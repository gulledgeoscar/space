// Textured cube meshes of blocks for thrown blocks, falling sand, dropped
// items and the held block.
import * as THREE from 'three';
import { BLOCKS } from '../world/blocks.js';
import { tileCanvas } from '../world/atlas.js';
import { ART } from '../items/art.js';

const matCache = new Map();
const texCache = new Map();
let cubeGeo = null;

export function tileTexture(tiles, layer) {
  if (texCache.has(layer)) return texCache.get(layer);
  const t = new THREE.CanvasTexture(tileCanvas(tiles, layer, 1));
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(layer, t);
  return t;
}

export function blockMaterials(game, id) {
  if (matCache.has(id)) return matCache.get(id);
  const b = BLOCKS[id];
  const transparent = b.render === 'translucent';
  const cutout = b.render === 'cutout' || b.shape === 'cross' || b.shape === 'torch';
  const mats = b.faceTex.map((layer) => new THREE.MeshLambertMaterial({
    map: tileTexture(game.atlas.tiles, layer),
    transparent,
    opacity: transparent ? 0.8 : 1,
    alphaTest: cutout ? 0.5 : 0,
    emissive: b.light ? new THREE.Color(0xffffff) : new THREE.Color(0),
    emissiveMap: b.light ? tileTexture(game.atlas.tiles, layer) : null,
    emissiveIntensity: b.light ? 0.8 : 0,
    side: cutout ? THREE.DoubleSide : THREE.FrontSide,
  }));
  matCache.set(id, mats);
  return mats;
}

export function blockMesh(game, id, size = 1) {
  if (!cubeGeo) { cubeGeo = new THREE.BoxGeometry(1, 1, 1); cubeGeo.userData.shared = true; }
  const b = BLOCKS[id];
  if (b.shape === 'cross' || b.shape === 'torch') {
    // Two crossed planes.
    const g = new THREE.Group();
    const mat = blockMaterials(game, id)[0];
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      p.rotation.y = r;
      g.add(p);
    }
    return g;
  }
  const m = new THREE.Mesh(cubeGeo, blockMaterials(game, id));
  m.scale.setScalar(size);
  if (b.shape === 'slab') { m.scale.y = size / 2; m.position.y = -size / 4; }
  return m;
}

// Extrude 16x16 pixel art into a thin voxel model (one box per pixel run).
const artCache = new Map();
export function artMesh(key, thickness = 1 / 16) {
  if (artCache.has(key)) return artCache.get(key).clone();
  const art = ART[key] ?? ART.hand;
  const group = new THREE.Group();
  const byColor = new Map();
  art.rows.forEach((row, y) => {
    let x = 0;
    while (x < 16) {
      const ch = row[x];
      if (!ch || ch === '.') { x++; continue; }
      let n = 1;
      while (x + n < 16 && row[x + n] === ch) n++;
      const color = art.palette[ch] ?? '#ff00ff';
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push([x, y, n]);
      x += n;
    }
  });
  for (const [color, runs] of byColor) {
    const geos = runs.map(([x, y, n]) => {
      const g = new THREE.BoxGeometry(n / 16, 1 / 16, thickness);
      g.translate((x + n / 2) / 16 - 0.5, 0.5 - (y + 0.5) / 16, 0);
      return g;
    });
    const merged = mergeBoxes(geos);
    const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color: new THREE.Color(color) }));
    group.add(mesh);
  }
  artCache.set(key, group);
  return group.clone();
}

function mergeBoxes(geos) {
  let count = 0, icount = 0;
  for (const g of geos) { count += g.attributes.position.count; icount += g.index.count; }
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  const idx = new Uint32Array(icount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.userData.shared = true;
  return out;
}
