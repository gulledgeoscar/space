// In-game overlay: crosshair, hotbar, health/hunger/air, messages, speech
// bubbles, vehicle and ammo readouts, debug info and screen effects.
import * as THREE from 'three';
import { iconFor } from './icons.js';
import { stackName, TOOLS } from '../items/items.js';
import { BIOME_NAMES } from '../world/generator.js';
import { BLOCKS } from '../world/blocks.js';
import { Minimap } from './minimap.js';

const HEART = (fill) => `<svg viewBox="0 0 9 9" width="18" height="18" shape-rendering="crispEdges"><path d="M1 1h3v1h1V1h3v1h1v3H8v1H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V2h1z" fill="#1a0a0a"/><path d="M1 2h2v1h1v1h1V3h1V2h2v3H7v1H6v1H5v1H4V7H3V6H2V5H1z" fill="${fill}"/>${fill !== '#3a1010' ? '<path d="M2 3h1v1H2z" fill="#ffb0b0"/>' : ''}</svg>`;
const FOOD = (on) => `<svg viewBox="0 0 9 9" width="18" height="18" shape-rendering="crispEdges"><path d="M4 1h3v1h1v3H7v1H5v1H4v1H2V7H1V5h1V4h1V2h1z" fill="#1a0a00"/><path d="M4 2h3v3H6v1H4V5H3V3h1z" fill="${on ? '#c87830' : '#3a2010'}"/><path d="M2 6h1v1H2z" fill="${on ? '#eee' : '#555'}"/></svg>`;
const BUBBLE = `<svg viewBox="0 0 9 9" width="16" height="16"><circle cx="4.5" cy="4.5" r="3.5" fill="#80c0ff" stroke="#1a3a6a"/><rect x="3" y="2.5" width="1.5" height="1.5" fill="#fff"/></svg>`;

export class Hud {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    game.ui.appendChild(this.root);
    this.messages = [];
    this.debug = false;
    this.bubbles = new Map();
    this.damageFlash = 0;
  }

  build() {
    this.root.innerHTML = `
      <div class="vignette"></div>
      <div class="sleep-fade"></div>
      <div class="water-tint"></div>
      <div class="fire-tint"></div>
      <div class="damage-tint"></div>
      <div class="scope"><div class="scope-ring"></div></div>
      <div class="crosshair"></div>
      <div class="msgs"></div>
      <div class="topright">
        <div class="compass"></div>
        <div class="coords"></div>
      </div>
      <div class="debug"></div>
      <div class="bottom">
        <div class="item-name"></div>
        <div class="vehicle-info"></div>
        <div class="bars">
          <div class="hearts"></div>
          <div class="food"></div>
        </div>
        <div class="air"></div>
        <div class="hotbar"></div>
        <div class="mode-hint"></div>
      </div>
      <div class="ammo"></div>
      <div class="bossbar"><span></span><div><div></div></div></div>
      <div class="bubbles"></div>
    `;
    this.el = (sel) => this.root.querySelector(sel);
    this.hotbarEl = this.el('.hotbar');
    this.minimap = new Minimap(this.game, this.el('.topright'));
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = `<img alt=""><span class="count"></span><span class="num">${i + 1}</span>`;
      this.hotbarEl.appendChild(s);
      this.slots.push(s);
      // Tappable on touch screens (the HUD ignores the mouse otherwise).
      s.addEventListener('touchstart', (e) => { e.preventDefault(); this.game.inventory.select(i); }, { passive: false });
    }
    this.refresh();
  }

  refresh() {
    if (!this.slots) return;
    const inv = this.game.inventory;
    inv.hotbar.forEach((stack, i) => {
      const s = this.slots[i];
      const img = s.querySelector('img');
      const url = iconFor(this.game, stack);
      if (url) { img.src = url; img.style.visibility = 'visible'; } else img.style.visibility = 'hidden';
      const c = s.querySelector('.count');
      c.textContent = stack && !this.game.creative && stack.count > 1 ? stack.count : '';
      s.classList.toggle('sel', i === inv.index);
      s.title = stackName(stack);
    });
    const survival = this.game.mode === 'survival';
    this.el('.bars').style.display = survival ? 'flex' : 'none';
    const p = this.game.player;
    this.el('.mode-hint').textContent = p.vehicle ? '' : this.game.mode === 'creative' ? 'CREATIVE · E inventory · G world · T chat' : this.game.mode === 'spectator' ? 'SPECTATOR · fly through anything' : '';
    this.lastHearts = -1;
  }

  setHidden(h) { this.root.style.display = h ? 'none' : ''; }
  toggleDebug() { this.debug = !this.debug; this.el('.debug').style.display = this.debug ? 'block' : 'none'; }

  showItemName(text) {
    const el = this.el('.item-name');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('fade');
    void el.offsetWidth;
    el.classList.add('fade');
  }

  message(text, color = '#fff') {
    const el = this.root.querySelector('.msgs');
    if (!el) return;
    const m = document.createElement('div');
    m.className = 'msg';
    m.style.color = color;
    m.textContent = text;
    el.appendChild(m);
    this.messages.push({ el: m, time: 8 });
    while (el.children.length > 8) { el.removeChild(el.firstChild); this.messages.shift(); }
    this.game.menus?.consoleLog?.(text, color);
  }

  flashDamage() { this.damageFlash = 1; }

  // Fade to black, run fn at the darkest point, fade back.
  fade(fn) {
    const el = this.el('.sleep-fade');
    el.style.opacity = 1;
    setTimeout(() => { fn(); setTimeout(() => { el.style.opacity = 0; }, 400); }, 1300);
  }

  speech(entity, text) {
    let b = this.bubbles.get(entity);
    if (!b) {
      b = document.createElement('div');
      b.className = 'bubble';
      this.el('.bubbles').appendChild(b);
      this.bubbles.set(entity, b);
    }
    b.textContent = text;
    b.dataset.time = '4';
  }

  update(dt) {
    if (!this.slots) return;
    const g = this.game;
    const p = g.player;
    // Messages fade.
    for (const m of this.messages) {
      m.time -= dt;
      m.el.style.opacity = Math.max(0, Math.min(1, m.time));
    }
    this.messages = this.messages.filter((m) => { if (m.time <= 0) { m.el.remove(); return false; } return true; });

    // Survival bars.
    if (g.mode === 'survival') {
      const hk = `${Math.ceil(p.health)}|${Math.ceil(p.hunger)}|${p.hurtTimer > 0}`;
      if (hk !== this.lastHearts) {
        this.lastHearts = hk;
        let h = '';
        for (let i = 0; i < 10; i++) {
          const v = p.health - i * 2;
          h += `<span class="${p.hurtTimer > 0 ? 'blink' : ''}">${HEART(v >= 2 ? '#e02020' : v >= 1 ? '#e06060' : '#3a1010')}</span>`;
        }
        this.el('.hearts').innerHTML = h;
        let f = '';
        for (let i = 9; i >= 0; i--) f += FOOD(p.hunger - i * 2 >= 1);
        this.el('.food').innerHTML = f;
      }
      const air = this.el('.air');
      if (p.headInWater || p.air < 10) {
        air.style.display = 'flex';
        const n = Math.max(0, Math.ceil(p.air));
        if (air.dataset.n !== String(n)) { air.dataset.n = n; air.innerHTML = BUBBLE.repeat(n); }
      } else air.style.display = 'none';
    } else this.el('.air').style.display = 'none';

    // Screen tints.
    const camBlock = g.world.getBlock(g.camera.position.x, g.camera.position.y, g.camera.position.z);
    this.el('.water-tint').style.opacity = BLOCKS[camBlock]?.liquid === 'water' ? 1 : 0;
    this.el('.fire-tint').style.opacity = (p.burning > 0 && !g.creative) || BLOCKS[camBlock]?.liquid === 'lava' ? 0.8 : 0;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    this.el('.damage-tint').style.opacity = this.damageFlash * 0.7 + (g.mode === 'survival' && p.health <= 4 ? 0.25 + Math.sin(performance.now() / 200) * 0.1 : 0);
    const scoped = g.zoom && g.holding('sniper');
    this.el('.scope').style.display = scoped ? 'block' : 'none';
    this.el('.crosshair').style.display = scoped ? 'none' : '';

    // Ammo / tool info.
    const sel = g.inventory.selected;
    const ammo = this.el('.ammo');
    if (sel?.kind === 'tool' && TOOLS[sel.key]?.ammo) {
      const a = g.tools.ammo[sel.key] ?? TOOLS[sel.key].ammo;
      ammo.style.display = 'block';
      ammo.innerHTML = g.tools.reloading > 0 ? '<b>RELOADING</b>' : `<b>${a}</b> / ${TOOLS[sel.key].ammo}`;
    } else if (sel?.kind === 'tool' && ['terraform', 'shape', 'paint'].includes(sel.key)) {
      ammo.style.display = 'block';
      ammo.innerHTML = `${sel.key === 'shape' ? `${['sphere', 'hollow sphere', 'cube', 'hollow cube', 'cylinder', 'pyramid', 'wall', 'floor'][g.tools.shapeIndex]} · ` : ''}size <b>${g.tools.size}</b><br><small>Alt+scroll · block: ${BLOCKS[g.inventory.nextBlock].name}</small>`;
    } else if (sel?.kind === 'tool' && sel.key === 'jetpack') {
      ammo.style.display = 'block';
      ammo.innerHTML = `fuel <b>${Math.round(p.jetFuel * 100)}%</b>`;
    } else ammo.style.display = 'none';

    // Vehicle readout.
    const v = p.vehicle;
    const vi = this.el('.vehicle-info');
    if (v) {
      vi.style.display = 'block';
      const sp = v.body ? Math.hypot(v.body.velocity.x, v.body.velocity.z) : v.speed !== undefined ? Math.abs(v.speed) : Math.hypot(v.vel.x, v.vel.z);
      const hp = Math.max(0, v.health / v.maxHealth);
      const extra = v.type === 'plane' ? ` · throttle ${Math.round(v.throttle * 100)}% · alt ${Math.round(v.pos.y)}` : v.type === 'helicopter' ? ` · alt ${Math.round(v.pos.y)}` : '';
      vi.innerHTML = `<b>${Math.round(sp * 3.6)}</b> km/h${extra}<div class="hpbar"><div style="width:${hp * 100}%"></div></div>`;
    } else vi.style.display = 'none';

    this.minimap?.update(dt);

    // Boss health.
    const boss = g.entities.list.find((e) => e.type === 'dragon' && !e.removed && e.pos.distanceTo(p.position) < 160);
    const bb = this.el('.bossbar');
    bb.style.display = boss ? 'block' : 'none';
    if (boss) {
      bb.querySelector('span').textContent = boss.name;
      bb.querySelector('div div').style.width = `${Math.max(0, boss.health / boss.maxHealth) * 100}%`;
    }

    // Compass / coords / time.
    if (g.settings.showCoords !== false) {
      const dirs = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'];
      const yaw = ((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      this.el('.compass').textContent = dirs[Math.round(yaw / (Math.PI / 4)) % 8];
      this.el('.coords').innerHTML = `${Math.floor(p.box.x)}, ${Math.floor(p.box.y)}, ${Math.floor(p.box.z)}<br>${g.timeString()} · ${g.weather.type}${g.timeScale !== 1 ? ` · ${g.timeScale === 0 ? 'FROZEN' : 'SLOW-MO'}` : ''}`;
      this.el('.topright').style.display = '';
    } else this.el('.topright').style.display = 'none';

    // Debug.
    if (this.debug) {
      const [, biome] = g.generator.column(Math.floor(p.box.x), Math.floor(p.box.z));
      const r = g.renderer.info.render;
      this.el('.debug').innerHTML = [
        `LIMITLESS sandbox · ${Math.round(g.fps)} fps`,
        `XYZ ${p.box.x.toFixed(2)} ${p.box.y.toFixed(2)} ${p.box.z.toFixed(2)}`,
        `Chunk ${Math.floor(p.box.x / 16)} ${Math.floor(p.box.z / 16)} · Biome ${BIOME_NAMES[biome]}`,
        `Chunks ${g.world.chunks.size} · Entities ${g.entities.list.length} · Bodies ${g.physics.bodies.size} · Proxies ${g.physics.proxies.size}`,
        `Draw calls ${r.calls} · Triangles ${(r.triangles / 1000).toFixed(0)}k`,
        `Block ticks ${g.ticks.queue.size} · Seed ${g.meta.seed}`,
        `Workers ${g.world.pool.workers.length} · gen ${(g.world.pool.stats.genMs / Math.max(1, g.world.pool.stats.gen)).toFixed(1)} ms · mesh ${(g.world.pool.stats.meshMs / Math.max(1, g.world.pool.stats.mesh)).toFixed(1)} ms`,
        `Looking at ${g.tools.target ? `${BLOCKS[g.tools.target.id].name} ${g.tools.target.x} ${g.tools.target.y} ${g.tools.target.z}` : g.tools.targetEntity ? g.tools.targetEntity.entity.type : '-'}`,
      ].join('<br>');
    }

    // Speech bubbles follow their speakers.
    const v3 = new THREE.Vector3();
    for (const [e, b] of this.bubbles) {
      let t = parseFloat(b.dataset.time) - dt;
      b.dataset.time = String(t);
      if (t <= 0 || e.removed) { b.remove(); this.bubbles.delete(e); continue; }
      v3.set(e.pos.x, e.pos.y + e.height * e.scale + 0.6, e.pos.z).project(g.camera);
      const visible = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
      b.style.display = visible ? '' : 'none';
      b.style.left = `${(v3.x * 0.5 + 0.5) * window.innerWidth}px`;
      b.style.top = `${(-v3.y * 0.5 + 0.5) * window.innerHeight}px`;
      b.style.opacity = Math.min(1, t);
    }
  }

  dispose() { this.root.remove(); }
}
