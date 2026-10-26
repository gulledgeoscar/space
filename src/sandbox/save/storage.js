// IndexedDB persistence: world list, per-world metadata (player, time,
// inventory, entities) and edited chunks stored run-length encoded.

const DB_NAME = 'limitless-sandbox';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ??= openDb());

function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  }));
}

// Run-length encoding: pairs of (count, value) with counts up to 255.
export function rleEncode(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let n = 1;
    while (i + n < data.length && data[i + n] === v && n < 255) n++;
    out.push(n, v);
    i += n;
  }
  return Uint8Array.from(out);
}

export function rleDecode(enc, length) {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < enc.length; i += 2) {
    out.fill(enc[i + 1], o, o + enc[i]);
    o += enc[i];
  }
  return out;
}

export async function listWorlds() {
  try {
    const all = await tx('worlds', 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  } catch {
    return [];
  }
}

export async function deleteWorld(id) {
  await tx('worlds', 'readwrite', (s) => s.delete(id));
  const d = await db();
  await new Promise((resolve) => {
    const t = d.transaction('chunks', 'readwrite');
    const s = t.objectStore('chunks');
    const range = IDBKeyRange.bound(`${id}|`, `${id}|￿`);
    s.delete(range);
    t.oncomplete = resolve;
    t.onerror = resolve;
  });
}

export class WorldStorage {
  constructor(meta, chunkVolume) {
    this.meta = meta;
    this.id = meta.id;
    this.volume = chunkVolume;
    this.saved = new Set(meta.chunkKeys || []);
    this.writes = Promise.resolve();
  }

  static async open(meta, chunkVolume) {
    const s = new WorldStorage(meta, chunkVolume);
    try {
      const stored = await tx('worlds', 'readonly', (st) => st.get(meta.id));
      if (stored) {
        s.meta = { ...stored, ...meta, created: stored.created };
        s.saved = new Set(stored.chunkKeys || []);
        s.state = stored.state || null;
      }
    } catch { /* storage unavailable: play without saving */ }
    return s;
  }

  has(key) { return this.saved.has(key); }

  loadChunk(key) {
    return tx('chunks', 'readonly', (s) => s.get(`${this.id}|${key}`)).then((enc) => (enc ? rleDecode(enc, this.volume) : null));
  }

  saveChunk(key, data) {
    this.saved.add(key);
    const enc = rleEncode(data);
    this.writes = this.writes.then(() => tx('chunks', 'readwrite', (s) => s.put(enc, `${this.id}|${key}`))).catch(() => {});
    return this.writes;
  }

  saveMeta(state) {
    const record = { ...this.meta, chunkKeys: [...this.saved], state, lastPlayed: Date.now() };
    this.meta = record;
    return tx('worlds', 'readwrite', (s) => s.put(record)).catch(() => {});
  }
}
