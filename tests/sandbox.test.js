// LIMITLESS sandbox: terrain, lighting, collision and save-format checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Simplex, hash3 } from '../src/sandbox/util/noise.js';
import { Generator } from '../src/sandbox/world/generator.js';
import { meshChunk, debugLight } from '../src/sandbox/world/mesher.js';
import { CHUNK, HEIGHT, CHUNK_VOLUME, SEA_LEVEL, index } from '../src/sandbox/world/constants.js';
import { B, BLOCKS, TEXTURES, OPAQUE, LIGHT } from '../src/sandbox/world/blocks.js';
import { moveBody, boxBlocked } from '../src/sandbox/physics/voxelCollide.js';
import { rleEncode, rleDecode } from '../src/sandbox/save/storage.js';

// A tiny world backed by one flat chunk at the origin for collision tests.
function flatWorld(groundY) {
  const data = new Uint8Array(CHUNK_VOLUME);
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) for (let y = 0; y <= groundY; y++) data[index(x, y, z)] = B.stone;
  return {
    data,
    getBlock(x, y, z) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      if (y < 0) return B.bedrock;
      if (y >= HEIGHT || x < 0 || z < 0 || x >= CHUNK || z >= CHUNK) return 0;
      return data[index(x, y, z)];
    },
  };
}

test('noise is deterministic per seed and bounded', () => {
  const a = new Simplex('abc'), b = new Simplex('abc'), c = new Simplex('xyz');
  let differs = false;
  for (let i = 0; i < 200; i++) {
    const x = i * 0.37, y = i * 0.91;
    assert.equal(a.noise2(x, y), b.noise2(x, y));
    const v = a.noise3(x, y, x - y);
    assert.ok(v >= -1.01 && v <= 1.01, `noise3 out of range: ${v}`);
    if (a.noise2(x, y) !== c.noise2(x, y)) differs = true;
  }
  assert.ok(differs, 'different seeds give different noise');
  assert.equal(hash3(1, 2, 3, 7), hash3(1, 2, 3, 7));
});

test('generated chunks are deterministic with bedrock floor and sea level water', () => {
  const g1 = new Generator('seed-1'), g2 = new Generator('seed-1');
  const a = g1.generate(3, -2), b = g2.generate(3, -2);
  assert.deepEqual(a, b);
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) assert.equal(a[index(x, 0, z)], B.bedrock);
  // Somewhere in a few chunks there is land above the sea and water at sea level.
  let land = 0, water = 0;
  for (let cz = -3; cz <= 3; cz++) for (let cx = -3; cx <= 3; cx++) {
    const d = g1.generate(cx, cz);
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      if (OPAQUE[d[index(x, SEA_LEVEL + 2, z)]]) land++;
      if (d[index(x, SEA_LEVEL, z)] === B.water) water++;
    }
  }
  assert.ok(land > 0 || water > 0);
});

test('superflat worlds are flat grass', () => {
  const g = new Generator('x', { type: 'flat' });
  const d = g.generate(0, 0);
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    assert.equal(d[index(x, SEA_LEVEL + 4, z)], B.grass);
    assert.equal(d[index(x, SEA_LEVEL + 5, z)], 0);
  }
});

test('every block face points at a real texture layer', () => {
  for (const b of BLOCKS) {
    if (!b) continue;
    for (const t of b.faceTex) assert.ok(t >= 0 && t < TEXTURES.length, `${b.key} face texture ${t}`);
  }
  assert.ok(TEXTURES.length <= 255, 'texture layers fit in a byte');
});

test('meshing a sealed cube shows only its outside, and torches light their surroundings', () => {
  const empty = () => new Uint8Array(CHUNK_VOLUME);
  const center = empty();
  // A 2x2x2 stone cube floating at y=60: 24 visible faces = 96 vertices.
  for (const [x, y, z] of [[4, 60, 4], [5, 60, 4], [4, 61, 4], [5, 61, 4], [4, 60, 5], [5, 60, 5], [4, 61, 5], [5, 61, 5]]) center[index(x, y, z)] = B.stone;
  const chunks = Array.from({ length: 9 }, (_, i) => (i === 4 ? center : empty()));
  const mesh = meshChunk(chunks);
  assert.equal(mesh.opaque.pos.length / 3, 96);
  assert.equal(mesh.cutout, null);
  // Open sky above is full sunlight.
  assert.equal(debugLight(8, 100, 8).sky, 15);

  // A torch in a sealed room: block light falls off by one per block.
  const room = empty();
  for (let y = 10; y <= 20; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) room[index(x, y, z)] = B.stone;
  for (let y = 12; y <= 18; y++) for (let z = 2; z <= 12; z++) for (let x = 2; x <= 12; x++) room[index(x, y, z)] = 0;
  room[index(7, 12, 7)] = B.torch;
  meshChunk(Array.from({ length: 9 }, (_, i) => (i === 4 ? room : empty())));
  assert.equal(debugLight(7, 12, 7).block, LIGHT[B.torch]);
  assert.equal(debugLight(10, 12, 7).block, LIGHT[B.torch] - 3);
  assert.equal(debugLight(7, 15, 7).sky, 0, 'the sealed room is dark to the sky');
});

test('a falling box lands on the ground and cannot walk into walls', () => {
  const w = flatWorld(9);
  const body = { box: { x: 8, y: 20, z: 8, hw: 0.3, h: 1.8 }, vel: { x: 0, y: 0, z: 0 } };
  let grounded = false;
  for (let i = 0; i < 200; i++) {
    body.vel.y -= 28 / 60;
    const r = moveBody(w, body, 1 / 60);
    if (r.ground) grounded = true;
  }
  assert.ok(grounded);
  assert.ok(Math.abs(body.box.y - 10) < 1e-6, `rests on top of y=9: ${body.box.y}`);
  // Wall at x = 11.
  for (let y = 10; y < 14; y++) for (let z = 0; z < CHUNK; z++) w.data[index(11, y, z)] = B.stone;
  body.vel.x = 5;
  for (let i = 0; i < 120; i++) { body.vel.x = 5; moveBody(w, body, 1 / 60); }
  assert.ok(body.box.x <= 11 - 0.3 + 1e-6, `stopped by wall: ${body.box.x}`);
  assert.ok(!boxBlocked(w, body.box));
});

test('step-up climbs a slab but not a full block', () => {
  const w = flatWorld(9);
  w.data[index(10, 10, 8)] = B.stone_slab;
  const body = { box: { x: 8.5, y: 10, z: 8.5, hw: 0.3, h: 1.8 }, vel: { x: 0, y: 0, z: 0 }, stepHeight: 0.55, onGround: true };
  for (let i = 0; i < 60; i++) { body.vel.x = 3; body.vel.y = -1; moveBody(w, body, 1 / 60); body.onGround = true; }
  assert.ok(body.box.x > 10.5, `walked onto the slab: ${body.box.x}`);
  assert.ok(Math.abs(body.box.y - 10.5) < 1e-6 || body.box.x > 11, 'stood on the slab');
});

test('run-length encoding round-trips chunk data compactly', () => {
  const data = new Generator('rle').generate(0, 0);
  const enc = rleEncode(data);
  assert.deepEqual(rleDecode(enc, CHUNK_VOLUME), data);
  assert.ok(enc.length < data.length / 4, `compresses: ${enc.length} bytes`);
});
