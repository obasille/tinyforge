// Moving a game in and out of the project as a zip (engine/tooling/game-zip):
// its folder and the library assets it uses, with their sidecars. Importing is
// one command, so one undo step removes everything it added.

import { ASSET_KINDS, type AssetList } from '@tinyforge/engine/tooling/asset-scan';
import { type ImportPlan, planImport, readGameZip, zipGame } from '@tinyforge/engine/tooling/game-zip';
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
