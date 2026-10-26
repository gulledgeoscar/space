// Owns every entity: spawning, updating, hit tests, riding, natural
// spawning, and persistence (including entities parked in unloaded chunks).
import * as THREE from 'three';
import { Mob, MOB_TYPES } from './mobs.js';
import { Crate, Barrel, Ball, Melon, Domino, PhysBlock, Corpse, Ragdoll, PrimedTnt, FallingBlock, DroppedItem, Nuke } from './props.js';
import { Car, Boat, Tank, Helicopter, Plane, Rocket } from './vehicles.js';
import { Projectile } from './projectiles.js';
import { BIOME } from '../world/generator.js';
import { CHUNK, chunkKey } from '../world/constants.js';
import { B, SOLID, LIQUID } from '../world/blocks.js';
import { PlayerAvatar } from './avatar.js';
import { Dragon } from './dragon.js';
import { Sign } from './sign.js';
import { Tornado, MeteorShower, Earthquake } from './disasters.js';

const MAX_SAVED = 2000;
const ray = new THREE.Ray();
const box3 = new THREE.Box3();
const hitPoint = new THREE.Vector3();

export class EntityManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.dormant = new Map(); // chunk key -> serialized entities
    this.spawnTimer = 3;
    this.pendingRestore = null;
    this.avatar = new PlayerAvatar(game);
  }

  add(e) {
    this.list.push(e);
    this.game.scene.add(e.mesh);
    return e;
  }

  spawn(type, pos, opts = {}) {
    const g = this.game;
    const p = new THREE.Vector3(pos.x, pos.y, pos.z);
    let e = null;
    if (MOB_TYPES[type]) {
      e = new Mob(g, type, opts);
      e.pos.copy(p);
      e.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
      if (opts.health) e.health = opts.health;
      if (opts.scale) e.setScale(opts.scale);
      if (opts.sitting) e.sitting = true;
    } else {
      switch (type) {
        case 'crate': e = new Crate(g); break;
        case 'barrel': e = new Barrel(g); break;
        case 'ball': e = new Ball(g, false); break;
        case 'bowling': e = new Ball(g, true); break;
        case 'melon_prop': e = new Melon(g); break;
        case 'domino': e = new Domino(g); break;
        case 'block': e = new PhysBlock(g, opts); break;
        case 'dummy': e = new Ragdoll(g); e.place(p, opts.yaw ?? 0); return this.add(e);
        case 'primed_tnt': e = new PrimedTnt(g, opts); break;
        case 'falling_block': e = new FallingBlock(g, opts); break;
        case 'item': e = new DroppedItem(g, opts); break;
        case 'nuke': e = new Nuke(g); break;
        case 'sign': e = new Sign(g, opts); break;
        case 'tornado': e = new Tornado(g); break;
        case 'meteors': e = new MeteorShower(g); break;
        case 'earthquake': e = new Earthquake(g); break;
        case 'dragon': e = new Dragon(g); p.y = Math.max(p.y + 20, opts.y ?? 0); if (opts.health) e.health = opts.health; break;
        case 'car': e = new Car(g, opts); e.place(p, opts.yaw ?? 0); break;
        case 'truck': e = new Car(g, { ...opts, truck: true }); e.place(p, opts.yaw ?? 0); break;
        case 'boat': e = new Boat(g); e.yaw = opts.yaw ?? 0; break;
        case 'tank': e = new Tank(g); e.yaw = opts.yaw ?? 0; break;
        case 'helicopter': e = new Helicopter(g); e.yaw = opts.yaw ?? 0; break;
        case 'plane': e = new Plane(g); e.place(p, opts.yaw ?? 0); break;
        case 'rocket': e = new Rocket(g); break;
        default: return null;
      }
      if (e.body && type !== 'car' && type !== 'truck') {
        e.body.position.set(p.x, p.y, p.z);
        if (opts.q) e.body.quaternion.set(...opts.q);
        else if (opts.yaw !== undefined) e.body.quaternion.setFromEuler(0, opts.yaw, 0);
        if (opts.vel) e.body.velocity.set(opts.vel.x, opts.vel.y, opts.vel.z);
        if (opts.spin) e.body.angularVelocity.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      }
      if (e.body && opts.q && (type === 'car' || type === 'truck')) e.body.quaternion.set(...opts.q);
      e.pos.copy(p);
      if (opts.scale && opts.scale !== 1) e.setScale(opts.scale);
      if (opts.frozen) e.frozen = true;
    }
    return this.add(e);
  }

  spawnProjectile(type, pos, vel, owner, opts = {}) {
    const e = new Projectile(this.game, type, { vel, owner, ...opts });
    e.pos.copy(pos);
    return this.add(e);
  }

  shootArrow(mob, target) {
    const from = mob.pos.clone().add(new THREE.Vector3(0, 1.5 * mob.scale, 0));
    const tp = (target.pos ?? target.position).clone().add(new THREE.Vector3(0, 1.2, 0));
    const d = tp.clone().sub(from);
    const dist = d.length();
    d.y += dist * dist * 0.012; // aim above to counter the drop
    const v = d.normalize().multiplyScalar(26);
    v.x += (Math.random() - 0.5) * 1.5; v.z += (Math.random() - 0.5) * 1.5;
    this.spawnProjectile('arrow', from, v, mob);
    this.game.audio.play('throw', { pos: from });
  }

  dropItem(pos, stack, vel) {
    return this.spawn('item', pos, { stack, vel });
  }

  spawnCorpse(mob, cause, source) {
    let force = null;
    const sp = source?.pos ?? source?.position;
    if (sp) force = new THREE.Vector3().subVectors(mob.pos, sp).setY(0).normalize().multiplyScalar(cause === 'explosion' ? 12 : 4).add(new THREE.Vector3(0, cause === 'explosion' ? 8 : 3, 0));
    const c = new Corpse(this.game, { source: mob, force });
    c.pos.copy(mob.pos);
    this.add(c);
  }

  alertPets(target) {
    for (const e of this.list) if (e.type === 'wolf' && e.tamed && !e.sitting && e !== target) e.target = target;
  }

  update(dt, realDt) {
    const g = this.game;
    const p = g.player;
    const view = (g.world.renderDistance + 1) * CHUNK;
    for (const e of this.list) {
      if (e.removed) continue;
      // Pause entities over unloaded ground (they'd fall through).
      if (!g.world.isLoaded(e.pos.x, e.pos.z) && e.kind !== 'projectile') continue;
      const far = Math.abs(e.pos.x - p.box.x) > view || Math.abs(e.pos.z - p.box.z) > view;
      if (far && e.kind === 'mob') continue;
      // What you ride keeps up with you in slow motion.
      e.update(e === p.vehicle ? realDt : dt);
    }
    // Sweep out removed entities.
    let w = 0;
    for (const e of this.list) {
      if (e.removed) {
        if (p.vehicle === e) this.dismount(p);
        e.dispose();
        continue;
      }
      this.list[w++] = e;
    }
    this.list.length = w;

    if (dt > 0) this.naturalSpawn(dt);
    this.avatar.update(realDt);
  }

  // Ray hit against entity bounds. Returns { entity, dist, point } or null.
  raycast(origin, dir, maxDist, filter = (e) => e.pickable) {
    ray.set(origin, dir);
    let best = null;
    for (const e of this.list) {
      if (e.removed || !filter(e)) continue;
      const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z;
      if (dx * dx + dz * dz > (maxDist + 8) * (maxDist + 8)) continue;
      e.bounds(box3);
      const hit = ray.intersectBox(box3, hitPoint);
      if (!hit) continue;
      const d = hit.distanceTo(origin);
      if (d <= maxDist && (!best || d < best.dist)) best = { entity: e, dist: d, point: hit.clone() };
    }
    return best;
  }

  inRadius(center, r, filter = () => true) {
    const out = [];
    for (const e of this.list) if (!e.removed && filter(e) && e.center.distanceTo(center) < r) out.push(e);
    return out;
  }

  // Boxes the player can stand on (vehicles and big props).
  solidBoxesNear(box) {
    const out = [];
    const p = this.game.player;
    for (const e of this.list) {
      if (e.removed || e === p.vehicle) continue;
      if (e.kind !== 'vehicle' && e.type !== 'crate') continue;
      if (Math.abs(e.pos.x - box.x) > 5 || Math.abs(e.pos.z - box.z) > 5) continue;
      const b = e.bounds(new THREE.Box3());
      if (e.type === 'crate') { b.min.set(e.pos.x - 0.5, e.pos.y - 0.5, e.pos.z - 0.5); b.max.set(e.pos.x + 0.5, e.pos.y + 0.5, e.pos.z + 0.5); }
      // Skip boxes the player is already inside so they can walk out.
      if (box.x + box.hw > b.min.x && box.x - box.hw < b.max.x && box.z + box.hw > b.min.z && box.z - box.hw < b.max.z && box.y + box.h > b.min.y && box.y < b.max.y - 0.05) continue;
      out.push(b);
    }
    return out.length ? out : null;
  }

  damageRadius(center, r, dmg, cause, source = null) {
    for (const e of this.list) {
      if (e.removed || e.kind === 'projectile' || e.kind === 'item') continue;
      const d = e.center.distanceTo(center);
      if (d < r) e.damage(dmg * (1 - d / r), cause, source ?? { pos: center });
    }
    const p = this.game.player;
    if (p.eyePos.distanceTo(center) < r && cause === 'lightning') p.damage(5, 'lightning');
  }

  explosion(center, r, power, cause, owner) {
    for (const e of this.list) {
      if (e.removed || e.kind === 'projectile') continue;
      const c = e.center;
      const d = c.distanceTo(center);
      if (d > r) continue;
      const f = 1 - d / r;
      if (e.kind === 'mob' || e.kind === 'explosive' || e.kind === 'item' || (e.kind === 'vehicle' && !e.body)) {
        const dir = c.clone().sub(center).normalize();
        e.vel.addScaledVector(dir, f * (6 + power * 2) / Math.max(0.5, e.scale));
        e.vel.y += f * (4 + power);
      }
      if (e.kind !== 'item' && e.kind !== 'explosive') e.damage(f * power * 6, cause, owner && owner !== e ? owner : { pos: center });
    }
  }

  onLightning(pos) {
    for (const e of this.list) {
      if (e.pos.distanceTo(pos) > 4) continue;
      if (e.type === 'bomber') { e.charged = true; continue; }
      if (e.type === 'pig' && !e.dead) {
        const z = this.spawn('zombie', e.pos, { yaw: e.yaw });
        z.burning = 0;
        e.dead = true; e.remove();
      }
    }
  }

  // ---- riding ----

  tryMount(player) {
    const g = this.game;
    const hit = this.raycast(player.eyePos, player.lookDir(), 6, (e) => e.rideable && !e.dead);
    if (hit) { this.mount(player, hit.entity); return; }
    // Otherwise take the nearest rideable thing within reach.
    let best = null, bd = 4.5;
    for (const e of this.list) {
      if (!e.rideable || e.dead || e.removed) continue;
      const d = e.center.distanceTo(player.eyePos);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) this.mount(player, best);
  }

  mount(player, v) {
    if (!v.rideable || player.vehicle) return;
    player.vehicle = v;
    v.rider = player;
    v.onMount?.();
    player.flying = false;
    if (v.kind === 'vehicle') this.game.thirdPerson = true;
    this.game.message(v.usesShift ? 'R to get out' : 'Shift or R to get out', '#a0e0ff');
    this.game.hud.refresh();
  }

  dismount(player) {
    const v = player.vehicle;
    if (!v) return;
    player.vehicle = null;
    v.rider = null;
    v.onDismount?.();
    this.game.thirdPerson = false;
    // Step off to the side, finding a free spot.
    const w = this.game.world;
    const base = v.center ?? v.pos;
    const side = new THREE.Vector3(Math.cos(v.yaw ?? 0), 0, -Math.sin(v.yaw ?? 0));
    const tries = [side, side.clone().negate(), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)];
    for (const t of tries) {
      for (const dist of [2, 3, 4]) {
        const x = base.x + t.x * dist, z = base.z + t.z * dist;
        let y = Math.floor(base.y + t.y * 2);
        for (let k = 0; k < 6; k++) {
          if (!w.isSolid(x, y, z) && !w.isSolid(x, y + 1, z)) {
            player.teleport(x, y + 0.01, z);
            player.vel.set(0, 2, 0);
            this.game.hud.refresh();
            return;
          }
          y++;
        }
      }
    }
    player.teleport(base.x, base.y + 3, base.z);
    this.game.hud.refresh();
  }

  // ---- natural spawning ----

  onChunkLoaded(c) {
    const parked = this.dormant.get(c.key);
    if (parked) {
      this.dormant.delete(c.key);
      for (const s of parked) this.restoreOne(s);
    }
    if (c.fromSave) return;
    const g = this.game;
    // Villagers (and a golem to guard them) move into new villages.
    for (const v of g.generator.villages.centersIn(c.cx, c.cz)) {
      const vk = `${v.x},${v.z}`;
      if (g.populatedVillages.has(vk)) continue;
      g.populatedVillages.add(vk);
      const n = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const b = v.buildings[1 + (i % (v.buildings.length - 1))] ?? v.buildings[0];
        const x = b.x + 0.5 + (Math.random() - 0.5) * 2, z = b.z + 0.5 + (Math.random() - 0.5) * 2;
        this.dormantSpawn(x, z, 'villager');
      }
      this.dormantSpawn(v.x + 4.5, v.z + 0.5, 'golem');
    }
    // Wild animals appear once per chunk, ever; saved ones come back from the save.
    const vk = g.dimKey(c.key);
    if (!g.mobSpawning || g.visitedChunks.has(vk)) return;
    g.visitedChunks.add(vk);
    if (Math.random() > 0.07) return;
    const x = c.cx * CHUNK + 4 + Math.floor(Math.random() * 8), z = c.cz * CHUNK + 4 + Math.floor(Math.random() * 8);
    const [, biome] = g.generator.column(x, z);
    const options = g.dim === 'moon' ? ['alien'] : {
      [BIOME.PLAINS]: ['cow', 'sheep', 'pig', 'horse', 'chicken'], [BIOME.FOREST]: ['pig', 'chicken', 'wolf', 'sheep'], [BIOME.BIRCH]: ['pig', 'chicken', 'sheep'],
      [BIOME.TAIGA]: ['wolf', 'sheep'], [BIOME.TUNDRA]: ['wolf'], [BIOME.JUNGLE]: ['chicken', 'pig'], [BIOME.SWAMP]: ['pig', 'chicken'],
      [BIOME.CHERRY]: ['sheep', 'pig'], [BIOME.MOUNTAINS]: ['sheep'], [BIOME.MUSHROOM]: ['cow'], [BIOME.DESERT]: [], [BIOME.BEACH]: ['chicken'], [BIOME.OCEAN]: ['fish'], [BIOME.FROZEN_OCEAN]: ['fish'],
    }[biome] ?? [];
    if (!options.length) return;
    if (g.dim === 'moon' && Math.random() > 0.3) return;
    const type = options[(Math.random() * options.length) | 0];
    const n = type === 'horse' || type === 'wolf' ? 2 : type === 'alien' ? 1 + ((Math.random() * 2) | 0) : 2 + ((Math.random() * 3) | 0);
    // Spawn once the chunk's blocks are known.
    for (let i = 0; i < n; i++) {
      const sx = x + Math.floor((Math.random() - 0.5) * 6), sz = z + Math.floor((Math.random() - 0.5) * 6);
      const top = g.world.surfaceY(sx, sz, true);
      if (top < 0) continue;
      const id = g.world.getBlock(sx, top, sz);
      if (type === 'fish') {
        if (LIQUID[id] === 1 && LIQUID[g.world.getBlock(sx, top - 2, sz)] === 1) this.spawn('fish', { x: sx + 0.5, y: top - 1.5, z: sz + 0.5 });
        continue;
      }
      if (LIQUID[id] || !SOLID[id]) continue;
      this.spawn(type, { x: sx + 0.5, y: top + 1, z: sz + 0.5 });
    }
  }

  // Spawn on the surface now if the chunk is loaded, else park it for later.
  dormantSpawn(x, z, type) {
    const g = this.game;
    if (g.world.isLoaded(x, z)) {
      const top = g.world.surfaceY(Math.floor(x), Math.floor(z), true);
      if (top >= 0) { this.spawn(type, { x, y: top + 1, z }); return; }
    }
    const k = chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    this.dormant.set(k, (this.dormant.get(k) ?? []).concat([{ type, x, y: 120, z, needsGround: true }]));
  }

  onChunkUnload(c) {
    const out = [];
    for (const e of this.list) {
      if (e.removed || e === this.game.player.vehicle) continue;
      if (Math.floor(e.pos.x / CHUNK) !== c.cx || Math.floor(e.pos.z / CHUNK) !== c.cz) continue;
      if (e.persistent && !(e.hostile && !e.name)) {
        const s = e.serialize();
        if (s) out.push(s);
      }
      e.removed = true;
    }
    if (out.length) this.dormant.set(c.key, (this.dormant.get(c.key) ?? []).concat(out));
    this.pruneDormant();
  }

  // Wild animals parked far away are forgotten once too many pile up.
  pruneDormant() {
    let total = 0;
    for (const arr of this.dormant.values()) total += arr.length;
    if (total < 1500) return;
    const p = this.game.player.box;
    const keys = [...this.dormant.keys()].map((k) => {
      const [cx, cz] = k.split(',').map(Number);
      return [k, (cx * CHUNK - p.x) ** 2 + (cz * CHUNK - p.z) ** 2];
    }).sort((a, b) => b[1] - a[1]);
    for (const [k] of keys) {
      const kept = this.dormant.get(k).filter((s) => !MOB_TYPES[s.type] || s.tamed || s.name || s.type === 'villager' || s.type === 'golem');
      total -= this.dormant.get(k).length - kept.length;
      if (kept.length) this.dormant.set(k, kept); else this.dormant.delete(k);
      if (total < 1000) break;
    }
  }

  naturalSpawn(dt) {
    const g = this.game;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 2;
    if (g.dim !== 'earth') return;
    if (!g.mobSpawning || g.difficulty === 'peaceful') {
      if (g.difficulty === 'peaceful') for (const e of this.list) if (e.hostile && !e.name) e.remove();
      return;
    }
    let hostiles = 0;
    for (const e of this.list) if (e.hostile) hostiles++;
    const cap = g.difficulty === 'hard' ? 14 : 9;
    if (hostiles >= cap || this.list.length > 250) return;
    const p = g.player.position;
    const night = g.sky.nightness > 0.75 || g.weather.type === 'storm';
    const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 26;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!g.world.isLoaded(x, z)) return;
    const top = g.world.surfaceY(x, z, true);
    if (top < 0) return;
    let y = -1;
    if (night && SOLID[g.world.getBlock(x, top, z)]) y = top + 1;
    else {
      // Caves: look for an enclosed air pocket well below the surface.
      for (let k = 0; k < 8; k++) {
        const ty = Math.floor(p.y) - 12 + Math.floor(Math.random() * 24);
        if (ty < 3 || ty > top - 6) continue;
        if (g.world.getBlock(x, ty, z) === 0 && g.world.getBlock(x, ty + 1, z) === 0 && SOLID[g.world.getBlock(x, ty - 1, z)]) { y = ty; break; }
      }
    }
    if (y < 0) return;
    const types = ['zombie', 'zombie', 'skeleton', 'bomber', 'spider'];
    const type = types[(Math.random() * types.length) | 0];
    this.spawn(type, { x: x + 0.5, y, z: z + 0.5 });
  }

  // ---- persistence ----

  serialize() {
    const out = [];
    for (const e of this.list) {
      if (e.removed || !e.persistent) continue;
      if (e.hostile && !e.name) continue;
      const s = e.serialize();
      if (s) out.push(s);
    }
    for (const arr of this.dormant.values()) out.push(...arr);
    if (out.length <= MAX_SAVED) return out;
    // Over the cap: keep what the player cares about (vehicles, pets, named
    // creatures, villagers, props) before wild animals.
    const rank = (s) => (MOB_TYPES[s.type] && !s.tamed && !s.name && s.type !== 'villager' && s.type !== 'golem' ? 1 : 0);
    return out.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_SAVED);
  }

  restoreOne(s) {
    try {
      if (s.needsGround) {
        const top = this.game.world.surfaceY(Math.floor(s.x), Math.floor(s.z), true);
        s = { ...s, y: top >= 0 ? top + 1 : s.y };
      }
      const e = this.spawn(s.type, { x: s.x, y: s.y + 0.02, z: s.z }, s);
      if (e && s.type === 'item') e.stack = s.stack;
    } catch (err) { console.warn('could not restore entity', s, err); }
  }

  afterLoad() {
    const pending = this.pendingRestore;
    this.pendingRestore = null;
    if (!pending) return;
    for (const s of pending) {
      const k = chunkKey(Math.floor(s.x / CHUNK), Math.floor(s.z / CHUNK));
      if (this.game.world.chunks.get(k)?.data) this.restoreOne(s);
      else this.dormant.set(k, (this.dormant.get(k) ?? []).concat([s]));
    }
  }

  clear(filter = () => true) {
    let n = 0;
    for (const e of this.list) if (!e.removed && filter(e) && e !== this.game.player.vehicle) { e.remove(); n++; }
    return n;
  }

  // Forget every entity (when leaving a dimension; they were serialised first).
  clearAll() {
    for (const e of this.list) e.dispose();
    this.list = [];
    this.dormant.clear();
  }

  dispose() {
    this.clearAll();
    this.avatar.dispose();
  }
}

export { B };
