// Rendezvous computer: closed-loop burn advice from the current state.
//   circularise  -> raise periapsis at apoapsis
//   phasing      -> wait in a lower (faster) orbit until the Hohmann lead
//                   angle comes round, then burn prograde
//   transfer     -> circularise at the Meridian's altitude
//   terminal     -> Clohessy-Wiltshire two-impulse targeting of a point on
//                   the docking axis 250 m out
// It only *advises* (cue on the HUD, node on the map); Assisted pilots can
// hold attitude on the cue with 0. The burns are flown with real engines.

import { Vector3 } from 'three';
import {
  stateToElements, hohmann, hohmannLeadAngle, phaseAngle, meanMotion, propagateKepler,
  lvlhBasis, relativeLvlh, cwTargetVelocity, lvlhToWorldOffset,
} from '../physics/orbital.js';
import { formatDuration } from '../physics/timeDilation.js';
import { KESTREL } from '../ship/kestrel.js';

export class RendezvousGuide {
  constructor(game, { targetAltitude = null } = {}) {
    this.game = game;
    this.advice = null;
    this.timer = 0;
    this.targetAlt = targetAltitude;
    this.phase = 'idle';
  }

  burnTime(dv) {
    const K = this.game.world.kestrel;
    const useMain = dv > 6;
    const a = useMain ? KESTREL.main.thrust / K.body.mass : (K.rcsThrust() * 4) / K.body.mass;
    return { t: dv / a, useMain };
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0 && this.advice) { this.publish(); return this.advice; }
    this.timer = 0.25;
    const W = this.game.world, K = W.kestrel.body, S = W.meridian.body;
    const mu = W.primary.gm, R = W.primary.radius;
    const el = stateToElements(K.pos, K.vel, mu);
    const rT = S.pos.length();
    const range = K.pos.distanceTo(S.pos);
    const atmTop = (W.primary.atmosphere?.top || 0) + 20000;
    let a = null;
    if (range < 25000) {
      a = this.terminal(range);
    } else if (el.rp < R + atmTop || (el.e > 0.004 && Math.abs(el.ra - rT) > 15000)) {
      // raise periapsis at apoapsis (or circularise a transfer orbit)
      const vAp = Math.sqrt(mu * (2 / el.ra - 1 / el.a));
      const dv = Math.sqrt(mu / el.ra) - vAp;
      a = this.atApsis('CIRCULARISE AT APOAPSIS', dv, el.tAp, el);
      this.phase = 'circularise';
    } else if (el.e > 0.004) {
      // on the transfer orbit: circularise at the Meridian's altitude
      const vAp = Math.sqrt(mu * (2 / el.ra - 1 / el.a));
      const dv = Math.sqrt(mu / el.ra) - vAp;
      a = this.atApsis('TRANSFER: CIRCULARISE', dv, el.tAp, el);
      this.phase = 'transfer';
    } else {
      // circular, below the target: Hohmann phasing
      const r1 = K.pos.length();
      const h = hohmann(mu, r1, rT);
      const lead = hohmannLeadAngle(mu, r1, rT);
      let phi = phaseAngle(K.pos, K.vel, S.pos);
      const dn = meanMotion(mu, r1) - meanMotion(mu, rT);
      let wait = (phi - lead) / dn;
      const synodic = (2 * Math.PI) / Math.abs(dn);
      while (wait < 0) wait += synodic;
      const node = new Vector3(), nv = new Vector3();
      propagateKepler(K.pos, K.vel, mu, wait, node, nv);
      const dir = K.vel.clone().normalize();
      a = { phase: 'phasing', label: 'HOHMANN TRANSFER BURN', dv: h.dv1, t: wait, dir, nodePos: node, prograde: true, info: `lead ${(lead * 57.3).toFixed(1)}° · phase ${(phi * 57.3).toFixed(1)}°` };
      this.phase = 'phasing';
    }
    this.advice = a;
    this.publish();
    return a;
  }

  atApsis(label, dv, tAp, el) {
    const K = this.game.world.kestrel.body;
    const node = new Vector3(), nv = new Vector3();
    propagateKepler(K.pos, K.vel, this.game.world.primary.gm, tAp, node, nv);
    const { t: bt } = this.burnTime(Math.abs(dv));
    // when the burn window is open, steer prograde now
    return { phase: 'apsis', label, dv: Math.abs(dv), t: tAp - bt / 2, dir: K.vel.clone().normalize().multiplyScalar(Math.sign(dv) || 1), nodePos: node, prograde: dv > 0 };
  }

  // CW targeting of the approach-corridor entry point (250 m out on the axis)
  terminal(range) {
    const W = this.game.world, K = W.kestrel.body, S = W.meridian.body;
    const mu = W.primary.gm;
    const basis = lvlhBasis(S.pos, S.vel);
    const rel = relativeLvlh(K.pos, K.vel, S.pos, S.vel, basis);
    const n = meanMotion(mu, S.pos.length());
    const axis = W.meridian.axisWorld(new Vector3());
    const portW = W.meridian.portWorld(new Vector3());
    const goalW = portW.addScaledVector(axis, 250).sub(S.pos);
    const goal = goalW.applyMatrix3(basis.M);
    const T = Math.max(150, Math.min(1500, range / 6));
    const vReq = cwTargetVelocity(rel.r, goal, n, T);
    this.phase = 'terminal';
    if (!vReq) return null;
    const dvL = vReq.clone().sub(rel.v);
    const dvW = lvlhToWorldOffset(dvL, basis, new Vector3());
    const dv = dvW.length();
    return { phase: 'terminal', label: range > 2500 ? 'TERMINAL INTERCEPT' : 'APPROACH TARGETING', dv, t: 0, dir: dvW.normalize(), info: `arrive 250 m on axis in ${formatDuration(T)}`, terminal: true };
  }

  publish() {
    const g = this.game, a = this.advice;
    const hud = g.ui.hud;
    if (!a || this.muted) { hud.setCue('burn', null); g.mapNode = null; g.pilot.burnTarget = null; return; }
    const now = a.t <= 1 || a.terminal;
    const show = a.dv > (a.terminal ? 0.25 : 0.8);
    if (show) {
      hud.setCue('burn', { dir: a.dir, icon: 'burn', cls: now ? 'green' : 'amber', label: `${a.label} ${a.dv.toFixed(1)} m/s ${now ? '· BURN NOW' : 'T-' + formatDuration(a.t)}`, clamp: true });
      g.pilot.burnTarget = { dir: a.dir.clone() };
    } else { hud.setCue('burn', null); g.pilot.burnTarget = null; }
    g.mapNode = a.nodePos ? { pos: a.nodePos, label: `${a.label} ${a.dv.toFixed(1)} m/s · T-${formatDuration(a.t)}` } : null;
  }

  clear() { this.muted = true; this.publish(); }
}
