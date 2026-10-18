// Planetary bodies. Gravity, radius, rotation, atmosphere and escape
// velocity are all physically consistent: GM = g R^2.

import { G0, G } from './constants.js';
import { Atmosphere } from './atmosphere.js';
import { ORBITS, LETHE_GM, LETHE_M_GEOM } from './timeDilation.js';

function planet(def) {
  const gm = def.gm ?? def.surfaceG * def.radius * def.radius;
  const p = {
    ...def,
    gm,
    mass: gm / G,
    surfaceG: gm / (def.radius * def.radius),
    escapeVelocity: Math.sqrt((2 * gm) / def.radius),
    lowOrbitSpeed: Math.sqrt(gm / (def.radius + (def.atmosphere?.top ?? 0) + 20000)),
  };
  return p;
}

export const EARTH = planet({
  id: 'earth',
  name: 'Earth',
  system: 'sol',
  gm: 3.986004418e14,
  radius: 6.371e6,
  rotationRate: 7.2921159e-5,               // rad/s about +Y
  atmosphere: new Atmosphere({ rho0: 1.225, scaleHeight: 8500, top: 120000, soundSpeed: 320 }),
  dilation: ORBITS.earth.factor,
  colors: { ocean: [0.01, 0.04, 0.12], land: [0.12, 0.15, 0.07], ice: [0.9, 0.93, 0.97], atmo: [0.35, 0.6, 1.0] },
  kind: 'earth',
});

// Pelagia: the ocean world on a near-ISCO orbit of Lethe. 1.3 g surface.
export const PELAGIA = planet({
  id: 'pelagia',
  name: 'Pelagia',
  system: 'lethe',
  surfaceG: 1.3 * G0,
  radius: 2.8e6,
  rotationRate: 0,                           // tidally locked (rocks, does not spin)
  atmosphere: new Atmosphere({ rho0: 1.35, scaleHeight: 8800, top: 95000, soundSpeed: 330 }),
  dilation: ORBITS.pelagia.factor,
  orbitRadiusM: ORBITS.pelagia.r,            // around Lethe, in units of M
  colors: { ocean: [0.06, 0.16, 0.2], land: [0.1, 0.14, 0.16], ice: [0.6, 0.7, 0.75], atmo: [0.7, 0.75, 0.8] },
  kind: 'ocean',
});

// Skadi: frozen world further out, where the Meridian parks (dilation ~4%).
export const SKADI = planet({
  id: 'skadi',
  name: 'Skadi',
  system: 'lethe',
  surfaceG: 0.85 * G0,
  radius: 3.6e6,
  rotationRate: 0,
  atmosphere: new Atmosphere({ rho0: 0.42, scaleHeight: 7200, top: 80000, soundSpeed: 290, temp0: 205 }),
  dilation: ORBITS.skadi.factor,
  orbitRadiusM: ORBITS.skadi.r,
  colors: { ocean: [0.55, 0.62, 0.68], land: [0.75, 0.8, 0.85], ice: [0.93, 0.96, 1.0], atmo: [0.75, 0.82, 0.95] },
  kind: 'ice',
});

export const PLANETS = { earth: EARTH, pelagia: PELAGIA, skadi: SKADI };

// Tidal physics for Pelagia's mega-waves. The planet is tidally locked but
// librates (rocks) by a small angle delta; its permanent tidal bulge then
// sweeps across the shallow ocean as a travelling surge.
export function pelagiaTides() {
  const d = PELAGIA.orbitRadiusM * LETHE_M_GEOM;           // distance to Lethe [m]
  const R = PELAGIA.radius;
  const massRatio = LETHE_GM / PELAGIA.gm;
  const tidalAccel = (2 * LETHE_GM * R) / (d * d * d);      // differential accel at surface
  const bulge = massRatio * Math.pow(R / d, 3) * R;         // equilibrium tidal bulge height
  const roche = R * Math.cbrt(2 * massRatio);               // fluid-ish Roche limit
  const libration = 0.0237;                                 // rad (~1.36 deg)
  const waveHeight = 2 * bulge * libration;                 // sweep amplitude
  return { d, tidalAccel, bulge, roche, libration, waveHeight, hill: d * Math.cbrt(PELAGIA.gm / (3 * LETHE_GM)) };
}
