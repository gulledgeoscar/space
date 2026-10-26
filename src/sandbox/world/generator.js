// Deterministic terrain generation: continents, mountains, rivers, biomes,
// caves, ores, trees and ground cover. Runs inside the chunk workers.
import { Simplex, hash3, hashSeed } from '../util/noise.js';
import { CHUNK, HEIGHT, SEA_LEVEL, CHUNK_VOLUME, index } from './constants.js';
import { B } from './blocks.js';
import { Villages } from './villages.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, TAIGA: 5, TUNDRA: 6, DESERT: 7,
  BADLANDS: 8, JUNGLE: 9, SWAMP: 10, MOUNTAINS: 11, PEAKS: 12, CHERRY: 13, MUSHROOM: 14, FROZEN_OCEAN: 15,
};
export const BIOME_NAMES = [
  'Ocean', 'Beach', 'Plains', 'Forest', 'Birch Forest', 'Taiga', 'Snowy Tundra', 'Desert',
  'Badlands', 'Jungle', 'Swamp', 'Mountains', 'Snowy Peaks', 'Cherry Grove', 'Mushroom Fields', 'Frozen Ocean',
];

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export class Generator {
  constructor(seed, options = {}) {
    this.seedStr = String(seed);
    this.seed = hashSeed(seed);
    this.flat = options.type === 'flat';
    this.cont = new Simplex(`${seed}:cont`);
    this.mount = new Simplex(`${seed}:mount`);
    this.detail = new Simplex(`${seed}:detail`);
    this.temp = new Simplex(`${seed}:temp`);
    this.humid = new Simplex(`${seed}:humid`);
    this.river = new Simplex(`${seed}:river`);
    this.cave1 = new Simplex(`${seed}:cave1`);
    this.cave2 = new Simplex(`${seed}:cave2`);
    this.cavern = new Simplex(`${seed}:cavern`);
    this.special = new Simplex(`${seed}:special`);
    this.villages = new Villages(this);
  }

  // Returns [height, biome] for a world column.
  column(x, z) {
    if (this.flat) return [SEA_LEVEL + 4, BIOME.PLAINS];
    const c = this.cont.fbm2(x / 900, z / 900, 4) * 1.4 + 0.22;
    const mMask = smooth(0.05, 0.55, this.mount.fbm2(x / 700 + 100, z / 700, 3));
    const ridge = 1 - Math.abs(this.mount.fbm2(x / 180, z / 180, 4));
    const d = this.detail.fbm2(x / 70, z / 70, 4);

    let h = SEA_LEVEL + 2 + c * 22 + d * 5;
    if (c < -0.15) h = SEA_LEVEL - 4 + (c + 0.15) * 40 + d * 3; // ocean floor
    h += mMask * Math.max(0, c + 0.2) * (ridge * ridge * 70 + d * 10);

    // Rivers cut the lowlands down to just below sea level.
    const rv = Math.abs(this.river.fbm2(x / 500, z / 500, 3));
    if (h < SEA_LEVEL + 30 && h > SEA_LEVEL - 6) {
      const k = 1 - smooth(0.0, 0.045, rv);
      h = lerp(h, SEA_LEVEL - 3, k);
    }

    let t = this.temp.fbm2(x / 1100, z / 1100, 3) * 1.3;
    const u = this.humid.fbm2(x / 900 + 50, z / 900, 3) * 1.3;
    t -= Math.max(0, h - SEA_LEVEL - 20) * 0.012;

    let biome;
    if (h < SEA_LEVEL - 1) biome = t < -0.5 ? BIOME.FROZEN_OCEAN : BIOME.OCEAN;
    else if (h > SEA_LEVEL + 52) biome = BIOME.PEAKS;
    else if (h > SEA_LEVEL + 34 && mMask > 0.3) biome = t < -0.2 ? BIOME.PEAKS : BIOME.MOUNTAINS;
    else if (h < SEA_LEVEL + 2 && t > -0.3) biome = BIOME.BEACH;
    else if (t < -0.52) biome = BIOME.TUNDRA;
    else if (t < -0.3) biome = BIOME.TAIGA;
    else if (t > 0.28 && u < 0) biome = u < -0.38 && h > SEA_LEVEL + 6 ? BIOME.BADLANDS : BIOME.DESERT;
    else if (u > 0.3 && t > 0.15) biome = BIOME.JUNGLE;
    else if (u > 0.42) biome = BIOME.SWAMP;
    else if (this.special.noise2(x / 260, z / 260) > 0.6) biome = t > 0 ? BIOME.CHERRY : BIOME.MUSHROOM;
    else if (u > 0.08) biome = t < -0.05 ? BIOME.BIRCH : BIOME.FOREST;
    else biome = BIOME.PLAINS;

    if (biome === BIOME.SWAMP) h = lerp(h, SEA_LEVEL + 0.3, 0.75);
    return [Math.max(4, Math.min(HEIGHT - 8, Math.round(h))), biome];
  }

  generate(cx, cz) {
    const data = new Uint8Array(CHUNK_VOLUME);
    const P = 4; // padding so trees can overhang chunk borders
    const W = CHUNK + P * 2;
    const heights = new Int16Array(W * W);
    const biomes = new Uint8Array(W * W);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let lz = 0; lz < W; lz++) for (let lx = 0; lx < W; lx++) {
      const [h, b] = this.column(x0 + lx - P, z0 + lz - P);
      heights[lz * W + lx] = h;
      biomes[lz * W + lx] = b;
    }

    if (this.flat) {
      for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
        data[index(x, 0, z)] = B.bedrock;
        for (let y = 1; y < SEA_LEVEL; y++) data[index(x, y, z)] = B.stone;
        for (let y = SEA_LEVEL; y < SEA_LEVEL + 4; y++) data[index(x, y, z)] = B.dirt;
        data[index(x, SEA_LEVEL + 4, z)] = B.grass;
      }
      return data;
    }

    const seed = this.seed;
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = x0 + x, wz = z0 + z;
      const ci = (z + P) * W + (x + P);
      const h = heights[ci];
      const biome = biomes[ci];
      const dirtDepth = 3 + ((hash3(wx, 7, wz, seed) * 2) | 0);

      let top = B.grass, filler = B.dirt;
      switch (biome) {
        case BIOME.OCEAN: top = h < SEA_LEVEL - 8 ? (hash3(wx, 1, wz, seed) < 0.3 ? B.clay : B.gravel) : B.sand; filler = B.sand; break;
        case BIOME.FROZEN_OCEAN: top = B.gravel; filler = B.gravel; break;
        case BIOME.BEACH: top = B.sand; filler = B.sand; break;
        case BIOME.DESERT: top = B.sand; filler = B.sandstone; break;
        case BIOME.BADLANDS: top = B.red_sand; filler = B.terracotta; break;
        case BIOME.TUNDRA: top = B.snow; break;
        case BIOME.PEAKS: top = h > SEA_LEVEL + 44 ? B.snow : B.stone; filler = B.stone; break;
        case BIOME.MOUNTAINS: top = h > SEA_LEVEL + 46 ? B.snow : (hash3(wx, 3, wz, seed) < 0.6 ? B.stone : B.grass); filler = B.stone; break;
        case BIOME.SWAMP: top = h <= SEA_LEVEL ? B.mud : B.grass; break;
        case BIOME.MUSHROOM: top = B.mycelium; break;
        default: break;
      }

      data[index(x, 0, z)] = B.bedrock;
      for (let y = 1; y <= h; y++) {
        let id;
        if (y <= 2 && hash3(wx, y, wz, seed) < 0.5) id = B.bedrock;
        else if (y === h) id = top;
        else if (y > h - dirtDepth) id = filler;
        else id = B.stone;
        if (biome === BIOME.BADLANDS && y > h - 12 && y < h) {
          const band = (y * 7 + ((this.detail.noise2(wx / 40, wz / 40) * 3) | 0)) % 5;
          id = band === 0 ? B.concrete_orange : band === 2 ? B.concrete_yellow : band === 3 ? B.concrete_white : B.terracotta;
        }
        if (id === B.stone) id = this.ore(wx, y, wz, biome);
        data[index(x, y, z)] = id;
      }
      // Water and ice fill.
      for (let y = h + 1; y <= SEA_LEVEL; y++) data[index(x, y, z)] = B.water;
      if ((biome === BIOME.FROZEN_OCEAN || biome === BIOME.TUNDRA || biome === BIOME.PEAKS) && h < SEA_LEVEL) data[index(x, SEA_LEVEL, z)] = B.ice;

      this.carveCaves(data, x, z, wx, wz, h);
    }

    this.decorate(data, cx, cz, heights, biomes, W, P);
    this.villages.stamp(data, cx, cz);
    return data;
  }

  ore(x, y, z, biome) {
    const s = this.seed;
    // Ores come in small clumps: hash a coarse cell, then thin it out.
    const cell = hash3(x >> 1, y >> 1, z >> 1, s + 11);
    const fine = hash3(x, y, z, s + 12);
    if (fine < 0.35) return B.stone;
    if (y < 14 && cell < 0.006) return B.diamond_ore;
    if (y < 32 && cell > 0.006 && cell < 0.014) return B.gold_ore;
    if (y < 64 && cell > 0.02 && cell < 0.045) return B.iron_ore;
    if (y < 90 && cell > 0.05 && cell < 0.1) return B.coal_ore;
    if ((biome === BIOME.MOUNTAINS || biome === BIOME.PEAKS) && cell > 0.995) return B.emerald_ore;
    if (y < 50 && cell > 0.2 && cell < 0.215) return B.gravel;
    return B.stone;
  }

  carveCaves(data, x, z, wx, wz, h) {
    const top = h < SEA_LEVEL + 1 ? h - 6 : h + 1;
    for (let y = 3; y < top; y++) {
      const fy = y * 1.6;
      const a = this.cave1.noise3(wx / 48, fy / 48, wz / 48);
      const b = this.cave2.noise3(wx / 48, fy / 48, wz / 48);
      let carve = a * a + b * b < 0.0065;
      if (!carve && y < 36) {
        const big = this.cavern.noise3(wx / 80, y / 40, wz / 80);
        carve = big > 0.62 - (36 - y) * 0.004;
      }
      if (!carve) continue;
      const i = index(x, y, z);
      if (data[i] === B.bedrock) continue;
      data[i] = y <= 10 ? B.lava : 0;
      // Exposed grass under a carved surface becomes dirt.
      if (y === h && data[i] === 0 && y > 0) {
        const below = index(x, y - 1, z);
        if (data[below] === B.dirt) data[below] = B.grass;
      }
    }
  }

  decorate(data, cx, cz, heights, biomes, W, P) {
    const s = this.seed;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const set = (x, y, z, id, replace = false) => {
      if (x < 0 || z < 0 || x >= CHUNK || z >= CHUNK || y < 0 || y >= HEIGHT) return;
      const i = index(x, y, z);
      const cur = data[i];
      if (cur === 0 || replace || cur === B.tall_grass || cur === B.rose || cur === B.dandelion) data[i] = id;
    };
    const get = (x, y, z) => (x < 0 || z < 0 || x >= CHUNK || z >= CHUNK || y < 0 || y >= HEIGHT ? -1 : data[index(x, y, z)]);

    // Trees (over the padded area so canopies cross chunk borders seamlessly).
    for (let lz = 0; lz < W; lz++) for (let lx = 0; lx < W; lx++) {
      const wx = x0 + lx - P, wz = z0 + lz - P;
      const h = heights[lz * W + lx];
      const biome = biomes[lz * W + lx];
      if (h <= SEA_LEVEL && biome !== BIOME.SWAMP) continue;
      if (h <= SEA_LEVEL - 1) continue;
      const r = hash3(wx, 1, wz, s + 101);
      if (r < 0.1 && this.villages.inVillage(wx, wz)) continue;
      const density = [0, 0.002, 0.006, 0.045, 0.04, 0.035, 0.008, 0.004, 0.001, 0.09, 0.02, 0.006, 0, 0.035, 0.006, 0][biome];
      if (r >= density) continue;
      const x = lx - P, z = lz - P;
      // The ground block must be a plant-friendly surface (checked within this chunk only).
      if (x >= 0 && z >= 0 && x < CHUNK && z < CHUNK) {
        const g = get(x, h, z);
        if (g !== B.grass && g !== B.dirt && g !== B.snow && g !== B.sand && g !== B.mycelium && g !== B.mud && g !== B.red_sand) continue;
        if (get(x, h + 1, z) !== 0) continue;
      }
      const r2 = hash3(wx, 2, wz, s + 102);
      const y0 = h + 1;
      if (biome === BIOME.DESERT || biome === BIOME.BADLANDS) {
        const tall = 1 + ((r2 * 3) | 0);
        for (let k = 0; k < tall; k++) set(x, y0 + k, z, B.cactus);
      } else if (biome === BIOME.TAIGA || biome === BIOME.TUNDRA || biome === BIOME.MOUNTAINS) {
        this.spruce(set, x, y0, z, 6 + ((r2 * 5) | 0));
      } else if (biome === BIOME.BIRCH || (biome === BIOME.FOREST && r2 < 0.3)) {
        this.blobTree(set, x, y0, z, 5 + ((r2 * 3) | 0), B.birch_log, B.birch_leaves, 2);
      } else if (biome === BIOME.JUNGLE) {
        if (r2 < 0.3) this.blobTree(set, x, y0, z, 10 + ((r2 * 20) | 0), B.jungle_log, B.jungle_leaves, 3, true);
        else this.bush(set, x, y0, z, B.jungle_log, B.jungle_leaves);
      } else if (biome === BIOME.CHERRY) {
        this.blobTree(set, x, y0, z, 4 + ((r2 * 2) | 0), B.cherry_log, B.cherry_leaves, 3);
      } else if (biome === BIOME.MUSHROOM) {
        this.giantMushroom(set, x, y0, z, 5 + ((r2 * 3) | 0), r2 < 0.5);
      } else if (biome === BIOME.SWAMP) {
        this.blobTree(set, x, y0, z, 5, B.oak_log, B.oak_leaves, 3, true);
      } else {
        this.blobTree(set, x, y0, z, 4 + ((r2 * 3) | 0), B.oak_log, B.oak_leaves, 2);
      }
    }

    // Ground cover inside this chunk.
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = x0 + x, wz = z0 + z;
      const ci = (z + P) * W + (x + P);
      const h = heights[ci];
      const biome = biomes[ci];
      const ground = get(x, h, z);
      const above = get(x, h + 1, z);
      const r = hash3(wx, 5, wz, s + 200);
      if (h < SEA_LEVEL - 1) {
        // Underwater life.
        if ((biome === BIOME.OCEAN) && h > SEA_LEVEL - 14 && r < 0.05 && get(x, h + 1, z) === B.water) {
          const t = this.temp.fbm2(wx / 1100, wz / 1100, 3);
          if (t > 0.2) set(x, h + 1, z, B.coral, true);
        }
        continue;
      }
      if (above !== 0) continue;
      if (ground === B.grass) {
        if (biome === BIOME.PLAINS && r < 0.22) set(x, h + 1, z, r < 0.02 ? B.rose : r < 0.04 ? B.dandelion : B.tall_grass);
        else if ((biome === BIOME.FOREST || biome === BIOME.BIRCH || biome === BIOME.CHERRY) && r < 0.12) set(x, h + 1, z, r < 0.01 ? B.rose : r < 0.015 ? B.red_mushroom : r < 0.02 ? B.brown_mushroom : B.tall_grass);
        else if (biome === BIOME.JUNGLE && r < 0.35) set(x, h + 1, z, r < 0.01 ? B.melon : B.tall_grass);
        else if (biome === BIOME.SWAMP && r < 0.1) set(x, h + 1, z, B.tall_grass);
        else if (r > 0.9995) set(x, h + 1, z, B.pumpkin);
        else if (r < 0.03) set(x, h + 1, z, B.tall_grass);
      } else if ((ground === B.sand || ground === B.red_sand) && (biome === BIOME.DESERT || biome === BIOME.BADLANDS) && r < 0.012) {
        set(x, h + 1, z, B.dead_bush);
      } else if (ground === B.mycelium && r < 0.06) {
        set(x, h + 1, z, r < 0.03 ? B.red_mushroom : B.brown_mushroom);
      }
      // Sugar cane on shores.
      if ((ground === B.sand || ground === B.grass) && h === SEA_LEVEL && r > 0.96) {
        const nearWater = get(x + 1, h, z) === B.water || get(x - 1, h, z) === B.water || get(x, h, z + 1) === B.water || get(x, h, z - 1) === B.water;
        if (nearWater) for (let k = 1; k <= 1 + ((r * 100) % 3 | 0); k++) set(x, h + k, z, B.sugar_cane);
      }
    }
    // Lily pads on swamp water.
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const ci = (z + P) * W + (x + P);
      if (biomes[ci] !== BIOME.SWAMP) continue;
      if (get(x, SEA_LEVEL, z) === B.water && get(x, SEA_LEVEL + 1, z) === 0 && hash3(x0 + x, 9, z0 + z, s) < 0.08) set(x, SEA_LEVEL + 1, z, B.lily_pad);
    }
  }

  blobTree(set, x, y0, z, height, log, leaf, radius, vines = false) {
    const top = y0 + height;
    for (let y = top - radius - 1; y <= top + 1; y++) {
      const r = y > top ? radius - 1 : radius;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dz * dz + (y - top) * (y - top) * 0.6;
        if (d > r * r + 1) continue;
        // Knock random corners off for an organic silhouette.
        if (Math.abs(dx) === r && Math.abs(dz) === r && hash3(x + dx, y, z + dz, this.seed + 5) < 0.6) continue;
        set(x + dx, y, z + dz, leaf);
        if (vines && (Math.abs(dx) === r || Math.abs(dz) === r) && y === top - radius - 1 && hash3(x + dx, y, z + dz, this.seed + 6) < 0.3) {
          const len = 2 + ((hash3(x + dx, y, z + dz, this.seed + 7) * 5) | 0);
          for (let k = 1; k <= len; k++) set(x + dx, y - k, z + dz, B.vines);
        }
      }
    }
    for (let y = y0; y < top; y++) set(x, y, z, log, true);
    if (height > 9) { // jungle giants get a thicker trunk
      for (let y = y0; y < top - 2; y++) { set(x + 1, y, z, log, true); set(x, y, z + 1, log, true); set(x + 1, y, z + 1, log, true); }
    }
  }

  spruce(set, x, y0, z, height) {
    const top = y0 + height;
    let r = 0;
    for (let y = top; y >= y0 + 2; y--) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
        set(x + dx, y, z + dz, B.spruce_leaves);
      }
      r = r >= 3 ? 1 : r + 1;
      if (y > top - 2) r = Math.min(r, 1);
    }
    set(x, top + 1, z, B.spruce_leaves);
    for (let y = y0; y < top; y++) set(x, y, z, B.spruce_log, true);
  }

  bush(set, x, y0, z, log, leaf) {
    set(x, y0, z, log, true);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) {
      if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
      set(x + dx, y0 + dy, z + dz, leaf);
    }
  }

  giantMushroom(set, x, y0, z, height, red) {
    const cap = red ? B.wool_red : B.wool_brown;
    const top = y0 + height;
    for (let y = y0; y < top; y++) set(x, y, z, B.wool_white, true);
    const r = red ? 2 : 3;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) === r && Math.abs(dz) === r) continue;
      set(x + dx, top, z + dz, cap);
      if (red && (Math.abs(dx) === r || Math.abs(dz) === r)) { set(x + dx, top - 1, z + dz, cap); set(x + dx, top - 2, z + dz, cap); }
    }
  }
}
