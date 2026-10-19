// Game: owns the renderer, world simulation, controllers, UI, audio and the
// active mission; runs the frame loop (fixed-step physics + interpolated
// rendering around a floating origin).

import { materials } from '../world/materials.js';
import {
  BoxGeometry, IcosahedronGeometry,
  Vector3, Quaternion, Color, DirectionalLight, HemisphereLight, AmbientLight, PMREMGenerator,
  Line, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, Mesh, SphereGeometry,
  MeshBasicMaterial, AdditiveBlending, Group, LineDashedMaterial, LineSegments,
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
import { PilotController, CHASE_DEFAULT } from '../player/piloting.js';
import { InteriorPlayer } from '../player/interiorPlayer.js';
import { UI } from '../ui/ui.js';
import { AudioEngine } from '../audio/audio.js';
import { MISSION_CLASSES } from '../missions/index.js';
import { G0 } from '../physics/constants.js';

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
    this.interiorPlayer = new InteriorPlayer(this);
    this.hatchOpen = false;
    this.setupTrajectory();
    this.audio = new AudioEngine();
    this.ui = new UI(this, uiRoot);
    this.pilotG = 0;
    this.alarm = false;
    this.extraWarnings = [];
    const unlockAudio = () => this.audio.init();
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
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
    // approach corridor (10 deg half-angle, 200 m): gate rings + 4 rails
    const verts = [], tan = Math.tan(10 * Math.PI / 180), seg = 48;
    for (const d of [10, 30, 60, 100, 150, 200]) {
      const rr = Math.max(0.6, d * tan), z = 5.25 + d;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
        verts.push(Math.cos(a0) * rr, Math.sin(a0) * rr, z, Math.cos(a1) * rr, Math.sin(a1) * rr, z);
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      verts.push(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 5.25 + 10 * 0.6 / (10 * tan), Math.cos(a) * 200 * tan, Math.sin(a) * 200 * tan, 205.25);
    }
    const cg = new BufferGeometry();
    cg.setAttribute('position', new Float32BufferAttribute(verts, 3));
    const cone = new LineSegments(cg, new LineBasicMaterial({ color: new Color(0.25, 0.85, 0.5), transparent: true, opacity: 0.22, depthWrite: false }));
    cone.frustumCulled = false;
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
      });
      this.renderAlpha = this.loop.alpha;
      this.simDt = steps * PHYSICS_DT;
      this.alarm = false;
      this.mission?.update?.(this.simDt, dt);
      this.processEvents();
      this.updatePilotLoad(dt);
    } else {
      this.simDt = 0;
      if (this.mode === 'title') this.titleUpdate?.(dt);
    }
    this.updateVisuals(dt);
    this.updateAudio(dt);
    this.render(dt);
    input.endFrame();
  }

  // Pilot's felt acceleration at the eye -> red-out / grey-out with a
  // physiological lag (blood takes seconds to pool).
  updatePilotLoad(dt) {
    const W = this.world, K = W.kestrel;
    let f;
    if (this.mode === 'flight' && W.kestrelActive) {
      if (K.body.frozen && W.docking.state !== 'free') {
        const S = W.meridian.body;
        const eye = K.body.bodyToWorld(_v.set(...KESTREL.eye), new Vector3());
        const r = new Vector3().subVectors(eye, S.pos);
        f = new Vector3().crossVectors(S.omega, new Vector3().crossVectors(S.omega, r));
      } else if (K.body.frozen) f = new Vector3();
      else f = K.computePilotLoad(W.gravityAtKestrel).clone();
      const up = K.body.dirToWorld(_w.set(0, 1, 0), new Vector3());
      const gz = f.dot(up) / G0;
      this.pilotG = (f.length() / G0) * (gz < 0 ? -1 : 1);
      const red = Math.min(1, Math.max(0, (-gz - 1.8) / 3.2));
      const grey = Math.min(1, Math.max(0, (gz - 4.0) / 3.5));
      this.fx.redout += (red - this.fx.redout) * Math.min(1, dt * 0.6);
      this.fx.greyout += (grey - this.fx.greyout) * Math.min(1, dt * 0.5);
      // structural vibration felt as shake
      const coarse = K.rcsMode === 'coarse';
      let rcs = 0; for (const th of K.thrusters) rcs += th.level;
      this.shake = Math.max(this.shake, (K.booster ? K.booster.level * 0.9 : K.mainLevel * 0.35) + (coarse ? rcs * 0.03 : 0) + Math.min(1.5, K.q / 30000) + Math.max(0, Math.abs(gz) - 2) * 0.12);
    } else {
      this.fx.redout *= Math.exp(-dt);
      this.fx.greyout *= Math.exp(-dt);
      this.pilotG = 0;
    }
  }

  updateAudio(dt) {
    const a = this.audio;
    if (!a.ready) return;
    const W = this.world, K = W.kestrel;
    let rcs = 0, pan = 0;
    const inFlight = this.mode === 'flight' && W.kestrelActive;
    if (inFlight && !this.paused) for (const th of K.thrusters) { rcs += th.level; pan += th.level * th.pos.x; }
    const engine = inFlight && !this.paused ? (K.booster ? K.booster.level * 1.4 : K.mainLevel) : 0;
    a.update(dt, {
      rcs, coarse: K.rcsMode === 'coarse', rcsPan: rcs > 0 ? pan / rcs / 2 : 0,
      engine, q: inFlight ? K.q : 0, airspeed: inFlight ? K.body.vel.distanceTo(W.surfaceVelocity(K.body.pos, _v)) : 0,
      hum: this.paused ? 0.2 : (this.mode === 'interior' ? 1 : inFlight ? 0.45 : 0.15) * (this.humScale ?? 1),
      water: this.waterLevel || 0,
      klaxon: !this.paused && (this.alarm || this.missionAlarm),
      caution: !this.paused && inFlight && (this.ui.hud.activeWarnings || 0) > 0,
      heart: this.heart || 0,
    });
  }

  // ---- missions ----------------------------------------------------------------
  resetWorld() {
    this.world = new World();
    this.hatchOpen = true;   // closed only while undocking; opens with equal pressure
    this.interior?.reset?.();
    this.surface?.dispose?.();
    this.surface = null;
    this.cutscene = null;
    this.particles.clear();
    this.fx.redout = this.fx.greyout = this.fx.damage = this.fx.fade = 0;
    this.warp = 1;
    this.pilot.enabled = true; this.pilot.lockControls = false; this.pilot.allowMain = true;
    this.pilot.killRot = false; this.pilot.killVel = false; this.pilot.attMode = null; this.pilot.burnTarget = null;
    this.pilot.chase = { ...CHASE_DEFAULT }; this.pilot._frame = null;
    this.ui.hud.cues.clear();
    this.ui.hud.phaseText = null; this.ui.hud.phaseSub = null;
    this.extraWarnings = [];
    this.missionAlarm = false;
    this.heart = 0;
    this.mapNode = null;
    this.mapOpen = false;
    this.ui.subs.clear();
    this.ui.setLetterbox(false);
    this.ui.prompt(null);
    this.audio.organ?.stop(1);
    this.audio.voice?.cancel();
    if (this.wrenModel) this.wrenModel.root.visible = false;
    for (const e of this.extraMeshes || []) e.parent?.remove(e);
    this.extraMeshes = [];
    // put torn-off ring modules back on the (new) Meridian
    const mm = this.meridianModel;
    for (const m of mm.modules) { if (m.parent !== mm.root) { m.removeFromParent(); mm.root.add(m); } m.position.set(0, 0, 0); m.quaternion.identity(); }
  }

  startMission(id, stage = null, restore = null, opts = {}) {
    this.mission?.dispose?.();
    if (!opts.keepWorld) this.resetWorld();
    else { this.ui.menus.clear(); this.ui.hud.cues.clear(); this.ui.hud.phaseText = null; this.ui.hud.phaseSub = null; this.mapNode = null; }
    this.ui.menus.clear();
    this.paused = false;
    const Cls = MISSION_CLASSES[id];
    this.mission = new Cls(this, stage);
    this.mission.keepWorld = !!opts.keepWorld;
    this.mission.start();
    if (restore) {
      this.world.restore(restore.world, PLANETS);
      this.mission.onRestore?.(restore.extra);
      this.mission.checkpointData = restore;
      this.mission.checkpointName = restore.name || this.mission.checkpointName;
    }
    // hold the mission on a controls card until the player is ready
    this.ui.controls.clear();
    if (!restore && !opts.noCard) this.ui.controls.show(this.mission);
    this.input.wantLock = true;
    this.input.requestLock();
  }
  restartMission(id, stage, data) { this.startMission(id, stage, data); }

  onMissionComplete(mission, results) {
    this.input.exitLock();
    setTimeout(() => this.ui.menus.results(results), results.delay ?? 1500);
  }

  setPaused(p) {
    this.paused = p;
    if (p) { this.ui.menus.pause(); this.input.exitLock(); this.audio.voice?.cancel(); }
    else { this.ui.menus.clear(); this.input.requestLock(); }
  }

  toTitle() {
    this.mission?.dispose?.();
    this.mission = null;
    this.resetWorld();
    this.paused = false;
    this.mode = 'title';
    this.titleSetup();
    this.ui.menus.title();
  }

  processEvents() {
    const K = this.world.kestrel, D = this.world.docking;
    for (const e of K.events) this.emit('kestrel:' + e.type, e);
    K.events.length = 0;
    for (const e of D.events) {
      // the hatches open once pressure is equal and close for undocking
      if (e.type === 'pressurised') this.hatchOpen = true;
      if (e.type === 'releaseStart') this.hatchOpen = false;
      this.emit('dock:' + e.type, e);
    }
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
    // overcast worlds dim the direct sun near the ground
    this.sun.intensity = 3.2 * (this.surface?.near && this.surface.sunScale ? this.surface.sunScale : 1);
    this.updateTrajectory(dt);
    this.mission?.visuals?.(dt, origin);
    this.interior?.visuals?.(dt, origin);
  }

  // ---- modes ---------------------------------------------------------------------
  enterInterior(spawn = 'bridge', opts = {}) {
    const ip = this.interiorPlayer;
    // blend only when the camera is already inside the cabin (cockpit view ->
    // floating beside the seat); anything else would sweep through the hull
    const inside = this.mode === 'flight' && this.pilot.camMode === 'cockpit' && spawn === 'seat';
    const fromCamera = opts.blend && inside ? this.cameraInStation() : null;
    if (!fromCamera && this.mode !== 'title') this.ui.flashFade();
    ip.spawn(spawn, { ...opts, fromCamera });
    this.mode = 'interior';
    this.controller = ip;
    this.mapOpen = false;
    ip.interior.group.visible = true;
    this.meridianModel.hub.visible = false;
    this.setShellShadows(false);
    this.scene.environmentIntensity = 0.1;
    this.emit('mode', 'interior');
  }

  enterFlight(cam = 'cockpit', { blend = true } = {}) {
    // blend from wherever the camera is now (walking/floating) into the cockpit
    const camNow = this.pipeline.camera;
    const kAbs = this.interpBodyPos(this.world.kestrel.body, new Vector3());
    const fromOff = camNow.position.clone().add(this.pipeline.origin).sub(kAbs);
    const fromQuat = camNow.quaternion.clone();
    const canBlend = blend && cam === 'cockpit' && this.mode === 'interior' && this.interiorPlayer.area === 'kestrel' && fromOff.length() < 6;
    if (!canBlend && this.mode !== 'title' && this.mode !== 'flight') this.ui.flashFade();
    this.mode = 'flight';
    this.controller = this.pilot;
    if (this.interiorPlayer.interior) this.interiorPlayer.interior.group.visible = false;
    this.meridianModel.hub.visible = true;
    this.setShellShadows(true);
    this.scene.environmentIntensity = 0.12;
    this.ui.setCoriolis('');
    this.ui.prompt(null);
    this.pilot.camMode = cam;
    this.pilot.transition = canBlend ? { fromOff, fromQuat, fromFov: camNow.fov, t: 0, dur: 1.3 } : null;
    this.emit('mode', 'flight');
  }

  // On foot on a planet surface (player controller supplied by the mission).
  enterSurface(player) {
    this.mode = 'surface';
    this.controller = player;
    this.mapOpen = false;
    this.scene.environmentIntensity = 0.25;
    this.ui.prompt(null);
    this.emit('mode', 'surface');
  }

  setShellShadows(on) {
    this.meridianModel.root.traverse((o) => { if (o.userData.exteriorShell) o.castShadow = on; });
  }

  // current camera pose expressed in the station body frame (for blends)
  cameraInStation() {
    const root = this.meridianModel.root;
    root.updateMatrixWorld();
    const cam = this.pipeline.camera;
    const inv = root.matrixWorld.clone().invert();
    const pos = cam.position.clone().applyMatrix4(inv);
    const quat = root.quaternion.clone().invert().multiply(cam.quaternion);
    return { pos, quat };
  }

  // Title screen: the Meridian turning slowly in front of Lethe.
  titleSetup() {
    const W = this.world;
    this.sky.setSystem('lethe');
    this.sky.setBlackHole(new Vector3(-0.35, 0.18, -1).normalize(), 26, 0.09);
    W.setPrimary(PLANETS.skadi);
    this.planetView.setPlanet(PLANETS.skadi);
    const r = PLANETS.skadi.radius + 900e3;
    W.meridian.body.pos.set(r, 0, 0);
    W.meridian.body.vel.set(0, 0, -Math.sqrt(PLANETS.skadi.gm / r));
    W.meridian.body.quat.setFromAxisAngle(new Vector3(0, 1, 0), 0.9);
    W.meridian.body.updateDerived();
    W.meridian.body.setAngularVelocity(W.meridian.axisWorld(new Vector3()).multiplyScalar(0.12));
    W.kestrelActive = false;
    this._titleT = 0;
    this.cutscene = {
      focus: 'station',
      camera: (dt, origin, cam) => {
        this._titleT += dt;
        const t = this._titleT;
        const S = W.meridian.body;
        const sp = this.interpBodyPos(S, new Vector3()).sub(origin);
        // Lethe sits behind the ring; the camera drifts slowly around it
        const bh = this.sky.bhDir;
        const side = new Vector3().crossVectors(bh, new Vector3(0, 1, 0)).normalize();
        const a = Math.sin(t * 0.03) * 0.5 + 0.35;
        const off = bh.clone().multiplyScalar(-Math.cos(a) * 125).addScaledVector(side, Math.sin(a) * 125).add(new Vector3(0, 18 + Math.sin(t * 0.05) * 6, 0));
        cam.position.copy(sp).add(off);
        cam.lookAt(sp.clone().addScaledVector(bh, 60).addScaledVector(side, -35));
        if (cam.fov !== 50) { cam.fov = 50; cam.updateProjectionMatrix(); }
      },
    };
  }

  titleUpdate(dt) {
    const W = this.world;
    this.loop.advance(dt, 1, (h) => { W.meridian.body.savePrev(); W.meridian.body.integrate(h); });
    this.renderAlpha = this.loop.alpha;
    this.simDt = dt;
  }

  // a jagged piece of hull for debris clouds
  makeDebrisMesh(size) {
    if (!this._debrisGeo) {
      this._debrisGeo = [new BoxGeometry(1, 0.15, 0.7), new BoxGeometry(0.4, 0.4, 1.2), new IcosahedronGeometry(0.5, 0), new BoxGeometry(1.4, 0.05, 1.0)];
    }
    const M = materials();
    const mats = [M.hull, M.hullDark, M.foil, M.darkMetal, M.radiator];
    const mesh = new Mesh(this._debrisGeo[Math.floor(Math.random() * this._debrisGeo.length)], mats[Math.floor(Math.random() * mats.length)]);
    mesh.scale.set(size * (0.6 + Math.random()), size * (0.6 + Math.random()), size * (0.6 + Math.random()));
    mesh.castShadow = true;
    this.scene.add(mesh);
    return mesh;
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
    km.pods.visible = km.hull.visible;
    km.canopy.visible = km.hull.visible;
    km.canopyWindows.visible = km.hull.visible && this.mode !== 'interior';
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
    for (const f of pm.floods) f.intensity = near && this.mode !== 'interior' ? 180 : 0;
    const open = D.state === 'hard' && D.pressure >= 1 && this.hatchOpen;
    pm.hatch.visible = !open;
    this.kestrelModel.noseHatch.visible = !open;
    this.kestrelModel.cockpit.innerHatch.visible = !open;
    pm.target.visible = D.state === 'free' || D.state === 'soft';
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
    // fill light: sky from above, planet-shine from below (oriented along the
    // local vertical, dimmer on the night side) so shadowed hulls aren't black
    if (this.mode === 'interior') {
      this.hemi.position.set(0, 1, 0);
      this.hemi.intensity = 0.05;
    } else {
      this.hemi.position.copy(up);
      const day = Math.max(0.15, this.sky.lightDir.dot(up) * 0.5 + 0.5);
      const near = Math.max(0, 1 - Math.max(0, alt) / (pl.radius * 4));
      this.hemi.color.setRGB(0.16 + c[0] * atmo * 0.6, 0.2 + c[1] * atmo * 0.6, 0.3 + c[2] * atmo * 0.6);
      this.hemi.groundColor.setRGB(c[0] * 0.5 + 0.08, c[1] * 0.5 + 0.08, c[2] * 0.5 + 0.08);
      this.hemi.intensity = 0.06 + atmo * 0.45 + 0.32 * near * day;
    }
    return env;
  }
}
