/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the export works from an IPFS gateway subpath or an ENS
// name without server rewrites. The export lands at the repository-root dist/.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    modulePreload: { polyfill: false },
    // viem ships as one chunk; the export is far below the 8 MiB per-file limit.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
