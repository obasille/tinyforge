// The project on disk, for Node: where each project path (project-layout.ts)
// lives in this repo, and compileGame(), which runs the compiler
// (compiler.ts) on files read from disk.
//
// scripts/build-games.js, the editor's production build and the tests use
// this. The editor itself compiles in a browser Worker with files from the
// Workspace; the Vite plugin serves those files from the same places.

import { existsSync, promises as fs, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_KINDS, type AssetKind, assetId } from './asset-scan.ts';
import type { CartridgeMeta } from './cartridge-meta.ts';
import { type CompileResult, type CompilerFiles, type CompileTarget, compile } from './compiler.ts';
import { parseGameMeta } from './game-meta.ts';
import { assetFilesIn, gameEntryPath, isProjectPath, MEMORY_MAP_PATH } from './project-layout.ts';

export type { CompileResult, CompileTarget } from './compiler.ts';
export { MAX_RAM_SIZE, readRamSize } from './game-meta.ts';

export const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const GAMES_DIR = path.join(ENGINE_ROOT, 'assembly', 'games');
export const SDK_DIR = path.join(ENGINE_ROOT, 'assembly', 'sdk');
export const MEMORY_MAP_FILE = path.join(ENGINE_ROOT, 'memory-map.ts');
export const ASCONFIG_FILE = path.join(GAMES_DIR, 'asconfig.json');
/** The repo's shared asset library (assets/sprites, assets/sfx, assets/music). */
export const ASSETS_DIR = path.resolve(ENGINE_ROOT, '..', '..', 'assets');

/** Where project paths live on disk (`assets/` can be another folder, e.g. in tests). */
export interface ProjectDirs {
  games: string;
  sdk: string;
  memoryMap: string;
  assets: string;
}

export const PROJECT_DIRS: ProjectDirs = {
  games: GAMES_DIR,
  sdk: SDK_DIR,
  memoryMap: MEMORY_MAP_FILE,
  assets: ASSETS_DIR,
};

/** The file a project path names, or null when the path is outside the project. */
export function diskPath(projectPath: string, dirs: ProjectDirs = PROJECT_DIRS): string | null {
  if (!isProjectPath(projectPath)) return null;
  const [root, ...rest] = projectPath.split('/');
  if (projectPath === MEMORY_MAP_PATH) return dirs.memoryMap;
  if (root === 'games' && rest.length > 0) return path.join(dirs.games, ...rest);
  if (root === 'engine' && rest[0] === 'sdk' && rest.length > 1) return path.join(dirs.sdk, ...rest.slice(1));
  if (root === 'assets' && rest.length > 1 && (ASSET_KINDS as readonly string[]).includes(rest[0])) {
    return path.join(dirs.assets, ...rest);
  }
  return null;
}

/** The project path of a file on disk, or null when it is not a project file. */
export function projectPathOfFile(file: string, dirs: ProjectDirs = PROJECT_DIRS): string | null {
  const abs = path.resolve(file);
  const under = (dir: string) => (abs.startsWith(dir + path.sep) ? path.relative(dir, abs).split(path.sep) : null);
  let p: string | null = null;
  if (abs === dirs.memoryMap) p = MEMORY_MAP_PATH;
  else if (under(dirs.games)) p = ['games', ...(under(dirs.games) ?? [])].join('/');
  else if (under(dirs.sdk)) p = ['engine', 'sdk', ...(under(dirs.sdk) ?? [])].join('/');
  else if (under(dirs.assets)) p = ['assets', ...(under(dirs.assets) ?? [])].join('/');
  return p && isProjectPath(p) && diskPath(p, dirs) ? p : null;
}

export interface ProjectFile {
  path: string;
  size: number;
  /** Modification time in milliseconds. */
  mtime: number;
}

async function walk(dir: string, prefix: string, out: ProjectFile[]): Promise<void> {
  if (!existsSync(dir)) return;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const p = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await walk(full, p, out);
    else if (entry.isFile()) {
      const stat = await fs.stat(full);
      out.push({ path: p, size: stat.size, mtime: Math.floor(stat.mtimeMs) });
    }
  }
}

/** Every project file, sorted by path. */
export async function listProjectFiles(dirs: ProjectDirs = PROJECT_DIRS): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];
  await walk(dirs.games, 'games', out);
  await walk(dirs.sdk, 'engine/sdk', out);
  if (existsSync(dirs.memoryMap)) {
    const stat = await fs.stat(dirs.memoryMap);
    out.push({ path: MEMORY_MAP_PATH, size: stat.size, mtime: Math.floor(stat.mtimeMs) });
  }
  for (const kind of ASSET_KINDS) await walk(path.join(dirs.assets, kind), `assets/${kind}`, out);
  return out.filter((f) => isProjectPath(f.path)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Compiler file access backed by the disk. */
export function nodeFiles(dirs: ProjectDirs = PROJECT_DIRS): CompilerFiles {
  const read = async (p: string) => {
    const file = diskPath(p, dirs);
    if (!file) return null;
    try {
      return await fs.readFile(file);
    } catch {
      return null;
    }
  };
  return {
    readText: async (p) => (await read(p))?.toString('utf8') ?? null,
    readBytes: async (p) => {
      const bytes = await read(p);
      return bytes ? new Uint8Array(bytes) : null;
    },
  };
}

/** Entry file of a game on disk: games/<name>/main.ts. */
export function gameEntry(name: string): string {
  return path.join(GAMES_DIR, name, 'main.ts');
}

/** Names of all games: each folder in assembly/games that has a main.ts. */
export function listGames(): string[] {
  return readdirSync(GAMES_DIR)
    .filter((f: string) => statSync(path.join(GAMES_DIR, f)).isDirectory() && existsSync(gameEntry(f)))
    .sort();
}

/** The library's file names per kind (a missing folder is empty). */
export function readAssetFiles(assetsDir = ASSETS_DIR): Record<AssetKind, string[]> {
  const paths: string[] = [];
  for (const kind of ASSET_KINDS) {
    const dir = path.join(assetsDir, kind);
    if (existsSync(dir)) for (const f of readdirSync(dir)) paths.push(`assets/${kind}/${f}`);
  }
  return assetFilesIn(paths);
}

/**
 * Compile one game from disk. Never throws for compile errors; they are in
 * `log`. Source map sources are absolute file paths, so DevTools and other
 * tools can open them.
 */
export async function compileGame(
  name: string,
  target: CompileTarget = 'debug',
  dirs: ProjectDirs = PROJECT_DIRS,
): Promise<CompileResult> {
  const result = await compile({ game: name, target, files: nodeFiles(dirs), assetFiles: readAssetFiles(dirs.assets) });
  if (!result.ok || !result.sourceMap) return result;
  const map = JSON.parse(result.sourceMap) as { sources?: string[] };
  map.sources = map.sources?.map((s) => diskPath(s, dirs) ?? s);
  return { ...result, sourceMap: JSON.stringify(map) };
}

/** A game's metadata from its main.ts, with the cover image's bytes. */
export function readGameMeta(name: string): Omit<CartridgeMeta, 'assets' | 'layout' | 'memory'> {
  const entry = gameEntryPath(name);
  const meta = parseGameMeta(entry, readFileSync(gameEntry(name), 'utf8'));
  let cover: CartridgeMeta['cover'] = null;
  if (meta.cover) {
    const id = meta.cover;
    const file = readAssetFiles().sprites.find((f) => /\.(png|jpe?g)$/i.test(f) && assetId(f) === id);
    if (!file) throw new Error(`${entry}: COVER sprite "${id}" not found in assets/sprites`);
    cover = {
      type: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg',
      bytes: new Uint8Array(readFileSync(path.join(ASSETS_DIR, 'sprites', file))),
    };
  }
  return { title: meta.title, description: meta.description, author: meta.author, cover, ram: meta.ram };
}
