// On foot on a planet: the same Walker physics in a uniform gravity field
// (planet g along local down; Coriolis from slow rotation is negligible),
// against the site's heightfield. Water slows you; 1.3 g shortens your
// stride and your jumps.

import { Vector3, Quaternion, Matrix4, Vector2 } from 'three';
import { Walker } from './onFoot.js';
import { buildAstronaut } from './astronaut.js';
import { settings } from '../core/settings.js';
import { G0 } from '../physics/constants.js';

const _m = new Matrix4();
const _v = new Vector3();

export class SurfacePlayer {
  constructor(game, surface) {
    this.game = game;
    this.surface = surface;
    this.walker = new Walker();
    this.walker.up.set(0, 1, 0);
    this.model = buildAstronaut();
    surface.group.add(this.model.root);
    this.firstPerson = false;
    this.flashlight = false;
    this.mouse = { x: 0, y: 0 };
    this.interactables = [];
    this.obstacles = [];  // { x, z, hx, hz, h } boxes in local coords (e.g. the Kestrel)
    this.enabled = true;
    this.stepAcc = 0;
    const g = surface.planet.surfaceG;
    this.env = {
      gravity: (p, out) => out.set(0, -g, 0),
      accel: (p, v, out) => {
        out.set(0, -g, 0);
        // water drag on the legs (quadratic) when wading
        const depth = (this.surface.waterLevel ? this.surface.waterLevel(p.x, p.z) : -1e9) - p.y;
        if (depth > 0) { const k = Math.min(1, depth / 0.6) * 1.8; out.x -= v.x * Math.abs(v.x) * k * 0.3; out.z -= v.z * Math.abs(v.z) * k * 0.3; }
        return out;
      },
      sdf: (p) => this.sdf(p),
      gradient: (p, out) => this.gradient(p, out),
      waterDrag: (p) => {
        const depth = (this.surface.waterLevel ? this.surface.waterLevel(p.x, p.z) : -1e9) - p.y;
        return depth > 0 ? Math.max(0.45, 1 - depth * 0.9) : 1;
      },
    };
  }

  spawn(x, z, facing = new Vector3(0, 0, -1)) {
    const W = this.walker;
    W.pos.set(x, this.surface.height(x, z) + 0.05, z);
    W.vel.set(0, 0, 0);
    W.forward.copy(facing).setY(0).normalize();
    W.up.set(0, 1, 0);
  }

  // A landed lander as two oriented boxes (fuselage + wings) in local
  // coords. kl: body centre, side: body +X, back: body +Z (both horizontal).
  addLander(kl, side, back) {
    const box = (c, hx, hz, y0, h) => ({ x: c.x, z: c.z, hx, hz, y0, h, ux: side.x, uz: side.z, vx: back.x, vz: back.z });
    this.obstacles.push(box(kl, 1.9, 7.7, kl.y - 1.4, kl.y + 1.45));
    this.obstacles.push(box(kl.clone().addScaledVector(back, 3.8), 4.9, 2.9, kl.y - 0.55, kl.y + 0.75));
  }

  sdf(p) {
    let d = p.y - this.surface.height(p.x, p.z);
    d *= 0.95;
    for (const o of this.obstacles) {
      let ox = p.x - o.x, oz = p.z - o.z;
      if (o.ux !== undefined) { const a = ox * o.ux + oz * o.uz, b = ox * o.vx + oz * o.vz; ox = a; oz = b; }
      const y0 = o.y0 ?? -10;
      const dx = Math.max(Math.abs(ox) - o.hx, 0), dz = Math.max(Math.abs(oz) - o.hz, 0), dy = Math.max(p.y - o.h, 0, y0 - p.y);
      let out = Math.hypot(dx, dy, dz);
      if (out === 0) out = -Math.min(o.hx - Math.abs(ox), o.hz - Math.abs(oz), o.h - p.y, p.y - y0);
      d = Math.min(d, out);
    }
    return d;
  }
  gradient(p, out) {
    const e = 0.02, q = p.clone();
    q.x += e; const a = this.sdf(q); q.x -= 2 * e; const b = this.sdf(q); q.x += e;
    q.y += e; const c = this.sdf(q); q.y -= 2 * e; const d = this.sdf(q); q.y += e;
    q.z += e; const f = this.sdf(q); q.z -= 2 * e; const h = this.sdf(q);
    out.set(a - b, c - d, f - h);
    const l = out.length();
    return l > 1e-9 ? out.multiplyScalar(1 / l) : out.set(0, 1, 0);
  }

  frame(dt, input) {
    if (!this.enabled) return;
    const sens = settings.get('mouseSensitivity');
    this.mouse.x += this.game.mouse.x * 0.0022 * sens;
    this.mouse.y += this.game.mouse.y * 0.0022 * sens * (settings.get('invertY') ? -1 : 1);
    if (input.hit('KeyV')) this.firstPerson = !this.firstPerson;
    if (input.hit('KeyF')) { this.flashlight = !this.flashlight; this.game.audio?.click(); }
    // interactables
    const p = this.walker.pos.clone().add(new Vector3(0, 1, 0));
    let best = null, bd = 1e9;
    for (const it of this.interactables) {
      if (it.enabled && !it.enabled()) continue;
      const d = it.pos.distanceTo(p);
      if (d < (it.radius || 2) && d < bd) { bd = d; best = it; }
    }
    const ui = this.game.ui;
    if (best) {
      if (best.hold) {
        if (input.key('KeyE')) best.progress = (best.progress || 0) + dt / best.hold; else best.progress = 0;
        ui.prompt('E', best.prompt + ' (hold)', Math.min(1, best.progress));
        if (best.progress >= 1) { best.progress = 0; best.action(); }
      } else {
        ui.prompt('E', best.prompt);
        if (input.hit('KeyE')) best.action();
      }
    } else ui.prompt(null);
  }

  fixedUpdate(dt, input) {
    if (!this.enabled) return;
    const W = this.walker;
    const yaw = -this.mouse.x, pitch = -this.mouse.y;
    this.mouse.x = 0; this.mouse.y = 0;
    W.pitch = Math.max(-1.4, Math.min(1.4, W.pitch + pitch));
    const mv = new Vector2(input.axis('KeyA', 'KeyD'), input.axis('KeyS', 'KeyW'));
    if (mv.lengthSq() > 1) mv.normalize();
    W.step(dt, this.env, { move: mv, run: input.key('ShiftLeft'), jump: input.hit('Space'), yaw });
    if (W.grounded && W.speed > 0.3) {
      this.stepAcc += W.speed * dt;
      if (this.stepAcc > (W.running ? 1.0 : 0.7)) {
        this.stepAcc = 0;
        const wet = this.surface.waterLevel && this.surface.waterLevel(W.pos.x, W.pos.z) > W.pos.y;
        this.game.audio?.footstep(wet ? 'water' : this.surface.planet.kind === 'ice' ? 'snow' : 'metal', 1);
        if (wet) {
          const wp = this.surface.toWorld(W.pos.x, W.pos.y + 0.3, W.pos.z, new Vector3());
          this.game.particles.spray(wp, this.game.world.surfaceVelocity(wp, new Vector3()), 4);
        }
      }
    }
  }

  visuals(dt) {
    const W = this.walker, a = this.model;
    a.root.position.copy(W.pos);
    _m.makeBasis(new Vector3().crossVectors(W.up, W.forward).normalize().negate(), W.up, W.forward.clone().negate());
    a.root.quaternion.setFromRotationMatrix(_m);
    a.animate({ mode: this.downed ? 'down' : W.speed > 0.15 ? (W.running ? 'run' : 'walk') : 'idle', speed: W.speed, dt });
    a.root.visible = (!this.firstPerson && !this.autoFP) || !!this.game.cutscene;
    a.lamp.intensity = this.flashlight ? 30 : 0;
    const gr = this.surface.planet.surfaceG / G0;
    const depth = this.surface.waterLevel ? this.surface.waterLevel(W.pos.x, W.pos.z) - W.pos.y : -1;
    this.game.ui.setCoriolis(this.game.cutscene ? '' : `${gr.toFixed(2)} g${depth > 0 ? ` · water ${(depth * 100).toFixed(0)} cm` : ''}${W.speed > 0.2 ? ` · ${W.speed.toFixed(1)} m/s` : ''}`);
  }

  updateCamera(dt, origin, camera) {
    const W = this.walker;
    const grp = this.surface.group;
    grp.updateMatrixWorld();
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(W.forward, up).normalize();
    const fwd = W.forward.clone().applyAxisAngle(right, W.pitch);
    const target = W.pos.clone().add(new Vector3(0, 1.62, 0));
    let pos;
    if (this.firstPerson) pos = target.clone().addScaledVector(fwd, 0.15);
    else {
      // over the shoulder, sphere-cast against the terrain and the landers
      const flatF = W.forward.clone().setY(0).normalize();
      const pivot = target.clone().add(new Vector3(0, -0.1, 0));
      const want = pivot.clone().addScaledVector(flatF, -2.8).add(new Vector3(0, 0.45 - Math.sin(W.pitch) * 1.2, 0)).addScaledVector(right, 0.5);
      const dir = want.clone().sub(pivot);
      const maxD = dir.length();
      dir.normalize();
      let t = 0;
      for (let i = 0; i < 40 && t < maxD; i++) {
        const dd = this.sdf(pivot.clone().addScaledVector(dir, t)) - 0.25;
        if (dd < 0.01) break;
        t += Math.max(dd, 0.03);
      }
      const free = Math.max(0, Math.min(maxD, t - 0.03));
      this.camDist = this.camDist === undefined ? free : free < this.camDist ? free : this.camDist + (free - this.camDist) * Math.min(1, dt * 2.5);
      pos = this.camDist < 0.5 ? target.clone().addScaledVector(fwd, 0.15) : pivot.clone().addScaledVector(dir, this.camDist);
      this.autoFP = this.camDist < 0.5;
    }
    _m.lookAt(pos, pos.clone().add(fwd), up);
    const q = new Quaternion().setFromRotationMatrix(_m);
    camera.position.copy(pos).applyMatrix4(grp.matrixWorld);
    camera.quaternion.copy(grp.quaternion).multiply(q);
    const fov = settings.get('fov');
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  worldPos(out = new Vector3()) { return this.surface.toWorld(this.walker.pos.x, this.walker.pos.y + 1, this.walker.pos.z, out); }

  dispose() { this.model.root.removeFromParent(); }
}
