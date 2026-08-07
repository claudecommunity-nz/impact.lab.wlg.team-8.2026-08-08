import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` so a GitHub Pages subpath deploy does not break every fetch.
// All data URLs must go through src/data/dataUrl.ts, never a bare '/data/...'.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: true },
});
