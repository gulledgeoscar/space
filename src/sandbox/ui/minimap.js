// Top-down minimap: each chunk keeps a 16x16 colour tile of its surface,
// rebuilt only when the chunk changes.
import { CHUNK, HEIGHT, index } from '../world/constants.js';
import { BLOCKS, LIQUID } from '../world/blocks.js';

const SIZE = 144;     // pixels
const SCALE = 1;      // blocks per pixel

const RGB = BLOCKS.map((b) => (b ? [(b.color >> 16) & 255, (b.color >> 8) & 255, b.color & 255] : [0, 0, 0]));

function buildTile(c) {
  const img = new ImageData(CHUNK, CHUNK);
  const heights = new Int16Array(CHUNK * CHUNK);
  const d = c.data;
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    let y = HEIGHT - 1, id = 0;
    for (; y > 0; y--) { id = d[index(x, y, z)]; if (id && BLOCKS[id]?.render !== 'none' && BLOCKS[id].shape !== 'torch') break; }
    let depth = 0;
    if (LIQUID[id] === 1) { let yy = y; while (yy > 0 && LIQUID[d[index(x, yy, z)]] === 1) { yy--; depth++; } }
    heights[z * CHUNK + x] = y;
    const [r, g, b] = RGB[id];
    const shade = LIQUID[id] === 1 ? Math.max(0.45, 1 - depth * 0.06) : 1;
    const o = (z * CHUNK + x) * 4;
    img.data[o] = r * shade; img.data[o + 1] = g * shade; img.data[o + 2] = b * shade; img.data[o + 3] = 255;
  }
  // Relief: lighten slopes facing north-west, darken the others.
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const h = heights[z * CHUNK + x];
    const hn = z > 0 ? heights[(z - 1) * CHUNK + x] : h;
    const k = h > hn ? 1.15 : h < hn ? 0.8 : 1;
    const o = (z * CHUNK + x) * 4;
    img.data[o] *= k; img.data[o + 1] *= k; img.data[o + 2] *= k;
  }
  return img;
}

export class Minimap {
  constructor(game, parent) {
    this.game = game;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.canvas.width = this.canvas.height = SIZE;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.tile = document.createElement('canvas');
    this.tile.width = this.tile.height = CHUNK;
    this.tctx = this.tile.getContext('2d');
    this.timer = 0;
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const g = this.game;
    const visible = g.settings.showMinimap !== false;
    this.canvas.style.display = visible ? '' : 'none';
    if (!visible) return;
    const ctx = this.ctx;
    const p = g.player.box;
    const half = (SIZE / 2) * SCALE;
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const cx0 = Math.floor((p.x - half) / CHUNK), cx1 = Math.floor((p.x + half) / CHUNK);
    const cz0 = Math.floor((p.z - half) / CHUNK), cz1 = Math.floor((p.z + half) / CHUNK);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = g.world.chunkAt(cx, cz);
      if (!c?.data) continue;
      if (!c.mapTile || c.mapVersion !== c.version) { c.mapTile = buildTile(c); c.mapVersion = c.version; }
      this.tctx.putImageData(c.mapTile, 0, 0);
      const sx = (cx * CHUNK - p.x) / SCALE + SIZE / 2, sz = (cz * CHUNK - p.z) / SCALE + SIZE / 2;
      ctx.drawImage(this.tile, Math.round(sx), Math.round(sz), CHUNK / SCALE, CHUNK / SCALE);
    }
    // Creatures and vehicles.
    for (const e of g.entities.list) {
      if (e.removed || (e.kind !== 'mob' && e.kind !== 'vehicle')) continue;
      const x = (e.pos.x - p.x) / SCALE + SIZE / 2, z = (e.pos.z - p.z) / SCALE + SIZE / 2;
      if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) continue;
      ctx.fillStyle = e.kind === 'vehicle' ? '#40a0ff' : e.hostile ? '#ff4040' : e.type === 'villager' ? '#ffd040' : '#ffffff';
      ctx.fillRect(x - 1.5, z - 1.5, 3, 3);
    }
    // You.
    const yaw = g.player.yaw;
    ctx.save();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(0, 2); ctx.lineTo(-4, 4); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '10px monospace';
    ctx.fillText('N', SIZE / 2 - 3, 10);
  }
}
