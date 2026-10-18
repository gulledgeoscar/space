// The player aboard the Meridian, simulated in the station's rotating frame:
// walking (centrifugal "gravity" + Coriolis), climbing the spoke ladder
// (gravity fading linearly with radius, Coriolis pressing you into or
// pulling you off the rungs), and floating in the hub and the docked
// Kestrel with a stabilised suit pack. Hatches and the ladder top are
// "transits": E starts a short guided glide through the tight bits.
//
// Camera rules: first person whenever floating, climbing or gliding (the
// cabin, tunnel and spoke are too tight for anything else); over the
// shoulder when walking, pulled in by a sphere-cast against the same
// collision volume the player uses, so it can never leave the hull.

import { Vector3, Quaternion, Matrix4, Vector2, Mesh, CylinderGeometry, MeshStandardMaterial, CatmullRomCurve3 } from 'three';
import { Walker } from './onFoot.js';
import { Floater } from './zeroG.js';
import { buildAstronaut } from './astronaut.js';
import { MeridianInterior } from '../ship/meridianInterior.js';
import {
  SPOKE_THETA, LADDER_OFF, R, toStation, fromStation, ROOMS, SPOKE_S, kestrelToStation, kestrelUp, KESTREL_HATCH,
} from '../ship/interiorLayout.js';
import { nextWaypoint } from './interiorRoute.js';
import { centrifugal, coriolis } from '../physics/rotatingFrame.js';
import { G0, HUB_R } from '../physics/constants.js';
import { settings } from '../core/settings.js';

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

const EYE_H = 1.62;          // walking eye height above the feet
const LADDER_EYE = 1.63;     // eye above the feet on the ladder (radially inward)

export class InteriorPlayer {
  constructor(game) {
    this.game = game;
    this.interior = null;
    this.walker = new Walker();
    this.floater = new Floater();
    this.mode = 'walk';
    this.firstPerson = false;
    this.flashlight = false;
    this.camLocal = new Vector3();
    this.camLocalQuat = new Quaternion();
    this.ladder = { rho: 30, rate: 0, coriolis: 0, g: 0 };
    this.bolts = [];
    this.area = '';
    this.enabled = true;
    this.omegaB = new Vector3(0, 0, 0.4952);
    this.env = this.makeEnv();
    this.stepAcc = 0;
    this.focusInteract = null;
    this.camTransition = null;
    this.mouse = { x: 0, y: 0 };
    this.headPitch = 0;
    this.ladderYaw = 0;
    this.camDist = 2.0;
    this.autoFP = false;
    this.glide = null;
    this.waypoint = null;
  }

  ensureBuilt() {
    if (this.interior) return;
    this.interior = new MeridianInterior(this.game);
    this.game.meridianModel.root.add(this.interior.group);
    this.model = buildAstronaut();
    this.interior.group.add(this.model.root);
    this.boltGeo = new CylinderGeometry(0.02, 0.02, 0.07, 8);
    this.boltMat = new MeshStandardMaterial({ color: 0xb8b8b0, metalness: 0.9, roughness: 0.3 });
    this.game.interior = this;
  }

  get space() { return this.interior.space; }
  get roll() { return this.interior.space.kestrelRoll || 0; }

  makeEnv() {
    const self = this;
    return {
      gravity(p, out) {
        const S = self.game.world.meridian.body;
        _w.set(p.x - S.comBody.x, p.y - S.comBody.y, p.z - S.comBody.z);
        return centrifugal(self.omegaB, _w, out);
      },
      accel(p, v, out) {
        const S = self.game.world.meridian.body;
        _w.set(p.x - S.comBody.x, p.y - S.comBody.y, p.z - S.comBody.z);
        centrifugal(self.omegaB, _w, out);
        return out.add(coriolis(self.omegaB, v, _v));
      },
      sdf: (p) => self.interior.space.sdf(p),
      gradient: (p, out) => self.interior.space.gradient(p, out),
    };
  }

  // ---- geometry helpers -------------------------------------------------------
  spokeRadial() { return new Vector3(Math.cos(SPOKE_THETA), Math.sin(SPOKE_THETA), 0); }
  ladderRadial() { return this.spokeRadial(); }
  ladderTangent() { return new Vector3(-Math.sin(SPOKE_THETA), Math.cos(SPOKE_THETA), 0); }
  hubUp() { return this.spokeRadial().negate(); }              // Spoke A is "down" in the hub
  hatchPos() { return kestrelToStation(KESTREL_HATCH.x, KESTREL_HATCH.y, KESTREL_HATCH.z, this.roll); }
  hatchesOpen() {
    const g = this.game, D = g.world.docking;
    return this.interior.space.kestrelDocked && D.state === 'hard' && D.pressure >= 1 && g.hatchOpen;
  }
  // cabin interaction points follow the docked Kestrel's roll index
  syncKestrelInteracts() {
    const it = this.interior, roll = this.roll;
    kestrelToStation(0, 0.6, -4.45, roll, it.seatInteract.pos);
    kestrelToStation(KESTREL_HATCH.x, KESTREL_HATCH.y, KESTREL_HATCH.z, roll, it.hatchOut.pos);
  }
  // which way is "up" for a floating player at p
  refUpAt(p) {
    const a = this.interior.space.area(p);
    if (a === 'kestrel' && p.z > 5.6) return kestrelUp(this.roll);
    if (a === 'kestrel') return new Vector3(0, 0, 0).add(kestrelUp(this.roll)).lerp(this.hubUp(), Math.min(1, Math.max(0, (5.6 - p.z) / 1.2))).normalize();
    return this.hubUp();
  }

  // ---- entering -------------------------------------------------------------
  spawn(where, opts = {}) {
    this.ensureBuilt();
    const W = this.walker, F = this.floater;
    this.interior.space.kestrelDocked = this.game.world.docking.state === 'hard';
    this.interior.space.kestrelRoll = this.game.world.docking.capturedRoll || 0;
    this.syncKestrelInteracts();
    this.glide = null;
    if (where === 'bridge' || where === 'bridgeConsole' || where === 'airlock' || where === 'ring') {
      const s = where === 'bridge' ? 12.0 : where === 'bridgeConsole' ? 5.3 : where === 'airlock' ? SPOKE_S - 2.5 : opts.s ?? 30;
      toStation(s, 0.02, opts.z ?? 0, W.pos);
      W.vel.set(0, 0, 0);
      const t = new Vector3(-Math.sin(s / R), Math.cos(s / R), 0);
      W.forward.copy(t).multiplyScalar(opts.facing ?? 1);
      W.up.set(-Math.cos(s / R), -Math.sin(s / R), 0);
      W.pitch = 0;
      this.mode = 'walk';
    } else if (where === 'hub') {
      F.pos.set(0, 0, 2.0);
      F.vel.set(0, 0, 0);
      F.lookAlong(this.spokeRadial().multiplyScalar(HUB_R).sub(F.pos), this.hubUp());
      this.mode = 'float';
    } else if (where === 'seat') {
      // unstrapped, floating beside the pilot seat, facing the nose hatch
      const roll = this.roll;
      kestrelToStation(0.72, 0.45, -4.4, roll, F.pos);
      F.vel.set(0, 0, 0);
      F.lookAlong(this.hatchPos().sub(F.pos), kestrelUp(roll));
      this.mode = 'float';
    }
    this.camDist = 1.0;
    this.camTransition = opts.fromCamera ? { t: 0, dur: 1.0, from: opts.fromCamera } : null;
    this.enabled = true;
    this.area = '';
  }

  // ---- transits (guided glides through hatches / onto the ladder) ------------
  transit(kind) {
    const F = this.floater, roll = this.roll;
    const K = (x, y, z) => kestrelToStation(x, y, z, roll);
    const start = this.playerPos(new Vector3());
    const r = this.spokeRadial(), t = this.ladderTangent();
    let pts, dur, end;
    if (kind === 'toHub') {
      pts = [start, K(0, 0.0, -5.15), K(0, -0.1, -5.9), K(0, -0.04, -6.7), new Vector3(0, 0, 4.9), new Vector3(0, 0, 3.2), new Vector3(0, -0.4, 1.4)];
      dur = 4.2;
      end = () => { this.toFloatAt(pts[pts.length - 1], r.clone().multiplyScalar(HUB_R).sub(pts[pts.length - 1]), this.hubUp()); };
      this.game.audio?.hiss(0.6, 0.08);
    } else if (kind === 'toCabin') {
      pts = [start, new Vector3(0, 0, 3.4), new Vector3(0, 0, 4.9), K(0, -0.04, -6.7), K(0, -0.1, -5.9), K(0, 0.05, -5.15), K(0.72, 0.45, -4.4)];
      dur = 4.2;
      end = () => { const p = pts[pts.length - 1]; this.toFloatAt(p, K(-0.3, 0.6, -5.6).sub(p), kestrelUp(roll)); };
      this.game.audio?.hiss(0.6, 0.08);
    } else if (kind === 'toLadder') {
      const rho0 = HUB_R + 1.0;
      const eye = r.clone().multiplyScalar(rho0 - LADDER_EYE).addScaledVector(t, LADDER_OFF - 0.42);
      pts = [start, r.clone().multiplyScalar(HUB_R - 1.6).addScaledVector(t, 0.2), eye];
      dur = 2.4;
      end = () => { this.toLadder(rho0); this.headPitch = -0.85; };
    } else return;
    this.glide = { curve: new CatmullRomCurve3(pts), t: 0, dur, end, kind, look0: F.forward(), up0: this.camUp ? this.camUp.clone() : this.refUpAt(start) };
    this.mode = 'glide';
    this.game.ui.prompt(null);
    this.game.emit('player:transit', kind);
  }

  stepGlide(dt) {
    const G = this.glide;
    G.t += dt;
    if (G.t >= G.dur) { this.glide = null; G.end(); return; }
  }

  glidePose() {
    const G = this.glide;
    const e = Math.min(1, G.t / G.dur);
    const k = e * e * (3 - 2 * e);
    const pos = G.curve.getPointAt(k);
    const tan = G.curve.getTangentAt(Math.min(0.999, k + 0.04));
    const up = this.refUpAt(pos);
    // look along the path, easing in from where you were looking
    const fwd = G.look0.clone().lerp(tan, Math.min(1, e * 3)).normalize();
    return { pos, fwd, up };
  }

  // ---- per frame --------------------------------------------------------------
  frame(dt, input) {
    if (!this.interior || !this.enabled) return;
    const sens = settings.get('mouseSensitivity');
    const m = this.game.mouse;
    this.mouse.x += m.x * 0.0022 * sens;
    this.mouse.y += m.y * 0.0022 * sens * (settings.get('invertY') ? -1 : 1);
    if (input.hit('KeyV')) this.firstPerson = !this.firstPerson;
    if (input.hit('KeyF')) this.toggleFlashlight();
    if (input.hit('KeyB') && this.mode !== 'glide') this.dropBolt();
    this.updateInteract(input);
  }

  toggleFlashlight() { this.flashlight = !this.flashlight; this.game.audio?.click(); }

  fixedUpdate(dt, input) {
    if (!this.interior || !this.enabled) return;
    const S = this.game.world.meridian.body;
    _q.copy(S.quat).invert();
    this.omegaB.copy(S.omega).applyQuaternion(_q);
    const yaw = -this.mouse.x, pitch = -this.mouse.y;
    this.mouse.x = 0; this.mouse.y = 0;
    const moveVec = new Vector2(input.axis('KeyA', 'KeyD'), input.axis('KeyS', 'KeyW'));
    if (moveVec.lengthSq() > 1) moveVec.normalize();
    this.interior.space.kestrelDocked = this.game.world.docking.state === 'hard';
    if (this.mode === 'glide') {
      this.stepGlide(dt);
    } else if (this.mode === 'walk') {
      const W = this.walker;
      W.pitch = Math.max(-1.45, Math.min(1.45, W.pitch + pitch));
      W.step(dt, this.env, { move: moveVec, run: input.key('ShiftLeft') || input.key('ShiftRight'), jump: input.hit('Space'), yaw });
      if (W.landed > 5.5) this.hardLanding(W.landed);
      if (W.grounded && W.speed > 0.3) {
        this.stepAcc += W.speed * dt;
        if (this.stepAcc > (W.running ? 1.1 : 0.75)) { this.stepAcc = 0; this.game.audio?.footstep('metal', Math.min(1.4, W.gEff / G0)); }
      }
      // weak gravity and airborne -> float
      if (W.gEff < 1.0 && !W.grounded && W.airTime > 0.25) this.toFloatAt(W.pos.clone().addScaledVector(W.up, 0.95), W.forward.clone(), W.up.clone(), W.vel.clone());
      // walk into the ladder to grab it
      if (this.nearLadder(W.pos.clone().addScaledVector(W.up, 0.95)) < 0.75 && moveVec.y > 0 && W.forward.dot(this.ladderTangent()) > 0.6) this.toLadder();
    } else if (this.mode === 'float') {
      const F = this.floater;
      const move = new Vector3(moveVec.x, (input.key('Space') ? 1 : 0) - (input.key('ControlLeft') || input.key('KeyC') ? 1 : 0), moveVec.y);
      F.step(dt, this.env, { yaw, pitch, move, boost: input.key('ShiftLeft') || input.key('ShiftRight'), refUp: this.refUpAt(F.pos) });
      if (F.lastImpact > 4) this.hardLanding(F.lastImpact);
      else if (F.lastImpact > 0.6) this.game.audio?.clunk(Math.min(0.6, F.lastImpact * 0.3), 1.4);
      // floating down into Spoke A: grab the ladder
      const rho = Math.hypot(F.pos.x, F.pos.y);
      if (this.interior.space.area(F.pos) === 'spoke' && rho > HUB_R + 0.5 && rho < R - 3) this.toLadder(Math.max(HUB_R + 1.0, rho + 0.95));
      // enough gravity and a floor under the feet -> walk
      this.env.gravity(F.pos, _v);
      const g = _v.length();
      if (g > 1.6 && F.touching && F.contactNormal && F.contactNormal.dot(_v.clone().normalize().negate()) > 0.7) this.toWalk();
    } else if (this.mode === 'ladder') {
      this.stepLadder(dt, input, yaw, pitch);
    }
    this.updateBolts(dt);
  }

  // ---- ladder -----------------------------------------------------------------
  nearLadder(p) {
    const r = this.ladderRadial(), t = this.ladderTangent();
    const rho = p.dot(r);
    if (rho < HUB_R - 1 || rho > R + 0.2) return 99;
    const off = p.clone().addScaledVector(r, -rho).addScaledVector(t, -LADDER_OFF);
    return Math.hypot(off.dot(t) + 0.45, off.z);
  }
  // rhoFeet: radial position of the feet on the ladder
  toLadder(rhoFeet = null) {
    const r = this.ladderRadial();
    let rho = rhoFeet;
    if (rho === null) rho = this.mode === 'walk' ? this.walker.pos.dot(r) : this.floater.pos.dot(r) + 0.95;
    this.ladder.rho = Math.min(R - 0.02, Math.max(HUB_R + 0.8, rho));
    this.ladder.rate = 0;
    this.headPitch = 0;
    this.ladderYaw = 0;
    this.mode = 'ladder';
    this.game.audio?.clunk(0.2, 2.2);
    this.game.emit('player:ladder', true);
  }
  stepLadder(dt, input, yaw, pitch) {
    const L2 = this.ladder;
    const g = this.omegaB.lengthSq() * L2.rho;            // w^2 r, fades toward the hub
    const climb = input.axis('KeyS', 'KeyW');                // + = up (toward the hub)
    const vmax = (input.key('ShiftLeft') || input.key('ShiftRight') ? 2.0 : 1.3) * (0.8 + 0.6 * (1 - Math.min(1, g / G0)));
    const target = -climb * vmax;                            // d(rho)/dt
    L2.rate += (target - L2.rate) * Math.min(1, dt * 5);
    L2.rho += L2.rate * dt;
    // Coriolis on the climber: a = -2 w x v, v = rho_dot r_hat -> -2 w rho_dot t_hat
    L2.coriolis = -2 * this.omegaB.z * L2.rate;              // + pushes spinward (into the rungs)
    L2.g = g;
    this.headPitch = Math.max(-1.3, Math.min(1.3, this.headPitch + pitch));
    this.ladderYaw = Math.max(-1.4, Math.min(1.4, this.ladderYaw + yaw));
    if (Math.abs(L2.rate) > 0.05) { this._rung = (this._rung || 0) + Math.abs(L2.rate) * dt; if (this._rung > 0.32) { this._rung = 0; this.game.audio?.footstep('metal', 0.5); } }
    // bottom: step off onto the airlock floor
    if (L2.rho >= R - 0.03 && climb < 0) { L2.rho = R - 0.03; this.toWalk(true); return; }
    if (L2.rho > R - 0.03) L2.rho = R - 0.03;
    // top: float out into the hub
    if (L2.rho < HUB_R + 0.75) {
      const r = this.ladderRadial();
      const p = this.ladderBodyPos(new Vector3()).addScaledVector(r, -0.6);
      this.toFloatAt(p, new Vector3(0, 0, 1), this.hubUp(), r.clone().multiplyScalar(-0.2));
      this.ladderTopAt = performance.now();
    }
  }
  ladderBodyPos(out) {
    const r = this.ladderRadial(), t = this.ladderTangent();
    const lean = Math.max(-0.12, Math.min(0.12, (this.ladder.coriolis || 0) * 0.12));
    return out.copy(r).multiplyScalar(this.ladder.rho - 0.95).addScaledVector(t, LADDER_OFF - 0.42 + lean);
  }

  toFloatAt(center, fwd, up, vel = new Vector3()) {
    const F = this.floater;
    F.pos.copy(center); F.vel.copy(vel);
    F.lookAlong(fwd, up);
    this.mode = 'float';
    this.game.emit('player:float');
  }
  toWalk(fromLadder = false) {
    const W = this.walker;
    if (fromLadder) {
      const r = this.ladderRadial(), t = this.ladderTangent();
      W.pos.copy(r).multiplyScalar(R - 0.02).addScaledVector(t, LADDER_OFF - 0.6);
      W.vel.set(0, 0, 0);
      W.forward.copy(t).negate();
      W.up.copy(r).negate();
      this.ladderOffAt = performance.now();
    } else {
      const F = this.floater;
      this.env.gravity(F.pos, _v);
      W.up.copy(_v).normalize().negate();
      W.pos.copy(F.pos).addScaledVector(W.up, -0.95);
      W.vel.copy(F.vel);
      W.forward.copy(F.forward()).addScaledVector(W.up, -F.forward().dot(W.up));
      if (W.forward.lengthSq() < 0.01) W.forward.set(0, 0, 1);
      W.forward.normalize();
    }
    W.pitch = 0;
    this.camDist = 0.6;
    this.mode = 'walk';
    this.game.emit('player:walk');
  }

  hardLanding(speed) {
    const g = this.game;
    g.fx.damage = Math.min(1, speed / 12);
    g.shake = Math.max(g.shake, speed / 4);
    g.audio?.clunk(Math.min(1.5, speed / 8), 1.1);
    if (!this._injT || performance.now() - this._injT > 6000) {
      this._injT = performance.now();
      g.ui.subs.say('case', speed > 9 ? `Impact at ${speed.toFixed(1)} metres per second. Please use the ladder.` : `Impact at ${speed.toFixed(1)} metres per second. Bruised, not broken.`, { key: 'fall', cooldown: 6 });
    }
  }

  // ---- interactions -------------------------------------------------------------
  playerPos(out = new Vector3()) {
    if (this.mode === 'glide') return out.copy(this.glidePose().pos);
    if (this.mode === 'walk') return out.copy(this.walker.pos).addScaledVector(this.walker.up, 1.2);
    if (this.mode === 'ladder') return this.ladderBodyPos(out);
    return out.copy(this.floater.pos);
  }
  updateInteract(input) {
    const ui = this.game.ui;
    if (this.mode === 'glide') { this.focusInteract = null; ui.prompt(null); return; }
    const p = this.playerPos(new Vector3());
    let best = null, bd = 1e9;
    for (const it of this.interior.interactables) {
      if (!it.enabled()) continue;
      const d = it.pos.distanceTo(p);
      if (d < it.radius && d < bd) { bd = d; best = it; }
    }
    this.focusInteract = best;
    if (best) {
      if (best.hold > 0) {
        if (input.key('KeyE')) best.progress += 1 / 60 / best.hold; else best.progress = 0;
        ui.prompt('E', best.prompt + ' (hold)', Math.min(1, best.progress));
        if (best.progress >= 1) { best.progress = 0; best.action(); }
      } else {
        ui.prompt('E', best.prompt);
        if (input.hit('KeyE')) best.action();
      }
    } else if (this.mode === 'ladder') {
      const L2 = this.ladder;
      ui.prompt('S', L2.rho > R - 4 ? 'Keep holding S to step off  ·  W climbs back up' : 'Climb down to the ring  ·  W climbs up to the hub');
    } else ui.prompt(null);
  }

  // current guidance target for the HUD (station frame), set by missions
  updateWaypoint() {
    const dest = this.game.mission?.interiorTarget?.();
    if (!dest || this.mode === 'glide' || this.game.cutscene) { this.waypoint = null; return; }
    this.waypoint = nextWaypoint(this.interior.space, this.playerPos(new Vector3()), dest, this.mode);
  }

  // ---- bolts (Coriolis demonstration) ------------------------------------------
  dropBolt() {
    const p = this.playerPos(new Vector3());
    const fwd = this.mode === 'walk' ? this.walker.forward.clone() : this.floater.forward();
    const pos = p.addScaledVector(fwd, 0.45);
    const vel = this.mode === 'walk' ? this.walker.vel.clone() : this.mode === 'float' ? this.floater.vel.clone() : new Vector3();
    const mesh = new Mesh(this.boltGeo, this.boltMat);
    mesh.castShadow = true;
    this.interior.group.add(mesh);
    const u = fromStation(pos);
    this.bolts.push({ pos, vel, mesh, t: 0, s0: u.s, h0: u.h, z0: u.z, done: false });
    if (this.bolts.length > 8) { const b = this.bolts.shift(); b.mesh.removeFromParent(); }
  }
  updateBolts(dt) {
    for (const b of this.bolts) {
      if (b.done) continue;
      b.t += dt;
      this.env.accel(b.pos, b.vel, _v);
      b.vel.addScaledVector(_v, dt);
      b.pos.addScaledVector(b.vel, dt);
      const d = this.interior.space.sdf(b.pos);
      if (d < 0.02) {
        this.interior.space.gradient(b.pos, _w);
        b.pos.addScaledVector(_w, 0.02 - d);
        const vn = b.vel.dot(_w);
        if (vn < 0) b.vel.addScaledVector(_w, -vn * 1.35);
        if (vn < -0.4) this.game.audio?.clunk(0.08, 3.5);
        b.vel.multiplyScalar(0.7);
        if (b.vel.length() < 0.05 || b.t > 6) {
          b.done = true;
          const u = fromStation(b.pos);
          const drift = u.s - b.s0;
          this.game.ui.subs.say('case', `The bolt landed ${Math.abs(drift * 100).toFixed(0)} centimetres ${drift < 0 ? 'antispinward' : 'spinward'} of where you dropped it. Coriolis: the floor moved, the bolt didn't.`, { key: 'bolt', cooldown: 4 });
        }
      }
      b.mesh.position.copy(b.pos);
      b.mesh.rotation.x += dt * 4;
    }
  }

  // ---- visuals + camera ----------------------------------------------------------
  visuals(dt) {
    if (!this.interior || this.game.mode !== 'interior') return;
    const pp = this.playerPos(new Vector3());
    this.interior.update(dt, pp);
    const a = this.model;
    a.lamp.intensity = this.flashlight ? 14 : 0;
    const root = a.root;
    if (this.mode === 'walk') {
      const W = this.walker;
      root.position.copy(W.pos);
      _m.makeBasis(new Vector3().crossVectors(W.up, W.forward).normalize().negate(), W.up, W.forward.clone().negate());
      root.quaternion.setFromRotationMatrix(_m);
      a.animate({ mode: W.speed > 0.15 ? (W.running ? 'run' : 'walk') : 'idle', speed: W.speed, dt });
    } else if (this.mode === 'ladder') {
      const t = this.ladderTangent();
      const body = this.ladderBodyPos(new Vector3());
      const up = this.ladderRadial().negate();
      root.position.copy(body).addScaledVector(up, -0.95);
      _m.makeBasis(new Vector3().crossVectors(up, t).normalize().negate(), up, t.clone().negate());
      root.quaternion.setFromRotationMatrix(_m);
      a.animate({ mode: 'climb', climbRate: Math.abs(this.ladder.rate), sideLean: Math.max(-0.2, Math.min(0.2, (this.ladder.coriolis || 0) * 0.15)), dt });
    } else if (this.mode === 'float') {
      const F = this.floater;
      root.quaternion.copy(F.quat);
      root.position.copy(F.pos).addScaledVector(F.up(), -0.95);
      a.animate({ mode: 'float', dt });
    }
    root.visible = this.mode === 'walk' && !this.firstPerson && !this.autoFP && !this.game.cutscene;
    // area announcements + ambience
    const area = this.interior.space.area(pp);
    if (area !== this.area) {
      this.area = area;
      const room = ROOMS.find((r) => r.id === area);
      const label = room ? room.name : area === 'spoke' ? 'SPOKE A' : area === 'hub' ? 'HUB · ZERO G' : area === 'kestrel' ? 'KESTREL' : '';
      if (label) this.game.ui.toast(label);
      this.game.emit('player:area', area);
    }
    const hs = this.interior.hydroS;
    const u = fromStation(pp);
    this.game.waterLevel = hs ? Math.max(0, 1 - Math.abs(u.s - hs) / 14) * (u.h > -1 && u.h < 4 ? 1 : 0) : 0;
    this.game.humScale = area === 'hub' || area === 'spoke' ? 0.6 : 1;
    this.updateWaypoint();
    this.updateStatusLine();
  }

  // one compact physics line (shown with the detailed HUD)
  updateStatusLine() {
    const ui = this.game.ui;
    const w = this.omegaB;
    let txt = '';
    if (this.mode === 'walk') {
      const W = this.walker;
      this.env.gravity(W.pos, _v);
      const cor = coriolis(w, W.vel, new Vector3());
      const vert = -cor.dot(W.up);
      txt = `${(_v.length() / G0).toFixed(2)} g` + (W.speed > 0.4 ? ` · Coriolis ${vert >= 0 ? '+' : ''}${(vert / G0).toFixed(2)} g` : '');
    } else if (this.mode === 'ladder') {
      const c = this.ladder.coriolis || 0;
      txt = `${(this.ladder.g / G0).toFixed(2)} g · r ${this.ladder.rho.toFixed(1)} m` + (Math.abs(c) > 0.05 ? ` · Coriolis ${c > 0 ? 'into the rungs' : 'off the ladder'}` : '');
    } else if (this.mode === 'float') {
      const F = this.floater;
      this.env.gravity(F.pos, _v);
      txt = `${(_v.length() / G0).toFixed(3)} g · suit gas ${(F.gas * 100).toFixed(0)}%`;
    }
    ui.setCoriolis(this.game.cutscene ? '' : txt);
  }

  // camera pose in station frame, then into world via the station model root
  updateCamera(dt, origin, camera) {
    if (!this.interior) return;
    const root = this.game.meridianModel.root;
    const pos = new Vector3(), quat = new Quaternion();
    let up, fwd, eye;
    let fp = true;
    if (this.mode === 'glide') {
      const gp = this.glidePose();
      eye = gp.pos; fwd = gp.fwd; up = gp.up;
    } else if (this.mode === 'walk') {
      const W = this.walker;
      up = W.up.clone();
      fwd = W.forward.clone().applyAxisAngle(new Vector3().crossVectors(W.forward, W.up).normalize(), W.pitch);
      eye = W.pos.clone().addScaledVector(up, EYE_H);
      fp = this.firstPerson;
    } else if (this.mode === 'ladder') {
      const t = this.ladderTangent();
      up = this.ladderRadial().negate();
      fwd = t.clone().applyAxisAngle(up, this.ladderYaw);
      fwd.applyAxisAngle(new Vector3().crossVectors(fwd, up).normalize(), this.headPitch);
      eye = this.ladderBodyPos(new Vector3()).addScaledVector(up, LADDER_EYE - 0.95);
    } else {
      const F = this.floater;
      up = F.up(); fwd = F.forward();
      eye = F.pos.clone().addScaledVector(up, 0.12);
    }
    this.camUp = up.clone();
    if (fp) {
      pos.copy(eye);
      this.autoFP = false;
    } else {
      // over the right shoulder, pulled in by a sphere-cast so it stays inside
      const right = new Vector3().crossVectors(fwd, up).normalize();
      const flatF = fwd.clone().addScaledVector(up, -fwd.dot(up)).normalize();
      const pivot = eye.clone().addScaledVector(up, -0.12);
      const want = pivot.clone().addScaledVector(flatF, -2.1).addScaledVector(up, 0.32 - fwd.dot(up) * 0.9).addScaledVector(right, 0.42);
      const dir = want.clone().sub(pivot);
      const maxD = dir.length();
      dir.normalize();
      const free = this.interior.space.march(pivot, want, 0.2);
      if (free < this.camDist) this.camDist = free;                         // pull in at once
      else this.camDist += (Math.min(free, maxD) - this.camDist) * Math.min(1, dt * 2.5); // ease back out
      if (this.camDist < 0.55) this.autoFP = true; else if (this.camDist > 0.9) this.autoFP = false;
      if (this.autoFP) pos.copy(eye);
      else pos.copy(pivot).addScaledVector(dir, this.camDist);
    }
    _m.lookAt(pos, pos.clone().add(fwd), up);
    quat.setFromRotationMatrix(_m);
    if (this.camTransition) {
      const tr = this.camTransition;
      tr.t += dt;
      const e = Math.min(1, tr.t / tr.dur);
      const k = e * e * (3 - 2 * e);
      pos.lerpVectors(tr.from.pos, pos, k);
      quat.slerpQuaternions(tr.from.quat, quat, k);
      if (e >= 1) this.camTransition = null;
    }
    this.camLocal.copy(pos); this.camLocalQuat.copy(quat);
    root.updateMatrixWorld();
    camera.position.copy(pos).applyMatrix4(root.matrixWorld);
    camera.quaternion.copy(root.quaternion).multiply(quat);
    const fov = settings.get('fov');
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    this.model.lamp.target.position.set(0, 0, -3);
  }

  reset() {
    for (const b of this.bolts) b.mesh.removeFromParent();
    this.bolts = [];
    this.flashlight = false;
    this.glide = null;
    this.waypoint = null;
  }

  debugLines() {
    if (this.game.mode !== 'interior') return [];
    const p = this.playerPos(new Vector3());
    const u = fromStation(p);
    const v = this.mode === 'walk' ? this.walker.vel : this.floater.vel;
    const cf = this.env.gravity(p, new Vector3());
    const cor = coriolis(this.omegaB, v, new Vector3());
    return [
      `PLAYER   mode ${this.mode}  r ${u.rho.toFixed(2)} m  θ ${(u.th * 57.3).toFixed(2)}°  z ${u.z.toFixed(2)}  area ${this.area}`,
      `         v_rot ${v.length().toFixed(2)} m/s  centrifugal ${cf.length().toFixed(3)} m/s² (${(cf.length() / G0).toFixed(3)} g)  Coriolis ${cor.length().toFixed(3)} m/s²`,
      `         ω_station ${this.omegaB.length().toFixed(4)} rad/s  a = ω²r  ${(this.omegaB.lengthSq() * u.rho).toFixed(3)} m/s²`,
    ];
  }
}
