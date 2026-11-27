import { utimesSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const ASSETS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets');

/** Collect console errors and page errors; any of them fails the test. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  // Tests in other files run in parallel on the same project and add and
  // remove their own `e2e...` files; reading one just as it goes is a 404
  // that says nothing about this test.
  // The console error and the response arrive in either order.
  const NOT_FOUND = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
  let vanished = 0;
  page.on('response', (r) => {
    if (r.status() !== 404 || !/\/__tf\/files\/.*\/e2e[a-z0-9]+/.test(r.url())) return;
    const at = errors.indexOf(NOT_FOUND);
    if (at >= 0) errors.splice(at, 1);
    else vanished++;
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (m.text() === NOT_FOUND && vanished > 0) vanished--;
    else errors.push(m.text());
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

test('the history dropdown undoes back to a picked change', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const start = (await session(page))?.game;
  await chooseGame(page, 'snake');
  await chooseGame(page, 'tetris');
  await page.getByTestId('undo-history').click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(["Select game 'Tetris'", "Select game 'Snake'"]);
  await items.nth(1).hover();
  await expect(page.getByRole('menu')).toContainText('Undo 2 changes');
  await items.nth(1).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByTestId('game-select')).toHaveAttribute('data-game', start ?? '');
  await expect(page.getByTestId('undo-history')).toBeDisabled();
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
    window.__tf?.editor.host.load('hang', bytes);
  }, HANGING_CARTRIDGE);
  await expect(page.getByTestId('run-status')).toHaveText('hung', { timeout: 10_000 });
  // The editor itself is still responsive: its controls react.
  await page.getByTestId('app-menu').click();
  await page.getByTestId('reset-layout').click();
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

test('F4 copies the hovered pixel color and says so', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const box = await page.getByTestId('game-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 1, box.y + 1);
  const readout = page.getByTestId('pixel-color');
  await expect(readout).toContainText(/#[0-9A-F]{6}/);
  const hex = ((await readout.textContent()) ?? '').match(/#[0-9A-F]{6}/)?.[0];
  await page.keyboard.press('F4');
  await expect(page.getByTestId('pixel-copied')).toHaveText(`Copied ${hex}`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(hex);
  await expect(page.getByTestId('pixel-copied')).toHaveText('');
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

const tabGroups = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.dv-groupview')].map((g) =>
      [...g.querySelectorAll('.dv-tab')].map((t) => t.textContent?.trim()),
    ),
  );

/** A touch on the on-screen controls (pointer events, as a finger sends them). */
const touchAt = (page: Page, x: number, y: number, id: number, type: string) =>
  page.evaluate(
    ([x, y, id, type]) => {
      document.elementFromPoint(x as number, y as number)?.dispatchEvent(
        new PointerEvent(type as string, {
          bubbles: true,
          pointerId: id as number,
          pointerType: 'touch',
          clientX: x as number,
          clientY: y as number,
        }),
      );
    },
    [x, y, id, type] as const,
  );

const heldButtons = (page: Page) => page.evaluate(() => window.__tf?.editor.input.current.buttons ?? -1);

test.describe('on a touch screen in landscape', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test('the game fills the screen with the controls, which press game buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('run-status')).toHaveText('running');
    const generation = (await session(page))?.generation;
    await expect(page.getByTestId('touch-game')).toHaveClass(/tf-touch-game-landscape/);
    await expect(page.getByTestId('virtual-controls')).toBeVisible();
    const canvas = await page.getByTestId('touch-screen').getByTestId('game-canvas').boundingBox();
    expect(Math.round(canvas?.height ?? 0)).toBe(390);
    expect(Math.round(canvas?.width ?? 0)).toBe(520);

    // Hold the left of the D-pad and A at once (two fingers).
    const pad = await page.locator('.tf-vc-dpad').boundingBox();
    const face = await page.locator('.tf-vc-face').boundingBox();
    if (!pad || !face) throw new Error('no controls');
    const left = [pad.x + 5, pad.y + pad.height / 2] as const;
    const a = [face.x + face.width / 2, face.y + face.height - 5] as const;
    await touchAt(page, left[0], left[1], 11, 'pointerdown');
    await touchAt(page, a[0], a[1], 12, 'pointerdown');
    expect(await heldButtons(page)).toBe((1 << 2) | (1 << 4));
    await expect(page.locator('.tf-vc-dpad [data-pressed]')).toHaveText('◀');
    await touchAt(page, left[0], left[1], 11, 'pointerup');
    expect(await heldButtons(page)).toBe(1 << 4);
    await touchAt(page, a[0], a[1], 12, 'pointercancel');
    expect(await heldButtons(page)).toBe(0);

    // Pause and Restart sit at the bottom left; there is no Edit button.
    await page.getByTestId('play-pause').click();
    await expect.poll(async () => (await session(page))?.status).toBe('paused');
    await page.getByTestId('play-pause').click();
    await expect.poll(async () => (await session(page))?.status).toBe('running');
    await expect(page.getByTestId('play-exit')).toHaveCount(0);
    // No menu button on a phone in landscape: turning it to portrait shows the top bar.
    await expect(page.locator('.tf-touch-menu')).toHaveCount(0);

    // Turning the phone keeps the same game running.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('touch-game')).toHaveClass(/tf-touch-game-portrait/);
    await expect(page.getByTestId('touch-screen').getByTestId('game-canvas')).toBeVisible();
    expect((await session(page))?.generation).toBe(generation);
    expect((await session(page))?.status).toBe('running');
  });
});

test.describe('on a touch screen in portrait', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('the game is on top with a column of controls on each side, the panels below as tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('run-status')).toHaveText('running');
    await expect(page.getByTestId('touch-game')).toHaveClass(/tf-touch-game-portrait/);
    await expect(page.getByTestId('touch-panels').getByRole('tab')).toHaveText([
      'Files',
      'Library',
      'Console',
      'Run',
      'Memory',
    ]);
    // No Dockview in the touch layout.
    await expect(page.locator('.dv-groupview')).toHaveCount(0);
    await expect(page.getByTestId('pixel-color')).toBeHidden();
    // The columns sit beside the game, the row with Start and the triggers above it.
    const screen = await page.getByTestId('touch-screen').boundingBox();
    const leftColumn = await page.locator('.tf-vc-column-left').boundingBox();
    const rightColumn = await page.locator('.tf-vc-column-right').boundingBox();
    const top = await page.locator('.tf-vc-top').boundingBox();
    if (!screen || !leftColumn || !rightColumn || !top) throw new Error('missing parts');
    expect(leftColumn.x + leftColumn.width).toBeLessThanOrEqual(screen.x);
    expect(rightColumn.x).toBeGreaterThanOrEqual(screen.x + screen.width);
    expect(top.y + top.height).toBeLessThanOrEqual(screen.y);
    // The bottom quarter of the right column is A.
    await touchAt(page, rightColumn.x + 20, rightColumn.y + rightColumn.height - 5, 21, 'pointerdown');
    expect(await heldButtons(page)).toBe(1 << 4);
    await touchAt(page, rightColumn.x + 20, rightColumn.y + rightColumn.height - 5, 21, 'pointerup');
    expect(await heldButtons(page)).toBe(0);
  });
});

test.describe('the touch panels in portrait', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('open files in the Editor tab, with a switcher, and stay open after a reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('run-status')).toHaveText('running');
    await page.getByTestId('file-games/pong').click();
    await page.getByTestId('file-games/pong/main.ts').click();
    const editorTab = page.getByTestId('touch-tab-editor');
    await expect(editorTab).toHaveText('Editor');
    await expect(editorTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('code-games/pong/main.ts').locator('.cm-content')).toContainText(
      'const TITLE = "Pong"',
    );
    await expect(page.getByTestId('file-games/pong/main.ts')).toHaveClass(/tf-files-active/);

    // A second file: the switcher lists both, one is shown.
    await page.evaluate(() => window.__tf?.editor.workbench.openFile('engine/sdk/drawing.ts'));
    const select = page.getByTestId('touch-file-select');
    await expect(select.locator('option')).toHaveText(['pong/main.ts', 'engine/sdk/drawing.ts']);
    await expect(page.getByTestId('code-engine/sdk/drawing.ts')).toBeVisible();
    await expect(page.getByTestId('code-games/pong/main.ts')).toBeHidden();
    await select.selectOption({ label: 'pong/main.ts' });
    await expect(page.getByTestId('code-games/pong/main.ts')).toBeVisible();

    // The other tabs keep the files open.
    await page.getByTestId('touch-tab-console').click();
    await expect(page.getByTestId('touch-panel-editor')).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('run-status')).toHaveText('running');
    await expect(page.getByTestId('touch-tab-console')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('touch-tab-editor').click();
    await expect(page.getByTestId('code-games/pong/main.ts').locator('.cm-content')).toContainText(
      'const TITLE = "Pong"',
    );

    // Closing the last file removes the Editor tab.
    await page.getByTestId('touch-file-close').click();
    await page.getByTestId('touch-file-close').click();
    await expect(page.getByTestId('touch-tab-editor')).toHaveCount(0);
    await expect(page.getByTestId('touch-tab-files')).toHaveAttribute('aria-selected', 'true');
  });

  test('the top bar fits one row; the Files actions are in a menu', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/');
    await expect(page.getByTestId('run-status')).toHaveText('running');
    const toolbar = await page.locator('.tf-toolbar').boundingBox();
    expect(toolbar?.height).toBeLessThan(56);
    await expect(page.getByRole('button', { name: 'Redo' })).toBeVisible();
    // No zoom into the code editor on iOS: its text is at least 16px.
    await page.evaluate(() => window.__tf?.editor.workbench.openFile('games/pong/main.ts'));
    await expect(page.locator('.cm-content').first()).toHaveCSS('font-size', '16px');
    await page.getByTestId('touch-tab-files').click();
    await expect(page.getByTestId('files-export')).toHaveCount(0);
    await page.getByTestId('files-menu').click();
    await expect(page.getByRole('menuitem')).toHaveText([
      'New game',
      'New file',
      'Rename',
      'Delete',
      'Export',
      'Cartridge',
      'Import',
    ]);
    await expect(page.getByTestId('files-export')).toBeEnabled();
    // The list stays on screen, above the bottom edge.
    const list = await page.getByRole('menu').boundingBox();
    expect((list?.y ?? 0) + (list?.height ?? 0)).toBeLessThanOrEqual(800);
  });

  test('the Files actions menu opens upward when the sheet is low', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tinyforge.editor.sheet', 'half'));
    await page.setViewportSize({ width: 390, height: 700 });
    await page.goto('/');
    await expect(page.getByTestId('run-status')).toHaveText('running');
    await page.getByTestId('touch-tab-files').click();
    await page.getByTestId('files-menu').click();
    const button = await page.getByTestId('files-menu').boundingBox();
    const list = await page.getByRole('menu').boundingBox();
    if (!button || !list) throw new Error('not shown');
    expect(list.y + list.height).toBeLessThanOrEqual(700);
    await expect(page.getByRole('menuitem', { name: 'Import' })).toBeInViewport();
  });

  test('a tab opens a collapsed sheet', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('tinyforge.editor.sheet', 'collapsed'));
    await page.goto('/');
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-state', 'collapsed');
    await page.getByTestId('touch-tab-run').click();
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-state', 'half');
    await expect(page.getByTestId('touch-panel-run')).toBeVisible();
  });
});

test.describe('the bottom sheet in portrait', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('sits under the game, expands over it on a tap, collapses when dragged down, and remembers', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('run-status')).toHaveText('running');
    const sheet = page.getByTestId('sheet');
    const handle = page.getByTestId('sheet-handle');
    const box = async (locator: ReturnType<typeof page.locator>) => {
      const b = await locator.boundingBox();
      if (!b) throw new Error('not shown');
      return b;
    };
    await expect(sheet).toHaveAttribute('data-state', 'half');
    const game = await box(page.getByTestId('touch-game'));
    expect(Math.abs((await box(sheet)).y - (game.y + game.height))).toBeLessThan(2);

    // A tap expands it over the game, up to the top bar.
    await handle.click();
    await expect(sheet).toHaveAttribute('data-state', 'expanded');
    const toolbar = await box(page.locator('.tf-toolbar'));
    await expect.poll(async () => Math.round((await box(sheet)).y)).toBe(Math.round(toolbar.y + toolbar.height));

    // Dragged down to the bottom: only the handle and the tabs remain.
    const h = await box(handle);
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, 830, { steps: 8 });
    await page.mouse.up();
    await expect(sheet).toHaveAttribute('data-state', 'collapsed');
    await expect.poll(async () => Math.round((await box(sheet)).height)).toBe(64);
    expect((await session(page))?.status).toBe('running');

    await page.reload();
    await expect(page.getByTestId('run-status')).toHaveText('running');
    await expect(page.getByTestId('sheet')).toHaveAttribute('data-state', 'collapsed');
  });
});

test('the menu switches to the touch layout and back, keeping the game running', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByTestId('app-menu').click();
  await page.getByTestId('use-touch-layout').click();
  // A desktop window is landscape: the game takes the screen, the menu is by Pause.
  await expect(page.getByTestId('touch-game')).toHaveClass(/tf-touch-game-landscape/);
  // The choice survives a reload.
  await page.reload();
  await expect(page.getByTestId('run-status')).toHaveText('running');
  const touchMenu = page.locator('.tf-touch-menu').getByTestId('app-menu');
  await touchMenu.click();
  await page.getByTestId('use-desktop-layout').click();
  await expect(page.getByTestId('touch-game')).toHaveCount(0);
  await expect.poll(async () => (await tabGroups(page)).length).toBe(5);
  await expect(page.getByTestId('viewport').getByTestId('game-canvas')).toBeVisible();
  await page.getByTestId('app-menu').click();
  await page.getByTestId('auto-layout').click();
  await expect(page.getByTestId('auto-layout')).toHaveCount(0);
  expect((await session(page))?.status).toBe('running');
});
