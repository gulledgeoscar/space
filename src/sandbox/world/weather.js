// Rain, snow, thunderstorms and lightning, plus ambient sound beds.
import * as THREE from 'three';
import { BIOME } from './generator.js';
import { B, BLOCKS, SOLID, LIQUID } from './blocks.js';

const RAIN = 1800;
const SNOW = 1400;
const BOX = 36;   // horizontal span around the camera
const GRID = 40;  // rain-shadow heightmap span

export class Weather {
  constructor(game) {
    this.game = game;
    this.type = 'clear';
    this.timer = 300 + Math.random() * 400;
    this.intensity = 0;      // 0..1, eases toward target
    this.storminess = 0;
    this.flash = 0;
    this.fogDensity = 0;
    this.nextBolt = 5;
    this.auto = true;

    // Rain streaks.
    const rp = new Float32Array(RAIN * 6);
    this.rainData = new Float32Array(RAIN * 4); // x, y, z, speed
    for (let i = 0; i < RAIN; i++) this.resetDrop(i, true);
    const rg = new THREE.BufferGeometry();
    this.rainPos = new THREE.BufferAttribute(rp, 3).setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('position', this.rainPos);
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9ab0d0, transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    game.scene.add(this.rain);

    // Snow flakes.
    const sp = new Float32Array(SNOW * 3);
    this.snowSeed = new Float32Array(SNOW);
    for (let i = 0; i < SNOW; i++) {
      sp[i * 3] = (Math.random() - 0.5) * BOX; sp[i * 3 + 1] = Math.random() * 30; sp[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.snowSeed[i] = Math.random() * 100;
    }
    const sg = new THREE.BufferGeometry();
    this.snowPos = new THREE.BufferAttribute(sp, 3).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.snowPos);
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.snowAnchor = new THREE.Vector3();
    game.scene.add(this.snow);

    // Heightmap of the highest blocking block around the camera so rain
    // stops at roofs.
    this.shadow = new Int16Array(GRID * GRID).fill(-1);
    this.shadowOrigin = { x: 0, z: 0 };
    this.shadowCursor = 0;

    this.bolts = [];
    this.ambientTimer = 3;
  }

  resetDrop(i, anywhere) {
    const d = this.rainData;
    d[i * 4] = (Math.random() - 0.5) * BOX;
    d[i * 4 + 1] = anywhere ? Math.random() * 30 : 24 + Math.random() * 8;
    d[i * 4 + 2] = (Math.random() - 0.5) * BOX;
    d[i * 4 + 3] = 22 + Math.random() * 8;
  }

  set(type, time) {
    this.type = type;
    this.timer = time ?? 200 + Math.random() * 500;
  }

  cycle() {
    const order = ['clear', 'rain', 'storm', 'snow'];
    this.set(order[(order.indexOf(this.type) + 1) % order.length], 600);
    this.game.message(`Weather: ${this.type}`);
  }

  // Precipitation kind at the player: snow in cold biomes, none in deserts.
  localKind() {
    if (this.type === 'clear' || this.game.dim !== 'earth') return 'none';
    if (this.type === 'snow') return 'snow';
    const p = this.game.player.box;
    const [, biome] = this.game.generator.column(Math.floor(p.x), Math.floor(p.z));
    if (biome === BIOME.DESERT || biome === BIOME.BADLANDS) return 'none';
    if (biome === BIOME.TUNDRA || biome === BIOME.PEAKS || biome === BIOME.FROZEN_OCEAN || biome === BIOME.TAIGA || p.y > 95) return 'snow';
    return 'rain';
  }

  updateShadow(cx, cz) {
    const w = this.game.world;
    const ox = Math.floor(cx) - GRID / 2, oz = Math.floor(cz) - GRID / 2;
    if (Math.abs(ox - this.shadowOrigin.x) > 3 || Math.abs(oz - this.shadowOrigin.z) > 3) {
      this.shadowOrigin = { x: ox, z: oz };
      this.shadow.fill(-1);
    }
    for (let k = 0; k < 120; k++) {
      const i = this.shadowCursor;
      this.shadowCursor = (this.shadowCursor + 1) % (GRID * GRID);
      const x = this.shadowOrigin.x + (i % GRID), z = this.shadowOrigin.z + Math.floor(i / GRID);
      this.shadow[i] = w.surfaceY(x, z, true);
    }
  }

  groundAt(x, z) {
    const gx = Math.floor(x) - this.shadowOrigin.x, gz = Math.floor(z) - this.shadowOrigin.z;
    if (gx < 0 || gz < 0 || gx >= GRID || gz >= GRID) return -1;
    return this.shadow[gz * GRID + gx];
  }

  strike(pos, opts = {}) {
    const g = this.game;
    // Find the ground under the target.
    const top = g.world.surfaceY(Math.floor(pos.x), Math.floor(pos.z), false);
    const y = opts.exact ? pos.y : Math.max(top + 1, 0);
    const end = new THREE.Vector3(pos.x, y, pos.z);
    const pts = [];
    let p = new THREE.Vector3(end.x + (Math.random() - 0.5) * 20, Math.min(160, end.y + 90), end.z + (Math.random() - 0.5) * 20);
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const q = new THREE.Vector3().lerpVectors(p, end, t);
      if (i > 0 && i < n) { q.x += (Math.random() - 0.5) * 6; q.z += (Math.random() - 0.5) * 6; }
      pts.push(q);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 1 }));
    line.frustumCulled = false;
    g.scene.add(line);
    // A glow core using a fat tube.
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.25, 4), new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.scene.add(tube);
    this.bolts.push({ line, tube, life: 0.35 });
    this.flash = 1;
    const dist = end.distanceTo(g.camera.position);
    setTimeout(() => g.audio.play('thunder', { gain: Math.max(0.2, 1 - dist / 300) }), Math.min(3000, dist * 3));
    // Effects at the ground.
    g.particles.explosion(end, 1.2);
    g.entities.damageRadius(end, 3.5, 10, 'lightning');
    if (opts.blast) g.explode(end, opts.blast, { fire: true, source: 'lightning' });
    else {
      for (let k = 0; k < 4; k++) {
        const fx = Math.floor(end.x + (Math.random() - 0.5) * 3), fz = Math.floor(end.z + (Math.random() - 0.5) * 3);
        const fy = g.world.surfaceY(fx, fz, false) + 1;
        if (fy > 0 && g.world.getBlock(fx, fy, fz) === 0 && g.fireSpread) g.world.setBlock(fx, fy, fz, B.fire);
      }
    }
    // Creatures struck become charged / zombified for fun.
    g.entities.onLightning?.(end);
  }

  update(dt, realDt) {
    const g = this.game;
    if (this.auto && g.daylightCycle) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const r = Math.random();
        this.set(this.type !== 'clear' ? 'clear' : r < 0.6 ? 'rain' : r < 0.85 ? 'storm' : 'snow');
      }
    }
    const kind = this.localKind();
    const target = this.type === 'clear' ? 0 : 1;
    this.intensity += (target - this.intensity) * Math.min(1, realDt * 0.3);
    const stormTarget = this.type === 'storm' ? 1 : this.type === 'clear' ? 0 : 0.55;
    this.storminess += (stormTarget - this.storminess) * Math.min(1, realDt * 0.3);
    this.fogDensity += ((this.type === 'clear' ? 0 : this.type === 'snow' || kind === 'snow' ? 0.45 : 0.25) - this.fogDensity) * Math.min(1, realDt * 0.3);
    this.flash = Math.max(0, this.flash - realDt * 3);

    const cam = g.camera.position;
    this.updateShadow(cam.x, cam.z);

    // Rain.
    const showRain = kind === 'rain' && this.intensity > 0.05;
    this.rain.visible = showRain;
    if (showRain) {
      const d = this.rainData, pos = this.rainPos.array;
      const active = Math.floor(RAIN * this.intensity);
      for (let i = 0; i < RAIN; i++) {
        if (i >= active) { pos.fill(0, i * 6, i * 6 + 6); continue; }
        d[i * 4 + 1] -= d[i * 4 + 3] * dt;
        const wx = cam.x + d[i * 4], wz = cam.z + d[i * 4 + 2];
        const wy = cam.y + d[i * 4 + 1] - 12;
        const ground = this.groundAt(wx, wz);
        if (d[i * 4 + 1] < -12 || wy < ground + 1) {
          if (wy < ground + 1 && ground > 0 && Math.random() < 0.05) g.particles.normal.emit(wx, ground + 1.05, wz, 0, 1.2, 0, 0.25, 0.05, 0.7, 0.8, 1, 0.5, 0, 8);
          this.resetDrop(i, false);
          continue;
        }
        pos[i * 6] = wx; pos[i * 6 + 1] = wy; pos[i * 6 + 2] = wz;
        pos[i * 6 + 3] = wx + 0.05; pos[i * 6 + 4] = wy + 0.6; pos[i * 6 + 5] = wz + 0.02;
      }
      this.rainPos.needsUpdate = true;
      this.rain.material.opacity = 0.25 + 0.3 * this.intensity;
    }
    // Snow.
    const showSnow = kind === 'snow' && this.intensity > 0.05;
    this.snow.visible = showSnow;
    if (showSnow) {
      const p = this.snowPos.array;
      const t = g.elapsed;
      // Flakes live in a box that scrolls with the camera.
      const dx = cam.x - this.snowAnchor.x, dy = cam.y - this.snowAnchor.y, dz = cam.z - this.snowAnchor.z;
      this.snowAnchor.copy(cam);
      for (let i = 0; i < SNOW; i++) {
        let x = p[i * 3] - dx, y = p[i * 3 + 1] - dy, z = p[i * 3 + 2] - dz;
        const s = this.snowSeed[i];
        y -= (1.5 + (s % 1)) * dt;
        x += Math.sin(t * 0.7 + s) * 0.4 * dt;
        z += Math.cos(t * 0.5 + s) * 0.4 * dt;
        const ground = this.groundAt(cam.x + x, cam.z + z);
        if (y < -12 || cam.y + y < ground + 1) { y = 18 + Math.random() * 6; x = (Math.random() - 0.5) * BOX; z = (Math.random() - 0.5) * BOX; }
        if (x < -BOX / 2) x += BOX; if (x > BOX / 2) x -= BOX;
        if (z < -BOX / 2) z += BOX; if (z > BOX / 2) z -= BOX;
        p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
      }
      this.snow.position.copy(cam);
      this.snowPos.needsUpdate = true;
      this.snow.material.opacity = 0.9 * this.intensity;
    }

    // Lightning during storms.
    if (this.type === 'storm' && this.intensity > 0.6) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 4 + Math.random() * 14;
        const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 90;
        this.strike(new THREE.Vector3(cam.x + Math.cos(a) * r, 0, cam.z + Math.sin(a) * r));
      }
    }
    for (const b of this.bolts) {
      b.life -= realDt;
      const o = Math.max(0, b.life / 0.35) * (Math.random() < 0.3 ? 0.3 : 1);
      b.line.material.opacity = o; b.tube.material.opacity = o * 0.8;
      if (b.life <= 0) {
        g.scene.remove(b.line, b.tube);
        b.line.geometry.dispose(); b.tube.geometry.dispose();
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);

    // Ambient sound beds.
    const a = g.audio;
    if (a.ctx) {
      const covered = this.groundAt(cam.x, cam.z) > cam.y;
      const rainLoop = a.noiseLoop('rain', { type: 'lowpass', f: 3000, q: 0.3, gain: 0.25 });
      rainLoop?.set(kind === 'rain' ? this.intensity * (covered ? 0.4 : 1) : 0, covered ? 900 : 3000);
      const windLoop = a.noiseLoop('wind', { type: 'bandpass', f: 400, q: 0.6, gain: 0.25, brown: true });
      const high = Math.max(0, Math.min(1, (cam.y - 80) / 40));
      windLoop?.set(Math.max(high, this.storminess * 0.6, kind === 'snow' ? 0.4 * this.intensity : 0), 300 + high * 400);
      this.ambientTimer -= realDt;
      if (this.ambientTimer < 0) {
        this.ambientTimer = 3 + Math.random() * 6;
        const night = g.sky.nightness > 0.6;
        const outside = !covered && this.type === 'clear' && g.dim === 'earth';
        if (outside && cam.y > 40 && cam.y < 110) a.play(night ? 'cricket' : 'bird', { gain: 0.6 });
      }
    }
  }

  dispose() {
    for (const b of this.bolts) this.game.scene.remove(b.line, b.tube);
    this.bolts = [];
  }
}

export { BLOCKS, SOLID, LIQUID };
