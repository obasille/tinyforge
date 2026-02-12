// scripts/check-alloc.js
// Checks a WASM file for allocation symbols (cross-platform)

import { execSync } from 'child_process';
import path from 'path';
import { mkdirSync } from 'fs';

const GAME = process.argv[2];
if (!GAME) {
  console.error('Usage: node scripts/check-alloc.js <game>');
  process.exit(1);
}

// Build debug version to a temp file in tmp/
const tmpDir = path.join('tmp', 'debug-builds');
const tempWasm = path.join(tmpDir, `${GAME}.wasm`);
try {
  mkdirSync(tmpDir, { recursive: true });
  execSync(`node scripts/build-games.js debug ${GAME} --outdir ${tmpDir}`, {
    stdio: 'inherit',
    shell: true,
  });
} catch (err) {
  console.error('Error building debug WASM:', err.message);
  process.exit(1);
}

const wasmPath = tempWasm;

const symbols = [
  '__new',
  '__alloc',
  '__realloc',
  '__free',
  'memory.grow',
  'malloc',
];

try {
  const objdump =
    process.platform === 'win32' ? 'wasm-objdump.exe' : 'wasm-objdump';
  const output = execSync(`${objdump} -x ${wasmPath}`, { encoding: 'utf8' });
  let found = false;
  for (const sym of symbols) {
    if (output.includes(sym)) {
      console.log(`Found allocation symbol: ${sym}`);
      found = true;
    }
  }
  if (!found) {
    console.log('No allocation symbols found.');
  }
} catch (err) {
  console.error('Error running wasm-objdump or reading file:', err.message);
  process.exit(1);
}
