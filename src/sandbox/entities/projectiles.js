// Projectiles: rockets, tank shells, grenades, snowballs, arrows,
// fireworks and the grappling hook.
import * as THREE from 'three';
import { Entity } from './base.js';
import { LIQUID, SOLID, B, BLOCKS } from '../world/blocks.js';

const SPECS = {
  rocket: { gravity: 0, radius: 0.15, life: 6, explode: 3.2 },
  shell: { gravity: 6, radius: 0.15, life: 6, explode: 3.0 },
  grenade: { gravity: 22, radius: 0.15, life: 3, explode: 3.0, bounce: 0.45, fuse: true },
  snowball: { gravity: 18, radius: 0.12, life: 5, damage: 1, knock: 4 },
  arrow: { gravity: 14, radius: 0.08, life: 30, damage: 4, sticks: true },
  firework: { gravity: -6, radius: 0.1, life: 1.6, firework: true },
  hook: { gravity: 6, radius: 0.1, life: 1.2, hook: true },
  fireball: { gravity: 0, radius: 0.3, life: 5, explode: 1.6, fire: true },
};

const geoms = {};
function meshFor(type) {
  const g = new THREE.Group();
  switch (type) {
    case 'rocket': case 'shell': {
      const body = new THREE.Mesh(geoms.rocket ??= new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: type === 'shell' ? 0x8a8a5a : 0x5a7a4a }));
      const tip = new THREE.Mesh(geoms.tip ??= new THREE.ConeGeometry(0.08, 0.2, 8).rotateX(Math.PI / 2).translate(0, 0, 0.4), new THREE.MeshLambertMaterial({ color: 0xc03020 }));
      g.add(body, tip);
      break;
    }
    case 'grenade': g.add(new THREE.Mesh(geoms.gren ??= new THREE.SphereGeometry(0.15, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3a5a2a }))); break;
    case 'snowball': g.add(new THREE.Mesh(geoms.snow ??= new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0xffffff }))); break;
    case 'arrow': {
      g.add(new THREE.Mesh(geoms.arrow ??= new THREE.BoxGeometry(0.04, 0.04, 0.7), new THREE.MeshLambertMaterial({ color: 0x8a6a3a })));
      const tip = new THREE.Mesh(geoms.atip ??= new THREE.BoxGeometry(0.07, 0.07, 0.1).translate(0, 0, 0.37), new THREE.MeshLambertMaterial({ color: 0x888888 }));
      g.add(tip);
      break;
    }
    case 'firework': g.add(new THREE.Mesh(geoms.fw ??= new THREE.CylinderGeometry(0.06, 0.06, 0.4, 6), new THREE.MeshLambertMaterial({ color: 0xd03030 }))); break;
    case 'hook': g.add(new THREE.Mesh(geoms.hook ??= new THREE.BoxGeometry(0.15, 0.15, 0.3), new THREE.MeshLambertMaterial({ color: 0x999999 }))); break;
    case 'fireball': g.add(new THREE.Mesh(geoms.fb ??= new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff8020 }))); break;
    default: break;
  }
  return g;
}

export class Projectile extends Entity {
  constructor(game, type, opts = {}) {
    super(game, type);
    this.kind = 'projectile';
    this.spec = SPECS[type];
    this.owner = opts.owner ?? null;
    this.vel.copy(opts.vel ?? new THREE.Vector3());
    this.life = this.spec.life;
    this.mesh.add(meshFor(type));
    this.persistent = false;
    this.pickable = false;
    this.stuck = false;
    this.color = opts.color ?? new THREE.Color().setHSL(Math.random(), 1, 0.6);
    if (type === 'hook') {
      this.rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x8a6a3a }));
      this.rope.frustumCulled = false;
      game.scene.add(this.rope);
    }
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    const s = this.spec;
    this.life -= dt;
    if (this.type === 'hook' && this.rope) {
      const a = g.player.eyePos.add(new THREE.Vector3(0, -0.3, 0));
      this.rope.geometry.setFromPoints([a, this.pos.clone()]);
      if (!g.holding('grapple') && !g.player.grapple) { this.remove(); return; }
      if (this.stuck) {
        if (!g.player.grapple) this.remove();
        return;
      }
    }
    if (this.stuck) {
      if (this.life <= 0) this.remove();
      return;
    }
    if (this.life <= 0) { this.expire(); return; }
    this.vel.y -= s.gravity * dt;
    if (LIQUID[g.world.getBlock(this.pos.x, this.pos.y, this.pos.z)] === 1) this.vel.multiplyScalar(1 - Math.min(1, dt * 3));
    const step = this.vel.clone().multiplyScalar(dt);
    const len = step.length();
    if (len > 0) {
      const dir = step.clone().multiplyScalar(1 / len);
      const blockHit = g.world.raycast(this.pos, dir, len + s.radius, (id) => SOLID[id] || (BLOCKS[id]?.render === 'cutout' && id !== B.torch) || id === B.tnt);
      const entHit = g.entities.raycast(this.pos, dir, len + s.radius, (e) => e !== this && e !== this.owner && e.pickable && !(this.owner === g.player && g.player.vehicle === e));
      const playerHit = this.owner !== g.player ? hitPlayer(g, this.pos, dir, len + s.radius) : null;
      let first = null;
      if (blockHit) first = { kind: 'block', dist: blockHit.dist, hit: blockHit };
      if (entHit && (!first || entHit.dist < first.dist)) first = { kind: 'entity', dist: entHit.dist, hit: entHit };
      if (playerHit !== null && (!first || playerHit < first.dist)) first = { kind: 'player', dist: playerHit };
      if (first) {
        this.pos.addScaledVector(dir, Math.max(0, first.dist - 0.02));
        this.onHit(first, dir);
        this.syncMesh();
        return;
      }
      this.pos.add(step);
    }
    if (this.type === 'rocket' || this.type === 'shell' || this.type === 'firework') g.particles.trail(this.pos);
    if (this.type === 'fireball') g.particles.fire(this.pos.x, this.pos.y, this.pos.z, 1.2);
    if (this.type === 'grenade' && Math.random() < 0.3) g.particles.smoke(this.pos.x, this.pos.y, this.pos.z, 0.08, 0.6);
    this.syncMesh();
  }

  syncMesh() {
    this.mesh.position.copy(this.pos);
    if (this.vel.lengthSq() > 0.01 && !this.stuck) {
      const d = this.vel.clone().normalize();
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      if (this.type === 'firework') this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    }
  }

  onHit(first, dir) {
    const g = this.game;
    const s = this.spec;
    if (s.hook) {
      if (first.kind === 'block') {
        this.stuck = true;
        g.player.grapple = this.pos.clone();
        g.audio.play('grapple', { pos: this.pos });
      } else if (first.kind === 'entity') {
        // Yank the creature toward you.
        const e = first.hit.entity;
        e.impulse?.(g.player.eyePos.sub(e.center ?? e.pos).normalize().multiplyScalar(14).add(new THREE.Vector3(0, 4, 0)));
        this.remove();
      } else this.remove();
      return;
    }
    if (s.bounce && first.kind === 'block') {
      const h = first.hit;
      const n = new THREE.Vector3(h.nx, h.ny, h.nz);
      this.vel.reflect(n).multiplyScalar(s.bounce);
      if (this.vel.length() < 1) this.vel.set(0, 0, 0);
      g.audio.play('land', { pos: this.pos, material: 'metal', gain: 0.3 });
      return;
    }
    if (s.explode) {
      if (s.fuse && first.kind === 'block') return;
      this.remove();
      g.explode(this.pos.clone().addScaledVector(dir, -0.3), s.explode, { fire: !!s.fire, owner: this.owner });
      return;
    }
    if (first.kind === 'entity') {
      const e = first.hit.entity;
      e.damage(s.damage ?? 1, 'projectile', this.owner ?? this);
      if (s.knock) e.impulse?.(dir.clone().multiplyScalar(s.knock).add(new THREE.Vector3(0, 2, 0)));
    } else if (first.kind === 'player') {
      g.player.damage(s.damage ?? 1, 'mob', this.pos);
      if (s.knock) g.player.knock.addScaledVector(dir, s.knock);
    } else if (first.kind === 'block') {
      const id = first.hit.id;
      if (this.type === 'snowball' && LIQUID[g.world.getBlock(first.hit.x, first.hit.y + 1, first.hit.z)] !== 2 && id === B.fire) g.world.setBlock(first.hit.x, first.hit.y, first.hit.z, 0);
      if (this.type === 'arrow' && id === B.tnt) g.ticks.igniteTnt(first.hit.x, first.hit.y, first.hit.z);
    }
    if (this.type === 'snowball') { g.particles.poof(this.pos, 0xffffff, 6); this.remove(); return; }
    if (s.sticks && first.kind === 'block') { this.stuck = true; this.life = 10; return; }
    this.remove();
  }

  expire() {
    const g = this.game;
    if (this.spec.firework) {
      const c = this.color;
      for (let i = 0; i < 120; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(9 + Math.random() * 3);
        g.particles.additive.emit(this.pos.x, this.pos.y, this.pos.z, v.x, v.y, v.z, 1.4 + Math.random() * 0.6, 0.12, c.r, c.g, c.b, 1, -0.02, 4);
      }
      for (let i = 0; i < 40; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(5);
        g.particles.additive.emit(this.pos.x, this.pos.y, this.pos.z, v.x, v.y, v.z, 1.2, 0.1, 1, 1, 1, 1, -0.02, 4);
      }
      g.audio.play('explosion', { pos: this.pos, size: 0.1, gain: 0.5 });
      g.weather.flash = Math.max(g.weather.flash, 0.15);
    } else if (this.spec.explode) {
      g.explode(this.pos, this.spec.explode, { owner: this.owner });
    }
    this.remove();
  }

  dispose() {
    super.dispose();
    if (this.rope) { this.game.scene.remove(this.rope); this.rope.geometry.dispose(); }
  }
}

// Ray vs player box; returns hit distance or null.
function hitPlayer(g, origin, dir, maxDist) {
  const p = g.player;
  if (p.dead) return null;
  const b = new THREE.Box3(new THREE.Vector3(p.box.x - 0.3, p.box.y, p.box.z - 0.3), new THREE.Vector3(p.box.x + 0.3, p.box.y + p.box.h, p.box.z + 0.3));
  const ray = new THREE.Ray(origin, dir);
  const hit = ray.intersectBox(b, new THREE.Vector3());
  if (!hit) return null;
  const d = hit.distanceTo(origin);
  return d <= maxDist ? d : null;
}
