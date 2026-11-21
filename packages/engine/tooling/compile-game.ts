// Compile a TinyForge cartridge with the AssemblyScript compiler's JS API.
//
// This uses the same settings as scripts/build-games.js: the options in
// assembly/games/asconfig.json (stub runtime, imported memory, memoryBase)
// plus its "debug" or "release" target. Output is returned in memory instead
// of being written to assets/cartridges, so the editor's dev server can serve
// debug builds without touching the classic host's release builds.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES_DIR = path.join(ENGINE_ROOT, 'assembly', 'games');
export const SDK_DIR = path.join(ENGINE_ROOT, 'assembly', 'sdk');
export const MEMORY_MAP_FILE = path.join(ENGINE_ROOT, 'memory-map.ts');
export const ASCONFIG_FILE = path.join(GAMES_DIR, 'asconfig.json');

export type CompileTarget = 'debug' | 'release';

export type CompileResult =
  | { ok: true; wasm: Uint8Array<ArrayBuffer>; sourceMap: string | null; log: string }
  | { ok: false; log: string };

/** Entry file of a game: games/<name>/main.ts. */
export function gameEntry(name: string): string {
  return path.join(GAMES_DIR, name, 'main.ts');
}

/** Names of all games: each folder in assembly/games that has a main.ts. */
export function listGames(): string[] {
  return readdirSync(GAMES_DIR)
    .filter((f: string) => statSync(path.join(GAMES_DIR, f)).isDirectory() && existsSync(gameEntry(f)))
    .sort();
}

/**
 * Which games a changed file affects. A file in the SDK or the memory map
 * affects every game; a file anywhere in games/<name>/ affects <name>.
 * Returns null when the file is not engine source.
 */
export function gamesAffectedBy(file: string): string[] | null {
  const abs = path.resolve(file);
  if (!abs.endsWith('.ts') && !abs.endsWith('asconfig.json')) return null;
  if (abs === MEMORY_MAP_FILE || abs.startsWith(SDK_DIR + path.sep) || abs === ASCONFIG_FILE) {
    return listGames();
  }
  if (!abs.startsWith(GAMES_DIR + path.sep)) return null;
  const rel = path.relative(GAMES_DIR, abs).split(path.sep);
  if (rel.length === 1) return [];
  return existsSync(gameEntry(rel[0])) ? [rel[0]] : [];
}

/** Compile one game. Never throws for compile errors; they are in `log`. */
export async function compileGame(name: string, target: CompileTarget = 'debug'): Promise<CompileResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !listGames().includes(name)) {
    return { ok: false, log: `Unknown game "${name}"` };
  }
  const asc = (await import('assemblyscript/asc')).default;
  const outName = `${name}.wasm`;
  const outputs = new Map<string, Uint8Array | string>();
  let log = '';
  const sink = {
    write(chunk: string | Uint8Array) {
      log += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    },
  };

  const { error } = await asc.main(
    [
      gameEntry(name),
      '--config',
      ASCONFIG_FILE,
      '--target',
      target,
      '--outFile',
      outName,
      ...(target === 'debug' ? ['--sourceMap'] : []),
    ],
    {
      stdout: sink,
      stderr: sink,
      writeFile(filename: string, contents: Uint8Array | string) {
        outputs.set(path.basename(filename), contents);
      },
    },
  );

  const wasm = outputs.get(outName);
  if (error || !(wasm instanceof Uint8Array)) {
    return { ok: false, log: log || String(error ?? 'No output produced') };
  }
  const map = outputs.get(`${outName}.map`);
  return {
    ok: true,
    wasm: new Uint8Array(wasm),
    sourceMap:
      map === undefined ? null : absoluteSources(typeof map === 'string' ? map : new TextDecoder().decode(map)),
    log,
  };
}

/**
 * asc writes source paths relative to the process's working directory. Make
 * them absolute so a server can map them to URLs; `~lib/` (the AssemblyScript
 * standard library) is left as is.
 */
function absoluteSources(mapJson: string): string {
  const map = JSON.parse(mapJson) as { sources?: string[] };
  map.sources = map.sources?.map((s) => (s.startsWith('~lib/') ? s : path.resolve(process.cwd(), s)));
  return JSON.stringify(map);
}
