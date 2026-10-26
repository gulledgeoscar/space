// Rigid-body physics (cannon-es) for props, ragdolls, thrown blocks and
// cars. The voxel world is represented by static box "proxies" created on
// demand around each awake body.
import * as CANNON from 'cannon-es';
import { SOLID, BLOCKS } from '../world/blocks.js';

const PROXY_TTL = 1.0;

export class Physics {
  constructor(game) {
    this.game = game;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -game.gravity, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.solver.iterations = 8;
    this.world.defaultContactMaterial.friction = 0.5;
    this.world.defaultContactMaterial.restitution = 0.15;
    this.groundMat = new CANNON.Material('ground');
    this.slipMat = new CANNON.Material('slippery');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.groundMat, this.slipMat, { friction: 0.0, restitution: 0.1 }));
    this.proxies = new Map();  // "x,y,z" -> { body, seen }
    this.proxyShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
    this.slabShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 0.5));
    this.bodies = new Set();
    this.time = 0;
    this.accum = 0;
  }

  add(body) {
    this.world.addBody(body);
    this.bodies.add(body);
  }

  remove(body) {
    if (!body) return;
    this.world.removeBody(body);
    this.bodies.delete(body);
  }

  // Ensure static proxies exist for exposed solid blocks around a region.
  touchRegion(x0, y0, z0, x1, y1, z1) {
    const w = this.game.world;
    for (let y = Math.floor(y0); y <= Math.floor(y1); y++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
      const id = w.getBlock(x, y, z);
      if (id <= 0 || !SOLID[id]) continue;
      const k = `${x},${y},${z}`;
      let p = this.proxies.get(k);
      if (p) { p.seen = this.time; continue; }
      // Skip blocks fully surrounded by solids: nothing can touch them.
      if (SOLID[w.getBlock(x + 1, y, z)] && SOLID[w.getBlock(x - 1, y, z)] && SOLID[w.getBlock(x, y + 1, z)] &&
          SOLID[w.getBlock(x, y - 1, z)] && SOLID[w.getBlock(x, y, z + 1)] && SOLID[w.getBlock(x, y, z - 1)]) continue;
      const slab = BLOCKS[id].shape === 'slab';
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: this.groundMat });
      body.addShape(slab ? this.slabShape : this.proxyShape);
      body.position.set(x + 0.5, y + (slab ? 0.25 : 0.5), z + 0.5);
      body.isProxy = true;
      this.world.addBody(body);
      this.proxies.set(k, { body, seen: this.time });
    }
  }

  onBlockChange(x, y, z) {
    const k = `${x},${y},${z}`;
    const p = this.proxies.get(k);
    if (p) { this.world.removeBody(p.body); this.proxies.delete(k); }
    // Wake bodies near the change so they fall into new holes.
    for (const b of this.bodies) {
      if (b.sleepState === CANNON.Body.SLEEPING) {
        const dx = b.position.x - x, dy = b.position.y - y, dz = b.position.z - z;
        if (dx * dx + dy * dy + dz * dz < 9) b.wakeUp();
      }
    }
  }

  update(dt) {
    if (dt <= 0) return;
    this.world.gravity.set(0, -this.game.gravity, 0);
    this.time += dt;
    // Proxies around every non-sleeping body.
    for (const b of this.bodies) {
      if (b.sleepState === CANNON.Body.SLEEPING || b.mass === 0 && b.type !== CANNON.Body.KINEMATIC) continue;
      const r = (b.boundingRadius || 1) + 1;
      const p = b.position, v = b.velocity;
      const ex = Math.min(6, Math.abs(v.x) * dt * 2), ey = Math.min(6, Math.abs(v.y) * dt * 2), ez = Math.min(6, Math.abs(v.z) * dt * 2);
      // Unloaded chunks: freeze the body rather than let it fall forever.
      if (!this.game.world.isLoaded(p.x, p.z)) { b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0); b.sleep(); continue; }
      this.touchRegion(p.x - r - ex, p.y - r - ey, p.z - r - ez, p.x + r + ex, p.y + r + ey, p.z + r + ez);
      if (p.y < -60) b.entity?.kill?.('void');
    }
    // Drop stale proxies.
    for (const [k, p] of this.proxies) {
      if (this.time - p.seen > PROXY_TTL) { this.world.removeBody(p.body); this.proxies.delete(k); }
    }
    this.world.step(1 / 60, dt, 4);
  }

  // Apply an outward impulse to bodies in a radius.
  blast(center, radius, strength) {
    for (const b of this.bodies) {
      if (b.mass === 0) continue;
      const dx = b.position.x - center.x, dy = b.position.y - center.y, dz = b.position.z - center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) continue;
      const f = (1 - d / radius) * strength * b.mass / Math.max(0.5, d);
      b.wakeUp();
      b.applyImpulse(new CANNON.Vec3(dx * f, (dy + 1.5) * f, dz * f));
      b.angularVelocity.x += (Math.random() - 0.5) * 10 * (1 - d / radius);
      b.angularVelocity.z += (Math.random() - 0.5) * 10 * (1 - d / radius);
    }
  }
}

export { CANNON };
