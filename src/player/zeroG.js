// Zero-g floating: Newtonian 6-DOF drift, push off surfaces, grab
// handrails, and a small suit thruster pack with limited gas.
// In the Meridian's hub the residual centrifugal/Coriolis field is still
// applied - near the axis it is tiny but real, so you slowly drift outward.

import { Vector3, Quaternion } from 'three';
import { closestOnSegment } from '../physics/collision.js';

const _a = new Vector3();
const _n = new Vector3();
const _q = new Quaternion();

export class Floater {
  constructor() {
    this.pos = new Vector3();      // body centre
    this.vel = new Vector3();
    this.quat = new Quaternion();  // -Z forward, +Y up
    this.angVel = new Vector3();   // body-frame look rates (damped)
    this.gas = 1.0;                // fraction of thruster gas
    this.thrusting = new Vector3();
    this.grabbing = null;
    this.radius = 0.38;
    this.touching = false;
    this.lastImpact = 0;
  }

  forward(out = new Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out = new Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out = new Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat); }

  // input: { look: {x, y}, roll, thrust: Vector3 (body: x right, y up, z back), grab, push }
  step(dt, env, input, rails = []) {
    // orientation from mouse (direct, the suit's gyro handles it)
    const q = this.quat;
    if (input.look) {
      q.multiply(_q.setFromAxisAngle(_a.set(0, 1, 0), -input.look.x));
      q.multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), -input.look.y));
    }
    if (input.roll) q.multiply(_q.setFromAxisAngle(_a.set(0, 0, 1), input.roll * dt * 1.4));
    q.normalize();
    // thruster pack: 0.55 m/s^2, gas lasts ~90 s of continuous firing
    this.thrusting.set(0, 0, 0);
    if (input.thrust && input.thrust.lengthSq() > 0 && this.gas > 0) {
      const t = input.thrust.clone().normalize();
      this.thrusting.copy(t);
      this.vel.addScaledVector(t.applyQuaternion(q), 0.55 * dt);
      this.gas = Math.max(0, this.gas - dt / 90);
    }
    // handrails
    this.grabbing = null;
    if (input.grab) {
      let best = null, bd = 0.75;
      for (const r of rails) {
        const c = closestOnSegment(this.pos, r.a, r.b, new Vector3());
        const d = c.distanceTo(this.pos);
        if (d < bd) { bd = d; best = { rail: r, point: c }; }
      }
      if (best) {
        this.grabbing = best;
        // hand-over-hand along the rail with W/S
        const dir = new Vector3().subVectors(best.rail.b, best.rail.a).normalize();
        const along = input.railMove || 0;
        const target = new Vector3().addScaledVector(dir, along * 1.1 * Math.sign(this.forward().dot(dir) || 1));
        this.vel.lerp(target, Math.min(1, dt * 6));
        // pull the body to arm's length from the rail
        const off = new Vector3().subVectors(this.pos, best.point);
        const len = off.length();
        if (len > 1e-4) this.vel.addScaledVector(off, ((0.5 - len) / len) * dt * 8);
      }
    }
    // residual rotating-frame field
    env.accel(this.pos, this.vel, _a);
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);
    // collide (single sphere)
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
        this.vel.addScaledVector(_n, -vn * 1.25);       // restitution 0.25
        const vt = this.vel.clone().addScaledVector(_n, -this.vel.dot(_n));
        this.vel.addScaledVector(vt, -Math.min(1, dt * 4)); // glove friction
      }
      this.touching = true;
      this.contactNormal = _n.clone();
    }
    if (!this.touching && env.sdf(this.pos) < this.radius + 0.12) { this.touching = true; env.gradient(this.pos, _n); this.contactNormal = _n.clone(); }
    // push off a surface along the look direction
    if (input.push && this.touching) {
      const f = this.forward();
      const n = this.contactNormal || f;
      const dir = f.dot(n) > -0.2 ? f : f.addScaledVector(n, -2 * f.dot(n)).normalize();
      this.vel.addScaledVector(dir, 1.6);
      this.pushed = true;
    }
    return this;
  }
}
