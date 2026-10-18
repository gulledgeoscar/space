// Full 6-DOF rigid body.
//
// State is kept as (position of CoM, linear velocity, orientation quaternion,
// world-frame angular momentum L). Integrating L instead of omega means that
// with no applied torque |L| and its direction are conserved exactly, while
// omega = I_world^-1 L naturally produces torque-free precession and
// nutation for asymmetric inertia tensors (Euler's equations).
//
// Translation uses semi-implicit (symplectic) Euler: v += a dt; x += v dt.
// Rotation uses the exponential map: q <- exp(omega dt / 2) q.

import { Vector3, Quaternion, Matrix3 } from 'three';

const _v = new Vector3();
const _v2 = new Vector3();
const _q = new Quaternion();
const _m = new Matrix3();
const _mt = new Matrix3();
const _rk = { k: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], qt: new Quaternion(), w: new Vector3() };

export function quatToMat3(q, out) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  // Matrix3.set takes row-major arguments.
  return out.set(
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  );
}

// ----- inertia tensor helpers (about the shape's own centroid, body axes) ---
export const Inertia = {
  point() { return new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0); },
  box(m, w, h, d) { // extents along x, y, z
    return new Matrix3().set(
      (m * (h * h + d * d)) / 12, 0, 0,
      0, (m * (w * w + d * d)) / 12, 0,
      0, 0, (m * (w * w + h * h)) / 12,
    );
  },
  cylinderZ(m, r, l) { // solid cylinder, axis along z
    const ixx = (m * (3 * r * r + l * l)) / 12;
    return new Matrix3().set(ixx, 0, 0, 0, ixx, 0, 0, 0, 0.5 * m * r * r);
  },
  shellCylinderZ(m, r, l) { // thin-walled cylinder, axis along z
    const ixx = (m * (6 * r * r + l * l)) / 12;
    return new Matrix3().set(ixx, 0, 0, 0, ixx, 0, 0, 0, m * r * r);
  },
  sphere(m, r) {
    const i = 0.4 * m * r * r;
    return new Matrix3().set(i, 0, 0, 0, i, 0, 0, 0, i);
  },
};

// Rotate a body-axes inertia tensor by quaternion q: I' = R I R^T
export function rotateInertia(I, q, out = new Matrix3()) {
  quatToMat3(q, _m);
  _mt.copy(_m).transpose();
  return out.multiplyMatrices(_m, I).multiply(_mt);
}

// Parallel-axis term m(|d|^2 E - d d^T) added to I.
export function addParallelAxis(I, m, d) {
  const e = I.elements; // column-major
  const dx = d.x, dy = d.y, dz = d.z;
  const dd = dx * dx + dy * dy + dz * dz;
  e[0] += m * (dd - dx * dx); e[4] += m * (dd - dy * dy); e[8] += m * (dd - dz * dz);
  e[1] -= m * dx * dy; e[3] -= m * dx * dy;
  e[2] -= m * dx * dz; e[6] -= m * dx * dz;
  e[5] -= m * dy * dz; e[7] -= m * dy * dz;
  return I;
}

// A rigid assembly of mass elements in a body reference frame. Elements can
// change mass (fuel tanks, ballast water) and be removed (structural failure);
// compute() returns total mass, centre of mass and the inertia tensor about it.
export class MassModel {
  constructor() { this.elements = []; }

  add(name, mass, pos, inertiaPerKg = null, extra = {}) {
    // inertiaPerKg: tensor for 1 kg of this shape, so mass can vary freely.
    const el = { name, mass, pos: pos.clone(), unitI: inertiaPerKg || Inertia.point(), ...extra };
    this.elements.push(el);
    return el;
  }

  remove(name) { this.elements = this.elements.filter((e) => e.name !== name); }
  get(name) { return this.elements.find((e) => e.name === name); }

  compute() {
    let mass = 0;
    const com = new Vector3();
    for (const e of this.elements) { mass += e.mass; com.addScaledVector(e.pos, e.mass); }
    if (mass > 0) com.multiplyScalar(1 / mass);
    const I = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
    const tmp = new Matrix3();
    for (const e of this.elements) {
      if (e.mass <= 0) continue;
      tmp.copy(e.unitI).multiplyScalar(e.mass);
      addParallelAxis(tmp, e.mass, _v.subVectors(e.pos, com));
      const a = I.elements, b = tmp.elements;
      for (let i = 0; i < 9; i++) a[i] += b[i];
    }
    return { mass, com, inertia: I };
  }
}

export class RigidBody {
  constructor(name = 'body') {
    this.name = name;
    this.mass = 1;
    this.invMass = 1;
    this.comBody = new Vector3();          // CoM in body reference coords
    this.inertiaBody = new Matrix3().identity();
    this.invInertiaBody = new Matrix3().identity();

    this.pos = new Vector3();              // world position of CoM
    this.vel = new Vector3();
    this.quat = new Quaternion();          // body -> world
    this.L = new Vector3();                // world angular momentum about CoM
    this.omega = new Vector3();            // world angular velocity (derived)

    this.force = new Vector3();
    this.torque = new Vector3();
    this.accel = new Vector3();            // mass-independent (gravity, fictitious)

    this.prevPos = new Vector3();
    this.prevQuat = new Quaternion();
    this.rot = new Matrix3().identity();   // cached rotation matrix
    this.invIWorld = new Matrix3().identity();
    this.frozen = false;                   // driven externally (docked, landed)
    this.lastAccel = new Vector3();        // total acceleration of last step (for g-load)
  }

  setMassProperties(mass, comBody, inertiaBody) {
    // Keep the body reference origin fixed in space while the CoM moves.
    _v.subVectors(comBody, this.comBody).applyQuaternion(this.quat);
    this.pos.add(_v);
    this.prevPos.add(_v);
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.comBody.copy(comBody);
    this.inertiaBody.copy(inertiaBody);
    this.invInertiaBody.copy(inertiaBody).invert();
    this.updateDerived();
  }

  setFromMassModel(model) {
    const r = model.compute();
    this.setMassProperties(r.mass, r.com, r.inertia);
    return r;
  }

  updateDerived() {
    quatToMat3(this.quat, this.rot);
    _mt.copy(this.rot).transpose();
    this.invIWorld.multiplyMatrices(this.rot, this.invInertiaBody).multiply(_mt);
    this.omega.copy(this.L).applyMatrix3(this.invIWorld);
  }

  inertiaWorld(out = new Matrix3()) {
    return rotateInertia(this.inertiaBody, this.quat, out);
  }

  setAngularVelocity(w) {
    this.L.copy(w).applyMatrix3(this.inertiaWorld(_m));
    this.updateDerived();
  }

  // ----- frames -------------------------------------------------------------
  // body reference point -> world
  bodyToWorld(p, out = new Vector3()) {
    return out.subVectors(p, this.comBody).applyQuaternion(this.quat).add(this.pos);
  }
  worldToBody(p, out = new Vector3()) {
    _q.copy(this.quat).invert();
    return out.subVectors(p, this.pos).applyQuaternion(_q).add(this.comBody);
  }
  dirToWorld(d, out = new Vector3()) { return out.copy(d).applyQuaternion(this.quat); }
  dirToBody(d, out = new Vector3()) { _q.copy(this.quat).invert(); return out.copy(d).applyQuaternion(_q); }
  velocityAt(pWorld, out = new Vector3()) {
    _v2.subVectors(pWorld, this.pos);
    return out.crossVectors(this.omega, _v2).add(this.vel);
  }

  // ----- loads ---------------------------------------------------------------
  applyForce(F, pWorld = null) {
    this.force.add(F);
    if (pWorld) {
      _v.subVectors(pWorld, this.pos).cross(F);
      this.torque.add(_v);
    }
  }
  // Force given in body axes at a point given in body reference coords.
  applyBodyForce(Fb, pBody) {
    _v2.copy(Fb).applyQuaternion(this.quat);
    this.force.add(_v2);
    _v.subVectors(pBody, this.comBody).applyQuaternion(this.quat);
    this.torque.add(_v.cross(_v2));
  }
  applyTorque(t) { this.torque.add(t); }
  applyImpulse(J, pWorld) {
    this.vel.addScaledVector(J, this.invMass);
    _v.subVectors(pWorld, this.pos).cross(J);
    this.L.add(_v);
    this.omega.copy(this.L).applyMatrix3(this.invIWorld);
  }

  // Effective inverse mass along normal n at contact offset r (world).
  // n . [ (1/m) n + (I^-1 (r x n)) x r ]
  effInvMass(r, n) {
    _v.crossVectors(r, n).applyMatrix3(this.invIWorld);
    _v.cross(r);
    return this.invMass + n.dot(_v);
  }

  savePrev() {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  integrate(dt) {
    if (this.frozen) { this.force.set(0, 0, 0); this.torque.set(0, 0, 0); this.accel.set(0, 0, 0); return; }
    // linear
    this.lastAccel.copy(this.force).multiplyScalar(this.invMass).add(this.accel);
    this.vel.addScaledVector(this.lastAccel, dt);
    this.pos.addScaledVector(this.vel, dt);
    // angular: L is updated by the torque impulse, then the orientation is
    // advanced with a classical RK4 on q' = 1/2 w(q) q, where
    // w(q) = R(q) I^-1 R(q)^T L. RK4 keeps the rotational energy drift of a
    // fast, asymmetric spinner (the tumbling Meridian at 65 RPM) negligible.
    this.L.addScaledVector(this.torque, dt);
    if (this.L.lengthSq() > 1e-20) this._rk4Orientation(dt);
    this.updateDerived();
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
    this.accel.set(0, 0, 0);
  }

  // omega(q) for the current L, written into out.
  _omegaAt(q, out) {
    quatToMat3(q, _m);
    _mt.copy(_m).transpose();
    // w = R I^-1 R^T L
    return out.copy(this.L).applyMatrix3(_mt).applyMatrix3(this.invInertiaBody).applyMatrix3(_m);
  }

  _rk4Orientation(dt) {
    const q0 = this.quat;
    const k = _rk.k, qt = _rk.qt, w = _rk.w;
    // derivative of quaternion: 0.5 * (w,0) * q
    const deriv = (q, out) => {
      this._omegaAt(q, w);
      out[0] = 0.5 * (w.x * q.w + w.y * q.z - w.z * q.y);
      out[1] = 0.5 * (-w.x * q.z + w.y * q.w + w.z * q.x);
      out[2] = 0.5 * (w.x * q.y - w.y * q.x + w.z * q.w);
      out[3] = 0.5 * (-w.x * q.x - w.y * q.y - w.z * q.z);
    };
    const add = (q, d, h) => qt.set(q.x + d[0] * h, q.y + d[1] * h, q.z + d[2] * h, q.w + d[3] * h).normalize();
    deriv(q0, k[0]);
    deriv(add(q0, k[0], dt / 2), k[1]);
    deriv(add(q0, k[1], dt / 2), k[2]);
    deriv(add(q0, k[2], dt), k[3]);
    const s = dt / 6;
    q0.set(
      q0.x + s * (k[0][0] + 2 * k[1][0] + 2 * k[2][0] + k[3][0]),
      q0.y + s * (k[0][1] + 2 * k[1][1] + 2 * k[2][1] + k[3][1]),
      q0.z + s * (k[0][2] + 2 * k[1][2] + 2 * k[2][2] + k[3][2]),
      q0.w + s * (k[0][3] + 2 * k[1][3] + 2 * k[2][3] + k[3][3]),
    ).normalize();
  }

  // Rotational kinetic energy 1/2 w.L
  rotKE() { return 0.5 * this.omega.dot(this.L); }

  snapshot() {
    return {
      pos: this.pos.toArray(), vel: this.vel.toArray(), quat: this.quat.toArray(), L: this.L.toArray(),
      frozen: this.frozen,
    };
  }
  restore(s) {
    this.pos.fromArray(s.pos); this.vel.fromArray(s.vel); this.quat.fromArray(s.quat); this.L.fromArray(s.L);
    this.frozen = s.frozen;
    this.updateDerived();
    this.savePrev();
  }
}
