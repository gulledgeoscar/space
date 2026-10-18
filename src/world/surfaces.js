// Planet surface sites. A site is a planet-fixed tangent frame (X east,
// Y up, Z south) that rotates with the planet. Each site provides:
//  - a near-layer terrain patch (curved to the planet's radius) with fog
//    that blends into the ray-traced far planet,
//  - ground(pWorld) for landing-gear / hull contact physics,
//  - local helpers for on-foot play (uniform gravity + heightfield).

import {
  Group, Mesh, PlaneGeometry, MeshStandardMaterial, Color, Vector3, Quaternion, Matrix4, FogExp2,
  BoxGeometry, CylinderGeometry, ShaderMaterial, DoubleSide, SphereGeometry, MeshBasicMaterial, BufferAttribute,
  Points, BufferGeometry, Float32BufferAttribute, PointsMaterial, AdditiveBlending, IcosahedronGeometry,
  ConeGeometry, CircleGeometry, RingGeometry,
} from 'three';
import { GeoBatch, canvasTexture, labelTexture } from './geometry.js';
import { materials } from './materials.js';
import { NOISE_GLSL } from '../shaders/noise.js';

const Y = new Vector3(0, 1, 0);
const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();
const _m = new Matrix4();

function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, z, oct = 5) { let f = 0, a = 0.5; for (let i = 0; i < oct; i++) { f += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return f; }

export class Surface {
  constructor(game, planet, { lat = 0, lon = 0, patch = 30000, segs = 200 } = {}) {
    this.game = game;
    this.planet = planet;
    // planet-fixed site normal
    this.nFixed = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
    this.group = new Group();
    this.group.name = 'surface:' + planet.id;
    this.patch = patch;
    this.segs = segs;
    this.fog = 0;
    this.fogColor = new Color(0.6, 0.7, 0.8);
    this.sceneFog = new FogExp2(0xa0b8d0, 0.00005);
    game.scene.add(this.group);
    this.basis = { e: new Vector3(), n: new Vector3(), s: new Vector3(), p: new Vector3(), q: new Quaternion() };
    this.updateBasis(game.world.time);
  }

  // terrain height (m) at local x (east), z (south)
  height(x, z) { return 0; }

  // site frame at sim time t
  updateBasis(t) {
    const ang = this.planet.rotationRate * t;
    const n = _v.copy(this.nFixed).applyAxisAngle(Y, ang).normalize();
    const B = this.basis;
    B.n.copy(n);
    B.e.crossVectors(Y, n);
    if (B.e.lengthSq() < 1e-8) B.e.set(1, 0, 0);
    B.e.normalize();
    B.s.crossVectors(B.e, B.n).normalize();      // X east, Y up, Z = east x up = south
    B.p.copy(n).multiplyScalar(this.planet.radius);
    _m.makeBasis(B.e, B.n, B.s);
    B.q.setFromRotationMatrix(_m);
    return B;
  }
  toWorld(x, y, z, out = new Vector3()) {
    const B = this.basis;
    // local y is height above the *curved* ground: correct for curvature
    const drop = (x * x + z * z) / (2 * this.planet.radius);
    return out.copy(B.p).addScaledVector(B.e, x).addScaledVector(B.n, y - drop).addScaledVector(B.s, z);
  }
  toLocal(p, out = new Vector3()) {
    const B = this.basis;
    _w.subVectors(p, B.p);
    const x = _w.dot(B.e), z = _w.dot(B.s);
    const y = _w.dot(B.n) + (x * x + z * z) / (2 * this.planet.radius);
    return out.set(x, y, z);
  }
  localDir(d, out = new Vector3()) { const B = this.basis; return out.set(d.dot(B.e), d.dot(B.n), d.dot(B.s)); }
  worldDir(d, out = new Vector3()) { const B = this.basis; return out.set(0, 0, 0).addScaledVector(B.e, d.x).addScaledVector(B.n, d.y).addScaledVector(B.s, d.z); }

  // contact for vehicle physics
  ground(pWorld) {
    const l = this.toLocal(pWorld, _v);
    const r = Math.hypot(l.x, l.z);
    let h, n;
    if (r < this.patch * 0.95) {
      h = this.height(l.x, l.z);
      const e = 0.5;
      const dx = this.height(l.x + e, l.z) - this.height(l.x - e, l.z);
      const dz = this.height(l.x, l.z + e) - this.height(l.x, l.z - e);
      n = this.worldDir(_w.set(-dx / (2 * e), 1, -dz / (2 * e)).normalize(), new Vector3());
    } else {
      h = 0;
      n = pWorld.clone().normalize();
    }
    const depth = h - l.y;
    if (depth < -2) return null;
    const surfaceVel = new Vector3().crossVectors(_w.copy(Y).multiplyScalar(this.planet.rotationRate), pWorld);
    return { depth, normal: n, surfaceVel, height: h };
  }

  // the near patch hides the far planet's ray-traced ground only at very
  // low altitude; above that the far planet is exact anyway
  hideFarSurface(alt) { return 0; }

  update(dt, origin) {
    const B = this.updateBasis(this.game.world.time);
    this.group.position.copy(B.p).sub(origin);
    this.group.quaternion.copy(B.q);
    const alt = this.game.pipeline.camInertialPos.length() - this.planet.radius;
    const scene = this.game.scene;
    if (alt < 40000) {
      scene.fog = this.sceneFog;
      this.sceneFog.density = this.fogDensity(alt);
      this.sceneFog.color.copy(this.fogColor);
      this.group.visible = true;
    } else { scene.fog = null; this.group.visible = alt < 120000; }
  }
  fogDensity(alt) { return 0.00003 * Math.exp(-alt / 8000); }

  // build a curved terrain patch with radial rings (dense near the origin)
  terrainGeometry(colorFn) {
    const rings = 90, seg = 128;
    const pos = [], col = [], idx = [];
    const radii = [];
    for (let i = 0; i <= rings; i++) radii.push(i === 0 ? 0 : 6 * Math.pow(this.patch / 6, i / rings));
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const x = Math.cos(a) * radii[i], z = Math.sin(a) * radii[i];
        const drop = (x * x + z * z) / (2 * this.planet.radius);
        pos.push(x, this.height(x, z) - drop, z);
        const c = colorFn(x, z);
        col.push(c[0], c[1], c[2]);
        if (i === 0) break;
      }
    }
    // indices: centre fan + ring strips
    for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * seg, a1 = 1 + i * seg;
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % seg;
        idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  dispose() {
    this.group.removeFromParent();
    this.game.scene.fog = null;
  }
}

// ---------------------------------------------------------------------------
// Earth: equatorial coastal launch site "Cape Ardent" with pad and tower.
export class EarthPad extends Surface {
  constructor(game, planet) {
    super(game, planet, { lat: 0, lon: 0, patch: 30000 });
    this.fogColor.setRGB(0.62, 0.74, 0.88);
    const M = materials();
    const geo = this.terrainGeometry((x, z) => {
      if (x > 2200 + Math.sin(z * 0.0004) * 600) return [0.05, 0.16, 0.26];          // ocean to the east
      if (x > 1900 + Math.sin(z * 0.0004) * 600) return [0.62, 0.58, 0.45];          // beach
      const n = fbm2(x * 0.0015, z * 0.0015);
      const g = 0.18 + n * 0.12;
      return [g * 0.62, g, g * 0.42];
    });
    const ground = new Mesh(geo, new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    ground.receiveShadow = true;
    this.group.add(ground);
    // pad, flame trench, tower, lights
    const b = new GeoBatch();
    const concrete = new MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.9 });
    b.box(70, 2, 70, concrete, new Vector3(0, -0.9, 0));
    b.box(10, 0.5, 40, M.darkMetal, new Vector3(0, 0.15, 22));
    // tower lattice
    for (const [x, z] of [[-4, -14], [4, -14], [-4, -6], [4, -6]]) b.box(0.6, 62, 0.6, M.accent, new Vector3(x, 31, z));
    for (let y = 4; y < 62; y += 4) {
      b.box(8.6, 0.35, 0.35, M.accent, new Vector3(0, y, -14)); b.box(8.6, 0.35, 0.35, M.accent, new Vector3(0, y, -6));
      b.box(0.35, 0.35, 8.6, M.accent, new Vector3(-4, y, -10)); b.box(0.35, 0.35, 8.6, M.accent, new Vector3(4, y, -10));
    }
    // crew access arm toward the Kestrel cockpit
    b.box(1.8, 1.8, 6.4, M.hullDark, new Vector3(0, 41.5, -3.6));
    b.box(10, 1, 10, M.darkMetal, new Vector3(0, 62.5, -10));
    for (const [x, z] of [[-30, -30], [30, -30], [-30, 30], [30, 30]]) {
      b.box(0.5, 22, 0.5, M.metal, new Vector3(x, 11, z));
      b.box(2.4, 1.2, 0.4, M.lightWhite, new Vector3(x, 22, z));
    }
    // service buildings
    for (const [x, z, w, h, d] of [[-260, 120, 60, 18, 40], [-310, 40, 30, 10, 30], [-420, -200, 90, 35, 60]]) b.box(w, h, d, new MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.8 }), new Vector3(x, h / 2, z));
    const pad = b.build();
    this.group.add(pad);
    // a sign
    const sign = new Mesh(new PlaneGeometry(24, 4), new MeshBasicMaterial({ map: labelTexture(['CAPE ARDENT · LC-2', 'HALDEN EXPEDITION OPERATIONS'], { w: 1024, h: 170, size: 80 }) }));
    sign.position.set(-36, 5, 0);
    sign.rotation.y = Math.PI / 2;
    this.group.add(sign);
  }
  fogDensity(alt) { return 0.000035 * Math.exp(-alt / 6000); }
}
