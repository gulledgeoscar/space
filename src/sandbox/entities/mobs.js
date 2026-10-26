// Creatures: animals, villagers, monsters and golems, with simple AI.
import * as THREE from 'three';
import { VoxelEntity } from './base.js';
import { buildModel } from './models.js';
import { B, BLOCKS, SOLID, LIQUID } from '../world/blocks.js';
import { moveAxis } from '../physics/voxelCollide.js';

export const MOB_TYPES = {
  pig: { hp: 10, speed: 2.2, hw: 0.4, h: 0.9, sound: 'pig', food: ['apple', 'bread'], drops: ['steak'] },
  cow: { hp: 10, speed: 2.0, hw: 0.45, h: 1.4, sound: 'cow', food: ['apple', 'bread'], drops: ['steak'] },
  sheep: { hp: 8, speed: 2.1, hw: 0.45, h: 1.3, sound: 'sheep', food: ['apple', 'bread'], drops: ['wool'] },
  chicken: { hp: 4, speed: 2.2, hw: 0.2, h: 0.75, sound: 'chicken', food: ['bread'], drops: ['steak'], flutter: true },
  wolf: { hp: 16, speed: 4.2, hw: 0.3, h: 0.85, sound: 'wolf', food: ['steak'], attack: 4, tameable: true },
  horse: { hp: 24, speed: 2.6, hw: 0.6, h: 1.6, sound: 'horse', food: ['apple', 'bread'], rideable: true },
  villager: { hp: 20, speed: 2.4, hw: 0.3, h: 1.95, sound: 'villager' },
  zombie: { hp: 20, speed: 3.0, hw: 0.3, h: 1.95, sound: 'zombie', hostile: true, attack: 3, burns: true, drops: ['iron?'] },
  skeleton: { hp: 20, speed: 3.0, hw: 0.3, h: 1.95, sound: 'skeleton', hostile: true, ranged: true, burns: true, drops: ['stick'] },
  bomber: { hp: 20, speed: 2.8, hw: 0.4, h: 1.6, sound: 'fuse', hostile: true, bomber: true, drops: ['gunpowder'] },
  spider: { hp: 16, speed: 4.6, hw: 0.65, h: 0.9, sound: 'spider', hostile: true, attack: 2, climbs: true, drops: ['string'] },
  fish: { hp: 3, speed: 2.5, hw: 0.2, h: 0.4, sound: 'splash', aquatic: true, drops: ['steak'] },
  alien: { hp: 14, speed: 2.6, hw: 0.3, h: 1.6, sound: 'villager', drops: ['emerald?'] },
  golem: { hp: 100, speed: 2.4, hw: 0.7, h: 2.7, sound: 'hit', guardian: true, attack: 12 },
};

const VILLAGER_LINES = [
  'Hrmm.', 'Nice weather today.', 'Have you seen my chickens?', 'Hmm... hm!', 'The night is dangerous. Build a wall!',
  'I heard someone built a skyscraper out of TNT.', 'Do you need anything? I have nothing.', 'Hrrm hrm.', 'Watch out for the Bombers.',
  'This world goes on forever, they say.', 'I used to be an adventurer.', 'Stay away from the lava.',
];

const tmp = new THREE.Vector3();

export class Mob extends VoxelEntity {
  constructor(game, type, opts = {}) {
    const def = MOB_TYPES[type];
    super(game, type, def.hw, def.h);
    this.def = def;
    this.kind = 'mob';
    this.health = this.maxHealth = def.hp;
    this.hostile = !!def.hostile;
    this.woolColor = opts.woolColor ?? (type === 'sheep' ? [0xeeeeee, 0xeeeeee, 0xeeeeee, 0x606060, 0x1c1c1c, 0x7a5030][(Math.random() * 6) | 0] : undefined);
    this.fishColor = opts.fishColor ?? (type === 'fish' ? [0xf08030, 0x40a0f0, 0xf0e040, 0xe04060, 0xc0c0c0][(Math.random() * 5) | 0] : undefined);
    this.coat = opts.coat ?? (type === 'horse' ? [0x8a5a30, 0x5a3a20, 0xd8c8a8, 0x3a2a20, 0xa8a8a8][(Math.random() * 5) | 0] : undefined);
    this.model = buildModel(this, type);
    this.mesh.add(this.model.root);
    this.state = 'idle';
    this.think = Math.random() * 2;
    this.moveTarget = null;
    this.target = null;
    this.walkPhase = 0;
    this.attackCooldown = 0;
    this.soundTimer = 5 + Math.random() * 10;
    this.fuse = 0;
    this.burning = 0;
    this.love = 0;
    this.tamed = !!opts.tamed;
    this.owner = this.tamed ? game.player : null;
    this.sitting = false;
    this.baby = !!opts.baby;
    this.grow = 0;
    this.charged = false;
    this.fleeTime = 0;
    this.name = opts.name ?? null;
    this.panicFrom = null;
    if (this.model.collar) this.model.collar.visible = this.tamed;
    this.setScale(opts.scale ?? (this.baby ? 0.5 : 1));
    this.buoyant = true;
    this.speech = null;
  }

  get rideable() { return !!this.def.rideable && !this.baby; }

  seatPosition() {
    return tmp.set(this.pos.x, this.pos.y + 1.0 * this.scale, this.pos.z).clone();
  }

  // Player steering while riding (horses).
  drive(input, dt, player) {
    const fwd = input.axis('KeyS', 'KeyW');
    const strafe = input.axis('KeyA', 'KeyD');
    this.yaw = player.yaw + Math.PI;
    const sp = (input.key('ControlLeft') ? 11 : 7) * (fwd < 0 ? 0.5 : 1);
    const sinY = Math.sin(player.yaw), cosY = Math.cos(player.yaw);
    const tx = (-sinY * fwd + cosY * strafe * 0.6) * sp;
    const tz = (-cosY * fwd - sinY * strafe * 0.6) * sp;
    const k = Math.min(1, dt * 5);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    if (input.key('Space') && this.onGround) this.vel.y = 10.5 * Math.sqrt(this.game.gravity / 28);
    this.ridden = true;
  }

  say(text) {
    this.speech = { text, time: 4 };
    this.game.hud.speech(this, text);
  }

  onHurt(amount, cause, source) {
    this.game.audio.play(this.def.sound === 'fuse' ? 'hit' : this.def.sound, { pos: this.pos });
    this.game.particles.blood(this.center, this.type === 'skeleton' || this.type === 'golem' ? 0xdddddd : 0xaa2020, 6);
    if (source && source !== this) {
      if (!this.hostile && !this.def.guardian && !this.tamed && this.type !== 'wolf') { this.state = 'flee'; this.fleeTime = 5; this.panicFrom = source; }
      else if (this.def.attack || this.def.ranged || this.def.bomber) {
        if (!(this.tamed && source === this.owner)) this.target = source;
      }
      // Knockback.
      const sp = source.pos ?? source.position;
      if (sp) {
        tmp.set(this.pos.x - sp.x, 0, this.pos.z - sp.z).normalize().multiplyScalar(5 / Math.sqrt(this.scale));
        this.vel.x += tmp.x; this.vel.z += tmp.z; this.vel.y = Math.max(this.vel.y, 4);
      }
    }
    // Tamed dogs join in on whatever their owner attacks.
    if (source === this.game.player && !this.tamed) this.game.entities.alertPets(this);
  }

  onLand(fell) { this.damage(Math.floor(fell - 3), 'fall'); }

  onDeath(cause, source) {
    const g = this.game;
    g.audio.play('death', { pos: this.pos });
    if (source === g.player) g.stats.kills++;
    if (!g.creative) {
      for (const d of this.def.drops ?? []) {
        if (d === 'wool') g.entities.dropItem(this.center, { kind: 'block', id: woolBlockFor(this.woolColor), count: 1 + ((Math.random() * 2) | 0) });
        else if (d.endsWith('?')) { if (Math.random() < 0.25) g.entities.dropItem(this.center, { kind: 'tool', key: d.slice(0, -1), count: 1 }); }
        else g.entities.dropItem(this.center, { kind: 'tool', key: d, count: 1 + ((Math.random() * 2) | 0) });
      }
    }
    if (this.type === 'bomber' && cause !== 'self') this.explodeNow(true);
    g.entities.spawnCorpse(this, cause, source);
  }

  feed(stack) {
    const g = this.game;
    if (this.def.tameable && stack.key === 'steak' && !this.tamed) {
      if (Math.random() < 0.4) {
        this.tamed = true; this.owner = g.player; this.target = null;
        if (this.model.collar) this.model.collar.visible = true;
        g.particles.sparkle(this.center, 0xff4060, 16);
        g.message('Dog tamed! Right-click to make it sit.');
      } else g.particles.poof(this.center, 0x404040, 6);
      return true;
    }
    if (this.def.food?.includes(stack.key)) {
      if (this.baby) { this.grow += 20; }
      else this.love = 15;
      g.particles.sparkle(this.center, 0xff6080, 10);
      this.heal(4);
      return true;
    }
    return false;
  }

  heal(n) { this.health = Math.min(this.maxHealth, this.health + n); }

  interact(player) {
    const g = this.game;
    const s = g.inventory.selected;
    if (s?.kind === 'tool' && (g.tools.isFood(s.key)) && this.feed(s)) { if (!g.creative) g.inventory.consumeSelected(); return true; }
    if (this.tamed && this.type === 'wolf') { this.sitting = !this.sitting; this.target = null; g.message(this.sitting ? 'Sit.' : 'Come on!'); return true; }
    if (this.type === 'villager') { this.say(VILLAGER_LINES[(Math.random() * VILLAGER_LINES.length) | 0]); this.lookAtPlayer = 3; return true; }
    if (this.rideable) { g.entities.mount(player, this); return true; }
    return false;
  }

  explodeNow(skipKill = false) {
    if (this.exploded) return;
    this.exploded = true;
    this.game.explode(this.center, this.charged ? 6 : 3.2, { source: 'explosion', owner: this });
    if (!skipKill) { this.dead = true; this.remove(); }
  }

  findTarget() {
    const g = this.game;
    const p = g.player;
    const def = this.def;
    const near = (e, r) => e.pos.distanceToSquared(this.pos) < r * r;
    if (def.guardian) {
      let best = null, bd = 18 * 18;
      for (const e of g.entities.list) {
        if (e.kind !== 'mob' || !e.hostile || e.dead) continue;
        const d = e.pos.distanceToSquared(this.pos);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    }
    if (this.hostile) {
      const night = g.sky.nightness > 0.5;
      if (this.type === 'spider' && !night && !this.target) return null;
      if (!g.creative && !p.dead && near({ pos: p.position }, 28)) return p;
      if (this.type === 'zombie') {
        for (const e of g.entities.list) if ((e.type === 'villager' || (e.type === 'golem')) && !e.dead && near(e, 16)) return e;
      }
      return null;
    }
    return null;
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    if (this.frozen) { this.updateLook(dt); this.mesh.position.copy(this.pos); return; }
    const def = this.def;
    const p = g.player;
    if (def.aquatic) { this.swim(dt); return; }
    this.attackCooldown -= dt;
    this.think -= dt;
    this.love = Math.max(0, this.love - dt);
    if (this.baby) {
      this.grow += dt;
      if (this.grow > 120) { this.baby = false; this.setScale(1); }
    }

    // Riding: the player drives.
    if (this.ridden && p.vehicle === this) {
      this.ridden = false;
      this.physics(dt);
      this.animate(dt, Math.hypot(this.vel.x, this.vel.z));
      this.mesh.position.copy(this.pos);
      this.mesh.rotation.y = this.yaw;
      this.updateLook(dt);
      return;
    }

    // Validate target.
    if (this.target && (this.target.dead || this.target.removed || (this.target === p && (g.creative || p.dead)))) this.target = null;
    if (this.think <= 0) {
      this.think = 0.5 + Math.random() * 0.5;
      if (!this.target) this.target = this.findTarget();
      if (this.tamed && this.owner && !this.target) {
        const op = p.position;
        const d = op.distanceTo(this.pos);
        if (this.sitting) this.moveTarget = null;
        else if (d > 24) { this.pos.set(op.x, op.y, op.z); this.vel.set(0, 0, 0); }
        else if (d > 4) this.moveTarget = op.clone();
        else this.moveTarget = null;
      } else if (!this.target && this.state !== 'flee') {
        // Wander, follow food, or seek a partner.
        const s = g.inventory.selected;
        const holdsFood = s?.kind === 'tool' && def.food?.includes(s.key);
        if (holdsFood && p.position.distanceTo(this.pos) < 10 && !p.dead) {
          this.moveTarget = p.position.clone();
          this.state = 'follow';
        } else if (this.love > 0) {
          const mate = g.entities.list.find((e) => e !== this && e.type === this.type && e.love > 0 && !e.baby && e.pos.distanceTo(this.pos) < 10);
          if (mate) {
            this.moveTarget = mate.pos.clone();
            if (mate.pos.distanceTo(this.pos) < 1.6) {
              this.love = 0; mate.love = 0;
              g.entities.spawn(this.type, this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), { baby: true, woolColor: Math.random() < 0.5 ? this.woolColor : mate.woolColor, coat: this.coat });
              g.particles.sparkle(this.center, 0xff6080, 20);
              g.audio.play('pop', { pos: this.pos });
            }
          }
        } else if (Math.random() < 0.35) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 8;
          this.moveTarget = new THREE.Vector3(this.pos.x + Math.cos(a) * r, this.pos.y, this.pos.z + Math.sin(a) * r);
          this.state = 'wander';
        } else if (Math.random() < 0.3) { this.moveTarget = null; this.state = 'idle'; }
        // Villagers flee zombies.
        if (this.type === 'villager') {
          const z = g.entities.list.find((e) => e.type === 'zombie' && e.pos.distanceTo(this.pos) < 8);
          if (z) { this.state = 'flee'; this.fleeTime = 3; this.panicFrom = z; }
        }
      }
    }

    let speed = def.speed;
    let want = null;
    if (this.state === 'flee' && this.panicFrom) {
      this.fleeTime -= dt;
      const from = this.panicFrom.pos ?? this.panicFrom.position;
      want = tmp.set(this.pos.x - from.x, 0, this.pos.z - from.z).normalize().multiplyScalar(5).add(this.pos).clone();
      speed *= 1.8;
      if (this.fleeTime <= 0) { this.state = 'idle'; this.panicFrom = null; }
    } else if (this.target) {
      const tp = this.target.pos ?? this.target.position;
      const dist = Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z);
      const reach = this.box.hw + (this.target.box?.hw ?? 0.3) + 0.9;
      if (def.ranged) {
        if (dist > 12) want = tp.clone();
        else if (dist < 6) want = tmp.set(this.pos.x * 2 - tp.x, this.pos.y, this.pos.z * 2 - tp.z).clone();
        if (this.attackCooldown <= 0 && dist < 18) {
          this.attackCooldown = 1.8 + Math.random();
          g.entities.shootArrow(this, this.target);
        }
      } else if (def.bomber) {
        want = tp.clone();
        if (dist < 2.6) { this.fuse += dt; if (this.fuse === dt) g.audio.play('fuse', { pos: this.pos }); }
        else this.fuse = Math.max(0, this.fuse - dt);
        if (this.fuse > 1.5) { this.explodeNow(); return; }
        if (dist > 30) this.target = null;
      } else {
        want = tp.clone();
        speed *= this.hostile ? 1.15 : 1.4;
        if (dist < reach && Math.abs(tp.y - this.pos.y) < 2.5 && this.attackCooldown <= 0) {
          this.attackCooldown = 1.0;
          const dmg = (def.attack ?? 2) * (g.difficulty === 'hard' ? 1.5 : g.difficulty === 'easy' ? 0.6 : 1);
          if (this.target === p) { p.damage(Math.round(dmg), 'mob', this.pos); g.entities.alertPets(this); }
          else this.target.damage?.(dmg, 'mob', this);
          if (this.type === 'golem') this.target.impulse?.(new THREE.Vector3(0, 12, 0));
          this.swing = 0.3;
          g.audio.play('hit', { pos: this.pos });
        }
        if (dist > 40) this.target = null;
      }
    } else if (this.moveTarget) {
      want = this.moveTarget;
      if (Math.hypot(want.x - this.pos.x, want.z - this.pos.z) < 1) { this.moveTarget = null; want = null; }
    }
    if (this.lookAtPlayer > 0) { this.lookAtPlayer -= dt; want = null; }

    // Steering.
    let moving = 0;
    if (want) {
      const dx = want.x - this.pos.x, dz = want.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) {
        const tx = (dx / d) * speed, tz = (dz / d) * speed;
        // Passive creatures refuse to walk off cliffs.
        if (!this.hostile && !this.target && this.onGround) {
          const ax = Math.floor(this.pos.x + (dx / d) * (this.box.hw + 0.6)), az = Math.floor(this.pos.z + (dz / d) * (this.box.hw + 0.6));
          let drop = 0;
          for (let k = 0; k < 4; k++) { const id = g.world.getBlock(ax, Math.floor(this.pos.y) - 1 - k, az); if (id > 0 && (SOLID[id] || LIQUID[id] === 1)) break; drop++; }
          const lava = LIQUID[g.world.getBlock(ax, Math.floor(this.pos.y) - 1, az)] === 2 || LIQUID[g.world.getBlock(ax, Math.floor(this.pos.y), az)] === 2;
          if (drop >= 3 || lava) { this.moveTarget = null; want = null; }
        }
        if (want) {
          const k = Math.min(1, dt * 8);
          this.vel.x += (tx - this.vel.x) * k;
          this.vel.z += (tz - this.vel.z) * k;
          moving = speed;
          const ty = Math.atan2(dx, dz);
          let dy = ty - this.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          this.yaw += dy * Math.min(1, dt * 8);
          if (this.wall && this.onGround) this.vel.y = 8.4 * Math.sqrt(g.gravity / 28);
          if (this.wall && def.climbs) this.vel.y = 3.5;
          if (this.inWater) this.vel.y = Math.max(this.vel.y, 2.5);
        }
      }
    }
    if (!moving && this.onGround) { this.vel.x *= 1 - Math.min(1, dt * 10); this.vel.z *= 1 - Math.min(1, dt * 10); }
    if (this.lookAtPlayer > 0 || (this.type === 'villager' && p.position.distanceTo(this.pos) < 4)) {
      const pp = p.position;
      const ty = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
      let dy = ty - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.yaw += dy * Math.min(1, dt * 5);
    }
    if (def.flutter && !this.onGround && this.vel.y < -2) this.vel.y = -2;

    this.physics(dt);

    // Daylight burning.
    if (def.burns && g.sky.daylight > 0.7 && g.weather.type === 'clear' && !this.inWater) {
      const top = g.world.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z), true);
      if (top < this.pos.y + this.height) this.burning = Math.max(this.burning, 2);
    }
    if (this.inLava) this.burning = 6;
    const feet = g.world.getBlock(this.pos.x, this.pos.y + 0.2, this.pos.z);
    if (feet === B.fire) this.burning = Math.max(this.burning, 4);
    if (this.inWater) this.burning = 0;
    if (this.burning > 0) {
      this.burning -= dt;
      this.burnTick = (this.burnTick ?? 0) + dt;
      if (this.burnTick > 0.8) { this.burnTick = 0; this.damage(this.inLava ? 4 : 1, 'fire'); }
      if (Math.random() < 0.5) g.particles.fire(this.pos.x, this.pos.y + Math.random() * this.height * this.scale, this.pos.z, 0.8 * this.scale);
    }

    // Sounds.
    this.soundTimer -= dt;
    if (this.soundTimer <= 0) {
      this.soundTimer = 6 + Math.random() * 14;
      if (this.def.sound !== 'fuse' && this.def.sound !== 'hit') g.audio.play(this.def.sound, { pos: this.pos, gain: 0.7 });
    }

    // Despawn far monsters.
    if (this.hostile && !this.name && this.pos.distanceTo(p.position) > 100) this.remove();

    this.animate(dt, moving ? Math.hypot(this.vel.x, this.vel.z) : 0);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    if (this.type === 'bomber') {
      const swell = this.fuse > 0 ? 1 + this.fuse * 0.15 + Math.sin(this.fuse * 30) * 0.03 : 1;
      this.model.root.scale.setScalar(swell);
      this.model.spark.visible = Math.sin(this.age * 20) > 0 || this.fuse > 0;
      if (this.fuse > 0 && Math.random() < 0.5) g.particles.fire(this.pos.x, this.pos.y + 1.6 * this.scale, this.pos.z, 0.3);
    }
    this.updateLook(dt);
    if (this.fuse > 0 && Math.sin(this.fuse * 25) > 0) for (const m of this.mats) m.mat.color.lerp(new THREE.Color(1, 1, 1), 0.6);
    if (this.charged) for (const m of this.mats) m.mat.color.lerp(new THREE.Color(0.5, 0.7, 1), 0.25);
  }

  // Fish wander inside water and flop about on land.
  swim(dt) {
    const g = this.game;
    const inWater = LIQUID[g.world.getBlock(this.pos.x, this.pos.y + 0.2, this.pos.z)] === 1;
    this.think -= dt;
    if (inWater) {
      if (this.think <= 0 || !this.moveTarget) {
        this.think = 1 + Math.random() * 3;
        this.moveTarget = new THREE.Vector3(this.pos.x + (Math.random() - 0.5) * 8, this.pos.y + (Math.random() - 0.5) * 3, this.pos.z + (Math.random() - 0.5) * 8);
        if (this.state === 'flee') this.state = 'idle';
      }
      const d = tmp.subVectors(this.moveTarget, this.pos);
      const len = d.length();
      if (len > 0.3) {
        d.multiplyScalar(this.def.speed * (this.state === 'flee' ? 2 : 1) / len);
        this.vel.lerp(d, Math.min(1, dt * 2));
        this.yaw = Math.atan2(this.vel.x, this.vel.z);
      }
      // Stay submerged.
      if (LIQUID[g.world.getBlock(this.pos.x, this.pos.y + this.vel.y * dt + 0.4, this.pos.z)] !== 1) this.vel.y = Math.min(this.vel.y, 0);
      this.box.x = this.pos.x; this.box.y = this.pos.y; this.box.z = this.pos.z;
      for (const axis of [0, 1, 2]) this.moveVoxel(axis, dt);
      this.pos.set(this.box.x, this.box.y, this.box.z);
      this.air = 10;
    } else {
      this.physics(dt);
      if (this.onGround && Math.random() < 0.05) { this.vel.y = 4; this.vel.x = (Math.random() - 0.5) * 3; this.vel.z = (Math.random() - 0.5) * 3; }
      this.air = (this.air ?? 10) - dt;
      if (this.air < 0) { this.air = 1; this.damage(1, 'drown'); }
    }
    this.model.tail.rotation.y = Math.sin(this.age * (inWater ? 10 : 25)) * 0.6;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(inWater ? 0 : Math.PI / 2 * Math.sign(Math.sin(this.age * 7)), this.yaw, 0);
    this.updateLook(dt);
  }

  moveVoxel(axis, dt) {
    const v = axis === 0 ? this.vel.x : axis === 1 ? this.vel.y : this.vel.z;
    const moved = moveAxis(this.game.world, this.box, axis, v * dt);
    if (Math.abs(moved - v * dt) > 1e-6) { if (axis === 0) this.vel.x *= -0.5; else if (axis === 1) this.vel.y *= -0.5; else this.vel.z *= -0.5; this.moveTarget = null; }
  }

  animate(dt, speed) {
    const m = this.model;
    this.walkPhase += dt * speed * 3.2 / Math.max(0.5, this.scale);
    const amp = Math.min(1, speed / 2) * 0.8;
    const s = Math.sin(this.walkPhase) * amp;
    if (m.spider) {
      m.legs.forEach((l) => { l.rotation.y = Math.sin(this.walkPhase + l.userData.i) * amp * 0.5; l.rotation.z = Math.cos(this.walkPhase * 2 + l.userData.i) * amp * 0.2; });
    } else {
      m.legs.forEach((l, i) => { l.rotation.x = (i % 2 === (i < 2 ? 0 : 1) ? s : -s); });
    }
    if (m.arms.length && (this.type === 'zombie' || this.type === 'golem')) {
      const swing = this.swing > 0 ? Math.sin(this.swing * 10) * 0.8 : 0;
      this.swing = Math.max(0, (this.swing ?? 0) - dt);
      if (this.type === 'zombie') m.arms.forEach((a, i) => { a.rotation.x = -1.45 + (i ? s : -s) * 0.2 - swing; });
      else m.arms.forEach((a, i) => { a.rotation.x = (i ? s : -s) * 0.6 - swing * 1.5; });
    } else if (m.arms.length && this.type !== 'villager' && this.type !== 'skeleton') {
      m.arms.forEach((a, i) => { a.rotation.x = (i ? -s : s); });
    } else if (this.type === 'skeleton') m.arms[0].rotation.x = s;
    if (m.wings) m.wings.forEach((w, i) => { w.rotation.z = !this.onGround ? Math.sin(this.age * 40) * 0.8 * (i ? 1 : -1) : 0; });
    if (m.tail) m.tail.rotation.z = Math.sin(this.age * (this.tamed ? 12 : 3)) * 0.3;
    if (m.head && this.type !== 'bomber') {
      m.head.rotation.x = this.sitting ? -0.2 : 0;
    }
    if (this.type === 'wolf') {
      m.root.position.y = this.sitting ? -0.25 : 0;
      m.root.rotation.x = this.sitting ? -0.35 : 0;
    }
  }

  serialize() {
    return { type: this.type, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, health: this.health, scale: this.scale, tamed: this.tamed, woolColor: this.woolColor, coat: this.coat, fishColor: this.fishColor, baby: this.baby, name: this.name, sitting: this.sitting };
  }
}

export function woolBlockFor(color) {
  let best = B.wool_white, bd = Infinity;
  for (const b of BLOCKS) {
    if (!b?.key?.startsWith('wool_')) continue;
    const c = b.color;
    const d = Math.abs(((c >> 16) & 255) - ((color >> 16) & 255)) + Math.abs(((c >> 8) & 255) - ((color >> 8) & 255)) + Math.abs((c & 255) - (color & 255));
    if (d < bd) { bd = d; best = b.id; }
  }
  return best;
}
