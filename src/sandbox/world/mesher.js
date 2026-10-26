// Chunk lighting (sky + block light flood fill) and meshing with smooth
// lighting and ambient occlusion. Pure; runs in the chunk workers.
//
// Input is the chunk plus its 8 neighbours. Light is solved over the whole
// 3x3 region so torches and sunlight bleed correctly across chunk borders.
import { CHUNK, HEIGHT, index } from './constants.js';
import { BLOCKS, OPAQUE, LIGHT, FILTER, RENDER, SHAPE, LIQUID, LEVEL } from './blocks.js';

const R = CHUNK * 3;            // region width
const RA = R * R;               // region layer area
const RV = RA * HEIGHT;         // region volume
const ri = (x, y, z) => (y * R + z) * R + x;

// Reused per-worker scratch buffers.
const vox = new Uint8Array(RV);
const sky = new Uint8Array(RV);
const blk = new Uint8Array(RV);
const queue = new Int32Array(RV);

// Face table: normal, tangents (T1 x T2 = N), shade.
const FACES = [
  { n: [1, 0, 0], t1: [0, 1, 0], t2: [0, 0, 1], shade: 0.8 },
  { n: [-1, 0, 0], t1: [0, 0, 1], t2: [0, 1, 0], shade: 0.8 },
  { n: [0, 1, 0], t1: [0, 0, 1], t2: [1, 0, 0], shade: 1.0 },
  { n: [0, -1, 0], t1: [1, 0, 0], t2: [0, 0, 1], shade: 0.55 },
  { n: [0, 0, 1], t1: [1, 0, 0], t2: [0, 1, 0], shade: 0.65 },
  { n: [0, 0, -1], t1: [0, 1, 0], t2: [1, 0, 0], shade: 0.65 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_CURVE = [0.42, 0.62, 0.8, 1.0];

class Builder {
  constructor() {
    this.cap = 4096;
    this.pos = new Uint16Array(this.cap * 3);
    this.uvl = new Uint8Array(this.cap * 4);
    this.lit = new Uint8Array(this.cap * 4);
    this.idx = [];
    this.n = 0;
  }
  grow() {
    this.cap *= 2;
    const p = new Uint16Array(this.cap * 3); p.set(this.pos); this.pos = p;
    const u = new Uint8Array(this.cap * 4); u.set(this.uvl); this.uvl = u;
    const l = new Uint8Array(this.cap * 4); l.set(this.lit); this.lit = l;
  }
  vertex(x, y, z, u, v, layer, s, b, ao, shade) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    this.pos[i * 3] = Math.round(x * 16);
    this.pos[i * 3 + 1] = Math.round(y * 16);
    this.pos[i * 3 + 2] = Math.round(z * 16);
    this.uvl[i * 4] = Math.round(u * 16);
    this.uvl[i * 4 + 1] = Math.round(v * 16);
    this.uvl[i * 4 + 2] = layer;
    this.uvl[i * 4 + 3] = 0;
    this.lit[i * 4] = s * 17;
    this.lit[i * 4 + 1] = b * 17;
    this.lit[i * 4 + 2] = ao * 255;
    this.lit[i * 4 + 3] = shade * 255;
    return i;
  }
  quad(a, b, c, d, flip) {
    if (flip) this.idx.push(b, c, d, b, d, a);
    else this.idx.push(a, b, c, a, c, d);
  }
  result() {
    if (this.n === 0) return null;
    const index = this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    return {
      pos: this.pos.slice(0, this.n * 3),
      uvl: this.uvl.slice(0, this.n * 4),
      lit: this.lit.slice(0, this.n * 4),
      index,
    };
  }
}

function fillRegion(chunks) {
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
    const c = chunks[dz * 3 + dx];
    for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) {
      const dst = ri(dx * CHUNK, y, dz * CHUNK + z);
      if (!c) { vox.fill(0, dst, dst + CHUNK); continue; }
      const src = index(0, y, z);
      vox.set(c.subarray(src, src + CHUNK), dst);
    }
  }
}

function propagate(light, head, tail) {
  while (head < tail) {
    const i = queue[head++];
    const l = light[i];
    if (l <= 1) continue;
    const x = i % R;
    const z = ((i / R) | 0) % R;
    const y = (i / RA) | 0;
    // six neighbours
    for (let k = 0; k < 6; k++) {
      let j;
      if (k === 0) { if (x === R - 1) continue; j = i + 1; }
      else if (k === 1) { if (x === 0) continue; j = i - 1; }
      else if (k === 2) { if (z === R - 1) continue; j = i + R; }
      else if (k === 3) { if (z === 0) continue; j = i - R; }
      else if (k === 4) { if (y === HEIGHT - 1) continue; j = i + RA; }
      else { if (y === 0) continue; j = i - RA; }
      const f = FILTER[vox[j]];
      if (f >= 15) continue;
      const nl = l - 1 - f;
      if (nl > light[j]) {
        light[j] = nl;
        queue[tail++] = j;
        if (tail >= RV) tail = 0; // never happens in practice; guards the buffer
      }
    }
  }
}

function computeLight(skyOn) {
  sky.fill(0);
  blk.fill(0);
  let tail = 0;
  if (skyOn) {
    // Straight-down sunlight.
    for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) {
      let l = 15;
      for (let y = HEIGHT - 1; y >= 0 && l > 0; y--) {
        const i = ri(x, y, z);
        const f = FILTER[vox[i]];
        if (f >= 15) break;
        l -= f;
        if (l <= 0) break;
        sky[i] = l;
      }
    }
    // Seed the flood fill with lit cells next to darker open cells.
    for (let y = 0; y < HEIGHT; y++) for (let z = 1; z < R - 1; z++) for (let x = 1; x < R - 1; x++) {
      const i = ri(x, y, z);
      const l = sky[i];
      if (l < 2) continue;
      if ((sky[i + 1] < l - 1 && FILTER[vox[i + 1]] < 15) || (sky[i - 1] < l - 1 && FILTER[vox[i - 1]] < 15) ||
          (sky[i + R] < l - 1 && FILTER[vox[i + R]] < 15) || (sky[i - R] < l - 1 && FILTER[vox[i - R]] < 15) ||
          (y > 0 && sky[i - RA] < l - 1 && FILTER[vox[i - RA]] < 15)) {
        queue[tail++] = i;
      }
    }
    propagate(sky, 0, tail);
  }
  tail = 0;
  for (let i = 0; i < RV; i++) {
    const e = LIGHT[vox[i]];
    if (e) { blk[i] = e; queue[tail++] = i; }
  }
  propagate(blk, 0, tail);
}

function liquidHeight(id, above) {
  if (LIQUID[above] === LIQUID[id]) return 1;
  const l = LEVEL[id];
  return l === 0 ? 0.875 : Math.max(0.12, ((8 - l) / 8) * 0.875);
}

export function meshChunk(chunks, opts = {}) {
  fillRegion(chunks);
  computeLight(opts.sky !== false);

  const out = { opaque: new Builder(), cutout: new Builder(), translucent: new Builder() };
  const off = CHUNK;
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const rx = x + off, rz = z + off;
    const i = ri(rx, y, rz);
    const id = vox[i];
    if (id === 0) continue;
    const block = BLOCKS[id];
    if (!block) continue;
    const shape = SHAPE[id];
    const target = RENDER[id] === 3 ? out.translucent : RENDER[id] === 2 ? out.cutout : out.opaque;
    if (shape === 0) cube(target, block, id, x, y, z, rx, rz, i);
    else if (shape === 1) crossShape(target, block, x, y, z, i);
    else if (shape === 2) torch(target, block, x, y, z, i);
    else if (shape === 3) liquid(LIQUID[id] === 2 ? out.opaque : out.translucent, block, id, x, y, z, i);
    else if (shape === 4) slab(target, block, x, y, z, i);
  }
  return { opaque: out.opaque.result(), cutout: out.cutout.result(), translucent: out.translucent.result() };
}

function neighborIndex(i, n, y) {
  const ny = y + n[1];
  if (ny < 0 || ny >= HEIGHT) return -1;
  return i + n[0] + n[2] * R + n[1] * RA;
}

function faceVisible(id, nid) {
  if (nid === 0) return true;
  if (OPAQUE[nid]) return false;
  if (nid === id) return false;
  if (LIQUID[id] && LIQUID[id] === LIQUID[nid]) return false;
  if (SHAPE[nid] === 0 && RENDER[nid] === RENDER[id] && RENDER[id] === 3) return false; // translucent cubes merge
  return true;
}

// Light at region cell j (sky, block), treating out-of-range as open sky.
function cellSky(j) { return j < 0 || j >= RV ? 15 : sky[j]; }
function cellBlk(j) { return j < 0 || j >= RV ? 0 : blk[j]; }
function cellOpaque(j) { return j >= 0 && j < RV && OPAQUE[vox[j]] === 1; }

function cube(b, block, id, x, y, z, rx, rz, i) {
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    const n = F.n;
    const ny = y + n[1];
    let ni = -1;
    let nid = 0;
    if (ny >= 0 && ny < HEIGHT) { ni = neighborIndex(i, n, y); nid = vox[ni]; }
    else if (ny < 0) continue;
    if (!faceVisible(id, nid)) continue;
    const layer = block.faceTex[f];
    const vi = [];
    const aos = [];
    for (let c = 0; c < 4; c++) {
      const [s1, s2] = CORNERS[c];
      // corner position in unit cube
      const px = 0.5 + n[0] * 0.5 + F.t1[0] * s1 * 0.5 + F.t2[0] * s2 * 0.5;
      const py = 0.5 + n[1] * 0.5 + F.t1[1] * s1 * 0.5 + F.t2[1] * s2 * 0.5;
      const pz = 0.5 + n[2] * 0.5 + F.t1[2] * s1 * 0.5 + F.t2[2] * s2 * 0.5;
      let ao = 3, ls = 15, lb = 0;
      if (ni >= 0) {
        const yS1 = ny + F.t1[1] * s1, yS2 = ny + F.t2[1] * s2, yC = ny + F.t1[1] * s1 + F.t2[1] * s2;
        const j1 = yS1 < 0 || yS1 >= HEIGHT ? -1 : ni + (F.t1[0] * s1) + (F.t1[2] * s1) * R + (F.t1[1] * s1) * RA;
        const j2 = yS2 < 0 || yS2 >= HEIGHT ? -1 : ni + (F.t2[0] * s2) + (F.t2[2] * s2) * R + (F.t2[1] * s2) * RA;
        const jc = yC < 0 || yC >= HEIGHT ? -1 : ni + (F.t1[0] * s1 + F.t2[0] * s2) + (F.t1[2] * s1 + F.t2[2] * s2) * R + (F.t1[1] * s1 + F.t2[1] * s2) * RA;
        const o1 = cellOpaque(j1) ? 1 : 0;
        const o2 = cellOpaque(j2) ? 1 : 0;
        const oc = cellOpaque(jc) ? 1 : 0;
        ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
        let sum = sky[ni], sumB = blk[ni], cnt = 1;
        if (!o1) { sum += cellSky(j1); sumB += cellBlk(j1); cnt++; }
        if (!o2) { sum += cellSky(j2); sumB += cellBlk(j2); cnt++; }
        if (!oc && !(o1 && o2)) { sum += cellSky(jc); sumB += cellBlk(jc); cnt++; }
        ls = sum / cnt; lb = sumB / cnt;
      }
      // UVs: sides use y as v, the top/bottom use x/z.
      let u, v;
      if (f === 0) { u = 1 - pz; v = py; }
      else if (f === 1) { u = pz; v = py; }
      else if (f === 4) { u = px; v = py; }
      else if (f === 5) { u = 1 - px; v = py; }
      else { u = px; v = pz; }
      aos.push(ao);
      vi.push(b.vertex(x + px, y + py, z + pz, u, v, layer, ls, lb, AO_CURVE[ao], F.shade));
    }
    b.quad(vi[0], vi[1], vi[2], vi[3], aos[0] + aos[2] < aos[1] + aos[3]);
  }
}

function ownLight(i) { return [sky[i], blk[i]]; }

function crossShape(b, block, x, y, z, i) {
  const [s, l] = ownLight(i);
  const layer = block.faceTex[0];
  const lo = 0.15, hi = 0.85;
  const h = block.key === 'lily_pad' ? 0.02 : 1;
  if (block.key === 'lily_pad') {
    const a = b.vertex(x, y + h, z, 0, 0, layer, s, l, 1, 1);
    const c = b.vertex(x, y + h, z + 1, 0, 1, layer, s, l, 1, 1);
    const d = b.vertex(x + 1, y + h, z + 1, 1, 1, layer, s, l, 1, 1);
    const e = b.vertex(x + 1, y + h, z, 1, 0, layer, s, l, 1, 1);
    b.quad(a, c, d, e, false);
    return;
  }
  const quads = [
    [[lo, lo], [hi, hi]],
    [[hi, lo], [lo, hi]],
  ];
  for (const [[ax, az], [bx, bz]] of quads) {
    const v0 = b.vertex(x + ax, y, z + az, 0, 0, layer, s, l, 1, 0.9);
    const v1 = b.vertex(x + bx, y, z + bz, 1, 0, layer, s, l, 1, 0.9);
    const v2 = b.vertex(x + bx, y + h, z + bz, 1, 1, layer, s, l, 1, 0.9);
    const v3 = b.vertex(x + ax, y + h, z + az, 0, 1, layer, s, l, 1, 0.9);
    b.quad(v0, v1, v2, v3, false);
  }
}

function box(b, layer, x, y, z, x0, y0, z0, x1, y1, z1, s, l, uvBox, skip) {
  // uvBox: [u0, v0, u1, v1] for the side faces and the top face uses [tu0, tv0, tu1, tv1]
  const [su0, sv0, su1, sv1, tu0, tv0, tu1, tv1] = uvBox;
  const P = (px, py, pz, u, v, shade) => b.vertex(x + px, y + py, z + pz, u, v, layer, s, l, 1, shade);
  // +x
  if (!skip?.[0]) b.quad(P(x1, y0, z1, su0, sv0, 0.8), P(x1, y0, z0, su1, sv0, 0.8), P(x1, y1, z0, su1, sv1, 0.8), P(x1, y1, z1, su0, sv1, 0.8), false);
  // -x
  if (!skip?.[1]) b.quad(P(x0, y0, z0, su0, sv0, 0.8), P(x0, y0, z1, su1, sv0, 0.8), P(x0, y1, z1, su1, sv1, 0.8), P(x0, y1, z0, su0, sv1, 0.8), false);
  // +y
  if (!skip?.[2]) b.quad(P(x0, y1, z0, tu0, tv0, 1), P(x0, y1, z1, tu0, tv1, 1), P(x1, y1, z1, tu1, tv1, 1), P(x1, y1, z0, tu1, tv0, 1), false);
  // -y
  if (!skip?.[3]) b.quad(P(x0, y0, z0, tu0, tv0, 0.55), P(x1, y0, z0, tu1, tv0, 0.55), P(x1, y0, z1, tu1, tv1, 0.55), P(x0, y0, z1, tu0, tv1, 0.55), false);
  // +z
  if (!skip?.[4]) b.quad(P(x0, y0, z1, su0, sv0, 0.65), P(x1, y0, z1, su1, sv0, 0.65), P(x1, y1, z1, su1, sv1, 0.65), P(x0, y1, z1, su0, sv1, 0.65), false);
  // -z
  if (!skip?.[5]) b.quad(P(x1, y0, z0, su0, sv0, 0.65), P(x0, y0, z0, su1, sv0, 0.65), P(x0, y1, z0, su1, sv1, 0.65), P(x1, y1, z0, su0, sv1, 0.65), false);
}

function torch(b, block, x, y, z, i) {
  const [s, l] = ownLight(i);
  const lo = 7 / 16, hi = 9 / 16, top = 13 / 16;
  box(b, block.faceTex[0], x, y, z, lo, 0, lo, hi, top, hi, s, Math.max(l, 14), [lo, 0, hi, top, lo, 11 / 16, hi, top]);
}

function slab(b, block, x, y, z, i) {
  const n = (dx, dy, dz) => {
    const ny = y + dy;
    if (ny < 0 || ny >= HEIGHT) return 0;
    return vox[i + dx + dz * R + dy * RA];
  };
  const skip = [OPAQUE[n(1, 0, 0)] || n(1, 0, 0) === block.id, OPAQUE[n(-1, 0, 0)] || n(-1, 0, 0) === block.id, false, OPAQUE[n(0, -1, 0)], OPAQUE[n(0, 0, 1)] || n(0, 0, 1) === block.id, OPAQUE[n(0, 0, -1)] || n(0, 0, -1) === block.id];
  const [s, l] = ownLight(i);
  box(b, block.faceTex[0], x, y, z, 0, 0, 0, 1, 0.5, 1, s, l, [0, 0, 1, 0.5, 0, 0, 1, 1], skip);
}

function liquid(b, block, id, x, y, z, i) {
  const above = y + 1 < HEIGHT ? vox[i + RA] : 0;
  const h = liquidHeight(id, above);
  const layer = block.faceTex[2];
  const kind = LIQUID[id];
  const [s, l] = ownLight(i);
  const P = (px, py, pz, u, v, shade) => b.vertex(x + px, y + py, z + pz, u, v, layer, s, l, 1, shade);
  const same = (j, ny) => ny >= 0 && ny < HEIGHT && LIQUID[vox[j]] === kind;
  const hidden = (j, ny) => ny < 0 || (ny < HEIGHT && (OPAQUE[vox[j]] || LIQUID[vox[j]] === kind));
  if (!same(i + RA, y + 1) && !(y + 1 < HEIGHT && OPAQUE[above])) {
    b.quad(P(0, h, 0, 0, 0, 1), P(0, h, 1, 0, 1, 1), P(1, h, 1, 1, 1, 1), P(1, h, 0, 1, 0, 1), false);
  }
  if (!hidden(i - RA, y - 1) && !(y > 0 && LIQUID[vox[i - RA]])) {
    b.quad(P(0, 0, 0, 0, 0, 0.55), P(1, 0, 0, 1, 0, 0.55), P(1, 0, 1, 1, 1, 0.55), P(0, 0, 1, 0, 1, 0.55), false);
  }
  if (!hidden(i + 1, y)) b.quad(P(1, 0, 1, 0, 0, 0.8), P(1, 0, 0, 1, 0, 0.8), P(1, h, 0, 1, h, 0.8), P(1, h, 1, 0, h, 0.8), false);
  if (!hidden(i - 1, y)) b.quad(P(0, 0, 0, 0, 0, 0.8), P(0, 0, 1, 1, 0, 0.8), P(0, h, 1, 1, h, 0.8), P(0, h, 0, 0, h, 0.8), false);
  if (!hidden(i + R, y)) b.quad(P(0, 0, 1, 0, 0, 0.65), P(1, 0, 1, 1, 0, 0.65), P(1, h, 1, 1, h, 0.65), P(0, h, 1, 0, h, 0.65), false);
  if (!hidden(i - R, y)) b.quad(P(1, 0, 0, 0, 0, 0.65), P(0, 0, 0, 1, 0, 0.65), P(0, h, 0, 1, h, 0.65), P(1, h, 0, 0, h, 0.65), false);
}

// Exposed for tests: light value at a local position after meshing.
export function debugLight(x, y, z) {
  const i = ri(x + CHUNK, y, z + CHUNK);
  return { sky: sky[i], block: blk[i] };
}
