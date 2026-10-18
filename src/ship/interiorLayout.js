// Meridian interior layout + collision space (station body frame).
//
// The ring is described in "unrolled" coordinates: s = arc length along the
// floor (spinward = +s), h = height above the floor (toward the axis),
// z = axial. toStation() maps them onto the real curved ring, so the floor
// genuinely curves up ahead of you.
//
// Navigable space is a union of convex volumes expressed as signed
// "inside distances" (positive inside); furniture subtracts. The player is
// a set of spheres that must stay at least their radius inside.

import { Vector3, Quaternion } from 'three';
import {
  RING_FLOOR_R, RING_CEIL_R, MODULE_ARC, HUB_R, HUB_Z0, HUB_Z1, SPOKE_R, SPOKE_MODULE, PORT_Z, KESTREL_DOCKED_Z,
} from '../physics/constants.js';

export const R = RING_FLOOR_R;
export const ROOM_H = RING_FLOOR_R - RING_CEIL_R; // 3.6
export const L = MODULE_ARC;
export const DOOR_W = 0.72;   // half width
export const DOOR_H = 2.3;
export const SPOKE_S = (SPOKE_MODULE + 0.5) * L;
export const SPOKE_THETA = SPOKE_S / R;
export const LADDER_OFF = 0.72;   // ladder sits spinward of the spoke axis

export const ROOMS = [
  { i: 0, id: 'bridge', name: 'BRIDGE', hw: 3.0 },
  { i: 1, id: 'corridor', name: 'GALLEY / CORRIDOR', hw: 1.6 },
  { i: 2, id: 'quarters', name: 'CREW QUARTERS', hw: 3.0 },
  { i: 3, id: 'lab', name: 'SCIENCE LAB', hw: 3.0 },
  { i: 4, id: 'hydro', name: 'HYDROPONICS', hw: 3.0 },
  { i: 5, id: 'airlock', name: 'AIRLOCK / SPOKE A', hw: 2.4 },
];

// Doors at module boundaries 1..5 (0 and 6 are sealed bulkheads).
export const DOORS = [1, 2, 3, 4, 5].map((k) => ({ k, s: k * L, open: 0, locked: false, label: `${ROOMS[k - 1].name}  |  ${ROOMS[k].name}` }));

export function toStation(s, h, z, out = new Vector3()) {
  const th = s / R, r = R - h;
  return out.set(r * Math.cos(th), r * Math.sin(th), z);
}
export function fromStation(p, out = { s: 0, h: 0, z: 0, rho: 0, th: 0 }) {
  const rho = Math.hypot(p.x, p.y);
  let th = Math.atan2(p.y, p.x);
  if (th < -Math.PI / 2) th += Math.PI * 2;
  out.rho = rho; out.th = th; out.s = th * R; out.h = R - rho; out.z = p.z;
  return out;
}
// local frame at arc position s: tangent (spinward), up (toward axis), axial
export function frameAt(s) {
  const th = s / R;
  return {
    t: new Vector3(-Math.sin(th), Math.cos(th), 0),
    up: new Vector3(-Math.cos(th), -Math.sin(th), 0),
    z: new Vector3(0, 0, 1),
  };
}
export function quatAt(s, yaw = 0) {
  const th = s / R;
  // local X = tangent, Y = up, Z = axial: rotation about Z by (th + pi/2)
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), th + Math.PI / 2);
  if (yaw) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  return q;
}

const boxIn = (x, x0, x1) => Math.min(x - x0, x1 - x);
// signed distance outside an axis-aligned box [x0,x1,y0,y1,z0,z1] (negative inside)
function boxOut(x, y, z, b) {
  const dx = Math.max(b[0] - x, 0, x - b[1]), dy = Math.max(b[2] - y, 0, y - b[3]), dz = Math.max(b[4] - z, 0, z - b[5]);
  const out = Math.hypot(dx, dy, dz);
  return out > 0 ? out : -Math.min(x - b[0], b[1] - x, y - b[2], b[3] - y, z - b[4], b[5] - z);
}
function segDist(x, y, z, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / (abx * abx + aby * aby + abz * abz)));
  return Math.hypot(x - a[0] - abx * t, y - a[1] - aby * t, z - a[2] - abz * t);
}

// Kestrel cabin (Kestrel body coords). The hatch sits low in the forward
// bulkhead; its tunnel slopes up to the docking ring on the nose axis.
export const KESTREL_HATCH = { x: 0, y: -0.12, z: -5.84, r: 0.5 };
export const NOSE_TUBE = { a: [0, -0.12, -5.5], b: [0, 0, -7.3], r: 0.5 };
export const CABIN_OBSTACLES = [
  [-0.42, 0.42, -0.55, 1.42, -4.78, -3.98],    // pilot seat
  [-1.2, 1.2, 0.3, 1.6, -5.95, -5.3],          // glareshield, MFDs, windscreen
  [-1.2, -0.62, -0.6, 1.6, -5.95, -5.3],       // panel wings either side of the hatch
  [0.62, 1.2, -0.6, 1.6, -5.95, -5.3],
  [-0.9, -0.3, -0.55, 0.78, -3.45, -2.6],      // passenger seats
  [0.3, 0.9, -0.55, 0.78, -3.45, -2.6],
];
// Kestrel body coords -> station frame for a Kestrel docked with `roll`
export function kestrelToStation(x, y, z, roll, out = new Vector3()) {
  const c = Math.cos(roll), s = Math.sin(roll);
  return out.set(x * c - y * s, x * s + y * c, z + KESTREL_DOCKED_Z);
}
export function kestrelUp(roll, out = new Vector3()) { return out.set(-Math.sin(roll), Math.cos(roll), 0); }

// Obstacles (furniture) in unrolled coords: { s0, s1, h0, h1, z0, z1 }
export const OBSTACLES = [];
export function addObstacle(s0, s1, h0, h1, z0, z1, tag = '') {
  const o = { s0: Math.min(s0, s1), s1: Math.max(s0, s1), h0, h1, z0: Math.min(z0, z1), z1: Math.max(z0, z1), tag };
  OBSTACLES.push(o);
  return o;
}

export class InteriorSpace {
  constructor() {
    this.doors = DOORS;
    this.kestrelDocked = true;
    this.kestrelRoll = 0;
    this.portOpen = true;
    this.spokeHatchOpen = true;
    this._u = { s: 0, h: 0, z: 0, rho: 0, th: 0 };
  }

  // Signed inside-distance of the navigable space (positive = free).
  sdf(p) {
    const u = fromStation(p, this._u);
    let best = -1e9;
    // ring rooms
    if (u.h > -1 && u.h < ROOM_H + 1 && u.s > -1 && u.s < 6 * L + 1) {
      const mi = Math.floor(u.s / L);
      for (let i = Math.max(0, mi - 1); i <= Math.min(5, mi + 1); i++) {
        const room = ROOMS[i];
        const d = Math.min(boxIn(u.s, i * L + 0.15, (i + 1) * L - 0.15), boxIn(u.h, 0, ROOM_H), boxIn(u.z, -room.hw, room.hw));
        if (d > best) best = d;
      }
      for (const door of this.doors) {
        if (door.open < 0.85 || Math.abs(u.s - door.s) > 2) continue;
        // the doorway volume reaches well into both rooms, so the clearance
        // never dips below the body radius where it meets the room boxes
        const d = Math.min(boxIn(u.s, door.s - 1.2, door.s + 1.2), boxIn(u.h, 0, DOOR_H), boxIn(u.z, -DOOR_W, DOOR_W));
        if (d > best) best = d;
      }
      // furniture
      if (best > -0.5) {
        for (const o of OBSTACLES) {
          if (u.s < o.s0 - 1 || u.s > o.s1 + 1) continue;
          const dx = Math.max(o.s0 - u.s, 0, u.s - o.s1), dy = Math.max(o.h0 - u.h, 0, u.h - o.h1), dz = Math.max(o.z0 - u.z, 0, u.z - o.z1);
          let out = Math.hypot(dx, dy, dz);
          if (out === 0) out = -Math.min(u.s - o.s0, o.s1 - u.s, u.h - o.h0, o.h1 - u.h, u.z - o.z0, o.z1 - u.z);
          if (out < best) best = out;
        }
      }
    }
    // spoke A (radial tube)
    const dth = u.th - SPOKE_THETA;
    const tang = u.rho * Math.sin(dth);
    if (Math.cos(dth) > 0) {
      const radial = u.rho * Math.cos(dth);
      const dAxis = Math.hypot(tang, u.z);
      const top = HUB_R - 0.6;
      const bottom = RING_CEIL_R + (this.spokeHatchOpen ? 0.6 : -0.05);
      const d = Math.min(SPOKE_R - dAxis, radial - top, bottom - radial);
      if (d > best) best = d;
    }
    // hub
    {
      const d = Math.min(HUB_R - u.rho, u.z - HUB_Z0, HUB_Z1 - u.z);
      if (d > best) best = d;
    }
    // docking tunnel + Kestrel
    if (this.portOpen && this.kestrelDocked) {
      const dt = Math.min(0.52 - u.rho, u.z - (HUB_Z1 - 0.4), PORT_Z + 0.15 - u.z);
      if (dt > best) best = dt;
      // Kestrel body coords: rotate by -roll about Z, shift by docked z
      const c = Math.cos(-this.kestrelRoll), s = Math.sin(-this.kestrelRoll);
      const kx = p.x * c - p.y * s, ky = p.x * s + p.y * c, kz = p.z - KESTREL_DOCKED_Z;
      if (kz > -7.6 && kz < -2.2) {
        // nose tunnel: from the cabin hatch (low in the forward bulkhead) to the dock ring
        const tun = NOSE_TUBE.r - segDist(kx, ky, kz, NOSE_TUBE.a, NOSE_TUBE.b);
        if (tun > best) best = tun;
        // cabin, minus the pilot seat, console/windscreen and passenger seats
        let cab = Math.min(boxIn(kx, -1.1, 1.1), boxIn(ky, -0.53, 1.47), boxIn(kz, -5.82, -2.66));
        if (cab > -0.5) for (const o of CABIN_OBSTACLES) cab = Math.min(cab, boxOut(kx, ky, kz, o));
        if (cab > best) best = cab;
      }
    }
    return best;
  }

  gradient(p, out = new Vector3()) {
    const e = 0.01;
    const q = p.clone();
    q.x = p.x + e; const a = this.sdf(q); q.x = p.x - e; const b = this.sdf(q); q.x = p.x;
    q.y = p.y + e; const c = this.sdf(q); q.y = p.y - e; const d = this.sdf(q); q.y = p.y;
    q.z = p.z + e; const f = this.sdf(q); q.z = p.z - e; const g = this.sdf(q);
    out.set(a - b, c - d, f - g);
    const l = out.length();
    return l > 1e-9 ? out.multiplyScalar(1 / l) : out.set(0, 0, 0);
  }

  // Which named area is p in (for ambience / HUD)?
  area(p) {
    const u = fromStation(p, this._u);
    if (u.z > HUB_Z1 - 0.1 && u.rho < 1.6) return 'kestrel';
    if (u.rho < HUB_R + 0.2) return 'hub';
    if (u.rho < RING_CEIL_R - 0.3) return 'spoke';
    const i = Math.floor(u.s / L);
    return ROOMS[i]?.id || 'ring';
  }

  // Sphere-march from a toward b; returns safe distance along the segment.
  march(a, b, radius = 0.15) {
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 1e-6) return 0;
    dir.multiplyScalar(1 / len);
    let t = 0;
    const p = new Vector3();
    for (let i = 0; i < 48 && t < len; i++) {
      p.copy(a).addScaledVector(dir, t);
      const d = this.sdf(p) - radius;
      if (d < 0.005) return Math.max(0, t - 0.02);
      t += Math.max(d, 0.02);
    }
    return len;
  }
}
