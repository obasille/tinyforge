// File edits as undoable commands (see FileCommand in commands.ts). Each one
// reads what it will overwrite or delete before it runs, so revert() puts the
// previous bytes back.

import { GAME_NAME, gameEntryPath } from '@tinyforge/engine/tooling/project-layout';
import { commandLabel, type FileCommand } from './commands.ts';
import type { ProjectFiles } from './project-files.ts';

/** A file's bytes, or null. Also finds a file written so recently that the file list does not show it yet. */
function current(files: ProjectFiles, path: string): Promise<Uint8Array | null> {
  return files.readBytes(path);
}

/** Create or replace a file. */
export async function writeFile(
  files: ProjectFiles,
  path: string,
  data: Uint8Array | string,
  label = commandLabel('Save', path),
): Promise<FileCommand> {
  const before = await current(files, path);
  return {
    type: 'files.write',
    label,
    args: { path },
    apply: () => files.write(path, data),
    revert: () => (before ? files.write(path, before) : files.delete(path)),
  };
}

/** Delete files (a folder is the files in it). */
export async function deleteFiles(files: ProjectFiles, paths: string[], label?: string): Promise<FileCommand> {
  const saved: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const path of paths) {
    const bytes = await current(files, path);
    if (!bytes) throw new Error(`${path} not found`);
    saved.push({ path, bytes });
  }
  return {
    type: 'files.delete',
    label: label ?? (paths.length === 1 ? commandLabel('Delete', paths[0]) : `Delete ${paths.length} files`),
    args: { paths },
    async apply() {
      for (const { path } of saved) await files.delete(path);
    },
    async revert() {
      for (const { path, bytes } of saved) await files.write(path, bytes);
    },
  };
}

/** Move files: each `[from, to]` pair (a folder is the files in it). */
export function renameFiles(files: ProjectFiles, moves: Array<[string, string]>, label?: string): FileCommand {
  for (const [, to] of moves) if (files.entry(to)) throw new Error(`${to} already exists`);
  return {
    type: 'files.rename',
    label:
      label ??
      (moves.length === 1
        ? `${commandLabel('Rename', moves[0][0])} to '${moves[0][1]}'`
        : `Move ${moves.length} files`),
    args: { moves },
    async apply() {
      for (const [from, to] of moves) await files.rename(from, to);
    },
    async revert() {
      for (const [from, to] of [...moves].reverse()) await files.rename(to, from);
    },
  };
}

/** The main.ts of a new game. */
export function newGameSource(name: string): string {
  return `// ${name}: a TinyForge game.
// See AGENTS.md for the SDK and its rules (no allocations after init).

import { Button, buttonDown, c, clearFramebuffer, drawString, fillRect, getI32, setI32 } from "../../sdk";

const TITLE = "${name}";
const DESCRIPTION = "A new game";
const AUTHOR = "Your name";
const RAM_SIZE: i32 = 0x100;

// Game state lives in RAM, at offsets from RAM_START.
const X = 0;
const Y = 4;

export function init(): void {
  setI32(X, 156);
  setI32(Y, 116);
}

export function update(): void {
  if (buttonDown(Button.LEFT)) setI32(X, getI32(X) - 2);
  if (buttonDown(Button.RIGHT)) setI32(X, getI32(X) + 2);
  if (buttonDown(Button.UP)) setI32(Y, getI32(Y) - 2);
  if (buttonDown(Button.DOWN)) setI32(Y, getI32(Y) + 2);
}

export function draw(): void {
  clearFramebuffer(c(0x141828));
  fillRect(getI32(X), getI32(Y), 8, 8, c(0xffc83c));
  drawString(8, 8, "${name}", c(0xffffff));
}
`;
}

/** Create a game folder with a main.ts. */
export async function createGame(files: ProjectFiles, name: string): Promise<FileCommand> {
  if (!GAME_NAME.test(name)) {
    throw new Error('A game name uses only letters, digits, _ and -');
  }
  if (files.games.includes(name) || files.files.some((f) => f.path.startsWith(`games/${name}/`))) {
    throw new Error(`games/${name} already exists`);
  }
  return writeFile(files, gameEntryPath(name), newGameSource(name), commandLabel('New game', name));
}

/** One step of a file batch. */
export type FileOp = { write: string; data: Uint8Array | string } | { delete: string };

/**
 * Several writes and deletes as one command (one undo step). Revert puts back
 * every path the batch touched, in reverse order.
 */
export async function fileBatch(
  files: ProjectFiles,
  ops: FileOp[],
  label: string,
  type = 'files.batch',
): Promise<FileCommand> {
  const before = new Map<string, Uint8Array | null>();
  for (const op of ops) {
    const path = 'write' in op ? op.write : op.delete;
    if (before.has(path)) continue;
    const bytes = await current(files, path);
    if (!bytes && 'delete' in op) throw new Error(`${path} not found`);
    before.set(path, bytes);
  }
  return {
    type,
    label,
    args: { ops: ops.map((op) => ('write' in op ? { write: op.write } : op)) },
    async apply() {
      for (const op of ops) {
        if ('write' in op) await files.write(op.write, op.data);
        else await files.delete(op.delete);
      }
    },
    async revert() {
      for (const [path, bytes] of [...before].reverse()) {
        // A path that did not exist was created by the batch.
        if (bytes) await files.write(path, bytes);
        else await files.delete(path);
      }
    },
  };
}
