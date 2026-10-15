import { expect, test } from '@playwright/test';
import { open, waitForData } from './helpers';

// This spec deliberately triggers a render crash, so it does not use the zero-console-errors guard.
test('a crash inside one view is contained by its error boundary, with a code, details and Retry', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await open(page, 'discovery');
  await waitForData(page);
  await page.keyboard.press('Control+Shift+E');
  await page.getByRole('button', { name: 'Crash this view once' }).click();

  const panel = page.getByRole('alert');
  await expect(panel).toContainText('SM-UI-001');
  await expect(panel).toContainText('Discovery view hit an unexpected error');
  await panel.getByText('Technical details').click();
  await expect(panel).toContainText('Injected view crash');
  // The shell is unaffected: navigation still works while the view is broken.
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

  await panel.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('grid', { name: 'Discovered columns' })).toBeVisible();
  // Every logged error is the injected one.
  expect(errors.every((e) => e.includes('Injected view crash') || e.includes('SmartMask'))).toBe(true);
});
