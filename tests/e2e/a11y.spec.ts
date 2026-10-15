import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { open, waitForData } from './helpers';

const VIEWS = ['overview', 'discovery', 'review', 'policy', 'workbench', 'verification', 'audit', 'performance', 'anomalies'] as const;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`axe-core, ${theme} theme`, () => {
    for (const view of VIEWS) {
      test(`${view} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await open(page, view, `theme=${theme}${view === 'workbench' ? '&sample=probe&role=support' : ''}`);
        await waitForData(page);
        if (view === 'workbench') {
          await page.getByTestId('run-query').click();
          await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 20_000 });
        }
        await page.waitForTimeout(700);
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
        const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
        expect(summary).toEqual([]);
      });
    }
  });
}

test.describe('axe-core on overlays', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`drawer, palette and wizard (${theme})`, async ({ page }) => {
      await open(page, 'discovery', `theme=${theme}&open=column:customers.ssn`);
      await expect(page.getByRole('dialog', { name: 'Details' })).toBeVisible();
      await page.waitForTimeout(600);
      let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeVisible();
      await page.waitForTimeout(400);
      results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    });
  }
});
