// Physical constants and the game's tuned-but-real design numbers.
// Everything is SI: metres, kilograms, seconds, newtons, radians.

export const G = 6.6743e-11;          // gravitational constant [m^3 kg^-1 s^-2]
export const C = 299792458;           // speed of light [m/s]
export const G0 = 9.80665;            // standard gravity [m/s^2]
export const SIGMA = 5.670374e-8;     // Stefan-Boltzmann [W m^-2 K^-4]
export const SOLAR_MASS = 1.98847e30; // [kg]

export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

// ---------------------------------------------------------------------------
// The Meridian: a 12-module ring around a central hub, spinning about its
// body +Z axis. Ring floor radius and spin rate are chosen so that the
// centripetal acceleration a = w^2 r at the floor is exactly 1 g.
// ---------------------------------------------------------------------------
export const RING_FLOOR_R = 40.0;                         // [m] floor (outer) radius
export const RING_CEIL_R = 36.4;                          // [m] ceiling radius (3.6 m room height)
export const RING_MODULES = 12;
export const RING_OMEGA = Math.sqrt(G0 / RING_FLOOR_R);   // [rad/s] = 0.4952 rad/s (4.73 RPM)
export const MODULE_ARC = (2 * Math.PI * RING_FLOOR_R) / RING_MODULES; // [m] floor length per module
export const HUB_R = 3.6;                                 // [m] hub interior radius
export const HUB_Z0 = -5.0;                               // hub interior extends z in [HUB_Z0, HUB_Z1]
export const HUB_Z1 = 5.0;
export const PORT_Z = 5.25;                               // docking port face (station body frame)
export const PORT_RING_R = 0.75;                          // soft-capture ring radius [m]
export const SPOKE_R = 1.1;                               // spoke tube radius [m]
export const SPOKE_MODULE = 5;                            // the airlock module carries spoke A

// Kestrel docking-frame geometry (Kestrel body frame, forward = -Z).
export const KESTREL_DOCK_Z = -7.05;                      // nose docking ring plane
// When hard-docked the Kestrel's body origin sits here in the station frame.
export const KESTREL_DOCKED_Z = PORT_Z - KESTREL_DOCK_Z - 0.05;

export const rpm = (w) => (w * 60) / (2 * Math.PI);
export const fromRpm = (r) => (r * 2 * Math.PI) / 60;
