// Signs: a wooden board with your text, on a wall or on a post.
import * as THREE from 'three';
import { Entity } from './base.js';

function textTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b08a54';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 256, 2);
  g.strokeStyle = '#6a4a24'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#1a1208';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Wrap into up to four lines.
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  g.font = 'bold 26px system-ui, sans-serif';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > 228 && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 4);
  shown.forEach((l, i) => g.fillText(l, 128, 64 + (i - (shown.length - 1) / 2) * 27));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Sign extends Entity {
  constructor(game, opts = {}) {
    super(game, 'sign');
    this.kind = 'prop';
    this.text = opts.text ?? '';
    this.wall = !!opts.wall;
    this.yaw = opts.yaw ?? 0;
    this.invulnerable = true;
    this.radius = 0.5;
    this.height = 1;
    const wood = this.trackMaterial(new THREE.MeshLambertMaterial({ color: 0x8a6030 }));
    const face = this.trackMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, map: textTexture(this.text) }));
    const board = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 0.06), [wood, wood, wood, wood, face, face]);
    board.position.y = this.wall ? 0.5 : 0.9;
    this.mesh.add(board);
    if (!this.wall) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), wood);
      post.position.y = 0.35;
      this.mesh.add(post);
    }
    this.mesh.rotation.y = this.yaw;
  }

  bounds(out = new THREE.Box3()) {
    out.min.set(this.pos.x - 0.5, this.pos.y, this.pos.z - 0.5);
    out.max.set(this.pos.x + 0.5, this.pos.y + (this.wall ? 0.8 : 1.2), this.pos.z + 0.5);
    return out;
  }

  update(dt) {
    super.update(dt);
    this.mesh.position.copy(this.pos);
    this.updateLook(dt);
  }

  impulse() {}
  setScale() {}

  serialize() { return { type: 'sign', x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, wall: this.wall, text: this.text }; }

  dispose() {
    this.mesh.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.map?.dispose(); });
    super.dispose();
  }
}
