// Procedural 16x16 pixel-art textures for every block face, packed into a
// texture array (one layer per texture, so mipmaps never bleed) plus
// isometric icons for the inventory.
import * as THREE from 'three';
import { TEXTURES, BLOCKS } from './blocks.js';
import { mulberry32, hashSeed } from '../util/noise.js';

const S = 16;

const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

class Tile {
  constructor(name) {
    this.px = new Uint8ClampedArray(S * S * 4);
    this.rand = mulberry32(hashSeed(name));
  }
  set(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; this.px[i + 3] = a;
  }
  get(x, y) {
    const i = (y * S + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
  }
  shade(c, amt) { return [clamp(c[0] * amt), clamp(c[1] * amt), clamp(c[2] * amt)]; }
  // Fill with a base colour plus per-pixel brightness noise.
  noise(hex, vary = 0.12, alpha = 255) {
    const c = rgb(hex);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      this.set(x, y, this.shade(c, 1 + (this.rand() * 2 - 1) * vary), alpha);
    }
    return this;
  }
  speckle(hex, count, size = 1, vary = 0.1) {
    const c = rgb(hex);
    for (let n = 0; n < count; n++) {
      const x = (this.rand() * S) | 0, y = (this.rand() * S) | 0;
      const k = 1 + (this.rand() * 2 - 1) * vary;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
        if (size > 1 && this.rand() < 0.25) continue;
        this.set(x + dx, y + dy, this.shade(c, k));
      }
    }
    return this;
  }
  blobs(hex, count, vary = 0.1) {
    const c = rgb(hex);
    for (let n = 0; n < count; n++) {
      const cx = 1 + ((this.rand() * (S - 3)) | 0), cy = 1 + ((this.rand() * (S - 3)) | 0);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
      for (const [dx, dy] of pts) if (this.rand() < 0.85) this.set(cx + dx, cy + dy, this.shade(c, 1 + (this.rand() * 2 - 1) * vary));
    }
    return this;
  }
  rect(x0, y0, w, h, hex, alpha = 255) {
    const c = rgb(hex);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, alpha);
    return this;
  }
  border(hex, width = 1) {
    const c = rgb(hex);
    for (let i = 0; i < S; i++) for (let w = 0; w < width; w++) {
      this.set(i, w, c); this.set(i, S - 1 - w, c); this.set(w, i, c); this.set(S - 1 - w, i, c);
    }
    return this;
  }
  clear() { this.px.fill(0); return this; }
  // Multiply existing pixels by a colour.
  tint(hex) {
    const c = rgb(hex);
    for (let i = 0; i < this.px.length; i += 4) {
      this.px[i] = (this.px[i] * c[0]) / 255; this.px[i + 1] = (this.px[i + 1] * c[1]) / 255; this.px[i + 2] = (this.px[i + 2] * c[2]) / 255;
    }
    return this;
  }
}

function bricks(t, mortar, brick, rowH = 4, brickW = 8) {
  t.noise(brick, 0.1);
  const m = rgb(mortar);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rowH);
    for (let x = 0; x < S; x++) {
      const off = (row % 2) * (brickW / 2);
      if (y % rowH === rowH - 1 || (x + off) % brickW === 0) t.set(x, y, t.shade(m, 1 + (t.rand() - 0.5) * 0.1));
    }
  }
  return t;
}

function logSide(t, bark, dark) {
  t.noise(bark, 0.08);
  for (let x = 0; x < S; x++) {
    if (t.rand() < 0.35) for (let y = 0; y < S; y++) if (t.rand() < 0.8) t.set(x, y, t.shade(rgb(dark), 1 + (t.rand() - 0.5) * 0.15));
  }
  return t;
}

function logTop(t, bark, wood, ring) {
  t.noise(wood, 0.05);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) t.set(x, y, t.shade(rgb(bark), 1 + (t.rand() - 0.5) * 0.15));
    else if (Math.round(d) % 2 === 0) t.set(x, y, t.shade(rgb(ring), 1 + (t.rand() - 0.5) * 0.08));
  }
  return t;
}

function leaves(t, hex) {
  t.clear();
  const c = rgb(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = t.rand();
    if (r < 0.12) continue; // holes
    t.set(x, y, t.shade(c, 0.75 + t.rand() * 0.45));
  }
  return t;
}

function ore(t, hex) {
  t.noise(0x7d7d7d, 0.12);
  t.blobs(hex, 5, 0.15);
  return t;
}

function cross(t, draw) { t.clear(); draw(t); return t; }

function plantStem(t, hex, x0 = 7, top = 4) {
  for (let y = top; y < S; y++) t.set(x0 + (y % 5 === 0 ? 1 : 0), y, t.shade(rgb(hex), 0.85 + t.rand() * 0.3));
}

function flower(t, petal, center) {
  plantStem(t, 0x3a8a2a, 7, 7);
  t.set(6, 11, rgb(0x3a8a2a)); t.set(5, 10, rgb(0x3a8a2a)); t.set(9, 12, rgb(0x3a8a2a)); t.set(10, 11, rgb(0x3a8a2a));
  const p = rgb(petal);
  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [-2, 0], [2, 0]]) t.set(7 + dx, 5 + dy, t.shade(p, 0.85 + t.rand() * 0.3));
  t.set(7, 5, rgb(center));
}

function glassTex(t, tintHex, alpha) {
  t.clear();
  const c = rgb(tintHex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, c, alpha);
  t.border(0xffffff);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1) { t.px[i] = clamp(c[0] * 0.5 + 127); t.px[i + 1] = clamp(c[1] * 0.5 + 127); t.px[i + 2] = clamp(c[2] * 0.5 + 127); t.px[i + 3] = 230; }
  }
  // glint
  for (let k = 0; k < 4; k++) { t.set(3 + k, 2 + k, [255, 255, 255], 200); t.set(4 + k, 2 + k, [255, 255, 255], 140); }
  t.set(10, 11, [255, 255, 255], 160); t.set(11, 12, [255, 255, 255], 160);
  return t;
}

const PAINTERS = {
  stone: (t) => t.noise(0x7d7d7d, 0.1).blobs(0x6a6a6a, 6, 0.08),
  dirt: (t) => t.noise(0x86603d, 0.14).speckle(0x6a4a2a, 18).speckle(0xa07850, 6),
  grass_top: (t) => t.noise(0x5d9b3a, 0.16).speckle(0x4a8a2a, 30).speckle(0x76b04a, 14),
  grass_side: (t) => {
    t.noise(0x86603d, 0.14).speckle(0x6a4a2a, 14);
    const g = rgb(0x5d9b3a);
    for (let x = 0; x < S; x++) {
      const depth = 3 + ((t.rand() * 3) | 0);
      for (let y = 0; y < depth; y++) t.set(x, y, t.shade(g, 0.85 + t.rand() * 0.3));
    }
    return t;
  },
  sand: (t) => t.noise(0xdbcf8e, 0.07).speckle(0xc8b878, 20).speckle(0xeee0a8, 10),
  red_sand: (t) => t.noise(0xb8622a, 0.07).speckle(0xa05020, 20).speckle(0xd07a40, 10),
  gravel: (t) => t.noise(0x84807c, 0.1).blobs(0x5e5a58, 8, 0.1).blobs(0xa8a4a0, 6, 0.1),
  water: (t) => {
    t.noise(0x2f5fd0, 0.06, 180);
    for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) if (t.rand() < 0.5) t.set(x, (y + ((x / 3) | 0)) % S, [90, 140, 240], 190);
    return t;
  },
  lava: (t) => {
    t.noise(0xd04a08, 0.08);
    t.blobs(0xffa020, 7, 0.1).blobs(0xffd040, 3, 0.1).speckle(0x902000, 10);
    return t;
  },
  oak_log: (t) => logSide(t, 0x6b5132, 0x4e3a22),
  oak_log_top: (t) => logTop(t, 0x6b5132, 0xb08a54, 0x9a7444),
  birch_log: (t) => {
    t.noise(0xd8d4c8, 0.05);
    for (let n = 0; n < 7; n++) { const x = (t.rand() * 13) | 0, y = (t.rand() * S) | 0; t.rect(x, y, 2 + ((t.rand() * 3) | 0), 1, 0x3a3a3a); }
    return t;
  },
  birch_log_top: (t) => logTop(t, 0xd8d4c8, 0xd0b884, 0xb89c68),
  spruce_log: (t) => logSide(t, 0x4a3420, 0x2e2012),
  spruce_log_top: (t) => logTop(t, 0x4a3420, 0x8a6a40, 0x6a5030),
  cherry_log: (t) => logSide(t, 0x5a3040, 0x3a1a28),
  cherry_log_top: (t) => logTop(t, 0x5a3040, 0xe0a8a8, 0xc08888),
  jungle_log: (t) => logSide(t, 0x5a4a2a, 0x3e3018),
  jungle_log_top: (t) => logTop(t, 0x5a4a2a, 0xb08850, 0x987040),
  oak_leaves: (t) => leaves(t, 0x3f8a2a),
  birch_leaves: (t) => leaves(t, 0x6a9a40),
  spruce_leaves: (t) => leaves(t, 0x2f5a35),
  cherry_leaves: (t) => leaves(t, 0xf0a0c8),
  jungle_leaves: (t) => leaves(t, 0x2a8a20),
  planks: (t) => {
    t.noise(0xb08a54, 0.06);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (y % 4 === 3) t.set(x, y, rgb(0x7a5a30));
      else if (((x + (((y / 4) | 0) % 2) * 8) % 16) === 0 && y % 4 !== 3) t.set(x, y, rgb(0x8a6a3a));
      else if (t.rand() < 0.08) t.set(x, y, rgb(0x9a7444));
    }
    return t;
  },
  cobble: (t) => {
    t.noise(0x6a6a6a, 0.08);
    for (let n = 0; n < 9; n++) {
      const cx = (t.rand() * S) | 0, cy = (t.rand() * S) | 0, r = 2 + t.rand() * 2.5;
      const k = 0.95 + t.rand() * 0.35;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < r) t.set(x, y, t.shade(rgb(0x8a8a8a), k - d * 0.04));
      }
    }
    return t;
  },
  glass: (t) => glassTex(t, 0xc8e6f0, 40),
  glass_red: (t) => glassTex(t, 0xc03030, 140),
  glass_blue: (t) => glassTex(t, 0x3050c0, 140),
  glass_green: (t) => glassTex(t, 0x30a040, 140),
  glass_yellow: (t) => glassTex(t, 0xe0c030, 140),
  brick: (t) => bricks(t, 0xc8c0b0, 0x9a4d3a),
  stone_bricks: (t) => bricks(t, 0x5a5a5a, 0x7e7e7e, 8, 16),
  snow: (t) => t.noise(0xf3f8fb, 0.03).speckle(0xdde8f0, 12),
  ice: (t) => { t.noise(0x9cc4f5, 0.05, 200); for (let k = 0; k < 6; k++) t.set(4 + k, 9 - k, [220, 240, 255], 220); return t; },
  packed_ice: (t) => t.noise(0x8ab4ee, 0.06).speckle(0xb0d0ff, 14),
  cactus_side: (t) => {
    t.noise(0x3b8a2e, 0.08);
    for (let y = 0; y < S; y++) { t.set(0, y, rgb(0x2a6a20)); t.set(15, y, rgb(0x2a6a20)); if (y % 4 === 1) { t.set(4, y, [230, 230, 200]); t.set(11, y + 2 > 15 ? y : y + 2, [230, 230, 200]); } }
    return t;
  },
  cactus_top: (t) => { t.noise(0x4a9a3a, 0.08).border(0x2a6a20); t.rect(6, 6, 4, 4, 0x6ab04a); return t; },
  sandstone: (t) => { t.noise(0xd8c88a, 0.05); t.rect(0, 0, 16, 3, 0xe0d298); t.rect(0, 12, 16, 4, 0xc8b878); return t; },
  sandstone_top: (t) => t.noise(0xe0d298, 0.05),
  coal_ore: (t) => ore(t, 0x222222),
  iron_ore: (t) => ore(t, 0xd8b08e),
  gold_ore: (t) => ore(t, 0xf8e050),
  diamond_ore: (t) => ore(t, 0x5fe0dc),
  emerald_ore: (t) => ore(t, 0x30d060),
  bedrock: (t) => t.noise(0x555555, 0.2).blobs(0x222222, 10, 0.2).blobs(0x888888, 4, 0.1),
  tnt_side: (t) => {
    t.noise(0xd03a2a, 0.06);
    t.rect(0, 5, 16, 6, 0xeeeeee);
    for (let x = 2; x < 14; x += 3) t.rect(x, 7, 2, 2, 0x222222);
    for (let x = 0; x < S; x += 4) for (let y = 0; y < S; y++) if (y < 5 || y > 10) t.set(x, y, rgb(0xa02a1a));
    return t;
  },
  tnt_top: (t) => { t.noise(0xd03a2a, 0.06); t.rect(6, 6, 4, 4, 0x333333); t.set(7, 7, [200, 200, 200]); return t; },
  tnt_bottom: (t) => t.noise(0xd03a2a, 0.06),
  glowstone: (t) => t.noise(0xc89a4a, 0.1).blobs(0xffe8a0, 8, 0.1).speckle(0xfff4d0, 10),
  torch: (t) => {
    t.clear();
    for (let y = 6; y < S; y++) { t.set(7, y, rgb(0x6b4a2a)); t.set(8, y, rgb(0x8a6a3a)); }
    t.set(7, 4, [255, 230, 120]); t.set(8, 4, [255, 230, 120]); t.set(7, 5, [255, 160, 40]); t.set(8, 5, [255, 200, 60]);
    t.set(7, 3, [255, 250, 200]); t.set(8, 3, [255, 210, 80]);
    return t;
  },
  tall_grass: (t) => cross(t, () => {
    const g = rgb(0x5d9b3a);
    for (let b = 0; b < 7; b++) {
      let x = 1 + b * 2 + ((t.rand() * 2) | 0);
      const h = 6 + ((t.rand() * 9) | 0);
      for (let y = S - 1; y > S - 1 - h; y--) { t.set(x, y, t.shade(g, 0.7 + t.rand() * 0.5)); if (t.rand() < 0.15) x += t.rand() < 0.5 ? -1 : 1; }
    }
  }),
  rose: (t) => cross(t, () => flower(t, 0xd02a2a, 0x8a1a1a)),
  dandelion: (t) => cross(t, () => flower(t, 0xf0d020, 0xd0a010)),
  dead_bush: (t) => cross(t, () => {
    const c = rgb(0x8a6a3a);
    for (let y = 8; y < S; y++) t.set(7, y, c);
    for (let k = 0; k < 5; k++) { t.set(7 - k, 8 - k, c); t.set(8 + k, 9 - k, c); t.set(6 - k, 11 - (k >> 1), c); t.set(9 + k, 12 - (k >> 1), c); }
  }),
  sugar_cane: (t) => cross(t, () => {
    for (const x0 of [3, 7, 11]) for (let y = 0; y < S; y++) t.set(x0, y, y % 5 === 0 ? rgb(0x6a9a40) : t.shade(rgb(0x8ac060), 0.9 + t.rand() * 0.2));
  }),
  red_mushroom: (t) => cross(t, () => {
    t.rect(7, 9, 2, 7, 0xe8e0d0); t.rect(4, 5, 8, 4, 0xc03030); t.rect(5, 4, 6, 1, 0xc03030); t.set(6, 6, [255, 255, 255]); t.set(9, 5, [255, 255, 255]);
  }),
  brown_mushroom: (t) => cross(t, () => { t.rect(7, 10, 2, 6, 0xe8e0d0); t.rect(4, 7, 8, 3, 0x9a7050); t.rect(5, 6, 6, 1, 0xa88060); }),
  coral: (t) => cross(t, () => {
    const c = rgb(0xf06090);
    for (let b = 0; b < 5; b++) { let x = 3 + b * 2; for (let y = S - 1; y > 3 + ((t.rand() * 5) | 0); y--) { t.set(x, y, t.shade(c, 0.8 + t.rand() * 0.3)); if (t.rand() < 0.3) x += t.rand() < 0.5 ? -1 : 1; } }
  }),
  vines: (t) => cross(t, () => {
    const c = rgb(0x2a7a20);
    for (let x = 0; x < S; x++) if (t.rand() < 0.6) { const h = (t.rand() * S) | 0; for (let y = 0; y < h; y++) if (t.rand() < 0.85) t.set(x, y, t.shade(c, 0.8 + t.rand() * 0.4)); }
  }),
  lily_pad: (t) => cross(t, () => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x - 7.5, y - 7.5) < 7 && !(x > 7 && Math.abs(y - 7.5) < 1)) t.set(x, y, t.shade(rgb(0x2a7a2a), 0.8 + t.rand() * 0.3)); }),
  fire: (t) => cross(t, () => {
    for (let x = 0; x < S; x++) {
      const h = 6 + ((t.rand() * 10) | 0);
      for (let y = S - 1; y > S - 1 - h; y--) {
        const f = (S - 1 - y) / h;
        t.set(x, y, f < 0.4 ? [255, 240, 140] : f < 0.75 ? [255, 160, 30] : [220, 70, 10], 255);
      }
    }
  }),
  obsidian: (t) => t.noise(0x1a1028, 0.15).speckle(0x3a2a58, 10).speckle(0x0a0614, 10),
  bookshelf: (t) => {
    t.noise(0xb08a54, 0.06);
    const colors = [0xa03030, 0x3050a0, 0x30a050, 0xd0a030, 0x7a3aa0, 0x4a4a4a];
    for (const y0 of [1, 9]) {
      t.rect(0, y0 - 1, 16, 1, 0x7a5a30);
      for (let x = 1; x < 15; x++) {
        const c = colors[(t.rand() * colors.length) | 0];
        const h = 5 + ((t.rand() * 2) | 0);
        t.rect(x, y0 + 6 - h, 1, h, c);
      }
    }
    return t;
  },
  quartz: (t) => t.noise(0xece6de, 0.03),
  quartz_top: (t) => t.noise(0xece6de, 0.03).border(0xd8d0c4),
  iron_block: (t) => { t.noise(0xd8d8d8, 0.03).border(0xa8a8a8); t.rect(1, 1, 14, 1, 0xf0f0f0); return t; },
  gold_block: (t) => { t.noise(0xf4d03a, 0.04).border(0xc8a020); t.rect(1, 1, 14, 1, 0xfff080); return t; },
  diamond_block: (t) => { t.noise(0x6af0e8, 0.04).border(0x30b0a8); t.rect(1, 1, 14, 1, 0xc8fff8); return t; },
  emerald_block: (t) => { t.noise(0x40e080, 0.04).border(0x20a050); t.rect(1, 1, 14, 1, 0xa0ffc0); return t; },
  mossy_cobble: (t) => { PAINTERS.cobble(t); t.blobs(0x4a7a3a, 8, 0.15); return t; },
  clay: (t) => t.noise(0x9aa0ae, 0.05),
  mud: (t) => t.noise(0x3c3430, 0.1).speckle(0x2a2420, 20),
  terracotta: (t) => t.noise(0x9a5a40, 0.05),
  pumpkin_side: (t) => { t.noise(0xe0801a, 0.06); for (let x = 1; x < S; x += 4) for (let y = 0; y < S; y++) t.set(x, y, rgb(0xb86010)); return t; },
  pumpkin_top: (t) => { t.noise(0xe0801a, 0.06); t.rect(6, 6, 4, 4, 0x6a8a2a); return t; },
  pumpkin_face: (t) => { PAINTERS.pumpkin_side(t); t.rect(3, 4, 3, 3, 0x2a1a0a); t.rect(10, 4, 3, 3, 0x2a1a0a); t.rect(3, 10, 10, 2, 0x2a1a0a); t.rect(5, 12, 2, 1, 0x2a1a0a); t.rect(9, 12, 2, 1, 0x2a1a0a); return t; },
  jack_face: (t) => { PAINTERS.pumpkin_side(t); t.rect(3, 4, 3, 3, 0xffe060); t.rect(10, 4, 3, 3, 0xffe060); t.rect(3, 10, 10, 2, 0xffd040); t.rect(5, 12, 2, 1, 0xffd040); t.rect(9, 12, 2, 1, 0xffd040); return t; },
  melon_side: (t) => { t.noise(0x6aa02a, 0.06); for (let x = 0; x < S; x += 3) for (let y = 0; y < S; y++) t.set(x, y, rgb(0x3a7a1a)); return t; },
  melon_top: (t) => { t.noise(0x6aa02a, 0.06); t.rect(7, 7, 2, 2, 0x4a6a2a); return t; },
  crafting_top: (t) => { PAINTERS.planks(t); t.border(0x6a4a2a); t.rect(7, 1, 1, 14, 0x6a4a2a); t.rect(1, 7, 14, 1, 0x6a4a2a); return t; },
  crafting_side: (t) => { PAINTERS.planks(t); t.rect(3, 3, 2, 6, 0x999999); t.rect(2, 3, 4, 2, 0xaaaaaa); t.rect(10, 4, 1, 7, 0x6a4a2a); t.rect(9, 3, 3, 2, 0x888888); return t; },
  furnace_side: (t) => t.noise(0x6a6a6a, 0.08).border(0x555555),
  furnace_top: (t) => t.noise(0x7a7a7a, 0.06),
  furnace_front: (t) => { PAINTERS.furnace_side(t); t.rect(4, 8, 8, 5, 0x1a1a1a); t.rect(5, 11, 6, 2, 0xf08020); t.rect(4, 3, 8, 2, 0x444444); return t; },
  lamp: (t) => { t.noise(0xffc070, 0.1).border(0x6a3a1a); t.blobs(0xfff0c0, 4); return t; },
  hay_side: (t) => { t.noise(0xc8a830, 0.1); for (let x = 0; x < S; x++) if (t.rand() < 0.4) for (let y = 0; y < S; y++) t.set(x, y, t.shade(rgb(0xa88a20), 0.9 + t.rand() * 0.2)); t.rect(0, 3, 16, 1, 0x7a4a1a); t.rect(0, 12, 16, 1, 0x7a4a1a); return t; },
  hay_top: (t) => t.noise(0xc8a830, 0.15).speckle(0x8a7020, 20),
  sponge: (t) => { t.noise(0xd0c040, 0.08); for (let n = 0; n < 14; n++) t.set((t.rand() * S) | 0, (t.rand() * S) | 0, rgb(0x8a7a20)); return t; },
  slime: (t) => { t.noise(0x7ad060, 0.06, 200); t.rect(3, 3, 10, 10, 0x8ae070, 220); t.border(0x5ab040); return t; },
  ladder: (t) => {
    t.clear();
    t.rect(0, 0, 2, 16, 0x9a7040); t.rect(14, 0, 2, 16, 0x9a7040); t.rect(0, 0, 16, 2, 0x9a7040); t.rect(0, 14, 16, 2, 0x9a7040);
    for (let k = 0; k < 16; k++) { t.set(k, k, rgb(0x8a6030)); t.set(15 - k, k, rgb(0x8a6030)); }
    return t;
  },
  basalt: (t) => { t.noise(0x4a4a50, 0.08); for (let x = 0; x < S; x += 3) for (let y = 0; y < S; y++) if (t.rand() < 0.7) t.set(x, y, rgb(0x3a3a40)); return t; },
  basalt_top: (t) => t.noise(0x4a4a50, 0.1).border(0x3a3a40),
  magma: (t) => { t.noise(0x6a2008, 0.1); for (let n = 0; n < 8; n++) { const x = (t.rand() * S) | 0, y = (t.rand() * S) | 0; t.rect(x, y, 3, 1, 0xf07020); t.rect(x + 1, y + 1, 1, 2, 0xffa040); } return t; },
  mycelium_top: (t) => t.noise(0x6a5a6a, 0.12).speckle(0x8a7a90, 18).speckle(0x9a8a9a, 6),
  mycelium_side: (t) => { PAINTERS.dirt(t); for (let x = 0; x < S; x++) { const d = 2 + ((t.rand() * 2) | 0); for (let y = 0; y < d; y++) t.set(x, y, t.shade(rgb(0x6a5a6a), 0.9 + t.rand() * 0.2)); } return t; },
  bounce_top: (t) => { t.noise(0x30e0ff, 0.05).border(0x1890b0); for (let k = 0; k < 4; k++) { t.rect(6 - k, 4 + k * 2, 4 + k * 2, 1, 0xffffff); } return t; },
  speed_top: (t) => { t.noise(0xffe030, 0.05).border(0xb09010); for (const y0 of [3, 9]) for (let k = 0; k < 4; k++) { t.set(5 + k, y0 + k, [40, 40, 40]); t.set(5 + k, y0 + 6 - k > 15 ? 15 : y0 + 6 - k, [40, 40, 40]); t.set(9 + k, y0 + k, [40, 40, 40]); } return t; },
  door_bottom: (t) => { PAINTERS.planks(t); t.border(0x6a4a24); t.rect(2, 2, 12, 5, 0x8a6030); t.rect(2, 9, 12, 5, 0x8a6030); t.rect(11, 1, 2, 2, 0x3a3a3a); return t; },
  door_top: (t) => { PAINTERS.planks(t); t.border(0x6a4a24); t.rect(3, 3, 10, 9, 0x000000, 0); t.rect(3, 7, 10, 1, 0x6a4a24); t.rect(7, 3, 1, 9, 0x6a4a24); return t; },
  bed_top: (t) => { t.noise(0xc03030, 0.06); t.rect(0, 0, 16, 5, 0xf0f0f0); t.rect(1, 1, 14, 3, 0xffffff); for (let x = 0; x < 16; x += 4) t.rect(x, 6, 1, 10, 0xa02020); return t; },
  bed_side: (t) => { t.noise(0xc03030, 0.06); t.rect(0, 8, 16, 8, 0x8a6030); t.rect(0, 14, 2, 2, 0x5a3a18); t.rect(14, 14, 2, 2, 0x5a3a18); return t; },
  chest_top: (t) => { t.noise(0xa07030, 0.06).border(0x5a3a18); return t; },
  chest_side: (t) => { t.noise(0xa07030, 0.06).border(0x5a3a18); t.rect(0, 5, 16, 1, 0x5a3a18); return t; },
  chest_front: (t) => { PAINTERS.chest_side(t); t.rect(7, 4, 2, 4, 0xd0d0d0); t.rect(7, 6, 2, 1, 0x404040); return t; },
  note_block: (t) => { t.noise(0x7a4a2a, 0.08).border(0x4a2a12); t.rect(6, 3, 2, 8, 0x1a1a1a); t.rect(8, 3, 3, 2, 0x1a1a1a); t.rect(4, 9, 4, 3, 0x1a1a1a); return t; },
  checker: (t) => { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) t.set(x, y, ((x >> 2) + (y >> 2)) % 2 ? [30, 30, 30] : [235, 235, 235]); return t; },
  prismarine: (t) => t.noise(0x5aa898, 0.12).blobs(0x3a8878, 6).speckle(0x8ad0c0, 8),
  sea_lantern: (t) => { t.noise(0xd0f0e8, 0.06).border(0x8ab8b0); t.rect(4, 4, 8, 8, 0xf0fff8); t.rect(6, 6, 4, 4, 0xffffff); return t; },
};

// Wool, concrete and neon are plain colours.
for (const b of BLOCKS) {
  if (!b) continue;
  if (b.key.startsWith('wool_')) PAINTERS[b.key] = (t) => { t.noise(b.color, 0.08); for (let y = 1; y < S; y += 3) for (let x = 0; x < S; x++) if ((x + y) % 4 === 0) t.set(x, y, t.shade(rgb(b.color), 0.85)); return t; };
  if (b.key.startsWith('concrete_')) PAINTERS[b.key] = (t) => t.noise(b.color, 0.025);
  if (b.key.startsWith('neon_')) PAINTERS[b.key] = (t) => { t.noise(b.color, 0.05); t.border(0xffffff); t.rect(2, 2, 12, 12, b.color); t.rect(5, 5, 6, 6, 0xffffff, 255); return t; };
}

function paint(name) {
  const t = new Tile(name);
  const painter = PAINTERS[name];
  if (painter) painter(t);
  else {
    const owner = BLOCKS.find((b) => b && b.faceTex && b.key === name);
    t.noise(owner?.color ?? 0xff00ff, 0.1);
  }
  return t.px;
}

export function buildAtlas() {
  const layers = TEXTURES.length;
  const data = new Uint8Array(S * S * 4 * layers);
  const tiles = [];
  for (let l = 0; l < layers; l++) {
    const px = paint(TEXTURES[l]);
    tiles.push(px);
    // DataArrayTexture rows go bottom-up in UV space; flip so v=1 is the tile top.
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      data.set(px.subarray(src, src + S * 4), l * S * S * 4 + y * S * 4);
    }
  }
  const texture = new THREE.DataArrayTexture(data, S, S, layers);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, tiles };
}

// Flat canvas of one texture, scaled up, for UI and item models.
export function tileCanvas(tiles, layer, scale = 4) {
  const c = document.createElement('canvas');
  c.width = c.height = S * scale;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = S;
  tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(tiles[layer]), S, S), 0, 0);
  g.drawImage(tmp, 0, 0, S * scale, S * scale);
  return c;
}

// Isometric block icon as a data URL.
export function blockIcon(tiles, block, size = 48) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const img = (layer) => {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = S;
    tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(tiles[layer]), S, S), 0, 0);
    return tmp;
  };
  if (block.shape === 'cross' || block.shape === 'torch') {
    g.drawImage(img(block.faceTex[0]), size * 0.1, size * 0.1, size * 0.8, size * 0.8);
    return c.toDataURL();
  }
  const s = size * 0.46;
  const h = block.shape === 'slab' ? 0.5 : 1;
  const top = img(block.faceTex[2]);
  const left = img(block.faceTex[4]);
  const right = img(block.faceTex[0]);
  const cx = size / 2;
  const topY = size * 0.04 + (1 - h) * s;
  // top face
  g.save();
  g.setTransform(s / S, (s / S) * 0.5, -s / S, (s / S) * 0.5, cx, topY);
  g.drawImage(top, 0, 0);
  g.restore();
  // left face
  g.save();
  g.setTransform(s / S, (s / S) * 0.5, 0, (s / S) * h, cx - s, topY + s * 0.5);
  g.drawImage(left, 0, 0, S, S, 0, 0, S, S);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, S, S);
  g.restore();
  // right face
  g.save();
  g.setTransform(s / S, -(s / S) * 0.5, 0, (s / S) * h, cx, topY + s);
  g.drawImage(right, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, S, S);
  g.restore();
  return c.toDataURL();
}
