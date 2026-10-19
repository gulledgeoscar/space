// Flight + docking HUD. All numbers come straight from the simulation.

import { Vector3, Quaternion } from 'three';
import { stateToElements } from '../physics/orbital.js';
import { G0, rpm } from '../physics/constants.js';
import { formatDuration } from '../physics/timeDilation.js';
import { settings } from '../core/settings.js';
import { KESTREL } from '../ship/kestrel.js';

const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '---');
const fmtDist = (m) => {
  if (!Number.isFinite(m)) return '---';
  const a = Math.abs(m);
  if (a >= 1e6) return (m / 1000).toFixed(0) + ' km';
  if (a >= 10000) return (m / 1000).toFixed(1) + ' km';
  if (a >= 100) return m.toFixed(0) + ' m';
  if (a >= 10) return m.toFixed(1) + ' m';
  return m.toFixed(2) + ' m';
};
export { fmtDist };

const _v = new Vector3();
const _w = new Vector3();
const _q = new Quaternion();

const ICONS = {
  prograde: '<svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0-7V-12M7 0H12M-7 0H-12" stroke="currentColor" stroke-width="2"/><circle r="1.5" fill="currentColor"/></svg>',
  retrograde: '<svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M-5-5L5 5M5-5L-5 5M0 7V12M7 0H12M-7 0H-12" stroke="currentColor" stroke-width="1.6"/></svg>',
  target: '<svg width="30" height="30" viewBox="-15 -15 30 30"><path d="M-12-6V-12H-6M6-12H12V-6M12 6V12H6M-6 12H-12V6" fill="none" stroke="currentColor" stroke-width="2"/><circle r="2" fill="currentColor"/></svg>',
  burn: '<svg width="30" height="30" viewBox="-15 -15 30 30"><path d="M0-12L12 0L0 12L-12 0Z" fill="none" stroke="currentColor" stroke-width="2"/><circle r="3" fill="currentColor"/></svg>',
  cue: '<svg width="34" height="34" viewBox="-17 -17 34 34"><path d="M-16 0H-6M6 0H16M0-16V-6M0 6V16" stroke="currentColor" stroke-width="2.4"/><circle r="5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  ca: '<svg width="20" height="20" viewBox="-10 -10 20 20"><path d="M0-8L8 6H-8Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

export class HUD {
  constructor(game, root) {
    this.game = game;
    this.root = el('div', 'hud hidden');
    root.appendChild(this.root);
    this.build();
    this.timer = 0;
    this.cues = new Map();
    this.flags = { orbit: true, docking: true, propulsion: true };
    this.screenTimer = 0;
  }

  build() {
    const r = this.root;
    // mission + objective
    this.tl = el('div', 'panel tl');
    this.missionTitle = el('div', 'mission-title', '');
    this.objective = el('div', 'objective', '');
    this.tl.append(this.missionTitle, this.objective);
    // clocks
    this.tr = el('div', 'panel tr');
    this.tr.innerHTML = `<h4>Mission clocks</h4>
      <div class="clock">SHIP&nbsp;&nbsp;<span data-k="ship">00:00:00</span></div>
      <div class="clock">EARTH <span class="earth" data-k="earth">+0</span></div>
      <div class="factor"><span data-k="factor">dt/dτ 1.000</span> · WARP <span data-k="warp">1×</span></div>`;
    // orbital / flight
    this.lm = el('div', 'panel lm');
    this.lm.innerHTML = `<h4>Flight</h4>
      ${['alt:Altitude', 'spd:Orbital vel', 'vs:Vert speed', 'srf:Surface vel', 'ap:Apoapsis', 'pe:Periapsis', 'tap:T-Apoapsis', 'inc:Inclination', 'q:Dyn. pressure', 'mach:Mach', 'g:Pilot load', 'temp:Hull temp']
    .map((s) => { const [k, n] = s.split(':'); return `<div class="row" data-row="${k}"><span class="k">${n}</span><span class="v" data-k="${k}">-</span></div>`; }).join('')}`;
    // propulsion
    this.bl = el('div', 'panel bl');
    this.bl.innerHTML = `<h4>Propulsion</h4>
      <div class="row"><span class="k">Propellant</span><span class="v" data-k="fuel">-</span></div>
      <div class="bar"><i data-bar="fuel"></i></div>
      <div class="row"><span class="k">Δv main</span><span class="v" data-k="dvm">-</span></div>
      <div class="row"><span class="k">Δv as RCS</span><span class="v" data-k="dvr">-</span></div>
      <div class="row"><span class="k">Throttle</span><span class="v" data-k="thr">0%</span></div>
      <div class="bar cyan"><i data-bar="thr"></i></div>
      <div class="row"><span class="k">RCS mode</span><span class="v" data-k="rcs">FINE</span></div>
      <div class="row"><span class="k">RCS jet temp</span><span class="v" data-k="rcst">-</span></div>
      <div class="row"><span class="k">Hull</span><span class="v" data-k="hull">100%</span></div>
      <div class="bar green"><i data-bar="hull"></i></div>
      <div class="row"><span class="k">Mass / CoM z</span><span class="v" data-k="mass">-</span></div>`;
    // docking
    this.br = el('div', 'panel br');
    this.br.innerHTML = `<h4>Docking — Meridian hub port</h4>
      ${['rng:Range', 'cls:Closing vel', 'lx:Lateral X', 'ly:Lateral Y', 'lv:Lateral vel', 'pit:Pitch err', 'yaw:Yaw err', 'rol:Roll err (idx)', 'spin:Station spin', 'rr:Rel spin rate', 'tan:Port tangential', 'dl:ΔL mismatch', 'ca:Closest approach']
    .map((s) => { const [k, n] = s.split(':'); return `<div class="row" data-row="${k}"><span class="k">${n}</span><span class="v" data-k="${k}">-</span></div>`; }).join('')}
      <div class="spinmeter"><div class="row"><span class="k">Rotation match</span><span class="v" data-k="sm">-</span></div><div class="bar green"><i data-bar="sm"></i></div></div>
      <div class="envelope">${['CLOSE', 'LAT', 'TILT', 'ROLL', 'SPIN', 'DRIFT'].map((x) => `<span data-env="${x}">${x}</span>`).join('')}</div>`;
    this.phase = el('div', 'phase', '<div class="name"></div><div class="sub"></div>');
    this.assist = el('div', 'assist', '');
    this.warnings = el('div', 'warnings', '');
    this.markers = el('div', 'markers', '');
    this.fd = el('div', 'fd hidden');
    this.fd.innerHTML = `<svg viewBox="-90 -90 180 180" width="180" height="180">
      <circle r="60" fill="none" stroke="rgba(127,216,255,0.35)" stroke-width="1"/>
      <circle r="20" fill="none" stroke="rgba(127,216,255,0.25)" stroke-width="1"/>
      <path d="M-70 0H-62M62 0H70M0-70V-62M0 62V70" stroke="rgba(127,216,255,0.5)"/>
      <circle data-fd="dot" r="5" fill="#7fd8ff"/>
      <line data-fd="vec" x1="0" y1="0" x2="0" y2="0" stroke="#7fd8ff" stroke-width="2"/>
      <rect data-fd="ax" x="78" y="-60" width="6" height="0" fill="#6dff9c"/>
      <text data-fd="hint" x="0" y="86" fill="#7fd8ff" font-size="11" text-anchor="middle" font-family="Share Tech Mono"></text>
    </svg>`;
    // ---- minimal HUD (default): objective, one strip of key numbers, status ----
    this.mObj = el('div', 'm-obj', '<div class="t"></div><div class="o"></div><div class="c"></div>');
    this.mStrip = el('div', 'm-strip', '');
    this.mCells = [];
    for (let i = 0; i < 4; i++) {
      const c = el('div', 'm-cell', '<div class="v">-</div><div class="k">-</div>');
      this.mStrip.appendChild(c);
      this.mCells.push({ el: c, v: c.querySelector('.v'), k: c.querySelector('.k') });
    }
    this.mFuel = el('div', 'm-fuel', '<div class="bar"><i></i></div><div class="lbl"></div>');
    this.mStatus = el('div', 'm-status', '');
    this.mHint = el('div', 'm-hint', 'I instruments · Tab controls');
    r.append(this.tl, this.tr, this.lm, this.bl, this.br, this.phase, this.assist, this.warnings, this.markers, this.fd, this.mObj, this.mStrip, this.mFuel, this.mStatus, this.mHint);
    this.k = {};
    for (const n of r.querySelectorAll('[data-k]')) this.k[n.dataset.k] = n;
    this.bars = {};
    for (const n of r.querySelectorAll('[data-bar]')) this.bars[n.dataset.bar] = n;
    this.env = {};
    for (const n of r.querySelectorAll('[data-env]')) this.env[n.dataset.env] = n;
    this.fdEls = {};
    for (const n of this.fd.querySelectorAll('[data-fd]')) this.fdEls[n.dataset.fd] = n;
    this.markerEls = new Map();
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  set(k, text, cls = null) {
    const n = this.k[k];
    if (!n) return;
    if (n._t !== text) { n.textContent = text; n._t = text; }
    const c = 'v' + (cls ? ' ' + cls : '');
    if (n._c !== c) { n.className = c; n._c = c; }
  }
  label(k, text) {
    const row = this.root.querySelector(`[data-row="${k}"] .k`);
    if (row && row._t !== text) { row.textContent = text; row._t = text; }
  }
  bar(k, f) { const n = this.bars[k]; if (n) n.style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%'; }
  row(k, vis) { const r = this.root.querySelector(`[data-row="${k}"]`); if (r) r.style.display = vis ? '' : 'none'; }

  setCue(name, data) { if (data) this.cues.set(name, data); else this.cues.delete(name); }

  setObjective(title, text) {
    this.missionTitle.textContent = title || '';
    this.objective.textContent = text || '';
    this.mObj.querySelector('.t').textContent = title || '';
    this.mObj.querySelector('.o').textContent = text || '';
  }

  // minimal strip cells: [value, label, cls]
  cells(list) {
    this.mCells.forEach((c, i) => {
      const d = list[i];
      c.el.style.display = d ? '' : 'none';
      if (!d) return;
      if (c.v._t !== d[0]) { c.v.textContent = d[0]; c.v._t = d[0]; }
      if (c.k._t !== d[1]) { c.k.textContent = d[1]; c.k._t = d[1]; }
      const cls = 'v' + (d[2] ? ' ' + d[2] : '');
      if (c.v.className !== cls) c.v.className = cls;
    });
  }

  updateMinimal(D, diff) {
    const g = this.game, W = g.world, K = W.kestrel, b = K.body, pl = W.primary;
    const alt = b.pos.length() - pl.radius;
    const el2 = stateToElements(b.pos, b.vel, pl.gm);
    const r = D.rel;
    const docking = W.meridianActive && (r.range < 2500 || D.state !== 'free');
    let status = '', stCls = '';
    // simple flight: what the flight computer is doing, and what W does now
    const fb = diff.helpers && g.mode === 'flight' ? g.pilot.fbw : null;
    if (fb && fb.ctx !== 'free' && D.state === 'free') {
      const spinning = Math.abs(rpm(r.spin)) > 0.3;
      this.cells([
        [fmtDist(r.range), 'RANGE'],
        [`${fmt(r.closing, r.range < 30 ? 2 : 1)} m/s`, 'CLOSING', r.range < 12 && r.closing > diff.closing ? 'bad' : null],
        [`${fmt(fb.speed, fb.speed < 1 ? 2 : 1)} m/s`, fb.speedSet > fb.vSafe + 0.01 ? 'SPEED · SAFE LIMIT' : 'SPEED SET', fb.speedSet > fb.vSafe + 0.01 ? 'warn' : 'good'],
        spinning ? [`${fmt(r.spinMatch * 100, 0)}%`, 'SPIN MATCH', r.spinMatch > 0.97 ? 'good' : null] : [`${fmt(r.tilt, 1)}°`, 'ALIGNMENT', r.tilt < diff.tilt ? 'good' : null],
      ]);
      if (r.range < 15 && r.pos.z > -0.5 && fb.leg === 'final') {
        const bad = [];
        if (fb.holding || r.tilt > diff.tilt || r.lateral > diff.lateral) bad.push('HOLDING SHORT · LINING UP');
        if (Math.abs(r.rollRate) > diff.rollRate) bad.push('MATCHING SPIN');
        if (fb.speedSet <= 0.001 && r.closing < 0.01) bad.push('W TO CLOSE IN');
        status = bad.length ? bad.join(' · ') : 'READY FOR CAPTURE · HOLD STEADY'; stCls = bad.length ? 'warn' : 'good';
      } else if (fb.speedSet <= 0.001 && Math.abs(r.closing) < 0.05) { status = 'HOLDING · PRESS W TO GO'; stCls = 'good'; }
      else if (fb.leg !== 'final') status = `AUTOPILOT · ${fb.leg.toUpperCase()}`;
      else status = fb.ctx === 'dock' ? 'AUTOPILOT · LINED UP ON THE PORT' : 'AUTOPILOT · HEADING FOR THE PORT' + (g.warp === 1 ? ' · WARP WITH .' : '');
    } else if (fb && fb.burn && D.state === 'free') {
      // guided burn
      const left = `${fmt(fb.left, fb.left < 10 ? 1 : 0)} m/s`;
      this.cells([[left, fb.label || 'BURN'], [el2.e < 1 ? fmtDist(el2.ra - pl.radius) : 'ESCAPE', 'APOAPSIS'], [fmtDist(el2.rp - pl.radius), 'PERIAPSIS', el2.rp < pl.radius ? 'bad' : null]]);
      if (fb.burn === 'ready') { status = 'BURN NOW · HOLD W'; stCls = 'good'; }
      else if (fb.burn === 'wait') status = `NEXT BURN IN ${formatDuration(Math.max(0, fb.t || 0))} · WARP WITH .`;
      else if (fb.burn === 'turning') { status = 'TURNING TO BURN · KEEP W HELD'; stCls = 'warn'; }
      else if (fb.burn === 'burning') { status = `BURNING · ${left} TO GO`; stCls = 'good'; }
      else if (fb.burn === 'complete') { status = 'BURN COMPLETE'; stCls = 'good'; }
    } else if (docking && D.state === 'free') {
      const tol = diff;
      const vmax = Math.max(tol.closing * 0.8, Math.min(2.0, r.range * 0.02));
      const near = r.range < 30;
      const spinning = Math.abs(rpm(r.spin)) > 0.3;
      const list = [
        [fmtDist(r.range), 'RANGE'],
        [`${fmt(r.closing, r.range < 30 ? 2 : 1)} m/s`, 'CLOSING', r.range < 12 ? (r.closing > tol.closing ? 'bad' : r.closing > 0 ? 'good' : 'warn') : (r.closing > vmax * 1.5 ? 'bad' : r.closing < -0.02 ? 'warn' : null)],
        [near ? `${fmt(r.lateral, 2)} m` : `${fmt(r.corridorAngle, 0)}°`, near ? 'OFF CENTRE' : 'OFF AXIS', near ? (r.lateral > tol.lateral ? 'bad' : 'good') : (r.pos.z < 0 ? 'bad' : r.corridorAngle > 10 ? 'warn' : 'good')],
        spinning ? [`${fmt(r.spinMatch * 100, 0)}%`, 'SPIN MATCH', r.spinMatch > 0.97 ? 'good' : r.range < 60 ? 'bad' : null] : [`${fmt(r.tilt, 1)}°`, 'ALIGNMENT', r.tilt < tol.tilt ? 'good' : r.range < 30 ? 'bad' : null],
      ];
      this.cells(list);
      if (r.range < 15 && r.pos.z > -0.5) {
        const bad = [];
        if (r.closing > tol.closing) bad.push('SLOW DOWN');
        else if (r.closing < 0.005) bad.push('CLOSE IN (W)');
        if (r.lateral > tol.lateral) bad.push('CENTRE UP');
        if (r.tilt > tol.tilt) bad.push('ALIGN');
        if (Math.abs(r.rollRate) > tol.rollRate) bad.push('MATCH SPIN');
        status = bad.length ? bad.join(' · ') : 'READY FOR CAPTURE'; stCls = bad.length ? 'warn' : 'good';
      } else if (r.range > 300 && W.docking.prediction && W.docking.prediction.closest > 200 && r.closing < 0.5) {
        status = `CLOSEST APPROACH ${fmtDist(W.docking.prediction.closest)}`;
      }
    } else if (docking) {
      this.cells([[D.phase(), 'STATUS', 'good'], D.state === 'hard' ? [`${fmt(D.pressure * 100, 0)}%`, 'PRESSURE'] : [`${D.latched} / 12`, 'LATCHES']]);
    } else if (alt < 120000 || K.rho > 1e-7) {
      const surfV = _v.subVectors(b.vel, W.surfaceVelocity(b.pos, _w));
      const vs = b.vel.dot(_w.copy(b.pos).normalize());
      const list = [[fmtDist(alt), 'ALTITUDE'], [`${fmt(surfV.length(), 0)} m/s`, 'SPEED'], [`${vs >= 0 ? '+' : ''}${fmt(vs, 0)} m/s`, 'VERTICAL', vs < -15 && alt < 3000 ? 'bad' : null]];
      if (el2.e < 1 && el2.ra - pl.radius > 2000) list.push([fmtDist(el2.ra - pl.radius), 'APOAPSIS']);
      this.cells(list);
      if (K.q > 22000) { status = `DYNAMIC PRESSURE ${fmt(K.q / 1000, 0)} kPa`; stCls = K.q > 32000 ? 'bad' : 'warn'; }
    } else {
      const list = [[el2.e < 1 ? fmtDist(el2.ra - pl.radius) : 'ESCAPE', 'APOAPSIS'], [fmtDist(el2.rp - pl.radius), 'PERIAPSIS', el2.rp < pl.radius ? 'bad' : null], [`${fmt(b.vel.length(), 0)} m/s`, 'ORBITAL SPEED']];
      if (W.meridianActive) list.push([fmtDist(r.range), 'MERIDIAN']);
      this.cells(list);
    }
    // fuel: one bar + delta-v
    const f = K.fuel / K.capacity;
    const bar = this.mFuel.querySelector('i');
    bar.style.width = (Math.max(0, Math.min(1, f)) * 100).toFixed(1) + '%';
    bar.className = f < 0.05 ? 'bad' : f < 0.15 ? 'warn' : '';
    const thr = K.booster ? K.booster.level : K.cmd.throttle;
    const lbl = `FUEL ${fmt(f * 100, 0)}% · Δv ${fmt(K.booster ? K.deltaVMain() : K.deltaVMain(), 0)} m/s` + (thr > 0.005 ? ` · THROTTLE ${fmt(thr * 100, 0)}%` : '');
    const ln = this.mFuel.querySelector('.lbl');
    if (ln._t !== lbl) { ln.textContent = lbl; ln._t = lbl; }
    if (this.mStatus._t !== status + stCls) { this.mStatus.textContent = status; this.mStatus.className = 'm-status ' + stCls; this.mStatus._t = status + stCls; }
    // time dilation line only where it matters
    const c = this.mObj.querySelector('.c');
    const ct = W.clock.factor > 2 || W.clock.earth > W.clock.ship + 3600 ? `EARTH +${formatDuration(W.clock.earth)}${g.warp > 1 ? ` · WARP ${g.warp}×` : ''}` : (g.warp > 1 ? `WARP ${g.warp}×` : '');
    if (c._t !== ct) { c.textContent = ct; c._t = ct; }
  }

  update(dt) {
    const g = this.game, W = g.world, K = W.kestrel, D = W.docking;
    if (this.root.classList.contains('hidden')) return;
    this.timer -= dt;
    const diff = settings.difficulty;
    const expert = settings.get('difficulty') === 'expert';
    this.updateMarkers();
    if (this.timer > 0) return;
    this.timer = 1 / 12;
    const detail = !!settings.get('hudDetail');
    for (const n of [this.tl, this.tr, this.lm, this.bl]) n.classList.toggle('hidden', !detail);
    for (const n of [this.mObj, this.mStrip, this.mFuel, this.mStatus, this.mHint]) n.classList.toggle('hidden', detail);
    if (!detail) this.updateMinimal(D, diff);
    // clocks
    this.set('ship', formatDuration(W.clock.ship));
    this.set('earth', '+' + formatDuration(W.clock.earth));
    this.set('factor', `dt/dτ ${W.clock.factor >= 100 ? W.clock.factor.toFixed(0) : W.clock.factor.toFixed(3)}`);
    this.set('warp', `${g.warp}×`, g.warp > 1 ? 'warn' : null);
    const b = K.body;
    const pl = W.primary;
    // flight
    const el2 = stateToElements(b.pos, b.vel, pl.gm);
    const alt = b.pos.length() - pl.radius;
    const surfV = _v.subVectors(b.vel, W.surfaceVelocity(b.pos, _w));
    const up = _w.copy(b.pos).normalize();
    this.set('alt', fmtDist(alt));
    this.set('spd', fmt(b.vel.length(), 1) + ' m/s');
    this.set('vs', fmt(b.vel.dot(up), 1) + ' m/s');
    this.set('srf', fmt(surfV.length(), 1) + ' m/s');
    this.set('ap', el2.e < 1 ? fmtDist(el2.ra - pl.radius) : 'ESCAPE', el2.ra - pl.radius < (pl.atmosphere?.top || 0) ? 'warn' : null);
    this.set('pe', fmtDist(el2.rp - pl.radius), el2.rp < pl.radius ? 'bad' : (el2.rp - pl.radius < (pl.atmosphere?.top || 0) ? 'warn' : 'good'));
    this.set('tap', Number.isFinite(el2.tAp) ? formatDuration(el2.tAp) : '---');
    this.set('inc', fmt((el2.inc * 180) / Math.PI, 2) + '°');
    const inAtmo = K.rho > 1e-6;
    this.row('q', inAtmo); this.row('mach', inAtmo); this.row('srf', alt < 200000);
    this.set('q', fmt(K.q / 1000, 1) + ' kPa', K.q > 32000 ? 'bad' : K.q > 22000 ? 'warn' : null);
    this.set('mach', fmt(K.mach, 2));
    const gl = g.pilotG || 0;
    this.set('g', fmt(gl, 2) + ' g', Math.abs(gl) > 4 ? 'bad' : Math.abs(gl) > 2.5 ? 'warn' : null);
    this.set('temp', fmt(K.thermal.T, 0) + ' K', K.thermal.T > 1700 ? 'bad' : K.thermal.T > 1100 ? 'warn' : null);
    // propulsion
    this.set('fuel', `${fmt(K.fuel, 0)} kg`, K.fuel < 300 ? 'bad' : K.fuel < 1500 ? 'warn' : null);
    this.bar('fuel', K.fuel / K.capacity);
    const dvm = K.deltaVMain(), dvr = K.deltaVRcs();
    this.set('dvm', fmt(dvm, 0) + ' m/s', dvm < 60 ? 'bad' : null);
    this.set('dvr', fmt(dvr, 1) + ' m/s', dvr < 12 ? 'bad' : dvr < 30 ? 'warn' : null);
    const thr = K.booster ? K.booster.level : K.cmd.throttle;
    this.set('thr', fmt(thr * 100, 0) + '%' + (K.booster ? ' S1' : ''));
    this.bar('thr', thr);
    this.set('rcs', K.rcsMode.toUpperCase(), K.rcsMode === 'coarse' ? 'warn' : null);
    this.set('rcst', fmt(K.rcsHeat, 0) + ' K', K.rcsHeat > 1150 ? 'bad' : K.rcsHeat > 900 ? 'warn' : null);
    this.set('hull', fmt(K.hull, 0) + '%', K.hull < 40 ? 'bad' : K.hull < 75 ? 'warn' : 'good');
    this.bar('hull', K.hull / 100);
    this.set('mass', `${fmt(b.mass / 1000, 2)} t / ${fmt(b.comBody.z, 2)}`);
    // docking
    const showDock = W.meridianActive && (D.rel.range < 8000 || D.state !== 'free');
    this.br.classList.toggle('hidden', !showDock || !detail);
    if (showDock) this.updateDocking(D, diff, expert);
    // phase banner
    const ph = this.phaseText || (showDock ? D.phase() : '');
    this.phase.querySelector('.name').textContent = ph;
    this.phase.querySelector('.sub').textContent = this.phaseSub || (detail && showDock && D.state === 'free' ? `range ${fmtDist(D.rel.range)} · closing ${fmt(D.rel.closing, 2)} m/s` : '');
    // assist line
    const p = g.pilot;
    const a = [];
    if (p.fbw?.auto) a.push(p.fbw.auto);
    if (p.fbw && p.fbw.ctx !== 'free' && p.fbw.speedSet !== undefined) a.push(`SPEED SET ${fmt(p.fbw.speedSet, 2)} m/s (SAFE ${fmt(p.fbw.vSafe, 2)})`);
    if (p.attMode) a.push('HOLD ' + p.attMode.toUpperCase());
    if (!diff.helpers) a.length = 0;
    if (detail) a.push(p.camMode === 'dock' ? 'DOCK CAM' : p.camMode.toUpperCase());
    this.assist.textContent = a.join('  ·  ');
    this.updateWarnings();
    this.updateFD(diff);
    this.screenTimer -= 1 / 12;
    if (this.screenTimer <= 0) { this.screenTimer = 0.5; this.drawScreens(); }
  }

  updateDocking(D, diff, expert) {
    const r = D.rel;
    const tol = diff;
    const vmax = Math.max(tol.closing * 0.8, Math.min(2.0, r.range * 0.02));
    this.set('rng', fmtDist(r.range));
    this.set('cls', fmt(r.closing, 3) + ' m/s', r.range < 12 ? (r.closing > tol.closing ? 'bad' : r.closing > 0 ? 'good' : 'warn') : (r.closing > vmax * 1.5 ? 'bad' : null));
    // far out, rotating-frame X/Y just spin around: show off-axis distance
    // and corridor angle instead
    const near = r.range < 30;
    this.label('lx', near ? 'Lateral X' : 'Off-axis');
    this.label('ly', near ? 'Lateral Y' : 'Corridor angle');
    if (near) {
      this.set('lx', fmt(r.pos.x, 3) + ' m', r.range < 12 ? (Math.abs(r.pos.x) > tol.lateral ? 'bad' : 'good') : null);
      this.set('ly', fmt(r.pos.y, 3) + ' m', r.range < 12 ? (Math.abs(r.pos.y) > tol.lateral ? 'bad' : 'good') : null);
    } else {
      this.set('lx', fmtDist(r.lateral));
      this.set('ly', fmt(r.corridorAngle, 1) + '°', r.pos.z < 0 ? 'bad' : r.corridorAngle > 10 ? 'warn' : 'good');
    }
    // lateral velocity vs the port centre far out; vs the actual port surface
    // (including its spin velocity w x r) once contact is possible
    const lv = near ? r.latVel : Math.hypot(r.vel.x, r.vel.y);
    this.label('lv', near ? 'Lateral vel (surface)' : 'Lateral vel');
    this.set('lv', fmt(lv, 3) + ' m/s', near && r.latVel > tol.lateralVel ? 'bad' : null);
    this.set('pit', fmt(r.pitch, 2) + '°', Math.abs(r.pitch) > tol.tilt ? 'bad' : 'good');
    this.set('yaw', fmt(r.yaw, 2) + '°', Math.abs(r.yaw) > tol.tilt ? 'bad' : 'good');
    this.set('rol', fmt(r.roll, 1) + '°', Math.abs(r.roll) > tol.roll ? 'bad' : 'good');
    this.set('spin', `${fmt(rpm(r.spin), 2)} RPM`);
    this.set('rr', fmt(r.rollRate, 4) + ' rad/s', Math.abs(r.rollRate) > tol.rollRate ? 'bad' : 'good');
    this.set('tan', r.range < 60 ? fmt(r.tangential, 3) + ' m/s' : `${fmt(r.axisOffset, 1)} m off axis`, r.range < 60 && r.tangential > tol.lateralVel ? 'bad' : null);
    this.set('dl', `${fmt(r.dLmag / 1000, 1)} kN·m·s`, r.dLmag > 8000 ? 'warn' : null);
    const pr = D.prediction;
    this.set('ca', pr && D.state === 'free' ? `${fmtDist(pr.closest)} @ ${formatDuration(pr.tClosest)}` : '---');
    this.set('sm', fmt(r.spinMatch * 100, 1) + '%', r.spinMatch > 0.97 ? 'good' : null);
    this.bar('sm', r.spinMatch);
    const set = (k, ok) => { const n = this.env[k]; const c = ok ? 'ok' : 'no'; if (n._c !== c) { n.className = c; n._c = c; } };
    set('CLOSE', r.closing < tol.closing && r.closing > -0.01);
    set('LAT', r.lateral < tol.lateral);
    set('TILT', r.tilt < tol.tilt);
    set('ROLL', Math.abs(r.roll) < tol.roll);
    set('SPIN', Math.abs(r.rollRate) < tol.rollRate);
    set('DRIFT', r.latVel < tol.lateralVel);
    this.root.querySelector('.spinmeter').style.display = expert ? 'none' : '';
    this.root.querySelector('.envelope').style.display = expert ? 'none' : '';
  }

  updateWarnings() {
    const g = this.game, K = g.world.kestrel;
    const w = [];
    if (K.q > 26000) w.push(['MAX Q', '']);
    if (K.thermal.T > 1500) w.push(['HULL TEMP', '']);
    if (K.rcsHeat > 950) w.push(['RCS JET TEMP', K.rcsHeat > 1150 ? '' : 'caution']);
    if (K.hull < 50) w.push(['HULL INTEGRITY', '']);
    if (K.fuel < K.capacity * 0.05 && K.fuel > 0) w.push(['LOW PROPELLANT', 'caution']);
    if (K.fuel <= 0) w.push(['PROPELLANT DEPLETED', '']);
    if (Math.abs(g.pilotG || 0) > 3.5) w.push(['G-LOAD', '']);
    for (const x of g.extraWarnings || []) w.push(x);
    const html = w.map(([t, c]) => `<div class="w ${c}">${t}</div>`).join('');
    if (html !== this._warn) { this.warnings.innerHTML = html; this._warn = html; }
    this.activeWarnings = w.length;
  }

  // Flight director: shows the velocity error the pilot should null (dot)
  // and the closing-speed target (bar) for the docking corridor.
  updateFD(diff) {
    const g = this.game, W = g.world, D = W.docking;
    const on = diff.guidance && W.meridianActive && D.state === 'free' && D.rel.range < 150 && g.mode === 'flight';
    this.fd.classList.toggle('hidden', !on);
    if (!on) return;
    const r = D.rel;
    // desired lateral velocity: drive offsets to zero with a ~25 s time constant
    const tau = Math.max(8, Math.min(40, r.range * 0.6));
    const dvx = -r.pos.x / tau - r.vel.x, dvy = -r.pos.y / tau - r.vel.y;
    const vTarget = Math.max(diff.closing * 0.6, Math.min(1.5, r.range * 0.012));
    const dvz = vTarget - r.closing;
    // express desired dv in the Kestrel body frame (pilot's view)
    const S = W.meridian.body, K = W.kestrel.body;
    _v.set(dvx, dvy, -dvz).applyQuaternion(S.quat).applyQuaternion(_q.copy(K.quat).invert());
    const s = 60 / 0.2;
    const x = Math.max(-62, Math.min(62, _v.x * s)), y = Math.max(-62, Math.min(62, -_v.y * s));
    this.fdEls.dot.setAttribute('cx', x.toFixed(1)); this.fdEls.dot.setAttribute('cy', y.toFixed(1));
    this.fdEls.vec.setAttribute('x2', x.toFixed(1)); this.fdEls.vec.setAttribute('y2', y.toFixed(1));
    const ax = Math.max(-60, Math.min(60, -_v.z * s));
    this.fdEls.ax.setAttribute('y', Math.min(0, -ax).toFixed(1));
    this.fdEls.ax.setAttribute('height', Math.abs(ax).toFixed(1));
    const hints = [];
    if (_v.x > 0.01) hints.push('D'); else if (_v.x < -0.01) hints.push('A');
    if (_v.y > 0.01) hints.push('R'); else if (_v.y < -0.01) hints.push('F');
    if (_v.z < -0.01) hints.push('W'); else if (_v.z > 0.01) hints.push('S');
    this.fdEls.hint.textContent = hints.length ? 'THRUST ' + hints.join(' ') : 'ON PROFILE';
  }

  // ---- projected markers -----------------------------------------------------
  updateMarkers() {
    const g = this.game, W = g.world, cam = g.pipeline.camera;
    const w = window.innerWidth, h = window.innerHeight;
    const show = new Set();
    const put = (id, worldRel, icon, cls, label, clampEdge = false) => {
      _v.copy(worldRel).project(cam);
      const behind = _v.z > 1;
      if (behind && !clampEdge) return;
      let x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * h;
      if (behind) { x = w - x; y = h - y; }
      if (clampEdge) { x = Math.max(24, Math.min(w - 24, x)); y = Math.max(24, Math.min(h - 24, y)); }
      else if (x < -40 || x > w + 40 || y < -40 || y > h + 40) return;
      let m = this.markerEls.get(id);
      if (!m) { m = el('div', 'marker'); m.innerHTML = ICONS[icon] + '<div class="lbl"></div>'; this.markers.appendChild(m); this.markerEls.set(id, m); }
      m.className = 'marker ' + (cls || '');
      m.style.left = x.toFixed(0) + 'px'; m.style.top = y.toFixed(0) + 'px';
      const l = m.querySelector('.lbl');
      if (l._t !== label) { l.textContent = label; l._t = label; }
      show.add(id);
    };
    if (g.mode === 'flight' && !g.mapOpen && !(g.pilot.camMode === 'dock')) {
      const K = W.kestrel.body;
      const camPos = cam.position;
      const D = W.docking;
      const near = W.meridianActive && D.rel.range < 3000;
      // velocity markers: target-relative near the Meridian, else orbital/surface
      let v;
      if (near) v = _w.copy(D.rel.vel).applyQuaternion(W.meridian.body.quat);
      else if (K.pos.length() - W.primary.radius < 30000) v = _w.subVectors(K.vel, W.surfaceVelocity(K.pos, new Vector3()));
      else v = _w.copy(K.vel);
      if (v.length() > 0.005) {
        const dir = v.clone().normalize();
        const tag = near ? ` ${v.length().toFixed(2)}` : '';
        put('pro', camPos.clone().addScaledVector(dir, 1000), 'prograde', 'green', near ? `DRIFT${tag}` : 'PROGRADE');
        if (settings.get('hudDetail')) put('retro', camPos.clone().addScaledVector(dir, -1000), 'retrograde', 'amber', near ? 'DRIFT−' : 'RETRO');
      }
      if (W.meridianActive && D.state === 'free') {
        const pw = D.rel.portWorld.clone().sub(g.pipeline.origin);
        put('port', pw, 'target', 'green', `PORT ${fmtDist(D.rel.range)}`, true);
      }
      for (const [name, c] of this.cues) {
        const p = c.worldRel ? c.worldRel : camPos.clone().addScaledVector(c.dir, 1000);
        put('cue-' + name, p, c.icon || 'cue', c.cls || '', c.label || '', !!c.clamp);
      }
    }
    for (const [id, m] of this.markerEls) m.style.display = show.has(id) ? '' : 'none';
  }

  // cockpit MFDs: attitude/range readouts on canvas textures
  drawScreens() {
    const g = this.game;
    const km = g.kestrelModel;
    if (!km.cockpit.group.visible) return;
    const W = g.world, K = W.kestrel, D = W.docking;
    const [s0, s1, s2] = km.cockpit.screens;
    const draw = (s, fn) => { const c = s.ctx; c.fillStyle = '#03070a'; c.fillRect(0, 0, 512, 320); c.strokeStyle = '#1f4d5c'; c.lineWidth = 3; c.strokeRect(4, 4, 504, 312); fn(c); s.tex.needsUpdate = true; };
    draw(s0, (c) => {
      c.fillStyle = '#7fd8ff'; c.font = '600 30px Share Tech Mono, monospace';
      c.fillText('PROP', 24, 52); c.fillText(`${K.fuel.toFixed(0)} KG`, 24, 92);
      c.fillText(`DV ${K.deltaVMain().toFixed(0)}`, 24, 140);
      c.fillText(`RCS ${K.rcsMode.toUpperCase()}`, 24, 188);
      c.fillText(`HULL ${K.hull.toFixed(0)}%`, 24, 236);
      c.fillStyle = K.hull > 60 ? '#6dff9c' : '#ff5a4a'; c.fillRect(24, 256, 4.6 * K.hull, 18);
    });
    draw(s1, (c) => {
      const r = D.rel;
      c.fillStyle = '#f0b44c'; c.font = '600 28px Share Tech Mono, monospace';
      c.fillText(D.phase(), 24, 46);
      c.font = '600 46px Share Tech Mono, monospace'; c.fillStyle = '#e9e6dc';
      c.fillText(`${fmtDist(r.range)}`, 24, 110);
      c.font = '600 28px Share Tech Mono, monospace'; c.fillStyle = '#f0b44c';
      c.fillText(`RR ${(-r.closing).toFixed(3)}`, 24, 154);
      c.fillText(`LAT ${r.lateral.toFixed(2)}`, 24, 194);
      // crosshair with offset dot
      c.strokeStyle = '#2c6e86'; c.beginPath(); c.arc(400, 170, 90, 0, 7); c.moveTo(310, 170); c.lineTo(490, 170); c.moveTo(400, 80); c.lineTo(400, 260); c.stroke();
      const sx = Math.max(-90, Math.min(90, r.pos.x * 120)), sy = Math.max(-90, Math.min(90, -r.pos.y * 120));
      c.fillStyle = r.envelope ? '#6dff9c' : '#ff5a4a'; c.beginPath(); c.arc(400 + sx, 170 + sy, 9, 0, 7); c.fill();
    });
    draw(s2, (c) => {
      c.fillStyle = '#7fd8ff'; c.font = '600 28px Share Tech Mono, monospace';
      c.fillText(`SPIN ${rpm(D.rel.spin).toFixed(2)} RPM`, 24, 52);
      c.fillText(`ROLL ${rpm(D.rel.kestrelSpin).toFixed(2)} RPM`, 24, 96);
      c.fillText(`MATCH ${(D.rel.spinMatch * 100).toFixed(1)}%`, 24, 140);
      c.fillStyle = '#6dff9c'; c.fillRect(24, 160, 460 * D.rel.spinMatch, 22);
      c.fillStyle = '#7fd8ff';
      c.fillText(`G ${(g.pilotG || 0).toFixed(2)}`, 24, 236);
      c.fillText(`T ${K.thermal.T.toFixed(0)}K`, 260, 236);
    });
  }
}
