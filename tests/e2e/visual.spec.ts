import { expect, test } from '@playwright/test';
import { open, waitForData } from './helpers';

const VIEWS = ['overview', 'discovery', 'review', 'policy', 'workbench', 'verification', 'audit', 'performance', 'anomalies'] as const;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`visual snapshots, ${theme}`, () => {
    for (const view of VIEWS) {
      test(`${view}`, async ({ page }) => {
        await open(page, view, `theme=${theme}${view === 'workbench' ? '&role=analyst' : ''}`);
        await waitForData(page);
        if (view === 'workbench') {
          await page.getByTestId('run-query').click();
          await expect(page.getByRole('grid', { name: /Masked result/ })).toBeVisible({ timeout: 20_000 });
          await page.getByRole('list', { name: 'Pipeline' }).waitFor();
        }
        // Wait for number count-ups and chart paint, then freeze everything time-dependent.
        await page.waitForTimeout(1200);
        await expect(page).toHaveScreenshot(`${view}-${theme}.png`, {
          mask: [page.locator('[aria-label="Live cache after a policy publish"]'), page.locator('.sm-table-foot'), page.getByRole('status')],
          maxDiffPixelRatio: 0.03,
        });
      });
    }
  });
}
