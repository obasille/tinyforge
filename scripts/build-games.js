#!/usr/bin/env node
// Build script that can build a single game or all games
// Usage:
// Each game is a folder in packages/engine/assembly/games with a main.ts.
// Usage:
//   node build-games.js                    - build all games (release)
//   node build-games.js debug              - build all games (debug)
//   node build-games.js <game>             - build one game (release)
//   node build-games.js debug <game>       - build one game (debug)
//   node build-games.js debug <g1> <g2>... - build several games (debug)
// A game can be given by name (pong) or by any path inside its folder
// (packages/engine/assembly/games/pong/main.ts).

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { runAsc } from './lib/asc.js';

const GAMES_DIR = 'packages/engine/assembly/games';
const entryOf = (game) => `${GAMES_DIR}/${game}/main.ts`;

// Parse --outdir option
let args = process.argv.slice(2);
let outputDir = 'assets/cartridges';
const outdirIdx = args.indexOf('--outdir');
if (outdirIdx !== -1 && args.length > outdirIdx + 1) {
  outputDir = args[outdirIdx + 1];
  args = args.slice(0, outdirIdx).concat(args.slice(outdirIdx + 2));
}

const isDebug = args[0] === 'debug';
const files = isDebug ? args.slice(1) : args;

const mode = isDebug ? 'debug' : 'release';
const target = isDebug ? 'debug' : 'release';

function buildGame(fileName, showMode = false) {
  const modeLabel = showMode && isDebug ? ' (debug)' : '';
  console.log(`Building ${fileName}${modeLabel}...`);

  try {
    mkdirSync(outputDir, { recursive: true });
    runAsc([
      entryOf(fileName),
      '-o',
      `${outputDir}/${fileName}.wasm`,
      '--config',
      `${GAMES_DIR}/asconfig.json`,
      '--target',
      target,
    ]);
    console.log(`✓ ${fileName}`);
    return true;
  } catch {
    console.error(`✗ ${fileName} failed`);
    return false;
  }
}

// Mode 1: Build all games
if (files.length === 0) {
  const games = readdirSync(GAMES_DIR)
    .filter((name) => statSync(`${GAMES_DIR}/${name}`).isDirectory() && existsSync(entryOf(name)))
    .sort();

  if (games.length === 0) {
    console.log(`No games found in ${GAMES_DIR}/ (expected <game>/main.ts)`);
    process.exit(0);
  }

  console.log(`Building ${games.length} game(s) in ${mode} mode...`);

  let failed = 0;
  for (const game of games) {
    if (!buildGame(game)) failed++;
  }

  if (failed > 0) {
    console.error(`\n${failed} game(s) failed to build`);
    process.exit(1);
  }

  console.log(`\n✓ All games built successfully`);
  process.exit(0);
}

// Mode 2: Build specific game(s), given by name or by a path inside the game's folder
let failed = 0;
for (const arg of files) {
  const rel = path.relative(GAMES_DIR, path.resolve(arg)).split(path.sep);
  const game = arg.includes('/') || arg.includes('\\') ? (rel[0] === '..' ? null : rel[0]) : arg;

  if (!game || !existsSync(entryOf(game))) {
    console.error(`Skipping ${arg} - not a game in ${GAMES_DIR}/ (expected <game>/main.ts)`);
    failed++;
    continue;
  }

  if (!buildGame(game, true)) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} game(s) failed to build`);
  process.exit(1);
}
