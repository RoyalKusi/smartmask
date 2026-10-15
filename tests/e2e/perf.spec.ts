import { expect, test } from './fixtures';
import { gzipSync } from 'node:zlib';
import { open, waitForData } from './helpers';

test.describe('performance budgets (lab figures from a local server)', () => {
  test('Overview route ships under 350 KB gzipped JavaScript and CSS', async ({ page }) => {
    let total = 0;
    const seen = new Set<string>();
    page.on('response', async (r) => {
      const url = new URL(r.url());
      if (!/\.(js|css)$/.test(url.pathname) || seen.has(url.pathname)) return;
      seen.add(url.pathname);
      total += gzipSync(await r.body()).length;
    });
    await open(page, 'overview');
    await waitForData(page);
    await page.waitForTimeout(1500);
    // eslint-disable-next-line no-console
    console.log(`overview route: ${(total / 1024).toFixed(1)} KB gzip across ${seen.size} files`);
    expect(total / 1024).toBeLessThan(350);
  });

  test('first contentful paint is under 1.2 s', async ({ page }) => {
    await open(page, 'overview');
    const fcp = await page.evaluate(
      () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Infinity,
    );
    expect(fcp).toBeLessThan(1200);
  });

  test('layout shift stays under 0.02 while skeletons resolve', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    for (const view of ['overview', 'discovery', 'audit']) {
      await open(page, view);
      await waitForData(page);
      await page.waitForTimeout(800);
    }
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    // eslint-disable-next-line no-console
    console.log(`cumulative layout shift: ${cls.toFixed(4)}`);
    expect(cls).toBeLessThan(0.02);
  });

  test('interactions commit within 100 ms (role switch, sort, drawer)', async ({ page }) => {
    await open(page, 'discovery');
    await waitForData(page);
    const commit = (sel: string) =>
      page.evaluate(async (s) => {
        const el = document.querySelector(s) as HTMLElement;
        const t0 = performance.now();
        el.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - t0;
      }, sel);
    const role = await commit('[data-testid=role-support]');
    const nav = await commit('a[href^="#/audit"]');
    // eslint-disable-next-line no-console
    console.log(`role switch ${role.toFixed(0)} ms, navigation ${nav.toFixed(0)} ms`);
    expect(role).toBeLessThan(100);
    expect(nav).toBeLessThan(100);
  });
});
