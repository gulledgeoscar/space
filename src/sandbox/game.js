// The running game: owns the renderer, world, player and every subsystem,
// and runs the frame loop.
import * as THREE from 'three';
import { World } from './world/world.js';
import { Sky } from './world/sky.js';
import { Weather } from './world/weather.js';
import { BlockTicks } from './world/ticks.js';
import { Generator, BIOME_NAMES } from './world/generator.js';
import { CHUNK, HEIGHT, SEA_LEVEL } from './world/constants.js';
import { BLOCKS, B, LIQUID, isDoor } from './world/blocks.js';
import { Player } from './player/player.js';
import { Input } from './input.js';
import { Particles } from './fx/particles.js';
import { Tools } from './items/tools.js';
import { Inventory } from './items/inventory.js';
import { EntityManager } from './entities/manager.js';
import { Physics } from './physics/physics.js';
import { explode } from './fx/explosion.js';
import { Hud } from './ui/hud.js';
import { Menus } from './ui/menus.js';
import { runCommand } from './ui/commands.js';
import { TouchControls } from './ui/touch.js';

export class Game {
  constructor({ canvas, ui, atlas, audio, settings, storage, meta }) {
    this.canvas = canvas;
    this.ui = ui;
    this.atlas = atlas;
    this.audio = audio;
    this.settings = settings;
    this.storage = storage;
    this.meta = meta;
    this.mode = meta.mode ?? 'creative';
    this.difficulty = meta.difficulty ?? 'normal';
    this.gravity = 28;
    this.timeScale = 1;
    this.hours = 8;
    this.dayLength = 20; // real minutes per in-game day
    this.daylightCycle = true;
    this.mobSpawning = meta.mobSpawning ?? true;
    this.fireSpread = true;
    this.explosionsBreak = true;
    this.keepInventory = true;
    this.noclipCheat = false;
    this.thirdPerson = false;
    this.zoom = false;
    this.hudHidden = false;
    this.paused = false;
    this.running = false;
    this.elapsed = 0;
    this.shake = 0;
    this.stats = { blocksBroken: 0, blocksPlaced: 0, kills: 0, explosions: 0 };
    this.chests = new Map(); // "x,y,z" -> 27 slots
    this.populatedVillages = new Set();
    this.visitedChunks = new Set();

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio ?? 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.fog = new THREE.Fog(0xaaccff, 80, 120);
    this.scene.fog = this.fog;
    this.camera = new THREE.PerspectiveCamera(settings.fov ?? 75, window.innerWidth / window.innerHeight, 0.05, 2000);
    this.scene.add(this.camera);

    // Lights for entities (chunks are lit by their own shader).
    this.hemi = new THREE.HemisphereLight(0xdde8ff, 0x6a5a40, 1.2);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    this.sun.position.set(50, 100, 30);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.input = new Input(canvas);
    this.world = new World(this.scene, atlas, { seed: meta.seed, worldType: meta.worldType, renderDistance: settings.renderDistance ?? 8, storage });
    this.generator = new Generator(meta.seed, { type: meta.worldType });
    this.sky = new Sky(this.scene);
    this.weather = new Weather(this);
    this.particles = new Particles(this);
    this.player = new Player(this);
    this.inventory = new Inventory(this);
    this.physics = new Physics(this);
    this.entities = new EntityManager(this);
    this.ticks = new BlockTicks(this);
    this.tools = new Tools(this);
    this.hud = new Hud(this);
    this.menus = new Menus(this);
    this.touch = new TouchControls(this);

    this.world.onChange((x, y, z, id, old) => {
      // Chests spill their contents; doors lose their other half.
      if (old === B.chest && id !== B.chest) this.dropChest(x, y, z);
      if (isDoor(old) && !isDoor(id)) for (const dy of [-1, 1]) if (isDoor(this.world.getBlock(x, y + dy, z))) this.world.setBlock(x, y + dy, z, 0);
      this.ticks.onBlockChange(x, y, z, id, old);
      this.physics.onBlockChange(x, y, z);
    });
    this.world.onChunkLoaded = (c) => { this.entities.onChunkLoaded(c); if (c.fromSave) this.ticks.scanChunk(c); };
    this.world.onChunkUnload = (c) => this.entities.onChunkUnload(c);

    this.input.onLockChange = (locked) => {
      if (!locked && this.running && !this.menus.open && !this.player.dead) this.menus.showPause();
    };
    this.onResize = () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.tools.resize();
    };
    window.addEventListener('resize', this.onResize);
    this.onUnload = () => { this.save(); };
    window.addEventListener('beforeunload', this.onUnload);
  }

  get creative() { return this.mode !== 'survival'; }

  holding(key) {
    const s = this.inventory.selected;
    return s && s.kind === 'tool' && s.key === key;
  }

  async start() {
    const state = this.storage?.state;
    if (state) this.restore(state);
    else {
      // New world: find land near the origin.
      const spot = this.findLandNear(0, 0);
      this.player.spawn.set(spot.x + 0.5, spot.y, spot.z + 0.5);
      this.player.teleport(spot.x + 0.5, spot.y, spot.z + 0.5);
      this.player.yaw = Math.PI * 0.75;
      this.inventory.giveStarter();
    }
    this.world.update(this.player.box.x, this.player.box.z);
    this.hud.build();
    this.tools.onSelect();
    this.running = true;
    this.last = performance.now();
    this.loadingDone = false;
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    this.autosave = setInterval(() => this.save(), 30000);
  }

  // Scan outward in a spiral for a dry column using the generator directly.
  findLandNear(x0, z0) {
    // Start next to a village when there's one nearby.
    let best = null;
    for (const v of this.generator.villages.near(x0 - 700, z0 - 700, x0 + 700, z0 + 700)) {
      const d = Math.hypot(v.x - x0, v.z - z0);
      if (!best || d < best.d) best = { d, v };
    }
    if (best) {
      const x = best.v.x + 6, z = best.v.z + 1;
      return { x, y: this.generator.column(x, z)[0] + 1.01, z };
    }
    for (let r = 0; r < 4000; r += 24) {
      const steps = Math.max(1, Math.floor((r * Math.PI * 2) / 24));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.round(x0 + Math.cos(a) * r), z = Math.round(z0 + Math.sin(a) * r);
        const [h, biome] = this.generator.column(x, z);
        if (h > SEA_LEVEL + 1 && h < SEA_LEVEL + 30 && BIOME_NAMES[biome] !== 'Ocean') return { x, y: h + 1.01, z };
      }
    }
    return { x: x0, y: 100, z: z0 };
  }

  // Once chunks are in, make sure the player is standing in open air.
  findSafeSpawn(player) {
    const x = Math.floor(player.box.x), z = Math.floor(player.box.z);
    const top = this.world.surfaceY(x, z);
    if (top >= 0) player.teleport(player.box.x, top + 1.01, player.box.z);
  }

  restore(s) {
    const p = this.player;
    p.teleport(s.player.x, s.player.y, s.player.z);
    p.yaw = s.player.yaw; p.pitch = s.player.pitch;
    p.health = s.player.health ?? 20; p.hunger = s.player.hunger ?? 20;
    p.flying = !!s.player.flying;
    if (s.player.spawn) p.spawn.set(s.player.spawn.x, s.player.spawn.y, s.player.spawn.z);
    this.hours = s.hours ?? 8;
    this.mode = s.mode ?? this.mode;
    this.difficulty = s.difficulty ?? this.difficulty;
    this.gravity = s.gravity ?? 28;
    this.daylightCycle = s.daylightCycle ?? true;
    this.mobSpawning = s.mobSpawning ?? true;
    this.fireSpread = s.fireSpread ?? true;
    this.explosionsBreak = s.explosionsBreak ?? true;
    this.dayLength = s.dayLength ?? 20;
    if (s.weather) this.weather.set(s.weather.type, s.weather.time);
    if (s.inventory) this.inventory.load(s.inventory);
    else this.inventory.giveStarter();
    if (s.entities) this.entities.pendingRestore = s.entities;
    if (s.stats) this.stats = { ...this.stats, ...s.stats };
    if (s.chests) this.chests = new Map(Object.entries(s.chests));
    if (s.villages) this.populatedVillages = new Set(s.villages);
    if (s.visited) this.visitedChunks = new Set(s.visited);
    this.restored = true;
  }

  snapshot() {
    const p = this.player;
    return {
      version: 1,
      player: { x: p.box.x, y: p.box.y, z: p.box.z, yaw: p.yaw, pitch: p.pitch, health: p.health, hunger: p.hunger, flying: p.flying, spawn: { x: p.spawn.x, y: p.spawn.y, z: p.spawn.z } },
      hours: this.hours,
      mode: this.mode,
      difficulty: this.difficulty,
      gravity: this.gravity,
      daylightCycle: this.daylightCycle,
      mobSpawning: this.mobSpawning,
      fireSpread: this.fireSpread,
      explosionsBreak: this.explosionsBreak,
      dayLength: this.dayLength,
      weather: { type: this.weather.type, time: this.weather.timer },
      inventory: this.inventory.save(),
      entities: this.entities.serialize(),
      stats: this.stats,
      chests: Object.fromEntries(this.chests),
      villages: [...this.populatedVillages],
      visited: [...this.visitedChunks],
    };
  }

  save() {
    if (!this.storage || !this.running) return Promise.resolve();
    return Promise.all([this.world.saveAll(), this.storage.saveMeta(this.snapshot())]);
  }

  async quit() {
    await this.save();
    this.running = false;
    clearInterval(this.autosave);
    this.input.unlock();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onUnload);
    this.weather.dispose();
    this.audio.stopLoop('rain'); this.audio.stopLoop('wind'); this.audio.stopLoop('flame');
    this.entities.dispose();
    this.world.dispose();
    this.hud.dispose();
    this.menus.dispose();
    this.tools.dispose();
    this.touch.dispose();
    this.input.dispose();
    this.renderer.dispose();
  }

  explode(pos, power, opts = {}) {
    explode(this, pos, power, opts);
  }

  message(text, color) { this.hud.message(text, color); }

  chest(key) {
    if (!this.chests.has(key)) this.chests.set(key, new Array(27).fill(null));
    return this.chests.get(key);
  }

  dropChest(x, y, z) {
    const key = `${x},${y},${z}`;
    const items = this.chests.get(key);
    this.chests.delete(key);
    if (!items) return;
    for (const s of items) if (s) this.entities.dropItem({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, s);
  }

  // Beds skip the night (and set your spawn point).
  sleep(t) {
    const p = this.player;
    p.spawn.set(t.x + 0.5, t.y + 1, t.z + 0.5);
    if (this.sky.nightness < 0.5 && this.weather.type !== 'storm') { this.message('Spawn point set. You can only sleep at night.'); return; }
    if (this.mode === 'survival' && this.entities.list.some((e) => e.hostile && e.pos.distanceTo(p.position) < 10)) { this.message('You may not rest now; there are monsters nearby.', '#ff9090'); return; }
    this.hud.fade(() => {
      this.hours = 6.2;
      if (this.weather.type !== 'clear') this.weather.set('clear');
      this.message('Good morning!');
    });
  }

  command(text) { return runCommand(this, text); }

  onPlayerDeath(cause) {
    const msgs = {
      fall: 'hit the ground too hard', lava: 'tried to swim in lava', drown: 'drowned', fire: 'burned to death',
      explosion: 'blew up', void: 'fell out of the world', mob: 'was slain', starve: 'starved to death', magma: 'discovered the floor was lava',
      lightning: 'was struck by lightning', generic: 'died',
    };
    if (this.player.vehicle) this.entities.dismount(this.player);
    this.message(`You ${msgs[cause] ?? 'died'}.`, '#ff6060');
    if (!this.keepInventory) this.inventory.dropAll();
    this.input.unlock();
    this.menus.showDeath(msgs[cause] ?? 'died');
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'survival') { this.player.flying = false; this.player.noclip = false; }
    if (mode !== 'spectator') this.player.noclip = false;
    this.message(`Game mode: ${mode[0].toUpperCase() + mode.slice(1)}`);
    this.hud.refresh();
  }

  handleGlobalKeys() {
    const i = this.input;
    if (i.hit('KeyE') && !this.player.dead) { this.menus.showInventory(); return; }
    if (i.hit('KeyT') || i.hit('Slash') || i.hit('Enter')) { this.menus.showConsole(i.hit('Slash') ? '/' : ''); return; }
    if (i.hit('KeyG')) { this.menus.showWorldSettings(); return; }
    if (i.hit('F1')) { this.hudHidden = !this.hudHidden; this.hud.setHidden(this.hudHidden); }
    if (i.hit('F3')) this.hud.toggleDebug();
    if (i.hit('F2')) this.wantScreenshot = true;
    if (i.hit('KeyJ')) { this.settings.showMinimap = this.settings.showMinimap === false; this.message(this.settings.showMinimap ? 'Minimap on' : 'Minimap off'); }
    if (i.hit('F5') || i.hit('KeyV') && !this.holding('copy')) this.thirdPerson = !this.thirdPerson;
    if (i.hit('KeyF') && this.creative && this.mode !== 'spectator') { this.player.flying = !this.player.flying; this.message(this.player.flying ? 'Flying' : 'Walking'); }
    if (i.hit('KeyN') && this.creative) {
      this.player.noclip = !this.player.noclip;
      this.noclipCheat = this.player.noclip;
      if (this.player.noclip) this.player.flying = true;
      this.message(this.player.noclip ? 'Noclip on' : 'Noclip off');
    }
    if (i.hit('KeyM')) {
      const order = ['creative', 'survival', 'spectator'];
      this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
    }
    if (i.hit('KeyR') && !this.tools.usesReload()) {
      if (this.player.vehicle) this.entities.dismount(this.player);
      else this.entities.tryMount(this.player);
    }
    if (i.hit('KeyQ')) this.inventory.dropSelected(i.key('ControlLeft'));
    if (i.hit('KeyZ')) this.zoomToggle = !this.zoomToggle;
    if (i.hit('KeyK')) { this.hours = (this.hours + 6) % 24; this.message(`Time: ${this.timeString()}`); }
    if (i.hit('KeyL')) this.weather.cycle();
    if (i.hit('KeyP')) this.setTimeScale(this.timeScale === 1 ? 0.25 : this.timeScale === 0.25 ? 0 : 1);
    if (i.hit('KeyB')) this.player.spawn.copy(this.player.position), this.message('Spawn point set here');
    for (let n = 1; n <= 9; n++) if (i.hit(`Digit${n}`)) this.inventory.select(n - 1);
    if (i.wheel && !i.key('AltLeft')) this.inventory.select((this.inventory.index + i.wheel + 9) % 9);
  }

  setTimeScale(s) {
    this.timeScale = s;
    this.message(s === 0 ? 'Time frozen (P to resume)' : s < 1 ? 'Slow motion' : 'Normal speed');
  }

  timeString() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  frame(now) {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps ? this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05 : 60;

    const p = this.player;
    // Hold the player in place until the ground under them has loaded.
    if (!this.loadingDone) {
      this.world.update(p.box.x, p.box.z);
      const prog = this.world.progress(2);
      this.menus.setLoading(prog);
      if (prog >= 1 && this.world.isLoaded(p.box.x, p.box.z)) {
        this.loadingDone = true;
        if (!this.restored) this.findSafeSpawn(p);
        this.menus.setLoading(null);
        this.entities.afterLoad();
        if (!this.menus.open) this.menus.showStartHint();
      }
      // The loading screen covers everything, so skip rendering and let the
      // workers have the CPU.
      this.input.endFrame();
      return;
    }

    // Gamepad: Start pauses; A / B confirm or back out of menus.
    const pad = this.input.pollGamepad(dt);
    if (pad) {
      if (pad.pause && !this.menus.open) this.menus.showPause();
      else if (this.menus.open && pad.menuConfirm) this.menus.panel?.querySelector('button.primary')?.click();
      else if (this.menus.open && pad.menuBack && this.menus.open !== 'death') { if (this.menus.open === 'pause') this.menus.close(true); else this.menus.close(true); }
    }
    if (this.input.virtual && !this.menus.open && !this.paused) this.input.locked = true;
    this.touch.setVisible(!this.menus.open && !this.hudHidden);
    const active = !this.paused && !this.menus.open;
    if (active && this.input.locked) this.handleGlobalKeys();
    this.zoom = (this.zoomToggle || (this.holding('sniper') && this.input.mouse(2))) && active;

    const sdt = this.paused ? 0 : dt * this.timeScale;
    if (active && this.input.locked) {
      const sens = (this.settings.sensitivity ?? 1) * 0.0022 * (this.zoom ? 0.3 : 1);
      p.look(this.input.mouseDX, this.input.mouseDY * (this.settings.invertY ? -1 : 1), sens);
    }
    if (!this.paused) {
      // The player moves in real time, so slow motion and frozen time work
      // like bullet time.
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const inp = active && this.input.locked ? this.input : NO_INPUT;
      for (let k = 0; k < steps; k++) p.update(dt / steps, k === 0 ? inp : HELD(inp));
      if (active && this.input.locked) this.tools.update(dt, this.input);
      else this.tools.update(dt, NO_INPUT);
      this.world.update(p.box.x, p.box.z);
      this.entities.update(sdt, dt);
      this.physics.update(sdt);
      this.ticks.update(sdt);
      if (this.daylightCycle) this.hours = (this.hours + (sdt * 24) / (this.dayLength * 60)) % 24;
      this.elapsed += sdt;
    }
    this.weather.update(sdt, dt);
    this.musicTimer = (this.musicTimer ?? 20) - dt;
    if (this.musicTimer <= 0) { this.musicTimer = 70 + Math.random() * 120; this.audio.playMusic(this.sky.nightness > 0.6); }
    this.particles.update(sdt);
    p.applyCamera(this.camera, this.thirdPerson, dt);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.rotation.z += (Math.random() - 0.5) * this.shake * 0.05;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.updateMatrixWorld();
    this.audio.updateListener(this.camera);
    this.hud.update(dt);
    this.renderFrame(dt);
    this.input.endFrame();
  }

  renderFrame(dt) {
    const p = this.player;
    this.sky.update(this.hours, this.camera, this.weather.storminess, dt);
    const u = this.world.materials.uniforms;
    u.time.value += dt;
    const flash = this.weather.flash;
    u.daylight.value = Math.min(1, this.sky.daylight + flash * 0.8);
    u.flash.value.setRGB(flash * 0.3, flash * 0.3, flash * 0.35);
    u.sunDir.value.copy(this.sky.sunDir);
    u.skyColor.value.copy(this.sky.uniforms.zenith.value).lerp(this.sky.fogColor, 0.5);
    const camBlock = this.world.getBlock(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    const far = this.world.renderDistance * CHUNK;
    if (LIQUID[camBlock] === 1) {
      u.fogColor.value.setRGB(0.08, 0.2, 0.45).multiplyScalar(0.3 + this.sky.daylight * 0.7);
      u.fogNear.value = 1; u.fogFar.value = 24;
      this.audio.setUnderwater(true);
    } else if (LIQUID[camBlock] === 2) {
      u.fogColor.value.setRGB(0.9, 0.3, 0.05);
      u.fogNear.value = 0; u.fogFar.value = 3;
    } else {
      u.fogColor.value.copy(this.sky.fogColor);
      const thick = this.weather.fogDensity;
      u.fogFar.value = far * (1 - thick * 0.6) - 4;
      u.fogNear.value = u.fogFar.value * (0.55 - thick * 0.4);
      this.audio.setUnderwater(false);
    }
    this.fog.color.copy(u.fogColor.value);
    this.fog.near = u.fogNear.value;
    this.fog.far = u.fogFar.value;
    const bg = u.fogColor.value;
    this.renderer.setClearColor(bg);
    // Entity lighting follows the sun.
    const d = this.sky.daylight;
    this.hemi.intensity = 0.25 + d * 1.0 + flash;
    this.sun.intensity = d * 1.5;
    this.sun.position.copy(this.sky.sunDir).multiplyScalar(100).add(p.position);
    this.sun.target.position.copy(p.position);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (!this.thirdPerson && !p.dead && !this.hudHidden) {
      this.renderer.clearDepth();
      this.tools.renderViewModel(this.renderer, d, p);
    }
    if (this.wantScreenshot) {
      this.wantScreenshot = false;
      const a = document.createElement('a');
      a.href = this.canvas.toDataURL('image/png');
      a.download = `limitless-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      this.message('Screenshot saved');
    }
  }
}

const NO_INPUT = {
  key: () => false, hit: () => false, doubleTap: () => false, axis: () => 0, mouse: () => false, click: () => false, release: () => false,
  wheel: 0, mouseDX: 0, mouseDY: 0,
};
// Later physics substeps see held keys but not fresh presses.
const HELD = (inp) => (inp === NO_INPUT ? NO_INPUT : {
  key: (c) => inp.key(c), hit: () => false, doubleTap: () => false, axis: (a, b) => inp.axis(a, b), mouse: (b) => inp.mouse(b), click: () => false, release: () => false,
  wheel: 0, mouseDX: 0, mouseDY: 0,
});

export { HEIGHT, B, BLOCKS };
