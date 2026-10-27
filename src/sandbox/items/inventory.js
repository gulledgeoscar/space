// Hotbar (9 slots) plus a 27-slot backpack. Creative mode never runs out.
import * as THREE from 'three';
import { B } from '../world/blocks.js';
import { sameItem, stackable, MAX_STACK, stackName } from './items.js';

export class Inventory {
  constructor(game) {
    this.game = game;
    this.hotbar = new Array(9).fill(null);
    this.main = new Array(27).fill(null);
    this.index = 0;
  }

  get selected() { return this.hotbar[this.index]; }

  // The slot after the selected one (builder tools take their block from it).
  get nextBlock() {
    for (let k = 1; k < 9; k++) {
      const s = this.hotbar[(this.index + k) % 9];
      if (s?.kind === 'block') return s.id;
    }
    return B.stone;
  }

  select(i) {
    if (i === this.index) return;
    this.index = i;
    this.game.tools.onSelect();
    this.game.hud.refresh();
    this.game.hud.showItemName(stackName(this.selected));
    this.game.audio.play('click');
  }

  giveStarter() {
    const blk = (id, count = 64) => ({ kind: 'block', id, count });
    const tool = (key, count = 1) => ({ kind: 'tool', key, count });
    if (this.game.mode === 'survival') {
      this.hotbar = [tool('pickaxe'), tool('sword'), blk(B.torch, 32), blk(B.planks, 32), tool('apple', 8), tool('grapple'), blk(B.cobble, 32), null, null];
      this.main.fill(null);
    } else {
      this.hotbar = [blk(B.grass), blk(B.stone), blk(B.planks), blk(B.glass), blk(B.torch), blk(B.tnt), tool('pistol'), tool('gravity'), tool('rocket')];
      this.main = [
        tool('shotgun'), tool('rifle'), tool('sniper'), tool('grenade', 16), tool('flamethrower'), tool('lightning'), tool('laser'), tool('terraform'), tool('shape'),
        tool('paint'), tool('teleport'), tool('grapple'), tool('jetpack'), tool('resize'), tool('freeze'), tool('flint'), tool('fireworks', 16), tool('remover'),
        { kind: 'spawn', key: 'car', count: 1 }, { kind: 'spawn', key: 'horse', count: 1 }, { kind: 'spawn', key: 'plane', count: 1 }, { kind: 'spawn', key: 'helicopter', count: 1 },
        { kind: 'spawn', key: 'rocket', count: 1 }, { kind: 'spawn', key: 'zombie', count: 1 }, { kind: 'spawn', key: 'dummy', count: 1 }, { kind: 'spawn', key: 'castle', count: 1 }, { kind: 'spawn', key: 'nuke', count: 1 },
      ];
    }
  }

  setSlot(i, stack) {
    if (i < 9) this.hotbar[i] = stack;
    else this.main[i - 9] = stack;
    if (i === this.index) this.game.tools.onSelect();
    this.game.hud.refresh();
  }

  getSlot(i) { return i < 9 ? this.hotbar[i] : this.main[i - 9]; }

  // Returns the count that didn't fit.
  add(stack) {
    let left = stack.count ?? 1;
    const slots = [...this.hotbar.keys()].map((i) => i).concat([...this.main.keys()].map((i) => i + 9));
    if (stackable(stack)) {
      for (const i of slots) {
        const s = this.getSlot(i);
        if (s && sameItem(s, stack) && s.count < MAX_STACK) {
          const n = Math.min(left, MAX_STACK - s.count);
          s.count += n; left -= n;
          if (!left) break;
        }
      }
    }
    for (const i of slots) {
      if (!left) break;
      if (!this.getSlot(i)) {
        const n = stackable(stack) ? Math.min(left, MAX_STACK) : 1;
        this.setSlot(i, { ...stack, count: n });
        left -= n;
      }
    }
    this.game.hud.refresh();
    return left;
  }

  consumeSelected(n = 1) {
    if (this.game.creative) return true;
    const s = this.selected;
    if (!s) return false;
    s.count -= n;
    if (s.count <= 0) this.hotbar[this.index] = null;
    this.game.tools.onSelect();
    this.game.hud.refresh();
    return true;
  }

  pickBlock(id) {
    const i = this.hotbar.findIndex((s) => s?.kind === 'block' && s.id === id);
    if (i >= 0) { this.select(i); return; }
    if (!this.game.creative) return;
    this.hotbar[this.index] = { kind: 'block', id, count: 64 };
    this.game.tools.onSelect();
    this.game.hud.refresh();
    this.game.hud.showItemName(stackName(this.selected));
  }

  dropSelected(all) {
    const s = this.selected;
    if (!s) return;
    const p = this.game.player;
    const n = all ? s.count : 1;
    const dir = p.lookDir();
    this.game.entities.dropItem(p.eyePos.addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.3, 0)), { ...s, count: n }, dir.multiplyScalar(6).add(new THREE.Vector3(0, 2, 0)));
    if (this.game.creative) return;
    s.count -= n;
    if (s.count <= 0) this.hotbar[this.index] = null;
    this.game.tools.onSelect();
    this.game.hud.refresh();
  }

  dropAll() {
    const p = this.game.player.position.add(new THREE.Vector3(0, 1, 0));
    for (let i = 0; i < 36; i++) {
      const s = this.getSlot(i);
      if (s) { this.game.entities.dropItem(p, s); this.setSlot(i, null); }
    }
  }

  save() { return { hotbar: this.hotbar, main: this.main, index: this.index }; }
  load(d) {
    this.hotbar = d.hotbar ?? this.hotbar;
    this.main = d.main ?? this.main;
    this.index = d.index ?? 0;
    while (this.hotbar.length < 9) this.hotbar.push(null);
    while (this.main.length < 27) this.main.push(null);
  }
}
