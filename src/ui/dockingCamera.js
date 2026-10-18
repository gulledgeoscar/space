// Nose docking-camera overlay: crosshair, range ticks, attitude bars and
// raw telemetry over the grainy monochrome feed (the feed itself is the
// post-FX pass rendering from the nose camera).

import { settings } from '../core/settings.js';
import { fmtDist } from './hud.js';

export class DockingCameraOverlay {
  constructor(game, root) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'dockcam hidden';
    this.root.innerHTML = `
      <svg viewBox="-500 -300 1000 600" preserveAspectRatio="xMidYMid slice">
        <g stroke="rgba(200,255,214,0.85)" stroke-width="1.6" fill="none">
          <circle r="22"/><circle r="120" stroke-dasharray="4 8"/>
          <path d="M-300 0H-40M40 0H300M0-220V-40M0 40V220"/>
          <g data-ticks></g>
          <rect data-tgt x="-30" y="-30" width="60" height="60" stroke="rgba(255,255,255,0.0)"/>
          <path data-pitch d="M-260 0h20"/>
          <path data-yaw d="M0 -200v20"/>
          <path data-roll d="M-60 -150 L60 -150" stroke-width="2.2"/>
        </g>
        <g fill="rgba(200,255,214,0.9)" font-family="Share Tech Mono" font-size="12" data-labels></g>
      </svg>
      <div class="txt tl"><div>CAM 1  NOSE  CL-A</div><div data-d="phase"></div></div>
      <div class="txt tr"><div class="rec">● REC</div><div data-d="time"></div></div>
      <div class="txt bl"><div data-d="rng"></div><div data-d="rr"></div><div data-d="lat"></div></div>
      <div class="txt br"><div data-d="att"></div><div data-d="spin"></div><div data-d="env"></div></div>`;
    root.appendChild(this.root);
    this.d = {};
    for (const n of this.root.querySelectorAll('[data-d]')) this.d[n.dataset.d] = n;
    // range ticks along the vertical axis (log scale, labels set each frame)
    const ticks = this.root.querySelector('[data-ticks]');
    let s = '';
    for (let i = -10; i <= 10; i++) if (i) s += `<path d="M${-8 + (i % 5 ? 3 : 0)} ${i * 20}H${8 - (i % 5 ? 3 : 0)}"/>`;
    for (let i = -14; i <= 14; i++) if (i) s += `<path d="M${i * 20} ${-6 + (i % 5 ? 3 : 0)}V${6 - (i % 5 ? 3 : 0)}"/>`;
    ticks.innerHTML = s;
    this.pitch = this.root.querySelector('[data-pitch]');
    this.yaw = this.root.querySelector('[data-yaw]');
    this.rollEl = this.root.querySelector('[data-roll]');
    this.timer = 0;
  }

  show(on) { this.root.classList.toggle('hidden', !on); }

  update(dt) {
    if (this.root.classList.contains('hidden')) return;
    this.timer -= dt;
    const W = this.game.world, D = W.docking, r = D.rel;
    // attitude bars move continuously
    const k = 40;
    this.pitch.setAttribute('d', `M-280 ${(-r.pitch * k).toFixed(1)}h40`);
    this.yaw.setAttribute('d', `M${(r.yaw * k).toFixed(1)} -220v40`);
    const a = (-r.roll * Math.PI) / 180;
    this.rollEl.setAttribute('d', `M${(-60 * Math.cos(a)).toFixed(1)} ${(-150 - 60 * Math.sin(a)).toFixed(1)} L${(60 * Math.cos(a)).toFixed(1)} ${(-150 + 60 * Math.sin(a)).toFixed(1)}`);
    if (this.timer > 0) return;
    this.timer = 0.1;
    const tol = settings.difficulty;
    this.d.phase.textContent = D.phase();
    const t = W.clock.ship;
    this.d.time.textContent = `MET ${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(Math.floor(t) % 60).padStart(2, '0')}.${String(Math.floor((t % 1) * 10))}`;
    this.d.rng.textContent = `RNG  ${fmtDist(r.range)}`;
    this.d.rr.textContent = `RDOT ${(-r.closing).toFixed(3)} M/S`;
    this.d.lat.textContent = `X ${r.pos.x.toFixed(3)}  Y ${r.pos.y.toFixed(3)}  V ${r.latVel.toFixed(3)}`;
    this.d.att.textContent = `P ${r.pitch.toFixed(2)}°  Y ${r.yaw.toFixed(2)}°  R ${r.roll.toFixed(1)}°`;
    this.d.spin.textContent = `ΔΩ ${r.rollRate.toFixed(4)} RAD/S  TAN ${r.tangential.toFixed(3)}`;
    this.d.env.textContent = D.state !== 'free' ? D.phase() : (r.envelope ? 'CAPTURE ENVELOPE  GO' : 'CAPTURE ENVELOPE  NO-GO');
    this.d.env.style.color = r.envelope || D.state !== 'free' ? '#9dffb8' : '#ff8f80';
    void tol;
  }
}
