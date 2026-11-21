// Compile a TinyForge cartridge with the AssemblyScript compiler's JS API.
//
// This uses the options in assembly/games/asconfig.json (stub runtime,
// imported memory) plus its "debug" or "release" target, and sets memoryBase
// to RAM_START + the game's RAM_SIZE, so static data starts right after the
// game's RAM. scripts/build-games.js uses this too. Output is returned in
// memory instead of being written to assets/cartridges, so the editor's dev
// server can serve debug builds without touching the classic host's release
// builds.
//
// The asset scan (asset-scan.ts) runs as a compiler hook: an unknown asset ID
// is a compile error, and the IDs the game uses go into its metadata.
//
// After compiling, the game's metadata (TITLE, DESCRIPTION, AUTHOR and the
// optional COVER sprite, declared in its main.ts, plus the assets used) is
// written into the module as a `tinyforge.meta` custom section (see
// cartridge-meta.ts).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Transform } from 'assemblyscript/transform';
import { DEFAULT_RAM_SIZE, LAYOUT_VERSION, RAM_START } from '../memory-map.ts';
import {
  ASSET_KINDS,
  ASSET_PATTERNS,
  type AssetKind,
  type AssetLibrary,
  assetId,
  createAssetScan,
  libraryFromFiles,
} from './asset-scan.ts';
import { type CartridgeMeta, importedMemory, shiftSourceMap, withMeta } from './cartridge-meta.ts';

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

/**
 * Which games a change in the asset library affects, or null when the file is
 * not in the library. Adding or removing a file can make an asset ID valid or
 * unknown, so it affects every game; editing a file affects only the games
 * that use it as their COVER (copied into the cartridge). Sprites and sounds
 * the game uses are loaded by the host, so their edits need no rebuild.
 */
export function gamesAffectedByAsset(file: string, event: 'add' | 'change' | 'unlink'): string[] | null {
  const abs = path.resolve(file);
  const kind = ASSET_KINDS.find((k) => abs.startsWith(path.join(ASSETS_DIR, k) + path.sep));
  if (!kind || !ASSET_PATTERNS[kind].test(abs)) return null;
  if (event !== 'change') return listGames();
  if (kind !== 'sprites') return [];
  const id = assetId(path.basename(abs));
  return listGames().filter((game) => {
    try {
      return coverId(game) === id;
    } catch {
      return false;
    }
  });
}

/** Compile one game. Never throws for compile errors; they are in `log`. */
export async function compileGame(name: string, target: CompileTarget = 'debug'): Promise<CompileResult> {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !listGames().includes(name)) {
    return { ok: false, log: `Unknown game "${name}"` };
  }
  // Metadata first: RAM_SIZE decides where static data starts.
  let gameMeta: ReturnType<typeof readGameMeta>;
  try {
    gameMeta = readGameMeta(name);
  } catch (e) {
    return { ok: false, log: `${e instanceof Error ? e.message : String(e)}\n` };
  }
  const asc = (await import('assemblyscript/asc')).default;
  const scan = createAssetScan(readLibrary());
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
      '--memoryBase',
      String(RAM_START + gameMeta.ram),
      ...(target === 'debug' ? ['--sourceMap'] : []),
    ],
    {
      // asc instantiates class transforms and uses objects as they are; its
      // typings only describe the class form.
      transforms: [scan.transform as unknown as Transform],
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
  const memory = importedMemory(wasm);
  if (!memory) return { ok: false, log: `${log}${name}: the module imports no memory\n` };
  const meta: CartridgeMeta = {
    ...gameMeta,
    layout: LAYOUT_VERSION,
    memory: memory.min * 65536,
    assets: scan.used(),
  };
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
type MetaField = (typeof META_FIELDS)[number];

/** COVER sprite ID declared in a game's main.ts, if any. */
function coverId(name: string): string | undefined {
  return readMetaFields(name).COVER;
}

/** The metadata constants declared in a game's main.ts. */
function readMetaFields(name: string): Partial<Record<MetaField, string>> {
  const entry = gameEntry(name);
  const source = readFileSync(entry, 'utf8');
  const values: Partial<Record<MetaField, string>> = {};
  for (const field of META_FIELDS) {
    const decl = new RegExp(`^const ${field}\\b.*$`, 'm').exec(source);
    if (!decl) continue;
    const literal = new RegExp(`^const ${field}(?::\\s*string)?\\s*=\\s*("(?:[^"\\\\]|\\\\.)*");\\s*(?://.*)?$`).exec(
      decl[0],
    );
    if (!literal) throw new Error(`${entry}: ${field} must be a string literal, like: const ${field} = "...";`);
    values[field] = JSON.parse(literal[1]) as string;
  }
  return values;
}

/** Largest RAM_SIZE a game can declare (256 MB). */
export const MAX_RAM_SIZE = 0x10000000;

/**
 * The game's RAM_SIZE (`const RAM_SIZE: i32 = 0x2000;` in main.ts), or the
 * default when it declares none. A whole number literal, a multiple of 16.
 */
export function readRamSize(entry: string, source: string): number {
  const decl = /^const RAM_SIZE\b.*$/m.exec(source);
  if (!decl) return DEFAULT_RAM_SIZE;
  const literal =
    /^const RAM_SIZE(?::\s*(?:i32|u32|usize))?\s*=\s*(0[xX][0-9a-fA-F_]+|[0-9][0-9_]*)\s*;\s*(?:\/\/.*)?$/.exec(
      decl[0],
    );
  if (!literal) throw new Error(`${entry}: RAM_SIZE must be a number literal, like: const RAM_SIZE: i32 = 0x2000;`);
  const value = Number(literal[1].replace(/_/g, ''));
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RAM_SIZE || value % 16 !== 0) {
    throw new Error(`${entry}: RAM_SIZE must be a multiple of 16 between 16 and ${MAX_RAM_SIZE} bytes`);
  }
  return value;
}

/**
 * Read a game's metadata from the top-level constants in its main.ts
 * (`const TITLE = "Pong";`). TITLE, DESCRIPTION and AUTHOR are required; COVER
 * is optional and names a sprite in the asset library; RAM_SIZE is optional
 * (default DEFAULT_RAM_SIZE). Throws a readable error, reported like a
 * compile error.
 */
export function readGameMeta(name: string): Omit<CartridgeMeta, 'assets' | 'layout' | 'memory'> {
  const entry = gameEntry(name);
  const values = readMetaFields(name);
  const ram = readRamSize(entry, readFileSync(entry, 'utf8'));
  for (const field of ['TITLE', 'DESCRIPTION', 'AUTHOR'] as const) {
    if (!values[field]) throw new Error(`${entry}: missing game metadata, add: const ${field} = "...";`);
  }
  return {
    ram,
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
    ? readdirSync(dir).find((f) => IMAGE_TYPES[path.extname(f).toLowerCase()] && assetId(f) === id)
    : undefined;
  if (!file) throw new Error(`${entry}: COVER sprite "${id}" not found in assets/sprites`);
  return {
    type: IMAGE_TYPES[path.extname(file).toLowerCase()],
    bytes: new Uint8Array(readFileSync(path.join(dir, file))),
  };
}

/** The asset IDs in the library folders (a missing folder is empty). */
export function readLibrary(assetsDir = ASSETS_DIR): AssetLibrary {
  const files = {} as Record<AssetKind, string[]>;
  for (const kind of ASSET_KINDS) {
    const dir = path.join(assetsDir, kind);
    files[kind] = existsSync(dir) ? readdirSync(dir) : [];
  }
  return libraryFromFiles(files);
}
