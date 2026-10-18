// The Meridian's hub docking port: visual assembly + the docking system.
//
// Docking frame: origin at the port face (station body (0,0,PORT_Z)), axis
// +Z out of the hub. The port spins with the station, so the Kestrel must
// (a) match the station's spin rate about the docking axis, (b) put its
// docking ring ON the spin axis - anywhere else the port surface moves at
// w*r - and (c) close at < 0.1 m/s within ~1 deg.
//
// Sequence: free -> contact -> soft capture (damped spring pulls the
// capture ring in and indexes the petals) -> latching (12 hooks, one by
// one) -> HARD DOCK: the two rigid bodies merge, conserving linear and
// angular momentum about the combined CoM with both inertia tensors ->
// pressure equalisation. Undocking reverses it with spring push-off.

import {
  Group, Mesh, CylinderGeometry, TorusGeometry, BoxGeometry, SphereGeometry, PlaneGeometry, CircleGeometry,
  MeshBasicMaterial, MeshStandardMaterial, Color, Vector3, Quaternion, Matrix3, SpotLight, Object3D,
  Shape, ExtrudeGeometry, RingGeometry, DoubleSide,
} from 'three';
import { GeoBatch, canvasTexture } from '../world/geometry.js';
import { materials } from '../world/materials.js';
import { PORT_Z, PORT_RING_R, KESTREL_DOCK_Z, KESTREL_DOCKED_Z, HUB_R } from '../physics/constants.js';
import { resolveContact } from '../physics/collision.js';
import { Inertia, rotateInertia } from '../physics/rigidBody.js';
import { angularMomentumMismatch } from '../physics/rotatingFrame.js';
import { KESTREL } from './kestrel.js';
import { settings } from '../core/settings.js';

export const TARGET_OFFSET_Y = 0.28; // docking target/camera offset above axis
const HUB_FACE_Z = 5.0;
const HUB_OUTER_R = 4.0;
const LATCHES = 12;
const DEG = Math.PI / 180;

function hubFaceTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#3a3e44'; ctx.fillRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    // approach pattern: concentric rings + quadrant stripes
    ctx.strokeStyle = '#f2efe6';
    for (const [r, lw] of [[150, 10], [230, 6], [330, 14], [440, 6]]) { ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    ctx.lineWidth = 8;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 150, cy + Math.sin(a) * 150); ctx.lineTo(cx + Math.cos(a) * 500, cy + Math.sin(a) * 500); ctx.stroke();
    }
    ctx.fillStyle = '#d4a017';
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.save(); ctx.translate(cx + Math.cos(a) * 385, cy + Math.sin(a) * 385); ctx.rotate(a);
      ctx.fillRect(-14, -40, 28, 80); ctx.restore();
    }
    ctx.fillStyle = '#f2efe6';
    ctx.font = '600 44px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('MERIDIAN  HUB PORT A', cx, cy + 495);
    ctx.fillText('SPIN AXIS', cx, cy - 470);
  });
}

function targetTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#060606'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 100, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(a) * 104, h / 2 + Math.sin(a) * 104); ctx.lineTo(w / 2 + Math.cos(a) * 124, h / 2 + Math.sin(a) * 124); ctx.stroke();
    }
  });
}

export function buildDockingPortModel() {
  const M = materials();
  const root = new Group();
  root.name = 'dockingPort';
  const b = new GeoBatch();
  // hub face decal
  const face = new Mesh(new CircleGeometry(HUB_OUTER_R - 0.05, 64), new MeshStandardMaterial({ map: hubFaceTexture(), roughness: 0.7, metalness: 0.3 }));
  face.position.z = HUB_FACE_Z + 0.065;
  face.receiveShadow = true;
  root.add(face);
  // port collar barrel
  b.add(new CylinderGeometry(1.05, 1.12, PORT_Z - HUB_FACE_Z, 48, 1, true), M.metal, new Vector3(0, 0, (PORT_Z + HUB_FACE_Z) / 2), { x: Math.PI / 2, y: 0, z: 0 });
  b.add(new RingGeometry(0.55, 1.05, 48), M.darkMetal, new Vector3(0, 0, PORT_Z - 0.005));
  b.add(new TorusGeometry(PORT_RING_R, 0.075, 12, 48), M.darkMetal, new Vector3(0, 0, PORT_Z + 0.02));
  b.add(new TorusGeometry(1.06, 0.05, 8, 48), M.hazard, new Vector3(0, 0, PORT_Z));
  // hatch
  b.add(new CylinderGeometry(0.55, 0.55, 0.06, 40), M.panelDark, new Vector3(0, 0, PORT_Z - 0.04), { x: Math.PI / 2, y: 0, z: 0 });
  b.add(new TorusGeometry(0.3, 0.025, 6, 24), M.metal, new Vector3(0, 0, PORT_Z));
  // guide petals (androgynous: offset 60 deg from the Kestrel's)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2 + Math.PI / 3;
    const petal = new Shape();
    petal.moveTo(-0.28, 0); petal.lineTo(0.28, 0); petal.lineTo(0.12, 0.36); petal.lineTo(-0.12, 0.36); petal.lineTo(-0.28, 0);
    const g = new ExtrudeGeometry(petal, { depth: 0.04, bevelEnabled: false });
    g.rotateX(Math.PI / 2 - 0.45);
    g.translate(0, PORT_RING_R - 0.02, 0);
    g.rotateZ(a - Math.PI / 2);
    g.translate(0, 0, PORT_Z + 0.03);
    b.add(g, M.hullDark);
  }
  root.add(b.build());

  // standoff target (folds flat on soft capture)
  const target = new Group();
  target.position.set(0, TARGET_OFFSET_Y, PORT_Z - 0.01);
  const plate = new Mesh(new CircleGeometry(0.16, 32), new MeshBasicMaterial({ map: targetTexture(), color: new Color(1.6, 1.6, 1.6) }));
  target.add(plate);
  const post = new Group();
  const postMesh = new Mesh(new CylinderGeometry(0.012, 0.012, 0.3, 8), M.darkMetal);
  postMesh.rotation.x = Math.PI / 2;
  postMesh.position.z = 0.15;
  post.add(postMesh);
  const crossMat = new MeshBasicMaterial({ color: new Color(2.4, 2.4, 2.4) });
  const c1 = new Mesh(new BoxGeometry(0.16, 0.022, 0.01), crossMat);
  const c2 = new Mesh(new BoxGeometry(0.022, 0.16, 0.01), crossMat);
  c1.position.z = c2.position.z = 0.3;
  post.add(c1, c2);
  target.add(post);
  root.add(target);

  // latch hooks
  const hooks = [];
  for (let i = 0; i < LATCHES; i++) {
    const a = (i / LATCHES) * Math.PI * 2 + 0.13;
    const pivot = new Object3D();
    pivot.position.set(Math.cos(a) * 0.98, Math.sin(a) * 0.98, PORT_Z - 0.02);
    pivot.rotation.z = a;
    const hook = new Group();
    const arm = new Mesh(new BoxGeometry(0.06, 0.07, 0.22), M.metal);
    arm.position.z = 0.11;
    const tip = new Mesh(new BoxGeometry(0.12, 0.07, 0.05), M.metal);
    tip.position.set(-0.04, 0, 0.21);
    hook.add(arm, tip);
    hook.rotation.y = 0.9;   // open (leaning outward)
    pivot.add(hook);
    root.add(pivot);
    hooks.push({ pivot, hook, open: 0.9, closed: -0.15, state: 0 });
  }

  // guide lights: 16 around the port, chase sequence
  const lightGeo = new SphereGeometry(0.06, 8, 6);
  const lightMats = {
    off: new MeshBasicMaterial({ color: new Color(0.08, 0.06, 0.03) }),
    amber: new MeshBasicMaterial({ color: new Color(6, 3.2, 0.4) }),
    green: new MeshBasicMaterial({ color: new Color(0.4, 6, 1.0) }),
    red: new MeshBasicMaterial({ color: new Color(7, 0.4, 0.3) }),
    white: new MeshBasicMaterial({ color: new Color(6, 6, 6) }),
  };
  const guide = [];
  for (let ring = 0; ring < 2; ring++) {
    const R = ring === 0 ? 1.55 : 2.65;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const m = new Mesh(lightGeo, lightMats.off);
      m.position.set(Math.cos(a) * R, Math.sin(a) * R, HUB_FACE_Z + 0.1);
      root.add(m);
      guide.push({ mesh: m, ring, i });
    }
  }
  // floodlights: two lamps on the hub rim aimed down the approach axis
  const floods = [];
  for (const s of [-1, 1]) {
    const lamp = new Mesh(new CylinderGeometry(0.18, 0.24, 0.3, 16), M.darkMetal);
    lamp.position.set(s * 3.3, 0, HUB_FACE_Z + 0.25);
    lamp.rotation.x = Math.PI / 2;
    root.add(lamp);
    const lens = new Mesh(new CircleGeometry(0.17, 16), lightMats.white);
    lens.position.set(s * 3.3, 0, HUB_FACE_Z + 0.41);
    root.add(lens);
    const spot = new SpotLight(0xfff4e0, 0, 140, 0.5, 0.5, 1.4);
    spot.position.set(s * 3.3, 0, HUB_FACE_Z + 0.45);
    spot.target.position.set(s * 0.5, 0, 60);
    root.add(spot, spot.target);
    floods.push(spot);
  }
  return { root, target, post, hooks, guide, lightMats, floods };
}

// ---------------------------------------------------------------------------
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _qi = new Quaternion();
const _m3 = new Matrix3();

const RING_SAMPLES = 24;
const ringPts = [];
for (let i = 0; i < RING_SAMPLES; i++) {
  const a = (i / RING_SAMPLES) * Math.PI * 2;
  ringPts.push(new Vector3(Math.cos(a) * KESTREL.dockRingR, Math.sin(a) * KESTREL.dockRingR, KESTREL.dockZ));
}
// spheres approximating the Kestrel hull for collisions with the station
const KESTREL_SPHERES = [
  { p: new Vector3(0, 0, -6.3), r: 0.95 }, { p: new Vector3(0, 0.2, -4.5), r: 1.35 },
  { p: new Vector3(0, 0, -1.5), r: 1.4 }, { p: new Vector3(0, 0, 1.8), r: 1.4 },
  { p: new Vector3(0, 0, 5.0), r: 1.3 }, { p: new Vector3(-3.6, -0.45, 4.2), r: 0.8 },
  { p: new Vector3(3.6, -0.45, 4.2), r: 0.8 }, { p: new Vector3(0, -0.05, 7.6), r: 0.75 },
];

export class DockingSystem {
  constructor(station, kestrel) {
    this.station = station;
    this.kestrel = kestrel;
    this.state = 'free';       // free | soft | latching | hard | releasing
    this.t = 0;
    this.latched = 0;
    this.events = [];
    this.rel = this.makeRel();
    this.capturedRoll = 0;
    this.lastContact = -10;
    this.clearance = 0;
    this.pressure = 0;         // 0..1 equalisation progress
    this.mergeInfo = null;
    this.enabled = true;
    this.captureEnabled = true;  // a mission can refuse capture (hostile)
    this.simTime = 0;
  }

  makeRel() {
    return {
      range: 0, pos: new Vector3(), vel: new Vector3(), closing: 0, lateral: 0, latVel: 0,
      tilt: 0, pitch: 0, yaw: 0, roll: 0, rollRate: 0, pitchRate: 0, yawRate: 0, spin: 0,
      axisOffset: 0, tangential: 0, dL: new Vector3(), dLmag: 0, portWorld: new Vector3(), axisWorld: new Vector3(),
      inCorridor: false, envelope: false, spinMatch: 0, kestrelSpin: 0,
    };
  }

  get tol() { return settings.difficulty; }
  get docked() { return this.state === 'hard'; }

  // Relative state in the rotating port frame.
  compute() {
    const S = this.station.body, K = this.kestrel.body, r = this.rel;
    S.bodyToWorld(_a.set(0, 0, PORT_Z), r.portWorld);
    S.dirToWorld(_a.set(0, 0, 1), r.axisWorld);
    const pk = this.kestrel.dockPoint(_b);
    _qi.copy(S.quat).invert();
    r.pos.subVectors(pk, r.portWorld).applyQuaternion(_qi);
    r.range = r.pos.length();
    // relative velocity of the Kestrel ring w.r.t. the port centre (which sits
    // on the spin axis), expressed in port axes ...
    K.velocityAt(pk, _a);
    S.velocityAt(r.portWorld, _c);
    r.vel.subVectors(_a, _c).applyQuaternion(_qi);
    r.closing = -r.vel.z;
    r.lateral = Math.hypot(r.pos.x, r.pos.y);
    // ... and w.r.t. the station material the ring would actually touch,
    // which adds the port surface's tangential velocity w x r off-axis.
    S.velocityAt(pk, _c);
    _c.subVectors(_a, _c).applyQuaternion(_qi);
    r.latVel = Math.hypot(_c.x, _c.y);
    r.corridorAngle = Math.atan2(r.lateral, Math.max(0.01, r.pos.z)) / DEG;
    // attitude error: Kestrel axes expressed in port axes
    _q.copy(_qi).multiply(K.quat);
    const f = _a.set(0, 0, -1).applyQuaternion(_q);
    r.tilt = Math.acos(Math.min(1, Math.max(-1, -f.z))) / DEG;
    r.yaw = Math.atan2(f.x, -f.z) / DEG;
    r.pitch = Math.atan2(f.y, -f.z) / DEG;
    const u = _c.set(0, 1, 0).applyQuaternion(_q);
    let roll = Math.atan2(-u.x, u.y) / DEG;
    roll = ((((roll + 60) % 120) + 120) % 120) - 60;   // 3-petal symmetry
    r.roll = roll;
    // rates
    _a.subVectors(K.omega, S.omega).applyQuaternion(_qi);
    r.rollRate = _a.z; r.pitchRate = _a.x; r.yawRate = _a.y;
    r.spin = S.omega.dot(r.axisWorld);
    r.kestrelSpin = K.omega.dot(r.axisWorld);
    r.spinMatch = Math.abs(r.spin) > 0.02 ? Math.max(0, 1 - Math.abs(r.rollRate) / Math.abs(r.spin)) : 1 - Math.min(1, Math.abs(r.rollRate) / 0.1);
    // distance from the true spin axis (line through CoM along omega)
    const wl = S.omega.length();
    if (wl > 1e-6) {
      _a.copy(S.omega).multiplyScalar(1 / wl);
      _b.subVectors(pk, S.pos);
      _b.addScaledVector(_a, -_b.dot(_a));
      r.axisOffset = _b.length();
    } else r.axisOffset = r.lateral;
    r.tangential = wl * r.axisOffset;
    angularMomentumMismatch(K.inertiaWorld(_m3), K.omega, S.omega, r.dL);
    r.dLmag = r.dL.length();
    const t = this.tol;
    r.inCorridor = r.pos.z > 0 && Math.atan2(r.lateral, Math.max(r.pos.z, 0.01)) < 10 * DEG;
    r.envelope = r.closing < t.closing && r.lateral < t.lateral && r.tilt < t.tilt && Math.abs(r.roll) < t.roll
      && Math.abs(r.rollRate) < t.rollRate && r.latVel < t.lateralVel;
    return r;
  }

  phase() {
    const s = this.state;
    if (s === 'hard') return 'HARD DOCK';
    if (s === 'latching') return 'LATCHING';
    if (s === 'soft') return 'SOFT CAPTURE';
    if (s === 'releasing') return 'RELEASE';
    const r = this.rel.range;
    if (this.simTime - this.lastContact < 1.0) return 'CONTACT';
    if (r > 2000) return 'RENDEZVOUS';
    if (r > 100) return 'FAR APPROACH';
    if (r > 10) return 'CLOSE APPROACH';
    return 'FINAL APPROACH';
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  step(dt) {
    if (!this.enabled) return;
    this.simTime += dt;
    if (this.state === 'hard') { this.stepHard(dt); return; }
    if (this.state === 'releasing') { this.stepRelease(dt); return; }
    this.compute();
    if (this.state === 'free') this.stepFree(dt);
    else this.stepSoft(dt);
  }

  // --- collisions --------------------------------------------------------------
  stepFree(dt) {
    if (this.rel.range > 80) return;
    if (this.clearance > 0) this.clearance = Math.max(0, this.clearance - dt);
    const S = this.station.body, K = this.kestrel.body;
    _qi.copy(S.quat).invert();
    // 1) docking ring vs port face / hub face
    let deepest = null;
    for (const p of ringPts) {
      const w = K.bodyToWorld(p, _a);
      const sp = _b.copy(w).sub(S.pos).applyQuaternion(_qi).add(S.comBody);
      const rad = Math.hypot(sp.x, sp.y);
      let depth = -1;
      let zone = null;
      if (rad < 1.1) { depth = PORT_Z - sp.z; zone = 'port'; }
      else if (rad < HUB_OUTER_R) { depth = HUB_FACE_Z + 0.07 - sp.z; zone = 'hub'; }
      if (depth > 0 && depth < 0.6 && (!deepest || depth > deepest.depth)) deepest = { depth, zone, world: w.clone() };
    }
    // 2) hull spheres vs hub (face + cylinder) and ring/spokes
    for (const sph of KESTREL_SPHERES) {
      const w = K.bodyToWorld(sph.p, _a);
      const sp = _b.copy(w).sub(S.pos).applyQuaternion(_qi).add(S.comBody);
      const rad = Math.hypot(sp.x, sp.y);
      // hub front face
      if (rad < HUB_OUTER_R + sph.r * 0.5 && sp.z - sph.r < HUB_FACE_Z + 0.07 && sp.z > HUB_FACE_Z - 1.0 && rad > 1.15) {
        const depth = HUB_FACE_Z + 0.07 - (sp.z - sph.r);
        if (!deepest || depth > deepest.depth) {
          const cp = w.clone().addScaledVector(this.rel.axisWorld, -sph.r);
          deepest = { depth, zone: 'hub', world: cp };
        }
      }
      // hub cylinder side
      if (sp.z < HUB_FACE_Z && sp.z > -5.6 && rad < HUB_OUTER_R + sph.r) {
        const depth = HUB_OUTER_R + sph.r - rad;
        if (depth > 0 && (!deepest || depth > deepest.depth)) {
          const nB = new Vector3(sp.x / rad, sp.y / rad, 0);
          const nW = nB.applyQuaternion(S.quat);
          deepest = { depth, zone: 'hubside', world: w.clone().addScaledVector(nW, -sph.r), normal: nW };
        }
      }
    }
    if (!deepest) return;
    this.lastContact = this.simTime;
    const n = deepest.normal ? deepest.normal.clone() : this.rel.axisWorld.clone();
    // capture test at first touch of ring on the port
    if (deepest.zone === 'port' && this.captureEnabled && this.clearance <= 0 && this.rel.envelope && this.rel.pos.z > -0.2) {
      this.beginSoftCapture();
      return;
    }
    // collision response
    const vrel = K.velocityAt(deepest.world, _a).sub(S.velocityAt(deepest.world, _b));
    const vn = vrel.dot(n);
    if (vn < 0) {
      const res = resolveContact(K, this.station.attachedKestrel ? S : S, deepest.world, n, 0.42, 0.3);
      const speed = -vn;
      this.emit('bounce', { speed, zone: deepest.zone, envelope: this.rel.envelope, rel: { ...this.rel } });
      if (speed > 0.3) this.kestrel.damage((speed - 0.3) * 38, 'impact');
      if (speed > 0.06) this.emit('impact', { speed, point: deepest.world.clone() });
    }
    // de-penetrate (station is ~10x heavier: move mostly the Kestrel)
    K.pos.addScaledVector(n, deepest.depth * 0.9);
    S.pos.addScaledVector(n, -deepest.depth * 0.1);
  }

  beginSoftCapture() {
    const r = this.rel;
    this.state = 'soft';
    this.t = 0;
    this.captureRel = { ...r, pos: r.pos.clone(), vel: r.vel.clone() };
    // index to the nearest petal position (multiple of 120 deg)
    const S = this.station.body, K = this.kestrel.body;
    _q.copy(S.quat).invert().multiply(K.quat);
    const u = _a.set(0, 1, 0).applyQuaternion(_q);
    const roll = Math.atan2(-u.x, u.y);
    this.capturedRoll = Math.round(roll / (2 * Math.PI / 3)) * (2 * Math.PI / 3);
    this.emit('softCapture', { rel: this.captureRel });
  }

  // 6-DOF damped spring between the docking frames.
  stepSoft(dt) {
    this.t += dt;
    const S = this.station.body, K = this.kestrel.body;
    const r = this.rel;
    const m = this.kestrel.body.mass;
    const k = m * Math.pow(2 * Math.PI * 0.45, 2), c = 2 * 0.95 * Math.sqrt(k * m);
    // retract the capture ring: target axial position goes to seated
    const zT = Math.max(-0.05, 0.02 - this.t * 0.04);
    const ex = _a.set(r.pos.x, r.pos.y, r.pos.z - zT);
    const F = new Vector3(-k * ex.x - c * r.vel.x, -k * ex.y - c * r.vel.y, -k * ex.z - c * r.vel.z).applyQuaternion(S.quat);
    const pk = this.kestrel.dockPoint(new Vector3());
    K.applyForce(F, pk);
    S.applyForce(F.clone().negate(), pk);
    // attitude: drive q_rel -> roll index
    const qTarget = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.capturedRoll);
    const qRel = new Quaternion().copy(S.quat).invert().multiply(K.quat);
    const qErr = qTarget.clone().invert().multiply(qRel);
    if (qErr.w < 0) { qErr.x *= -1; qErr.y *= -1; qErr.z *= -1; qErr.w *= -1; }
    const eAng = new Vector3(qErr.x, qErr.y, qErr.z).multiplyScalar(2).applyQuaternion(qTarget).applyQuaternion(S.quat);
    const Ik = Math.max(K.inertiaBody.elements[0], K.inertiaBody.elements[4], K.inertiaBody.elements[8]);
    const kr = Ik * Math.pow(2 * Math.PI * 0.5, 2), cr = 2 * 0.95 * Math.sqrt(kr * Ik);
    const wRel = new Vector3().subVectors(K.omega, S.omega);
    const T = eAng.multiplyScalar(-kr).addScaledVector(wRel, -cr);
    K.applyTorque(T);
    S.applyTorque(T.clone().negate());
    const seated = r.pos.z < -0.03 && r.lateral < 0.01 && r.tilt < 0.25 && Math.abs(r.rollRate) < 0.004;
    if (this.state === 'soft' && (seated || this.t > 7)) {
      this.state = 'latching';
      this.latchT = 0;
      this.emit('latchStart');
    }
    if (this.state === 'latching') {
      this.latchT += dt;
      const n = Math.min(LATCHES, Math.floor(this.latchT / 0.32));
      while (this.latched < n) { this.latched++; this.emit('latch', { i: this.latched }); }
      if (this.latched >= LATCHES && this.latchT > LATCHES * 0.32 + 0.3) this.hardDock();
    }
  }

  // Merge the two bodies: conserve momentum and angular momentum.
  hardDock() {
    const st = this.station, S = st.body, K = this.kestrel.body;
    const before = { spin: S.omega.dot(st.axisWorld(new Vector3())), omega: S.omega.clone(), kOmega: K.omega.clone() };
    const Mtot = S.mass + K.mass;
    const c = new Vector3().copy(S.pos).multiplyScalar(S.mass).addScaledVector(K.pos, K.mass).multiplyScalar(1 / Mtot);
    const v = new Vector3().copy(S.vel).multiplyScalar(S.mass).addScaledVector(K.vel, K.mass).multiplyScalar(1 / Mtot);
    const Lt = new Vector3().copy(S.L).add(K.L);
    const orb = (b) => new Vector3().subVectors(b.pos, c).cross(new Vector3().subVectors(b.vel, v).multiplyScalar(b.mass));
    Lt.add(orb(S)).add(orb(K));
    // Kestrel pose in station body coordinates (seated, indexed)
    const relQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.capturedRoll);
    const relOrigin = new Vector3(0, 0, KESTREL_DOCKED_Z);
    const kComInStation = relOrigin.clone().add(K.comBody.clone().applyQuaternion(relQuat));
    const kI = rotateInertia(K.inertiaBody, relQuat);
    st.mass.add('kestrel', K.mass, kComInStation, kI.multiplyScalar(1 / K.mass), { kestrel: true });
    const oldPos = S.pos.clone();
    st.refreshMass();
    S.pos.copy(c);
    S.prevPos.add(new Vector3().subVectors(c, oldPos));
    S.vel.copy(v);
    S.L.copy(Lt);
    S.updateDerived();
    // re-anchor: pose so that the merged CoM is at c (keep orientation)
    st.attachedKestrel = this.kestrel;
    this.kestrel.attached = { relQuat, relOrigin };
    K.frozen = true;
    this.followStation();
    this.state = 'hard';
    this.pressure = 0;
    const after = { spin: S.omega.dot(st.axisWorld(new Vector3())), omega: S.omega.clone() };
    this.mergeInfo = { before, after, rel: this.captureRel };
    this.emit('hardDock', this.mergeInfo);
  }

  // Kestrel rides with the station while hard-docked.
  followStation() {
    const S = this.station.body, K = this.kestrel.body, a = this.kestrel.attached;
    K.quat.copy(S.quat).multiply(a.relQuat);
    const o = S.bodyToWorld(a.relOrigin, new Vector3());
    K.pos.copy(o).add(K.comBody.clone().applyQuaternion(K.quat));
    K.vel.copy(S.velocityAt(K.pos, new Vector3()));
    K.setAngularVelocity(S.omega);
    K.updateDerived();
  }

  stepHard(dt) {
    this.followStation();
    if (this.pressure < 1) {
      this.pressure = Math.min(1, this.pressure + dt / 4.5);
      if (this.pressure >= 1) this.emit('pressurised');
    }
    this.compute();
  }

  // Start an undocking: hooks open, then separation springs fire.
  release() {
    if (this.state !== 'hard') return false;
    this.state = 'releasing';
    this.t = 0;
    this.emit('releaseStart');
    return true;
  }

  stepRelease(dt) {
    this.t += dt;
    this.followStation();
    const n = LATCHES - Math.floor(this.t / 0.18);
    while (this.latched > Math.max(0, n)) { this.latched--; this.emit('unlatch', { i: this.latched }); }
    if (this.latched <= 0 && this.t > LATCHES * 0.18 + 0.4) this.separate();
  }

  separate(pushSpeed = 0.07) {
    const st = this.station, S = st.body, K = this.kestrel.body;
    // rigid breakup: both pieces keep omega, velocities from the field
    const omega = S.omega.clone();
    const vField = (p) => new Vector3().crossVectors(omega, new Vector3().subVectors(p, S.pos)).add(S.vel);
    const kPos = K.pos.clone();
    const kVel = vField(kPos);
    st.mass.remove('kestrel');
    const oldPos = S.pos.clone(), oldVel = S.vel.clone();
    st.refreshMass();
    S.vel.copy(oldVel).add(new Vector3().crossVectors(omega, new Vector3().subVectors(S.pos, oldPos)));
    S.setAngularVelocity(omega);
    K.frozen = false;
    K.pos.copy(kPos);
    K.vel.copy(kVel);
    K.setAngularVelocity(omega);
    K.savePrev();
    // separation springs: equal and opposite impulse along the port axis
    const axis = st.axisWorld(new Vector3());
    const mu = (S.mass * K.mass) / (S.mass + K.mass);
    const J = axis.clone().multiplyScalar(mu * pushSpeed);
    K.vel.addScaledVector(J, 1 / K.mass);
    S.vel.addScaledVector(J, -1 / S.mass);
    st.attachedKestrel = null;
    this.kestrel.attached = null;
    this.state = 'free';
    this.clearance = 6;
    this.latched = 0;
    this.pressure = 0;
    this.emit('separated');
  }

  // Put the Kestrel straight into a hard-docked state (mission start).
  attachImmediately(roll = 0) {
    const st = this.station, S = st.body, K = this.kestrel.body;
    this.capturedRoll = roll;
    // place Kestrel at the docked pose first so the merge is exact
    const relQuat = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), roll);
    K.quat.copy(S.quat).multiply(relQuat);
    const o = S.bodyToWorld(new Vector3(0, 0, KESTREL_DOCKED_Z), new Vector3());
    K.pos.copy(o).add(K.comBody.clone().applyQuaternion(K.quat));
    K.vel.copy(S.velocityAt(K.pos, new Vector3()));
    K.setAngularVelocity(S.omega);
    K.updateDerived();
    this.captureRel = { ...this.rel };
    this.latched = LATCHES;
    this.hardDock();
    this.pressure = 1;
    this.events.length = 0;
  }

  snapshot() { return { state: this.state, latched: this.latched, capturedRoll: this.capturedRoll, pressure: this.pressure }; }
}

export { KESTREL_SPHERES };
