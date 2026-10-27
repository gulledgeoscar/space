// Instant structures placed with the spawner: houses, castles, towers,
// skyscrapers, pyramids, a volcano and more. Built in the player's facing.
import { B } from './blocks.js';

// Returns a placer that maps local (right, up, forward) to world coords.
function placer(world, ox, oy, oz, yaw, replaceSolid = true) {
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  // Forward is away from the player.
  const fx = [0, -1, 0, 1][q], fz = [-1, 0, 1, 0][q];
  const rx = -fz, rz = fx;
  let count = 0;
  const set = (r, u, f, id) => {
    const x = ox + r * rx + f * fx, z = oz + r * rz + f * fz;
    if (!replaceSolid && id === 0) return;
    if (world.setBlock(x, oy + u, z, id, { silent: id !== B.lava && id !== B.water })) count++;
  };
  set.count = () => count;
  return set;
}

const fill = (set, r0, u0, f0, r1, u1, f1, id) => {
  for (let u = u0; u <= u1; u++) for (let f = f0; f <= f1; f++) for (let r = r0; r <= r1; r++) set(r, u, f, id);
};
const hollow = (set, r0, u0, f0, r1, u1, f1, id) => {
  for (let u = u0; u <= u1; u++) for (let f = f0; f <= f1; f++) for (let r = r0; r <= r1; r++) {
    if (r === r0 || r === r1 || f === f0 || f === f1) set(r, u, f, id);
  }
};

const BUILDERS = {
  house(set) {
    fill(set, -3, 0, 1, 3, 0, 7, B.cobble);
    fill(set, -3, 1, 1, 3, 5, 7, 0);
    hollow(set, -3, 1, 1, 3, 3, 7, B.planks);
    for (const [r, f] of [[-3, 1], [3, 1], [-3, 7], [3, 7]]) fill(set, r, 1, f, r, 3, f, B.oak_log);
    // windows and door
    for (const f of [3, 5]) { set(-3, 2, f, B.glass); set(3, 2, f, B.glass); }
    set(-1, 2, 7, B.glass); set(1, 2, 7, B.glass);
    set(0, 1, 1, 0); set(0, 2, 1, 0);
    // roof
    for (let k = 0; k < 4; k++) fill(set, -4 + k, 4 + k, 0, 4 - k, 4 + k, 8, B.brick);
    fill(set, -2, 4, 2, 2, 6, 6, 0);
    fill(set, -2, 4, 2, 2, 4, 6, 0);
    // furniture
    set(2, 1, 6, B.crafting_table); set(-2, 1, 6, B.bookshelf); set(-2, 2, 6, B.bookshelf);
    set(2, 1, 2, B.wool_red); set(2, 1, 3, B.wool_red);
    set(0, 3, 6, B.torch); set(-2, 3, 2, B.torch);
    set(-1, 1, 0, B.torch); set(1, 1, 0, B.torch);
  },
  tower(set) {
    const H = 22;
    for (let u = 0; u < H; u++) for (let f = 1; f <= 7; f++) for (let r = -3; r <= 3; r++) {
      const edge = r === -3 || r === 3 || f === 1 || f === 7;
      const corner = (r === -3 || r === 3) && (f === 1 || f === 7);
      if (corner) continue;
      set(r, u, f, edge ? (u % 6 === 3 && (r === 0 || f === 4) ? B.glass : B.stone_bricks) : (u % 6 === 0 ? B.planks : 0));
    }
    for (let u = 1; u < H; u++) set(0, u, 4, B.ladder);
    for (let u = 0; u < H; u += 6) set(0, u, 4, B.ladder);
    set(0, 1, 1, 0); set(0, 2, 1, 0);
    fill(set, -4, H, 0, 4, H, 8, B.stone_bricks);
    for (let r = -4; r <= 4; r++) for (let f = 0; f <= 8; f++) if ((r === -4 || r === 4 || f === 0 || f === 8) && (r + f) % 2 === 0) set(r, H + 1, f, B.stone_bricks);
    set(0, H, 4, B.ladder);
    for (const [r, f] of [[-3, 1], [3, 1], [-3, 7], [3, 7]]) set(r, H + 1, f, B.torch);
  },
  castle(set) {
    const R = 11;
    // Curtain wall.
    for (let u = 0; u < 9; u++) for (let f = 0; f <= 2 * R; f++) for (let r = -R; r <= R; r++) {
      const edge = r === -R || r === R || f === 0 || f === 2 * R;
      if (u === 0) set(r, u, f, edge ? B.stone_bricks : (Math.random() < 0.3 ? B.mossy_cobble : B.cobble));
      else if (edge) set(r, u, f, u === 8 ? ((r + f) % 2 === 0 ? B.stone_bricks : 0) : (Math.random() < 0.15 ? B.mossy_cobble : B.stone_bricks));
      else if (u < 8) set(r, u, f, 0);
    }
    // Gate.
    fill(set, -1, 1, 0, 1, 4, 0, 0);
    // Corner towers.
    for (const [cr, cf] of [[-R, 0], [R, 0], [-R, 2 * R], [R, 2 * R]]) {
      for (let u = 0; u < 14; u++) for (let df = -3; df <= 3; df++) for (let dr = -3; dr <= 3; dr++) {
        const d = dr * dr + df * df;
        if (d > 10) continue;
        const shell = d > 4;
        if (u === 13) { if (shell && (dr + df) % 2 === 0) set(cr + dr, u, cf + df, B.stone_bricks); continue; }
        set(cr + dr, u, cf + df, shell ? B.stone_bricks : u === 12 || u === 0 ? B.planks : 0);
      }
      set(cr, 13, cf, B.torch);
    }
    // Keep.
    for (let u = 0; u < 16; u++) for (let f = 7; f <= 15; f++) for (let r = -4; r <= 4; r++) {
      const edge = r === -4 || r === 4 || f === 7 || f === 15;
      if (u === 15) { if (edge && (r + f) % 2 === 0) set(r, u, f, B.stone_bricks); continue; }
      set(r, u, f, edge ? (u % 5 === 3 && (r === 0 || f === 11) ? B.glass : B.stone_bricks) : u % 5 === 0 ? B.planks : 0);
    }
    fill(set, -1, 1, 7, 1, 3, 7, 0);
    for (let u = 1; u < 15; u++) set(3, u, 14, B.ladder);
    for (let u = 0; u < 15; u += 5) set(3, u, 14, B.ladder);
    set(0, 15, 11, B.gold_block); set(0, 16, 11, B.wool_red); set(0, 17, 11, B.wool_red);
    for (const r of [-3, 3]) { set(r, 1, 1, B.torch); }
    set(-2, 4, 6, B.torch); set(2, 4, 6, B.torch);
  },
  pyramid(set) {
    const N = 15;
    for (let u = 0; u <= N; u++) for (let f = u; f <= 2 * N - u; f++) for (let r = -N + u; r <= N - u; r++) {
      const outer = r === -N + u || r === N - u || f === u || f === 2 * N - u;
      set(r, u, f, outer ? (u % 3 === 0 ? B.sandstone : B.sand) : B.sandstone);
    }
    // Hidden chamber with treasure... and a trap.
    fill(set, -3, 1, N - 3, 3, 4, N + 3, 0);
    fill(set, -1, 1, 1, 1, 3, N - 4, 0);
    set(0, 1, N, B.gold_block); set(-1, 1, N, B.diamond_block); set(1, 1, N, B.emerald_block);
    fill(set, -2, 0, N - 2, 2, 0, N + 2, B.tnt);
    set(-3, 3, N - 3, B.torch); set(3, 3, N + 3, B.torch);
    set(0, N + 1, N, B.gold_block);
  },
  skyscraper(set) {
    const H = 64;
    for (let u = 0; u < H; u++) for (let f = 1; f <= 11; f++) for (let r = -5; r <= 5; r++) {
      const edge = r === -5 || r === 5 || f === 1 || f === 11;
      const frame = (r === -5 || r === 5) && (f === 1 || f === 11) || u % 4 === 0;
      if (edge) set(r, u, f, frame ? B.iron_block : (u % 4 === 2 && (r === 0 || f === 6) ? B.glass_blue : B.glass));
      else if (u % 4 === 0) set(r, u, f, (r === 0 && f === 6) ? B.ladder : B.quartz);
      else set(r, u, f, r === 0 && f === 6 ? B.ladder : 0);
      if (!edge && u % 4 === 3 && (r === -3 || r === 3) && (f === 3 || f === 9)) set(r, u, f, B.sea_lantern);
    }
    fill(set, -1, 1, 1, 1, 3, 1, 0);
    fill(set, -6, H, 0, 6, H, 12, B.iron_block);
    set(0, H, 6, B.ladder);
    for (let u = H + 1; u < H + 8; u++) set(0, u, 6, B.iron_block);
    set(0, H + 8, 6, B.neon_red);
  },
  big_tree(set) {
    const H = 22;
    for (let u = -1; u < H; u++) fill(set, -1, u, 3, 1, u, 5, B.oak_log);
    for (const [dr, df] of [[-2, 4], [2, 4], [0, 2], [0, 6]]) { set(dr, 0, df, B.oak_log); set(dr, -1, df, B.oak_log); }
    const R = 9;
    for (let u = -R; u <= R; u++) for (let f = -R; f <= R; f++) for (let r = -R; r <= R; r++) {
      const d = r * r + f * f + u * u * 1.6;
      if (d > R * R || Math.random() < 0.08) continue;
      set(r, H + u, f + 4, d < 4 ? B.oak_log : B.oak_leaves);
    }
    for (const [br, bf] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 2; k < 7; k++) set(br * k, H - 4 + Math.floor(k / 2), 4 + bf * k, B.oak_log);
  },
  dome(set) {
    const R = 10;
    for (let u = 0; u <= R; u++) for (let f = -R; f <= R; f++) for (let r = -R; r <= R; r++) {
      const d = Math.sqrt(r * r + f * f + u * u);
      if (u === 0 && r * r + f * f <= R * R) { set(r, 0, f + R + 1, B.grass); continue; }
      if (d <= R && d > R - 1) set(r, u, f + R + 1, B.glass);
      else if (d <= R - 1) set(r, u, f + R + 1, 0);
    }
    set(0, 1, 1, 0); set(0, 2, 1, 0);
    for (let k = 0; k < 12; k++) set(Math.round(Math.cos(k) * 6), 1, R + 1 + Math.round(Math.sin(k) * 6), [B.rose, B.dandelion, B.tall_grass][k % 3]);
    set(0, 1, R + 1, B.sea_lantern);
  },
  ramp(set) {
    for (let f = 1; f <= 14; f++) {
      const h = Math.floor(f / 2.2);
      for (let r = -2; r <= 2; r++) {
        for (let u = 0; u < h; u++) set(r, u, f, r === -2 || r === 2 ? B.concrete_black : B.concrete_yellow);
        set(r, h, f, f % 2 ? B.stone_slab : (r === -2 || r === 2 ? B.concrete_black : B.concrete_yellow));
      }
    }
  },
  arena(set) {
    const R = 14;
    for (let f = -R - 1; f <= R + 1; f++) for (let r = -R - 1; r <= R + 1; r++) {
      const d = Math.sqrt(r * r + f * f);
      if (d > R + 1.5) continue;
      set(r, 0, f + R + 2, d > R - 0.5 ? B.brick : B.sand);
      for (let u = 1; u <= 4; u++) set(r, u, f + R + 2, d > R - 0.5 && d <= R + 1.5 ? (u === 4 && (r + f) % 2 ? 0 : B.brick) : 0);
      if (d > R - 0.5 && d < R + 0.5 && (r + f) % 6 === 0) set(r, 5, f + R + 2, B.torch);
    }
    fill(set, -1, 1, 1, 1, 3, 2, 0);
  },
  pool(set) {
    fill(set, -6, -4, 1, 6, 0, 13, B.quartz);
    fill(set, -5, -3, 2, 5, 0, 12, B.water);
    for (let r = -5; r <= 5; r += 5) set(r, -4, 7, B.sea_lantern);
    fill(set, -1, 1, 0, 1, 1, 3, B.planks);
    fill(set, 0, 1, 1, 0, 1, 5, B.plank_slab);
  },
  volcano(set) {
    const R = 16, H = 20;
    for (let u = 0; u < H; u++) {
      const rad = R * (1 - u / H) + 2;
      for (let f = -R - 2; f <= R + 2; f++) for (let r = -R - 2; r <= R + 2; r++) {
        const d = Math.sqrt(r * r + f * f);
        if (d > rad) continue;
        const crater = d < 3 && u > H - 6;
        set(r, u, f + R + 3, crater ? (u === H - 1 ? B.lava : B.magma) : d > rad - 1.5 ? (Math.random() < 0.3 ? B.basalt : B.stone) : (Math.random() < 0.1 ? B.magma : B.stone));
      }
    }
    fill(set, -2, H - 1, R + 1, 2, H - 1, R + 5, B.lava);
    set(0, H - 2, R + 3, B.lava);
  },
};

export function buildStructure(game, key, x, y, z, yaw) {
  const b = BUILDERS[key];
  if (!b) return 0;
  const set = placer(game.world, x, y, z, yaw);
  b(set);
  return set.count();
}

export const STRUCTURE_KEYS = Object.keys(BUILDERS);
