// Shared PBR material library with procedurally painted canvas textures.

import { MeshStandardMaterial, MeshBasicMaterial, Color, DoubleSide, AdditiveBlending } from 'three';
import { canvasTexture } from './geometry.js';

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function hullPanels(base = '#d9d6cf', line = 'rgba(40,40,45,0.35)', seed = 3) {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const r = rng(seed);
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    // panel tone variation
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * 8) * 128, y = Math.floor(r() * 8) * 128;
      const pw = 128 * (1 + Math.floor(r() * 2)), ph = 128 * (1 + Math.floor(r() * 2));
      const v = Math.floor(r() * 18) - 9;
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 120})`;
      ctx.fillRect(x, y, pw, ph);
    }
    ctx.strokeStyle = line; ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(w, i * 128); ctx.stroke();
    }
    // rivets and small hatches
    ctx.fillStyle = 'rgba(60,60,60,0.35)';
    for (let i = 0; i <= 8; i++) for (let j = 0; j < 32; j++) {
      ctx.beginPath(); ctx.arc(i * 128 + 6, j * 32 + 8, 2, 0, 7); ctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = r() * w, y = r() * h;
      ctx.strokeStyle = 'rgba(30,30,30,0.4)';
      ctx.strokeRect(x, y, 30 + r() * 40, 20 + r() * 30);
    }
    // grime
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(80,70,60,${r() * 0.05})`;
      ctx.fillRect(r() * w, r() * h, 1 + r() * 6, 1 + r() * 30);
    }
  }, { repeat: [1, 1] });
}

function tiles() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const r = rng(11);
    ctx.fillStyle = '#16171a'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = 18 + Math.floor(r() * 16);
      ctx.fillStyle = `rgb(${v},${v},${v + 2})`;
      ctx.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
  }, { repeat: [2, 2] });
}

function grating() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2a2d31'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0d0e10';
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) ctx.fillRect(x * 32 + 4, y * 16 + 4, 24, 8);
    ctx.strokeStyle = '#4a4e54'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, w - 2, h - 2);
  }, { repeat: [1, 1] });
}

function hazard() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e0a800';
    for (let x = -h; x < w + h; x += 48) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + 24, h); ctx.lineTo(x + 24 + h, 0); ctx.lineTo(x + h, 0); ctx.fill(); }
  }, { repeat: [1, 1] });
}

let LIB = null;
export function materials() {
  if (LIB) return LIB;
  const hullTex = hullPanels();
  const interiorTex = hullPanels('#c5c8c9', 'rgba(30,35,40,0.45)', 9);
  LIB = {
    hull: new MeshStandardMaterial({ color: 0xffffff, map: hullTex, roughness: 0.62, metalness: 0.15 }),
    hullDark: new MeshStandardMaterial({ color: 0x8a8d92, map: hullTex, roughness: 0.55, metalness: 0.35 }),
    tiles: new MeshStandardMaterial({ color: 0xffffff, map: tiles(), roughness: 0.9, metalness: 0.0 }),
    accent: new MeshStandardMaterial({ color: 0xd8641e, roughness: 0.5, metalness: 0.1 }),
    gold: new MeshStandardMaterial({ color: 0xc9a043, roughness: 0.35, metalness: 1.0 }),
    foil: new MeshStandardMaterial({ color: 0xd9b25a, roughness: 0.28, metalness: 0.9 }),
    metal: new MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.38, metalness: 0.9 }),
    darkMetal: new MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.5, metalness: 0.8 }),
    rubber: new MeshStandardMaterial({ color: 0x18191b, roughness: 0.9, metalness: 0.0 }),
    nozzle: new MeshStandardMaterial({ color: 0x3a3330, roughness: 0.45, metalness: 0.85, side: DoubleSide }),
    panel: new MeshStandardMaterial({ color: 0xaab0b5, map: interiorTex, roughness: 0.72, metalness: 0.12 }),
    panelDark: new MeshStandardMaterial({ color: 0x5a6068, map: interiorTex, roughness: 0.6, metalness: 0.2 }),
    floor: new MeshStandardMaterial({ color: 0xffffff, map: grating(), roughness: 0.8, metalness: 0.6 }),
    hazard: new MeshStandardMaterial({ color: 0xffffff, map: hazard(), roughness: 0.7, metalness: 0.1 }),
    glass: new MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }),
    solar: new MeshStandardMaterial({ color: 0x0c1a3a, roughness: 0.25, metalness: 0.6, emissive: 0x020612 }),
    radiator: new MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.5, metalness: 0.2 }),
    copper: new MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 1.0 }),
    cable: new MeshStandardMaterial({ color: 0x202226, roughness: 0.75, metalness: 0.1 }),
    seat: new MeshStandardMaterial({ color: 0x2c3138, roughness: 0.85, metalness: 0.05 }),
    lightWarm: new MeshBasicMaterial({ color: new Color(3.0, 2.6, 2.0) }),
    lightCool: new MeshBasicMaterial({ color: new Color(2.2, 2.7, 3.2) }),
    lightRed: new MeshBasicMaterial({ color: new Color(4.0, 0.25, 0.15) }),
    lightGreen: new MeshBasicMaterial({ color: new Color(0.25, 4.0, 0.6) }),
    lightAmber: new MeshBasicMaterial({ color: new Color(4.0, 2.2, 0.3) }),
    lightWhite: new MeshBasicMaterial({ color: new Color(6, 6, 6) }),
    screenBlue: new MeshBasicMaterial({ color: new Color(0.25, 0.7, 1.2) }),
    plume: new MeshBasicMaterial({ color: new Color(1.6, 1.2, 2.4), transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  };
  return LIB;
}
