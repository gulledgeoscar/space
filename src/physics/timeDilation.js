// Relativistic clocks.
//
// For a static observer in Schwarzschild spacetime:
//   d(tau)/dt = sqrt(1 - r_s / r),  r_s = 2GM/c^2
//
// For a prograde circular equatorial orbit in the Kerr metric
// (Bardeen, Press & Teukolsky 1972; geometric units G = c = M = 1):
//   dt/d(tau) = (r^{3/2} + a) / ( r^{3/4} sqrt(r^{3/2} - 3 r^{1/2} + 2a) )
//
// Lethe is a near-extremal Kerr hole (a = 1 - 1e-14). An orbit hugging the
// ISCO can reach dt/dtau ~ 61,000, i.e. 1 hour on the planet is ~7 years far
// away. The radius is solved numerically rather than hand-picked.

import { G, C, SOLAR_MASS } from './constants.js';

export const LETHE_MASS = 1.0e9 * SOLAR_MASS;            // [kg]
export const LETHE_GM = G * LETHE_MASS;                  // [m^3/s^2]
export const LETHE_M_GEOM = LETHE_GM / (C * C);          // GM/c^2 [m] (~1.48e12 m)
export const LETHE_SPIN = 1 - 1e-14;                     // dimensionless a/M

export const HOUR_TO_YEARS_TARGET = 7;                   // design target: 1 h -> 7 yr
export const TARGET_FACTOR = (HOUR_TO_YEARS_TARGET * 365.25 * 24); // 61362

export function schwarzschildFactor(r, gm) {
  const rs = (2 * gm) / (C * C);
  return Math.sqrt(Math.max(0, 1 - rs / r)); // dtau/dt
}

// Kerr ISCO radius (prograde), units of M.
export function kerrIsco(a) {
  const z1 = 1 + Math.cbrt(1 - a * a) * (Math.cbrt(1 + a) + Math.cbrt(1 - a));
  const z2 = Math.sqrt(3 * a * a + z1 * z1);
  return 3 + z2 - Math.sqrt((3 - z1) * (3 + z1 + 2 * z2));
}

// dt/dtau for a prograde circular equatorial Kerr orbit (r, a in units of M).
export function kerrOrbitDtDtau(r, a) {
  const r12 = Math.sqrt(r);
  const r32 = r * r12;
  const inner = r32 - 3 * r12 + 2 * a;
  if (inner <= 0) return Infinity;
  return (r32 + a) / (Math.pow(r, 0.75) * Math.sqrt(inner));
}

// Solve for the orbital radius (units of M) giving a desired dt/dtau.
// The factor decreases monotonically with r above the ISCO.
export function solveRadiusForFactor(target, a = LETHE_SPIN) {
  const isco = kerrIsco(a);
  let lo = isco * (1 + 1e-15), hi = 50;
  if (kerrOrbitDtDtau(lo, a) < target) return { r: lo, factor: kerrOrbitDtDtau(lo, a), isco };
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (kerrOrbitDtDtau(mid, a) > target) lo = mid; else hi = mid;
  }
  const r = 0.5 * (lo + hi);
  return { r, factor: kerrOrbitDtDtau(r, a), isco };
}

// Weak-field correction for standing on a planet's surface (tiny).
export function surfaceFactor(gm, radius) {
  return 1 / schwarzschildFactor(radius, gm); // dt_far / dtau
}

const PELAGIA_ORBIT = solveRadiusForFactor(TARGET_FACTOR);
export const ORBITS = {
  // r in units of M, factor = dt_far / dtau
  pelagia: { r: PELAGIA_ORBIT.r, factor: PELAGIA_ORBIT.factor, isco: PELAGIA_ORBIT.isco },
  skadi: { r: 40, factor: kerrOrbitDtDtau(40, LETHE_SPIN) },
  earth: { r: Infinity, factor: 1 },
};

// Two clocks: proper time of the player ("ship time") and far-away
// coordinate time ("Earth time").
export class DilationClock {
  constructor() { this.ship = 0; this.earth = 0; this.factor = 1; }
  advance(dtProper, factor = this.factor) {
    this.factor = factor;
    this.ship += dtProper;
    this.earth += dtProper * factor;
  }
  snapshot() { return { ship: this.ship, earth: this.earth, factor: this.factor }; }
  restore(s) { Object.assign(this, s); }
}

export function formatDuration(sec) {
  const sign = sec < 0 ? '-' : '';
  sec = Math.abs(sec);
  const y = Math.floor(sec / (365.25 * 86400));
  sec -= y * 365.25 * 86400;
  const d = Math.floor(sec / 86400);
  sec -= d * 86400;
  const h = Math.floor(sec / 3600);
  sec -= h * 3600;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (y > 0) return `${sign}${y}y ${d}d ${hms}`;
  if (d > 0) return `${sign}${d}d ${hms}`;
  return sign + hms;
}
