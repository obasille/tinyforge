#!/usr/bin/env node
// TinyForge command-line tools, for working without the editor. `pnpm tf help`
// lists the commands (USAGE below). The same code as the editor's Export,
// Import and Cartridge (engine/tooling/game-zip.ts, cartridge-assets.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compileGame, diskPath, listProjectFiles, nodeFiles } from '../packages/engine/tooling/compile-game.ts';
import { cartridgeAssetPaths, embedAssets } from '../packages/engine/tooling/cartridge-assets.ts';
import { coverIdOf } from '../packages/engine/tooling/game-meta.ts';
import { planImport, readGameZip, zipGame } from '../packages/engine/tooling/game-zip.ts';

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  if (i < 0) return null;
  const value = rest[i + 1];
  rest.splice(i, 2);
  return value ?? '';
};

const USAGE = `TinyForge command line (pnpm tf <command>):

  export <game> [--out <dir>]      save the game as <dir>/<game>.zip (default: the current folder):
                                   its folder and the library assets it uses, with their sidecars
  import <file.zip> [--replace]    add a game from such a zip; assets that differ from the
                                   project's are kept unless --replace
  cartridge <game> [--out <dir>]   save a playable <dir>/<game>.wasm: a release build with the
                                   library files it uses (and its cover) embedded
  help                             this list

Builds: pnpm build:games (all games), pnpm build:debug. The editor: pnpm dev, or
pnpm editor:static for a read-only copy with no AI. Deploying the editor:
pnpm build:editor, pnpm upload:editor, pnpm ai:setup (see README.md).`;

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function exportGame(game, outDir) {
  if (!game) fail('Usage: pnpm tf export <game> [--out <dir>]');
  const files = nodeFiles();
  const main = await files.readText(`games/${game}/main.ts`);
  if (main === null) fail(`No game named ${game}`);
  // The compile finds the assets the game uses (and checks they exist).
  const result = await compileGame(game, 'release');
  if (!result.ok) {
    process.stderr.write(result.log);
    fail(`${game} does not compile: fix it first (the editor can export it as it is)`);
  }
  const used = result.meta.assets;
  const cover = coverIdOf(main);
  if (cover && !used.sprites.includes(cover)) used.sprites.push(cover);
  const paths = (await listProjectFiles()).map((f) => f.path);
  const zip = await zipGame(game, paths, used, (p) => files.readBytes(p));
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${game}.zip`);
  writeFileSync(out, zip);
  console.log(`✓ ${out} (${(zip.length / 1024).toFixed(1)} KB)`);
}

async function exportCartridge(game, outDir) {
  if (!game) fail('Usage: pnpm tf cartridge <game> [--out <dir>]');
  const files = nodeFiles();
  const main = await files.readText(`games/${game}/main.ts`);
  if (main === null) fail(`No game named ${game}`);
  const result = await compileGame(game, 'release');
  if (!result.ok) {
    process.stderr.write(result.log);
    fail(`${game} does not compile`);
  }
  const paths = (await listProjectFiles()).map((f) => f.path);
  const assets = [];
  for (const p of cartridgeAssetPaths(paths, result.meta.assets, coverIdOf(main))) {
    const [, kind, file] = p.split('/');
    assets.push({ kind, file, bytes: await files.readBytes(p) });
  }
  const wasm = embedAssets(result.wasm, assets);
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${game}.wasm`);
  writeFileSync(out, wasm);
  console.log(`✓ ${out} (${(wasm.length / 1024).toFixed(1)} KB, ${assets.length} asset file(s))`);
}

async function importGame(file, replace) {
  if (!file) fail('Usage: pnpm tf import <file.zip> [--replace]');
  if (!existsSync(file)) fail(`${file} not found`);
  let parsed;
  try {
    parsed = await readGameZip(new Uint8Array(readFileSync(file)));
  } catch (e) {
    fail(`${file}: ${e.message}`);
  }
  const files = nodeFiles();
  const paths = (await listProjectFiles()).map((f) => f.path);
  const exists = paths.some((p) => p.startsWith(`games/${parsed.game}/`));
  const plan = await planImport(parsed, (p) => files.readBytes(p), exists);
  if (plan.gameExists) fail(`The project already has a game named ${plan.game}`);
  const writes = [...plan.added, ...(replace ? plan.changed : [])];
  for (const { path: projectPath, bytes } of writes) {
    const target = diskPath(projectPath);
    if (!target) fail(`${projectPath} is outside the project`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    console.log(`  + ${projectPath}`);
  }
  for (const f of replace ? [] : plan.changed) console.log(`  kept ${f.path} (the zip's differs; --replace takes it)`);
  console.log(`✓ Imported ${plan.game}: ${writes.length} file(s) written, ${plan.same.length} already the same`);
}

if (command === 'export') {
  const out = flag('--out') ?? '.';
  await exportGame(rest[0], out);
}
else if (command === 'cartridge') {
  const out = flag('--out') ?? '.';
  await exportCartridge(rest[0], out);
} else if (command === 'import') {
  const replace = rest.includes('--replace');
  await importGame(rest.filter((a) => a !== '--replace')[0], replace);
} else if (command === 'help' || command === '--help' || command === undefined) {
  console.log(USAGE);
} else {
  console.error(USAGE);
  fail(`Unknown command ${command}`);
}
