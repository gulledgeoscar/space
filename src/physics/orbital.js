// Orbital mechanics: Newtonian point-mass gravity, classical orbital elements,
// universal-variable Kepler propagation, LVLH frames and the
// Clohessy-Wiltshire (Hill) relative-motion solution.
//
// Planet-centred inertial frame convention: +Y is the planet's north pole,
// equatorial orbits lie in the XZ plane.

import { Vector3, Matrix3 } from 'three';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

// a = -mu r / |r|^3
export function gravityAccel(r, mu, out = new Vector3()) {
  const d2 = r.lengthSq();
  const d = Math.sqrt(d2);
  return out.copy(r).multiplyScalar(-mu / (d2 * d));
}

export function circularSpeed(mu, r) { return Math.sqrt(mu / r); }
export function escapeSpeed(mu, r) { return Math.sqrt((2 * mu) / r); }
export function orbitalPeriod(mu, a) { return 2 * Math.PI * Math.sqrt((a * a * a) / mu); }
export function meanMotion(mu, a) { return Math.sqrt(mu / (a * a * a)); }

// Classical elements from state vectors.
export function stateToElements(r, v, mu) {
  const rmag = r.length();
  const vmag2 = v.lengthSq();
  const h = new Vector3().crossVectors(r, v);
  const hmag = h.length();
  const energy = vmag2 / 2 - mu / rmag;
  const a = Math.abs(energy) > 1e-12 ? -mu / (2 * energy) : Infinity;
  // eccentricity vector e = (v x h)/mu - r/|r|
  const evec = new Vector3().crossVectors(v, h).multiplyScalar(1 / mu).addScaledVector(r, -1 / rmag);
  const e = evec.length();
  // pole is +Y; node vector n = Y x h
  const n = new Vector3(0, 1, 0).cross(h);
  const nmag = n.length();
  const inc = Math.acos(Math.min(1, Math.max(-1, h.y / hmag)));
  let raan = 0;
  if (nmag > 1e-9) { raan = Math.atan2(n.z, n.x); }
  let argp = 0;
  if (nmag > 1e-9 && e > 1e-9) {
    argp = Math.acos(Math.min(1, Math.max(-1, n.dot(evec) / (nmag * e))));
    if (evec.y < 0) argp = 2 * Math.PI - argp;
  }
  let nu = 0;
  if (e > 1e-9) {
    nu = Math.acos(Math.min(1, Math.max(-1, evec.dot(r) / (e * rmag))));
    if (r.dot(v) < 0) nu = 2 * Math.PI - nu;
  }
  const p = (hmag * hmag) / mu;
  const rp = p / (1 + e);
  const ra = e < 1 ? p / (1 - e) : Infinity;
  const period = e < 1 ? orbitalPeriod(mu, a) : Infinity;
  // time to periapsis / apoapsis (elliptic only)
  let tPe = NaN, tAp = NaN;
  if (e < 1 && e > 1e-6) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    let M = E - e * Math.sin(E);
    if (M < 0) M += 2 * Math.PI;
    const nmot = meanMotion(mu, a);
    tPe = (2 * Math.PI - M) / nmot;
    tAp = ((Math.PI - M + 2 * Math.PI) % (2 * Math.PI)) / nmot;
  }
  return { a, e, inc, raan, argp, nu, h, hmag, evec, energy, p, rp, ra, period, tPe, tAp, rmag };
}

// Stumpff functions
function stumpC(z) {
  if (z > 1e-6) return (1 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1) / -z;
  return 1 / 2 - z / 24 + (z * z) / 720;
}
function stumpS(z) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120 + (z * z) / 5040;
}

// Universal-variable Kepler propagation (Curtis, Alg. 3.4). Works for any
// conic. Writes into rOut, vOut.
export function propagateKepler(r0, v0, mu, dt, rOut, vOut) {
  const sqmu = Math.sqrt(mu);
  const r0m = r0.length();
  const vr0 = r0.dot(v0) / r0m;
  const alpha = 2 / r0m - v0.lengthSq() / mu;
  let x = sqmu * Math.abs(alpha) * dt;
  if (!isFinite(x) || x === 0) x = 1e-3;
  for (let i = 0; i < 60; i++) {
    const z = alpha * x * x;
    const C = stumpC(z), S = stumpS(z);
    const F = ((r0m * vr0) / sqmu) * x * x * C + (1 - alpha * r0m) * x * x * x * S + r0m * x - sqmu * dt;
    const dF = ((r0m * vr0) / sqmu) * x * (1 - alpha * x * x * S) + (1 - alpha * r0m) * x * x * C + r0m;
    const dx = F / dF;
    x -= dx;
    if (Math.abs(dx) < 1e-9) break;
  }
  const z = alpha * x * x;
  const C = stumpC(z), S = stumpS(z);
  const f = 1 - ((x * x) / r0m) * C;
  const g = dt - (1 / sqmu) * x * x * x * S;
  _a.copy(r0).multiplyScalar(f).addScaledVector(v0, g);
  const rm = _a.length();
  const fdot = (sqmu / (rm * r0m)) * (alpha * x * x * x * S - x);
  const gdot = 1 - ((x * x) / rm) * C;
  _b.copy(r0).multiplyScalar(fdot).addScaledVector(v0, gdot);
  rOut.copy(_a);
  vOut.copy(_b);
}

// Sample an orbit as a polyline (planet-centred). Uses true anomaly for
// ellipses; for escape trajectories samples time.
export function orbitPolyline(r, v, mu, n = 256, maxR = Infinity) {
  const el = stateToElements(r, v, mu);
  const pts = [];
  if (el.e < 0.999) {
    const P = el.period;
    const rr = new Vector3(), vv = new Vector3();
    for (let i = 0; i <= n; i++) {
      propagateKepler(r, v, mu, (P * i) / n, rr, vv);
      pts.push(rr.clone());
    }
  } else {
    const rr = new Vector3(), vv = new Vector3();
    const span = 4 * r.length() / Math.max(1, v.length());
    for (let i = 0; i <= n; i++) {
      propagateKepler(r, v, mu, (span * i) / n, rr, vv);
      if (rr.length() > maxR) break;
      pts.push(rr.clone());
    }
  }
  return { pts, el };
}

// Closest approach between two Keplerian trajectories within horizon.
export function closestApproach(r1, v1, r2, v2, mu, horizon, samples = 240) {
  const a = new Vector3(), av = new Vector3(), b = new Vector3(), bv = new Vector3();
  let bestT = 0, bestD = r1.distanceTo(r2);
  const dist = (t) => {
    propagateKepler(r1, v1, mu, t, a, av);
    propagateKepler(r2, v2, mu, t, b, bv);
    return a.distanceTo(b);
  };
  for (let i = 1; i <= samples; i++) {
    const t = (horizon * i) / samples;
    const d = dist(t);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  // golden-section refine
  let lo = Math.max(0, bestT - horizon / samples), hi = Math.min(horizon, bestT + horizon / samples);
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 40; k++) {
    const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo);
    if (dist(c) < dist(d)) hi = d; else lo = c;
  }
  bestT = (lo + hi) / 2;
  bestD = dist(bestT);
  const p1 = new Vector3(), p2 = new Vector3();
  propagateKepler(r1, v1, mu, bestT, p1, av);
  propagateKepler(r2, v2, mu, bestT, p2, bv);
  return { t: bestT, d: bestD, p1, p2, relSpeed: av.distanceTo(bv) };
}

// Hohmann transfer between circular radii.
export function hohmann(mu, r1, r2) {
  const at = (r1 + r2) / 2;
  const v1 = Math.sqrt(mu / r1), v2 = Math.sqrt(mu / r2);
  const vp = Math.sqrt(mu * (2 / r1 - 1 / at));
  const va = Math.sqrt(mu * (2 / r2 - 1 / at));
  return { dv1: vp - v1, dv2: v2 - va, tof: Math.PI * Math.sqrt((at * at * at) / mu) };
}

// Phase angle the target must lead the chaser by at the first Hohmann burn.
export function hohmannLeadAngle(mu, r1, r2) {
  const tof = hohmann(mu, r1, r2).tof;
  const n2 = meanMotion(mu, r2);
  return Math.PI - n2 * tof;
}

// Signed angle (radians) from chaser to target measured in the orbit plane,
// positive when the target is ahead.
export function phaseAngle(rc, vc, rt) {
  const h = _c.crossVectors(rc, vc).normalize();
  const a = _a.copy(rc).projectOnPlane(h).normalize();
  const b = _b.copy(rt).projectOnPlane(h).normalize();
  const ang = Math.atan2(_a.clone().cross(b).dot(h), a.dot(b));
  return ang;
}

// ---------------------------------------------------------------------------
// LVLH (Hill) frame of the target: x = radial (R-bar, away from planet),
// y = along-track (V-bar), z = orbit normal (H-bar).
// ---------------------------------------------------------------------------
export function lvlhBasis(rT, vT) {
  const x = rT.clone().normalize();
  const z = new Vector3().crossVectors(rT, vT).normalize();
  const y = new Vector3().crossVectors(z, x);
  // rows = basis vectors; M * worldVec = lvlhVec
  const M = new Matrix3().set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
  const omega = new Vector3().crossVectors(rT, vT).multiplyScalar(1 / rT.lengthSq()); // world
  return { x, y, z, M, omega };
}

// Relative state of chaser w.r.t. target expressed in the rotating LVLH frame.
export function relativeLvlh(rC, vC, rT, vT, basis = lvlhBasis(rT, vT)) {
  const dr = new Vector3().subVectors(rC, rT);
  const dv = new Vector3().subVectors(vC, vT);
  // velocity seen in the rotating frame: dv - omega x dr
  dv.sub(new Vector3().crossVectors(basis.omega, dr));
  return { r: dr.applyMatrix3(basis.M), v: dv.applyMatrix3(basis.M), basis };
}

// Inverse of relativeLvlh (for a point at LVLH position rho, zero rel. velocity
// is not assumed): returns world position offset from target.
export function lvlhToWorldOffset(rho, basis, out = new Vector3()) {
  return out.set(0, 0, 0)
    .addScaledVector(basis.x, rho.x)
    .addScaledVector(basis.y, rho.y)
    .addScaledVector(basis.z, rho.z);
}

// Clohessy-Wiltshire closed-form propagation for a circular target orbit with
// mean motion n. Writes position (and optionally velocity) after time t.
export function cwPropagate(r0, v0, n, t, rOut, vOut = null) {
  const nt = n * t;
  const s = Math.sin(nt), c = Math.cos(nt);
  const x0 = r0.x, y0 = r0.y, z0 = r0.z;
  const xd = v0.x, yd = v0.y, zd = v0.z;
  rOut.set(
    (4 - 3 * c) * x0 + (s / n) * xd + (2 / n) * (1 - c) * yd,
    6 * (s - nt) * x0 + y0 - (2 / n) * (1 - c) * xd + (1 / n) * (4 * s - 3 * nt) * yd,
    z0 * c + (zd / n) * s,
  );
  if (vOut) {
    vOut.set(
      3 * n * s * x0 + c * xd + 2 * s * yd,
      6 * n * (c - 1) * x0 - 2 * s * xd + (4 * c - 3) * yd,
      -z0 * n * s + zd * c,
    );
  }
  return rOut;
}

// CW two-impulse targeting: the relative velocity needed now to be at rf
// after time T (coasting). Returns null for singular geometry.
export function cwTargetVelocity(r0, rf, n, T) {
  const nt = n * T;
  const s = Math.sin(nt), c = Math.cos(nt);
  // Phi_rr * r0
  const prr = new Vector3(
    (4 - 3 * c) * r0.x,
    6 * (s - nt) * r0.x + r0.y,
    c * r0.z,
  );
  // Phi_rv (3x3, z decoupled)
  const a11 = s / n, a12 = (2 / n) * (1 - c);
  const a21 = -(2 / n) * (1 - c), a22 = (1 / n) * (4 * s - 3 * nt);
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-9 || Math.abs(s) < 1e-9) return null;
  const bx = rf.x - prr.x, by = rf.y - prr.y, bz = rf.z - prr.z;
  return new Vector3(
    (a22 * bx - a12 * by) / det,
    (-a21 * bx + a11 * by) / det,
    (bz * n) / s,
  );
}
