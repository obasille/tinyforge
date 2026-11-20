import { expect, type Page, test } from '@playwright/test';

/** Collect console errors and page errors; any of them fails the test. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function session(page: Page) {
  return page.evaluate(() => window.__tf?.session.getState());
}

test.beforeEach(async ({ page }) => {
  // Start every test from the default project and layout.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('tf-test-init')) {
      localStorage.clear();
      sessionStorage.setItem('tf-test-init', '1');
    }
  });
});

test('loads, docks the panels and runs the default game in the worker', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  for (const title of ['Game', 'Run', 'Memory', 'Console']) {
    await expect(page.locator('.dv-default-tab', { hasText: title }).first()).toBeVisible();
  }
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect.poll(async () => (await session(page))?.stats?.ticks ?? 0).toBeGreaterThan(30);
  await expect(page.getByTestId('console')).toContainText('Sprites loaded');
  expect(errors).toEqual([]);
});

test('memory viewer updates every frame from the worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const hex = page.getByTestId('memory-hex');
  await expect(hex).not.toBeEmpty();
  // Count pushes for the visible range over one second at 60 Hz.
  const pushes = await page.evaluate(async () => {
    const tf = window.__tf;
    if (!tf) return 0;
    let n = 0;
    const stop = tf.editor.host.watch(0x6e000, 256, () => n++);
    await new Promise((r) => setTimeout(r, 1000));
    stop();
    return n;
  });
  expect(pushes).toBeGreaterThan(40);
});

test('pause, step and resume through the run panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('paused');
  const before = await page.evaluate(async () => {
    const tf = window.__tf;
    return new Promise<number>((resolve) => {
      const stop = tf?.editor.host.watch(0, 4, (_b, _o, ticks) => {
        stop?.();
        resolve(ticks);
      });
    });
  });
  await page.getByRole('button', { name: 'Step 1 tick' }).click();
  const after = await page.evaluate(async () => {
    const tf = window.__tf;
    return new Promise<number>((resolve) => {
      const stop = tf?.editor.host.watch(0, 4, (_b, _o, ticks) => {
        stop?.();
        resolve(ticks);
      });
    });
  });
  expect(after).toBe(before + 1);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('running');
});

test('switching games is undoable', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByTestId('game-select').selectOption('snake');
  await expect.poll(async () => (await session(page))?.game).toBe('snake');
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.getByTestId('game-select')).toHaveValue('pong');
  await expect.poll(async () => (await session(page))?.game).toBe('pong');
  expect(errors).toEqual([]);
});

// update() spins forever after 30 ticks. Built from:
//   export function update(): void { n++; if (n > 30) { while (true) { n++; } } }
// with: asc hang.ts --runtime stub --importMemory --memoryBase 524288 -O1
const HANGING_CARTRIDGE =
  'AGFzbQEAAAABBAFgAAACDwEDZW52Bm1lbW9yeQIACAMEAwAAAAYGAX8BQQALByEEBGluaXQAAQZ1cGRhdGUAAARkcmF3AAIGbWVtb3J5AgAKKwMeACMAQQFqJAAjAEEeSgRAA0AjAEEBaiQADAALAAsLBgBBACQACwMAAQs=';

test('a game stuck in an infinite loop can be stopped without freezing the editor', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    window.__tf?.editor.host.load('hang', url);
  }, HANGING_CARTRIDGE);
  await expect(page.getByTestId('run-status')).toHaveText('hung', { timeout: 10_000 });
  // The editor itself is still responsive: its controls react.
  await page.getByRole('button', { name: 'Reset layout' }).click();
  await page.getByRole('button', { name: 'Stop and reload game' }).click();
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect.poll(async () => (await session(page))?.game).toBe('pong');
  expect((await session(page))?.generation).toBe(2);
});
