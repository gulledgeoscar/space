// BONUS - FREE DOCK: randomised orbit, spin rate, approach geometry and
// propellant. Scored on time, delta-v used and precision at capture.

import { Vector3, Quaternion, Euler } from 'three';
import { Mission } from './missionBase.js';
import { DockingDirector } from './dockingDirector.js';
import { circularState, orientStation } from './scenario.js';
import { lvlhBasis } from '../physics/orbital.js';
import { PLANETS } from '../physics/bodies.js';
import { fromRpm, rpm } from '../physics/constants.js';
import { settings } from '../core/settings.js';
import { progress } from '../core/save.js';

export class FreeDockMission extends Mission {
  static id = 6;
  start() {
    const g = this.game, W = this.world;
    const rnd = (a, b) => a + Math.random() * (b - a);
    const planet = Math.random() < 0.5 ? PLANETS.earth : PLANETS.skadi;
    W.setPrimary(planet);
    g.planetView.setPlanet(planet);
    g.sky.setSystem(planet.system === 'sol' ? 'sol' : 'lethe');
    if (planet.system !== 'sol') g.sky.setBlackHole(new Vector3(rnd(-1, 1), rnd(0.1, 0.5), rnd(-1, 1)).normalize(), 40, 0.1);
    const alt = rnd(300e3, 650e3);
    const st = circularState(planet, alt, rnd(0, Math.PI * 2), rnd(0, 0.3));
    W.meridian.body.pos.copy(st.pos); W.meridian.body.vel.copy(st.vel);
    const basis = lvlhBasis(st.pos, st.vel);
    // station axis: random direction biased toward -V-bar
    const axis = basis.y.clone().negate().add(new Vector3(rnd(-0.6, 0.6), rnd(-0.6, 0.6), rnd(-0.6, 0.6))).normalize();
    const spinRpm = Math.random() < 0.25 ? rnd(8, 16) : rnd(0, 8);
    orientStation(W.meridian, axis, fromRpm(spinRpm), rnd(0, 6.28));
    // Kestrel: within a 50-degree cone in front of the port
    const range = rnd(180, 700);
    const off = axis.clone();
    const perp = new Vector3().crossVectors(axis, new Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1))).normalize();
    off.applyQuaternion(new Quaternion().setFromAxisAngle(perp, rnd(0, 0.85))).multiplyScalar(range);
    const K = W.kestrel;
    K.body.pos.copy(W.meridian.portWorld(new Vector3())).add(off);
    K.body.vel.copy(st.vel).add(new Vector3().crossVectors(basis.omega, off)).add(new Vector3(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)));
    const look = new Vector3().subVectors(W.meridian.portWorld(new Vector3()), K.body.pos).normalize();
    K.body.quat.setFromUnitVectors(new Vector3(0, 0, -1), look).multiply(new Quaternion().setFromEuler(new Euler(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-3, 3))));
    K.body.updateDerived();
    K.body.setAngularVelocity(new Vector3(rnd(-0.01, 0.01), rnd(-0.01, 0.01), rnd(-0.02, 0.02)));
    K.fuel = K.capacity * rnd(0.12, 0.45);
    K.body.savePrev(); W.meridian.body.savePrev();
    g.enterFlight('chase', { blend: false });
    this.params = { planet: planet.name, spin: spinRpm, range, fuel: K.fuel };
    this.director = new DockingDirector(this, { onHardDock: (e) => this.onDocked(e) });
    this.objectives('FREE DOCK', `${planet.name} orbit · ${spinRpm.toFixed(1)} RPM · ${range.toFixed(0)} m`, [['dock', 'Dock with the Meridian hub port'], ['fast', 'Bonus: under 4 minutes']]);
    this.saveCheckpoint('Start');
    this.t0 = W.time;
    this.dv0 = K.dvUsed;
    const self = this;
    this.run((function* () {
      yield { real: 1.0 };
      yield* self.line('case', `Free dock. ${planet.name} orbit. The Meridian is turning at ${spinRpm.toFixed(1)} RPM, ${range.toFixed(0)} metres out. You have ${K.fuel.toFixed(0)} kilograms of propellant.`);
      yield* self.line('case', settings.difficulty.helpers ? 'W to go, S to slow, Space to stop. I handle the lining up. The clock is running.' : 'No helpers. The clock is running.');
    })());
  }
  controlsNote() {
    return settings.difficulty.helpers
      ? 'Hold <kbd>W</kbd> to fly toward the port, <kbd>S</kbd> to slow, <kbd>Space</kbd> to stop. The computer lines you up and slows you for capture.'
      : 'Slow down near the station, centre on the port, and close in at under ' + settings.difficulty.closing.toFixed(2) + ' m/s.';
  }
  update(simDt, realDt) {
    super.update(simDt, realDt);
    this.director.update(realDt);
    if (!this.done) this.game.ui.hud.phaseSub = null;
  }
  onDocked(e) {
    const W = this.world, K = W.kestrel;
    const t = W.time - this.t0;
    const dv = K.dvUsed - this.dv0;
    const c = this.director.summary() || { closing: 0, lateral: 0, tilt: 0 };
    const tol = settings.difficulty;
    const prec = Math.max(0, 0.4 * (1 - c.closing / tol.closing) + 0.3 * (1 - c.lateral / tol.lateral) + 0.3 * (1 - c.tilt / tol.tilt));
    const mult = { assisted: 1, realistic: 1.5, expert: 2 }[settings.get('difficulty')] || 1;
    const score = Math.max(0, Math.round((5000 * prec + 3000 * Math.exp(-t / 300) + 2000 * Math.exp(-dv / 25) - 500 * this.director.bounces) * mult * (1 + this.params.spin / 20)));
    this.complete('dock');
    if (t < 240) this.complete('fast');
    const entry = { score, label: `${this.params.spin.toFixed(1)} RPM ${settings.difficulty.label} ${new Date().toLocaleDateString()}` };
    const pos = progress.addScore(entry);
    const table = progress.scores.map((s, i) => ({ ...s, mine: i === pos }));
    this.finish({
      title: 'HARD DOCK', score, table, delay: 4500,
      lines: [
        ['Time', `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`],
        ['Δv used', `${dv.toFixed(1)} m/s`],
        ['Closing at capture', `${c.closing.toFixed(3)} m/s`],
        ['Lateral offset', `${c.lateral.toFixed(3)} m`],
        ['Alignment', `${c.tilt.toFixed(2)}°`],
        ['Bounces', `${this.director.bounces}`],
        ['Station spin', `${rpm(Math.abs(e.after.spin)).toFixed(2)} RPM`],
        ['Difficulty', settings.difficulty.label],
      ],
      onNext: () => this.game.startMission(6), nextLabel: 'NEW RANDOM DOCK',
    });
  }
}
