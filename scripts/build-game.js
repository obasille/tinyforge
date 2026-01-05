#!/usr/bin/env node
// Build script that can build a single game or all games
// Usage:
//   node build-game.js                    - build all games (release)
//   node build-game.js debug              - build all games (debug)
//   node build-game.js <file>             - build single game (release)
//   node build-game.js debug <file>       - build single game (debug)
//   node build-game.js debug <f1> <f2>... - build multiple games (debug)

import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { basename } from 'path';

const args = process.argv.slice(2);
const isDebug = args[0] === 'debug';
const files = isDebug ? args.slice(1) : args;

const mode = isDebug ? 'debug' : 'release';
const target = isDebug ? '--target debug' : '';

function buildGame(fileName, showMode = false) {
  const modeLabel = showMode && isDebug ? ' (debug)' : '';
  console.log(`Building ${fileName}${modeLabel}...`);
  
  try {
    execSync(
      `npx asc games/${fileName}.ts -o cartridges/${fileName}.wasm --config games/asconfig.json ${target}`,
      { stdio: 'inherit' }
    );
    console.log(`✓ ${fileName}`);
    return true;
  } catch (error) {
    console.error(`✗ ${fileName} failed`);
    return false;
  }
}

// Mode 1: Build all games
if (files.length === 0) {
  const gamesDir = 'games';
  
  const gameFiles = readdirSync(gamesDir)
    .filter(file => file.endsWith('.ts'))
    .map(file => file.replace('.ts', ''));

  if (gameFiles.length === 0) {
    console.log('No game files found in games/ directory');
    process.exit(0);
  }

  console.log(`Building ${gameFiles.length} game(s) in ${mode} mode...`);

  let failed = 0;
  for (const game of gameFiles) {
    if (!buildGame(game)) failed++;
  }

  if (failed > 0) {
    console.error(`\n${failed} game(s) failed to build`);
    process.exit(1);
  }

  console.log(`\n✓ All games built successfully`);
  process.exit(0);
}

// Mode 2: Build specific game(s)
let failed = 0;
for (const filePath of files) {
  // Remove .ts extension if present
  let fileName = basename(filePath, '.ts');
  
  // If no .ts was removed, try removing it from the original
  if (fileName === filePath && filePath.endsWith('.ts')) {
    fileName = filePath.slice(0, -3);
  }
  
  // Check if path includes directory
  const parts = filePath.split(/[\/\\]/);
  const dir = parts.length > 1 ? parts[0] : 'games';
  
  // For simple filenames, extract just the basename
  if (parts.length === 1) {
    fileName = parts[0].replace(/\.ts$/, '');
  }

  if (dir !== 'games') {
    console.error(`Skipping ${filePath} - not in games/ directory`);
    failed++;
    continue;
  }

  if (!buildGame(fileName, true)) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} game(s) failed to build`);
  process.exit(1);
}
