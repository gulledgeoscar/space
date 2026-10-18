// Flight aids shared by the planetary missions: ascent pitch-program cue,
// landing readouts and the Assisted-mode auto-land (a vertical-speed
// controller flying the real engine and RCS), plus surface-site creation
// at the predicted touchdown point.

import { Vector3 } from 'three';
import { stateToElements } from '../physics/orbital.js';
import { KESTREL } from '../ship/kestrel.js';
import { settings } from '../core/settings.js';

export function ascentCue(world, planet, targetAp, opts = {}) {
  const K = world.kestrel.body;
  const up = K.pos.clone().normalize();
  const east = new Vector3(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
  east.normalize();
  const alt = K.pos.length() - planet.radius;
  const vs = K.vel.clone().sub(world.surfaceVelocity(K.pos, new Vector3())).length();
  const el = stateToElements(K.pos, K.vel, planet.gm);
  const apAlt = el.ra - planet.radius;
  const turnAlt = opts.turnAlt ?? (planet.atmosphere ? planet.atmosphere.top * 0.6 : 30000);
  let e = vs < 50 ? 90 : 90 * (1 - Math.pow(Math.min(1, alt / turnAlt), 0.52));
  e = Math.max(e, apAlt < targetAp * 0.8 ? 9 : 0);
  if (apAlt > targetAp * 1.02) e = Math.min(e, -2);
  const r = (e * Math.PI) / 180;
  return { dir: east.multiplyScalar(Math.cos(r)).addScaledVector(up, Math.sin(r)).normalize(), e, apAlt, alt, el };
}

// Height above the local surface and surface-relative velocity
export function surfaceState(world, surface) {
  const K = world.kestrel.body;
  const up = K.pos.clone().normalize();
  const vrel = K.vel.clone().sub(world.surfaceVelocity(K.pos, new Vector3()));
  let agl = K.pos.length() - world.primary.radius;
  if (surface) { const l = surface.toLocal(K.pos); agl = l.y - surface.height(l.x, l.z); }
  const vs = vrel.dot(up);
  const vh = vrel.clone().addScaledVector(up, -vs);
  return { up, vrel, agl, vs, vh: vh.length(), vhVec: vh };
}

// Distance needed to stop with full main-engine thrust against gravity.
export function stopDistance(world, st) {
  const K = world.kestrel;
  const g = world.primary.surfaceG;
  const a = KESTREL.main.thrust / K.body.mass - g;
  if (a <= 0) return Infinity;
  const v = st.vrel.length();
  return (v * v) / (2 * a);
}

export class LandingAssist {
  constructor(game) { this.game = game; this.on = false; }
  toggle() {
    if (!settings.difficulty.helpers) { this.game.ui.toast('AUTO-LAND IS AN ASSISTED HELPER'); return; }
    this.on = !this.on;
    this.game.emit('assist', this.on ? 'AUTO-LAND' : 'AUTO-LAND OFF');
    this.game.ui.toast(this.on ? 'AUTO-LAND ENGAGED' : 'AUTO-LAND OFF');
    if (!this.on) { this.game.pilot.attMode = null; }
  }
  update(dt, surface) {
    if (!this.on) return;
    const g = this.game, W = g.world, K = W.kestrel;
    const st = surfaceState(W, surface);
    // attitude: against the surface velocity, upright when slow
    const retro = st.vrel.clone().normalize().negate();
    const w = Math.min(1, st.vrel.length() / 25);
    const dir = st.up.clone().multiplyScalar(1 - w).addScaledVector(retro, w).normalize();
    // keep the tail down: never point below the horizon
    if (dir.dot(st.up) < 0.25) dir.addScaledVector(st.up, 0.25 - dir.dot(st.up)).normalize();
    g.pilot.burnTarget = { dir };
    g.pilot.attMode = 'burn';
    // vertical speed target shrinks with height; null horizontal speed low down
    const vsT = -Math.max(1.6, Math.min(80, st.agl * 0.12));
    const gnd = W.primary.surfaceG;
    const aMax = KESTREL.main.thrust / K.body.mass;
    const cosT = Math.max(0.2, new Vector3(0, 0, -1).applyQuaternion(K.body.quat).dot(st.up));
    const need = (gnd + (vsT - st.vs) * 1.2) / (aMax * cosT);
    K.cmd.throttle = st.agl < 1.5 && Math.abs(st.vs) < 2.5 ? 0 : Math.max(0, Math.min(1, need));
    if (st.agl < 300 && !K.gearDown) { K.gearDown = true; g.ui.toast('GEAR DOWN'); }
    if (K.onGround && Math.abs(st.vs) < 0.5) { this.on = false; K.cmd.throttle = 0; g.pilot.attMode = null; g.ui.toast('AUTO-LAND COMPLETE'); }
  }
}

// Predicted touchdown direction (unit, inertial) from the current state.
export function predictedTouchdown(world) {
  const K = world.kestrel.body;
  const up = K.pos.clone().normalize();
  const vrel = K.vel.clone().sub(world.surfaceVelocity(K.pos, new Vector3()));
  const vs = vrel.dot(up);
  const vh = vrel.clone().addScaledVector(up, -vs);
  const alt = K.pos.length() - world.primary.radius;
  const t = vs < -1 ? alt / -vs : 30;
  return K.pos.clone().addScaledVector(vh, Math.min(t, 200) * 0.6).normalize();
}
