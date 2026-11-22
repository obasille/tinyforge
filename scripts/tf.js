#!/usr/bin/env node
// TinyForge command-line tools, for working without the editor:
//
//   pnpm tf export <game> [--out <dir>]   save the game as <dir>/<game>.zip (default: the current folder):
//                                         its folder and the library assets it uses, with their sidecars
//   pnpm tf import <file.zip> [--replace] add a game from such a zip; assets that differ from the
//                                         project's are kept unless --replace
//
// The same code as the editor's Export and Import (engine/tooling/game-zip.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { compileGame, diskPath, listProjectFiles, nodeFiles } from '../packages/engine/tooling/compile-game.ts';
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
else if (command === 'import') {
  const replace = rest.includes('--replace');
  await importGame(rest.filter((a) => a !== '--replace')[0], replace);
} else {
  fail('Commands: export <game> [--out <dir>], import <file.zip> [--replace]');
}
