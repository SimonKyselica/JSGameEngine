---
name: run-editor
description: Launch the Rowan editor or an exported game and look at it, to confirm a change works in the real app and not only in tests. Use when asked to run, start, open, try out or screenshot the editor or a game.
---

# Run the editor and see it working

## Start it

```sh
npm install        # first time only
npm run dev        # builds the player, then serves the editor at http://localhost:5173
```

`npm run dev` serves the sources with hot reload. To run exactly what users get (the minified
build, which is what the browser tests use):

```sh
npm run build
npm run preview    # serves the built editor at http://localhost:4173
```

Both ports are fixed (`strictPort`), so a "port is already in use" error means a server is
already running; reuse it or stop it.

The editor keeps projects in the browser's IndexedDB. A fresh browser profile starts with the
starter project: a camera, a ground, a player that moves with A/D and jumps with Space, and
three crates.

## Drive it without a person

There is no display to click on, so use Playwright, which is already set up. The quickest way to
look at a state is a throwaway spec that takes a screenshot. Name it `e2e/zz-*.spec.ts`, and
delete it when done:

```ts
import { expect, test } from '@playwright/test';
import { chooseMenu, hierarchyRow, openEditor } from './support';

test('look', async ({ page }) => {
  await openEditor(page);
  await hierarchyRow(page, 'Player').click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/look.png' });
});
```

```sh
npm run build && npx playwright test e2e/zz-look.spec.ts
```

Then read `test-results/look.png`. Playwright starts and stops the preview server itself.

Useful helpers in `e2e/support.ts`:

- `openEditor(page)`: loads the editor and waits for the hierarchy.
- `chooseMenu(page, 'File', 'Build Game…')`: picks a main-menu item.
- `hierarchyRow(page, 'Player')`: the row of an entity in the Hierarchy panel.
- `readNumber(page, 'Position X')`: a number shown in the Inspector.
- `readCanvasPixel(page, 'canvas.viewport-canvas', 0.5, 0.5)`: a pixel the engine actually drew.
- `playFeatureTestInput` and `waitForFeatureTestReport`: run the feature-test project.

Panels are reachable by role and name: `getByRole('region', { name: 'Inspector' })`, likewise
`Hierarchy`, `Project` and `Console`; the views are `getByLabel('Scene view')` and
`getByLabel('Game view')`.

## Check an exported game

File → Build Game… downloads either a zip to host or a single HTML file. `e2e/featureTest.spec.ts`
shows both paths end to end: it captures the download, opens the single file from disk, and
serves the unzipped folder with `serveDirectory`.

## What to look for

- The Console panel: script errors and engine warnings appear there, not in the browser console.
- Play, Pause and Step in the toolbar, and that Stop restores the scene exactly.
- After a change to rendering, compare a pixel or a screenshot; do not assume.
