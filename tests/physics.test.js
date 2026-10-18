// Physics verification: these check the simulation against closed-form
// results so the game's "real physics" claims stay honest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Matrix3 } from 'three';

import { G0, RING_OMEGA, RING_FLOOR_R, PHYSICS_DT } from '../src/physics/constants.js';
import { RigidBody, Inertia, MassModel } from '../src/physics/rigidBody.js';
import {
  gravityAccel, propagateKepler, stateToElements, lvlhBasis, relativeLvlh, cwPropagate,
  cwTargetVelocity, hohmann,
} from '../src/physics/orbital.js';
import { spinGravity, fictitiousAccel } from '../src/physics/rotatingFrame.js';
import { ORBITS, TARGET_FACTOR, kerrOrbitDtDtau, LETHE_SPIN } from '../src/physics/timeDilation.js';
import { deltaV, propellantFor } from '../src/physics/rocket.js';
import { resolveContact } from '../src/physics/collision.js';
import { EARTH, PELAGIA, SKADI, pelagiaTides } from '../src/physics/bodies.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('ring spin gives 1 g at the floor and fades linearly to the hub', () => {
  near(spinGravity(RING_OMEGA, RING_FLOOR_R), G0, 1e-9, 'floor g');
  near(spinGravity(RING_OMEGA, RING_FLOOR_R / 2), G0 / 2, 1e-9, 'half radius');
  near(spinGravity(RING_OMEGA, 0), 0, 1e-12, 'axis');
});

test('Coriolis: dropped object lands antispinward of the plumb line', () => {
  // Drop from 1.8 m above a 40 m floor in the rotating frame; integrate.
  const w = new Vector3(0, 0, RING_OMEGA);
  const p = new Vector3(RING_FLOOR_R - 1.8, 0, 0);
  const v = new Vector3();
  const a = new Vector3();
  for (let i = 0; i < 100000 && p.length() < RING_FLOOR_R; i++) {
    fictitiousAccel(w, null, p, v, a);
    v.addScaledVector(a, 1e-4);
    p.addScaledVector(v, 1e-4);
  }
  const theta = Math.atan2(p.y, p.x); // spin is +theta
  assert.ok(theta < 0, 'lands behind (antispinward)');
  // Inertial answer: the ball flies straight along a chord at w r0 while the
  // floor turns by w t underneath it.
  const r0 = RING_FLOOR_R - 1.8;
  const chord = Math.sqrt(RING_FLOOR_R ** 2 - r0 ** 2);
  const t = chord / (RING_OMEGA * r0);
  const exact = (RING_OMEGA * t - Math.atan2(chord, r0)) * RING_FLOOR_R;
  const drift = -theta * RING_FLOOR_R;
  near(drift, exact, 0.01, 'drift matches inertial straight-line solution');
});

test('Tsiolkovsky delta-v and its inverse agree', () => {
  const dv = deltaV(1050, 32000, 14000);
  near(dv, 1050 * G0 * Math.log(32000 / 14000), 1e-9, 'dv');
  near(propellantFor(dv, 1050, 32000), 18000, 1e-6, 'propellant');
});

test('Kepler propagation returns to start after one period', () => {
  const mu = EARTH.gm;
  const r = new Vector3(EARTH.radius + 400e3, 0, 0);
  const v = new Vector3(0, 300, -Math.sqrt(mu / r.x) * 1.02);
  const el = stateToElements(r, v, mu);
  const r2 = new Vector3(), v2 = new Vector3();
  propagateKepler(r, v, mu, el.period, r2, v2);
  near(r2.distanceTo(r), 0, 1e-3, 'position');
  assert.ok(el.inc > 0 && el.e > 0.0, 'non-trivial orbit');
});

test('Newtonian integration of a near-target chaser matches Clohessy-Wiltshire', () => {
  const mu = EARTH.gm;
  const rT = new Vector3(EARTH.radius + 400e3, 0, 0);
  const vc = Math.sqrt(mu / rT.x);
  const vT = new Vector3(0, 0, -vc);
  const basis = lvlhBasis(rT, vT);
  // chaser 200 m behind on V-bar, thrusting 0.5 m/s straight at the target
  const rC = rT.clone().addScaledVector(basis.y, -200);
  const vC = vT.clone().addScaledVector(basis.y, 0.5);
  const rel0 = relativeLvlh(rC, vC, rT, vT);
  const T = 900;
  const steps = Math.round(T / PHYSICS_DT);
  const a = new Vector3();
  for (let i = 0; i < steps; i++) {
    vT.add(gravityAccel(rT, mu, a).multiplyScalar(PHYSICS_DT)); rT.addScaledVector(vT, PHYSICS_DT);
    vC.add(gravityAccel(rC, mu, a).multiplyScalar(PHYSICS_DT)); rC.addScaledVector(vC, PHYSICS_DT);
  }
  const relN = relativeLvlh(rC, vC, rT, vT);
  const n = Math.sqrt(mu / Math.pow(EARTH.radius + 400e3, 3));
  const cw = cwPropagate(rel0.r, rel0.v, n, T, new Vector3());
  near(relN.r.distanceTo(cw), 0, 5, 'CW vs Newton after 15 min (m)');
  // thrusting straight at it raised the orbit: chaser is above (x>0)
  assert.ok(relN.r.x > 50, `chaser rose: x=${relN.r.x}`);
});

test('CW targeting velocity reaches the requested point', () => {
  const n = 0.00113;
  const r0 = new Vector3(30, -800, 10);
  const rf = new Vector3(0, -50, 0);
  const v0 = cwTargetVelocity(r0, rf, n, 400);
  const out = cwPropagate(r0, v0, n, 400, new Vector3());
  near(out.distanceTo(rf), 0, 1e-6, 'arrival');
});

test('Hohmann numbers are sane', () => {
  const h = hohmann(EARTH.gm, EARTH.radius + 380e3, EARTH.radius + 400e3);
  assert.ok(h.dv1 > 5 && h.dv1 < 6.5, `dv1 ${h.dv1}`);
});

test('torque-free asymmetric body conserves L and precesses', () => {
  const b = new RigidBody();
  b.setMassProperties(1000, new Vector3(), new Matrix3().set(800, 0, 0, 0, 1200, 0, 0, 0, 2000));
  b.setAngularVelocity(new Vector3(0.3, 0.05, 6.8));
  const L0 = b.L.clone();
  const E0 = b.rotKE();
  const w0 = b.omega.clone();
  for (let i = 0; i < 120 * 30; i++) b.integrate(PHYSICS_DT);
  near(b.L.distanceTo(L0), 0, 1e-9, 'L');
  near(b.rotKE() / E0, 1, 0.01, 'energy within 1% over 30 s');
  assert.ok(b.omega.distanceTo(w0) > 1e-3, 'omega direction wanders (precession)');
});

test('collision impulse conserves linear and angular momentum', () => {
  const a = new RigidBody(), c = new RigidBody();
  a.setMassProperties(30000, new Vector3(), Inertia.box(30000, 3, 2, 14));
  c.setMassProperties(300000, new Vector3(), Inertia.cylinderZ(300000, 30, 10));
  a.pos.set(0, 0.4, 7); c.pos.set(0, 0, 0);
  a.vel.set(0, 0, -0.8); c.setAngularVelocity(new Vector3(0, 0, 0.5));
  a.updateDerived();
  const P0 = a.vel.clone().multiplyScalar(a.mass).addScaledVector(c.vel, c.mass);
  const Lsys = (x) => new Vector3().crossVectors(x.pos, x.vel.clone().multiplyScalar(x.mass)).add(x.L);
  const L0 = Lsys(a).add(Lsys(c));
  const res = resolveContact(a, c, new Vector3(0.1, 0.4, 0.5), new Vector3(0, 0, 1), 0.5, 0.3);
  assert.ok(res && res.j > 0);
  const P1 = a.vel.clone().multiplyScalar(a.mass).addScaledVector(c.vel, c.mass);
  const L1 = Lsys(a).add(Lsys(c));
  near(P1.distanceTo(P0), 0, 1e-6, 'momentum');
  near(L1.distanceTo(L0), 0, 1e-4, 'angular momentum');
  assert.ok(a.vel.z > 0, 'rebounds');
});

test('mass model parallel axis', () => {
  const m = new MassModel();
  m.add('a', 10, new Vector3(1, 0, 0));
  m.add('b', 10, new Vector3(-1, 0, 0));
  const r = m.compute();
  near(r.inertia.elements[4], 20, 1e-9, 'Iyy');
  near(r.inertia.elements[0], 0, 1e-9, 'Ixx');
});

test('Pelagia: 1 hour on the surface is ~7 years far away', () => {
  near(ORBITS.pelagia.factor, TARGET_FACTOR, 1, 'factor');
  assert.ok(ORBITS.pelagia.r > ORBITS.pelagia.isco, 'orbit is outside the ISCO');
  near((3600 * ORBITS.pelagia.factor) / (365.25 * 86400), 7, 0.01, 'years per hour');
  assert.ok(kerrOrbitDtDtau(40, LETHE_SPIN) < 1.05);
});

test('planets: surface gravity, escape velocity and tides', () => {
  near(PELAGIA.surfaceG / G0, 1.3, 1e-9, 'Pelagia 1.3 g');
  near(SKADI.surfaceG / G0, 0.85, 1e-9, 'Skadi');
  near(EARTH.escapeVelocity, 11186, 5, 'Earth escape');
  const t = pelagiaTides();
  assert.ok(t.d > t.roche, 'outside Roche limit');
  assert.ok(t.hill > 2 * PELAGIA.radius, 'Hill sphere holds low orbits');
  assert.ok(t.waveHeight > 800 && t.waveHeight < 1600, `wave ${t.waveHeight}`);
});
