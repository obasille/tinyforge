// A game as a plain zip: its folder and the library assets it uses, with
// their sidecars, at their project paths and nothing else:
//
//   games/pong/main.ts
//   assets/sprites/pong_cover.png
//   assets/sfx/pong_hit.wav
//   assets/sfx/pong_hit.wav.json
//
// The editor and the CLI (`pnpm tf export`, `pnpm tf import`) both use this.
// Plain TS with no Node or DOM APIs.

import { type AssetList, assetId } from './asset-scan.ts';
import { assetKindOf, GAME_NAME, gameOf, isWritablePath } from './project-layout.ts';
import { readZip, writeZip, type ZipEntry } from './zip.ts';

/** The project paths a game's zip holds, sorted. */
export function gameZipPaths(game: string, paths: Iterable<string>, used: AssetList): string[] {
  const all = new Set(paths);
  const out: string[] = [];
  for (const p of all) {
    if (gameOf(p) === game) out.push(p);
    const kind = assetKindOf(p);
    if (kind && used[kind].includes(assetId(p.slice(`assets/${kind}/`.length)))) {
      out.push(p);
      if (all.has(`${p}.json`)) out.push(`${p}.json`);
    }
  }
  return out.sort();
}

/** Zip a game: `read` gives a project file's bytes. */
export async function zipGame(
  game: string,
  paths: Iterable<string>,
  used: AssetList,
  read: (path: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array> {
  const entries: ZipEntry[] = [];
  for (const path of gameZipPaths(game, paths, used)) {
    const bytes = await read(path);
    if (bytes) entries.push({ path, bytes });
  }
  return writeZip(entries);
}

/** A file a game zip may hold: a file in a game folder, a library asset, or an asset's sidecar. */
function allowed(path: string): boolean {
  if (!isWritablePath(path)) return false;
  if (path.startsWith('games/')) return true;
  return assetKindOf(path.endsWith('.json') ? path.slice(0, -5) : path) !== null;
}

/**
 * Read a game's zip and check it: one game (with a main.ts), library assets,
 * nothing else, no path outside the project. A zip that wraps it all in one
 * folder (as some zip tools do) is accepted too.
 */
export async function readGameZip(zip: Uint8Array): Promise<{ game: string; files: ZipEntry[] }> {
  let files = await readZip(zip);
  const top = files[0]?.path.split('/')[0];
  if (top && top !== 'games' && top !== 'assets' && files.every((f) => f.path.startsWith(`${top}/`))) {
    files = files.map((f) => ({ ...f, path: f.path.slice(top.length + 1) }));
  }
  const refused = files.filter((f) => !allowed(f.path)).map((f) => f.path);
  if (refused.length > 0) {
    throw new Error(`Not a game zip: it holds ${refused.slice(0, 3).join(', ')}${refused.length > 3 ? '…' : ''}`);
  }
  const games = [...new Set(files.flatMap((f) => gameOf(f.path) ?? []))];
  if (games.length !== 1) {
    throw new Error(
      games.length === 0
        ? 'Not a game zip: it has no games/<name>/ folder'
        : `The zip holds several games: ${games.join(', ')}`,
    );
  }
  const game = games[0];
  if (!GAME_NAME.test(game) || !files.some((f) => f.path === `games/${game}/main.ts`)) {
    throw new Error(`games/${game}/main.ts is missing from the zip`);
  }
  return { game, files };
}

/** What importing a zip would do, file by file. */
export interface ImportPlan {
  game: string;
  /** The project already has this game's folder: importing is refused. */
  gameExists: boolean;
  /** Files the project does not have. */
  added: ZipEntry[];
  /** Asset files the project has with other content: imported only when replacing. */
  changed: ZipEntry[];
  /** Files the project already has, the same: skipped. */
  same: string[];
}

export async function planImport(
  zip: { game: string; files: ZipEntry[] },
  read: (path: string) => Promise<Uint8Array | null>,
  gameExists: boolean,
): Promise<ImportPlan> {
  const plan: ImportPlan = { game: zip.game, gameExists, added: [], changed: [], same: [] };
  for (const file of zip.files) {
    const current = await read(file.path);
    if (current === null) plan.added.push(file);
    else if (current.length === file.bytes.length && current.every((b, i) => b === file.bytes[i]))
      plan.same.push(file.path);
    else plan.changed.push(file);
  }
  return plan;
}
