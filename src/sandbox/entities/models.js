// Blocky creature models built from boxes with procedurally painted faces.
// Every model faces +Z and stands on y = 0.
import * as THREE from 'three';

const PX = 1 / 16;
const geoCache = new Map();
const texCache = new Map();

function boxGeo(w, h, d) {
  const k = `${w},${h},${d}`;
  if (!geoCache.has(k)) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.userData.shared = true;
    geoCache.set(k, g);
  }
  return geoCache.get(k);
}

function canvasTex(key, w, h, draw) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

// Subtle per-pixel noise so flat colours don't look plastic.
function noiseTex() {
  return canvasTex('noise', 8, 8, (g) => {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = 215 + Math.floor(Math.random() * 40);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  });
}

function spotsTex(key, base, spot) {
  return canvasTex(key, 16, 16, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 16, 16);
    g.fillStyle = spot;
    for (let i = 0; i < 6; i++) g.fillRect((Math.random() * 12) | 0, (Math.random() * 12) | 0, 3 + ((Math.random() * 3) | 0), 2 + ((Math.random() * 3) | 0));
  });
}

// A material that the entity can tint (brightness / hurt).
function mat(entity, color, map = noiseTex()) {
  const m = new THREE.MeshLambertMaterial({ color, map });
  entity?.trackMaterial(m);
  return m;
}

// Box with an optional painted front (+z) face.
function box(entity, w, h, d, color, front = null, opts = {}) {
  const side = mat(entity, color, opts.map);
  let material = side;
  if (front || opts.top) {
    const mats = [side, side, opts.top ? mat(entity, 0xffffff, opts.top) : side, side, front ? mat(entity, 0xffffff, front) : side, side];
    material = mats;
  }
  const mesh = new THREE.Mesh(boxGeo(w, h, d), material);
  return mesh;
}

// A limb hanging from a pivot at its top.
function limb(entity, w, h, d, color, x, y, z, front = null) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const m = box(entity, w, h, d, color, front);
  m.position.y = -h / 2;
  pivot.add(m);
  return pivot;
}

function face(key, skin, draw) {
  return canvasTex(`face:${key}`, 8, 8, (g) => {
    g.fillStyle = skin; g.fillRect(0, 0, 8, 8);
    draw(g);
  });
}

const px = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

export const FACES = {
  pig: () => face('pig', '#f2a7a2', (g) => { px(g, '#fff', 1, 2, 2, 1); px(g, '#000', 2, 2); px(g, '#fff', 5, 2, 2, 1); px(g, '#000', 5, 2); }),
  cow: () => face('cow', '#5a4030', (g) => { px(g, '#fff', 2, 0, 4, 3); px(g, '#fff', 1, 2, 2, 1); px(g, '#000', 1, 2); px(g, '#fff', 5, 2, 2, 1); px(g, '#000', 6, 2); px(g, '#c8b0a0', 2, 5, 4, 3); px(g, '#4a3020', 2, 6); px(g, '#4a3020', 5, 6); }),
  sheep: () => face('sheep', '#d8c0a8', (g) => { px(g, '#eee', 0, 0, 8, 1); px(g, '#fff', 1, 3, 2, 1); px(g, '#000', 1, 3); px(g, '#fff', 5, 3, 2, 1); px(g, '#000', 6, 3); px(g, '#f0a0a0', 3, 5, 2, 1); }),
  chicken: () => face('chicken', '#ffffff', (g) => { px(g, '#000', 1, 2); px(g, '#000', 6, 2); }),
  wolf: () => face('wolf', '#d0d0d0', (g) => { px(g, '#fff', 1, 3, 2, 1); px(g, '#000', 2, 3); px(g, '#fff', 5, 3, 2, 1); px(g, '#000', 5, 3); px(g, '#a0a0a0', 0, 0, 8, 2); }),
  horse: () => face('horse', '#8a5a30', (g) => { px(g, '#000', 1, 2); px(g, '#000', 6, 2); px(g, '#6a4020', 0, 5, 8, 3); px(g, '#000', 2, 6); px(g, '#000', 5, 6); }),
  villager: () => face('villager', '#c09070', (g) => { px(g, '#3a2a1a', 1, 2, 6, 1); px(g, '#fff', 1, 3, 2, 1); px(g, '#3a8a3a', 2, 3); px(g, '#fff', 5, 3, 2, 1); px(g, '#3a8a3a', 5, 3); px(g, '#8a6040', 3, 4, 2, 3); }),
  zombie: () => face('zombie', '#4a8a4a', (g) => { px(g, '#1a1a1a', 1, 3, 2, 1); px(g, '#1a1a1a', 5, 3, 2, 1); px(g, '#2a5a2a', 2, 5, 4, 1); px(g, '#3a7a3a', 0, 0, 8, 1); }),
  skeleton: () => face('skeleton', '#d8d8d8', (g) => { px(g, '#222', 1, 3, 2, 2); px(g, '#222', 5, 3, 2, 2); px(g, '#555', 3, 5, 2, 1); px(g, '#333', 1, 6, 6, 1); px(g, '#d8d8d8', 2, 6); px(g, '#d8d8d8', 4, 6); }),
  bomber: () => face('bomber', '#202028', (g) => { px(g, '#ff3030', 1, 3, 2, 1); px(g, '#ff3030', 5, 3, 2, 1); px(g, '#ff8080', 1, 3); px(g, '#ff8080', 6, 3); px(g, '#c0c0c0', 2, 5, 4, 1); px(g, '#202028', 3, 5); }),
  spider: () => face('spider', '#2a2020', (g) => { px(g, '#e02020', 1, 2); px(g, '#e02020', 6, 2); px(g, '#e02020', 2, 3); px(g, '#e02020', 5, 3); px(g, '#e02020', 3, 2, 2, 1); }),
  golem: () => face('golem', '#c8c4bc', (g) => { px(g, '#5a4a3a', 1, 1, 6, 1); px(g, '#a02020', 2, 3); px(g, '#a02020', 5, 3); px(g, '#a8a49c', 3, 4, 2, 3); }),
  player: () => face('player', '#d8a888', (g) => { px(g, '#4a2a10', 0, 0, 8, 2); px(g, '#4a2a10', 0, 2); px(g, '#4a2a10', 7, 2); px(g, '#fff', 1, 4, 2, 1); px(g, '#3050a0', 2, 4); px(g, '#fff', 5, 4, 2, 1); px(g, '#3050a0', 5, 4); px(g, '#a06050', 3, 6, 2, 1); }),
  dummy: () => face('dummy', '#e0c090', (g) => { px(g, '#000', 2, 3); px(g, '#000', 5, 3); px(g, '#c03030', 2, 5, 4, 1); }),
};

// Four-legged animal.
function quadruped(entity, o) {
  const root = new THREE.Group();
  const legs = [];
  const bodyY = o.legH + o.bodyH / 2;
  const body = box(entity, o.bodyW, o.bodyH, o.bodyL, o.color, null, { map: o.bodyMap });
  body.position.y = bodyY;
  root.add(body);
  const hx = o.bodyW / 2 - o.legW / 2, hz = o.bodyL / 2 - o.legW / 2;
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const l = limb(entity, o.legW, o.legH, o.legW, o.legColor ?? o.color, sx * hx, o.legH, sz * hz);
    legs.push(l);
    root.add(l);
  }
  const head = new THREE.Group();
  head.position.set(0, bodyY + (o.headY ?? o.bodyH * 0.35), o.bodyL / 2 + (o.headOut ?? 0));
  const hm = box(entity, o.head[0], o.head[1], o.head[2], o.headColor ?? o.color, o.face);
  hm.position.z = o.head[2] / 2 - 0.05;
  head.add(hm);
  root.add(head);
  return { root, legs, arms: [], head, body };
}

function humanoid(entity, o) {
  const root = new THREE.Group();
  const legH = o.legH ?? 0.75, bodyH = o.bodyH ?? 0.75, w = o.width ?? 0.5;
  const legW = o.limbW ?? 0.25, armW = o.armW ?? legW;
  const legs = [
    limb(entity, legW, legH, legW, o.legColor, -legW / 2, legH, 0),
    limb(entity, legW, legH, legW, o.legColor, legW / 2, legH, 0),
  ];
  const body = box(entity, w, bodyH, o.depth ?? 0.25, o.bodyColor);
  body.position.y = legH + bodyH / 2;
  const arms = [
    limb(entity, armW, o.armH ?? bodyH, armW, o.armColor ?? o.skin, -(w / 2 + armW / 2), legH + bodyH - 0.02, 0),
    limb(entity, armW, o.armH ?? bodyH, armW, o.armColor ?? o.skin, w / 2 + armW / 2, legH + bodyH - 0.02, 0),
  ];
  const head = new THREE.Group();
  head.position.set(0, legH + bodyH, 0);
  const hs = o.headSize ?? 0.5;
  const hm = box(entity, hs, hs, hs, o.skin, o.face);
  hm.position.y = hs / 2;
  head.add(hm);
  root.add(body, head, ...legs, ...arms);
  return { root, legs, arms, head, body };
}

export function buildModel(entity, type) {
  switch (type) {
    case 'pig': {
      const m = quadruped(entity, { bodyW: 0.62, bodyH: 0.5, bodyL: 0.88, legH: 0.38, legW: 0.25, head: [0.5, 0.5, 0.45], color: 0xf2a7a2, face: FACES.pig(), headOut: -0.08, headY: 0.12 });
      const snout = box(entity, 0.25, 0.18, 0.08, 0xe58a88);
      snout.position.set(0, -0.08, 0.44);
      m.head.add(snout);
      return m;
    }
    case 'cow': {
      const m = quadruped(entity, { bodyW: 0.75, bodyH: 0.62, bodyL: 1.1, legH: 0.7, legW: 0.25, head: [0.5, 0.5, 0.38], color: 0xffffff, bodyMap: spotsTex('cowspots', '#5a4030', '#f0f0f0'), legColor: 0x5a4030, headColor: 0x5a4030, face: FACES.cow(), headOut: -0.05, headY: 0.2 });
      for (const sx of [-1, 1]) { const h = box(entity, 0.08, 0.15, 0.08, 0xe0d8c8); h.position.set(sx * 0.3, 0.3, 0.12); m.head.add(h); }
      return m;
    }
    case 'sheep': {
      const m = quadruped(entity, { bodyW: 0.8, bodyH: 0.68, bodyL: 1.0, legH: 0.6, legW: 0.22, head: [0.42, 0.42, 0.45], color: entity.woolColor ?? 0xeeeeee, legColor: 0xd8c0a8, headColor: 0xd8c0a8, face: FACES.sheep(), headOut: -0.05, headY: 0.18 });
      m.wool = m.body;
      return m;
    }
    case 'chicken': {
      const m = quadruped(entity, { bodyW: 0.38, bodyH: 0.38, bodyL: 0.45, legH: 0.3, legW: 0.07, head: [0.25, 0.38, 0.2], color: 0xffffff, legColor: 0xe8b830, face: FACES.chicken(), headOut: -0.06, headY: 0.32 });
      m.legs.splice(2, 2).forEach((l) => m.root.remove(l));
      m.legs.forEach((l) => { l.position.z = 0; });
      const beak = box(entity, 0.16, 0.1, 0.12, 0xf0a020); beak.position.set(0, 0.04, 0.2); m.head.add(beak);
      const wattle = box(entity, 0.08, 0.12, 0.06, 0xd02020); wattle.position.set(0, -0.08, 0.16); m.head.add(wattle);
      m.wings = [];
      for (const sx of [-1, 1]) {
        const w = limb(entity, 0.06, 0.25, 0.36, 0xf4f4f4, sx * 0.22, 0.65, 0);
        m.root.add(w); m.wings.push(w);
      }
      return m;
    }
    case 'wolf': {
      const m = quadruped(entity, { bodyW: 0.42, bodyH: 0.42, bodyL: 0.85, legH: 0.42, legW: 0.15, head: [0.4, 0.38, 0.3], color: 0xc8c8c8, face: FACES.wolf(), headOut: 0.05, headY: 0.15 });
      const snout = box(entity, 0.2, 0.15, 0.2, 0xb0b0b0); snout.position.set(0, -0.08, 0.32); m.head.add(snout);
      const nose = box(entity, 0.08, 0.06, 0.04, 0x202020); nose.position.set(0, -0.03, 0.43); m.head.add(nose);
      for (const sx of [-1, 1]) { const e = box(entity, 0.1, 0.12, 0.06, 0xa8a8a8); e.position.set(sx * 0.12, 0.24, 0.08); m.head.add(e); }
      const tail = limb(entity, 0.1, 0.4, 0.1, 0xb8b8b8, 0, 0.75, -0.42);
      tail.rotation.x = -0.9;
      m.root.add(tail); m.tail = tail;
      m.collar = box(null, 0.44, 0.1, 0.1, 0xd03030); m.collar.position.set(0, 0.7, 0.4); m.collar.visible = false; m.root.add(m.collar);
      return m;
    }
    case 'horse': {
      const m = quadruped(entity, { bodyW: 0.7, bodyH: 0.65, bodyL: 1.45, legH: 0.95, legW: 0.22, head: [0.35, 0.35, 0.65], color: entity.coat ?? 0x8a5a30, face: FACES.horse(), headOut: 0.2, headY: 0.65 });
      const neck = box(entity, 0.3, 0.7, 0.35, entity.coat ?? 0x8a5a30); neck.position.set(0, 1.55, 0.72); neck.rotation.x = 0.45; m.root.add(neck);
      const mane = box(entity, 0.1, 0.75, 0.15, 0x2a1a10); mane.position.set(0, 1.62, 0.6); mane.rotation.x = 0.45; m.root.add(mane);
      m.head.rotation.x = 0.5;
      const tail = limb(entity, 0.12, 0.6, 0.12, 0x2a1a10, 0, 1.45, -0.72); tail.rotation.x = -0.4; m.root.add(tail); m.tail = tail;
      const saddle = box(null, 0.72, 0.1, 0.5, 0x6a3a1a); saddle.position.set(0, 1.62, 0); m.root.add(saddle);
      return m;
    }
    case 'villager': {
      const m = humanoid(entity, { skin: 0xc09070, bodyColor: 0x7a5a3a, legColor: 0x6a4a2a, armColor: 0x7a5a3a, face: FACES.villager(), headSize: 0.52, depth: 0.32 });
      const nose = box(entity, 0.1, 0.22, 0.1, 0xb08060); nose.position.set(0, 0.18, 0.3); m.head.add(nose);
      // Folded arms.
      m.arms.forEach((a) => { a.rotation.x = -0.9; });
      return m;
    }
    case 'zombie': {
      const m = humanoid(entity, { skin: 0x4a8a4a, bodyColor: 0x2a8aa0, legColor: 0x3a3a8a, armColor: 0x4a8a4a, face: FACES.zombie() });
      m.arms.forEach((a) => { a.rotation.x = -1.45; });
      return m;
    }
    case 'skeleton': {
      const m = humanoid(entity, { skin: 0xd8d8d8, bodyColor: 0xc8c8c8, legColor: 0xd0d0d0, armColor: 0xd0d0d0, face: FACES.skeleton(), limbW: 0.12, width: 0.45, depth: 0.2 });
      const bow = box(null, 0.05, 0.7, 0.05, 0x8a6030); bow.position.set(0, -0.6, 0.15); m.arms[1].add(bow);
      m.arms[1].rotation.x = -1.4;
      return m;
    }
    case 'bomber': {
      const root = new THREE.Group();
      const body = box(entity, 0.8, 0.8, 0.8, 0x202028, FACES.bomber());
      body.position.y = 0.75;
      const band = box(entity, 0.84, 0.12, 0.84, 0xc0a020); band.position.y = 0.45;
      const cap = box(entity, 0.3, 0.15, 0.3, 0x606068); cap.position.y = 1.22;
      const fuse = box(null, 0.06, 0.25, 0.06, 0xd0b080); fuse.position.y = 1.4;
      const spark = new THREE.Mesh(boxGeo(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd040 })); spark.position.y = 1.55;
      root.add(body, band, cap, fuse, spark);
      const legs = [limb(entity, 0.18, 0.35, 0.18, 0x303038, -0.2, 0.35, 0), limb(entity, 0.18, 0.35, 0.18, 0x303038, 0.2, 0.35, 0)];
      root.add(...legs);
      return { root, legs, arms: [], head: body, body, spark };
    }
    case 'spider': {
      const root = new THREE.Group();
      const body = box(entity, 0.9, 0.55, 0.9, 0x2a2020); body.position.set(0, 0.55, -0.35);
      const head = new THREE.Group(); head.position.set(0, 0.55, 0.15);
      const hm = box(entity, 0.55, 0.5, 0.5, 0x2a2020, FACES.spider()); hm.position.z = 0.25; head.add(hm);
      root.add(body, head);
      const legs = [];
      for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) {
        const pivot = new THREE.Group(); pivot.position.set(sx * 0.25, 0.55, 0.25 - i * 0.22);
        const l = box(entity, 0.9, 0.1, 0.1, 0x3a2a2a); l.position.x = sx * 0.45; l.rotation.z = sx * 0.5;
        pivot.add(l); pivot.userData.side = sx; pivot.userData.i = i;
        root.add(pivot); legs.push(pivot);
      }
      return { root, legs, arms: [], head, body, spider: true };
    }
    case 'golem': {
      const m = humanoid(entity, { skin: 0xc8c4bc, bodyColor: 0xc0bcb4, legColor: 0xb8b4ac, armColor: 0xc8c4bc, face: FACES.golem(), width: 1.0, depth: 0.6, legH: 0.9, bodyH: 1.0, limbW: 0.38, armW: 0.32, armH: 1.6, headSize: 0.55 });
      const vine = box(null, 0.6, 0.5, 0.05, 0x3a7a2a); vine.position.set(0.1, 1.5, 0.31); m.root.add(vine);
      return m;
    }
    case 'player': {
      const m = humanoid(entity, { skin: 0xd8a888, bodyColor: 0x30a0b0, legColor: 0x3040a0, armColor: 0xd8a888, face: FACES.player() });
      const hair = box(entity, 0.52, 0.12, 0.52, 0x4a2a10); hair.position.y = 0.48; m.head.add(hair);
      return m;
    }
    case 'dummy': {
      return humanoid(entity, { skin: 0xe0c090, bodyColor: 0xd0b080, legColor: 0xc0a070, armColor: 0xe0c090, face: FACES.dummy() });
    }
    default: {
      const root = new THREE.Group();
      const b = box(entity, 0.6, 0.6, 0.6, 0xff00ff); b.position.y = 0.3; root.add(b);
      return { root, legs: [], arms: [], head: null, body: b };
    }
  }
}

export { box, boxGeo, mat, canvasTex, noiseTex, PX };
