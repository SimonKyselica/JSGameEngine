import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Workspace packages are resolved to their sources, so tests never need a build first. */
export const workspaceAliases = [
  { find: '@rowan/core/compiler', replacement: resolvePath('./packages/core/src/compiler.ts') },
  { find: '@rowan/core', replacement: resolvePath('./packages/core/src/index.ts') },
  { find: '@rowan/runtime', replacement: resolvePath('./packages/runtime/src/index.ts') },
  { find: '@rowan/feature-test', replacement: resolvePath('./packages/feature-test/src/index.ts') },
];

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      reporter: ['text-summary', 'html'],
    },
  },
});
