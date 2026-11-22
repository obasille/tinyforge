// The sprite editor and the sound player against the real dev server. Each
// test uses an asset ID of its own, removed afterwards.

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPRITES = path.join(REPO, 'assets', 'sprites');
const SFX = path.join(REPO, 'assets', 'sfx');

let id = '';
/** Samples in a WAV in assets/sfx, or -1 while it is being written. */
function samplesIn(file: string): number {
  const bytes = readFileSync(path.join(SFX, file));
  return bytes.length >= 44 ? bytes.readUInt32LE(40) / 2 : -1;
}

const ours = (dir: string) => readdirSync(dir).filter((f) => f.startsWith(id));

test.beforeEach(async ({ page }) => {
  id = `e2e${Date.now().toString(36)}`;
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('tf-test-init')) {
      localStorage.clear();
      sessionStorage.setItem('tf-test-init', '1');
    }
  });
});

test.afterEach(() => {
  for (const dir of [SPRITES, SFX]) for (const f of ours(dir)) rmSync(path.join(dir, f), { force: true });
});

async function openLibrary(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.dv-tab', { hasText: 'Library' }).click();
  await expect(page.getByTestId('asset-assets/sprites/coin~8x1.png')).toBeVisible();
}

/** Width, height and RGBA of an 8-bit RGBA PNG written by the editor (filter type per row). */
function readPng(file: string): { width: number; height: number; rgba: Uint8Array } {
  const buf = readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  let idat = Buffer.alloc(0);
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    if (buf.toString('latin1', at + 4, at + 8) === 'IDAT')
      idat = Buffer.concat([idat, buf.subarray(at + 8, at + 8 + len)]);
    at += len + 12;
  }
  const raw = inflateSync(idat);
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      rgba[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + pred) & 255;
    }
  }
  return { width, height, rgba };
}

/** A mono 16-bit WAV: `samples` samples of a square wave. */
function wav(samples: number, rate = 8000): Buffer {
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) out.writeInt16LE(i % 40 < 20 ? 8000 : -8000, 44 + i * 2);
  return out;
}

test('creates a sprite, draws, adds a frame and saves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openLibrary(page);
  await page.getByTestId('library-new-sprite').click();
  await page.getByTestId('new-sprite-id').fill(id);
  await page.getByTestId('library-new-form').getByLabel('Width').fill('8');
  await page.getByTestId('library-new-form').getByLabel('Height').fill('8');
  await page.getByTestId('new-sprite-create').click();
  const panel = page.getByTestId(`sprite-assets/sprites/${id}.png`);
  await expect(panel).toBeVisible();
  await expect.poll(() => ours(SPRITES)).toEqual([`${id}.png`]);

  // Draw a stroke across the middle row with the pencil.
  await expect(panel.getByTestId('sprite-status')).toContainText('8×8');
  const canvas = panel.getByTestId('sprite-canvas');
  // The docked layout can still be settling: wait until the canvas stops moving.
  let box = await canvas.boundingBox();
  await expect
    .poll(async () => {
      const next = await canvas.boundingBox();
      const same = JSON.stringify(next) === JSON.stringify(box);
      box = next;
      return same;
    })
    .toBe(true);
  if (!box) throw new Error('no canvas');
  const zoom = await page.evaluate(() => [...(window.__tf?.editor.openSprites ?? [])][0].state.getState().zoom);
  const left = box.x + box.width / 2 - 4 * zoom;
  const top = box.y + box.height / 2 - 4 * zoom;
  await page.mouse.move(left + zoom / 2, top + 4.5 * zoom);
  await page.mouse.down();
  await page.mouse.move(left + 7.5 * zoom, top + 4.5 * zoom, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.dv-tab', { hasText: `● ${id}.png` })).toBeVisible();

  await panel.getByTestId('sprite-add-frame').click();
  await expect(panel.getByTestId('sprite-frame-1')).toBeVisible();
  // Ctrl+S saves the active panel even with the keyboard focus outside it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+s');
  await expect.poll(() => ours(SPRITES)).toEqual([`${id}~2x1.png`]);
  const png = readPng(path.join(SPRITES, `${id}~2x1.png`));
  expect([png.width, png.height]).toEqual([16, 8]);
  const row = 4 * png.width * 4;
  for (let x = 0; x < 8; x++) expect(png.rgba[row + x * 4 + 3]).toBe(255); // frame 1, row 4: drawn
  expect(png.rgba[row + 8 * 4 + 3]).toBe(0); // frame 2: empty
  // The panel follows the renamed file.
  await expect(page.locator('.dv-tab', { hasText: `${id}~2x1.png` })).toBeVisible();

  // The budget lists games and their sprite memory.
  await page.locator('.dv-tab', { hasText: 'Library' }).click();
  await page.getByTestId('library-tab-budget').click();
  await expect(page.getByTestId('budget-dinoWorld')).toContainText('KB');
  expect(errors).toEqual([]);
});

test('selects, trims and saves a sound', async ({ page }) => {
  writeFileSync(path.join(SFX, `${id}.wav`), wav(8000));
  await openLibrary(page);
  await page.getByTestId('library-tab-sfx').click();
  await page.getByTestId(`asset-assets/sfx/${id}.wav`).dblclick();
  const panel = page.getByTestId(`sound-assets/sfx/${id}.wav`);
  await expect(panel.getByTestId('sound-status')).toContainText('1.000 s · 8000 Hz · mono');

  const wave = panel.getByTestId('waveform');
  const box = await wave.boundingBox();
  if (!box) throw new Error('no waveform');
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(panel.getByTestId('sound-status')).toContainText('selection');
  await panel.getByTestId('sound-trim').click();
  await expect(panel.getByTestId('sound-status')).toContainText(/0\.[45]\d\d s · 8000 Hz/);
  await page.keyboard.press('Control+s');
  // Half the samples are left (the file may be mid-write: -1).
  await expect
    .poll(() => {
      const n = samplesIn(`${id}.wav`);
      return n > 3500 && n < 4200;
    })
    .toBe(true);
  // Undo outside the panel puts the file back.
  await page.locator('.dv-tab', { hasText: 'Library' }).click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => samplesIn(`${id}.wav`)).toBe(8000);
});
