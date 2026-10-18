// Piloting controller for the Kestrel.
//
// Inputs map straight to RCS jets/throttle. Assisted-mode helpers are a
// flight computer layered on top: they only ever command the same jets the
// pilot could fire, burning the same propellant - the physics underneath is
// never altered.
//
//   W/S fwd/back  A/D left/right  R/F up/down      (translation)
//   mouse / arrows pitch+yaw      Q/E roll         (rotation)
//   Z/X throttle up/down  Backspace cut  T RCS fine/coarse  G gear
//   Assisted: K kill rotation, L kill relative velocity, 1-9 attitude holds

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

export class PilotController {
  constructor(game) {
    this.game = game;
    this.camMode = 'cockpit';
    this.stick = new Vector2();
    this.attMode = null;
    this.killRot = false;
    this.killVel = false;
    this.chase = { yaw: 0.35, pitch: 0.25, dist: 32 };
    this.look = { yaw: 0, pitch: 0 };
    this.camOff = new Vector3();
    this.camQuat = new Quaternion();
    this.transition = null;
    this.burnTarget = null;     // { dir: Vector3 world, dv: m/s } from planners
    this.enabled = true;
    this.allowMain = true;
    this.lockControls = false;
    this.lastInput = { t: new Vector3(), r: new Vector3() };
  }

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
      } else {
        this.look.yaw = MathUtils.clamp(this.look.yaw - mouse.x * 0.003 * sens, -2.2, 2.2);
        this.look.pitch = MathUtils.clamp(this.look.pitch - mouse.y * 0.003 * sens, -1.2, 1.2);
      }
    } else if (input.locked && !this.lockControls && !this.game.mapOpen) {
      this.stick.x = MathUtils.clamp(this.stick.x - mouse.x * 0.0035 * sens, -1, 1);
      this.stick.y = MathUtils.clamp(this.stick.y - mouse.y * 0.0035 * sens * inv, -1, 1);
    }
    // stick springs back to centre
    const k = Math.exp(-dt / 0.18);
    this.stick.multiplyScalar(k);
    if (!look) { this.look.yaw *= Math.exp(-dt / 0.6); this.look.pitch *= Math.exp(-dt / 0.6); }
    if (mouse.wheel && this.camMode === 'chase') this.chase.dist = MathUtils.clamp(this.chase.dist * (1 + mouse.wheel * 0.12), 8, 4000);

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
      if (input.hit('KeyK')) { this.killRot = !this.killRot; this.attMode = null; this.game.emit('assist', this.killRot ? 'KILL ROTATION' : 'KILL ROTATION OFF'); }
      if (input.hit('KeyL')) { this.killVel = !this.killVel; this.game.emit('assist', this.killVel ? 'KILL REL VELOCITY' : 'KILL REL VELOCITY OFF'); }
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
      if (!this.enabled) cmd.throttle = 0;
      return;
    }
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

  // The rotating reference the pilot wants to be still in: near the
  // Meridian that is the station's spin, elsewhere inertial.
  referenceOmega(out) {
    const D = this.world.docking;
    if (this.world.meridianActive && D.rel.range < 250) return out.copy(this.world.meridian.body.omega);
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
    const maxRate = Math.min(0.12, Math.sqrt(2 * Math.min(au.pitch, au.yaw) * 0.5 * Math.max(ang, 1e-4)));
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
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), this.look.pitch - 0.08));
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
      const m4 = new Matrix4().lookAt(off, new Vector3(), up);
      quat.setFromRotationMatrix(m4);
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

  // Chase camera reference frame: follows the Kestrel's heading but, near
  // the spinning Meridian, rolls with the station so the port looks still.
  chaseFrame(kQuat, dt) {
    const W = this.world;
    let target = kQuat;
    const K = W.kestrel.body;
    const alt = K.pos.length() - W.primary.radius;
    if (W.meridianActive && W.docking.rel.range < 400) target = this.game.interpBodyQuat(W.meridian.body, new Quaternion());
    else if (alt < 90000) {
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
