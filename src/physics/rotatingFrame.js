// Physics of the rotating station frame.
//
// In a frame rotating with angular velocity w (and angular acceleration
// alpha) a free particle at position p with velocity v (both measured in that
// frame) feels the fictitious accelerations
//
//   centrifugal  a_cf  = -w x (w x p)       (= w^2 r_perp, outward)
//   Coriolis     a_cor = -2 w x v
//   Euler        a_eu  = -alpha x p
//
// Ring "gravity" is the centrifugal term: a = w^2 r. It falls off linearly
// toward the hub, which is why the spoke climb goes from 1 g to 0 g.

import { Vector3 } from 'three';

const _t = new Vector3();

export function omegaForGravity(radius, g) { return Math.sqrt(g / radius); }
export function spinGravity(omega, radius) { return omega * omega * radius; }
export function tangentialSpeed(omega, radius) { return omega * radius; }

export function centrifugal(omega, p, out = new Vector3()) {
  _t.crossVectors(omega, p);
  return out.crossVectors(omega, _t).negate();
}

export function coriolis(omega, v, out = new Vector3()) {
  return out.crossVectors(omega, v).multiplyScalar(-2);
}

export function fictitiousAccel(omega, alpha, p, v, out = new Vector3()) {
  centrifugal(omega, p, out);
  out.add(coriolis(omega, v, _t));
  if (alpha) out.sub(_t.crossVectors(alpha, p));
  return out;
}

// Spin-dock kinematics: the velocity of the docking-port material point the
// chaser would touch, i.e. v_station + w_s x (p - c_s). If the chaser sits a
// distance d off the spin axis this includes a tangential term w d.
export function pointVelocity(stationVel, stationOmega, stationCom, p, out = new Vector3()) {
  _t.subVectors(p, stationCom);
  return out.crossVectors(stationOmega, _t).add(stationVel);
}

// Angular-momentum mismatch between a chaser rolling at w_c and a port
// spinning at w_s about (nearly) the same axis: the angular momentum that
// the latches would have to absorb at capture, I_c (w_s - w_c).
export function angularMomentumMismatch(chaserInertiaWorld, chaserOmega, stationOmega, out = new Vector3()) {
  _t.subVectors(stationOmega, chaserOmega);
  return out.copy(_t).applyMatrix3(chaserInertiaWorld);
}
