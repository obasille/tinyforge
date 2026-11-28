// The file tree, the code editor and the in-browser compiler, against the
// real dev server. Each test works in a game folder of its own, removed
// afterwards.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const GAMES = path.join(REPO, 'packages', 'engine', 'assembly', 'games');

let game = '';

test.beforeEach(async ({ page }) => {
  game = `e2e${Date.now().toString(36)}`;
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('tf-test-init')) {
      localStorage.clear();
      sessionStorage.setItem('tf-test-init', '1');
    }
  });
});

test.afterEach(() => {
  rmSync(path.join(GAMES, game), { recursive: true, force: true });
});

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

const mainPath = () => `games/${game}/main.ts`;

/** Text, diagnostics and state of the open code editor for a file. */
async function code(page: Page, file: string) {
  return page.evaluate((f) => {
    const e = window.__tf?.editor.workbench.editorsFor(f)[0];
    return e ? { text: e.text, state: e.state.getState(), diagnostics: e.shownDiagnostics() } : null;
  }, file);
}

async function setText(page: Page, file: string, edit: [string, string]) {
  await page.evaluate(
    ([f, from, to]) => {
      const e = window.__tf?.editor.workbench.editorsFor(f)[0];
      if (!e) throw new Error(`${f} is not open`);
      e.setText(e.text.replace(from, to));
      e.focus();
    },
    [file, ...edit],
  );
}

/** Run an action of the Files panel's menu. */
async function fileAction(page: Page, name: string): Promise<void> {
  await page.getByTestId('files-menu').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Open the Files menu, check its Export items, and close it. */
async function exportItems(page: Page, check: (exp: Locator, cart: Locator) => Promise<void>): Promise<void> {
  await page.getByTestId('files-menu').click();
  await check(page.getByTestId('files-export'), page.getByTestId('files-export-cartridge'));
  await page.keyboard.press('Escape');
}

/** Create a game with the Files panel and wait for its code panel. */
async function createGame(page: Page): Promise<void> {
  await fileAction(page, 'New game');
  await page.getByTestId('files-name').fill(game);
  await page.getByTestId('files-name').press('Enter');
  await expect(page.getByTestId(`code-${mainPath()}`).locator('.cm-content')).toContainText(`const TITLE = "${game}"`);
  expect(existsSync(path.join(GAMES, game, 'main.ts'))).toBe(true);
}

test('the file tree opens files in the code editor; engine files are read-only', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByTestId('file-games/pong').click();
  await page.getByTestId('file-games/pong/main.ts').click();
  const panel = page.getByTestId('code-games/pong/main.ts');
  await expect(panel.locator('.cm-content')).toContainText('const TITLE = "Pong"');
  await expect(page.locator('.dv-default-tab', { hasText: 'main.ts' })).toBeVisible();

  await page.getByTestId('file-engine').click();
  await page.getByTestId('file-engine/sdk').click();
  await page.getByTestId('file-engine/sdk/drawing.ts').click();
  const sdk = page.getByTestId('code-engine/sdk/drawing.ts');
  await expect(sdk).toContainText('Read-only');
  await expect(sdk.locator('.cm-content')).toHaveAttribute('aria-readonly', 'true');
  expect(errors).toEqual([]);
});

test('the tree has Code, Assets and Engine sections; the active code tab is highlighted', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect(page.getByTestId('files').locator('.tf-files-section-head .tf-files-name')).toHaveText([
    'Code',
    'Assets',
    'Engine',
  ]);

  // Opening a file reveals it: its folders open and its row is marked.
  const pong = page.getByTestId('file-games/pong/main.ts');
  const drawing = page.getByTestId('file-engine/sdk/drawing.ts');
  await page.evaluate(() => window.__tf?.editor.workbench.openFile('games/pong/main.ts'));
  await expect(pong).toHaveClass(/tf-files-active/);
  await page.evaluate(() => window.__tf?.editor.workbench.openFile('engine/sdk/drawing.ts'));
  await expect(drawing).toHaveClass(/tf-files-active/);
  await expect(drawing).toBeInViewport();
  await expect(pong).not.toHaveClass(/tf-files-active/);

  // Switching tabs moves the mark; focusing another panel keeps it.
  await page.locator('.dv-default-tab', { hasText: 'main.ts' }).click();
  await expect(pong).toHaveClass(/tf-files-active/);
  await page.locator('.dv-default-tab', { hasText: 'Game' }).click();
  await expect(pong).toHaveClass(/tf-files-active/);

  // Closing the active tab moves the mark to the code tab still shown.
  await page.locator('.dv-default-tab', { hasText: 'main.ts' }).locator('.dv-default-tab-action').click();
  await expect(drawing).toHaveClass(/tf-files-active/);
  expect(errors).toEqual([]);
});

test('a new game compiles in the browser; saving hot reloads it and keeps its state', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await createGame(page);
  await page.evaluate((g) => window.__tf?.editor.selectGame(g), game);
  await expect.poll(async () => await page.evaluate(() => window.__tf?.session.getState().game)).toBe(game);
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect(page.getByTestId('console')).toContainText(`Compiled ${game}`);

  // Move the square: its X lives in game RAM at offset 0.
  const x = () =>
    page.evaluate(async () => {
      const s = await window.__tf?.snapshot();
      return s ? new DataView(s.buffer).getInt32(0x50000, true) : -1;
    });
  await page.getByTestId('viewport').focus();
  await page.keyboard.down('ArrowRight');
  await expect.poll(x).toBeGreaterThan(170);
  await page.keyboard.up('ArrowRight');
  const moved = await x();

  // Edit and save with Ctrl+S: the file changes on disk and the game hot reloads with its state.
  await setText(page, mainPath(), ['c(0x141828)', 'c(0x402020)']);
  await expect.poll(async () => (await code(page, mainPath()))?.state.dirty).toBe(true);
  await expect(page.locator('.dv-default-tab', { hasText: '● main.ts' })).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await code(page, mainPath()))?.state.dirty).toBe(false);
  expect(readFileSync(path.join(GAMES, game, 'main.ts'), 'utf8')).toContain('c(0x402020)');
  await expect(page.getByTestId('console')).toContainText(`${game} changed, rebuilding and hot reloading`);
  await expect.poll(() => page.getByTestId('console').getByText(`Compiled ${game}`).count()).toBe(2);
  expect(await x()).toBe(moved);

  // Undo (outside the text) puts the previous file back on disk and in the buffer.
  await page.getByTestId('viewport').focus();
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => readFileSync(path.join(GAMES, game, 'main.ts'), 'utf8')).toContain('c(0x141828)');
  await expect.poll(async () => (await code(page, mainPath()))?.text).toContain('c(0x141828)');
  expect(errors).toEqual([]);
});

test('unknown asset IDs are underlined while typing, IDs autocomplete, compile errors show in place', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await createGame(page);

  await setText(page, mainPath(), [
    'export function draw(): void {',
    'export function draw(): void {\n  s("pong_cov");',
  ]);
  await expect
    .poll(async () => (await code(page, mainPath()))?.diagnostics.map((d) => d.message))
    .toEqual(['Unknown sprite "pong_cov": no file with that ID in assets/sprites.']);
  const used = () => page.evaluate(() => window.__tf?.editor.workbench.usedAssets.getState().sprites);
  expect(await used()).toEqual([]);

  // Complete the ID inside the string.
  const pos = ((await code(page, mainPath()))?.text.indexOf('"pong_cov"') ?? 0) + '"pong_cov'.length;
  await page.evaluate(
    ([f, p]) => {
      const e = window.__tf?.editor.workbench.editorsFor(f as string)[0];
      e?.select(p as number);
      e?.focus();
    },
    [mainPath(), pos],
  );
  await page.keyboard.type('e');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('pong_cover');
  // CodeMirror ignores Enter for a moment after the list opens.
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await code(page, mainPath()))?.diagnostics).toEqual([]);
  await expect.poll(async () => (await code(page, mainPath()))?.text).toContain('s("pong_cover");');

  // A type error comes back from the compiler at its place in the file.
  await setText(page, mainPath(), ['setI32(Y, 116);', 'setI32(Y, "x");']);
  await page.keyboard.press('Control+s');
  await expect
    .poll(async () => (await code(page, mainPath()))?.diagnostics.map((d) => d.message))
    .toContain("Type '~lib/string/String' is not assignable to type 'i32'.");
  // The Files list shows how many errors the game's build has.
  await expect(page.getByTestId(`build-${game}`)).toHaveText(/^[1-9]\d* errors?$/);
});

test('a game that does not compile shows its errors in the Game tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await createGame(page);
  const file = path.join(GAMES, game, 'main.ts');
  const good = readFileSync(file, 'utf8');
  const broken = good.replace('setI32(Y, 116);', 'setI32(Y, "x");');
  expect(broken).not.toBe(good);
  writeFileSync(file, broken);

  // Choosing it stops the game that was running and shows the first error.
  await page.evaluate((g) => window.__tf?.editor.selectGame(g), game);
  const banner = page.getByTestId('compile-error');
  await expect(banner).toContainText(`${game} does not compile`);
  await expect(banner).toContainText(`games/${game}/main.ts:`);
  await expect(page.getByTestId('run-status')).toHaveText('idle');

  // The error's place in the console opens the code editor at that line.
  await page
    .getByTestId('console')
    .getByRole('button', { name: new RegExp(`games/${game}/main\\.ts\\(\\d+,\\d+\\)`) })
    .first()
    .click();
  const editor = page.getByTestId(`code-${mainPath()}`);
  await expect(editor.locator('.cm-activeLine')).toContainText('setI32(Y, "x");');

  // Fixed, it runs; broken again, its last good build keeps running.
  writeFileSync(file, good);
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await expect(banner).toHaveCount(0);
  writeFileSync(file, broken);
  await expect(banner).toContainText('running its last good build');
  await expect(page.getByTestId('run-status')).toHaveText('running');
});

test('a file changed on disk reloads a clean buffer and asks before replacing edits', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await createGame(page);
  const file = path.join(GAMES, game, 'main.ts');

  writeFileSync(file, readFileSync(file, 'utf8').replace('A new game', 'Changed outside'));
  await expect.poll(async () => (await code(page, mainPath()))?.text).toContain('Changed outside');

  await setText(page, mainPath(), ['Changed outside', 'Mine']);
  writeFileSync(file, readFileSync(file, 'utf8').replace('Changed outside', 'Theirs'));
  const panel = page.getByTestId(`code-${mainPath()}`);
  await expect(panel.getByTestId('code-conflict')).toContainText('changed on disk');
  await panel.getByRole('button', { name: 'Use the file on disk' }).click();
  await expect.poll(async () => (await code(page, mainPath()))?.text).toContain('Theirs');
  await expect(panel.getByTestId('code-conflict')).toHaveCount(0);
});

test('files can be created, renamed and deleted from the tree, with undo', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await createGame(page);
  const dir = path.join(GAMES, game);

  await page.getByTestId(`file-games/${game}`).click(); // select the folder (it stays open)
  await expect(page.getByTestId(`file-games/${game}/main.ts`)).toHaveCount(0);
  // Export follows the selection: this game's folder, not the code root.
  await exportItems(page, (exp) => expect(exp).toHaveAttribute('title', new RegExp(`^Save ${game} as a zip`)));
  await page.getByTestId('file-games').click();
  await exportItems(page, async (exp, cart) => {
    await expect(exp).toBeDisabled();
    await expect(cart).toBeDisabled();
  });
  await page.getByTestId('file-games').click();
  await page.getByTestId('file-games/pong').click();
  await exportItems(page, (exp) => expect(exp).toHaveAttribute('title', /^Save pong as a zip/));
  await page.getByTestId(`file-games/${game}`).click();
  await fileAction(page, 'New file');
  await page.getByTestId('files-name').fill('level.ts');
  await page.getByTestId('files-name').press('Enter');
  await expect.poll(() => existsSync(path.join(dir, 'level.ts'))).toBe(true);

  await page.getByTestId(`file-games/${game}/level.ts`).click();
  await fileAction(page, 'Rename');
  await page.getByTestId('files-name').fill('levels.ts');
  await page.getByTestId('files-name').press('Enter');
  await expect.poll(() => existsSync(path.join(dir, 'levels.ts'))).toBe(true);
  expect(existsSync(path.join(dir, 'level.ts'))).toBe(false);

  await page.getByTestId(`file-games/${game}/levels.ts`).click();
  await fileAction(page, 'Delete');
  await page.getByTestId('files-confirm').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => existsSync(path.join(dir, 'levels.ts'))).toBe(false);
  await expect(page.getByTestId(`file-games/${game}/levels.ts`)).toHaveCount(0);

  // Ctrl+Z (outside a text field) brings it back.
  await page.getByTestId('viewport').focus();
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => existsSync(path.join(dir, 'levels.ts'))).toBe(true);

  // Deleting the game folder, while it runs, removes the game from the picker.
  await page.evaluate((g) => window.__tf?.editor.selectGame(g), game);
  await expect.poll(() => page.evaluate(() => window.__tf?.session.getState().game)).toBe(game);
  await page.getByTestId(`file-games/${game}`).click();
  await fileAction(page, 'Delete');
  await page.getByTestId('files-confirm').getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => existsSync(dir)).toBe(false);
  await expect.poll(() => page.evaluate((g) => window.__tf?.files.games.includes(g), game)).toBe(false);
  // It was running: another game runs instead, and Ctrl+Z brings back both the game and the choice.
  await expect.poll(() => page.evaluate(() => window.__tf?.project.getState().game)).toBe('pong');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByTestId('viewport').focus();
  await page.keyboard.press('Control+KeyZ');
  await expect.poll(() => existsSync(path.join(dir, 'main.ts'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__tf?.project.getState().game)).toBe(game);
  await expect.poll(() => page.evaluate(() => window.__tf?.session.getState().game)).toBe(game);
  // Redo deletes it again and runs pong again.
  await page.keyboard.press('Control+Shift+KeyZ');
  await expect.poll(() => existsSync(dir)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__tf?.project.getState().game)).toBe('pong');
  expect(errors).toEqual([]);
});

test('a game exports as a zip and imports back as one undo step', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await createGame(page);
  await page.getByTestId(`file-${mainPath()}`).click();
  const download = page.waitForEvent('download');
  await fileAction(page, 'Export');
  const zip = await download;
  expect(zip.suggestedFilename()).toBe(`${game}.zip`);
  const zipFile = path.join(test.info().outputDir, `${game}.zip`);
  await zip.saveAs(zipFile);

  // Remove the game, then bring it back from the zip.
  rmSync(path.join(GAMES, game), { recursive: true, force: true });
  await expect.poll(() => page.evaluate((g) => window.__tf?.editor.games.includes(g), game)).toBe(false);
  await page.getByTestId('files-import-input').setInputFiles(zipFile);
  await expect.poll(() => existsSync(path.join(GAMES, game, 'main.ts'))).toBe(true);
  await expect(page.getByRole('button', { name: `Undo Import game '${game}'` })).toBeVisible();

  // Importing it again is refused: the game exists.
  await page.getByTestId('files-import-input').setInputFiles(zipFile);
  await expect(page.getByTestId('files').getByRole('alert')).toContainText(`already has a game named ${game}`);

  await page.getByRole('button', { name: `Undo Import game '${game}'` }).click();
  await expect.poll(() => existsSync(path.join(GAMES, game, 'main.ts'))).toBe(false);
  expect(errors).toEqual([]);
});

test('a game exports as a cartridge whose assets the library imports', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.getByTestId('run-status')).toHaveText('running');
  await page.getByTestId('file-games/pong').click();
  await page.getByTestId('file-games/pong/main.ts').click();
  const download = page.waitForEvent('download');
  await fileAction(page, 'Cartridge');
  const cartridge = await download;
  expect(cartridge.suggestedFilename()).toBe('pong.wasm');
  const wasmFile = path.join(test.info().outputDir, 'pong.wasm');
  await cartridge.saveAs(wasmFile);
  // Still a cartridge the engine accepts, with its sounds inside.
  const module = await WebAssembly.compile(readFileSync(wasmFile));
  expect(WebAssembly.Module.customSections(module, 'tinyforge.assets')).toHaveLength(1);

  await page.locator('.dv-tab', { hasText: 'Library' }).click();
  await page.getByTestId('library-file-input').setInputFiles(wasmFile);
  await expect(page.getByTestId('draft-pong_hit_p1.wav')).toBeVisible();
  await expect(page.getByTestId('draft-pong_theme.wav')).toBeVisible();

  // A game that uses no assets has none to import.
  await createGame(page);
  await page.getByTestId(`file-${mainPath()}`).click();
  const plain = page.waitForEvent('download');
  await fileAction(page, 'Cartridge');
  const plainFile = path.join(test.info().outputDir, `${game}.wasm`);
  await (await plain).saveAs(plainFile);
  await page.locator('.dv-tab', { hasText: 'Library' }).click();
  await page.getByTestId('library-file-input').setInputFiles(plainFile);
  await expect(page.getByTestId('library')).toContainText('has no embedded assets');
  expect(errors).toEqual([]);
});
