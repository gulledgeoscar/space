// Chunk manager: streams chunks around the player through a worker pool,
// owns block data, and answers block queries and raycasts.
import * as THREE from 'three';
import { CHUNK, HEIGHT, index, chunkKey } from './constants.js';
import { BLOCKS, SOLID, LIQUID, B, TEXTURES } from './blocks.js';
import { createChunkMaterials } from './chunkMaterial.js';

class WorkerPool {
  constructor(size) {
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
    this.stats = { gen: 0, mesh: 0, genMs: 0, meshMs: 0, waitMs: 0 };
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        const job = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        if (job) {
          const t = job.msg.type;
          if (t === 'gen' || t === 'mesh') { this.stats[t]++; this.stats[`${t}Ms`] += performance.now() - job.started; this.stats.waitMs += job.started - job.queued; }
        }
        this.idle.push(w);
        job?.resolve(e.data);
        this.pump();
      };
      w.onerror = (e) => console.error('chunk worker error', e);
      this.workers.push(w);
      this.idle.push(w);
    }
  }
  get busy() { return this.workers.length - this.idle.length; }
  run(msg, transfer = [], priority = false) {
    return new Promise((resolve) => {
      const job = { msg, transfer, resolve, queued: performance.now() };
      if (priority) this.queue.unshift(job); else this.queue.push(job);
      this.pump();
    });
  }
  pump() {
    while (this.idle.length && this.queue.length) {
      const job = this.queue.shift();
      const w = this.idle.pop();
      const id = this.nextId++;
      job.msg.id = id;
      job.started = performance.now();
      this.pending.set(id, job);
      w.postMessage(job.msg, job.transfer);
    }
  }
  dispose() { for (const w of this.workers) w.terminate(); }
}

const NEIGHBORS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

export class World {
  constructor(scene, atlas, opts) {
    this.scene = scene;
    this.seed = opts.seed;
    this.worldType = opts.worldType ?? 'default';
    this.renderDistance = opts.renderDistance ?? 8;
    this.storage = opts.storage ?? null;
    this.chunks = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);
    this.materials = createChunkMaterials(atlas.texture, TEXTURES.indexOf('water'), TEXTURES.indexOf('lava'));
    const cores = navigator.hardwareConcurrency || 4;
    this.pool = new WorkerPool(Math.max(2, Math.min(6, cores - 1)));
    this.listeners = [];
    this.center = { cx: 0, cz: 0 };
    this.genInFlight = 0;
    this.urgent = new Set();
    this.loadedOnce = false;
  }

  onChange(fn) { this.listeners.push(fn); }

  key(cx, cz) { return chunkKey(cx, cz); }
  chunkAt(cx, cz) { return this.chunks.get(chunkKey(cx, cz)); }

  getBlock(x, y, z) {
    if (y < 0) return B.bedrock;
    if (y >= HEIGHT) return 0;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.data) return -1; // unknown / not loaded
    return c.data[index(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  isLoaded(x, z) {
    const c = this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return !!(c && c.data);
  }

  // Unloaded space counts as solid so nothing falls out of the world.
  isSolid(x, y, z) {
    const id = this.getBlock(x, y, z);
    return id < 0 ? true : SOLID[id] === 1;
  }

  setBlock(x, y, z, id, opts = {}) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.data) return false;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const i = index(lx, y, lz);
    const old = c.data[i];
    if (old === id) return false;
    c.data[i] = id;
    c.modified = true;
    this.markDirty(cx, cz, true);
    // Light can travel up to 15 blocks, but the visible effect beyond the
    // touching neighbours is small, so those refresh at normal priority.
    const lightChange = BLOCKS[old]?.light || BLOCKS[id]?.light || BLOCKS[old]?.opaque !== BLOCKS[id]?.opaque;
    for (const [dx, dz] of NEIGHBORS) {
      if (!dx && !dz) continue;
      const touching = (dx === -1 && lx === 0) || (dx === 1 && lx === CHUNK - 1) || dx === 0;
      const touchingZ = (dz === -1 && lz === 0) || (dz === 1 && lz === CHUNK - 1) || dz === 0;
      if (touching && touchingZ) this.markDirty(cx + dx, cz + dz, true);
      else if (lightChange) this.markDirty(cx + dx, cz + dz, false);
    }
    if (!opts.silent) for (const fn of this.listeners) fn(x, y, z, id, old);
    return true;
  }

  markDirty(cx, cz, urgent) {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.data) return;
    c.dirty = true;
    c.version++;
    if (urgent) this.urgent.add(c.key);
  }

  // Highest solid (or liquid) block in a column, or -1.
  surfaceY(x, z, includeLiquid = true) {
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id < 0) return -1;
      if (SOLID[id] || (includeLiquid && LIQUID[id])) return y;
    }
    return -1;
  }

  // Voxel DDA. Returns { x, y, z, id, nx, ny, nz, dist, point } or null.
  raycast(origin, dir, maxDist = 8, accept = (id) => id > 0 && !LIQUID[id]) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = sx ? Math.abs(1 / dir.x) : Infinity;
    const tdy = sy ? Math.abs(1 / dir.y) : Infinity;
    const tdz = sz ? Math.abs(1 / dir.z) : Infinity;
    let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let steps = 0; steps < 1024 && t <= maxDist; steps++) {
      const id = this.getBlock(x, y, z);
      if (id > 0 && accept(id, x, y, z)) {
        return { x, y, z, id, nx, ny, nz, dist: t, point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t) };
      }
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
      if (y < -1 || y > HEIGHT + 1) break;
    }
    return null;
  }

  // ---- streaming ----

  update(px, pz) {
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    this.center = { cx, cz };
    const rd = this.renderDistance;

    // Request missing chunks nearest first.
    if (this.genInFlight < this.pool.workers.length * 2) {
      const wanted = [];
      for (let dz = -rd - 1; dz <= rd + 1; dz++) for (let dx = -rd - 1; dx <= rd + 1; dx++) {
        if (dx * dx + dz * dz > (rd + 1.5) * (rd + 1.5)) continue;
        const k = chunkKey(cx + dx, cz + dz);
        if (!this.chunks.has(k)) wanted.push([dx * dx + dz * dz, cx + dx, cz + dz]);
      }
      wanted.sort((a, b) => a[0] - b[0]);
      for (const [, x, z] of wanted) {
        if (this.genInFlight >= this.pool.workers.length * 2) break;
        this.requestChunk(x, z);
      }
    }

    // Unload far chunks.
    const far = (rd + 3) * (rd + 3);
    for (const c of this.chunks.values()) {
      const dx = c.cx - cx, dz = c.cz - cz;
      if (dx * dx + dz * dz > far && c.data) this.unload(c);
    }

    this.scheduleMeshes(cx, cz, rd);
  }

  requestChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const c = { cx, cz, key, data: null, version: 0, meshedVersion: -1, dirty: true, meshing: false, meshes: {}, modified: false, entities: null };
    this.chunks.set(key, c);
    this.genInFlight++;
    const finish = (data, fromSave) => {
      this.genInFlight--;
      if (this.chunks.get(key) !== c) return;
      c.data = data;
      c.modified = !!fromSave;
      c.fromSave = !!fromSave;
      c.version++;
      // Neighbours can now mesh their borders properly.
      for (const [dx, dz] of NEIGHBORS) this.markDirty(cx + dx, cz + dz, false);
      this.onChunkLoaded?.(c);
    };
    const gen = () => this.pool.run({ type: 'gen', cx, cz, seed: this.seed, worldType: this.worldType }).then((r) => finish(r.data, false));
    if (this.storage?.has(key)) {
      this.storage.loadChunk(key).then((data) => (data ? finish(data, true) : gen())).catch(gen);
    } else gen();
  }

  unload(c) {
    if (c.modified && this.storage) this.storage.saveChunk(c.key, c.data);
    this.onChunkUnload?.(c);
    this.disposeMeshes(c);
    this.chunks.delete(c.key);
  }

  neighborsReady(cx, cz) {
    for (const [dx, dz] of NEIGHBORS) {
      const n = this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (!n || !n.data) return false;
    }
    return true;
  }

  scheduleMeshes(cx, cz, rd) {
    const free = this.pool.idle.length;
    if (!free && !this.urgent.size) return;
    const candidates = [];
    for (const c of this.chunks.values()) {
      if (!c.data || !c.dirty || c.meshing) continue;
      const dx = c.cx - cx, dz = c.cz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > (rd + 0.5) * (rd + 0.5)) continue;
      if (!this.neighborsReady(c.cx, c.cz)) continue;
      candidates.push([this.urgent.has(c.key) ? -1 : d2, c]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    let budget = Math.max(1, free);
    for (const [prio, c] of candidates) {
      if (budget <= 0 && prio >= 0) break;
      this.meshChunk(c, prio < 0);
      budget--;
    }
  }

  meshChunk(c, urgent) {
    c.meshing = true;
    c.dirty = false;
    this.urgent.delete(c.key);
    const version = c.version;
    const chunks = NEIGHBORS.map(([dx, dz]) => this.chunks.get(chunkKey(c.cx + dx, c.cz + dz)).data.slice());
    this.pool.run({ type: 'mesh', chunks, sky: this.worldType !== 'cave' }, chunks.map((a) => a.buffer), urgent).then(({ mesh }) => {
      c.meshing = false;
      if (this.chunks.get(c.key) !== c) return;
      if (c.version !== version) c.dirty = true;
      this.applyMesh(c, mesh);
      c.meshedVersion = version;
    });
  }

  applyMesh(c, mesh) {
    for (const kind of ['opaque', 'cutout', 'translucent']) {
      const m = mesh[kind];
      const old = c.meshes[kind];
      if (!m) {
        if (old) { this.group.remove(old); old.geometry.dispose(); delete c.meshes[kind]; }
        continue;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
      g.setAttribute('uvl', new THREE.BufferAttribute(m.uvl, 4));
      g.setAttribute('lit', new THREE.BufferAttribute(m.lit, 4, true));
      g.setIndex(new THREE.BufferAttribute(m.index, 1));
      let minY = Infinity, maxY = -Infinity;
      for (let i = 1; i < m.pos.length; i += 3) { const y = m.pos[i]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      minY /= 16; maxY /= 16;
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(CHUNK, maxY, CHUNK));
      g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
      if (old) {
        old.geometry.dispose();
        old.geometry = g;
      } else {
        const mesh3 = new THREE.Mesh(g, this.materials[kind]);
        mesh3.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
        mesh3.matrixAutoUpdate = false;
        mesh3.updateMatrix();
        mesh3.renderOrder = kind === 'translucent' ? 2 : kind === 'cutout' ? 1 : 0;
        mesh3.frustumCulled = true;
        this.group.add(mesh3);
        c.meshes[kind] = mesh3;
      }
    }
    c.hasMesh = true;
  }

  disposeMeshes(c) {
    for (const kind of Object.keys(c.meshes)) {
      const m = c.meshes[kind];
      this.group.remove(m);
      m.geometry.dispose();
    }
    c.meshes = {};
  }

  // Fraction of nearby chunks with meshes, for the loading screen.
  progress(radius = 3) {
    let total = 0, ready = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      total++;
      const c = this.chunkAt(this.center.cx + dx, this.center.cz + dz);
      if (c?.hasMesh) ready++;
    }
    return ready / total;
  }

  saveAll() {
    if (!this.storage) return Promise.resolve();
    const jobs = [];
    for (const c of this.chunks.values()) if (c.modified && c.data) jobs.push(this.storage.saveChunk(c.key, c.data));
    return Promise.all(jobs);
  }

  dispose() {
    this.pool.dispose();
    for (const c of this.chunks.values()) this.disposeMeshes(c);
    this.chunks.clear();
    this.scene.remove(this.group);
  }
}
