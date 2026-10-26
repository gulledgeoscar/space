// World dimensions shared by the main thread and the chunk workers.

export const CHUNK = 16;            // chunk width and depth in blocks
export const HEIGHT = 128;          // world height in blocks
export const SEA_LEVEL = 40;
export const CHUNK_VOLUME = CHUNK * CHUNK * HEIGHT;
export const LAYER = CHUNK * CHUNK;

// y-major layout so a column is a stride of LAYER and a layer is contiguous.
export const index = (x, y, z) => (y * CHUNK + z) * CHUNK + x;

export const chunkKey = (cx, cz) => `${cx},${cz}`;
