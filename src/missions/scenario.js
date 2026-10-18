// Scenario helpers shared by missions: placing craft on orbits, orienting
// the station, putting the Kestrel at an LVLH offset, etc.

import { Vector3, Quaternion } from 'three';
import { lvlhBasis, lvlhToWorldOffset } from '../physics/orbital.js';
import { RING_OMEGA } from '../physics/constants.js';

// Circular orbit state at altitude, at angle theta in the equatorial
// (XZ) plane, prograde (h along +Y), optionally inclined about X.
export function circularState(planet, altitude, theta = 0, inc = 0) {
  const r = planet.radius + altitude;
  const v = Math.sqrt(planet.gm / r);
  const pos = new Vector3(Math.cos(theta) * r, 0, -Math.sin(theta) * r);
  const vel = new Vector3(-Math.sin(theta) * v, 0, -Math.cos(theta) * v);
  if (inc) {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), inc);
    pos.applyQuaternion(q); vel.applyQuaternion(q);
  }
  return { pos, vel };
}

// Point the station's spin axis (body +Z, docking port) along dir and set
// its spin to omega about that axis.
export function orientStation(station, dir, omega = RING_OMEGA, roll = 0) {
  const b = station.body;
  b.quat.setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().normalize());
  if (roll) b.quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll));
  b.updateDerived();
  b.setAngularVelocity(dir.clone().normalize().multiplyScalar(omega));
  b.savePrev();
}

// Place the Kestrel at an offset from the station given in LVLH (R-bar,
// V-bar, H-bar) with relative velocity in the rotating LVLH frame.
export function placeKestrelLvlh(world, rho, rhoDot = new Vector3()) {
  const S = world.meridian.body, K = world.kestrel.body;
  const basis = lvlhBasis(S.pos, S.vel);
  const off = lvlhToWorldOffset(rho, basis);
  K.pos.copy(S.pos).add(off);
  // inertial velocity = v_t + omega x rho + R^T rhoDot
  const vRot = lvlhToWorldOffset(rhoDot, basis);
  K.vel.copy(S.vel).add(new Vector3().crossVectors(basis.omega, off)).add(vRot);
  K.savePrev();
  return basis;
}

// Kestrel attitude: nose toward a world point, with an up hint.
export function pointKestrel(world, targetWorld, upHint = null, roll = 0) {
  const K = world.kestrel.body;
  const f = new Vector3().subVectors(targetWorld, K.pos).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), f);
  if (upHint) {
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const want = upHint.clone().projectOnPlane(f).normalize();
    const ang = Math.atan2(new Vector3().crossVectors(up, want).dot(f), up.dot(want));
    q.premultiply(new Quaternion().setFromAxisAngle(f, ang));
  }
  if (roll) q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll));
  K.quat.copy(q);
  K.updateDerived();
  K.setAngularVelocity(new Vector3());
  K.savePrev();
}

// Kestrel aligned with the port axis (nose into the port) at a given range
// along the axis, with optional lateral offset (station body x,y).
export function placeOnAxis(world, range, lateral = new Vector3(), matchSpin = false) {
  const S = world.meridian.body, K = world.kestrel;
  const axis = S.dirToWorld(new Vector3(0, 0, 1));
  const port = world.meridian.portWorld(new Vector3());
  const latW = S.dirToWorld(lateral);
  const dockOff = new Vector3(0, 0, K.body.comBody.z - (-7.05));
  K.body.quat.copy(S.quat);
  K.body.updateDerived();
  // CoM is behind the dock ring by (com.z - dockZ) along +Z body
  const dockPoint = port.clone().addScaledVector(axis, range).add(latW);
  K.body.pos.copy(dockPoint).add(dockOff.applyQuaternion(K.body.quat));
  K.body.vel.copy(S.vel);
  // spin about the shared axis only (see PilotController.referenceOmega)
  K.body.setAngularVelocity(matchSpin ? axis.clone().multiplyScalar(S.omega.dot(axis)) : new Vector3());
  K.body.savePrev();
}

// Standard start: Meridian on a circular orbit around `planet`, spinning at
// 1 g, Kestrel hard-docked in the hub port.
export function setupDocked(game, planet, altitude = 400e3, { system = null, theta = 0.3, bh = null, fuel = null } = {}) {
  const W = game.world;
  W.setPrimary(planet);
  game.planetView.setPlanet(planet);
  game.sky.setSystem(system || (planet.system === 'sol' ? 'sol' : 'lethe'));
  if (bh) game.sky.setBlackHole(bh.dir, bh.dist ?? 40, bh.inc ?? 0.1);
  const st = circularState(planet, altitude, theta);
  W.meridian.body.pos.copy(st.pos); W.meridian.body.vel.copy(st.vel);
  const basis = lvlhBasis(st.pos, st.vel);
  orientStation(W.meridian, basis.y.clone().negate());
  if (fuel !== null) W.kestrel.fuel = fuel;
  W.docking.attachImmediately(0);
  W.meridian.body.savePrev(); W.kestrel.body.savePrev();
  game.hatchOpen = true;
  return basis;
}
