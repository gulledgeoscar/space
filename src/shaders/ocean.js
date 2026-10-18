// Pelagia's shallow ocean: small wind waves (analytic normals), Fresnel sky
// reflection, foam, and the tidal surge - a kilometre-high travelling bulge
// displaced in the vertex shader (the same profile the physics samples).

import { NOISE_GLSL } from './noise.js';

export const OceanShader = {
  uniforms: {
    uTime: { value: 0 },
    uWaveFront: { value: -30000 }, // position of the surge front along uWaveDir (site-local, m)
    uWaveDir: { value: null },     // unit (x, z) direction the surge travels
    uWaveH: { value: 1200 },
    uWaveW: { value: 1600 },
    uSunDir: { value: null },      // local frame
    uSunColor: { value: null },
    uSkyColor: { value: null },
    uDeep: { value: null },
    uShallow: { value: null },
    uFogColor: { value: null },
    uFogDensity: { value: 0.00003 },
    uCamPos: { value: null },      // local frame
    uR: { value: 2.8e6 },
  },
  vertexShader: /* glsl */ `
    uniform float uTime, uWaveFront, uWaveH, uWaveW, uR;
    uniform vec2 uWaveDir;
    varying vec3 vLocal;
    varying float vSurge;
    float surge(vec2 p) {
      float s = uWaveFront - dot(p, uWaveDir);  // distance behind the front (>0 = inside the wave)
      // steep leading face, long trailing back
      float k = s < 0.0 ? exp(-pow(s / (uWaveW * 0.35), 2.0)) : exp(-pow(s / (uWaveW * 1.6), 2.0));
      return uWaveH * k;
    }
    void main() {
      vec3 p = position;
      float h = surge(p.xz);
      vSurge = h;
      p.y += h;
      vLocal = p;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime, uFogDensity, uWaveH;
    uniform vec3 uSunDir, uSunColor, uSkyColor, uDeep, uShallow, uFogColor, uCamPos;
    varying vec3 vLocal;
    varying float vSurge;
    ${NOISE_GLSL}
    vec3 waveNormal(vec2 p) {
      vec2 g = vec2(0.0);
      // a few travelling swell components + noise chop
      vec2 d1 = normalize(vec2(1.0, 0.3)), d2 = normalize(vec2(-0.4, 1.0)), d3 = normalize(vec2(0.7, -0.6));
      g += d1 * cos(dot(p, d1) * 0.9 + uTime * 1.9) * 0.08;
      g += d2 * cos(dot(p, d2) * 1.7 + uTime * 2.6) * 0.05;
      g += d3 * cos(dot(p, d3) * 3.1 + uTime * 3.4) * 0.03;
      float e = 0.6;
      float n0 = snoise(vec3(p * 0.35, uTime * 0.4));
      g += vec2(snoise(vec3((p + vec2(e, 0.0)) * 0.35, uTime * 0.4)) - n0, snoise(vec3((p + vec2(0.0, e)) * 0.35, uTime * 0.4)) - n0) * 0.5;
      return normalize(vec3(-g.x, 1.0, -g.y));
    }
    void main() {
      vec3 V = normalize(uCamPos - vLocal);
      float dist = length(uCamPos - vLocal);
      vec3 N = waveNormal(vLocal.xz);
      // the surge's own slope
      vec3 dx = dFdx(vLocal), dy = dFdy(vLocal);
      vec3 Ns = normalize(cross(dy, dx));
      if (Ns.y < 0.0) Ns = -Ns;
      float surgeK = clamp(vSurge / max(uWaveH, 1.0), 0.0, 1.0);
      N = normalize(mix(N, Ns, smoothstep(0.02, 0.2, surgeK)));
      N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(300.0, 6000.0, dist) * 0.7));
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      vec3 R = reflect(-V, N);
      vec3 sky = mix(uSkyColor * 0.55, uSkyColor, smoothstep(-0.1, 0.5, R.y));
      float spec = pow(max(dot(R, uSunDir), 0.0), 240.0) * 8.0;
      vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 0.3, surgeK));
      water *= 0.4 + 0.6 * max(dot(N, uSunDir), 0.0);
      vec3 col = mix(water, sky, fres) + uSunColor * spec;
      // foam on the crest of the surge
      float foam = smoothstep(0.82, 0.97, surgeK) * (0.6 + 0.4 * snoise(vec3(vLocal.xz * 0.05, uTime)));
      col = mix(col, vec3(0.85, 0.9, 0.9), clamp(foam, 0.0, 1.0));
      float f = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
      col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
      gl_FragColor = vec4(col, 0.93);
    }
  `,
};
