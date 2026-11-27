// The editor's live view of the Workspace: the file list, cached reads, and
// one stream of changes, whether they come from the editor's own writes or
// from another program (an edit in VS Code, a git checkout).
//
// The file list is a store, so the file tree and anything derived from it
// (the games, the asset library) update when files change.

import { ASSET_KINDS, type AssetKind } from '@tinyforge/engine/tooling/asset-scan';
import { assetFilesIn, assetKindOf, gamesIn } from '@tinyforge/engine/tooling/project-layout';
import type { AssetManifest, AssetRef } from './protocol.ts';
import { createStore, type Store } from './store.ts';
import { type FileChange, type FileEntry, type Workspace, WorkspaceError } from './workspace.ts';

export interface ProjectFilesState {
  files: FileEntry[];
  writable: boolean;
  /** False until the first listing arrived. */
  ready: boolean;
}

/** Asset ID and format of a library file name (`coin~8x1-v2.png` → coin, 8x1). */
export function parseAssetName(file: string): { id: string; format: string } {
  const name = file.replace(/\.[^/.]+$/, '');
  const tilde = name.indexOf('~');
  const dash = name.indexOf('-');
  if (tilde >= 0) {
    const rest = name.slice(tilde + 1);
    const restDash = rest.indexOf('-');
    return { id: name.slice(0, tilde), format: restDash >= 0 ? rest.slice(0, restDash) : rest };
  }
  return { id: dash >= 0 ? name.slice(0, dash) : name, format: '' };
}

/** Why a change fails in a read-only copy of the project. */
export const READ_ONLY = 'This copy of the editor is read-only: it cannot save changes.';

export class ProjectFiles {
  readonly state: Store<ProjectFilesState> = createStore<ProjectFilesState>({
    files: [],
    writable: false,
    ready: false,
  });
  private byPath = new Map<string, FileEntry>();
  private readonly cache = new Map<string, { mtime: number; data: Promise<Uint8Array> }>();
  private readonly listeners = new Set<(changes: FileChange[]) => void>();
  private watching = false;
  private stopWatch: (() => void) | null = null;
  /** Change batches are applied one at a time, in order. */
  private queue: Promise<void> = Promise.resolve();
  /** The editor's own writes (true) and deletes (false) since the last listing. */
  private readonly own = new Map<string, boolean>();

  constructor(readonly workspace: Workspace) {}

  /** List the files and start following changes. */
  async start(): Promise<void> {
    const info = await this.workspace.list();
    this.watching = info.watch;
    this.setFiles(info.files, info.writable);
    this.stopWatch = this.workspace.watch((changes) => {
      void this.enqueue(changes);
    });
  }

  dispose(): void {
    this.stopWatch?.();
  }

  get files(): FileEntry[] {
    return this.state.getState().files;
  }

  get writable(): boolean {
    return this.state.getState().writable;
  }

  entry(path: string): FileEntry | undefined {
    return this.byPath.get(path);
  }

  /**
   * Whether a file exists, counting the editor's own writes and deletes that
   * the file list does not show yet. Never asks the workspace, so it never
   * makes a request that fails.
   */
  exists(path: string): boolean {
    return this.own.get(path) ?? this.byPath.has(path);
  }

  /** Names of the games (folders in games/ with a main.ts). */
  get games(): string[] {
    return gamesIn(this.byPath.keys());
  }

  /** The library's file names per kind. */
  get assetFiles(): Record<AssetKind, string[]> {
    return assetFilesIn(this.byPath.keys());
  }

  /** The asset library with a fetchable URL per file (the URL changes with the file). */
  get library(): AssetManifest {
    const lib: AssetManifest = { games: this.games, sprites: [], sfx: [], music: [] };
    for (const entry of this.files) {
      const kind = assetKindOf(entry.path);
      if (!kind) continue;
      const parsed = parseAssetName(entry.path.slice(`assets/${kind}/`.length));
      if (!parsed.id) continue;
      const ref: AssetRef = { ...parsed, url: this.workspace.url(entry) };
      lib[kind].push(ref);
    }
    for (const kind of ASSET_KINDS) lib[kind].sort((a, b) => (a.url < b.url ? -1 : 1));
    return lib;
  }

  /**
   * A file's bytes, or null when it does not exist. Cached until it changes.
   * A file the list does not show yet (just written, its change not reported
   * yet) is read without caching.
   */
  readBytes(path: string): Promise<Uint8Array | null> {
    const entry = this.byPath.get(path);
    if (!entry) return this.workspace.read(path).catch(() => null);
    const hit = this.cache.get(path);
    if (hit && hit.mtime === entry.mtime) return hit.data;
    const data = this.workspace.read(path);
    this.cache.set(path, { mtime: entry.mtime, data });
    data.catch(() => {
      if (this.cache.get(path)?.data === data) this.cache.delete(path);
    });
    return data.catch(() => null);
  }

  async readText(path: string): Promise<string | null> {
    const bytes = await this.readBytes(path);
    return bytes === null ? null : new TextDecoder().decode(bytes);
  }

  /** Called with each batch of changes, after the file list is updated. */
  onChange(listener: (changes: FileChange[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Refuse a change in a read-only copy (the static build) before any request. */
  private checkWritable(): void {
    const { ready, writable } = this.state.getState();
    if (ready && !writable) throw new WorkspaceError(READ_ONLY, 403);
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.checkWritable();
    const existed = this.byPath.has(path);
    this.cache.delete(path);
    await this.workspace.write(path, data);
    this.own.set(path, true);
    await this.afterOwnChange([{ path, kind: existed ? 'change' : 'add' }]);
  }

  async delete(path: string): Promise<void> {
    this.checkWritable();
    this.cache.delete(path);
    await this.workspace.delete(path);
    this.own.set(path, false);
    await this.afterOwnChange([{ path, kind: 'unlink' }]);
  }

  async rename(from: string, to: string): Promise<void> {
    this.checkWritable();
    this.cache.delete(from);
    this.cache.delete(to);
    await this.workspace.rename(from, to);
    this.own.set(from, false);
    this.own.set(to, true);
    await this.afterOwnChange([
      { path: from, kind: 'unlink' },
      { path: to, kind: 'add' },
    ]);
  }

  /**
   * A workspace that watches reports the editor's own writes like any other
   * change; for one that does not, apply them here.
   */
  private afterOwnChange(changes: FileChange[]): Promise<void> {
    return this.watching ? Promise.resolve() : this.enqueue(changes);
  }

  private enqueue(changes: FileChange[]): Promise<void> {
    this.queue = this.queue.then(() => this.apply(changes)).catch(() => {});
    return this.queue;
  }

  private async apply(changes: FileChange[]): Promise<void> {
    for (const c of changes) this.cache.delete(c.path);
    const info = await this.workspace.list();
    this.setFiles(info.files, info.writable);
    for (const listener of [...this.listeners]) listener(changes);
  }

  private setFiles(files: FileEntry[], writable: boolean): void {
    const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    this.byPath = new Map(sorted.map((f) => [f.path, f]));
    this.own.clear();
    this.state.setState({ files: sorted, writable, ready: true });
  }
}
