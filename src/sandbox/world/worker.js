// Chunk worker: terrain generation and meshing off the main thread.
import { Generator } from './generator.js';
import { meshChunk } from './mesher.js';

let gen = null;
let genKey = '';

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'gen') {
    const key = `${msg.seed}|${msg.worldType}`;
    if (key !== genKey) { gen = new Generator(msg.seed, { type: msg.worldType }); genKey = key; }
    const data = gen.generate(msg.cx, msg.cz);
    self.postMessage({ id: msg.id, data }, [data.buffer]);
  } else if (msg.type === 'mesh') {
    const mesh = meshChunk(msg.chunks, { sky: msg.sky });
    const transfer = [];
    for (const k of ['opaque', 'cutout', 'translucent']) {
      const m = mesh[k];
      if (m) transfer.push(m.pos.buffer, m.uvl.buffer, m.lit.buffer, m.index.buffer);
    }
    self.postMessage({ id: msg.id, mesh }, transfer);
  } else if (msg.type === 'column') {
    const key = `${msg.seed}|${msg.worldType}`;
    if (key !== genKey) { gen = new Generator(msg.seed, { type: msg.worldType }); genKey = key; }
    self.postMessage({ id: msg.id, column: gen.column(msg.x, msg.z) });
  }
};
