// Impulse-based rigid-body contact with restitution and Coulomb friction.
//
//            -(1 + e) (v_rel . n)
//   j = ---------------------------------------------------------------
//       1/m1 + 1/m2 + n . [ (I1^-1 (r1 x n)) x r1 + (I2^-1 (r2 x n)) x r2 ]
//
// Both bodies receive equal and opposite impulses, so linear and angular
// momentum of the pair are conserved; the restitution coefficient sets how
// much of the normal kinetic energy survives the bounce.

import { Vector3 } from 'three';

const _r1 = new Vector3();
const _r2 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _vr = new Vector3();
const _J = new Vector3();
const _t = new Vector3();

// a, b: RigidBody (b may be null for an immovable world).
// p: contact point (world), n: normal pointing from b into a.
// Returns { j, vn, jt } or null when separating.
export function resolveContact(a, b, p, n, restitution = 0.4, friction = 0.3) {
  _r1.subVectors(p, a.pos);
  a.velocityAt(p, _v1);
  if (b) { _r2.subVectors(p, b.pos); b.velocityAt(p, _v2); } else _v2.set(0, 0, 0);
  _vr.subVectors(_v1, _v2);
  const vn = _vr.dot(n);
  if (vn >= 0) return null;
  const k = a.effInvMass(_r1, n) + (b ? b.effInvMass(_r2, n) : 0);
  const j = (-(1 + restitution) * vn) / k;
  _J.copy(n).multiplyScalar(j);
  // friction along the tangential slip direction
  _t.copy(_vr).addScaledVector(n, -vn);
  const vt = _t.length();
  let jt = 0;
  if (vt > 1e-6) {
    _t.multiplyScalar(1 / vt);
    const kt = a.effInvMass(_r1, _t) + (b ? b.effInvMass(_r2, _t) : 0);
    jt = Math.min(vt / kt, friction * j);
    _J.addScaledVector(_t, -jt);
  }
  a.applyImpulse(_J, p);
  if (b) b.applyImpulse(_J.negate(), p);
  return { j, vn, jt, impulse: j };
}

// Push bodies apart along n to remove penetration depth (mass-weighted).
export function separate(a, b, n, depth) {
  if (depth <= 0) return;
  const wa = a.invMass, wb = b && !b.frozen ? b.invMass : 0;
  const tot = wa + wb;
  if (tot <= 0) return;
  a.pos.addScaledVector(n, (depth * wa) / tot);
  if (b && wb > 0) b.pos.addScaledVector(n, (-depth * wb) / tot);
}

// Closest point on segment ab to p.
export function closestOnSegment(p, a, b, out = new Vector3()) {
  _t.subVectors(b, a);
  const l2 = _t.lengthSq();
  let s = l2 > 0 ? _t.dot(_r1.subVectors(p, a)) / l2 : 0;
  s = Math.max(0, Math.min(1, s));
  return out.copy(a).addScaledVector(_t, s);
}
