// The asset library panel against the real dev server: browsing, "used by",
// and importing (file input and drag and drop). Imported files use an ID of
// their own and are removed afterwards.

import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { expect, type Page, test } from '@playwright/test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SPRITES = path.join(REPO, 'assets', 'sprites');

let id = '';

/** A width×height RGBA PNG, one colour per 8-pixel column band. */
function png(width: number, height: number): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw.set([255, (x >> 3) * 60, 80, 255], o);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ours = () => readdirSync(SPRITES).filter((f) => f.startsWith(id));

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
  for (const f of ours()) rmSync(path.join(SPRITES, f), { force: true });
});

async function openLibrary(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('.dv-tab', { hasText: 'Library' }).click();
  await expect(page.getByTestId('asset-assets/sprites/coin~8x1.png')).toBeVisible();
  expect(errors).toEqual([]);
}

test('shows sprites, sounds and the games that use them', async ({ page }) => {
  await openLibrary(page);
  await page.getByTestId('asset-assets/sprites/coin~8x1.png').click();
  await expect(page.getByTestId('library-details-id')).toHaveText('coin');
  await expect(page.getByTestId('library-used-by')).toContainText('dinoWorld');
  // The COVER sprite counts as used.
  await page.getByTestId('library-search').fill('pong_cover');
  await page.getByTestId('asset-assets/sprites/pong_cover.png').click();
  await expect(page.getByTestId('library-used-by')).toContainText('pong');
  await page.getByTestId('library-tab-sfx').click();
  await page.getByTestId('library-search').fill('pong_hit');
  await expect(page.getByTestId('asset-assets/sfx/pong_hit_p1.wav')).toBeVisible();
  await expect(page.getByTestId('asset-assets/sfx/sumo_go.wav')).toHaveCount(0);
  // The file tree shows an asset in the library.
  await page.getByTestId('file-assets/music').click();
  await page.getByTestId('file-assets/music/pong_theme.wav').click();
  await expect(page.getByTestId('library-details-id')).toHaveText('pong_theme');
});

test('imports a sprite sheet with tags, then undoes and redoes it', async ({ page }) => {
  await openLibrary(page);
  await page.getByTestId('library-file-input').setInputFiles({
    name: `${id}.png`,
    mimeType: 'image/png',
    buffer: png(32, 8),
  });
  const draft = page.getByTestId(`draft-${id}.png`);
  await expect(draft).toContainText('32×8');
  await draft.getByRole('button', { name: 'Split as 4×1?' }).click();
  await expect(draft).toContainText('4 frames of 8×8');
  await expect(draft).toContainText(`assets/sprites/${id}~4x1.png`);
  // A bad split is refused until it is fixed.
  await draft.getByTestId('draft-cols').fill('3');
  await expect(draft).toContainText('does not split into 3×1');
  await expect(page.getByTestId('library-import-confirm')).toBeDisabled();
  await draft.getByTestId('draft-cols').fill('4');
  await draft.getByPlaceholder('ui, coin').fill('e2e, walker');
  await page.getByTestId('library-import-confirm').click();

  await expect(page.getByTestId('library-details-id')).toHaveText(id);
  await expect.poll(ours).toEqual([`${id}~4x1.png`, `${id}~4x1.png.json`]);
  expect(JSON.parse(readFileSync(path.join(SPRITES, `${id}~4x1.png.json`), 'utf8'))).toEqual({
    tags: ['e2e', 'walker'],
  });
  await expect(page.getByTestId('library-details')).toContainText('4×1 frames of 8×8');

  // Search by tag.
  await page.getByTestId('library-search').fill('#walker');
  await expect(page.locator('.tf-lib-card')).toHaveCount(1);

  // One undo removes the whole import; redo puts it back.
  await page.getByTestId('library-search').blur();
  await page.keyboard.press('Control+z');
  await expect.poll(ours).toEqual([]);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(ours).toHaveLength(2);
});

test('drops files, checks IDs, edits info and deletes', async ({ page }) => {
  await openLibrary(page);
  const bytes = [...png(8, 8)];
  await page.evaluate(
    ({ id, bytes }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], 'coin.png', { type: 'image/png' }));
      data.items.add(new File([new Uint8Array(bytes)], `${id}.png`, { type: 'image/png' }));
      const target = document.querySelector('[data-testid="library"]');
      for (const type of ['dragover', 'drop']) {
        target?.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
      }
    },
    { id, bytes },
  );
  const coin = page.getByTestId('draft-coin.png');
  await expect(coin).toContainText('The library already has a sprite "coin"');
  await expect(coin.getByTestId('draft-replace')).toBeVisible();
  await expect(page.getByTestId('library-import-confirm')).toHaveText('Import 1 file');
  await coin.getByRole('button', { name: 'Remove coin.png' }).click();
  await page.getByTestId('library-import-confirm').click();
  await expect.poll(ours).toEqual([`${id}.png`]);

  // Info goes to the sidecar.
  await expect(page.getByTestId('library-details-id')).toHaveText(id);
  await page.getByPlaceholder('CC0, CC-BY 4.0…').fill('CC0');
  await page.getByTestId('library-save-info').click();
  await expect.poll(ours).toEqual([`${id}.png`, `${id}.png.json`]);

  // Rename the ID: the sidecar follows.
  await page.getByTestId('library-rename-start').click();
  await page.getByTestId('library-rename').fill(`${id}b`);
  await page.getByTestId('library-rename').press('Enter');
  await expect.poll(ours).toEqual([`${id}b.png`, `${id}b.png.json`]);
  await expect(page.getByTestId('library-details-id')).toHaveText(`${id}b`);

  await page.getByTestId('library-delete').click();
  await page.getByTestId('library-delete-confirm').click();
  await expect.poll(ours).toEqual([]);
  await expect(page.getByTestId('library-details')).toHaveCount(0);
});
