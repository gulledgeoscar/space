// Axis-separated AABB movement against the voxel grid. Shared by the
// player, creatures, dropped items and falling blocks.
//
// A box is { x, y, z, hw, h }: centre x/z, feet y, half width, height.
import { BLOCKS, SOLID } from '../world/blocks.js';

const EPS = 1e-4;

// Collision interval [y0, y1] inside a block, or null when passable.
function blockSpan(id) {
  if (id < 0) return [0, 1]; // unloaded: solid
  if (!SOLID[id]) return null;
  if (BLOCKS[id].shape === 'slab') return [0, 0.5];
  return [0, 1];
}

// Moves the box along one axis, clipping against solid blocks and any
// extra AABBs ({min:{x,y,z}, max:{x,y,z}}). Returns the distance moved.
export function moveAxis(world, box, axis, d, extra) {
  if (d === 0) return 0;
  const x0 = box.x - box.hw, x1 = box.x + box.hw;
  const z0 = box.z - box.hw, z1 = box.z + box.hw;
  const y0 = box.y, y1 = box.y + box.h;
  let moved = d;

  if (axis === 1) {
    const bx0 = Math.floor(x0 + EPS), bx1 = Math.floor(x1 - EPS);
    const bz0 = Math.floor(z0 + EPS), bz1 = Math.floor(z1 - EPS);
    if (d < 0) {
      const from = Math.floor(y0 + EPS), to = Math.floor(y0 + d);
      for (let by = from; by >= to; by--) for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
        const s = blockSpan(world.getBlock(bx, by, bz));
        if (!s) continue;
        const top = by + s[1];
        if (top <= y0 + EPS && top > y0 + moved) moved = top - y0;
      }
    } else {
      const from = Math.floor(y1 - EPS), to = Math.floor(y1 + d);
      for (let by = from; by <= to; by++) for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
        const s = blockSpan(world.getBlock(bx, by, bz));
        if (!s) continue;
        const bot = by + s[0];
        if (bot >= y1 - EPS && bot < y1 + moved) moved = bot - y1;
      }
    }
    if (extra) for (const e of extra) {
      if (e.max.x <= x0 || e.min.x >= x1 || e.max.z <= z0 || e.min.z >= z1) continue;
      if (d < 0 && e.max.y <= y0 + EPS && e.max.y > y0 + moved) moved = e.max.y - y0;
      if (d > 0 && e.min.y >= y1 - EPS && e.min.y < y1 + moved) moved = e.min.y - y1;
    }
    box.y += moved;
    return moved;
  }

  // Horizontal axes.
  const lo = axis === 0 ? x0 : z0, hi = axis === 0 ? x1 : z1;
  const by0 = Math.floor(y0 + EPS), by1 = Math.floor(y1 - EPS);
  const o0 = Math.floor((axis === 0 ? z0 : x0) + EPS), o1 = Math.floor((axis === 0 ? z1 : x1) - EPS);
  if (d < 0) {
    const from = Math.floor(lo + EPS), to = Math.floor(lo + d);
    for (let b = from - 1; b >= to; b--) for (let o = o0; o <= o1; o++) for (let by = by0; by <= by1; by++) {
      const id = axis === 0 ? world.getBlock(b, by, o) : world.getBlock(o, by, b);
      const s = blockSpan(id);
      if (!s || by + s[1] <= y0 + EPS || by + s[0] >= y1 - EPS) continue;
      const face = b + 1;
      if (face <= lo + EPS && face > lo + moved) moved = face - lo;
    }
  } else {
    const from = Math.floor(hi - EPS), to = Math.floor(hi + d);
    for (let b = from + 1; b <= to; b++) for (let o = o0; o <= o1; o++) for (let by = by0; by <= by1; by++) {
      const id = axis === 0 ? world.getBlock(b, by, o) : world.getBlock(o, by, b);
      const s = blockSpan(id);
      if (!s || by + s[1] <= y0 + EPS || by + s[0] >= y1 - EPS) continue;
      const face = b;
      if (face >= hi - EPS && face < hi + moved) moved = face - hi;
    }
  }
  if (extra) for (const e of extra) {
    if (e.max.y <= y0 + EPS || e.min.y >= y1 - EPS) continue;
    const oMin = axis === 0 ? e.min.z : e.min.x, oMax = axis === 0 ? e.max.z : e.max.x;
    const oLo = axis === 0 ? z0 : x0, oHi = axis === 0 ? z1 : x1;
    if (oMax <= oLo || oMin >= oHi) continue;
    const eMin = axis === 0 ? e.min.x : e.min.z, eMax = axis === 0 ? e.max.x : e.max.z;
    if (d < 0 && eMax <= lo + EPS && eMax > lo + moved) moved = eMax - lo;
    if (d > 0 && eMin >= hi - EPS && eMin < hi + moved) moved = eMin - hi;
  }
  if (axis === 0) box.x += moved; else box.z += moved;
  return moved;
}

// True when the box overlaps any solid block.
export function boxBlocked(world, box) {
  const x0 = Math.floor(box.x - box.hw + EPS), x1 = Math.floor(box.x + box.hw - EPS);
  const z0 = Math.floor(box.z - box.hw + EPS), z1 = Math.floor(box.z + box.hw - EPS);
  const y0 = Math.floor(box.y + EPS), y1 = Math.floor(box.y + box.h - EPS);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const s = blockSpan(world.getBlock(x, y, z));
    if (s && y + s[1] > box.y + EPS && y + s[0] < box.y + box.h - EPS) return true;
  }
  return false;
}

// Visit every block id the box overlaps (for water / lava / ladder checks).
export function forBlocksInBox(world, box, fn) {
  const x0 = Math.floor(box.x - box.hw), x1 = Math.floor(box.x + box.hw);
  const z0 = Math.floor(box.z - box.hw), z1 = Math.floor(box.z + box.hw);
  const y0 = Math.floor(box.y), y1 = Math.floor(box.y + box.h);
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const id = world.getBlock(x, y, z);
    if (id > 0) fn(id, x, y, z);
  }
}

// Generic integrate-and-collide step. Returns contact flags.
// body: { box, vel: {x,y,z}, stepHeight? }
export function moveBody(world, body, dt, extra) {
  const { box, vel } = body;
  const res = { ground: false, ceiling: false, wallX: false, wallZ: false };
  const dy = vel.y * dt;
  const my = moveAxis(world, box, 1, dy, extra);
  if (Math.abs(my - dy) > 1e-7) {
    if (dy < 0) res.ground = true; else res.ceiling = true;
    vel.y = 0;
  }
  for (const axis of [0, 2]) {
    const d = (axis === 0 ? vel.x : vel.z) * dt;
    if (d === 0) continue;
    const m = moveAxis(world, box, axis, d, extra);
    if (Math.abs(m - d) > 1e-7) {
      // Step up small ledges (slabs, or full blocks when allowed).
      const step = body.stepHeight ?? 0;
      let stepped = false;
      if (step > 0 && (res.ground || body.onGround)) {
        const saveY = box.y;
        const up = moveAxis(world, box, 1, step, extra);
        const rest = d - m;
        const m2 = moveAxis(world, box, axis, rest, extra);
        if (Math.abs(m2 - rest) < 1e-6) {
          moveAxis(world, box, 1, -up, extra);
          stepped = true;
        } else {
          // undo
          if (axis === 0) box.x -= m2; else box.z -= m2;
          box.y = saveY;
        }
      }
      if (!stepped) {
        if (axis === 0) { res.wallX = true; vel.x = 0; } else { res.wallZ = true; vel.z = 0; }
      }
    }
  }
  return res;
}
