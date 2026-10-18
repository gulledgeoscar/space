// The sky: a procedurally generated star/nebula cubemap (thousands of point
// stars + galactic band), and a per-frame full-screen pass that renders it
// through the black-hole lensing shader into a scaled render target which the
// far layer uses as its background.

import {
  WebGLCubeRenderTarget, CubeCamera, Scene, Points, BufferGeometry, Float32BufferAttribute,
  ShaderMaterial, Mesh, SphereGeometry, BackSide, AdditiveBlending, WebGLRenderTarget,
  HalfFloatType, LinearFilter, LinearMipmapLinearFilter, OrthographicCamera, PlaneGeometry,
  Vector3, Matrix3, Color, Quaternion,
} from 'three';
import { SkyShader, StarPointShader, NebulaShader } from '../shaders/blackhole.js';
import { blackbodyColor } from '../physics/atmosphere.js';
import { settings } from '../core/settings.js';

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYSTEMS = {
  sol: { seed: 7, tint1: new Color(0.35, 0.42, 0.7), tint2: new Color(0.85, 0.65, 0.5), gain: 0.9 },
  lethe: { seed: 31, tint1: new Color(0.55, 0.32, 0.25), tint2: new Color(0.35, 0.5, 0.85), gain: 1.3 },
};

export class Sky {
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.renderer = pipeline.renderer;
    this.system = null;
    this.cubeSize = settings.quality.cube;
    this.cubeRT = null;

    this.material = new ShaderMaterial({
      uniforms: SkyShader.uniforms,
      vertexShader: SkyShader.vertexShader,
      fragmentShader: SkyShader.fragmentShader,
      depthWrite: false, depthTest: false,
    });
    const u = this.material.uniforms;
    u.uCamRot.value = new Matrix3();
    u.uInertialToBH.value = new Matrix3();
    u.uCamBH.value = new Vector3(0, 3, 30);
    u.uSunDir.value = new Vector3(1, 0.2, 0).normalize();
    u.uSunColor.value = new Color(1.0, 0.96, 0.9);
    u.uUp.value = new Vector3(0, 1, 0);
    u.uAtmoColor.value = new Color(0.35, 0.6, 1.0);
    u.uFogColor.value = new Color(0.6, 0.65, 0.7);
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new Scene();
    this.scene.add(this.quad);
    this.cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.rt = new WebGLRenderTarget(4, 4, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    pipeline.farScene.background = this.rt.texture;
    this.bhDir = new Vector3(0, 0, -1);  // inertial direction to Lethe
    this.bhNormal = new Vector3(0, 1, 0);
    this.bhDistance = 40;
    this.bhInclination = 0.12;
    this.lightDir = new Vector3(1, 0.3, 0.2).normalize(); // direction light comes FROM (towards source)
    pipeline.onResize(() => this.resize());
    pipeline.onQuality(() => this.resize());
    this.resize();
    pipeline.beforeRender.push((r) => this.render(r));
  }

  resize() {
    const s = settings.quality.skyScale;
    const { x, y } = this.pipeline.size;
    const pr = this.pipeline.pixelRatio;
    this.rt.setSize(Math.max(64, Math.floor(x * pr * s)), Math.max(64, Math.floor(y * pr * s)));
    this.material.uniforms.uSteps.value = settings.quality.bhSteps;
  }

  setSystem(id) {
    if (this.system === id) return;
    this.system = id;
    const def = SYSTEMS[id];
    this.buildCube(def);
    const u = this.material.uniforms;
    u.uBH.value = id === 'lethe' ? 1 : 0;
    u.uSunOn.value = id === 'sol' ? 1 : 0;
    if (id === 'sol') {
      this.lightDir.set(0.75, 0.25, 0.6).normalize();
      u.uSunDir.value.copy(this.lightDir);
      u.uSunColor.value.setRGB(1.0, 0.96, 0.9);
    } else {
      this.setBlackHole(this.bhDir, this.bhDistance, this.bhInclination);
      u.uSunColor.value.setRGB(1.0, 0.78, 0.55);
    }
  }

  // Place Lethe in the sky: dir = inertial unit vector toward the hole,
  // distanceM = visual distance in units of M, inc = camera elevation above
  // the disk plane (radians).
  setBlackHole(dir, distanceM = 40, inc = 0.12, normalHint = new Vector3(0, 1, 0)) {
    this.bhDir.copy(dir).normalize();
    this.bhDistance = distanceM;
    this.bhInclination = inc;
    const f = this.bhDir;
    const k = normalHint.clone().addScaledVector(f, -normalHint.dot(f)).normalize();
    const c = Math.cos(inc), s = Math.sin(inc);
    const Yi = k.clone().multiplyScalar(c).addScaledVector(f, -s);
    const Zi = f.clone().multiplyScalar(-c).addScaledVector(k, -s);
    const Xi = new Vector3().crossVectors(Yi, Zi);
    this.bhNormal.copy(Yi);
    // M (BH -> inertial) has columns Xi, Yi, Zi; we need its transpose.
    const u = this.material.uniforms;
    u.uInertialToBH.value.set(Xi.x, Xi.y, Xi.z, Yi.x, Yi.y, Yi.z, Zi.x, Zi.y, Zi.z);
    u.uCamBH.value.set(0, s * distanceM, c * distanceM);
    this.lightDir.copy(f);
    u.uSunDir.value.copy(f);
  }

  buildCube(def) {
    if (this.cubeRT) this.cubeRT.dispose();
    const size = this.cubeSize;
    this.cubeRT = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    const scene = new Scene();
    const rand = mulberry(def.seed);
    const gn = new Vector3(0.35, 0.8, 0.48).normalize();
    const t1 = new Vector3().crossVectors(gn, new Vector3(1, 0, 0)).normalize();
    const t2 = new Vector3().crossVectors(gn, t1);
    const N = settings.get('quality') === 'high' ? 16000 : 10000;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size1 = new Float32Array(N);
    const pxScale = size / 1024;
    const v = new Vector3();
    for (let i = 0; i < N; i++) {
      if (rand() < 0.5) {
        // concentrated toward the galactic plane
        const a = rand() * Math.PI * 2;
        const lat = (rand() + rand() + rand() - 1.5) * 0.22;
        v.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).addScaledVector(gn, lat).normalize();
      } else {
        const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
        v.set(r * Math.cos(a), z, r * Math.sin(a));
      }
      pos[i * 3] = v.x * 900; pos[i * 3 + 1] = v.y * 900; pos[i * 3 + 2] = v.z * 900;
      const m = Math.pow(rand(), 5.5);           // most stars faint, a few bright
      const T = 2800 + Math.pow(rand(), 1.6) * 11000;
      const [r, g, b] = blackbodyColor(T);
      const lum = 0.045 + m * 1.7;
      col[i * 3] = r * lum; col[i * 3 + 1] = g * lum; col[i * 3 + 2] = b * lum;
      size1[i] = (1.1 + m * 3.6) * pxScale;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new Float32BufferAttribute(col, 3));
    geo.setAttribute('size', new Float32BufferAttribute(size1, 1));
    const stars = new Points(geo, new ShaderMaterial({
      vertexShader: StarPointShader.vertexShader, fragmentShader: StarPointShader.fragmentShader,
      blending: AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    }));
    const nebMat = new ShaderMaterial({
      uniforms: {
        uTint1: { value: def.tint1 }, uTint2: { value: def.tint2 }, uGain: { value: def.gain }, uSeed: { value: def.seed * 0.37 },
      },
      vertexShader: NebulaShader.vertexShader, fragmentShader: NebulaShader.fragmentShader,
      side: BackSide, depthWrite: false,
    });
    const neb = new Mesh(new SphereGeometry(950, 64, 32), nebMat);
    neb.renderOrder = -1;
    scene.add(neb, stars);
    const cc = new CubeCamera(1, 2000, this.cubeRT);
    const prevTarget = this.renderer.getRenderTarget();
    cc.update(this.renderer, scene);
    this.renderer.setRenderTarget(prevTarget);
    geo.dispose(); stars.material.dispose(); neb.geometry.dispose(); nebMat.dispose();
    this.material.uniforms.uStars.value = this.cubeRT.texture;
  }

  // env: { atmo (0..1), up (inertial Vector3), atmoColor (Color), starGain, fog, fogColor }
  update(dt, env = {}) {
    const p = this.pipeline;
    const u = this.material.uniforms;
    u.uTime.value += dt;
    const m = new Matrix3().setFromMatrix4(p.farCamera.matrixWorld);
    u.uCamRot.value.copy(m);
    u.uTanHalf.value = Math.tan((p.camera.fov * Math.PI) / 360);
    u.uAspect.value = p.camera.aspect;
    u.uAtmo.value = env.atmo ?? 0;
    if (env.up) u.uUp.value.copy(env.up);
    if (env.atmoColor) u.uAtmoColor.value.copy(env.atmoColor);
    u.uStarGain.value = env.starGain ?? 1;
    u.uFog.value = env.fog ?? 0;
    if (env.fogColor) u.uFogColor.value.copy(env.fogColor);
  }

  render(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }
}
