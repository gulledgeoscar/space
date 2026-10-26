// Overlay screens during play: pause, settings, world controls, inventory,
// chat console, death screen, loading bar and the "click to play" card.
import { creativeCatalog, stackName, TOOLS, SPAWNS, sameItem, stackable, MAX_STACK } from '../items/items.js';
import { iconFor } from './icons.js';
import { BLOCKS } from '../world/blocks.js';
import { saveSettings } from './settings.js';
import { RECIPES, canCraft, craft, ingredientStack } from '../items/crafting.js';

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};

export const CONTROLS = [
  ['WASD', 'Move'], ['Mouse', 'Look'], ['Space', 'Jump · double-tap to fly (creative)'], ['Shift', 'Sneak / fly down'], ['Ctrl / double-tap W', 'Sprint'],
  ['Left click', 'Break / attack / fire'], ['Right click', 'Place / use / interact / ride'], ['Middle click', 'Pick block'], ['1–9 / wheel', 'Hotbar'],
  ['E', 'Inventory & spawn menu'], ['G', 'World controls (time, weather, gravity…)'], ['T or /', 'Chat & commands'], ['R', 'Get in / out of vehicles · reload'],
  ['Q', 'Drop item'], ['F', 'Toggle flying (creative) · flip car'], ['N', 'Noclip'], ['M', 'Cycle game mode'], ['F5 / V', 'Third person'], ['Z', 'Zoom'],
  ['J', 'Minimap'], ['F2', 'Screenshot'], ['K', 'Skip time +6h'], ['L', 'Cycle weather'], ['P', 'Slow-mo / freeze time'], ['B', 'Set spawn point'], ['Alt + wheel', 'Tool size'], ['F1', 'Hide HUD'], ['F3', 'Debug info'], ['Esc', 'Pause'],
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'menus';
    game.ui.appendChild(this.root);
    this.open = null;
    this.history = [];
    this.histIndex = -1;
    this.log = [];
    this.cursor = null; // survival inventory: stack held by the mouse
    this.tab = 'Building';
    this.search = '';
    this.keyHandler = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyHandler);
    this.loadingEl = h('<div class="loading"><div class="loading-title">Generating world…</div><div class="bar"><div></div></div></div>');
    this.root.appendChild(this.loadingEl);
  }

  dispose() {
    window.removeEventListener('keydown', this.keyHandler);
    this.root.remove();
  }

  setLoading(p, title) {
    if (p === null) { this.loadingEl.style.display = 'none'; return; }
    if (title) this.loadingEl.querySelector('.loading-title').textContent = title;
    this.loadingEl.style.display = 'flex';
    this.loadingEl.querySelector('.bar div').style.width = `${Math.round(p * 100)}%`;
  }

  onKey(e) {
    if (!this.open) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.open === 'pause' || this.open === 'death') return;
      if (this.open === 'chest') { this.close(true); return; }
      this.close(true);
    } else if ((e.code === 'KeyE' && (this.open === 'inventory' || this.open === 'chest') && document.activeElement?.tagName !== 'INPUT') || (e.code === 'KeyG' && this.open === 'world')) {
      e.preventDefault();
      this.close(true);
    }
  }

  show(name, el) {
    this.closePanel();
    this.open = name;
    this.panel = el;
    this.root.appendChild(el);
    this.game.input.unlock();
    this.game.input.typing = name === 'console';
  }

  closePanel() {
    if (this.panel) this.panel.remove();
    this.panel = null;
    if (this.cursor) {
      const left = this.game.inventory.add(this.cursor);
      if (left) this.game.entities.dropItem(this.game.player.eyePos, { ...this.cursor, count: left });
      this.cursor = null;
    }
  }

  close(relock = true) {
    this.closePanel();
    this.open = null;
    this.game.input.typing = false;
    this.game.paused = false;
    if (relock) this.game.input.lock();
  }

  // ---- start / pause / death ----

  showStartHint() {
    const touch = matchMedia('(pointer: coarse)').matches;
    const help = touch
      ? '<p class="sub">Left thumb: move · right side: drag to look, tap to place or use, hold to break.<br>⤒ jump · ⛏ attack/fire · ✋ use · ⤓ sneak · 🎒 inventory · 🕊 fly · 🚗 ride</p>'
      : `<div class="controls">${CONTROLS.slice(0, 16).map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>`;
    const el = h(`<div class="overlay start"><div class="card">
      <h1>LIMITLESS</h1><p class="sub">Do anything.</p>
      ${help}
      <button class="primary big">${touch ? 'Tap' : 'Click'} to play</button>
    </div></div>`);
    el.querySelector('button').onclick = () => { this.game.audio.init(); this.close(true); };
    el.onclick = (e) => { if (e.target === el) { this.game.audio.init(); this.close(true); } };
    this.show('start', el);
  }

  showPause() {
    this.game.paused = true;
    const el = h(`<div class="overlay"><div class="card menu">
      <h2>Paused</h2>
      <button class="primary" data-a="resume">Back to game</button>
      <button data-a="inv">Inventory &amp; spawn menu <kbd>E</kbd></button>
      <button data-a="world">World controls <kbd>G</kbd></button>
      <button data-a="settings">Settings</button>
      <button data-a="controls">Controls</button>
      <button data-a="quit">Save &amp; quit to title</button>
      <p class="stats">Blocks broken ${this.game.stats.blocksBroken} · placed ${this.game.stats.blocksPlaced} · kills ${this.game.stats.kills} · explosions ${this.game.stats.explosions}</p>
    </div></div>`);
    el.querySelector('[data-a=resume]').onclick = () => this.close(true);
    el.querySelector('[data-a=inv]').onclick = () => this.showInventory();
    el.querySelector('[data-a=world]').onclick = () => this.showWorldSettings();
    el.querySelector('[data-a=settings]').onclick = () => this.showSettings();
    el.querySelector('[data-a=controls]').onclick = () => this.showControls();
    el.querySelector('[data-a=quit]').onclick = async () => {
      el.querySelector('[data-a=quit]').textContent = 'Saving…';
      await this.game.quit();
      this.game.onQuit?.();
    };
    this.show('pause', el);
  }

  showControls() {
    const el = h(`<div class="overlay"><div class="card wide">
      <h2>Controls</h2>
      <div class="controls">${CONTROLS.map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join('')}</div>
      <p class="sub">Vehicles: WASD drive · Space handbrake / jump / climb · Shift descend · Left click fire or horn · F flip car</p>
      <button class="primary">Back</button>
    </div></div>`);
    el.querySelector('button').onclick = () => this.showPause();
    this.show('controls', el);
  }

  showDeath(cause) {
    const el = h(`<div class="overlay death"><div class="card">
      <h1>You died!</h1><p class="sub">You ${cause}.</p>
      <button class="primary big">Respawn</button>
    </div></div>`);
    el.querySelector('button').onclick = () => { this.game.player.respawn(); this.close(true); };
    this.show('death', el);
  }

  // ---- settings ----

  showSettings() {
    const s = this.game.settings;
    const el = h(`<div class="overlay"><div class="card menu">
      <h2>Settings</h2>
      <label>Render distance <b data-v="rd">${s.renderDistance}</b><input type="range" min="3" max="16" step="1" value="${s.renderDistance}" data-k="renderDistance"></label>
      <label>Field of view <b data-v="fov">${s.fov}</b><input type="range" min="50" max="110" step="1" value="${s.fov}" data-k="fov"></label>
      <label>Mouse sensitivity <b data-v="sens">${s.sensitivity.toFixed(2)}</b><input type="range" min="0.2" max="3" step="0.05" value="${s.sensitivity}" data-k="sensitivity"></label>
      <label>Volume <b data-v="vol">${Math.round(s.volume * 100)}%</b><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></label>
      <label>Music <b data-v="mus">${Math.round(s.music * 100)}%</b><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"></label>
      <label>Resolution scale <b data-v="pr">${s.pixelRatio}</b><input type="range" min="0.5" max="2" step="0.25" value="${s.pixelRatio}" data-k="pixelRatio"></label>
      <label class="check"><input type="checkbox" data-k="invertY" ${s.invertY ? 'checked' : ''}> Invert mouse Y</label>
      <label class="check"><input type="checkbox" data-k="viewBob" ${s.viewBob !== false ? 'checked' : ''}> View bobbing</label>
      <label class="check"><input type="checkbox" data-k="showCoords" ${s.showCoords !== false ? 'checked' : ''}> Show coordinates &amp; time</label>
      <label class="check"><input type="checkbox" data-k="showMinimap" ${s.showMinimap !== false ? 'checked' : ''}> Minimap <kbd>J</kbd></label>
      <button class="primary">Done</button>
    </div></div>`);
    const labels = { renderDistance: 'rd', fov: 'fov', sensitivity: 'sens', volume: 'vol', pixelRatio: 'pr', music: 'mus' };
    el.querySelectorAll('input').forEach((inp) => {
      inp.oninput = () => {
        const k = inp.dataset.k;
        const v = inp.type === 'checkbox' ? inp.checked : parseFloat(inp.value);
        s[k] = v;
        const lab = el.querySelector(`[data-v=${labels[k]}]`);
        if (lab) lab.textContent = k === 'volume' || k === 'music' ? `${Math.round(v * 100)}%` : k === 'sensitivity' ? v.toFixed(2) : v;
        this.applySettings();
      };
    });
    el.querySelector('button.primary').onclick = () => { saveSettings(s); this.open === 'settings' && this.showPause(); };
    this.show('settings', el);
  }

  applySettings() {
    const g = this.game, s = g.settings;
    g.world.renderDistance = s.renderDistance;
    g.audio.setVolume(s.volume);
    g.audio.setMusicVolume(s.music);
    g.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 2, s.pixelRatio));
    g.camera.fov = s.fov;
    g.camera.updateProjectionMatrix();
    g.hud.refresh();
    saveSettings(s);
  }

  // ---- world controls ----

  showWorldSettings() {
    const g = this.game;
    const el = h(`<div class="overlay"><div class="card wide world">
      <h2>World controls</h2>
      <div class="cols">
        <div>
          <label>Time of day <b data-v="time">${g.timeString()}</b><input type="range" min="0" max="24" step="0.1" value="${g.hours}" data-k="hours"></label>
          <label class="check"><input type="checkbox" data-k="daylightCycle" ${g.daylightCycle ? 'checked' : ''}> Day/night cycle</label>
          <label>Day length <b data-v="dl">${g.dayLength} min</b><input type="range" min="2" max="60" step="1" value="${g.dayLength}" data-k="dayLength"></label>
          <label>Weather <select data-k="weather">${['clear', 'rain', 'storm', 'snow'].map((w) => `<option ${g.weather.type === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
          <label>Gravity <b data-v="grav">${(g.gravity / 28).toFixed(2)} g</b><input type="range" min="2" max="80" step="1" value="${g.gravity}" data-k="gravity"></label>
          <div class="row"><button data-g="4.6">Moon</button><button data-g="10.6">Mars</button><button data-g="28">Earth</button><button data-g="70">Jupiter</button></div>
          <label>Time speed <select data-k="timeScale">${[[1, 'Normal'], [0.5, 'Half'], [0.25, 'Slow motion'], [0.1, 'Super slow'], [0, 'Frozen']].map(([v, n]) => `<option value="${v}" ${g.timeScale === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <div>
          <label>Game mode <select data-k="mode">${['creative', 'survival', 'spectator'].map((m) => `<option ${g.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <label>Difficulty <select data-k="difficulty">${['peaceful', 'easy', 'normal', 'hard'].map((m) => `<option ${g.difficulty === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
          <label>Walk speed <b data-v="spd">${(g.settings.speedMult ?? 1).toFixed(1)}×</b><input type="range" min="0.5" max="5" step="0.1" value="${g.settings.speedMult ?? 1}" data-k="speedMult"></label>
          <label>Jump height <b data-v="jmp">${(g.settings.jumpMult ?? 1).toFixed(1)}×</b><input type="range" min="0.5" max="4" step="0.1" value="${g.settings.jumpMult ?? 1}" data-k="jumpMult"></label>
          <label class="check"><input type="checkbox" data-k="mobSpawning" ${g.mobSpawning ? 'checked' : ''}> Creatures &amp; monsters spawn</label>
          <label class="check"><input type="checkbox" data-k="fireSpread" ${g.fireSpread ? 'checked' : ''}> Fire spreads</label>
          <label class="check"><input type="checkbox" data-k="explosionsBreak" ${g.explosionsBreak ? 'checked' : ''}> Explosions destroy blocks</label>
          <label class="check"><input type="checkbox" data-k="keepInventory" ${g.keepInventory ? 'checked' : ''}> Keep inventory on death</label>
        </div>
      </div>
      <div class="row">
        <button data-a="heal">Heal &amp; feed</button><button data-a="monsters">Remove monsters</button><button data-a="clear">Remove all entities</button><button data-a="spawn">Set spawn here</button>
      </div>
      <button class="primary">Done</button>
    </div></div>`);
    const set = (k, v) => {
      switch (k) {
        case 'hours': g.hours = v; el.querySelector('[data-v=time]').textContent = g.timeString(); break;
        case 'dayLength': g.dayLength = v; el.querySelector('[data-v=dl]').textContent = `${v} min`; break;
        case 'gravity': g.gravity = v; el.querySelector('[data-v=grav]').textContent = `${(v / 28).toFixed(2)} g`; el.querySelector('[data-k=gravity]').value = v; break;
        case 'weather': g.weather.set(v, 900); break;
        case 'timeScale': g.timeScale = parseFloat(v); break;
        case 'mode': g.setMode(v); break;
        case 'difficulty': g.difficulty = v; break;
        case 'speedMult': g.settings.speedMult = v; el.querySelector('[data-v=spd]').textContent = `${v.toFixed(1)}×`; break;
        case 'jumpMult': g.settings.jumpMult = v; el.querySelector('[data-v=jmp]').textContent = `${v.toFixed(1)}×`; break;
        default: g[k] = v;
      }
    };
    el.querySelectorAll('[data-k]').forEach((inp) => {
      const ev = inp.tagName === 'SELECT' ? 'onchange' : 'oninput';
      inp[ev] = () => set(inp.dataset.k, inp.type === 'checkbox' ? inp.checked : inp.tagName === 'SELECT' ? inp.value : parseFloat(inp.value));
    });
    el.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => set('gravity', parseFloat(b.dataset.g)); });
    el.querySelector('[data-a=heal]').onclick = () => { g.player.health = 20; g.player.hunger = 20; g.message('Healed'); };
    el.querySelector('[data-a=monsters]').onclick = () => g.message(`Removed ${g.entities.clear((e) => e.hostile)} monsters`);
    el.querySelector('[data-a=clear]').onclick = () => g.message(`Removed ${g.entities.clear((e) => e.kind !== 'projectile')} entities`);
    el.querySelector('[data-a=spawn]').onclick = () => { g.player.spawn.copy(g.player.position); g.message('Spawn point set'); };
    el.querySelector('button.primary').onclick = () => this.close(true);
    this.show('world', el);
  }

  // ---- inventory ----

  showInventory() {
    const g = this.game;
    const creative = g.creative;
    const el = h(`<div class="overlay"><div class="card inventory ${creative ? 'creative' : ''}">
      ${creative ? `<div class="tabs"></div><input class="search" placeholder="Search everything…" value="${this.search}"><div class="catalog"></div>` : '<h2>Inventory</h2>'}
      <div class="desc"></div>
      ${creative ? '' : '<h3>Crafting</h3><div class="crafting"></div><div class="grid main"></div>'}
      <div class="grid hot"></div>
      <p class="sub">${creative ? 'Click an item to put it in the selected hotbar slot. Click a hotbar slot to select it. Right-click a slot to clear it.' : 'Click to pick up and place stacks.'}</p>
    </div></div>`);
    this.show('inventory', el);
    const desc = el.querySelector('.desc');
    const describe = (s) => {
      if (!s) { desc.innerHTML = ''; return; }
      const d = s.kind === 'tool' ? TOOLS[s.key]?.desc : s.kind === 'spawn' ? `Right-click the ground to spawn. Category: ${SPAWNS[s.key]?.category}` : BLOCKS[s.id]?.category;
      desc.innerHTML = `<b>${stackName(s)}</b> ${d ? `— ${d}` : ''}`;
    };
    const slotEl = (stack, onClick, extra = '') => {
      const d = document.createElement('div');
      d.className = `slot ${extra}`;
      const url = iconFor(g, stack);
      d.innerHTML = `${url ? `<img src="${url}" alt="">` : ''}${stack && !creative && stack.count > 1 ? `<span class="count">${stack.count}</span>` : ''}`;
      d.onmouseenter = () => describe(stack);
      d.onclick = (e) => onClick(e, false);
      d.oncontextmenu = (e) => { e.preventDefault(); onClick(e, true); };
      return d;
    };
    const renderHot = () => {
      const hot = el.querySelector('.hot');
      hot.innerHTML = '';
      g.inventory.hotbar.forEach((s, i) => hot.appendChild(slotEl(s, (e, right) => {
        if (creative) {
          if (right) g.inventory.setSlot(i, null);
          else g.inventory.select(i);
        } else this.cursorClick(i, right);
        renderHot(); renderMain();
      }, i === g.inventory.index ? 'sel' : '')));
    };
    const renderMain = () => {
      const main = el.querySelector('.main');
      if (!main) return;
      main.innerHTML = '';
      g.inventory.main.forEach((s, i) => main.appendChild(slotEl(s, (e, right) => { this.cursorClick(i + 9, right); renderHot(); renderMain(); })));
    };
    const renderCraft = () => {
      const box = el.querySelector('.crafting');
      if (!box) return;
      box.innerHTML = '';
      const sorted = [...RECIPES].sort((a, b) => canCraft(g.inventory, b) - canCraft(g.inventory, a));
      for (const r of sorted) {
        const ok = canCraft(g.inventory, r);
        const row = document.createElement('button');
        row.className = `recipe ${ok ? 'ok' : ''}`;
        row.disabled = !ok;
        row.innerHTML = `<img src="${iconFor(g, r.out)}" alt=""><span class="n">${r.out.count > 1 ? `${r.out.count}×` : ''}</span>
          <span class="needs">${r.needs.map(([ing, n]) => `<img src="${iconFor(g, ingredientStack(ing))}" alt=""><small>${n}</small>`).join('')}</span>`;
        row.onmouseenter = () => describe(r.out);
        row.onclick = () => { if (craft(g.inventory, r)) { g.audio.play('pop'); renderCraft(); renderHot(); renderMain(); } };
        box.appendChild(row);
      }
    };
    renderHot(); renderMain(); renderCraft();
    if (!creative) return;

    const cat = creativeCatalog();
    const tabs = {
      Building: cat.blocks.filter((s) => s.category === 'Building' || s.category === 'Decor'),
      Nature: cat.blocks.filter((s) => s.category === 'Nature'),
      Colors: cat.blocks.filter((s) => s.category === 'Colors'),
      'Light & Special': cat.blocks.filter((s) => s.category === 'Light' || s.category === 'Special'),
      'Tools & Weapons': cat.tools.filter((s) => s.category !== 'Materials'),
      Materials: cat.tools.filter((s) => s.category === 'Materials'),
      Creatures: cat.spawns.filter((s) => s.category === 'Creatures' || s.category === 'Monsters'),
      'Vehicles & Props': cat.spawns.filter((s) => ['Vehicles', 'Props', 'Explosives'].includes(s.category)),
      Disasters: cat.spawns.filter((s) => s.category === 'Disasters'),
      Structures: cat.spawns.filter((s) => s.category === 'Structures'),
    };
    const tabsEl = el.querySelector('.tabs');
    const catalog = el.querySelector('.catalog');
    const search = el.querySelector('.search');
    const renderCatalog = () => {
      catalog.innerHTML = '';
      const q = this.search.trim().toLowerCase();
      const items = q ? [...cat.blocks, ...cat.tools, ...cat.spawns].filter((s) => stackName(s).toLowerCase().includes(q)) : tabs[this.tab];
      for (const s of items) {
        catalog.appendChild(slotEl(s, (e) => {
          const stack = { ...s };
          delete stack.category;
          if (e.shiftKey) {
            const free = g.inventory.hotbar.findIndex((x) => !x);
            g.inventory.setSlot(free >= 0 ? free : g.inventory.index, stack);
          } else {
            g.inventory.setSlot(g.inventory.index, stack);
          }
          g.audio.play('click');
          renderHot();
        }));
      }
      tabsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', !q && b.textContent === this.tab));
    };
    for (const name of Object.keys(tabs)) {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = () => { this.tab = name; this.search = ''; search.value = ''; renderCatalog(); };
      tabsEl.appendChild(b);
    }
    search.oninput = () => { this.search = search.value; renderCatalog(); };
    search.onkeydown = (e) => { e.stopPropagation(); if (e.code === 'Escape') this.close(true); };
    renderCatalog();
  }

  // A chest: its 27 slots above your backpack and hotbar.
  showChest(key) {
    const g = this.game;
    const items = g.chest(key);
    const el = h(`<div class="overlay"><div class="card inventory">
      <h2>Chest</h2><div class="grid chest"></div><div class="desc"></div>
      <div class="grid main"></div><div class="grid hot"></div>
      <p class="sub">Click to pick up and place stacks. Shift-click moves a stack across.</p></div></div>`);
    this.show('chest', el);
    const inv = g.inventory;
    const chestSlots = { get: (i) => items[i], set: (i, s) => { items[i] = s; } };
    const invSlots = { get: (i) => inv.getSlot(i), set: (i, s) => inv.setSlot(i, s) };
    const render = () => {
      const fill = (sel, store, from, n) => {
        const grid = el.querySelector(sel);
        grid.innerHTML = '';
        for (let k = 0; k < n; k++) {
          const i = from + k;
          const s = store.get(i);
          const d = document.createElement('div');
          d.className = 'slot';
          const url = iconFor(g, s);
          d.innerHTML = `${url ? `<img src="${url}" alt="">` : ''}${s && s.count > 1 ? `<span class="count">${s.count}</span>` : ''}`;
          d.onmouseenter = () => { el.querySelector('.desc').textContent = stackName(s); };
          const click = (e, right) => {
            e.preventDefault();
            if (e.shiftKey && s) {
              const other = store === chestSlots ? invSlots : chestSlots;
              const n2 = store === chestSlots ? 36 : 27;
              for (let j = 0; j < n2; j++) if (!other.get(j)) { other.set(j, s); store.set(i, null); break; }
            } else this.cursorClickOn(store, i, right);
            g.hud.refresh();
            render();
          };
          d.onclick = (e) => click(e, false);
          d.oncontextmenu = (e) => click(e, true);
          grid.appendChild(d);
        }
      };
      fill('.chest', chestSlots, 0, 27);
      fill('.main', invSlots, 9, 27);
      fill('.hot', invSlots, 0, 9);
    };
    render();
  }

  cursorClickOn(store, i, right) {
    const slot = store.get(i);
    const c = this.cursor;
    if (!c) {
      if (!slot) return;
      if (right && slot.count > 1) { const half = Math.ceil(slot.count / 2); this.cursor = { ...slot, count: half }; slot.count -= half; }
      else { this.cursor = slot; store.set(i, null); }
    } else if (!slot) {
      if (right) { store.set(i, { ...c, count: 1 }); c.count--; if (!c.count) this.cursor = null; }
      else { store.set(i, c); this.cursor = null; }
    } else if (sameItem(slot, c) && stackable(c)) {
      const n = Math.min(right ? 1 : c.count, MAX_STACK - slot.count);
      slot.count += n; c.count -= n;
      if (!c.count) this.cursor = null;
    } else { store.set(i, c); this.cursor = slot; }
  }

  // Survival: pick up / drop / swap stacks with the mouse.
  cursorClick(i, right) {
    const inv = this.game.inventory;
    const slot = inv.getSlot(i);
    const c = this.cursor;
    if (!c) {
      if (!slot) return;
      if (right && slot.count > 1) {
        const half = Math.ceil(slot.count / 2);
        this.cursor = { ...slot, count: half };
        slot.count -= half;
      } else { this.cursor = slot; inv.setSlot(i, null); }
    } else if (!slot) {
      if (right) { inv.setSlot(i, { ...c, count: 1 }); c.count--; if (!c.count) this.cursor = null; }
      else { inv.setSlot(i, c); this.cursor = null; }
    } else if (sameItem(slot, c) && stackable(c)) {
      const n = Math.min(right ? 1 : c.count, MAX_STACK - slot.count);
      slot.count += n; c.count -= n;
      if (!c.count) this.cursor = null;
    } else { inv.setSlot(i, c); this.cursor = slot; }
    this.game.hud.refresh();
  }

  // A one-line text box (signs).
  showPrompt(title, value, done) {
    const el = h(`<div class="overlay"><div class="card menu"><h2></h2><input type="text" maxlength="80"><button class="primary">Done</button><button>Cancel</button></div></div>`);
    el.querySelector('h2').textContent = title;
    const inp = el.querySelector('input');
    inp.value = value;
    this.show('prompt', el);
    this.game.input.typing = true;
    setTimeout(() => inp.focus(), 0);
    const finish = (ok) => { const v = inp.value.trim(); this.close(true); if (ok) done(v); };
    el.querySelector('button.primary').onclick = () => finish(true);
    el.querySelectorAll('button')[1].onclick = () => finish(false);
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.code === 'Enter') finish(true); if (e.code === 'Escape') finish(false); };
  }

  // ---- console ----

  consoleLog(text, color) {
    this.log.push({ text, color });
    if (this.log.length > 60) this.log.shift();
    if (this.open === 'console') this.renderLog();
  }

  renderLog() {
    const out = this.panel?.querySelector('.log');
    if (!out) return;
    out.innerHTML = this.log.map((l) => `<div style="color:${l.color}">${l.text.replace(/</g, '&lt;')}</div>`).join('');
    out.scrollTop = out.scrollHeight;
  }

  showConsole(prefill = '') {
    const el = h(`<div class="overlay console-wrap"><div class="console">
      <div class="log"></div>
      <input type="text" spellcheck="false" autocomplete="off" placeholder="Type a message or /help for commands">
    </div></div>`);
    this.show('console', el);
    this.renderLog();
    const inp = el.querySelector('input');
    inp.value = prefill;
    setTimeout(() => inp.focus(), 0);
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.code === 'Enter') {
        const text = inp.value.trim();
        if (text) {
          this.history.unshift(text);
          this.histIndex = -1;
          if (text.startsWith('/')) this.game.command(text);
          else this.game.message(`<You> ${text}`);
        }
        this.close(true);
      } else if (e.code === 'Escape') this.close(true);
      else if (e.code === 'ArrowUp') { this.histIndex = Math.min(this.history.length - 1, this.histIndex + 1); inp.value = this.history[this.histIndex] ?? ''; e.preventDefault(); }
      else if (e.code === 'ArrowDown') { this.histIndex = Math.max(-1, this.histIndex - 1); inp.value = this.history[this.histIndex] ?? ''; e.preventDefault(); }
      else if (e.code === 'Tab') { e.preventDefault(); this.game.commandComplete?.(inp); }
    };
  }
}
