// Geometry helpers: lofted hulls, a batcher that merges static parts per
// material (few draw calls), and canvas-generated textures/labels.

import {
  BufferGeometry, Float32BufferAttribute, Mesh, Matrix4, Group, CanvasTexture, SRGBColorSpace,
  RepeatWrapping, BoxGeometry, CylinderGeometry, Vector3, Quaternion, Euler, LinearMipmapLinearFilter,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Superellipse cross-sections lofted along z.
// sections: [{ z, w, h, y = 0, x = 0, n = 4 }]
export function loft(sections, radial = 32, capStart = true, capEnd = true) {
  const pos = [], uv = [], idx = [];
  const ring = (s, t) => {
    const n = s.n ?? 4;
    const a = (t / radial) * Math.PI * 2;
    const c = Math.cos(a), si = Math.sin(a);
    const px = (s.x ?? 0) + (s.w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const py = (s.y ?? 0) + (s.h / 2) * Math.sign(si) * Math.pow(Math.abs(si), 2 / n);
    return [px, py, s.z];
  };
  let zMin = Infinity, zMax = -Infinity;
  for (const s of sections) { zMin = Math.min(zMin, s.z); zMax = Math.max(zMax, s.z); }
  for (let i = 0; i < sections.length; i++) {
    for (let t = 0; t <= radial; t++) {
      pos.push(...ring(sections[i], t));
      uv.push(t / radial, (sections[i].z - zMin) / (zMax - zMin || 1));
    }
  }
  const rw = radial + 1;
  for (let i = 0; i < sections.length - 1; i++) {
    for (let t = 0; t < radial; t++) {
      const a = i * rw + t, b = a + 1, c = a + rw, d = c + 1;
      // counter-clockwise rings + increasing z => outward-facing normals
      idx.push(a, b, c, b, d, c);
    }
  }
  const capAt = (i, flip) => {
    const s = sections[i];
    const center = pos.length / 3;
    pos.push(s.x ?? 0, s.y ?? 0, s.z);
    uv.push(0.5, 0.5);
    for (let t = 0; t < radial; t++) {
      const a = i * rw + t, b = a + 1;
      if (flip) idx.push(center, a, b); else idx.push(center, b, a);
    }
  };
  if (capStart) capAt(0, false);
  if (capEnd) capAt(sections.length - 1, true);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3(1, 1, 1);
const _p = new Vector3();

// Collects geometry per material and merges into one mesh per material.
export class GeoBatch {
  constructor() { this.buckets = new Map(); }
  add(geometry, material, position = null, rotation = null, scale = null) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    _p.set(0, 0, 0); _q.identity(); _s.set(1, 1, 1);
    if (position) _p.copy(position);
    if (rotation) { if (rotation.isQuaternion) _q.copy(rotation); else _q.setFromEuler(_e.set(rotation.x || 0, rotation.y || 0, rotation.z || 0, rotation.order || 'XYZ')); }
    if (scale) { if (typeof scale === 'number') _s.setScalar(scale); else _s.copy(scale); }
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
    return this;
  }
  addMatrix(geometry, material, matrix) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(matrix);
    if (!this.buckets.has(material)) this.buckets.set(material, []);
    this.buckets.get(material).push(g);
  }
  box(w, h, d, material, position, rotation) { return this.add(new BoxGeometry(w, h, d), material, position, rotation); }
  cyl(rt, rb, h, material, position, rotation, seg = 16) { return this.add(new CylinderGeometry(rt, rb, h, seg), material, position, rotation); }
  build({ castShadow = true, receiveShadow = true } = {}) {
    const group = new Group();
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = castShadow && !mat.transparent;
      mesh.receiveShadow = receiveShadow;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.buckets.clear();
    return group;
  }
}

export function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = LinearMipmapLinearFilter;
  if (repeat) { t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.userData.canvas = c;
  t.userData.ctx = ctx;
  return t;
}

// Normal map derived from a canvas texture's brightness (dark = recessed):
// panel seams become grooves, rivets and plates catch the light.
export function normalMapFrom(tex, strength = 2.5, { invert = false } = {}) {
  const src = tex.userData.canvas;
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const l = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
    H[i] = invert ? 1 - l : l;
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(w, h);
  const at = (x, y) => H[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sobel gradient of the height field
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (y * w + x) * 4;
      out.data[o] = (nx * 0.5 + 0.5) * 255; out.data[o + 1] = (ny * 0.5 + 0.5) * 255; out.data[o + 2] = (nz * 0.5 + 0.5) * 255; out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  t.minFilter = LinearMipmapLinearFilter;
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  t.repeat.copy(tex.repeat);
  return t;
}

// Simple text label texture.
export function labelTexture(lines, { w = 512, h = 128, bg = '#1a1d22', fg = '#e8e2d0', border = '#e8c27a', font = 'Rajdhani', size = 54, stripes = false } = {}) {
  if (typeof lines === 'string') lines = [lines];
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (stripes) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      ctx.fillStyle = '#d9a400';
      for (let x = -h; x < w; x += 40) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 20, h); ctx.lineTo(x + 20 + h, 0); ctx.lineTo(x + h, 0); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = bg; ctx.fillRect(10, 10, w - 20, h - 20);
    }
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 6; ctx.strokeRect(5, 5, w - 10, h - 10); }
    ctx.fillStyle = fg;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lh = h / (lines.length + 0.4);
    lines.forEach((l, i) => {
      const s = i === 0 ? size : size * 0.6;
      ctx.font = `600 ${s}px ${font}, sans-serif`;
      ctx.fillText(l, w / 2, lh * (i + 0.7));
    });
  });
}
