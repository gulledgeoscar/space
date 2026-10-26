// Entry point: title screen, world list, world creation, then the game.
import './style.css';
import { buildAtlas } from './world/atlas.js';
import { Audio } from './audio/sfx.js';
import { Game } from './game.js';
import { WorldStorage, listWorlds, deleteWorld } from './save/storage.js';
import { CHUNK_VOLUME } from './world/constants.js';
import { loadSettings, saveSettings } from './ui/settings.js';
import { CONTROLS } from './ui/menus.js';
import { completeCommand } from './ui/commands.js';

const app = document.getElementById('app');
const ui = document.getElementById('ui-root');
const settings = loadSettings();
const audio = new Audio();
audio.setVolume(settings.volume);
let atlas = null;
let game = null;

const WORDS = ['amber', 'basalt', 'cedar', 'delta', 'ember', 'fjord', 'glacier', 'harbor', 'island', 'jade', 'kelp', 'lagoon', 'meadow', 'nova', 'oasis', 'pine', 'quartz', 'ridge', 'summit', 'tundra', 'umber', 'valley', 'willow', 'zephyr'];
const randomSeed = () => `${WORDS[(Math.random() * WORDS.length) | 0]}-${WORDS[(Math.random() * WORDS.length) | 0]}-${(Math.random() * 1000) | 0}`;

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function supportsWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

async function showTitle() {
  game = null;
  document.querySelectorAll('canvas.view').forEach((c) => c.remove());
  ui.innerHTML = '';
  const worlds = await listWorlds();
  const title = el(`<div class="title-screen">
    <div class="sky-bg"><div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div><div class="hills"></div></div>
    <div class="title-card">
      <h1 class="logo">LIMITLESS</h1>
      <p class="tagline">A first-person sandbox where you can do anything.</p>
      <div class="title-buttons">
        <button class="primary big" data-a="new">Create new world</button>
        ${worlds.length ? '<button class="big" data-a="continue">Continue last world</button>' : ''}
        <button data-a="settings">Settings</button>
        <button data-a="controls">Controls</button>
      </div>
      ${worlds.length ? `<h3>Your worlds</h3><div class="world-list">${worlds.map((w) => `
        <div class="world-row" data-id="${w.id}">
          <div><b>${escape(w.name)}</b><small>${w.mode ?? 'creative'} · ${w.worldType === 'flat' ? 'flat · ' : ''}seed ${escape(String(w.seed))} · ${new Date(w.lastPlayed || w.created).toLocaleString()}</small></div>
          <button data-play="${w.id}">Play</button><button class="danger" data-del="${w.id}">Delete</button>
        </div>`).join('')}</div>` : ''}
      <p class="credits">Break, build, blow up, drive, fly, tame, terraform. Everything is generated in your browser.</p>
    </div>
  </div>`);
  ui.appendChild(title);
  if (!supportsWebGL2()) {
    title.querySelector('.title-buttons').innerHTML = '<p class="error">This game needs WebGL2. Try a recent Chrome, Edge or Firefox.</p>';
    return;
  }
  title.querySelector('[data-a=new]').onclick = () => showCreate();
  title.querySelector('[data-a=continue]')?.addEventListener('click', () => startWorld(worlds[0]));
  title.querySelector('[data-a=settings]').onclick = () => showTitleSettings();
  title.querySelector('[data-a=controls]').onclick = () => showTitleControls();
  title.querySelectorAll('[data-play]').forEach((b) => { b.onclick = () => startWorld(worlds.find((w) => w.id === b.dataset.play)); });
  title.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.confirm) { await deleteWorld(b.dataset.del); showTitle(); return; }
      b.dataset.confirm = '1';
      b.textContent = 'Really?';
    };
  });
}

function escape(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function modal(html) {
  const m = el(`<div class="overlay title-modal"><div class="card menu">${html}</div></div>`);
  ui.appendChild(m);
  return m;
}

function showCreate() {
  const m = modal(`
    <h2>Create a new world</h2>
    <label>World name<input type="text" name="name" value="My World" maxlength="40"></label>
    <label>Seed<input type="text" name="seed" value="${randomSeed()}" maxlength="60"></label>
    <div class="seg" data-k="mode"><button class="on" data-v="creative">Creative</button><button data-v="survival">Survival</button></div>
    <p class="sub" data-hint>Unlimited blocks, every tool and weapon, flying, no damage.</p>
    <div class="seg" data-k="type"><button class="on" data-v="default">Normal terrain</button><button data-v="flat">Superflat</button></div>
    <button class="primary big" data-a="go">Create world</button>
    <button data-a="back">Back</button>`);
  const state = { mode: 'creative', type: 'default' };
  m.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      state[seg.dataset.k] = b.dataset.v;
      m.querySelector('[data-hint]').textContent = state.mode === 'creative' ? 'Unlimited blocks, every tool and weapon, flying, no damage.' : 'Health, hunger, mining and monsters at night. Switch modes any time with M.';
    };
  }));
  m.querySelector('[data-a=back]').onclick = () => m.remove();
  m.querySelector('[data-a=go]').onclick = () => {
    const name = m.querySelector('[name=name]').value.trim() || 'My World';
    const seed = m.querySelector('[name=seed]').value.trim() || randomSeed();
    startWorld({ id: `w${Date.now().toString(36)}`, name, seed, mode: state.mode, worldType: state.type, created: Date.now() });
  };
}

function showTitleSettings() {
  const m = modal(`
    <h2>Settings</h2>
    <label>Render distance <b>${settings.renderDistance}</b><input type="range" min="3" max="16" value="${settings.renderDistance}" data-k="renderDistance"></label>
    <label>Field of view <b>${settings.fov}</b><input type="range" min="50" max="110" value="${settings.fov}" data-k="fov"></label>
    <label>Mouse sensitivity <b>${settings.sensitivity}</b><input type="range" min="0.2" max="3" step="0.05" value="${settings.sensitivity}" data-k="sensitivity"></label>
    <label>Volume <b>${Math.round(settings.volume * 100)}%</b><input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-k="volume"></label>
    <label>Resolution scale <b>${settings.pixelRatio}</b><input type="range" min="0.5" max="2" step="0.25" value="${settings.pixelRatio}" data-k="pixelRatio"></label>
    <button class="primary" data-a="done">Done</button>`);
  m.querySelectorAll('input').forEach((inp) => {
    inp.oninput = () => {
      const v = parseFloat(inp.value);
      settings[inp.dataset.k] = v;
      inp.previousElementSibling.textContent = inp.dataset.k === 'volume' ? `${Math.round(v * 100)}%` : v;
      audio.setVolume(settings.volume);
      saveSettings(settings);
    };
  });
  m.querySelector('[data-a=done]').onclick = () => m.remove();
}

function showTitleControls() {
  const m = modal(`<h2>Controls</h2><div class="controls">${CONTROLS.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div><button class="primary">Back</button>`);
  m.querySelector('.card').classList.add('wide');
  m.querySelector('button').onclick = () => m.remove();
}

async function startWorld(meta) {
  audio.init();
  ui.innerHTML = '<div class="loading"><div class="loading-title">Preparing world…</div><div class="bar"><div style="width:5%"></div></div></div>';
  await new Promise((r) => setTimeout(r, 30));
  if (!atlas) atlas = buildAtlas();
  const canvas = document.createElement('canvas');
  canvas.className = 'view';
  app.insertBefore(canvas, ui);
  const storage = await WorldStorage.open(meta, CHUNK_VOLUME);
  ui.innerHTML = '';
  game = new Game({ canvas, ui, atlas, audio, settings, storage, meta: storage.meta });
  game.onQuit = () => showTitle();
  game.commandComplete = completeCommand;
  window.__game = game; // handy for debugging from the console
  await game.start();
  await storage.saveMeta(game.snapshot());
}

showTitle();
