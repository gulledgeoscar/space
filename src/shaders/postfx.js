// Final-stage screen effects, all driven by simulation values:
//  - G-load red-out / grey-out vignette (from the pilot's real acceleration)
//  - nose docking camera: grainy monochrome feed, scanlines, barrel distortion
//  - damage flash, heat shimmer tint, fades

export const PostFXShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRedout: { value: 0 },      // 0..1 eyeballs-out (blood to the head)
    uGreyout: { value: 0 },     // 0..1 eyeballs-down (blood leaving the head)
    uDockCam: { value: 0 },     // 0 or 1
    uDamage: { value: 0 },      // flash 0..1
    uFade: { value: 0 },        // fade to black 0..1
    uVignette: { value: 0.35 },
    uAspect: { value: 1.7 },
    uSignal: { value: 1 },      // dock-cam signal quality 0..1
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uRedout, uGreyout, uDockCam, uDamage, uFade, uVignette, uAspect, uSignal;
    varying vec2 vUv;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      vec3 col;
      if (uDockCam > 0.5) {
        // mild barrel distortion of the wide-ish nose lens
        vec2 c = uv - 0.5;
        float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
        uv = 0.5 + c * (1.0 + 0.06 * r2);
        // horizontal line jitter when signal degrades
        float line = floor(uv.y * 360.0);
        uv.x += (hash(vec2(line, floor(uTime * 30.0))) - 0.5) * 0.004 * (1.6 - uSignal);
        col = texture2D(tDiffuse, uv).rgb;
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        l = l / (1.0 + l);               // compress HDR
        l = smoothstep(0.02, 0.85, l);
        // grain + scanlines
        float g = hash(uv * vec2(1280.0, 720.0) + fract(uTime * 7.13) * 100.0);
        l += (g - 0.5) * 0.09 * (1.6 - uSignal * 0.6);
        l *= 0.86 + 0.14 * sin(uv.y * 900.0);
        // rolling brightness bar
        l *= 0.94 + 0.06 * smoothstep(0.0, 0.05, abs(fract(uv.y * 0.5 - uTime * 0.13) - 0.5));
        col = vec3(l) * vec3(0.82, 1.0, 0.86);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
        float vv = length((vUv - 0.5) * vec2(uAspect, 1.0));
        col *= smoothstep(1.05, 0.35, vv);
        gl_FragColor = vec4(col * 2.2, 1.0);
        return;
      }

      col = texture2D(tDiffuse, uv).rgb;
      vec2 cc = (uv - 0.5) * vec2(uAspect, 1.0);
      float d = length(cc);

      // red-out: blood pooling in the head, red haze closing in from edges
      if (uRedout > 0.001) {
        float edge = smoothstep(1.1 - uRedout * 0.9, 0.15, d);
        vec3 red = vec3(0.55, 0.02, 0.01) * (0.5 + 0.5 * dot(col, vec3(0.3, 0.6, 0.1)));
        col = mix(col, red + col * vec3(0.6, 0.05, 0.05), clamp(uRedout * 0.55 + (1.0 - edge) * uRedout, 0.0, 1.0));
        col *= 1.0 - (1.0 - edge) * uRedout * 0.85;
      }
      // grey-out: colour drains, tunnel vision
      if (uGreyout > 0.001) {
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(l), uGreyout);
        col *= smoothstep(1.2 - uGreyout, 0.1, d * (0.6 + uGreyout));
      }
      // grade (linear HDR, before tone mapping): a touch more saturation,
      // cool shadows, warm highlights
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = max(vec3(0.0), mix(vec3(lum), col, 1.08));
      float hi = smoothstep(0.05, 1.2, lum);
      col *= mix(vec3(0.97, 1.0, 1.05), vec3(1.04, 1.0, 0.95), hi);
      // standard lens vignette
      col *= 1.0 - uVignette * smoothstep(0.45, 1.25, d);
      // damage flash (hot white then red)
      col = mix(col, vec3(1.4, 0.35, 0.2), uDamage * 0.6);
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
