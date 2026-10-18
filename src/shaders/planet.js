// Ray-traced planet + atmosphere for the far layer.
//
// A full-screen pass intersects each pixel's view ray with the planet sphere
// analytically (in units of planet radii, so float32 stays exact from 400 km
// orbit down to a few hundred metres) and integrates single-scattering
// Rayleigh + Mie in-scatter along the ray through an exponential atmosphere.
// Result is premultiplied: alpha = 1 where the ray hits the ground.

import { NOISE_GLSL } from './noise.js';

export const PlanetShader = {
  uniforms: {
    uCamPos: { value: null },      // camera, planet-centred, units of R
    uCamRot: { value: null },
    uTanHalf: { value: 0.7 },
    uAspect: { value: 1.7 },
    uPlanetRot: { value: null },   // inertial -> planet-fixed
    uSunDir: { value: null },
    uSunColor: { value: null },
    uKind: { value: 0 },           // 0 earth, 1 ocean, 2 ice
    uAtmoTop: { value: 0.02 },     // shell height / R
    uScaleH: { value: 0.0013 },    // density scale height / R
    uDensity: { value: 1.0 },      // relative sea-level density
    uAtmoColor: { value: null },
    uColOcean: { value: null },
    uColLand: { value: null },
    uColIce: { value: null },
    uTime: { value: 0 },
    uSunI: { value: 3.0 },
    uHide: { value: 0 },           // 0..1 fade surface (near patch covers it)
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform vec3 uCamPos, uSunDir, uSunColor, uAtmoColor, uColOcean, uColLand, uColIce;
    uniform mat3 uCamRot, uPlanetRot;
    uniform float uTanHalf, uAspect, uKind, uAtmoTop, uScaleH, uDensity, uTime, uSunI, uHide;
    varying vec2 vUv;
    ${NOISE_GLSL}

    vec2 sphere(vec3 ro, vec3 rd, float r) {
      float b = dot(ro, rd);
      float c = dot(ro, ro) - r * r;
      float h = b * b - c;
      if (h < 0.0) return vec2(1e9, -1e9);
      h = sqrt(h);
      return vec2(-b - h, -b + h);
    }

    vec3 surface(vec3 P, vec3 V, out float spec) {
      vec3 q = uPlanetRot * P;
      vec3 N = P;
      spec = 0.0;
      vec3 alb;
      if (uKind < 0.5) {
        float h = fbm6(q * 2.1 + 3.0);
        float land = smoothstep(0.11, 0.15, h);
        float lat = abs(q.y);
        float ice = smoothstep(0.78, 0.86, lat + fbm3(q * 6.0) * 0.08);
        vec3 landC = mix(uColLand, vec3(0.42, 0.36, 0.24), smoothstep(0.1, 0.35, fbm3(q * 5.0 + 9.0)) * (1.0 - lat));
        landC = mix(landC, vec3(0.3, 0.27, 0.2), smoothstep(0.2, 0.5, h));
        alb = mix(uColOcean, landC, land);
        alb = mix(alb, uColIce, ice);
        spec = (1.0 - land) * (1.0 - ice);
        float cl = smoothstep(0.22, 0.65, fbm6(q * 3.2 + vec3(uTime * 0.002, 0.0, 0.0)) + 0.1 * snoise(q * 20.0));
        alb = mix(alb, vec3(0.95), cl * 0.85);
        spec *= 1.0 - cl;
      } else if (uKind < 1.5) {
        float swell = fbm3(q * 9.0);
        float shallow = smoothstep(0.25, 0.55, fbm6(q * 1.6 + 7.0));
        alb = mix(uColOcean, uColOcean * 1.8 + vec3(0.02, 0.05, 0.04), shallow);
        alb *= 0.9 + 0.2 * swell;
        float cl = smoothstep(0.25, 0.7, fbm6(q * 2.4 + 2.0));
        alb = mix(alb, vec3(0.75, 0.78, 0.8), cl * 0.6);
        spec = 1.0 - cl * 0.8;
      } else {
        float r1 = 1.0 - abs(snoise(q * 7.0));
        float r2 = 1.0 - abs(snoise(q * 23.0 + 5.0));
        float ridges = pow(r1, 6.0) * 0.6 + pow(r2, 8.0) * 0.4;
        float plains = fbm6(q * 3.0);
        alb = mix(uColLand, uColIce, smoothstep(-0.2, 0.4, plains));
        alb = mix(alb, uColOcean * 0.7, ridges * 0.6);
        float cl = smoothstep(0.15, 0.6, fbm6(q * 2.0 + 13.0));
        alb = mix(alb, vec3(0.92, 0.95, 1.0), cl * 0.5);
        spec = 0.15;
      }
      return alb;
    }

    void main() {
      vec2 ndc = vUv * 2.0 - 1.0;
      vec3 rd = normalize(uCamRot * vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, -1.0));
      vec3 ro = uCamPos;
      vec2 tp = sphere(ro, rd, 1.0);
      float top = 1.0 + uAtmoTop;
      vec2 ta = sphere(ro, rd, top);
      bool hit = tp.x > 0.0 && tp.x < 1e8;
      if (ta.x > 1e8 && !hit) discard;
      vec3 col = vec3(0.0);
      float alpha = 0.0;
      vec3 trans = vec3(1.0);
      // in-scatter
      // Rayleigh coefficients at sea level, per planet radius (physical
      // 5.8/13.5/33.1 e-6 m^-1 scaled by R and tinted per world).
      vec3 betaR = uAtmoColor * uDensity;
      if (ta.y > 0.0 && uAtmoTop > 0.0) {
        float t0 = max(ta.x, 0.0);
        float t1 = hit ? tp.x : ta.y;
        float seg = (t1 - t0) / 10.0;
        vec3 acc = vec3(0.0);
        vec3 od = vec3(0.0);
        float cosA = dot(rd, uSunDir);
        float phaseR = 0.0596831 * (1.0 + cosA * cosA);
        float g = 0.76;
        float phaseM = 0.0795775 * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosA, 1.5);
        for (int i = 0; i < 10; i++) {
          vec3 P = ro + rd * (t0 + seg * (float(i) + 0.5));
          float r = length(P);
          float h = max(r - 1.0, 0.0);
          float dens = exp(-h / uScaleH);
          vec3 dOd = betaR * dens * seg;
          od += dOd;
          // light path to the sun: Chapman-like airmass estimate
          vec3 n = P / r;
          float mu = dot(n, uSunDir);
          float shadow = smoothstep(-0.12, 0.02, mu + 0.0 * h);
          float air = dens * uScaleH / max(mu + 0.15, 0.02);
          vec3 sunT = exp(-betaR * air * 1.2);
          acc += exp(-od) * dOd * sunT * shadow;
        }
        float mieAmt = 0.18;
        col += acc * (phaseR + phaseM * mieAmt) * uSunColor * uSunI * 1.3;
        trans = exp(-od);
      }
      if (hit) {
        vec3 P = ro + rd * tp.x;
        vec3 N = normalize(P);
        float spec;
        vec3 alb = surface(N, -rd, spec);
        float NdL = dot(N, uSunDir);
        float diff = max(NdL, 0.0);
        vec3 H = normalize(uSunDir - rd);
        float sp = pow(max(dot(N, H), 0.0), 120.0) * spec * 2.5 * step(0.0, NdL);
        vec3 lit = alb * (diff * uSunColor * uSunI * 0.9 + vec3(0.004)) + uSunColor * sp;
        // terminator warmth
        lit += alb * vec3(0.25, 0.08, 0.02) * smoothstep(0.15, 0.0, abs(NdL)) * 0.4;
        // city lights on Earth's night side
        if (uKind < 0.5) {
          vec3 q = uPlanetRot * N;
          float land = smoothstep(0.11, 0.15, fbm6(q * 2.1 + 3.0));
          float cities = smoothstep(0.55, 0.8, snoise(q * 60.0) * 0.5 + snoise(q * 15.0) * 0.5) * land;
          lit += vec3(1.0, 0.7, 0.35) * cities * 0.05 * smoothstep(0.05, -0.1, NdL);
        }
        col += lit * trans * (1.0 - uHide);
        alpha = 1.0 - uHide;
      }
      gl_FragColor = vec4(col, alpha);
    }
  `,
};
