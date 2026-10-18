// Subtitled radio chatter. Lines queue per channel; each line triggers a
// radio chirp and (optionally) CASE-9's synthesized voice.

import { settings } from '../core/settings.js';

const SPEAKERS = {
  case: { name: 'CASE-9', cls: 'case' },
  okafor: { name: 'DR. OKAFOR', cls: 'crew' },
  halden: { name: 'HALDEN CONTROL', cls: 'control' },
  vance: { name: 'DR. VANCE', cls: 'hostile' },
  pilot: { name: 'YOU', cls: 'crew' },
  wren: { name: 'WREN', cls: 'hostile' },
};

export class Subtitles {
  constructor(game, root) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'subs';
    root.appendChild(this.root);
    this.queue = [];
    this.active = [];
    this.recent = new Map();
    settings.onChange((k) => { if (k === 'subtitleSize') this.applySize(); });
    this.applySize();
  }
  applySize() { this.root.style.setProperty('--sub-scale', settings.get('subtitleSize')); }

  // say('case', 'text', { dur, key, cooldown, priority })
  say(who, text, opts = {}) {
    if (opts.key) {
      const last = this.recent.get(opts.key);
      const now = performance.now() / 1000;
      if (last && now - last < (opts.cooldown ?? 8)) return false;
      this.recent.set(opts.key, now);
    }
    const dur = opts.dur ?? Math.max(2.6, text.length * 0.065);
    const item = { who, text, dur, t: 0 };
    if (opts.priority) {
      this.queue.unshift(item);
      for (const a of this.active) if (!a.fading) { a.fading = true; a.el.classList.add('fade'); }
    } else this.queue.push(item);
    // keep the backlog short so lines stay in step with what is happening
    while (this.queue.length > 4) this.queue.splice(1, 1);
    return true;
  }

  get busy() { return this.queue.length > 0 || this.active.length > 0; }
  clear() { this.queue.length = 0; for (const a of this.active) a.el.remove(); this.active.length = 0; }

  expireOldest() { const a = this.active.shift(); if (a) a.el.remove(); }

  update(dt) {
    for (const a of this.active) {
      a.t += dt;
      if (a.t > a.dur && !a.fading) { a.fading = true; a.el.classList.add('fade'); }
    }
    while (this.active.length && this.active[0].t > this.active[0].dur + 0.6) this.expireOldest();
    // one line on screen at a time (the previous one fades out underneath)
    const canStart = this.active.every((a) => a.fading);
    if (this.queue.length && canStart && this.active.length < 2) {
      const item = this.queue.shift();
      const sp = SPEAKERS[item.who] || { name: item.who.toUpperCase(), cls: 'crew' };
      const e = document.createElement('div');
      e.className = `line ${sp.cls}`;
      e.innerHTML = `<span class="who">${sp.name}</span>`;
      e.appendChild(document.createTextNode(item.text));
      this.root.appendChild(e);
      item.el = e;
      this.active.push(item);
      this.game.audio?.radio?.(item.who);
      if (item.who === 'case') this.game.audio?.speak?.(item.text);
      else this.game.audio?.speakCrew?.(item.text, item.who);
    }
  }
}
