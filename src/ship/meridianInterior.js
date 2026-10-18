// The walkable Meridian: bridge -> galley corridor -> crew quarters ->
// science lab -> hydroponics -> airlock -> spoke A ladder -> zero-g hub ->
// docking tunnel -> Kestrel. Built procedurally on the real curved ring.

import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, Vector3, Matrix4, Quaternion, BoxGeometry,
  CylinderGeometry, SphereGeometry, PlaneGeometry, TorusGeometry, MeshStandardMaterial, MeshBasicMaterial,
  Color, PointLight, DoubleSide, CircleGeometry, ConeGeometry, IcosahedronGeometry, InstancedMesh, Object3D,
  CatmullRomCurve3, TubeGeometry, RingGeometry, AdditiveBlending, SpriteMaterial, Sprite, CanvasTexture,
} from 'three';
import { GeoBatch, canvasTexture, labelTexture } from '../world/geometry.js';
import { materials } from '../world/materials.js';
import {
  R, ROOM_H, L, ROOMS, DOORS, DOOR_W, DOOR_H, SPOKE_S, SPOKE_THETA, LADDER_OFF, toStation, quatAt, frameAt,
  addObstacle, OBSTACLES, InteriorSpace,
} from './interiorLayout.js';
import { MODULE_WINDOWS } from './meridianModel.js';
import { RING_CEIL_R, HUB_R, HUB_Z0, HUB_Z1, SPOKE_R, PORT_Z, G0, RING_OMEGA, rpm } from '../physics/constants.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);

// Parametric surface -> flat-shaded triangles. fn(u, v) returns a point;
// cells for which hole(uc, vc) is true are skipped.
function surf(fn, u0, u1, du, v0, v1, dv, { flip = false, hole = null, uvs = 0.5, ub = [], vb = [] } = {}) {
  const us = [u0], vs = [v0];
  for (let u = u0 + du; u < u1 - 1e-6; u += du) us.push(u);
  for (const x of ub) if (x > u0 && x < u1) us.push(x);
  us.push(u1);
  for (let v = v0 + dv; v < v1 - 1e-6; v += dv) vs.push(v);
  for (const x of vb) if (x > v0 && x < v1) vs.push(x);
  vs.push(v1);
  us.sort((a, b) => a - b); vs.sort((a, b) => a - b);
  const pos = [], nor = [], uv = [];
  const A = new Vector3(), B = new Vector3(), C = new Vector3(), D = new Vector3(), n = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
  const tri = (a, b, c, ua, va, ub2, vb2, uc, vc) => {
    e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2).normalize();
    for (const [p, uu, vv] of [[a, ua, va], [b, ub2, vb2], [c, uc, vc]]) { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uv.push(uu * uvs, vv * uvs); }
  };
  for (let i = 0; i < us.length - 1; i++) {
    for (let j = 0; j < vs.length - 1; j++) {
      const ua = us[i], ub2 = us[i + 1], va = vs[j], vb2 = vs[j + 1];
      if (ub2 - ua < 1e-6 || vb2 - va < 1e-6) continue;
      if (hole && hole((ua + ub2) / 2, (va + vb2) / 2)) continue;
      fn(ua, va, A); fn(ua, vb2, B); fn(ub2, vb2, C); fn(ub2, va, D);
      if (!flip) { tri(A, B, C, ua, va, ua, vb2, ub2, vb2); tri(A, C, D, ua, va, ub2, vb2, ub2, va); }
      else { tri(A, C, B, ua, va, ub2, vb2, ua, vb2); tri(A, D, C, ua, va, ub2, va, ub2, vb2); }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

class Builder {
  constructor() { this.b = new GeoBatch(); }
  mat(s, h, z, yaw = 0, sc = null) {
    toStation(s, h, z, _p);
    _q.copy(quatAt(s, yaw));
    if (sc) _s.copy(sc); else _s.set(1, 1, 1);
    return new Matrix4().compose(_p, _q, _s);
  }
  geo(g, mat, s, h, z, yaw = 0, local = null) {
    const m = this.mat(s, h, z, yaw);
    if (local) m.multiply(local);
    this.b.addMatrix(g, mat, m);
  }
  // w along tangent (s), ht along up (h, base at h), d along z (centred)
  box(w, ht, d, mat, s, h, z, yaw = 0) { this.geo(new BoxGeometry(w, ht, d), mat, s, h + ht / 2, z, yaw); }
  cylUp(r, ht, mat, s, h, z, seg = 16) { this.geo(new CylinderGeometry(r, r, ht, seg), mat, s, h + ht / 2, z); }
  cylZ(r, len, mat, s, h, z, seg = 12) { this.geo(new CylinderGeometry(r, r, len, seg), mat, s, h, z, 0, new Matrix4().makeRotationX(Math.PI / 2)); }
  cylT(r, len, mat, s, h, z, seg = 12) { this.geo(new CylinderGeometry(r, r, len, seg), mat, s, h, z, 0, new Matrix4().makeRotationZ(Math.PI / 2)); }
  sphere(r, mat, s, h, z) { this.geo(new SphereGeometry(r, 12, 8), mat, s, h, z); }
  raw(g, mat) { this.b.add(g, mat); }
  // curved floor (normal toward axis) / ceiling
  floor(s0, s1, z0, z1, mat, h = 0, hole = null) {
    this.raw(surf((u, v, o) => toStation(u, h, v, o), s0, s1, 0.8, z0, z1, 1.0, { hole, uvs: 0.5 }), mat);
  }
  ceiling(s0, s1, z0, z1, mat, h = ROOM_H, hole = null) {
    this.raw(surf((u, v, o) => toStation(u, h, v, o), s0, s1, 0.8, z0, z1, 1.0, { hole, flip: true, uvs: 0.5 }), mat);
  }
  // wall at axial position z facing +z (sign=+1) or -z (sign=-1)
  wallZ(s0, s1, h0, h1, z, sign, mat, windows = []) {
    const hole = (u, v) => windows.some((w) => u > w.s0 && u < w.s1 && v > w.h0 && v < w.h1);
    const ub = windows.flatMap((w) => [w.s0, w.s1]), vb = windows.flatMap((w) => [w.h0, w.h1]);
    this.raw(surf((u, v, o) => toStation(u, v, z, o), s0, s1, 1.0, h0, h1, 1.2, { flip: sign > 0, hole, ub, vb, uvs: 0.5 }), mat);
  }
  // bulkhead at arc position s facing +s (sign=+1) or -s (-1), with door hole
  wallS(s, z0, z1, h0, h1, sign, mat, door = false) {
    const hole = door ? (u, v) => Math.abs(u) < DOOR_W + 0.02 && v < DOOR_H : null;
    this.raw(surf((u, v, o) => toStation(s, v, u, o), z0, z1, 0.6, h0, h1, 0.6, { flip: sign < 0, hole, ub: door ? [-DOOR_W - 0.02, DOOR_W + 0.02] : [], vb: door ? [DOOR_H] : [], uvs: 0.5 }), mat);
  }
  // pipe along the ring at (h, z) from s0 to s1
  pipeS(s0, s1, h, z, r, mat) {
    const pts = [];
    for (let s = s0; s <= s1 + 1e-6; s += Math.max(0.5, (s1 - s0) / 24)) pts.push(toStation(s, h, z, new Vector3()));
    if (pts.length < 2) return;
    this.raw(new TubeGeometry(new CatmullRomCurve3(pts), pts.length * 2, r, 8, false), mat);
  }
  // sagging cable between two unrolled points
  cable(a, b, sag, r, mat) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const s = a[0] + (b[0] - a[0]) * t, h = a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), z = a[2] + (b[2] - a[2]) * t;
      pts.push(toStation(s, h, z, new Vector3()));
    }
    this.raw(new TubeGeometry(new CatmullRomCurve3(pts), 16, r, 6, false), mat);
  }
  build(opts) { return this.b.build(opts); }
}

// ---------------- canvas textures -----------------------------------------
function screenTex(w, h, draw) { const t = canvasTexture(w, h, draw); return t; }

function whiteboard() {
  return canvasTexture(1024, 512, (c, w, h) => {
    c.fillStyle = '#e9ebe6'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9aa'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#1b3f8a'; c.font = 'italic 34px Georgia, serif';
    const lines = [
      'a = ω²r   →  ω = √(g/R) = 0.495 rad/s  (R = 40 m)',
      'a_cor = −2 ω × v      (drop a bolt: lands 0.38 m antispinward)',
      'ẍ − 2nẏ − 3n²x = 0     ÿ + 2nẋ = 0     z̈ + n²z = 0',
      'Δv = Isp g₀ ln(m₀/m_f)',
      'dt/dτ = (r^3/2 + a) / (r^3/4 √(r^3/2 − 3r^1/2 + 2a))',
      '   a = 1 − 10⁻¹⁴ ,  r = 1.0000376 M  →  61,362',
    ];
    lines.forEach((l, i) => c.fillText(l, 40, 70 + i * 70));
    c.fillStyle = '#a02020'; c.font = 'bold 30px sans-serif';
    c.fillText('1 hr = 7 yr  (!!)', 700, 470);
  });
}
function noticeBoard() {
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#6b4d2e'; c.fillRect(0, 0, w, h);
    const notes = [['#f6e27a', 'GALLEY ROTA\nMon OKAFOR\nTue YOU\nWed CASE-9 (no)'], ['#9fe3f5', 'Spin stays at\n4.73 RPM.\nStop asking. -C9'], ['#f7b7c8', 'Hydroponics:\nDO NOT eat the\ntest lettuce #4'], ['#c8f0a8', 'Earth comms\nwindow 0400\n(time-shifted)']];
    notes.forEach(([col, txt], i) => {
      const x = 30 + (i % 2) * 240, y = 30 + Math.floor(i / 2) * 240;
      c.save(); c.translate(x + 100, y + 100); c.rotate((i % 2 ? 1 : -1) * 0.05); c.fillStyle = col; c.fillRect(-100, -100, 200, 200);
      c.fillStyle = '#222'; c.font = '24px "Comic Sans MS", cursive';
      txt.split('\n').forEach((l, k) => c.fillText(l, -88, -60 + k * 34)); c.restore();
      c.fillStyle = '#c00'; c.beginPath(); c.arc(x + 100, y + 12, 7, 0, 7); c.fill();
    });
  });
}
function patchTex() {
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#0f1a2b'; c.beginPath(); c.arc(256, 256, 240, 0, 7); c.fill();
    c.strokeStyle = '#e8c27a'; c.lineWidth = 14; c.stroke();
    c.lineWidth = 26; c.beginPath(); c.ellipse(256, 256, 150, 150, 0, 0, 7); c.stroke();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillStyle = '#e9e6dc'; c.fillRect(256 + Math.cos(a) * 150 - 9, 256 + Math.sin(a) * 150 - 9, 18, 18); }
    c.fillStyle = '#e8c27a'; c.beginPath(); c.arc(256, 256, 22, 0, 7); c.fill();
    c.fillStyle = '#e9e6dc'; c.font = '700 40px Rajdhani, sans-serif'; c.textAlign = 'center';
    c.fillText('MERIDIAN', 256, 470); c.font = '600 26px Rajdhani, sans-serif'; c.fillText('EXPEDITION ONE', 256, 70);
  });
}

export class MeridianInterior {
  constructor(game) {
    this.game = game;
    this.group = new Group();
    this.group.name = 'interior';
    this.space = new InteriorSpace();
    this.doors = DOORS;
    this.doorMeshes = [];
    this.fixtures = [];
    this.screens = [];
    this.interactables = [];
    this.lights = [];
    this.rails = [];
    this.M = materials();
    OBSTACLES.length = 0;
    this.buildRooms();
    this.buildSpoke();
    this.buildHub();
    this.buildLights();
    this.t = 0;
  }

  // ----------------------------------------------------------------------------
  buildRooms() {
    const M = this.M;
    const b = new Builder();
    const trimLight = new MeshBasicMaterial({ color: new Color(2.4, 2.2, 1.9) });
    this.trimLight = trimLight;
    const flickerMat = new MeshBasicMaterial({ color: new Color(2.4, 2.2, 1.9) });
    this.flickerMat = flickerMat;
    const purple = new MeshBasicMaterial({ color: new Color(2.6, 0.5, 2.8) });
    const leaf = new MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.7, side: DoubleSide });
    const leaf2 = new MeshStandardMaterial({ color: 0x67a838, roughness: 0.6, side: DoubleSide });
    const tomato = new MeshStandardMaterial({ color: 0xc8321e, roughness: 0.4 });
    const wood = new MeshStandardMaterial({ color: 0x7a5636, roughness: 0.6 });
    const fabric = new MeshStandardMaterial({ color: 0x3d4a5c, roughness: 0.95 });
    const fabric2 = new MeshStandardMaterial({ color: 0x7c5b46, roughness: 0.95 });
    const white = new MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.5 });
    const water = new MeshStandardMaterial({ color: 0x2a6b80, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 });

    for (const room of ROOMS) {
      const s0 = room.i * L, s1 = (room.i + 1) * L, hw = room.hw;
      const wins = MODULE_WINDOWS[room.i] || [];
      const side = (sg) => wins.filter((w) => w.side === sg).map((w) => ({ ...w, s0: s0 + w.s0, s1: s0 + w.s1 }));
      const floorWin = wins.filter((w) => w.side === 0).map((w) => ({ ...w, s0: s0 + w.s0, s1: s0 + w.s1 }));
      const fHole = (u, v) => floorWin.some((w) => u > w.s0 && u < w.s1 && v > w.z0 && v < w.z1);
      // shell
      b.b.add(surf((u, v, o) => toStation(u, 0, v, o), s0 + 0.15, s1 - 0.15, 0.8, -hw, hw, 1, { hole: fHole, ub: floorWin.flatMap((w) => [w.s0, w.s1]), vb: floorWin.flatMap((w) => [w.z0, w.z1]), uvs: 0.5 }), M.floor);
      const ceilHole = room.id === 'airlock' ? (u, v) => Math.abs(u - SPOKE_S) < 1.1 && Math.abs(v) < 1.1 : null;
      b.b.add(surf((u, v, o) => toStation(u, ROOM_H, v, o), s0 + 0.15, s1 - 0.15, 0.8, -hw, hw, 1, { flip: true, hole: ceilHole, ub: ceilHole ? [SPOKE_S - 1.1, SPOKE_S + 1.1] : [], vb: ceilHole ? [-1.1, 1.1] : [], uvs: 0.5 }), M.panelDark);
      b.wallZ(s0 + 0.15, s1 - 0.15, 0, ROOM_H, -hw, 1, M.panel, side(-1));
      b.wallZ(s0 + 0.15, s1 - 0.15, 0, ROOM_H, hw, -1, M.panel, side(1));
      // glass in the windows + frames
      for (const w of [...side(-1), ...side(1)]) {
        const z = w.side * hw;
        b.wallZ(w.s0, w.s1, w.h0, w.h1, z * 1.0 + w.side * 0.08, -w.side, M.glass);
        b.pipeS(w.s0, w.s1, w.h0, z, 0.05, M.darkMetal);
        b.pipeS(w.s0, w.s1, w.h1, z, 0.05, M.darkMetal);
        for (const s of [w.s0, w.s1]) b.box(0.1, w.h1 - w.h0, 0.12, M.darkMetal, s, w.h0, z);
      }
      for (const w of floorWin) {
        b.raw(surf((u, v, o) => toStation(u, -0.02, v, o), w.s0, w.s1, 0.8, w.z0, w.z1, 1, { uvs: 0.5 }), M.glass);
        // railing
        for (const z of [w.z0 - 0.15, w.z1 + 0.15]) { b.pipeS(w.s0 - 0.2, w.s1 + 0.2, 1.0, z, 0.03, M.metal); for (const s of [w.s0 - 0.2, (w.s0 + w.s1) / 2, w.s1 + 0.2]) b.cylUp(0.025, 1.0, M.metal, s, 0, z); }
      }
      // bulkheads (sealed at both ends of the walkable arc)
      const doorAt0 = room.i > 0, doorAt1 = room.i < 5;
      b.wallS(s0 + 0.15, -hw, hw, 0, ROOM_H, 1, M.panelDark, doorAt0);
      b.wallS(s1 - 0.15, -hw, hw, 0, ROOM_H, -1, M.panelDark, doorAt1);
      // narrow rooms: close the gap between room wall and the 3 m doorway region
      // ceiling light strips + floor trim
      for (const z of [-hw * 0.55, hw * 0.55]) {
        const mat = room.id === 'corridor' || room.id === 'lab' ? flickerMat : trimLight;
        b.raw(surf((u, v, o) => toStation(u, ROOM_H - 0.02, v, o), s0 + 1, s1 - 1, 1, z - 0.12, z + 0.12, 1, { flip: true }), room.id === 'hydro' ? purple : mat);
      }
      for (const z of [-hw + 0.05, hw - 0.05]) b.pipeS(s0 + 0.3, s1 - 0.3, 0.06, z, 0.04, M.darkMetal);
      // ceiling pipes and cable tray
      b.pipeS(s0 + 0.2, s1 - 0.2, ROOM_H - 0.25, -hw + 0.3, 0.07, M.copper);
      b.pipeS(s0 + 0.2, s1 - 0.2, ROOM_H - 0.4, -hw + 0.45, 0.05, M.metal);
      b.pipeS(s0 + 0.2, s1 - 0.2, ROOM_H - 0.22, hw - 0.35, 0.09, M.hullDark);
      for (let s = s0 + 1; s < s1 - 0.5; s += 2.2) b.cable([s, ROOM_H - 0.3, hw - 0.6], [s + 2.2, ROOM_H - 0.3, hw - 0.6], 0.12 + Math.random() * 0.1, 0.018, M.cable);
      // wall ribs every ~3.5 m
      for (let s = s0 + 1.8; s < s1 - 1; s += 3.5) {
        for (const z of [-hw + 0.06, hw - 0.06]) b.box(0.14, ROOM_H, 0.12, M.hullDark, s, 0, z);
        b.box(0.14, 0.12, hw * 2, M.hullDark, s, ROOM_H - 0.12, 0);
      }
      // room sign on the entry bulkhead
      this.sign(room.name, s0 + 0.17, 2.75, -hw + 0.9, '+s', { w: 1.4, h: 0.35 });
      this.fixtures.push({ s: s0 + L * 0.3, h: ROOM_H - 0.5, z: 0, color: room.id === 'hydro' ? 0xd27cff : 0xffe7c8, i: 1.0, flicker: room.id === 'corridor' }, { s: s0 + L * 0.72, h: ROOM_H - 0.5, z: 0, color: room.id === 'hydro' ? 0xd27cff : 0xffe7c8, i: 1.0, flicker: room.id === 'lab' });
      this[`room_${room.id}`]?.(b, s0, s1, hw, { trimLight, purple, leaf, leaf2, tomato, wood, fabric, fabric2, white, water });
    }
    // sealed bulkheads labels
    this.sign('SEALED · M-12 ENGINEERING · ACCESS VIA SPOKE D', 0.17, 2.1, 0, '+s', { w: 2.6, h: 0.32, bg: '#2a0d0a', fg: '#ff9a80', border: '#b03020' });
    this.sign('SEALED · M-07 STORES · DEPRESSURISED', 6 * L - 0.17, 2.1, 0, '-s', { w: 2.2, h: 0.32, bg: '#2a0d0a', fg: '#ff9a80', border: '#b03020' });
    // doors
    for (const d of this.doors) this.buildDoor(b, d);
    const mesh = b.build();
    this.group.add(mesh);
    this.roomMesh = mesh;
  }

  // facing: '+s' (spinward), '-s', '+z', '-z'
  sign(text, s, h, z, facing, { w = 1.2, h: hh = 0.3, bg = '#14181d', fg = '#e8e2d0', border = '#e8c27a' } = {}) {
    const tex = labelTexture(text, { w: 1024, h: Math.round(1024 * hh / w), bg, fg, border, size: Math.round(1024 * hh / w * 0.55) });
    const m = new Mesh(new PlaneGeometry(w, hh), new MeshBasicMaterial({ map: tex, color: new Color(1.3, 1.3, 1.3) }));
    toStation(s, h, z, m.position);
    const yaw = { '+z': 0, '-z': Math.PI, '+s': Math.PI / 2, '-s': -Math.PI / 2 }[facing] ?? 0;
    m.quaternion.copy(quatAt(s, yaw));
    this.group.add(m);
    return m;
  }
  screen(w, h, s, hh, z, yaw, draw, live = false) {
    const tex = canvasTexture(512, Math.round(512 * h / w), (c, cw, ch) => draw(c, cw, ch, 0));
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ map: tex, toneMapped: false }));
    toStation(s, hh, z, m.position);
    m.quaternion.copy(quatAt(s, yaw));
    this.group.add(m);
    const scr = { mesh: m, tex, draw, live, s };
    this.screens.push(scr);
    return scr;
  }
  interact(id, s, h, z, prompt, action, { radius = 1.4, hold = 0, enabled = () => true, posStation = null } = {}) {
    const pos = posStation ? posStation.clone() : toStation(s, h, z, new Vector3());
    const it = { id, pos, prompt, action, radius, hold, enabled, progress: 0 };
    this.interactables.push(it);
    return it;
  }

  // ---------------- room furnishings ------------------------------------------
  room_bridge(b, s0, s1, hw, x) {
    const M = this.M;
    // big curved main console near the far (spinward) end, facing back
    const cs = s0 + 17.2;
    for (let k = -4; k <= 4; k++) {
      const z = k * 0.62;
      const yaw = -k * 0.09;
      b.box(0.9, 0.95, 0.6, M.panelDark, cs + Math.abs(k) * 0.06 * Math.abs(k), 0, z, yaw);
      b.box(0.65, 0.05, 0.6, M.rubber, cs - 0.15 + Math.abs(k) * 0.06 * Math.abs(k), 0.95, z, yaw);
    }
    addObstacle(cs - 0.5, cs + 1.9, 0, 1.0, -2.8, 2.8, 'console');
    // three large screens above the console
    const live = (title) => (c, w, h, t) => this.drawBridgeScreen(c, w, h, title, t);
    this.bridgeScreens = [
      this.screen(1.5, 0.9, cs + 0.6, 1.75, -1.65, -Math.PI / 2 + 0.25, live('STATION'), true),
      this.screen(1.8, 1.05, cs + 0.75, 1.85, 0, -Math.PI / 2, live('MISSION'), true),
      this.screen(1.5, 0.9, cs + 0.6, 1.75, 1.65, -Math.PI / 2 - 0.25, live('CASE-9'), true),
    ];
    for (const z of [-1.65, 0, 1.65]) b.box(0.08, 1.2, 0.08, M.darkMetal, cs + 0.85, 0.95, z);
    this.interact('bridgeConsole', cs - 0.7, 1.0, 0, 'Use main console', () => this.game.emit('interact:bridgeConsole'), { radius: 1.8 });
    // captain's chair + two stations
    const chair = (s, z, yaw) => {
      b.cylUp(0.08, 0.45, M.metal, s, 0, z);
      b.box(0.6, 0.12, 0.6, M.seat, s, 0.45, z, yaw);
      b.box(0.12, 0.75, 0.6, M.seat, s - 0.3, 0.5, z, yaw);
      addObstacle(s - 0.4, s + 0.35, 0, 1.2, z - 0.35, z + 0.35, 'chair');
    };
    chair(s0 + 14.6, 0, 0);
    for (const z of [-2.2, 2.2]) {
      b.box(1.2, 0.85, 0.5, M.panelDark, s0 + 11.5, 0, z * 1.15);
      addObstacle(s0 + 10.9, s0 + 12.1, 0, 0.9, z * 1.15 - 0.3, z * 1.15 + 0.3, 'station');
      chair(s0 + 10.6, z * 0.95, 0);
      this.screen(0.9, 0.5, s0 + 11.5, 1.15, z * 1.15 - Math.sign(z) * 0.26, Math.sign(z) > 0 ? Math.PI : 0, (c, w, h) => this.drawNavScreen(c, w, h, z > 0 ? 'NAV' : 'COMMS'));
    }
    // mission patch + holo-ring decoration near the entry
    const patch = new Mesh(new CircleGeometry(0.55, 32), new MeshBasicMaterial({ map: patchTex() }));
    toStation(s0 + 3.0, 2.2, -hw + 0.03, patch.position);
    patch.quaternion.copy(quatAt(s0 + 3.0, 0));
    this.group.add(patch);
    this.sign('BRIDGE', s0 + 3.0, 2.95, -hw + 0.02, '+z', { w: 1.0, h: 0.28 });
    // wall cabinets
    for (const s of [s0 + 1.2, s0 + 2.0]) b.box(0.7, 2.0, 0.45, M.hullDark, s, 0, hw - 0.3);
    addObstacle(s0 + 0.8, s0 + 2.4, 0, 2.0, hw - 0.55, hw, 'cabinet');
    // plant + mug on a station desk
    b.cylUp(0.18, 0.35, M.darkMetal, s0 + 1.2, 0, -hw + 0.4);
    for (let k = 0; k < 7; k++) b.geo(new ConeGeometry(0.12, 0.5, 5), x.leaf, s0 + 1.2 + Math.sin(k) * 0.1, 0.55, -hw + 0.4 + Math.cos(k) * 0.1, k);
    b.cylUp(0.04, 0.1, x.white, s0 + 11.4, 0.85, 2.4);
  }

  room_corridor(b, s0, s1, hw, x) {
    const M = this.M;
    // lockers along the -z wall, galley along the +z wall
    for (let s = s0 + 1.0; s < s0 + 9; s += 0.62) {
      b.box(0.58, 2.1, 0.45, M.hullDark, s, 0, -hw + 0.25);
      b.box(0.04, 0.15, 0.02, M.metal, s + 0.18, 1.1, -hw + 0.49);
    }
    addObstacle(s0 + 0.7, s0 + 9.1, 0, 2.1, -hw, -hw + 0.5, 'lockers');
    // galley counter
    b.box(4.0, 0.92, 0.6, M.panel, s0 + 12.0, 0, hw - 0.32);
    b.box(4.0, 0.05, 0.64, M.darkMetal, s0 + 12.0, 0.92, hw - 0.32);
    addObstacle(s0 + 10.0, s0 + 14.0, 0, 0.97, hw - 0.64, hw, 'counter');
    // coffee machine + mugs
    b.box(0.35, 0.5, 0.35, M.darkMetal, s0 + 13.4, 0.97, hw - 0.3);
    b.box(0.08, 0.06, 0.1, M.lightRed, s0 + 13.24, 1.3, hw - 0.12);
    for (let k = 0; k < 3; k++) b.cylUp(0.04, 0.1, x.white, s0 + 11 + k * 0.25, 0.97, hw - 0.25);
    this.interact('coffee', s0 + 13.0, 1.1, hw - 0.6, 'Coffee machine', () => this.game.emit('interact:coffee'));
    // overhead cabinets
    b.box(4.0, 0.6, 0.35, M.hullDark, s0 + 12.0, 2.2, hw - 0.2);
    // table + stools
    b.cylUp(0.06, 0.75, M.metal, s0 + 16.5, 0, 0);
    b.box(1.0, 0.04, 0.8, x.wood, s0 + 16.5, 0.75, 0);
    addObstacle(s0 + 15.9, s0 + 17.1, 0, 0.8, -0.45, 0.45, 'table');
    for (const k of [-1, 1]) b.cylUp(0.18, 0.45, M.seat, s0 + 16.5 + k * 0.8, 0, 0.1 * k);
    // notice board
    const nb = new Mesh(new PlaneGeometry(1.0, 1.0), new MeshStandardMaterial({ map: noticeBoard(), roughness: 0.9 }));
    toStation(s0 + 16.0, 1.7, -hw + 0.03, nb.position);
    nb.quaternion.copy(quatAt(s0 + 16.0, 0));
    this.group.add(nb);
    // handrails
    for (const z of [-hw + 0.55, hw - 0.7]) b.pipeS(s0 + 9.5, s1 - 0.5, 1.05, z, 0.025, M.metal);
    this.interact('lockers', s0 + 5, 1.2, -hw + 0.9, 'Crew lockers', () => this.game.emit('interact:lockers'));
  }

  room_quarters(b, s0, s1, hw, x) {
    const M = this.M;
    // bunks: two stacked per side, curtains
    for (const [sb, side] of [[s0 + 3.5, -1], [s0 + 3.5, 1], [s0 + 8.5, -1], [s0 + 8.5, 1]]) {
      const z = side * (hw - 0.5);
      for (const h of [0.35, 1.55]) {
        b.box(2.1, 0.12, 0.95, M.hullDark, sb, h, z);
        b.box(1.95, 0.14, 0.85, h > 1 ? x.fabric : x.fabric2, sb, h + 0.12, z);
        b.box(0.4, 0.1, 0.6, x.white, sb - 0.75, h + 0.26, z);
      }
      b.box(2.1, 0.08, 0.95, M.hullDark, sb, 2.75, z);
      for (const ds of [-1.05, 1.05]) b.box(0.06, 2.8, 0.95, M.hullDark, sb + ds, 0, z);
      b.box(1.2, 1.0, 0.02, x.fabric, sb + 0.4, 1.7, z - side * 0.47);
      addObstacle(sb - 1.1, sb + 1.1, 0, 2.85, z - 0.5, z + 0.5, 'bunk');
    }
    // desk with lamp + photo
    b.box(1.4, 0.75, 0.6, x.wood, s0 + 13.5, 0, -hw + 0.32);
    addObstacle(s0 + 12.8, s0 + 14.2, 0, 0.8, -hw, -hw + 0.65, 'desk');
    b.cylUp(0.02, 0.4, M.metal, s0 + 13.0, 0.75, -hw + 0.3);
    b.box(0.2, 0.1, 0.2, x.trimLight, s0 + 13.0, 1.15, -hw + 0.3);
    b.box(0.25, 0.18, 0.02, M.darkMetal, s0 + 13.8, 0.75, -hw + 0.12);
    this.screen(0.7, 0.45, s0 + 13.5, 1.4, -hw + 0.04, 0, (c, w, h) => this.drawLog(c, w, h));
    // guitar leaning on the wall
    b.box(0.36, 0.5, 0.1, x.wood, s0 + 15.3, 0.1, hw - 0.18, 0.2);
    b.box(0.06, 0.6, 0.04, x.wood, s0 + 15.32, 0.6, hw - 0.18, 0.2);
    // lockers
    for (let s = s0 + 16.5; s < s1 - 0.8; s += 0.62) b.box(0.58, 2.1, 0.45, M.hullDark, s, 0, -hw + 0.25);
    addObstacle(s0 + 16.2, s1 - 0.5, 0, 2.1, -hw, -hw + 0.5, 'lockers');
    // sealed spoke B hatch in the ceiling
    const hs = s0 + L / 2;
    b.geo(new TorusGeometry(0.9, 0.08, 8, 28), M.hazard, hs, ROOM_H - 0.04, 0, 0, new Matrix4().makeRotationX(Math.PI / 2));
    b.geo(new CylinderGeometry(0.85, 0.85, 0.06, 28), M.darkMetal, hs, ROOM_H - 0.05, 0);
    this.sign('SPOKE B — SEALED', hs, 2.6, -hw + 0.02, '+z', { w: 1.1, h: 0.25, bg: '#2a0d0a', fg: '#ff9a80', border: '#b03020' });
    this.interact('spokeB', hs, 2.0, 0, 'Spoke B hatch (sealed)', () => this.game.emit('interact:spokeB'));
  }

  room_lab(b, s0, s1, hw, x) {
    const M = this.M;
    // benches on both sides
    for (const side of [-1, 1]) {
      const z = side * (hw - 0.45);
      b.box(9, 0.9, 0.85, M.panel, s0 + 7.5, 0, z);
      b.box(9, 0.04, 0.9, M.darkMetal, s0 + 7.5, 0.9, z);
      addObstacle(s0 + 3, s0 + 12, 0, 0.95, z - 0.45, z + 0.45, 'bench');
      // sample canisters / instruments
      for (let k = 0; k < 9; k++) {
        const s = s0 + 3.6 + k * 0.95;
        if (k % 3 === 0) { b.box(0.45, 0.35, 0.45, M.hullDark, s, 0.94, z); b.box(0.3, 0.2, 0.02, M.screenBlue, s, 1.04, z - side * 0.23); }
        else for (let j = 0; j < 3; j++) b.cylUp(0.05, 0.18 + j * 0.03, j % 2 ? M.glass : x.white, s + j * 0.13 - 0.13, 0.94, z + 0.1);
      }
    }
    // microscope
    b.box(0.3, 0.06, 0.3, M.darkMetal, s0 + 5.1, 0.94, hw - 0.45);
    b.cylUp(0.03, 0.4, M.metal, s0 + 5.0, 1.0, hw - 0.5);
    b.geo(new CylinderGeometry(0.04, 0.05, 0.25, 10), M.darkMetal, s0 + 5.1, 1.35, hw - 0.45, 0, new Matrix4().makeRotationZ(0.5));
    // glovebox
    b.box(1.4, 0.8, 0.8, M.glass, s0 + 14.5, 0.9, -hw + 0.5);
    b.box(1.5, 0.9, 0.85, M.darkMetal, s0 + 14.5, 0, -hw + 0.5);
    for (const ds of [-0.3, 0.3]) b.geo(new TorusGeometry(0.11, 0.025, 6, 16), M.rubber, s0 + 14.5 + ds, 1.25, -hw + 0.92);
    addObstacle(s0 + 13.7, s0 + 15.3, 0, 1.8, -hw, -hw + 0.95, 'glovebox');
    // rock samples (from Earth's moon, labelled)
    for (let k = 0; k < 5; k++) b.geo(new IcosahedronGeometry(0.07 + k * 0.01, 0), M.hullDark, s0 + 14.0 + k * 0.22, 1.0, -hw + 0.45);
    // centrifuge
    b.cylUp(0.35, 0.8, x.white, s0 + 17.5, 0, hw - 0.5);
    b.cylUp(0.3, 0.05, M.darkMetal, s0 + 17.5, 0.8, hw - 0.5);
    addObstacle(s0 + 17.1, s0 + 17.9, 0, 0.9, hw - 0.9, hw - 0.1, 'centrifuge');
    // whiteboard with the physics
    const wb = new Mesh(new PlaneGeometry(2.6, 1.3), new MeshStandardMaterial({ map: whiteboard(), roughness: 0.4 }));
    toStation(s0 + 17.0, 1.85, -hw + 0.03, wb.position);
    wb.quaternion.copy(quatAt(s0 + 17.0, 0));
    this.group.add(wb);
    this.interact('whiteboard', s0 + 17.0, 1.6, -hw + 0.9, 'Read the whiteboard', () => this.game.emit('interact:whiteboard'));
    // spectrum monitors
    for (const side of [-1, 1]) this.screen(1.1, 0.6, s0 + 9.5, 1.7, side * (hw - 0.04), side > 0 ? Math.PI : 0, (c, w, h, t) => this.drawSpectrum(c, w, h, t, side), true);
  }

  room_hydro(b, s0, s1, hw, x) {
    const M = this.M;
    // plant racks: 3 tiers each side, with leaves (instanced) and grow lights
    const leafGeo = new PlaneGeometry(0.16, 0.24);
    const leaves = [];
    for (const side of [-1, 1]) {
      const z = side * (hw - 0.55);
      for (let tier = 0; tier < 3; tier++) {
        const h = 0.3 + tier * 0.8;
        b.box(15, 0.06, 1.0, M.darkMetal, s0 + 10.5, h, z);
        b.box(15, 0.14, 0.9, x.water, s0 + 10.5, h + 0.06, z);
        b.box(15, 0.04, 0.2, x.purple, s0 + 10.5, h + 0.72, z);
        for (let k = 0; k < 44; k++) leaves.push({ s: s0 + 3.2 + k * 0.33 + Math.random() * 0.1, h: h + 0.22, z: z + (Math.random() - 0.5) * 0.6, tier, side });
      }
      for (let s = s0 + 3; s <= s0 + 18; s += 2.5) b.box(0.06, 2.5, 1.0, M.metal, s, 0, z);
      addObstacle(s0 + 2.9, s0 + 18.1, 0, 2.5, z - 0.55, z + 0.55, 'racks');
    }
    // instanced leaves
    const inst = new InstancedMesh(leafGeo, x.leaf, leaves.length * 4);
    const inst2 = new InstancedMesh(new SphereGeometry(0.035, 6, 4), x.tomato, leaves.length);
    const o = new Object3D();
    let n = 0, nt = 0;
    for (const l of leaves) {
      for (let j = 0; j < 4; j++) {
        toStation(l.s + (Math.random() - 0.5) * 0.1, l.h + Math.random() * 0.18, l.z + (Math.random() - 0.5) * 0.1, o.position);
        o.quaternion.copy(quatAt(l.s, Math.random() * 6.28)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.4 - Math.random() * 0.6));
        o.scale.setScalar(0.7 + Math.random() * 0.8);
        o.updateMatrix();
        inst.setMatrixAt(n++, o.matrix);
      }
      if (l.tier === 1 && Math.random() < 0.5) {
        toStation(l.s, l.h + 0.15, l.z, o.position); o.scale.setScalar(1); o.updateMatrix();
        inst2.setMatrixAt(nt++, o.matrix);
      }
    }
    inst.count = n; inst2.count = nt;
    inst.castShadow = true;
    this.group.add(inst, inst2);
    // water tanks + pipes at the far end
    for (const z of [-1.0, 1.0]) { b.cylUp(0.45, 1.6, M.radiator, s1 - 1.2, 0, z); b.cylUp(0.46, 0.08, M.darkMetal, s1 - 1.2, 1.2, z); }
    addObstacle(s1 - 1.75, s1 - 0.6, 0, 1.6, -1.5, 1.5, 'tanks');
    b.pipeS(s0 + 2, s1 - 1.5, 2.9, 0, 0.06, M.copper);
    for (let s = s0 + 3.5; s < s1 - 2; s += 3) b.cable([s, 2.9, 0], [s, 2.2, hw - 0.6], 0, 0.02, M.copper);
    this.screen(0.8, 0.5, s1 - 2.4, 1.6, -hw + 0.04, 0, (c, w, h, t) => this.drawHydro(c, w, h, t), true);
    this.interact('plants', s0 + 10, 1.2, 0, 'Inspect the crops', () => this.game.emit('interact:plants'));
    this.hydroS = s0 + L / 2;
  }

  room_airlock(b, s0, s1, hw, x) {
    const M = this.M;
    // hazard stripes on the floor around the ladder
    b.raw(surf((u, v, o) => toStation(u, 0.01, v, o), SPOKE_S - 1.4, SPOKE_S + 1.4, 0.7, -1.4, 1.4, 0.7, { hole: (u, v) => Math.abs(u - SPOKE_S) < 1.15 && Math.abs(v) < 1.15, ub: [SPOKE_S - 1.15, SPOKE_S + 1.15], vb: [-1.15, 1.15] }), M.hazard);
    // ladder from the floor up through the ceiling hatch
    this.ladderRungs(b, R, RING_CEIL_R - 0.05);
    // hatch ring in the ceiling
    b.geo(new TorusGeometry(1.12, 0.09, 8, 32), M.hazard, SPOKE_S, ROOM_H - 0.04, 0, 0, new Matrix4().makeRotationX(Math.PI / 2));
    this.sign('SPOKE A  ↑  HUB · GRAVITY FALLS TO ZERO', SPOKE_S - 1.8, 2.7, -hw + 0.02, '+z', { w: 2.2, h: 0.3 });
    // EVA suit rack
    for (let k = 0; k < 3; k++) {
      const s = s0 + 3 + k * 1.1, z = hw - 0.45;
      b.box(0.55, 0.75, 0.4, x.white, s, 0.85, z);
      b.sphere(0.2, x.white, s, 1.82, z);
      b.box(0.5, 0.6, 0.2, M.hullDark, s, 0.95, z + 0.28);
      for (const ds of [-0.17, 0.17]) b.box(0.16, 0.8, 0.16, x.white, s + ds, 0.05, z);
    }
    b.box(3.5, 0.1, 0.6, M.metal, s0 + 4.1, 2.15, hw - 0.4);
    addObstacle(s0 + 2.5, s0 + 6, 0, 2.2, hw - 0.75, hw, 'suits');
    this.interact('suitGas', s0 + 4.1, 1.2, hw - 1.0, 'Refill suit thruster pack', () => this.game.emit('interact:suitGas'));
    // external airlock door (sealed)
    b.box(0.2, 2.4, 1.6, M.hullDark, s0 + 9, 0, -hw + 0.1);
    b.geo(new TorusGeometry(0.5, 0.05, 6, 24), M.hazard, s0 + 9, 1.3, -hw + 0.22);
    this.sign('EVA AIRLOCK · CYCLE FROM PANEL', s0 + 9, 2.6, -hw + 0.22, '+z', { w: 1.6, h: 0.25 });
    this.screen(0.6, 0.4, s0 + 10.3, 1.4, -hw + 0.04, 0, (c, w, h, t) => this.drawPressure(c, w, h, t), true);
  }

  ladderRungs(b, rhoBottom, rhoTop) {
    const M = this.M;
    // ladder: two rails and rungs on the spinward side of the spoke axis
    const th = SPOKE_THETA;
    const t = new Vector3(-Math.sin(th), Math.cos(th), 0);
    const r = new Vector3(Math.cos(th), Math.sin(th), 0);
    const len = rhoBottom - rhoTop;
    for (const z of [-0.24, 0.24]) {
      const mid = r.clone().multiplyScalar((rhoBottom + rhoTop) / 2).addScaledVector(t, LADDER_OFF).add(new Vector3(0, 0, z));
      const m = new Matrix4().compose(mid, new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), r), new Vector3(1, 1, 1));
      b.b.addMatrix(new CylinderGeometry(0.03, 0.03, len, 8), M.metal, m);
    }
    for (let rho = rhoTop + 0.15; rho < rhoBottom - 0.1; rho += 0.32) {
      const mid = r.clone().multiplyScalar(rho).addScaledVector(t, LADDER_OFF);
      const m = new Matrix4().compose(mid, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2), new Vector3(1, 1, 1));
      b.b.addMatrix(new CylinderGeometry(0.022, 0.022, 0.5, 8), M.metal, m);
    }
  }

  // ---------------- spoke --------------------------------------------------------
  buildSpoke() {
    const M = this.M;
    const b = new Builder();
    const th = SPOKE_THETA;
    const r = new Vector3(Math.cos(th), Math.sin(th), 0);
    const t = new Vector3(-Math.sin(th), Math.cos(th), 0);
    const rhoTop = HUB_R - 0.05, rhoBot = RING_CEIL_R;
    const len = rhoBot - rhoTop;
    // tube wall (inward-facing)
    const wall = surf((u, v, o) => o.copy(r).multiplyScalar(u).addScaledVector(t, Math.cos(v) * SPOKE_R).add(new Vector3(0, 0, Math.sin(v) * SPOKE_R)), rhoTop, rhoBot, 1.0, 0, Math.PI * 2, Math.PI / 10, { flip: true, uvs: 0.6 });
    b.raw(wall, M.panel);
    this.ladderRungs(b, rhoBot + 0.05, rhoTop);
    // ring lamps + gravity placards every 3 m
    const lampMat = new MeshBasicMaterial({ color: new Color(2.6, 2.4, 2.0) });
    this.spokeSigns = [];
    for (let rho = rhoTop + 2; rho < rhoBot - 0.5; rho += 3) {
      const m = new Matrix4().compose(r.clone().multiplyScalar(rho), new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), r), new Vector3(1, 1, 1));
      b.b.addMatrix(new TorusGeometry(SPOKE_R - 0.04, 0.035, 6, 24), lampMat, m);
      if (Math.round(rho) % 6 === 0 || rho > rhoBot - 3.5) {
        const g = (RING_OMEGA * RING_OMEGA * rho) / G0;
        const tex = labelTexture([`${g.toFixed(2)} g`, `r = ${rho.toFixed(1)} m`], { w: 256, h: 128, size: 60 });
        const p = new Mesh(new PlaneGeometry(0.42, 0.21), new MeshBasicMaterial({ map: tex, color: new Color(1.4, 1.4, 1.4) }));
        p.position.copy(r).multiplyScalar(rho).addScaledVector(t, -0.95).add(new Vector3(0, 0, 0.45));
        p.up.copy(r).negate();
        p.lookAt(p.position.clone().add(t));
        this.group.add(p);
      }
    }
    // cable runs
    for (const a of [2.2, 4.0]) {
      const off = t.clone().multiplyScalar(Math.cos(a) * (SPOKE_R - 0.08)).add(new Vector3(0, 0, Math.sin(a) * (SPOKE_R - 0.08)));
      const m = new Matrix4().compose(r.clone().multiplyScalar((rhoTop + rhoBot) / 2).add(off), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), r), new Vector3(1, 1, 1));
      b.b.addMatrix(new CylinderGeometry(0.03, 0.03, len, 6), M.cable, m);
    }
    this.fixtures.push({ pos: r.clone().multiplyScalar(26), color: 0xfff0dc, i: 0.8 }, { pos: r.clone().multiplyScalar(12), color: 0xfff0dc, i: 0.8 });
    this.group.add(b.build());
  }

  // ---------------- hub, tunnel ----------------------------------------------------
  buildHub() {
    const M = this.M;
    const b = new Builder();
    const spokeA = SPOKE_THETA;
    const hw = SPOKE_R / HUB_R + 0.02;
    const winZ = [-3.35, -2.65];
    const holes = (u, v) => {
      // spoke hatch
      let da = Math.atan2(Math.sin(u - spokeA), Math.cos(u - spokeA));
      if (Math.abs(da) < hw && Math.abs(v) < SPOKE_R) return true;
      // observation windows
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; da = Math.atan2(Math.sin(u - a), Math.cos(u - a)); if (Math.abs(da) < 0.19 && v > winZ[0] && v < winZ[1]) return true; }
      return false;
    };
    const ub = [spokeA - hw, spokeA + hw];
    for (let k = 0; k < 8; k++) ub.push((k / 8) * Math.PI * 2 - 0.19, (k / 8) * Math.PI * 2 + 0.19);
    const cyl = surf((u, v, o) => o.set(Math.cos(u) * HUB_R, Math.sin(u) * HUB_R, v), 0, Math.PI * 2, Math.PI / 24, HUB_Z0, HUB_Z1, 1.0, { flip: false, hole: holes, ub: ub.map((x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)), vb: [-SPOKE_R, SPOKE_R, ...winZ], uvs: 0.4 });
    b.raw(cyl, M.panel);
    // window glass
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.raw(surf((u, v, o) => o.set(Math.cos(u) * (HUB_R + 0.05), Math.sin(u) * (HUB_R + 0.05), v), a - 0.19, a + 0.19, 0.1, winZ[0], winZ[1], 1, {}), M.glass);
    }
    // end caps: aft (sealed hatch) and forward with the docking hatch opening
    const capAft = surf((u, v, o) => o.set(Math.cos(v) * u, Math.sin(v) * u, HUB_Z0), 0.01, HUB_R, 0.6, 0, Math.PI * 2, Math.PI / 16, { flip: true });
    const capFwd = surf((u, v, o) => o.set(Math.cos(v) * u, Math.sin(v) * u, HUB_Z1), 0.56, HUB_R, 0.6, 0, Math.PI * 2, Math.PI / 16, { flip: false });
    b.raw(capAft, M.panelDark);
    b.raw(capFwd, M.panelDark);
    b.raw(new TorusGeometry(0.56, 0.06, 8, 32).translate(0, 0, HUB_Z1 - 0.02), M.hazard);
    b.raw(new TorusGeometry(0.7, 0.05, 8, 32).translate(0, 0, HUB_Z0 + 0.03), M.hazard);
    b.raw(new CylinderGeometry(0.65, 0.65, 0.05, 32).rotateX(Math.PI / 2).translate(0, 0, HUB_Z0 + 0.04), M.darkMetal);
    // spoke A hatch collar in the hub wall
    const sA = new Vector3(Math.cos(spokeA), Math.sin(spokeA), 0);
    b.b.addMatrix(new TorusGeometry(SPOKE_R + 0.05, 0.08, 8, 28), M.hazard, new Matrix4().compose(sA.clone().multiplyScalar(HUB_R - 0.02), new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), sA), new Vector3(1, 1, 1)));
    // handrails along z at six angles, ring rails near the ends
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.26;
      const p = new Vector3(Math.cos(a) * (HUB_R - 0.18), Math.sin(a) * (HUB_R - 0.18), 0);
      b.b.addMatrix(new CylinderGeometry(0.028, 0.028, 9.2, 8), M.metal, new Matrix4().compose(p, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2), new Vector3(1, 1, 1)));
      this.rails.push({ a: p.clone().setZ(-4.6), b: p.clone().setZ(4.6) });
    }
    for (const z of [-4.2, 4.2, 0.0]) b.raw(new TorusGeometry(HUB_R - 0.2, 0.026, 6, 48).translate(0, 0, z), M.metal);
    // storage boxes, nets, consoles at a few angles
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.6;
      if (Math.abs(Math.atan2(Math.sin(a - spokeA), Math.cos(a - spokeA))) < 0.6) continue;
      const z = -1.6 + (k % 3) * 1.6;
      const p = new Vector3(Math.cos(a) * (HUB_R - 0.35), Math.sin(a) * (HUB_R - 0.35), z);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a);
      b.b.addMatrix(new BoxGeometry(0.5, 0.7, 0.9), k % 2 ? M.hullDark : M.radiator, new Matrix4().compose(p, q, new Vector3(1, 1, 1)));
    }
    // lights ring
    const lampMat = new MeshBasicMaterial({ color: new Color(2.4, 2.4, 2.6) });
    for (const z of [-3.9, 3.9]) b.raw(new TorusGeometry(HUB_R - 0.05, 0.05, 6, 48).translate(0, 0, z), lampMat);
    // docking tunnel to the Kestrel
    b.raw(surf((u, v, o) => o.set(Math.cos(u) * 0.55, Math.sin(u) * 0.55, v), 0, Math.PI * 2, Math.PI / 12, HUB_Z1, PORT_Z + 0.05, 0.3, { flip: false }), M.panelDark);
    for (const z of [HUB_Z1 + 0.1, PORT_Z]) b.raw(new TorusGeometry(0.5, 0.03, 6, 24).translate(0, 0, z), lampMat);
    this.hubMesh = b.build();
    this.group.add(this.hubMesh);
    // hub signage + console screen
    const s = new Mesh(new PlaneGeometry(1.6, 0.4), new MeshBasicMaterial({ map: labelTexture(['HUB · 0 g', 'PORT A → KESTREL   ·   SPOKE A → RING'], { w: 1024, h: 256, size: 90 }), color: new Color(1.3, 1.3, 1.3), side: DoubleSide }));
    s.position.set(0, 1.6, HUB_Z1 - 0.06); s.rotation.y = Math.PI;
    this.group.add(s);
    this.fixtures.push({ pos: new Vector3(0, 0, -2.5), color: 0xe8f0ff, i: 1.2 }, { pos: new Vector3(0, 0, 3.0), color: 0xe8f0ff, i: 1.0 });
    // interactables
    this.interact('board', 0, 0, 0, 'Take the pilot seat', () => this.game.emit('interact:board'), { posStation: new Vector3(0, 0.6, 12.25 - 4.45), radius: 1.0, enabled: () => this.space.kestrelDocked });
    this.interact('hubLog', 0, 0, 0, 'Hub status panel', () => this.game.emit('interact:hubLog'), { posStation: new Vector3(0, -2.9, 1.2), radius: 1.5 });
  }

  buildDoor(b, d) {
    const M = this.M;
    const g = new Group();
    const hwRoom = 3;
    // frame
    const fs = d.s;
    b.box(0.35, 0.18, DOOR_W * 2 + 0.4, M.hullDark, fs, DOOR_H, 0);
    for (const z of [-DOOR_W - 0.12, DOOR_W + 0.12]) b.box(0.35, DOOR_H, 0.2, M.hullDark, fs, 0, z);
    // the two sliding panels
    const mats = M.panelDark;
    const panels = [];
    for (const side of [-1, 1]) {
      const m = new Mesh(new BoxGeometry(0.08, DOOR_H, DOOR_W), mats);
      m.castShadow = true;
      g.add(m);
      panels.push({ mesh: m, side });
    }
    // status lights both sides
    const lamp = new MeshBasicMaterial({ color: new Color(0.3, 3, 0.6) });
    for (const ds of [-0.2, 0.2]) {
      const l = new Mesh(new BoxGeometry(0.04, 0.06, 0.18), lamp);
      toStation(fs + ds, DOOR_H + 0.25, 0, l.position);
      l.quaternion.copy(quatAt(fs));
      this.group.add(l);
    }
    // labels on both faces
    const before = ROOMS[d.k - 1].name, after = ROOMS[d.k].name;
    this.sign(`${after}  →`, fs - 0.19, DOOR_H + 0.45, 0, '-s', { w: 1.3, h: 0.24 });
    this.sign(`←  ${before}`, fs + 0.19, DOOR_H + 0.45, 0, '+s', { w: 1.3, h: 0.24 });
    this.group.add(g);
    this.doorMeshes.push({ door: d, panels, lamp, group: g, wasOpen: false });
    void hwRoom;
  }

  // ---------------- lights ----------------------------------------------------------
  buildLights() {
    for (let i = 0; i < 4; i++) {
      const l = new PointLight(0xffe7c8, 0, 9, 1.6);
      this.group.add(l);
      this.lights.push(l);
    }
    for (const f of this.fixtures) if (!f.pos) f.pos = toStation(f.s, f.h, f.z, new Vector3());
  }

  // ---------------- runtime ------------------------------------------------------------
  update(dt, playerPos) {
    this.t += dt;
    const t = this.t;
    // doors: open when the player is near (and unlocked)
    for (const dm of this.doorMeshes) {
      const d = dm.door;
      const ps = playerPos ? Math.atan2(playerPos.y, playerPos.x) : 0;
      let pS = (ps < -Math.PI / 2 ? ps + Math.PI * 2 : ps) * R;
      const near = playerPos && Math.abs(pS - d.s) < 2.4 && Math.abs(playerPos.z) < 2.5 && Math.hypot(playerPos.x, playerPos.y) > RING_CEIL_R - 0.5;
      const target = near && !d.locked ? 1 : 0;
      const prev = d.open;
      d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 2.2);
      if (prev === 0 && d.open > 0) this.game.audio?.door();
      for (const p of dm.panels) {
        const z = p.side * (DOOR_W / 2 + d.open * DOOR_W * 0.98);
        toStation(d.s, DOOR_H / 2, z, p.mesh.position);
        p.mesh.quaternion.copy(quatAt(d.s));
      }
      dm.lamp.color.setRGB(d.locked ? 3 : 0.3, d.locked ? 0.3 : 3, d.locked ? 0.2 : 0.6);
    }
    // flickering fixtures
    const fl = Math.random() < 0.06 ? 0.15 + Math.random() * 0.4 : 1;
    this.flicker = this.flicker === undefined ? 1 : this.flicker + (fl - this.flicker) * 0.6;
    this.flickerMat.color.setRGB(2.4 * this.flicker, 2.2 * this.flicker, 1.9 * this.flicker);
    // assign the 4 dynamic lights to the nearest fixtures
    if (playerPos) {
      const sorted = this.fixtures.map((f) => ({ f, d: f.pos.distanceToSquared(playerPos) })).sort((a, b) => a.d - b.d);
      for (let i = 0; i < this.lights.length; i++) {
        const l = this.lights[i], e = sorted[i];
        if (!e) { l.intensity = 0; continue; }
        l.position.copy(e.f.pos);
        l.color.setHex(e.f.color);
        l.intensity = 22 * e.f.i * (e.f.flicker ? this.flicker : 1);
        l.distance = 11;
      }
    }
    // live screens (2 Hz)
    this._scr = (this._scr || 0) - dt;
    if (this._scr <= 0) {
      this._scr = 0.5;
      for (const s of this.screens) {
        if (!s.live) continue;
        if (playerPos && s.mesh.position.distanceTo(playerPos) > 14) continue;
        const c = s.tex.userData.ctx;
        s.draw(c, s.tex.userData.canvas.width, s.tex.userData.canvas.height, t);
        s.tex.needsUpdate = true;
      }
    }
  }

  // ---------------- screen painters -------------------------------------------------
  drawBridgeScreen(c, w, h, title, t) {
    const g = this.game, W = g.world, S = W.meridian;
    c.fillStyle = '#020a10'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1d6f8a'; c.lineWidth = 4; c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#7fd8ff'; c.font = '600 26px Share Tech Mono, monospace';
    c.fillText(title, 18, 36);
    c.font = '20px Share Tech Mono, monospace';
    if (title === 'STATION') {
      const spin = S.spinRate;
      const lines = [`SPIN    ${rpm(spin).toFixed(2)} RPM`, `RING g  ${((spin * spin * R) / G0).toFixed(3)} g`, `MASS    ${(S.body.mass / 1000).toFixed(1)} t`, `CoM OFF ${S.comOffset().toFixed(3)} m`, `HULL    NOMINAL`, `O2      20.9 %`];
      lines.forEach((l, i) => c.fillText(l, 18, 72 + i * 28));
      // spinning ring glyph
      c.save(); c.translate(w - 70, h / 2 + 10); c.rotate(t * spin);
      c.strokeStyle = '#e8c27a'; c.lineWidth = 6; c.beginPath(); c.arc(0, 0, 44, 0, 7); c.stroke();
      for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(0, 0); c.lineTo(44, 0); c.stroke(); }
      c.restore();
    } else if (title === 'MISSION') {
      const m = g.mission;
      c.fillStyle = '#e9e6dc'; c.font = '600 24px Rajdhani, sans-serif';
      const lines = (m?.briefingText || ['MERIDIAN EXPEDITION ONE', 'Standing by for briefing.']).slice(0, 7);
      lines.forEach((l, i) => c.fillText(l, 18, 74 + i * 30));
      c.fillStyle = '#7fd8ff'; c.font = '18px Share Tech Mono, monospace';
      c.fillText(`EARTH +${(W.clock.earth / 86400).toFixed(1)} d   SHIP ${(W.clock.ship / 3600).toFixed(2)} h`, 18, h - 20);
    } else {
      // CASE-9: voice waveform
      c.strokeStyle = '#7fd8ff'; c.lineWidth = 3; c.beginPath();
      const talking = g.ui.subs.active.some((a) => a.who === 'case' && !a.fading);
      for (let x = 0; x < w - 40; x += 4) {
        const y = h / 2 + 10 + Math.sin(x * 0.07 + t * 9) * (talking ? 30 * Math.sin(x * 0.013 + t * 3) : 3) * Math.random();
        if (x === 0) c.moveTo(20 + x, y); else c.lineTo(20 + x, y);
      }
      c.stroke();
      c.fillStyle = '#7fd8ff'; c.font = '18px Share Tech Mono, monospace';
      c.fillText(talking ? 'TRANSMITTING' : 'LISTENING', 18, h - 22);
    }
  }
  drawNavScreen(c, w, h, title) {
    c.fillStyle = '#03080c'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#2c6e86'; c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#f0b44c'; c.font = '600 28px Share Tech Mono, monospace'; c.fillText(title, 16, 38);
    c.strokeStyle = '#7fd8ff'; c.beginPath(); c.ellipse(w * 0.6, h * 0.58, w * 0.25, h * 0.25, 0.3, 0, 7); c.stroke();
    c.fillStyle = '#6dff9c'; c.beginPath(); c.arc(w * 0.6 + w * 0.2, h * 0.5, 6, 0, 7); c.fill();
    c.fillStyle = '#7fd8ff'; c.font = '18px Share Tech Mono, monospace';
    c.fillText(title === 'NAV' ? 'HOLD · INERTIAL' : 'HALDEN LINK · 42 ms', 16, h - 18);
  }
  drawLog(c, w, h) {
    c.fillStyle = '#0a0d10'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c9c3b3'; c.font = '17px Share Tech Mono, monospace';
    ['PERSONAL LOG · DAY 211', '', 'Coffee rationing continues.', 'CASE-9 claims it does not', 'dream. It asked me what', 'it would dream about.', 'I did not have an answer.'].forEach((l, i) => c.fillText(l, 16, 30 + i * 24));
  }
  drawSpectrum(c, w, h, t, side) {
    c.fillStyle = '#020608'; c.fillRect(0, 0, w, h);
    c.strokeStyle = side > 0 ? '#6dff9c' : '#f0b44c'; c.lineWidth = 2; c.beginPath();
    for (let x = 0; x < w; x += 3) {
      const y = h * 0.75 - (Math.exp(-((x - w * 0.35) ** 2) / 900) * 120 + Math.exp(-((x - w * 0.7) ** 2) / 400) * 70 + Math.random() * 8 + Math.sin(x * 0.05 + t) * 5);
      if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.fillStyle = '#7fd8ff'; c.font = '16px Share Tech Mono, monospace'; c.fillText(side > 0 ? 'SKADI ICE CORE · H2O / CO2' : 'PELAGIA SURFACE · Na Cl Mg', 12, 22);
  }
  drawHydro(c, w, h, t) {
    c.fillStyle = '#05080a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#d27cff'; c.font = '18px Share Tech Mono, monospace';
    ['NUTRIENT  pH 6.1', `EC   ${(1.8 + Math.sin(t * 0.2) * 0.05).toFixed(2)} mS`, 'LUX  410 µmol', 'RACK 4 · LETTUCE (TEST)'].forEach((l, i) => c.fillText(l, 14, 32 + i * 30));
  }
  drawPressure(c, w, h, t) {
    c.fillStyle = '#05080a'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#6dff9c'; c.font = '20px Share Tech Mono, monospace';
    c.fillText('CABIN  101.3 kPa', 12, 32); c.fillText('EVA    0.0 kPa', 12, 62); c.fillText('SPOKE  101.2 kPa', 12, 92);
  }
}
