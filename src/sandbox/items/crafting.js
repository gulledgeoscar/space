// Survival crafting: simple shapeless recipes from what's in your inventory.
import { B } from '../world/blocks.js';

const blk = (id, count = 1) => ({ kind: 'block', id, count });
const tool = (key, count = 1) => ({ kind: 'tool', key, count });
const spawn = (key, count = 1) => ({ kind: 'spawn', key, count });
// Ingredient groups: any of these counts.
const LOGS = { group: 'log', ids: [B.oak_log, B.birch_log, B.spruce_log, B.jungle_log, B.cherry_log] };

export const RECIPES = [
  { out: blk(B.planks, 4), needs: [[LOGS, 1]] },
  { out: tool('stick', 4), needs: [[blk(B.planks), 2]] },
  { out: blk(B.torch, 4), needs: [[tool('coal'), 1], [tool('stick'), 1]] },
  { out: blk(B.crafting_table), needs: [[blk(B.planks), 4]] },
  { out: blk(B.plank_slab, 6), needs: [[blk(B.planks), 3]] },
  { out: blk(B.ladder, 3), needs: [[tool('stick'), 7]] },
  { out: blk(B.bookshelf), needs: [[blk(B.planks), 6], [tool('string'), 3]] },
  { out: blk(B.glass, 4), needs: [[blk(B.sand), 4], [tool('coal'), 1]] },
  { out: blk(B.stone, 8), needs: [[blk(B.cobble), 8], [tool('coal'), 1]] },
  { out: blk(B.stone_bricks, 4), needs: [[blk(B.stone), 4]] },
  { out: blk(B.stone_slab, 6), needs: [[blk(B.stone_bricks), 3]] },
  { out: blk(B.brick, 4), needs: [[blk(B.clay), 4], [tool('coal'), 1]] },
  { out: blk(B.sandstone), needs: [[blk(B.sand), 4]] },
  { out: blk(B.furnace), needs: [[blk(B.cobble), 8]] },
  { out: blk(B.lamp), needs: [[blk(B.torch), 4], [blk(B.glass), 1]] },
  { out: blk(B.glowstone), needs: [[blk(B.torch), 4], [tool('gold'), 1]] },
  { out: blk(B.tnt), needs: [[tool('gunpowder'), 5], [blk(B.sand), 4]] },
  { out: blk(B.wool_white), needs: [[tool('string'), 4]] },
  { out: blk(B.hay), needs: [[blk(B.tall_grass), 9]] },
  { out: blk(B.iron_block), needs: [[tool('iron'), 9]] },
  { out: blk(B.gold_block), needs: [[tool('gold'), 9]] },
  { out: blk(B.diamond_block), needs: [[tool('diamond'), 9]] },
  { out: blk(B.emerald_block), needs: [[tool('emerald'), 9]] },
  { out: blk(B.bounce_pad), needs: [[tool('iron'), 2], [blk(B.slime), 1]] },
  { out: tool('bread'), needs: [[blk(B.hay), 1]] },
  { out: tool('pickaxe'), needs: [[tool('iron'), 3], [tool('stick'), 2]] },
  { out: tool('sword'), needs: [[tool('iron'), 2], [tool('stick'), 1]] },
  { out: tool('flint'), needs: [[tool('iron'), 1], [blk(B.gravel), 1]] },
  { out: tool('grapple'), needs: [[tool('iron'), 3], [tool('string'), 3]] },
  { out: tool('pistol'), needs: [[tool('iron'), 4], [tool('gunpowder'), 1]] },
  { out: tool('shotgun'), needs: [[tool('iron'), 6], [tool('gunpowder'), 2], [blk(B.planks), 2]] },
  { out: tool('rifle'), needs: [[tool('iron'), 8], [tool('gunpowder'), 3]] },
  { out: tool('grenade', 4), needs: [[tool('iron'), 1], [tool('gunpowder'), 2]] },
  { out: tool('rocket'), needs: [[tool('iron'), 6], [tool('gunpowder'), 4], [tool('gold'), 1]] },
  { out: tool('fireworks', 4), needs: [[tool('gunpowder'), 1], [blk(B.wool_white), 1]] },
  { out: tool('jetpack'), needs: [[tool('iron'), 6], [tool('gunpowder'), 4], [tool('diamond'), 1]] },
  { out: tool('gravity'), needs: [[tool('iron'), 4], [tool('diamond'), 2], [tool('emerald'), 2]] },
  { out: tool('laser'), needs: [[tool('iron'), 4], [tool('diamond'), 3], [tool('gold'), 2]] },
  { out: tool('teleport'), needs: [[tool('emerald'), 3], [tool('gold'), 2]] },
  { out: spawn('boat'), needs: [[blk(B.planks), 5]] },
  { out: spawn('car'), needs: [[tool('iron'), 10], [tool('coal'), 4], [blk(B.glass), 2]] },
  { out: spawn('crate'), needs: [[blk(B.planks), 6]] },
];

function matches(stack, ing) {
  if (!stack) return false;
  if (ing.group) return stack.kind === 'block' && ing.ids.includes(stack.id);
  if (stack.kind !== ing.kind) return false;
  return ing.kind === 'block' ? stack.id === ing.id : stack.key === ing.key;
}

export function countOf(inv, ing) {
  let n = 0;
  for (let i = 0; i < 36; i++) { const s = inv.getSlot(i); if (matches(s, ing)) n += s.count; }
  return n;
}

export function canCraft(inv, r) {
  return r.needs.every(([ing, n]) => countOf(inv, ing) >= n);
}

export function craft(inv, r) {
  if (!canCraft(inv, r)) return false;
  for (const [ing, n] of r.needs) {
    let left = n;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = inv.getSlot(i);
      if (!matches(s, ing)) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count <= 0) inv.setSlot(i, null);
    }
  }
  const leftover = inv.add({ ...r.out });
  if (leftover) inv.game.entities.dropItem(inv.game.player.eyePos, { ...r.out, count: leftover });
  return true;
}

export const ingredientStack = (ing) => (ing.group ? { kind: 'block', id: ing.ids[0], count: 1 } : ing);
