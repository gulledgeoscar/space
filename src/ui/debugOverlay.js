// Physics debug overlay (P): velocity / angular momentum / thrust / gravity
// vectors drawn in 3D plus raw state, orbital elements and g-load.

import { ArrowHelper, Vector3, Color, Group } from 'three';
import { stateToElements } from '../physics/orbital.js';
import { G0, rpm } from '../physics/constants.js';

const _v = new Vector3();

export class DebugOverlay {
  constructor(game, root) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'debug hidden';
    root.appendChild(this.el);
    this.on = false;
    this.group = new Group();
    this.group.visible = false;
    game.scene.add(this.group);
    const mk = (c) => { const a = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 1, c, 0.6, 0.3); a.line.material.depthTest = false; a.cone.material.depthTest = false; a.renderOrder = 20; this.group.add(a); return a; };
    this.aVel = mk(0x6dff9c);
    this.aL = mk(0xff6bd6);
    this.aThrust = mk(0xffb34c);
    this.aGrav = mk(0x7fd8ff);
    this.aSL = mk(0xff4040);
    this.aSW = mk(0xffffff);
    this.timer = 0;
  }

  toggle() { this.on = !this.on; this.el.classList.toggle('hidden', !this.on); this.group.visible = this.on; }

  setArrow(a, origin, dir, len) {
    if (!(len > 1e-6)) { a.visible = false; return; }
    a.visible = true;
    a.position.copy(origin);
    a.setDirection(_v.copy(dir).normalize());
    a.setLength(len, Math.min(len * 0.25, 2.5), Math.min(len * 0.12, 1.2));
  }

  update(dt) {
    if (!this.on) return;
    const g = this.game, W = g.world, K = W.kestrel, S = W.meridian, D = W.docking;
    const origin = g.pipeline.origin;
    if (g.mode === 'flight' || g.mode === 'cutscene') {
      const kp = new Vector3().copy(K.body.pos).sub(origin);
      const vrel = W.meridianActive ? new Vector3().copy(D.rel.vel).applyQuaternion(S.body.quat) : new Vector3().subVectors(K.body.vel, W.surfaceVelocity(K.body.pos, new Vector3()));
      this.setArrow(this.aVel, kp, vrel, Math.min(60, vrel.length() * 8));
      this.setArrow(this.aL, kp, K.body.L, Math.min(30, Math.log10(1 + K.body.L.length()) * 3));
      const thrustAcc = new Vector3().copy(K.body.lastAccel).sub(W.gravityAtKestrel);
      this.setArrow(this.aThrust, kp, thrustAcc, Math.min(40, thrustAcc.length() * 10));
      this.setArrow(this.aGrav, kp, W.gravityAtKestrel, W.gravityAtKestrel.length() * 1.5);
      if (W.meridianActive) {
        const sp = new Vector3().copy(S.body.pos).sub(origin);
        this.setArrow(this.aSL, sp, S.body.L, 45);
        this.setArrow(this.aSW, sp, S.body.omega, 38);
      } else { this.aSL.visible = false; this.aSW.visible = false; }
    } else { for (const a of [this.aVel, this.aL, this.aThrust, this.aGrav, this.aSL, this.aSW]) a.visible = false; }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const b = K.body;
    const el = stateToElements(b.pos, b.vel, W.primary.gm);
    const I = b.inertiaBody.elements;
    const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '---');
    const v3 = (v, d = 3) => `(${f(v.x, d)}, ${f(v.y, d)}, ${f(v.z, d)})`;
    const deg = 180 / Math.PI;
    const lines = [
      `PHYSICS  ${W.time.toFixed(2)} s sim  · step ${(1 / 120).toFixed(5)} s · ${g.loop.stepsLastFrame} steps/frame · warp ${g.warp}×`,
      `KESTREL  m ${f(b.mass, 1)} kg  CoM ${v3(b.comBody, 3)}  I diag (${f(I[0], 0)}, ${f(I[4], 0)}, ${f(I[8], 0)}) kg·m²`,
      `         products Ixy ${f(I[3], 1)} Ixz ${f(I[6], 1)} Iyz ${f(I[7], 1)}`,
      `         ω ${v3(b.omega, 4)} rad/s  |L| ${f(b.L.length(), 1)} N·m·s  KE_rot ${f(b.rotKE(), 2)} J`,
      `         g-load ${f(g.pilotG || 0, 2)} g (pilot eye)  specific force ${v3(K.pilotAccel, 2)} m/s²`,
      `ORBIT    a ${f(el.a / 1000, 3)} km  e ${f(el.e, 6)}  i ${f(el.inc * deg, 3)}°  Ω ${f(el.raan * deg, 2)}°  ω ${f(el.argp * deg, 2)}°  ν ${f(el.nu * deg, 2)}°`,
      `         Ap ${f((el.ra - W.primary.radius) / 1000, 2)} km  Pe ${f((el.rp - W.primary.radius) / 1000, 2)} km  T ${f(el.period / 60, 2)} min  E ${f(el.energy, 1)} J/kg`,
    ];
    if (W.meridianActive) {
      const sb = S.body;
      const z = S.axisWorld(new Vector3());
      const nut = Math.acos(Math.min(1, z.dot(sb.L.clone().normalize()))) * deg;
      lines.push(`MERIDIAN m ${f(sb.mass / 1000, 2)} t  I_zz ${f(sb.inertiaBody.elements[8] / 1e6, 2)}e6  spin ${f(rpm(S.spinRate), 3)} RPM  |ω| ${f(sb.omega.length(), 4)}`);
      lines.push(`         |L| ${f(sb.L.length() / 1e6, 3)}e6 N·m·s  nutation ${f(nut, 3)}°  CoM off-axis ${f(S.comOffset(), 3)} m  vents ${S.vents.filter((v) => v.gas > 1).length}`);
      lines.push(`DOCK     ${D.state}  rel pos ${v3(D.rel.pos, 3)}  rel vel ${v3(D.rel.vel, 3)}  ΔL ${v3(D.rel.dL, 0)}`);
      if (D.mergeInfo) lines.push(`MERGE    spin ${f(D.mergeInfo.before.spin, 4)} -> ${f(D.mergeInfo.after.spin, 4)} rad/s (conservation of angular momentum)`);
    }
    if (g.interior?.debugLines) lines.push(...g.interior.debugLines());
    if (g.surface?.debugLines) lines.push(...g.surface.debugLines());
    this.el.textContent = lines.join('\n');
  }
}
