import { expect, test, type Page } from '@playwright/test';
import { chooseMenu, openEditor } from './support';

/** Opens the documentation at an address such as `#/api/Vec2` and waits for the page. */
async function openDocs(page: Page, hash = ''): Promise<void> {
  await page.goto(`/docs.html${hash}`);
  await expect(page.getByRole('navigation', { name: 'Documentation' })).toBeVisible();
}

test.describe('scripting documentation', () => {
  test('opens in a new tab from the Help menu and with F1', async ({ page, context }) => {
    await openEditor(page);

    const [fromMenu] = await Promise.all([
      context.waitForEvent('page'),
      chooseMenu(page, 'Help', 'Scripting Reference'),
    ]);
    await expect(fromMenu.getByRole('heading', { level: 1 })).toHaveText('Getting started');
    await expect(fromMenu).toHaveTitle('Getting started · Rowan Scripting');
    await fromMenu.close();

    const [fromShortcut] = await Promise.all([
      context.waitForEvent('page'),
      page.keyboard.press('F1'),
    ]);
    await expect(fromShortcut).toHaveURL(/\/docs\.html$/);
    await expect(fromShortcut.getByRole('heading', { level: 1 })).toHaveText('Getting started');
  });

  test('shows a guide with highlighted example code and no errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openDocs(page);

    const article = page.getByRole('article');
    await expect(article.getByRole('heading', { name: 'Your first script' })).toBeVisible();
    const example = article.locator('.docs-code').first();
    await expect(example).toContainText('export default class Spinner extends Behaviour');
    await expect(example.locator('.tok-keyword').first()).toHaveText('import');

    // The outline lists the headings of the page and links to them.
    await page
      .getByRole('navigation', { name: 'On this page' })
      .getByRole('link', { name: 'Working with scripts' })
      .click();
    await expect(page).toHaveURL(/#\/guide\/getting-started\/working-with-scripts$/);
    await expect(article.getByRole('heading', { name: 'Working with scripts' })).toBeInViewport();
    expect(pageErrors).toEqual([]);
  });

  test('navigates from the sidebar to the reference of a type', async ({ page }) => {
    await openDocs(page);
    const sidebar = page.getByRole('navigation', { name: 'Documentation' });
    await sidebar.getByRole('link', { name: 'Behaviour', exact: true }).click();

    await expect(page).toHaveURL(/#\/api\/Behaviour$/);
    await expect(page).toHaveTitle('Behaviour · Rowan Scripting');
    await expect(sidebar.getByRole('link', { name: 'Behaviour', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Behaviour');
    await expect(page.locator('.docs-usage')).toContainText("import { Behaviour } from 'rowan';");

    const after = page.locator('#after');
    await expect(after.locator('.docs-signature')).toHaveText(
      'after(seconds: number, callback: () => void): CancelTimer',
    );
    await expect(after).toContainText('returns a function that cancels it');

    // Types named in the text and in signatures link to their own page.
    await page.getByRole('article').getByRole('link', { name: 'ScriptLifecycle' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ScriptLifecycle');
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Behaviour');

    await after.locator('.docs-signature').getByRole('link', { name: 'CancelTimer' }).click();
    await expect(page).toHaveURL(/#\/api\/CancelTimer$/);
    // The address changes before the page is drawn again, so wait for the new page itself:
    // until then the locator below would still match every signature of the old one.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('CancelTimer');
    await expect(page.locator('.docs-signature')).toHaveText('type CancelTimer = () => void');
  });

  test('opens a link to a member at that member', async ({ page }) => {
    await openDocs(page, '#/api/Physics2D/raycastAll');
    await expect(page.locator('#raycastAll')).toBeInViewport();
    await expect(page.locator('#raycastAll .docs-signature')).toContainText('): RaycastHit[]');
    await expect(
      page.getByRole('navigation', { name: 'On this page' }).getByRole('link', {
        name: 'raycastAll',
        exact: true,
      }),
    ).toHaveAttribute('aria-current', 'location');
    await expect(page.getByText('In a script')).toBeVisible();
    await expect(page.locator('.docs-usage')).toContainText('this.physics');
  });

  test('searches guides and the reference with the keyboard', async ({ page }) => {
    await openDocs(page);
    const search = page.getByRole('combobox', { name: 'Search the documentation' });
    const results = page.getByRole('listbox', { name: 'Search results' });

    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await page.keyboard.type('raycast');
    await expect(results.getByRole('option').first()).toContainText('Physics2D.raycast');
    await expect(results.getByRole('option', { selected: true })).toContainText(
      'Finds the closest solid collider',
    );

    await page.keyboard.press('ArrowDown');
    await expect(results.getByRole('option', { selected: true })).toContainText(
      'Physics2D.raycastAll',
    );
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/api\/Physics2D\/raycastAll$/);
    await expect(page.locator('#raycastAll')).toBeInViewport();
    await expect(results).toBeHidden();
    await expect(search).toHaveValue('');

    await search.fill('no such thing anywhere');
    await expect(results).toContainText('Nothing matches');
    await page.keyboard.press('Escape');
    await expect(results).toBeHidden();

    await search.fill('timers');
    await results.getByRole('option', { name: /^Timers/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Timers');
  });

  test('walks through the pages with the previous and next links', async ({ page }) => {
    await openDocs(page);
    const pager = page.getByRole('navigation', { name: 'Previous and next page' });
    await expect(pager.getByRole('link')).toHaveCount(1);

    await pager.getByRole('link', { name: /Next/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('The script lifecycle');
    await pager.getByRole('link', { name: /Previous/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting started');
  });
});
