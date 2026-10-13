import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  chooseMenu,
  countCanvasPixels,
  expectAllChecksPassed,
  hierarchyRow,
  openEditor,
  playFeatureTestInput,
  readCanvasPixel,
  serveDirectory,
  waitForFeatureTestReport,
} from './support';

/**
 * These tests run the feature-test project, which exercises every component and the
 * whole scripting API, in a real browser: in the editor's play mode and as an exported
 * game. Together they cover what the headless unit test cannot: WebGL, Web Audio, real
 * input events, and the export pipeline.
 */

const MAGENTA = [255, 0, 255] as const;
const CYAN = [0, 255, 255] as const;
/** A word in large bold letters covers thousands of pixels; a failed text covers none. */
const MIN_TEXT_PIXELS = 300;

async function openFeatureTestProject(page: Page): Promise<void> {
  await openEditor(page);
  await chooseMenu(page, 'Help', 'Open Feature Test Project');
  await expect(hierarchyRow(page, 'Harness')).toBeVisible();
}

/** Runs the feature test in an exported game page and checks its report and its picture. */
async function expectExportedGameToPass(game: Page): Promise<void> {
  const pageErrors: string[] = [];
  game.on('pageerror', (error) => pageErrors.push(error.message));
  const consoleErrors: string[] = [];
  game.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const canvas = game.locator('canvas');
  await expect(canvas).toBeVisible();
  await playFeatureTestInput(game, canvas);
  expectAllChecksPassed(await waitForFeatureTestReport(game));

  // The Finish scene shows a green disc in the middle of a dark green background.
  const [red, green, blue] = await readCanvasPixel(game, 'canvas', 0.5, 0.5);
  expect(green).toBeGreaterThan(200);
  expect(red).toBeLessThan(150);
  expect(blue).toBeLessThan(180);
  const corner = await readCanvasPixel(game, 'canvas', 0.02, 0.02);
  expect(Math.max(...corner)).toBeLessThan(90);
  // Above the disc the scene says "Finished" in magenta, a color nothing else in it has.
  expect(await countCanvasPixels(game, 'canvas', MAGENTA, 40)).toBeGreaterThan(MIN_TEXT_PIXELS);
  // Beside the disc a sprite shows the last frame of a sheet of eight colors, the cyan one.
  // The frame next to it is magenta, and none of that may show: all magenta is in the text
  // above the disc, so the lower half of the picture has none.
  expect(await countCanvasPixels(game, 'canvas', CYAN, 20)).toBeGreaterThan(MIN_TEXT_PIXELS);

  await expect(game).toHaveTitle('Rowan Feature Test');
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
}

test('the feature-test project passes in the editor', async ({ page }) => {
  await openFeatureTestProject(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

  await playFeatureTestInput(page, page.getByLabel('Game view'));
  expectAllChecksPassed(await waitForFeatureTestReport(page));
  // The report is closed by the Finish scene, whose text is drawn in the frame that follows.
  await expect
    .poll(() => countCanvasPixels(page, 'canvas.viewport-canvas', MAGENTA, 40))
    .toBeGreaterThan(MIN_TEXT_PIXELS);

  await page.getByRole('tab', { name: /Console/ }).click();
  const log = page.getByRole('log');
  await expect(log).toContainText(/Feature test finished: (\d+) of \1 checks passed/);
  await expect(log.locator('.console-entry.error')).toHaveCount(0);
});

test('stopping the feature test before it has finished is not reported as a failure', async ({
  page,
}) => {
  await openFeatureTestProject(page);
  await page.getByRole('tab', { name: /Console/ }).click();
  const log = page.getByRole('log');

  // Twice, because the second run starts from whatever the first one left behind.
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    // The probes report from their first frame; the test as a whole waits for input.
    await page.waitForFunction(
      () =>
        ((window as unknown as Record<string, { checks?: unknown[] }>).__ROWAN_FEATURE_TEST__
          ?.checks?.length ?? 0) > 50,
    );
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    await expect(log).toContainText('The feature test was stopped before it had finished.');
    await expect(log.locator('.console-entry.error')).toHaveCount(0);
    await expect(log.locator('.console-entry.warn')).toHaveCount(0);
  }
});

test('a single-file export runs straight from disk', async ({ page, context }, testInfo) => {
  await openFeatureTestProject(page);
  await chooseMenu(page, 'File', 'Build Game…');
  await page.getByRole('radio', { name: /Single HTML file/ }).check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Build', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('rowan-feature-test.html');
  const htmlPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(htmlPath);

  // The page must be self-contained: no script or asset is loaded from anywhere else.
  const html = await readFile(htmlPath, 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=/);

  const game = await context.newPage();
  await game.goto(pathToFileURL(htmlPath).href);
  await expectExportedGameToPass(game);
});

test('a folder export runs from a static web server', async ({ page, context }, testInfo) => {
  await openFeatureTestProject(page);
  await chooseMenu(page, 'File', 'Build Game…');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Build', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('rowan-feature-test.zip');
  const zipPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(zipPath);

  const entries = unzipSync(new Uint8Array(await readFile(zipPath)));
  const paths = Object.keys(entries);
  expect(paths).toEqual(
    expect.arrayContaining(['index.html', 'rowan-player.js', 'game/game.json', 'game/scripts.js']),
  );
  // Only the game ships: the page, the player, the data, and one file per binary asset.
  expect(paths.filter((path) => !path.startsWith('game/assets/'))).toHaveLength(4);

  const root = testInfo.outputPath('site');
  for (const [path, content] of Object.entries(entries)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const server = await serveDirectory(root);
  try {
    const game = await context.newPage();
    await game.goto(server.url);
    await expectExportedGameToPass(game);
  } finally {
    await server.close();
  }
});
