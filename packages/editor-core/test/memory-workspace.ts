// An in-memory Workspace for tests. `watch` reports changes like a server
// would, after the write; `external()` changes a file as another program would.

import type { FileChange, FileEntry, Workspace, WorkspaceInfo } from '../src/workspace.ts';

export class MemoryWorkspace implements Workspace {
  readonly data = new Map<string, Uint8Array>();
  private readonly mtimes = new Map<string, number>();
  private readonly listeners = new Set<(changes: FileChange[]) => void>();
  private clock = 1;

  constructor(
    files: Record<string, string | Uint8Array> = {},
    private readonly options: { watch?: boolean; writable?: boolean } = {},
  ) {
    for (const [p, v] of Object.entries(files)) this.set(p, v);
  }

  private set(path: string, value: string | Uint8Array): void {
    this.data.set(path, typeof value === 'string' ? new TextEncoder().encode(value) : value.slice());
    this.mtimes.set(path, this.clock++);
  }

  private emit(changes: FileChange[]): void {
    if (this.options.watch === false) return;
    queueMicrotask(() => {
      for (const l of this.listeners) l(changes);
    });
  }

  /** Change a file as another program would. */
  external(path: string, value: string | Uint8Array | null): void {
    const existed = this.data.has(path);
    if (value === null) {
      this.data.delete(path);
      this.mtimes.delete(path);
      this.emit([{ path, kind: 'unlink' }]);
      return;
    }
    this.set(path, value);
    this.emit([{ path, kind: existed ? 'change' : 'add' }]);
  }

  text(path: string): string | undefined {
    const d = this.data.get(path);
    return d && new TextDecoder().decode(d);
  }

  async list(): Promise<WorkspaceInfo> {
    const files: FileEntry[] = [...this.data].map(([path, d]) => ({
      path,
      size: d.length,
      mtime: this.mtimes.get(path) ?? 0,
      ...(path.startsWith('engine/') ? { readonly: true } : {}),
    }));
    return { writable: this.options.writable !== false, watch: this.options.watch !== false, files };
  }

  async read(path: string): Promise<Uint8Array> {
    const d = this.data.get(path);
    if (!d) throw new Error(`${path} not found`);
    return d.slice();
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    if (this.options.writable === false) throw new Error('read-only');
    this.external(path, data);
  }

  async delete(path: string): Promise<void> {
    if (!this.data.has(path)) throw new Error(`${path} not found`);
    this.external(path, null);
  }

  async rename(from: string, to: string): Promise<void> {
    const d = this.data.get(from);
    if (!d) throw new Error(`${from} not found`);
    if (this.data.has(to)) throw new Error(`${to} already exists`);
    this.data.delete(from);
    this.mtimes.delete(from);
    this.set(to, d);
    this.emit([
      { path: from, kind: 'unlink' },
      { path: to, kind: 'add' },
    ]);
  }

  watch(listener: (changes: FileChange[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  url(entry: FileEntry): string {
    return `mem:/${entry.path}?v=${entry.mtime}`;
  }
}
