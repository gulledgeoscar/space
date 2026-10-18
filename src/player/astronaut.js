// Astronaut built from primitives: suit, reflective visor, life-support
// backpack with thruster nozzles, articulated limbs and procedural
// walk / run / climb / float / sit animation.

import {
  Group, Mesh, CapsuleGeometry, SphereGeometry, BoxGeometry, CylinderGeometry, TorusGeometry,
  MeshStandardMaterial, MeshBasicMaterial, Color, SpotLight, Object3D, PointLight,
} from 'three';
import { materials } from '../world/materials.js';

export function buildAstronaut({ suit = 0xe8e6df, accent = 0xd8641e, name = 'pilot' } = {}) {
  const M = materials();
  const suitMat = new MeshStandardMaterial({ color: suit, roughness: 0.82, metalness: 0.02 });
  const jointMat = new MeshStandardMaterial({ color: 0x8e9196, roughness: 0.7 });
  const accentMat = new MeshStandardMaterial({ color: accent, roughness: 0.55 });
  const visorMat = new MeshStandardMaterial({ color: 0xd9a646, roughness: 0.04, metalness: 1.0, envMapIntensity: 2.5 });
  const root = new Group();
  root.name = name;
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };

  const hips = new Group(); hips.position.y = 0.95; root.add(hips);
  const pelvis = mesh(new CapsuleGeometry(0.17, 0.12, 4, 10), suitMat, 0, 0.02, 0);
  pelvis.rotation.z = Math.PI / 2;
  hips.add(pelvis);
  const torso = new Group(); torso.position.y = 0.12; hips.add(torso);
  const chest = mesh(new CapsuleGeometry(0.22, 0.32, 6, 14), suitMat, 0, 0.3, 0);
  chest.scale.set(1.05, 1, 0.8);
  torso.add(chest);
  torso.add(mesh(new BoxGeometry(0.26, 0.18, 0.06), M.hullDark, 0, 0.32, -0.19));
  const chestLights = [];
  for (let i = 0; i < 3; i++) { const l = mesh(new BoxGeometry(0.03, 0.02, 0.01), i === 1 ? M.lightGreen : M.lightAmber, -0.07 + i * 0.07, 0.36, -0.225); torso.add(l); chestLights.push(l); }
  torso.add(mesh(new BoxGeometry(0.46, 0.04, 0.34), accentMat, 0, 0.12, 0));
  // backpack (PLSS) with thruster nozzles
  const pack = mesh(new BoxGeometry(0.42, 0.56, 0.22), M.darkMetal, 0, 0.34, 0.25);
  torso.add(pack);
  const nozzles = [];
  for (const [x, y] of [[-0.2, 0.62], [0.2, 0.62], [-0.2, 0.06], [0.2, 0.06]]) {
    const n = mesh(new CylinderGeometry(0.02, 0.035, 0.05, 8), M.metal, x, y, 0.36);
    n.rotation.x = Math.PI / 2;
    torso.add(n);
    nozzles.push(n);
  }
  // helmet
  const neck = mesh(new TorusGeometry(0.12, 0.035, 8, 20), jointMat, 0, 0.6, 0);
  neck.rotation.x = Math.PI / 2;
  torso.add(neck);
  const head = new Group(); head.position.y = 0.76; torso.add(head);
  const helmet = mesh(new SphereGeometry(0.18, 24, 18), suitMat);
  head.add(helmet);
  // spherical cap centred on -Z (phi = 3pi/2) covering the face
  const visor = mesh(new SphereGeometry(0.184, 24, 16, Math.PI * 1.12, Math.PI * 0.76, Math.PI * 0.2, Math.PI * 0.5), visorMat, 0, -0.005, 0);
  head.add(visor);
  for (const x of [-0.12, 0.12]) head.add(mesh(new BoxGeometry(0.04, 0.03, 0.05), new MeshBasicMaterial({ color: new Color(4, 4, 3.6) }), x, 0.1, -0.13));
  // flashlight (helmet lamp)
  const lamp = new SpotLight(0xfff2dd, 0, 22, 0.55, 0.45, 1.6);
  lamp.position.set(0, 0.1, -0.1);
  const lampTarget = new Object3D(); lampTarget.position.set(0, 0.0, -3);
  head.add(lamp, lampTarget);
  lamp.target = lampTarget;

  // arms
  const arm = (side) => {
    const sh = new Group(); sh.position.set(side * 0.29, 0.48, 0); torso.add(sh);
    sh.add(mesh(new SphereGeometry(0.09, 12, 10), jointMat));
    const up = mesh(new CapsuleGeometry(0.075, 0.2, 4, 10), suitMat, 0, -0.16, 0); sh.add(up);
    const el = new Group(); el.position.y = -0.31; sh.add(el);
    el.add(mesh(new SphereGeometry(0.07, 10, 8), jointMat));
    const fo = mesh(new CapsuleGeometry(0.065, 0.18, 4, 10), suitMat, 0, -0.14, 0); el.add(fo);
    const glove = mesh(new SphereGeometry(0.06, 10, 8), M.rubber, 0, -0.29, 0); glove.scale.set(1, 1.2, 0.8); el.add(glove);
    const cuff = mesh(new TorusGeometry(0.065, 0.015, 6, 14), accentMat, 0, -0.24, 0);
    cuff.rotation.x = Math.PI / 2;
    el.add(cuff);
    return { sh, el };
  };
  const leg = (side) => {
    const hp = new Group(); hp.position.set(side * 0.11, -0.04, 0); hips.add(hp);
    hp.add(mesh(new CapsuleGeometry(0.095, 0.26, 4, 10), suitMat, 0, -0.21, 0));
    const kn = new Group(); kn.position.y = -0.44; hp.add(kn);
    kn.add(mesh(new SphereGeometry(0.085, 10, 8), jointMat));
    kn.add(mesh(new CapsuleGeometry(0.085, 0.25, 4, 10), suitMat, 0, -0.2, 0));
    const boot = mesh(new BoxGeometry(0.15, 0.1, 0.27), M.hullDark, 0, -0.43, -0.04);
    kn.add(boot);
    return { hp, kn };
  };
  const L = { armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1) };

  const anim = { phase: 0, lean: 0, bob: 0 };
  return {
    root, hips, torso, head, visor, lamp, nozzles, chestLights, ...L, anim, suitMat,
    // pose: { mode: 'walk'|'run'|'idle'|'climb'|'float'|'sit', speed, climbRate, lean, dt }
    animate(pose) {
      const a = anim;
      const dt = pose.dt || 0.016;
      const m = pose.mode;
      const sp = pose.speed || 0;
      if (m === 'walk' || m === 'run' || m === 'idle') {
        const stride = m === 'run' ? 1.6 : 1.15;
        a.phase += dt * (sp / stride) * Math.PI * 2 * 0.5;
        const k = Math.min(1, sp / (m === 'run' ? 4 : 1.6));
        const amp = (m === 'run' ? 0.75 : 0.45) * k;
        const s = Math.sin(a.phase);
        L.legL.hp.rotation.x = s * amp; L.legR.hp.rotation.x = -s * amp;
        L.legL.kn.rotation.x = Math.max(0, -Math.cos(a.phase)) * amp * 1.4;
        L.legR.kn.rotation.x = Math.max(0, Math.cos(a.phase)) * amp * 1.4;
        L.armL.sh.rotation.x = -s * amp * 0.8; L.armR.sh.rotation.x = s * amp * 0.8;
        L.armL.el.rotation.x = -0.3 - k * 0.3; L.armR.el.rotation.x = -0.3 - k * 0.3;
        L.armL.sh.rotation.z = 0.12; L.armR.sh.rotation.z = -0.12;
        this.hips.position.y = 0.95 - Math.abs(Math.cos(a.phase)) * 0.04 * k - (pose.crouch || 0) * 0.25;
        this.torso.rotation.x = -(m === 'run' ? 0.22 : 0.06) * k + (pose.lean || 0) * 0.5;
        this.torso.rotation.z = pose.sideLean || 0;
      } else if (m === 'climb') {
        a.phase += dt * (pose.climbRate || 0) * 6;
        const s = Math.sin(a.phase), c = Math.cos(a.phase);
        L.armL.sh.rotation.x = -2.4 + s * 0.45; L.armR.sh.rotation.x = -2.4 - s * 0.45;
        L.armL.el.rotation.x = -0.5 + c * 0.3; L.armR.el.rotation.x = -0.5 - c * 0.3;
        L.legL.hp.rotation.x = -0.5 + s * 0.4; L.legR.hp.rotation.x = -0.5 - s * 0.4;
        L.legL.kn.rotation.x = 0.9 - s * 0.4; L.legR.kn.rotation.x = 0.9 + s * 0.4;
        L.armL.sh.rotation.z = 0.15; L.armR.sh.rotation.z = -0.15;
        this.torso.rotation.x = 0.05; this.torso.rotation.z = pose.sideLean || 0;
        this.hips.position.y = 0.95;
      } else if (m === 'float') {
        a.phase += dt * 0.6;
        const s = Math.sin(a.phase);
        L.armL.sh.rotation.set(-0.5 + s * 0.08, 0, 0.5); L.armR.sh.rotation.set(-0.45 - s * 0.08, 0, -0.5);
        L.armL.el.rotation.x = -0.6; L.armR.el.rotation.x = -0.65;
        L.legL.hp.rotation.x = 0.15 + s * 0.06; L.legR.hp.rotation.x = -0.1 - s * 0.06;
        L.legL.kn.rotation.x = 0.5; L.legR.kn.rotation.x = 0.35;
        this.torso.rotation.set(0.05, 0, 0);
        this.hips.position.y = 0.95;
      } else if (m === 'sit') {
        L.legL.hp.rotation.x = -1.45; L.legR.hp.rotation.x = -1.45;
        L.legL.kn.rotation.x = 1.4; L.legR.kn.rotation.x = 1.4;
        L.armL.sh.rotation.set(-0.7, 0, 0.1); L.armR.sh.rotation.set(-0.7, 0, -0.1);
        L.armL.el.rotation.x = -0.8; L.armR.el.rotation.x = -0.8;
        this.torso.rotation.set(0.1, 0, 0);
        this.hips.position.y = 0.55;
      } else if (m === 'down') {
        // knocked flat on the back
        this.torso.rotation.set(0, 0, 0);
        L.armL.sh.rotation.set(-0.3, 0, 1.2); L.armR.sh.rotation.set(-0.2, 0, -1.1);
        L.legL.hp.rotation.x = 0.1; L.legR.hp.rotation.x = -0.15;
      }
    },
  };
}
