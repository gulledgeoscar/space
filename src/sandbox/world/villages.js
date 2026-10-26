// Villages: planned per 320-block cell, then stamped into whichever chunks
// they overlap. Deterministic, so every chunk agrees on the layout.
import { hash3, mulberry32 } from '../util/noise.js';
import { CHUNK, HEIGHT, SEA_LEVEL, index } from './constants.js';
import { B, SOLID } from './blocks.js';
import { BIOME } from './generator.js';

const CELL = 320;

const PALETTES = {
  default: { floor: B.cobble, wall: B.planks, post: B.oak_log, roof: B.spruce_log, path: B.gravel, accent: B.stone_bricks },
  desert: { floor: B.sandstone, wall: B.sandstone, post: B.sandstone, roof: B.terracotta, path: B.gravel, accent: B.terracotta },
  taiga: { floor: B.cobble, wall: B.spruce_log, post: B.spruce_log, roof: B.planks, path: B.gravel, accent: B.mossy_cobble },
};

// Building footprints (half sizes) by type.
const SIZES = { house: [3, 3], big: [4, 5], farm: [4, 5], tower: [3, 3], lamp: [0, 0], well: [2, 2] };

export class Villages {
  constructor(gen) {
    this.gen = gen;
    this.cache = new Map();
    this.okBiomes = new Set([BIOME.PLAINS, BIOME.DESERT, BIOME.TAIGA, BIOME.CHERRY, BIOME.BIRCH, BIOME.FOREST]);
  }

  plan(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let plan = null;
    const g = this.gen;
    if (!g.flat && !g.moon && hash3(cx, 77, cz, g.seed) < 0.45) {
      const rand = mulberry32(Math.floor(hash3(cx, 78, cz, g.seed) * 4294967296));
      const x = cx * CELL + 60 + Math.floor(rand() * (CELL - 120));
      const z = cz * CELL + 60 + Math.floor(rand() * (CELL - 120));
      const [h, biome] = g.column(x, z);
      if (this.okBiomes.has(biome) && h > SEA_LEVEL + 1 && h < SEA_LEVEL + 22) {
        const style = biome === BIOME.DESERT ? 'desert' : biome === BIOME.TAIGA ? 'taiga' : 'default';
        const buildings = [{ type: 'well', x, z, rot: 0 }];
        const n = 6 + Math.floor(rand() * 6);
        let tries = 0;
        while (buildings.length < n + 1 && tries++ < 80) {
          const a = rand() * Math.PI * 2, r = 12 + rand() * 30;
          const bx = Math.round(x + Math.cos(a) * r), bz = Math.round(z + Math.sin(a) * r);
          const pick = rand();
          const type = pick < 0.5 ? 'house' : pick < 0.68 ? 'big' : pick < 0.85 ? 'farm' : pick < 0.93 ? 'tower' : 'lamp';
          const [sx, sz] = SIZES[type];
          // Keep buildings apart and on dry, fairly level ground.
          const clash = buildings.some((o) => {
            const [ox, oz] = SIZES[o.type];
            return Math.abs(o.x - bx) < sx + ox + 3 && Math.abs(o.z - bz) < sz + oz + 3;
          });
          if (clash) continue;
          const [bh] = g.column(bx, bz);
          if (bh <= SEA_LEVEL || Math.abs(bh - h) > 6) continue;
          // Doors face the well.
          const dx = x - bx, dz = z - bz;
          const rot = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 0 : 2);
          buildings.push({ type, x: bx, z: bz, rot });
        }
        for (const b of buildings) b.y = g.column(b.x, b.z)[0];
        plan = { x, z, y: h, style, buildings, radius: 46 };
      }
    }
    this.cache.set(key, plan);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    return plan;
  }

  // Plans whose area overlaps the given rectangle.
  near(x0, z0, x1, z1) {
    const out = [];
    for (let cz = Math.floor((z0 - 60) / CELL); cz <= Math.floor((z1 + 60) / CELL); cz++) {
      for (let cx = Math.floor((x0 - 60) / CELL); cx <= Math.floor((x1 + 60) / CELL); cx++) {
        const p = this.plan(cx, cz);
        if (p && p.x + p.radius >= x0 && p.x - p.radius <= x1 && p.z + p.radius >= z0 && p.z - p.radius <= z1) out.push(p);
      }
    }
    return out;
  }

  inVillage(x, z) {
    for (const p of this.near(x, z, x, z)) if (Math.abs(p.x - x) < p.radius && Math.abs(p.z - z) < p.radius) return true;
    return false;
  }

  // Village centres that fall inside a chunk (for spawning villagers).
  centersIn(cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    return this.near(x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1).filter((p) => p.x >= x0 && p.x < x0 + CHUNK && p.z >= z0 && p.z < z0 + CHUNK);
  }

  stamp(data, cx, cz) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const plans = this.near(x0, z0, x0 + CHUNK - 1, z0 + CHUNK - 1);
    if (!plans.length) return;
    const set = (x, y, z, id) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
      data[index(lx, y, lz)] = id;
    };
    const get = (x, y, z) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 0 || y >= HEIGHT) return -1;
      return data[index(lx, y, lz)];
    };
    for (const p of plans) {
      const pal = PALETTES[p.style];
      // Paths from each door to the well.
      for (const b of p.buildings) {
        if (b.type === 'well') continue;
        const steps = Math.max(Math.abs(b.x - p.x), Math.abs(b.z - p.z));
        for (let s = 0; s <= steps; s++) {
          const px = Math.round(b.x + ((p.x - b.x) * s) / steps), pz = Math.round(b.z + ((p.z - b.z) * s) / steps);
          for (const [ox, oz] of [[0, 0], [1, 0], [0, 1]]) {
            const x = px + ox, z = pz + oz;
            if (x < x0 - 1 || z < z0 - 1 || x > x0 + CHUNK || z > z0 + CHUNK) continue;
            const [h] = this.gen.column(x, z);
            if (h <= SEA_LEVEL) { set(x, SEA_LEVEL, z, pal.floor); continue; }
            const top = get(x, h, z);
            if (top > 0 && SOLID[top]) set(x, h, z, pal.path);
            for (let y = h + 1; y < h + 3; y++) if (get(x, y, z) > 0 && !SOLID[get(x, y, z)]) set(x, y, z, 0);
          }
        }
      }
      for (const b of p.buildings) {
        const [sx, sz] = SIZES[b.type];
        if (b.x + sx + 2 < x0 || b.x - sx - 2 >= x0 + CHUNK || b.z + sz + 2 < z0 || b.z - sz - 2 >= z0 + CHUNK) continue;
        this.building(b, pal, set, get);
      }
    }
  }

  building(b, pal, set, get) {
    const [sx, sz] = SIZES[b.type];
    // Local coords rotated so the door (local -z side) faces the well.
    const rot = b.rot;
    const W = (lx, ly, lz, id) => {
      let x = lx, z = lz;
      if (rot === 1) { x = -lz; z = lx; } else if (rot === 2) { x = -lx; z = -lz; } else if (rot === 3) { x = lz; z = -lx; }
      set(b.x + x, b.y + ly, b.z + z, id);
    };
    const ex = rot % 2 ? sz : sx, ez = rot % 2 ? sx : sz;
    // Foundation and clearing.
    for (let dz = -ez - 1; dz <= ez + 1; dz++) for (let dx = -ex - 1; dx <= ex + 1; dx++) {
      for (let y = b.y; y > b.y - 6; y--) {
        const cur = get(b.x + dx, y, b.z + dz);
        if (cur > 0 && SOLID[cur]) break;
        if (Math.abs(dx) <= ex && Math.abs(dz) <= ez) set(b.x + dx, y, b.z + dz, b.type === 'farm' ? B.dirt : pal.floor);
      }
      if (Math.abs(dx) <= ex && Math.abs(dz) <= ez) for (let y = b.y + 1; y < b.y + 14; y++) set(b.x + dx, y, b.z + dz, 0);
    }
    switch (b.type) {
      case 'house': case 'big': {
        const h = 4;
        for (let lz = -sz; lz <= sz; lz++) for (let lx = -sx; lx <= sx; lx++) {
          W(lx, 0, lz, pal.floor);
          const edge = Math.abs(lx) === sx || Math.abs(lz) === sz;
          const corner = Math.abs(lx) === sx && Math.abs(lz) === sz;
          for (let y = 1; y < h; y++) {
            if (!edge) continue;
            const window = y === 2 && !corner && (lx === 0 || lz === 0 || Math.abs(lz) === sz - 2);
            W(lx, y, lz, corner ? pal.post : window ? B.glass : pal.wall);
          }
        }
        // Door on the -z side.
        W(0, 1, -sz, 0); W(0, 2, -sz, 0);
        W(-1, 2, -sz - 1, B.torch); W(1, 2, -sz - 1, B.torch);
        // Pyramid roof.
        for (let k = 0; k <= Math.min(sx, sz) + 1; k++) {
          for (let lz = -sz - 1 + k; lz <= sz + 1 - k; lz++) for (let lx = -sx - 1 + k; lx <= sx + 1 - k; lx++) {
            const ring = lx === -sx - 1 + k || lx === sx + 1 - k || lz === -sz - 1 + k || lz === sz + 1 - k;
            if (ring || k === Math.min(sx, sz) + 1) W(lx, h + k, lz, pal.roof);
          }
        }
        W(sx - 1, 1, sz - 1, B.crafting_table);
        W(-sx + 1, 1, sz - 1, B.wool_red);
        W(-sx + 1, 1, sz - 2, B.wool_red);
        W(0, h - 1, 0, B.torch);
        if (b.type === 'big') { W(sx - 1, 1, 0, B.bookshelf); W(sx - 1, 2, 0, B.bookshelf); W(-sx + 1, 1, 0, B.furnace); }
        break;
      }
      case 'farm':
        for (let lz = -sz; lz <= sz; lz++) for (let lx = -sx; lx <= sx; lx++) {
          const edge = Math.abs(lx) === sx || Math.abs(lz) === sz;
          if (edge) { W(lx, 0, lz, pal.post); continue; }
          if (lx === 0) { W(lx, 0, lz, B.water); continue; }
          W(lx, 0, lz, B.mud);
          const crop = (Math.abs(lx) + lz + 10) % 3;
          W(lx, 1, lz, crop === 0 ? B.tall_grass : crop === 1 ? B.dandelion : B.tall_grass);
        }
        W(sx, 1, sz, B.pumpkin); W(-sx, 1, sz, B.melon); W(sx, 1, -sz, B.hay); W(-sx, 1, -sz, B.hay);
        break;
      case 'tower':
        for (let y = 0; y < 12; y++) for (let lz = -sz; lz <= sz; lz++) for (let lx = -sx; lx <= sx; lx++) {
          const edge = Math.abs(lx) === sx || Math.abs(lz) === sz;
          if (y === 0 || y === 7) W(lx, y, lz, pal.accent);
          else if (edge) W(lx, y, lz, y % 3 === 2 && (lx === 0 || lz === 0) ? B.glass : pal.accent);
        }
        for (let y = 1; y < 12; y++) W(sx - 1, y, sz - 1, B.ladder);
        W(0, 1, -sz, 0); W(0, 2, -sz, 0);
        for (let lz = -sz; lz <= sz; lz++) for (let lx = -sx; lx <= sx; lx++) if ((Math.abs(lx) === sx || Math.abs(lz) === sz) && (lx + lz) % 2 === 0) W(lx, 12, lz, pal.accent);
        W(0, 8, 0, B.gold_block); W(0, 9, 0, B.lamp);
        break;
      case 'well':
        for (let lz = -2; lz <= 2; lz++) for (let lx = -2; lx <= 2; lx++) {
          const edge = Math.abs(lx) === 2 || Math.abs(lz) === 2;
          W(lx, 0, lz, pal.accent);
          if (edge) W(lx, 1, lz, pal.accent);
          else { W(lx, 0, lz, B.water); W(lx, -1, lz, B.water); W(lx, -2, lz, B.water); }
        }
        for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { W(lx, 2, lz, pal.post); W(lx, 3, lz, pal.post); }
        for (let lz = -2; lz <= 2; lz++) for (let lx = -2; lx <= 2; lx++) W(lx, 4, lz, pal.roof);
        W(0, 5, 0, B.lamp);
        break;
      case 'lamp':
        W(0, 1, 0, pal.post); W(0, 2, 0, pal.post); W(0, 3, 0, pal.post); W(0, 4, 0, B.glowstone);
        break;
      default: break;
    }
  }
}
