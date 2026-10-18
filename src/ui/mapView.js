// Orbit map (M): conic orbits of the Kestrel and the Meridian (Kepler
// propagation), apoapsis / periapsis, closest-approach markers, planned
// burn nodes and the planet, in a rotatable 3D view (units: km).

import {
  Scene, PerspectiveCamera, Mesh, SphereGeometry, MeshBasicMaterial, Line, BufferGeometry,
  Float32BufferAttribute, LineBasicMaterial, Vector3, Color, Group, AmbientLight, LineDashedMaterial,
  RingGeometry, DoubleSide, MeshStandardMaterial, DirectionalLight,
} from 'three';
import { orbitPolyline, closestApproach, stateToElements } from '../physics/orbital.js';
import { formatDuration } from '../physics/timeDilation.js';
import { fmtDist } from './hud.js';

const KM = 1e-3;

function makeLine(color, n = 260) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setDrawRange(0, 0);
  const l = new Line(g, new LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  l.frustumCulled = false;
  return l;
}

export class MapView {
  constructor(game, root) {
    this.game = game;
    this.scene = new Scene();
    this.scene.background = new Color(0x020406);
    this.camera = new PerspectiveCamera(50, 1, 1, 1e7);
    this.yaw = 0.6; this.pitch = 0.9; this.dist = 30000;
    this.planet = new Mesh(new SphereGeometry(1, 64, 32), new MeshStandardMaterial({ color: 0x29507a, roughness: 0.9 }));
    this.atmo = new Mesh(new SphereGeometry(1, 64, 32), new MeshBasicMaterial({ color: 0x4a8fd8, transparent: true, opacity: 0.12, depthWrite: false }));
    this.scene.add(this.planet, this.atmo, new AmbientLight(0xffffff, 0.35));
    this.sun = new DirectionalLight(0xffffff, 2.0);
    this.scene.add(this.sun);
    this.kLine = makeLine(0x7fd8ff);
    this.mLine = makeLine(0x6dff9c);
    this.wLine = makeLine(0xff6b5a);
    this.scene.add(this.kLine, this.mLine, this.wLine);
    const dot = (c, s = 1) => { const m = new Mesh(new SphereGeometry(s, 12, 8), new MeshBasicMaterial({ color: c })); this.scene.add(m); return m; };
    this.kDot = dot(0x7fd8ff); this.mDot = dot(0x6dff9c); this.wDot = dot(0xff6b5a);
    this.caK = dot(0xff9a6b); this.caM = dot(0xff9a6b);
    this.apDot = dot(0x9fd3ff); this.peDot = dot(0xffcf8a);
    this.nodeDot = dot(0xffffff);
    this.labels = document.createElement('div');
    this.labels.className = 'maplabels hidden';
    root.appendChild(this.labels);
    this.info = document.createElement('div');
    this.info.className = 'hud';
    this.labels.appendChild(this.info);
    this.lab = {};
    for (const k of ['k', 'm', 'w', 'ap', 'pe', 'ca', 'node', 'mAp']) {
      const d = document.createElement('div');
      d.className = 'ml ' + (k === 'ap' || k === 'mAp' ? 'ap' : k === 'pe' ? 'pe' : k === 'ca' ? 'ca' : k === 'm' ? 'tgt' : '');
      this.labels.appendChild(d);
      this.lab[k] = d;
    }
    this.timer = 0;
    this.visible = false;
  }

  show(on) {
    if (on === this.visible) return;
    this.visible = on;
    this.labels.classList.toggle('hidden', !on);
    if (on) this.timer = 0;
  }

  polyInto(line, pts) {
    const arr = line.geometry.attributes.position.array;
    const n = Math.min(pts.length, arr.length / 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = pts[i].x * KM; arr[i * 3 + 1] = pts[i].y * KM; arr[i * 3 + 2] = pts[i].z * KM; }
    line.geometry.setDrawRange(0, n);
    line.geometry.attributes.position.needsUpdate = true;
  }

  recompute() {
    const W = this.game.world, mu = W.primary.gm, K = W.kestrel.body, S = W.meridian.body;
    const R = W.primary.radius;
    this.planet.scale.setScalar(R * KM);
    this.atmo.scale.setScalar((R + (W.primary.atmosphere?.top || 0)) * KM);
    this.planet.material.color.setRGB(...W.primary.colors.ocean.map((c) => c * 3 + 0.05));
    const ko = orbitPolyline(K.pos, K.vel, mu, 256, R * 30);
    this.polyInto(this.kLine, ko.pts);
    this.kEl = ko.el;
    if (W.meridianActive) {
      const mo = orbitPolyline(S.pos, S.vel, mu, 256, R * 30);
      this.polyInto(this.mLine, mo.pts);
      this.mEl = mo.el;
      const horizon = Math.min(Number.isFinite(ko.el.period) ? ko.el.period * 2 : 20000, 40000);
      this.ca = closestApproach(K.pos, K.vel, S.pos, S.vel, mu, horizon, 200);
    } else { this.mLine.geometry.setDrawRange(0, 0); this.ca = null; }
    if (W.wren && W.wrenActive !== false) this.polyInto(this.wLine, orbitPolyline(W.wren.body.pos, W.wren.body.vel, mu, 256, R * 30).pts);
    else this.wLine.geometry.setDrawRange(0, 0);
  }

  render(dt) {
    const g = this.game, W = g.world, r = g.pipeline.renderer;
    const m = g.mouse;
    if (g.input.mouseButton(0) || g.input.mouseButton(2) || g.input.locked) {
      this.yaw -= m.x * 0.005; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + m.y * 0.005));
    }
    if (m.wheel) this.dist = Math.max(W.primary.radius * KM * 1.2, Math.min(4e5, this.dist * (1 + m.wheel * 0.1)));
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.25; this.recompute(); }
    const K = W.kestrel.body, S = W.meridian.body;
    const kp = K.pos.clone().multiplyScalar(KM);
    const focus = kp.clone().multiplyScalar(0.0);
    const c = this.camera;
    c.aspect = window.innerWidth / window.innerHeight;
    c.position.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist).add(focus);
    c.lookAt(focus);
    c.near = this.dist * 0.001; c.far = this.dist * 100;
    c.updateProjectionMatrix();
    this.sun.position.copy(g.sky.lightDir).multiplyScalar(1e5);
    const s = this.dist * 0.006;
    for (const d of [this.kDot, this.mDot, this.wDot, this.caK, this.caM, this.apDot, this.peDot, this.nodeDot]) d.scale.setScalar(s);
    this.kDot.position.copy(kp);
    this.mDot.visible = W.meridianActive;
    this.mDot.position.copy(S.pos).multiplyScalar(KM);
    this.wDot.visible = !!(W.wren && W.wrenActive !== false);
    if (this.wDot.visible) this.wDot.position.copy(W.wren.body.pos).multiplyScalar(KM);
    // apsides of the Kestrel orbit
    const el = this.kEl || stateToElements(K.pos, K.vel, W.primary.gm);
    const ev = el.evec.clone().normalize();
    const R = W.primary.radius;
    this.apDot.visible = el.e < 1 && el.e > 1e-4;
    this.peDot.visible = el.e > 1e-4;
    this.apDot.position.copy(ev).multiplyScalar(-el.ra * KM);
    this.peDot.position.copy(ev).multiplyScalar(el.rp * KM);
    const ca = this.ca;
    this.caK.visible = this.caM.visible = !!ca;
    if (ca) { this.caK.position.copy(ca.p1).multiplyScalar(KM); this.caM.position.copy(ca.p2).multiplyScalar(KM); }
    const node = g.mapNode;
    this.nodeDot.visible = !!node;
    if (node) this.nodeDot.position.copy(node.pos).multiplyScalar(KM);
    r.setRenderTarget(null);
    r.autoClear = true;
    r.render(this.scene, c);
    r.autoClear = false;
    // labels
    const L = (k, p, text, vis = true) => {
      const e = this.lab[k];
      if (!vis) { e.style.display = 'none'; return; }
      const v = p.clone().project(c);
      if (v.z > 1) { e.style.display = 'none'; return; }
      e.style.display = '';
      e.style.left = ((v.x * 0.5 + 0.5) * window.innerWidth).toFixed(0) + 'px';
      e.style.top = ((-v.y * 0.5 + 0.5) * window.innerHeight).toFixed(0) + 'px';
      if (e._t !== text) { e.textContent = text; e._t = text; }
    };
    L('k', this.kDot.position, 'KESTREL');
    L('m', this.mDot.position, 'MERIDIAN', this.mDot.visible);
    L('w', this.wDot.position, 'WREN', this.wDot.visible);
    L('ap', this.apDot.position, `Ap ${fmtDist(el.ra - R)}  T-${formatDuration(el.tAp)}`, this.apDot.visible);
    L('pe', this.peDot.position, `Pe ${fmtDist(el.rp - R)}  T-${formatDuration(el.tPe)}`, this.peDot.visible);
    L('ca', this.caK.position, ca ? `CLOSEST ${fmtDist(ca.d)} in ${formatDuration(ca.t)} · ${ca.relSpeed.toFixed(1)} m/s` : '', !!ca);
    L('node', this.nodeDot.position, node ? node.label : '', !!node);
    const me = this.mEl;
    this.info.innerHTML = `<div class="panel mapinfo"><h4>Orbit — ${W.primary.name}</h4>
      <div class="row"><span class="k">Kestrel Ap / Pe</span><span class="v">${fmtDist(el.ra - R)} / ${fmtDist(el.rp - R)}</span></div>
      <div class="row"><span class="k">Inclination</span><span class="v">${((el.inc * 180) / Math.PI).toFixed(2)}°</span></div>
      <div class="row"><span class="k">Period</span><span class="v">${Number.isFinite(el.period) ? formatDuration(el.period) : 'escape'}</span></div>
      ${me && W.meridianActive ? `<div class="row"><span class="k">Meridian Ap / Pe</span><span class="v">${fmtDist(me.ra - R)} / ${fmtDist(me.rp - R)}</span></div>` : ''}
      ${ca ? `<div class="row"><span class="k">Closest approach</span><span class="v">${fmtDist(ca.d)} in ${formatDuration(ca.t)}</span></div>` : ''}
      ${node ? `<div class="row"><span class="k">Planned burn</span><span class="v">${node.label}</span></div>` : ''}
      <div class="row"><span class="k">Controls</span><span class="v">drag rotate · wheel zoom · M close</span></div></div>`;
  }
}
