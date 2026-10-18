// Render pipeline.
//
// Space scenes span 12 orders of magnitude (a latch hook a few cm across, a
// planet 6,000 km away), so the frame is drawn in two layers that share one
// camera orientation:
//   1. far layer  - lensed sky (pre-rendered to a scaled target), planets and
//                   atmospheres, with a far camera whose near plane adapts
//                   to altitude;
//   2. near layer - ships, station, interiors, terrain patches; the depth
//                   buffer is cleared in between.
// Everything near is positioned relative to a floating origin (the focus
// craft or the station), so float32 GPU precision never sees 10^6 m numbers.
// Then: UnrealBloom -> PostFX (G-load, docking camera, damage) -> Output.

import {
  WebGLRenderer, Scene, PerspectiveCamera, ACESFilmicToneMapping, SRGBColorSpace,
  PCFSoftShadowMap, Vector2, Vector3, Quaternion, Color, HalfFloatType,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PostFXShader } from '../shaders/postfx.js';
import { settings } from './settings.js';

class LayeredRenderPass extends Pass {
  constructor(pipeline) {
    super();
    this.p = pipeline;
    this.needsSwap = false;
  }
  render(renderer, writeBuffer, readBuffer) {
    const p = this.p;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.setClearColor(p.debugSky ? 0xff00ff : 0x000000, 1);   // debugSky: show leaks to space in magenta
    renderer.clear(true, true, true);
    if (!p.debugSky) renderer.render(p.farScene, p.farCamera);
    renderer.clearDepth();
    if (p.nearEnabled) renderer.render(p.scene, p.camera);
    if (p.overlayScene) { renderer.clearDepth(); renderer.render(p.overlayScene, p.overlayCamera || p.camera); }
  }
}

export class RenderPipeline {
  constructor(canvas) {
    const q = settings.quality;
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.autoClear = false;

    this.scene = new Scene();                // near layer
    this.farScene = new Scene();             // far layer
    this.farScene.background = new Color(0x000000);
    this.camera = new PerspectiveCamera(settings.get('fov'), 1, 0.05, 60000);
    this.farCamera = new PerspectiveCamera(settings.get('fov'), 1, 500, 5e9);
    this.scene.add(this.camera);
    this.nearEnabled = true;
    this.overlayScene = null;

    // inertial pose of the camera (planet-centred metres), set each frame
    this.camInertialPos = new Vector3();
    this.camInertialQuat = new Quaternion();
    this.origin = new Vector3();             // floating origin in inertial frame

    this.composer = new EffectComposer(this.renderer);
    this.composer.renderTarget1.texture.type = HalfFloatType;
    this.layered = new LayeredRenderPass(this);
    this.composer.addPass(this.layered);
    this.bloom = new UnrealBloomPass(new Vector2(512, 512), 0.5, 0.45, 1.15);
    this.composer.addPass(this.bloom);
    this.post = new ShaderPass(PostFXShader);
    this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());

    this.size = new Vector2(1, 1);
    this.beforeRender = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    settings.onChange((k) => {
      if (k === 'quality') this.applyQuality();
      if (k === 'fov') { this.camera.fov = settings.get('fov'); this.camera.updateProjectionMatrix(); }
    });
  }

  applyQuality() {
    const q = settings.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    this.bloom.enabled = q.bloom;
    this.resize();
    for (const fn of this.qualityListeners || []) fn(q);
  }

  onQuality(fn) { (this.qualityListeners ||= []).push(fn); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * settings.quality.pixelRatio;
    this.pixelRatio = Math.max(0.5, Math.min(pr, 2));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.floor(w * this.pixelRatio * 0.5), Math.floor(h * this.pixelRatio * 0.5));
    this.size.set(w, h);
    for (const cam of [this.camera, this.farCamera]) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
    this.post.uniforms.uAspect.value = w / h;
    for (const fn of this.resizeListeners || []) fn(w, h);
  }

  onResize(fn) { (this.resizeListeners ||= []).push(fn); }

  // Sync the far camera to the near camera's inertial pose.
  syncFarCamera(nearPlane = 500) {
    this.camera.updateMatrixWorld(true);
    const wp = new Vector3();
    this.camera.getWorldPosition(wp);
    this.camera.getWorldQuaternion(this.camInertialQuat);
    this.camInertialPos.copy(this.origin).add(wp);
    const fc = this.farCamera;
    fc.position.copy(this.camInertialPos);
    fc.quaternion.copy(this.camInertialQuat);
    fc.fov = this.camera.fov;
    fc.aspect = this.camera.aspect;
    fc.near = nearPlane;
    fc.far = Math.max(nearPlane * 1e6, 1e9);
    fc.updateProjectionMatrix();
    fc.updateMatrixWorld(true);
  }

  render(dt) {
    for (const fn of this.beforeRender) fn(this.renderer, dt);
    this.post.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
