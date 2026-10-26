// Physics props (crates, barrels, balls, thrown blocks, ragdolls, corpses)
// and simple voxel entities (lit TNT, falling sand, dropped items, nukes).
import * as THREE from 'three';
import { RigidEntity, VoxelEntity, Entity } from './base.js';
import { CANNON } from '../physics/physics.js';
import { blockMesh, artMesh } from './blockMesh.js';
import { buildModel, box, canvasTex } from './models.js';
import { B, BLOCKS, SOLID, LIQUID, SHAPE } from '../world/blocks.js';
import { stackable } from '../items/items.js';

const crateTex = () => canvasTex('crate', 16, 16, (g) => {
  g.fillStyle = '#b08040'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#8a6030';
  for (let y = 0; y < 16; y += 4) g.fillRect(0, y, 16, 1);
  g.fillStyle = '#5a3a18'; g.fillRect(0, 0, 16, 2); g.fillRect(0, 14, 16, 2); g.fillRect(0, 0, 2, 16); g.fillRect(14, 0, 2, 16);
  for (let i = 1; i < 15; i++) { g.fillRect(i, i, 2, 1); }
});
const barrelTex = () => canvasTex('barrel', 16, 16, (g) => {
  g.fillStyle = '#c03020'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#801810'; g.fillRect(0, 2, 16, 1); g.fillRect(0, 13, 16, 1);
  g.fillStyle = '#f0d020'; g.fillRect(4, 6, 8, 4);
  g.fillStyle = '#202020'; g.fillRect(7, 6, 2, 3); g.fillRect(7, 9, 2, 1);
});
const ballTex = () => canvasTex('ball', 32, 16, (g) => {
  const cols = ['#f04040', '#ffffff', '#f0d020', '#ffffff', '#3070f0', '#ffffff', '#40c040', '#ffffff'];
  cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 4, 0, 4, 16); });
});
const melonTex = () => canvasTex('melonprop', 16, 16, (g) => {
  g.fillStyle = '#4a9a2a'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#2a6a1a'; for (let x = 0; x < 16; x += 4) g.fillRect(x, 0, 2, 16);
});

class Prop extends RigidEntity {
  constructor(game, type) {
    super(game, type);
    this.kind = 'prop';
    this.health = this.maxHealth = 30;
  }
  onHurt(amount, cause, source) {
    if (source?.pos || source?.position) {
      const sp = source.pos ?? source.position;
      const d = new THREE.Vector3().subVectors(this.pos, sp).normalize().multiplyScalar(Math.min(20, amount * 0.8));
      this.impulse(d);
    }
  }
  update(dt) {
    super.update(dt);
    this.updateLook(dt);
    if (this.life !== undefined) {
      this.life -= dt;
      if (this.life <= 0) { this.game.particles.poof(this.pos, 0xbbbbbb, 6); this.remove(); }
    }
  }
  serialize() {
    if (this.life !== undefined) return null;
    const q = this.body.quaternion;
    return { type: this.type, x: this.pos.x, y: this.pos.y, z: this.pos.z, q: [q.x, q.y, q.z, q.w], scale: this.scale, block: this.block, frozen: this.frozen };
  }
}

export class Crate extends Prop {
  constructor(game) {
    super(game, 'crate');
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.trackMaterial(new THREE.MeshLambertMaterial({ map: crateTex() })));
    this.mesh.add(m);
    this.makeBody(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), 25);
    this.height = 1;
  }
  onDeath() {
    this.game.particles.blockBreak(this.pos.x - 0.5, this.pos.y - 0.5, this.pos.z - 0.5, B.planks, 25);
    this.game.audio.play('break', { pos: this.pos, material: 'wood' });
  }
}

export class Barrel extends Prop {
  constructor(game) {
    super(game, 'barrel');
    this.health = this.maxHealth = 6;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 14), this.trackMaterial(new THREE.MeshLambertMaterial({ map: barrelTex() })));
    this.mesh.add(m);
    const body = this.makeBody(new CANNON.Cylinder(0.4, 0.4, 1.1, 10), 20);
    body.addEventListener('collide', (e) => {
      if (Math.abs(e.contact.getImpactVelocityAlongNormal()) > 14) this.damage(10, 'impact');
    });
  }
  onHurt(amount, cause) {
    super.onHurt(amount, cause);
    if (this.health > 0 && this.health < 4) this.burning = true;
  }
  update(dt) {
    super.update(dt);
    if (this.burning) {
      this.burnTime = (this.burnTime ?? 2) - dt;
      if (Math.random() < 0.6) this.game.particles.fire(this.pos.x, this.pos.y + 0.5, this.pos.z, 0.6);
      if (this.burnTime <= 0) this.kill('fire');
    }
  }
  onDeath() {
    this.game.explode(this.pos, 3.8, { fire: true });
  }
}

export class Ball extends Prop {
  constructor(game, heavy = false) {
    super(game, heavy ? 'bowling' : 'ball');
    const r = heavy ? 0.35 : 0.5;
    const mat = heavy ? new THREE.MeshPhongMaterial({ color: 0x202048, shininess: 80 }) : new THREE.MeshLambertMaterial({ map: ballTex() });
    this.trackMaterial(mat);
    this.mesh.add(new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), mat));
    const body = this.makeBody(new CANNON.Sphere(r), heavy ? 60 : 0.8, { linearDamping: heavy ? 0.02 : 0.15, angularDamping: 0.2 });
    const m = new CANNON.Material(heavy ? 'heavy' : 'bouncy');
    body.material = m;
    game.physics.world.addContactMaterial(new CANNON.ContactMaterial(game.physics.groundMat, m, { friction: heavy ? 0.1 : 0.4, restitution: heavy ? 0.1 : 0.8 }));
    this.height = r * 2;
  }
  invulnerable = true;
}

export class Melon extends Prop {
  constructor(game) {
    super(game, 'melon_prop');
    this.health = this.maxHealth = 3;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), this.trackMaterial(new THREE.MeshLambertMaterial({ map: melonTex() })));
    m.scale.set(1, 0.85, 1.2);
    this.mesh.add(m);
    const body = this.makeBody(new CANNON.Sphere(0.45), 6, { angularDamping: 0.4 });
    body.addEventListener('collide', (e) => {
      if (Math.abs(e.contact.getImpactVelocityAlongNormal()) > 9) this.damage(10, 'impact');
    });
  }
  onDeath() {
    const g = this.game;
    for (let i = 0; i < 30; i++) g.particles.debris(this.pos.x, this.pos.y, this.pos.z, new THREE.Color(i % 4 ? 0xe03040 : 0x40a040), (Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8, 0.1, 1.2);
    g.audio.play('splash', { pos: this.pos });
  }
}

export class Domino extends Prop {
  constructor(game) {
    super(game, 'domino');
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.16), this.trackMaterial(new THREE.MeshLambertMaterial({ color: 0xf4f4f0 })));
    this.mesh.add(m);
    const dots = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.17), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    for (const y of [0.4, -0.4]) { const d = dots.clone(); d.position.y = y; this.mesh.add(d); }
    this.makeBody(new CANNON.Box(new CANNON.Vec3(0.4, 0.8, 0.08)), 3, { angularDamping: 0.05 });
    this.height = 1.6;
  }
  invulnerable = true;
}

// A block knocked loose by an explosion or picked up with the gravity gun.
// Once it settles it snaps back into the world as a real block.
export class PhysBlock extends Prop {
  constructor(game, opts = {}) {
    super(game, 'block');
    this.block = opts.block ?? B.stone;
    this.mesh.add(blockMesh(game, this.block, 1));
    this.makeBody(new CANNON.Box(new CANNON.Vec3(0.49, 0.49, 0.49)), 18, { angularDamping: 0.2 });
    if (opts.life) this.life = opts.life;
    this.restTime = 0;
    this.invulnerable = true;
    this.pickable = true;
  }
  update(dt) {
    super.update(dt);
    if (this.removed || this.held) { this.restTime = 0; return; }
    const v = this.body.velocity, a = this.body.angularVelocity;
    if (v.lengthSquared() + a.lengthSquared() < 0.05 || this.body.sleepState === CANNON.Body.SLEEPING) this.restTime += dt;
    else this.restTime = 0;
    if (this.restTime > 1.5 && this.life === undefined) this.settle();
  }
  settle() {
    const w = this.game.world;
    const x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + 0.1), z = Math.floor(this.pos.z);
    const here = w.getBlock(x, y, z);
    if (here === 0 || LIQUID[here] || SHAPE[here] === 1) {
      w.setBlock(x, y, z, this.block);
      this.remove();
    } else this.restTime = 0;
  }
}

// Mob bodies tumble physically after death, then vanish.
export class Corpse extends Prop {
  constructor(game, opts) {
    super(game, 'corpse');
    const src = opts.source;
    this.persistent = false;
    this.pickable = true;
    this.invulnerable = true;
    const model = buildModel(this, src.type);
    if (src.type === 'sheep' && model.wool) model.wool.material.color?.set?.(src.woolColor);
    const h = src.def.h * src.scale, w = src.def.hw * src.scale;
    model.root.scale.setScalar(src.scale);
    model.root.position.y = -h / 2;
    model.root.rotation.y = src.yaw;
    this.mesh.add(model.root);
    this.makeBody(new CANNON.Box(new CANNON.Vec3(w, h / 2, w)), 30 * src.scale, { angularDamping: 0.3 });
    this.body.position.set(src.pos.x, src.pos.y + h / 2, src.pos.z);
    this.life = 3;
    const force = opts.force ?? new THREE.Vector3((Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2);
    this.body.velocity.set(force.x + src.vel.x, force.y + src.vel.y, force.z + src.vel.z);
    this.body.angularVelocity.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6 + 3);
    this.brightness = src.brightness;
  }
  update(dt) {
    super.update(dt);
    for (const m of this.mats) m.mat.color.copy(m.base).multiplyScalar(this.brightness).lerp(new THREE.Color(1, 0.2, 0.2), 0.35);
  }
  serialize() { return null; }
}

// A jointed humanoid that flops around: a test dummy.
export class Ragdoll extends Entity {
  constructor(game) {
    super(game, 'dummy');
    this.kind = 'prop';
    this.invulnerable = true;
    this.parts = [];
    const model = buildModel(this, 'dummy');
    const P = game.physics;
    const mk = (obj, half, mass, offset) => {
      const body = new CANNON.Body({ mass, linearDamping: 0.1, angularDamping: 0.4 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(...half)));
      body.entity = this;
      body.allowSleep = true;
      P.add(body);
      const holder = new THREE.Group();
      // Re-centre the visual on the body.
      obj.parent?.remove(obj);
      obj.position.set(...offset);
      obj.rotation.set(0, 0, 0);
      holder.add(obj);
      game.scene.add(holder);
      this.parts.push({ body, holder });
      return body;
    };
    // Detach limb meshes from their pivots so each limb is its own body.
    const torsoMesh = model.body;
    const headMesh = model.head.children[0];
    const armMeshes = model.arms.map((a) => a.children[0]);
    const legMeshes = model.legs.map((l) => l.children[0]);
    this.torso = mk(torsoMesh, [0.25, 0.375, 0.125], 20, [0, 0, 0]);
    this.headB = mk(headMesh, [0.25, 0.25, 0.25], 6, [0, 0, 0]);
    this.arms = armMeshes.map((m) => mk(m, [0.125, 0.375, 0.125], 4, [0, 0, 0]));
    this.legs = legMeshes.map((m) => mk(m, [0.125, 0.375, 0.125], 8, [0, 0, 0]));
    const C = CANNON;
    const join = (a, b, pa, pb) => {
      const c = new C.ConeTwistConstraint(a, b, { pivotA: new C.Vec3(...pa), pivotB: new C.Vec3(...pb), axisA: C.Vec3.UNIT_Y, axisB: C.Vec3.UNIT_Y, angle: 0.8, twistAngle: 0.5 });
      P.world.addConstraint(c);
      (this.constraints ??= []).push(c);
    };
    join(this.torso, this.headB, [0, 0.375, 0], [0, -0.27, 0]);
    join(this.torso, this.arms[0], [-0.38, 0.33, 0], [0, 0.35, 0]);
    join(this.torso, this.arms[1], [0.38, 0.33, 0], [0, 0.35, 0]);
    join(this.torso, this.legs[0], [-0.125, -0.38, 0], [0, 0.37, 0]);
    join(this.torso, this.legs[1], [0.125, -0.38, 0], [0, 0.37, 0]);
    this.height = 1.9;
  }
  place(pos, yaw = 0) {
    const set = (b, x, y, z) => { b.position.set(pos.x + x, pos.y + y, pos.z + z); b.quaternion.setFromEuler(0, yaw, 0); };
    set(this.torso, 0, 1.15, 0);
    set(this.headB, 0, 1.8, 0);
    set(this.arms[0], -0.38, 1.15, 0);
    set(this.arms[1], 0.38, 1.15, 0);
    set(this.legs[0], -0.125, 0.38, 0);
    set(this.legs[1], 0.125, 0.38, 0);
    this.pos.copy(pos);
  }
  get body() { return this.torso; }
  get center() { return new THREE.Vector3(this.torso.position.x, this.torso.position.y, this.torso.position.z); }
  impulse(v) { for (const p of this.parts) { p.body.wakeUp(); p.body.velocity.x += v.x; p.body.velocity.y += v.y; p.body.velocity.z += v.z; } }
  damage(amount, cause, source) {
    this.hurtTime = 0.3;
    const sp = source?.pos ?? source?.position;
    if (sp) this.impulse(new THREE.Vector3().subVectors(this.center, sp).normalize().multiplyScalar(Math.min(25, amount)));
    this.game.particles.blood(this.center, 0xd0b080, 4);
    return true;
  }
  bounds(out = new THREE.Box3()) {
    out.makeEmpty();
    for (const p of this.parts) out.expandByPoint(new THREE.Vector3(p.body.position.x, p.body.position.y, p.body.position.z));
    out.expandByScalar(0.3);
    return out;
  }
  update(dt) {
    this.age += dt;
    for (const p of this.parts) {
      p.holder.position.set(p.body.position.x, p.body.position.y, p.body.position.z);
      p.holder.quaternion.set(p.body.quaternion.x, p.body.quaternion.y, p.body.quaternion.z, p.body.quaternion.w);
      if (this.frozen) { p.body.velocity.set(0, 0, 0); p.body.angularVelocity.set(0, 0, 0); }
    }
    this.pos.set(this.torso.position.x, this.torso.position.y - 1.1, this.torso.position.z);
    this.updateLook(dt);
    if (this.torso.position.y < -60) this.remove();
  }
  setScale() { /* jointed bodies keep their size */ }
  dispose() {
    for (const c of this.constraints ?? []) this.game.physics.world.removeConstraint(c);
    for (const p of this.parts) { this.game.physics.remove(p.body); this.game.scene.remove(p.holder); }
  }
  serialize() { return { type: 'dummy', x: this.pos.x, y: this.pos.y, z: this.pos.z }; }
}

// ---- voxel-physics entities ----

export class PrimedTnt extends VoxelEntity {
  constructor(game, opts = {}) {
    super(game, 'primed_tnt', 0.49, 0.98);
    this.kind = 'explosive';
    this.fuse = opts.fuse ?? 4;
    this.power = opts.power ?? 4;
    this.mesh.add(blockMesh(game, B.tnt, 0.98));
    this.mesh.children[0].position.y = 0.49;
    this.flash = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    this.flash.position.y = 0.49;
    this.mesh.add(this.flash);
    if (opts.vel) this.vel.copy(opts.vel); else this.vel.set((Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2);
    this.drag = 2;
    this.persistent = false;
    game.audio.play('fuse', { pos: this.pos });
  }
  update(dt) {
    super.update(dt);
    this.fuse -= dt;
    this.physics(dt);
    this.mesh.position.copy(this.pos);
    this.flash.material.opacity = Math.sin(this.age * 12) > 0.3 ? 0.6 : 0;
    const s = this.fuse < 0.5 ? 1 + (0.5 - this.fuse) * 0.3 : 1;
    this.mesh.children[0].scale.setScalar(0.98 * s);
    if (Math.random() < 0.3) this.game.particles.smoke(this.pos.x, this.pos.y + 1.1, this.pos.z, 0.15, 0.8);
    if (this.fuse <= 0 && !this.removed) {
      this.remove();
      this.game.explode({ x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z }, this.power, {});
    }
  }
  damage() { return false; }
}

export class FallingBlock extends VoxelEntity {
  constructor(game, opts = {}) {
    super(game, 'falling_block', 0.48, 0.98);
    this.kind = 'misc';
    this.block = opts.block ?? B.sand;
    const m = blockMesh(game, this.block, 0.98);
    m.position.y = 0.49;
    this.mesh.add(m);
    this.persistent = false;
    this.pickable = false;
    this.stepHeight = 0;
  }
  update(dt) {
    super.update(dt);
    this.physics(dt);
    this.mesh.position.copy(this.pos);
    if (this.onGround || this.age > 30) {
      const w = this.game.world;
      const x = Math.floor(this.pos.x), y = Math.floor(this.pos.y + 0.3), z = Math.floor(this.pos.z);
      const here = w.getBlock(x, y, z);
      if (here === 0 || LIQUID[here] || SHAPE[here] === 1) {
        w.setBlock(x, y, z, this.block);
        this.game.audio.play('place', { pos: this.pos, material: BLOCKS[this.block].sound });
      } else this.game.particles.blockBreak(x, y, z, this.block, 8);
      this.remove();
    }
  }
}

export class DroppedItem extends VoxelEntity {
  constructor(game, opts = {}) {
    super(game, 'item', 0.15, 0.3);
    this.kind = 'item';
    this.stack = { ...opts.stack };
    const s = this.stack;
    let m;
    if (s.kind === 'block') { m = blockMesh(game, s.id, 0.3); }
    else { m = artMesh(s.kind === 'tool' ? s.key : 'hand'); m.scale.setScalar(0.45); }
    this.model = m;
    this.mesh.add(m);
    this.pickupDelay = opts.delay ?? 0.6;
    this.vel.set((Math.random() - 0.5) * 3, 4, (Math.random() - 0.5) * 3);
    if (opts.vel) this.vel.copy(opts.vel);
    this.drag = 1.5;
    this.pickable = false;
    this.life = 300;
  }
  update(dt) {
    super.update(dt);
    const g = this.game;
    this.pickupDelay -= dt;
    this.life -= dt;
    if (this.life <= 0) { this.remove(); return; }
    const pp = g.player.position.add(new THREE.Vector3(0, 0.6, 0));
    const d = pp.distanceTo(this.pos);
    if (this.pickupDelay <= 0 && d < 2.5 && !g.player.dead) {
      if (d < 0.9) {
        const left = g.inventory.add(this.stack);
        if (left < this.stack.count) g.audio.play('pop');
        if (left <= 0) { this.remove(); return; }
        this.stack.count = left;
      } else this.vel.add(pp.sub(this.pos).normalize().multiplyScalar(dt * 40));
    }
    this.physics(dt);
    this.model.rotation.y += dt * 2;
    this.mesh.position.set(this.pos.x, this.pos.y + 0.15 + Math.sin(this.age * 3) * 0.05, this.pos.z);
  }
  serialize() { return { type: 'item', x: this.pos.x, y: this.pos.y, z: this.pos.z, stack: this.stack }; }
}

export class Nuke extends VoxelEntity {
  constructor(game) {
    super(game, 'nuke', 0.5, 1.5);
    this.kind = 'explosive';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 12), new THREE.MeshLambertMaterial({ color: 0x4a5a3a }));
    body.position.y = 0.8;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4a5a3a }));
    nose.rotation.x = Math.PI; nose.position.y = 0;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.2, 12), new THREE.MeshLambertMaterial({ color: 0xe0e020 }));
    band.position.y = 1.0;
    const fins = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.06), new THREE.MeshLambertMaterial({ color: 0x3a4a2a }));
    fins.position.y = 1.7;
    const fins2 = fins.clone(); fins2.rotation.y = Math.PI / 2;
    this.mesh.add(body, nose, band, fins, fins2);
    this.vel.set(0, -10, 0);
    this.persistent = false;
    this.whistle = 0;
  }
  update(dt) {
    super.update(dt);
    this.whistle -= dt;
    if (this.whistle <= 0) { this.whistle = 0.5; this.game.audio.play('whoosh', { pos: this.pos }); }
    this.physics(dt);
    this.mesh.position.copy(this.pos);
    if ((this.onGround || this.inWater || this.wall) && !this.removed) {
      this.remove();
      const g = this.game;
      g.explode({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 13, { fire: true });
      g.weather.flash = 1;
      g.shake = 2;
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 4;
        const h = Math.random();
        g.particles.normal.emit(this.pos.x + Math.cos(a) * r, this.pos.y + h * 25, this.pos.z + Math.sin(a) * r, Math.cos(a) * (h > 0.8 ? 6 : 1), 6 + Math.random() * 4, Math.sin(a) * (h > 0.8 ? 6 : 1), 6 + Math.random() * 4, 2.5, 0.35, 0.3, 0.28, 0.8, 1.5, -0.5);
      }
    }
  }
  damage() { return false; }
}

export { SOLID, stackable, box };
