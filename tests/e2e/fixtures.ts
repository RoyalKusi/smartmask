import { expect, test as base } from '@playwright/test';

/** Every test fails if the page logs a console error or throws: the brief requires zero console errors. */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await use();
      expect(errors, 'console errors during the test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
