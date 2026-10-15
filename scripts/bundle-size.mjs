// Measures gzip size of the JavaScript the browser actually requests for a route (default: Overview).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/bundle-size.mjs [route]
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const route = process.argv[2] ?? 'overview';
const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
const page = await browser.newPage();
const files = [];
const timeline = [];
const t0 = Date.now();
page.on('requestfinished', (r) => {
  const u = new URL(r.url());
  if (u.pathname.endsWith('.js') || u.pathname.endsWith('.css')) {
    files.push(u.pathname);
    timeline.push([Date.now() - t0, u.pathname]);
  }
});
await page.goto(`http://localhost:4173/#/${route}?fast=1`);
await page.locator('h1').waitFor();
await page.waitForTimeout(2500);
const fcp = await page.evaluate(
  () => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
);
// Initial graph = entry script + its static import closure + stylesheets named in the built index.html (dynamic imports excluded).
const html = readFileSync(join('dist', 'index.html'), 'utf8');
const initial = [];
const walk = (f) => {
  if (initial.includes(f)) return;
  initial.push(f);
  if (!f.endsWith('.js')) return;
  const code = readFileSync(join('dist', f), 'utf8');
  for (const m of code.matchAll(
    /(?:^|[;}\s])(?:import|export)\s*(?:[^"';()]*?from\s*)?["']\.\/([^"']+\.js)["']/g,
  ))
    walk(`/assets/${m[1]}`);
};
for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) walk(m[1]);
let total = 0;
let critical = 0;
for (const f of [...new Set(files)]) {
  const gz = gzipSync(readFileSync(join('dist', f))).length;
  total += gz;
  if (initial.includes(f)) critical += gz;
  console.log(
    `${(gz / 1024).toFixed(1).padStart(7)} KB  ${initial.includes(f) ? 'initial ' : 'deferred'}  ${f}`,
  );
}
console.log(
  `\nroute "${route}": ${(total / 1024).toFixed(1)} KB gzip total, ${(critical / 1024).toFixed(1)} KB gzip in the initial HTML graph (entry + static imports + css)`,
);
console.log(
  `first-contentful-paint: ${fcp === null ? 'n/a' : fcp.toFixed(0) + ' ms'} (headless, software rendering, local server)`,
);
await browser.close();
