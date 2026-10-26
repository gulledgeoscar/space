// Drivable vehicles. Cars and trucks use cannon's raycast vehicle; boats,
// tanks, planes and helicopters use lighter arcade physics against voxels.
import * as THREE from 'three';
import { RigidEntity, VoxelEntity, Entity } from './base.js';
import { CANNON } from '../physics/physics.js';
import { canvasTex } from './models.js';
import { moveBody, boxBlocked } from '../physics/voxelCollide.js';
import { LIQUID, SOLID } from '../world/blocks.js';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function lambert(entity, color, opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color, ...opts });
  entity.trackMaterial(m);
  return m;
}
function boxMesh(entity, w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(entity, color, opts));
  m.position.set(x, y, z);
  return m;
}
const glassMat = () => new THREE.MeshLambertMaterial({ color: 0x86b8e0, transparent: true, opacity: 0.55 });
const tireTex = () => canvasTex('tire', 16, 16, (g) => {
  g.fillStyle = '#1a1a1a'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#333'; for (let x = 0; x < 16; x += 3) g.fillRect(x, 0, 1, 16);
});

// Shared vehicle behaviour: riders, health, engine sound, wreck on death.
const VehicleMixin = (Base) => class extends Base {
  initVehicle(hp) {
    this.kind = 'vehicle';
    this.health = this.maxHealth = hp;
    this.rider = null;
    this.wrecked = false;
    this.cameraDistance = 7;
  }
  get rideable() { return !this.wrecked; }
  onMount() { this.engineSound = this.game.audio.engine(`veh${this.id}`); }
  onDismount() { this.game.audio.stopLoop(`veh${this.id}`); this.engineSound = null; }
  onHurt(amount) {
    if (this.health < this.maxHealth * 0.3 && Math.random() < 0.5) this.smoking = true;
  }
  kill(cause, source) {
    if (this.wrecked) return;
    this.wrecked = true;
    this.health = 0;
    this.game.explode(this.center, 3.5, { fire: true, breakBlocks: false });
    if (this.rider) this.game.entities.dismount(this.rider);
    for (const m of this.mats) m.base.multiplyScalar(0.25);
    this.smoking = true;
    this.wreckTime = 30;
  }
  vehicleTick(dt) {
    if (this.smoking && Math.random() < 0.3) this.game.particles.smoke(this.pos.x, this.pos.y + 1.2, this.pos.z, 0.5, 2.5);
    if (this.wrecked) {
      if (Math.random() < 0.2) this.game.particles.fire(this.pos.x, this.pos.y + 0.8, this.pos.z, 1.2);
      this.wreckTime -= dt;
      if (this.wreckTime <= 0) { this.game.particles.poof(this.pos, 0x333333, 20); this.remove(); }
    }
  }
  dispose() {
    this.game.audio.stopLoop(`veh${this.id}`);
    super.dispose();
  }
};

export class Car extends VehicleMixin(RigidEntity) {
  constructor(game, opts = {}) {
    super(game, opts.truck ? 'truck' : 'car');
    const truck = !!opts.truck;
    this.truck = truck;
    this.initVehicle(truck ? 160 : 100);
    this.color = opts.color ?? (truck ? 0x3060d0 : [0xd03030, 0x30a0d0, 0xe0c030, 0x40b040, 0xf0f0f0, 0x202020][(Math.random() * 6) | 0]);
    const W = truck ? 1.3 : 1.0, Hh = truck ? 0.5 : 0.35, L = truck ? 2.2 : 2.1;
    this.half = new CANNON.Vec3(W, Hh, L);
    const body = new CANNON.Body({ mass: truck ? 1400 : 900, angularDamping: 0.4, linearDamping: 0.05 });
    body.addShape(new CANNON.Box(this.half), new CANNON.Vec3(0, truck ? 0.4 : 0.15, 0));
    body.entity = this;
    body.allowSleep = false;
    this.body = body;
    game.physics.add(body);

    const wheelR = truck ? 0.85 : 0.42;
    this.vehicle = new CANNON.RaycastVehicle({ chassisBody: body, indexRightAxis: 0, indexUpAxis: 1, indexForwardAxis: 2 });
    const wopts = {
      radius: wheelR, directionLocal: new CANNON.Vec3(0, -1, 0), suspensionStiffness: truck ? 22 : 35,
      suspensionRestLength: truck ? 0.7 : 0.35, frictionSlip: truck ? 3 : 2.6, dampingRelaxation: 2.3, dampingCompression: 4.4,
      maxSuspensionForce: 1e6, rollInfluence: 0.02, axleLocal: new CANNON.Vec3(-1, 0, 0),
      chassisConnectionPointLocal: new CANNON.Vec3(), maxSuspensionTravel: truck ? 0.6 : 0.3,
      customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true,
    };
    const wx = W * 0.92, wz = L * 0.68, wy = truck ? -0.1 : 0;
    for (const [x, z] of [[wx, wz], [-wx, wz], [wx, -wz], [-wx, -wz]]) {
      wopts.chassisConnectionPointLocal = new CANNON.Vec3(x, wy, z);
      this.vehicle.addWheel({ ...wopts });
    }
    this.vehicle.addToWorld(game.physics.world);

    // Visuals.
    const c = this.color;
    if (truck) {
      this.mesh.add(boxMesh(this, W * 2, 0.7, L * 2, c, 0, 0.55, 0));
      this.mesh.add(boxMesh(this, W * 1.9, 0.75, L * 0.9, c, 0, 1.25, -0.1));
      const win = new THREE.Mesh(new THREE.BoxGeometry(W * 1.92, 0.5, L * 0.85), glassMat()); win.position.set(0, 1.3, -0.1); this.mesh.add(win);
      this.mesh.add(boxMesh(this, W * 2.1, 0.15, 0.2, 0x888888, 0, 0.35, L + 0.05));
      this.mesh.add(boxMesh(this, 1.6, 0.12, 0.12, 0x222222, 0, 1.68, 0.3));
    } else {
      this.mesh.add(boxMesh(this, W * 2, 0.55, L * 2, c, 0, 0.25, 0));
      this.mesh.add(boxMesh(this, W * 1.8, 0.5, L * 1.0, c, 0, 0.78, -0.25));
      const win = new THREE.Mesh(new THREE.BoxGeometry(W * 1.82, 0.38, L * 0.95), glassMat()); win.position.set(0, 0.8, -0.25); this.mesh.add(win);
      this.mesh.add(boxMesh(this, W * 2.02, 0.12, 0.1, 0x666666, 0, 0.15, L + 0.02));
      this.mesh.add(boxMesh(this, W * 2.02, 0.12, 0.1, 0x666666, 0, 0.15, -L - 0.02));
    }
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff8d0 }));
      hl.position.set(sx * W * 0.65, truck ? 0.7 : 0.35, L + 0.02);
      this.mesh.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.05), new THREE.MeshBasicMaterial({ color: 0xd02020 }));
      tl.position.set(sx * W * 0.65, truck ? 0.7 : 0.35, -L - 0.02);
      this.mesh.add(tl);
    }
    this.wheelMeshes = [];
    const tmat = new THREE.MeshLambertMaterial({ map: tireTex() });
    this.trackMaterial(tmat);
    for (let i = 0; i < 4; i++) {
      const wg = new THREE.Group();
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, truck ? 0.7 : 0.3, 16), tmat);
      tire.rotation.z = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, truck ? 0.72 : 0.32, 8), lambert(this, 0xc0c0c0));
      hub.rotation.z = Math.PI / 2;
      wg.add(tire, hub);
      game.scene.add(wg);
      this.wheelMeshes.push(wg);
    }
    this.height = truck ? 2 : 1.4;
    this.steer = 0;
    this.speedFov = 0;
    body.addEventListener('collide', (e) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      const other = e.body?.entity;
      game.physics.defer(() => {
        if (v > 12) this.damage((v - 12) * 4, 'crash');
        if (other && other.kind === 'mob' && v > 5) other.damage(v * 1.5, 'crash', this.rider ?? this);
      });
    });
  }

  place(pos, yaw) {
    this.body.position.set(pos.x, pos.y + (this.truck ? 2 : 1.2), pos.z);
    this.body.quaternion.setFromEuler(0, yaw, 0);
    this.pos.copy(pos);
  }

  seatPosition() {
    tmpV.set(-0.45 * (this.truck ? 1.2 : 1), this.truck ? 0.55 : 0.05, this.truck ? 0 : -0.25);
    const q = this.body.quaternion;
    tmpQ.set(q.x, q.y, q.z, q.w);
    tmpV.applyQuaternion(tmpQ);
    return new THREE.Vector3(this.body.position.x + tmpV.x, this.body.position.y + tmpV.y, this.body.position.z + tmpV.z);
  }

  chaseYaw() {
    tmpV.set(0, 0, 1).applyQuaternion(tmpQ.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w));
    return Math.atan2(-tmpV.x, -tmpV.z);
  }

  forwardSpeed() {
    const v = this.body.velocity;
    tmpV.set(0, 0, 1).applyQuaternion(tmpQ.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w));
    return v.x * tmpV.x + v.y * tmpV.y + v.z * tmpV.z;
  }

  drive(input, dt) {
    if (this.wrecked) return;
    const fwd = input.axis('KeyS', 'KeyW');
    const steerIn = input.axis('KeyD', 'KeyA');
    const speed = this.forwardSpeed();
    const maxF = this.truck ? 5200 : 3000;
    let engine = 0, brake = 0;
    if (fwd > 0) engine = speed < -1 ? 0 : maxF, brake = speed < -1 ? 60 : 0;
    else if (fwd < 0) engine = speed > 1 ? 0 : -maxF * 0.6, brake = speed > 1 ? 60 : 0;
    else brake = 4;
    if (input.key('Space')) { brake = 80; engine = 0; }
    if (input.key('ControlLeft')) engine *= 1.6;
    const steerMax = Math.max(0.12, 0.55 - Math.abs(speed) * 0.012);
    this.steer += (steerIn * steerMax - this.steer) * Math.min(1, dt * 6);
    for (let i = 0; i < 4; i++) {
      // cannon's raycast vehicle pushes along -forward for positive force.
      this.vehicle.applyEngineForce(i >= 2 || this.truck ? -engine : 0, i);
      this.vehicle.setBrake(brake, i);
    }
    this.vehicle.setSteeringValue(this.steer, 0);
    this.vehicle.setSteeringValue(this.steer, 1);
    // Flip back over.
    if (input.hit('KeyF')) {
      const p = this.body.position;
      const e = new THREE.Euler().setFromQuaternion(tmpQ.set(this.body.quaternion.x, this.body.quaternion.y, this.body.quaternion.z, this.body.quaternion.w), 'YXZ');
      this.body.quaternion.setFromEuler(0, e.y, 0);
      this.body.position.set(p.x, p.y + 1.5, p.z);
      this.body.velocity.set(0, 0, 0);
      this.body.angularVelocity.set(0, 0, 0);
    }
    if (input.click(0)) this.game.audio.play('note', { f: 220 });
    this.engineSound?.set(Math.min(1.5, Math.abs(speed) / 25 + Math.abs(fwd) * 0.15), 0.1);
    this.speedFov = Math.min(15, Math.abs(speed) * 0.4);
  }

  update(dt) {
    super.update(dt);
    if (this.rider == null) {
      for (let i = 0; i < 4; i++) { this.vehicle.applyEngineForce(0, i); this.vehicle.setBrake(this.wrecked ? 50 : 8, i); }
    }
    for (let i = 0; i < 4; i++) {
      this.vehicle.updateWheelTransform(i);
      const t = this.vehicle.wheelInfos[i].worldTransform;
      this.wheelMeshes[i].position.set(t.position.x, t.position.y, t.position.z);
      this.wheelMeshes[i].quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
    }
    this.vehicleTick(dt);
    this.updateLook(dt);
    if (this.body.position.y < -60) this.remove();
  }

  bounds(out = new THREE.Box3()) {
    const r = this.truck ? 2.0 : 1.6;
    out.min.set(this.pos.x - r, this.pos.y - 0.4, this.pos.z - r);
    out.max.set(this.pos.x + r, this.pos.y + (this.truck ? 1.6 : 1.0), this.pos.z + r);
    return out;
  }

  get center() { return this.pos.clone().add(new THREE.Vector3(0, 0.5, 0)); }
  setScale() { /* fixed size */ }

  dispose() {
    this.vehicle.removeFromWorld(this.game.physics.world);
    for (const w of this.wheelMeshes) {
      this.game.scene.remove(w);
      w.traverse((o) => o.geometry?.dispose());
    }
    super.dispose();
  }

  serialize() {
    if (this.wrecked) return null;
    const q = this.body.quaternion;
    return { type: this.type, x: this.pos.x, y: this.pos.y, z: this.pos.z, q: [q.x, q.y, q.z, q.w], color: this.color };
  }
}

// Voxel-collided vehicles share a yaw-only body.
class ArcadeVehicle extends VehicleMixin(VoxelEntity) {}

export class Boat extends ArcadeVehicle {
  constructor(game) {
    super(game, 'boat', 0.7, 0.6);
    this.initVehicle(40);
    const wood = 0x9a6a3a;
    this.mesh.add(boxMesh(this, 1.4, 0.15, 2.6, wood, 0, 0.1, 0));
    for (const sx of [-1, 1]) this.mesh.add(boxMesh(this, 0.12, 0.45, 2.6, 0x8a5a2a, sx * 0.7, 0.35, 0));
    this.mesh.add(boxMesh(this, 1.4, 0.45, 0.12, 0x8a5a2a, 0, 0.35, 1.3));
    this.mesh.add(boxMesh(this, 1.4, 0.45, 0.12, 0x8a5a2a, 0, 0.35, -1.3));
    this.mesh.add(boxMesh(this, 1.3, 0.08, 0.35, 0x7a4a1a, 0, 0.35, -0.2));
    this.paddles = [];
    for (const sx of [-1, 1]) {
      const pv = new THREE.Group(); pv.position.set(sx * 0.8, 0.5, 0);
      const p = boxMesh(this, 0.08, 0.08, 1.5, 0x6a4a2a); p.rotation.x = 0.3; pv.add(p);
      this.mesh.add(pv); this.paddles.push(pv);
    }
    this.speed = 0;
    this.cameraDistance = 6;
    this.height = 0.8;
  }
  seatPosition() { return new THREE.Vector3(this.pos.x, this.pos.y + 0.1, this.pos.z); }
  chaseYaw() { return this.yaw + Math.PI; }
  drive(input, dt, player) {
    const fwd = input.axis('KeyS', 'KeyW');
    const turn = input.axis('KeyD', 'KeyA');
    const inWater = this.floating;
    this.speed += fwd * (inWater ? 14 : 3) * dt;
    this.yaw += turn * dt * 1.8;
    this.paddleT = (this.paddleT ?? 0) + (Math.abs(fwd) + Math.abs(turn) > 0 ? dt * 8 : 0);
    this.engineSound?.set(0, 0);
  }
  update(dt) {
    super.update(dt);
    const g = this.game;
    // Float on water.
    const wy = Math.floor(this.pos.y + 0.3);
    const here = g.world.getBlock(this.pos.x, wy, this.pos.z);
    const above = g.world.getBlock(this.pos.x, wy + 1, this.pos.z);
    this.floating = LIQUID[here] === 1 || LIQUID[g.world.getBlock(this.pos.x, this.pos.y - 0.1, this.pos.z)] === 1;
    const max = this.floating ? 12 : 1.5;
    this.speed = Math.max(-4, Math.min(max, this.speed));
    this.speed *= 1 - Math.min(1, dt * (this.floating ? 0.4 : 4));
    this.vel.x = Math.sin(this.yaw) * this.speed;
    this.vel.z = Math.cos(this.yaw) * this.speed;
    if (this.floating) {
      const target = LIQUID[above] === 1 ? wy + 1.2 : wy + 0.8;
      this.vel.y += (target - this.pos.y) * 20 * dt;
      this.vel.y *= 0.9;
      this.gravityScale = 0;
    } else this.gravityScale = 1;
    this.physics(dt);
    if (this.wall) this.speed *= 0.5;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(Math.sin(this.age * 1.3) * 0.03, this.yaw, Math.sin(this.age * 1.7) * 0.04);
    this.paddles.forEach((p, i) => { p.rotation.x = Math.sin((this.paddleT ?? 0) + i) * 0.6; });
    if (this.floating && Math.abs(this.speed) > 3 && Math.random() < 0.5) g.particles.splash(new THREE.Vector3(this.pos.x - Math.sin(this.yaw) * 1.3, this.pos.y + 0.2, this.pos.z - Math.cos(this.yaw) * 1.3), 2);
    this.vehicleTick(dt);
    this.updateLook(dt);
  }
  serialize() { return { type: 'boat', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw }; }
}

export class Tank extends ArcadeVehicle {
  constructor(game) {
    super(game, 'tank', 1.4, 1.4);
    this.initVehicle(300);
    const green = 0x4a5a32;
    this.mesh.add(boxMesh(this, 2.6, 0.7, 3.8, green, 0, 0.75, 0));
    for (const sx of [-1, 1]) this.mesh.add(boxMesh(this, 0.6, 0.75, 4.0, 0x2a2a24, sx * 1.35, 0.4, 0));
    this.turret = new THREE.Group();
    this.turret.position.y = 1.1;
    this.turret.add(boxMesh(this, 1.6, 0.6, 1.8, 0x55663a, 0, 0.3, 0));
    this.barrel = new THREE.Group();
    this.barrel.position.set(0, 0.35, 0.8);
    this.barrel.add(boxMesh(this, 0.22, 0.22, 2.4, 0x3a4a2a, 0, 0, 1.2));
    this.turret.add(this.barrel);
    this.mesh.add(this.turret);
    this.speed = 0;
    this.stepHeight = 1.05;
    this.cameraDistance = 9;
    this.cooldown = 0;
    this.height = 2;
  }
  seatPosition() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z); }
  chaseYaw() { return this.yaw + Math.PI; }
  drive(input, dt, player) {
    const fwd = input.axis('KeyS', 'KeyW');
    const turn = input.axis('KeyD', 'KeyA');
    this.speed += fwd * 18 * dt;
    this.throttle = fwd;
    this.yaw += turn * dt * 1.2;
    // Turret follows the camera.
    this.turret.rotation.y = player.yaw + Math.PI - this.yaw;
    this.barrel.rotation.x = -Math.max(-0.15, Math.min(0.6, player.pitch + 0.15));
    this.cooldown -= dt;
    if (input.click(0) && this.cooldown <= 0) {
      this.cooldown = 1.2;
      const dir = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(this.barrel.rotation.x, this.yaw + this.turret.rotation.y, 0, 'YXZ'));
      const muzzle = new THREE.Vector3(this.pos.x, this.pos.y + 1.45, this.pos.z).addScaledVector(dir, 3.4);
      this.game.entities.spawnProjectile('shell', muzzle, dir.multiplyScalar(70), player);
      this.game.particles.muzzle(muzzle, dir.normalize());
      this.game.particles.explosion(muzzle, 0.6);
      this.game.audio.play('shotgun', { gain: 1.5 });
      this.game.shake = Math.max(this.game.shake, 0.4);
      this.speed -= 2;
    }
    this.engineSound?.set(0.3 + Math.abs(this.speed) / 8, 0.12);
  }
  update(dt) {
    super.update(dt);
    this.speed = Math.max(-5, Math.min(10, this.speed));
    if (!this.rider || !this.throttle) this.speed *= 1 - Math.min(1, dt * 2.5);
    this.throttle = 0;
    this.vel.x = Math.sin(this.yaw) * this.speed;
    this.vel.z = Math.cos(this.yaw) * this.speed;
    this.physics(dt);
    // Crush creatures under the treads.
    if (Math.abs(this.speed) > 2) for (const e of this.game.entities.list) if (e.kind === 'mob' && e.pos.distanceTo(this.pos) < 2) e.damage(20, 'crash', this.rider ?? this);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.vehicleTick(dt);
    this.updateLook(dt);
  }
  setScale() {}
  serialize() { return this.wrecked ? null : { type: 'tank', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw }; }
}

export class Helicopter extends ArcadeVehicle {
  constructor(game) {
    super(game, 'helicopter', 1.2, 2.0);
    this.initVehicle(120);
    this.usesShift = true;
    const c = 0x3a8a3a;
    this.mesh.add(boxMesh(this, 2.0, 1.6, 3.0, c, 0, 1.2, 0.3));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.9), glassMat()); glass.position.set(0, 1.45, 1.8); this.mesh.add(glass);
    this.mesh.add(boxMesh(this, 0.5, 0.5, 3.6, c, 0, 1.5, -2.8));
    this.mesh.add(boxMesh(this, 0.12, 1.2, 0.6, c, 0.25, 2.0, -4.4));
    for (const sx of [-1, 1]) this.mesh.add(boxMesh(this, 0.12, 0.12, 3.2, 0x333333, sx * 0.9, 0.06, 0.3));
    for (const sx of [-1, 1]) for (const sz of [-0.6, 1.2]) this.mesh.add(boxMesh(this, 0.08, 0.4, 0.08, 0x333333, sx * 0.9, 0.25, sz));
    this.rotor = new THREE.Group(); this.rotor.position.y = 2.2;
    this.rotor.add(boxMesh(this, 0.2, 0.2, 0.2, 0x222222, 0, -0.05, 0));
    this.rotor.add(boxMesh(this, 9, 0.05, 0.35, 0x222222));
    this.rotor.add(boxMesh(this, 0.35, 0.05, 9, 0x222222));
    this.mesh.add(this.rotor);
    this.tail = new THREE.Group(); this.tail.position.set(0.35, 2.0, -4.4);
    this.tail.add(boxMesh(this, 0.05, 1.6, 0.2, 0x222222));
    this.mesh.add(this.tail);
    this.spin = 0;
    this.lift = 0;
    this.cameraDistance = 11;
    this.cooldown = 0;
    this.tilt = new THREE.Vector2();
    this.height = 2.4;
  }
  seatPosition() {
    tmpV.set(0, 0.7, 1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return new THREE.Vector3(this.pos.x + tmpV.x, this.pos.y + tmpV.y, this.pos.z + tmpV.z);
  }
  drive(input, dt, player) {
    const up = input.axis('ShiftLeft', 'Space');
    const fwd = input.axis('KeyS', 'KeyW');
    const strafe = input.axis('KeyA', 'KeyD');
    this.yaw = player.yaw + Math.PI;
    this.spin = Math.min(1, this.spin + dt * 0.5);
    const power = this.spin;
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const ax = (sinY * fwd - cosY * strafe) * 22 * power;
    const az = (cosY * fwd + sinY * strafe) * 22 * power;
    this.vel.x += ax * dt; this.vel.z += az * dt;
    this.lift = up * 12 * power;
    this.tilt.x += (fwd * 0.25 - this.tilt.x) * Math.min(1, dt * 3);
    this.tilt.y += (strafe * 0.25 - this.tilt.y) * Math.min(1, dt * 3);
    this.cooldown -= dt;
    if (input.click(0) && this.cooldown <= 0) {
      this.cooldown = 0.6;
      const dir = new THREE.Vector3();
      player.lookDir(dir);
      const side = (this.side = -(this.side ?? 1));
      const from = new THREE.Vector3(this.pos.x + cosY * side * 1.3, this.pos.y + 0.6, this.pos.z - sinY * side * 1.3).addScaledVector(dir, 2);
      this.game.entities.spawnProjectile('rocket', from, dir.multiplyScalar(55), player);
      this.game.audio.play('rocket');
    }
    this.engineSound?.set(0.6 + Math.abs(up) * 0.3 + Math.abs(fwd) * 0.1, 0.14);
  }
  update(dt) {
    super.update(dt);
    const ridden = !!this.rider;
    if (!ridden) { this.spin = Math.max(0, this.spin - dt * 0.3); this.lift = 0; this.tilt.multiplyScalar(0.95); }
    // Hovering: rotor lift cancels gravity, controls add vertical speed.
    const hover = ridden ? this.spin : 0;
    this.gravityScale = 1 - hover;
    if (ridden) this.vel.y += (this.lift - this.vel.y) * Math.min(1, dt * 2.5);
    this.vel.x *= 1 - Math.min(1, dt * 0.9);
    this.vel.z *= 1 - Math.min(1, dt * 0.9);
    const vy = this.vel.y;
    this.physics(dt);
    if (this.onGround && vy < -14) this.damage(-vy * 2, 'crash');
    this.rotor.rotation.y += dt * this.spin * 30;
    this.tail.rotation.x += dt * this.spin * 40;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.tilt.x, this.yaw, -this.tilt.y, 'YXZ');
    this.cameraRoll = 0;
    this.vehicleTick(dt);
    this.updateLook(dt);
    if (this.spin > 0.5 && this.pos.y - this.game.world.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z)) < 6 && Math.random() < 0.3) {
      this.game.particles.normal.emit(this.pos.x + (Math.random() - 0.5) * 6, this.pos.y - 0.5, this.pos.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.5, (Math.random() - 0.5) * 6, 1, 0.4, 0.7, 0.65, 0.55, 0.3, 0.5, 0);
    }
  }
  setScale() {}
  serialize() { return this.wrecked ? null : { type: 'helicopter', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw }; }
}

export class Plane extends ArcadeVehicle {
  constructor(game) {
    super(game, 'plane', 1.0, 1.4);
    this.initVehicle(80);
    this.usesShift = true;
    const c = 0xe8e8e8, accent = 0xd03030;
    const body = new THREE.Group();
    body.add(boxMesh(this, 1.0, 1.0, 5.0, c, 0, 0, 0));
    body.add(boxMesh(this, 0.9, 0.9, 0.6, accent, 0, 0, 2.7));
    body.add(boxMesh(this, 9.0, 0.15, 1.5, c, 0, -0.1, 0.4));
    body.add(boxMesh(this, 3.2, 0.12, 0.9, c, 0, 0.1, -2.3));
    body.add(boxMesh(this, 0.12, 1.2, 0.9, accent, 0, 0.7, -2.3));
    for (const sx of [-1, 1]) body.add(boxMesh(this, 1.0, 0.16, 1.52, accent, sx * 4.0, -0.1, 0.4));
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.2), glassMat()); canopy.position.set(0, 0.7, 0.6); body.add(canopy);
    for (const sx of [-1, 1]) body.add(boxMesh(this, 0.1, 0.8, 0.1, 0x333333, sx * 0.7, -0.75, 1.0));
    body.add(boxMesh(this, 0.1, 0.5, 0.1, 0x333333, 0, -0.55, -2.2));
    this.prop = new THREE.Group(); this.prop.position.z = 3.05;
    this.prop.add(boxMesh(this, 0.15, 2.2, 0.08, 0x222222));
    body.add(this.prop);
    body.position.y = 1.0;
    this.body3 = body;
    this.mesh.add(body);
    this.quat = new THREE.Quaternion();
    this.speed = 0;
    this.throttle = 0;
    this.cameraDistance = 12;
    this.cooldown = 0;
    this.height = 2;
  }
  seatPosition() {
    tmpV.set(0, 1.1, 0.6).applyQuaternion(this.quat);
    return new THREE.Vector3(this.pos.x + tmpV.x, this.pos.y + tmpV.y, this.pos.z + tmpV.z);
  }
  drive(input, dt, player) {
    if (input.key('KeyW')) this.throttle = Math.min(1, this.throttle + dt * 0.5);
    if (input.key('KeyS') || input.key('ShiftLeft')) this.throttle = Math.max(0, this.throttle - dt * 0.6);
    // Steer toward where the camera points.
    const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(-player.pitch, player.yaw + Math.PI, 0, 'YXZ'));
    const flying = this.speed > 16;
    const rate = flying ? 1.6 : 0.8;
    const before = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    if (!flying) {
      // On the ground only the yaw follows; the nose can lift as speed builds.
      const e = new THREE.Euler().setFromQuaternion(target, 'YXZ');
      e.x = Math.max(e.x, -0.3 * Math.min(1, this.speed / 16));
      e.x = Math.min(e.x, 0);
      target.setFromEuler(e);
    }
    this.quat.slerp(target, Math.min(1, dt * rate));
    const after = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ');
    let dy = after.y - before.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.bank = THREE.MathUtils.lerp(this.bank ?? 0, Math.max(-1, Math.min(1, -dy / dt * 0.6)), Math.min(1, dt * 3));
    this.cooldown -= dt;
    if (input.mouse(0) && this.cooldown <= 0) {
      this.cooldown = 0.08;
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
      for (const sx of [-1, 1]) {
        const from = new THREE.Vector3(sx * 2.5, 1, 1.5).applyQuaternion(this.quat).add(this.pos);
        this.game.tools.hitscan(from, dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, 0)), 120, 6, player, { tracer: true });
      }
      this.game.audio.play('rifle', { gain: 0.6 });
    }
    this.engineSound?.set(0.4 + this.throttle * 0.8, 0.13);
    this.speedFov = Math.min(18, this.speed * 0.25);
  }
  update(dt) {
    super.update(dt);
    if (!this.rider) this.throttle = Math.max(0, this.throttle - dt * 0.3);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    this.speed += (this.throttle * 55 - this.speed) * dt * 0.35;
    if (fwd.y > 0) this.speed -= fwd.y * 12 * dt;
    else this.speed -= fwd.y * 8 * dt;
    this.speed = Math.max(0, this.speed);
    const lift = Math.min(1, this.speed / 18);
    this.vel.x = fwd.x * this.speed;
    this.vel.z = fwd.z * this.speed;
    const vyTarget = fwd.y * this.speed;
    if (this.onGround && vyTarget < 0) this.vel.y = Math.min(this.vel.y, 0);
    this.vel.y += (vyTarget - this.vel.y) * Math.min(1, dt * 4 * lift) - this.game.gravity * dt * (1 - lift);
    const pre = this.vel.clone();
    this.stepHeight = 0.6;
    this.gravityScale = 0;
    this.physics(dt);
    if ((this.wall && pre.length() > 14) || (this.onGround && pre.y < -16)) this.kill('crash');
    if (this.wall) this.speed *= 0.3;
    this.prop.rotation.z += dt * (5 + this.throttle * 50);
    this.mesh.position.copy(this.pos);
    const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (this.bank ?? 0) * 0.9);
    this.mesh.quaternion.copy(this.quat).multiply(roll);
    this.cameraRoll = -(this.bank ?? 0) * 0.3;
    this.vehicleTick(dt);
    this.updateLook(dt);
  }
  get yawAngle() { return new THREE.Euler().setFromQuaternion(this.quat, 'YXZ').y; }
  place(pos, yaw) { this.pos.copy(pos); this.quat.setFromEuler(new THREE.Euler(0, yaw, 0)); }
  setScale() {}
  serialize() { return this.wrecked ? null : { type: 'plane', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yawAngle }; }
}

export { SOLID, boxBlocked, moveBody, Entity };
