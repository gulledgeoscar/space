// First-person controller: walking, sprinting, sneaking, jumping, swimming,
// climbing, creative flight and noclip, plus health, hunger and air.
import * as THREE from 'three';
import { moveBody, forBlocksInBox, boxBlocked } from '../physics/voxelCollide.js';
import { BLOCKS, LIQUID, B } from '../world/blocks.js';

const STAND_H = 1.8, CROUCH_H = 1.5;
const STAND_EYE = 1.62, CROUCH_EYE = 1.27;

export class Player {
  constructor(game) {
    this.game = game;
    this.box = { x: 0.5, y: 80, z: 0.5, hw: 0.3, h: STAND_H };
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eye = STAND_EYE;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.inLava = false;
    this.onLadder = false;
    this.flying = false;
    this.noclip = false;
    this.sprinting = false;
    this.crouching = false;
    this.health = 20;
    this.maxHealth = 20;
    this.hunger = 20;
    this.saturation = 5;
    this.air = 10;
    this.fallStart = null;
    this.hurtTimer = 0;
    this.invuln = 0;
    this.dead = false;
    this.bob = 0;
    this.bobAmount = 0;
    this.fovKick = 0;
    this.burning = 0;
    this.vehicle = null;
    this.spawn = new THREE.Vector3(0.5, 80, 0.5);
    this.stepDist = 0;
    this.knock = new THREE.Vector3();
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.jetFuel = 1;
    this.grapple = null;
    this.speedBoost = 0;
    this.lastDamageCause = '';
  }

  get position() { return new THREE.Vector3(this.box.x, this.box.y, this.box.z); }
  get eyePos() { return new THREE.Vector3(this.box.x, this.box.y + this.eye, this.box.z); }

  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  teleport(x, y, z) {
    this.box.x = x; this.box.y = y; this.box.z = z;
    this.vel.set(0, 0, 0);
    this.fallStart = null;
  }

  get creative() { return this.game.mode !== 'survival'; }

  look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  damage(amount, cause = 'generic', from = null) {
    if (this.dead || this.creative || this.invuln > 0 || amount <= 0) return false;
    this.health -= amount;
    this.hurtTimer = 0.35;
    this.invuln = 0.45;
    this.lastDamageCause = cause;
    this.game.audio?.play('hurt');
    this.game.hud?.flashDamage();
    if (from) {
      const k = new THREE.Vector3(this.box.x - from.x, 0, this.box.z - from.z).normalize().multiplyScalar(7);
      this.vel.x += k.x; this.vel.z += k.z; this.vel.y = Math.max(this.vel.y, 5);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.game.onPlayerDeath(cause);
    }
    return true;
  }

  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }

  respawn() {
    this.dead = false;
    this.health = this.maxHealth;
    this.hunger = 20;
    this.air = 10;
    this.burning = 0;
    this.teleport(this.spawn.x, this.spawn.y, this.spawn.z);
    this.game.findSafeSpawn?.(this);
  }

  update(dt, input) {
    const g = this.game;
    const s = g.settings;
    if (this.dead) return;
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.invuln = Math.max(0, this.invuln - dt);

    if (this.vehicle) {
      this.updateRiding(dt, input);
      return;
    }

    // Toggle flight with a double-tap of space (creative / spectator).
    if (g.mode === 'spectator') { this.flying = true; this.noclip = true; }
    else if (this.noclip && g.mode !== 'spectator' && !g.noclipCheat) this.noclip = false;
    if (this.creative && input.doubleTap('Space') && g.mode !== 'spectator') {
      this.flying = !this.flying;
      if (!this.flying) this.noclip = false;
    }
    if (!this.creative) { this.flying = false; this.noclip = g.noclipCheat; }

    // Environment probes.
    this.inWater = false; this.inLava = false; this.onLadder = false;
    let hot = false;
    forBlocksInBox(g.world, { ...this.box, hw: this.box.hw - 0.001, h: this.box.h - 0.1 }, (id) => {
      if (LIQUID[id] === 1) this.inWater = true;
      else if (LIQUID[id] === 2) this.inLava = true;
      if (BLOCKS[id]?.climbable) this.onLadder = true;
      if (id === B.fire) hot = true;
    });
    const headId = g.world.getBlock(this.box.x, this.box.y + this.eye, this.box.z);
    this.headInWater = LIQUID[headId] === 1;
    this.headInLava = LIQUID[headId] === 2;
    const below = g.world.getBlock(this.box.x, this.box.y - 0.05, this.box.z);
    const belowBlock = BLOCKS[below] || null;

    // Input.
    const fwd = input.axis('KeyS', 'KeyW');
    const strafe = input.axis('KeyA', 'KeyD');
    const wantSprint = input.key('ControlLeft') || input.key('ControlRight') || (input.doubleTap('KeyW'));
    if (wantSprint && fwd > 0) this.sprinting = true;
    if (fwd <= 0 || this.crouching || (!this.creative && this.hunger <= 6)) this.sprinting = false;
    this.crouching = !this.flying && input.key('ShiftLeft');

    // Crouch height (only stand up when there is room).
    const wantH = this.crouching ? CROUCH_H : STAND_H;
    if (wantH !== this.box.h) {
      const test = { ...this.box, h: wantH };
      if (wantH < this.box.h || !boxBlocked(g.world, test)) this.box.h = wantH;
    }
    const eyeTarget = this.box.h === CROUCH_H ? CROUCH_EYE : STAND_EYE;
    this.eye += (eyeTarget - this.eye) * Math.min(1, dt * 14);

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const wishX = -sinY * fwd + cosY * strafe;
    const wishZ = -cosY * fwd - sinY * strafe;
    const wishLen = Math.hypot(wishX, wishZ) || 1;
    const mult = s.speedMult ?? 1;
    const gravity = g.gravity;

    if (this.flying) {
      let speed = (this.sprinting ? 22 : 11) * mult * (g.mode === 'spectator' ? 1.3 : 1);
      const ty = input.axis('ShiftLeft', 'Space') * speed * 0.8;
      const tx = (wishX / wishLen) * speed * Math.min(1, Math.abs(fwd) + Math.abs(strafe));
      const tz = (wishZ / wishLen) * speed * Math.min(1, Math.abs(fwd) + Math.abs(strafe));
      const k = Math.min(1, dt * 10);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;
      this.vel.y += (ty - this.vel.y) * k;
      this.fallStart = null;
    } else {
      let speed = this.crouching ? 1.4 : this.sprinting ? 5.8 : 4.3;
      speed *= mult;
      if (this.speedBoost > 0) { speed *= 2.2; this.speedBoost -= dt; }
      if (this.inWater || this.inLava) speed *= this.inLava ? 0.45 : 0.6;
      const tx = (wishX / wishLen) * speed * Math.min(1, Math.abs(fwd) + Math.abs(strafe));
      const tz = (wishZ / wishLen) * speed * Math.min(1, Math.abs(fwd) + Math.abs(strafe));
      let accel = this.onGround ? 14 : 3.2;
      if (this.onGround && (belowBlock?.slippery || below === B.ice)) accel = 1.6;
      if (this.inWater) accel = 5;
      const k = Math.min(1, dt * accel);
      this.vel.x += (tx - this.vel.x) * k;
      this.vel.z += (tz - this.vel.z) * k;

      if (this.inWater || this.inLava) {
        this.vel.y -= gravity * 0.22 * dt;
        this.vel.y *= 1 - Math.min(1, dt * 3);
        if (input.key('Space')) this.vel.y = Math.min(this.vel.y + 22 * dt, 4);
        if (input.key('ShiftLeft')) this.vel.y -= 10 * dt;
        this.fallStart = null;
      } else if (this.onLadder) {
        this.vel.y = input.key('Space') || fwd > 0 ? 3.2 : input.key('ShiftLeft') ? 0 : Math.max(this.vel.y - gravity * dt, -2.5);
        this.fallStart = null;
      } else {
        this.vel.y -= gravity * dt;
        if (this.vel.y < -78) this.vel.y = -78;
      }

      // Jump.
      if (input.key('Space') && this.onGround && !this.inWater) {
        this.vel.y = 8.6 * Math.sqrt(gravity / 28) * (s.jumpMult ?? 1);
        if (this.sprinting) { this.vel.x += -sinY * 1.6; this.vel.z += -cosY * 1.6; }
        this.exhaustion += this.sprinting ? 0.2 : 0.05;
      }
      // Jetpack.
      if (g.holding('jetpack') && input.key('Space') && !this.onGround && this.jetFuel > 0) {
        this.vel.y = Math.min(this.vel.y + 34 * dt, 9);
        this.jetFuel -= dt * (this.creative ? 0 : 0.2);
        g.particles?.jet(this);
        this.fallStart = null;
      }
      if (this.onGround) this.jetFuel = Math.min(1, this.jetFuel + dt * 0.5);
    }

    // Grappling hook pull.
    if (this.grapple) {
      const to = new THREE.Vector3().subVectors(this.grapple, this.eyePos);
      const d = to.length();
      if (d < 1.5 || input.key('Space')) this.grapple = null;
      else { to.multiplyScalar(1 / d); this.vel.addScaledVector(to, 60 * dt); this.vel.multiplyScalar(1 - dt * 0.8); this.fallStart = null; }
    }

    // Knockback impulses.
    this.vel.add(this.knock);
    this.knock.set(0, 0, 0);

    // Move.
    const startY = this.box.y;
    const wasGround = this.onGround;
    if (this.noclip) {
      this.box.x += this.vel.x * dt; this.box.y += this.vel.y * dt; this.box.z += this.vel.z * dt;
      this.onGround = false;
    } else {
      const extra = g.entities?.solidBoxesNear(this.box) ?? null;
      const preVy = this.vel.y;
      // Sneaking keeps you from walking off edges.
      const sx = this.box.x, sz = this.box.z;
      const res = moveBody(g.world, { box: this.box, vel: this.vel, stepHeight: this.onGround ? 0.55 : 0, onGround: this.onGround }, dt, extra);
      if (this.crouching && wasGround && !this.flying) {
        const probe = { ...this.box, y: this.box.y - 0.6, h: 0.55 };
        if (!boxBlocked(g.world, probe) && !extra?.some((e) => e.max.y > probe.y)) {
          this.box.x = sx; this.box.z = sz; this.vel.x = 0; this.vel.z = 0;
        }
      }
      this.onGround = res.ground;
      if (this.flying && res.ground && !this.noclip && g.mode !== 'spectator') this.flying = false;

      // Landing: fall damage and bouncy blocks.
      if (res.ground) {
        const landed = g.world.getBlock(this.box.x, this.box.y - 0.05, this.box.z);
        const lb = BLOCKS[landed];
        if (lb?.bounce && preVy < -3 && !this.crouching) { this.vel.y = -preVy * lb.bounce; this.onGround = false; }
        if (lb?.launch) { this.vel.y = lb.launch; this.onGround = false; g.audio?.play('boing'); }
        if (lb?.speed) this.speedBoost = 2.5;
        if (lb?.hot && !this.crouching) this.damage(1, 'magma');
        if (this.fallStart !== null) {
          const fell = this.fallStart - this.box.y;
          if (fell > 3.5 && !lb?.bounce && !this.inWater && landed !== B.hay) this.damage(Math.floor(fell - 3), 'fall');
          if (fell > 1.2) g.audio?.play('land', { material: lb?.sound });
        }
        this.fallStart = null;
      } else if (!this.flying && !this.inWater && !this.onLadder) {
        if (this.fallStart === null || this.box.y > this.fallStart) this.fallStart = Math.max(this.box.y, startY);
      }
    }
    if (this.box.y < -40) { this.damage(1000, 'void'); if (this.creative) this.teleport(this.box.x, 120, this.box.z); }

    // Footsteps and view bob.
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.bob += hs * dt * 1.6;
      this.stepDist += hs * dt;
      if (this.stepDist > (this.sprinting ? 2.2 : 1.8)) {
        this.stepDist = 0;
        g.audio?.play('step', { material: belowBlock?.sound ?? 'stone' });
        this.exhaustion += 0.01;
      }
    }
    this.bobAmount += ((this.onGround && hs > 0.5 ? Math.min(1, hs / 5) : 0) - this.bobAmount) * Math.min(1, dt * 8);
    this.fovKick += ((this.sprinting ? 1 : 0) - this.fovKick) * Math.min(1, dt * 6);

    // Swimming splash when entering water.
    if (this.inWater && !this.wasInWater && this.vel.y < -4) g.audio?.play('splash');
    this.wasInWater = this.inWater;

    this.survivalTick(dt, hot);
  }

  survivalTick(dt, hot) {
    const g = this.game;
    if (this.creative) { this.air = 10; this.burning = 0; return; }
    // Drowning.
    if (this.headInWater) {
      this.air -= dt;
      if (this.air < 0) { this.air += 1; this.damage(2, 'drown'); }
    } else this.air = Math.min(10, this.air + dt * 4);
    // Fire and lava.
    if (this.inLava || this.headInLava) { this.damage(4, 'lava'); this.burning = 6; }
    if (hot) this.burning = Math.max(this.burning, 4);
    if (this.inWater) this.burning = 0;
    if (this.burning > 0) {
      this.burning -= dt;
      this.burnTick = (this.burnTick ?? 0) + dt;
      if (this.burnTick > 1) { this.burnTick = 0; this.damage(1, 'fire'); }
    }
    // Hunger.
    if (this.sprinting) this.exhaustion += dt * 0.1;
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
    this.regenTimer += dt;
    if (this.regenTimer > 4) {
      this.regenTimer = 0;
      if (this.hunger >= 18 && this.health < this.maxHealth) { this.heal(1); this.exhaustion += 1.5; }
      else if (this.hunger <= 0 && g.difficulty !== 'peaceful') this.damage(1, 'starve');
    }
    if (g.difficulty === 'peaceful') { this.hunger = 20; if (this.regenTimer > 1) { this.regenTimer = 0; this.heal(1); } }
  }

  eat(food) {
    this.hunger = Math.min(20, this.hunger + food);
    this.saturation = Math.min(this.hunger, this.saturation + food * 0.6);
    this.game.audio?.play('eat');
  }

  updateRiding(dt, input) {
    const v = this.vehicle;
    if (input.hit('ShiftLeft') || v.dead) { this.game.entities.dismount(this); return; }
    const seat = v.seatPosition();
    this.box.x = seat.x; this.box.y = seat.y; this.box.z = seat.z;
    this.vel.set(0, 0, 0);
    this.onGround = false;
    this.fallStart = null;
    this.bobAmount = 0;
    v.drive?.(input, dt, this);
  }

  // Camera placement each frame.
  applyCamera(camera, thirdPerson, dt) {
    const eye = this.eyePos;
    const bob = this.game.settings.viewBob !== false ? this.bobAmount : 0;
    const bx = Math.cos(this.bob * 2) * 0.04 * bob;
    const by = Math.abs(Math.sin(this.bob * 2)) * 0.06 * bob;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
    if (this.vehicle?.cameraRoll) camera.rotation.z = this.vehicle.cameraRoll;
    if (this.hurtTimer > 0) camera.rotation.z += Math.sin(this.hurtTimer * 30) * 0.03;
    if (this.dead) camera.rotation.z = 0.6;
    camera.position.set(eye.x, eye.y + by, eye.z);
    camera.translateX(bx);
    if (thirdPerson) {
      const back = new THREE.Vector3(0, 0, 1).applyEuler(camera.rotation);
      const dist = this.vehicle ? this.vehicle.cameraDistance ?? 6 : 4;
      const hit = this.game.world.raycast(camera.position, back, dist, (id) => BLOCKS[id]?.opaque);
      const d = hit ? Math.max(0.3, hit.dist - 0.3) : dist;
      camera.position.addScaledVector(back, d);
    }
    const base = this.game.settings.fov ?? 75;
    const zoom = this.game.zoom ? 0.3 : 1;
    const target = (base + this.fovKick * 8 + (this.vehicle?.speedFov ?? 0)) * zoom;
    if (Math.abs(camera.fov - target) > 0.05) {
      camera.fov += (target - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
  }
}
