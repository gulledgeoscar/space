// Item registry: blocks, tools, weapons, food and spawnables share one
// "stack" shape: { kind: 'block' | 'tool' | 'spawn', id | key, count }.
import { BLOCKS, inventoryBlocks } from '../world/blocks.js';

export const TOOLS = {
  hand: { name: 'Hand', category: 'Tools', desc: 'Punch blocks and creatures. Right-click creatures to ride or feed them.' },
  pickaxe: { name: 'Diamond Pickaxe', category: 'Tools', desc: 'Mines everything fast.' },
  sword: { name: 'Diamond Sword', category: 'Weapons', desc: 'Melee weapon. 7 damage.' },
  pistol: { name: 'Pistol', category: 'Weapons', desc: 'Semi-automatic. Left-click to fire.', ammo: 12, reload: 1.1 },
  rifle: { name: 'Assault Rifle', category: 'Weapons', desc: 'Fully automatic. Hold left-click.', ammo: 30, reload: 1.6 },
  shotgun: { name: 'Shotgun', category: 'Weapons', desc: '8 pellets per shot; blasts through glass and leaves.', ammo: 6, reload: 2 },
  sniper: { name: 'Sniper Rifle', category: 'Weapons', desc: 'Right-click to zoom. Huge damage.', ammo: 5, reload: 2.2 },
  rocket: { name: 'Rocket Launcher', category: 'Weapons', desc: 'Fires explosive rockets.', ammo: 1, reload: 1.2 },
  grenade: { name: 'Grenades', category: 'Weapons', desc: 'Left-click to throw. Explodes after 3 seconds.' },
  flamethrower: { name: 'Flamethrower', category: 'Weapons', desc: 'Sets the world on fire.' },
  laser: { name: 'Mining Laser', category: 'Tools', desc: 'Hold left-click to cut through blocks. Right-click: wide beam.' },
  lightning: { name: 'Lightning Staff', category: 'Weapons', desc: 'Calls lightning where you point.' },
  gravity: { name: 'Gravity Gun', category: 'Tools', desc: 'Right-click: pick up creatures, props or blocks. Left-click: launch.' },
  terraform: { name: 'Terraformer', category: 'Building', desc: 'Left-click: dig a sphere. Right-click: raise ground. Scroll+Alt: size.' },
  shape: { name: 'Builder Wand', category: 'Building', desc: 'Right-click to build a shape from the block in the next slot. Left-click cycles shape; Alt+scroll sizes.' },
  paint: { name: 'Paint Brush', category: 'Building', desc: 'Right-click paints blocks with the block in the next slot. Alt+scroll sizes.' },
  copy: { name: 'Copy Tool', category: 'Building', desc: 'Left-click: set corner 1, right-click: corner 2, C: copy, V: paste where you look.' },
  remover: { name: 'Remover', category: 'Tools', desc: 'Deletes the creature, prop or vehicle you aim at. Right-click: delete all nearby.' },
  teleport: { name: 'Teleport Gun', category: 'Tools', desc: 'Teleports you to where you aim.' },
  grapple: { name: 'Grappling Hook', category: 'Tools', desc: 'Shoot a hook and fly to it. Space releases.' },
  jetpack: { name: 'Jetpack', category: 'Tools', desc: 'Hold to keep equipped; hold Space in the air to fly.' },
  resize: { name: 'Resize Ray', category: 'Tools', desc: 'Left-click grows, right-click shrinks creatures and props.' },
  freeze: { name: 'Freeze Ray', category: 'Tools', desc: 'Freezes creatures and props in place. Right-click to thaw.' },
  flint: { name: 'Flint and Steel', category: 'Tools', desc: 'Lights fires and TNT.' },
  fireworks: { name: 'Fireworks', category: 'Tools', desc: 'Launches a firework where you aim.' },
  snowball: { name: 'Snowballs', category: 'Weapons', desc: 'Throw snowballs.' },
  apple: { name: 'Apple', category: 'Food', desc: 'Restores 4 hunger. Hold right-click to eat.', food: 4 },
  bread: { name: 'Bread', category: 'Food', desc: 'Restores 5 hunger.', food: 5 },
  steak: { name: 'Steak', category: 'Food', desc: 'Restores 8 hunger.', food: 8 },
};

export const SPAWNS = {
  // creatures
  pig: { name: 'Pig', category: 'Creatures', color: '#f0a0a0' },
  cow: { name: 'Cow', category: 'Creatures', color: '#5a4030' },
  sheep: { name: 'Sheep', category: 'Creatures', color: '#eeeeee' },
  chicken: { name: 'Chicken', category: 'Creatures', color: '#ffffff' },
  wolf: { name: 'Dog', category: 'Creatures', color: '#c0c0c0' },
  horse: { name: 'Horse', category: 'Creatures', color: '#8a5a30' },
  villager: { name: 'Villager', category: 'Creatures', color: '#8a6a50' },
  zombie: { name: 'Zombie', category: 'Monsters', color: '#4a8a4a' },
  skeleton: { name: 'Skeleton', category: 'Monsters', color: '#d0d0d0' },
  bomber: { name: 'Bomber', category: 'Monsters', color: '#40c040' },
  spider: { name: 'Spider', category: 'Monsters', color: '#3a2a2a' },
  golem: { name: 'Iron Golem', category: 'Creatures', color: '#d0d0d0' },
  // vehicles
  car: { name: 'Car', category: 'Vehicles', color: '#d03030' },
  truck: { name: 'Monster Truck', category: 'Vehicles', color: '#3060d0' },
  boat: { name: 'Boat', category: 'Vehicles', color: '#9a6a3a' },
  plane: { name: 'Plane', category: 'Vehicles', color: '#e0e0e0' },
  helicopter: { name: 'Helicopter', category: 'Vehicles', color: '#40a040' },
  // props
  crate: { name: 'Crate', category: 'Props', color: '#b08040' },
  barrel: { name: 'Explosive Barrel', category: 'Props', color: '#c03020' },
  ball: { name: 'Beach Ball', category: 'Props', color: '#f0f040' },
  bowling: { name: 'Bowling Ball', category: 'Props', color: '#202040' },
  melon_prop: { name: 'Watermelon', category: 'Props', color: '#40a040' },
  dummy: { name: 'Ragdoll Dummy', category: 'Props', color: '#e0c090' },
  domino: { name: 'Domino Row', category: 'Props', color: '#f0f0f0' },
  primed_tnt: { name: 'Lit TNT', category: 'Explosives', color: '#d03030' },
  nuke: { name: 'Nuke', category: 'Explosives', color: '#e0e020' },
  // structures
  house: { name: 'House', category: 'Structures', color: '#b08a54' },
  tower: { name: 'Tower', category: 'Structures', color: '#7a7a7a' },
  castle: { name: 'Castle', category: 'Structures', color: '#8a8a8a' },
  pyramid: { name: 'Pyramid', category: 'Structures', color: '#d8c88a' },
  skyscraper: { name: 'Skyscraper', category: 'Structures', color: '#80a0c0' },
  big_tree: { name: 'Giant Tree', category: 'Structures', color: '#3f8a2a' },
  dome: { name: 'Glass Dome', category: 'Structures', color: '#c8e6f0' },
  ramp: { name: 'Stunt Ramp', category: 'Structures', color: '#ffe030' },
  arena: { name: 'Arena', category: 'Structures', color: '#9a4d3a' },
  pool: { name: 'Swimming Pool', category: 'Structures', color: '#2f5fd0' },
  volcano: { name: 'Volcano', category: 'Structures', color: '#e85a10' },
};

export const stackName = (s) => {
  if (!s) return '';
  if (s.kind === 'block') return BLOCKS[s.id]?.name ?? 'Block';
  if (s.kind === 'tool') return TOOLS[s.key]?.name ?? s.key;
  if (s.kind === 'spawn') return `Spawn ${SPAWNS[s.key]?.name ?? s.key}`;
  return '';
};

export const sameItem = (a, b) => a && b && a.kind === b.kind && (a.kind === 'block' ? a.id === b.id : a.key === b.key);

export function creativeCatalog() {
  const blocks = inventoryBlocks().map((b) => ({ kind: 'block', id: b.id, count: 64, category: b.category }));
  const tools = Object.entries(TOOLS).filter(([k]) => k !== 'hand').map(([key, t]) => ({ kind: 'tool', key, count: 1, category: t.category }));
  const spawns = Object.entries(SPAWNS).map(([key, s]) => ({ kind: 'spawn', key, count: 1, category: s.category }));
  return { blocks, tools, spawns };
}

export const MAX_STACK = 64;
export const stackable = (s) => s && (s.kind === 'block' || (s.kind === 'tool' && (TOOLS[s.key]?.food || ['grenade', 'snowball', 'fireworks'].includes(s.key))) || s.kind === 'spawn');
