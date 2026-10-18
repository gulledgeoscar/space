// Rocket propulsion: the Tsiolkovsky rocket equation and mass flow.
//   dv = Isp g0 ln(m0 / mf)
//   mdot = F / (Isp g0)

import { G0 } from './constants.js';

export const exhaustVelocity = (isp) => isp * G0;
export const deltaV = (isp, m0, mf) => (mf > 0 && m0 > mf ? isp * G0 * Math.log(m0 / mf) : 0);
export const massFlow = (thrust, isp) => thrust / (isp * G0);
// Propellant needed for a given dv starting from mass m0.
export const propellantFor = (dv, isp, m0) => m0 * (1 - Math.exp(-dv / (isp * G0)));
