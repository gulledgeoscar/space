// Particle effects: lit cube debris (instanced) plus soft point sprites for
// fire, smoke, sparks and splashes.
import * as THREE from 'three';
import { BLOCKS, SOLID } from '../world/blocks.js';

const MAX_CUBES = 2500;
const MAX_SOFT = 5000;

const softVertex = /* glsl */`
  attribute float size;
  attribute vec4 color;
  varying vec4 vColor;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(size * 600.0 / max(0.1, -mv.z), 90.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const softFragment = /* glsl */`
  varying vec4 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.15, d);
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
    #include <colorspace_fragment>
  }
`;

class SoftPool {
  constructor(scene, blending) {
    this.n = MAX_SOFT;
    this.pos = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 4);
    this.size = new Float32Array(this.n);
    this.vel = new Float32Array(this.n * 3);
    this.life = new Float32Array(this.n);
    this.max = new Float32Array(this.n);
    this.grow = new Float32Array(this.n);
    this.grav = new Float32Array(this.n);
    this.base = new Float32Array(this.n * 4);
    this.fade = new Uint8Array(this.n); // 0 alpha fade, 1 fire colour ramp
    this.cursor = 0;
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setAttribute('size', this.sizeAttr);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: softVertex, fragmentShader: softFragment, transparent: true, depthWrite: false, blending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, r, g, b, a, grow = 0, grav = 0, fade = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.grow[i] = grow; this.grav[i] = grav;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
    this.fade[i] = fade;
  }
  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { if (this.col[i * 4 + 3] !== 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; } continue; }
      alive++;
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.max[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, dt * 1.5);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      if (this.fade[i] === 1) {
        // fire: white-yellow -> orange -> dark red
        const r = 1, g = Math.max(0.15, 0.95 - t * 1.1), b = Math.max(0, 0.6 - t * 2);
        this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b;
      } else {
        this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      }
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * (1 - t) * Math.min(1, t * 8 + 0.3);
    }
    this.count = alive;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}

export class Particles {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.cubeMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.cubeMat, MAX_CUBES);
    this.cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cubes.setColorAt(0, new THREE.Color());
    this.cubes.frustumCulled = false;
    this.cubes.count = 0;
    scene.add(this.cubes);
    this.cube = [];
    this.additive = new SoftPool(scene, THREE.AdditiveBlending);
    this.normal = new SoftPool(scene, THREE.NormalBlending);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.c = new THREE.Color();
    this.tileColors = new Map();
  }

  // Pick a few representative colours from a block's texture.
  colorsFor(id) {
    if (this.tileColors.has(id)) return this.tileColors.get(id);
    const b = BLOCKS[id];
    const tiles = this.game.atlas.tiles;
    const out = [];
    if (b && tiles) {
      const px = tiles[b.faceTex[0]];
      for (let k = 0; k < 12; k++) {
        const i = ((Math.random() * 256) | 0) * 4;
        if (px[i + 3] < 128) continue;
        out.push(new THREE.Color().setRGB(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255, THREE.SRGBColorSpace));
      }
    }
    if (!out.length) out.push(new THREE.Color(b?.color ?? 0x888888));
    this.tileColors.set(id, out);
    return out;
  }

  debris(x, y, z, color, vx, vy, vz, size = 0.12, life = 1.2, gravity = 20) {
    if (this.cube.length >= MAX_CUBES) this.cube.shift();
    this.cube.push({ x, y, z, vx, vy, vz, size, life, max: life, color, gravity, rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 10 });
  }

  blockBreak(x, y, z, id, count = 18) {
    const cols = this.colorsFor(id);
    for (let i = 0; i < count; i++) {
      this.debris(x + Math.random(), y + Math.random(), z + Math.random(), cols[(Math.random() * cols.length) | 0],
        (Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4, 0.08 + Math.random() * 0.1, 0.6 + Math.random() * 0.6);
    }
  }

  dig(point, normal, id) {
    const cols = this.colorsFor(id);
    for (let i = 0; i < 2; i++) {
      this.debris(point.x + normal.x * 0.05, point.y + normal.y * 0.05, point.z + normal.z * 0.05, cols[(Math.random() * cols.length) | 0],
        normal.x * 2 + (Math.random() - 0.5) * 2, normal.y * 2 + Math.random() * 2, normal.z * 2 + (Math.random() - 0.5) * 2, 0.06, 0.4);
    }
  }

  impact(point, normal, id) {
    if (id > 0) {
      const cols = this.colorsFor(id);
      for (let i = 0; i < 5; i++) {
        this.debris(point.x, point.y, point.z, cols[(Math.random() * cols.length) | 0],
          normal.x * 3 + (Math.random() - 0.5) * 3, normal.y * 3 + Math.random() * 3, normal.z * 3 + (Math.random() - 0.5) * 3, 0.05, 0.5);
      }
    }
    for (let i = 0; i < 4; i++) this.additive.emit(point.x, point.y, point.z, normal.x * 4 + (Math.random() - 0.5) * 6, normal.y * 4 + Math.random() * 4, normal.z * 4 + (Math.random() - 0.5) * 6, 0.15, 0.03, 1, 0.8, 0.4, 1, 0, 10);
    this.normal.emit(point.x, point.y, point.z, normal.x, normal.y + 0.5, normal.z, 0.8, 0.12, 0.6, 0.6, 0.6, 0.5, 0.4, -0.5);
  }

  blood(point, color = 0xaa1111, n = 8) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) this.debris(point.x, point.y, point.z, c, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0.06, 0.6);
  }

  muzzle(pos, dir) {
    for (let i = 0; i < 6; i++) {
      const s = Math.random() * 6 + 2;
      this.additive.emit(pos.x, pos.y, pos.z, dir.x * s + (Math.random() - 0.5), dir.y * s + (Math.random() - 0.5), dir.z * s + (Math.random() - 0.5), 0.06, 0.12, 1, 0.85, 0.5, 1, 1);
    }
    this.normal.emit(pos.x, pos.y, pos.z, dir.x * 1.5, dir.y * 1.5 + 0.4, dir.z * 1.5, 0.6, 0.06, 0.7, 0.7, 0.7, 0.3, 0.3, -0.4);
  }

  explosion(pos, radius) {
    const n = Math.min(400, 60 + radius * 40);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(Math.random() * radius * 5);
      this.additive.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 0.4 + Math.random() * 0.5, 0.4 + Math.random() * radius * 0.25, 1, 1, 1, 1, radius * 0.4, -1, 1);
    }
    for (let i = 0; i < n * 0.6; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(Math.random() * radius * 2);
      const gr = 0.15 + Math.random() * 0.2;
      this.normal.emit(pos.x + v.x * 0.3, pos.y + v.y * 0.3, pos.z + v.z * 0.3, v.x, v.y + 1, v.z, 2 + Math.random() * 3, 0.5 + radius * 0.2, gr, gr, gr, 0.7, radius * 0.5, -0.8);
    }
    for (let i = 0; i < 30; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).normalize().multiplyScalar(10 + Math.random() * 15);
      this.additive.emit(pos.x, pos.y, pos.z, v.x, v.y, v.z, 0.8 + Math.random(), 0.06, 1, 0.7, 0.3, 1, 0, 18);
    }
  }

  fire(x, y, z, scale = 1) {
    this.additive.emit(x + (Math.random() - 0.5) * 0.6 * scale, y, z + (Math.random() - 0.5) * 0.6 * scale, (Math.random() - 0.5) * 0.4, 1.5 + Math.random(), (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, 0.25 * scale, 1, 1, 1, 0.9, -0.2, 0, 1);
    if (Math.random() < 0.3) this.normal.emit(x, y + 0.6, z, 0, 1.5, 0, 1.5, 0.3 * scale, 0.2, 0.2, 0.2, 0.35, 0.5, -0.3);
  }

  flame(pos, dir) {
    for (let i = 0; i < 4; i++) {
      const s = 10 + Math.random() * 5;
      this.additive.emit(pos.x, pos.y, pos.z, dir.x * s + (Math.random() - 0.5) * 2.5, dir.y * s + (Math.random() - 0.5) * 2.5, dir.z * s + (Math.random() - 0.5) * 2.5, 0.45 + Math.random() * 0.2, 0.15, 1, 1, 1, 0.9, 1.6, -1.5, 1);
    }
  }

  smoke(x, y, z, size = 0.4, life = 2) {
    const g = 0.25 + Math.random() * 0.25;
    this.normal.emit(x, y, z, (Math.random() - 0.5) * 0.4, 0.8 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4, life, size, g, g, g, 0.5, size, -0.2);
  }

  trail(pos) {
    this.additive.emit(pos.x, pos.y, pos.z, 0, 0, 0, 0.15, 0.25, 1, 1, 1, 1, -1, 0, 1);
    this.normal.emit(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 0.3, 0.3, (Math.random() - 0.5) * 0.3, 1.5, 0.2, 0.75, 0.75, 0.75, 0.5, 0.5, -0.1);
  }

  splash(pos, n = 20) {
    for (let i = 0; i < n; i++) this.normal.emit(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 3, Math.random() * 5 + 2, (Math.random() - 0.5) * 3, 0.8, 0.08, 0.6, 0.75, 1, 0.8, 0, 14);
  }

  poof(pos, color = 0xffffff, n = 16) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) this.normal.emit(pos.x + (Math.random() - 0.5), pos.y + Math.random(), pos.z + (Math.random() - 0.5), (Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.9, 0.3, c.r, c.g, c.b, 0.7, 0.4, -0.5);
  }

  sparkle(pos, color = 0x80e0ff, n = 12) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) this.additive.emit(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 0.6, 0.08, c.r, c.g, c.b, 1, -0.1, 0);
  }

  jet(player) {
    const p = player.position;
    for (let i = 0; i < 2; i++) this.additive.emit(p.x + (Math.random() - 0.5) * 0.3, p.y + 0.6, p.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5), -8, (Math.random() - 0.5), 0.25, 0.18, 1, 1, 1, 1, 0.5, 0, 1);
  }

  update(dt) {
    const world = this.game.world;
    let n = 0;
    const alive = [];
    for (const p of this.cube) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      const id = world.getBlock(nx, ny - p.size / 2, nz);
      if (id > 0 && SOLID[id]) {
        if (p.vy < 0) { p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; p.spin *= 0.5; }
        else { p.vx *= -0.3; p.vz *= -0.3; }
      } else { p.x = nx; p.y = ny; p.z = nz; }
      p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
      alive.push(p);
      const s = p.size * Math.min(1, p.life / p.max * 3);
      this.e.set(p.rx, p.ry, 0);
      this.q.setFromEuler(this.e);
      this.s.set(s, s, s);
      this.p.set(p.x, p.y, p.z);
      this.m.compose(this.p, this.q, this.s);
      this.cubes.setMatrixAt(n, this.m);
      this.cubes.setColorAt(n, p.color);
      n++;
    }
    this.cube = alive;
    this.cubes.count = n;
    this.cubes.instanceMatrix.needsUpdate = true;
    if (this.cubes.instanceColor) this.cubes.instanceColor.needsUpdate = true;
    this.additive.update(dt);
    this.normal.update(dt);
  }
}
