// Zero-g floating: Newtonian drift in the station's rotating frame with a
// stabilised suit thruster pack.
//
// Look is first-person style: yaw/pitch about a reference "up" that the
// surroundings define (cabin ceiling in the Kestrel, the hub axis side away
// from Spoke A in the hub), so the view never accumulates roll.
// The pack is a velocity-hold controller: WASD/Space/Ctrl command a velocity
// relative to the station and the jets accelerate toward it (and brake to a
// stop when you let go), spending gas in proportion to the delta-v. The
// residual centrifugal/Coriolis field near the hub is still integrated - the
// stabiliser is what cancels it, so with the gas gone you slowly drift.

import { Vector3, Quaternion, Matrix4 } from 'three';

const _a = new Vector3();
const _n = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

export const FLOAT_SPEED = 1.3;     // m/s commanded with WASD
export const FLOAT_BOOST = 2.4;     // with Shift
const ACCEL = 1.8;                  // m/s^2 suit jets
const GAS_DV = 600;                 // total delta-v in a full tank, m/s

export class Floater {
  constructor() {
    this.pos = new Vector3();      // head/body centre
    this.vel = new Vector3();
    this.quat = new Quaternion();  // -Z forward, +Y up (derived from base, yaw, pitch)
    this.base = new Quaternion();  // frame whose +Y is the reference up
    this.yaw = 0;
    this.pitch = 0;
    this.gas = 1.0;
    this.thrusting = new Vector3();
    this.radius = 0.3;
    this.touching = false;
    this.lastImpact = 0;
    this.contactNormal = null;
  }

  forward(out = new Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out = new Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out = new Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat); }
  refUp(out = new Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.base); }

  updateQuat() {
    this.quat.copy(this.base)
      .multiply(_q.setFromAxisAngle(_a.set(0, 1, 0), this.yaw))
      .multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), this.pitch));
  }

  // Point the view along fwd with the given reference up.
  lookAlong(fwd, up) {
    const u = up.clone().normalize();
    let f = fwd.clone().addScaledVector(u, -fwd.dot(u));
    if (f.lengthSq() < 1e-6) f = new Vector3(0, 0, -1).addScaledVector(u, -u.z);
    f.normalize();
    const right = new Vector3().crossVectors(f, u).normalize();
    this.base.setFromRotationMatrix(_m.makeBasis(right, u, f.clone().negate()));
    this.yaw = 0;
    this.pitch = Math.asin(Math.max(-1, Math.min(1, fwd.clone().normalize().dot(u))));
    this.updateQuat();
  }

  // Swing the reference up toward `target` (keeps the heading).
  alignUp(target, k) {
    const cur = this.refUp(_a);
    const t = _n.copy(target).normalize();
    if (cur.dot(t) > 0.99999) return;
    _q.setFromUnitVectors(cur, t);
    const id = new Quaternion();
    id.slerp(_q, Math.min(1, k));
    this.base.premultiply(id).normalize();
  }

  // input: { yaw, pitch (rad deltas), move: Vector3 (x right, y up, z forward), boost, refUp }
  step(dt, env, input) {
    if (input.refUp) this.alignUp(input.refUp, dt * 2.5);
    this.yaw += input.yaw || 0;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (input.pitch || 0)));
    this.updateQuat();

    // stabilised suit pack: accelerate toward the commanded velocity
    this.thrusting.set(0, 0, 0);
    const mv = input.move || _a.set(0, 0, 0);
    const speed = input.boost ? FLOAT_BOOST : FLOAT_SPEED;
    const fwd = this.forward(new Vector3()), right = this.right(new Vector3()), up = this.refUp(new Vector3());
    const want = new Vector3().addScaledVector(right, mv.x).addScaledVector(up, mv.y).addScaledVector(fwd, mv.z);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(speed);
    if (this.gas > 0) {
      const dv = want.sub(this.vel);
      const l = dv.length();
      if (l > 1e-4) {
        const step = Math.min(l, ACCEL * dt);
        this.vel.addScaledVector(dv, step / l);
        this.gas = Math.max(0, this.gas - step / GAS_DV);
        if (mv.lengthSq() > 0) this.thrusting.copy(mv);
      }
    }
    // residual rotating-frame field
    env.accel(this.pos, this.vel, _a);
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.collide(env, dt);
    return this;
  }

  collide(env, dt = 1 / 120) {
    this.touching = false;
    this.lastImpact = 0;
    for (let i = 0; i < 3; i++) {
      const d = env.sdf(this.pos);
      if (d >= this.radius) break;
      env.gradient(this.pos, _n);
      if (_n.lengthSq() < 0.5) break;
      this.pos.addScaledVector(_n, this.radius - d + 0.001);
      const vn = this.vel.dot(_n);
      if (vn < 0) {
        this.lastImpact = Math.max(this.lastImpact, -vn);
        this.vel.addScaledVector(_n, -vn * 1.2);        // restitution 0.2
        const vt = this.vel.clone().addScaledVector(_n, -this.vel.dot(_n));
        this.vel.addScaledVector(vt, -Math.min(1, dt * 4)); // glove friction
      }
      this.touching = true;
      this.contactNormal = _n.clone();
    }
    if (!this.touching && env.sdf(this.pos) < this.radius + 0.12) { this.touching = true; env.gradient(this.pos, _n); this.contactNormal = _n.clone(); }
  }
}
