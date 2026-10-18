// The simulation world: one primary body (planet), the Kestrel, the
// Meridian, optional extra craft (Wren, booster) and debris, all integrated
// in the primary's inertial frame at a fixed 120 Hz step.

import { Vector3, Quaternion } from 'three';
import { gravityAccel } from '../physics/orbital.js';
import { DilationClock } from '../physics/timeDilation.js';
import { EARTH } from '../physics/bodies.js';
import { Kestrel } from '../ship/kestrel.js';
import { Meridian } from '../ship/meridian.js';
import { DockingSystem } from '../ship/dockingPort.js';
import { RigidBody, Inertia } from '../physics/rigidBody.js';

const _g = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const Y = new Vector3(0, 1, 0);

export class World {
  constructor() {
    this.primary = EARTH;
    this.clock = new DilationClock();
    this.time = 0;
    this.kestrel = new Kestrel('Kestrel');
    this.meridian = new Meridian();
    this.docking = new DockingSystem(this.meridian, this.kestrel);
    this.wren = null;            // second lander (missions 4)
    this.wrenDocking = null;
    this.extras = [];            // { body, kind, mesh, life }
    this.debris = [];            // { pos, vel, quat, omega, r, mesh, mass }
    this.groundFn = null;        // (pWorld) => { depth, normal, surfaceVel } | null
    this.kestrelActive = true;
    this.meridianActive = true;
    this.preStep = [];
    this.postStep = [];
    this.debrisHits = [];
    this.gravityAtKestrel = new Vector3();
  }

  setPrimary(p) { this.primary = p; }

  // planet-fixed rotation velocity at a point
  surfaceVelocity(p, out = new Vector3()) {
    return out.crossVectors(_w.copy(Y).multiplyScalar(this.primary.rotationRate), p);
  }
  altitude(p) { return p.length() - this.primary.radius; }

  defaultGround(p) {
    const R = this.primary.radius;
    const r = p.length();
    const depth = R - r;
    if (depth < -2) return null;
    return { depth, normal: p.clone().multiplyScalar(1 / r), surfaceVel: this.surfaceVelocity(p) };
  }

  envFor(body) {
    const pl = this.primary;
    const alt = this.altitude(body.pos);
    const atm = pl.atmosphere;
    const rho = atm ? atm.density(alt) : 0;
    const air = new Vector3().subVectors(body.vel, this.surfaceVelocity(body.pos, _v));
    return {
      alt, rho, airVel: air, ambientDensityRatio: rho / 1.225, soundSpeed: atm?.soundSpeed ?? 300,
      ambientTemp: atm ? atm.temp0 : 4,
      ground: alt < 300 ? (this.groundFn || ((p) => this.defaultGround(p))) : null,
    };
  }

  craftStep(craft, dt) {
    const b = craft.body;
    if (b.frozen) return;
    gravityAccel(b.pos, this.primary.gm, _g);
    b.accel.add(_g);
    craft.applyForces(dt, this.envFor(b));
  }

  step(dt) {
    for (const f of this.preStep) f(dt);
    const K = this.kestrel, S = this.meridian;
    const mu = this.primary.gm;
    // save previous poses for render interpolation
    K.body.savePrev(); S.body.savePrev();
    if (this.wren) this.wren.body.savePrev();
    for (const e of this.extras) e.body.savePrev();

    if (this.kestrelActive) {
      this.craftStep(K, dt);
      gravityAccel(K.body.pos, mu, this.gravityAtKestrel);
    }
    if (this.wren && this.wrenActive !== false) this.craftStep(this.wren, dt);
    if (this.meridianActive) {
      gravityAccel(S.body.pos, mu, _g);
      S.body.accel.add(_g);
      S.applyForces(dt);
    }
    for (const e of this.extras) {
      if (e.body.frozen) continue;
      gravityAccel(e.body.pos, mu, _g);
      e.body.accel.add(_g);
      if (e.applyForces) e.applyForces(dt, this.envFor(e.body));
    }
    // contacts / docking (adds forces or impulses before integration)
    if (this.kestrelActive && this.meridianActive) this.docking.step(dt);
    if (this.wrenDocking && this.wren) this.wrenDocking.step(dt);

    if (this.kestrelActive) K.body.integrate(dt);
    if (this.wren) this.wren.body.integrate(dt);
    if (this.meridianActive) { S.body.integrate(dt); S.postIntegrate(dt); }
    for (const e of this.extras) e.body.integrate(dt);
    // a docked Kestrel rides along after the station has moved
    if (this.docking.state === 'hard' || this.docking.state === 'releasing') this.docking.followStation();

    // debris: point masses on Keplerian paths, with spin for looks
    for (const d of this.debris) {
      gravityAccel(d.pos, mu, _g);
      d.vel.addScaledVector(_g, dt);
      d.pos.addScaledVector(d.vel, dt);
      d.spin += d.spinRate * dt;
      if (this.kestrelActive && !K.body.frozen && d.r > 0) {
        const dist = d.pos.distanceTo(K.body.pos);
        if (dist < d.r + 4.5) this.debrisContact(d, dt);
      }
    }
    this.time += dt;
    this.clock.advance(dt, this.primary.dilation);
    for (const f of this.postStep) f(dt);
  }

  // Debris vs. Kestrel: sphere contact against the hull spheres.
  debrisContact(d) {
    const K = this.kestrel.body;
    const local = K.worldToBody(d.pos, _v);
    // nearest point on the fuselage centreline segment
    const z = Math.max(-6.8, Math.min(7.0, local.z));
    const dx = local.x, dy = local.y;
    const halfW = Math.abs(local.x) > 1.8 ? 0.4 : 1.6;
    const dist = Math.hypot(dx * (1.6 / Math.max(halfW, 1.6)), dy, local.z - z) - halfW;
    if (dist > d.r) return;
    const n = _w.subVectors(K.pos, d.pos).normalize();
    const vrel = K.velocityAt(d.pos, new Vector3()).sub(d.vel);
    const vn = vrel.dot(n);
    if (vn >= 0) return;
    // impulse with debris treated as a point mass
    const j = (-(1 + 0.3) * vn) / (K.invMass + 1 / d.mass);
    const J = n.clone().multiplyScalar(j);
    K.applyImpulse(J, d.pos);
    d.vel.addScaledVector(J, -1 / d.mass);
    const speed = -vn;
    this.kestrel.damage(Math.min(60, speed * speed * d.mass * 0.0004 + speed * 1.5), 'debris');
    this.debrisHits.push({ speed, pos: d.pos.clone(), mass: d.mass });
  }

  // ---- checkpoints ---------------------------------------------------------
  snapshot() {
    return {
      time: this.time, clock: this.clock.snapshot(), primary: this.primary.id,
      kestrel: this.kestrel.snapshot(), meridian: this.meridian.snapshot(),
      docking: this.docking.snapshot(), kestrelAttached: this.kestrel.attached ? {
        relQuat: this.kestrel.attached.relQuat.toArray(), relOrigin: this.kestrel.attached.relOrigin.toArray(),
      } : null,
      debris: this.debris.map((d) => ({ ...d, pos: d.pos.toArray(), vel: d.vel.toArray(), mesh: null })),
      kestrelActive: this.kestrelActive, meridianActive: this.meridianActive,
    };
  }

  restore(s, planets) {
    this.time = s.time;
    this.clock.restore(s.clock);
    if (planets && planets[s.primary]) this.primary = planets[s.primary];
    this.meridian.restore(s.meridian);
    this.kestrel.restore(s.kestrel);
    const D = this.docking;
    D.state = s.docking.state; D.latched = s.docking.latched; D.capturedRoll = s.docking.capturedRoll; D.pressure = s.docking.pressure;
    D.events.length = 0; D.clearance = 2;
    if (s.kestrelAttached) {
      this.kestrel.attached = { relQuat: new Quaternion().fromArray(s.kestrelAttached.relQuat), relOrigin: new Vector3().fromArray(s.kestrelAttached.relOrigin) };
      this.meridian.attachedKestrel = this.kestrel;
    } else { this.kestrel.attached = null; this.meridian.attachedKestrel = null; }
    this.kestrelActive = s.kestrelActive; this.meridianActive = s.meridianActive;
    // debris meshes are owned by the game; positions restored by index
    s.debris.forEach((d, i) => {
      if (!this.debris[i]) return;
      this.debris[i].pos.fromArray(d.pos); this.debris[i].vel.fromArray(d.vel);
    });
  }
}
