import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { workspaceAliases } from '../../vitest.config.ts';

// Builds the player as one self-contained script that exported games include.
export default defineConfig({
  resolve: { alias: workspaceAliases },
  build: {
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/player.ts', import.meta.url)),
      name: 'RowanPlayer',
      formats: ['iife'],
      fileName: () => 'rowan-player.js',
    },
  },
});
