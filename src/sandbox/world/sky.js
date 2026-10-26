// Sky dome with a day/night gradient, sun, moon, stars and blocky clouds.
import * as THREE from 'three';

const C = (r, g, b) => new THREE.Color(r, g, b);
const PALETTE = {
  dayZenith: C(0.30, 0.52, 0.95), dayHorizon: C(0.68, 0.80, 0.98),
  setZenith: C(0.22, 0.26, 0.50), setHorizon: C(1.0, 0.52, 0.28),
  nightZenith: C(0.008, 0.012, 0.035), nightHorizon: C(0.03, 0.045, 0.09),
  stormZenith: C(0.30, 0.32, 0.36), stormHorizon: C(0.45, 0.47, 0.5),
};

const skyVertex = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const skyFragment = /* glsl */`
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunDir;
  uniform vec3 sunGlow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);
    float t = pow(1.0 - max(h, 0.0), 2.5);
    vec3 col = mix(zenith, horizon, t);
    if (h < 0.0) col = mix(horizon, horizon * 0.6, clamp(-h * 3.0, 0.0, 1.0));
    float s = max(dot(d, sunDir), 0.0);
    col += sunGlow * (pow(s, 8.0) * 0.5 + pow(s, 64.0) * 0.6);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const cloudVertex = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const cloudFragment = /* glsl */`
  uniform float time;
  uniform vec3 color;
  uniform float cover;
  uniform vec3 camPos;
  varying vec3 vWorld;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 p = vWorld.xz + vec2(time * 2.0, time * 0.6);
    vec2 cell = floor(p / 12.0);
    float n = vnoise(cell * 0.18) * 0.65 + vnoise(cell * 0.5) * 0.35;
    if (n < 1.0 - cover) discard;
    float dist = length(vWorld.xz - camPos.xz);
    float fade = 1.0 - smoothstep(500.0, 900.0, dist);
    vec2 f = fract(p / 12.0);
    float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    gl_FragColor = vec4(color * (0.92 + 0.08 * step(0.08, edge)), 0.82 * fade);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = {
      zenith: { value: PALETTE.dayZenith.clone() },
      horizon: { value: PALETTE.dayHorizon.clone() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunGlow: { value: new THREE.Color(1, 0.9, 0.7) },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    // Sun and moon are square, Minecraft style.
    const sunTex = this.discTexture('#fff6c8', '#ffd860');
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    const moonTex = this.moonTexture();
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false }));
    this.sun.renderOrder = this.moon.renderOrder = -9;
    this.group.add(this.sun, this.moon);

    // Stars.
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos.set([r * Math.cos(th) * 850, u * 850, r * Math.sin(th) * 850], i * 3);
      sizes[i] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // Clouds.
    this.cloudUniforms = {
      time: { value: 0 },
      color: { value: new THREE.Color(1, 1, 1) },
      cover: { value: 0.42 },
      camPos: { value: new THREE.Vector3() },
    };
    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({ vertexShader: cloudVertex, fragmentShader: cloudFragment, uniforms: this.cloudUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.clouds.renderOrder = 3;
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    this.daylight = 1;
    this.fogColor = new THREE.Color();
    this.sunDir = new THREE.Vector3();
    this.nightness = 0;
  }

  discTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,240,200,0.9)');
    grad.addColorStop(1, 'rgba(255,200,100,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    g.fillStyle = outer; g.fillRect(18, 18, 28, 28);
    g.fillStyle = inner; g.fillRect(22, 22, 20, 20);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  moonTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#dfe6f0'; g.fillRect(6, 6, 20, 20);
    g.fillStyle = '#b8c0cc';
    for (const [x, y, s] of [[9, 10, 4], [17, 15, 5], [12, 20, 3], [20, 8, 3]]) g.fillRect(x, y, s, s);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // hours: 0..24. storm: 0..1 overcast amount.
  update(hours, camera, storm, dt) {
    const theta = ((hours - 6) / 24) * Math.PI * 2;
    this.sunDir.set(Math.cos(theta), Math.sin(theta), 0.25).normalize();
    const elev = this.sunDir.y;
    const day = THREE.MathUtils.smoothstep(elev, -0.15, 0.25);
    const set = Math.max(0, 1 - Math.abs(elev) * 4) * (elev > -0.25 ? 1 : 0);

    const z = this.uniforms.zenith.value, h = this.uniforms.horizon.value;
    z.copy(PALETTE.nightZenith).lerp(PALETTE.dayZenith, day);
    h.copy(PALETTE.nightHorizon).lerp(PALETTE.dayHorizon, day);
    z.lerp(PALETTE.setZenith, set * 0.5);
    h.lerp(PALETTE.setHorizon, set * 0.75);
    if (storm > 0) {
      const sz = PALETTE.stormZenith.clone().multiplyScalar(0.15 + day * 0.85);
      const sh = PALETTE.stormHorizon.clone().multiplyScalar(0.15 + day * 0.85);
      z.lerp(sz, storm * 0.85); h.lerp(sh, storm * 0.85);
    }
    this.uniforms.sunDir.value.copy(this.sunDir);
    this.uniforms.sunGlow.value.setRGB(1, 0.75 + day * 0.2, 0.5 + day * 0.3).multiplyScalar((1 - storm * 0.9) * Math.max(0, Math.min(1, elev * 4 + 0.6)));

    this.daylight = (0.12 + 0.88 * day) * (1 - storm * 0.45);
    this.nightness = 1 - day;
    this.fogColor.copy(h);

    this.group.position.copy(camera.position);
    this.sun.position.copy(this.sunDir).multiplyScalar(800);
    this.sun.lookAt(camera.position);
    this.moon.position.copy(this.sunDir).multiplyScalar(-800);
    this.moon.lookAt(camera.position);
    this.sun.material.opacity = 1 - storm;
    this.moon.material.opacity = 1 - storm * 0.8;
    this.starMat.opacity = Math.max(0, (1 - day * 1.6)) * (1 - storm);
    this.stars.rotation.z = theta;

    this.cloudUniforms.time.value += dt;
    this.cloudUniforms.camPos.value.copy(camera.position);
    this.cloudUniforms.cover.value = 0.42 + storm * 0.55;
    const cc = this.cloudUniforms.color.value;
    cc.setRGB(1, 1, 1).multiplyScalar(0.03 + 0.97 * day * day).lerp(h, set * 0.3);
    if (storm) cc.multiplyScalar(1 - storm * 0.6);
    this.clouds.position.set(camera.position.x, 150, camera.position.z);
  }
}
