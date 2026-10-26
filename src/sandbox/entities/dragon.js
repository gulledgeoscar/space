// A dragon boss: circles overhead, swoops at you and breathes fireballs.
import * as THREE from 'three';
import { Entity } from './base.js';
import { box } from './models.js';

const tmp = new THREE.Vector3();

export class Dragon extends Entity {
  constructor(game) {
    super(game, 'dragon');
    this.kind = 'mob';
    this.hostile = true;
    this.health = this.maxHealth = 200;
    this.radius = 2.2;
    this.height = 2.4;
    this.name = 'Dragon';
    this.speed = 16;
    this.heading = new THREE.Vector3(1, 0, 0);
    this.state = 'circle';
    this.stateTime = 8;
    this.fireCooldown = 2;
    this.orbit = Math.random() * Math.PI * 2;
    this.roarTimer = 3;

    const c = 0x3a1a4a, belly = 0x6a3a7a;
    const root = new THREE.Group();
    const body = box(this, 2.0, 1.6, 5.0, c); body.position.y = 1.2;
    const bellyM = box(this, 1.6, 0.3, 4.4, belly); bellyM.position.y = 0.45;
    root.add(body, bellyM);
    for (let i = 0; i < 5; i++) { const spike = box(this, 0.25, 0.5, 0.4, 0x1a0a20); spike.position.set(0, 2.2, 2 - i * 1.0); root.add(spike); }
    // Neck and head.
    this.neck = new THREE.Group(); this.neck.position.set(0, 1.6, 2.5);
    const neckM = box(this, 0.9, 0.9, 2.4, c); neckM.position.z = 1.1; this.neck.add(neckM);
    this.head = new THREE.Group(); this.head.position.z = 2.4;
    const skull = box(this, 1.3, 1.0, 1.6, c); skull.position.z = 0.6;
    const snout = box(this, 1.0, 0.5, 1.2, c); snout.position.set(0, -0.1, 1.8);
    this.jaw = box(this, 0.9, 0.25, 1.4, belly); this.jaw.position.set(0, -0.55, 1.4);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff40ff });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.3), eyeMat); eye.position.set(sx * 0.66, 0.15, 0.9); this.head.add(eye);
      const horn = box(this, 0.15, 0.6, 0.15, 0xd0c8b0); horn.position.set(sx * 0.4, 0.75, 0.1); horn.rotation.x = -0.6; this.head.add(horn);
    }
    this.head.add(skull, snout, this.jaw);
    this.neck.add(this.head);
    root.add(this.neck);
    // Tail.
    this.tail = [];
    let parent = root, z = -2.5, y = 1.3;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group(); seg.position.set(0, i === 0 ? y : 0, i === 0 ? z : -1.2);
      const m = box(this, 0.9 - i * 0.14, 0.8 - i * 0.12, 1.3, c); m.position.z = -0.6;
      seg.add(m); parent.add(seg); this.tail.push(seg); parent = seg;
    }
    // Wings.
    this.wings = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(sx * 1.0, 2.0, 0.8);
      const arm = box(this, 4.0, 0.2, 0.4, c); arm.position.x = sx * 2.0;
      const membrane = box(this, 4.2, 0.08, 3.2, 0x5a2a6a); membrane.position.set(sx * 2.4, -0.05, -1.4);
      const tip = new THREE.Group(); tip.position.x = sx * 4.0;
      const arm2 = box(this, 3.5, 0.15, 0.3, c); arm2.position.x = sx * 1.75;
      const mem2 = box(this, 3.6, 0.06, 2.6, 0x5a2a6a); mem2.position.set(sx * 1.9, -0.05, -1.3);
      tip.add(arm2, mem2);
      pivot.add(arm, membrane, tip);
      pivot.userData = { side: sx, tip };
      root.add(pivot);
      this.wings.push(pivot);
    }
    root.position.y = -1.2;
    this.mesh.add(root);
    this.pickable = true;
  }

  get center() { return this.pos.clone(); }

  bounds(out = new THREE.Box3()) {
    out.min.set(this.pos.x - 2.5, this.pos.y - 1.5, this.pos.z - 2.5);
    out.max.set(this.pos.x + 2.5, this.pos.y + 1.5, this.pos.z + 2.5);
    return out;
  }

  onHurt(amount, cause, source) {
    this.game.audio.play('hit', { pos: this.pos });
    if (Math.random() < 0.3) this.roar();
    if (this.state === 'circle' && Math.random() < 0.4) { this.state = 'swoop'; this.stateTime = 4; }
  }

  roar() { this.game.audio.play('zombie', { pos: this.pos, gain: 2 }); this.game.audio.play('thunder', { pos: this.pos, gain: 0.4 }); }

  onDeath() {
    const g = this.game;
    this.roar();
    for (let i = 0; i < 6; i++) setTimeout(() => g.running && g.particles.explosion(this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 6)), 3), i * 200);
    g.audio.play('explosion', { pos: this.pos, size: 2 });
    g.particles.sparkle(this.pos, 0xff60ff, 80);
    for (let i = 0; i < 8; i++) g.entities.dropItem(this.pos, { kind: 'tool', key: 'diamond', count: 1 }, new THREE.Vector3((Math.random() - 0.5) * 8, 6, (Math.random() - 0.5) * 8));
    g.message('The dragon is defeated!', '#ff80ff');
    g.audio.play('levelup');
  }

  update(dt) {
    super.update(dt);
    const g = this.game;
    if (this.frozen) { this.updateLook(dt); return; }
    const p = g.player;
    const target = p.dead ? null : p.position.add(new THREE.Vector3(0, 1, 0));
    const ground = g.world.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z), true);
    this.stateTime -= dt;
    let goal;
    if (!target) {
      goal = this.pos.clone().add(new THREE.Vector3(Math.cos(this.age * 0.2) * 30, 0, Math.sin(this.age * 0.2) * 30));
      goal.y = Math.max(ground + 30, 90);
    } else if (this.state === 'circle') {
      this.orbit += dt * 0.35;
      goal = target.clone().add(new THREE.Vector3(Math.cos(this.orbit) * 35, 22, Math.sin(this.orbit) * 35));
      if (this.stateTime <= 0) { this.state = Math.random() < 0.5 ? 'swoop' : 'strafe'; this.stateTime = this.state === 'swoop' ? 5 : 6; }
    } else if (this.state === 'swoop') {
      goal = target.clone();
      if (this.pos.distanceTo(target) < 6 || this.stateTime <= 0) { this.state = 'climb'; this.stateTime = 3; }
    } else if (this.state === 'strafe') {
      goal = target.clone().add(new THREE.Vector3(0, 14, 0));
      this.fireCooldown -= dt * 2;
      if (this.stateTime <= 0) { this.state = 'circle'; this.stateTime = 6 + Math.random() * 6; }
    } else {
      goal = this.pos.clone().addScaledVector(this.heading, 20);
      goal.y = (target?.y ?? this.pos.y) + 28;
      if (this.stateTime <= 0) { this.state = 'circle'; this.stateTime = 6 + Math.random() * 6; }
    }
    if (goal.y < ground + 5) goal.y = ground + 5;
    // Steer.
    const want = tmp.subVectors(goal, this.pos).normalize();
    const turn = this.state === 'swoop' ? 2.2 : 1.2;
    this.heading.lerp(want, Math.min(1, dt * turn)).normalize();
    const speed = this.state === 'swoop' ? 26 : this.speed;
    this.vel.copy(this.heading).multiplyScalar(speed);
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < ground + 3) this.pos.y = ground + 3;
    // Fire.
    this.fireCooldown -= dt;
    if (target && this.fireCooldown <= 0 && this.pos.distanceTo(target) < 60 && this.state !== 'climb') {
      this.fireCooldown = this.state === 'strafe' ? 0.5 : 2.5;
      const mouth = this.pos.clone().addScaledVector(this.heading, 5).add(new THREE.Vector3(0, 0.5, 0));
      const lead = target.clone().addScaledVector(p.vel, 0.6);
      const dir = lead.sub(mouth).normalize();
      g.entities.spawnProjectile('fireball', mouth, dir.multiplyScalar(32), this);
      g.audio.play('rocket', { pos: mouth });
      this.jawOpen = 0.6;
    }
    // Ram the player on a swoop.
    if (target && this.state === 'swoop' && this.pos.distanceTo(target) < 4) {
      p.damage(6, 'mob', this.pos);
      p.knock.addScaledVector(this.heading, 14).add(new THREE.Vector3(0, 8, 0));
    }
    this.roarTimer -= dt;
    if (this.roarTimer <= 0) { this.roarTimer = 8 + Math.random() * 10; this.roar(); }

    // Animate.
    const flap = Math.sin(this.age * (this.state === 'swoop' ? 3 : 5));
    for (const w of this.wings) {
      const s = w.userData.side;
      w.rotation.z = s * (this.state === 'swoop' ? 0.15 : flap * 0.6);
      w.userData.tip.rotation.z = s * (this.state === 'swoop' ? 0.3 : flap * 0.4 + 0.1);
    }
    this.tail.forEach((t, i) => { t.rotation.y = Math.sin(this.age * 2 + i * 0.6) * 0.18; t.rotation.x = Math.sin(this.age * 1.5 + i) * 0.08; });
    this.jawOpen = Math.max(0, (this.jawOpen ?? 0) - dt);
    this.jaw.rotation.x = this.jawOpen;
    this.neck.rotation.x = -this.heading.y * 0.5;
    this.mesh.position.copy(this.pos);
    const yaw = Math.atan2(this.heading.x, this.heading.z);
    const pitch = -Math.asin(Math.max(-1, Math.min(1, this.heading.y)));
    const bank = THREE.MathUtils.clamp((yaw - (this.lastYaw ?? yaw)) / Math.max(dt, 1e-3) * -0.5, -0.8, 0.8);
    this.lastYaw = yaw;
    this.bank = THREE.MathUtils.lerp(this.bank ?? 0, Number.isFinite(bank) && Math.abs(bank) < 0.8 ? bank : 0, Math.min(1, dt * 3));
    this.mesh.rotation.set(pitch, yaw, this.bank, 'YXZ');
    this.updateLook(dt);
    this.brightness = Math.max(this.brightness, 0.6);
  }

  serialize() { return { type: 'dragon', x: this.pos.x, y: this.pos.y, z: this.pos.z, health: this.health }; }
}
