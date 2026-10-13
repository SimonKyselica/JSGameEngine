import { expect, test } from '@playwright/test';
import { encodePng } from '../packages/core/src/assets/png';
import {
  chooseMenu,
  countCanvasPixels,
  hierarchyRow,
  openEditor,
  readCanvasPixel,
  readNumber,
} from './support';

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

  test('sets up the clips of a sprite animator in the inspector', async ({ page }) => {
    await openEditor(page);
    await hierarchyRow(page, 'Player').click();
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await inspector.getByRole('button', { name: 'Add Component' }).click();
    await page.getByRole('menuitem', { name: 'Sprite Animator' }).click();

    const addClip = inspector.getByRole('button', { name: 'Add Clip' });
    const playing = inspector.getByRole('textbox', { name: 'Clip', exact: true });
    await addClip.click();
    const first = inspector.getByRole('group', { name: 'Clip 1' });
    await expect(first.getByRole('textbox', { name: 'Clip name' })).toHaveValue('clip');
    // The first clip of an animator is the one that plays.
    await expect(playing).toHaveValue('clip');

    // Renaming the clip that plays keeps it playing.
    await first.getByRole('textbox', { name: 'Clip name' }).fill('walk');
    await expect(playing).toHaveValue('walk');
    const lastFrame = first.getByRole('spinbutton', { name: 'Last frame' });
    await lastFrame.fill('3');
    await lastFrame.blur();

    // The next clip starts where this one ends, as the rows of a sprite sheet do.
    await addClip.click();
    const second = inspector.getByRole('group', { name: 'Clip 2' });
    await expect(second.getByRole('spinbutton', { name: 'First frame' })).toHaveValue('4');
    await expect(second.getByRole('checkbox', { name: 'Loop' })).toBeChecked();

    await second.getByRole('button', { name: 'Remove clip' }).click();
    await expect(inspector.getByRole('group', { name: /^Clip \d/ })).toHaveCount(1);
    await chooseMenu(page, 'Edit', 'Undo');
    await expect(inspector.getByRole('group', { name: /^Clip \d/ })).toHaveCount(2);
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

  test('writes text into the scene, edits it in the inspector and picks it by clicking', async ({
    page,
  }) => {
    await openEditor(page);
    // Nothing in the starter scene is white, so white pixels are the text. Its letters cover
    // thousands of pixels; this is far above what anything but drawn text could reach.
    const MIN_TEXT_PIXELS = 500;
    const whitePixels = (): Promise<number> =>
      countCanvasPixels(page, GL_CANVAS, [255, 255, 255], 30);
    expect(await whitePixels()).toBe(0);

    await chooseMenu(page, 'Entity', 'Text');
    await expect(hierarchyRow(page, 'Text')).toHaveClass(/selected/);
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await expect(inspector.getByText('Text Renderer')).toBeVisible();

    // A new text says "Text" and is hidden behind the player sprite in the middle of the
    // scene. Two lines at twice the size reach far beyond the sprite.
    const text = inspector.getByRole('textbox', { name: 'Text', exact: true });
    await expect(text).toHaveValue('Text');
    await text.fill('Score: 1500\nLives: 3');
    const fontSize = inspector.getByRole('spinbutton', { name: 'Font Size' });
    await fontSize.fill('1');
    await fontSize.blur();
    await expect.poll(whitePixels).toBeGreaterThan(MIN_TEXT_PIXELS);

    // The text is wider than the player sprite in front of it, so a click to the left of
    // the sprite lands on the text.
    const scene = page.getByLabel('Scene view');
    const box = (await scene.boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + 20);
    await expect(page.getByText('Select an entity or an asset')).toBeVisible();
    await page.mouse.click(box.x + box.width / 2 - 60, box.y + box.height / 2);
    await expect(hierarchyRow(page, 'Text')).toHaveClass(/selected/);

    await inspector.getByRole('checkbox', { name: 'Visible' }).uncheck();
    await expect.poll(whitePixels).toBe(0);
    await chooseMenu(page, 'Edit', 'Undo');
    await expect.poll(whitePixels).toBeGreaterThan(MIN_TEXT_PIXELS);

    // The game draws it too, through the scene's camera.
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect.poll(whitePixels).toBeGreaterThan(MIN_TEXT_PIXELS);
  });

  test('puts a button on the screen that reacts to the pointer while the game runs', async ({
    page,
  }) => {
    await openEditor(page);
    await chooseMenu(page, 'Entity', 'Button');
    await expect(hierarchyRow(page, 'Button')).toHaveClass(/selected/);
    await expect(hierarchyRow(page, 'Background')).toBeVisible();
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await expect(inspector.getByText('Screen Anchor')).toBeVisible();
    await expect(inspector.getByRole('spinbutton', { name: 'Size X' })).toHaveValue('220');

    // The background of a new button, and what its default tints make of that color.
    const LOOKS = {
      normal: [51, 115, 217],
      hovered: [43, 98, 184],
      pressed: [33, 75, 141],
    } as const;
    /**
     * Which of the three colors the button is drawn in. The smoothed pixels along its edge
     * can match a darker tint by chance, so a look only counts when it covers the button:
     * well over a thousand pixels, and several times more than the other two.
     */
    const look = async (): Promise<string> => {
      const counts = await Promise.all(
        Object.entries(LOOKS).map(async ([name, color]) => ({
          name,
          pixels: await countCanvasPixels(page, GL_CANVAS, color, 10),
        })),
      );
      counts.sort((a, b) => b.pixels - a.pixels);
      const [first, second] = counts;
      return first!.pixels > 1000 && first!.pixels > second!.pixels * 4 ? first!.name : 'none';
    };

    // The scene view shows the button inside the camera's frame, as the game will.
    await expect.poll(look).toBe('normal');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect.poll(look).toBe('normal');

    // The button is anchored to the middle of the screen, which is the middle of the view.
    const game = page.getByLabel('Game view');
    const box = (await game.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 5);
    await expect.poll(look).toBe('hovered');

    await page.mouse.down();
    await expect.poll(look).toBe('pressed');
    await page.mouse.up();
    await expect.poll(look).toBe('hovered');

    await page.mouse.move(box.x + 10, box.y + 10);
    await expect.poll(look).toBe('normal');
  });

  test('snaps gizmo drags in snap mode and remembers the mode', async ({ page }) => {
    await openEditor(page);
    const snap = page.getByRole('button', { name: 'Snap', exact: true });
    await expect(snap).toHaveAttribute('aria-pressed', 'false');
    await snap.click();
    await expect(snap).toHaveAttribute('aria-pressed', 'true');

    const scene = page.getByLabel('Scene view');
    const box = (await scene.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    // The scene view shows 12 world units from top to bottom.
    const pixelsPerUnit = box.height / 12;
    const isOnGrid = (value: number): boolean => Math.abs(value * 4 - Math.round(value * 4)) < 1e-6;

    // Select the player at the origin and drag its X arrow by an odd distance.
    await page.mouse.click(centerX, centerY);
    await page.mouse.move(centerX + 50, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 187, centerY, { steps: 5 });
    await page.mouse.up();
    const snapped = await readNumber(page, 'Position X');
    expect(snapped).toBeGreaterThan(1);
    expect(isOnGrid(snapped)).toBe(true);

    // In snap mode the modifier key does the opposite: the drag moves freely.
    const arrowX = centerX + snapped * pixelsPerUnit + 50;
    await page.mouse.move(arrowX, centerY);
    await page.mouse.down();
    await page.keyboard.down('Control');
    await page.mouse.move(arrowX + 91, centerY, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Control');
    const free = await readNumber(page, 'Position X');
    expect(free).toBeGreaterThan(snapped);
    expect(isOnGrid(free)).toBe(false);

    // The mode is an editor preference and survives a reload.
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Snap', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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

  test('lets an entity fall through a layer that the project tells it to ignore', async ({
    page,
  }) => {
    await openEditor(page);
    await chooseMenu(page, 'File', 'Project Settings…');
    const dialog = page.getByRole('dialog', { name: 'Project Settings' });
    const addLayer = dialog.getByRole('button', { name: 'Add Layer' });
    await expect(addLayer).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'New layer name' }).fill('Ghost');
    await addLayer.click();

    const pair = dialog.getByRole('checkbox', { name: 'Default collides with Ghost' });
    await expect(pair).toBeChecked();
    await pair.uncheck();
    await expect(dialog.getByRole('checkbox', { name: 'Ghost collides with Ghost' })).toBeChecked();
    // The default layer cannot be removed; the new one can.
    await expect(dialog.getByRole('button', { name: 'Remove layer Default' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Remove layer Ghost' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    await hierarchyRow(page, 'Player').click();
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await inspector.getByRole('combobox', { name: 'Layer' }).selectOption('Ghost');

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    // The ground is on the default layer and its top is at y = -2.5. The player used to
    // come to rest on it at y = -2; as a ghost it keeps falling.
    await expect.poll(async () => readNumber(page, 'Position Y')).toBeLessThan(-6);
  });

  test('clears what the game has saved in the browser', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      // What a game of some project would have left behind, and something that is not a save.
      localStorage.setItem('rowan.save.another-project', '{"coins":9}');
      localStorage.setItem('unrelated', 'stays');
    });
    const savesOfThisProject = (): Promise<number> =>
      page.evaluate(
        () =>
          Object.keys(localStorage).filter(
            (key) => key.startsWith('rowan.save.') && key !== 'rowan.save.another-project',
          ).length,
      );

    // Playing the feature test saves something for the project that is open.
    await chooseMenu(page, 'Help', 'Open Feature Test Project');
    await expect(hierarchyRow(page, 'Harness')).toBeVisible();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect.poll(savesOfThisProject).toBe(1);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();

    await chooseMenu(page, 'File', 'Clear Saved Game Data');
    expect(await savesOfThisProject()).toBe(0);
    // Only the saves of this project are gone.
    expect(await page.evaluate(() => localStorage.getItem('rowan.save.another-project'))).toBe(
      '{"coins":9}',
    );
    expect(await page.evaluate(() => localStorage.getItem('unrelated'))).toBe('stays');
    await page.getByRole('tab', { name: /Console/ }).click();
    await expect(page.getByRole('log')).toContainText('Saved game data cleared.');
  });

  test('paints a level with tiles, and takes a stroke back with undo', async ({ page }) => {
    await openEditor(page);
    await chooseMenu(page, 'Entity', 'Tilemap');
    await expect(hierarchyRow(page, 'Tilemap')).toHaveClass(/selected/);
    const inspector = page.getByRole('region', { name: 'Inspector' });
    const palette = inspector.getByRole('radiogroup', { name: 'Tile to paint with' });
    // The eraser and the four tiles of the tileset a new map comes with.
    await expect(palette.getByRole('radio')).toHaveCount(5);

    // Picking a tile takes up the brush.
    await palette.getByRole('radio', { name: 'Tile 3' }).click();
    await expect(page.getByRole('button', { name: /Paint Tiles/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Tile 3 is water, a blue of its own; tile 0, the floor of a new map, is about as green
    // as the ground of the starter scene. A stroke of tiles covers several thousand pixels.
    // The smoothed edge of the blue player sprite can match the water by chance, but that is
    // a few hundred pixels at most, so the two are told apart by how many there are.
    const water = (): Promise<number> => countCanvasPixels(page, GL_CANVAS, [64, 132, 214], 12);
    const grass = (): Promise<number> => countCanvasPixels(page, GL_CANVAS, [86, 168, 92], 12);
    const PAINTED = 3000;
    const NOT_PAINTED = 1000;
    expect(await water()).toBeLessThan(NOT_PAINTED);
    await expect.poll(grass).toBeGreaterThan(PAINTED);

    const scene = page.getByLabel('Scene view');
    const box = (await scene.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const y = box.y + box.height / 2 - 60;
    await page.mouse.move(centerX - 80, y);
    await page.mouse.down();
    await page.mouse.move(centerX + 80, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(water).toBeGreaterThan(PAINTED);

    // The whole stroke is one step.
    await chooseMenu(page, 'Edit', 'Undo');
    await expect.poll(water).toBeLessThan(NOT_PAINTED);
    await chooseMenu(page, 'Edit', 'Redo');
    await expect.poll(water).toBeGreaterThan(PAINTED);

    // The eraser takes tiles away again.
    await palette.getByRole('radio', { name: 'Eraser' }).click();
    await page.mouse.move(centerX - 90, y);
    await page.mouse.down();
    await page.mouse.move(centerX + 90, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(water).toBeLessThan(NOT_PAINTED);

    // A map that is made narrower loses the floor beyond its new edge. The ground of the
    // scene is as green as the floor and stays, so the green shrinks without disappearing.
    const before = await grass();
    const width = inspector.getByRole('spinbutton', { name: 'Map width' });
    const resize = inspector.getByRole('button', { name: 'Resize' });
    await expect(resize).toBeDisabled();
    await width.fill('6');
    await resize.click();
    await expect.poll(grass).toBeLessThan(before * 0.8);
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
