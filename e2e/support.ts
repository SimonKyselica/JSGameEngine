import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve } from 'node:path';
import type { FeatureTestReport } from '@rowan/feature-test';

/** Opens the editor and waits until the starter project is on screen. */
export async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Entities' })).toBeVisible();
}

/** Chooses an item from the main menu, for example `chooseMenu(page, 'File', 'Save')`. */
export async function chooseMenu(page: Page, menu: string, item: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main menu' })
    .getByRole('button', { name: menu })
    .click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

export function hierarchyRow(page: Page, name: string): Locator {
  return page
    .getByRole('tree', { name: 'Entities' })
    .locator('.tree-row')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first();
}

/** The value of a number field in the inspector, found by its accessible name. */
export async function readNumber(page: Page, name: string): Promise<number> {
  const field = page.getByRole('region', { name: 'Inspector' }).getByRole('spinbutton', { name });
  return Number(await field.inputValue());
}

/**
 * Reads one pixel of the WebGL canvas. The read happens inside an animation frame,
 * right after the editor has drawn, because the drawing buffer is cleared once the
 * browser has presented it.
 *
 * @param x Horizontal position from 0 (left) to 1 (right).
 * @param y Vertical position from 0 (top) to 1 (bottom).
 */
export async function readCanvasPixel(
  page: Page,
  selector: string,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  return page.evaluate(
    ({ selector, x, y }) =>
      new Promise<[number, number, number]>((resolve, reject) => {
        requestAnimationFrame(() => {
          const source = document.querySelector<HTMLCanvasElement>(selector);
          const copy = document.createElement('canvas');
          const context = copy.getContext('2d');
          if (!source || !context) {
            reject(new Error(`No canvas matches ${selector}`));
            return;
          }
          copy.width = source.width;
          copy.height = source.height;
          context.drawImage(source, 0, 0);
          const pixel = context.getImageData(
            Math.floor(x * (source.width - 1)),
            Math.floor(y * (source.height - 1)),
            1,
            1,
          ).data;
          resolve([pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0]);
        });
      }),
    { selector, x, y },
  );
}

/**
 * Counts the pixels of the WebGL canvas that have a color, give or take `tolerance` per
 * channel. Like {@link readCanvasPixel}, it reads inside an animation frame.
 */
export async function countCanvasPixels(
  page: Page,
  selector: string,
  color: readonly [red: number, green: number, blue: number],
  tolerance: number,
): Promise<number> {
  return page.evaluate(
    ({ selector, color, tolerance }) =>
      new Promise<number>((resolve, reject) => {
        requestAnimationFrame(() => {
          const source = document.querySelector<HTMLCanvasElement>(selector);
          const copy = document.createElement('canvas');
          const context = copy.getContext('2d');
          if (!source || !context || source.width === 0 || source.height === 0) {
            reject(new Error(`No canvas with a picture matches ${selector}`));
            return;
          }
          copy.width = source.width;
          copy.height = source.height;
          context.drawImage(source, 0, 0);
          const { data } = context.getImageData(0, 0, copy.width, copy.height);
          let count = 0;
          for (let offset = 0; offset < data.length; offset += 4) {
            if (
              Math.abs(data[offset]! - color[0]) <= tolerance &&
              Math.abs(data[offset + 1]! - color[1]) <= tolerance &&
              Math.abs(data[offset + 2]! - color[2]) <= tolerance
            ) {
              count++;
            }
          }
          resolve(count);
        });
      }),
    { selector, color, tolerance },
  );
}

/** Waits until the running feature test has passed the named check. */
async function waitForCheck(page: Page, name: string): Promise<void> {
  await page.waitForFunction(
    (checkName) => {
      const report = (window as unknown as Record<string, FeatureTestReport | undefined>)
        .__ROWAN_FEATURE_TEST__;
      return report?.checks.some((check) => check.name === checkName && check.passed) ?? false;
    },
    name,
    { timeout: 10_000 },
  );
}

/**
 * Provides the keyboard and mouse input the feature test's InputProbe waits for.
 *
 * Keys and buttons are held until the game has seen them, rather than for a fixed time,
 * so the test does not depend on how fast the machine renders frames.
 */
export async function playFeatureTestInput(page: Page, canvas: Locator): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error('The game canvas is not visible');
  }
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);

  for (const key of ['Space', 'KeyD', 'KeyW']) {
    await page.keyboard.down(key);
  }
  await waitForCheck(page, 'Input.isKeyDown');
  await waitForCheck(page, 'Input.getAxis horizontal');
  await waitForCheck(page, 'Input.getAxis vertical');
  for (const key of ['Space', 'KeyD', 'KeyW']) {
    await page.keyboard.up(key);
  }
  await waitForCheck(page, 'Input.wasKeyReleased');

  await page.mouse.down({ button: 'left' });
  await waitForCheck(page, 'Input.isMouseButtonDown');
  await page.mouse.up({ button: 'left' });
  for (const button of ['middle', 'right'] as const) {
    await page.mouse.down({ button });
    await waitForCheck(page, `Input.wasMouseButtonPressed ${button}`);
    await page.mouse.up({ button });
  }
  await page.mouse.wheel(0, 120);

  // The pointer has been on the button that UiProbe sits on, and clicked it. Moving it
  // away is the last thing that probe waits for.
  await waitForCheck(page, 'onClick');
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8);
  await waitForCheck(page, 'onPointerExit, after the other pointer callbacks in their order');
}

/** Waits for the feature test running in the page to finish and returns its report. */
export async function waitForFeatureTestReport(page: Page): Promise<FeatureTestReport> {
  await page.waitForFunction(
    () => (window as unknown as Record<string, { done?: boolean }>).__ROWAN_FEATURE_TEST__?.done,
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown>).__ROWAN_FEATURE_TEST__ as FeatureTestReport,
  );
}

/** Fails with the names of the failed checks, which is far more useful than a count. */
export function expectAllChecksPassed(report: FeatureTestReport): void {
  expect(report.checks.filter((check) => !check.passed)).toEqual([]);
  expect(report.pending).toEqual([]);
  expect(report.checks.length).toBeGreaterThan(150);
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wav': 'audio/wav',
};

/** Serves a folder over HTTP on a free port, the way a static web host would. */
export async function serveDirectory(
  root: string,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const filePath = resolve(
      root,
      `.${requested.endsWith('/') ? `${requested}index.html` : requested}`,
    );
    // Never serve anything outside the folder.
    if (!filePath.startsWith(resolve(root))) {
      response.writeHead(403).end();
      return;
    }
    readFile(filePath).then(
      (content) => {
        response
          .writeHead(200, {
            'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
          })
          .end(content);
      },
      () => response.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
      }),
  };
}
