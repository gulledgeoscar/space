// MISSION 3 - UNDOCK & OCEAN WORLD.
// Walk to the Kestrel, undock inside the burn window and manage the drift;
// descend into Pelagia's 1.3 g while the dilation clock races (1 hour here
// = 7 years at home); wade out to the SOUNDER-3 beacon; outrun the tidal
// surge; fly a Delta-v-limited ascent; re-dock on fumes; walk to the bridge.

import { Vector3, Quaternion, Matrix4, Group, Mesh, CylinderGeometry, SphereGeometry, MeshStandardMaterial, MeshBasicMaterial, Color, TorusGeometry } from 'three';
import { Mission } from './missionBase.js';
import { DockingDirector } from './dockingDirector.js';
import { setupDocked, circularState, orientStation, placeKestrelLvlh, pointKestrel } from './scenario.js';
import { ascentCue, surfaceState, stopDistance, LandingAssist, predictedTouchdown, deorbitBurn } from './flightAids.js';
import { orbitCamera, stationCamera } from './cinematics.js';
import { lvlhBasis, stateToElements } from '../physics/orbital.js';
import { SKADI, PELAGIA, pelagiaTides } from '../physics/bodies.js';
import { ORBITS, formatDuration } from '../physics/timeDilation.js';
import { OceanSurface } from '../world/surfaces.js';
import { SurfacePlayer } from '../player/surfacePlayer.js';
import { toStation } from '../ship/interiorLayout.js';
import { settings } from '../core/settings.js';
import { G0 } from '../physics/constants.js';
import { placeCrew, BRIDGE_CREW_S } from './mission2_walk.js';

export const SKADI_BH = { dir: new Vector3(-0.55, 0.25, -0.8).normalize(), dist: 40, inc: 0.1 };
export const PELAGIA_BH = { dir: new Vector3(0.55, 0.5, -0.67).normalize(), dist: 11, inc: 0.07 };
const WINDOW = 600; // s of sim time from mission start until the burn window closes

export class OceanMission extends Mission {
  static id = 3;

  start() {
    const g = this.game;
    this.landing = new LandingAssist(g);
    this.tides = pelagiaTides();
    this.objectives('UNDOCK & PELAGIA', `Pelagia · 1.3 g · dt/dτ ${ORBITS.pelagia.factor.toFixed(0)}`, [
      ['board', 'Walk to the docking port and board the Kestrel'],
      ['undock', 'Undock and clear the Meridian inside the burn window'],
      ['burn', 'Fly the departure burn (35 m/s prograde)'],
      ['land', 'Land on Pelagia'],
      ['beacon', 'Recover the SOUNDER-3 data beacon'],
      ['escape', 'Get off the surface before the surge arrives'],
      ['orbit', 'Reach orbit with what is left'],
      ['redock', 'Re-dock with the Meridian on fumes'],
      ['bridge', 'Float through the hatch and walk to the bridge'],
    ]);
    this.briefingText = ['PELAGIA · SOUNDER-3 BEACON', '1.3 g surface · knee-deep ocean', `dt/dτ = ${ORBITS.pelagia.factor.toFixed(0)}`, '1 min down there = 42 days at home', `Tidal surge ≈ ${this.tides.waveHeight.toFixed(0)} m`, 'Burn window: 10 minutes'];
    this.director = new DockingDirector(this, {
      onSeparated: () => this.onSeparated(),
      onHardDock: () => { this.complete('redock'); this.phase = 'docked'; },
      onPressurised: () => this.say('case', 'Pressure equal. Unstrap with E. Dr. Okafor is waiting on the bridge — she has been waiting for a while.'),
    });
    this.on('interact:board', () => this.boardFromInterior());
    this.on('player:area', (a) => { if (a === 'bridge' && this.phase === 'walkback') this.missionDone(); });
    this.on('mode', (m) => {
      if (m === 'interior' && this.phase === 'docked') {
        this.phase = 'walkback';
        placeCrew(this.game, 'okafor', BRIDGE_CREW_S, 0.05, 2.1, -1, 'sit');
        this.say('case', 'Hub, spoke, ring, bridge. You know the way.');
      }
    });
    const st = this.stage || 'bridge';
    ({ bridge: () => this.setupBridge(), undock: () => this.setupUndock(), descent: () => this.setupDescent(), surface: () => this.setupSurfaceStage(), ascent: () => this.setupAscentStage(), redock: () => this.setupRedock() }[st] || (() => this.setupBridge()))();
  }

  allowExit() { return this.phase === 'docked' || this.phase === 'walkback'; }
  allowBoard() { return this.phase === 'walk'; }
  // the flight computer's docking mode only on the way back in
  wantsDocking() { return this.phase === 'redock'; }
  surfaceTarget() {
    if (this.phase !== 'surface' || !this.beaconLocal) return null;
    return this.hasBeacon ? { pos: this.kestrelLocal.clone(), label: 'KESTREL' } : { pos: this.beaconLocal.clone().add(new Vector3(0, 1, 0)), label: 'BEACON' };
  }
  controlsNote() { return this.phase === 'walk' ? 'Walk to the Kestrel: follow the yellow ◆ marker — ladder, hub, hatch, pilot seat. <kbd>E</kbd> at each one.' : null; }
  interiorTarget() { return this.phase === 'walk' ? 'kestrel' : this.phase === 'walkback' ? 'bridge' : null; }
  allowUndock() { return this.phase === 'cockpit'; }
  onUndockStart() { this.phase = 'releasing'; }
  warpLimit() { return this.phase === 'surface' ? 1 : 50; }

  // ---- stage: bridge --------------------------------------------------------
  setupBridge() {
    const g = this.game;
    this.reachStage('bridge');
    setupDocked(g, SKADI, 300e3, { bh: SKADI_BH, fuel: 17500 });
    g.enterInterior('bridgeConsole', { facing: 1 });
    placeCrew(g, 'okafor', BRIDGE_CREW_S, 0.05, 2.1, -1, 'sit');
    this.phase = 'walk';
    this.windowEnd = this.world.time + WINDOW;
    const self = this;
    this.run((function* () {
      yield { real: 1 };
      yield* self.lines([
        ['okafor', 'The window to Pelagia opens now and closes in ten minutes. After that the next one is nine days out — about sixty years down there.'],
        ['case', 'Every minute you spend on that surface costs forty-two days at home. I will be counting. Out loud, probably.'],
        ['okafor', 'SOUNDER-3 has been pinging from the shallows for two years of our time. Bring it home. Go.'],
      ]);
    })());
  }

  boardFromInterior() {
    if (this.phase !== 'walk') return;
    const g = this.game;
    this.complete('board');
    g.enterFlight('cockpit');
    this.phase = 'cockpit';
    this.reachStage('undock');
    this.saveCheckpoint('Kestrel cockpit · docked', { snapshot: false });
    this.say('case', 'Strapped in. U releases the latches. Kill our roll once we are free — we will still be turning with the station.');
  }

  setupUndock() {
    const g = this.game;
    this.reachStage('undock');
    setupDocked(g, SKADI, 300e3, { bh: SKADI_BH, fuel: 17500 });
    g.enterFlight('cockpit');
    this.complete('board');
    this.phase = 'cockpit';
    this.windowEnd = this.world.time + WINDOW * 0.6;
    this.say('case', 'U releases the latches. The window is open.');
  }

  onSeparated() {
    if (this.phase !== 'releasing') return;
    this.phase = 'clear';
    this.complete('undock');
    const self = this;
    this.run((function* () {
      yield { real: 1.5 };
      yield* self.line('case', settings.difficulty.helpers ? 'Free. I have stopped our roll. Hold S to back away from her.' : 'We are rolling at the station\'s four point seven RPM. Kill it. Then back away along the axis with S. Watch the predicted path: we are in Skadi orbit too, so the drift is real.');
      yield () => self.world.docking.rel.range > 120;
      yield* self.line('case', settings.difficulty.helpers ? 'One hundred twenty metres. Clear for the main engine. Hold W: I will point prograde and burn the thirty-five metres per second.' : 'One hundred twenty metres. Clear for the main engine. Point prograde and burn thirty-five metres per second.');
      self.phase = 'depart';
      self.dv0 = self.world.kestrel.dvUsed;
    })());
  }

  // ---- departure burn and transfer -------------------------------------------
  transferOut() {
    const g = this.game, self = this;
    this.phase = 'transfer';
    this.complete('burn');
    g.pilot.lockControls = true;
    g.ui.setLetterbox(true);
    g.cutscene = { camera: orbitCamera(g, this.world.kestrel.body, { dist: 40, yaw: 2.6, pitch: 0.15, speed: 0.05 }) };
    this.run((function* () {
      yield* self.line('case', 'Departure burn complete. Handing the transfer to the autopilot. Lethe will do most of the work.');
      g.ui.setFade(true);
      yield { real: 1.6 };
      g.ui.showCaption('PELAGIA', '4 h 12 m ship time · falling toward Lethe', 4.5);
      self.world.clock.ship += 4.2 * 3600;
      self.world.clock.earth += 11 * 86400;
      yield { real: 3 };
      self.setupDescent(true);
      g.ui.setFade(false);
      yield { real: 1 };
      g.ui.setLetterbox(false);
      g.cutscene = null;
      g.pilot.lockControls = false;
    })());
  }

  // ---- stage: descent ---------------------------------------------------------
  setupDescent(fromTransfer = false) {
    const g = this.game, W = this.world, K = W.kestrel;
    this.reachStage('descent');
    if (W.docking.state !== 'free') W.docking.state = 'free';
    W.meridianActive = false;
    K.attached = null; K.body.frozen = false;
    W.setPrimary(PELAGIA);
    g.planetView.setPlanet(PELAGIA);
    g.sky.setSystem('lethe');
    g.sky.setBlackHole(PELAGIA_BH.dir, PELAGIA_BH.dist, PELAGIA_BH.inc);
    // 110 km circular orbit; deorbit point placed so we come down in daylight under Lethe
    const st = circularState(PELAGIA, 110e3, -0.55);
    K.body.pos.copy(st.pos); K.body.vel.copy(st.vel);
    K.fuel = fromTransfer ? Math.min(K.capacity, 17000) : 17000;
    K.gearDown = false; K.hull = Math.max(K.hull, 90); K.thermal.T = 260;
    pointKestrel(W, K.body.pos.clone().sub(st.vel), K.body.pos.clone().normalize());
    g.enterFlight('chase');
    g.pilot.setCamera('chase');
    this.phase = 'deorbit';
    this.arrival = { ship: W.clock.ship, earth: W.clock.earth };
    if (!fromTransfer) ['board', 'undock', 'burn'].forEach((i) => this.complete(i));
    this.saveCheckpoint('Pelagia orbit', { snapshot: false });
    this.checkpointStage = 'descent';
    const self = this;
    this.run((function* () {
      yield { real: 1.5 };
      yield* self.lines([
        ['case', `Pelagia orbit, one hundred ten kilometres. Lethe fills half the sky. From here on, one second of ours is ${formatDuration(ORBITS.pelagia.factor)} of Earth's.`],
        ...(settings.difficulty.helpers ? [
          ['case', 'Deorbit burn: hold W. I will turn us retrograde and cut the engine when we are low enough.'],
          ['case', 'After that, I fly the landing. H hands you the controls if you want them.'],
        ] : [
          ['case', 'Deorbit: point retrograde and burn about one hundred twenty metres per second. Then belly into the air and let it slow us. Gear with G.'],
          ['case', 'Watch the stop-distance readout. Burn when it matches your height.'],
        ]),
      ]);
    })());
  }

  // ---- the surface ------------------------------------------------------------
  makeSite() {
    const g = this.game, W = this.world;
    const n = predictedTouchdown(W);
    this.surface = new OceanSurface(g, PELAGIA, n);
    g.surface = this.surface;
    // Pelagia is tidally locked: Lethe hangs at a fixed spot in its sky.
    // Put that spot high above the landing site (hidden by the entry haze).
    const east = new Vector3(0, 1, 0).cross(n).normalize();
    g.sky.setBlackHole(n.clone().multiplyScalar(0.62).addScaledVector(east, -0.55).add(new Vector3(0, 0.56, 0)).normalize(), PELAGIA_BH.dist, PELAGIA_BH.inc);
    W.groundFn = (p) => this.surface.ground(p);
    // beacon ~220 m from the predicted touchdown point
    const a = Math.random() * Math.PI * 2;
    this.beaconLocal = new Vector3(Math.cos(a) * 220, 0, Math.sin(a) * 220);
    this.beaconLocal.y = this.surface.height(this.beaconLocal.x, this.beaconLocal.z);
    this.beacon = this.buildBeacon();
    this.beacon.position.copy(this.beaconLocal);
    this.surface.group.add(this.beacon);
    g.extraMeshes.push(this.surface.group);
  }

  buildBeacon() {
    const grp = new Group();
    const body = new Mesh(new CylinderGeometry(0.35, 0.45, 1.4, 16), new MeshStandardMaterial({ color: 0xd8641e, roughness: 0.6 }));
    body.position.y = 0.5;
    const ring = new Mesh(new TorusGeometry(0.47, 0.06, 8, 20), new MeshStandardMaterial({ color: 0x333333 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.6;
    const mast = new Mesh(new CylinderGeometry(0.03, 0.03, 1.6, 6), new MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.8 }));
    mast.position.y = 2.0;
    this.beaconLamp = new Mesh(new SphereGeometry(0.09, 10, 8), new MeshBasicMaterial({ color: new Color(8, 1, 0.5) }));
    this.beaconLamp.position.y = 2.85;
    body.castShadow = true;
    grp.add(body, ring, mast, this.beaconLamp);
    return grp;
  }

  touchdown() {
    const g = this.game, W = this.world, K = W.kestrel, self = this;
    this.phase = 'landed';
    this.complete('land');
    this.landing.on = false;
    K.cmd.throttle = 0;
    this.say('case', `Touchdown at ${Math.abs(this.touchV || 0).toFixed(1)} metres per second. Welcome to one point three g. You weigh ${(1.3 * 95).toFixed(0)} kilograms with the suit on — it will feel like it.`);
    this.run((function* () {
      yield { real: 2 };
      yield () => K.body.vel.distanceTo(W.surfaceVelocity(K.body.pos, new Vector3())) < 0.3;
      K.body.frozen = true;
      yield* self.line('case', 'Beacon bearing on your visor. Two hundred metres. Go on foot; I will keep the engine warm. E on the hatch when you come back.');
      self.startSurface();
    })());
  }

  startSurface(fromCheckpoint = false) {
    const g = this.game, W = this.world, K = W.kestrel, S = this.surface;
    this.phase = 'surface';
    this.reachStage('surface');
    const kl = S.toLocal(K.body.pos);
    this.kestrelLocal = kl;
    const sp = new SurfacePlayer(g, S);
    this.player = sp;
    const side = S.localDir(K.body.dirToWorld(new Vector3(1, 0, 0))).setY(0).normalize();
    const back = S.localDir(K.body.dirToWorld(new Vector3(0, 0, 1))).setY(0).normalize();
    // step off beside the nose, clear of the wing, facing the beacon
    sp.spawn(kl.x + side.x * 3.4 - back.x * 3.6, kl.z + side.z * 3.4 - back.z * 3.6, this.beaconLocal.clone().sub(kl).setY(0).normalize());
    sp.addLander(kl, side, back);
    sp.interactables.push({
      pos: new Vector3(this.beaconLocal.x, this.beaconLocal.y + 1, this.beaconLocal.z), radius: 2.4, hold: 3,
      prompt: 'Recover the SOUNDER-3 beacon', enabled: () => !this.hasBeacon, action: () => this.recoverBeacon(),
    });
    sp.interactables.push({
      pos: new Vector3(kl.x + side.x * 2.0, kl.y, kl.z + side.z * 2.0), radius: 3.2,
      prompt: 'Board the Kestrel', action: () => this.boardFromSurface(),
    });
    g.enterSurface(sp);
    this.surfaceT0 = W.time;
    if (!fromCheckpoint) this.saveCheckpoint('Pelagia surface', { snapshot: false });
    this.checkpointStage = 'surface';
    g.ui.hud.setCue('beacon', null);
    this.dilationCall = 0;
  }

  recoverBeacon() {
    const g = this.game, self = this;
    this.hasBeacon = true;
    this.beacon.visible = false;
    this.world.kestrel.extra = 40;
    g.audio?.clunk(0.4, 1.6);
    this.complete('beacon');
    const W = this.world;
    const spent = W.clock.earth - this.arrival.earth;
    this.run((function* () {
      yield* self.line('pilot', 'Got it. Heading back.');
      yield* self.line('case', `Beacon secured. For the record, Earth has aged ${formatDuration(spent)} since we arrived.`);
      yield { real: 1.5 };
      yield* self.line('case', 'Look at the horizon. Those are not mountains.');
      self.surface.startSurge(9000, 72);
      self.surgeOn = true;
      g.audio?.organ?.play('tension', 0.6);
      g.heart = 0.6;
      yield* self.line('case', `Tidal surge, ${self.tides.waveHeight.toFixed(0)} metres high. Lethe's tide, sweeping the shelf as Pelagia rocks. Run. Now.`);
    })());
  }

  boardFromSurface() {
    if (!this.hasBeacon) { this.say('case', 'The beacon first. We did not come all this way for a photo.', { key: 'nob', cooldown: 8 }); return; }
    const g = this.game, W = this.world, K = W.kestrel;
    this.player.dispose();
    this.player = null;
    K.body.frozen = false;
    g.enterFlight('cockpit');
    this.phase = 'liftoff';
    this.reachStage('ascent');
    this.say('case', 'Throttle up — Z — straight up first. We need to be above that water before it gets here.');
  }

  // ---- ascent ---------------------------------------------------------------------
  setupSurfaceStage() {
    // jump straight to standing on Pelagia
    this.setupDescent();
    const W = this.world, K = W.kestrel;
    this.makeSite();
    const S = this.surface;
    const p = S.toWorld(0, S.height(0, 0) + 2.28, 0);
    K.body.pos.copy(p);
    const up = p.clone().normalize();
    K.body.quat.setFromUnitVectors(new Vector3(0, 1, 0), up);
    K.body.updateDerived();
    K.body.vel.set(0, 0, 0); K.body.setAngularVelocity(new Vector3());
    K.body.frozen = true; K.gearDown = true;
    K.fuel = 15800;
    this.complete('land');
    this.startSurface();
  }

  setupAscentStage() {
    this.setupSurfaceStage();
    this.hasBeacon = true; this.beacon.visible = false;
    this.complete('beacon');
    this.surface.startSurge(7000, 72);
    this.surgeOn = true;
    this.boardFromSurface();
  }

  transferBack() {
    const g = this.game, self = this, W = this.world;
    this.phase = 'transfer2';
    this.complete('orbit');
    g.pilot.lockControls = true;
    g.ui.setLetterbox(true);
    const away = W.clock.earth - this.arrival.earth;
    this.run((function* () {
      yield* self.line('case', `Orbit. Delta-v remaining ${W.kestrel.deltaVMain().toFixed(0)} metres per second. The return slingshot will take nearly all of it.`);
      g.ui.setFade(true);
      yield { real: 1.6 };
      W.clock.ship += 3.1 * 3600;
      W.clock.earth += 9 * 86400;
      g.ui.showCaption('THE MERIDIAN', `We were down there ${formatDuration(self.surfaceTimeShip || 0)}. Earth aged ${formatDuration(away)}.`, 6);
      yield { real: 4 };
      self.surface?.dispose(); self.surface = null; g.surface = null; W.groundFn = null;
      self.setupRedock(true);
      g.ui.setFade(false);
      yield { real: 1 };
      g.ui.setLetterbox(false);
      g.pilot.lockControls = false;
    })());
  }

  setupRedock(fromTransfer = false) {
    const g = this.game, W = this.world, K = W.kestrel;
    this.reachStage('redock');
    W.setPrimary(SKADI);
    g.planetView.setPlanet(SKADI);
    g.sky.setSystem('lethe');
    g.sky.setBlackHole(SKADI_BH.dir, SKADI_BH.dist, SKADI_BH.inc);
    W.meridianActive = true;
    W.docking.state = 'free'; W.docking.latched = 0; W.docking.clearance = 0;
    K.attached = null; W.meridian.attachedKestrel = null;
    W.meridian.mass.remove('kestrel'); W.meridian.refreshMass();
    const st = circularState(SKADI, 300e3, 1.2);
    W.meridian.body.pos.copy(st.pos); W.meridian.body.vel.copy(st.vel);
    orientStation(W.meridian, lvlhBasis(st.pos, st.vel).y.negate());
    K.body.frozen = false;
    K.fuel = 85;                      // nearly dry: ~17 m/s of RCS delta-v
    K.gearDown = false;
    placeKestrelLvlh(W, new Vector3(-12, -420, 6), new Vector3(0, 0.25, 0));
    pointKestrel(W, W.meridian.portWorld(new Vector3()), W.meridian.body.pos.clone().normalize());
    g.enterFlight('chase');
    this.phase = 'redock';
    this.director.done.clear();
    this.director.lastRange = Infinity;
    if (!fromTransfer) ['board', 'undock', 'burn', 'land', 'beacon', 'escape', 'orbit'].forEach((i) => this.complete(i));
    this.saveCheckpoint('Re-dock · 420 m · 85 kg propellant');
    this.checkpointStage = 'redock';
    const self = this;
    this.run((function* () {
      yield { real: 1 };
      yield* self.lines([
        ['case', `Four hundred twenty metres. Eighty-five kilograms of propellant: ${K.deltaVRcs().toFixed(0)} metres per second of RCS. There is no main-engine margin at all.`],
        ['okafor', 'Kestrel, Meridian. We see you. Take it slow — we have been waiting long enough that a few more minutes won\'t matter.'],
        ['case', 'Fine RCS only. Every pulse counts. If we run dry we are a very expensive satellite.'],
      ]);
    })());
  }

  missionDone() {
    if (this.done) return;
    const W = this.world;
    this.complete('bridge');
    this.say('okafor', 'You\'re back. It\'s been a long time for us. Let me see that data.');
    this.finish({
      title: 'MISSION 3 COMPLETE', delay: 2500,
      lines: [['Ship time', formatDuration(W.clock.ship)], ['Earth time', '+' + formatDuration(W.clock.earth)], ['Propellant at dock', `${W.kestrel.fuel.toFixed(1)} kg`], ['Hull', `${W.kestrel.hull.toFixed(0)}%`], ['Bounces', `${this.director.bounces}`]],
      onNext: () => this.game.startMission(4), nextLabel: 'MISSION 4: SKADI',
    });
  }

  onRestore(extra) {
    // restoring a surface checkpoint: rebuild site and player around the Kestrel
    if (this.checkpointStage === 'surface' && this.surface) this.startSurface(true);
  }

  // ---- per frame ------------------------------------------------------------------
  frame(dt, input) {
    if (input.hit('KeyH')) this.landing.toggle();
  }

  update(simDt, realDt) {
    super.update(simDt, realDt);
    const g = this.game, W = this.world, K = W.kestrel;
    this.director.update(realDt);
    this.surface?.update(realDt, g.pipeline.origin);
    const hud = g.ui.hud;
    if (this.phase === 'walk' || this.phase === 'cockpit' || this.phase === 'releasing' || this.phase === 'clear' || this.phase === 'depart') {
      const left = this.windowEnd - W.time;
      hud.phaseText = 'BURN WINDOW';
      hud.phaseSub = left > 0 ? `closes in ${formatDuration(left)}` : 'CLOSED';
      if (left < 60 && left > 0) g.extraWarnings = [['BURN WINDOW ' + Math.ceil(left) + ' s', 'caution']];
      if (left <= 0 && !this.failed) this.fail('WINDOW MISSED', 'The transfer window to Pelagia closed. Next window: nine days — about sixty years on Pelagia.');
    }
    if (this.phase === 'depart') {
      const dv = W.kestrel.dvUsed - this.dv0;
      const pro = K.body.vel.clone().sub(W.meridian.body.vel);
      hud.phaseSub = `departure Δv ${dv.toFixed(1)} / 35 m/s · window ${formatDuration(this.windowEnd - W.time)}`;
      hud.setCue('burn', { dir: K.body.vel.clone().normalize(), icon: 'burn', cls: 'green', label: `DEPARTURE ${Math.max(0, 35 - dv).toFixed(1)} m/s`, clamp: true });
      g.pilot.burnTarget = { dir: K.body.vel.clone().normalize(), dv: Math.max(0, 35 - dv), now: true, terminal: true, label: 'DEPARTURE' };
      if (dv >= 35) { hud.setCue('burn', null); g.extraWarnings = []; hud.phaseText = null; hud.phaseSub = null; this.transferOut(); }
      void pro;
    }
    if (this.phase === 'deorbit' || this.phase === 'entry') this.updateDescent(realDt);
    if (this.phase === 'surface') this.updateSurface(realDt);
    if (this.phase === 'liftoff') this.updateAscent(realDt);
    if (this.surgeOn && this.surface) this.checkSurge();
    if (this.phase === 'redock' && K.fuel <= 0 && !this.dryTold) { this.dryTold = true; this.say('case', 'Propellant depleted. We are coasting. Whatever path we are on now is the one we keep.'); }
  }

  updateDescent() {
    const g = this.game, W = this.world, K = W.kestrel;
    const st = surfaceState(W, this.surface);
    const stop = stopDistance(W, st);
    g.ui.hud.phaseText = this.phase === 'deorbit' ? 'DEORBIT' : 'ENTRY & LANDING';
    if (this.phase === 'deorbit' && settings.difficulty.helpers) g.pilot.burnTarget = deorbitBurn(W, PELAGIA, 35e3);
    else if (g.pilot.burnTarget?.label === 'DEORBIT') g.pilot.burnTarget = null;
    g.ui.hud.phaseSub = `AGL ${(st.agl / 1000).toFixed(st.agl < 2000 ? 2 : 1)} km · v↓ ${(-st.vs).toFixed(0)} m/s · v→ ${st.vh.toFixed(0)} m/s · stop ${stop.toFixed(0)} m${this.landing.on ? ' · AUTO-LAND' : ''}`;
    const el = stateToElements(K.body.pos, K.body.vel, PELAGIA.gm);
    if (this.phase === 'deorbit' && el.rp - PELAGIA.radius < 40e3) { this.phase = 'entry'; this.say('case', 'Periapsis inside the atmosphere. We are committed. Belly forward — more drag, less heat per square metre.'); }
    if (!this.surface && st.agl < 9000) this.makeSite();
    // Simple flight: the computer takes the landing (H hands it back)
    if (this.surface && settings.difficulty.helpers && !this.landing.on && !this.landing.declined && st.agl < 6000 && st.vs < -5) {
      this.landing.toggle();
      this.say('case', 'Auto-land engaged. I will put us down. Press H if you want the controls.', { key: 'autoland', cooldown: 60 });
    }
    if (this.surface) this.landing.update(1 / 60, this.surface);
    if (K.thermal.T > 1400 && !this.hotTold) { this.hotTold = true; this.say('case', `Hull at ${K.thermal.T.toFixed(0)} kelvin. That orange glow is us.`); }
    if (st.agl < stop * 1.3 && st.agl < 4000 && -st.vs > 20 && !this.landing.on) this.game.extraWarnings = [['BURN NOW', '']];
    else this.game.extraWarnings = [];
    if (K.onGround && this.phase !== 'landed') {
      this.touchV = st.vs;
      if (K.hull <= 5) this.fail('CRASHED', 'The Kestrel hit the seabed too hard. Start the landing burn when stop distance matches your height.');
      else this.touchdown();
    }
  }

  updateSurface(dt) {
    const g = this.game, W = this.world;
    this.player?.visuals(dt);
    // beacon blink + bearing cue
    if (this.beaconLamp) this.beaconLamp.visible = (W.time % 1.2) < 0.15 || !this.hasBeacon && (W.time % 1.2) < 0.3;
    this.dilationCall -= dt;
    if (this.dilationCall <= 0 && !this.surgeOn) {
      this.dilationCall = 45;
      const t = W.time - this.surfaceT0;
      if (t > 10) this.say('case', `Surface time ${formatDuration(t)}. Earth: ${formatDuration(t * ORBITS.pelagia.factor)} gone.`);
    }
    if (this.surgeOn && this.player) {
      const p = this.player.walker.pos;
      const arr = -this.surface.surgeArrival(p.x, p.z);
      g.extraWarnings = [];
      g.ui.hud.phaseText = null;
      if (arr > 0) g.ui.setCoriolis(`SURGE ARRIVAL ${arr.toFixed(0)} s · ${(this.surface.surgeHeight(p.x, p.z)).toFixed(0)} m and rising`);
    }
  }

  checkSurge() {
    const W = this.world, K = W.kestrel, S = this.surface;
    let p, h;
    if (this.player) { p = this.player.walker.pos; h = S.surgeHeight(p.x, p.z); if (h > 1.6 + p.y) this.swept('You were caught in the open by the surge.'); return; }
    const l = S.toLocal(K.body.pos);
    h = S.surgeHeight(l.x, l.z);
    if (h > l.y - 2) this.swept('The surge caught the Kestrel before it was high enough.');
    if (l.y > 2500 && this.phase === 'liftoff' && !this.escaped) {
      this.escaped = true;
      this.complete('escape');
      this.say('case', 'Above the surge. That was closer than I would have liked. I do not usually like things.');
      this.game.heart = 0;
      this.game.audio?.organ?.setIntensity(0.4);
    }
  }

  swept(text) {
    if (this.failed) return;
    this.game.audio?.explosion(0.8);
    this.game.shake = 3;
    this.fail('SWEPT AWAY', text + ' The surge front moves at seventy metres per second — get airborne with a minute to spare.');
  }

  updateAscent() {
    const g = this.game, W = this.world, K = W.kestrel;
    const cue = ascentCue(W, PELAGIA, 110e3);
    g.pilot.burnTarget = { dir: cue.dir, cut: cue.apAlt > 110e3 };
    g.ui.hud.setCue('asc', { dir: cue.dir, icon: 'cue', cls: 'green', label: `PITCH ${cue.e.toFixed(0)}°`, clamp: true });
    g.ui.hud.phaseText = 'ASCENT';
    g.ui.hud.phaseSub = `Ap ${(cue.apAlt / 1000).toFixed(1)} km · Δv ${K.deltaVMain().toFixed(0)} m/s · q ${(K.q / 1000).toFixed(1)} kPa`;
    if (!this.surfaceTimeShip && K.body.pos.length() - PELAGIA.radius > 3000) this.surfaceTimeShip = W.time - this.surfaceT0;
    if (cue.apAlt > 108e3 && !this.mecoTold) { this.mecoTold = true; this.say('case', 'Apoapsis one hundred ten. Cut the engine and circularise at apoapsis.'); }
    if (cue.el.rp - PELAGIA.radius > 95e3) { g.ui.hud.setCue('asc', null); g.ui.hud.phaseText = null; g.ui.hud.phaseSub = null; this.transferBack(); }
    if (K.fuel <= 0 && cue.el.rp < PELAGIA.radius && !this.failed) this.fail('OUT OF PROPELLANT', 'The Kestrel ran dry before reaching orbit. Fly the pitch cue closely: in 1.3 g every second of gravity loss costs 12.7 m/s.');
  }

  visuals(dt) { if (this.phase === 'surface') this.player?.visuals(dt); }

  dispose() {
    super.dispose();
    this.player?.dispose();
    this.surface?.dispose();
    this.game.surface = null;
  }
}
