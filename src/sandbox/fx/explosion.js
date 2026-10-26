// Explosions: carve a ragged sphere, chain-react TNT, fling some blocks as
// physics debris, hurt and knock back everything nearby.
import * as THREE from 'three';
import { BLOCKS, B, LIQUID } from '../world/blocks.js';

export function explode(game, pos, power, opts = {}) {
  const w = game.world;
  const r = power;
  const center = new THREE.Vector3(pos.x, pos.y, pos.z);
  const inLiquid = LIQUID[w.getBlock(center.x, center.y, center.z)] > 0;
  game.stats.explosions++;

  // Blocks.
  let debris = 0;
  const maxDebris = Math.max(4, Math.min(30, 40 - r * 2));
  const breakBlocks = game.explosionsBreak && opts.breakBlocks !== false && !inLiquid;
  if (breakBlocks) {
    const R = Math.ceil(r);
    const cx = Math.floor(center.x), cy = Math.floor(center.y), cz = Math.floor(center.z);
    let particlesLeft = 60;
    for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const d = Math.sqrt((x + 0.5 - center.x) ** 2 + (y + 0.5 - center.y) ** 2 + (z + 0.5 - center.z) ** 2);
      if (d > r) continue;
      const id = w.getBlock(x, y, z);
      if (id <= 0) continue;
      const b = BLOCKS[id];
      if (!b) continue;
      const strength = power * (1 - d / r) * (0.6 + Math.random() * 0.8) * 3;
      if (strength < Math.min(b.blast, 1000) * 0.35 + (d > r * 0.8 ? Math.random() * 2 : 0)) continue;
      if (b.blast === Infinity || LIQUID[id]) continue;
      if (id === B.tnt) {
        w.setBlock(x, y, z, 0);
        game.entities.spawn('primed_tnt', { x: x + 0.5, y, z: z + 0.5 }, { fuse: 0.4 + Math.random() * 1.0, vel: new THREE.Vector3(x + 0.5 - center.x, 3, z + 0.5 - center.z).normalize().multiplyScalar(6) });
        continue;
      }
      w.setBlock(x, y, z, 0);
      if (debris < maxDebris && b.shape === 'cube' && Math.random() < 0.18) {
        debris++;
        const dir = new THREE.Vector3(x + 0.5 - center.x, y + 0.5 - center.y + 0.8, z + 0.5 - center.z).normalize();
        game.entities.spawn('block', { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, { block: id, vel: dir.multiplyScalar(6 + Math.random() * power * 2.5), spin: true, life: 12 + Math.random() * 6 });
      } else if (particlesLeft > 0 && Math.random() < 0.3) {
        particlesLeft--;
        game.particles.blockBreak(x, y, z, id, 3);
      }
    }
    if (opts.fire) {
      for (let k = 0; k < r * 6; k++) {
        const fx = Math.floor(center.x + (Math.random() - 0.5) * r * 2), fz = Math.floor(center.z + (Math.random() - 0.5) * r * 2);
        const fy = Math.floor(center.y + (Math.random() - 0.5) * r);
        if (w.getBlock(fx, fy, fz) === 0 && w.isSolid(fx, fy - 1, fz) && game.fireSpread) w.setBlock(fx, fy, fz, B.fire);
      }
    }
  }

  // Creatures, props and the player.
  game.entities.explosion(center, r * 2, power, opts.source ?? 'explosion', opts.owner);
  game.physics.blast(center, r * 2.2, 3 + power * 1.5);
  const p = game.player;
  const pd = p.eyePos.distanceTo(center);
  if (pd < r * 2.2 && !p.vehicle) {
    const f = 1 - pd / (r * 2.2);
    const dir = p.eyePos.sub(center).normalize();
    p.knock.addScaledVector(dir, f * (8 + power * 3));
    p.knock.y += f * 6;
    p.damage(Math.round(f * power * 5), 'explosion');
  }
  if (p.vehicle && pd < r * 2) p.vehicle.damage?.(power * 10 * (1 - pd / (r * 2)), 'explosion');

  // Feedback.
  game.particles.explosion(center, Math.min(r, 8));
  game.audio.play('explosion', { pos: center, size: r / 4, gain: Math.min(2, 0.8 + r / 6) });
  game.shake = Math.max(game.shake, Math.min(1.5, (r * 0.6) / Math.max(1, pd * 0.25)));
  game.weather.flash = Math.max(game.weather.flash, Math.min(0.6, r / Math.max(4, pd)));
}
