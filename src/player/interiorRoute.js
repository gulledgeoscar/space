// Wayfinding aboard the Meridian. The walkable station is a single chain:
//
//   Kestrel seat - cabin hatch - port tunnel - hub - Spoke A (ladder) -
//   airlock - hydroponics - lab - quarters - corridor - bridge
//
// so the next waypoint toward any destination is found by walking that
// chain from the player's current area. Positions are in the station frame.

import { Vector3 } from 'three';
import {
  ROOMS, L, R, SPOKE_S, SPOKE_THETA, LADDER_OFF, toStation, fromStation, kestrelToStation, KESTREL_HATCH,
} from '../ship/interiorLayout.js';
import { HUB_R } from '../physics/constants.js';

// order along the chain (larger = further from the Kestrel)
const RANK = { kestrel: 0, hub: 1, spoke: 2, ring: 3 };

export const DESTINATIONS = {
  kestrel: { label: 'KESTREL', area: 'kestrel' },
  hub: { label: 'HUB', area: 'hub' },
  airlock: { label: 'RING', area: 'ring', s: SPOKE_S - 2.5 },
  bridge: { label: 'BRIDGE', area: 'ring', s: 9.0 },
  console: { label: 'MAIN CONSOLE', area: 'ring', s: 4.6 },
};

function areaClass(a) {
  if (a === 'kestrel' || a === 'hub' || a === 'spoke') return a;
  return 'ring';
}

// -> { pos: Vector3 (station frame), label, final }
export function nextWaypoint(space, playerPos, destId, mode = 'walk') {
  const dest = DESTINATIONS[destId];
  if (!dest) return null;
  const here = areaClass(space.area(playerPos));
  const roll = space.kestrelRoll || 0;
  const r = new Vector3(Math.cos(SPOKE_THETA), Math.sin(SPOKE_THETA), 0);
  const t = new Vector3(-Math.sin(SPOKE_THETA), Math.cos(SPOKE_THETA), 0);
  const u = fromStation(playerPos);
  const hatch = kestrelToStation(KESTREL_HATCH.x, KESTREL_HATCH.y, KESTREL_HATCH.z, roll);
  const port = new Vector3(0, 0, 4.4);
  const spokeTop = r.clone().multiplyScalar(HUB_R - 0.6);
  const ladderBase = r.clone().multiplyScalar(R - 1.2).addScaledVector(t, LADDER_OFF - 0.5);
  const seat = kestrelToStation(0, 0.7, -4.35, roll);

  const goingOut = RANK[dest.area] > RANK[here];
  const goingIn = RANK[dest.area] < RANK[here];
  if (here === 'kestrel') {
    if (goingOut) return { pos: hatch, label: 'HATCH' };
    return { pos: seat, label: 'PILOT SEAT', final: true };
  }
  if (here === 'hub') {
    if (goingOut) return { pos: spokeTop, label: 'SPOKE A' };
    if (goingIn) return { pos: port, label: 'KESTREL' };
    return { pos: new Vector3(0, 0, 0), label: dest.label, final: true };
  }
  if (here === 'spoke') {
    if (goingOut || dest.area === 'ring') return { pos: ladderBase.clone().addScaledVector(r, 1.0), label: 'RING' };
    return { pos: spokeTop, label: 'HUB' };
  }
  // ring rooms
  const targetS = dest.area === 'ring' ? dest.s : SPOKE_S;
  if (dest.area !== 'ring' && Math.abs(u.s - SPOKE_S) < 3.2) {
    return { pos: ladderBase.clone().addScaledVector(r, -1.0), label: 'LADDER' };
  }
  // next door between here and the target
  const room = Math.floor(u.s / L);
  const targetRoom = Math.floor(targetS / L);
  if (room !== targetRoom) {
    const k = targetRoom > room ? room + 1 : room;      // door index (boundary k*L)
    const next = ROOMS[targetRoom > room ? room + 1 : room - 1];
    return { pos: toStation(k * L, 1.3, 0), label: next ? next.name : 'DOOR' };
  }
  return { pos: toStation(targetS, 1.2, 0), label: dest.label, final: true };
}

