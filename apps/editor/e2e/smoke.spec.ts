import { utimesSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets');

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

/** Open the game picker and choose a game. */
async function chooseGame(page: Page, game: string): Promise<void> {
  await page.getByTestId('game-select').click();
  await page.getByTestId(`game-option-${game}`).click();
}

test('loads, docks the panels and runs the default game in the worker', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  for (const title of ['Game', 'Run', 'Memory', 'Console']) {
    await expect(page.locator('.dv-default-tab', { hasText: title }).first()).toBeVisible();
  }
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect.poll(async () => (await session(page))?.stats?.ticks ?? 0).toBeGreaterThan(30);
  await expect(page.getByTestId('console')).toContainText('Sprites loaded for pong');
  await expect(page.getByTestId('console')).toContainText('Audio loaded: 8 SFX, 1 music tracks');
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
    const stop = tf.editor.host.watch(0x50000, 256, () => n++);
    await new Promise((r) => setTimeout(r, 1000));
    stop();
    return n;
  });
  expect(pushes).toBeGreaterThan(40);
});

test('pause, step and resume through the run panel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByRole('button', { name: /^Pause/ }).click();
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
  await page.getByRole('button', { name: /^Step 1 tick/ }).click();
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
  await page.getByRole('button', { name: /^Resume/ }).click();
  await expect(page.getByTestId('run-status')).toHaveText('running');
});

test('the game picker lists games with their title, description, author and cover', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByTestId('game-select').click();
  const pong = page.getByTestId('game-option-pong');
  await expect(pong).toHaveAttribute('aria-selected', 'true');
  await expect(pong).toContainText('Pong');
  await expect(pong).toContainText('Two-player pong with horizontal paddles');
  await expect(pong).toContainText('by Olivier Basille');
  // The cover comes from the cartridge's tinyforge.meta section.
  await expect(pong.locator('img')).toHaveAttribute('src', /^blob:/);
  await expect(pong.locator('img')).toHaveJSProperty('naturalWidth', 64);
  // Games without a cover show their initials.
  await expect(page.getByTestId('game-option-snake')).toContainText('Classic snake game');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('game-picker')).toHaveCount(0);
  await expect(page.getByTestId('viewport')).toBeFocused();
  expect(errors).toEqual([]);
});

test('switching games is undoable', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await chooseGame(page, 'snake');
  await expect.poll(async () => (await session(page))?.game).toBe('snake');
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.getByTestId('game-select')).toHaveAttribute('data-game', 'pong');
  await expect.poll(async () => (await session(page))?.game).toBe('pong');
  expect(errors).toEqual([]);
});

// update() spins forever after 30 ticks. Built from:
//   export function update(): void { n++; if (n > 30) { while (true) { n++; } } }
// with: asc hang.ts --runtime stub --importMemory -O1, then a tinyforge.meta
// section added with withMeta() (layout 1, 8 pages of memory).
const HANGING_CARTRIDGE =
  'AGFzbQEAAAAAmwEOdGlueWZvcmdlLm1ldGGIAAAAeyJmb3JtYXQiOjEsImxheW91dCI6MSwicmFtIjoxNiwibWVtb3J5Ijo1MjQyODgsInRpdGxlIjoiSGFuZyIsImRlc2NyaXB0aW9uIjoiIiwiYXV0aG9yIjoiIiwiYXNzZXRzIjp7InNwcml0ZXMiOltdLCJzZngiOltdLCJtdXNpYyI6W119fQEEAWAAAAIPAQNlbnYGbWVtb3J5AgAIAwQDAAAABgYBfwFBAAsHIQQEaW5pdAABBnVwZGF0ZQAABGRyYXcAAgZtZW1vcnkCAAorAx4AIwBBAWokACMAQR5KBEADQCMAQQFqJAAMAAsACwsGAEEAJAALAwABCw==';

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

test('hovering the game shows the color of the pixel under the mouse', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const canvas = page.getByTestId('game-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  // Pixel (0, 0) of pong is the black background; compare with what the worker reports.
  await page.mouse.move(box.x + 1, box.y + 1);
  const readout = page.getByTestId('pixel-color');
  await expect(readout).toContainText(/^0, 0 {3}#[0-9A-F]{6} {3}0x[0-9A-F]{8}/);
  const fromMemory = await page.evaluate(async () => {
    const snap = await window.__tf?.snapshot();
    return snap
      ? `#${[snap[0], snap[1], snap[2]].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
      : '';
  });
  await expect(readout).toContainText(fromMemory);
  await page.mouse.move(box.x - 20, box.y - 20);
  await expect(readout).toContainText('Hover the game');
});

test('seed fields are plain text, not color pickers', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const run = page.getByTestId('run-panel');
  await expect(run.locator('.tp-colv, .tp-colswv')).toHaveCount(0);
  const values = await run
    .locator('input, textarea')
    .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(values.some((v) => /^0x[0-9A-F]{8}$/.test(v))).toBe(true);
});

test('choosing a game gives the keyboard back to the game view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await chooseGame(page, 'snake');
  await expect(page.getByTestId('viewport')).toBeFocused();
});

test('the game view has keyboard focus when the editor starts', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewport')).toBeFocused();
  // A game key reaches the game: Start leaves pong's title screen.
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.keyboard.down('Enter');
  await expect.poll(() => page.evaluate(() => window.__tf?.editor.input.current.buttons)).toBe(1 << 6);
  await page.keyboard.up('Enter');
});

test('master volume and mute apply to the audio and survive a reload', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const gain = () => page.evaluate(() => window.__tf?.editor.audio.outputGain);
  expect(await gain()).toBe(1);

  await page.getByTestId('volume').fill('30');
  await expect.poll(gain).toBeCloseTo(0.3);
  await page.getByTestId('mute').click();
  await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(gain).toBe(0);
  await expect(page.getByTestId('viewport')).toBeFocused();

  await page.reload();
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect(page.getByTestId('volume')).toHaveValue('30');
  await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true');
  expect(await gain()).toBe(0);

  await page.getByTestId('mute').click();
  await expect.poll(gain).toBeCloseTo(0.3);
  expect(errors).toEqual([]);
});

test('F-key shortcuts pause, step, resume, restart and reload', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect(page.getByTestId('viewport')).toBeFocused();
  const ticks = () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const stop = window.__tf?.editor.host.watch(0, 4, (_b, _o, t) => {
            stop?.();
            resolve(t);
          });
        }),
    );

  await page.keyboard.press('F8');
  await expect(page.getByTestId('run-status')).toHaveText('paused');
  await expect(page.getByRole('button', { name: 'Resume (F8)' })).toBeVisible();
  const before = await ticks();
  await page.keyboard.press('F10');
  await expect.poll(ticks).toBe(before + 1);
  await page.keyboard.press('F8');
  await expect(page.getByTestId('run-status')).toHaveText('running');

  // F5 must reload the cartridge, not the browser page.
  await page.evaluate(() => {
    (window as unknown as { marker: number }).marker = 1;
  });
  await expect.poll(ticks).toBeGreaterThan(60);
  await page.keyboard.press('Shift+F5');
  await expect.poll(ticks).toBeLessThan(60);
  await expect.poll(ticks).toBeGreaterThan(60);
  await page.keyboard.press('F5');
  await expect.poll(ticks).toBeLessThan(60);
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
  expect(errors).toEqual([]);
});

test('the Ctrl keys are game triggers and Ctrl+Z still undoes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('viewport')).toBeFocused();
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const buttons = () => page.evaluate(() => window.__tf?.editor.input.current.buttons);
  await page.keyboard.down('ControlLeft');
  await expect.poll(buttons).toBe(1 << 9);
  await page.keyboard.down('ControlRight');
  await expect.poll(buttons).toBe((1 << 9) | (1 << 10));
  await page.keyboard.up('ControlRight');
  await page.keyboard.up('ControlLeft');
  await expect.poll(buttons).toBe(0);

  // A game key pressed with a trigger held still reaches the game.
  await page.keyboard.down('ControlLeft');
  await page.keyboard.down('KeyS');
  await expect.poll(buttons).toBe((1 << 9) | (1 << 4));
  await page.keyboard.up('KeyS');
  await page.keyboard.up('ControlLeft');

  // Editor shortcuts keep working from the game view.
  await chooseGame(page, 'snake');
  await expect.poll(async () => (await session(page))?.game).toBe('snake');
  await page.getByTestId('viewport').focus();
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(async () => (await session(page))?.game).toBe('pong');
});

test('each game loads only its own sprites and sounds, and a changed sprite reloads in place', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const loaded = () =>
    page.evaluate(() => ({
      sprites: window.__tf?.session.getState().spriteCount,
      audio: window.__tf?.editor.audio.counts,
    }));
  // Pong: no sprites (its cover is metadata), 8 sound effects and its theme.
  await expect.poll(loaded).toEqual({ sprites: 0, audio: { sfx: 8, music: 1 } });

  await chooseGame(page, 'dinoWorld');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect.poll(loaded).toEqual({ sprites: 2, audio: { sfx: 1, music: 0 } });
  // Memory is sized to the game: well under the old fixed 1 MB, sprites at the end.
  const memory = (await session(page))?.memory;
  expect(memory?.size).toBeLessThan(1 << 20);
  expect((memory?.hostDataAddr ?? 0) + (memory?.spriteTableBytes ?? 0)).toBeLessThanOrEqual(memory?.size ?? 0);

  // Touch the dino sprite sheet: the sprite table is rewritten, the game keeps running.
  const reloads = () => page.getByTestId('console').getByText('Sprites loaded for dinoWorld').count();
  const before = await reloads();
  // Stats are pushed every 250 ms; wait for dinoWorld's own (not pong's last ones).
  await page.waitForTimeout(600);
  const ticks = (await session(page))?.stats?.ticks ?? 0;
  expect(ticks).toBeGreaterThan(0);
  const file = path.join(ASSETS, 'sprites', 'dino~9x1.png');
  const now = new Date();
  utimesSync(file, now, now);
  await expect.poll(reloads, { timeout: 10_000 }).toBeGreaterThan(before);
  expect((await session(page))?.stats?.ticks ?? 0).toBeGreaterThanOrEqual(ticks);
  await expect(page.getByTestId('run-status')).toHaveText('running');
  expect(errors).toEqual([]);
});
