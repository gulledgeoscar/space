// Shader materials for chunk meshes: texture-array sampling, baked sky/block
// light with a live daylight factor, ambient occlusion, fog and animated
// liquids.
import * as THREE from 'three';

const vertex = /* glsl */`
  attribute vec4 uvl;
  attribute vec4 lit;
  uniform float time;
  uniform float waterLayer;
  uniform float lavaLayer;
  uniform float waveAmp;
  varying vec3 vUv;
  varying vec4 vLit;
  varying float vDist;
  varying vec3 vWorld;
  void main() {
    vec3 p = position / 16.0;
    vec4 world = modelMatrix * vec4(p, 1.0);
    float layer = uvl.z;
    vec2 uv = uvl.xy / 16.0;
    bool isWater = abs(layer - waterLayer) < 0.5;
    bool isLava = abs(layer - lavaLayer) < 0.5;
    if (isWater) {
      uv += vec2(time * 0.03, time * 0.05);
      if (fract(p.y) > 0.01 && fract(p.y) < 0.99) world.y += sin(world.x * 0.9 + time * 1.7) * cos(world.z * 0.7 + time * 1.3) * waveAmp;
    }
    if (isLava) uv += vec2(time * 0.012, time * 0.02);
    vUv = vec3(uv, layer);
    vLit = lit;
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */`
  precision highp sampler2DArray;
  uniform sampler2DArray map;
  uniform float daylight;
  uniform vec3 skyTint;
  uniform vec3 torchColor;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float alphaTest;
  uniform float opacity;
  uniform float lavaLayer;
  uniform float minLight;
  uniform float time;
  uniform vec3 flash;
  varying vec3 vUv;
  varying vec4 vLit;
  varying float vDist;
  varying vec3 vWorld;
  float curve(float l) { return pow(l, 1.7); }
  void main() {
    vec4 tex = texture(map, vUv);
    if (tex.a < alphaTest) discard;
    float sky = curve(vLit.r) * daylight;
    float blk = curve(vLit.g);
    vec3 light = max(skyTint * sky, torchColor * blk * (0.92 + 0.08 * sin(time * 9.0 + vWorld.x * 3.1 + vWorld.z * 2.3)));
    light = max(light, vec3(minLight));
    light += flash;
    bool isLava = abs(vUv.z - lavaLayer) < 0.5;
    if (isLava) light = vec3(1.0);
    vec3 col = tex.rgb * light * vLit.b * vLit.a;
    float fog = smoothstep(fogNear, fogFar, vDist);
    gl_FragColor = vec4(mix(col, fogColor, fog), tex.a * opacity);
    #include <colorspace_fragment>
  }
`;

export function createChunkMaterials(texture, waterLayer, lavaLayer) {
  const shared = {
    map: { value: texture },
    time: { value: 0 },
    daylight: { value: 1 },
    skyTint: { value: new THREE.Color(1, 1, 1) },
    torchColor: { value: new THREE.Color(1.0, 0.82, 0.55) },
    fogColor: { value: new THREE.Color(0.7, 0.8, 1) },
    fogNear: { value: 80 },
    fogFar: { value: 120 },
    waterLayer: { value: waterLayer },
    lavaLayer: { value: lavaLayer },
    waveAmp: { value: 0.04 },
    minLight: { value: 0.02 },
    flash: { value: new THREE.Color(0, 0, 0) },
  };
  const make = (opts) => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { ...shared, alphaTest: { value: opts.alphaTest }, opacity: { value: opts.opacity ?? 1 } },
    transparent: !!opts.transparent,
    depthWrite: !opts.transparent,
    side: opts.side ?? THREE.FrontSide,
  });
  return {
    uniforms: shared,
    opaque: make({ alphaTest: 0.0 }),
    cutout: make({ alphaTest: 0.5, side: THREE.DoubleSide }),
    translucent: make({ alphaTest: 0.01, transparent: true, side: THREE.DoubleSide, opacity: 1 }),
  };
}
