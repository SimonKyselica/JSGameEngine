import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
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
    rolldownOptions: {
      // Two pages: the editor, and the scripting documentation it opens from the Help menu.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        docs: fileURLToPath(new URL('./docs.html', import.meta.url)),
      },
    },
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
