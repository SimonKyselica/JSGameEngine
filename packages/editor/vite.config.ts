import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { workspaceAliases } from '../../vitest.config.ts';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: workspaceAliases },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The entry chunk carries the engine, the physics library and React. The code editor
    // and the feature-test project are already split off and loaded on demand.
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
