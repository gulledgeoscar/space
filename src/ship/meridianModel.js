// The Meridian's exterior: hub, twelve curved ring modules (separate groups
// so they can break away), spokes, solar wings, radiators, rim thrusters,
// beacons and the glowing windows that line up with the walkable interior.

import {
  Group, Mesh, BufferGeometry, Float32BufferAttribute, Vector3, CylinderGeometry, BoxGeometry,
  SphereGeometry, TorusGeometry, PlaneGeometry, MeshBasicMaterial, MeshStandardMaterial, Color,
  DoubleSide, ConeGeometry, AdditiveBlending,
} from 'three';
import { GeoBatch, labelTexture } from '../world/geometry.js';
import { materials } from '../world/materials.js';
import { RING_MODULES, RING_FLOOR_R, RING_CEIL_R, MODULE_ARC } from '../physics/constants.js';
import { moduleAngle, SPOKE_MODULES, RIM_R, MODULE_MID_R } from './meridian.js';

export const SHELL_IN = RING_CEIL_R - 0.25;
export const SHELL_OUT = RING_FLOOR_R + 0.3;
export const SHELL_Z = 3.25;

// Window openings in the walkable interior (s measured along the floor from
// the module's start, h above the floor). Shared with the interior builder.
export const MODULE_WINDOWS = {
  0: [ // bridge: tall side windows both walls + floor viewport
    { side: 1, s0: 4, s1: 9, h0: 0.9, h1: 2.9 }, { side: 1, s0: 11, s1: 16, h0: 0.9, h1: 2.9 },
    { side: -1, s0: 4, s1: 9, h0: 0.9, h1: 2.9 }, { side: -1, s0: 11, s1: 16, h0: 0.9, h1: 2.9 },
    { side: 0, s0: 13.4, s1: 16.6, z0: -1.2, z1: 1.2 },
  ],
  2: [{ side: 1, s0: 7, s1: 9, h0: 1.2, h1: 2.2 }, { side: 1, s0: 13, s1: 15, h0: 1.2, h1: 2.2 }],
  3: [{ side: -1, s0: 8, s1: 13, h0: 1.1, h1: 2.4 }],
  4: [{ side: 1, s0: 3, s1: 18, h0: 2.4, h1: 3.3 }, { side: -1, s0: 3, s1: 18, h0: 2.4, h1: 3.3 }],
  5: [{ side: 1, s0: 15, s1: 17, h0: 1.2, h1: 2.4 }],
};

// Curved box between radii [rIn, rOut], |z| <= zh, angles [a0, a1].
export function arcBox(rIn, rOut, zh, a0, a1, segs = 12, caps = true) {
  const pos = [], nor = [], uv = [];
  const push = (p, n, u, v) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); uv.push(u, v); };
  const P = (r, a, z) => [r * Math.cos(a), r * Math.sin(a), z];
  const quad = (p0, p1, p2, p3, n0, n1, n2, n3, uvs) => {
    push(p0, n0, ...uvs[0]); push(p1, n1, ...uvs[1]); push(p2, n2, ...uvs[2]);
    push(p0, n0, ...uvs[0]); push(p2, n2, ...uvs[2]); push(p3, n3, ...uvs[3]);
  };
  const L = (a1 - a0) * rOut;
  for (let i = 0; i < segs; i++) {
    const t0 = a0 + ((a1 - a0) * i) / segs, t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    const u0 = (i / segs) * L / 8, u1 = ((i + 1) / segs) * L / 8;
    const nO0 = [Math.cos(t0), Math.sin(t0), 0], nO1 = [Math.cos(t1), Math.sin(t1), 0];
    const nI0 = nO0.map((x) => -x), nI1 = nO1.map((x) => -x);
    // outer face (normal outward)
    quad(P(rOut, t0, -zh), P(rOut, t1, -zh), P(rOut, t1, zh), P(rOut, t0, zh), nO0, nO1, nO1, nO0, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
    // inner face (normal inward toward axis)
    quad(P(rIn, t0, zh), P(rIn, t1, zh), P(rIn, t1, -zh), P(rIn, t0, -zh), nI0, nI1, nI1, nI0, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
    // +z face
    quad(P(rIn, t0, zh), P(rOut, t0, zh), P(rOut, t1, zh), P(rIn, t1, zh), [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [[u0, 0], [u0, 0.5], [u1, 0.5], [u1, 0]]);
    // -z face
    quad(P(rIn, t1, -zh), P(rOut, t1, -zh), P(rOut, t0, -zh), P(rIn, t0, -zh), [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], [[u1, 0], [u1, 0.5], [u0, 0.5], [u0, 0]]);
  }
  // end caps
  const e0 = [Math.sin(a0), -Math.cos(a0), 0], e1 = [-Math.sin(a1), Math.cos(a1), 0];
  if (caps) quad(P(rIn, a0, -zh), P(rOut, a0, -zh), P(rOut, a0, zh), P(rIn, a0, zh), e0, e0, e0, e0, [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
  if (caps) quad(P(rIn, a1, zh), P(rOut, a1, zh), P(rOut, a1, -zh), P(rIn, a1, -zh), e1, e1, e1, e1, [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  return g;
}

// A structural band hugging the OUTSIDE of a module shell at angle a (so
// it never intrudes into the walkable interior).
export function shellBand(a, halfAngle, t = 0.1) {
  const parts = [
    arcBox(SHELL_OUT, SHELL_OUT + t, SHELL_Z + t, a - halfAngle, a + halfAngle, 1),
    arcBox(SHELL_IN - t, SHELL_IN, SHELL_Z + t, a - halfAngle, a + halfAngle, 1),
  ];
  for (const sz of [-1, 1]) {
    const g = arcBox(SHELL_IN - t, SHELL_OUT + t, t / 2, a - halfAngle, a + halfAngle, 1);
    g.translate(0, 0, sz * (SHELL_Z + t / 2));
    parts.push(g);
  }
  return parts;
}

// A curved window pane facing out of a module side (side = +1/-1 z) or the
// floor (side 0, faces outward radially).
function windowPane(w, a0) {
  const R = RING_FLOOR_R;
  const s2a = (s) => a0 + s / R;
  if (w.side === 0) {
    const g = arcBox(SHELL_OUT + 0.01, SHELL_OUT + 0.02, (w.z1 - w.z0) / 2, s2a(w.s0), s2a(w.s1), 4);
    g.translate(0, 0, (w.z0 + w.z1) / 2);
    return g;
  }
  const pos = [];
  const segs = 6;
  const z = w.side * (SHELL_Z + 0.02);
  for (let i = 0; i < segs; i++) {
    const t0 = s2a(w.s0 + ((w.s1 - w.s0) * i) / segs), t1 = s2a(w.s0 + ((w.s1 - w.s0) * (i + 1)) / segs);
    const r0 = R - w.h0, r1 = R - w.h1;
    const p = (r, a) => [r * Math.cos(a), r * Math.sin(a), z];
    const A = p(r0, t0), B = p(r0, t1), C = p(r1, t1), D = p(r1, t0);
    if (w.side > 0) pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    else pos.push(...A, ...C, ...B, ...A, ...D, ...C);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

export function buildMeridianModel() {
  const M = materials();
  const root = new Group();
  root.name = 'Meridian';
  const winMat = new MeshBasicMaterial({ color: new Color(2.2, 1.7, 1.1) });
  const winMatCool = new MeshBasicMaterial({ color: new Color(1.0, 1.6, 2.2) });

  // ---- ring modules ---------------------------------------------------------
  const modules = [];
  const gap = 0.04 / RING_FLOOR_R;
  for (let i = 0; i < RING_MODULES; i++) {
    const a0 = (i / RING_MODULES) * Math.PI * 2, a1 = ((i + 1) / RING_MODULES) * Math.PI * 2;
    const group = new Group();
    group.name = `module${i}`;
    const b = new GeoBatch();
    // no end caps: neighbouring modules butt together and the walkable
    // rooms run straight through the joints
    const shell = new Mesh(arcBox(SHELL_IN, SHELL_OUT, SHELL_Z, a0 + gap, a1 - gap, 16, false), i % 3 === 1 ? M.hullDark : M.hull);
    shell.castShadow = true; shell.receiveShadow = true;
    shell.userData.exteriorShell = true;
    group.add(shell);
    // ribs
    for (let k = 1; k < 4; k++) {
      const a = a0 + gap + ((a1 - a0 - 2 * gap) * k) / 4;
      for (const g of shellBand(a, 0.006, 0.08)) b.add(g, M.hullDark);
    }
    // windows
    for (const w of MODULE_WINDOWS[i] || []) b.add(windowPane(w, a0), i === 4 ? winMatCool : winMat);
    // small running lights along the rim
    for (let k = 0; k < 3; k++) {
      const a = a0 + ((a1 - a0) * (k + 0.5)) / 3;
      b.add(new SphereGeometry(0.12, 6, 4), k === 1 ? M.lightAmber : M.lightWhite, new Vector3(Math.cos(a) * (SHELL_OUT + 0.1), Math.sin(a) * (SHELL_OUT + 0.1), SHELL_Z + 0.1));
    }
    // radiators on alternate modules (outer face, fins)
    if (i % 2 === 0) {
      for (let k = 0; k < 4; k++) {
        const a = a0 + ((a1 - a0) * (k + 0.5)) / 4;
        b.box(2.4, 0.08, 5.6, M.radiator, new Vector3(Math.cos(a) * (SHELL_OUT + 1.2), Math.sin(a) * (SHELL_OUT + 1.2), 0), { x: 0, y: 0, z: a });
      }
    }
    // module number on both sides
    const mid = (a0 + a1) / 2;
    const tex = labelTexture(`M-${String(i + 1).padStart(2, '0')}`, { w: 256, h: 128, bg: 'rgba(0,0,0,0)', fg: '#2a2c30', border: null, size: 80 });
    for (const side of [-1, 1]) {
      const p = new Mesh(new PlaneGeometry(3.2, 1.6), new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      p.position.set(Math.cos(mid + 0.12) * (RING_FLOOR_R - 2.0), Math.sin(mid + 0.12) * (RING_FLOOR_R - 2.0), side * (SHELL_Z + 0.03));
      p.rotation.set(0, side > 0 ? 0 : Math.PI, mid - Math.PI / 2 + (side > 0 ? 0 : 0));
      if (side < 0) p.rotation.z = -(mid - Math.PI / 2) + Math.PI; // keep readable from outside
      group.add(p);
    }
    group.add(b.build());
    root.add(group);
    modules.push(group);
  }
  // big ring lettering
  const nameTex = labelTexture('MERIDIAN', { w: 1024, h: 160, bg: 'rgba(0,0,0,0)', fg: '#c74f15', border: null, size: 130 });
  for (const i of [1, 7]) {
    const mid = moduleAngle(i);
    const p = new Mesh(new PlaneGeometry(12, 1.9), new MeshBasicMaterial({ map: nameTex, transparent: true, depthWrite: false }));
    p.position.set(Math.cos(mid) * (RING_FLOOR_R - 1.8), Math.sin(mid) * (RING_FLOOR_R - 1.8), SHELL_Z + 0.04);
    p.rotation.z = mid - Math.PI / 2;
    modules[i].add(p);
  }

  // ---- connectors between modules ------------------------------------------
  const cb = new GeoBatch();
  for (let i = 0; i < RING_MODULES; i++) {
    const a = (i / RING_MODULES) * Math.PI * 2;
    const p = new Vector3(Math.cos(a) * MODULE_MID_R, Math.sin(a) * MODULE_MID_R, 0);
    for (const g of shellBand(a, 0.35 / RING_FLOOR_R, 0.16)) cb.add(g, M.darkMetal);
  }
  const connectors = cb.build();
  connectors.name = 'connectors';
  root.add(connectors);

  // ---- hub ---------------------------------------------------------------------
  const hb = new GeoBatch();
  hb.add(new CylinderGeometry(4.0, 4.0, 10.0, 48, 1, true), M.hull, new Vector3(0, 0, 0), { x: Math.PI / 2, y: 0, z: 0 });
  hb.add(new CylinderGeometry(4.0, 3.2, 0.6, 48), M.hullDark, new Vector3(0, 0, -5.3), { x: Math.PI / 2, y: 0, z: 0 });
  for (const z of [-4.2, -1.5, 1.5, 4.2]) hb.add(new TorusGeometry(4.02, 0.12, 8, 48), M.hullDark, new Vector3(0, 0, z));
  // hub observation windows ring
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    hb.add(new PlaneGeometry(1.4, 0.7), winMatCool, new Vector3(Math.cos(a) * 4.03, Math.sin(a) * 4.03, -3.0), { x: 0, y: Math.PI / 2, z: a, order: 'ZYX' });
  }
  // hub face (front) disk with port opening handled by dockingPort
  hb.add(new CylinderGeometry(4.0, 4.0, 0.12, 48), M.hullDark, new Vector3(0, 0, 4.98), { x: Math.PI / 2, y: 0, z: 0 });
  // aft mast + solar wings
  hb.add(new CylinderGeometry(0.6, 0.6, 4.0, 16), M.darkMetal, new Vector3(0, 0, -7.4), { x: Math.PI / 2, y: 0, z: 0 });
  for (const s of [-1, 1]) {
    hb.box(15.5, 0.08, 3.4, M.solar, new Vector3(s * 9.4, 0, -8.6));
    hb.box(15.6, 0.12, 0.12, M.metal, new Vector3(s * 9.4, 0, -6.85));
    hb.box(15.6, 0.12, 0.12, M.metal, new Vector3(s * 9.4, 0, -10.35));
    for (let k = 0; k < 6; k++) hb.box(0.06, 0.1, 3.5, M.metal, new Vector3(s * (2.0 + k * 2.6), 0, -8.6));
  }
  // antennas
  hb.add(new CylinderGeometry(0.05, 0.05, 6, 6), M.metal, new Vector3(0, 0, -11.6), { x: Math.PI / 2, y: 0, z: 0 });
  hb.add(new ConeGeometry(1.4, 0.6, 24, 1, true), M.radiator, new Vector3(0, 0, -14.4), { x: -Math.PI / 2, y: 0, z: 0 });
  const hub = hb.build();
  hub.name = 'hub';
  root.add(hub);

  // ---- spokes --------------------------------------------------------------
  const spokes = new Map();
  for (const i of SPOKE_MODULES) {
    const a = moduleAngle(i);
    const sbatch = new GeoBatch();
    const r0 = 3.9, r1 = SHELL_IN + 0.1;
    const len = r1 - r0;
    const mid = (r0 + r1) / 2;
    sbatch.add(new CylinderGeometry(1.25, 1.25, len, 20, 1, true), M.hull, new Vector3(Math.cos(a) * mid, Math.sin(a) * mid, 0), { x: 0, y: 0, z: a - Math.PI / 2 });
    for (let k = 1; k < 6; k++) {
      const r = r0 + (len * k) / 6;
      sbatch.add(new TorusGeometry(1.28, 0.08, 6, 20), M.hullDark, new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0), { x: Math.PI / 2, y: 0, z: a + Math.PI / 2, order: 'ZYX' });
    }
    // cable trays along the spoke
    sbatch.box(len, 0.2, 0.3, M.darkMetal, new Vector3(Math.cos(a) * mid, Math.sin(a) * mid, 1.35), { x: 0, y: 0, z: a });
    const g = sbatch.build();
    g.name = `spoke${i}`;
    root.add(g);
    spokes.set(i, g);
  }

  // ---- rim thruster pods -----------------------------------------------------
  const rb = new GeoBatch();
  const rimPods = [];
  for (const i of [0, 3, 6, 9]) {
    const a = moduleAngle(i) + 0.14;
    const p = new Vector3(Math.cos(a) * RIM_R, Math.sin(a) * RIM_R, 0);
    const pod = new Group();
    pod.position.copy(p);
    pod.rotation.z = a;
    const m = new Mesh(new BoxGeometry(1.2, 1.4, 1.4), M.hullDark);
    pod.add(m);
    for (const s of [-1, 1]) {
      const n = new Mesh(new ConeGeometry(0.3, 0.6, 12, 1, true), M.nozzle);
      n.position.set(0, s * 0.95, 0);
      n.rotation.z = s > 0 ? 0 : Math.PI;
      pod.add(n);
    }
    modules[i].add(pod);
    rimPods.push({ pod, module: i, angle: a });
  }

  // ---- blinking beacons ------------------------------------------------------
  const beaconMat = new MeshBasicMaterial({ color: new Color(6, 0.4, 0.2) });
  const beacons = [];
  for (const p of [new Vector3(0, 4.2, 4.0), new Vector3(0, -4.2, 4.0), new Vector3(0, 0, -14.8)]) {
    const s = new Mesh(new SphereGeometry(0.15, 8, 6), beaconMat);
    s.position.copy(p);
    root.add(s);
    beacons.push(s);
  }

  return { root, modules, spokes, hub, connectors, rimPods, beacons, beaconMat };
}
