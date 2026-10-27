// Axis-separated AABB movement against the voxel grid. Shared by the
// player, creatures, dropped items and falling blocks.
//
// A box is { x, y, z, hw, h }: centre x/z, feet y, half width, height.
import { BLOCKS, SOLID } from '../world/blocks.js';

const EPS = 1e-4;

// Collision boxes of a block in block-local units [x0, y0, z0, x1, y1, z1],
// or null when passable. Blocks can define their own via `boxes`.
const FULL = [[0, 0, 0, 1, 1, 1]];
const boxCache = [];
export function blockBoxes(id) {
  if (id < 0) return FULL; // unloaded: solid
  if (boxCache[id] !== undefined) return boxCache[id];
  const b = BLOCKS[id];
  let out = null;
  if (b && SOLID[id]) out = b.boxes ?? (b.shape === 'slab' ? [[0, 0, 0, 1, 0.5, 1]] : FULL);
  boxCache[id] = out;
  return out;
}

const emin = [0, 0, 0], emax = [0, 0, 0];

// Moves the box along one axis (0 x, 1 y, 2 z), clipping against block
// collision boxes and any extra AABBs ({min:{x,y,z}, max:{x,y,z}}).
// Returns the distance actually moved.
export function moveAxis(world, box, axis, d, extra) {
  if (d === 0) return 0;
  emin[0] = box.x - box.hw; emax[0] = box.x + box.hw;
  emin[1] = box.y; emax[1] = box.y + box.h;
  emin[2] = box.z - box.hw; emax[2] = box.z + box.hw;
  let moved = d;
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (a === axis) {
      lo[a] = Math.floor(Math.min(emin[a], emin[a] + d) - EPS);
      hi[a] = Math.floor(Math.max(emax[a], emax[a] + d) + EPS);
    } else {
      lo[a] = Math.floor(emin[a] + EPS);
      hi[a] = Math.floor(emax[a] - EPS);
    }
  }
  const clip = (bx0, by0, bz0, bx1, by1, bz1) => {
    const bmin = [bx0, by0, bz0], bmax = [bx1, by1, bz1];
    for (let a = 0; a < 3; a++) {
      if (a === axis) continue;
      if (bmax[a] <= emin[a] + EPS || bmin[a] >= emax[a] - EPS) return;
    }
    if (d > 0 && bmin[axis] >= emax[axis] - EPS && bmin[axis] - emax[axis] < moved) moved = Math.max(0, bmin[axis] - emax[axis]);
    if (d < 0 && bmax[axis] <= emin[axis] + EPS && bmax[axis] - emin[axis] > moved) moved = Math.min(0, bmax[axis] - emin[axis]);
  };
  for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
    const boxes = blockBoxes(world.getBlock(x, y, z));
    if (!boxes) continue;
    for (const b of boxes) clip(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
  }
  if (extra) for (const e of extra) clip(e.min.x, e.min.y, e.min.z, e.max.x, e.max.y, e.max.z);
  if (axis === 0) box.x += moved; else if (axis === 1) box.y += moved; else box.z += moved;
  return moved;
}

// True when the box overlaps any block collision box.
export function boxBlocked(world, box) {
  const x0 = box.x - box.hw, x1 = box.x + box.hw, z0 = box.z - box.hw, z1 = box.z + box.hw;
  const y0 = box.y, y1 = box.y + box.h;
  for (let y = Math.floor(y0 + EPS); y <= Math.floor(y1 - EPS); y++) {
    for (let z = Math.floor(z0 + EPS); z <= Math.floor(z1 - EPS); z++) {
      for (let x = Math.floor(x0 + EPS); x <= Math.floor(x1 - EPS); x++) {
        const boxes = blockBoxes(world.getBlock(x, y, z));
        if (!boxes) continue;
        for (const b of boxes) {
          if (x + b[3] > x0 + EPS && x + b[0] < x1 - EPS && y + b[4] > y0 + EPS && y + b[1] < y1 - EPS && z + b[5] > z0 + EPS && z + b[2] < z1 - EPS) return true;
        }
      }
    }
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
