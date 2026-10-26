// Block registry. Pure data so the workers, the main thread and the tests share it.
//
// render: 'opaque' | 'cutout' (alpha-tested, e.g. leaves, plants) | 'translucent'
//         (blended, e.g. water, glass) | 'none' (air)
// shape:  'cube' | 'cross' (plants) | 'torch' | 'liquid' | 'slab'

export const B = {};          // name -> id
export const BLOCKS = [];     // id -> definition
export const TEXTURES = [];   // texture layer -> name
const texIndex = new Map();

function tex(name) {
  if (!texIndex.has(name)) {
    texIndex.set(name, TEXTURES.length);
    TEXTURES.push(name);
  }
  return texIndex.get(name);
}

const DEFAULTS = {
  solid: true,
  opaque: true,
  render: 'opaque',
  shape: 'cube',
  light: 0,
  filter: 15,          // how much sky/block light is lost passing through
  hardness: 1,         // seconds to mine by hand-ish
  flammable: false,
  gravity: false,
  liquid: false,
  category: 'Building',
  blast: 1,            // explosion resistance
  hidden: false,       // not in the creative inventory
  sound: 'stone',
  color: 0x888888,     // particle / map colour
};

function def(id, key, name, opts = {}) {
  const t = opts.tex ?? key;
  const faces = typeof t === 'string' ? { top: t, side: t, bottom: t } : { top: t.top ?? t.side, side: t.side, bottom: t.bottom ?? t.top ?? t.side };
  const block = { ...DEFAULTS, ...opts, id, key, name };
  if (block.render === 'cutout' || block.render === 'translucent') {
    block.opaque = false;
    if (opts.filter === undefined) block.filter = block.render === 'cutout' ? 1 : 0;
  }
  if (block.shape === 'cross' || block.shape === 'torch') {
    block.solid = opts.solid ?? false;
    block.opaque = false;
    block.filter = 0;
    if (!opts.render) block.render = 'cutout';
  }
  // texture layers for the six faces in mesher order: +x -x +y -y +z -z
  block.faceTex = [tex(faces.side), tex(faces.side), tex(faces.top), tex(faces.bottom), tex(faces.side), tex(faces.side)];
  if (opts.texFront) block.faceTex[4] = tex(opts.texFront);
  BLOCKS[id] = block;
  B[key] = id;
  return block;
}

def(0, 'air', 'Air', { solid: false, opaque: false, render: 'none', filter: 0, hidden: true, hardness: 0, tex: 'stone' });
def(1, 'stone', 'Stone', { hardness: 1.5, blast: 6, color: 0x7d7d7d });
def(2, 'dirt', 'Dirt', { hardness: 0.5, sound: 'dirt', color: 0x86603d });
def(3, 'grass', 'Grass', { tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6, sound: 'grass', color: 0x5d9b3a });
def(4, 'sand', 'Sand', { hardness: 0.5, gravity: true, sound: 'sand', color: 0xdbcf8e });
def(5, 'gravel', 'Gravel', { hardness: 0.6, gravity: true, sound: 'dirt', color: 0x84807c });
def(6, 'water', 'Water', { solid: false, render: 'translucent', shape: 'liquid', liquid: 'water', filter: 2, hardness: 0, category: 'Nature', sound: 'water', color: 0x2f5fd0, blast: 100 });
def(7, 'lava', 'Lava', { solid: false, opaque: false, render: 'opaque', shape: 'liquid', liquid: 'lava', light: 15, filter: 0, hardness: 0, category: 'Nature', sound: 'lava', color: 0xe85a10, blast: 100 });
def(8, 'oak_log', 'Oak Log', { tex: { top: 'oak_log_top', side: 'oak_log' }, hardness: 1, flammable: true, sound: 'wood', category: 'Nature', color: 0x6b5132 });
def(9, 'oak_leaves', 'Oak Leaves', { render: 'cutout', hardness: 0.2, flammable: true, sound: 'grass', category: 'Nature', color: 0x3f8a2a });
def(10, 'planks', 'Oak Planks', { hardness: 1, flammable: true, sound: 'wood', color: 0xb08a54 });
def(11, 'cobble', 'Cobblestone', { hardness: 1.5, blast: 6, color: 0x787878 });
def(12, 'glass', 'Glass', { render: 'cutout', hardness: 0.3, sound: 'glass', filter: 0, color: 0xc8e6f0 });
def(13, 'brick', 'Bricks', { hardness: 1.5, blast: 6, color: 0x9a4d3a });
def(14, 'snow', 'Snow', { hardness: 0.3, sound: 'snow', category: 'Nature', color: 0xf3f8fb });
def(15, 'ice', 'Ice', { render: 'translucent', hardness: 0.5, sound: 'glass', filter: 2, category: 'Nature', color: 0x9cc4f5 });
def(16, 'cactus', 'Cactus', { tex: { top: 'cactus_top', side: 'cactus_side' }, hardness: 0.4, sound: 'wood', category: 'Nature', color: 0x3b8a2e, render: 'cutout' });
def(17, 'sandstone', 'Sandstone', { tex: { top: 'sandstone_top', side: 'sandstone' }, hardness: 0.8, color: 0xd8c88a });
def(18, 'coal_ore', 'Coal Ore', { hardness: 2, category: 'Nature', color: 0x3a3a3a });
def(19, 'iron_ore', 'Iron Ore', { hardness: 2.5, category: 'Nature', color: 0xc7a586 });
def(20, 'gold_ore', 'Gold Ore', { hardness: 2.5, category: 'Nature', color: 0xe8d04a });
def(21, 'diamond_ore', 'Diamond Ore', { hardness: 3, category: 'Nature', color: 0x5fe0dc });
def(22, 'bedrock', 'Bedrock', { hardness: Infinity, blast: Infinity, category: 'Nature', color: 0x333333 });
def(23, 'tnt', 'TNT', { tex: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }, hardness: 0.1, flammable: true, category: 'Special', sound: 'grass', color: 0xd03a2a });
def(24, 'glowstone', 'Glowstone', { light: 15, hardness: 0.3, sound: 'glass', category: 'Light', color: 0xf5d27a });
def(25, 'torch', 'Torch', { shape: 'torch', light: 14, hardness: 0, category: 'Light', sound: 'wood', color: 0xffc040 });
def(26, 'tall_grass', 'Tall Grass', { shape: 'cross', hardness: 0, flammable: true, category: 'Nature', sound: 'grass', color: 0x5d9b3a });
def(27, 'rose', 'Rose', { shape: 'cross', hardness: 0, category: 'Nature', sound: 'grass', color: 0xd02a2a });
def(28, 'dandelion', 'Dandelion', { shape: 'cross', hardness: 0, category: 'Nature', sound: 'grass', color: 0xf0d020 });
def(29, 'birch_log', 'Birch Log', { tex: { top: 'birch_log_top', side: 'birch_log' }, hardness: 1, flammable: true, sound: 'wood', category: 'Nature', color: 0xd8d4c8 });
def(30, 'birch_leaves', 'Birch Leaves', { render: 'cutout', hardness: 0.2, flammable: true, sound: 'grass', category: 'Nature', color: 0x6a9a40 });
def(31, 'spruce_log', 'Spruce Log', { tex: { top: 'spruce_log_top', side: 'spruce_log' }, hardness: 1, flammable: true, sound: 'wood', category: 'Nature', color: 0x4a3420 });
def(32, 'spruce_leaves', 'Spruce Leaves', { render: 'cutout', hardness: 0.2, flammable: true, sound: 'grass', category: 'Nature', color: 0x2f5a35 });

const WOOL = [
  ['white', 0xeeeeee], ['red', 0xc0302a], ['orange', 0xe8802a], ['yellow', 0xf0d040],
  ['lime', 0x70d040], ['green', 0x3a7a2a], ['cyan', 0x2a9aa0], ['light_blue', 0x6aa8e8],
  ['blue', 0x3048b0], ['purple', 0x8040b0], ['magenta', 0xc050c0], ['pink', 0xf0a0c0],
  ['brown', 0x7a5030], ['gray', 0x606060], ['light_gray', 0xa8a8a8], ['black', 0x1c1c1c],
];
WOOL.forEach(([c, color], i) => {
  const label = c.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  def(33 + i, `wool_${c}`, `${label} Wool`, { tex: `wool_${c}`, hardness: 0.4, flammable: true, sound: 'cloth', category: 'Colors', color, woolColor: color });
});
WOOL.forEach(([c, color], i) => {
  const label = c.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  def(49 + i, `concrete_${c}`, `${label} Concrete`, { tex: `concrete_${c}`, hardness: 1.2, blast: 4, category: 'Colors', color, woolColor: color });
});

def(65, 'obsidian', 'Obsidian', { hardness: 8, blast: 1200, color: 0x1a1028 });
def(66, 'bookshelf', 'Bookshelf', { tex: { top: 'planks', side: 'bookshelf' }, hardness: 1, flammable: true, sound: 'wood', category: 'Decor', color: 0x8a6a3a });
def(67, 'stone_bricks', 'Stone Bricks', { hardness: 1.5, blast: 6, color: 0x7a7a7a });
def(68, 'quartz', 'Quartz Block', { tex: { top: 'quartz_top', side: 'quartz' }, hardness: 1, color: 0xece6de });
def(69, 'iron_block', 'Block of Iron', { hardness: 3, blast: 6, sound: 'metal', category: 'Decor', color: 0xd8d8d8 });
def(70, 'gold_block', 'Block of Gold', { hardness: 3, blast: 6, sound: 'metal', category: 'Decor', color: 0xf4d03a });
def(71, 'diamond_block', 'Block of Diamond', { hardness: 3, blast: 6, sound: 'metal', category: 'Decor', color: 0x6af0e8 });
def(72, 'mossy_cobble', 'Mossy Cobblestone', { hardness: 1.5, blast: 6, color: 0x6a7a5a });
def(73, 'clay', 'Clay', { hardness: 0.6, sound: 'dirt', category: 'Nature', color: 0x9aa0ae });
def(74, 'pumpkin', 'Pumpkin', { tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, texFront: 'pumpkin_face', hardness: 0.8, sound: 'wood', category: 'Nature', color: 0xe0801a });
def(75, 'melon', 'Melon', { tex: { top: 'melon_top', side: 'melon_side' }, hardness: 0.8, sound: 'wood', category: 'Nature', color: 0x6aa02a });
def(76, 'jack_o_lantern', "Jack o'Lantern", { tex: { top: 'pumpkin_top', side: 'pumpkin_side' }, texFront: 'jack_face', light: 15, hardness: 0.8, sound: 'wood', category: 'Light', color: 0xf0a020 });
def(77, 'crafting_table', 'Crafting Table', { tex: { top: 'crafting_top', side: 'crafting_side', bottom: 'planks' }, hardness: 1, flammable: true, sound: 'wood', category: 'Decor', color: 0x9a6a3a });
def(78, 'furnace', 'Furnace', { tex: { top: 'furnace_top', side: 'furnace_side' }, texFront: 'furnace_front', hardness: 2, category: 'Decor', color: 0x6a6a6a });
def(79, 'lamp', 'Redstone Lamp', { light: 15, hardness: 0.3, sound: 'glass', category: 'Light', color: 0xffc070 });
def(80, 'fire', 'Fire', { shape: 'cross', light: 15, hardness: 0, category: 'Special', sound: 'fire', color: 0xff8020, solid: false });
def(81, 'dead_bush', 'Dead Bush', { shape: 'cross', hardness: 0, flammable: true, category: 'Nature', sound: 'grass', color: 0x8a6a3a });
def(82, 'sugar_cane', 'Sugar Cane', { shape: 'cross', hardness: 0, category: 'Nature', sound: 'grass', color: 0x8ac060 });
def(83, 'red_mushroom', 'Red Mushroom', { shape: 'cross', hardness: 0, category: 'Nature', sound: 'grass', color: 0xc03030 });
def(84, 'brown_mushroom', 'Brown Mushroom', { shape: 'cross', hardness: 0, category: 'Nature', sound: 'grass', color: 0x9a7050 });
def(85, 'red_sand', 'Red Sand', { hardness: 0.5, gravity: true, sound: 'sand', category: 'Nature', color: 0xb8622a });
def(86, 'terracotta', 'Terracotta', { hardness: 1.2, color: 0x9a5a40 });
def(87, 'hay', 'Hay Bale', { tex: { top: 'hay_top', side: 'hay_side' }, hardness: 0.5, flammable: true, sound: 'grass', category: 'Decor', color: 0xc8a830 });
def(88, 'sponge', 'Sponge', { hardness: 0.5, sound: 'grass', category: 'Special', color: 0xd0c040 });
def(89, 'neon_red', 'Red Neon', { light: 12, hardness: 0.3, sound: 'glass', category: 'Light', color: 0xff3050 });
def(90, 'neon_green', 'Green Neon', { light: 12, hardness: 0.3, sound: 'glass', category: 'Light', color: 0x30ff70 });
def(91, 'neon_blue', 'Blue Neon', { light: 12, hardness: 0.3, sound: 'glass', category: 'Light', color: 0x3090ff });
def(92, 'neon_pink', 'Pink Neon', { light: 12, hardness: 0.3, sound: 'glass', category: 'Light', color: 0xff50e0 });
def(93, 'slime', 'Slime Block', { render: 'translucent', hardness: 0.1, filter: 1, sound: 'slime', category: 'Special', color: 0x7ad060, bounce: 0.95 });
def(94, 'ladder', 'Scaffolding', { render: 'cutout', hardness: 0.3, solid: false, flammable: true, sound: 'wood', category: 'Decor', color: 0x9a7040, climbable: true });
def(95, 'packed_ice', 'Packed Ice', { hardness: 0.5, sound: 'glass', category: 'Nature', color: 0x8ab4ee, slippery: true });
def(96, 'mud', 'Mud', { hardness: 0.5, sound: 'dirt', category: 'Nature', color: 0x3c3430 });
def(97, 'basalt', 'Basalt', { tex: { top: 'basalt_top', side: 'basalt' }, hardness: 1.2, color: 0x4a4a50 });
def(98, 'magma', 'Magma Block', { light: 4, hardness: 0.5, color: 0x8a3010, hot: true });
def(99, 'mycelium', 'Mycelium', { tex: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' }, hardness: 0.6, sound: 'grass', category: 'Nature', color: 0x6a5a6a });
def(100, 'glass_red', 'Red Stained Glass', { tex: 'glass_red', render: 'translucent', hardness: 0.3, sound: 'glass', filter: 0, category: 'Colors', color: 0xc03030 });
def(101, 'glass_blue', 'Blue Stained Glass', { tex: 'glass_blue', render: 'translucent', hardness: 0.3, sound: 'glass', filter: 0, category: 'Colors', color: 0x3050c0 });
def(102, 'glass_green', 'Green Stained Glass', { tex: 'glass_green', render: 'translucent', hardness: 0.3, sound: 'glass', filter: 0, category: 'Colors', color: 0x30a040 });
def(103, 'glass_yellow', 'Yellow Stained Glass', { tex: 'glass_yellow', render: 'translucent', hardness: 0.3, sound: 'glass', filter: 0, category: 'Colors', color: 0xe0c030 });
def(104, 'bounce_pad', 'Bounce Pad', { tex: { top: 'bounce_top', side: 'iron_block' }, hardness: 0.5, sound: 'slime', category: 'Special', color: 0x30e0ff, launch: 22 });
def(105, 'speed_pad', 'Speed Pad', { tex: { top: 'speed_top', side: 'iron_block' }, hardness: 0.5, sound: 'metal', category: 'Special', color: 0xffe030, speed: true });
def(106, 'emerald_ore', 'Emerald Ore', { hardness: 3, category: 'Nature', color: 0x40d070 });
def(107, 'emerald_block', 'Block of Emerald', { hardness: 3, blast: 6, sound: 'metal', category: 'Decor', color: 0x40e080 });
def(108, 'checker', 'Checkerboard', { hardness: 1, category: 'Decor', color: 0x808080 });
def(109, 'stone_slab', 'Stone Slab', { shape: 'slab', opaque: false, filter: 0, tex: 'stone_bricks', hardness: 1.5, category: 'Building', color: 0x7a7a7a });
def(110, 'plank_slab', 'Oak Slab', { shape: 'slab', opaque: false, filter: 0, tex: 'planks', hardness: 1, flammable: true, sound: 'wood', category: 'Building', color: 0xb08a54 });
def(111, 'lily_pad', 'Lily Pad', { shape: 'cross', hidden: true, hardness: 0, category: 'Nature', color: 0x2a7a2a });
def(112, 'prismarine', 'Prismarine', { hardness: 1.5, category: 'Decor', color: 0x5aa898 });
def(113, 'sea_lantern', 'Sea Lantern', { light: 15, hardness: 0.3, sound: 'glass', category: 'Light', color: 0xd0f0e8 });
def(114, 'coral', 'Coral', { shape: 'cross', hardness: 0, category: 'Nature', color: 0xf06090, sound: 'grass' });
def(115, 'cherry_leaves', 'Cherry Leaves', { render: 'cutout', hardness: 0.2, flammable: true, sound: 'grass', category: 'Nature', color: 0xf0a0c8 });
def(116, 'cherry_log', 'Cherry Log', { tex: { top: 'cherry_log_top', side: 'cherry_log' }, hardness: 1, flammable: true, sound: 'wood', category: 'Nature', color: 0x5a3040 });
def(117, 'jungle_log', 'Jungle Log', { tex: { top: 'jungle_log_top', side: 'jungle_log' }, hardness: 1, flammable: true, sound: 'wood', category: 'Nature', color: 0x5a4a2a });
def(118, 'jungle_leaves', 'Jungle Leaves', { render: 'cutout', hardness: 0.2, flammable: true, sound: 'grass', category: 'Nature', color: 0x2a8a20 });
def(119, 'vines', 'Vines', { render: 'cutout', shape: 'cross', hardness: 0, flammable: true, category: 'Nature', sound: 'grass', color: 0x2a7a20, climbable: true });

// Flowing liquids. Level 1 is next to the source (or falling), 7 is the thinnest.
export const WATER_FLOW = 200; // ids 201..207
export const LAVA_FLOW = 210;  // ids 211..217
for (let l = 1; l <= 7; l++) {
  def(WATER_FLOW + l, `water_${l}`, 'Flowing Water', { ...BLOCKS[6], hidden: true, tex: 'water', level: l });
  def(LAVA_FLOW + l, `lava_${l}`, 'Flowing Lava', { ...BLOCKS[7], hidden: true, tex: 'lava', level: l });
}
BLOCKS[6].level = 0;
BLOCKS[7].level = 0;

export const MAX_BLOCK_ID = 255;

// Lookup tables used in the hot meshing / lighting loops.
export const OPAQUE = new Uint8Array(256);
export const SOLID = new Uint8Array(256);
export const LIGHT = new Uint8Array(256);
export const FILTER = new Uint8Array(256);
export const RENDER = new Uint8Array(256);   // 0 none, 1 opaque, 2 cutout, 3 translucent
export const SHAPE = new Uint8Array(256);    // 0 cube, 1 cross, 2 torch, 3 liquid, 4 slab
export const LIQUID = new Uint8Array(256);   // 0 none, 1 water, 2 lava
export const LEVEL = new Uint8Array(256);
const RENDER_CODES = { none: 0, opaque: 1, cutout: 2, translucent: 3 };
const SHAPE_CODES = { cube: 0, cross: 1, torch: 2, liquid: 3, slab: 4 };
for (let id = 0; id < 256; id++) {
  const b = BLOCKS[id];
  if (!b) { FILTER[id] = 0; continue; }
  OPAQUE[id] = b.opaque ? 1 : 0;
  SOLID[id] = b.solid ? 1 : 0;
  LIGHT[id] = b.light;
  FILTER[id] = b.opaque ? 15 : b.filter;
  RENDER[id] = RENDER_CODES[b.render];
  SHAPE[id] = SHAPE_CODES[b.shape];
  LIQUID[id] = b.liquid === 'water' ? 1 : b.liquid === 'lava' ? 2 : 0;
  LEVEL[id] = b.level ?? 0;
}

export const isWater = (id) => LIQUID[id] === 1;
export const isLava = (id) => LIQUID[id] === 2;
export const blockName = (id) => BLOCKS[id]?.name ?? 'Unknown';
export const inventoryBlocks = () => BLOCKS.filter((b) => b && !b.hidden);
