// Controls card: shown (and the game held) at the start of every mission,
// listing the keys for the mode you start in plus a mission-specific note.
// When a mission first switches you into another mode (cockpit -> floating
// -> walking) a smaller non-blocking card shows that mode's keys.

import { settings } from '../core/settings.js';

const k = (keys) => keys.split(' ').map((x) => `<kbd>${x.replace(/_/g, ' ')}</kbd>`).join('');

export const CONTROLS = {
  flight: {
    get title() { return settings.difficulty.helpers ? 'FLYING THE KESTREL · SIMPLE' : 'FLYING THE KESTREL'; },
    rows: () => settings.difficulty.helpers ? [
      ['Mouse Arrows', 'Point the ship (it holds where you point)'],
      ['W', 'Go: faster toward the station · hold for a burn'],
      ['S', 'Slow down / back off'],
      ['Space', 'Stop (near the station)'],
      ['A D R F', 'Slide sideways'],
      ['Q E', 'Roll'],
      ['C', 'Camera: cockpit · chase · docking'],
      ['M', 'Map'],
      [', .', 'Time warp'],
    ] : [
      ['W S', 'Thrust forward / back'],
      ['A D', 'Thrust left / right'],
      ['R F', 'Thrust up / down'],
      ['Mouse Arrows', 'Pitch and yaw'],
      ['Q E', 'Roll'],
      ['Z X', 'Main engine throttle up / down'],
      ['C', 'Camera: cockpit · chase · docking'],
      ['M', 'Map'],
      [', .', 'Time warp'],
    ],
    get tip() { return settings.difficulty.helpers ? 'Near the station the computer lines you up with the port, matches her spin and slows you for capture. You only choose the speed.' : ''; },
  },
  float: {
    title: 'ZERO G',
    rows: () => [
      ['Mouse', 'Look'],
      ['W A S D', 'Float forward / back / sideways'],
      ['Space Ctrl', 'Up / down'],
      ['Shift', 'Faster'],
      ['E', 'Use hatches, ladders and panels'],
    ],
    tip: 'Follow the yellow ◆ marker. Hatches and the ladder are one press of E.',
  },
  walk: {
    title: 'ON FOOT',
    rows: () => [
      ['Mouse', 'Look'],
      ['W A S D', 'Walk'],
      ['Shift', 'Run'],
      ['Space', 'Jump'],
      ['E', 'Interact'],
      ['V', 'First / third person'],
      ['F', 'Flashlight'],
    ],
    tip: 'Follow the yellow ◆ marker to your objective.',
  },
  ladder: {
    title: 'LADDER',
    rows: () => [['W', 'Climb up (toward the hub)'], ['S', 'Climb down (toward the ring)'], ['Shift', 'Faster'], ['Mouse', 'Look around']],
  },
};
const GENERAL = [['Tab', 'Controls & objectives'], ['I', 'Full instruments'], ['Esc', 'Pause · settings']];

export function currentControlMode(game) {
  if (game.mode === 'flight') return 'flight';
  if (game.mode === 'surface') return 'walk';
  if (game.mode === 'interior') {
    const m = game.interiorPlayer.mode;
    return m === 'glide' ? 'float' : m;
  }
  return 'flight';
}

function rowsHtml(rows) {
  return rows.map(([keys, what]) => `<div class="cc-row"><span class="cc-keys">${k(keys)}</span><span class="cc-what">${what}</span></div>`).join('');
}

export class ControlsCard {
  constructor(game, root) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'controls-card hidden interactive';
    root.appendChild(this.el);
    this.hint = document.createElement('div');
    this.hint.className = 'controls-hint hidden';
    root.appendChild(this.hint);
    this.open = false;
    this.onKey = (e) => {
      if (!this.open) return;
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
    };
    window.addEventListener('keydown', this.onKey, true);
    this.el.addEventListener('mousedown', (e) => { e.stopPropagation(); this.close(); this.game.input.requestLock(); });
  }

  // blocking card at mission start
  show(mission) {
    const g = this.game;
    const mode = currentControlMode(g);
    const c = CONTROLS[mode];
    const note = mission?.controlsNote?.() || c.tip || '';
    const title = mission?.ui?.objectives?.title || '';
    this.el.innerHTML = `
      <div class="cc-box">
        <div class="cc-mission">${title}</div>
        <div class="cc-title">${c.title}</div>
        <div class="cc-rows">${rowsHtml(c.rows())}</div>
        ${note ? `<div class="cc-note">${note}</div>` : ''}
        <div class="cc-general">${GENERAL.map(([a, b]) => `${k(a)} ${b}`).join('<span class="sep">·</span>')}</div>
        <div class="cc-go">Press <kbd>Space</kbd> or click to start</div>
      </div>`;
    this.el.classList.remove('hidden');
    this.open = true;
    this.wasPaused = g.paused;
    g.paused = true;
    g.cardOpen = true;
    this.shown = new Set([mode]);
    this.hint.classList.add('hidden');
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.add('hidden');
    const g = this.game;
    g.cardOpen = false;
    g.paused = false;
    g.input.down.clear();
    g.input.pressed.clear();
  }

  // non-blocking reminder when the control mode changes mid-mission
  modeChanged() {
    const g = this.game;
    if (!g.mission || g.cutscene || this.open) return;
    const mode = currentControlMode(g);
    if (!this.shown || this.shown.has(mode)) return;
    this.shown.add(mode);
    const c = CONTROLS[mode];
    this.hint.innerHTML = `<div class="cc-title">${c.title}</div><div class="cc-rows">${rowsHtml(c.rows())}</div>${c.tip ? `<div class="cc-note">${c.tip}</div>` : ''}`;
    this.hint.classList.remove('hidden');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.hint.classList.add('hidden'), 10000);
  }

  // the Tab panel's controls section for the current mode
  tabHtml() {
    const c = CONTROLS[currentControlMode(this.game)];
    return `<div class="cc-tab"><h4>${c.title}</h4>${rowsHtml(c.rows())}<div class="cc-general">${GENERAL.map(([a, b]) => `${k(a)} ${b}`).join('<span class="sep">·</span>')}</div></div>`;
  }

  clear() { this.close(); this.hint.classList.add('hidden'); this.shown = null; }
}
