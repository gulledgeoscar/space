// Entity base classes.
//   Entity       — anything in the world with a mesh and an update.
//   VoxelEntity  — moves with axis-aligned box collision against blocks.
//   RigidEntity  — driven by a cannon-es body.
import * as THREE from 'three';
import { moveBody, forBlocksInBox } from '../physics/voxelCollide.js';
import { LIQUID, BLOCKS } from '../world/blocks.js';
import { CANNON } from '../physics/physics.js';

let nextId = 1;

export class Entity {
  constructor(game, type) {
    this.game = game;
    this.type = type;
    this.id = nextId++;
    this.kind = 'misc';
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.mesh = new THREE.Group();
    this.health = 10;
    this.maxHealth = 10;
    this.dead = false;
    this.removed = false;
    this.frozen = false;
    this.scale = 1;
    this.age = 0;
    this.hurtTime = 0;
    this.mats = [];
    this.brightness = 1;
    this.lightTimer = Math.random();
    this.persistent = true;   // saved with the world
    this.pickable = true;     // hit by guns, gravity gun and tools
    this.radius = 0.5;
    this.height = 1;
  }

  // Register a material for the per-entity brightness and hurt tint.
  trackMaterial(mat) {
    this.mats.push({ mat, base: mat.color.clone() });
    return mat;
  }

  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * this.scale * 0.5, this.pos.z); }

  update(dt) { this.age += dt; }

  // Dim entities that are underground or roofed over; tint red when hurt.
  updateLook(dt) {
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.4;
      const w = this.game.world;
      const top = w.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z), false);
      const covered = top > this.pos.y + this.height * this.scale + 0.5;
      const sky = this.game.sky.daylight;
      this.brightness = covered ? Math.max(0.35, (1 - Math.min(1, (top - this.pos.y) / 12)) * 0.8) : 1;
      this.brightness *= 0.45 + 0.55 * Math.min(1, sky * 1.2);
      this.brightness = Math.max(0.18, this.brightness);
    }
    this.hurtTime = Math.max(0, this.hurtTime - dt);
    const hurt = this.hurtTime > 0;
    for (const m of this.mats) {
      m.mat.color.copy(m.base).multiplyScalar(this.brightness);
      if (hurt) m.mat.color.lerp(new THREE.Color(1, 0.15, 0.1), 0.55);
      if (this.frozen) m.mat.color.lerp(new THREE.Color(0.6, 0.85, 1), 0.5);
    }
  }

  damage(amount, cause = 'generic', source = null) {
    if (this.dead || this.invulnerable) return false;
    this.health -= amount;
    this.hurtTime = 0.3;
    this.onHurt?.(amount, cause, source);
    if (this.health <= 0) this.kill(cause, source);
    return true;
  }

  kill(cause, source) {
    if (this.dead) return;
    this.dead = true;
    this.onDeath?.(cause, source);
    this.remove();
  }

  remove() {
    this.removed = true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
  }

  setScale(s) {
    this.scale = Math.max(0.1, Math.min(12, s));
    this.mesh.scale.setScalar(this.scale);
  }

  impulse(v) { this.vel.add(v); }

  // Axis-aligned bounds for gun hits and the player standing on things.
  bounds(out = new THREE.Box3()) {
    const r = this.radius * this.scale;
    out.min.set(this.pos.x - r, this.pos.y, this.pos.z - r);
    out.max.set(this.pos.x + r, this.pos.y + this.height * this.scale, this.pos.z + r);
    return out;
  }

  serialize() { return null; }
}

export class VoxelEntity extends Entity {
  constructor(game, type, hw = 0.3, h = 1) {
    super(game, type);
    this.baseHw = hw;
    this.baseH = h;
    this.box = { x: 0, y: 0, z: 0, hw, h };
    this.onGround = false;
    this.inWater = false;
    this.inLava = false;
    this.radius = hw;
    this.height = h;
    this.gravityScale = 1;
    this.drag = 0;
    this.stepHeight = 0.6;
    this.fallStart = null;
    this.bounce = 0;
    this.wall = false;
  }

  setScale(s) {
    super.setScale(s);
    this.box.hw = this.baseHw * this.scale;
    this.box.h = this.baseH * this.scale;
  }

  physics(dt) {
    const g = this.game;
    if (this.frozen) { this.vel.set(0, 0, 0); return; }
    this.box.x = this.pos.x; this.box.y = this.pos.y; this.box.z = this.pos.z;
    this.inWater = false; this.inLava = false;
    forBlocksInBox(g.world, { ...this.box, h: this.box.h * 0.6 }, (id) => {
      if (LIQUID[id] === 1) this.inWater = true;
      else if (LIQUID[id] === 2) this.inLava = true;
    });
    if (this.inWater || this.inLava) {
      this.vel.y += (this.buoyant ? 12 : -4) * dt;
      this.vel.multiplyScalar(1 - Math.min(1, dt * 2.5));
      this.fallStart = null;
    } else {
      this.vel.y -= g.gravity * this.gravityScale * dt;
    }
    if (this.drag) { this.vel.x *= 1 - Math.min(1, this.drag * dt); this.vel.z *= 1 - Math.min(1, this.drag * dt); }
    const preVy = this.vel.y;
    const res = moveBody(g.world, { box: this.box, vel: this.vel, stepHeight: this.onGround ? this.stepHeight * this.scale : 0, onGround: this.onGround }, dt);
    this.wall = res.wallX || res.wallZ;
    this.onGround = res.ground;
    if (res.ground) {
      const lb = BLOCKS[g.world.getBlock(this.box.x, this.box.y - 0.05, this.box.z)];
      if (lb?.bounce && preVy < -3) { this.vel.y = -preVy * lb.bounce; this.onGround = false; }
      else if (this.bounce && preVy < -2) { this.vel.y = -preVy * this.bounce; this.onGround = false; }
      if (lb?.launch) { this.vel.y = lb.launch; this.onGround = false; }
      if (this.fallStart !== null) {
        const fell = this.fallStart - this.box.y;
        if (fell > 4 && !lb?.bounce) this.onLand?.(fell);
      }
      this.fallStart = null;
    } else if (!this.inWater) {
      if (this.fallStart === null || this.box.y > this.fallStart) this.fallStart = this.box.y;
    }
    this.pos.set(this.box.x, this.box.y, this.box.z);
    if (this.pos.y < -60) this.kill('void');
  }
}

export class RigidEntity extends Entity {
  constructor(game, type) {
    super(game, type);
    this.body = null;
  }

  makeBody(shape, mass, opts = {}) {
    this.body = new CANNON.Body({ mass, linearDamping: opts.linearDamping ?? 0.05, angularDamping: opts.angularDamping ?? 0.1, material: opts.material });
    this.body.addShape(shape, opts.offset);
    this.body.allowSleep = true;
    this.body.sleepSpeedLimit = 0.15;
    this.body.sleepTimeLimit = 1.2;
    this.body.entity = this;
    this.body.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.game.physics.add(this.body);
    return this.body;
  }

  update(dt) {
    super.update(dt);
    if (!this.body) return;
    if (this.frozen) {
      this.body.type = CANNON.Body.STATIC;
      this.body.velocity.set(0, 0, 0);
      this.body.angularVelocity.set(0, 0, 0);
    } else if (this.body.type === CANNON.Body.STATIC && this.body.mass > 0) {
      this.body.type = CANNON.Body.DYNAMIC;
      this.body.wakeUp();
    }
    this.pos.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w);
  }

  impulse(v) {
    if (!this.body) return;
    this.body.wakeUp();
    this.body.velocity.x += v.x; this.body.velocity.y += v.y; this.body.velocity.z += v.z;
  }

  bounds(out = new THREE.Box3()) {
    const r = (this.body?.boundingRadius ?? 0.5) * 0.8;
    out.min.set(this.pos.x - r, this.pos.y - r, this.pos.z - r);
    out.max.set(this.pos.x + r, this.pos.y + r, this.pos.z + r);
    return out;
  }

  get center() { return this.pos.clone(); }

  setScale(s) {
    const old = this.scale;
    super.setScale(s);
    if (!this.body) return;
    const k = this.scale / old;
    for (const shape of this.body.shapes) {
      if (shape.halfExtents) { shape.halfExtents.scale(k, shape.halfExtents); shape.updateConvexPolyhedronRepresentation(); shape.updateBoundingSphereRadius(); }
      else if (shape.radius !== undefined) { shape.radius *= k; shape.updateBoundingSphereRadius(); }
    }
    this.body.mass *= k * k * k;
    this.body.updateMassProperties();
    this.body.updateBoundingRadius();
    this.body.aabbNeedsUpdate = true;
    this.body.wakeUp();
  }

  dispose() {
    super.dispose();
    this.game.physics.remove(this.body);
  }
}
