// The Meridian's walkable route: every doorway must let the player's body
// through (ring gravity + Coriolis acting), and the docked Kestrel's hatch
// tunnel must leave room for a floating astronaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Vector2 } from 'three';
import { InteriorSpace, toStation, fromStation, L, R, SPOKE_S, kestrelToStation, NOSE_TUBE } from '../src/ship/interiorLayout.js';
import { Walker } from '../src/player/onFoot.js';
import { centrifugal, coriolis } from '../src/physics/rotatingFrame.js';
import { RING_OMEGA } from '../src/physics/constants.js';

function env(space) {
  const w = new Vector3(0, 0, RING_OMEGA), t = new Vector3();
  return {
    gravity: (p, out) => centrifugal(w, p, out),
    accel: (p, v, out) => centrifugal(w, p, out).add(coriolis(w, v, t)),
    sdf: (p) => space.sdf(p),
    gradient: (p, out) => space.gradient(p, out),
  };
}

// walk along the ring toward arc position sTarget, opening doors on the way
function walkTo(space, W, sTarget, maxT = 120) {
  const e = env(space);
  const dt = 1 / 120;
  for (let t = 0; t < maxT; t += dt) {
    const u = fromStation(W.pos);
    for (const d of space.doors) d.open = Math.abs(u.s - d.s) < 2.4 ? 1 : 0;
    const dir = Math.sign(sTarget - u.s);
    if (Math.abs(sTarget - u.s) < 0.3) return { ok: true, t };
    // face along the ring, steer back to the centreline
    const th = u.s / R;
    const tan = new Vector3(-Math.sin(th), Math.cos(th), 0).multiplyScalar(dir);
    W.forward.copy(tan).add(new Vector3(0, 0, -u.z * 0.5)).normalize();
    W.step(dt, e, { move: new Vector2(0, 1), run: false, jump: false, yaw: 0 });
  }
  return { ok: false, s: fromStation(W.pos).s };
}

test('every doorway on the ring is walkable, both ways', () => {
  const space = new InteriorSpace();
  const W = new Walker();
  toStation(9, 0.02, 0, W.pos);
  W.up.set(-Math.cos(9 / R), -Math.sin(9 / R), 0);
  W.forward.set(-Math.sin(9 / R), Math.cos(9 / R), 0);
  const out = walkTo(space, W, SPOKE_S - 2.5);
  assert.ok(out.ok, `stuck walking spinward at s = ${out.s?.toFixed(2)} (doors at ${space.doors.map((d) => d.s.toFixed(1)).join(', ')})`);
  const back = walkTo(space, W, 9);
  assert.ok(back.ok, `stuck walking back at s = ${back.s?.toFixed(2)}`);
});

test('closed doors block the way', () => {
  const space = new InteriorSpace();
  for (const d of space.doors) d.open = 0;
  const p = toStation(L, 1.0, 0);
  assert.ok(space.sdf(p) < 0.1, 'a shut door is a wall');
});

test('the docked Kestrel hatch tunnel fits a floating astronaut', () => {
  const space = new InteriorSpace();
  space.kestrelDocked = true;
  for (const roll of [0, 2.094, -2.094]) {
    space.kestrelRoll = roll;
    // sample along the nose tunnel axis from the cabin hatch to the port tunnel
    for (let k = 0; k <= 20; k++) {
      const f = k / 20;
      const a = NOSE_TUBE.a, b = NOSE_TUBE.b;
      const p = kestrelToStation(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, roll);
      assert.ok(space.sdf(p) > 0.32, `tunnel too tight at ${f.toFixed(2)} (roll ${roll.toFixed(2)}): ${space.sdf(p).toFixed(3)}`);
    }
    // and on into the hub
    for (const z of [5.2, 4.8, 4.2, 3.0]) assert.ok(space.sdf(new Vector3(0, 0, z)) > 0.32, `port tunnel too tight at z ${z}`);
  }
});
