// Atmospheric flight: exponential density model, quadratic drag,
// dynamic pressure, Sutton-Graves stagnation heating and a lumped hull
// thermal model with radiative cooling.

import { SIGMA } from './constants.js';

export class Atmosphere {
  constructor({ rho0, scaleHeight, top, soundSpeed = 320, temp0 = 288 }) {
    this.rho0 = rho0;            // sea-level density [kg/m^3]
    this.H = scaleHeight;        // scale height [m]
    this.top = top;              // altitude above which density is treated as 0 [m]
    this.soundSpeed = soundSpeed;
    this.temp0 = temp0;
  }
  density(alt) {
    if (alt >= this.top) return 0;
    return this.rho0 * Math.exp(-Math.max(alt, 0) / this.H);
  }
}

export function dynamicPressure(rho, speed) { return 0.5 * rho * speed * speed; }

// Drag force magnitude: F = 1/2 rho v^2 Cd A
export function dragForce(rho, speed, cdA) { return 0.5 * rho * speed * speed * cdA; }

// Sutton-Graves convective heat flux at the stagnation point [W/m^2].
// k = 1.7415e-4 for Earth-like air, rn = nose radius [m].
export function suttonGraves(rho, speed, noseRadius, k = 1.7415e-4) {
  return k * Math.sqrt(rho / noseRadius) * speed * speed * speed;
}

// Lumped-capacitance hull: m c dT/dt = q A_hot - eps sigma A_rad (T^4 - Tenv^4)
export class HullThermal {
  constructor({ heatCapacity = 9.0e6, hotArea = 6, radArea = 60, emissivity = 0.85, T = 280 }) {
    this.C = heatCapacity; // [J/K] (m * c of the heat shield layer)
    this.hotArea = hotArea;
    this.radArea = radArea;
    this.eps = emissivity;
    this.T = T;
    this.flux = 0;
  }
  step(dt, flux, Tenv = 4) {
    this.flux = flux;
    const qin = flux * this.hotArea;
    const qout = this.eps * SIGMA * this.radArea * (this.T ** 4 - Tenv ** 4);
    this.T += ((qin - qout) / this.C) * dt;
    if (this.T < Tenv) this.T = Tenv;
  }
}

// Approximate blackbody colour (for the reentry glow) as linear RGB, 0..1.
export function blackbodyColor(T) {
  const t = T / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.1 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5 * Math.log(t - 10) - 305.04;
  const c = (x) => Math.min(1, Math.max(0, x / 255)) ** 2.2;
  return [c(r), c(g), c(b)];
}
