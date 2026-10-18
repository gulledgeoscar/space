// Docking director: the shared choreography of every docking. Phase and
// range callouts from CASE-9, warnings with real numbers, contact / capture /
// latch / hard-dock audio + banners, bounce and damage handling, alarms,
// music swell and the catastrophic-impact checkpoint retry.

import { rpm } from '../physics/constants.js';
import { settings } from '../core/settings.js';

const RANGE_CALLS = [
  [2000, 'Two kilometres. The Meridian\'s port beacon is on your HUD.'],
  [1000, 'One kilometre. From here on, every push you make bends your orbit as well as your path.'],
  [500, 'Five hundred metres. Far approach. Keep the closing rate under two metres per second.'],
  [250, 'Two hundred fifty.'],
  [100, 'One hundred metres. Close approach. Closing rate under one, please.'],
  [50, 'Fifty metres. The port is turning at {rpm} RPM. Match it before you touch it.'],
  [30, 'Thirty.'],
  [20, 'Twenty metres.'],
  [10, 'Ten metres. Final approach. Under a tenth of a metre per second. The latches are older than they look.'],
  [5, 'Five.'],
  [3, 'Three.'],
  [2, 'Two.'],
  [1, 'One metre.'],
];

const f2 = (x) => x.toFixed(2);

export class DockingDirector {
  constructor(mission, opts = {}) {
    this.m = mission;
    this.g = mission.game;
    this.opts = { callouts: true, music: true, spinCalls: false, ...opts };
    this.done = new Set();
    this.lastRange = Infinity;
    this.active = true;
    this.capturedAt = null;
    this.mergeShown = false;
    this.bounces = 0;
    this.maxImpact = 0;
    this.captureRel = null;
    const g = this.g;
    mission.on('dock:softCapture', (e) => this.onSoftCapture(e));
    mission.on('dock:latch', (e) => { g.audio?.latch(e.i); if (e.i === 1) this.m.say('case', 'Latches engaging.', { key: 'latches', cooldown: 20 }); });
    mission.on('dock:hardDock', (e) => this.onHardDock(e));
    mission.on('dock:pressurised', () => { this.m.say('case', 'Pressure equal. The hatch is yours.'); g.audio?.blip('good'); this.opts.onPressurised?.(); });
    mission.on('dock:bounce', (e) => this.onBounce(e));
    mission.on('dock:impact', (e) => this.onImpact(e));
    mission.on('dock:releaseStart', () => { this.m.say('case', 'Releasing latches.'); g.audio?.hiss(1.5, 0.12); });
    mission.on('dock:unlatch', (e) => g.audio?.latch(e.i));
    mission.on('dock:separated', () => {
      g.audio?.clunk(0.6, 0.8);
      this.m.say('case', 'Separation confirmed. The springs gave us seven centimetres a second. Everything else is up to you.');
      this.done.clear(); this.lastRange = 0;
      this.opts.onSeparated?.();
    });
    mission.on('kestrel:damage', (e) => this.onDamage(e));
  }

  rel() { return this.g.world.docking.rel; }

  update(dt) {
    if (!this.active) return;
    const W = this.g.world, D = W.docking;
    if (!W.meridianActive || !W.kestrelActive) return;
    const r = D.rel;
    const tol = settings.difficulty;
    if (!Number.isFinite(this.lastRange)) { this.lastRange = r.range; return; }
    // range callouts (crossing downward)
    if (D.state === 'free' && this.opts.callouts) {
      for (const [R, text] of RANGE_CALLS) {
        if (this.lastRange > R && r.range <= R && !this.done.has(R)) {
          this.done.add(R);
          let t = text.replace('{rpm}', rpm(Math.abs(r.spin)).toFixed(1));
          if (this.opts.spinCalls && R <= 100) t = `${Math.round(R)} metres. ${rpm(Math.abs(r.spin)).toFixed(1)} RPM. ${R > 10 ? 'Roll match ' + (r.spinMatch * 100).toFixed(0) + ' percent.' : ''}`;
          this.m.say('case', t, { key: 'range', cooldown: 1.5 });
        }
      }
      this.warnings(r, tol);
    }
    this.lastRange = r.range;
    // music swell with proximity
    if (this.opts.music && this.g.audio?.organ) {
      const o = this.g.audio.organ;
      if (D.state === 'free' && r.range < 400) {
        if (o.theme !== (this.opts.theme || 'tension') || !o.playing) o.play(this.opts.theme || 'tension', 0.3);
        o.setIntensity(this.opts.baseIntensity ?? (0.25 + 0.6 * (1 - Math.min(1, r.range / 300))));
      }
    }
    // alarm conditions
    const klaxon = D.state === 'free' && r.range < 15 && r.pos.z > 0 && (r.closing > tol.closing * 2.5 || (r.range < 4 && r.lateral > 0.6));
    this.g.alarm = klaxon || this.g.alarm;
  }

  warnings(r, tol) {
    const say = (key, text, cd = 9) => this.m.say('case', text, { key, cooldown: cd });
    if (r.range < 12 && r.pos.z > 0 && r.closing > tol.closing * 2) say('fast', `Too fast. You're closing at ${f2(r.closing)}. Back it off.`, 6);
    else if (r.range < 60 && r.range > 12 && r.closing > Math.max(0.6, r.range * 0.03)) say('fast2', `Closing at ${f2(r.closing)} metres per second at ${r.range.toFixed(0)} metres. That is a lot of momentum to undo.`, 10);
    if (r.range < 25 && r.closing < -0.05) say('away', 'We are drifting away from the port.', 12);
    if (r.range < 10 && r.pos.z > 0.3 && r.lateral > 0.35) say('lat', `You are ${f2(r.lateral)} metres off the spin axis. The port surface there moves at ${f2(r.tangential)} metres per second.`, 10);
    if (r.range < 35 && Math.abs(r.spin) > 0.05 && Math.abs(r.rollRate) > tol.rollRate * 2) say('spin', `Roll rate mismatch ${f2(r.rollRate)} radians per second. Match the spin.`, 11);
    if (r.range < 10 && r.pos.z > 0.3 && r.tilt > 3) say('tilt', `Attitude error ${r.tilt.toFixed(1)} degrees.`, 10);
    if (r.range < 3 && r.envelope) say('green', 'Alignment good. Capture envelope is green.', 40);
  }

  onSoftCapture(e) {
    const g = this.g;
    this.captureRel = e.rel;
    g.audio?.clunk(1.0, 1.0);
    g.shake = Math.max(g.shake, 0.6);
    g.ui.showBanner('SOFT CAPTURE', 'white', 2.5, `closing ${f2(e.rel.closing)} m/s · offset ${f2(e.rel.lateral)} m · ${e.rel.tilt.toFixed(2)}°`);
    this.m.say('case', 'Contact. Soft capture.', { priority: true });
    this.opts.onCapture?.(e);
  }

  onHardDock(e) {
    const g = this.g;
    g.audio?.clunk(0.9, 0.85);
    setTimeout(() => g.audio?.hiss(4.5, 0.22), 400);
    g.ui.showBanner('HARD DOCK', 'green', 5, '12 / 12 LATCHES · EQUALISING PRESSURE');
    const b = rpm(e.before.spin), a = rpm(e.after.spin);
    const delta = Math.abs(a - b) > 0.005 ? ` Combined spin ${b.toFixed(2)} to ${a.toFixed(2)} RPM, conserving angular momentum.` : '';
    this.m.say('case', `Hard dock confirmed. Twelve of twelve latches.${delta} Equalising pressure.`);
    if (g.audio?.organ?.playing) { g.audio.organ.setIntensity(0.55); setTimeout(() => g.audio.organ.stop(8), 6000); }
    this.opts.onHardDock?.(e);
  }

  onBounce(e) {
    const g = this.g;
    this.bounces++;
    this.maxImpact = Math.max(this.maxImpact, e.speed);
    if (e.speed < 0.05) return;
    g.audio?.clunk(Math.min(1.5, 0.3 + e.speed), 0.8);
    g.shake = Math.max(g.shake, Math.min(3, 0.4 + e.speed * 2));
    const r = e.rel;
    let why = '';
    if (r.closing > settings.difficulty.closing) why = `closing at ${f2(r.closing)}`;
    else if (r.lateral > settings.difficulty.lateral) why = `${f2(r.lateral)} metres off axis`;
    else if (r.tilt > settings.difficulty.tilt) why = `${r.tilt.toFixed(1)} degrees misaligned`;
    else if (Math.abs(r.rollRate) > settings.difficulty.rollRate) why = `roll rate off by ${f2(r.rollRate)}`;
    else if (r.latVel > settings.difficulty.lateralVel) why = `sliding sideways at ${f2(r.latVel)}`;
    if (e.zone !== 'port') why = 'you hit the hub face, not the port';
    if (e.speed > 0.3) {
      this.m.say('case', `Impact at ${f2(e.speed)} metres per second. ${why ? 'Cause: ' + why + '.' : ''} We bounced, and we are tumbling.`, { priority: true, key: 'bounce', cooldown: 3 });
      g.fx.damage = Math.min(1, e.speed);
      g.ui.showBanner('IMPACT', 'red', 1.5, `${f2(e.speed)} m/s`);
    } else this.m.say('case', `Contact, no capture — ${why || 'out of envelope'}. We bounced off. Physics is unforgiving but consistent.`, { key: 'bounce', cooldown: 4 });
  }

  onImpact(e) {
    const g = this.g;
    const v = g.world.kestrel.body.velocityAt(e.point, e.point.clone());
    g.particles.sparks(e.point, v, Math.floor(20 + e.speed * 80), 2 + e.speed * 6);
  }

  onDamage(e) {
    const g = this.g, K = g.world.kestrel;
    if (e.amount > 2) { g.fx.damage = Math.min(1, g.fx.damage + e.amount / 30); g.shake = Math.max(g.shake, e.amount / 10); }
    if (K.hull <= 0 && !this.destroyed) {
      this.destroyed = true;
      const p = K.body.pos.clone();
      g.particles.explosion(p, K.body.vel.clone(), 0.6);
      g.audio?.explosion(0.8);
      g.ui.showBanner('HULL BREACH', 'red', 4);
      this.m.say('case', 'Hull breach. I am sorry. Restoring the last checkpoint.', { priority: true });
      g.world.kestrelActive = false;
      this.m.fail('KESTREL LOST', `Structural failure after a ${f2(this.maxImpact || 0)} m/s impact. Docking needs under ${settings.difficulty.closing} m/s closing and ${settings.difficulty.tilt}° alignment.`);
    } else if (e.cause === 'impact' && K.hull < 45) {
      this.m.say('case', `Hull integrity ${K.hull.toFixed(0)} percent. One more like that and we will be docking in pieces.`, { key: 'hull', cooldown: 8 });
    }
  }

  // Precision summary for scoring/results.
  summary() {
    const c = this.captureRel;
    return c ? { closing: c.closing, lateral: c.lateral, tilt: c.tilt, roll: c.roll, rollRate: c.rollRate, bounces: this.bounces } : null;
  }
}
