// The player aboard the Meridian, simulated in the station's rotating frame:
// walking (centrifugal "gravity" + Coriolis), climbing the spoke ladder
// (gravity fading linearly with radius, Coriolis pressing you into or
// pulling you off the rungs), and free floating in the hub.

import { Vector3, Quaternion, Matrix4, Vector2, Mesh, CylinderGeometry, MeshStandardMaterial } from 'three';
import { Walker } from './onFoot.js';
import { Floater } from './zeroG.js';
import { buildAstronaut } from './astronaut.js';
import { MeridianInterior } from '../ship/meridianInterior.js';
import { SPOKE_THETA, LADDER_OFF, R, L, toStation, fromStation, ROOMS, SPOKE_S } from '../ship/interiorLayout.js';
import { centrifugal, coriolis } from '../physics/rotatingFrame.js';
import { G0, HUB_R, RING_CEIL_R, KESTREL_DOCKED_Z } from '../physics/constants.js';
import { settings } from '../core/settings.js';

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

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
    this.ladder = { rho: 30, rate: 0, push: 0 };
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
  }

  ensureBuilt() {
    if (this.interior) return;
    this.interior = new MeridianInterior(this.game);
    this.game.meridianModel.root.add(this.interior.group);
    this.model = buildAstronaut();
    this.interior.group.add(this.model.root);
    const boltMat = new MeshStandardMaterial({ color: 0xb8b8b0, metalness: 0.9, roughness: 0.3 });
    this.boltGeo = new CylinderGeometry(0.02, 0.02, 0.07, 8);
    this.boltMat = boltMat;
    this.game.interior = this;
  }

  get space() { return this.interior.space; }

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

  // ---- entering -------------------------------------------------------------
  spawn(where, opts = {}) {
    this.ensureBuilt();
    const W = this.walker, F = this.floater;
    this.interior.space.kestrelDocked = this.game.world.docking.state === 'hard';
    this.interior.space.kestrelRoll = this.game.world.docking.capturedRoll || 0;
    if (where === 'bridge' || where === 'bridgeConsole' || where === 'airlock' || where === 'ring') {
      const s = where === 'bridge' ? 9.0 : where === 'bridgeConsole' ? 15.6 : where === 'airlock' ? SPOKE_S - 2.5 : opts.s ?? 30;
      toStation(s, 0.02, opts.z ?? 0, W.pos);
      W.vel.set(0, 0, 0);
      const t = new Vector3(-Math.sin(s / R), Math.cos(s / R), 0);
      W.forward.copy(t).multiplyScalar(opts.facing ?? 1);
      W.up.set(-Math.cos(s / R), -Math.sin(s / R), 0);
      this.mode = 'walk';
    } else if (where === 'hub') {
      F.pos.set(0, -1.2, 0);
      F.vel.set(0, 0, 0);
      F.quat.setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(Math.cos(SPOKE_THETA), Math.sin(SPOKE_THETA), 0).negate());
      this.mode = 'float';
    } else if (where === 'seat') {
      // floating just behind the pilot seat in the docked Kestrel
      const roll = this.interior.space.kestrelRoll;
      const p = new Vector3(0, 0.3, -3.7).applyAxisAngle(new Vector3(0, 0, 1), roll);
      F.pos.set(p.x, p.y, p.z + KESTREL_DOCKED_Z);
      F.vel.set(0, 0, -0.05);
      F.quat.setFromAxisAngle(new Vector3(0, 0, 1), roll);
      this.mode = 'float';
    }
    this.camTransition = opts.fromCamera ? { t: 0, dur: 1.2, from: opts.fromCamera } : null;
    this.enabled = true;
    this.area = '';
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
    if (input.hit('KeyB')) this.dropBolt();
    // interactions
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
    if (this.mode === 'walk') {
      const W = this.walker;
      W.pitch = Math.max(-1.45, Math.min(1.45, W.pitch + pitch));
      W.step(dt, this.env, { move: moveVec, run: input.key('ShiftLeft'), jump: input.hit('Space'), yaw });
      if (W.landed > 5.5) this.hardLanding(W.landed);
      if (W.grounded && W.speed > 0.3) {
        this.stepAcc += W.speed * dt;
        if (this.stepAcc > (W.running ? 1.1 : 0.75)) { this.stepAcc = 0; this.game.audio?.footstep('metal', Math.min(1.4, W.gEff / G0)); }
      }
      // weak gravity and airborne -> float
      if (W.gEff < 1.0 && !W.grounded && W.airTime > 0.25) this.toFloat(W.pos.clone().addScaledVector(W.up, 0.95), W.vel.clone());
      // mount the ladder by walking into it
      if (this.nearLadder(W.pos.clone().addScaledVector(W.up, 0.95)) < 0.75 && moveVec.y > 0 && W.forward.dot(this.ladderTangent()) > 0.6) this.toLadder();
    } else if (this.mode === 'float') {
      const F = this.floater;
      // suit pack: WASD planar, Space up (or push off when touching), Ctrl/C down
      const thrust = new Vector3(input.axis('KeyA', 'KeyD'), (input.key('Space') && !F.touching ? 1 : 0) - (input.key('ControlLeft') || input.key('KeyC') ? 1 : 0), input.axis('KeyW', 'KeyS'));
      const grab = input.key('KeyE') && !this.focusInteract;
      F.step(dt, this.env, { look: { x: -yaw, y: -pitch }, roll: input.axis('KeyE', 'KeyQ') * (grab ? 0 : 1), thrust: grab ? null : thrust, grab, railMove: grab ? moveVec.y : 0, push: input.hit('Space') && F.touching }, this.interior.rails);
      if (F.lastImpact > 4) this.hardLanding(F.lastImpact);
      else if (F.lastImpact > 0.6) this.game.audio?.clunk(Math.min(0.6, F.lastImpact * 0.3), 1.4);
      // enough gravity and a floor under the feet -> walk
      this.env.gravity(F.pos, _v);
      const g = _v.length();
      if (g > 1.6 && F.touching && F.contactNormal && F.contactNormal.dot(_v.clone().normalize().negate()) > 0.7) this.toWalk();
      if (this.nearLadder(F.pos) < 0.8 && input.hit('KeyE')) this.toLadder();
    } else if (this.mode === 'ladder') {
      this.stepLadder(dt, input, yaw, pitch);
    }
    this.updateBolts(dt);
  }

  // ---- ladder -----------------------------------------------------------------
  ladderRadial() { return new Vector3(Math.cos(SPOKE_THETA), Math.sin(SPOKE_THETA), 0); }
  ladderTangent() { return new Vector3(-Math.sin(SPOKE_THETA), Math.cos(SPOKE_THETA), 0); }
  nearLadder(p) {
    const r = this.ladderRadial(), t = this.ladderTangent();
    const rho = p.dot(r);
    if (rho < HUB_R - 1 || rho > R + 0.2) return 99;
    const off = p.clone().addScaledVector(r, -rho).addScaledVector(t, -LADDER_OFF);
    return Math.hypot(off.dot(t) + 0.45, off.z);
  }
  toLadder() {
    const p = this.mode === 'walk' ? this.walker.pos.clone() : this.floater.pos.clone().addScaledVector(this.ladderRadial(), 0.95);
    this.ladder.rho = Math.min(R - 0.02, Math.max(HUB_R + 0.6, p.dot(this.ladderRadial())));
    this.ladder.rate = 0;
    this.mode = 'ladder';
    this.game.audio?.clunk(0.2, 2.2);
    this.game.emit('player:ladder', true);
  }
  stepLadder(dt, input, yaw, pitch) {
    const L2 = this.ladder;
    const g = this.omegaB.lengthSq() * L2.rho;            // w^2 r, fades toward the hub
    const climb = input.axis('KeyS', 'KeyW');                // + = up (toward hub)
    const vmax = (input.key('ShiftLeft') ? 1.5 : 1.0) * (0.75 + 0.6 * (1 - Math.min(1, g / G0)));
    const target = -climb * vmax;                            // d(rho)/dt
    L2.rate += (target - L2.rate) * Math.min(1, dt * 5);
    L2.rho += L2.rate * dt;
    // Coriolis on the climber: a = -2 w x v, v = rho_dot r_hat -> -2 w rho_dot t_hat
    L2.coriolis = -2 * this.omegaB.z * L2.rate;              // + pushes spinward (into the rungs)
    L2.g = g;
    this.headPitch = Math.max(-1.2, Math.min(1.2, this.headPitch + pitch));
    this.ladderYaw = Math.max(-1.3, Math.min(1.3, (this.ladderYaw || 0) + yaw));
    if (Math.abs(L2.rate) > 0.05) { this._rung = (this._rung || 0) + Math.abs(L2.rate) * dt; if (this._rung > 0.32) { this._rung = 0; this.game.audio?.footstep('metal', 0.5); } }
    // bottom: step off onto the airlock floor
    if (L2.rho >= R - 0.03 && climb < 0) { L2.rho = R - 0.03; this.toWalk(true); return; }
    if (L2.rho > R - 0.03) L2.rho = R - 0.03;
    // top: float out into the hub
    if (L2.rho < HUB_R + 0.75) {
      const r = this.ladderRadial();
      const p = this.ladderBodyPos(new Vector3());
      this.toFloat(p, r.clone().multiplyScalar(-0.35));
      this.floater.quat.setFromUnitVectors(new Vector3(0, 0, -1), r.clone().negate());
      return;
    }
    if (input.hit('Space')) {
      const p = this.ladderBodyPos(new Vector3());
      this.toFloat(p, this.ladderRadial().multiplyScalar(L2.rate).addScaledVector(this.ladderTangent(), -0.4));
      this.game.ui.toast('LET GO OF THE LADDER');
    }
  }
  ladderBodyPos(out) {
    const r = this.ladderRadial(), t = this.ladderTangent();
    const lean = Math.max(-0.12, Math.min(0.12, (this.ladder.coriolis || 0) * 0.12));
    return out.copy(r).multiplyScalar(this.ladder.rho - 0.95).addScaledVector(t, LADDER_OFF - 0.42 + lean);
  }

  toFloat(center, vel) {
    const F = this.floater;
    F.pos.copy(center); F.vel.copy(vel);
    if (this.mode === 'walk') {
      const W = this.walker;
      const m = new Matrix4().makeBasis(new Vector3().crossVectors(W.forward, W.up).normalize(), W.up, W.forward.clone().negate());
      F.quat.setFromRotationMatrix(m);
    }
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
      g.ui.subs.say('case', speed > 9
        ? `You hit at ${speed.toFixed(1)} metres per second. In the rotating frame you were falling the whole way down that spoke. Please use the ladder.`
        : `Impact at ${speed.toFixed(1)} metres per second. Bruised, not broken.`, { key: 'fall', cooldown: 6 });
    }
  }

  // ---- interactions -------------------------------------------------------------
  playerPos(out = new Vector3()) {
    if (this.mode === 'walk') return out.copy(this.walker.pos).addScaledVector(this.walker.up, 1.2);
    if (this.mode === 'ladder') return this.ladderBodyPos(out);
    return out.copy(this.floater.pos);
  }
  updateInteract(input) {
    const p = this.playerPos(new Vector3());
    let best = null, bd = 1e9;
    for (const it of this.interior.interactables) {
      if (!it.enabled()) continue;
      const d = it.pos.distanceTo(p);
      if (d < it.radius && d < bd) { bd = d; best = it; }
    }
    this.focusInteract = best;
    const ui = this.game.ui;
    if (best) {
      if (best.hold > 0) {
        if (input.key('KeyE')) best.progress += 1 / 60 / best.hold; else best.progress = 0;
        ui.prompt('E', best.prompt + ' (hold)', Math.min(1, best.progress));
        if (best.progress >= 1) { best.progress = 0; best.action(); }
      } else {
        ui.prompt('E', best.prompt);
        if (input.hit('KeyE')) best.action();
      }
    } else if (this.mode === 'float' && this.nearRail()) ui.prompt('E', 'Hold to grab handrail');
    else if (this.mode !== 'ladder' && this.nearLadder(p) < 1.2) ui.prompt(this.mode === 'walk' ? 'W' : 'E', 'Climb the ladder');
    else if (this.mode === 'ladder') ui.prompt('W/S', `Climb · Space let go · ${(this.ladder.g / G0).toFixed(2)} g`);
    else ui.prompt(null);
  }
  nearRail() {
    for (const r of this.interior.rails) {
      const ab = new Vector3().subVectors(r.b, r.a);
      const t = Math.max(0, Math.min(1, new Vector3().subVectors(this.floater.pos, r.a).dot(ab) / ab.lengthSq()));
      if (r.a.clone().addScaledVector(ab, t).distanceTo(this.floater.pos) < 0.75) return true;
    }
    return false;
  }

  // ---- bolts (Coriolis demonstration) ------------------------------------------
  dropBolt() {
    const p = this.playerPos(new Vector3());
    let fwd;
    if (this.mode === 'walk') fwd = this.walker.forward.clone(); else fwd = this.floater.forward();
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
          this.game.ui.subs.say('case', `Bolt fell ${(b.h0 - u.h).toFixed(2)} metres in ${b.t.toFixed(2)} seconds and landed ${Math.abs(drift * 100).toFixed(1)} centimetres ${drift < 0 ? 'antispinward' : 'spinward'} of where it was dropped. Coriolis. The floor moved; the bolt didn't.`, { key: 'bolt', cooldown: 4 });
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
    const lamp = a.lamp;
    lamp.intensity = this.flashlight ? 14 : 0;
    // model pose
    const root = a.root;
    if (this.mode === 'walk') {
      const W = this.walker;
      root.position.copy(W.pos);
      _m.makeBasis(new Vector3().crossVectors(W.up, W.forward).normalize().negate(), W.up, W.forward.clone().negate());
      root.quaternion.setFromRotationMatrix(_m);
      a.animate({ mode: W.speed > 0.15 ? (W.running ? 'run' : 'walk') : 'idle', speed: W.speed, dt });
    } else if (this.mode === 'ladder') {
      const r = this.ladderRadial(), t = this.ladderTangent();
      const body = this.ladderBodyPos(new Vector3());
      const up = r.clone().negate();
      root.position.copy(body).addScaledVector(up, -0.95);
      _m.makeBasis(new Vector3().crossVectors(up, t).normalize().negate(), up, t.clone().negate());
      root.quaternion.setFromRotationMatrix(_m);
      a.animate({ mode: 'climb', climbRate: Math.abs(this.ladder.rate), sideLean: Math.max(-0.2, Math.min(0.2, (this.ladder.coriolis || 0) * 0.15)), dt });
    } else {
      const F = this.floater;
      root.quaternion.copy(F.quat);
      root.position.copy(F.pos).addScaledVector(F.up(), -0.95);
      a.animate({ mode: 'float', dt });
    }
    root.visible = (!this.firstPerson && !this.autoFP) || !!this.game.cutscene;
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
    this.updateCoriolisReadout();
  }

  updateCoriolisReadout() {
    const ui = this.game.ui;
    const w = this.omegaB;
    let txt = '';
    if (this.mode === 'walk') {
      const W = this.walker;
      const cor = coriolis(w, W.vel, new Vector3());
      this.env.gravity(W.pos, _v);
      const g = _v.length();
      const felt = _v.clone().add(cor);
      const vert = -cor.dot(W.up);
      const sw = W.vel.dot(new Vector3(0, 0, 1).cross(W.up).negate());
      if (W.speed > 0.4) txt = `APPARENT ${(felt.length() / G0).toFixed(2)} g · Coriolis ${vert >= 0 ? '+' : ''}${(vert / G0).toFixed(2)} g (${sw > 0 ? 'running spinward: heavier' : 'running antispinward: lighter'})`;
      else txt = `${(g / G0).toFixed(2)} g · r = ${Math.hypot(W.pos.x, W.pos.y).toFixed(1)} m`;
    } else if (this.mode === 'ladder') {
      const c = this.ladder.coriolis || 0;
      txt = `${(this.ladder.g / G0).toFixed(2)} g · r = ${this.ladder.rho.toFixed(1)} m` + (Math.abs(c) > 0.05 ? ` · CORIOLIS ${Math.abs(c).toFixed(2)} m/s² ${c > 0 ? 'pressing you into the rungs' : 'pulling you off the ladder'}` : '');
    } else {
      const F = this.floater;
      this.env.gravity(F.pos, _v);
      txt = `${(_v.length() / G0).toFixed(3)} g · drift ${F.vel.length().toFixed(2)} m/s · suit gas ${(F.gas * 100).toFixed(0)}%${F.grabbing ? ' · HOLDING RAIL' : ''}`;
    }
    ui.setCoriolis(this.game.cutscene ? '' : txt);
  }

  // camera pose in station frame, then into world via the station model root
  updateCamera(dt, origin, camera) {
    if (!this.interior) return;
    const root = this.game.meridianModel.root;
    const target = new Vector3(), pos = new Vector3(), quat = new Quaternion();
    let up, fwd;
    if (this.mode === 'walk') {
      const W = this.walker;
      up = W.up.clone();
      fwd = W.forward.clone().applyAxisAngle(new Vector3().crossVectors(W.forward, W.up).normalize(), W.pitch);
      target.copy(W.pos).addScaledVector(up, 1.62);
    } else if (this.mode === 'ladder') {
      const t = this.ladderTangent();
      up = this.ladderRadial().negate();
      fwd = t.clone().applyAxisAngle(up, this.ladderYaw || 0);
      fwd.applyAxisAngle(new Vector3().crossVectors(fwd, up).normalize(), this.headPitch);
      target.copy(this.ladderBodyPos(new Vector3())).addScaledVector(up, 0.68);
    } else {
      const F = this.floater;
      up = F.up(); fwd = F.forward();
      target.copy(F.pos).addScaledVector(up, 0.66);
    }
    this.autoFP = false;
    if (this.firstPerson) pos.copy(target).addScaledVector(fwd, 0.12);
    else {
      const back = target.clone().addScaledVector(fwd, -2.3).addScaledVector(up, 0.45);
      const d = this.interior.space.march(target, back, 0.18);
      // too tight for a chase camera (spoke, Kestrel cabin): go first person
      if (d < 1.05) { this.autoFP = true; pos.copy(target).addScaledVector(fwd, 0.12); }
      else pos.copy(target).addScaledVector(back.sub(target).normalize(), d);
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
    // helmet lamp follows the view
    this.model.lamp.target.position.set(0, 0, -3);
  }

  reset() {
    for (const b of this.bolts) b.mesh.removeFromParent();
    this.bolts = [];
    this.flashlight = false;
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
