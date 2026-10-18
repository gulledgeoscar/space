// Sky shader: background starfield/nebula cubemap, the Sun, in-atmosphere
// scattering, and LETHE - a black hole rendered by integrating Schwarzschild
// null geodesics per pixel.
//
// Photon paths obey the Binet equation u'' + u = 3 M u^2. Integrating
//   x'' = -(3/2) r_s h^2 x / r^5     (h = |x x v|, conserved)
// in flat 3-space reproduces exactly those orbits (geometric units, M = 1,
// r_s = 2). Rays are traced backwards from the camera; every crossing of the
// equatorial plane inside the disk radii adds emission, which naturally
// produces the lensed image of the far side of the disk arching over and
// under the shadow, the thin photon ring and secondary images. Rays that
// escape sample the star cubemap in their bent direction (Einstein ring).
// Disk light is Doppler-beamed: I_obs ~ g^3 I_emit with
// g = sqrt(1 - 2/r) / (gamma (1 - beta . n_photon)), and its temperature is
// shifted by g - so the approaching side is brighter and bluer.
// (Spin-induced shadow asymmetry of a Kerr hole is not modelled.)

import { NOISE_GLSL } from './noise.js';

export const SkyShader = {
  uniforms: {
    uStars: { value: null },
    uCamRot: { value: null },
    uTanHalf: { value: 0.7 },
    uAspect: { value: 1.7 },
    uBH: { value: 0 },
    uInertialToBH: { value: null },
    uCamBH: { value: null },
    uSteps: { value: 110 },
    uTime: { value: 0 },
    uDiskIn: { value: 3.0 },
    uDiskOut: { value: 14.0 },
    uDiskT: { value: 6800 },
    uDiskGain: { value: 3.2 },
    uSunDir: { value: null },
    uSunOn: { value: 0 },
    uSunColor: { value: null },
    uAtmo: { value: 0 },          // 0..1 how deep in an atmosphere we are
    uUp: { value: null },
    uAtmoColor: { value: null },
    uStarGain: { value: 1 },
    uFogColor: { value: null },
    uFog: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform samplerCube uStars;
    uniform mat3 uCamRot, uInertialToBH;
    uniform vec3 uCamBH, uSunDir, uSunColor, uUp, uAtmoColor, uFogColor;
    uniform float uTanHalf, uAspect, uBH, uSteps, uTime, uDiskIn, uDiskOut, uDiskT, uDiskGain;
    uniform float uSunOn, uAtmo, uStarGain, uFog;
    varying vec2 vUv;
    ${NOISE_GLSL}

    vec3 blackbody(float T) {
      float t = T / 100.0;
      vec3 c;
      c.r = t <= 66.0 ? 1.0 : clamp(1.29293618 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
      c.g = t <= 66.0 ? clamp(0.39008157 * log(t) - 0.63184144, 0.0, 1.0)
                      : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
      c.b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678 * log(t - 10.0) - 1.19625408, 0.0, 1.0));
      return pow(c, vec3(2.2));
    }

    // Single-scattering sky from inside an atmosphere. tau = zenith Rayleigh
    // optical depth (scaled by local density), airmass ~ 1/(mu + 0.15).
    vec3 skyAtmo(vec3 rd, vec3 base) {
      if (uAtmo <= 0.001) return base;
      float mu = dot(rd, uUp);
      float sunMu = dot(uSunDir, uUp);
      vec3 tau = vec3(0.045, 0.105, 0.245) * (0.6 + 0.8 * uAtmoColor) * uAtmo;
      float amView = 1.0 / max(mu + 0.15, 0.08);
      float amSun = 1.0 / max(sunMu + 0.15, 0.06);
      vec3 sunT = exp(-tau * amSun * 0.6);
      float cosA = dot(rd, uSunDir);
      float phaseR = 0.75 * (1.0 + cosA * cosA);
      float phaseM = 0.06 / pow(1.0001 - 0.9 * cosA, 1.5);
      vec3 rayleigh = (1.0 - exp(-tau * amView)) * phaseR;
      vec3 mie = vec3(1.0 - exp(-0.05 * uAtmo * amView)) * phaseM;
      float day = smoothstep(-0.2, 0.06, sunMu);
      vec3 sky = (rayleigh * 3.4 + mie * 1.1) * sunT * uSunColor * (0.02 + day);
      // below the horizon: haze toward the ground colour
      sky = mix(sky, sky * 0.6 + vec3(0.02) * day, smoothstep(0.0, -0.15, mu));
      float hide = clamp(dot(sky, vec3(0.33)) * 4.0, 0.0, 1.0);
      vec3 col = base * (1.0 - hide) + sky;
      if (uFog > 0.0) col = mix(col, uFogColor, uFog * smoothstep(0.55, -0.05, mu));
      return col;
    }

    vec3 background(vec3 d) {
      vec3 col = textureLod(uStars, d, 0.0).rgb * uStarGain;
      if (uSunOn > 0.5) {
        float c = dot(d, uSunDir);
        col += uSunColor * (smoothstep(0.99996, 0.99999, c) * 60.0 + pow(max(c, 0.0), 900.0) * 6.0 + pow(max(c, 0.0), 40.0) * 0.12);
      }
      return col;
    }

    vec4 disk(vec3 hit, vec3 vray) {
      float r = length(hit.xz);
      float phi = atan(hit.z, hit.x);
      float om = pow(r, -1.5);
      float ph = phi - uTime * om * 2.4;
      vec3 q = vec3(r * 2.2, cos(ph) * 2.0, sin(ph) * 2.0);
      float n = fbm3(q * 1.3 + vec3(0.0, 0.0, r * 0.4));
      float rings = 0.78 + 0.22 * sin(r * 4.0 + n * 5.0);
      float dens = clamp(0.55 + 0.6 * n, 0.0, 1.0) * rings;
      float edge = smoothstep(uDiskIn, uDiskIn + 0.35, r) * smoothstep(uDiskOut, uDiskOut - 5.0, r);
      dens *= edge;
      float x = uDiskIn / r;
      float T = pow(x, 0.75) * pow(max(1.0 - sqrt(x), 0.0), 0.25) / 0.488;
      float beta = clamp(sqrt(1.0 / r), 0.0, 0.7);
      vec3 vd = beta * normalize(vec3(-hit.z, 0.0, hit.x));
      vec3 nph = -normalize(vray);
      float gam = 1.0 / sqrt(1.0 - beta * beta);
      float g = sqrt(max(1.0 - 2.0 / r, 0.02)) / (gam * (1.0 - dot(vd, nph)));
      vec3 c = blackbody(max(uDiskT * T * g, 900.0));
      float I = pow(g, 3.0) * (0.25 + 1.6 * T * T) * uDiskGain;
      float a = clamp(dens * 1.15, 0.0, 0.97);
      return vec4(c * I * (0.4 + dens), a);
    }

    vec3 traceBH(vec3 rdInertial) {
      vec3 p = uCamBH;
      vec3 v = normalize(uInertialToBH * rdInertial);
      float s1 = dot(p, v);
      vec3 cp = p - s1 * v;
      float b = length(cp);
      vec3 accum = vec3(0.0);
      float trans = 1.0;
      float R = max(uDiskOut + 8.0, 24.0);
      if (b > R) {
        float alpha = (2.0 / b) * (1.0 - s1 / sqrt(s1 * s1 + b * b));
        v = normalize(v - alpha * cp / b);
      } else {
        // start at the bounding sphere if the camera is outside it
        float pr = length(p);
        if (pr > R) {
          float tEnter = -s1 - sqrt(max(R * R - b * b, 0.0));
          if (tEnter > 0.0) {
            // weak-field bending accumulated on the way in
            float sIn = s1 + tEnter;
            float bb = max(b, 0.5);
            float alpha = (2.0 / bb) * (sIn / sqrt(sIn * sIn + bb * bb) - s1 / sqrt(s1 * s1 + bb * bb));
            p = p + v * tEnter;
            v = normalize(v - alpha * cp / bb);
          }
        }
        vec3 hv = cross(p, v);
        float h2 = dot(hv, hv);
        for (int i = 0; i < 220; i++) {
          if (float(i) >= uSteps) break;
          float r = length(p);
          if (r < 2.02) { trans = 0.0; break; }
          if (r > R + 1.0 && dot(p, v) > 0.0) break;
          float dt = clamp(0.085 * r * (0.5 + 0.5 * smoothstep(2.5, 6.0, r)), 0.02, 3.0);
          vec3 a = -3.0 * h2 * p / pow(r, 5.0);
          vec3 pn = p + v * dt + 0.5 * a * dt * dt;
          float rn = length(pn);
          vec3 an = -3.0 * h2 * pn / pow(rn, 5.0);
          vec3 vn = v + 0.5 * (a + an) * dt;
          if (p.y * pn.y < 0.0) {
            float f = p.y / (p.y - pn.y);
            vec3 hit = mix(p, pn, f);
            float rh = length(hit.xz);
            if (rh > uDiskIn && rh < uDiskOut) {
              vec4 e = disk(hit, normalize(mix(v, vn, f)));
              accum += trans * e.rgb * e.a;
              trans *= 1.0 - e.a;
              if (trans < 0.02) break;
            }
          }
          p = pn; v = vn;
        }
        if (trans > 0.0) {
          // residual weak-field bending beyond the integration sphere
          vec3 vu = normalize(v);
          float so = dot(p, vu);
          vec3 cpo = p - so * vu;
          float bo = length(cpo);
          if (bo > 0.5) {
            float alpha = (2.0 / bo) * (1.0 - so / sqrt(so * so + bo * bo));
            v = normalize(vu - alpha * cpo / bo);
          }
        }
      }
      if (trans <= 0.0) return accum;
      vec3 dI = transpose(uInertialToBH) * normalize(v);
      return accum + trans * background(dI);
    }

    void main() {
      vec2 ndc = vUv * 2.0 - 1.0;
      vec3 rdc = normalize(vec3(ndc.x * uTanHalf * uAspect, ndc.y * uTanHalf, -1.0));
      vec3 rd = normalize(uCamRot * rdc);
      vec3 col = uBH > 0.5 ? traceBH(rd) : background(rd);
      col = skyAtmo(rd, col);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// Point-sprite stars rendered once into the background cubemap.
export const StarPointShader = {
  vertexShader: /* glsl */ `
    attribute float size;
    attribute vec3 color;
    varying vec3 vColor;
    void main() {
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec3 vColor;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = dot(c, c) * 4.0;
      if (d > 1.0) discard;
      float a = (exp(-d * 5.0) + 0.06 * exp(-d * 1.2)) * smoothstep(1.0, 0.6, d);
      gl_FragColor = vec4(vColor * a, 1.0);
    }
  `,
};

// Procedural nebula / galactic band on an inverted sphere.
export const NebulaShader = {
  uniforms: { uTint1: { value: null }, uTint2: { value: null }, uGain: { value: 1 }, uSeed: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTint1, uTint2;
    uniform float uGain, uSeed;
    varying vec3 vDir;
    ${NOISE_GLSL}
    void main() {
      vec3 d = normalize(vDir);
      // galactic plane tilted ~60 deg from the ecliptic-ish XZ plane
      vec3 gn = normalize(vec3(0.35, 0.8, 0.48));
      float lat = dot(d, gn);
      float band = exp(-lat * lat * 18.0);
      vec3 q = d * 2.4 + uSeed;
      float n1 = fbm6(q);
      float n2 = fbm3(q * 2.7 + 4.0);
      float dust = smoothstep(0.05, 0.45, fbm3(q * 4.0 + 11.0)) * band;
      float glow = band * (0.55 + 0.45 * n1) + 0.18 * smoothstep(0.25, 0.75, n2) * (0.4 + band);
      vec3 col = mix(uTint1, uTint2, smoothstep(-0.3, 0.5, n2)) * glow;
      col *= 1.0 - dust * 0.75;
      // faint core
      col += uTint2 * 0.6 * pow(max(dot(d, normalize(vec3(0.8, -0.2, -0.55))), 0.0), 18.0) * band;
      gl_FragColor = vec4(col * 0.06 * uGain, 1.0);
    }
  `,
};
