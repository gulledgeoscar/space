// MISSION 5 - THE SPIN DOCK (finale).
// The wrecked Meridian turns at ~65 RPM about its main axis, nutating,
// venting, rebalancing its ballast and shedding a debris cloud on real
// trajectories. Approach on the spin axis, roll the Kestrel up to the
// station's spin (pilot red-out from the real centripetal load at the eye,
// RCS jets overheating), drive in, capture - the two bodies merge with
// angular momentum conserved - then fire the rim jets to despin to zero.

import { Vector3, Quaternion, Matrix4, MathUtils } from 'three';
import { Mission } from './missionBase.js';
import { DockingDirector } from './dockingDirector.js';
import { circularState, orientStation, pointKestrel } from './scenario.js';
import { lvlhBasis } from '../physics/orbital.js';
import { SKADI } from '../physics/bodies.js';
import { formatDuration } from '../physics/timeDilation.js';
import { moduleAngle, MODULE_MID_R } from '../ship/meridian.js';
import { wreckMeridian, spawnDebrisCloud, updateDebrisMeshes, ORBIT_ALT } from './mission4_ice.js';
import { SKADI_BH } from './mission3_ocean.js';
import { settings } from '../core/settings.js';
import { rpm, PHYSICS_DT, G0 } from '../physics/constants.js';

export class SpinDockMission extends Mission {
  static id = 5;

  start() {
    const g = this.game, W = this.world;
    if (!this.keepWorld || !W.meridian.damaged) this.freshWreck();
    else {
      g.cutscene = null;
      g.ui.setLetterbox(false);
      g.pilot.lockControls = false;
    }
    // fast-forward: the minutes it took to catch up (ballast and slosh damping work)
    W.kestrelActive = false;
    for (let i = 0; i < 150 / PHYSICS_DT; i++) W.step(PHYSICS_DT);
    W.kestrelActive = true;
    this.placeKestrel();
    g.enterFlight('cockpit');
    this.reachStage('approach');
    this.objectives('THE SPIN DOCK', 'Meridian · 65 RPM · venting · nutating', [
      ['approach', 'Approach the hub through the debris'],
      ['axis', 'Line up on the spin axis'],
      ['match', 'Roll the Kestrel to match the Meridian\'s spin'],
      ['dock', 'Dock'],
      ['despin', 'Fire the rim thrusters against the spin until she stops'],
    ]);
    this.director = new DockingDirector(this, {
      spinCalls: true, theme: 'finale',
      onCapture: () => { this.complete('match'); },
      onHardDock: (e) => this.onDocked(e),
    });
    this.phase = 'approach';
    this.saveCheckpoint('Spin dock · 900 m');
    this.checkpointStage = 'approach';
    g.audio?.organ?.play('finale', 0.35);
    const self = this, S = W.meridian;
    this.run((function* () {
      yield { real: 1 };
      yield* self.lines([
        ['case', `Nine hundred metres. The Meridian is turning at ${rpm(S.spinRate).toFixed(1)} RPM. Her rim is moving at ${(S.spinRate * 41).toFixed(0)} metres per second.`],
        ['pilot', 'CASE, can we dock with that?'],
        ['case', 'Physically? Yes, if we sit exactly on her spin axis and turn with her. On the axis the port barely moves. Three centimetres off, it moves at twenty centimetres a second.'],
        ['case', 'Anything that breaks off that ring leaves sideways at two hundred seventy metres a second. Stay on the axis and none of it comes our way. The slow debris from the blast is another matter — watch for it.'],
        ['case', 'Plan: line up at fifty metres, null the drift, then roll up to her spin. The roll will push you into your seat — well, out of it. Your eyes are a metre from our roll axis. Expect a red-out.'],
      ]);
      if (settings.difficulty.helpers) yield* self.line('case', 'I will hold us on her axis and roll us up to her spin. You set the pace with W and S. Slowly.');
    })());
  }

  // ---- setup ------------------------------------------------------------------------
  freshWreck() {
    const g = this.game, W = this.world, S = W.meridian;
    W.setPrimary(SKADI);
    g.planetView.setPlanet(SKADI);
    g.sky.setSystem('lethe');
    g.sky.setBlackHole(SKADI_BH.dir, SKADI_BH.dist, SKADI_BH.inc);
    const st = circularState(SKADI, ORBIT_ALT, 0.4);
    S.body.pos.copy(st.pos); S.body.vel.copy(st.vel);
    orientStation(S, lvlhBasis(st.pos, st.vel).y.negate());
    const point = S.body.bodyToWorld(new Vector3(Math.cos(moduleAngle(9)) * MODULE_MID_R, Math.sin(moduleAngle(9)) * MODULE_MID_R, 0), new Vector3());
    wreckMeridian(g, point, { fx: false });
  }

  placeKestrel() {
    const g = this.game, W = this.world, K = W.kestrel, S = W.meridian;
    K.attached = null; K.body.frozen = false;
    W.docking.state = 'free'; W.docking.latched = 0; W.docking.clearance = 0;
    S.attachedKestrel = null;
    W.wren = null; W.wrenDocking = null;
    g.surface?.dispose?.(); g.surface = null; W.groundFn = null;
    const axis = S.axisWorld(new Vector3());
    const perp = new Vector3().crossVectors(axis, new Vector3(0.3, 1, 0.2)).normalize();
    const off = axis.clone().applyQuaternion(new Quaternion().setFromAxisAngle(perp, 0.32)).multiplyScalar(900);
    const basis = lvlhBasis(S.body.pos, S.body.vel);
    K.body.pos.copy(S.portWorld(new Vector3())).add(off);
    K.body.vel.copy(S.body.vel).add(new Vector3().crossVectors(basis.omega, off));
    K.fuel = 9000;
    K.hull = 100;
    K.gearDown = false;
    K.rcsMode = 'coarse';
    for (const th of K.thrusters) th.temp = 290;
    pointKestrel(W, S.portWorld(new Vector3()), S.body.dirToWorld(new Vector3(0, 1, 0)));
    // a fresh shower of slow blast debris between us and the hub
    for (let k = 0; k < 3; k++) {
      const p = S.portWorld(new Vector3()).addScaledVector(off, 0.25 + k * 0.2).add(new Vector3().randomDirection().multiplyScalar(40));
      spawnDebrisCloud(g, p, S.body.vel.clone(), 14);
    }
  }

  allowExit() { return false; }
  controlsNote() {
    return settings.difficulty.helpers
      ? 'The flight computer keeps you on the spin axis and matches her roll inside 400 m. Set your approach speed with <kbd>W</kbd> / <kbd>S</kbd>; <kbd>Space</kbd> stops.'
      : 'Line up on the station\'s spin axis, then roll with <kbd>Q</kbd> <kbd>E</kbd> until SPIN MATCH reads 100%. Then close in slowly with <kbd>W</kbd>.';
  }
  allowUndock() { return false; }
  warpLimit() {
    if (this.phase === 'despin') return 50;
    if (this.phase === 'finale') return 1;
    return this.world.docking.rel.range > 300 ? 10 : 1;
  }

  onDocked(e) {
    const g = this.game, S = this.world.meridian, self = this;
    this.complete('dock');
    this.phase = 'despin';
    this.mergeInfo = e;
    this.run((function* () {
      yield { real: 2 };
      const b = rpm(e.before.spin), a = rpm(e.after.spin);
      yield* self.lines([
        ['case', `Hard dock. Angular momentum conserved: the Meridian and the Kestrel are one body now, turning at ${a.toFixed(2)} RPM — it was ${b.toFixed(2)} before we joined.`],
        ['case', `I have the ring jets. Four of them, twenty-five kilonewtons each, forty-one metres out. Against ${(S.body.inertiaBody.elements[8] / 1e6).toFixed(0)} million kilogram metres squared, that is ${(1000 * 4 * 25000 * 41.2 / S.body.inertiaBody.elements[8]).toFixed(1)} milliradians per second squared.`],
        ['case', `${settings.difficulty.helpers ? 'Hold W and I will fire them against the spin' : `Hold ${S.spinRate > 0 ? 'E' : 'Q'} — against the spin`}. It will take about ${(Math.abs(S.spinRate) / (4 * 25000 * 41.2 / S.body.inertiaBody.elements[8]) / 60).toFixed(0)} minutes. Time warp is yours.`],
      ]);
    })());
  }

  fixedUpdate(dt) {
    const W = this.world, S = W.meridian, input = this.game.input;
    if (this.phase === 'despin') {
      let cmd = input.axis('KeyE', 'KeyQ');   // Q = +Z torque, E = -Z
      // simple flight: hold W (or Q / E) and the computer fires against the
      // spin, easing off as it nears zero
      if (settings.difficulty.helpers && (input.key('KeyW') || cmd)) cmd = -MathUtils.clamp(S.spinRate / 0.05, -1, 1);
      S.despinCmd = cmd;
      if (Math.abs(S.spinRate) < 0.004 && !this.stopped) { this.stopped = true; S.despinCmd = 0; }
      if (this.stopped) S.despinCmd = 0;
    } else S.despinCmd = 0;
  }

  update(simDt, realDt) {
    super.update(simDt, realDt);
    const g = this.game, W = this.world, S = W.meridian, K = W.kestrel, D = W.docking;
    this.director.update(realDt);
    const r = D.rel;
    if (this.phase === 'approach') {
      // music + alarms with proximity and roll-match
      const prox = 1 - Math.min(1, r.range / 600);
      g.audio?.organ?.setIntensity(0.35 + prox * 0.45 + r.spinMatch * 0.2);
      this.director.opts.baseIntensity = 0.35 + prox * 0.45 + r.spinMatch * 0.2;
      g.heart = 0.3 + prox * 0.7;
      const jetHot = K.rcsHeat > 950;
      g.missionAlarm = (r.range < 200 && (jetHot || (r.range < 30 && r.tangential > 0.5))) || S.vents.some((v) => v.gas > 60) && r.range < 400;
      g.extraWarnings = [];
      if (Math.abs(S.spinRate) > 1) g.extraWarnings.push([`MERIDIAN ${rpm(S.spinRate).toFixed(1)} RPM`, 'caution']);
      if (r.range < 120 && r.axisOffset > 0.5) g.extraWarnings.push([`OFF AXIS ${r.axisOffset.toFixed(2)} m`, '']);
      if (r.range < 900 && !this.inCloud && r.range < 500) { this.inCloud = true; this.complete('approach'); }
      if (r.range < 70 && r.lateral < 0.5 && r.tilt < 3 && !this.axisDone) {
        this.axisDone = true; this.complete('axis');
        this.say('case', 'On the axis. Null the drift. Now roll. Coarse jets.');
        this.saveCheckpoint('On the axis · 70 m');
      }
      if (r.spinMatch > 0.98 && Math.abs(r.spin) > 1 && !this.matchSaid) { this.matchSaid = true; this.say('case', 'Rotation matched. The station looks still from in here. Everything else is spinning — that is the universe, not us. Drive in.'); }
      if (K.rcsHeat > 1100 && !this.hotSaid) { this.hotSaid = true; this.say('case', 'RCS jet temperature critical. They will derate at eleven fifty kelvin. Short pulses.'); }
      if (g.pilotG < -2.5 && !this.redSaid) { this.redSaid = true; this.say('case', `You are pulling ${Math.abs(g.pilotG).toFixed(1)} g toward your head. That red at the edges is your blood. Breathe.`); }
      g.ui.hud.phaseText = null;
    } else if (this.phase === 'despin') {
      g.missionAlarm = false;
      g.heart = 0.3;
      const spin = rpm(S.spinRate);
      g.ui.hud.phaseText = 'DESPIN';
      g.ui.hud.phaseSub = `MERIDIAN ${spin.toFixed(2)} RPM · rim jets ${S.despinCmd ? (S.despinCmd > 0 ? '+' : '−') + ' FIRING' : 'idle'} · hold ${settings.difficulty.helpers ? 'W' : S.spinRate > 0 ? 'E' : 'Q'}`;
      g.extraWarnings = [];
      const marks = [50, 40, 30, 20, 10, 5, 1];
      for (const mk of marks) if (Math.abs(spin) < mk && !(this['m' + mk])) { this['m' + mk] = true; this.say('case', mk === 1 ? 'One RPM. Gently.' : `${mk} RPM.`, { key: 'rpm', cooldown: 1 }); }
      g.audio?.organ?.setIntensity(0.4 + Math.min(0.5, Math.abs(spin) / 130));
      if (this.stopped && !this.finaleStarted) this.finale();
    }
  }

  finale() {
    const g = this.game, W = this.world, S = W.meridian, self = this;
    this.finaleStarted = true;
    this.phase = 'finale';
    this.complete('despin');
    g.pilot.lockControls = true;
    g.audio?.organ?.setIntensity(1.0);
    g.ui.setLetterbox(true);
    const bh = g.sky.bhDir.clone();
    let t = 0;
    g.cutscene = {
      focus: 'station',
      camera: (dt, origin, cam) => {
        t += dt;
        const sp = g.interpBodyPos(S.body, new Vector3()).sub(origin);
        const axis = S.axisWorld(new Vector3());
        const k = Math.min(1, t / 36);
        const e = k * k * (3 - 2 * k);
        const side = new Vector3().crossVectors(bh, new Vector3(0, 1, 0)).normalize();
        // start beside the hub, end far out with Lethe behind the ring
        const near = axis.clone().multiplyScalar(30).addScaledVector(side, 14);
        const far = bh.clone().multiplyScalar(-520).addScaledVector(side, 140).add(new Vector3(0, 90, 0));
        cam.position.copy(sp).add(near.lerp(far, e));
        cam.up.set(0, 1, 0);
        cam.lookAt(sp.clone().addScaledVector(bh, 120 * e));
        const fov = 55 - 20 * e;
        if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      },
    };
    this.run((function* () {
      yield* self.lines([
        ['case', 'Zero. She is still. For the first time in a long time, so am I.'],
        ['okafor', 'Kestrel... I can stand up. The ring is holding. You did it.'],
      ]);
      yield { real: 6 };
      g.ui.showCaption('MERIDIAN', 'stabilised · 0.00 RPM', 7);
      yield { real: 9 };
      g.ui.showCaption('', `ship time ${formatDuration(W.clock.ship)} · earth +${formatDuration(W.clock.earth)}`, 6);
      yield { real: 7 };
      g.audio?.organ?.stop(10);
      self.finish({
        title: 'THE MERIDIAN HOLDS', delay: 1500,
        lines: [
          ['Spin at capture', `${rpm(self.mergeInfo.before.spin).toFixed(2)} RPM`],
          ['Combined after merge', `${rpm(self.mergeInfo.after.spin).toFixed(2)} RPM`],
          ['Closing speed at capture', `${(self.director.summary()?.closing || 0).toFixed(3)} m/s`],
          ['Lateral offset at capture', `${(self.director.summary()?.lateral || 0).toFixed(3)} m`],
          ['Bounces', `${self.director.bounces}`],
          ['Ship time', formatDuration(W.clock.ship)], ['Earth time', '+' + formatDuration(W.clock.earth)],
        ],
        onNext: () => g.startMission(6), nextLabel: 'FREE DOCK MODE',
      });
    })());
  }

  visuals() { updateDebrisMeshes(this.game); }
}
