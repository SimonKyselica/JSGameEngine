import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Builds the distributable library. Dependencies stay external so consumers can dedupe them.
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: {
        'rowan-core': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        'rowan-compiler': fileURLToPath(new URL('./src/compiler.ts', import.meta.url)),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['planck', 'sucrase'],
    },
  },
});
