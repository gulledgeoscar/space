// Chat commands: /time, /weather, /give, /summon, /tp, /fill, /explode…
import * as THREE from 'three';
import { B, BLOCKS } from '../world/blocks.js';
import { TOOLS, SPAWNS } from '../items/items.js';
import { MOB_TYPES } from '../entities/mobs.js';
import { BIOME_NAMES } from '../world/generator.js';
import { buildStructure, STRUCTURE_KEYS } from '../world/structures.js';

const HELP = [
  '/time set <day|noon|night|midnight|0-24> · /time speed <minutes per day>',
  '/weather <clear|rain|storm|snow> · /gravity <number|moon|mars|earth|jupiter>',
  '/gamemode <creative|survival|spectator> · /difficulty <peaceful|easy|normal|hard>',
  '/give <item> [count] · /summon <creature|vehicle|prop> [count] · /build <structure>',
  '/tp <x> <y> <z> | spawn · /locate <biome> · /seed · /heal · /fly · /noclip',
  '/kill <monsters|animals|items|all|me> · /fill <block> <radius> · /explode [power] · /nuke',
  '/rain <creature> [count] (it\'s raining pigs) · /speed <x> · /jump <x> · /timescale <x>',
  '/clear (inventory) · /spawnpoint · /size <0.25-4>',
];

function findItem(name) {
  const n = name.toLowerCase().replace(/\s+/g, '_');
  if (B[n] !== undefined) return { kind: 'block', id: B[n], count: 64 };
  if (TOOLS[n]) return { kind: 'tool', key: n, count: 1 };
  if (SPAWNS[n]) return { kind: 'spawn', key: n, count: 1 };
  const block = BLOCKS.find((b) => b && !b.hidden && (b.name.toLowerCase().replace(/\s+/g, '_') === n || b.key.includes(n)));
  if (block) return { kind: 'block', id: block.id, count: 64 };
  const tool = Object.entries(TOOLS).find(([, t]) => t.name.toLowerCase().includes(n.replace(/_/g, ' ')));
  if (tool) return { kind: 'tool', key: tool[0], count: 1 };
  const spawn = Object.entries(SPAWNS).find(([, s]) => s.name.toLowerCase().includes(n.replace(/_/g, ' ')));
  if (spawn) return { kind: 'spawn', key: spawn[0], count: 1 };
  return null;
}

function spawnKey(name) {
  const n = name.toLowerCase();
  if (SPAWNS[n]) return n;
  if (n === 'dog') return 'wolf';
  const e = Object.entries(SPAWNS).find(([, s]) => s.name.toLowerCase().includes(n));
  return e ? e[0] : null;
}

export function runCommand(g, text) {
  const [cmdRaw, ...args] = text.slice(1).trim().split(/\s+/);
  const cmd = (cmdRaw || '').toLowerCase();
  const p = g.player;
  const say = (t, c = '#ffe080') => g.message(t, c);
  const err = (t) => g.message(t, '#ff8080');
  const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
  const ahead = () => {
    const hit = g.world.raycast(p.eyePos, p.lookDir(), 14);
    if (hit) return new THREE.Vector3(hit.x + 0.5 + hit.nx, hit.y + Math.max(0, hit.ny), hit.z + 0.5 + hit.nz);
    const at = p.eyePos.addScaledVector(p.lookDir().setY(0).normalize(), 6);
    const top = g.world.surfaceY(Math.floor(at.x), Math.floor(at.z), false);
    if (top >= 0 && top < at.y + 4) at.y = top + 1;
    return at;
  };
  switch (cmd) {
    case 'help': case '?':
      HELP.forEach((l) => say(l, '#c0e0ff'));
      break;
    case 'time': {
      if (args[0] === 'speed') { g.dayLength = Math.max(0.5, num(args[1], 20)); say(`A day now lasts ${g.dayLength} minutes`); break; }
      const v = args[0] === 'set' ? args[1] : args[0];
      const named = { day: 7, morning: 7, noon: 12, sunset: 18.3, evening: 18.5, night: 21, midnight: 0, sunrise: 5.8 };
      const hrs = named[v] ?? num(v, null);
      if (hrs === null) { err('Usage: /time set <day|noon|night|midnight|0-24>'); break; }
      g.hours = ((hrs % 24) + 24) % 24;
      say(`Time set to ${g.timeString()}`);
      break;
    }
    case 'day': g.hours = 8; say('Good morning'); break;
    case 'night': g.hours = 21; say('Good night'); break;
    case 'weather': {
      const w = args[0] ?? 'clear';
      if (!['clear', 'rain', 'storm', 'snow', 'thunder'].includes(w)) { err('Usage: /weather <clear|rain|storm|snow>'); break; }
      g.weather.set(w === 'thunder' ? 'storm' : w, 900);
      say(`Weather: ${g.weather.type}`);
      break;
    }
    case 'gamemode': case 'gm': {
      const m = { c: 'creative', 1: 'creative', creative: 'creative', s: 'survival', 0: 'survival', survival: 'survival', sp: 'spectator', 3: 'spectator', spectator: 'spectator' }[args[0]];
      if (!m) { err('Usage: /gamemode <creative|survival|spectator>'); break; }
      g.setMode(m);
      break;
    }
    case 'difficulty': {
      if (!['peaceful', 'easy', 'normal', 'hard'].includes(args[0])) { err('Usage: /difficulty <peaceful|easy|normal|hard>'); break; }
      g.difficulty = args[0];
      say(`Difficulty: ${args[0]}`);
      break;
    }
    case 'gravity': {
      const presets = { moon: 4.6, mars: 10.6, earth: 28, normal: 28, jupiter: 70, zero: 0.5, space: 0.5 };
      const v = presets[args[0]] ?? num(args[0], null);
      if (v === null) { err('Usage: /gravity <number|moon|mars|earth|jupiter>'); break; }
      g.gravity = Math.max(0.1, Math.min(200, v));
      say(`Gravity: ${(g.gravity / 28).toFixed(2)} g`);
      break;
    }
    case 'give': case 'i': {
      if (!args[0]) { err('Usage: /give <item> [count]'); break; }
      const item = findItem(args.slice(0, args.length > 1 && Number.isFinite(+args[args.length - 1]) ? -1 : undefined).join('_'));
      if (!item) { err(`Unknown item: ${args[0]}`); break; }
      if (Number.isFinite(+args[args.length - 1]) && args.length > 1) item.count = Math.max(1, Math.min(640, +args[args.length - 1]));
      // Creative: hand it straight to you in the selected slot.
      const left = g.creative ? (g.inventory.setSlot(g.inventory.index, item), 0) : g.inventory.add(item);
      say(left ? 'Inventory full' : `Gave ${item.count} × ${item.kind === 'block' ? BLOCKS[item.id].name : item.kind === 'tool' ? TOOLS[item.key].name : SPAWNS[item.key].name}`);
      break;
    }
    case 'summon': case 'spawn': {
      const key = spawnKey(args[0] ?? '');
      if (!key) { err(`Unknown thing: ${args[0] ?? ''}. Try pig, horse, car, plane, zombie, dummy…`); break; }
      const n = Math.max(1, Math.min(50, num(args[1], 1)));
      if (SPAWNS[key].category === 'Structures') { const at = ahead(); buildStructure(g, key, Math.floor(at.x), Math.floor(at.y), Math.floor(at.z), p.yaw); break; }
      for (let i = 0; i < n; i++) {
        const at = ahead().add(new THREE.Vector3((Math.random() - 0.5) * (n > 1 ? 4 : 0), key === 'nuke' ? 70 : 0.5, (Math.random() - 0.5) * (n > 1 ? 4 : 0)));
        g.entities.spawn(key, at, { yaw: p.yaw + Math.PI });
      }
      say(`Summoned ${n} × ${SPAWNS[key].name}`);
      break;
    }
    case 'rain': {
      const key = spawnKey(args[0] ?? 'pig');
      if (!key || !MOB_TYPES[key] && !['crate', 'ball', 'melon_prop', 'barrel', 'primed_tnt', 'bowling'].includes(key)) { err('Usage: /rain <creature> [count]'); break; }
      const n = Math.max(1, Math.min(60, num(args[1], 20)));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 14;
        g.entities.spawn(key, { x: p.box.x + Math.cos(a) * r, y: Math.min(125, p.box.y + 25 + Math.random() * 20), z: p.box.z + Math.sin(a) * r });
      }
      say(`It's raining ${SPAWNS[key].name.toLowerCase()}s!`);
      break;
    }
    case 'build': {
      const key = STRUCTURE_KEYS.find((k) => k === args[0] || SPAWNS[k]?.name.toLowerCase().includes((args[0] ?? '').toLowerCase()));
      if (!key) { err(`Structures: ${STRUCTURE_KEYS.join(', ')}`); break; }
      const at = ahead();
      const n = buildStructure(g, key, Math.floor(at.x), Math.floor(at.y), Math.floor(at.z), p.yaw);
      say(`Built ${SPAWNS[key].name} (${n} blocks)`);
      break;
    }
    case 'tp': case 'teleport': {
      if (args[0] === 'spawn') { p.teleport(p.spawn.x, p.spawn.y, p.spawn.z); break; }
      const rel = (v, base) => (v?.startsWith('~') ? base + num(v.slice(1), 0) : num(v, null));
      const x = rel(args[0], p.box.x), y = rel(args[1], p.box.y), z = rel(args[2], p.box.z);
      if (x === null || y === null || z === null) { err('Usage: /tp <x> <y> <z> (use ~ for relative)'); break; }
      p.teleport(x, y, z);
      say(`Teleported to ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`);
      break;
    }
    case 'locate': {
      const want = (args.join(' ') || '').toLowerCase();
      if (want === 'village') {
        const vs = g.generator.villages.near(p.box.x - 2000, p.box.z - 2000, p.box.x + 2000, p.box.z + 2000);
        vs.sort((a, b) => Math.hypot(a.x - p.box.x, a.z - p.box.z) - Math.hypot(b.x - p.box.x, b.z - p.box.z));
        if (!vs.length) { err('No village within 2000 blocks'); break; }
        say(`Nearest village: ${vs[0].x}, ${vs[0].y}, ${vs[0].z}. /tp ${vs[0].x + 4} ${vs[0].y + 2} ${vs[0].z}`);
        break;
      }
      const idx = BIOME_NAMES.findIndex((b) => b.toLowerCase().includes(want));
      if (!want || idx < 0) { err(`Biomes: ${BIOME_NAMES.join(', ')}`); break; }
      for (let r = 32; r < 6000; r += 32) {
        for (let k = 0; k < Math.max(8, r / 8); k++) {
          const a = (k / Math.max(8, r / 8)) * Math.PI * 2;
          const x = Math.round(p.box.x + Math.cos(a) * r), z = Math.round(p.box.z + Math.sin(a) * r);
          const [h, b] = g.generator.column(x, z);
          if (b === idx) {
            say(`Nearest ${BIOME_NAMES[idx]}: ${x}, ${h + 1}, ${z} (${r} blocks away). /tp ${x} ${h + 2} ${z}`);
            return true;
          }
        }
      }
      err('Not found nearby');
      break;
    }
    case 'biome': { const [, b] = g.generator.column(Math.floor(p.box.x), Math.floor(p.box.z)); say(`You are in: ${BIOME_NAMES[b]}`); break; }
    case 'seed': say(`Seed: ${g.meta.seed}`); break;
    case 'heal': p.health = p.maxHealth; p.hunger = 20; p.burning = 0; say('Healed'); break;
    case 'fly': if (g.mode === 'survival') g.setMode('creative'); p.flying = !p.flying; say(p.flying ? 'Flying' : 'Walking'); break;
    case 'noclip': p.noclip = !p.noclip; g.noclipCheat = p.noclip; if (p.noclip) p.flying = true; say(p.noclip ? 'Noclip on' : 'Noclip off'); break;
    case 'kill': {
      const what = args[0] ?? 'monsters';
      if (what === 'me') { p.dead = false; g.mode === 'survival' ? p.damage(1000, 'generic') : say('You are immortal in creative'); break; }
      const filters = {
        monsters: (e) => e.hostile, animals: (e) => e.kind === 'mob' && !e.hostile, items: (e) => e.kind === 'item',
        all: (e) => e.kind !== 'projectile', vehicles: (e) => e.kind === 'vehicle', props: (e) => e.kind === 'prop',
      };
      const f = filters[what];
      if (!f) { err('Usage: /kill <monsters|animals|items|vehicles|props|all|me>'); break; }
      say(`Removed ${g.entities.clear(f)}`);
      break;
    }
    case 'fill': {
      const item = findItem(args[0] ?? '');
      if (!item || item.kind !== 'block') { err('Usage: /fill <block> <radius> (sphere around you) or /fill x1 y1 z1 x2 y2 z2 <block>'); break; }
      if (args.length >= 7) break;
      const r = Math.max(1, Math.min(20, num(args[1], 5)));
      const c = p.position;
      const n = g.tools.sphere(c, r, () => item.id, () => true);
      p.teleport(c.x, c.y + r + 1, c.z);
      say(`Filled ${n} blocks`);
      break;
    }
    case 'explode': case 'boom': g.explode(ahead(), Math.max(1, Math.min(20, num(args[0], 5))), { fire: args.includes('fire') }); break;
    case 'nuke': { const at = ahead(); at.y += 70; g.entities.spawn('nuke', at); say('Nuke incoming!', '#ff8040'); break; }
    case 'speed': g.settings.speedMult = Math.max(0.1, Math.min(10, num(args[0], 1))); say(`Speed ${g.settings.speedMult}×`); break;
    case 'jump': g.settings.jumpMult = Math.max(0.1, Math.min(10, num(args[0], 1))); say(`Jump ${g.settings.jumpMult}×`); break;
    case 'timescale': case 'slowmo': g.timeScale = Math.max(0, Math.min(4, num(args[0], cmd === 'slowmo' ? 0.25 : 1))); say(`Time scale ${g.timeScale}`); break;
    case 'clear': g.inventory.hotbar.fill(null); g.inventory.main.fill(null); g.tools.onSelect(); g.hud.refresh(); say('Inventory cleared'); break;
    case 'spawnpoint': p.spawn.copy(p.position); say('Spawn point set'); break;
    case 'size': {
      const s = Math.max(0.25, Math.min(4, num(args[0], 1)));
      p.setSize?.(s);
      say(`You are now ${s}× size`);
      break;
    }
    default:
      err(`Unknown command /${cmd}. Type /help`);
      return false;
  }
  return true;
}

export function completeCommand(input) {
  const cmds = ['help', 'time', 'weather', 'gamemode', 'difficulty', 'gravity', 'give', 'summon', 'rain', 'build', 'tp', 'locate', 'biome', 'seed', 'heal', 'fly', 'noclip', 'kill', 'fill', 'explode', 'nuke', 'speed', 'jump', 'timescale', 'clear', 'spawnpoint', 'size'];
  const v = input.value;
  if (!v.startsWith('/') || v.includes(' ')) return;
  const m = cmds.filter((c) => c.startsWith(v.slice(1)));
  if (m.length === 1) input.value = `/${m[0]} `;
}
