import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

const VIEWPORT = { width: 1440, height: 900 };

const ALL_PROJECTS = [
  {
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      viewport: VIEWPORT,
      launchOptions: {
        // Software rendering makes WebGL2 available on machines without a GPU.
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
      },
    },
  },
  { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: VIEWPORT } },
  { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: VIEWPORT } },
];

/**
 * The browsers to test in: Chromium and WebKit (Safari's engine) by default. Set
 * `E2E_BROWSERS` to a comma-separated list to choose, for example `E2E_BROWSERS=chromium`
 * for a quick run or `E2E_BROWSERS=chromium,webkit,firefox` for all three. Each browser
 * needs `npx playwright install <name>` once.
 */
const requestedBrowsers = (process.env.E2E_BROWSERS ?? 'chromium,webkit')
  .split(',')
  .map((name) => name.trim().toLowerCase());

/**
 * End-to-end tests run the built editor in a real browser, so `npm run build` must have
 * run first; `npm run test:e2e` takes care of that.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Every test gets a fresh browser profile, and with it an empty project store.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: ALL_PROJECTS.filter((project) => requestedBrowsers.includes(project.name)),
  webServer: {
    command: `npm run preview -w @rowan/editor -- --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
