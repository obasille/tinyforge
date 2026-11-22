// Importing files into the asset library: each dropped file becomes a draft
// (kind, ID, sheet layout, optional sidecar) that the import panel lets the
// person adjust, with its problems listed until it can be written. The whole
// import is one FileCommand, so one undo removes it.
//
// Plain TS: the library panel renders the drafts and the sheet preview.

import { ASSET_PATTERNS, type AssetKind } from '@tinyforge/engine/tooling/asset-scan';
import { idProblem, type LibraryAsset, MAX_ID_LENGTH, type Sidecar, sidecarPath } from './asset-library.ts';
import { commandLabel, type FileCommand } from './commands.ts';
import { type FileOp, fileBatch } from './file-commands.ts';
import { type ImageSize, imageSize } from './png.ts';
import { type ProjectFiles, parseAssetName } from './project-files.ts';

/** Most columns or rows in a sheet (the sprite table stores them in a byte). */
export const MAX_SHEET = 255;

export interface ImportDraft {
  /** The dropped file's name. */
  name: string;
  bytes: Uint8Array;
  /** Extension, lower case, without the dot. */
  ext: string;
  /** Null when the file is not an image or a sound. */
  kind: AssetKind | null;
  id: string;
  cols: number;
  rows: number;
  /** Image size, for a sprite. */
  image: ImageSize | null;
  /** Replace the library asset that has this ID. */
  replace: boolean;
  tags: string[];
  license: string;
  source: string;
}

/** The library kind a file name can be imported as (sounds default to sfx). */
export function kindForFile(name: string): AssetKind | null {
  if (ASSET_PATTERNS.sprites.test(name)) return 'sprites';
  if (!ASSET_PATTERNS.sfx.test(name)) return null;
  return /music|theme|loop|song|bgm/i.test(name) ? 'music' : 'sfx';
}

/** An ID made from a file name: letters, digits and _, at most 16 characters. */
export function idFromName(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const id = parseAssetName(base)
    .id.replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_ID_LENGTH);
  return id || 'asset';
}

/** A draft for a dropped file, with its ID and sheet layout read from the name. */
export function draftImport(name: string, bytes: Uint8Array): ImportDraft {
  const ext = /\.([^./]+)$/.exec(name)?.[1].toLowerCase() ?? '';
  const kind = kindForFile(name);
  const format = name.includes('~') ? parseAssetName(name).format : '';
  const sheet = /^(\d+)x(\d+)$/.exec(format);
  return {
    name,
    bytes,
    ext,
    kind,
    id: idFromName(name),
    cols: sheet && kind === 'sprites' ? Number(sheet[1]) : 1,
    rows: sheet && kind === 'sprites' ? Number(sheet[2]) : 1,
    image: kind === 'sprites' ? imageSize(bytes) : null,
    replace: false,
    tags: [],
    license: '',
    source: '',
  };
}

/**
 * A strip layout the image looks like (square frames side by side, or one
 * above the other), or null.
 */
export function suggestedSheet(image: ImageSize | null): { cols: number; rows: number } | null {
  if (!image) return null;
  const { width, height } = image;
  if (width > height && width % height === 0 && width / height <= MAX_SHEET) return { cols: width / height, rows: 1 };
  if (height > width && height % width === 0 && height / width <= MAX_SHEET) return { cols: 1, rows: height / width };
  return null;
}

/** The library file name a draft is written to. */
export function targetFile(draft: ImportDraft): string {
  const sheet = draft.kind === 'sprites' && (draft.cols > 1 || draft.rows > 1) ? `~${draft.cols}x${draft.rows}` : '';
  return `${draft.id}${sheet}.${draft.ext}`;
}

export const targetPath = (draft: ImportDraft & { kind: AssetKind }) => `assets/${draft.kind}/${targetFile(draft)}`;

/** Frame size of a sprite draft, when the layout divides the image. */
export function frameSize(draft: ImportDraft): ImageSize | null {
  if (!draft.image || draft.cols < 1 || draft.rows < 1) return null;
  const { width, height } = draft.image;
  if (width % draft.cols !== 0 || height % draft.rows !== 0) return null;
  return { width: width / draft.cols, height: height / draft.rows };
}

/** The library assets a draft would replace (same kind and ID). */
export function replacedBy(draft: ImportDraft, assets: readonly LibraryAsset[]): LibraryAsset[] {
  return assets.filter((a) => a.kind === draft.kind && a.id === draft.id);
}

/** Why a draft cannot be imported as it is; empty when it can. */
export function importProblems(
  draft: ImportDraft,
  assets: readonly LibraryAsset[],
  drafts: readonly ImportDraft[],
): string[] {
  if (!draft.kind) return ['Not an image (PNG, JPEG) or a sound (WAV, MP3, OGG)'];
  if (!ASSET_PATTERNS[draft.kind].test(`x.${draft.ext}`)) {
    return [`A .${draft.ext} file cannot be ${draft.kind === 'sprites' ? 'a sprite' : 'a sound'}`];
  }
  const problems: string[] = [];
  const idIssue = idProblem(draft.id);
  if (idIssue) problems.push(idIssue);
  if (!draft.replace && replacedBy(draft, assets).length > 0) {
    problems.push(`The library already has a ${draft.kind === 'sprites' ? 'sprite' : 'sound'} "${draft.id}"`);
  }
  if (drafts.some((d) => d !== draft && d.kind === draft.kind && d.id === draft.id)) {
    problems.push(`Another file in this import has the ID "${draft.id}"`);
  }
  if (draft.kind === 'sprites') {
    if (!draft.image) problems.push('The image could not be read');
    const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_SHEET;
    if (!valid(draft.cols) || !valid(draft.rows)) {
      problems.push(`Columns and rows are whole numbers from 1 to ${MAX_SHEET}`);
    } else if (draft.image && !frameSize(draft)) {
      problems.push(
        `${draft.image.width}×${draft.image.height} does not split into ${draft.cols}×${draft.rows} equal frames`,
      );
    }
  }
  return problems;
}

/** The sidecar a draft writes, or null when it sets no metadata. */
export function draftSidecar(draft: ImportDraft): Sidecar | null {
  const sidecar: Sidecar = {};
  if (draft.tags.length > 0) sidecar.tags = draft.tags;
  if (draft.license.trim()) sidecar.license = draft.license.trim();
  if (draft.source.trim()) sidecar.source = draft.source.trim();
  return Object.keys(sidecar).length > 0 ? sidecar : null;
}

export const sidecarText = (sidecar: Sidecar) => `${JSON.stringify(sidecar, null, 2)}\n`;

/**
 * The import as one command. A replaced asset's files are deleted; its
 * sidecar moves to the new file unless the draft sets its own metadata.
 * Throws when a draft still has problems.
 */
export async function importCommand(
  files: ProjectFiles,
  drafts: readonly ImportDraft[],
  assets: readonly LibraryAsset[],
): Promise<FileCommand> {
  if (drafts.length === 0) throw new Error('Nothing to import');
  const ops: FileOp[] = [];
  for (const draft of drafts) {
    const problems = importProblems(draft, assets, drafts);
    if (problems.length > 0) throw new Error(`${draft.name}: ${problems[0]}`);
    const path = targetPath(draft as ImportDraft & { kind: AssetKind });
    let sidecar: Uint8Array | string | null = null;
    const own = draftSidecar(draft);
    if (own) sidecar = sidecarText(own);
    for (const old of replacedBy(draft, assets)) {
      const oldSidecar = sidecarPath(old.path);
      const oldBytes = files.exists(oldSidecar) ? await files.readBytes(oldSidecar) : null;
      if (oldBytes) {
        sidecar ??= oldBytes;
        if (oldSidecar !== sidecarPath(path)) ops.push({ delete: oldSidecar });
      }
      if (old.path !== path) ops.push({ delete: old.path });
    }
    ops.push({ write: path, data: draft.bytes });
    if (sidecar) ops.push({ write: sidecarPath(path), data: sidecar });
  }
  const label =
    drafts.length === 1
      ? commandLabel('Import', targetPath(drafts[0] as ImportDraft & { kind: AssetKind }))
      : `Import ${drafts.length} assets`;
  return fileBatch(files, ops, label, 'assets.import');
}
