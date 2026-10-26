// Natural disasters you can unleash: a tornado that lifts everything, a
// meteor shower, and an earthquake that shakes the ground loose.
import * as THREE from 'three';
import { Entity } from './base.js';
import { B, BLOCKS, SOLID, LIQUID } from '../world/blocks.js';

export class Tornado extends Entity {
  constructor(game) {
    super(game, 'tornado');
    this.kind = 'disaster';
    this.persistent = false;
    this.pickable = false;
    this.invulnerable = true;
    this.life = 60;
    this.dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.liftTimer = 0;
    // Visible funnel: stacked translucent rings that twist.
    this.rings = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x5a5a62, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const r = 1.2 + i * i * 0.07;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.15, r, 3.2, 14, 1, true), mat);
      ring.position.y = i * 3;
      this.mesh.add(ring);
      this.rings.push(ring);
    }
    this.loop = null;
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    this.life -= dt;
    if (this.life <= 0) { this.remove(); return; }
    // Wander, drifting toward the player now and then.
    if (Math.random() < dt * 0.3) {
      const to = g.player.position.sub(this.pos).setY(0).normalize();
      this.dir.lerp(to, 0.4).add(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).multiplyScalar(0.6)).setY(0).normalize();
    }
    this.pos.addScaledVector(this.dir, dt * 5);
    const top = g.world.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z), true);
    if (top >= 0) this.pos.y += (top + 1 - this.pos.y) * Math.min(1, dt * 3);
    this.mesh.position.copy(this.pos);
    this.rings.forEach((r, i) => { r.rotation.y += dt * (6 - i * 0.2); r.position.x = Math.sin(this.age * 1.3 + i * 0.4) * i * 0.15; });

    // Suck things in: swirl around the axis while lifting.
    const pull = (pos, vel, mass = 1) => {
      const dx = this.pos.x - pos.x, dz = this.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 18 || pos.y > this.pos.y + 45) return false;
      const f = (1 - d / 18) * dt / Math.sqrt(mass);
      vel.x += (dx / (d + 0.1)) * 28 * f - (dz / (d + 0.1)) * 40 * f;
      vel.z += (dz / (d + 0.1)) * 28 * f + (dx / (d + 0.1)) * 40 * f;
      vel.y += (g.gravity + 10) * f * (d < 5 ? 1.6 : 0.8);
      return true;
    };
    const p = g.player;
    if (!p.vehicle && g.mode !== 'spectator' && !p.noclip) { if (pull(p.position, p.vel)) { p.fallStart = null; p.onGround = false; } }
    for (const e of g.entities.list) {
      if (e === this || e.removed || e.frozen) continue;
      if (e.body) {
        const v = e.body.velocity;
        const tmp = new THREE.Vector3(v.x, v.y, v.z);
        if (pull(e.pos, tmp, Math.max(1, e.body.mass / 10))) { e.body.wakeUp(); v.set(tmp.x, tmp.y, tmp.z); }
      } else if (e.vel && e.kind !== 'projectile') pull(e.pos, e.vel, Math.max(1, e.scale));
    }
    // Rip loose blocks from the ground.
    this.liftTimer -= dt;
    if (this.liftTimer <= 0) {
      this.liftTimer = 0.12;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 6;
      const x = Math.floor(this.pos.x + Math.cos(a) * r), z = Math.floor(this.pos.z + Math.sin(a) * r);
      const y = g.world.surfaceY(x, z, false);
      const id = g.world.getBlock(x, y, z);
      if (y > 0 && id > 0 && BLOCKS[id].hardness < 2.5 && id !== B.bedrock && !LIQUID[id]) {
        g.world.setBlock(x, y, z, 0);
        if (BLOCKS[id].shape === 'cube' && g.physics.bodies.size < 250) g.entities.spawn('block', { x: x + 0.5, y: y + 0.6, z: z + 0.5 }, { block: id, vel: new THREE.Vector3(0, 8, 0), spin: true, life: 25 });
      }
    }
    // Dust.
    for (let i = 0; i < 10; i++) {
      const h = Math.random() * 40, a = Math.random() * Math.PI * 2, r = 1 + h * 0.25;
      g.particles.normal.emit(this.pos.x + Math.cos(a) * r, this.pos.y + h, this.pos.z + Math.sin(a) * r, -Math.sin(a) * 12, 3, Math.cos(a) * 12, 1.2, 0.8, 0.45, 0.43, 0.4, 0.45, 1, 0);
    }
    // Roar.
    const loop = g.audio.noiseLoop(`tornado${this.id}`, { type: 'bandpass', f: 250, q: 0.6, gain: 0.5, brown: true });
    loop?.set(Math.max(0, 1 - this.pos.distanceTo(g.camera.position) / 120), 220);
    if (this.pos.distanceTo(g.player.position) < 40) g.shake = Math.max(g.shake, 0.15);
  }

  dispose() {
    super.dispose();
    this.game.audio.stopLoop(`tornado${this.id}`);
  }
}

export class MeteorShower extends Entity {
  constructor(game) {
    super(game, 'meteors');
    this.kind = 'disaster';
    this.persistent = false;
    this.pickable = false;
    this.invulnerable = true;
    this.life = 25;
    this.next = 0.5;
  }
  update(dt) {
    super.update(dt);
    const g = this.game;
    this.life -= dt;
    if (this.life <= 0) { this.remove(); return; }
    this.next -= dt;
    if (this.next > 0) return;
    this.next = 0.4 + Math.random() * 1.2;
    const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 60;
    const target = new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r);
    const from = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80));
    from.y = 125;
    target.y = Math.max(0, g.world.surfaceY(Math.floor(target.x), Math.floor(target.z), true));
    const vel = target.clone().sub(from).normalize().multiplyScalar(55);
    g.entities.spawnProjectile('meteor', from, vel, null);
  }
}

export class Earthquake extends Entity {
  constructor(game) {
    super(game, 'earthquake');
    this.kind = 'disaster';
    this.persistent = false;
    this.pickable = false;
    this.invulnerable = true;
    this.life = 15;
  }
  update(dt) {
    super.update(dt);
    const g = this.game;
    this.life -= dt;
    if (this.life <= 0) { this.remove(); return; }
    const strength = Math.min(1, this.age / 2, this.life / 2);
    const near = Math.max(0, 1 - g.player.position.distanceTo(this.pos) / 80);
    g.shake = Math.max(g.shake, 0.5 * strength * near);
    if (g.player.onGround && Math.random() < dt * 4 * strength) g.player.vel.y += 2.5;
    const rumble = g.audio.noiseLoop(`quake${this.id}`, { type: 'lowpass', f: 120, q: 0.5, gain: 0.8, brown: true });
    rumble?.set(strength * near);
    // Loosen the ground: surface blocks fall, cracks open.
    for (let k = 0; k < 6; k++) {
      if (Math.random() > strength) continue;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 40;
      const x = Math.floor(this.pos.x + Math.cos(a) * r), z = Math.floor(this.pos.z + Math.sin(a) * r);
      const y = g.world.surfaceY(x, z, false);
      if (y <= 2) continue;
      const id = g.world.getBlock(x, y, z);
      if (!SOLID[id] || BLOCKS[id].hardness === Infinity) continue;
      if (Math.random() < 0.5) {
        // A crack: drop a short column.
        for (let dy = 0; dy < 3 + Math.random() * 4; dy++) {
          const cid = g.world.getBlock(x, y - dy, z);
          if (cid <= 0 || BLOCKS[cid].hardness === Infinity) break;
          g.world.setBlock(x, y - dy, z, 0);
          if (dy === 0) g.particles.blockBreak(x, y, z, cid, 6);
        }
      } else if (g.world.getBlock(x, y - 1, z) !== 0) {
        g.world.setBlock(x, y, z, 0);
        g.entities.spawn('block', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, { block: id, vel: new THREE.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 4, (Math.random() - 0.5) * 3), spin: true, life: 10 });
      }
    }
    // Things on the ground jump around.
    for (const e of g.entities.list) {
      if (e.body && Math.random() < dt * 3 * strength) { e.body.wakeUp(); e.body.velocity.y += 3; }
      else if (e.kind === 'mob' && e.onGround && Math.random() < dt * 3 * strength) e.vel.y += 3;
    }
  }
  dispose() {
    super.dispose();
    this.game.audio.stopLoop(`quake${this.id}`);
  }
}
