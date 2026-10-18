// UI manager: owns HUD layers, subtitles, banners, prompts, objectives,
// cinematic letterbox/captions, menus, map view and the debug overlay, and
// handles global keys (Esc, Tab, M, P).

import './styles.css';
import { HUD } from './hud.js';
import { DockingCameraOverlay } from './dockingCamera.js';
import { Subtitles } from './subtitles.js';
import { Menus } from './menus.js';
import { DebugOverlay } from './debugOverlay.js';
import { MapView } from './mapView.js';
import { ControlsCard } from './controlsCard.js';
import { Vector3 } from 'three';
import { settings } from '../core/settings.js';
import { formatDuration } from '../physics/timeDilation.js';

const div = (cls, html = '') => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; return e; };

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.letterbox = div('letterbox');
    this.letterbox.style.cssText = 'position:absolute;inset:0';
    root.appendChild(this.letterbox);
    this.hud = new HUD(game, root);
    this.dockcam = new DockingCameraOverlay(game, root);
    this.subs = new Subtitles(game, root);
    this.banner = div('banner');
    this.toastBox = div('toast');
    this.promptEl = div('prompt hidden');
    this.objectivesEl = div('objectives hidden');
    this.caption = div('caption');
    this.coriolis = div('coriolis');
    this.crosshair = div('crosshair hidden');
    this.fpsEl = div('fps');
    this.miniClock = div('miniclock hidden');
    this.fade = div('fadeblack');
    this.waypointEl = div('waypoint hidden', '<div class="wp-icon"><svg width="22" height="22" viewBox="-11 -11 22 22"><path d="M0-9L9 0L0 9L-9 0Z" fill="none" stroke="currentColor" stroke-width="2"/><circle r="2.2" fill="currentColor"/></svg></div><div class="wp-arrow">▲</div><div class="wp-lbl"></div>');
    root.append(this.banner, this.toastBox, this.promptEl, this.objectivesEl, this.caption, this.coriolis, this.crosshair, this.fpsEl, this.miniClock, this.waypointEl);
    this.extra = div('');
    root.appendChild(this.extra);
    root.appendChild(this.fade);
    this.debug = new DebugOverlay(game, root);
    this.map = new MapView(game, root);
    this.menus = new Menus(game, root);
    this.controls = new ControlsCard(game, root);
    for (const ev of ['mode', 'player:walk', 'player:float', 'player:ladder']) game.on(ev, () => setTimeout(() => this.controls.modeChanged(), 0));
    this.objectives = { title: '', sub: '', items: [] };
    this.bannerTimer = 0;
    this.promptState = null;
  }

  // ---- mode-dependent layer visibility ---------------------------------------
  frame(dt) {
    const g = this.game;
    const flight = g.mode === 'flight' && !g.cutscene && !g.paused && !this.menus.open;
    const dockcam = flight && g.pilot.camMode === 'dock' && !g.mapOpen;
    this.hud.show(flight && !dockcam && !g.mapOpen);
    this.dockcam.show(dockcam);
    this.hud.update(dt);
    this.dockcam.update(dt);
    this.subs.update(dt);
    this.map.show(g.mapOpen && g.mode === 'flight');
    this.debug.update(dt);
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.banner.classList.remove('show'); }
    this.crosshair.classList.toggle('hidden', !(g.mode === 'interior' || g.mode === 'surface') || g.cutscene || this.menus.open);
    // compact mission clock + objective while on foot (time keeps dilating)
    const onFoot = (g.mode === 'interior' || g.mode === 'surface') && !g.cutscene && !this.menus.open;
    this.miniClock.classList.toggle('hidden', !onFoot);
    if (onFoot) {
      this._mc = (this._mc || 0) - dt;
      if (this._mc <= 0) {
        this._mc = 0.2;
        const W = g.world;
        const f = W.clock.factor;
        const cur = this.objectives.items.find((i) => !i.done);
        const detail = settings.get('hudDetail');
        const clocks = detail || f > 2 || W.clock.earth > W.clock.ship + 3600;
        const html = `<div class="o">${cur ? cur.text : ''}</div>${clocks ? `${detail ? `<div>SHIP ${formatDuration(W.clock.ship)}</div>` : ''}<div class="e">EARTH +${formatDuration(W.clock.earth)}</div>` : ''}${f > 10 ? `<div class="f">1 s here = ${formatDuration(f)} on Earth</div>` : ''}`;
        if (html !== this._mcHtml) { this.miniClock.innerHTML = html; this._mcHtml = html; }
      }
    }
    this.updateWaypoint();
    this.fpsEl.textContent = settings.get('showFps') ? `${g.fps.toFixed(0)} fps · ${g.loop.stepsLastFrame} steps` : '';
  }

  // aboard the station: marker on the next waypoint toward the objective
  updateWaypoint() {
    const g = this.game, ip = g.interiorPlayer, el = this.waypointEl;
    let wp = null, root = null, from = null;
    if (!g.cutscene && !this.menus.open) {
      if (g.mode === 'interior' && ip?.waypoint) { wp = ip.waypoint; root = g.meridianModel.root; from = ip.camLocal; }
      else if (g.mode === 'surface' && g.surface && g.controller?.walker) {
        wp = g.mission?.surfaceTarget?.();
        root = g.surface.group;
        from = g.controller.walker.pos.clone().add(new Vector3(0, 1.6, 0));
      }
    }
    if (!wp) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const cam = g.pipeline.camera;
    root.updateMatrixWorld();
    const p = wp.pos.clone().applyMatrix4(root.matrixWorld);
    const dist = from.distanceTo(wp.pos);
    const v = p.clone().project(cam);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    const m = 60;
    const off = behind || x < m || x > w - m || y < m || y > h - m;
    if (off) {
      // pin to the screen edge, arrow pointing toward the target
      let dx = x - w / 2, dy = y - h / 2;
      if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
      const k = Math.min((w / 2 - m) / Math.max(1e-3, Math.abs(dx)), (h / 2 - m) / Math.max(1e-3, Math.abs(dy)));
      x = w / 2 + dx * k; y = h / 2 + dy * k;
      el.querySelector('.wp-arrow').style.transform = `rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
    }
    el.classList.toggle('off', off);
    el.style.left = x.toFixed(0) + 'px'; el.style.top = y.toFixed(0) + 'px';
    const txt = `${wp.label} · ${dist < 10 ? dist.toFixed(1) : dist.toFixed(0)} m`;
    const lbl = el.querySelector('.wp-lbl');
    if (lbl._t !== txt) { lbl.textContent = txt; lbl._t = txt; }
  }

  handleGlobalKeys(input) {
    const g = this.game;
    if (g.mode === 'title' || g.cardOpen) return;
    if (input.hit('Escape')) {
      if (this.menus.open && g.paused) { g.setPaused(false); return; }
      if (g.mapOpen) { g.mapOpen = false; return; }
      g.setPaused(true);
      return;
    }
    if (g.paused) return;
    if (input.hit('Tab')) {
      const show = this.objectivesEl.classList.contains('hidden');
      if (show) this.renderObjectives();
      this.objectivesEl.classList.toggle('hidden', !show);
    }
    if (input.hit('KeyM') && g.mode === 'flight' && !g.cutscene) { g.mapOpen = !g.mapOpen; }
    if (input.hit('KeyP')) this.debug.toggle();
    if (input.hit('KeyI')) { settings.set('hudDetail', !settings.get('hudDetail')); this.toast(settings.get('hudDetail') ? 'INSTRUMENTS · FULL' : 'INSTRUMENTS · MINIMAL'); }
  }

  setObjectives(title, sub, items) {
    this.objectives = { title, sub, items };
    this.renderObjectives();
    const cur = items.find((i) => !i.done);
    this.hud.setObjective(title, cur ? cur.text : '');
  }
  completeObjective(id) {
    const it = this.objectives.items.find((i) => i.id === id);
    if (it && !it.done) { it.done = true; this.renderObjectives(); this.toast('OBJECTIVE COMPLETE'); this.game.audio?.blip?.('good'); }
    const cur = this.objectives.items.find((i) => !i.done);
    this.hud.setObjective(this.objectives.title, cur ? cur.text : '');
  }
  renderObjectives() {
    const o = this.objectives;
    this.objectivesEl.innerHTML = `<h3>${o.title}</h3><div class="sub">${o.sub || ''}</div><ul style="padding:0">${o.items.map((i) => `<li class="${i.done ? 'done' : 'todo'}">${i.text}</li>`).join('')}</ul>
      ${this.controls ? this.controls.tabHtml() : ''}<div class="keys">Tab close · P physics overlay</div>`;
  }

  showBanner(text, cls = 'white', dur = 3.5, small = '') {
    this.banner.className = `banner ${cls} show`;
    this.banner.innerHTML = `${text}${small ? `<span class="small">${small}</span>` : ''}`;
    this.bannerTimer = dur;
  }
  toast(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.toastBox.appendChild(d);
    setTimeout(() => d.remove(), 3200);
  }
  // prompt('E', 'Open hatch', holdFraction)
  prompt(key, text, hold = null) {
    if (!key) { this.promptEl.classList.add('hidden'); this.promptState = null; return; }
    const st = `${key}|${text}|${hold === null ? '' : hold.toFixed(2)}`;
    if (st === this.promptState) return;
    this.promptState = st;
    this.promptEl.classList.remove('hidden');
    this.promptEl.innerHTML = `<kbd>${key}</kbd>${text}${hold !== null ? `<span class="hold"><i style="width:${(hold * 100).toFixed(0)}%"></i></span>` : ''}`;
  }
  setLetterbox(on) { this.letterbox.classList.toggle('on', on); }
  showCaption(big, small, dur = 5) {
    this.caption.innerHTML = `<span class="big">${big}</span>${small || ''}`;
    this.caption.classList.add('show');
    clearTimeout(this._capT);
    this._capT = setTimeout(() => this.caption.classList.remove('show'), dur * 1000);
  }
  setFade(on) { this.fade.classList.toggle('on', on); }
  // quick dip to black that hides a camera cut
  flashFade() {
    const f = this.fade;
    f.style.transition = 'none';
    f.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity 0.45s'; f.style.opacity = ''; setTimeout(() => { f.style.transition = ''; }, 500); }));
  }
  setCoriolis(text) { const t = settings.get('hudDetail') ? text : ''; if (this._cor !== t) { this.coriolis.innerHTML = t || ''; this._cor = t; } }
}
