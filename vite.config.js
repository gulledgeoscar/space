import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) without hardcoding the repo name.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // Two games: MERIDIAN at the root and the LIMITLESS sandbox at /sandbox/.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        sandbox: resolve(import.meta.dirname, 'sandbox/index.html'),
      },
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
  server: { host: true },
});
