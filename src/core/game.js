// Game: owns the renderer, world simulation, controllers, UI, audio and the
// active mission; runs the frame loop (fixed-step physics + interpolated
// rendering around a floating origin).

import {
  Vector3, Quaternion, Color, DirectionalLight, HemisphereLight, AmbientLight, PMREMGenerator,
  Line, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, Mesh, SphereGeometry,
  MeshBasicMaterial, AdditiveBlending, Group, ConeGeometry, LineDashedMaterial,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RenderPipeline } from './renderer.js';
import { Input } from './input.js';
import { settings } from './settings.js';
import { World } from './world.js';
import { FixedStepLoop } from '../physics/integrator.js';
import { PHYSICS_DT, KESTREL_DOCK_Z } from '../physics/constants.js';
import { lvlhBasis, relativeLvlh, cwPropagate, meanMotion } from '../physics/orbital.js';
import { blackbodyColor } from '../physics/atmosphere.js';
import { PLANETS } from '../physics/bodies.js';
import { Sky } from '../world/sky.js';
import { PlanetView } from '../world/planetView.js';
import { Particles } from '../world/particles.js';
import { buildKestrelModel } from '../ship/kestrelModel.js';
import { buildMeridianModel } from '../ship/meridianModel.js';
import { buildDockingPortModel } from '../ship/dockingPort.js';
import { KESTREL } from '../ship/kestrel.js';
import { PilotController } from '../player/piloting.js';

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.pipeline = new RenderPipeline(canvas);
    this.scene = this.pipeline.scene;
    this.input = new Input(canvas);
    this.world = new World();
    this.loop = new FixedStepLoop(PHYSICS_DT);
    this.sky = new Sky(this.pipeline);
    this.sky.setSystem('sol');
    this.planetView = new PlanetView(this.pipeline);
    this.planetView.setPlanet(this.world.primary);
    this.particles = new Particles(this.scene);
    this.listeners = new Map();
    this.renderAlpha = 0;
    this.warp = 1;
    this.warpLevels = [1, 2, 5, 10, 25, 50];
    this.paused = false;
    this.mode = 'title';       // title | flight | interior | surface | cutscene
    this.mouse = { x: 0, y: 0, wheel: 0 };
    this.shake = 0;
    this.fx = { redout: 0, greyout: 0, damage: 0, fade: 0 };
    this.mission = null;
    this.ui = null; this.audio = null;
    this.debug = false;
    this.mapOpen = false;
    this.cutscene = null;

    this.setupLights();
    this.setupModels();
    this.pilot = new PilotController(this);
    this.controller = this.pilot;
    this.setupTrajectory();
    this.pipeline.onResize((w, h) => this.particles.setScale(h * this.pipeline.pixelRatio, this.pipeline.camera.fov));
    this.particles.setScale(window.innerHeight * this.pipeline.pixelRatio, 70);
    this._last = performance.now();
    this.fps = 60;
  }

  on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); return () => this.listeners.get(type).delete(fn); }
  emit(type, data) { for (const fn of this.listeners.get(type) || []) fn(data); }

  setupLights() {
    const sun = new DirectionalLight(0xffffff, 3.2);
    sun.castShadow = true;
    const q = settings.quality;
    sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
    const c = sun.shadow.camera;
    c.left = -30; c.right = 30; c.top = 30; c.bottom = -30; c.near = 1; c.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    this.hemi = new HemisphereLight(0x6f86a8, 0x221a14, 0.05);
    this.scene.add(this.hemi);
    this.ambient = new AmbientLight(0xffffff, 0.02);
    this.scene.add(this.ambient);
    const pm = new PMREMGenerator(this.pipeline.renderer);
    this.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.12;
    this.pipeline.onQuality((qq) => { sun.shadow.mapSize.set(qq.shadowSize, qq.shadowSize); sun.shadow.map?.dispose(); sun.shadow.map = null; });
  }

  setupModels() {
    this.kestrelModel = buildKestrelModel();
    this.scene.add(this.kestrelModel.root);
    this.meridianModel = buildMeridianModel();
    this.portModel = buildDockingPortModel();
    this.meridianModel.root.add(this.portModel.root);
    this.scene.add(this.meridianModel.root);
    this.wrenModel = null;
  }

  setupTrajectory() {
    const n = 160;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.traj = new Line(g, new LineBasicMaterial({ color: new Color(0.3, 1.6, 2.4), transparent: true, opacity: 0.85, depthWrite: false }));
    this.traj.frustumCulled = false;
    this.traj.visible = false;
    this.trajPoints = n;
    this.scene.add(this.traj);
    this.caMarker = new Mesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: new Color(2.5, 0.8, 0.2), transparent: true, opacity: 0.8, depthWrite: false }));
    this.caMarker.visible = false;
    this.scene.add(this.caMarker);
    this.trajTimer = 0;
    this.trajData = null;
    // approach corridor cone (10 deg half-angle, 200 m)
    const cone = new Mesh(new ConeGeometry(Math.tan(10 * Math.PI / 180) * 200, 200, 32, 1, true),
      new MeshBasicMaterial({ color: new Color(0.2, 0.9, 0.5), wireframe: true, transparent: true, opacity: 0.08, depthWrite: false }));
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = 5.25 + 100;
    this.corridor = cone;
    this.meridianModel.root.add(cone);
  }

  // ---- interpolation helpers -------------------------------------------------
  interpBodyPos(b, out) { return out.lerpVectors(b.prevPos, b.pos, this.renderAlpha); }
  interpBodyQuat(b, out) { return out.slerpQuaternions(b.prevQuat, b.quat, this.renderAlpha); }
  // reference-origin (model) position of a body, interpolated, relative to origin
  modelPose(b, obj, origin) {
    const q = this.interpBodyQuat(b, _q);
    const p = this.interpBodyPos(b, _v);
    obj.quaternion.copy(q);
    obj.position.copy(b.comBody).applyQuaternion(q).negate().add(p).sub(origin);
  }

  allowedWarp() {
    const max = settings.get('maxWarp');
    let lim = max;
    const W = this.world;
    if (this.mode === 'flight') {
      if (W.meridianActive && W.docking.rel.range < 60 && W.docking.state !== 'hard') lim = 1;
      const env = W.kestrel.rho;
      if (env > 1e-4) lim = Math.min(lim, 5);
      if (W.kestrel.onGround) lim = Math.min(lim, 2);
      if (this.pilot.lastInput.t.lengthSq() > 0 || W.kestrel.cmd.throttle > 0 && W.kestrel.rho > 0) lim = Math.min(lim, 10);
    } else if (this.mode === 'interior' || this.mode === 'surface') lim = 1;
    if (this.mission?.warpLimit) lim = Math.min(lim, this.mission.warpLimit());
    return lim;
  }

  setWarp(w) {
    const lim = this.allowedWarp();
    const lv = this.warpLevels.filter((x) => x <= lim);
    this.warp = Math.max(1, Math.min(w, lv[lv.length - 1] || 1));
  }

  // ---- main loop ---------------------------------------------------------------
  start() {
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this._last) / 1000);
      this._last = now;
      this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
      try { this.frame(dt); } catch (e) { console.error(e); this.emit('error', e); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  frame(dt) {
    const input = this.input;
    const m = input.consumeMouse();
    this.mouse = m;
    this.ui?.handleGlobalKeys?.(input);
    if (!this.paused && this.mode !== 'title') {
      if (input.hit('Period')) this.setWarp(this.warpLevels[Math.min(this.warpLevels.length - 1, this.warpLevels.indexOf(this.warp) + 1)]);
      if (input.hit('Comma')) this.setWarp(this.warpLevels[Math.max(0, this.warpLevels.indexOf(this.warp) - 1)]);
      if (this.warp > this.allowedWarp()) this.setWarp(this.allowedWarp());
      this.controller?.frame?.(dt, input);
      this.mission?.frame?.(dt, input);
      const steps = this.loop.advance(dt, this.warp, (h) => {
        this.controller?.fixedUpdate?.(h, input);
        this.mission?.fixedUpdate?.(h);
        this.world.step(h);
        this.interior?.fixedUpdate?.(h);
      });
      this.renderAlpha = this.loop.alpha;
      this.simDt = steps * PHYSICS_DT;
      this.mission?.update?.(this.simDt, dt);
      this.processEvents();
    } else {
      this.simDt = 0;
      if (this.mode === 'title') this.titleUpdate?.(dt);
    }
    this.updateVisuals(dt);
    this.render(dt);
    input.endFrame();
  }

  processEvents() {
    const K = this.world.kestrel, D = this.world.docking;
    for (const e of K.events) this.emit('kestrel:' + e.type, e);
    K.events.length = 0;
    for (const e of D.events) this.emit('dock:' + e.type, e);
    D.events.length = 0;
    for (const h of this.world.debrisHits) this.emit('debrisHit', h);
    this.world.debrisHits.length = 0;
    if (this.world.wrenDocking) { for (const e of this.world.wrenDocking.events) this.emit('wren:' + e.type, e); this.world.wrenDocking.events.length = 0; }
  }

  // Focus/floating origin for this frame (absolute inertial position).
  focusOrigin(out) {
    if (this.mode === 'interior' || this.cutscene?.focus === 'station') return this.interpBodyPos(this.world.meridian.body, out);
    if (this.cutscene?.focusPos) return out.copy(this.cutscene.focusPos);
    return this.interpBodyPos(this.world.kestrel.body, out);
  }

  updateVisuals(dt) {
    const W = this.world, K = W.kestrel, S = W.meridian;
    const origin = this.focusOrigin(this.pipeline.origin);
    const km = this.kestrelModel;
    // Kestrel
    km.root.visible = W.kestrelActive;
    if (W.kestrelActive) this.modelPose(K.body, km.root, origin);
    // Meridian
    const mm = this.meridianModel;
    mm.root.visible = W.meridianActive;
    if (W.meridianActive) this.modelPose(S.body, mm.root, origin);
    if (this.wrenModel && W.wren) { this.wrenModel.root.visible = true; this.modelPose(W.wren.body, this.wrenModel.root, origin); }
    for (const e of W.extras) if (e.mesh) this.modelPose(e.body, e.mesh, origin);
    for (const d of W.debris) if (d.mesh) {
      d.mesh.position.subVectors(d.pos, origin);
      d.mesh.quaternion.setFromAxisAngle(d.spinAxis, d.spin);
    }
    if (this.simDt > 0) this.emitThrusterParticles(dt);
    this.particles.gravity.copy(W.gravityAtKestrel);
    this.particles.airVel.copy(W.surfaceVelocity(K.body.pos, _v));
    this.particles.update(this.simDt, origin);
    this.updateKestrelVisuals(dt);
    this.updatePortVisuals(dt);

    // camera
    if (this.cutscene?.camera) this.cutscene.camera(dt, origin, this.pipeline.camera);
    else this.controller?.updateCamera?.(dt, origin, this.pipeline.camera);
    // screen shake
    if (this.shake > 0.001) {
      const s = this.shake;
      this.pipeline.camera.rotateX((Math.random() - 0.5) * 0.01 * s);
      this.pipeline.camera.rotateY((Math.random() - 0.5) * 0.01 * s);
      this.pipeline.camera.rotateZ((Math.random() - 0.5) * 0.006 * s);
      this.shake *= Math.exp(-dt * 3.5);
    }
    // sun & shadow follow the focus
    const sunDir = this.sky.lightDir;
    this.sun.position.copy(sunDir).multiplyScalar(150).add(this.shadowFocus());
    this.sun.target.position.copy(this.shadowFocus());
    this.sun.target.updateMatrixWorld();
    this.updateTrajectory(dt);
    this.mission?.visuals?.(dt, origin);
    this.interior?.visuals?.(dt, origin);
  }

  shadowFocus() {
    const cam = this.pipeline.camera;
    if (this.mode === 'flight' && this.pilot.camMode === 'chase') return _w.set(0, 0, 0);
    return _w.copy(cam.position);
  }

  emitThrusterParticles(dt) {
    const W = this.world, K = W.kestrel;
    if (!W.kestrelActive || K.body.frozen) return;
    const b = K.body;
    const coarse = K.rcsMode === 'coarse';
    for (const th of K.thrusters) {
      if (th.level <= 0.02) continue;
      const rate = (coarse ? 55 : 30) * th.level * this.simDt;
      let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
      if (n <= 0) continue;
      const p = b.bodyToWorld(_v.copy(th.pos).addScaledVector(th.dir, -0.15), new Vector3());
      const dir = b.dirToWorld(_w.copy(th.dir).negate(), new Vector3());
      const bv = b.velocityAt(p, new Vector3());
      while (n-- > 0) this.particles.rcsPuff(p, dir, bv, th.level, coarse);
    }
    const lvl = K.booster ? K.booster.level : K.mainLevel;
    if (lvl > 0.01) {
      const atmo = Math.min(1, K.rho / 1.225);
      const z = K.booster ? 39 : 8.3;
      for (const x of K.booster ? [0] : [-0.72, 0.72]) {
        const p = b.bodyToWorld(_v.set(x, -0.05, z), new Vector3());
        const dir = b.dirToWorld(_w.set(0, 0, 1), new Vector3());
        const bv = b.velocityAt(p, new Vector3());
        this.particles.engine(p, dir, bv, lvl, atmo);
      }
    }
  }

  updateKestrelVisuals(dt) {
    const K = this.world.kestrel, km = this.kestrelModel;
    const lvl = K.mainLevel;
    km.plumeMat.opacity = Math.min(0.85, lvl * 0.9) * (0.85 + Math.random() * 0.15);
    for (const p of km.plumes) { p.visible = lvl > 0.01; p.scale.set(1, 0.6 + lvl * 0.6, 1); }
    // reentry glow from the hull thermal model
    const T = K.thermal.T;
    if (T > 750) {
      const [r, g, b] = blackbodyColor(T);
      const I = Math.min(4, ((T - 750) / 900) ** 2 * 2.5);
      km.hullMat.emissive.setRGB(r * I, g * I, b * I);
    } else km.hullMat.emissive.setRGB(0, 0, 0);
    // strobe
    this._strobe = (this._strobe || 0) + dt;
    km.strobe.visible = (this._strobe % 1.4) < 0.08;
    // gear
    for (const l of km.legs) {
      l.leg.visible = K.gearDown;
      const st = K.gearState.find((g) => g.id === l.def.id);
      l.leg.position.y = l.def.pos[1] + (st ? st.compression * 0.7 : 0);
    }
    // cockpit visibility: interior shown in cockpit cam / interior mode
    const inCockpit = (this.mode === 'flight' && this.pilot.camMode === 'cockpit') || this.mode === 'interior';
    km.cockpit.group.visible = inCockpit;
    km.hull.visible = !(this.mode === 'flight' && this.pilot.camMode === 'cockpit');
    km.canopy.visible = km.hull.visible;
    km.canopyWindows.visible = km.hull.visible;
    km.cockpit.cabinLight.intensity = inCockpit ? 0.6 : 0;
  }

  updatePortVisuals(dt) {
    const D = this.world.docking, pm = this.portModel, mm = this.meridianModel;
    this._portT = (this._portT || 0) + dt;
    const t = this._portT;
    const r = D.rel;
    const near = this.world.meridianActive && r.range < 600;
    let mat = pm.lightMats.amber;
    if (D.state !== 'free') mat = pm.lightMats.green;
    else if (r.range < 15 && r.pos.z > 0) mat = r.envelope ? pm.lightMats.green : (r.closing > settings.difficulty.closing * 2 ? pm.lightMats.red : pm.lightMats.amber);
    const chase = Math.floor(t * 10) % 16;
    for (const g of pm.guide) {
      if (D.state === 'hard') { g.mesh.material = pm.lightMats.green; continue; }
      const on = g.ring === 0 ? ((g.i - chase + 16) % 16) < 3 : ((chase - g.i + 16) % 16) < 2;
      g.mesh.material = on && near ? mat : pm.lightMats.off;
    }
    // latch hooks
    pm.hooks.forEach((h, i) => {
      const closed = i < D.latched;
      const target = closed ? h.closed : h.open;
      h.hook.rotation.y += (target - h.hook.rotation.y) * Math.min(1, dt * 10);
    });
    // standoff target folds down after capture
    const fold = D.state === 'free' ? 0 : -Math.PI / 2;
    pm.post.rotation.x += (fold - pm.post.rotation.x) * Math.min(1, dt * 3);
    for (const f of pm.floods) f.intensity = near ? 180 : 0;
    mm.beacons.forEach((b) => { b.visible = (t % 2.0) < 0.12; });
    this.corridor.visible = near && D.state === 'free' && settings.difficulty.trajectory && !this.mapOpen && r.range > 4;
  }

  // Predicted relative trajectory (Clohessy-Wiltshire) drawn around the
  // station: refreshed a few times a second.
  updateTrajectory(dt) {
    const W = this.world;
    const show = this.mode === 'flight' && W.meridianActive && W.kestrelActive && W.docking.state === 'free'
      && settings.difficulty.trajectory && W.docking.rel.range < 30000;
    this.traj.visible = show;
    this.caMarker.visible = show;
    if (!show) return;
    this.trajTimer -= dt;
    const S = W.meridian.body, K = W.kestrel.body;
    if (this.trajTimer <= 0 || !this.trajData) {
      this.trajTimer = 0.15;
      const basis = lvlhBasis(S.pos, S.vel);
      const rel = relativeLvlh(K.pos, K.vel, S.pos, S.vel, basis);
      const n = meanMotion(W.primary.gm, S.pos.length());
      const range = rel.r.length();
      const speed = Math.max(0.05, rel.v.length());
      const T = Math.min(5400, Math.max(60, (range / speed) * 1.6));
      const pts = [];
      let best = { d: Infinity, t: 0, p: new Vector3() };
      const p = new Vector3();
      for (let i = 0; i < this.trajPoints; i++) {
        const t = (T * i) / (this.trajPoints - 1);
        cwPropagate(rel.r, rel.v, n, t, p);
        const off = new Vector3().addScaledVector(basis.x, p.x).addScaledVector(basis.y, p.y).addScaledVector(basis.z, p.z);
        pts.push(off);
        const d = p.length();
        if (d < best.d) best = { d, t, p: off.clone() };
      }
      this.trajData = { pts, best, T };
      W.docking.prediction = { closest: best.d, tClosest: best.t, horizon: T };
    }
    const origin = this.pipeline.origin;
    const sp = this.interpBodyPos(S, _v).sub(origin);
    const arr = this.traj.geometry.attributes.position.array;
    this.trajData.pts.forEach((o, i) => { arr[i * 3] = sp.x + o.x; arr[i * 3 + 1] = sp.y + o.y; arr[i * 3 + 2] = sp.z + o.z; });
    this.traj.geometry.attributes.position.needsUpdate = true;
    const b = this.trajData.best;
    this.caMarker.position.copy(sp).add(b.p);
    const camDist = this.caMarker.position.distanceTo(this.pipeline.camera.position);
    this.caMarker.scale.setScalar(Math.max(0.05, camDist * 0.006));
  }

  render(dt) {
    const p = this.pipeline;
    const W = this.world;
    // far camera near-plane adapts to altitude above the primary
    const alt = Math.max(1, p.camInertialPos.length() - W.primary.radius);
    p.syncFarCamera(Math.max(0.5, Math.min(alt * 0.4, 5000)));
    const env = this.skyEnv();
    this.sky.update(this.simDt, env);
    this.planetView.update(dt, W.time, this.sky.lightDir, this.sky.material.uniforms.uSunColor.value, env.hideSurface || 0);
    const u = p.post.uniforms;
    u.uRedout.value = this.fx.redout;
    u.uGreyout.value = this.fx.greyout;
    u.uDamage.value = this.fx.damage;
    u.uFade.value = this.fx.fade;
    u.uDockCam.value = this.mode === 'flight' && this.pilot.camMode === 'dock' && !this.cutscene ? 1 : 0;
    this.fx.damage *= Math.exp(-dt * 3);
    this.ui?.frame?.(dt);
    if (this.mapOpen && this.ui?.map) this.ui.map.render(dt);
    else p.render(dt);
  }

  // Sky/atmosphere parameters for the camera's location.
  skyEnv() {
    const W = this.world, p = this.pipeline;
    const pl = W.primary;
    const r = p.camInertialPos.length();
    const alt = r - pl.radius;
    let atmo = 0;
    if (pl.atmosphere && alt < pl.atmosphere.top) atmo = Math.exp(-Math.max(0, alt) / pl.atmosphere.H);
    if (this.mode === 'interior') atmo = 0;
    const up = p.camInertialPos.clone().normalize();
    const c = pl.colors.atmo;
    const env = { atmo, up, atmoColor: new Color(c[0], c[1], c[2]), starGain: 1 - Math.min(0.97, atmo * 4) };
    if (this.surface?.fog) { env.fog = this.surface.fog; env.fogColor = this.surface.fogColor; }
    if (this.surface) env.hideSurface = this.surface.hideFarSurface ? this.surface.hideFarSurface(alt) : 0;
    // ambient light from the sky when inside an atmosphere
    this.hemi.intensity = 0.05 + atmo * 1.2;
    return env;
  }
}
