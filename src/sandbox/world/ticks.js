// Scheduled block updates: flowing water and lava, falling sand, spreading
// fire, TNT ignition, sponges and grass growth.
import { B, BLOCKS, LIQUID, LEVEL, SOLID, SHAPE, WATER_FLOW, LAVA_FLOW } from './blocks.js';
import { CHUNK, HEIGHT } from './constants.js';

const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export class BlockTicks {
  constructor(game) {
    this.game = game;
    this.queue = new Map(); // key -> due time
    this.now = 0;
    this.randomTimer = 0;
  }

  key(x, y, z) { return `${x},${y},${z}`; }

  schedule(x, y, z, delay) {
    if (y < 0 || y >= HEIGHT) return;
    const k = this.key(x, y, z);
    const due = this.now + delay;
    const cur = this.queue.get(k);
    if (cur === undefined || due < cur) this.queue.set(k, due);
  }

  delayFor(id) {
    if (LIQUID[id] === 1) return 0.25;
    if (LIQUID[id] === 2) return 1.0;
    if (id === B.fire) return 0.6 + Math.random() * 1.2;
    if (BLOCKS[id]?.gravity) return 0.05;
    return 0.05;
  }

  onBlockChange(x, y, z, id, old) {
    const w = this.game.world;
    this.considerCell(x, y, z, id);
    for (const [dx, dy, dz] of N6) {
      const nid = w.getBlock(x + dx, y + dy, z + dz);
      if (nid > 0) this.considerCell(x + dx, y + dy, z + dz, nid);
    }
    if (id === B.sponge) this.absorb(x, y, z);
  }

  considerCell(x, y, z, id) {
    if (LIQUID[id] || id === B.fire || BLOCKS[id]?.gravity || id === B.tnt) this.schedule(x, y, z, this.delayFor(id));
  }

  // Saved chunks may hold fire, flowing liquid or unsupported sand whose
  // pending updates were lost when the chunk unloaded: schedule them again.
  scanChunk(c) {
    const d = c.data;
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    for (let i = 0; i < d.length; i++) {
      const id = d[i];
      if (id !== B.fire && !(LIQUID[id] && LEVEL[id] > 0) && !BLOCKS[id]?.gravity) continue;
      const x = i % CHUNK, z = ((i / CHUNK) | 0) % CHUNK, y = (i / (CHUNK * CHUNK)) | 0;
      this.schedule(x0 + x, y, z0 + z, this.delayFor(id) + Math.random() * 0.5);
    }
  }

  update(dt) {
    if (dt <= 0) return;
    this.now += dt;
    let budget = 600;
    const due = [];
    for (const [k, t] of this.queue) {
      if (t <= this.now) due.push(k);
      if (due.length >= budget) break;
    }
    for (const k of due) {
      this.queue.delete(k);
      const [x, y, z] = k.split(',').map(Number);
      this.tick(x, y, z);
    }
    this.randomTimer += dt;
    if (this.randomTimer > 0.1) {
      this.randomTimer = 0;
      this.randomTicks();
    }
  }

  tick(x, y, z) {
    const w = this.game.world;
    const id = w.getBlock(x, y, z);
    if (id <= 0) return;
    if (LIQUID[id]) this.tickLiquid(x, y, z, id);
    else if (id === B.fire) this.tickFire(x, y, z);
    else if (BLOCKS[id].gravity) this.tickGravity(x, y, z, id);
    else if (id === B.tnt) {
      for (const [dx, dy, dz] of N6) {
        const n = w.getBlock(x + dx, y + dy, z + dz);
        if (n === B.fire || LIQUID[n] === 2) { this.igniteTnt(x, y, z); break; }
      }
    }
  }

  igniteTnt(x, y, z, fuse = 3.5) {
    const w = this.game.world;
    if (w.getBlock(x, y, z) !== B.tnt) return;
    w.setBlock(x, y, z, 0);
    this.game.entities.spawn('primed_tnt', { x: x + 0.5, y, z: z + 0.5 }, { fuse });
  }

  // Can liquid of this kind move into a cell holding nid? Handles lava/water reactions.
  flowInto(x, y, z, nid, kind) {
    const w = this.game.world;
    if (nid === 0 || nid === B.fire) return true;
    if (nid < 0) return false;
    if (SHAPE[nid] === 1 && nid !== B.fire) { // plants wash away
      this.game.particles.blockBreak(x, y, z, nid, 4);
      return true;
    }
    const other = LIQUID[nid];
    if (other && other !== kind) {
      if (kind === 1) w.setBlock(x, y, z, LEVEL[nid] === 0 ? B.obsidian : B.cobble);
      else w.setBlock(x, y, z, B.stone);
      this.game.audio.play('fizz', { pos: { x, y, z } });
      this.game.particles.smoke(x + 0.5, y + 1, z + 0.5, 0.6, 2);
      return false;
    }
    return false;
  }

  tickLiquid(x, y, z, id) {
    const w = this.game.world;
    const kind = LIQUID[id];
    const L = LEVEL[id];
    const flowBase = kind === 1 ? WATER_FLOW : LAVA_FLOW;
    const source = kind === 1 ? B.water : B.lava;
    const step = kind === 1 ? 1 : 2;
    const at = (dx, dy, dz) => w.getBlock(x + dx, y + dy, z + dz);

    // Lava touching water hardens.
    if (kind === 2) {
      for (const [dx, dy, dz] of N6) {
        if (dy === -1) continue;
        if (LIQUID[at(dx, dy, dz)] === 1) {
          w.setBlock(x, y, z, L === 0 ? B.obsidian : B.cobble);
          this.game.audio.play('fizz', { pos: { x, y, z } });
          return;
        }
      }
      // ...and sets things on fire.
      if (this.game.fireSpread && Math.random() < 0.15) {
        const fx = x + ((Math.random() * 3) | 0) - 1, fz = z + ((Math.random() * 3) | 0) - 1, fy = y + 1 + ((Math.random() * 2) | 0);
        if (w.getBlock(fx, fy, fz) === 0 && this.nearFlammable(fx, fy, fz)) w.setBlock(fx, fy, fz, B.fire);
      }
    }

    if (L > 0) {
      const above = at(0, 1, 0);
      let minLevel = 99;
      let sources = 0;
      for (const [dx, dz] of H4) {
        const n = at(dx, 0, dz);
        if (LIQUID[n] === kind) {
          minLevel = Math.min(minLevel, LEVEL[n]);
          if (LEVEL[n] === 0) sources++;
        }
      }
      let desired;
      if (LIQUID[above] === kind) desired = 1;
      else if (minLevel < L || minLevel + step <= 7) desired = minLevel + step;
      else desired = 99;
      if (kind === 1 && sources >= 2) {
        const below = at(0, -1, 0);
        if (SOLID[below] || (LIQUID[below] === 1 && LEVEL[below] === 0)) { w.setBlock(x, y, z, source); return; }
      }
      if (desired > 7 || (LIQUID[above] !== kind && minLevel >= L)) { w.setBlock(x, y, z, 0); return; }
      if (desired !== L) { w.setBlock(x, y, z, flowBase + desired); return; }
    }

    // Fall.
    const below = at(0, -1, 0);
    if (y > 0 && below !== B.bedrock) {
      if (LIQUID[below] !== kind && this.flowInto(x, y - 1, z, below, kind)) { w.setBlock(x, y - 1, z, flowBase + 1); return; }
      if (LIQUID[below] === kind) return;
    }
    // Spread sideways.
    const next = L + step;
    if (next > 7) return;
    for (const [dx, dz] of H4) {
      const n = at(dx, 0, dz);
      if (LIQUID[n] === kind) {
        if (LEVEL[n] > next) w.setBlock(x + dx, y, z + dz, flowBase + next);
      } else if (this.flowInto(x + dx, y, z + dz, n, kind)) {
        w.setBlock(x + dx, y, z + dz, flowBase + next);
      }
    }
  }

  nearFlammable(x, y, z) {
    const w = this.game.world;
    for (const [dx, dy, dz] of N6) if (BLOCKS[w.getBlock(x + dx, y + dy, z + dz)]?.flammable) return true;
    return false;
  }

  tickFire(x, y, z) {
    const g = this.game;
    const w = g.world;
    if (!g.fireSpread) { if (Math.random() < 0.5) w.setBlock(x, y, z, 0); else this.schedule(x, y, z, 1); return; }
    const below = w.getBlock(x, y - 1, z);
    // Rain puts out exposed fires.
    if (g.weather.type !== 'clear' && g.weather.localKind() === 'rain' && w.surfaceY(x, z, true) <= y && Math.random() < 0.5) { w.setBlock(x, y, z, 0); return; }
    if (!SOLID[below] && !this.nearFlammable(x, y, z)) { w.setBlock(x, y, z, 0); return; }
    let fuel = false;
    for (const [dx, dy, dz] of N6) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const n = w.getBlock(nx, ny, nz);
      if (!BLOCKS[n]?.flammable) continue;
      fuel = true;
      if (Math.random() < 0.22) {
        if (n === B.tnt) this.igniteTnt(nx, ny, nz, 1 + Math.random());
        else {
          g.particles.blockBreak(nx, ny, nz, n, 6);
          w.setBlock(nx, ny, nz, Math.random() < 0.6 ? B.fire : 0);
        }
      }
    }
    // Leap to nearby air next to fuel.
    for (let k = 0; k < 3; k++) {
      const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 4) | 0) - 1, nz = z + ((Math.random() * 3) | 0) - 1;
      if (w.getBlock(nx, ny, nz) === 0 && this.nearFlammable(nx, ny, nz) && Math.random() < 0.35) w.setBlock(nx, ny, nz, B.fire);
    }
    // Burn out.
    if (!fuel && below !== B.magma && below !== B.obsidian && Math.random() < 0.35) { w.setBlock(x, y, z, 0); return; }
    if (fuel && Math.random() < 0.06) { w.setBlock(x, y, z, 0); return; }
    this.schedule(x, y, z, this.delayFor(B.fire));
  }

  tickGravity(x, y, z, id) {
    const w = this.game.world;
    const below = w.getBlock(x, y - 1, z);
    if (below < 0 || y <= 0) return;
    if (below === 0 || LIQUID[below] || SHAPE[below] === 1) {
      w.setBlock(x, y, z, 0);
      this.game.entities.spawn('falling_block', { x: x + 0.5, y, z: z + 0.5 }, { block: id });
    }
  }

  absorb(x, y, z) {
    const w = this.game.world;
    let removed = 0;
    for (let dy = -5; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      if (dx * dx + dy * dy + dz * dz > 30) continue;
      if (LIQUID[w.getBlock(x + dx, y + dy, z + dz)] === 1) { w.setBlock(x + dx, y + dy, z + dz, 0, { silent: true }); removed++; }
    }
    if (removed) this.game.particles.splash({ x: x + 0.5, y: y + 1, z: z + 0.5 }, 30);
  }

  // A few random block ticks per frame near the player: grass spreads, dirt
  // under a roof loses its grass, sugar cane and cactus grow.
  randomTicks() {
    const g = this.game;
    const w = g.world;
    const p = g.player.box;
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 64);
      const z = Math.floor(p.z + (Math.random() - 0.5) * 64);
      const top = w.surfaceY(x, z, false);
      if (top < 0) continue;
      const y = top - ((Math.random() * 3) | 0);
      const id = w.getBlock(x, y, z);
      const above = w.getBlock(x, y + 1, z);
      if (id === B.dirt && above === 0) {
        for (const [dx, dz] of H4) if (w.getBlock(x + dx, y, z + dz) === B.grass || w.getBlock(x + dx, y + 1, z + dz) === B.grass || w.getBlock(x + dx, y - 1, z + dz) === B.grass) { w.setBlock(x, y, z, B.grass, { silent: true }); break; }
      } else if (id === B.grass && BLOCKS[above]?.opaque) {
        w.setBlock(x, y, z, B.dirt, { silent: true });
      } else if ((id === B.sugar_cane || id === B.cactus) && above === 0 && Math.random() < 0.2) {
        let h = 1;
        while (w.getBlock(x, y - h, z) === id) h++;
        if (h < 3) w.setBlock(x, y + 1, z, id);
      }
    }
  }
}

export { CHUNK };
