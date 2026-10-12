import { expect, test } from '@playwright/test';
import { encodePng } from '../packages/core/src/assets/png';
import { chooseMenu, hierarchyRow, openEditor, readCanvasPixel, readNumber } from './support';

const GL_CANVAS = 'canvas.viewport-canvas';

test.describe('editor', () => {
  test('opens the starter project with its scene, assets and no errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openEditor(page);

    for (const name of ['Main Camera', 'Ground', 'Player', 'Crate']) {
      await expect(hierarchyRow(page, name)).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Project' })).toContainText(
      'PlayerController.ts',
    );
    await expect(page.getByText('Select an entity or an asset')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('draws the scene with WebGL', async ({ page }) => {
    await openEditor(page);
    // The scene view looks at the origin, where the blue player sprite sits.
    // The player's color is (0.3, 0.6, 1.0); rounding may differ by one between GPUs.
    await expect
      .poll(async () => {
        const [red, green, blue] = await readCanvasPixel(page, GL_CANVAS, 0.5, 0.5);
        return Math.abs(red - 77) <= 2 && Math.abs(green - 153) <= 2 && blue >= 253;
      })
      .toBe(true);
    // Away from any sprite the scene view shows its dark background.
    const background = await readCanvasPixel(page, GL_CANVAS, 0.05, 0.05);
    expect(Math.max(...background)).toBeLessThan(60);
  });

  test('edits an entity in the inspector with undo and redo', async ({ page }) => {
    await openEditor(page);
    await hierarchyRow(page, 'Player').click();
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await expect(inspector.getByRole('textbox', { name: 'Name' })).toHaveValue('Player');

    const positionX = inspector.getByRole('spinbutton', { name: 'Position X' });
    await positionX.fill('3.5');
    await positionX.blur();
    expect(await readNumber(page, 'Position X')).toBe(3.5);
    await expect(page.getByRole('button', { name: 'Save*' })).toBeVisible();

    await chooseMenu(page, 'Edit', 'Undo');
    expect(await readNumber(page, 'Position X')).toBe(0);
    await chooseMenu(page, 'Edit', 'Redo');
    expect(await readNumber(page, 'Position X')).toBe(3.5);
  });

  test('creates, renames, duplicates and deletes entities', async ({ page }) => {
    await openEditor(page);
    await chooseMenu(page, 'Entity', 'Sprite');
    await expect(hierarchyRow(page, 'Sprite')).toHaveClass(/selected/);

    const name = page.getByRole('region', { name: 'Inspector' }).getByRole('textbox', {
      name: 'Name',
    });
    await name.fill('Hero');
    await name.blur();
    await expect(hierarchyRow(page, 'Hero')).toBeVisible();

    await chooseMenu(page, 'Edit', 'Duplicate');
    await expect(hierarchyRow(page, 'Hero (1)')).toHaveClass(/selected/);

    await chooseMenu(page, 'Edit', 'Delete');
    await expect(hierarchyRow(page, 'Hero (1)')).toHaveCount(0);
    await expect(hierarchyRow(page, 'Hero')).toBeVisible();
  });

  test('walks the hierarchy with the arrow keys and closes dialogs with Escape', async ({
    page,
  }) => {
    await openEditor(page);
    await hierarchyRow(page, 'Main Camera').click();
    await page.keyboard.press('ArrowDown');
    await expect(hierarchyRow(page, 'Ground')).toHaveClass(/selected/);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(hierarchyRow(page, 'Main Camera')).toHaveClass(/selected/);

    await chooseMenu(page, 'File', 'Project Settings…');
    const dialog = page.getByRole('dialog', { name: 'Project Settings' });
    await expect(dialog).toBeVisible();
    // With a dialog open, Delete must not reach the selected entity behind it.
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(hierarchyRow(page, 'Main Camera')).toBeVisible();
  });

  test('cuts, copies and pastes entities with the keyboard and the menu', async ({ page }) => {
    await openEditor(page);
    await hierarchyRow(page, 'Player').click();
    await page.keyboard.press('ControlOrMeta+C');
    await page.keyboard.press('ControlOrMeta+V');
    await expect(hierarchyRow(page, 'Player (1)')).toHaveClass(/selected/);
    await expect(
      page.getByRole('region', { name: 'Inspector' }).getByRole('button', {
        name: 'Rigidbody 2D',
        exact: true,
      }),
    ).toBeVisible();

    await page.keyboard.press('ControlOrMeta+X');
    await expect(hierarchyRow(page, 'Player (1)')).toHaveCount(0);
    await chooseMenu(page, 'Edit', 'Paste');
    await expect(hierarchyRow(page, 'Player (1)')).toHaveClass(/selected/);

    await chooseMenu(page, 'Edit', 'Undo');
    await expect(hierarchyRow(page, 'Player (1)')).toHaveCount(0);
  });

  test('filters the hierarchy with the search box', async ({ page }) => {
    await openEditor(page);
    const search = page.getByRole('searchbox', { name: 'Search entities' });
    const rows = page.getByRole('tree', { name: 'Entities' }).locator('.tree-row');
    await expect(rows).toHaveCount(6);

    await search.fill('crate');
    await expect(rows).toHaveCount(3);
    await expect(hierarchyRow(page, 'Ground')).toHaveCount(0);

    // Arrow keys in the search field move through the results.
    await search.press('ArrowDown');
    await expect(rows.first()).toHaveClass(/selected/);

    await search.fill('nothing like this');
    await expect(page.getByText('No entity matches the search.')).toBeVisible();

    await search.press('Escape');
    await expect(search).toHaveValue('');
    await expect(rows).toHaveCount(6);
  });

  test('adds and removes components', async ({ page }) => {
    await openEditor(page);
    await hierarchyRow(page, 'Ground').click();
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await expect(
      inspector.getByRole('button', { name: 'Box Collider 2D', exact: true }),
    ).toBeVisible();

    await inspector.getByRole('button', { name: 'Add Component' }).click();
    await page.getByRole('menuitem', { name: 'Rigidbody 2D' }).click();
    await expect(inspector.getByRole('combobox').filter({ hasText: 'Dynamic' })).toBeVisible();

    await inspector.getByRole('button', { name: 'Remove Rigidbody 2D' }).click();
    await expect(inspector.getByRole('button', { name: 'Rigidbody 2D', exact: true })).toHaveCount(
      0,
    );
  });

  test('selects an entity by clicking it in the scene view and moves it with the gizmo', async ({
    page,
  }) => {
    await openEditor(page);
    const scene = page.getByLabel('Scene view');
    const box = (await scene.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // The player sprite is at the world origin, which is the middle of the scene view.
    await page.mouse.click(centerX, centerY);
    await expect(hierarchyRow(page, 'Player')).toHaveClass(/selected/);

    // Drag the gizmo's X arrow, which extends to the right of the entity.
    await page.mouse.move(centerX + 50, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 150, centerY + 40, { steps: 5 });
    await page.mouse.up();
    expect(await readNumber(page, 'Position X')).toBeGreaterThan(0.5);
    expect(await readNumber(page, 'Position Y')).toBe(0);

    await chooseMenu(page, 'Edit', 'Undo');
    expect(await readNumber(page, 'Position X')).toBe(0);

    // Clicking empty space clears the selection.
    await page.mouse.click(box.x + 20, box.y + 20);
    await expect(page.getByText('Select an entity or an asset')).toBeVisible();
  });

  test('plays the scene, simulates physics, and restores the scene on stop', async ({ page }) => {
    await openEditor(page);
    await hierarchyRow(page, 'Player').click();
    expect(await readNumber(page, 'Position Y')).toBe(0);

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Game' })).toHaveAttribute('aria-selected', 'true');
    // Gravity pulls the player down onto the ground, whose top is at y = -2.5.
    await expect.poll(async () => readNumber(page, 'Position Y')).toBeCloseTo(-2, 1);

    // The script moves the player while D is held.
    await page.getByLabel('Game view').click();
    await page.keyboard.down('KeyD');
    await expect.poll(async () => readNumber(page, 'Position X')).toBeGreaterThan(0.5);
    await page.keyboard.up('KeyD');

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    expect(await readNumber(page, 'Position X')).toBe(0);
    expect(await readNumber(page, 'Position Y')).toBe(0);
  });

  test('pauses and steps the game one frame at a time', async ({ page }) => {
    await openEditor(page);
    await hierarchyRow(page, 'Player').click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const paused = await readNumber(page, 'Position Y');
    await page.waitForTimeout(300);
    expect(await readNumber(page, 'Position Y')).toBe(paused);

    if (paused > -1.9) {
      await page.getByRole('button', { name: 'Step one frame' }).click();
      expect(await readNumber(page, 'Position Y')).toBeLessThan(paused);
    }
  });

  test('reports script errors in the console without stopping the game', async ({ page }) => {
    await openEditor(page);
    await chooseMenu(page, 'Assets', 'New Script…');
    await page.getByRole('dialog').getByRole('textbox').fill('Broken');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // Replace the template with a script that throws in its first update.
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(
      `import { Behaviour } from 'rowan';\n` +
        `export default class Broken extends Behaviour {\n` +
        `  onStart() { this.log('hello from a script'); }\n` +
        `  onUpdate() { throw new Error('deliberate failure'); }\n}\n`,
    );
    await expect(page.getByText('No syntax errors')).toBeVisible();

    await page.getByRole('tab', { name: 'Scene' }).click();
    await hierarchyRow(page, 'Ground').click();
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await inspector.getByRole('button', { name: 'Add Component' }).click();
    await page.getByRole('menuitem', { name: 'Script', exact: true }).click();
    await inspector.getByRole('button', { name: 'Add Script' }).click();
    await page.getByRole('menuitem', { name: 'Broken.ts' }).click();

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('tab', { name: /Console/ }).click();
    const log = page.getByRole('log');
    await expect(log).toContainText('hello from a script');
    await expect(log).toContainText('onUpdate failed on "Ground": deliberate failure');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  });

  test('gives the keyboard to the game when Play starts while a script is being edited', async ({
    page,
  }) => {
    await openEditor(page);
    await page
      .getByRole('region', { name: 'Project' })
      .getByRole('button', { name: 'PlayerController.ts' })
      .dblclick();
    const code = page.locator('.cm-content');
    await expect(code).toBeVisible();
    await hierarchyRow(page, 'Player').click();

    // Leave the caret in the script, then start the game from the keyboard.
    await code.click();
    const source = await code.innerText();
    await page.keyboard.press('ControlOrMeta+P');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();

    // The game must receive the keys: the script moves the player while D is held.
    await page.keyboard.down('KeyD');
    await expect.poll(async () => readNumber(page, 'Position X')).toBeGreaterThan(0.5);
    await page.keyboard.up('KeyD');
    await page.keyboard.press('KeyA');
    await page.keyboard.press('KeyD');

    // And none of them may end up as text in the script.
    await page.keyboard.press('ControlOrMeta+P');
    await page.getByRole('tab', { name: 'PlayerController.ts' }).click();
    expect(await code.innerText()).toBe(source);
  });

  test('saves the project and restores it after a reload', async ({ page }) => {
    await openEditor(page);
    await chooseMenu(page, 'Entity', 'Camera');
    await hierarchyRow(page, 'Camera').dblclick();
    const rename = page.getByRole('textbox', { name: 'Entity name' });
    await rename.fill('Second Camera');
    await rename.press('Enter');
    await expect(page.getByRole('button', { name: 'Save*' })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();

    await page.reload();
    await expect(hierarchyRow(page, 'Second Camera')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
  });

  test('imports an image and shows it as a sprite', async ({ page }) => {
    await openEditor(page);
    // A 2x2 opaque red image.
    const pixels = new Uint8Array(16);
    for (let offset = 0; offset < pixels.length; offset += 4) {
      pixels.set([255, 0, 0, 255], offset);
    }
    const png = Buffer.from(encodePng(2, 2, pixels));
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      chooseMenu(page, 'Assets', 'Import Files…'),
    ]);
    await chooser.setFiles({ name: 'red.png', mimeType: 'image/png', buffer: png });

    const project = page.getByRole('region', { name: 'Project' });
    await project.getByRole('button', { name: 'red.png' }).dblclick();
    await expect(hierarchyRow(page, 'red')).toHaveClass(/selected/);
    await expect(
      page.getByRole('region', { name: 'Inspector' }).getByRole('button', {
        name: 'Sprite Renderer',
        exact: true,
      }),
    ).toBeVisible();
  });
});
