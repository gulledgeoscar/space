// Title screen, mission select, settings, controls, pause and results.

import { settings } from '../core/settings.js';
import { progress } from '../core/save.js';

export const MISSIONS = [
  { id: 1, title: 'LAUNCH & FIRST DOCK', desc: 'Flip the startup switches, fly a real gravity turn to orbit, chase down the Meridian and learn why pointing at it is wrong.',
    stages: [['launch', 'Pad'], ['orbit', 'Orbit'], ['rendezvous', 'Rendezvous (2 km)']] },
  { id: 2, title: 'WALK THE SHIP', desc: 'Float out through the hub, climb down a spoke as gravity builds and the Coriolis force shoves you sideways. Briefing on the bridge.',
    stages: [['hub', 'Hub']] },
  { id: 3, title: 'UNDOCK & PELAGIA', desc: 'Undock inside the burn window. Land in 1.3 g on the ocean world, recover a beacon while years slip by, outrun the tide, re-dock on fumes.',
    stages: [['bridge', 'Bridge'], ['undock', 'Undock'], ['descent', 'Descent'], ['surface', 'Surface'], ['ascent', 'Ascent'], ['redock', 'Re-dock']] },
  { id: 4, title: 'SKADI', desc: 'Fog, snow and frozen clouds. A colleague whose data lied. A lander that leaves without you - and a docking no one should attempt.',
    stages: [['bridge', 'Bridge'], ['descent', 'Descent'], ['surface', 'Surface'], ['ascent', 'Ascent']] },
  { id: 5, title: 'THE SPIN DOCK', desc: 'The Meridian is spinning at 65 RPM, venting, wobbling and shedding debris. Match its rotation and dock. Then stop it.',
    stages: [['approach', 'Approach']] },
  { id: 6, title: 'FREE DOCK', desc: 'Randomised orbit, spin rate, geometry and fuel. Scored on time, Δv used and precision at capture.', stages: [] },
];

const h = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };

export class Menus {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.stack = [];
    this.el = document.createElement('div');
    root.appendChild(this.el);
  }

  clear() { this.el.innerHTML = ''; this.stack = []; this.current = null; }
  get open() { return !!this.current; }

  showPanel(node, center = false) {
    this.el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'menu interactive' + (center ? ' center' : '');
    wrap.appendChild(node);
    this.el.appendChild(wrap);
    this.current = wrap;
    this.game.input.exitLock();
  }

  title() {
    const box = h(`<div class="box">
      <h1>MERIDIAN</h1>
      <div class="tag">EVERY DOCKING IS A MATTER OF PHYSICS</div>
      <button data-a="continue">CONTINUE<span class="meta">Mission ${progress.unlocked}</span></button>
      <button data-a="missions">MISSION SELECT</button>
      <button data-a="settings">SETTINGS</button>
      <button data-a="controls">CONTROLS</button>
      <div class="note">Real 6-DOF rigid-body physics at 120 Hz · Clohessy–Wiltshire relative motion · Kerr time dilation · lensed black hole.<br>Headphones recommended.</div>
    </div>`);
    box.querySelector('[data-a=continue]').onclick = () => this.game.startMission(Math.min(progress.unlocked, 5));
    box.querySelector('[data-a=missions]').onclick = () => this.missions();
    box.querySelector('[data-a=settings]').onclick = () => this.settingsPanel(() => this.title());
    box.querySelector('[data-a=controls]').onclick = () => this.controls(() => this.title());
    this.showPanel(box);
  }

  missions() {
    const box = h('<div class="box" style="width:min(620px,92vw)"><h2>MISSIONS</h2><div data-list></div><button data-a="back">BACK</button></div>');
    const list = box.querySelector('[data-list]');
    for (const m of MISSIONS) {
      const ok = progress.isUnlocked(m.id);
      const b = h(`<button ${ok ? '' : 'disabled'}>${m.id}. ${m.title}<span class="meta">${ok ? '' : 'LOCKED'}</span><span class="desc">${m.desc}</span></button>`);
      b.onclick = () => this.game.startMission(m.id);
      list.appendChild(b);
      if (ok && m.stages.length > 1) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin:-2px 0 8px 14px';
        for (const [sid, name] of m.stages.slice(1)) {
          if (!progress.reachedStage(m.id, sid)) continue;
          const sb = h(`<button style="width:auto;padding:4px 10px;font-size:12px">↳ ${name}</button>`);
          sb.onclick = () => this.game.startMission(m.id, sid);
          row.appendChild(sb);
        }
        if (row.children.length) list.appendChild(row);
      }
    }
    box.querySelector('[data-a=back]').onclick = () => this.title();
    if (progress.scores.length) {
      const sc = h(`<div class="scores" style="margin:14px 0"><div><b>FREE DOCK — BEST</b><span></span></div>${progress.scores.map((s, i) => `<div><span>${i + 1}. ${s.label}</span><span>${s.score}</span></div>`).join('')}</div>`);
      box.insertBefore(sc, box.querySelector('[data-a=back]'));
    }
    this.showPanel(box);
  }

  settingsPanel(back) {
    const v = settings.values;
    const box = h(`<div class="box"><h2>SETTINGS</h2><div class="settings">
      <div class="srow">Mouse sensitivity <input type="range" min="0.2" max="3" step="0.05" data-s="mouseSensitivity"></div>
      <div class="srow">Invert mouse Y <select data-s="invertY" data-bool><option value="false">Off</option><option value="true">On</option></select></div>
      <div class="srow">Field of view <input type="range" min="50" max="100" step="1" data-s="fov"></div>
      <div class="srow">Graphics quality <select data-s="quality"><option value="low">Low (laptop)</option><option value="medium">Medium</option><option value="high">High</option></select></div>
      <div class="srow">Max time warp <select data-s="maxWarp" data-num><option>1</option><option>5</option><option>10</option><option>25</option><option>50</option></select></div>
      <div class="srow">Docking difficulty <select data-s="difficulty"><option value="assisted">Assisted — helpers, guidance</option><option value="realistic">Realistic — no auto-stabilisation</option><option value="expert">Expert — dock cam + raw numbers</option></select></div>
      <div class="srow">Master volume <input type="range" min="0" max="1" step="0.05" data-s="masterVolume"></div>
      <div class="srow">Music volume <input type="range" min="0" max="1" step="0.05" data-s="musicVolume"></div>
      <div class="srow">CASE-9 voice <select data-s="voice" data-bool><option value="true">Speech synthesis</option><option value="false">Subtitles only</option></select></div>
      <div class="srow">Subtitle size <input type="range" min="0.7" max="1.6" step="0.05" data-s="subtitleSize"></div>
      <div class="srow">Show FPS <select data-s="showFps" data-bool><option value="false">Off</option><option value="true">On</option></select></div>
    </div>
    <div class="note">Assisted adds kill-rotation (K), kill-relative-velocity (L), attitude holds (1–9) and a guidance cue. Helpers fly the same thrusters and burn the same propellant — the physics underneath never changes.</div>
    <button data-a="unlock">UNLOCK ALL MISSIONS</button>
    <button data-a="back">BACK</button></div>`);
    for (const inp of box.querySelectorAll('[data-s]')) {
      const k = inp.dataset.s;
      inp.value = String(v[k]);
      const read = () => (inp.dataset.bool !== undefined ? inp.value === 'true' : (inp.type === 'range' || inp.dataset.num !== undefined ? Number(inp.value) : inp.value));
      inp.oninput = inp.onchange = () => settings.set(k, read());
    }
    box.querySelector('[data-a=unlock]').onclick = (e) => { progress.unlockAll(); e.target.textContent = 'ALL MISSIONS UNLOCKED'; };
    box.querySelector('[data-a=back]').onclick = back;
    this.showPanel(box);
  }

  controls(back) {
    const rows = [
      ['FLIGHT', ''], ['W / S', 'RCS forward / back'], ['A / D', 'RCS left / right'], ['R / F', 'RCS up / down'],
      ['Mouse, ↑↓←→', 'Pitch / yaw'], ['Q / E', 'Roll'], ['Z / X', 'Throttle up / down (Shift = fast)'], ['Backspace', 'Cut throttle'],
      ['T', 'RCS fine / coarse'], ['C', 'Camera: cockpit / chase / docking'], ['RMB drag', 'Look / orbit chase cam'], ['G', 'Landing gear'],
      ['U', 'Release latches (undock)'], ['Space', 'Stage / confirm'], ['M', 'Map / orbit view'], [', / .', 'Time warp − / +'],
      ['K / L', 'Assisted: kill rotation / kill rel. velocity'], ['1 – 9', 'Assisted: prograde, retro, normal, anti, rad out/in, target, anti, port align'],
      ['ON FOOT', ''], ['WASD + mouse', 'Walk / look'], ['Shift', 'Run'], ['Space', 'Jump / push off'], ['E (hold)', 'Interact / grab handrail'],
      ['R / F, WASD', 'Suit thrusters (zero-g)'], ['Q / E', 'Roll (zero-g)'], ['F', 'Flashlight'], ['V', 'First / third person'], ['B', 'Drop a bolt (watch Coriolis)'],
      ['GENERAL', ''], ['Tab', 'Objectives'], ['P', 'Physics debug overlay'], ['Esc', 'Pause'],
    ];
    const box = h(`<div class="box" style="width:min(700px,94vw)"><h2>CONTROLS</h2><div class="controls-grid">${rows.map(([a, b]) => (b ? `<b>${a}</b><span>${b}</span>` : `<b style="color:#fff;margin-top:8px">${a}</b><span></span>`)).join('')}</div><button data-a="back" style="margin-top:16px">BACK</button></div>`);
    box.querySelector('[data-a=back]').onclick = back;
    this.showPanel(box, true);
  }

  pause() {
    const g = this.game;
    const box = h(`<div class="box"><h2>PAUSED</h2>
      <button data-a="resume">RESUME</button>
      <button data-a="retry" ${g.mission?.canRetry?.() ? '' : 'disabled'}>RETRY FROM CHECKPOINT<span class="meta">${g.mission?.checkpointName || ''}</span></button>
      <button data-a="restart">RESTART MISSION</button>
      <button data-a="settings">SETTINGS</button>
      <button data-a="controls">CONTROLS</button>
      <button data-a="quit">QUIT TO TITLE</button></div>`);
    box.querySelector('[data-a=resume]').onclick = () => g.setPaused(false);
    box.querySelector('[data-a=retry]').onclick = () => { g.setPaused(false); g.mission?.retry?.(); };
    box.querySelector('[data-a=restart]').onclick = () => { g.setPaused(false); g.startMission(g.mission.id); };
    box.querySelector('[data-a=settings]').onclick = () => this.settingsPanel(() => this.pause());
    box.querySelector('[data-a=controls]').onclick = () => this.controls(() => this.pause());
    box.querySelector('[data-a=quit]').onclick = () => g.toTitle();
    this.showPanel(box, true);
  }

  failed(reason, onRetry) {
    const g = this.game;
    const box = h(`<div class="box"><h2 style="color:#ff5a4a">${reason.title || 'MISSION FAILED'}</h2>
      <div class="note" style="font-size:16px;color:#ddd">${reason.text || ''}</div>
      <button data-a="retry">RETRY FROM CHECKPOINT<span class="meta">${g.mission?.checkpointName || ''}</span></button>
      <button data-a="quit">QUIT TO TITLE</button></div>`);
    box.querySelector('[data-a=retry]').onclick = () => { this.clear(); onRetry(); };
    box.querySelector('[data-a=quit]').onclick = () => g.toTitle();
    this.showPanel(box, true);
  }

  results({ title, lines = [], score = null, onNext = null, nextLabel = 'CONTINUE', table = null }) {
    const g = this.game;
    const box = h(`<div class="box results" style="width:min(560px,92vw)"><h2>${title}</h2>
      ${score !== null ? `<div class="big">${score}</div>` : ''}
      <div class="scores">${lines.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')}</div>
      ${table ? `<div class="scores" style="margin-top:14px"><div><b>BEST SCORES</b><span></span></div>${table.map((s, i) => `<div style="${s.mine ? 'color:#6dff9c' : ''}"><span>${i + 1}. ${s.label}</span><span>${s.score}</span></div>`).join('')}</div>` : ''}
      <div style="margin-top:18px">${onNext ? `<button data-a="next">${nextLabel}</button>` : ''}<button data-a="title">TITLE SCREEN</button></div></div>`);
    if (onNext) box.querySelector('[data-a=next]').onclick = () => { this.clear(); onNext(); };
    box.querySelector('[data-a=title]').onclick = () => g.toTitle();
    this.showPanel(box, true);
  }
}
