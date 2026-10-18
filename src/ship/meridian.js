// THE MERIDIAN - station dynamics.
//
// A rigid assembly: hub, twelve ring modules (each carrying a ballast water
// tank), four spokes, docking port and solar wings. It spins about its body
// +Z axis at w = sqrt(g / R) so the ring floor (R = 40 m) has 1 g.
//
// Simulated effects:
//  - full inertia tensor from the mass model (recomputed when mass moves)
//  - rim thrusters (tangential, 41 m lever arm) used to despin/spin
//  - venting atmosphere through hull breaches: real thrust at the breach
//    point -> force + torque, exponential blow-down of the module's air
//  - passive nutation damping (fluid slosh / flexible structure): internal
//    energy dissipation that conserves L but drifts the body toward pure
//    spin about its major axis
//  - ballast pumping: water moved between module tanks to drive the CoM
//    back onto the hub axis after the ring loses mass
//  - structural breakup: modules detach as separate rigid bodies keeping
//    their instantaneous velocity v + w x r (rigid breakup)

import { Vector3, Quaternion, Matrix3 } from 'three';
import { RigidBody, MassModel, Inertia, rotateInertia } from '../physics/rigidBody.js';
import {
  RING_FLOOR_R, RING_CEIL_R, RING_MODULES, RING_OMEGA, HUB_R, PORT_Z, SPOKE_MODULE,
} from '../physics/constants.js';

export const MODULE_MID_R = (RING_FLOOR_R + RING_CEIL_R) / 2 + 0.1; // 38.3 m centroid
export const MODULE_MASS = 20000;
// radiation-shielding water jackets double as ballast (5 t per module)
export const BALLAST_MASS = 5000;
export const RIM_R = 41.2;
export const RIM_THRUST = 25000;
export const SPOKE_MODULES = [2, 5, 8, 11];

export function moduleAngle(i) { return ((i + 0.5) / RING_MODULES) * Math.PI * 2; }

const _v = new Vector3();
const _w = new Vector3();
const _a = new Vector3();
const _q = new Quaternion();

export class Meridian {
  constructor() {
    this.body = new RigidBody('Meridian');
    this.mass = new MassModel();
    const m = this.mass;
    m.add('hub', 60000, new Vector3(0, 0, -0.3), Inertia.shellCylinderZ(1, 4.0, 10.6));
    m.add('port', 2000, new Vector3(0, 0, PORT_Z - 0.2), Inertia.cylinderZ(1, 1.1, 0.6));
    m.add('solar', 6000, new Vector3(0, 0, -7.5), Inertia.box(1, 34, 0.2, 3));
    for (let i = 0; i < RING_MODULES; i++) {
      const a = moduleAngle(i);
      const p = new Vector3(Math.cos(a) * MODULE_MID_R, Math.sin(a) * MODULE_MID_R, 0);
      // module modelled as a box 21 m long (tangential) x 3.8 m x 6.4 m
      const I = Inertia.box(1, 3.8, 21, 6.4);
      const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a);
      m.add(`module${i}`, MODULE_MASS, p, rotateInertia(I, qz), { module: i });
      m.add(`ballast${i}`, BALLAST_MASS, p, Inertia.point(), { module: i, ballast: true });
    }
    for (const i of SPOKE_MODULES) {
      const a = moduleAngle(i);
      const rMid = (HUB_R + 0.4 + RING_CEIL_R) / 2;
      const p = new Vector3(Math.cos(a) * rMid, Math.sin(a) * rMid, 0);
      const len = RING_CEIL_R - HUB_R;
      const I = Inertia.box(1, len, 2.4, 2.4);
      const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a);
      m.add(`spoke${i}`, 3000, p, rotateInertia(I, qz), { spoke: i });
    }
    this.body.setFromMassModel(m);
    this.body.setAngularVelocity(new Vector3(0, 0, RING_OMEGA));
    this.modulesPresent = new Array(RING_MODULES).fill(true);
    this.rimThrusters = [0, 3, 6, 9].map((i) => {
      const a = moduleAngle(i) + 0.14;
      return {
        pos: new Vector3(Math.cos(a) * RIM_R, Math.sin(a) * RIM_R, 0),
        tangent: new Vector3(-Math.sin(a), Math.cos(a), 0),
        module: i, level: 0,
      };
    });
    this.despinCmd = 0;          // -1..1 commanded roll torque (rim jets)
    this.vents = [];             // { pos, dir, gas, tau, ve, module }
    this.nutationDamping = 0.0;  // 1/s (0 = rigid)
    this.ballastActive = false;
    this.pumpRate = 300;         // kg/s of water moved
    this.damaged = false;
    this.events = [];
    this.attachedKestrel = null;
  }

  get spinRate() { return this.body.omega.dot(this.axisWorld()); }
  axisWorld(out = new Vector3()) { return this.body.dirToWorld(_v.set(0, 0, 1), out); }
  portWorld(out = new Vector3()) { return this.body.bodyToWorld(_v.set(0, 0, PORT_Z), out); }

  refreshMass() { this.body.setFromMassModel(this.mass); }

  // CoM offset from the hub axis (body frame), metres
  comOffset() { return Math.hypot(this.body.comBody.x, this.body.comBody.y); }

  applyForces(dt) {
    const b = this.body;
    // rim thrusters (pairs fire tangentially for a pure torque about +Z)
    for (const t of this.rimThrusters) {
      t.level = this.modulesPresent[t.module] ? this.despinCmd : 0;
      if (t.level === 0) continue;
      _a.copy(t.tangent).multiplyScalar(RIM_THRUST * t.level);
      b.applyBodyForce(_a, t.pos);
    }
    // venting atmosphere: thrust = mdot * v_e, mdot = gas / tau
    for (const v of this.vents) {
      if (v.gas <= 0.01) continue;
      const mdot = v.gas / v.tau;
      const used = Math.min(v.gas, mdot * dt);
      v.gas -= used;
      _a.copy(v.dir).multiplyScalar(-mdot * v.ve); // reaction opposite to the gas jet
      b.applyBodyForce(_a, v.pos);
      v.thrust = mdot * v.ve;
    }
  }

  postIntegrate(dt) {
    const b = this.body;
    // passive nutation damping: rotate the body about (z_body x L) so its
    // major axis creeps toward L. L is untouched (internal process).
    if (this.nutationDamping > 0 && b.L.lengthSq() > 1) {
      const z = this.axisWorld(_w);
      _v.copy(b.L).normalize();
      _a.crossVectors(z, _v);
      const s = _a.length();
      if (s > 1e-7) {
        const ang = Math.asin(Math.min(1, s)) * Math.min(1, this.nutationDamping * dt);
        _q.setFromAxisAngle(_a.multiplyScalar(1 / s), ang);
        b.quat.premultiply(_q).normalize();
        b.updateDerived();
      }
    }
    // ballast pumping toward a balanced ring
    if (this.ballastActive) this.pumpBallast(dt);
  }

  pumpBallast(dt) {
    // move water from the module best aligned with the CoM offset to the
    // one most opposite, limited by pump rate and tank contents
    const off = new Vector3(this.body.comBody.x, this.body.comBody.y, 0);
    const offMag = off.length();
    if (offMag < 0.01) return;
    off.multiplyScalar(1 / offMag);
    let src = null, dst = null, best = -2, worst = 2;
    for (const e of this.mass.elements) {
      if (!e.ballast || !this.modulesPresent[e.module]) continue;
      const d = (e.pos.x * off.x + e.pos.y * off.y) / MODULE_MID_R;
      if (d > best && e.mass > 1) { best = d; src = e; }
      if (d < worst) { worst = d; dst = e; }
    }
    if (!src || !dst || src === dst) return;
    const dm = Math.min(src.mass, this.pumpRate * dt);
    src.mass -= dm; dst.mass += dm;
    // Internal mass motion: the system CoM, its velocity and L about it are
    // all unchanged - the structure (hub) moves around the CoM instead.
    const pos = this.body.pos.clone(), prev = this.body.prevPos.clone();
    this.refreshMass();
    this.body.pos.copy(pos);
    this.body.prevPos.copy(prev);
    this.body.updateDerived();
  }

  // Remove ring modules (and spokes/ballast attached to them). Returns the
  // debris descriptors with their rigid-breakup initial state.
  detachModules(indices) {
    const b = this.body;
    const debris = [];
    for (const i of indices) {
      if (!this.modulesPresent[i]) continue;
      this.modulesPresent[i] = false;
      const parts = this.mass.elements.filter((e) => e.module === i || e.spoke === i);
      let mm = 0;
      const cBody = new Vector3();
      for (const e of parts) { mm += e.mass; cBody.addScaledVector(e.pos, e.mass); }
      cBody.multiplyScalar(1 / mm);
      const pW = b.bodyToWorld(cBody, new Vector3());
      const vW = b.velocityAt(pW, new Vector3());
      debris.push({ module: i, mass: mm, posWorld: pW, velWorld: vW, quat: b.quat.clone(), omega: b.omega.clone(), centreBody: cBody });
      this.mass.elements = this.mass.elements.filter((e) => !(e.module === i || e.spoke === i));
    }
    // rigid breakup: remaining body keeps omega; its CoM velocity is the
    // old field evaluated at the new CoM
    const omega = b.omega.clone();
    const oldPos = b.pos.clone(), oldVel = b.vel.clone();
    this.refreshMass();
    _v.subVectors(b.pos, oldPos);
    b.vel.copy(oldVel).add(_w.crossVectors(omega, _v));
    b.setAngularVelocity(omega);
    this.damaged = true;
    return debris;
  }

  addVent(moduleIndex, gasMass = 600, tau = 45, ve = 420, tilt = 0.25) {
    const a = moduleAngle(moduleIndex) - 0.24;
    const pos = new Vector3(Math.cos(a) * MODULE_MID_R, Math.sin(a) * MODULE_MID_R, 1.2);
    // gas jets out of the torn end, mostly anti-tangential, a bit along +z
    const dir = new Vector3(Math.sin(a), -Math.cos(a), tilt).normalize();
    this.vents.push({ pos, dir, gas: gasMass, gas0: gasMass, tau, ve, module: moduleIndex, thrust: 0 });
  }

  snapshot() {
    return {
      body: this.body.snapshot(),
      masses: this.mass.elements.map((e) => ({ ...e, pos: e.pos.toArray(), unitI: e.unitI.toArray() })),
      modulesPresent: this.modulesPresent.slice(),
      vents: this.vents.map((v) => ({ ...v, pos: v.pos.toArray(), dir: v.dir.toArray() })),
      nutationDamping: this.nutationDamping, ballastActive: this.ballastActive, damaged: this.damaged,
    };
  }
  restore(s) {
    this.mass.elements = s.masses.map((e) => ({ ...e, pos: new Vector3().fromArray(e.pos), unitI: new Matrix3().fromArray(e.unitI) }));
    this.modulesPresent = s.modulesPresent.slice();
    this.vents = s.vents.map((v) => ({ ...v, pos: new Vector3().fromArray(v.pos), dir: new Vector3().fromArray(v.dir) }));
    this.nutationDamping = s.nutationDamping; this.ballastActive = s.ballastActive; this.damaged = s.damaged;
    // set mass props without moving (restore overwrites pose afterwards)
    const r = this.mass.compute();
    this.body.mass = r.mass; this.body.invMass = 1 / r.mass;
    this.body.comBody.copy(r.com);
    this.body.inertiaBody.copy(r.inertia); this.body.invInertiaBody.copy(r.inertia).invert();
    this.body.restore(s.body);
    this.despinCmd = 0;
  }
}
