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
import { settings } from '../core/settings.js';

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
    this.fade = div('fadeblack');
    root.append(this.banner, this.toastBox, this.promptEl, this.objectivesEl, this.caption, this.coriolis, this.crosshair, this.fpsEl);
    this.extra = div('');
    root.appendChild(this.extra);
    root.appendChild(this.fade);
    this.debug = new DebugOverlay(game, root);
    this.map = new MapView(game, root);
    this.menus = new Menus(game, root);
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
    this.fpsEl.textContent = settings.get('showFps') ? `${g.fps.toFixed(0)} fps · ${g.loop.stepsLastFrame} steps` : '';
  }

  handleGlobalKeys(input) {
    const g = this.game;
    if (g.mode === 'title') return;
    if (input.hit('Escape')) {
      if (this.menus.open && g.paused) { g.setPaused(false); return; }
      if (g.mapOpen) { g.mapOpen = false; return; }
      g.setPaused(true);
      return;
    }
    if (g.paused) return;
    if (input.hit('Tab')) this.objectivesEl.classList.toggle('hidden');
    if (input.hit('KeyM') && g.mode === 'flight' && !g.cutscene) { g.mapOpen = !g.mapOpen; }
    if (input.hit('KeyP')) this.debug.toggle();
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
      <div class="keys">Tab close · Esc pause · P physics overlay · M map · C camera · , . warp</div>`;
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
  setCoriolis(text) { if (this._cor !== text) { this.coriolis.innerHTML = text || ''; this._cor = text; } }
}
