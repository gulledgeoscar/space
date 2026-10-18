// MISSION 1 - LAUNCH & FIRST DOCK.
// Switch-flipping startup, a real ascent from the equator (hold-down clamps
// on a rotating Earth, gravity turn, max-Q, staging, insertion), Hohmann
// phasing to the Meridian, then a tutorial docking that teaches orbital
// drift with the Clohessy-Wiltshire predicted path.

import { Vector3, Quaternion, Matrix4 } from 'three';
import { Mission } from './missionBase.js';
import { DockingDirector } from './dockingDirector.js';
import { RendezvousGuide } from './rendezvous.js';
import { circularState, orientStation, placeKestrelLvlh, pointKestrel } from './scenario.js';
import { lvlhBasis, stateToElements } from '../physics/orbital.js';
import { EARTH } from '../physics/bodies.js';
import { EarthPad } from '../world/surfaces.js';
import { SwitchPanel } from '../ui/checklist.js';
import { buildBoosterModel } from '../ship/kestrelModel.js';
import { RigidBody, Inertia } from '../physics/rigidBody.js';
import { BOOSTER } from '../ship/kestrel.js';
import { settings } from '../core/settings.js';
import { G0 } from '../physics/constants.js';

const MERIDIAN_ALT = 400e3;

export class LaunchMission extends Mission {
  static id = 1;

  start() {
    const g = this.game, W = this.world;
    W.setPrimary(EARTH);
    g.planetView.setPlanet(EARTH);
    g.sky.setSystem('sol');
    this.guide = new RendezvousGuide(g);
    this.guide.muted = true;
    this.director = new DockingDirector(this, {
      onHardDock: () => { this.complete('dock'); this.phaseName = 'docked'; },
      onPressurised: () => { this.say('case', 'Unstrap with E and float through the nose hatch. Dr. Okafor has the kettle on. Metaphorically.'); },
    });
    this.director.active = false;
    this.objectives('LAUNCH & FIRST DOCK', 'Cape Ardent → 400 km → Meridian hub port', [
      ['startup', 'Configure the Kestrel for launch'],
      ['ascent', 'Fly the ascent: gravity turn, max-Q, staging'],
      ['orbit', 'Reach a stable orbit (periapsis above 150 km)'],
      ['rendezvous', 'Rendezvous with the Meridian'],
      ['lesson', 'Learn why pointing at the Meridian is wrong'],
      ['dock', 'Dock with the spinning hub port'],
      ['hatch', 'Float through the hatch into the Meridian'],
    ]);
    this.on('player:area', (a) => { if (a === 'hub' && this.phaseName === 'docked') this.enteredMeridian(); });
    this.on('kestrel:boosterBurnout', () => this.onBurnout());
    const stage = this.stage || 'launch';
    if (stage === 'rendezvous' || stage === 'final') this.setupRendezvous(stage === 'final');
    else if (stage === 'orbit') this.setupOrbit();
    else this.setupPad();
  }

  allowExit() { return this.phaseName === 'docked'; }
  allowUndock() { return false; }

  // ---------------------------------------------------------------------------
  setupMeridian(theta) {
    const W = this.world;
    const st = circularState(EARTH, MERIDIAN_ALT, theta);
    W.meridian.body.pos.copy(st.pos); W.meridian.body.vel.copy(st.vel);
    const basis = lvlhBasis(st.pos, st.vel);
    orientStation(W.meridian, basis.y.clone().negate());
  }

  setupPad() {
    const g = this.game, W = this.world, K = W.kestrel;
    this.reachStage('launch');
    this.setupMeridian(-0.2356);
    this.surface = new EarthPad(g, EARTH);
    g.surface = this.surface;
    W.groundFn = (p) => this.surface.ground(p);
    K.fuel = 10000;
    K.attachBooster(1);
    K.gearDown = false;
    this.boosterModel = buildBoosterModel();
    g.kestrelModel.root.add(this.boosterModel.root);
    g.extraMeshes.push(this.boosterModel.root);
    this.padHold = true;
    this.holdOnPad(0);
    W.preStep.push((dt) => { if (this.padHold) this.holdOnPad(dt); });
    g.enterFlight('chase', { blend: false });
    g.pilot.chase.dist = 95; g.pilot.chase.pitch = 0.1; g.pilot.chase.yaw = 0.7;
    g.pilot._frame = null;
    g.pilot.lockControls = true;
    this.phaseName = 'pad';
    this.checkpointStage = 'launch';
    g.input.exitLock();
    const self = this;
    this.run((function* () {
      yield { real: 1.2 };
      yield* self.line('halden', 'Kestrel, Halden Control. Range is green, weather is green, the Meridian is passing overhead in eleven minutes.');
      yield* self.line('case', 'Good morning. I am CASE-9. I will be reading you the checklist, the numbers, and occasionally my opinion.');
      yield* self.line('case', 'Configure the Kestrel: throw the switches in order. The red guards lift first.');
      self.panel = new SwitchPanel(g, g.ui.extra);
      self.panel.onCommit = () => self.commit();
    })());
  }

  // Kestrel stack held by the clamps: rides the rotating planet.
  holdOnPad() {
    const W = this.world, K = W.kestrel, S = this.surface;
    // pose for the END of this step (frozen bodies are not integrated)
    const B = S.updateBasis(W.time + 1 / 120);
    const up = B.n, east = B.e;
    // body axes: nose (-Z) up, top (+Y) east  ->  X = north
    const m = new Matrix4().makeBasis(B.s.clone().negate(), east, up.clone().negate());
    K.body.quat.setFromRotationMatrix(m);
    const origin = B.p.clone().addScaledVector(up, BOOSTER.enginePos[2] + 0.3);
    K.body.pos.copy(K.body.comBody).applyQuaternion(K.body.quat).add(origin);
    K.body.vel.copy(W.surfaceVelocity(K.body.pos, new Vector3()));
    K.body.setAngularVelocity(new Vector3(0, EARTH.rotationRate, 0));
    K.body.frozen = true;
  }

  commit() {
    const g = this.game, self = this;
    this.panel.remove();
    this.panel = null;
    this.complete('startup');
    g.input.requestLock();
    this.run((function* () {
      yield* self.line('halden', 'Kestrel, you are go for launch. Godspeed, and don\'t forget to come back.');
      for (let i = 10; i >= 1; i--) {
        self.say('case', i === 3 ? 'Three. Booster ignition.' : `${i}.`, { dur: 0.9 });
        if (i === 3) { self.world.kestrel.booster.lit = true; self.world.kestrel.cmd.throttle = 1; g.audio?.explosion(0.25); }
        yield { real: 1 };
      }
      self.padHold = false;
      self.world.kestrel.body.frozen = false;
      self.say('case', 'Liftoff. Clamps released. The pitch cue will tell you where to point; Assisted pilots can hold it with zero.');
      g.pilot.lockControls = false;
      self.phaseName = 'ascent';
      self.ascentT0 = self.world.time;
      g.audio?.organ?.play('wonder', 0.35);
      yield 40;
      g.audio?.organ?.stop(10);
    })());
  }

  // pitch-program cue: elevation above the local horizon toward east
  ascentCue() {
    const W = this.world, K = W.kestrel.body;
    const up = K.pos.clone().normalize();
    const east = new Vector3(0, 1, 0).cross(up).normalize();
    const alt = K.pos.length() - EARTH.radius;
    const vs = K.vel.clone().sub(W.surfaceVelocity(K.pos, new Vector3())).length();
    const el = stateToElements(K.pos, K.vel, EARTH.gm);
    const apAlt = el.ra - EARTH.radius;
    let e;
    if (vs < 60) e = 90;
    else e = 90 * (1 - Math.pow(Math.min(1, alt / 62000), 0.52));
    e = Math.max(e, apAlt < 160e3 ? 9 : 0);
    if (apAlt > 205e3) e = Math.min(e, -2);
    const r = (e * Math.PI) / 180;
    return { dir: east.multiplyScalar(Math.cos(r)).addScaledVector(up, Math.sin(r)).normalize(), e, apAlt, alt };
  }

  onBurnout() {
    this.say('case', 'BECO. Booster burnout. Stage with SPACE.' + (settings.difficulty.helpers ? ' I will do it in three seconds if you don\'t.' : ''), { priority: true });
    this.stageReady = true;
    this.stageTimer = 3;
  }

  stageSep() {
    const g = this.game, W = this.world, K = W.kestrel;
    const info = K.separateBooster();
    if (!info) return;
    this.stageReady = false;
    // the spent stage becomes its own rigid body
    const body = new RigidBody('booster');
    body.setMassProperties(info.mass, new Vector3(...BOOSTER.pos), Inertia.cylinderZ(info.mass, 1.95, 30));
    body.quat.copy(info.quat);
    body.pos.copy(info.pos);
    body.vel.copy(info.vel);
    body.setAngularVelocity(info.omega.clone().add(new Vector3(0.05, 0, 0.02).applyQuaternion(info.quat)));
    body.savePrev();
    g.kestrelModel.root.remove(this.boosterModel.root);
    g.scene.add(this.boosterModel.root);
    W.extras.push({
      body, mesh: this.boosterModel.root, kind: 'booster',
      applyForces: (dt, env) => {
        if (env.rho > 0) {
          const v = env.airVel.length();
          if (v > 1) body.applyForce(env.airVel.clone().multiplyScalar(-0.5 * env.rho * v * 12 * 1.1));
        }
      },
    });
    K.cmd.throttle = 1;
    g.audio?.clunk(1.2, 0.7);
    g.shake = 1.5;
    this.say('case', 'Staging. Kestrel main engine ignition. You are on your own propellant now. Mind it.');
    this.complete('ascent');
  }

  // ---------------------------------------------------------------------------
  setupOrbit() {
    const g = this.game, W = this.world, K = W.kestrel;
    this.reachStage('orbit');
    const th = 0.6;
    const st = circularState(EARTH, 205e3, th);
    K.body.pos.copy(st.pos); K.body.vel.copy(st.vel);
    K.fuel = 4600;
    K.gearDown = false;
    pointKestrel(W, K.body.pos.clone().add(st.vel), K.body.pos.clone().negate());
    this.setupMeridian(th + 0.21);
    g.enterFlight('chase', { blend: false });
    this.complete('startup'); this.complete('ascent');
    this.phaseName = 'orbit';
    this.enterOrbitPhase();
  }

  setupRendezvous(final = false) {
    const g = this.game, W = this.world, K = W.kestrel;
    this.reachStage('rendezvous');
    this.setupMeridian(0.9);
    K.fuel = 2600;
    K.gearDown = false;
    placeKestrelLvlh(W, new Vector3(-90, -1900, 25), new Vector3(0, 0, 0));
    pointKestrel(W, W.meridian.portWorld(new Vector3()), W.meridian.body.pos.clone().normalize());
    g.enterFlight('chase', { blend: false });
    ['startup', 'ascent', 'orbit', 'rendezvous'].forEach((i) => this.complete(i));
    this.phaseName = 'prox';
    this.beginProximity(final);
  }

  enterOrbitPhase() {
    const self = this;
    this.guide.muted = false;
    this.complete('orbit');
    this.saveCheckpoint('Parking orbit', { snapshot: false });
    this.checkpointStage = 'orbit';
    this.reachStage('orbit');
    this.run((function* () {
      yield* self.line('case', 'Orbit. Technically we are still falling, but we keep missing. Congratulations.');
      yield* self.line('case', 'The Meridian is in a higher orbit, ahead of us. Lower orbits are faster, so we are catching up. The diamond cue shows the next burn; press M for the map.');
      yield* self.line('case', 'Time warp with the period key. I will drop us out of warp before each burn.');
    })());
  }

  beginProximity(final = false) {
    const self = this, g = this.game;
    this.guide.muted = false;
    this.director.active = true;
    this.complete('rendezvous');
    if (final) { this.complete('lesson'); this.guide.clear(); this.checkpointStage = 'final'; return; }
    this.saveCheckpoint('Rendezvous · 2 km');
    this.checkpointStage = 'rendezvous';
    this.reachStage('rendezvous');
    this.lesson = 'intro';
    this.run((function* () {
      yield* self.line('case', 'Two kilometres. Rendezvous complete. Now for the part that confuses everyone.');
      yield* self.line('case', 'Point the nose at the Meridian and push forward for a few seconds. Go on. Watch the cyan predicted path.' + (settings.difficulty.helpers ? ' Seven holds the nose on target.' : ''));
      self.lesson = 'push';
      const r0 = self.world.docking.rel.range;
      const t0 = self.world.time;
      const dv0 = self.world.kestrel.dvUsed;
      yield () => self.world.kestrel.dvUsed - dv0 > 0.6 || self.world.time - t0 > 45;
      yield { real: 4 };
      yield* self.line('case', 'See the path climb and curve back behind the Meridian? Pushing toward it added speed along our orbit. More speed means a higher orbit, and higher orbits are slower.');
      yield* self.line('case', 'So you rise, slow down, and fall behind the thing you aimed at. This is the Clohessy–Wiltshire problem. In orbit, straight lines are a lie.');
      yield* self.line('case', 'The green diamond accounts for it: it is a burn that puts us on the docking axis 250 metres out. Burn along it until it shrinks, then coast and watch the path bend in.');
      self.complete('lesson');
      self.lesson = 'done';
      void r0;
      yield () => self.world.docking.rel.range < 320;
      yield* self.line('case', 'Approach corridor. From here: stop the drift, line up on the port axis, match the Meridian\'s roll. It turns at four point seven RPM, and so must we.');
      if (settings.difficulty.helpers) yield* self.line('case', 'Assisted: L nulls relative velocity, 9 aligns with the port axis, K matches the station\'s spin inside 250 metres. Then creep in with W.');
      else yield* self.line('case', 'Realistic: no auto-stabilisation. Use the docking camera — C — and keep the cross in the circle.');
      self.guide.clear();
      self.saveCheckpoint('Final approach · 300 m');
      self.checkpointStage = 'final';
    })());
  }

  enteredMeridian() {
    if (this.phaseName !== 'docked') return;
    this.phaseName = 'done';
    this.complete('hatch');
    this.say('okafor', 'Welcome aboard. That was a clean dock.');
    const W = this.world;
    this.finish({
      title: 'MISSION 1 COMPLETE', delay: 2500,
      lines: [['Mission elapsed', `${(W.clock.ship / 60).toFixed(1)} min`], ['Δv used', `${W.kestrel.dvUsed.toFixed(0)} m/s`], ['Propellant left', `${W.kestrel.fuel.toFixed(0)} kg`], ['Hull', `${W.kestrel.hull.toFixed(0)}%`], ['Bounces', `${this.director.bounces}`]],
      onNext: () => this.game.startMission(2, 'continue', null, { keepWorld: true }), nextLabel: 'CONTINUE: WALK THE SHIP',
    });
  }

  // ---------------------------------------------------------------------------
  frame(dt, input) {
    if (this.panel) this.panel.key(input);
    if (this.stageReady && input.hit('Space')) this.stageSep();
  }

  update(simDt, realDt) {
    super.update(simDt, realDt);
    const g = this.game, W = this.world, K = W.kestrel;
    this.director.update(realDt);
    if (this.surface) this.surface.update(realDt, g.pipeline.origin);
    if (this.stageReady && settings.difficulty.helpers) {
      this.stageTimer -= realDt;
      if (this.stageTimer <= 0) this.stageSep();
    }
    if (this.phaseName === 'ascent') this.updateAscent(simDt);
    if (this.phaseName === 'orbit' || this.phaseName === 'ascent-coast') {
      const a = this.guide.update(realDt);
      // drop out of warp shortly before a burn window
      if (a && !a.terminal && a.t < 20 + a.dv / 2 && g.warp > 1) { g.setWarp(1); this.say('case', `Burn window. ${a.label}, ${a.dv.toFixed(1)} metres per second.`, { key: 'burnwin', cooldown: 30 }); }
      if (W.docking.rel.range < 2100 && this.phaseName === 'orbit') { this.phaseName = 'prox'; this.beginProximity(); }
    }
    if (this.phaseName === 'prox') this.guide.update(realDt);
    // fail: crashed or dropped back into the atmosphere
    if (this.phaseName === 'ascent' || this.phaseName === 'ascent-coast') {
      const alt = K.body.pos.length() - EARTH.radius;
      if (alt < 50 && W.time - this.ascentT0 > 5 && K.body.vel.dot(K.body.pos.clone().normalize()) < -5) {
        g.particles.explosion(K.body.pos.clone(), K.body.vel.clone(), 1.5); g.audio?.explosion(1.2); W.kestrelActive = false;
        this.fail('LOST ON ASCENT', 'The Kestrel came back down. Follow the pitch cue: start the turn east after the tower, about 9 degrees above the horizon by 60 km.');
      }
    }
    if (K.hull <= 0 && !this.failed && this.phaseName.startsWith('ascent')) {
      g.particles.explosion(K.body.pos.clone(), K.body.vel.clone(), 1.5); g.audio?.explosion(1.2); W.kestrelActive = false;
      this.fail('VEHICLE BREAKUP', 'Aerodynamic loads exceeded the structure. Throttle back through max-Q and keep the nose on the velocity vector in the thick air.');
    }
  }

  updateAscent() {
    const g = this.game, W = this.world, K = W.kestrel;
    const cue = this.ascentCue();
    g.pilot.burnTarget = { dir: cue.dir };
    g.ui.hud.setCue('asc', { dir: cue.dir, icon: 'cue', cls: 'green', label: `PITCH ${cue.e.toFixed(0)}°`, clamp: true });
    g.ui.hud.phaseText = K.booster ? 'ASCENT · STAGE 1' : 'ASCENT · STAGE 2';
    g.ui.hud.phaseSub = `Ap ${(cue.apAlt / 1000).toFixed(1)} km · alt ${(cue.alt / 1000).toFixed(1)} km · q ${(K.q / 1000).toFixed(1)} kPa`;
    // max-Q choreography
    const q = K.q;
    if (!this.maxQ) this.maxQ = { peak: 0, said: 0 };
    const mq = this.maxQ;
    if (q > mq.peak) mq.peak = q;
    if (mq.said === 0 && q > 15000) { mq.said = 1; this.say('case', 'Approaching max-Q. Throttle back to about seventy percent with X and keep the nose on the velocity vector.'); }
    if (mq.said === 1 && mq.peak > 18000 && q < mq.peak * 0.92) { mq.said = 2; this.say('case', `Max-Q, ${(mq.peak / 1000).toFixed(1)} kilopascals. Through the worst of it. Throttle up.`); }
    // aerodynamic structural limit
    if (q > 24000 && K.aoa > 0.17) K.damage((q / 1000 - 20) * 0.08 * (K.aoa / 0.17), 'aero');
    if (q > 48000) K.damage((q - 48000) * 0.0004, 'aero');
    if (K.aoa > 0.2 && q > 20000) g.extraWarnings = [['ANGLE OF ATTACK', '']]; else g.extraWarnings = [];
    // MECO / insertion
    const el = stateToElements(K.body.pos, K.body.vel, EARTH.gm);
    const apAlt = el.ra - EARTH.radius;
    if (!K.booster && apAlt > 195e3 && !this.mecoSaid) {
      this.mecoSaid = true;
      this.say('case', 'Apoapsis two hundred kilometres. Cut the engine — Backspace — and coast to apoapsis.', { priority: true });
    }
    if (this.mecoSaid && K.cmd.throttle === 0 && !this.coast) {
      this.coast = true;
      this.phaseName = 'ascent-coast';
      g.ui.hud.setCue('asc', null);
      g.ui.hud.phaseText = null; g.ui.hud.phaseSub = null;
      g.extraWarnings = [];
      this.guide.muted = false;
      this.say('case', 'MECO. Periapsis is still inside the atmosphere. The cue shows the circularisation burn at apoapsis.');
      this.watchInsertion();
    }
  }

  watchInsertion() {
    const self = this;
    this.run((function* () {
      yield () => {
        const K = self.world.kestrel.body;
        const el = stateToElements(K.pos, K.vel, EARTH.gm);
        return el.rp - EARTH.radius > 150e3;
      };
      self.phaseName = 'orbit';
      self.enterOrbitPhase();
    })());
  }

  warpLimit() { return this.phaseName === 'pad' ? 1 : 50; }

  visuals() {
    const K = this.world.kestrel;
    if (this.boosterModel) {
      const lvl = K.booster ? K.booster.level : 0;
      this.boosterModel.plumeMat.opacity = lvl > 0 ? 0.55 + Math.random() * 0.2 : 0;
      this.boosterModel.plume.visible = lvl > 0;
      this.boosterModel.plume.scale.set(1 + K.rho * 0.3, 0.7 + lvl * 0.5, 1 + K.rho * 0.3);
    }
  }

  dispose() {
    super.dispose();
    this.panel?.remove();
    this.surface?.dispose();
    this.game.surface = null;
  }
}
