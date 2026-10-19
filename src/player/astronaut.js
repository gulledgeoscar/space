// Astronaut built from primitives: a hard upper torso, soft-goods limbs
// with bearing rings at the joints, gloves, boots, a bubble helmet with a
// gold visor and a life-support backpack, plus procedural walk / run /
// climb / float / sit animation.
//
// Proportions are set so the limbs never pass through the body: the
// shoulder joints sit outside the torso's widest point and every pose
// swings the arms outward (rotation.z = side * angle), clear of the chest.

import {
  Group, Mesh, SphereGeometry, BoxGeometry, CylinderGeometry, TorusGeometry, LatheGeometry, CapsuleGeometry,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, Color, SpotLight, Object3D, Vector2, Vector3, Matrix4,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { materials } from '../world/materials.js';
import { canvasTexture } from '../world/geometry.js';

// fabric weave for the suit (soft goods), shared by every astronaut
let FABRIC = null;
function fabricTexture() {
  if (FABRIC) return FABRIC;
  FABRIC = canvasTexture(256, 256, (c, w, h) => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { c.fillStyle = `rgba(0,0,0,${0.035 + (y % 8 ? 0 : 0.02)})`; c.fillRect(0, y, w, 1); }
    for (let x = 0; x < w; x += 4) { c.fillStyle = 'rgba(0,0,0,0.025)'; c.fillRect(x, 0, 1, h); }
    // seams
    c.fillStyle = 'rgba(0,0,0,0.12)';
    for (const y of [64, 192]) c.fillRect(0, y, w, 2);
  }, { repeat: [3, 3] });
  return FABRIC;
}

// tapered limb segment along -Y: radius r0 at the top to r1 at the bottom
function limb(r0, r1, len, mat) {
  const g = new Group();
  const body = new Mesh(new CylinderGeometry(r0, r1, len, 16, 1), mat);
  body.position.y = -len / 2;
  const capT = new Mesh(new SphereGeometry(r0, 16, 10), mat);
  const capB = new Mesh(new SphereGeometry(r1, 16, 10), mat);
  capB.position.y = -len;
  for (const m of [body, capT, capB]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return g;
}

// Orient a figure in its parent's frame: face along fwd (-Z) with +Y = up.
// (Object3D.lookAt works in world space, which is wrong for figures placed
// inside the rotating station or a planet-site frame.)
const _mb = new Matrix4(), _rx = new Vector3(), _fz = new Vector3(), _uy = new Vector3();
export function faceAlong(obj, fwd, up) {
  _uy.copy(up).normalize();
  _fz.copy(fwd).addScaledVector(_uy, -fwd.dot(_uy)).normalize();
  _rx.crossVectors(_uy, _fz).negate().normalize();   // right = fwd x up
  _mb.makeBasis(_rx, _uy, _fz.clone().negate());
  obj.quaternion.setFromRotationMatrix(_mb);
}

export function buildAstronaut({ suit = 0xe8e6df, accent = 0xd8641e, name = 'pilot' } = {}) {
  const M = materials();
  const fabric = fabricTexture();
  const suitMat = new MeshStandardMaterial({ color: suit, map: fabric, roughness: 0.86, metalness: 0.0 });
  const shellMat = new MeshPhysicalMaterial({ color: new Color(suit).multiplyScalar(0.96), roughness: 0.38, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.35 });
  const jointMat = new MeshStandardMaterial({ color: 0x9ea3a9, roughness: 0.32, metalness: 0.85 });
  const accentMat = new MeshStandardMaterial({ color: accent, roughness: 0.5 });
  const gloveMat = new MeshStandardMaterial({ color: 0xd8d6cf, map: fabric, roughness: 0.75 });
  const bootMat = new MeshStandardMaterial({ color: 0x5d6168, roughness: 0.7, metalness: 0.1 });
  const soleMat = new MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.95 });
  const visorMat = new MeshPhysicalMaterial({ color: 0xc89a3c, roughness: 0.05, metalness: 1.0, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.05 });
  const packMat = new MeshPhysicalMaterial({ color: new Color(suit).multiplyScalar(0.9), roughness: 0.45, metalness: 0.1, clearcoat: 0.4 });
  const root = new Group();
  root.name = name;
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };

  // ---- hips / pelvis (brief) ----
  const hips = new Group(); hips.position.y = 0.95; root.add(hips);
  const brief = mesh(new CapsuleGeometry(0.15, 0.13, 6, 14), suitMat, 0, 0.0, 0);
  brief.rotation.z = Math.PI / 2;
  brief.scale.set(1, 1, 0.85);
  hips.add(brief);
  const waist = mesh(new TorusGeometry(0.175, 0.022, 8, 28), jointMat, 0, 0.1, 0);   // waist bearing
  waist.rotation.x = Math.PI / 2;
  hips.add(waist);

  // ---- hard upper torso: lathe shell, flattened front-to-back ----
  const torso = new Group(); torso.position.y = 0.12; hips.add(torso);
  const prof = [[0.0, 0.0], [0.17, 0.0], [0.195, 0.1], [0.222, 0.24], [0.228, 0.36], [0.215, 0.45], [0.18, 0.52], [0.125, 0.575], [0.0, 0.58]].map(([r, y]) => new Vector2(r, y));
  const hut = mesh(new LatheGeometry(prof, 28), shellMat, 0, 0, 0);
  hut.scale.set(1.0, 1, 0.8);
  torso.add(hut);
  // chest control box, lights, name strip
  torso.add(mesh(new RoundedBoxGeometry(0.24, 0.14, 0.07, 2, 0.02), M.hullDark, 0, 0.3, -0.19));
  const chestLights = [];
  for (let i = 0; i < 3; i++) { const l = mesh(new BoxGeometry(0.028, 0.018, 0.01), i === 1 ? M.lightGreen : M.lightAmber, -0.07 + i * 0.07, 0.33, -0.228); torso.add(l); chestLights.push(l); }
  torso.add(mesh(new BoxGeometry(0.2, 0.035, 0.02), accentMat, 0, 0.42, -0.165));
  // hoses from the backpack into the chest
  for (const s of [-1, 1]) {
    const hose = mesh(new TorusGeometry(0.13, 0.016, 6, 14, Math.PI * 0.9), M.cable, s * 0.13, 0.2, -0.03);
    hose.rotation.set(0, Math.PI / 2, 0);
    torso.add(hose);
  }

  // ---- backpack (PLSS) with thruster nozzles ----
  const pack = new Group(); pack.position.set(0, 0.32, 0.26); torso.add(pack);
  pack.add(mesh(new RoundedBoxGeometry(0.38, 0.5, 0.2, 3, 0.06), packMat));
  pack.add(mesh(new RoundedBoxGeometry(0.26, 0.16, 0.04, 2, 0.015), M.darkMetal, 0, 0.1, 0.1));
  pack.add(mesh(new RoundedBoxGeometry(0.3, 0.07, 0.05, 2, 0.02), accentMat, 0, -0.16, 0.095));
  for (const x of [-0.16, 0.16]) pack.add(mesh(new CylinderGeometry(0.022, 0.022, 0.36, 10), M.metal, x, 0.02, 0.085));
  const nozzles = [];
  for (const [x, y] of [[-0.17, 0.27], [0.17, 0.27], [-0.17, -0.27], [0.17, -0.27]]) {
    const n = mesh(new CylinderGeometry(0.018, 0.032, 0.05, 10), M.metal, x, y, 0.1);
    n.rotation.x = Math.PI / 2;
    pack.add(n);
    nozzles.push(n);
  }

  // ---- helmet ----
  const neck = mesh(new TorusGeometry(0.13, 0.03, 10, 28), jointMat, 0, 0.585, 0);
  neck.rotation.x = Math.PI / 2;
  torso.add(neck);
  const head = new Group(); head.position.y = 0.75; torso.add(head);
  head.add(mesh(new SphereGeometry(0.175, 32, 24), shellMat));
  // gold visor: a spherical cap facing -Z
  const visor = mesh(new SphereGeometry(0.181, 32, 20, Math.PI * 1.13, Math.PI * 0.74, Math.PI * 0.22, Math.PI * 0.46), visorMat, 0, -0.005, 0);
  head.add(visor);
  // visor rim and helmet lights
  const rim = mesh(new TorusGeometry(0.168, 0.012, 8, 32, Math.PI * 0.9), jointMat, 0, 0.065, -0.02);
  rim.rotation.set(Math.PI / 2 - 0.25, 0, Math.PI * 0.55);
  head.add(rim);
  const lampMat = new MeshBasicMaterial({ color: new Color(4, 4, 3.6) });
  for (const x of [-0.13, 0.13]) {
    head.add(mesh(new BoxGeometry(0.045, 0.035, 0.07), M.darkMetal, x, 0.09, -0.11));
    head.add(mesh(new BoxGeometry(0.035, 0.022, 0.01), lampMat, x, 0.09, -0.147));
  }
  head.add(mesh(new CylinderGeometry(0.004, 0.004, 0.16, 6), M.metal, 0.11, 0.2, 0.08));   // antenna
  // flashlight (helmet lamp)
  const lamp = new SpotLight(0xfff2dd, 0, 22, 0.55, 0.45, 1.6);
  lamp.position.set(0, 0.1, -0.1);
  const lampTarget = new Object3D(); lampTarget.position.set(0, 0.0, -3);
  head.add(lamp, lampTarget);
  lamp.target = lampTarget;

  // ---- arms: shoulder joints outside the torso's widest point ----
  const arm = (side) => {
    const sh = new Group(); sh.position.set(side * 0.318, 0.43, 0); torso.add(sh);
    const ring = mesh(new TorusGeometry(0.082, 0.02, 8, 22), jointMat);
    ring.rotation.y = Math.PI / 2;
    sh.add(ring);
    sh.add(mesh(new SphereGeometry(0.09, 16, 12), shellMat));
    const up = limb(0.074, 0.064, 0.25, suitMat); sh.add(up);
    const el = new Group(); el.position.y = -0.3; sh.add(el);
    const eRing = mesh(new TorusGeometry(0.066, 0.014, 6, 18), jointMat);
    eRing.rotation.x = Math.PI / 2;
    el.add(eRing);
    el.add(limb(0.062, 0.052, 0.22, suitMat));
    const wr = mesh(new TorusGeometry(0.055, 0.015, 6, 18), accentMat, 0, -0.235, 0);
    wr.rotation.x = Math.PI / 2;
    el.add(wr);
    // glove: palm, fingers, thumb (thumb toward the body)
    const hand = new Group(); hand.position.y = -0.27; el.add(hand);
    const palm = mesh(new RoundedBoxGeometry(0.08, 0.095, 0.045, 2, 0.018), gloveMat, 0, -0.04, 0); hand.add(palm);
    const fingers = mesh(new RoundedBoxGeometry(0.075, 0.065, 0.038, 2, 0.015), gloveMat, 0, -0.105, 0.006); fingers.rotation.x = -0.35; hand.add(fingers);
    const thumb = mesh(new CapsuleGeometry(0.014, 0.04, 4, 8), gloveMat, -side * 0.045, -0.045, -0.012); thumb.rotation.z = side * 0.6; hand.add(thumb);
    return { sh, el, hand };
  };
  const leg = (side) => {
    const hp = new Group(); hp.position.set(side * 0.105, -0.06, 0); hips.add(hp);
    hp.add(limb(0.098, 0.082, 0.38, suitMat));
    const kn = new Group(); kn.position.y = -0.43; hp.add(kn);
    kn.add(mesh(new SphereGeometry(0.084, 14, 10), shellMat));
    kn.add(limb(0.08, 0.068, 0.34, suitMat));
    // boot: upper, toe cap and sole
    const boot = new Group(); boot.position.y = -0.4; kn.add(boot);
    boot.add(mesh(new CylinderGeometry(0.078, 0.084, 0.12, 14), bootMat, 0, 0.0, 0.0));
    const foot = mesh(new CapsuleGeometry(0.06, 0.15, 4, 10), bootMat, 0, -0.04, -0.06);
    foot.rotation.x = Math.PI / 2; foot.scale.set(1.15, 1, 0.75);
    boot.add(foot);
    boot.add(mesh(new RoundedBoxGeometry(0.145, 0.03, 0.29, 2, 0.012), soleMat, 0, -0.085, -0.06));
    return { hp, kn };
  };
  const L = { armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1) };

  // Joint conventions (the figure faces -Z):
  //   hip  rotation.x > 0  thigh swings forward      knee  rotation.x < 0  foot folds back
  //   shoulder .x > 0      arm swings forward         elbow rotation.x > 0  forearm folds forward
  //   shoulder .z = side * out  keeps the arm clear of the body
  const setArm = (A, side, fwd, out, elbow, twist = 0) => { A.sh.rotation.set(fwd, twist * side, side * out); A.el.rotation.x = elbow; };
  const setLeg = (G, side, fwd, knee, out = 0.03) => { G.hp.rotation.set(fwd, 0, side * out); G.kn.rotation.x = -knee; };

  const anim = { phase: 0, lean: 0, bob: 0, breath: 0 };
  return {
    root, hips, torso, head, visor, lamp, nozzles, chestLights, ...L, anim, suitMat,
    // pose: { mode: 'walk'|'run'|'idle'|'climb'|'float'|'sit'|'down', speed, climbRate, lean, sideLean, dt }
    animate(pose) {
      const a = anim;
      const dt = pose.dt || 0.016;
      const m = pose.mode;
      const sp = pose.speed || 0;
      a.breath += dt * 1.6;
      const breath = Math.sin(a.breath) * 0.012;
      this.hips.rotation.set(0, 0, 0);
      if (m === 'walk' || m === 'run' || m === 'idle') {
        const run = m === 'run';
        const stride = run ? 1.6 : 1.15;
        a.phase += dt * (sp / stride) * Math.PI * 2 * 0.5;
        const k = Math.min(1, sp / (run ? 4 : 1.6));
        const amp = (run ? 0.75 : 0.45) * k;
        const s = Math.sin(a.phase), c = Math.cos(a.phase);
        // the knee folds while that leg swings through (moving forward)
        setLeg(L.legL, -1, s * amp, 0.06 + Math.max(0, c) * amp * 1.6);
        setLeg(L.legR, 1, -s * amp, 0.06 + Math.max(0, -c) * amp * 1.6);
        // arms swing opposite to the legs, elbows bent a little (more when running)
        const elbow = 0.22 + k * (run ? 1.05 : 0.3);
        setArm(L.armL, -1, -s * amp * 0.85, 0.16 + k * 0.05 + breath, elbow);
        setArm(L.armR, 1, s * amp * 0.85, 0.16 + k * 0.05 + breath, elbow);
        this.hips.position.y = 0.95 - Math.abs(c) * 0.035 * k - (pose.crouch || 0) * 0.25;
        this.hips.rotation.y = -s * 0.07 * k;
        // lean into the motion (forward = -Z, i.e. negative rotation.x)
        this.torso.rotation.set(-(run ? 0.2 : 0.05) * k + (pose.lean || 0) * 0.5 + breath, s * 0.1 * k, pose.sideLean || 0);
        this.head.rotation.set(0, -s * 0.05 * k, 0);
      } else if (m === 'climb') {
        a.phase += dt * (pose.climbRate || 0) * 6;
        const s = Math.sin(a.phase), c = Math.cos(a.phase);
        // hands up on the rungs in front, feet stepping
        setArm(L.armL, -1, 2.5 + s * 0.35, 0.2, 0.55 + c * 0.3);
        setArm(L.armR, 1, 2.5 - s * 0.35, 0.2, 0.55 - c * 0.3);
        setLeg(L.legL, -1, 0.45 + s * 0.4, 0.85 + s * 0.4, 0.05);
        setLeg(L.legR, 1, 0.45 - s * 0.4, 0.85 - s * 0.4, 0.05);
        this.torso.rotation.set(0.05, 0, pose.sideLean || 0);
        this.head.rotation.set(-0.15, 0, 0);
        this.hips.position.y = 0.95;
      } else if (m === 'float') {
        a.phase += dt * 0.6;
        const s = Math.sin(a.phase);
        setArm(L.armL, -1, 0.35 + s * 0.08, 0.5, 0.65);
        setArm(L.armR, 1, 0.4 - s * 0.08, 0.45, 0.7);
        setLeg(L.legL, -1, 0.12 + s * 0.06, 0.5, 0.08);
        setLeg(L.legR, 1, -0.08 - s * 0.06, 0.32, 0.08);
        this.torso.rotation.set(0.05 + breath, 0, 0);
        this.head.rotation.set(0, 0, 0);
        this.hips.position.y = 0.95;
      } else if (m === 'sit') {
        // thighs forward, shins down, hands on the knees
        setLeg(L.legL, -1, 1.5, 1.45, 0.08);
        setLeg(L.legR, 1, 1.5, 1.45, 0.08);
        setArm(L.armL, -1, 0.7, 0.18, 0.75);
        setArm(L.armR, 1, 0.7, 0.18, 0.75);
        this.torso.rotation.set(-0.06 + breath, 0, 0);
        this.head.rotation.set(0.05, 0, 0);
        this.hips.position.y = 0.55;
      } else if (m === 'down') {
        // knocked flat on the back, arms flung out
        this.hips.rotation.set(Math.PI / 2, 0, 0);
        this.hips.position.y = 0.2;
        this.torso.rotation.set(0, 0, 0);
        setArm(L.armL, -1, -0.2, 1.15, 0.4);
        setArm(L.armR, 1, -0.1, 1.05, 0.5);
        setLeg(L.legL, -1, 0.1, 0.25, 0.15);
        setLeg(L.legR, 1, -0.05, 0.1, 0.12);
      }
    },
  };
}
