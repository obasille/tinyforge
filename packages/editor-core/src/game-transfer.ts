// Moving a game in and out of the project as a zip (engine/tooling/game-zip):
// its folder and the library assets it uses, with their sidecars. Importing is
// one command, so one undo step removes everything it added.

import { ASSET_KINDS, type AssetList } from '@tinyforge/engine/tooling/asset-scan';
import { cartridgeAssetPaths, embedAssets } from '@tinyforge/engine/tooling/cartridge-assets';
import type { CompileResult } from '@tinyforge/engine/tooling/compiler';
import { type ImportPlan, planImport, readGameZip, zipGame } from '@tinyforge/engine/tooling/game-zip';
import { assetKindOf } from '@tinyforge/engine/tooling/project-layout';
import type { LibraryAsset } from './asset-library.ts';
import type { FileCommand } from './commands.ts';
import { commandLabel } from './commands.ts';
import { type FileOp, fileBatch } from './file-commands.ts';
import type { ProjectFiles } from './project-files.ts';

/** The assets a game uses: in its code (compiled or typed) or as its cover. */
export function usedAssets(assets: readonly LibraryAsset[], game: string): AssetList {
  const used: AssetList = { sprites: [], sfx: [], music: [] };
  for (const a of assets) if (a.usedBy.includes(game)) used[a.kind].push(a.id);
  for (const kind of ASSET_KINDS) used[kind].sort();
  return used;
}

/** The game as a zip file. */
export function exportGameZip(files: ProjectFiles, game: string, assets: readonly LibraryAsset[]): Promise<Uint8Array> {
  return zipGame(
    game,
    files.files.map((f) => f.path),
    usedAssets(assets, game),
    (path) => files.readBytes(path),
  );
}

/**
 * The game as a playable cartridge: a release build with the library files it
 * uses embedded (the tinyforge.assets section). Throws when it does not compile.
 */
export async function exportCartridge(
  files: ProjectFiles,
  build: () => Promise<CompileResult>,
): Promise<Uint8Array<ArrayBuffer>> {
  const result = await build();
  if (!result.ok) throw new Error('The game does not compile: fix it before exporting a cartridge');
  const embedded = [];
  for (const path of cartridgeAssetPaths(
    files.files.map((f) => f.path),
    result.meta.assets,
  )) {
    const bytes = await files.readBytes(path);
    const kind = assetKindOf(path);
    if (bytes && kind) embedded.push({ kind, file: path.slice(`assets/${kind}/`.length), bytes });
  }
  return embedAssets(result.wasm, embedded);
}

/** Read a game zip and compare it with the project. Throws when it is not a game zip. */
export async function planGameImport(files: ProjectFiles, zip: Uint8Array): Promise<ImportPlan> {
  const parsed = await readGameZip(zip);
  const exists = files.files.some((f) => f.path.startsWith(`games/${parsed.game}/`));
  return planImport(parsed, (path) => (files.exists(path) ? files.readBytes(path) : Promise.resolve(null)), exists);
}

/** The import as one command: new files, and the changed assets when `replace`. */
export async function gameImportCommand(files: ProjectFiles, plan: ImportPlan, replace: boolean): Promise<FileCommand> {
  if (plan.gameExists) throw new Error(`The project already has a game named ${plan.game}`);
  const ops: FileOp[] = [...plan.added, ...(replace ? plan.changed : [])].map((f) => ({
    write: f.path,
    data: f.bytes,
  }));
  return fileBatch(files, ops, commandLabel('Import game', plan.game), 'files.import-game');
}
