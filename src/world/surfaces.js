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
    this.near = alt < 40000;
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

// ---------------------------------------------------------------------------
// Pelagia: knee-deep ocean over a sandy shelf, the SOUNDER-3 beacon, and
// the tidal surge.
import { OceanShader } from '../shaders/ocean.js';

export class OceanSurface extends Surface {
  constructor(game, planet, siteNormal) {
    super(game, planet, { patch: 32000 });
    this.nFixed.copy(siteNormal).normalize();
    this.updateBasis(game.world.time);
    this.fogColor.setRGB(0.42, 0.52, 0.55);
    this.depth = 0.55;
    // seabed
    const bed = new Mesh(this.terrainGeometry((x, z) => { const n = fbm2(x * 0.01, z * 0.01, 3); return [0.42 + n * 0.1, 0.4 + n * 0.08, 0.33]; }), new MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    bed.receiveShadow = true;
    this.group.add(bed);
    // water: same ring layout, flat (surge added in the shader)
    const self = this;
    const saveH = this.height;
    this.height = () => 0;
    const wg = this.terrainGeometry(() => [1, 1, 1]);
    this.height = saveH;
    const u = OceanShader.uniforms;
    this.waterMat = new ShaderMaterial({
      uniforms: {
        ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, { value: v.value }])),
      },
      vertexShader: OceanShader.vertexShader, fragmentShader: OceanShader.fragmentShader,
      transparent: true, depthWrite: true, extensions: { derivatives: true },
    });
    const wu = this.waterMat.uniforms;
    wu.uWaveDir.value = new Vector3(1, 0, 0);
    wu.uWaveDir.value = { x: -0.8, y: 0.6, isVector2: true };
    wu.uSunDir.value = new Vector3(0, 1, 0);
    wu.uSunColor.value = new Color(1.0, 0.82, 0.62);
    wu.uSkyColor.value = new Color(0.45, 0.55, 0.6);
    wu.uDeep.value = new Color(0.03, 0.12, 0.15);
    wu.uShallow.value = new Color(0.16, 0.3, 0.3);
    wu.uFogColor.value = this.fogColor;
    wu.uCamPos.value = new Vector3();
    wu.uR.value = planet.radius;
    this.water = new Mesh(wg, this.waterMat);
    this.water.renderOrder = 2;
    this.water.frustumCulled = false;
    this.group.add(this.water);
    this.surge = { active: false, front: -60000, speed: 0, H: 1180, W: 1600, dir: { x: -0.8, z: 0.6 } };
    // rocks / ripples for scale
    const M = materials();
    const b = new GeoBatch();
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * 6.28, r = 40 + Math.random() * 900;
      b.add(new IcosahedronGeometry(0.4 + Math.random() * 1.6, 0), M.hullDark, new Vector3(Math.cos(a) * r, -this.depth + 0.2, Math.sin(a) * r), { x: Math.random(), y: Math.random(), z: Math.random() }, 1);
    }
    this.group.add(b.build());
    void self;
  }
  height(x, z) { return -this.depth + (fbm2(x * 0.02, z * 0.02, 3) - 0.5) * 0.25; }
  surgeHeight(x, z) {
    const s = this.surge;
    if (!s.active && s.front < -50000) return 0;
    const d = s.front - (x * s.dir.x + z * s.dir.z);
    const k = d < 0 ? Math.exp(-Math.pow(d / (s.W * 0.35), 2)) : Math.exp(-Math.pow(d / (s.W * 1.6), 2));
    return s.H * k;
  }
  waterLevel(x, z) { return this.surgeHeight(x, z); }
  startSurge(distance = 9000, speed = 70) { this.surge.active = true; this.surge.front = -distance; this.surge.speed = speed; }
  // where the surge front is relative to a local point (negative = still coming)
  surgeArrival(x, z) { const s = this.surge; return (s.front - (x * s.dir.x + z * s.dir.z)) / Math.max(1, s.speed); }
  fogDensity(alt) { return 0.00011 * Math.exp(-alt / 5000) + 0.00001; }
  update(dt, origin) {
    super.update(dt, origin);
    const s = this.surge;
    if (s.active) s.front += s.speed * this.game.simDt;
    const u = this.waterMat.uniforms;
    u.uTime.value += dt;
    u.uWaveFront.value = s.front;
    u.uWaveDir.value = { x: s.dir.x, y: s.dir.z, isVector2: true };
    u.uWaveH.value = s.H; u.uWaveW.value = s.W;
    const cam = this.game.pipeline.camInertialPos;
    this.toLocal(cam, u.uCamPos.value);
    this.localDir(this.game.sky.lightDir, u.uSunDir.value).normalize();
    u.uFogDensity.value = this.sceneFog.density;
  }
}

// ---------------------------------------------------------------------------
// Skadi: ice plains and pressure ridges, fog, snow and frozen clouds.
// Snow with fine detail near the eye: wind ripples, footprint-sized lumps
// and glittering crust, procedurally in the fragment shader (fades out with
// distance so the far plain stays smooth).
function snowMaterial() {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnowP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowP;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float dist = length(vViewPosition);
          float near = 1.0 - smoothstep(30.0, 260.0, dist);
          vec2 q = vSnowP.xz;
          float ripple = sin(q.x * 1.9 + q.y * 0.7 + snoise(vec3(q * 0.25, 1.0)) * 3.0) * 0.5 + 0.5;
          float lumps = snoise(vec3(q * 0.9, 3.0)) * 0.5 + 0.5;
          float big = snoise(vec3(q * 0.06, 5.0)) * 0.5 + 0.5;
          float k = mix(1.0, 0.78 + 0.16 * ripple + 0.12 * lumps, near) * (0.88 + 0.2 * big);
          diffuseColor.rgb *= k;
        }`);
  };
  return m;
}

export class IceSurface extends Surface {
  constructor(game, planet, siteNormal, { clear = [] } = {}) {
    super(game, planet, { patch: 26000 });
    this.nFixed.copy(siteNormal).normalize();
    this.updateBasis(game.world.time);
    this.clear = clear;     // [{ x, z, r }] kept free of props (the Wren)
    // overcast: a dimmer sun through the haze, and a grey-blue fog rather
    // than a white-out
    this.sunScale = 0.42;
    this.fogColor.setRGB(0.36, 0.42, 0.5);
    const ground = new Mesh(this.terrainGeometry((x, z) => {
      const h = this.height(x, z);
      // wind-packed snow (blue-grey), with drifts, bare blue ice in the
      // hollows and dark rock showing on the ridge crests
      const drift = fbm2(x * 0.004, z * 0.004, 3);
      const sast = fbm2(x * 0.09 + z * 0.02, z * 0.09, 2);   // sastrugi streaks
      let r = 0.42 + drift * 0.14 + sast * 0.08, gc = r * 1.03, bc = r * 1.14;
      const iceK = Math.max(0, Math.min(1, (fbm2(x * 0.0021 + 7, z * 0.0021, 3) - 0.55) * 5));
      r += (0.3 - r) * iceK; gc += (0.4 - gc) * iceK; bc += (0.52 - bc) * iceK;
      const e = 2;
      const slope = Math.hypot(this.height(x + e, z) - this.height(x - e, z), this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
      const rockK = Math.max(0, Math.min(1, (slope - 0.32) * 4)) * Math.max(0, Math.min(1, (h - 8) / 12));
      r += (0.16 - r) * rockK; gc += (0.16 - gc) * rockK; bc += (0.18 - bc) * rockK;
      return [r, gc, bc];
    }), snowMaterial());
    ground.receiveShadow = true;
    this.group.add(ground);
    // frozen clouds: sculpted ice masses hanging in the thin air
    const ice = new MeshStandardMaterial({ color: 0x9fb4c8, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.94 });
    const b = new GeoBatch();
    for (let c = 0; c < 18; c++) {
      const a = Math.random() * 6.28, r = 900 + Math.random() * 9000;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 260 + Math.random() * 600;
      for (let k = 0; k < 9; k++) b.add(new IcosahedronGeometry(40 + Math.random() * 120, 1), ice, new Vector3(cx + (Math.random() - 0.5) * 300, cy + (Math.random() - 0.5) * 60, cz + (Math.random() - 0.5) * 300), { x: Math.random(), y: Math.random(), z: Math.random() }, new Vector3(1, 0.35 + Math.random() * 0.3, 1));
    }
    const clouds = b.build({ castShadow: true });
    this.group.add(clouds);
    this.buildLandmarks();
    // snow around the camera
    const N = 4000;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = Math.random() * 60; pos[i * 3 + 2] = (Math.random() - 0.5) * 120; }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.snow = new Points(g, new PointsMaterial({ color: 0xdfe6ee, size: 0.1, transparent: true, opacity: 0.75, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
    this.snowPos = pos;
    this.wind = new Vector3(4, -1.5, 1.5);
  }

  // Things to judge distance and height by: dark rock outcrops and boulders,
  // blue ice spires, Vance's survey stakes with orange flags, a ring of
  // beacon masts with blinking lights, and his old supply dump.
  buildLandmarks() {
    const rock = new MeshStandardMaterial({ color: 0x3b4048, roughness: 0.92, metalness: 0.0, flatShading: true });
    const rockSnow = new MeshStandardMaterial({ color: 0x8e9aa8, roughness: 0.8, flatShading: true });
    const spire = new MeshStandardMaterial({ color: 0x5f86a8, roughness: 0.25, metalness: 0.05, emissive: 0x0c1a26, flatShading: true });
    const pole = new MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.6, metalness: 0.6 });
    const flag = new MeshStandardMaterial({ color: 0xff5a14, roughness: 0.6, emissive: 0x3a1000, side: DoubleSide });
    const crate = new MeshStandardMaterial({ color: 0x6b7480, roughness: 0.7, metalness: 0.3 });
    const crateBand = new MeshStandardMaterial({ color: 0xd8641e, roughness: 0.6 });
    const B = new GeoBatch();
    this.colliders = [];
    const ground = (x, z) => this.height(x, z);
    const blocked = (x, z, pad = 0) => this.clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + pad);
    // rocks: outcrops of a few stretched, half-buried blocks
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = i < 90 ? 25 + Math.random() * 380 : 300 + Math.pow(Math.random(), 1.4) * 5000;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const size = r < 300 ? 0.4 + Math.random() * 1.3 : (1.5 + Math.random() * 9) * (Math.random() < 0.1 ? 2.2 : 1);
      if (blocked(x, z, size * 3)) continue;
      const n = 1 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const s = size * (0.5 + Math.random() * 0.6);
        const px = x + (Math.random() - 0.5) * size * 2.2, pz = z + (Math.random() - 0.5) * size * 2.2;
        const py = ground(px, pz) - s * 0.25;
        const sc = new Vector3(1 + Math.random() * 0.6, 0.55 + Math.random() * 0.7, 1 + Math.random() * 0.5);
        const rot = { x: Math.random() * 0.5, y: Math.random() * 6.28, z: Math.random() * 0.5 };
        B.add(new IcosahedronGeometry(s, 0), rock, new Vector3(px, py, pz), rot, sc);
        // a snow cap on the bigger ones
        if (s > 1.2) B.add(new IcosahedronGeometry(s * 0.8, 0), rockSnow, new Vector3(px, py + s * sc.y * 0.42, pz), rot, new Vector3(sc.x, sc.y * 0.35, sc.z));
        if (r < 700) this.colliders.push({ x: px, z: pz, r: s * Math.max(sc.x, sc.z) * 0.75, top: py + s * sc.y * 0.9 });
      }
    }
    // ice spires: tall leaning blue cones, in clusters, out on the plain
    for (let c = 0; c < 24; c++) {
      const a = Math.random() * Math.PI * 2, r = 350 + Math.random() * 4500;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const m = 2 + Math.floor(Math.random() * 5);
      for (let k = 0; k < m; k++) {
        const h = 8 + Math.random() * 38, w = h * (0.12 + Math.random() * 0.1);
        const px = cx + (Math.random() - 0.5) * 40, pz = cz + (Math.random() - 0.5) * 40;
        B.add(new ConeGeometry(w, h, 6), spire, new Vector3(px, ground(px, pz) + h * 0.45, pz), { x: (Math.random() - 0.5) * 0.25, y: Math.random() * 6.28, z: (Math.random() - 0.5) * 0.25 });
      }
    }
    // survey stakes: lines of poles with orange flags radiating from the site
    const stake = (x, z, h = 2.4) => {
      if (blocked(x, z, 2)) return;
      const y = ground(x, z);
      B.add(new CylinderGeometry(0.03, 0.04, h, 6), pole, new Vector3(x, y + h / 2, z));
      B.add(new PlaneGeometry(0.42, 0.26), flag, new Vector3(x + 0.21, y + h - 0.16, z), { y: Math.random() * 0.6 - 0.3 });
    };
    for (let l = 0; l < 6; l++) {
      const a = (l / 6) * Math.PI * 2 + Math.random() * 0.4;
      for (let d = 30; d < 900; d += 25) stake(Math.cos(a) * d + Math.sin(d * 0.01) * 4, Math.sin(a) * d);
    }
    // beacon masts in a ring around the site, each with a blinking light
    this.beacons = [];
    const lampMat = new MeshBasicMaterial({ color: 0xff3020 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2, r = 420 + (i % 2) * 260;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = ground(x, z);
      B.add(new CylinderGeometry(0.12, 0.2, 12, 8), pole, new Vector3(x, y + 6, z));
      for (const [dx, dz] of [[1, 0], [-0.5, 0.87], [-0.5, -0.87]]) B.add(new CylinderGeometry(0.02, 0.02, 6.6, 4), pole, new Vector3(x + dx * 1.4, y + 3, z + dz * 1.4), { x: dz * 0.22, z: -dx * 0.22 });
      const lamp = new Mesh(new SphereGeometry(0.28, 10, 8), lampMat);
      lamp.position.set(x, y + 12.3, z);
      this.group.add(lamp);
      this.beacons.push(lamp);
      if (r < 700) this.colliders.push({ x, z, r: 0.5, top: y + 12 });
    }
    // Vance's supply dump: crates, drums and a buried sledge
    let da = Math.random() * Math.PI * 2;
    for (let t = 0; t < 8 && blocked(Math.cos(da) * 60, Math.sin(da) * 60, 15); t++) da += 0.8;
    const dx0 = Math.cos(da) * 60, dz0 = Math.sin(da) * 60;
    for (let i = 0; i < 9; i++) {
      const x = dx0 + (Math.random() - 0.5) * 9, z = dz0 + (Math.random() - 0.5) * 9, y = ground(x, z);
      const w = 0.8 + Math.random() * 0.7, h = 0.6 + Math.random() * 0.5;
      const ry = Math.random() * 6.28;
      if (i % 3 === 2) B.add(new CylinderGeometry(0.3, 0.3, 0.9, 12), crateBand, new Vector3(x, y + 0.42, z));
      else {
        B.add(new BoxGeometry(w, h, w * 0.8), crate, new Vector3(x, y + h / 2 - 0.08, z), { y: ry });
        B.add(new BoxGeometry(w + 0.02, 0.08, w * 0.8 + 0.02), crateBand, new Vector3(x, y + h * 0.7, z), { y: ry });
      }
      this.colliders.push({ x, z, r: w * 0.55, top: y + h });
    }
    B.add(new BoxGeometry(1.4, 0.3, 3.2), crate, new Vector3(dx0 + 5, ground(dx0 + 5, dz0) + 0.05, dz0), { y: da, z: 0.12 });
    this.group.add(B.build({ castShadow: true }));
    this.blinkT = 0;
  }

  height(x, z) {
    const ridges = Math.pow(1 - Math.abs(vnoise(x * 0.0016, z * 0.0016) * 2 - 1), 4) * 38;
    const roll = (fbm2(x * 0.0006, z * 0.0006, 4) - 0.5) * 60;
    // a flat landing plain around the site
    const r = Math.hypot(x, z);
    const flat = Math.min(1, Math.max(0, (r - 250) / 900));
    return (roll + ridges) * flat + (fbm2(x * 0.05, z * 0.05, 2) - 0.5) * 0.4;
  }
  fogDensity(alt) { return 0.0002 * Math.exp(-alt / 3000) + 0.000012; }
  update(dt, origin) {
    super.update(dt, origin);
    // snow box follows the camera in local coordinates
    const cam = this.toLocal(this.game.pipeline.camInertialPos, new Vector3());
    const p = this.snowPos;
    for (let i = 0; i < p.length; i += 3) {
      p[i] += this.wind.x * dt; p[i + 1] += this.wind.y * dt; p[i + 2] += this.wind.z * dt;
      if (p[i] - cam.x > 60) p[i] -= 120; if (p[i] - cam.x < -60) p[i] += 120;
      if (p[i + 2] - cam.z > 60) p[i + 2] -= 120; if (p[i + 2] - cam.z < -60) p[i + 2] += 120;
      if (p[i + 1] - cam.y < -10) p[i + 1] += 60; if (p[i + 1] - cam.y > 50) p[i + 1] -= 60;
    }
    this.snow.geometry.attributes.position.needsUpdate = true;
    this.snow.visible = Math.abs(cam.y) < 3000;    // beacons blink, out of step with each other
    this.blinkT += dt;
    this.beacons.forEach((l, i) => { l.visible = ((this.blinkT + i * 0.37) % 1.6) < 0.25; });
  }
}
