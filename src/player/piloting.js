// Piloting controller for the Kestrel.
//
// REALISTIC / EXPERT: inputs map straight to RCS jets and throttle.
//   W/S fwd/back  A/D left/right  R/F up/down      (translation)
//   mouse / arrows pitch+yaw      Q/E roll         (rotation)
//   Z/X throttle up/down  Backspace cut  T RCS fine/coarse  G gear
//
// SIMPLE (the 'assisted' difficulty) puts a fly-by-wire flight computer in
// between. It only ever commands the same jets and engine the pilot could
// fire, burning the same propellant - the physics is never altered:
//   - the mouse/arrows point the nose and it holds there (never tumbles);
//   - near the Meridian, W/S set an approach speed and the computer holds
//     it, routes round the ring onto the docking axis, cancels drift, keeps
//     a speed it can always stop from, and inside 400 m lines the Kestrel
//     up with the port and matches the station's spin;
//   - elsewhere W fires the main engine while held; for a guided burn
//     (a mission or the rendezvous computer offers a direction and a dv)
//     holding W turns onto it, burns and cuts off when it is done;
//   - 1-0 remain as optional attitude holds.

import { Vector3, Quaternion, Vector2, MathUtils, Matrix4 } from 'three';
import { KESTREL } from '../ship/kestrel.js';
import { settings } from '../core/settings.js';

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _qi = new Quaternion();
const _m4 = new Matrix4();

export const ATT_MODES = {
  Digit1: 'prograde', Digit2: 'retrograde', Digit3: 'normal', Digit4: 'antinormal',
  Digit5: 'radial-out', Digit6: 'radial-in', Digit7: 'target', Digit8: 'anti-target', Digit9: 'port-align', Digit0: 'burn',
};

// default chase view: just behind and above the Kestrel, close enough to
// read its attitude and see the RCS puffs
export const CHASE_DEFAULT = { yaw: 0, pitch: 0.17, dist: 14 };

export class PilotController {
  constructor(game) {
    this.game = game;
    this.camMode = 'cockpit';
    this.stick = new Vector2();
    this.attMode = null;
    this.killRot = false;
    this.killVel = false;
    this.chase = { ...CHASE_DEFAULT };
    this.chaseIdle = 0;
    this.look = { yaw: 0, pitch: 0 };
    this.camOff = new Vector3();
    this.camQuat = new Quaternion();
    this.transition = null;
    this.burnTarget = null;     // { dir: Vector3 world, dv: m/s } from planners
    this.enabled = true;
    this.allowMain = true;
    this.lockControls = false;
    this.lastInput = { t: new Vector3(), r: new Vector3() };
    // simple flight state
    this.aim = null;               // world direction the nose should point
    this.aimIn = new Vector2();    // mouse aim accumulated since the last step
    this.aimIdle = 99;             // seconds since the player last steered
    this.speedSet = 0;             // fly-by-wire approach speed, m/s (+ = toward the port)
    this.fbw = null;               // status for the HUD
    this.wBoost = null;            // throttle to restore after a W boost
    this.burn = null;              // guided burn in progress
    this.wLatch = false;           // W must be released before it fires again
  }

  get simple() { return settings.difficulty.helpers; }

  get world() { return this.game.world; }
  get kestrel() { return this.game.world.kestrel; }
  get helpers() { return settings.difficulty.helpers; }

  // --- per-frame (input sampling, camera) -----------------------------------
  frame(dt, input) {
    const K = this.kestrel;
    if (!this.enabled) return;
    const mouse = this.game.mouse;
    const sens = settings.get('mouseSensitivity');
    const inv = settings.get('invertY') ? -1 : 1;
    const look = input.mouseButton(2) || input.key('AltLeft');
    if (look) {
      if (this.camMode === 'chase') {
        this.chase.yaw -= mouse.x * 0.004 * sens;
        this.chase.pitch = MathUtils.clamp(this.chase.pitch + mouse.y * 0.004 * sens, -1.4, 1.4);
        this.chaseIdle = 0;
      } else {
        this.look.yaw = MathUtils.clamp(this.look.yaw - mouse.x * 0.003 * sens, -2.2, 2.2);
        this.look.pitch = MathUtils.clamp(this.look.pitch - mouse.y * 0.003 * sens, -1.2, 1.2);
      }
    } else if (input.locked && !this.lockControls && !this.game.mapOpen && this.simple) {
      this.aimIn.x += mouse.x * 0.0022 * sens;
      this.aimIn.y += mouse.y * 0.0022 * sens * inv;
    } else if (input.locked && !this.lockControls && !this.game.mapOpen) {
      this.stick.x = MathUtils.clamp(this.stick.x - mouse.x * 0.0035 * sens, -1, 1);
      this.stick.y = MathUtils.clamp(this.stick.y - mouse.y * 0.0035 * sens * inv, -1, 1);
    }
    // stick springs back to centre
    const k = Math.exp(-dt / 0.18);
    this.stick.multiplyScalar(k);
    if (!look) { this.look.yaw *= Math.exp(-dt / 0.6); this.look.pitch *= Math.exp(-dt / 0.6); }
    if (mouse.wheel && this.camMode === 'chase') this.chase.dist = MathUtils.clamp(this.chase.dist * (1 + mouse.wheel * 0.12), 6, 4000);
    // after a few seconds without dragging, swing back behind the ship
    this.chaseIdle += dt;
    if (!look && this.chaseIdle > 3 && this.chase.dist < 60) {
      const k = Math.min(1, dt * 0.8);
      this.chase.yaw += (Math.atan2(Math.sin(CHASE_DEFAULT.yaw - this.chase.yaw), Math.cos(CHASE_DEFAULT.yaw - this.chase.yaw))) * k;
      this.chase.pitch += (CHASE_DEFAULT.pitch - this.chase.pitch) * k;
    }

    // while hard-docked: unstrap into the ship, or release the latches
    const D = this.world.docking;
    if (D.state === 'hard' && this.game.mode === 'flight' && !this.game.cutscene) {
      const m = this.game.mission;
      const canExit = D.pressure >= 1 && m?.allowExit?.() !== false;
      const canUndock = !!m?.allowUndock?.();
      const parts = [];
      if (canExit) parts.push('E unstrap & float to the hatch');
      if (canUndock) parts.push('U release latches');
      this.game.ui.prompt(parts.length ? 'E/U' : null, parts.join('  ·  '));
      if (canExit && input.hit('KeyE')) { this.game.ui.prompt(null); this.game.enterInterior('seat', { blend: true }); return; }
      if (canUndock && input.hit('KeyU')) { D.release(); m.onUndockStart?.(); }
    } else if (this.game.mode === 'flight' && this._dockPrompt) this.game.ui.prompt(null);
    this._dockPrompt = D.state === 'hard';
    if (this.lockControls) return;
    if (input.hit('KeyT')) {
      K.rcsMode = K.rcsMode === 'fine' ? 'coarse' : 'fine';
      this.game.emit('rcsMode', K.rcsMode);
    }
    if (input.hit('KeyG')) { K.gearDown = !K.gearDown; this.game.emit('gear', K.gearDown); }
    if (input.hit('Backspace')) K.cmd.throttle = 0;
    if (this.helpers) {
      // (simple flight always holds attitude and cancels drift, so the old
      // K / L toggles are gone; 1-0 remain as optional attitude holds)
      this.killRot = false; this.killVel = false;
      for (const [code, mode] of Object.entries(ATT_MODES)) {
        if (input.hit(code)) {
          this.attMode = this.attMode === mode ? null : mode;
          this.killRot = false;
          this.game.emit('assist', this.attMode ? `HOLD ${mode.toUpperCase()}` : 'ATTITUDE HOLD OFF');
        }
      }
    } else {
      this.killRot = false; this.killVel = false; this.attMode = null;
    }
    if (input.hit('KeyC')) this.cycleCamera();
  }

  cycleCamera() {
    const order = this.availableCams();
    const i = order.indexOf(this.camMode);
    this.setCamera(order[(i + 1) % order.length]);
  }
  availableCams() {
    const D = this.world.docking;
    if (settings.difficulty.expertCam && D.rel.range < 300 && this.world.meridianActive) return ['dock'];
    return ['cockpit', 'chase', 'dock'];
  }
  setCamera(mode) {
    if (mode === this.camMode) return;
    this.transition = { fromOff: this.camOff.clone(), fromQuat: this.camQuat.clone(), fromFov: this.game.pipeline.camera.fov, t: 0, dur: 0.7 };
    this.camMode = mode;
    this.game.emit('camera', mode);
  }

  // --- per fixed step: commands + flight computer ---------------------------
  fixedUpdate(dt, input) {
    const K = this.kestrel;
    const cmd = K.cmd;
    if (!this.enabled || this.lockControls || K.body.frozen) {
      cmd.t.set(0, 0, 0); cmd.r.set(0, 0, 0);
      this.fbw = null; this.burn = null; this.aim = null;
      if (!this.enabled) cmd.throttle = 0;
      return;
    }
    if (this.simple) { this.simpleFlight(dt, input); return; }
    // translation (body axes; forward = -Z)
    cmd.t.set(input.axis('KeyA', 'KeyD'), input.axis('KeyF', 'KeyR'), input.axis('KeyW', 'KeyS'));
    // rotation: x = pitch (nose up +), y = yaw (nose left +), z = roll (left +)
    const kp = input.axis('ArrowDown', 'ArrowUp');
    const ky = input.axis('ArrowRight', 'ArrowLeft');
    const kr = input.axis('KeyE', 'KeyQ');
    cmd.r.set(MathUtils.clamp(kp + this.stick.y, -1, 1), MathUtils.clamp(ky + this.stick.x, -1, 1), kr);
    const manualRot = Math.abs(kp) + Math.abs(ky) + Math.abs(kr) + this.stick.length() > 0.08;
    const manualTrans = cmd.t.lengthSq() > 0;
    this.lastInput.t.copy(cmd.t); this.lastInput.r.copy(cmd.r);
    // throttle
    if (this.allowMain) {
      if (input.key('KeyZ')) cmd.throttle = Math.min(1, cmd.throttle + dt * (input.key('ShiftLeft') ? 2.0 : 0.45));
      if (input.key('KeyX')) cmd.throttle = Math.max(0, cmd.throttle - dt * (input.key('ShiftLeft') ? 2.0 : 0.45));
    } else cmd.throttle = 0;

    if (!this.helpers) return;
    // flight computer (assisted only)
    const ref = this.referenceOmega(_c);
    if (this.attMode && !manualRot) {
      const tgt = this.attitudeTarget(this.attMode);
      if (tgt) this.pointAt(tgt.fwd, tgt.up, ref, cmd.r);
    } else if (this.killRot && !manualRot) {
      this.holdRate(ref, cmd.r);
    }
    if (this.killVel && !manualTrans) this.nullRelativeVelocity(cmd.t);
  }

  // ---- simple flight (fly-by-wire) ------------------------------------------
  // context: 'dock' (< 400 m from the port), 'approach' (< 6 km), 'free'
  flightContext() {
    const W = this.world, D = W.docking;
    const wants = W.meridianActive && D.state === 'free' && (this.game.mission?.wantsDocking?.() ?? true);
    if (!wants) return 'free';
    return D.rel.range < 400 ? 'dock' : D.rel.range < 6000 ? 'approach' : 'free';
  }

  simpleFlight(dt, input) {
    const W = this.world, K = this.kestrel, b = K.body, cmd = K.cmd, D = W.docking;
    // in contact with the port (capture, latching, docked): hands off
    if (W.meridianActive && D.state !== 'free') {
      cmd.t.set(0, 0, 0); cmd.r.set(0, 0, 0); cmd.throttle = 0;
      this.speedSet = 0; this.burn = null; this.wBoost = null; this.aim = null; this.wLatch = true;
      this.fbw = { ctx: 'dock', auto: 'CAPTURE', leg: 'final', speedSet: 0, speed: 0, vSafe: 0, closing: D.rel.closing, range: D.rel.range };
      return;
    }
    const nose = new Vector3(0, 0, -1).applyQuaternion(b.quat);
    if (!this.aim) this.aim = nose.clone();
    // steering: the mouse and arrow keys move the aim point, the ship follows
    const upB = new Vector3(0, 1, 0).applyQuaternion(b.quat), rightB = new Vector3(1, 0, 0).applyQuaternion(b.quat);
    const yaw = -this.aimIn.x + input.axis('ArrowRight', 'ArrowLeft') * dt * 0.7;
    const pitch = -this.aimIn.y + input.axis('ArrowDown', 'ArrowUp') * dt * 0.7;
    this.aimIn.set(0, 0);
    if (Math.abs(yaw) + Math.abs(pitch) > 1e-6) {
      this.aim.applyAxisAngle(upB, yaw).applyAxisAngle(rightB, pitch).normalize();
      // never let the aim run more than ~50 degrees ahead of the nose
      const ang = this.aim.angleTo(nose);
      if (ang > 0.9) this.aim.copy(nose).lerp(this.aim, 0.9 / ang).normalize();
      this.aimIdle = 0;
    } else this.aimIdle += dt;
    const manual = this.aimIdle < 3;
    const ctx = this.flightContext();
    const S = W.meridian;
    const ref = new Vector3();
    let up = null, auto = '';
    if (ctx === 'dock') {
      // turn with the station - but only the part of her spin that is a roll
      // for us (the Kestrel can't tumble end over end at her rate)
      const c = S.axisWorld(ref).dot(nose);
      ref.copy(nose).multiplyScalar(S.spinRate * c);
      if (!manual) { const t = this.attitudeTarget('port-align'); this.aim.copy(t.fwd); up = t.up; auto = 'AUTO-ALIGN TO PORT'; }
    } else if (ctx === 'approach' && !manual) {
      this.aim.subVectors(D.rel.portWorld, b.pos).normalize();
      auto = 'POINTING AT PORT';
    } else if (ctx === 'free' && (this.burn || (this.burnTarget && (this.attMode === 'burn' || !manual || input.key('KeyW'))))) {
      this.aim.copy(this.burn ? this.burn.dir : this.burnTarget.dir).normalize();
      auto = 'FOLLOWING GUIDANCE';
    } else if (this.attMode && !manual) {
      const t = this.attitudeTarget(this.attMode);
      if (t) { this.aim.copy(t.fwd); up = t.up; auto = 'HOLD ' + this.attMode.toUpperCase(); }
    }
    this.pointAt(this.aim, up, ref, cmd.r);
    const roll = input.axis('KeyE', 'KeyQ');
    if (roll) cmd.r.z = roll;

    if (ctx === 'free') { this.freeFlight(dt, input, nose, auto); return; }

    // ---- fly-by-wire near the station: hold a commanded velocity ----
    cmd.throttle = 0;
    this.wBoost = null; this.burn = null;
    const axis = D.rel.axisWorld;
    // where the Kestrel is, relative to the port, in a frame that does not
    // turn with the station (z along her axis, lateral off it)
    const rel = new Vector3().copy(D.rel.pos).applyQuaternion(S.body.quat);
    const z = rel.dot(axis);
    const latV = rel.clone().addScaledVector(axis, -z);
    const lat = latV.length();
    const latDir = lat > 0.5 ? latV.clone().multiplyScalar(1 / lat) : new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
    if (latDir.lengthSq() < 0.5) latDir.set(1, 0, 0);
    // route: once inside the approach cone, straight down the axis; else to
    // a point on the axis in front of the port, swinging wide of the ring
    // if we are beside or behind her
    // (with some hysteresis once we are on the final leg, and right in to
    // the ring: the docking point is a metre or two short of the port)
    const inCone = z > -1 && lat < (this.finalLeg ? 5 + z * 0.4 : 2 + z * 0.12);
    this.finalLeg = inCone;
    let goal, leg;
    if (inCone) { goal = new Vector3(); leg = 'final'; }
    else if (z < 60 && lat < 160) { goal = latDir.clone().multiplyScalar(170).addScaledVector(axis, z); leg = 'clear the ring'; }
    else if (z < 60) { goal = latDir.clone().multiplyScalar(lat).addScaledVector(axis, 120); leg = 'round to the front'; }
    else { goal = axis.clone().multiplyScalar(Math.min(z, 250)); leg = 'onto the axis'; }
    const toGoal = goal.clone().sub(rel);
    const dist = inCone ? D.rel.range : toGoal.length();
    // safe speed for the distance: can always stop on the thrusters, and
    // slows to capture speed in the last metres
    const aBrake = (KESTREL.rcs.coarse * 4) / b.mass * 0.4;
    const cap = ctx === 'dock' ? 2.5 : 20;
    const vSafe = inCone
      ? Math.min(cap, Math.max(0.1, Math.min(Math.sqrt(2 * aBrake * Math.max(0, dist - 3)), 0.08 + dist * 0.025)))
      : Math.min(cap, Math.max(0.4, Math.min(Math.sqrt(2 * aBrake * dist), 0.4 + dist * 0.05)));
    const fine = inCone && dist < 30;
    if (input.key('KeyW')) this.speedSet = Math.min(cap, Math.max(this.speedSet, 0) + dt * (fine ? 0.1 : 0.8));
    if (input.key('KeyS')) this.speedSet = Math.max(-1.0, this.speedSet - dt * (fine ? 0.15 : 0.8));
    if (input.hit('Space')) this.speedSet = 0;
    let speed = Math.min(this.speedSet, vSafe);
    // hold short of the port until the capture conditions are met (on a
    // fast-spinning station the port face moves sideways unless we are
    // within centimetres of her axis, and touching it early knocks us off)
    let holding = false;
    if (inCone && dist < 4 && speed > 0) {
      const tol = settings.difficulty, r = D.rel;
      const latNeed = Math.min(tol.lateral * 0.6, (tol.lateralVel * 0.4) / Math.max(Math.abs(r.spin), 0.05));
      const ready = r.lateral < latNeed && r.latVel < tol.lateralVel * 0.6 && r.tilt < tol.tilt * 0.6 && Math.abs(r.rollRate) < tol.rollRate * 0.6;
      if (!ready) { speed = MathUtils.clamp((z - 2.5) * 0.15, -0.05, speed); holding = true; }
    }
    const along = inCone ? axis.clone().negate() : toGoal.clone().normalize();
    // final leg: steer onto the axis as we come down it, and come down it
    // more slowly while still well off-centre
    const centred = inCone ? MathUtils.clamp(1.5 - lat / (1.5 + z * 0.12), 0.15, 1) : 1;
    const want = along.clone().multiplyScalar(speed * centred);
    if (inCone) {
      const lm = latV.clone().multiplyScalar(-Math.min(0.15, Math.max(0.05, 2.0 / Math.max(10, dist))));
      const cap = Math.max(0.6, speed);
      if (lm.length() > cap) lm.setLength(cap);
      want.add(lm);
    }
    // A/D/R/F nudge sideways
    const nudge = new Vector3(input.axis('KeyA', 'KeyD'), input.axis('KeyF', 'KeyR'), 0);
    if (nudge.lengthSq()) want.addScaledVector(nudge.applyQuaternion(b.quat), fine ? 0.15 : 0.6);
    // track it with the jets (coarse for big corrections, fine close in)
    // (centre-of-mass velocities: at the docking ring, our own fast roll on
    // a spinning station would add circling noise)
    const vrel = new Vector3().subVectors(b.vel, S.body.vel);
    const dv = want.clone().sub(vrel);
    // (coarse also while rolling up to a fast spin)
    K.rcsMode = (dv.length() > 0.15 && D.rel.range > 25) || Math.abs(D.rel.rollRate) > 0.03 ? 'coarse' : 'fine';
    const acc = (K.rcsThrust() * 4) / b.mass;
    _qi.copy(b.quat).invert();
    const db = dv.applyQuaternion(_qi);
    const gT = (v) => (Math.abs(v) < 0.003 ? 0 : MathUtils.clamp(v / (acc * 0.5), -1, 1));
    cmd.t.set(gT(db.x), gT(db.y), gT(db.z));
    this.fbw = { ctx, auto, leg, holding, speedSet: this.speedSet, speed, vSafe, closing: D.rel.closing, range: D.rel.range };
  }

  // Away from the station. W fires the main engine while held. When a
  // mission offers a guided burn (a direction and a Δv), holding W flies it:
  // the nose turns onto the burn, the engine (or the thrusters, for small
  // burns) fires, and it cuts off by itself when the Δv is done.
  freeFlight(dt, input, nose, auto) {
    const K = this.kestrel, cmd = K.cmd;
    const bt = this.burnTarget;
    const w = input.key('KeyW');
    if (!w) this.wLatch = false;
    cmd.t.set(input.axis('KeyA', 'KeyD'), input.axis('KeyF', 'KeyR'), input.key('KeyS') ? 1 : 0);
    if (K.rcsMode !== 'coarse') K.rcsMode = 'coarse';
    this.speedSet = 0;
    let burn = '';
    if (!this.allowMain) cmd.throttle = 0;
    if (bt?.cut && (cmd.throttle > 0 || this.wBoost !== null)) {
      // the mission says the engine's work is done (ascent at apoapsis)
      cmd.throttle = 0; this.wBoost = null; this.wLatch = true;
    }
    const guided = bt && bt.dv !== undefined;
    if (this.burn || (guided && bt.now && w && !this.wLatch)) {
      // ---- guided burn ----
      if (!this.burn) this.burn = { label: bt.label, dir: bt.dir.clone(), goal: bt.dv, dv0: K.dvUsed, live: !!bt.terminal };
      const B = this.burn;
      const same = bt && bt.label === B.label;
      if (same) B.dir.copy(bt.dir);
      let left = B.goal - (K.dvUsed - B.dv0);
      if (same && bt.now) left = Math.min(left, bt.dv);
      if (B.live && !same) left = 0;
      const aligned = nose.angleTo(B.dir) < 0.05;
      if (!w || left < 0.15) {
        cmd.throttle = 0;
        if (left < 0.15) { this.wLatch = true; this.game.emit('assist', 'BURN COMPLETE'); }
        this.burn = null;
        burn = left < 0.15 ? 'complete' : '';
      } else if (!aligned) { cmd.throttle = 0; burn = 'turning'; }
      else {
        const aMain = KESTREL.main.thrust / K.body.mass;
        if (left > 1.5 && this.allowMain) cmd.throttle = MathUtils.clamp(left / (aMain * 1.5), 0.08, 1);
        else { cmd.throttle = 0; cmd.t.z = -1; }
        burn = 'burning';
      }
      this.fbw = { ctx: 'free', auto, burn, left: Math.max(0, left), label: B.label };
      return;
    }
    if (this.allowMain && this.attMode !== 'burn' && !bt?.cut) {
      if (w && !this.wLatch && !guided) {
        if (this.wBoost === null) this.wBoost = cmd.throttle;
        cmd.throttle = Math.min(1, cmd.throttle + dt * 1.5);
      } else if (this.wBoost !== null) { cmd.throttle = this.wBoost; this.wBoost = null; }
      if (input.key('KeyZ')) cmd.throttle = Math.min(1, cmd.throttle + dt * 0.6);
      if (input.key('KeyX')) cmd.throttle = Math.max(0, cmd.throttle - dt * 0.6);
    }
    this.fbw = { ctx: 'free', auto, burn: guided ? (this.wLatch && w ? 'complete' : bt.now ? 'ready' : 'wait') : '', left: guided ? bt.dv : 0, label: guided ? bt.label : '', t: bt?.t };
  }

  // The rotating reference the pilot wants to be still in: near the
  // Meridian that is the station's spin, elsewhere inertial. Only the spin
  // about her axis is copied: the Kestrel is long and thin (Ix ~ 12 Iz), so
  // copying a nutating station's small transverse omega would set it coning
  // by ~10x that angle about its own L.
  referenceOmega(out) {
    const D = this.world.docking;
    if (this.world.meridianActive && D.rel.range < 250) {
      const S = this.world.meridian;
      return S.axisWorld(out).multiplyScalar(S.spinRate);
    }
    return out.set(0, 0, 0);
  }

  // rough per-axis angular acceleration authority [rad/s^2]
  authority() {
    const K = this.kestrel;
    const F = K.rcsThrust();
    const I = K.body.inertiaBody.elements;
    return {
      pitch: (F * 2 * (6.4 + 4.0)) / I[0],
      yaw: (F * 2 * (6.4 + 4.0)) / I[4],
      roll: (F * 2 * (2 * 1.15 + 2 * 1.5)) / I[8],
    };
  }

  // Drive body rates toward a reference angular velocity (world).
  holdRate(refOmega, out, desiredBody = null) {
    const K = this.kestrel.body;
    _qi.copy(K.quat).invert();
    const err = _a.subVectors(K.omega, refOmega).applyQuaternion(_qi); // body frame
    if (desiredBody) err.sub(desiredBody);
    const au = this.authority();
    const tau = 0.35;
    const g = (e, a) => {
      const u = -e / (a * tau);
      const db = 0.0004 / a;
      return Math.abs(e) < 0.0002 ? 0 : MathUtils.clamp(u + Math.sign(u) * db, -1, 1);
    };
    out.set(g(err.x, au.pitch), g(err.y, au.yaw), g(err.z, au.roll));
  }

  // Point the nose (-Z) along fwd (and optionally +Y toward up).
  pointAt(fwd, up, refOmega, out) {
    const K = this.kestrel.body;
    _qi.copy(K.quat).invert();
    const f = _a.copy(fwd).normalize().applyQuaternion(_qi);
    // rotation that brings body -Z onto f: axis = (-Z) x f
    const ax = new Vector3(0, 0, -1).cross(f);
    const s = ax.length();
    const ang = Math.atan2(s, -f.z);
    const desired = new Vector3();
    const au = this.authority();
    const maxRate = Math.min(this.simple ? 0.35 : 0.12, Math.sqrt(2 * Math.min(au.pitch, au.yaw) * 0.5 * Math.max(ang, 1e-4)));
    if (s > 1e-6) desired.copy(ax).multiplyScalar((Math.min(ang * 1.2, maxRate)) / s);
    if (up) {
      const u = _b.copy(up).applyQuaternion(_qi);
      const rollErr = Math.atan2(-u.x, u.y);
      desired.z = MathUtils.clamp(rollErr * 0.8, -0.15, 0.15);
    }
    this.holdRate(refOmega, out, desired);
  }

  nullRelativeVelocity(out) {
    const W = this.world;
    const K = W.kestrel.body;
    let vrel;
    if (W.meridianActive) {
      const D = W.docking;
      vrel = _a.copy(D.rel.vel).applyQuaternion(W.meridian.body.quat); // world
    } else if (W.groundFn || W.altitude(K.pos) < 5000) {
      vrel = _a.subVectors(K.vel, W.surfaceVelocity(K.pos, _b));
    } else return;
    _qi.copy(K.quat).invert();
    const vb = vrel.applyQuaternion(_qi);
    const acc = (this.kestrel.rcsThrust() * 4) / K.mass;
    const g = (v) => (Math.abs(v) < 0.004 ? 0 : MathUtils.clamp(-v / (acc * 0.6), -1, 1));
    out.set(g(vb.x), g(vb.y), g(vb.z));
  }

  attitudeTarget(mode) {
    const W = this.world;
    const K = W.kestrel.body;
    const r = K.pos, v = _b.copy(K.vel);
    const pro = v.clone().normalize();
    const radial = r.clone().normalize();
    const normal = new Vector3().crossVectors(r, K.vel).normalize();
    const up = radial;
    switch (mode) {
      case 'prograde': return { fwd: pro, up };
      case 'retrograde': return { fwd: pro.negate(), up };
      case 'normal': return { fwd: normal, up };
      case 'antinormal': return { fwd: normal.negate(), up };
      case 'radial-out': return { fwd: radial, up: pro };
      case 'radial-in': return { fwd: radial.clone().negate(), up: pro };
      case 'target':
      case 'anti-target': {
        if (!W.meridianActive) return null;
        const d = new Vector3().subVectors(W.docking.rel.portWorld, K.pos).normalize();
        return { fwd: mode === 'target' ? d : d.negate(), up: null };
      }
      case 'port-align': {
        if (!W.meridianActive) return null;
        const S = W.meridian.body;
        const fwd = W.docking.rel.axisWorld.clone().negate();
        const up = S.dirToWorld(new Vector3(0, 1, 0));
        return { fwd, up };
      }
      case 'burn': return this.burnTarget ? { fwd: this.burnTarget.dir.clone(), up } : null;
      default: return null;
    }
  }

  // --- camera ----------------------------------------------------------------
  // Camera pose is computed as an offset from the (interpolated) Kestrel so
  // transitions blend smoothly even while everything moves at 7.6 km/s.
  updateCamera(dt, origin, camera) {
    const K = this.kestrel.body;
    const kPos = this.game.interpBodyPos(K, _c);
    const kQuat = this.game.interpBodyQuat(K, _q);
    const off = new Vector3(), quat = new Quaternion();
    let fov = settings.get('fov');
    if (this.camMode === 'cockpit') {
      off.set(...KESTREL.eye).sub(K.comBody).applyQuaternion(kQuat);
      const look = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.look.yaw)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.look.pitch - 0.1));
      quat.copy(kQuat).multiply(look);
    } else if (this.camMode === 'dock') {
      off.set(...KESTREL.dockCam).sub(K.comBody).applyQuaternion(kQuat);
      quat.copy(kQuat);
      fov = 34;
    } else {
      off.set(
        Math.sin(this.chase.yaw) * Math.cos(this.chase.pitch),
        Math.sin(this.chase.pitch),
        Math.cos(this.chase.yaw) * Math.cos(this.chase.pitch),
      ).multiplyScalar(this.chase.dist);
      const frameQ = this.chaseFrame(kQuat, dt);
      off.applyQuaternion(frameQ);
      const up = new Vector3(0, 1, 0).applyQuaternion(frameQ);
      // aim a little above the ship so it sits in the lower part of the frame
      const aim = up.clone().multiplyScalar(Math.min(this.chase.dist, 60) * 0.09);
      const m4 = new Matrix4().lookAt(off, aim, up);
      quat.setFromRotationMatrix(m4);
      fov = Math.min(fov, 62);
    }
    if (this.transition) {
      this.transition.t += dt;
      const t = Math.min(1, this.transition.t / this.transition.dur);
      const e = t * t * (3 - 2 * t);
      off.lerpVectors(this.transition.fromOff, off, e);
      quat.slerpQuaternions(this.transition.fromQuat, quat, e);
      fov = this.transition.fromFov + (fov - this.transition.fromFov) * e;
      if (t >= 1) this.transition = null;
    }
    this.camOff.copy(off);
    this.camQuat.copy(quat);
    camera.position.copy(kPos).add(off).sub(origin);
    camera.quaternion.copy(quat);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // Chase camera reference frame: follows the Kestrel's attitude (lagged a
  // little, so rotations read clearly); low over a planet it keeps the
  // horizon level instead.
  chaseFrame(kQuat, dt) {
    const W = this.world;
    let target = kQuat;
    const K = W.kestrel.body;
    const alt = K.pos.length() - W.primary.radius;
    if (alt < 90000) {
      // low over a planet: keep the horizon level (camera up = local vertical)
      const up = K.pos.clone().normalize();
      const nose = new Vector3(0, 0, -1).applyQuaternion(kQuat);
      let f = nose.clone().addScaledVector(up, -nose.dot(up));
      if (f.lengthSq() < 0.09) { const top = new Vector3(0, 1, 0).applyQuaternion(kQuat); f = top.addScaledVector(up, -top.dot(up)); }
      f.normalize();
      const back = f.negate();
      const right = new Vector3().crossVectors(up, back).normalize();
      target = new Quaternion().setFromRotationMatrix(_m4.makeBasis(right, up, back));
    }
    if (!this._frame) this._frame = target.clone();
    this._frame.slerp(target, 1 - Math.exp(-dt * 2.5));
    return this._frame;
  }

}
