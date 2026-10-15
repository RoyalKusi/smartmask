import { expect, test } from './fixtures';
import { open, waitForData } from './helpers';

const VIEWS = [
  'overview',
  'discovery',
  'review',
  'policy',
  'workbench',
  'verification',
  'audit',
  'performance',
  'anomalies',
] as const;

test.describe('adaptive layout', () => {
  test('compact (<640 px): navigation is an overlay blade and tables become card lists', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'discovery');
    await waitForData(page);
    const blade = page.getByRole('navigation', { name: 'Primary' });
    await expect(blade).not.toBeInViewport();
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(blade).toBeInViewport();
    await blade.getByRole('link', { name: 'Audit Trail' }).click();
    await expect(page).toHaveURL(/#\/audit/);
    await expect(blade).not.toBeInViewport();
    await waitForData(page);
    await expect(page.locator('.sm-rowcard').first()).toBeVisible();
    await expect(page.locator('.sm-thead')).toHaveCount(0);
  });

  test('medium (640 to 1007 px): icon-only rail', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await open(page, 'overview');
    const box = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
    expect(box!.width).toBeLessThan(60);
    await expect(page.getByRole('link', { name: 'Discovery' })).toBeVisible();
  });

  test('large (>=1008 px): expanded 280 px blade, collapses to a 48 px rail and remembers it', async ({
    page,
  }) => {
    await open(page, 'overview');
    expect((await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!.width).toBeGreaterThan(
      270,
    );
    await page.getByRole('button', { name: 'Collapse navigation' }).click();
    await expect
      .poll(async () => (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!.width)
      .toBeLessThan(60);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect((await page.getByRole('navigation', { name: 'Primary' }).boundingBox())!.width).toBeLessThan(60);
  });

  for (const view of VIEWS) {
    test(`${view} never scrolls horizontally at 390 px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, view);
      await waitForData(page);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const main = await page.evaluate(() => {
        const m = document.querySelector('.sm-main') as HTMLElement;
        return m.scrollWidth - m.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
      expect(main).toBeLessThanOrEqual(1);
    });
  }
});

test.describe('keyboard operation', () => {
  test('data table: arrows move, Space selects, Enter opens the drawer, focus returns on close', async ({
    page,
  }) => {
    await open(page, 'discovery');
    await waitForData(page);
    const grid = page.getByRole('grid', { name: 'Discovered columns' });
    await grid.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await expect(page.getByText('1 selected')).toBeVisible();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Details' });
    await expect(drawer).toBeVisible();
    await expect.poll(() => decodeURIComponent(page.url())).toContain('open=column:customers.last_name');
    await drawer.getByRole('tab', { name: 'Lineage' }).click();
    await expect(drawer).toContainText('Scanner');
    await drawer.getByRole('tab', { name: 'History' }).click();
    await expect(drawer).toContainText('SCAN');
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('dialog focus returns to the opener on close', async ({ page }) => {
    await open(page, 'audit');
    await waitForData(page);
    const opener = page.getByRole('button', { name: 'Tamper test…' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  });

  test('columns can be resized by dragging the header handle', async ({ page }) => {
    await open(page, 'discovery');
    await waitForData(page);
    const header = page.getByRole('columnheader').filter({ hasText: 'Family' });
    const before = (await header.boundingBox())!.width;
    const handle = page.getByRole('separator', { name: 'Resize Family' });
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await header.boundingBox())!.width).toBeGreaterThan(before + 40);
  });

  test('column header menu sorts and filters', async ({ page }) => {
    await open(page, 'discovery');
    await waitForData(page);
    await page.getByRole('button', { name: 'Score S column menu' }).click();
    await page.getByRole('menuitem', { name: 'Sort descending' }).click();
    await expect.poll(() => decodeURIComponent(page.url())).toContain('sort=s:desc');
    await page.getByRole('button', { name: 'State column menu' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'REVIEW' }).click();
    await page.keyboard.press('Escape');
    await expect.poll(() => decodeURIComponent(page.url())).toContain('state=REVIEW');
    await expect(page.getByRole('grid', { name: 'Discovered columns' })).toContainText('order_ref');
  });
});
