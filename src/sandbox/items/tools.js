// What happens when you click: breaking and placing blocks, attacking, and
// every tool and weapon. Also draws the block highlight and the held item.
import * as THREE from 'three';
import { BLOCKS, B, SOLID, LIQUID, SHAPE, DOOR, isDoor } from '../world/blocks.js';
import { TOOLS, SPAWNS, stackName } from './items.js';
import { blockMesh, artMesh } from '../entities/blockMesh.js';
import { buildStructure } from '../world/structures.js';
import { canvasTex } from '../entities/models.js';
import { woolBlockFor } from '../entities/mobs.js';
import { RigidEntity } from '../entities/base.js';
import { CANNON } from '../physics/physics.js';

const GUNS = {
  pistol: { damage: 6, rate: 0.18, auto: false, spread: 0.008, sound: 'pistol', recoil: 0.05, pellets: 1 },
  rifle: { damage: 4.5, rate: 0.085, auto: true, spread: 0.02, sound: 'rifle', recoil: 0.025, pellets: 1 },
  shotgun: { damage: 3, rate: 0.75, auto: false, spread: 0.07, sound: 'shotgun', recoil: 0.14, pellets: 9 },
  sniper: { damage: 30, rate: 1.1, auto: false, spread: 0.001, sound: 'shotgun', recoil: 0.18, pellets: 1, range: 300 },
};
const SHAPES = ['sphere', 'hollow sphere', 'cube', 'hollow cube', 'cylinder', 'pyramid', 'wall', 'floor'];
const MELEE = { hand: 2, sword: 7, pickaxe: 4 };

function crackTextures() {
  const out = [];
  for (let s = 0; s < 8; s++) {
    out.push(canvasTex(`crack${s}`, 16, 16, (g) => {
      g.clearRect(0, 0, 16, 16);
      g.fillStyle = 'rgba(0,0,0,0.75)';
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const lines = 2 + s * 2;
      for (let l = 0; l < lines; l++) {
        let x = 8, y = 8;
        const a = rnd() * Math.PI * 2;
        const len = 2 + s * 0.9;
        for (let k = 0; k < len; k++) {
          x += Math.cos(a + (rnd() - 0.5)) * 1.2; y += Math.sin(a + (rnd() - 0.5)) * 1.2;
          g.fillRect(Math.floor(x), Math.floor(y), 1, 1);
        }
      }
    }));
  }
  return out;
}

export class Tools {
  constructor(game) {
    this.game = game;
    this.target = null;       // block hit
    this.targetEntity = null; // entity hit
    this.cooldown = 0;
    this.breakRepeat = 0;
    this.placeRepeat = 0;
    this.mining = null;
    this.swingTime = 0;
    this.recoil = 0;
    this.equip = 0;
    this.ammo = {};
    this.reloading = 0;
    this.held = null;          // gravity gun payload
    this.size = 3;
    this.shapeIndex = 0;
    this.copy = { a: null, b: null, clip: null };
    this.eatTime = 0;

    // Block highlight.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.highlight.visible = false;
    game.scene.add(this.highlight);
    this.cracks = crackTextures();
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.01, 1.01, 1.01), new THREE.MeshBasicMaterial({ map: this.cracks[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.crack.visible = false;
    game.scene.add(this.crack);
    // Copy-tool selection box.
    this.selection = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x40c0ff }));
    this.selection.visible = false;
    game.scene.add(this.selection);
    // Shape preview.
    this.preview = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x80c0ff, wireframe: true, transparent: true, opacity: 0.35 }));
    this.preview.visible = false;
    game.scene.add(this.preview);
    // Laser beam.
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.visible = false;
    game.scene.add(this.beam);
    this.tracers = [];
    this.portals = { blue: null, orange: null };
    this.portalCooldown = 0;

    // First-person view model.
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmAmbient = new THREE.AmbientLight(0xffffff, 0.9);
    this.vmSun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.vmSun.position.set(-1, 2, 1);
    this.vmScene.add(this.vmAmbient, this.vmSun);
    this.vmRoot = new THREE.Group();
    this.vmScene.add(this.vmRoot);
    const skin = new THREE.MeshLambertMaterial({ color: 0xd8a888 });
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.55), skin);
    this.vmItem = new THREE.Group();
    this.vmRoot.add(this.arm, this.vmItem);
    this.onSelect();
  }

  resize() {
    this.vmCamera.aspect = window.innerWidth / window.innerHeight;
    this.vmCamera.updateProjectionMatrix();
  }

  isFood(key) { return !!TOOLS[key]?.food; }

  usesReload() {
    const s = this.game.inventory.selected;
    return s?.kind === 'tool' && GUNS[s.key] && !this.game.player.vehicle;
  }

  // Rebuild the held-item model when the selection changes.
  onSelect() {
    const s = this.game.inventory.selected;
    this.vmItem.clear();
    this.equip = 1;
    this.mining = null;
    if (this.held && !this.game.holding('gravity')) this.dropHeld(false);
    // The bare arm only shows with an empty hand; items float bottom-right.
    this.arm.visible = !s;
    this.arm.position.set(0.5, -0.5, -0.62);
    this.arm.rotation.set(0.25, 0.25, 0.1);
    if (!s) return;
    let m;
    if (s.kind === 'block') {
      m = blockMesh(this.game, s.id, 0.26);
      m.position.set(0.46, -0.38, -0.8);
      m.rotation.set(0.15, 0.75, 0);
    } else if (s.kind === 'tool') {
      m = artMesh(s.key);
      const gun = GUNS[s.key] || ['rocket', 'flamethrower', 'laser', 'gravity', 'teleport', 'resize', 'freeze', 'grapple', 'portal'].includes(s.key);
      if (gun) {
        // The art's barrel points right (+x); turn it to point forward.
        m.rotation.set(0, Math.PI / 2 + 0.06, 0);
        m.position.set(0.34, -0.27, -0.66);
        m.scale.setScalar(0.45);
      } else if (this.isFood(s.key) || s.key === 'grenade' || s.key === 'snowball' || s.key === 'fireworks' || s.key === 'jetpack') {
        m.position.set(0.42, -0.34, -0.72);
        m.rotation.set(0, -0.4, 0);
        m.scale.setScalar(0.34);
      } else {
        m.position.set(0.42, -0.3, -0.78);
        m.rotation.set(0, -1.35, 0.2);
        m.scale.setScalar(0.42);
      }
    } else {
      const c = new THREE.Color(SPAWNS[s.key]?.color ?? '#ffffff');
      m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshLambertMaterial({ color: c }));
      m.scale.set(1, 1.25, 1);
      m.position.set(0.4, -0.3, -0.7);
    }
    this.vmItem.add(m);
    this.vmItem.userData.base = m.position.clone();
  }

  // ---- per frame ----

  update(dt, input) {
    const g = this.game;
    const p = g.player;
    this.cooldown -= dt;
    this.swingTime = Math.max(0, this.swingTime - dt);
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.equip = Math.max(0, this.equip - dt * 5);
    for (const t of this.tracers) { t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.06); if (t.life <= 0) { g.scene.remove(t.line); t.line.geometry.dispose(); } }
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.beam.visible = false;
    this.preview.visible = false;
    this.updatePortals(dt);

    if (p.dead || p.vehicle) {
      this.highlight.visible = false; this.crack.visible = false;
      if (this.held) this.dropHeld(false);
      g.audio.stopLoop('flame');
      return;
    }

    const eye = p.eyePos;
    const dir = p.lookDir();
    const reach = g.creative ? 7 : 5;
    const sel = g.inventory.selected;
    const key = sel?.kind === 'tool' ? sel.key : null;
    const longRange = ['teleport', 'portal', 'lightning', 'terraform', 'shape', 'paint', 'remover', 'resize', 'freeze', 'copy', 'fireworks'].includes(key) || sel?.kind === 'spawn';
    const range = longRange ? 120 : reach;
    this.target = g.world.raycast(eye, dir, range, (id) => !LIQUID[id] || (sel?.kind === 'spawn' && SPAWNS[sel.key]?.category === 'Vehicles' && sel.key === 'boat'));
    const ent = g.entities.raycast(eye, dir, longRange ? 120 : reach + 1, (e) => e.pickable && e !== this.held?.entity);
    this.targetEntity = ent && (!this.target || ent.dist < this.target.dist) ? ent : null;

    // Highlight.
    const showHL = this.target && this.target.dist <= reach && !this.targetEntity && (sel?.kind === 'block' || !sel || ['pickaxe', 'flint', 'sword', 'paint'].includes(key));
    this.highlight.visible = !!showHL;
    if (showHL) this.highlight.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);

    // Alt + wheel adjusts tool size.
    if (input.key('AltLeft') && input.wheel) {
      this.size = Math.max(1, Math.min(16, this.size - input.wheel));
      g.hud.showItemName(`Size: ${this.size}`);
    }

    // Gravity gun payload follows the crosshair.
    if (this.held) this.updateHeld(dt, eye, dir);

    // Flamethrower sound off unless firing.
    if (!(key === 'flamethrower' && input.mouse(0))) g.audio.stopLoop('flame');

    // Middle click picks the targeted block.
    if (input.click(1) && this.target) g.inventory.pickBlock(this.target.id);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.ammo[key] = TOOLS[key]?.ammo; g.audio.play('click'); }
    }
    if (key && GUNS[key] && input.hit('KeyR') && !g.entities.raycast(eye, dir, 5, (e) => e.rideable)) this.reload(key);

    if (!sel || sel.kind === 'block') this.useBlock(dt, input, sel);
    else if (sel.kind === 'tool') this.useTool(dt, input, key);
    else if (sel.kind === 'spawn') this.useSpawn(input, sel);

    this.crack.visible = !!this.mining;
    if (this.mining) {
      this.crack.position.set(this.mining.x + 0.5, this.mining.y + 0.5, this.mining.z + 0.5);
      this.crack.material.map = this.cracks[Math.min(7, Math.floor(this.mining.progress * 8))];
    }
  }

  // Punch whatever entity is targeted; returns true if one was hit.
  melee(key) {
    const e = this.targetEntity?.entity;
    if (!e || this.targetEntity.dist > (this.game.creative ? 6 : 4.5)) return false;
    if (this.cooldown > 0) return true;
    this.cooldown = key === 'sword' ? 0.45 : 0.3;
    this.swing();
    const dmg = MELEE[key] ?? MELEE.hand;
    const p = this.game.player;
    const crit = !p.onGround && p.vel.y < 0;
    e.damage(dmg * (crit ? 1.5 : 1), 'melee', p);
    e.impulse?.(p.lookDir().setY(0).normalize().multiplyScalar(e.kind === 'prop' ? 6 : 3).add(new THREE.Vector3(0, 2, 0)));
    if (crit) this.game.particles.sparkle(e.center, 0xffffff, 8);
    this.game.audio.play(key === 'sword' ? 'swing' : 'hit', { pos: e.pos });
    return true;
  }

  // Right-click on a creature (ride, feed, talk). Returns true if handled.
  interact() {
    const e = this.targetEntity?.entity;
    if (!e || this.targetEntity.dist > 5) return false;
    if (e.interact?.(this.game.player)) { this.swing(); return true; }
    if (e.rideable) { this.game.entities.mount(this.game.player, e); return true; }
    return false;
  }

  swing() { this.swingTime = 0.25; }

  useBlock(dt, input, sel) {
    const g = this.game;
    const t = this.target;
    const reach = g.creative ? 7 : 5;
    // Break.
    if (input.mouse(0)) {
      if (input.click(0) && this.melee('hand')) return;
      if (t && t.dist <= reach && !this.targetEntity) this.mine(dt, input, t, 'hand');
      else this.mining = null;
    } else this.mining = null;
    this.breakRepeat -= dt;
    // Place / interact; holding right-click keeps placing.
    const canPlace = () => sel?.kind === 'block' && t && t.dist <= reach && this.placeBlock(t, sel.id);
    if (input.click(2)) {
      this.holdPlace = !this.interact() && !(t && t.dist <= reach && !g.input.key('ShiftLeft') && this.useBlockAt(t));
      if (this.holdPlace) { canPlace(); this.placeRepeat = 0.3; }
    } else if (input.mouse(2) && this.holdPlace) {
      this.placeRepeat -= dt;
      if (this.placeRepeat <= 0 && canPlace()) this.placeRepeat = 0.16;
    }
  }

  mine(dt, input, t, key) {
    const g = this.game;
    if (BLOCKS[t.id].hardness === Infinity && !g.creative) { this.mining = null; return; }
    if (g.creative) {
      if (input.click(0) || this.breakRepeat <= 0) {
        this.breakRepeat = input.click(0) ? 0.28 : 0.16;
        this.breakBlock(t.x, t.y, t.z, true);
        this.swing();
      }
      this.mining = null;
      return;
    }
    if (!this.mining || this.mining.x !== t.x || this.mining.y !== t.y || this.mining.z !== t.z) this.mining = { x: t.x, y: t.y, z: t.z, progress: 0, tick: 0 };
    const b = BLOCKS[t.id];
    const speed = key === 'pickaxe' ? 5 : key === 'sword' ? 1.5 : 1;
    const time = Math.max(0.05, b.hardness * 1.2 / speed);
    this.mining.progress += dt / time;
    this.mining.tick -= dt;
    if (this.mining.tick <= 0) {
      this.mining.tick = 0.2;
      this.swing();
      g.audio.play('dig', { material: b.sound, pos: { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 } });
      g.particles.dig(t.point, new THREE.Vector3(t.nx, t.ny, t.nz), t.id);
    }
    if (this.mining.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z, true);
      this.mining = null;
    }
  }

  breakBlock(x, y, z, byPlayer) {
    const g = this.game;
    const id = g.world.getBlock(x, y, z);
    if (id <= 0) return;
    if (id === B.bedrock && !g.creative) return;
    g.world.setBlock(x, y, z, 0);
    g.particles.blockBreak(x, y, z, id);
    g.audio.play('break', { material: BLOCKS[id].sound, pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
    g.stats.blocksBroken++;
    if (byPlayer && !g.creative && BLOCKS[id].hardness !== Infinity && !LIQUID[id] && id !== B.fire) {
      const ORE = { [B.coal_ore]: 'coal', [B.iron_ore]: 'iron', [B.gold_ore]: 'gold', [B.diamond_ore]: 'diamond', [B.emerald_ore]: 'emerald' };
      if (ORE[id]) {
        g.entities.dropItem({ x: x + 0.5, y: y + 0.3, z: z + 0.5 }, { kind: 'tool', key: ORE[id], count: id === B.coal_ore ? 1 + ((Math.random() * 2) | 0) : 1 });
        return;
      }
      const leaves = BLOCKS[id].render === 'cutout' && BLOCKS[id].shape === 'cube' && BLOCKS[id].key.endsWith('leaves');
      const drop = isDoor(id) ? DOOR : id === B.grass || id === B.mycelium ? B.dirt : id === B.stone ? B.cobble : id === B.glass ? 0 : leaves ? (Math.random() < 0.08 ? -1 : 0) : id;
      if (drop > 0) g.entities.dropItem({ x: x + 0.5, y: y + 0.3, z: z + 0.5 }, { kind: 'block', id: drop, count: 1 });
      if (drop === -1) g.entities.dropItem({ x: x + 0.5, y: y + 0.3, z: z + 0.5 }, { kind: 'tool', key: 'apple', count: 1 });
    }
    // Plants on top pop off.
    const above = g.world.getBlock(x, y + 1, z);
    if (SHAPE[above] === 1 && above !== B.fire && above !== B.vines) {
      g.world.setBlock(x, y + 1, z, 0);
      g.particles.blockBreak(x, y + 1, z, above, 6);
    }
  }

  // Right-click on doors, beds, chests and note blocks. Returns true if used.
  useBlockAt(t) {
    const g = this.game;
    const id = t.id;
    if (isDoor(id)) {
      const d = BLOCKS[id].door;
      const nid = DOOR + d.o * 2 + (d.open ? 0 : 1);
      for (const dy of [-1, 0, 1]) if (isDoor(g.world.getBlock(t.x, t.y + dy, t.z))) g.world.setBlock(t.x, t.y + dy, t.z, nid);
      g.audio.play('place', { material: 'wood', pos: t.point });
      this.swing();
      return true;
    }
    if (id === B.bed) { g.sleep(t); return true; }
    if (id === B.chest) { g.menus.showChest(g.dimKey(`${t.x},${t.y},${t.z}`)); return true; }
    if (id === B.note_block) {
      const k = `${t.x},${t.y},${t.z}`;
      this.notes ??= new Map();
      const n = ((this.notes.get(k) ?? -1) + 1) % 25;
      this.notes.set(k, n);
      g.audio.play('note', { f: 185 * 2 ** (n / 12), pos: t.point });
      g.particles.sparkle(new THREE.Vector3(t.x + 0.5, t.y + 1.2, t.z + 0.5), new THREE.Color().setHSL(n / 25, 1, 0.6).getHex(), 4);
      this.swing();
      return true;
    }
    return false;
  }

  placeBlock(t, id) {
    const g = this.game;
    const p = g.player;
    let x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
    // Clicking a plant or snow replaces it.
    if (SHAPE[t.id] === 1 && t.id !== B.fire) { x = t.x; y = t.y; z = t.z; }
    const cur = g.world.getBlock(x, y, z);
    if (cur < 0 || (cur !== 0 && !LIQUID[cur] && SHAPE[cur] !== 1 && cur !== B.fire)) return false;
    if (SOLID[id]) {
      const b = p.box;
      if (x + 1 > b.x - b.hw && x < b.x + b.hw && z + 1 > b.z - b.hw && z < b.z + b.hw && y + 1 > b.y && y < b.y + b.h) return false;
      const box = new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + 1, y + 1, z + 1));
      for (const e of g.entities.list) if (e.kind === 'mob' && e.bounds().intersectsBox(box)) return false;
    }
    if (id === DOOR) {
      // Doors are two blocks tall and face away from you.
      const above = g.world.getBlock(x, y + 1, z);
      if (above !== 0 && SHAPE[above] !== 1) return false;
      const o = ((Math.round(p.yaw / (Math.PI / 2)) % 4) + 4) % 4;
      id = DOOR + o * 2;
      g.world.setBlock(x, y + 1, z, id);
    }
    if (g.world.setBlock(x, y, z, id)) {
      g.audio.play('place', { material: BLOCKS[id].sound, pos: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
      g.inventory.consumeSelected();
      g.stats.blocksPlaced++;
      this.swing();
      return true;
    }
    return false;
  }

  reload(key) {
    if (this.reloading > 0 || !TOOLS[key]?.ammo) return;
    if ((this.ammo[key] ?? TOOLS[key].ammo) >= TOOLS[key].ammo) return;
    this.reloading = TOOLS[key].reload;
    this.game.audio.play('click');
    this.game.hud.showItemName('Reloading…');
  }

  useTool(dt, input, key) {
    const g = this.game;
    const p = g.player;
    const eye = p.eyePos;
    const dir = p.lookDir();
    const t = this.target;
    const L = input.mouse(0), Lc = input.click(0), Rc = input.click(2), R = input.mouse(2);

    if (GUNS[key]) {
      const gun = GUNS[key];
      if (this.ammo[key] === undefined) this.ammo[key] = TOOLS[key].ammo;
      if ((gun.auto ? L : Lc) && this.cooldown <= 0 && this.reloading <= 0) {
        if (this.ammo[key] <= 0) { this.reload(key); return; }
        this.cooldown = gun.rate;
        this.ammo[key]--;
        const spread = gun.spread * (g.zoom ? 0.2 : 1) * (p.onGround ? 1 : 2);
        const muzzle = eye.clone().add(new THREE.Vector3(0.25, -0.15, 0).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'))).addScaledVector(dir, 0.6);
        for (let k = 0; k < gun.pellets; k++) {
          const d = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2, (Math.random() - 0.5) * spread * 2)).normalize();
          this.hitscan(eye, d, gun.range ?? 120, gun.damage, p, { tracer: k % 3 === 0, muzzle, breakGlass: true });
        }
        g.particles.muzzle(muzzle, dir);
        g.audio.play(gun.sound);
        this.recoil = Math.min(1, this.recoil + gun.recoil * 6);
        p.pitch += gun.recoil * 0.4;
        p.yaw += (Math.random() - 0.5) * gun.recoil * 0.2;
        if (this.ammo[key] <= 0) this.reload(key);
      }
      if (!L && this.melee) { /* guns don't melee */ }
      if (Rc && key !== 'sniper') this.interact();
      return;
    }

    switch (key) {
      case 'hand': case 'sword': case 'pickaxe': {
        if (L) {
          if (Lc && this.melee(key)) return;
          if (t && t.dist <= (g.creative ? 7 : 5) && !this.targetEntity) this.mine(dt, input, t, key);
          else this.mining = null;
        } else this.mining = null;
        this.breakRepeat -= dt;
        if (Rc && !this.interact() && t && t.dist <= 6) this.useBlockAt(t);
        break;
      }
      case 'rocket':
        if (Lc && this.cooldown <= 0) {
          this.cooldown = 0.9;
          const from = eye.clone().addScaledVector(dir, 0.8).add(new THREE.Vector3(0, -0.1, 0));
          g.entities.spawnProjectile('rocket', from, dir.clone().multiplyScalar(45), p);
          g.audio.play('rocket');
          this.recoil = 1;
          p.knock.addScaledVector(dir, -2);
        }
        if (Rc) this.interact();
        break;
      case 'grenade': case 'snowball':
        if (Lc && this.cooldown <= 0) {
          this.cooldown = 0.35;
          const v = dir.clone().multiplyScalar(key === 'grenade' ? 20 : 26).add(new THREE.Vector3(0, 3, 0)).add(p.vel.clone().multiplyScalar(0.5));
          g.entities.spawnProjectile(key, eye.clone().addScaledVector(dir, 0.5), v, p);
          g.audio.play('throw');
          this.swing();
          g.inventory.consumeSelected();
        }
        if (Rc) this.interact();
        break;
      case 'fireworks':
        if ((Lc || Rc) && this.cooldown <= 0) {
          this.cooldown = 0.25;
          const from = t && t.dist < 60 ? t.point.clone().add(new THREE.Vector3(t.nx * 0.3, t.ny * 0.3 + 0.2, t.nz * 0.3)) : eye.clone().addScaledVector(dir, 1);
          const v = Lc && t ? new THREE.Vector3((Math.random() - 0.5) * 2, 22, (Math.random() - 0.5) * 2) : dir.clone().multiplyScalar(30);
          g.entities.spawnProjectile('firework', from, v, p, { color: new THREE.Color().setHSL(Math.random(), 1, 0.6) });
          g.audio.play('whoosh');
          g.inventory.consumeSelected();
        }
        break;
      case 'flamethrower':
        if (L) {
          const from = eye.clone().add(new THREE.Vector3(0.3, -0.25, 0).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'))).addScaledVector(dir, 1.4);
          g.particles.flame(from, dir);
          const loop = g.audio.noiseLoop('flame', { type: 'lowpass', f: 700, q: 0.4, gain: 0.35, brown: false });
          loop?.set(1);
          this.flameTick = (this.flameTick ?? 0) - dt;
          if (this.flameTick <= 0) {
            this.flameTick = 0.1;
            for (const e of g.entities.inRadius(eye.clone().addScaledVector(dir, 4), 4, (e) => e.kind === 'mob' || e.kind === 'prop' || e.kind === 'vehicle')) {
              e.damage(1.5, 'fire', p);
              if (e.kind === 'mob') e.burning = 5;
              if (e.type === 'barrel') e.burning = true;
            }
            const h = g.world.raycast(eye, dir, 12);
            if (h && g.fireSpread && Math.random() < 0.6) {
              const fx = h.x + h.nx, fy = h.y + h.ny, fz = h.z + h.nz;
              if (g.world.getBlock(fx, fy, fz) === 0) g.world.setBlock(fx, fy, fz, B.fire);
              if (h.id === B.tnt) g.ticks.igniteTnt(h.x, h.y, h.z, 1.5);
              if (h.id === B.ice || h.id === B.snow) g.world.setBlock(h.x, h.y, h.z, h.id === B.ice ? B.water : 0);
            }
          }
        }
        break;
      case 'laser': {
        if (L || R) {
          const h = g.world.raycast(eye, dir, 64);
          const end = h ? h.point : eye.clone().addScaledVector(dir, 64);
          const from = eye.clone().add(new THREE.Vector3(0.22, -0.15, 0).applyEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'))).addScaledVector(dir, 0.5);
          this.beam.visible = true;
          this.beam.position.copy(from);
          this.beam.lookAt(end);
          this.beam.scale.set(R ? 4 : 1, R ? 4 : 1, from.distanceTo(end));
          this.beam.material.color.setHSL(0.98, 1, 0.5 + Math.random() * 0.2);
          this.laserTick = (this.laserTick ?? 0) - dt;
          if (this.laserTick <= 0) {
            this.laserTick = R ? 0.12 : 0.05;
            if (h && BLOCKS[h.id].hardness !== Infinity) {
              const r = R ? 1 : 0;
              for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
                const id = g.world.getBlock(h.x + dx, h.y + dy, h.z + dz);
                if (id > 0 && !LIQUID[id] && BLOCKS[id].hardness !== Infinity) {
                  g.world.setBlock(h.x + dx, h.y + dy, h.z + dz, 0);
                  if (Math.random() < 0.5) g.particles.blockBreak(h.x + dx, h.y + dy, h.z + dz, id, 4);
                }
              }
              g.particles.impact(h.point, new THREE.Vector3(h.nx, h.ny, h.nz), 0);
              g.audio.play('laser', { gain: 0.25 });
            }
            const e = g.entities.raycast(eye, dir, h ? h.dist : 64, (x) => x.pickable);
            if (e) { e.entity.damage(3, 'laser', p); if (e.entity.kind === 'mob') e.entity.burning = 3; }
          }
        }
        break;
      }
      case 'lightning':
        if ((Lc || Rc) && this.cooldown <= 0) {
          this.cooldown = Rc ? 1.5 : 0.4;
          const at = this.targetEntity ? this.targetEntity.point : t ? t.point : eye.clone().addScaledVector(dir, 60);
          if (Rc) {
            for (let k = 0; k < 6; k++) setTimeout(() => g.running && g.weather.strike(new THREE.Vector3(at.x + (Math.random() - 0.5) * 14, at.y, at.z + (Math.random() - 0.5) * 14)), k * 180);
          } else g.weather.strike(at, { blast: 1.8 });
          this.swing();
        }
        break;
      case 'gravity':
        if (Rc) {
          if (this.held) this.dropHeld(false);
          else this.grab();
        }
        if (Lc) {
          if (this.held) this.dropHeld(true);
          else this.punt();
        }
        break;
      case 'terraform':
        if ((Lc || (L && this.cooldown <= 0)) && t) {
          this.cooldown = 0.25;
          this.sphere(t.point, this.size, () => 0, (id) => BLOCKS[id].hardness !== Infinity);
          g.audio.play('break', { material: 'dirt', pos: t.point });
          g.particles.blockBreak(t.x, t.y, t.z, t.id, 20);
        }
        if ((Rc || (R && this.cooldown <= 0)) && t) {
          this.cooldown = 0.25;
          const block = g.inventory.nextBlock;
          const c = t.point.clone().add(new THREE.Vector3(t.nx, t.ny, t.nz).multiplyScalar(this.size * 0.4));
          this.sphere(c, this.size, (x, y, z) => (block === B.grass && g.world.getBlock(x, y + 1, z) > 0 ? B.dirt : block), (id) => id === 0 || LIQUID[id] || SHAPE[id] === 1);
          // Grass on exposed tops.
          g.audio.play('place', { material: 'dirt', pos: t.point });
        }
        if (t) { this.preview.visible = true; this.preview.position.copy(t.point); this.preview.scale.setScalar(this.size); }
        break;
      case 'shape':
        if (Lc) {
          this.shapeIndex = (this.shapeIndex + 1) % SHAPES.length;
          g.hud.showItemName(`Shape: ${SHAPES[this.shapeIndex]} (size ${this.size})`);
        }
        if (Rc && t) {
          const n = this.buildShape(SHAPES[this.shapeIndex], t, g.inventory.nextBlock);
          g.audio.play('place', { material: 'stone' });
          g.hud.showItemName(`Built ${SHAPES[this.shapeIndex]}: ${n} blocks`);
        }
        if (t) { this.preview.visible = true; this.preview.position.copy(t.point); this.preview.scale.setScalar(this.size); }
        break;
      case 'paint': {
        const block = g.inventory.nextBlock;
        if (Rc && this.targetEntity?.entity.type === 'sheep') {
          const sheep = this.targetEntity.entity;
          const color = BLOCKS[block].woolColor ?? BLOCKS[block].color;
          sheep.woolColor = color;
          sheep.model.wool && sheep.mats.forEach((m) => { if (m.mat === sheep.model.wool.material) m.base.set(color); });
          g.particles.sparkle(sheep.center, color, 12);
          break;
        }
        if ((Lc || (L && this.cooldown <= 0)) && t) {
          this.cooldown = 0.08;
          if (t.id !== block) g.world.setBlock(t.x, t.y, t.z, block);
        }
        if ((Rc || (R && this.cooldown <= 0)) && t) {
          this.cooldown = 0.2;
          this.sphere(t.point, this.size, () => block, (id) => id > 0 && !LIQUID[id] && SHAPE[id] !== 1 && BLOCKS[id].hardness !== Infinity);
        }
        if (t) { this.preview.visible = true; this.preview.position.copy(t.point); this.preview.scale.setScalar(this.size); }
        break;
      }
      case 'copy': {
        if (Lc && t) { this.copy.a = { x: t.x, y: t.y, z: t.z }; g.hud.showItemName('Corner 1 set'); }
        if (Rc && t) { this.copy.b = { x: t.x, y: t.y, z: t.z }; g.hud.showItemName('Corner 2 set'); }
        if (input.hit('KeyC')) this.copyRegion();
        if (input.hit('KeyV') && t) this.paste(t);
        const { a, b } = this.copy;
        this.selection.visible = !!(a && b);
        if (a && b) {
          const min = new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
          const max = new THREE.Vector3(Math.max(a.x, b.x) + 1, Math.max(a.y, b.y) + 1, Math.max(a.z, b.z) + 1);
          this.selection.position.copy(min.clone().add(max).multiplyScalar(0.5));
          this.selection.scale.copy(max.sub(min));
        }
        break;
      }
      case 'remover':
        if (Lc && this.targetEntity) {
          const e = this.targetEntity.entity;
          g.particles.poof(e.center, 0xffffff, 20);
          g.audio.play('pop');
          e.remove();
        }
        if (Rc) {
          const n = g.entities.clear((e) => e.pos.distanceTo(p.position) < 24 && e.kind !== 'item');
          g.message(`Removed ${n} things nearby`);
        }
        break;
      case 'teleport':
        if (Lc && t) {
          const to = new THREE.Vector3(t.x + 0.5 + t.nx, t.y + t.ny, t.z + 0.5 + t.nz);
          if (t.ny === 1) to.y = t.y + 1;
          g.particles.sparkle(p.eyePos, 0xc060ff, 30);
          p.teleport(to.x, to.y, to.z);
          g.audio.play('teleport');
          g.particles.sparkle(p.eyePos, 0xc060ff, 30);
        }
        if (Rc) {
          const to = eye.clone().addScaledVector(dir, 15);
          p.teleport(to.x, to.y - p.eye, to.z);
          g.audio.play('teleport');
        }
        break;
      case 'portal':
        if ((Lc || Rc) && t) this.placePortal(Lc ? 'blue' : 'orange', t);
        else if (Lc || Rc) g.audio.play('click');
        break;
      case 'sign':
        if (Rc && t && t.dist < 8) {
          const wall = t.ny === 0;
          const at = wall
            ? { x: t.x + 0.5 + t.nx * 0.53, y: t.y, z: t.z + 0.5 + t.nz * 0.53 }
            : { x: t.x + 0.5, y: t.y + (t.ny > 0 ? 1 : -1), z: t.z + 0.5 };
          const yaw = wall ? Math.atan2(t.nx, t.nz) : p.yaw;
          g.menus.showPrompt('Write on the sign', '', (text) => {
            if (text) g.entities.spawn('sign', at, { text, yaw, wall });
            g.inventory.consumeSelected();
          });
        }
        if (Lc) this.melee('hand');
        break;
      case 'grapple':
        if (Lc && this.cooldown <= 0) {
          this.cooldown = 0.4;
          p.grapple = null;
          for (const e of g.entities.list) if (e.type === 'hook') e.remove();
          g.entities.spawnProjectile('hook', eye.clone().addScaledVector(dir, 0.5), dir.clone().multiplyScalar(60), p);
          g.audio.play('grapple');
        }
        if (Rc) { p.grapple = null; for (const e of g.entities.list) if (e.type === 'hook') e.remove(); }
        break;
      case 'resize':
        if ((Lc || Rc) && this.targetEntity) {
          const e = this.targetEntity.entity;
          e.setScale(e.scale * (Lc ? 1.3 : 1 / 1.3));
          g.audio.play('resize', { up: Lc });
          g.particles.sparkle(e.center, 0x40ffa0, 12);
        }
        break;
      case 'freeze':
        if ((Lc || Rc) && this.targetEntity) {
          const e = this.targetEntity.entity;
          e.frozen = Lc;
          g.audio.play('freeze');
          g.particles.sparkle(e.center, 0x80d0ff, 16);
        }
        break;
      case 'flint':
        if (Rc) {
          if (this.targetEntity) { const e = this.targetEntity.entity; e.burning = e.type === 'barrel' ? true : 6; }
          else if (t) {
            if (t.id === B.tnt) g.ticks.igniteTnt(t.x, t.y, t.z);
            else {
              const x = t.x + t.nx, y = t.y + t.ny, z = t.z + t.nz;
              if (g.world.getBlock(x, y, z) === 0) g.world.setBlock(x, y, z, B.fire);
            }
            g.audio.play('flame');
          }
          this.swing();
        }
        if (Lc) this.melee('hand');
        break;
      case 'jetpack':
        if (Lc) this.melee('hand');
        break;
      default:
        if (this.isFood(key)) {
          if (R && (p.hunger < 20 || g.creative)) {
            this.eatTime += dt;
            if (Math.random() < 0.2) g.particles.dig(eye.clone().addScaledVector(dir, 0.4).add(new THREE.Vector3(0, -0.2, 0)), new THREE.Vector3(0, 1, 0), B.melon);
            if (this.eatTime > 1.2) {
              this.eatTime = 0;
              p.eat(TOOLS[key].food);
              p.heal(TOOLS[key].food / 2);
              g.inventory.consumeSelected();
            }
          } else this.eatTime = 0;
          if (Rc) this.interact();
          if (Lc) this.melee('hand');
        }
    }
  }

  useSpawn(input, sel) {
    const g = this.game;
    const p = g.player;
    const t = this.target;
    if (input.click(0)) this.melee('hand');
    if (!input.click(2)) return;
    if (this.interact()) return;
    const key = sel.key;
    const def = SPAWNS[key];
    const yaw = p.yaw + Math.PI;
    if (def.category === 'Structures') {
      if (!t) return;
      const n = buildStructure(g, key, t.x + t.nx, t.y + Math.max(0, t.ny), t.z + t.nz, p.yaw);
      g.message(`Built ${def.name} (${n} blocks)`);
      g.audio.play('levelup');
      g.inventory.consumeSelected();
      return;
    }
    let pos;
    if (t) pos = new THREE.Vector3(t.x + 0.5 + t.nx, t.y + (t.ny >= 0 ? t.ny : -2), t.z + 0.5 + t.nz);
    else pos = p.eyePos.addScaledVector(p.lookDir(), 6);
    if (key === 'nuke') {
      pos.y += 70;
      g.message('Nuke incoming!', '#ff8040');
    }
    if (key === 'domino') {
      const d = p.lookDir().setY(0).normalize();
      for (let k = 0; k < 18; k++) {
        const at = pos.clone().addScaledVector(d, k * 1.1);
        const top = g.world.surfaceY(Math.floor(at.x), Math.floor(at.z), false);
        g.entities.spawn('domino', { x: at.x, y: top + 1.85, z: at.z }, { yaw: Math.atan2(d.x, d.z) });
      }
      return;
    }
    if (def.category === 'Vehicles') pos.y += key === 'plane' || key === 'helicopter' ? 0.2 : 0.5;
    if (def.category === 'Props' && key !== 'dummy') pos.y += 0.6;
    const e = g.entities.spawn(key, pos, { yaw });
    if (e) {
      g.particles.poof(pos, 0xffffff, 10);
      g.audio.play('pop');
      g.inventory.consumeSelected();
    }
  }

  // ---- portals ----

  placePortal(color, t) {
    const g = this.game;
    const n = new THREE.Vector3(t.nx, t.ny, t.nz);
    const pos = new THREE.Vector3(t.x + 0.5, t.y + 0.5, t.z + 0.5).addScaledVector(n, 0.52);
    let p = this.portals[color];
    if (!p) {
      const c = color === 'blue' ? 0x40a0ff : 0xff8020;
      const mesh = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      const inner = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
      const swirl = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.38, 6, 1, 0, Math.PI * 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      mesh.add(ring, inner, swirl);
      mesh.scale.set(1.1, 2.0, 1);
      g.scene.add(mesh);
      p = this.portals[color] = { mesh, swirl, pos, n, color: c };
    }
    p.pos.copy(pos);
    p.n.copy(n);
    p.mesh.position.copy(pos);
    // Face out of the wall, tall side up (floors and ceilings follow your view).
    const up = Math.abs(n.y) > 0.5 ? new THREE.Vector3(-Math.sin(g.player.yaw), 0, -Math.cos(g.player.yaw)) : new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), n.clone().negate(), up);
    p.mesh.quaternion.setFromRotationMatrix(m);
    if (Math.abs(n.y) < 0.5) p.mesh.position.y = Math.max(pos.y, t.y + 1);
    p.pos.copy(p.mesh.position);
    g.particles.sparkle(p.pos, p.color, 20);
    g.audio.play('teleport', { pos: p.pos });
    this.swing();
  }

  updatePortals(dt) {
    const { blue, orange } = this.portals;
    for (const p of [blue, orange]) if (p) p.swirl.rotation.z += dt * 4;
    this.portalCooldown -= dt;
    if (!blue || !orange || this.portalCooldown > 0) return;
    const g = this.game;
    const tryPass = (center, vel, move) => {
      for (const [a, b] of [[blue, orange], [orange, blue]]) {
        const rel = center.clone().sub(a.pos);
        const along = rel.dot(a.n);
        const across = rel.clone().addScaledVector(a.n, -along);
        const wall = Math.abs(a.n.y) < 0.5;
        const ok = wall ? Math.hypot(across.x, across.z) < 0.6 && Math.abs(across.y) < 1.2 : across.length() < 0.7;
        if (ok && along > -0.3 && along < 0.9 && vel.dot(a.n) <= 0.5) {
          const speed = Math.max(4, vel.length());
          const out = b.pos.clone().addScaledVector(b.n, Math.abs(b.n.y) > 0.5 ? 1.0 : 0.7);
          move(out, b.n.clone().multiplyScalar(speed), b);
          g.audio.play('teleport', { pos: out });
          g.particles.sparkle(out, b.color, 16);
          this.portalCooldown = 0.4;
          return true;
        }
      }
      return false;
    };
    const p = g.player;
    if (!p.vehicle) {
      const c = p.position.add(new THREE.Vector3(0, p.box.h / 2, 0));
      if (tryPass(c, p.vel, (out, v, b) => {
        p.teleport(out.x, out.y - p.box.h / 2, out.z);
        p.vel.copy(v);
        if (Math.abs(b.n.y) < 0.5) p.yaw = Math.atan2(-b.n.x, -b.n.z);
      })) return;
    }
    for (const e of g.entities.list) {
      if (e.removed || e.kind === 'disaster' || e === p.vehicle) continue;
      const c = e.center;
      const vel = e.body ? new THREE.Vector3(e.body.velocity.x, e.body.velocity.y, e.body.velocity.z) : e.vel;
      if (tryPass(c, vel, (out, v) => {
        if (e.body) { e.body.position.set(out.x, out.y, out.z); e.body.velocity.set(v.x, v.y, v.z); e.body.wakeUp(); }
        else { e.pos.set(out.x, out.y - (e.height ?? 1) * (e.scale ?? 1) / 2, out.z); e.vel.copy(v); }
      })) return;
    }
  }

  // ---- gravity gun ----

  grab() {
    const g = this.game;
    const p = g.player;
    const range = 14;
    const ent = g.entities.raycast(p.eyePos, p.lookDir(), range, (e) => e.pickable && e.kind !== 'vehicle' || e.type === 'car' || e.type === 'boat');
    const blk = g.world.raycast(p.eyePos, p.lookDir(), range);
    if (ent && (!blk || ent.dist < blk.dist)) {
      this.held = { entity: ent.entity, dist: Math.max(2.5, Math.min(5, ent.dist)) };
      g.audio.play('grapple');
      return;
    }
    if (blk && BLOCKS[blk.id].hardness !== Infinity && !LIQUID[blk.id]) {
      g.world.setBlock(blk.x, blk.y, blk.z, 0);
      const e = g.entities.spawn('block', { x: blk.x + 0.5, y: blk.y + 0.5, z: blk.z + 0.5 }, { block: blk.id });
      this.held = { entity: e, dist: 3 };
      g.audio.play('grapple');
    }
  }

  updateHeld(dt, eye, dir) {
    const e = this.held.entity;
    if (e.removed || e.dead) { this.held = null; return; }
    e.held = true;
    const target = eye.clone().addScaledVector(dir, this.held.dist + (e.scale ?? 1) * 0.5);
    const body = e.body;
    if (body && body.mass !== undefined) {
      body.wakeUp();
      const to = new CANNON.Vec3(target.x - body.position.x, target.y - body.position.y, target.z - body.position.z);
      body.velocity.set(to.x * 12, to.y * 12, to.z * 12);
      body.angularVelocity.scale(0.9, body.angularVelocity);
    } else {
      e.vel.set((target.x - e.pos.x) * 12, (target.y - e.center.y + e.pos.y - e.pos.y) * 12, (target.z - e.pos.z) * 12);
      e.vel.y = (target.y - (e.pos.y + (e.height ?? 1) * (e.scale ?? 1) * 0.5)) * 12 + this.game.gravity * dt;
    }
    if (Math.random() < 0.3) this.game.particles.sparkle(e.center ?? e.pos, 0xffa030, 1);
  }

  dropHeld(launch) {
    const g = this.game;
    const e = this.held?.entity;
    this.held = null;
    if (!e) return;
    e.held = false;
    if (launch) {
      const v = g.player.lookDir().multiplyScalar(e.body ? 38 : 28);
      if (e.body) { e.body.velocity.set(v.x, v.y, v.z); e.body.angularVelocity.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10); }
      else e.vel.copy(v);
      if (e.kind === 'mob') e.fallStart = e.pos.y + 3;
      g.audio.play('whoosh');
      this.recoil = 1;
    }
  }

  punt() {
    const g = this.game;
    const p = g.player;
    const ent = g.entities.raycast(p.eyePos, p.lookDir(), 10, (e) => e.pickable);
    const blk = g.world.raycast(p.eyePos, p.lookDir(), 10);
    if (ent && (!blk || ent.dist < blk.dist)) {
      ent.entity.impulse?.(p.lookDir().multiplyScalar(30).add(new THREE.Vector3(0, 6, 0)));
      ent.entity.damage?.(2, 'impact', p);
    } else if (blk && BLOCKS[blk.id].hardness !== Infinity && !LIQUID[blk.id]) {
      g.world.setBlock(blk.x, blk.y, blk.z, 0);
      g.entities.spawn('block', { x: blk.x + 0.5, y: blk.y + 0.5, z: blk.z + 0.5 }, { block: blk.id, vel: p.lookDir().multiplyScalar(30), spin: true });
    }
    g.audio.play('whoosh');
    this.recoil = 1;
  }

  // ---- shared helpers ----

  hitscan(from, dir, range, damage, owner, opts = {}) {
    const g = this.game;
    const blk = g.world.raycast(from, dir, range, (id) => SOLID[id] || BLOCKS[id]?.render === 'cutout' || id === B.glass);
    const ent = g.entities.raycast(from, dir, range, (e) => e.pickable && e !== g.player.vehicle);
    let end;
    if (ent && (!blk || ent.dist < blk.dist)) {
      end = ent.point;
      ent.entity.damage(damage, 'gun', owner);
      ent.entity.impulse?.(dir.clone().multiplyScalar(Math.min(8, damage * 0.6)));
      if (ent.entity.kind === 'mob') g.particles.blood(end, 0xaa1111, 4);
      else g.particles.impact(end, dir.clone().negate(), 0);
    } else if (blk) {
      end = blk.point;
      const n = new THREE.Vector3(blk.nx, blk.ny, blk.nz);
      g.particles.impact(end, n, blk.id);
      const b = BLOCKS[blk.id];
      if (opts.breakGlass && (b.sound === 'glass' && b.light === 0 || b.render === 'cutout' && b.shape !== 'cube') && b.hardness < 1) this.breakBlock(blk.x, blk.y, blk.z, false);
      if (blk.id === B.tnt) g.ticks.igniteTnt(blk.x, blk.y, blk.z, 0.5);
    } else end = from.clone().addScaledVector(dir, range);
    if (opts.tracer) {
      const start = opts.muzzle ?? from;
      const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 1 }));
      line.frustumCulled = false;
      g.scene.add(line);
      this.tracers.push({ line, life: 0.06 });
    }
    return end;
  }

  sphere(center, r, idFor, canReplace) {
    const g = this.game;
    const R = Math.ceil(r);
    const cx = Math.floor(center.x), cy = Math.floor(center.y), cz = Math.floor(center.z);
    let n = 0;
    for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const id = g.world.getBlock(x, y, z);
      if (id < 0 || !canReplace(id)) continue;
      const nid = idFor(x, y, z);
      if (g.world.setBlock(x, y, z, nid)) n++;
    }
    return n;
  }

  buildShape(shape, t, block) {
    const g = this.game;
    const s = this.size;
    const c = new THREE.Vector3(t.x + t.nx, t.y + t.ny, t.z + t.nz);
    let n = 0;
    const set = (x, y, z) => {
      const cur = g.world.getBlock(x, y, z);
      if (cur === 0 || LIQUID[cur] || SHAPE[cur] === 1) if (g.world.setBlock(x, y, z, block)) n++;
    };
    const yaw = g.player.yaw;
    const fx = Math.round(-Math.sin(yaw)), fz = Math.round(-Math.cos(yaw));
    switch (shape) {
      case 'sphere': case 'hollow sphere':
        for (let dy = -s; dy <= s; dy++) for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d <= s + 0.3 && (shape === 'sphere' || d > s - 0.8)) set(c.x + dx, c.y + dy + s, c.z + dz);
        }
        break;
      case 'cube': case 'hollow cube':
        for (let dy = 0; dy < s * 2; dy++) for (let dz = -s; dz < s; dz++) for (let dx = -s; dx < s; dx++) {
          const edge = dy === 0 || dy === s * 2 - 1 || dz === -s || dz === s - 1 || dx === -s || dx === s - 1;
          if (shape === 'cube' || edge) set(c.x + dx, c.y + dy, c.z + dz);
        }
        break;
      case 'cylinder':
        for (let dy = 0; dy < s * 2; dy++) for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) if (dx * dx + dz * dz <= s * s + 0.5) set(c.x + dx, c.y + dy, c.z + dz);
        break;
      case 'pyramid':
        for (let dy = 0; dy <= s; dy++) for (let dz = -(s - dy); dz <= s - dy; dz++) for (let dx = -(s - dy); dx <= s - dy; dx++) set(c.x + dx, c.y + dy, c.z + dz);
        break;
      case 'wall':
        for (let dy = 0; dy < s * 2; dy++) for (let k = -s; k <= s; k++) set(c.x + k * (fz !== 0 ? 1 : 0), c.y + dy, c.z + k * (fx !== 0 ? 1 : 0));
        break;
      case 'floor':
        for (let dz = -s; dz <= s; dz++) for (let dx = -s; dx <= s; dx++) set(c.x + dx, c.y, c.z + dz);
        break;
      default: break;
    }
    return n;
  }

  copyRegion() {
    const g = this.game;
    const { a, b } = this.copy;
    if (!a || !b) { g.message('Set both corners first (left and right click)'); return; }
    const min = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
    const size = { x: Math.abs(a.x - b.x) + 1, y: Math.abs(a.y - b.y) + 1, z: Math.abs(a.z - b.z) + 1 };
    if (size.x * size.y * size.z > 250000) { g.message('Selection too big (max 250,000 blocks)'); return; }
    const data = new Uint8Array(size.x * size.y * size.z);
    let i = 0;
    for (let y = 0; y < size.y; y++) for (let z = 0; z < size.z; z++) for (let x = 0; x < size.x; x++) data[i++] = Math.max(0, g.world.getBlock(min.x + x, min.y + y, min.z + z));
    this.copy.clip = { size, data };
    g.message(`Copied ${size.x}×${size.y}×${size.z}. Press V to paste where you look.`);
  }

  paste(t) {
    const g = this.game;
    const clip = this.copy.clip;
    if (!clip) { g.message('Nothing copied yet (C copies the selection)'); return; }
    const o = { x: t.x + t.nx, y: t.y + Math.max(0, t.ny), z: t.z + t.nz };
    let i = 0;
    for (let y = 0; y < clip.size.y; y++) for (let z = 0; z < clip.size.z; z++) for (let x = 0; x < clip.size.x; x++) {
      const id = clip.data[i++];
      if (id) g.world.setBlock(o.x + x, o.y + y, o.z + z, id, { silent: !LIQUID[id] });
    }
    g.audio.play('levelup');
  }

  // ---- held item rendering ----

  renderViewModel(renderer, daylight, p) {
    const sel = this.game.inventory.selected;
    const t = performance.now() / 1000;
    const bob = p.bobAmount;
    const bx = Math.cos(p.bob * 2) * 0.015 * bob;
    const by = -Math.abs(Math.sin(p.bob * 2)) * 0.02 * bob;
    const swing = this.swingTime > 0 ? Math.sin((1 - this.swingTime / 0.25) * Math.PI) : 0;
    this.vmRoot.position.set(bx, by - this.equip * 0.4 - (this.reloading > 0 ? 0.25 : 0) + Math.sin(t * 1.5) * 0.004, this.recoil * 0.08);
    this.vmRoot.rotation.set(swing * -0.6 + this.recoil * 0.25, swing * 0.3, swing * -0.2);
    if (this.eatTime > 0) { this.vmRoot.position.y += Math.sin(t * 25) * 0.02; this.vmRoot.position.x -= 0.15; this.vmRoot.rotation.x = -0.3; }
    if (this.game.zoom && sel?.key === 'sniper') return;
    const light = Math.max(0.25, daylight);
    this.vmAmbient.intensity = 0.4 + light * 0.6;
    this.vmSun.intensity = light * 1.0;
    renderer.render(this.vmScene, this.vmCamera);
  }

  dispose() {
    const g = this.game;
    g.scene.remove(this.highlight, this.crack, this.selection, this.preview, this.beam);
    for (const p of Object.values(this.portals)) if (p) g.scene.remove(p.mesh);
    for (const t of this.tracers) g.scene.remove(t.line);
  }
}

export { stackName, RigidEntity, woolBlockFor };
