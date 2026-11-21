// The Workspace: the editor's only way to reach project files.
//
// Everything that reads or writes files (the compiler, the file tree, the
// code editor, the asset library, later the AI tools) goes through this
// interface, and one adapter per deployment implements it: HTTP for the
// local dev server, a hosted server or a static copy (http-workspace.ts),
// later native files in a desktop app or the browser's own storage. Nothing
// else in the editor knows which one it runs on.
//
// Paths are project paths (packages/engine/tooling/project-layout.ts):
// games/<name>/..., engine/... (read-only) and assets/<kind>/....

import type { ChangeKind } from '@tinyforge/engine/tooling/project-layout';

export type { ChangeKind } from '@tinyforge/engine/tooling/project-layout';

export interface FileEntry {
  path: string;
  size: number;
  /** Modification time in milliseconds; changes when the file does. */
  mtime: number;
  /** The editor may not change this file. */
  readonly?: boolean;
}

export interface FileChange {
  path: string;
  kind: ChangeKind;
}

export interface WorkspaceInfo {
  /** Files can be written (false for a static copy). */
  writable: boolean;
  /** watch() reports changes made outside the editor. */
  watch: boolean;
  files: FileEntry[];
}

export interface Workspace {
  /** All files, and what the workspace supports. */
  list(): Promise<WorkspaceInfo>;
  /** A file's bytes. Throws when it does not exist. */
  read(path: string): Promise<Uint8Array>;
  /** Create or replace a file (its folders are created as needed). */
  write(path: string, data: Uint8Array | string): Promise<void>;
  /** Delete a file; folders it leaves empty go too. */
  delete(path: string): Promise<void>;
  /** Move a file. Fails when `to` exists. */
  rename(from: string, to: string): Promise<void>;
  /**
   * Report file changes, including the editor's own writes. Returns a
   * function that stops watching. Does nothing when `watch` is false.
   */
  watch(listener: (changes: FileChange[]) => void): () => void;
  /** A URL the page and its Workers can fetch the file from; it changes when the file does. */
  url(entry: FileEntry): string;
}

/** Thrown for a failed workspace request, with the server's message. */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
