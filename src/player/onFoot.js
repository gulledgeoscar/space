// On-foot locomotion in an arbitrary gravity field.
//
// The environment supplies the acceleration a(p, v) - real gravity on a
// planet, or centrifugal + Coriolis in the Meridian's rotating frame - and a
// signed-distance collision field. Traction is limited by friction times the
// felt gravity, so in a weak field you skid and bound; jumps are a fixed leg
// impulse, so they go lower in 1.3 g and higher near the hub.

import { Vector3, Quaternion } from 'three';
import { G0 } from '../physics/constants.js';

const _a = new Vector3();
const _b = new Vector3();
const _n = new Vector3();
const _c = new Vector3();

export const BODY_SPHERES = [
  { h: 0.3, r: 0.28 },   // feet
  { h: 0.95, r: 0.3 },   // torso
  { h: 1.5, r: 0.24 },   // head
];

export class Walker {
  constructor() {
    this.pos = new Vector3();       // feet contact point
    this.vel = new Vector3();
    this.up = new Vector3(0, 1, 0);
    this.forward = new Vector3(0, 0, -1);
    this.pitch = 0;
    this.grounded = false;
    this.groundTime = 0;
    this.airTime = 0;
    this.gEff = G0;
    this.lastImpact = 0;
    this.speed = 0;
    this.running = false;
    this.crouch = 0;
    this.stepPhase = 0;
    this.jumpV = 2.7;
  }

  // Remove penetration for each body sphere; returns the deepest floor-ish contact normal.
  collide(env) {
    let ground = null;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const s of BODY_SPHERES) {
        _c.copy(this.pos).addScaledVector(this.up, s.h);
        const d = env.sdf(_c);
        if (d < s.r) {
          env.gradient(_c, _n);
          if (_n.lengthSq() < 0.5) continue;
          this.pos.addScaledVector(_n, s.r - d + 0.001);
          const vn = this.vel.dot(_n);
          if (vn < 0) {
            if (_n.dot(this.up) > 0.6 && -vn > this.lastImpact) this.lastImpact = -vn;
            this.vel.addScaledVector(_n, -vn);
          }
          if (_n.dot(this.up) > 0.6) ground = _n.clone();
          moved = true;
        }
      }
      if (!moved) break;
    }
    return ground;
  }

  // input: { move: Vector2 (x right, y forward), run, jump, yaw }
  step(dt, env, input) {
    // gravity direction (without Coriolis) defines "up"
    env.gravity(this.pos, _a);
    this.gEff = _a.length();
    if (this.gEff > 1e-4) {
      _b.copy(_a).multiplyScalar(-1 / this.gEff);
      // turn smoothly toward the new up (walking around the ring)
      this.up.lerp(_b, Math.min(1, dt * 8)).normalize();
    }
    if (input.yaw) this.forward.applyQuaternion(new Quaternion().setFromAxisAngle(this.up, input.yaw));
    this.forward.addScaledVector(this.up, -this.forward.dot(this.up)).normalize();
    const right = _c.crossVectors(this.forward, this.up).normalize().clone();
    // ground probe: is the feet sphere touching something below?
    const probe = _b.copy(this.pos).addScaledVector(this.up, 0.3 - 0.06);
    const wasGrounded = this.grounded;
    this.grounded = env.sdf(probe) < 0.3 && this.vel.dot(this.up) < 1.0;
    if (this.grounded) { this.groundTime += dt; this.airTime = 0; } else { this.airTime += dt; this.groundTime = 0; }
    const gScale = this.gEff / G0;
    // walking speed: heavier suit-plus-body weight slows you (fatigue-limited)
    const base = (input.run ? 3.8 : 1.55) * Math.min(1.15, Math.pow(Math.max(gScale, 0.25), -0.6));
    const desired = new Vector3().addScaledVector(this.forward, input.move.y * base).addScaledVector(right, input.move.x * base);
    if (env.waterDrag) desired.multiplyScalar(env.waterDrag(this.pos));
    if (this.grounded) {
      // traction-limited approach to the desired tangential velocity
      const vt = this.vel.clone().addScaledVector(this.up, -this.vel.dot(this.up));
      const dv = desired.sub(vt);
      const aMax = 0.9 * this.gEff + 0.4;
      const l = dv.length();
      if (l > 1e-6) this.vel.addScaledVector(dv, Math.min(1, (aMax * dt) / l));
      if (input.jump && this.groundTime > 0.08) { this.vel.addScaledVector(this.up, this.jumpV); this.grounded = false; }
    } else if (desired.lengthSq() > 0) {
      // tiny air control (arm-swinging), physically negligible
      this.vel.addScaledVector(desired.normalize(), 0.15 * dt);
    }
    // field acceleration (gravity, centrifugal, Coriolis)
    env.accel(this.pos, this.vel, _a);
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.lastImpact = 0;
    this.collide(env);
    const vt = this.vel.clone().addScaledVector(this.up, -this.vel.dot(this.up));
    this.speed = vt.length();
    this.running = input.run && this.speed > 2.2;
    this.landed = !wasGrounded && this.grounded ? this.lastImpact : 0;
    return this;
  }
}
