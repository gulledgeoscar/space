// Kestrel visual model: lofted lifting-body hull with a raised canopy, short
// swept wings with winglets, twin bell nozzles, a nose docking collar with
// three guide petals, RCS pods at the physical jet positions, gear, lights
// and a cockpit interior used in first-person flight and when docked.

import {
  Group, Mesh, MeshStandardMaterial, Color, Vector3, Shape, ExtrudeGeometry, LatheGeometry,
  Vector2, CylinderGeometry, BoxGeometry, TorusGeometry, SphereGeometry, PointLight, SpotLight,
  ConeGeometry, Float32BufferAttribute, PlaneGeometry, MeshBasicMaterial, DoubleSide, AdditiveBlending,
  CanvasTexture,
} from 'three';
import { loft, GeoBatch, canvasTexture, labelTexture } from '../world/geometry.js';
import { materials } from '../world/materials.js';
import { KESTREL } from './kestrel.js';

// hull sections (z, width, height, yOffset)
const HULL = [
  { z: -6.45, w: 1.75, h: 1.75, y: 0, n: 2.2 },
  { z: -6.1, w: 2.2, h: 2.05, y: 0.02, n: 2.6 },
  { z: -5.4, w: 2.75, h: 2.3, y: 0.05, n: 3.0 },
  { z: -4.2, w: 3.2, h: 2.42, y: 0.04, n: 3.6 },
  { z: -2.0, w: 3.42, h: 2.42, y: 0.0, n: 4.0 },
  { z: 1.5, w: 3.45, h: 2.38, y: 0.0, n: 4.2 },
  { z: 4.5, w: 3.35, h: 2.24, y: 0.0, n: 4.2 },
  { z: 6.2, w: 3.05, h: 1.95, y: 0.0, n: 4.0 },
  { z: 6.55, w: 2.7, h: 1.7, y: 0.0, n: 3.6 },
];

function shadeBelly(geo, topColor = [1, 1, 1], bellyColor = [0.18, 0.18, 0.2], threshold = -0.25) {
  const n = geo.attributes.normal;
  const col = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const t = Math.min(1, Math.max(0, (threshold - n.getY(i)) / 0.15));
    for (let k = 0; k < 3; k++) col[i * 3 + k] = topColor[k] * (1 - t) + bellyColor[k] * t;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  return geo;
}

function wingGeometry(side) {
  const s = new Shape();
  // planform in (x outboard, y = aft) coordinates; mirrored by negating x so
  // ExtrudeGeometry keeps outward-facing winding on both wings
  const pts = [[1.55, -0.6], [4.55, 3.6], [4.65, 5.3], [1.55, 5.6]];
  s.moveTo(side * pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(side * pts[i][0], pts[i][1]);
  s.lineTo(side * pts[0][0], pts[0][1]);
  const g = new ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
  g.rotateX(Math.PI / 2);   // shape y -> +z (aft), extrude -> -y
  g.translate(0, -0.33, 0);
  g.computeVertexNormals();
  return g;
}

function nozzleGeometry(rThroat = 0.2, rExit = 0.55, len = 1.0) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const r = rThroat + (rExit - rThroat) * Math.pow(t, 0.6);
    pts.push(new Vector2(r, t * len));
  }
  const g = new LatheGeometry(pts, 32);
  g.rotateX(Math.PI / 2); // axis along +z (aft)
  return g;
}

function mfdTexture() {
  return canvasTexture(512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#04080a'; ctx.fillRect(0, 0, w, h);
  }, { srgb: true });
}

export function buildKestrelModel({ livery = 'kestrel' } = {}) {
  const M = materials();
  const root = new Group();
  root.name = 'KestrelModel';
  const isWren = livery === 'wren';
  const hullMat = new MeshStandardMaterial({
    color: 0xffffff, map: M.hull.map, roughness: 0.6, metalness: 0.15, vertexColors: true,
    emissive: new Color(0, 0, 0),
  });
  const accent = isWren ? new MeshStandardMaterial({ color: 0x2f7d8c, roughness: 0.5 }) : M.accent;

  // --- exterior hull --------------------------------------------------------
  const exterior = new Group();
  exterior.name = 'exterior';
  const hullGeo = shadeBelly(loft(HULL, 48, false, true));
  const hull = new Mesh(hullGeo, hullMat);
  hull.castShadow = true; hull.receiveShadow = true;
  exterior.add(hull);
  // canopy hump with dark windows
  const canopyGeo = shadeBelly(loft([
    { z: -5.95, w: 0.9, h: 0.25, y: 0.95, n: 2.5 },
    { z: -5.55, w: 1.8, h: 0.8, y: 1.0, n: 3.0 },
    { z: -4.6, w: 2.1, h: 1.0, y: 1.08, n: 3.2 },
    { z: -3.3, w: 1.9, h: 0.75, y: 1.02, n: 3.2 },
    { z: -2.4, w: 1.2, h: 0.2, y: 0.98, n: 3.0 },
  ], 32, true, true));
  const canopy = new Mesh(canopyGeo, hullMat);
  canopy.castShadow = true;
  exterior.add(canopy);

  const b = new GeoBatch();
  const windowMat = new MeshStandardMaterial({ color: 0x0a1018, roughness: 0.05, metalness: 0.9, emissive: 0x050a10 });
  // windshield panes (hidden from the inside, see canopyWindows)
  const wb = new GeoBatch();
  for (const [x, ry] of [[-0.45, 0.32], [0.45, -0.32]]) {
    wb.box(0.78, 0.42, 0.04, windowMat, new Vector3(x, 1.26, -5.55), { x: -0.95, y: ry, z: 0 });
  }
  for (const s of [-1, 1]) wb.box(0.04, 0.32, 0.9, windowMat, new Vector3(s * 0.98, 1.2, -4.6), { x: 0, y: 0, z: s * -0.35 });
  const canopyWindows = wb.build();
  exterior.add(canopyWindows);
  // side cabin portholes
  for (const s of [-1, 1]) for (const z of [-2.0, -0.6]) b.cyl(0.22, 0.22, 0.05, windowMat, new Vector3(s * 1.71, 0.25, z), { x: 0, y: 0, z: Math.PI / 2 }, 20);

  // wings + winglets
  for (const s of [-1, 1]) {
    const wg = shadeBelly(wingGeometry(s), [1, 1, 1], [0.18, 0.18, 0.2], -0.5);
    const wm = new Mesh(wg, hullMat);
    wm.castShadow = true; wm.receiveShadow = true;
    exterior.add(wm);
    b.box(0.12, 1.3, 1.9, M.hullDark, new Vector3(s * 4.62, 0.15, 4.5), { x: -0.12, y: 0, z: s * 0.18 });
    b.box(0.05, 0.08, 1.6, accent, new Vector3(s * 4.69, 0.7, 4.5), { x: -0.12, y: 0, z: s * 0.18 });
    // red/green nav lights
    b.add(new SphereGeometry(0.07, 8, 6), s < 0 ? M.lightRed : M.lightGreen, new Vector3(s * 4.7, 0.85, 4.1));
  }
  // accent stripe along the hull
  for (const s of [-1, 1]) b.box(0.03, 0.12, 9.5, accent, new Vector3(s * 1.73, 0.62, 0.8));
  // engine block + nozzles
  b.box(2.6, 1.3, 1.2, M.darkMetal, new Vector3(0, -0.05, 6.75));
  const nozzleGeo = nozzleGeometry(0.22, 0.58, 1.05);
  const nozzles = [];
  for (const x of [-0.72, 0.72]) {
    b.add(nozzleGeo, M.nozzle, new Vector3(x, -0.05, 7.25));
    b.cyl(0.3, 0.3, 0.35, M.metal, new Vector3(x, -0.05, 7.22), { x: Math.PI / 2, y: 0, z: 0 }, 20);
    nozzles.push(new Vector3(x, -0.05, 8.3));
  }
  // nose docking collar: barrel, soft-capture ring, three guide petals
  const collar = new Group();
  collar.name = 'dockCollar';
  const cb = new GeoBatch();
  cb.cyl(0.88, 0.9, 0.62, M.metal, new Vector3(0, 0, -6.72), { x: Math.PI / 2, y: 0, z: 0 }, 40);
  cb.add(new TorusGeometry(KESTREL.dockRingR, 0.07, 10, 48), M.darkMetal, new Vector3(0, 0, KESTREL.dockZ + 0.05));
  cb.add(new TorusGeometry(0.52, 0.05, 8, 40), M.rubber, new Vector3(0, 0, KESTREL.dockZ + 0.1));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const petal = new Shape();
    petal.moveTo(-0.28, 0); petal.lineTo(0.28, 0); petal.lineTo(0.12, 0.38); petal.lineTo(-0.12, 0.38); petal.lineTo(-0.28, 0);
    const pg = new ExtrudeGeometry(petal, { depth: 0.04, bevelEnabled: false });
    pg.translate(0, 0, -0.02);
    // petal stands up off the ring, leaning inward
    const g = pg.clone();
    g.rotateX(-Math.PI / 2 + 0.45);
    g.translate(0, KESTREL.dockRingR - 0.02, 0);
    g.rotateZ(a - Math.PI / 2);
    g.translate(0, 0, KESTREL.dockZ + 0.06);
    cb.add(g, M.hullDark);
  }
  // docking camera (the nose hatch is a separate mesh so it can open)
  const noseHatch = new Mesh(new CylinderGeometry(0.46, 0.46, 0.05, 32), M.panelDark);
  noseHatch.rotation.x = Math.PI / 2;
  noseHatch.position.z = -6.98;
  collar.add(noseHatch);
  cb.box(0.12, 0.12, 0.16, M.darkMetal, new Vector3(0, 0.28, -7.02));
  cb.add(new SphereGeometry(0.04, 10, 8), M.glass, new Vector3(0, 0.28, -7.1));
  collar.add(cb.build());
  exterior.add(collar);

  // RCS pods at the physical jet positions (one pod per jet cluster)
  const podGeo = new BoxGeometry(0.24, 0.24, 0.3);
  for (const p of KESTREL_PODS()) b.add(podGeo, M.hullDark, p);
  // heat-shield chin tiles band
  b.box(2.3, 0.04, 9.0, M.tiles, new Vector3(0, -1.2, 0.8));
  // registration
  const reg = labelTexture(isWren ? 'WREN  WRN-02' : 'KESTREL  KST-01', { w: 512, h: 96, bg: 'rgba(0,0,0,0)', fg: '#2b2e33', border: null, size: 60 });
  reg.colorSpace = 'srgb';
  for (const s of [-1, 1]) {
    const p = new Mesh(new PlaneGeometry(2.4, 0.45), new MeshBasicMaterial({ map: reg, transparent: true, depthWrite: false }));
    p.position.set(s * 1.735, 0.25, 2.6);
    p.rotation.y = s * Math.PI / 2;
    exterior.add(p);
  }
  exterior.add(b.build());

  // landing gear
  const gear = new Group();
  gear.name = 'gear';
  const legs = [];
  for (const g of KESTREL.gear) {
    const leg = new Group();
    leg.position.set(g.pos[0], g.pos[1], g.pos[2]);
    const strut = new Mesh(new CylinderGeometry(0.07, 0.09, g.len, 10), M.metal);
    strut.position.y = -g.len / 2;
    const foot = new Mesh(new CylinderGeometry(0.3, 0.34, 0.1, 16), M.darkMetal);
    foot.position.y = -g.len;
    strut.castShadow = foot.castShadow = true;
    leg.add(strut, foot);
    gear.add(leg);
    legs.push({ leg, strut, foot, def: g });
  }
  exterior.add(gear);

  // lights: landing light (spot) + strobe
  const strobeMat = new MeshBasicMaterial({ color: new Color(8, 8, 8) });
  const strobe = new Mesh(new SphereGeometry(0.06, 8, 6), strobeMat);
  strobe.position.set(0, 1.25, 5.4);
  exterior.add(strobe);

  root.add(exterior);

  // --- main engine plumes ---------------------------------------------------
  const plumes = [];
  const plumeMat = new MeshBasicMaterial({ color: new Color(1.2, 1.0, 2.6), transparent: true, opacity: 0.0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  for (const x of [-0.72, 0.72]) {
    const cone = new Mesh(new ConeGeometry(0.55, 6, 24, 1, true), plumeMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(x, -0.05, 8.3 + 3);
    root.add(cone);
    const core = new Mesh(new ConeGeometry(0.3, 2.2, 16, 1, true), plumeMat);
    core.rotation.x = -Math.PI / 2;
    core.position.set(x, -0.05, 8.3 + 1.1);
    root.add(core);
    plumes.push(cone, core);
  }

  // --- cockpit interior (visible in first-person and when boarding) --------
  const cockpit = buildCockpit(M);
  root.add(cockpit.group);

  return {
    root, exterior, hull, canopy, canopyWindows, hullMat, collar, gear, legs, plumes, plumeMat, strobe, strobeMat,
    cockpit, nozzles, noseHatch,
  };
}

// one pod per lateral jet cluster + axial jets
function KESTREL_PODS() {
  const pts = [];
  for (const [z, top, side] of [[-5.4, 1.15, 1.35], [5.0, 1.12, 1.65]]) {
    pts.push(new Vector3(0, top, z), new Vector3(0, -top, z), new Vector3(-side, 0, z), new Vector3(side, 0, z));
  }
  return pts;
}

function buildCockpit(M) {
  // Pilot eye at (0, 0.95, -5.05). Windscreen spans y 0.8..1.45 ahead of
  // the glareshield; hatch to the nose collar sits low in the bulkhead.
  const group = new Group();
  group.name = 'cockpit';
  const b = new GeoBatch();
  const wall = M.panel;
  const frame = M.darkMetal;
  // cabin shell (x[-1.15,1.15] y[-0.6,1.5] z[-5.9,-2.6]) - floor, rear, sides
  b.box(2.3, 0.06, 3.3, M.floor, new Vector3(0, -0.58, -4.25));
  b.box(2.3, 0.06, 2.75, wall, new Vector3(0, 1.52, -3.95));
  b.box(2.3, 2.1, 0.06, wall, new Vector3(0, 0.45, -2.6));
  for (const s of [-1, 1]) {
    b.box(0.06, 1.35, 3.3, wall, new Vector3(s * 1.15, 0.08, -4.25));          // lower side wall
    b.box(0.06, 0.65, 2.2, wall, new Vector3(s * 1.12, 1.2, -3.7));            // upper side wall, aft
    // side window frames (window between z -5.7 and -4.7, y 0.78 .. 1.42)
    b.box(0.08, 0.08, 1.1, frame, new Vector3(s * 1.1, 0.78, -5.2));
    b.box(0.08, 0.08, 1.1, frame, new Vector3(s * 1.05, 1.44, -5.15));
    b.box(0.08, 0.7, 0.08, frame, new Vector3(s * 1.1, 1.1, -4.62));
  }
  // windscreen frame: sloped A-pillars + centre post + top bow
  for (const x of [-1.08, 1.08]) {
    b.box(0.1, 0.78, 0.1, frame, new Vector3(x, 1.12, -5.62), { x: -0.55, y: 0, z: 0 });
  }
  b.box(2.2, 0.1, 0.12, frame, new Vector3(0, 1.47, -5.28));
  b.box(2.3, 0.07, 0.4, M.panelDark, new Vector3(0, 1.52, -5.05));
  // glareshield + main panel (top at y 0.78)
  b.box(2.2, 0.06, 0.45, M.rubber, new Vector3(0, 0.78, -5.62));
  b.box(2.2, 0.62, 0.08, M.panelDark, new Vector3(0, 0.46, -5.5), { x: 0.42, y: 0, z: 0 });
  b.box(2.3, 0.75, 0.06, M.panelDark, new Vector3(0, -0.2, -5.88));
  // hatch ring in the forward bulkhead (to the docking collar)
  b.add(new TorusGeometry(0.42, 0.05, 8, 32), M.hazard, new Vector3(0, -0.12, -5.84));
  b.cyl(0.4, 0.4, 0.04, M.metal, new Vector3(0, -0.12, -5.86), { x: Math.PI / 2, y: 0, z: 0 }, 24);
  // centre console between the pilot's knees
  b.box(0.36, 0.28, 0.7, M.panelDark, new Vector3(0, 0.05, -4.95));
  for (let i = 0; i < 8; i++) b.add(new BoxGeometry(0.03, 0.04, 0.03), i % 3 ? M.metal : M.accent, new Vector3(-0.12 + (i % 4) * 0.08, 0.2, -5.1 + Math.floor(i / 4) * 0.12));
  // pilot seat
  b.box(0.65, 0.12, 0.6, M.seat, new Vector3(0, 0.12, -4.45));
  b.box(0.65, 0.95, 0.12, M.seat, new Vector3(0, 0.62, -4.08), { x: 0.2, y: 0, z: 0 });
  b.box(0.36, 0.26, 0.12, M.seat, new Vector3(0, 1.25, -3.95));
  for (const s of [-1, 1]) b.box(0.08, 0.32, 0.5, M.seat, new Vector3(s * 0.36, 0.3, -4.45));
  // passenger seats
  for (const x of [-0.6, 0.6]) {
    b.box(0.55, 0.1, 0.55, M.seat, new Vector3(x, -0.1, -3.15));
    b.box(0.55, 0.8, 0.1, M.seat, new Vector3(x, 0.32, -2.85));
  }
  // handrails, cable runs, overhead switch panel
  for (const s of [-1, 1]) {
    b.cyl(0.025, 0.025, 2.0, M.metal, new Vector3(s * 1.04, 1.3, -3.7), { x: Math.PI / 2, y: 0, z: 0 }, 8);
    b.cyl(0.03, 0.03, 3.2, M.cable, new Vector3(s * 1.08, -0.4, -4.25), { x: Math.PI / 2, y: 0, z: 0 }, 6);
  }
  b.box(1.1, 0.05, 0.55, M.panelDark, new Vector3(0, 1.46, -4.55));
  const sw = new BoxGeometry(0.02, 0.05, 0.02);
  for (let i = 0; i < 12; i++) b.add(sw, M.metal, new Vector3(-0.44 + i * 0.08, 1.42, -4.45));
  for (let i = 0; i < 6; i++) b.add(new BoxGeometry(0.04, 0.02, 0.04), i % 2 ? M.lightGreen : M.lightAmber, new Vector3(-0.3 + i * 0.12, 1.43, -4.7));
  const shell = b.build({ castShadow: false });
  group.add(shell);

  // MFD screens on the sloped main panel (canvas, updated by the HUD)
  const screens = [];
  for (const [x, w] of [[-0.66, 0.5], [0, 0.56], [0.66, 0.5]]) {
    const tex = mfdTexture();
    const mat = new MeshBasicMaterial({ map: tex, toneMapped: false });
    const scr = new Mesh(new PlaneGeometry(w, w * 0.62), mat);
    scr.position.set(x, 0.48, -5.45);
    scr.rotation.x = -0.42;
    group.add(scr);
    screens.push({ mesh: scr, tex, ctx: tex.userData.ctx, canvas: tex.userData.canvas });
  }
  const cabinLight = new PointLight(0xffe2c0, 0.0, 4, 2);
  cabinLight.position.set(0, 1.3, -4.0);
  group.add(cabinLight);
  return { group, screens, cabinLight };
}
