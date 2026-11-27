import { expect, type Page, test } from '@playwright/test';
import { CONTENT_SECURITY_POLICY } from '../vite/site-headers.ts';

/** Every CSP violation in the page and its Workers, and every page error. */
function trackProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('worker', (w) => w.on('console', (m) => m.type() === 'error' && problems.push(`worker: ${m.text()}`)));
  return problems;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
});

test('the static build compiles and runs games under the site CSP', async ({ page }) => {
  const problems = trackProblems(page);
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);

  // The default game: compiled in the compile Worker, run in the game Worker.
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const console = page.getByTestId('console');
  await expect(console).toContainText(/Compiled pong in \d+ ms/);
  await expect(console).toContainText('Sprites loaded for pong');

  // Covers are blob: images.
  await page.getByTestId('game-select').click();
  await expect(page.getByTestId('game-option-pong').locator('img')).toHaveJSProperty('naturalWidth', 64);
  // Another game compiles too.
  await page.getByTestId('game-option-snake').click();
  await expect(console).toContainText(/Compiled snake in \d+ ms/);
  await expect(page.getByTestId('run-status')).toHaveText('running');

  // The library shows sprites from __tf/files.
  await page.locator('.dv-tab', { hasText: 'Library' }).click();
  await expect(page.getByTestId('asset-assets/sprites/coin~8x1.png')).toBeVisible();

  expect(problems).toEqual([]);
});
