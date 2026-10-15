import { expect, type Page } from '@playwright/test';

export async function open(page: Page, view: string, params = ''): Promise<void> {
  await page.goto(`/#/${view}?fast=1${params ? `&${params}` : ''}`);
  await expect(page.locator('h1')).toBeVisible();
}

export async function waitForData(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

export async function setRole(page: Page, role: 'admin' | 'support' | 'analyst'): Promise<void> {
  await page.getByTestId(`role-${role}`).click();
  await expect(page).toHaveURL(role === 'admin' ? /^((?!role=).)*$/ : new RegExp(`role=${role}`));
}

export function trackConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** A toast by its title. Fluent also mirrors toasts into an aria-live region, so match the visible title element. */
export function toast(page: Page, title: string | RegExp) {
  return page.locator('.fui-ToastTitle', { hasText: title });
}
