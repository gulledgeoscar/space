// KESTREL - the lander/shuttle. Physical systems:
//  - mass model (structure, cockpit, engines, wings, propellant tank) whose
//    CoM and inertia tensor are recomputed as propellant burns
//  - 24 RCS jets at their real positions; translation jets do not fire
//    through the CoM, so a pure translation command yields a small parasitic
//    torque the pilot must trim out (just like the real thing)
//  - gimballed main engine with altitude-dependent Isp
//  - single propellant tank shared by main engine and RCS (cross-feed)
//  - drag, Sutton-Graves heating, hull thermal model, landing gear contacts
//  - RCS jet temperatures (overheat warnings during long firings)
//
// Body frame: forward (nose, docking ring) = -Z, up = +Y, right = +X.

import { Vector3, Matrix3, Quaternion } from 'three';
import { RigidBody, MassModel, Inertia } from '../physics/rigidBody.js';
import { G0, KESTREL_DOCK_Z, PORT_RING_R } from '../physics/constants.js';
import { massFlow, deltaV } from '../physics/rocket.js';
import { suttonGraves, HullThermal, dynamicPressure } from '../physics/atmosphere.js';

export const KESTREL = {
  // Mass-balanced like a real spinner: the cockpit sits high but is trimmed
  // by the nose avionics bay below it, and the low wings by the dorsal
  // radiators, so the principal axes coincide with the geometric axes
  // (products of inertia ~0). An unbalanced craft rolled to match the
  // Meridian's spin would cone about its angular momentum vector.
  dry: [
    ['structure', 9000, [0, 0, 0.3], [3.2, 2.2, 13]],
    ['cockpit', 1100, [0, 0.45, -5.0], [2.4, 1.6, 2.5]],
    ['avionics', 400, [0, -1.2375, -5.0], [1.6, 0.4, 1.6]],
    ['engines', 2500, [0, 0, 6.2], [2.4, 1.2, 1.8]],
    ['wings', 760, [0, -0.45, 2.6], [9.0, 0.3, 5.0]],
    ['radiators', 240, [0, 1.425, 2.6], [2.4, 0.1, 4.0]],
  ],
  tank: { pos: [0, 0, 1.6], r: 1.0, l: 6.5, capacity: 18000 },
  main: { thrust: 600e3, ispVac: 1050, ispSL: 880, pos: [0, 0, 7.4], gimbal: (4 * Math.PI) / 180 },
  rcs: { coarse: 2200, fine: 120, isp: 280 },
  dockZ: KESTREL_DOCK_Z,
  dockRingR: PORT_RING_R,
  eye: [0, 0.95, -5.05],
  dockCam: [0, 0.0, -6.95],
  noseRadius: 1.6,
  areas: { front: 6.5, side: 26, top: 46 },
  cd: 1.05,
  gear: [
    { id: 'nose', pos: [0, -1.25, -4.3], len: 1.0 },
    { id: 'left', pos: [-2.1, -1.2, 2.7], len: 1.0 },
    { id: 'right', pos: [2.1, -1.2, 2.7], len: 1.0 },
  ],
  // hull points used for crash detection when gear is up / tipping over
  hullPoints: [[0, -1.1, -6.2], [0, -1.15, 5.8], [-4.4, -0.45, 4.8], [4.4, -0.45, 4.8], [0, 1.4, -4.5], [0, 1.1, 6.2], [0, 0, -7.1]],
};

// First stage used for the Earth launch: sits under the Kestrel's tail.
export const BOOSTER = {
  dry: 17500, prop: 215000, thrust: 4.15e6, ispSL: 288, ispVac: 322,
  pos: [0, 0, 22.5], dims: [3.9, 3.9, 30], enginePos: [0, 0, 38.5], gimbal: (5 * Math.PI) / 180,
};

function buildThrusters() {
  const list = [];
  const rings = [
    { ring: 'fwd', z: -5.4, top: 1.15, side: 1.35 },
    { ring: 'aft', z: 5.0, top: 1.12, side: 1.65 },
  ];
  for (const r of rings) {
    for (const [px, py, axis] of [[0, r.top, 'x'], [0, -r.top, 'x'], [-r.side, 0, 'y'], [r.side, 0, 'y']]) {
      for (const s of [1, -1]) {
        const dir = new Vector3(axis === 'x' ? s : 0, axis === 'y' ? s : 0, 0);
        // nozzle sits slightly outboard of the hull, exhaust opposite to force
        const pos = new Vector3(px, py, r.z);
        list.push({ pos, dir, kind: 'lat', ring: r.ring, id: `${r.ring}-${px}-${py}-${axis}${s}` });
      }
    }
  }
  // axial: nose jets push the craft aft (+Z), tail jets push it forward (-Z)
  for (const [x, y] of [[0.75, 0.55], [-0.75, 0.55], [0.75, -0.55], [-0.75, -0.55]]) {
    list.push({ pos: new Vector3(x * 1.05, y * 1.4, -6.35), dir: new Vector3(0, 0, 1), kind: 'axial', ring: 'fwd', id: `nose${x}${y}` });
    list.push({ pos: new Vector3(x * 1.7, y * 1.6, 6.45), dir: new Vector3(0, 0, -1), kind: 'axial', ring: 'aft', id: `tail${x}${y}` });
  }
  for (const t of list) { t.level = 0; t.temp = 290; t.derate = 1; }
  return list;
}

const _f = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _tau = new Vector3();

export class Kestrel {
  constructor(name = 'Kestrel', { fuel = KESTREL.tank.capacity } = {}) {
    this.name = name;
    this.body = new RigidBody(name);
    this.mass = new MassModel();
    for (const [n, m, p, dims] of KESTREL.dry) this.mass.add(n, m, new Vector3(...p), Inertia.box(1, ...dims));
    this.tank = this.mass.add('propellant', fuel, new Vector3(...KESTREL.tank.pos), Inertia.cylinderZ(1, KESTREL.tank.r, KESTREL.tank.l));
    this.extra = null; // optional extra mass (e.g. a recovered beacon)
    this.dryMass = KESTREL.dry.reduce((s, d) => s + d[1], 0);
    this.capacity = KESTREL.tank.capacity;
    this.body.setFromMassModel(this.mass);
    this.thrusters = buildThrusters();
    this.cmd = { t: new Vector3(), r: new Vector3(), throttle: 0 };
    this.rcsMode = 'fine';
    this.mainLevel = 0;
    this.gimbal = new Vector3();
    this.engineArmed = true;
    this.rcsEnabled = true;
    this.hull = 100;
    this.thermal = new HullThermal({ heatCapacity: 3.2e5, hotArea: 7, radArea: 9, emissivity: 0.85, T: 285 });
    this.gearDown = true;
    this.gearState = KESTREL.gear.map((g) => ({ ...g, compression: 0, contact: false, load: 0 }));
    this.onGround = false;
    this.q = 0; this.mach = 0; this.rho = 0; this.aoa = 0;
    this.fuelUsed = 0;
    this.dvUsed = 0;              // integral of |thrust accel| dt
    this.events = [];             // { type, value } consumed by game
    this.attached = null;         // when docked: { to, relQuat, relPos }
    this.rcsHeat = 290;           // hottest jet [K]
    this.lastGLoad = new Vector3();
    this.pilotAccel = new Vector3();
  }

  // ---- staging ---------------------------------------------------------------
  attachBooster(propFraction = 1) {
    this.booster = { prop: BOOSTER.prop * propFraction, level: 0, lit: false };
    this.mass.add('boosterDry', BOOSTER.dry, new Vector3(...BOOSTER.pos), Inertia.cylinderZ(1, BOOSTER.dims[0] / 2, BOOSTER.dims[2]));
    this.boosterTank = this.mass.add('boosterProp', this.booster.prop, new Vector3(...BOOSTER.pos), Inertia.cylinderZ(1, BOOSTER.dims[0] / 2, BOOSTER.dims[2] * 0.9));
    this.refreshMass();
  }
  separateBooster() {
    if (!this.booster) return null;
    const b = this.body;
    const els = this.mass.elements.filter((e) => e.name.startsWith('booster'));
    let m = 0; const c = new Vector3();
    for (const e of els) { m += e.mass; c.addScaledVector(e.pos, e.mass); }
    c.multiplyScalar(1 / m);
    const posW = b.bodyToWorld(c, new Vector3());
    const velW = b.velocityAt(posW, new Vector3());
    const omega = b.omega.clone();
    const oldPos = b.pos.clone(), oldVel = b.vel.clone();
    this.mass.remove('boosterDry'); this.mass.remove('boosterProp');
    this.boosterTank = null;
    this.booster = null;
    this.refreshMass();
    b.vel.copy(oldVel).add(new Vector3().crossVectors(omega, new Vector3().subVectors(b.pos, oldPos)));
    b.setAngularVelocity(omega);
    // separation springs: 1.5 m/s apart
    const ax = b.dirToWorld(new Vector3(0, 0, -1));
    b.vel.addScaledVector(ax, 1.2);
    velW.addScaledVector(ax, -0.3);
    return { mass: m, pos: posW, vel: velW, quat: b.quat.clone(), omega };
  }

  get fuel() { return this.tank.mass; }
  set fuel(v) { this.tank.mass = Math.max(0, Math.min(this.capacity, v)); this.refreshMass(); }
  get totalMass() { return this.body.mass; }

  refreshMass(force = true) {
    // recomputing the tensor is cheap but not free; at 6000 steps/s under
    // warp, refresh when at least 0.25 kg has burned since the last update
    if (!force && Math.abs(this._lastMassFuel - this.tank.mass) < 0.25) return;
    this._lastMassFuel = this.tank.mass;
    this.body.setFromMassModel(this.mass);
  }

  // Stage-aware delta-v: with the booster attached, stage 1 (booster
  // propellant pushing the whole stack) plus stage 2 (Kestrel alone).
  deltaVMain() {
    const m2 = this.dryMass + this.fuel;
    const dv2 = deltaV(KESTREL.main.ispVac, m2, this.dryMass);
    if (!this.booster) return dv2;
    const m0 = this.body.mass;
    return dv2 + deltaV((BOOSTER.ispSL + BOOSTER.ispVac) / 2, m0, m0 - this.boosterTank.mass);
  }
  deltaVRcs() { return deltaV(KESTREL.rcs.isp, this.body.mass, this.body.mass - this.fuel); }

  rcsThrust() { return this.rcsMode === 'coarse' ? KESTREL.rcs.coarse : KESTREL.rcs.fine; }

  // Map 6-DOF command to jet duty cycles (0..1). Pure-couple rotation sets
  // cancel net force by symmetry; translation sets fire through the rings,
  // which straddle the CoM unevenly -> parasitic torque.
  allocate() {
    const t = this.cmd.t, r = this.cmd.r;
    const com = this.body.comBody;
    for (const th of this.thrusters) {
      let lvl = 0;
      const d = th.dir;
      lvl += Math.max(0, d.x * t.x + d.y * t.y + d.z * t.z);
      if (th.kind === 'lat') {
        _p.subVectors(th.pos, com);
        _tau.crossVectors(_p, d);
        if (Math.abs(d.y) > 0.9) lvl += Math.max(0, Math.sign(_tau.x) * r.x);
        if (Math.abs(d.x) > 0.9) lvl += Math.max(0, Math.sign(_tau.y) * r.y);
        if (Math.abs(_tau.z) > 0.5) lvl += Math.max(0, Math.sign(_tau.z) * r.z);
      }
      th.level = this.rcsEnabled && this.fuel > 0 ? Math.min(1, lvl) : 0;
    }
  }

  // env: { rho, airVel (world, craft relative to air), ambientDensityRatio, ground(pWorld) }
  applyForces(dt, env) {
    const b = this.body;
    if (b.frozen) { this.mainLevel = 0; for (const th of this.thrusters) th.level = 0; return; }
    this.allocate();
    let mdot = 0;
    const Frcs = this.rcsThrust();
    let thrustAccel = 0;
    let hottest = 0;
    for (const th of this.thrusters) {
      // jet temperature: heats while firing, radiates when idle
      const heatRate = this.rcsMode === 'coarse' ? 38 : 4;
      th.temp += (th.level * heatRate - (th.temp - 290) * 0.035) * dt;
      th.derate = th.temp > 1150 ? 0.5 : 1;
      hottest = Math.max(hottest, th.temp);
      if (th.level <= 0) continue;
      const F = Frcs * th.level * th.derate;
      _f.copy(th.dir).multiplyScalar(F);
      b.applyBodyForce(_f, th.pos);
      mdot += massFlow(F, KESTREL.rcs.isp);
      thrustAccel += F / b.mass;
    }
    this.rcsHeat = hottest;
    // first stage, when attached, replaces the Kestrel's own engine
    if (this.booster) {
      const bt = this.booster.lit && this.boosterTank.mass > 0 ? Math.max(0.4, this.cmd.throttle) : 0;
      this.booster.level = bt;
      this.mainLevel = 0;
      if (bt > 0) {
        const amb = Math.min(1, env.ambientDensityRatio || 0);
        const isp = BOOSTER.ispVac - (BOOSTER.ispVac - BOOSTER.ispSL) * amb;
        const F = BOOSTER.thrust * bt;
        const gm = BOOSTER.gimbal;
        _f.set(Math.sin(gm) * this.cmd.r.y, -Math.sin(gm) * this.cmd.r.x, -1).normalize().multiplyScalar(F);
        _p.set(...BOOSTER.enginePos);
        b.applyBodyForce(_f, _p);
        const used = Math.min(this.boosterTank.mass, massFlow(F, isp) * dt);
        this.boosterTank.mass -= used;
        this.dvUsed += (F / b.mass) * dt;
        this._boosterMassAcc = (this._boosterMassAcc || 0) + used;
        if (this._boosterMassAcc > 50) { this._boosterMassAcc = 0; this.refreshMass(); }
        if (this.boosterTank.mass <= 0) { this.booster.lit = false; this.events.push({ type: 'boosterBurnout' }); }
      }
    }
    // main engine
    const thr = this.engineArmed && this.fuel > 0 && !this.booster ? this.cmd.throttle : 0;
    this.mainLevel = thr;
    if (thr > 0) {
      const amb = Math.min(1, env.ambientDensityRatio || 0);
      const isp = KESTREL.main.ispVac - (KESTREL.main.ispVac - KESTREL.main.ispSL) * amb;
      const F = KESTREL.main.thrust * thr;
      const gm = KESTREL.main.gimbal;
      this.gimbal.set(Math.sin(gm) * this.cmd.r.y, -Math.sin(gm) * this.cmd.r.x, 0);
      _f.set(this.gimbal.x, this.gimbal.y, -1).normalize().multiplyScalar(F);
      _p.set(...KESTREL.main.pos);
      b.applyBodyForce(_f, _p);
      mdot += massFlow(F, isp);
      thrustAccel += F / b.mass;
    }
    this.dvUsed += thrustAccel * dt;
    // propellant
    if (mdot > 0) {
      const used = Math.min(this.fuel, mdot * dt);
      this.tank.mass -= used;
      this.fuelUsed += used;
      this.refreshMass(false);
    }
    // atmosphere
    this.rho = env.rho || 0;
    if (this.rho > 0 && env.airVel) {
      const v = env.airVel.length();
      this.q = dynamicPressure(this.rho, v);
      this.mach = v / (env.soundSpeed || 320);
      if (v > 0.1) {
        b.dirToBody(env.airVel, _v).multiplyScalar(1 / v);
        const A = KESTREL.areas;
        const cdA = KESTREL.cd * (A.front * Math.abs(_v.z) + A.side * Math.abs(_v.x) + A.top * Math.abs(_v.y));
        const D = 0.5 * this.rho * v * v * cdA;
        _f.copy(env.airVel).multiplyScalar(-D / v);
        // centre of pressure aft of the CoM gives weathervane stability
        _p.set(0, 0, b.comBody.z + 1.2);
        b.applyForce(_f, b.bodyToWorld(_p, _w));
        this.aoa = Math.acos(Math.min(1, Math.max(-1, -_v.z)));
        // aerodynamic rate damping
        _tau.copy(b.omega).multiplyScalar(-this.rho * v * 900);
        b.applyTorque(_tau);
        const flux = suttonGraves(this.rho, v, KESTREL.noseRadius);
        this.thermal.step(dt, flux, env.ambientTemp || 250);
      } else this.thermal.step(dt, 0, env.ambientTemp || 250);
    } else {
      this.q = 0; this.mach = 0; this.aoa = 0;
      this.thermal.step(dt, 0, env.ambientTemp || 4);
    }
    if (this.thermal.T > 1950) this.damage((this.thermal.T - 1950) * 0.02 * dt, 'heat');
    // ground contact
    if (env.ground) this.groundContact(dt, env.ground);
  }

  groundContact(dt, ground) {
    const b = this.body;
    let anyContact = false;
    const legs = this.gearDown ? this.gearState : [];
    for (const g of legs) {
      _p.set(g.pos[0], g.pos[1] - g.len, g.pos[2]);
      b.bodyToWorld(_p, _w);
      const c = ground(_w);
      g.contact = false; g.load = 0;
      if (!c || c.depth <= 0) { g.compression *= 0.9; continue; }
      anyContact = true;
      g.contact = true;
      b.velocityAt(_w, _v);
      if (c.surfaceVel) _v.sub(c.surfaceVel);
      const vn = _v.dot(c.normal);
      const depth = Math.min(c.depth, 0.8);
      g.compression = depth;
      let N = 4.2e5 * depth - 7.0e4 * vn;
      if (N < 0) N = 0;
      g.load = N;
      _f.copy(c.normal).multiplyScalar(N);
      // friction (viscous, capped by Coulomb)
      _v.addScaledVector(c.normal, -vn);
      const vt = _v.length();
      if (vt > 1e-4) {
        const Ft = Math.min(0.7 * N, 9e4 * vt);
        _f.addScaledVector(_v, -Ft / vt);
      }
      b.applyForce(_f, _w);
      if (-vn > 4.5) this.damage((-vn - 4.5) * 9, 'landing');
    }
    // hull points (belly-flop / tip-over)
    for (const hp of KESTREL.hullPoints) {
      _p.set(...hp);
      b.bodyToWorld(_p, _w);
      const c = ground(_w);
      if (!c || c.depth <= 0) continue;
      anyContact = true;
      b.velocityAt(_w, _v);
      if (c.surfaceVel) _v.sub(c.surfaceVel);
      const vn = _v.dot(c.normal);
      const N = Math.max(0, 1.2e6 * Math.min(c.depth, 0.5) - 1.5e5 * vn);
      _f.copy(c.normal).multiplyScalar(N);
      _v.addScaledVector(c.normal, -vn);
      const vt = _v.length();
      if (vt > 1e-4) _f.addScaledVector(_v, -Math.min(0.6 * N, 2e5 * vt) / vt);
      b.applyForce(_f, _w);
      if (-vn > 1.5) this.damage((-vn - 1.0) * 14, 'hull-strike');
    }
    this.onGround = anyContact;
  }

  damage(amount, cause) {
    if (amount <= 0) return;
    this.hull = Math.max(0, this.hull - amount);
    this.events.push({ type: 'damage', amount, cause });
  }

  // Pilot's felt acceleration (specific force) at the eye point: what the
  // body experiences relative to free fall - rotation + thrust/contact.
  computePilotLoad(gravityAccel) {
    const b = this.body;
    _p.set(...KESTREL.eye);
    b.bodyToWorld(_p, _w);
    _v.subVectors(_w, b.pos);
    // centripetal acceleration of the eye point: w x (w x r)
    _tau.crossVectors(b.omega, _v);
    const cent = new Vector3().crossVectors(b.omega, _tau);
    // specific force = a_point - g = (a_cm + a_cent) - g
    this.pilotAccel.copy(b.lastAccel).sub(gravityAccel).add(cent);
    return this.pilotAccel;
  }

  // World-space docking frame (nose ring centre + forward axis).
  dockPoint(out = new Vector3()) { return this.body.bodyToWorld(_p.set(0, 0, KESTREL.dockZ), out); }
  forward(out = new Vector3()) { return this.body.dirToWorld(_v.set(0, 0, -1), out); }

  snapshot() {
    return {
      body: this.body.snapshot(), fuel: this.fuel, hull: this.hull, T: this.thermal.T, rcsMode: this.rcsMode,
      gearDown: this.gearDown, fuelUsed: this.fuelUsed, dvUsed: this.dvUsed,
    };
  }
  restore(s) {
    this.tank.mass = s.fuel; this.refreshMass();
    this.body.restore(s.body);
    this.hull = s.hull; this.thermal.T = s.T; this.rcsMode = s.rcsMode; this.gearDown = s.gearDown;
    this.fuelUsed = s.fuelUsed; this.dvUsed = s.dvUsed;
    this.cmd.t.set(0, 0, 0); this.cmd.r.set(0, 0, 0); this.cmd.throttle = 0;
    for (const th of this.thrusters) { th.temp = 290; th.level = 0; }
    this.events.length = 0;
  }
}
