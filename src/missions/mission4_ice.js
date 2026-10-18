// MISSION 4 - SKADI & THE HOSTILE DOCK.
// Undock and descend to the frozen world; meet Vance at the Wren; he lied
// about Skadi, cracks your visor and takes the Wren. Race to orbit and watch
// his forced docking go wrong: the Wren bounces off the hub, careens into
// the ring and detonates, tearing two modules away. The Meridian - now
// asymmetric - spins up, wobbles, vents and starts rebalancing itself.

import { Vector3, Quaternion, Matrix4 } from 'three';
import { Mission } from './missionBase.js';
import { DockingDirector } from './dockingDirector.js';
import { setupDocked, circularState, orientStation, pointKestrel } from './scenario.js';
import { ascentCue, surfaceState, stopDistance, LandingAssist, predictedTouchdown } from './flightAids.js';
import { orbitCamera } from './cinematics.js';
import { lvlhBasis, stateToElements } from '../physics/orbital.js';
import { SKADI } from '../physics/bodies.js';
import { formatDuration } from '../physics/timeDilation.js';
import { IceSurface } from '../world/surfaces.js';
import { SurfacePlayer } from '../player/surfacePlayer.js';
import { buildAstronaut } from '../player/astronaut.js';
import { buildKestrelModel } from '../ship/kestrelModel.js';
import { Kestrel } from '../ship/kestrel.js';
import { DockingSystem } from '../ship/dockingPort.js';
import { moduleAngle, MODULE_MID_R } from '../ship/meridian.js';
import { settings } from '../core/settings.js';
import { fromRpm, rpm } from '../physics/constants.js';
import { SKADI_BH } from './mission3_ocean.js';
import { placeCrew, BRIDGE_CREW_S } from './mission2_walk.js';

export const ORBIT_ALT = 300e3;

export class IceMission extends Mission {
  static id = 4;

  start() {
    const g = this.game;
    this.landing = new LandingAssist(g);
    this.objectives('SKADI', 'Ice world · 0.85 g · Vance beacon', [
      ['board', 'Board the Kestrel and undock'],
      ['land', 'Descend and land on Skadi near the Wren'],
      ['vance', 'Meet Dr. Vance'],
      ['ridge', 'Walk with Vance to the survey ridge'],
      ['back', 'Get back to the Kestrel before your oxygen runs out'],
      ['orbit', 'Race the Wren to orbit'],
    ]);
    this.briefingText = ['SKADI · VANCE SURVEY SITE', '0.85 g · 0.42 kg/m³ air · -68 °C', 'Beacon: "habitable" (8 years)', 'Wren lander on the surface', 'Meridian holding 300 km'];
    this.director = new DockingDirector(this, { onSeparated: () => this.onSeparated() });
    this.on('interact:board', () => this.boardFromInterior());
    const st = this.stage || 'bridge';
    ({ bridge: () => this.setupBridge(), descent: () => this.setupDescent(), surface: () => this.setupSurfaceStage(), ascent: () => this.setupAscentStage() }[st] || (() => this.setupBridge()))();
  }

  allowExit() { return false; }
  allowBoard() { return this.phase === 'walk'; }
  // on the surface: where the marker points
  surfaceTarget() {
    if (this.phase !== 'surface') return null;
    if (this.story === 'meet') return { pos: this.vanceLocal.clone().add(new Vector3(0, 1.2, 0)), label: 'DR. VANCE' };
    if (this.story === 'walk' && this.ridge) return { pos: this.ridge.clone().add(new Vector3(0, 1, 0)), label: 'RIDGE' };
    if (this.canBoard && this.kestrelLocal) return { pos: this.kestrelLocal.clone(), label: 'KESTREL' };
    return null;
  }
  controlsNote() { return this.phase === 'walk' ? 'Walk to the Kestrel: follow the yellow ◆ marker — ladder, hub, hatch, pilot seat. <kbd>E</kbd> at each one.' : null; }
  interiorTarget() { return this.phase === 'walk' ? 'kestrel' : null; }
  allowUndock() { return this.phase === 'cockpit'; }
  onUndockStart() { this.phase = 'releasing'; }
  warpLimit() { return this.phase === 'surface' || this.phase === 'wrecking' ? 1 : 50; }

  setupBridge() {
    const g = this.game;
    this.reachStage('bridge');
    setupDocked(g, SKADI, ORBIT_ALT, { bh: SKADI_BH, fuel: 17500 });
    g.enterInterior('bridgeConsole', { facing: 1 });
    placeCrew(g, 'okafor', BRIDGE_CREW_S, 0.05, 2.1, -1, 'sit');
    this.phase = 'walk';
    const self = this;
    this.run((function* () {
      yield { real: 1 };
      yield* self.lines([
        ['okafor', 'Vance\'s beacon has said "habitable" for eight years. His telemetry says he\'s alive — in hypersleep, then awake as of yesterday.'],
        ['okafor', 'He went down alone. He\'s earned someone coming to get him. Bring him up, and his data.'],
        ['case', 'Skadi has a thin atmosphere and thick fog. Frozen clouds at three to nine hundred metres. Try not to land on one.'],
      ]);
    })());
  }

  boardFromInterior() {
    if (this.phase !== 'walk') return;
    const g = this.game;
    g.enterFlight('cockpit');
    this.phase = 'cockpit';
    this.say('case', 'U releases the latches. Then kill our roll and back off. We deorbit from two hundred metres.');
  }

  onSeparated() {
    if (this.phase !== 'releasing') return;
    this.complete('board');
    this.phase = 'clear';
    const self = this;
    this.run((function* () {
      yield () => self.world.docking.rel.range > 200;
      yield* self.line('case', 'Clear. Deorbit: retrograde' + (settings.difficulty.helpers ? ' (2)' : '') + ', about ninety metres per second. Then belly forward.');
      self.phase = 'deorbit';
      self.saveCheckpoint('Deorbit', { snapshot: false });
      self.checkpointStage = 'descent';
      self.reachStage('descent');
    })());
  }

  setupDescent(quiet = false) {
    const g = this.game, W = this.world, K = W.kestrel;
    this.reachStage('descent');
    setupDocked(g, SKADI, ORBIT_ALT, { bh: SKADI_BH, fuel: 17500 });
    W.docking.separate(0);
    const S = W.meridian.body;
    K.body.pos.addScaledVector(W.meridian.axisWorld(new Vector3()), 260);
    K.body.setAngularVelocity(new Vector3());
    pointKestrel(W, K.body.pos.clone().sub(S.vel), K.body.pos.clone().normalize());
    g.enterFlight('chase');
    this.complete('board');
    this.phase = 'deorbit';
    this.checkpointStage = 'descent';
    if (!quiet) this.say('case', 'Deorbit: retrograde, about ninety metres per second.');
  }

  // ---------------------------------------------------------------------------
  makeSite() {
    const g = this.game, W = this.world;
    const n = predictedTouchdown(W);
    this.surface = new IceSurface(g, SKADI, n);
    g.surface = this.surface;
    W.groundFn = (p) => this.surface.ground(p);
    const east = new Vector3(0, 1, 0).cross(n).normalize();
    g.sky.setBlackHole(n.clone().multiplyScalar(0.45).addScaledVector(east, 0.7).add(new Vector3(0, 0.4, 0)).normalize(), SKADI_BH.dist, SKADI_BH.inc);
    // the Wren, landed 170 m away, and Vance beside it
    const a = Math.random() * 6.28;
    this.wrenLocal = new Vector3(Math.cos(a) * 170, 0, Math.sin(a) * 170);
    this.wrenLocal.y = this.surface.height(this.wrenLocal.x, this.wrenLocal.z) + 2.28;
    this.wrenModel = buildKestrelModel({ livery: 'wren' });
    this.wrenModel.cockpit.group.visible = false;
    this.wrenModel.root.position.copy(this.wrenLocal);
    this.wrenModel.root.rotation.y = a + 1.2;
    this.surface.group.add(this.wrenModel.root);
    this.vance = buildAstronaut({ suit: 0x55606e, accent: 0x2f7d8c, name: 'vance' });
    this.vanceLocal = this.wrenLocal.clone().add(new Vector3(Math.cos(a + 0.6) * 5, 0, Math.sin(a + 0.6) * 5));
    this.vanceLocal.y = this.surface.height(this.vanceLocal.x, this.vanceLocal.z);
    this.surface.group.add(this.vance.root);
    this.vanceState = { mode: 'idle', target: null, speed: 0, facing: new Vector3(1, 0, 0) };
  }

  touchdown() {
    const K = this.world.kestrel, self = this;
    this.phase = 'landed';
    this.landing.on = false;
    K.cmd.throttle = 0;
    this.complete('land');
    this.run((function* () {
      yield { real: 1.5 };
      K.body.frozen = true;
      yield* self.line('case', `Down. Minus sixty-eight outside, zero point eight five g. The Wren is ${self.wrenLocal.clone().sub(self.surface.toLocal(K.body.pos)).setY(0).length().toFixed(0)} metres away. So is someone standing next to it.`);
      self.startSurface();
    })());
  }

  startSurface() {
    const g = this.game, W = this.world, K = W.kestrel, S = this.surface;
    this.phase = 'surface';
    this.reachStage('surface');
    const kl = S.toLocal(K.body.pos);
    this.kestrelLocal = kl;
    const sp = new SurfacePlayer(g, S);
    this.player = sp;
    const side = S.localDir(K.body.dirToWorld(new Vector3(1, 0, 0))).setY(0).normalize();
    const back = S.localDir(K.body.dirToWorld(new Vector3(0, 0, 1))).setY(0).normalize();
    // step off beside the nose, clear of the wing, facing the Wren
    sp.spawn(kl.x + side.x * 3.4 - back.x * 3.6, kl.z + side.z * 3.4 - back.z * 3.6, this.vanceLocal.clone().sub(kl).setY(0).normalize());
    sp.addLander(kl, side, back);
    const wr = this.wrenModel.root.rotation.y;
    sp.addLander(this.wrenLocal, new Vector3(Math.cos(wr), 0, -Math.sin(wr)), new Vector3(Math.sin(wr), 0, Math.cos(wr)));
    this.boardIt = { pos: new Vector3(kl.x + side.x * 2.0, kl.y, kl.z + side.z * 2.0), radius: 3.2, prompt: 'Board the Kestrel', enabled: () => this.canBoard, action: () => this.boardFromSurface() };
    sp.interactables.push(this.boardIt);
    sp.interactables.push({ pos: this.vanceLocal.clone().add(new Vector3(0, 1, 0)), radius: 3.5, prompt: 'Talk to Dr. Vance', enabled: () => this.story === 'meet', action: () => this.meetVance() });
    g.enterSurface(sp);
    this.saveCheckpoint('Skadi surface', { snapshot: false });
    this.checkpointStage = 'surface';
    this.story = 'meet';
    this.say('case', 'Go and say hello. Carefully. People who live alone for eight years develop opinions.');
  }

  meetVance() {
    const self = this;
    this.story = 'talk';
    this.complete('vance');
    // the ridge he wants to show you: 120 m away on rising ground
    const dir = this.vanceLocal.clone().sub(this.kestrelLocal).setY(0).normalize();
    const side = new Vector3(-dir.z, 0, dir.x);
    this.ridge = this.vanceLocal.clone().addScaledVector(side, 110).addScaledVector(dir, 30);
    this.ridge.y = this.surface.height(this.ridge.x, this.ridge.z);
    this.run((function* () {
      yield* self.lines([
        ['vance', 'You came. Eight years. I stopped counting the days and started counting the readings.'],
        ['vance', 'Walk with me. There\'s a ridge — you need to see the plains from up there to understand this place.'],
      ]);
      self.story = 'walk';
      self.vanceState.mode = 'walk';
      self.vanceState.target = self.ridge.clone();
      yield () => self.player && self.player.walker.pos.distanceTo(self.ridge) < 8 && self.vanceLocal.distanceTo(self.ridge) < 3;
      self.complete('ridge');
      self.story = 'ridge';
      self.vanceState.mode = 'idle';
      yield* self.lines([
        ['vance', 'It\'s beautiful, isn\'t it. Ammonia ice under the snow. No soil. No liquid water within a thousand kilometres.'],
        ['case', 'That does not match the beacon.'],
        ['vance', 'No. It doesn\'t. Habitable got me a rescue. Uninhabitable got me eight more years of nothing.'],
        ['vance', 'The Meridian can still go home. One of us will be on it. I\'m sorry.'],
      ]);
      self.betrayal();
    })());
  }

  betrayal() {
    const g = this.game, self = this;
    this.story = 'betrayed';
    const p = this.player;
    // Vance shoves you down the slope; your visor cracks
    const away = p.walker.pos.clone().sub(this.vanceLocal).setY(0).normalize();
    p.walker.vel.addScaledVector(away, 3.2).add(new Vector3(0, 1.8, 0));
    p.downed = true;
    p.enabled = false;
    g.fx.damage = 1;
    g.shake = 3;
    g.audio?.clunk(1.3, 0.7);
    g.audio?.hiss(6, 0.18);
    this.o2 = 150;
    g.ui.showBanner('VISOR BREACH', 'red', 2.5, 'SUIT O2 LEAK');
    this.vanceState.mode = 'run';
    this.vanceState.target = this.wrenLocal.clone();
    this.run((function* () {
      yield { real: 1 };
      self.say('case', 'Your visor is cracked. You are leaking oxygen — I make it two and a half minutes. Get up.', { priority: true });
      yield { real: 4 };
      p.downed = false;
      p.enabled = true;
      self.complete('ridge');
      yield () => self.vanceLocal.distanceTo(self.wrenLocal) < 4;
      self.vance.root.visible = false;
      self.say('case', 'He is in the Wren. Engines lighting. He is going for the Meridian.');
      self.launchWren();
      self.canBoard = true;
      yield* self.line('okafor', 'Kestrel, Meridian — the Wren just lit up on radar. Who is flying it? Kestrel, respond!');
      yield* self.line('case', 'Back to the Kestrel. We can catch him in orbit. Probably.');
    })());
  }

  launchWren() {
    const g = this.game, W = this.world, S = this.surface;
    const wren = new Kestrel('Wren', { fuel: 12000 });
    wren.gearDown = false;
    const wp = S.toWorld(this.wrenLocal.x, this.wrenLocal.y, this.wrenLocal.z);
    const up = wp.clone().normalize();
    wren.body.quat.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.wrenModel.root.rotation.y));
    wren.body.updateDerived();
    wren.body.pos.copy(wp);
    wren.body.vel.set(0, 0, 0);
    wren.body.savePrev();
    W.wren = wren;
    W.wrenActive = true;
    this.wrenModel.root.removeFromParent();
    g.scene.add(this.wrenModel.root);
    g.wrenModel = this.wrenModel;
    g.extraMeshes.push(this.wrenModel.root);
    this.wrenT = 0;
    g.audio?.explosion(0.3);
  }

  // Wren autopilot: vertical rise, then pitch over (enough to look real
  // from the ground; it is taken off the board once out of sight).
  wrenStep(dt) {
    const W = this.world, w = W.wren;
    if (!w || W.wrenActive === false || this.phase === 'wrecking') return;
    this.wrenT += dt;
    const up = w.body.pos.clone().normalize();
    const alt = w.body.pos.length() - SKADI.radius;
    const nose = w.body.dirToWorld(new Vector3(0, 0, -1));
    // attitude: rotate nose (body -Z) up first, then tilt east
    const east = new Vector3(0, 1, 0).cross(up).normalize();
    const e = this.wrenT < 4 ? 0 : Math.max(0.15, 1 - alt / 9000);
    const want = this.wrenT < 4 ? up : up.clone().multiplyScalar(e).addScaledVector(east, 1 - e).normalize();
    const err = new Vector3().crossVectors(nose, want);
    const bodyErr = err.applyQuaternion(w.body.quat.clone().invert());
    const wb = w.body.omega.clone().applyQuaternion(w.body.quat.clone().invert());
    w.cmd.r.set(Math.max(-1, Math.min(1, bodyErr.x * 3 - wb.x * 4)), Math.max(-1, Math.min(1, bodyErr.y * 3 - wb.y * 4)), Math.max(-1, Math.min(1, -wb.z * 4)));
    w.rcsMode = 'coarse';
    w.cmd.throttle = this.wrenT > 1.5 ? 1 : 0;
    if (alt > 7000) { W.wrenActive = false; this.wrenModel.root.visible = false; }
  }

  boardFromSurface() {
    const g = this.game, K = this.world.kestrel;
    this.player.dispose();
    this.player = null;
    K.body.frozen = false;
    g.enterFlight('cockpit');
    this.phase = 'liftoff';
    this.complete('back');
    this.reachStage('ascent');
    this.saveCheckpoint('Skadi liftoff', { snapshot: false });
    this.checkpointStage = 'ascent';
    this.say('case', 'Seals holding in here. Full throttle. Follow the cue to three hundred kilometres. He has a head start and no conscience.');
  }

  setupSurfaceStage() {
    this.setupDescent(true);
    const W = this.world, K = W.kestrel;
    W.meridianActive = true;
    this.makeSite();
    const S = this.surface;
    const p = S.toWorld(0, S.height(0, 0) + 2.28, 0);
    K.body.pos.copy(p);
    K.body.quat.setFromUnitVectors(new Vector3(0, 1, 0), p.clone().normalize());
    K.body.updateDerived();
    K.body.vel.set(0, 0, 0); K.body.setAngularVelocity(new Vector3());
    K.body.frozen = true; K.gearDown = true;
    K.fuel = 16500;
    this.complete('land');
    this.startSurface();
  }

  setupAscentStage() {
    this.setupSurfaceStage();
    ['vance', 'ridge', 'back'].forEach((i) => this.complete(i));
    this.story = 'betrayed';
    this.vance.root.visible = false;
    this.launchWren();
    this.world.wrenActive = false;
    this.wrenModel.root.visible = false;
    this.canBoard = true;
    this.boardFromSurface();
  }

  // ---------------------------------------------------------------------------
  frame(dt, input) { if (input.hit('KeyH')) this.landing.toggle(); }

  fixedUpdate(dt) { this.wrenStep(dt); this.fixedRam(dt); }

  update(simDt, realDt) {
    super.update(simDt, realDt);
    const g = this.game, W = this.world, K = W.kestrel;
    this.director.update(realDt);
    this.surface?.update(realDt, g.pipeline.origin);
    if (this.phase === 'deorbit' || this.phase === 'entry') this.updateDescent();
    if (this.phase === 'surface') this.updateSurface(realDt);
    if (this.phase === 'liftoff') this.updateAscent();
  }

  updateDescent() {
    const g = this.game, W = this.world, K = W.kestrel;
    const st = surfaceState(W, this.surface);
    const stop = stopDistance(W, st);
    g.ui.hud.phaseText = this.phase === 'deorbit' ? 'DEORBIT' : 'ENTRY & LANDING';
    g.ui.hud.phaseSub = `AGL ${(st.agl / 1000).toFixed(st.agl < 2000 ? 2 : 1)} km · v↓ ${(-st.vs).toFixed(0)} m/s · v→ ${st.vh.toFixed(0)} m/s · stop ${stop.toFixed(0)} m${this.landing.on ? ' · AUTO-LAND' : ''}`;
    const el = stateToElements(K.body.pos, K.body.vel, SKADI.gm);
    if (this.phase === 'deorbit' && el.rp - SKADI.radius < 30e3) { this.phase = 'entry'; this.say('case', 'Entry. Thin air here — we will come in fast and need the engine early.'); }
    if (!this.surface && st.agl < 9000) this.makeSite();
    if (this.surface) this.landing.update(1 / 60, this.surface);
    g.extraWarnings = st.agl < stop * 1.3 && st.agl < 4000 && -st.vs > 20 && !this.landing.on ? [['BURN NOW', '']] : [];
    if (K.onGround && this.phase !== 'landed') {
      if (K.hull <= 5) this.fail('CRASHED', 'Skadi\'s thin air barely slows you. Start the landing burn high.');
      else this.touchdown();
    }
  }

  updateSurface(dt) {
    const g = this.game;
    this.player?.visuals(dt);
    // Vance animation / movement
    const v = this.vanceState;
    if (this.vance && this.vance.root.visible) {
      const vs = v.mode === 'run' ? 3.6 : v.mode === 'walk' ? 1.3 : 0;
      if (v.target && vs > 0) {
        const d = v.target.clone().sub(this.vanceLocal).setY(0);
        const dist = d.length();
        // wait for the player while walking together
        const pd = this.player ? this.player.walker.pos.distanceTo(this.vanceLocal) : 0;
        const go = v.mode === 'run' || pd < 9;
        if (dist > 0.5 && go) { d.normalize(); this.vanceLocal.addScaledVector(d, Math.min(dist, vs * this.game.simDt)); v.facing.copy(d); v.speed = vs; } else v.speed = 0;
        this.vanceLocal.y = this.surface.height(this.vanceLocal.x, this.vanceLocal.z);
      } else v.speed = 0;
      if (v.mode === 'idle' && this.player) v.facing.copy(this.player.walker.pos.clone().sub(this.vanceLocal).setY(0).normalize());
      this.vance.root.position.copy(this.vanceLocal);
      this.vance.root.lookAt(this.vanceLocal.clone().sub(v.facing));
      this.vance.animate({ mode: v.speed > 0.1 ? (v.speed > 2.5 ? 'run' : 'walk') : 'idle', speed: v.speed, dt });
    }
    if (this.o2 !== undefined && this.story === 'betrayed' || this.o2 !== undefined && this.phase === 'surface' && this.canBoard) {
      this.o2 -= this.game.simDt;
      g.ui.setCoriolis(`SUIT O2 ${Math.max(0, this.o2).toFixed(0)} s · Kestrel ${this.player ? this.player.walker.pos.distanceTo(this.kestrelLocal).toFixed(0) : 0} m`);
      if (this.o2 < 30 && !this.o2told) { this.o2told = true; this.say('case', 'Thirty seconds of oxygen. Run.'); }
      if (this.o2 <= 0) this.fail('SUIT FAILURE', 'You ran out of oxygen on Skadi. Head straight back to the Kestrel after the fall.');
    }
  }

  updateAscent() {
    const g = this.game, W = this.world, K = W.kestrel;
    const cue = ascentCue(W, SKADI, ORBIT_ALT);
    g.pilot.burnTarget = { dir: cue.dir };
    g.ui.hud.setCue('asc', { dir: cue.dir, icon: 'cue', cls: 'green', label: `PITCH ${cue.e.toFixed(0)}°`, clamp: true });
    g.ui.hud.phaseText = 'ASCENT · RACE THE WREN';
    g.ui.hud.phaseSub = `Ap ${(cue.apAlt / 1000).toFixed(1)} km · Δv ${K.deltaVMain().toFixed(0)} m/s`;
    if (cue.apAlt > ORBIT_ALT * 0.97 && !this.mecoTold) { this.mecoTold = true; this.say('case', 'Apoapsis three hundred. Cut the engine.'); }
    if ((cue.apAlt > ORBIT_ALT * 0.9 && K.body.pos.length() - SKADI.radius > 60e3) && !this.wrecked) {
      this.wrecked = true;
      g.ui.hud.setCue('asc', null);
      this.complete('orbit');
      this.botchedDock();
    }
  }

  // ---- the botched docking ------------------------------------------------------
  botchedDock() {
    const g = this.game, W = this.world, self = this;
    this.phase = 'wrecking';
    g.pilot.lockControls = true;
    K_cut(W);
    this.surface?.dispose(); this.surface = null; g.surface = null; W.groundFn = null;
    // place the Wren on a bad approach: fast, off-axis, not rolling
    const S = W.meridian;
    const wren = W.wren || new Kestrel('Wren', { fuel: 3000 });
    W.wren = wren; W.wrenActive = true;
    if (!g.wrenModel) { g.wrenModel = buildKestrelModel({ livery: 'wren' }); g.wrenModel.cockpit.group.visible = false; g.scene.add(g.wrenModel.root); g.extraMeshes.push(g.wrenModel.root); }
    g.wrenModel.root.visible = true;
    wren.body.frozen = false;
    wren.cmd.throttle = 0; wren.cmd.t.set(0, 0, 0); wren.cmd.r.set(0, 0, 0);
    const axis = S.axisWorld(new Vector3());
    const lat = S.body.dirToWorld(new Vector3(1, 0.4, 0).normalize());
    const port = S.portWorld(new Vector3());
    wren.body.quat.copy(S.body.quat).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.06));
    wren.body.updateDerived();
    const dockOff = new Vector3(0, 0, wren.body.comBody.z + 7.05).applyQuaternion(wren.body.quat);
    wren.body.pos.copy(port).addScaledVector(axis, 70).addScaledVector(lat, 1.7).add(dockOff);
    wren.body.vel.copy(S.body.vel).addScaledVector(axis, -2.4).addScaledVector(lat, -0.05);
    wren.body.setAngularVelocity(new Vector3());
    wren.body.savePrev();
    this.wrenDock = new DockingSystem(S, wren);
    this.wrenDock.captureEnabled = false;
    W.wrenDocking = this.wrenDock;
    // the Kestrel is still climbing far away; the camera follows the action
    g.ui.setLetterbox(true);
    g.cutscene = { focus: 'station', camera: orbitCamera(g, S.body, { dist: 150, yaw: 0.7, pitch: 0.35, speed: 0.025, fov: 45 }) };
    g.audio?.organ?.play('tension', 0.75);
    this.on('wren:bounce', (e) => this.onWrenBounce(e));
    this.run((function* () {
      yield* self.lines([
        ['case', 'There. The Wren, seventy metres off the Meridian\'s port. He is closing at two point four metres per second. He has not matched the spin.'],
        ['okafor', 'Wren, abort your approach! You are not aligned — the latches will not take you!'],
        ['vance', 'Then I\'ll open the hatch myself.'],
        ['case', 'I have locked the port. He is coming in anyway.'],
      ]);
      yield () => self.wrenHit;
      yield { real: 2.5 };
      // after the bounce Vance burns at full throttle - straight into the ring
      self.say('vance', 'No, no, no — ', { priority: true });
      self.ramRing = true;
      yield () => self.exploded;
      yield { real: 3 };
      yield* self.lines([
        ['case', `Module nine is gone. The blast spun the ring up to ${rpm(S.spinRate).toFixed(0)} RPM. She is lopsided now — the CoM is ${S.comOffset().toFixed(1)} metres off the hub and she is wobbling.`],
        ['case', 'The ballast pumps are moving shielding water around the ring to rebalance her. Modules eight and ten are venting atmosphere. That is thrust. That is torque.'],
        ['okafor', 'Kestrel... the pressure is dropping. I\'m sealing myself in the bridge. The ring jets need commands from the hub, and the hub is the one place I can\'t reach.'],
        ['case', 'Her orbit is fine. Her spin is not: two hundred seventy metres per second at the rim, a hundred and eighty g on the ring floor. If nobody docks and despins her, the ring tears itself apart.'],
      ]);
      g.ui.setLetterbox(false);
      self.finish({
        title: 'MISSION 4 COMPLETE', delay: 500,
        lines: [['Meridian spin', `${rpm(S.spinRate).toFixed(1)} RPM`], ['Modules lost', '1'], ['Earth time', '+' + formatDuration(W.clock.earth)]],
        onNext: () => g.startMission(5, 'continue', null, { keepWorld: true }), nextLabel: 'MISSION 5: THE SPIN DOCK',
      });
    })());
  }

  onWrenBounce(e) {
    if (this.wrenHit) return;
    this.wrenHit = true;
    const g = this.game;
    g.audio?.clunk(1.6, 0.6);
    g.particles.sparks(e.rel ? this.world.meridian.portWorld(new Vector3()) : this.world.wren.body.pos.clone(), this.world.meridian.body.vel.clone(), 200, 8);
    this.say('case', `Impact at ${e.speed.toFixed(1)} metres per second. He bounced.`, { priority: true });
  }

  fixedRam(dt) {
    const W = this.world, w = W.wren, S = W.meridian;
    if (!this.ramRing || this.exploded || !w) return;
    // Vance fights the tumble and throttles up; the craft heads into module 9
    const target = S.body.bodyToWorld(new Vector3(Math.cos(moduleAngle(9)) * MODULE_MID_R, Math.sin(moduleAngle(9)) * MODULE_MID_R, 0), new Vector3());
    const tv = S.body.velocityAt(target, new Vector3());
    const rel = target.clone().sub(w.body.pos);
    // pursuit in the station's rotating frame: the target point accelerates
    // at w^2 r (~9 m/s^2), so the velocity loop needs a stiff gain or it
    // lags forever behind the circling module
    const want = rel.clone().normalize().multiplyScalar(9).add(tv);
    const dv = want.sub(w.body.vel);
    w.body.vel.addScaledVector(dv, Math.min(1, dt * 6));
    this.ramTime = (this.ramTime || 0) + dt;
    // nose swings toward the ring as he fights for control (visual only)
    w.cmd.throttle = 0;
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), rel.clone().normalize());
    w.body.quat.slerp(q, Math.min(1, dt * 1.5));
    w.body.updateDerived();
    if (rel.length() < 7 || (this.ramTime > 14 && rel.length() < 25)) this.explode(target);
  }

  explode(point) {
    const g = this.game, W = this.world;
    this.exploded = true;
    W.wrenDocking = null;
    W.wrenActive = false;
    if (g.wrenModel) g.wrenModel.root.visible = false;
    wreckMeridian(g, point);
  }

  visuals(dt) {
    if (this.phase === 'surface') this.player?.visuals(dt);
    updateDebrisMeshes(this.game);
  }

  dispose() {
    super.dispose();
    this.player?.dispose();
    this.surface?.dispose();
    this.game.surface = null;
  }
}

function K_cut(W) { W.kestrel.cmd.throttle = 0; }

// Small blast debris: point masses with Keplerian motion, a few m/s apart.
export function spawnDebrisCloud(game, point, baseVel, n = 60) {
  const W = game.world;
  game.debrisMeshes = game.debrisMeshes || [];
  for (let i = 0; i < n; i++) {
    const size = 0.3 + Math.random() * 1.8;
    const mesh = game.makeDebrisMesh(size);
    W.debris.push({ pos: point.clone().add(new Vector3().randomDirection().multiplyScalar(Math.random() * 6)), vel: baseVel.clone().add(new Vector3().randomDirection().multiplyScalar(1 + Math.random() * 9)), spin: Math.random() * 6, spinRate: (Math.random() - 0.5) * 3, spinAxis: new Vector3().randomDirection(), r: size, mass: 40 + size * size * size * 120, mesh });
    game.extraMeshes.push(mesh);
  }
}

export function updateDebrisMeshes(game) {
  // debris with a module mesh: keep the ring-frame geometry consistent
  for (const d of game.world.debris) {
    if (!d.offset || !d.mesh) continue;
    const q = d.q0.clone().premultiply(new Quaternion().setFromAxisAngle(d.spinAxis, d.spin));
    d.mesh.quaternion.copy(q);
    d.mesh.position.copy(d.offset).applyQuaternion(q).negate().add(d.pos).sub(game.pipeline.origin);
  }
}

// The blast: tear module 9 away (rigid breakup), throw a debris cloud on
// real trajectories, and apply the angular impulse that spins the ring up
// to ~65 RPM with a slight tilt; then start ballast, slosh damping, vents.
export function wreckMeridian(game, point, { fx = true } = {}) {
  const g = game, W = g.world, S = W.meridian;
  if (fx) {
    g.particles.explosion(point, S.body.velocityAt(point, new Vector3()), 3);
    g.audio?.explosion(1.6);
    g.shake = 4;
    g.fx.damage = 0.8;
  }
  const debris = S.detachModules([9]);
  for (const d of debris) {
    const mesh = g.meridianModel.modules[d.module];
    mesh.removeFromParent();
    g.scene.add(mesh);
    W.debris.push({ pos: d.posWorld.clone(), vel: d.velWorld.clone().add(new Vector3().randomDirection().multiplyScalar(6)), spin: 0, spinRate: 0.4 + Math.random() * 0.6, spinAxis: new Vector3().randomDirection(), r: 12, mass: d.mass, mesh, offset: d.centreBody.clone(), q0: d.quat.clone() });
    g.extraMeshes.push(mesh);
  }
  spawnDebrisCloud(g, point, S.body.velocityAt(point, new Vector3()), 70);
  const axis = S.axisWorld(new Vector3());
  const Izz = S.body.inertiaBody.elements[8];
  const dL = (fromRpm(64.5) - S.spinRate) * Izz;
  const r = point.clone().sub(S.body.pos);
  const rPerp = r.clone().addScaledVector(axis, -r.dot(axis));
  const tang = new Vector3().crossVectors(axis, rPerp).normalize();
  const J = tang.multiplyScalar(dL / rPerp.length()).addScaledVector(axis, (dL / rPerp.length()) * 0.035);
  S.body.applyImpulse(J, point);
  S.ballastActive = true;
  S.pumpRate = 260;
  S.nutationDamping = 0.012;
  S.addVent(8, 650, 70, 430, 0.25);
  S.addVent(10, 650, 80, 430, -0.2);
  g.emit('meridian:exploded');
}
