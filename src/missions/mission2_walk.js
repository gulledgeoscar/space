// MISSION 2 - WALK THE SHIP.
// Float out of the docked Kestrel into the zero-g hub, climb down Spoke A
// as gravity builds (and the Coriolis force tugs you off the rungs), walk
// the ring to the bridge, take the briefing, then walk back and board.

import { Vector3 } from 'three';
import { Mission } from './missionBase.js';
import { setupDocked } from './scenario.js';
import { stationCamera } from './cinematics.js';
import { EARTH } from '../physics/bodies.js';
import { toStation } from '../ship/interiorLayout.js';
import { buildAstronaut } from '../player/astronaut.js';
import { ORBITS } from '../physics/timeDilation.js';

export function placeCrew(game, name, s, h, z, facing = 1, pose = 'sit', suit = 0x3f6f9a) {
  const ip = game.interiorPlayer;
  ip.ensureBuilt();
  const a = buildAstronaut({ suit, accent: 0xe8c27a, name });
  toStation(s, h, z, a.root.position);
  const up = a.root.position.clone().setZ(0).normalize().negate();
  const fwd = new Vector3(-Math.sin(s / 40), Math.cos(s / 40), 0).multiplyScalar(facing);
  a.root.up.copy(up);
  a.root.lookAt(a.root.position.clone().sub(fwd));
  a.animate({ mode: pose, dt: 0 });
  ip.interior.group.add(a.root);
  game.extraMeshes.push(a.root);
  return a;
}

export class WalkMission extends Mission {
  static id = 2;
  start() {
    const g = this.game;
    if (!this.keepWorld) {
      setupDocked(g, EARTH, 400e3, { theta: 0.8 });
      g.enterInterior(this.stage === 'hub' ? 'hub' : 'seat');
    }
    this.okafor = placeCrew(g, 'okafor', 10.6, 0.05, 2.1, 1, 'sit');
    this.briefingText = ['MERIDIAN EXPEDITION ONE', 'Transit: the Aperture, 22 months', 'Target: LETHE · 1e9 M☉ · spin 1 − 10⁻¹⁴', `PELAGIA · ocean · 1.3 g · dt/dτ ${ORBITS.pelagia.factor.toFixed(0)}`, 'SKADI · ice · 0.85 g · Vance beacon', '1 hour on Pelagia = 7 years at home'];
    this.objectives('WALK THE SHIP', 'Hub → Spoke A → ring → bridge, and back', [
      ['hatch', 'Float through the hatch into the hub'],
      ['spoke', 'Climb down Spoke A to the ring'],
      ['bridge', 'Walk the ring to the bridge'],
      ['brief', 'Take the briefing at the main console'],
      ['back', 'Return to the docking port and board the Kestrel'],
    ]);
    this.reachStage('hub');
    this.phase = 'start';
    if (this.keepWorld && this.game.interiorPlayer.area === 'hub') { this.phase = 'hub'; this.complete('hatch'); }
    this.on('player:area', (a) => this.onArea(a));
    this.on('player:ladder', () => { if (!this.ladderTold) { this.ladderTold = true; this.say('case', 'Thirty-two metres of ladder. Gravity grows linearly with radius: zero up here, one g at the bottom.'); } });
    this.on('interact:bridgeConsole', () => this.briefing());
    this.on('interact:board', () => this.board());
    this.flavour();
    const self = this;
    this.run((function* () {
      yield { real: 1.5 };
      yield* self.line('case', 'Hard dock holding. Pressure is equal. Welcome home, more or less.');
      yield* self.line('case', 'The hatch is open. Push off the cabin wall with Space, hold E to grab the handrails, or use the suit thrusters: W A S D, R and F. Gas is limited.');
      yield* self.line('okafor', 'Kestrel, Okafor. Come down to the bridge when you can. Briefing in ten.');
    })());
  }

  flavour() {
    const say = (k, t) => this.say('case', t, { key: k, cooldown: 60 });
    this.on('interact:coffee', () => say('coffee', 'The coffee is reconstituted from a powder that was coffee once. Spiritually, it still is.'));
    this.on('interact:lockers', () => say('lockers', 'Personal lockers. Yours contains a photo, three socks and a chess set with one bishop missing.'));
    this.on('interact:whiteboard', () => say('wb', 'Okafor\'s whiteboard. The bottom line is the one that matters: one hour on Pelagia, seven years at home.'));
    this.on('interact:plants', () => say('plants', 'Lettuce, soy, dwarf tomatoes. Rack four is a test. Do not eat rack four.'));
    this.on('interact:spokeB', () => say('spokeb', 'Spoke B has been sealed since the micrometeoroid strike in month nine. Use Spoke A.'));
    this.on('interact:suitGas', () => { this.game.interiorPlayer.floater.gas = 1; say('gas', 'Thruster pack refilled.'); this.game.audio?.hiss(1.2, 0.15); });
    this.on('interact:hubLog', () => say('hub', `Hub status: spin ${(this.world.meridian.spinRate * 9.549).toFixed(2)} RPM, ring gravity 1.00 g. Everything that floats in here drifts outward eventually.`));
  }

  onArea(a) {
    const ip = this.game.interiorPlayer;
    if (a === 'hub' && this.phase === 'start') {
      this.phase = 'hub';
      this.complete('hatch');
      this.say('case', 'This is the hub. Near the axis the centrifugal pull is a few thousandths of a g. Not nothing: anything you let go of drifts slowly outward.');
      this.say('case', 'Spoke A is the hatch with the yellow ring. The ladder is on its spinward wall.');
    }
    if (a === 'spoke' && this.phase === 'hub') {
      this.phase = 'spoke';
      this.say('case', 'Climbing down you are moving outward, so the Coriolis force pushes you antispinward — off the rungs. Climbing up pushes you into them. Hold on.');
    }
    if (a === 'airlock' && (this.phase === 'spoke' || this.phase === 'hub')) {
      this.phase = 'ring';
      this.complete('spoke');
      this.say('case', 'One g at the floor. The floor curves up ahead of you because it is the inside of a forty-metre wheel.');
      this.say('case', 'The bridge is five modules spinward. Walking spinward you weigh a little more; walking back, a little less. Press B to drop a bolt and watch where it lands.');
    }
    if (a === 'bridge' && this.phase === 'ring') { this.phase = 'bridge'; this.complete('bridge'); this.say('okafor', 'There you are. Main console, when you\'re ready.'); }
    if (a === 'hydro' && !this._hydro) { this._hydro = true; this.say('okafor', 'Mind the grow lights. They make everyone look like a bruise.'); }
    if (a === 'lab' && !this._lab) { this._lab = true; this.say('case', 'The science lab. Dr. Okafor would like you to know the centrifuge is calibrated and you should not touch it.'); }
    void ip;
  }

  briefing() {
    if (this.phase !== 'bridge' || this.briefed) return;
    this.briefed = true;
    const g = this.game, self = this;
    const ip = g.interiorPlayer;
    ip.enabled = false;
    g.ui.setLetterbox(true);
    const cs = 17.2;
    g.cutscene = { camera: stationCamera(g, toStation(cs - 2.6, 1.55, 0.3), toStation(cs + 0.75, 1.85, 0), { fov: 42, drift: (t, p) => p.add(new Vector3(0, 0, Math.sin(t * 0.1) * 0.4)) }) };
    this.run((function* () {
      yield* self.lines([
        ['okafor', 'Twenty-two months to the Aperture. On the other side: Lethe.'],
        ['case', 'A black hole of a billion solar masses, spinning at one minus ten to the minus fourteen of the maximum. That last number is the whole story.'],
        ['okafor', 'Two worlds worth a look. Pelagia is an ocean. It orbits so close to Lethe that time down there runs sixty-one thousand times slower than here.'],
        ['case', 'One hour on Pelagia is seven years on Earth. I did the arithmetic four times. It does not improve.'],
        ['okafor', 'Skadi is ice, further out. Theo Vance went there alone eight years ago in the Wren. His beacon still says "habitable".'],
        ['okafor', 'Every trip down and back ends in a docking. Out there there is nobody to catch us if we miss.'],
        ['case', 'So: no missing. The Kestrel is fuelled. Walk back to the docking port when you are ready.'],
      ]);
      g.cutscene = null;
      g.ui.setLetterbox(false);
      ip.enabled = true;
      self.complete('brief');
      self.phase = 'return';
    })());
  }

  board() {
    if (this.phase !== 'return') {
      this.say('case', 'The briefing first. Dr. Okafor has slides. Well — words.', { key: 'nobrief', cooldown: 10 });
      return;
    }
    this.complete('back');
    this.finish({
      title: 'MISSION 2 COMPLETE', delay: 800,
      lines: [['Ship time', (this.world.clock.ship / 60).toFixed(1) + ' min'], ['Bolts dropped', String(this.game.interiorPlayer.bolts.length)]],
      onNext: () => this.game.startMission(3), nextLabel: 'MISSION 3: UNDOCK & PELAGIA',
    });
  }
}
