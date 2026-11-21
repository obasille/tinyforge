// Paths in a TinyForge project, as the Workspace (the editor's file API), the
// compiler and the dev server name them:
//
//   games/<name>/main.ts ...   the games, one folder each (writable)
//   games/asconfig.json        build settings shared by every game (read-only)
//   engine/sdk/...             the SDK (read-only)
//   engine/memory-map.ts       the memory layout (read-only)
//   assets/sprites|sfx|music/  the shared asset library (writable)
//
// Paths are relative, use `/`, and never contain `.` or `..` segments.
// Plain TS with no Node or DOM APIs.

import { ASSET_KINDS, ASSET_PATTERNS, type AssetKind, assetId } from './asset-scan.ts';

export const ASCONFIG_PATH = 'games/asconfig.json';
export const MEMORY_MAP_PATH = 'engine/memory-map.ts';

/** A game's folder or file name: letters, digits, `_` and `-`. */
export const GAME_NAME = /^[A-Za-z0-9_-]+$/;

/** Entry file of a game. */
export const gameEntryPath = (game: string): string => `games/${game}/main.ts`;

/** A well-formed project path: relative, `/`-separated, no empty, `.`, `..` or hidden segments. */
export function isProjectPath(path: string): boolean {
  if (path.length === 0 || path.length > 512 || path.includes('\\')) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split('/').every((s) => s.length > 0 && !s.startsWith('.'));
}

/** Whether the editor may create, change or delete a file at this path. */
export function isWritablePath(path: string): boolean {
  if (!isProjectPath(path)) return false;
  const parts = path.split('/');
  if (parts[0] === 'games') return parts.length >= 3 && GAME_NAME.test(parts[1]);
  if (parts[0] === 'assets') return parts.length >= 3 && (ASSET_KINDS as readonly string[]).includes(parts[1]);
  return false;
}

/** The game a path belongs to (games/<name>/...), or null. */
export function gameOf(path: string): string | null {
  const m = /^games\/([^/]+)\/./.exec(path);
  return m && GAME_NAME.test(m[1]) ? m[1] : null;
}

/** Names of the games among these paths: each games/<name>/ folder with a main.ts. */
export function gamesIn(paths: Iterable<string>): string[] {
  const games = new Set<string>();
  for (const p of paths) {
    const m = /^games\/([^/]+)\/main\.ts$/.exec(p);
    if (m && GAME_NAME.test(m[1])) games.add(m[1]);
  }
  return [...games].sort();
}

/** The library kind of an asset path (assets/<kind>/<file>), or null. */
export function assetKindOf(path: string): AssetKind | null {
  const m = /^assets\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return null;
  const kind = ASSET_KINDS.find((k) => k === m[1]);
  return kind && ASSET_PATTERNS[kind].test(m[2]) ? kind : null;
}

/** The library's file names per kind, from a list of project paths. */
export function assetFilesIn(paths: Iterable<string>): Record<AssetKind, string[]> {
  const files: Record<AssetKind, string[]> = { sprites: [], sfx: [], music: [] };
  for (const p of paths) {
    const kind = assetKindOf(p);
    if (kind) files[kind].push(p.slice(`assets/${kind}/`.length));
  }
  for (const kind of ASSET_KINDS) files[kind].sort();
  return files;
}

export type ChangeKind = 'add' | 'change' | 'unlink';

/**
 * Which games need a rebuild after a file changed, or null when the file is
 * not something a build reads. The SDK, the memory map and asconfig.json
 * affect every game; a file in games/<name>/ affects <name>. Adding or
 * removing a library file can make an asset ID valid or unknown, so it
 * affects every game; editing one affects only the games that use it as their
 * COVER (copied into the cartridge). Other assets are loaded by the host.
 */
export function affectedGames(
  path: string,
  kind: ChangeKind,
  games: readonly string[],
  coverOf: (game: string) => string | null | undefined,
): string[] | null {
  if (path === ASCONFIG_PATH || path === MEMORY_MAP_PATH || path.startsWith('engine/sdk/')) {
    return path.endsWith('.ts') || path.endsWith('.json') ? [...games] : null;
  }
  const game = gameOf(path);
  if (game) return games.includes(game) || path === gameEntryPath(game) ? [game] : [];
  const assetKind = assetKindOf(path);
  if (!assetKind) return null;
  if (kind !== 'change') return [...games];
  if (assetKind !== 'sprites') return [];
  const id = assetId(path.slice('assets/sprites/'.length));
  return games.filter((g) => coverOf(g) === id);
}

/**
 * Where the compiler sees a project file. The compiler keeps the engine's own
 * folder layout, so the games' `../../sdk` and the SDK's `../../memory-map`
 * imports resolve as they do on disk.
 */
export function compilerPath(path: string): string | null {
  if (path.startsWith('games/')) return `assembly/${path}`;
  if (path.startsWith('engine/sdk/')) return `assembly/sdk/${path.slice('engine/sdk/'.length)}`;
  if (path === MEMORY_MAP_PATH) return 'memory-map.ts';
  return null;
}

/** The project path of a file the compiler names, or null (e.g. `~lib/`). */
export function projectPathOf(compilerFile: string): string | null {
  const p = normalizePath(compilerFile);
  if (p.startsWith('assembly/games/')) return p.slice('assembly/'.length);
  if (p.startsWith('assembly/sdk/')) return `engine/sdk/${p.slice('assembly/sdk/'.length)}`;
  if (p === 'memory-map.ts') return MEMORY_MAP_PATH;
  return null;
}

/** Resolve `.` and `..` segments and strip a leading `./`. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
