// Compile a TinyForge cartridge with the AssemblyScript compiler's JS API.
//
// This uses the same settings as scripts/build-games.js: the options in
// assembly/games/asconfig.json (stub runtime, imported memory, memoryBase)
// plus its "debug" or "release" target. Output is returned in memory instead
// of being written to assets/cartridges, so the editor's dev server can serve
// debug builds without touching the classic host's release builds.
//
// After compiling, the game's metadata (TITLE, DESCRIPTION, AUTHOR and the
// optional COVER sprite, declared in its main.ts) is written into the module
// as a `tinyforge.meta` custom section (see cartridge-meta.ts).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CartridgeMeta, shiftSourceMap, withMeta } from './cartridge-meta.ts';

export const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES_DIR = path.join(ENGINE_ROOT, 'assembly', 'games');
export const SDK_DIR = path.join(ENGINE_ROOT, 'assembly', 'sdk');
export const MEMORY_MAP_FILE = path.join(ENGINE_ROOT, 'memory-map.ts');
export const ASCONFIG_FILE = path.join(GAMES_DIR, 'asconfig.json');
/** The repo's shared asset library (assets/sprites, assets/sfx, assets/music). */
export const ASSETS_DIR = path.resolve(ENGINE_ROOT, '..', '..', 'assets');

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
  let meta: CartridgeMeta;
  try {
    meta = readGameMeta(name);
  } catch (e) {
    return { ok: false, log: `${log}${e instanceof Error ? e.message : String(e)}\n` };
  }
  const withSection = withMeta(new Uint8Array(wasm), meta);
  const map = outputs.get(`${outName}.map`);
  return {
    ok: true,
    wasm: withSection.wasm as Uint8Array<ArrayBuffer>,
    sourceMap:
      map === undefined
        ? null
        : shiftSourceMap(
            absoluteSources(typeof map === 'string' ? map : new TextDecoder().decode(map)),
            withSection.inserted,
          ),
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

const META_FIELDS = ['TITLE', 'DESCRIPTION', 'AUTHOR', 'COVER'] as const;

/**
 * Read a game's metadata from the top-level string constants in its main.ts
 * (`const TITLE = "Pong";`). TITLE, DESCRIPTION and AUTHOR are required; COVER
 * is optional and names a sprite in the asset library. Throws a readable
 * error, reported like a compile error.
 */
export function readGameMeta(name: string): CartridgeMeta {
  const entry = gameEntry(name);
  const source = readFileSync(entry, 'utf8');
  const values: Partial<Record<(typeof META_FIELDS)[number], string>> = {};
  for (const field of META_FIELDS) {
    const decl = new RegExp(`^const ${field}\\b.*$`, 'm').exec(source);
    if (!decl) continue;
    const literal = new RegExp(`^const ${field}(?::\\s*string)?\\s*=\\s*("(?:[^"\\\\]|\\\\.)*");\\s*(?://.*)?$`).exec(
      decl[0],
    );
    if (!literal) throw new Error(`${entry}: ${field} must be a string literal, like: const ${field} = "...";`);
    values[field] = JSON.parse(literal[1]) as string;
  }
  for (const field of ['TITLE', 'DESCRIPTION', 'AUTHOR'] as const) {
    if (!values[field]) throw new Error(`${entry}: missing game metadata, add: const ${field} = "...";`);
  }
  return {
    title: values.TITLE ?? '',
    description: values.DESCRIPTION ?? '',
    author: values.AUTHOR ?? '',
    cover: values.COVER ? readCover(entry, values.COVER) : null,
  };
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** The sprite file whose id (the name before any `~` or `-`) is `id`. */
function readCover(entry: string, id: string): { type: string; bytes: Uint8Array } {
  const dir = path.join(ASSETS_DIR, 'sprites');
  const file = existsSync(dir)
    ? readdirSync(dir).find((f) => IMAGE_TYPES[path.extname(f).toLowerCase()] && spriteId(f) === id)
    : undefined;
  if (!file) throw new Error(`${entry}: COVER sprite "${id}" not found in assets/sprites`);
  return {
    type: IMAGE_TYPES[path.extname(file).toLowerCase()],
    bytes: new Uint8Array(readFileSync(path.join(dir, file))),
  };
}

function spriteId(file: string): string {
  const name = file.replace(/\.[^/.]+$/, '');
  const tilde = name.indexOf('~');
  const dash = name.indexOf('-');
  return tilde >= 0 ? name.slice(0, tilde) : dash >= 0 ? name.slice(0, dash) : name;
}
