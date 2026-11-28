import { expect, test } from '@playwright/test';

// The installable app: manifest, icons and the service worker (vite/pwa.ts,
// pwa/sw.js). The other static tests block service workers.
test.use({ serviceWorkers: 'allow' });

test('the build installs: manifest, icons, and a worker that never caches __tf/', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');

  // Manifest and icons, linked from the page.
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href ?? '')).json();
  expect(manifest).toMatchObject({ short_name: 'TinyForge', display: 'standalone', start_url: './' });
  for (const icon of manifest.icons) {
    const res = await request.get(icon.src);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  // The worker installs, then controls the page from the next launch.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect(page.getByTestId('run-status')).toHaveText('running');
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // A compile through the worker: the compiler is cached on first use.
  await page.getByTestId('game-select').click();
  await page.getByTestId('game-option-snake').click();
  await expect(page.getByTestId('console')).toContainText(/Compiled snake in \d+ ms/);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
  expect(cached).toContain('/');
  expect(cached.some((u) => /^\/assets\/index-.*\.js$/.test(u))).toBe(true);
  expect(cached.some((u) => /^\/assets\/asc-.*\.js$/.test(u))).toBe(true);
  // Project files, the AI and GitHub proxy and the login are never cached.
  expect(cached.filter((u) => u.startsWith('/__tf/'))).toEqual([]);
  expect(errors).toEqual([]);
});
