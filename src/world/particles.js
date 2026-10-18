// Particle system for RCS puffs, engine exhaust, sparks, debris glints,
// venting gas, water spray. Particle state is kept in inertial doubles and
// re-expressed relative to the floating origin when uploaded, so puffs fly
// away correctly even when the craft moves at 7.6 km/s.

import {
  Points, BufferGeometry, BufferAttribute, ShaderMaterial, AdditiveBlending, NormalBlending, Vector3, Color,
} from 'three';

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.05), 0.0, 400.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  varying vec4 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = (1.0 - d) * (1.0 - d);
    gl_FragColor = vec4(vColor.rgb * a * vColor.a, vColor.a * a);
  }
`;

class Pool {
  constructor(n, additive) {
    this.n = n;
    this.p = new Float64Array(n * 3);
    this.v = new Float64Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.c = new Float32Array(n * 4);
    this.drag = new Float32Array(n);
    this.next = 0;
    this.pos32 = new Float32Array(n * 3);
    this.size32 = new Float32Array(n);
    this.col32 = new Float32Array(n * 4);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos32, 3));
    g.setAttribute('aSize', new BufferAttribute(this.size32, 1));
    g.setAttribute('aColor', new BufferAttribute(this.col32, 4));
    this.mat = new ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    if (!additive) {
      // premultiplied normal blending
      this.mat.blending = NormalBlending;
      this.mat.premultipliedAlpha = true;
    }
    this.points = new Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.alive = 0;
  }
  spawn(px, py, pz, vx, vy, vz, life, s0, s1, r, g, b, a, drag = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p[i * 3] = px; this.p[i * 3 + 1] = py; this.p[i * 3 + 2] = pz;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life;
    this.s0[i] = s0; this.s1[i] = s1;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = a;
    this.drag[i] = drag;
  }
  update(dt, origin, gx, gy, gz, air) {
    let alive = 0;
    const ax = air.x, ay = air.y, az = air.z;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.size32[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, 1 - this.drag[i] * dt);
      const i3 = i * 3;
      // gravity, and drag relaxing toward the local air velocity
      this.v[i3] = ax + (this.v[i3] + gx * dt - ax) * k;
      this.v[i3 + 1] = ay + (this.v[i3 + 1] + gy * dt - ay) * k;
      this.v[i3 + 2] = az + (this.v[i3 + 2] + gz * dt - az) * k;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      const t = 1 - Math.max(0, this.life[i]) / this.max[i];
      this.pos32[i3] = this.p[i3] - ox; this.pos32[i3 + 1] = this.p[i3 + 1] - oy; this.pos32[i3 + 2] = this.p[i3 + 2] - oz;
      this.size32[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col32[i * 4] = this.c[i * 4]; this.col32[i * 4 + 1] = this.c[i * 4 + 1]; this.col32[i * 4 + 2] = this.c[i * 4 + 2];
      this.col32[i * 4 + 3] = this.c[i * 4 + 3] * Math.max(0, fade);
      alive++;
    }
    this.alive = alive;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }
  clear() { this.life.fill(0); }
}

export class Particles {
  constructor(scene) {
    this.glow = new Pool(3000, true);
    this.gas = new Pool(3500, false);
    scene.add(this.glow.points, this.gas.points);
    this.gravity = new Vector3();
    this.airVel = new Vector3();
    this._d = new Vector3();
  }
  setScale(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.glow.mat.uniforms.uScale.value = s;
    this.gas.mat.uniforms.uScale.value = s;
  }
  // RCS jet puff: cold, translucent, expanding quickly
  rcsPuff(pos, exhaustDir, baseVel, strength, coarse) {
    const n = coarse ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const sp = (coarse ? 26 : 12) * (0.7 + Math.random() * 0.6);
      const j = 0.25;
      const dx = exhaustDir.x + (Math.random() - 0.5) * j, dy = exhaustDir.y + (Math.random() - 0.5) * j, dz = exhaustDir.z + (Math.random() - 0.5) * j;
      this.gas.spawn(pos.x, pos.y, pos.z, baseVel.x + dx * sp, baseVel.y + dy * sp, baseVel.z + dz * sp,
        coarse ? 0.55 : 0.4, coarse ? 0.15 : 0.06, coarse ? 2.6 : 0.9, 0.95, 0.96, 1.0, (coarse ? 0.32 : 0.22) * strength);
    }
  }
  engine(pos, exhaustDir, baseVel, level, atmo = 0) {
    for (let k = 0; k < 4; k++) {
      const sp = 60 + Math.random() * 40;
      const j = 0.12 + atmo * 0.2;
      this.glow.spawn(pos.x, pos.y, pos.z,
        baseVel.x + (exhaustDir.x + (Math.random() - 0.5) * j) * sp,
        baseVel.y + (exhaustDir.y + (Math.random() - 0.5) * j) * sp,
        baseVel.z + (exhaustDir.z + (Math.random() - 0.5) * j) * sp,
        0.35 + atmo * 0.4, 0.6, 3.5 + atmo * 6, 1.6 * level, 1.2 * level, 2.4 * level, 0.5);
    }
    if (atmo > 0.05) {
      for (let k = 0; k < 2; k++) {
        const sp = 25 + Math.random() * 15;
        this.gas.spawn(pos.x, pos.y, pos.z, baseVel.x + exhaustDir.x * sp + (Math.random() - 0.5) * 8,
          baseVel.y + exhaustDir.y * sp + (Math.random() - 0.5) * 8, baseVel.z + exhaustDir.z * sp + (Math.random() - 0.5) * 8,
          3.5, 2, 24, 0.85, 0.83, 0.8, 0.25 * atmo * level, 0.4);
      }
    }
  }
  sparks(pos, baseVel, count = 40, speed = 6) {
    for (let k = 0; k < count; k++) {
      const d = this._rand();
      const s = speed * (0.3 + Math.random());
      this.glow.spawn(pos.x, pos.y, pos.z, baseVel.x + d.x * s, baseVel.y + d.y * s, baseVel.z + d.z * s,
        0.6 + Math.random() * 1.2, 0.08, 0.02, 5, 3, 1.2, 1);
    }
  }
  explosion(pos, baseVel, scale = 1) {
    for (let k = 0; k < 260 * scale; k++) {
      const d = this._rand();
      const s = (8 + Math.random() * 40) * scale;
      this.glow.spawn(pos.x, pos.y, pos.z, baseVel.x + d.x * s, baseVel.y + d.y * s, baseVel.z + d.z * s,
        1 + Math.random() * 2.5, 3 * scale, 9 * scale, 6, 2.6, 0.8, 1);
    }
    for (let k = 0; k < 160 * scale; k++) {
      const d = this._rand();
      const s = (2 + Math.random() * 14) * scale;
      this.gas.spawn(pos.x, pos.y, pos.z, baseVel.x + d.x * s, baseVel.y + d.y * s, baseVel.z + d.z * s,
        4 + Math.random() * 4, 4 * scale, 30 * scale, 0.5, 0.48, 0.46, 0.5);
    }
    this.sparks(pos, baseVel, 120 * scale, 30 * scale);
  }
  vent(pos, dir, baseVel, rate) {
    for (let k = 0; k < 3; k++) {
      const s = 30 + Math.random() * 60;
      this.gas.spawn(pos.x, pos.y, pos.z, baseVel.x + (dir.x + (Math.random() - 0.5) * 0.4) * s,
        baseVel.y + (dir.y + (Math.random() - 0.5) * 0.4) * s, baseVel.z + (dir.z + (Math.random() - 0.5) * 0.4) * s,
        1.6, 0.6, 9, 0.92, 0.95, 1.0, 0.18 * rate);
    }
  }
  spray(pos, baseVel, count = 6) {
    for (let k = 0; k < count; k++) {
      const d = this._rand();
      this.gas.spawn(pos.x, pos.y, pos.z, baseVel.x + d.x * 3, baseVel.y + Math.abs(d.y) * 6 + 2, baseVel.z + d.z * 3,
        1.4, 0.3, 2.5, 0.85, 0.92, 0.95, 0.3, 0.2);
    }
  }
  _rand() {
    const d = this._d;
    do { d.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (d.lengthSq() > 1 || d.lengthSq() < 0.01);
    return d.normalize();
  }
  update(dt, origin) {
    const g = this.gravity;
    this.glow.update(dt, origin, g.x, g.y, g.z, this.airVel);
    this.gas.update(dt, origin, g.x, g.y, g.z, this.airVel);
  }
  clear() { this.glow.clear(); this.gas.clear(); }
}
