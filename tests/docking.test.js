// End-to-end docking physics: capture, bounce, merge and undock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { World } from '../src/core/world.js';
import { circularState, orientStation, placeOnAxis } from '../src/missions/scenario.js';
import { lvlhBasis } from '../src/physics/orbital.js';
import { PHYSICS_DT, RING_OMEGA, fromRpm } from '../src/physics/constants.js';

function setup(spin = RING_OMEGA, range = 1.0, lateral = new Vector3()) {
  const W = new World();
  const st = circularState(W.primary, 400e3, 0.3);
  W.meridian.body.pos.copy(st.pos); W.meridian.body.vel.copy(st.vel);
  orientStation(W.meridian, lvlhBasis(st.pos, st.vel).y.negate(), spin);
  placeOnAxis(W, range, lateral, true);
  return W;
}

function closeAt(W, speed) {
  // give the Kestrel a closing velocity along the port axis (inertially)
  const axis = W.meridian.axisWorld(new Vector3());
  W.kestrel.body.vel.addScaledVector(axis, -speed);
}

function run(W, seconds, cb) {
  const events = [];
  for (let i = 0; i < seconds / PHYSICS_DT; i++) {
    W.step(PHYSICS_DT);
    for (const e of W.docking.events) events.push(e);
    W.docking.events.length = 0;
    if (cb && cb(events)) break;
  }
  return events;
}

test('gentle spin-matched approach captures, latches and hard-docks', () => {
  const W = setup();
  closeAt(W, 0.06);
  const L0 = W.meridian.body.L.clone().add(W.kestrel.body.L);
  const ev = run(W, 30, (e) => e.some((x) => x.type === 'hardDock'));
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('softCapture'), 'soft capture');
  assert.equal(types.filter((t) => t === 'latch').length, 12, 'twelve latches');
  assert.ok(types.includes('hardDock'), 'hard dock');
  const hd = ev.find((e) => e.type === 'hardDock');
  assert.ok(Math.abs(hd.after.spin - hd.before.spin) < 0.01, 'spin barely changes for a matched Kestrel');
  // spin axis direction of L stays (nearly) put
  const L1 = W.meridian.body.L.clone();
  assert.ok(L1.angleTo(L0) < 0.01, 'angular momentum direction conserved');
  assert.equal(W.kestrel.hull, 100);
});

test('fast approach bounces off with damage', () => {
  const W = setup();
  closeAt(W, 0.8);
  const ev = run(W, 6);
  const b = ev.find((e) => e.type === 'bounce');
  assert.ok(b, 'bounced');
  assert.ok(!ev.some((e) => e.type === 'softCapture'), 'no capture');
  assert.ok(W.kestrel.hull < 100, `damage taken (${W.kestrel.hull})`);
  assert.ok(W.docking.rel.closing < 0, 'moving away after rebound');
});

test('unmatched roll at 65 RPM is refused, matched roll docks and conserves L', () => {
  const w = fromRpm(65);
  const W = setup(w);
  closeAt(W, 0.05);
  const ev = run(W, 30, (e) => e.some((x) => x.type === 'hardDock'));
  assert.ok(ev.some((e) => e.type === 'hardDock'), 'docked while spinning at 65 RPM');
  // despin with rim jets: torque / inertia
  const S = W.meridian;
  S.despinCmd = -1;
  const w0 = S.spinRate;
  run(W, 10);
  const alpha = (w0 - S.spinRate) / 10;
  const Izz = S.body.inertiaBody.elements[8];
  const expected = (4 * 25000 * 41.2) / Izz;
  assert.ok(Math.abs(alpha - expected) / expected < 0.05, `despin rate ${alpha} vs ${expected}`);

  const W2 = setup(w);
  W2.kestrel.body.setAngularVelocity(new Vector3());
  closeAt(W2, 0.05);
  const ev2 = run(W2, 6);
  assert.ok(!ev2.some((e) => e.type === 'softCapture'), 'no capture without matching spin');
});

test('undock: latches release and springs push apart', () => {
  const W = setup();
  W.docking.attachImmediately();
  W.docking.release();
  const ev = run(W, 10, (e) => e.some((x) => x.type === 'separated'));
  assert.ok(ev.some((e) => e.type === 'separated'));
  run(W, 5);
  const r = W.docking.compute();
  assert.ok(r.vel.z > 0.04 && r.vel.z < 0.1, `separation speed ${r.vel.z}`);
});
