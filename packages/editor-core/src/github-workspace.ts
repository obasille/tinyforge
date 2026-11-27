// Workspace on GitHub, for the deployed editor: the project as it is on the
// repository's `web` branch, through the site's proxy (apps/editor/server/ai,
// which holds the token). Edits are kept here and saved as one commit after a
// few seconds without changes, on save(), or when the page goes away.
//
//   GET  __tf/ai/github/tree         { head, files: [{ path, size, sha }] }
//   GET  __tf/ai/github/blob/<sha>   a file's bytes
//   POST __tf/ai/github/commit       { base, message, changes } → { head, blobs } or 409
//
// A file unchanged since the deploy is read from the static copy
// (__tf/files/, whose files.json has each file's Git blob SHA), so loading a
// game costs no GitHub request. A commit never overwrites: when the branch
// moved (another device, or a push from the desktop), the save stops with a
// conflict and the edits stay here until the page is reloaded.

import { isWritablePath } from '@tinyforge/engine/tooling/project-layout';
import { createStore, type Store } from './store.ts';
import { type FileChange, type FileEntry, type Workspace, WorkspaceError, type WorkspaceInfo } from './workspace.ts';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict';

export interface SaveState {
  status: SaveStatus;
  /** Files changed and not committed yet. */
  pending: string[];
  /** Why the last save failed. */
  error?: string;
}

export interface GitHubWorkspaceOptions {
  fetch?: typeof fetch;
  /** Commit after this long without a change (ms). */
  idleMs?: number;
  /** blob: URLs for files not committed yet (URL.createObjectURL in a browser). */
  objectUrl?: (bytes: Uint8Array) => string;
}

interface Remote {
  sha: string;
  size: number;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
/** A number that changes with the content: the editor's FileEntry.mtime. */
const shaTime = (sha: string) => Number.parseInt(sha.slice(0, 12), 16);

/** The Git blob id of these bytes, as GitHub's tree lists it. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export class GitHubWorkspace implements Workspace {
  readonly save: Store<SaveState> = createStore<SaveState>({ status: 'saved', pending: [] });
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly idleMs: number;
  private readonly objectUrl: (bytes: Uint8Array) => string;
  private head = '';
  private remote = new Map<string, Remote>();
  /** The deploy's static copy: path → blob SHA. */
  private staticShas: Map<string, string> | null = null;
  /** Uncommitted edits: bytes, or null for a delete. */
  private readonly edits = new Map<string, { data: Uint8Array | null; version: number }>();
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private readonly listeners = new Set<(changes: FileChange[]) => void>();
  private readonly urls = new Map<string, { version: number; url: string }>();

  constructor(base: string, options: GitHubWorkspaceOptions = {}) {
    this.base = base.endsWith('/') ? base : `${base}/`;
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.idleMs = options.idleMs ?? 5000;
    this.objectUrl =
      options.objectUrl ??
      ((bytes) =>
        URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/octet-stream' })));
  }

  private href(path: string): string {
    return new URL(path, this.base).href;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetch(this.href(path), {
      cache: 'no-store',
      ...init,
      headers: { 'X-TinyForge': '1', ...init.headers },
    });
    if (!res.ok && res.status !== 409) {
      const html = /html|xml/i.test(res.headers.get('content-type') ?? '');
      const text = html ? '' : (await res.text().catch(() => '')).slice(0, 300);
      throw new WorkspaceError(text || `HTTP ${res.status}`, res.status);
    }
    return res;
  }

  /** Read the branch's file list (and the static copy's, once). */
  private async refresh(): Promise<void> {
    if (!this.staticShas) {
      const info = (await (await this.request('__tf/files.json')).json()) as {
        files: Array<{ path: string; sha?: string }>;
      };
      this.staticShas = new Map(info.files.flatMap((f) => (f.sha ? [[f.path, f.sha] as const] : [])));
    }
    const tree = (await (await this.request('__tf/ai/github/tree')).json()) as {
      head: string;
      files: Array<{ path: string; size: number; sha: string }>;
    };
    this.head = tree.head;
    this.remote = new Map(tree.files.map((f) => [f.path, { sha: f.sha, size: f.size }]));
  }

  async list(): Promise<WorkspaceInfo> {
    if (!this.head) await this.refresh();
    return { writable: true, watch: false, files: this.entries() };
  }

  /** The branch's files with the uncommitted edits on top. */
  private entries(): FileEntry[] {
    const files = new Map<string, FileEntry>();
    for (const [path, r] of this.remote) {
      files.set(path, {
        path,
        size: r.size,
        mtime: shaTime(r.sha),
        ...(isWritablePath(path) ? {} : { readonly: true }),
      });
    }
    for (const [path, edit] of this.edits) {
      if (edit.data === null) files.delete(path);
      else files.set(path, { path, size: edit.data.length, mtime: 1e15 + edit.version });
    }
    return [...files.values()];
  }

  async read(path: string): Promise<Uint8Array> {
    const edit = this.edits.get(path);
    if (edit) {
      if (edit.data === null) throw new WorkspaceError(`${path} not found`, 404);
      return edit.data.slice();
    }
    const r = this.remote.get(path);
    if (!r) throw new WorkspaceError(`${path} not found`, 404);
    return new Uint8Array(await (await this.request(this.remotePath(path, r))).arrayBuffer());
  }

  /** The static copy when it holds this version of the file, else the proxy. */
  private remotePath(path: string, r: Remote): string {
    return this.staticShas?.get(path) === r.sha
      ? `__tf/files/${encodePath(path)}?v=${r.sha.slice(0, 12)}`
      : `__tf/ai/github/blob/${r.sha}`;
  }

  private exists(path: string): boolean {
    const edit = this.edits.get(path);
    return edit ? edit.data !== null : this.remote.has(path);
  }

  private change(path: string, data: Uint8Array | null): void {
    if (!isWritablePath(path)) throw new WorkspaceError(`${path} is read-only`, 403);
    this.edits.set(path, { data, version: ++this.version });
    this.setPending();
    this.schedule();
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    this.change(path, typeof data === 'string' ? new TextEncoder().encode(data) : data.slice());
  }

  async delete(path: string): Promise<void> {
    if (!this.exists(path)) throw new WorkspaceError(`${path} not found`, 404);
    this.change(path, null);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.exists(to)) throw new WorkspaceError(`${to} already exists`, 409);
    const data = await this.read(from);
    this.change(to, data);
    this.change(from, null);
  }

  watch(listener: (changes: FileChange[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  url(entry: FileEntry): string {
    const edit = this.edits.get(entry.path);
    if (edit?.data) {
      const cached = this.urls.get(entry.path);
      if (cached?.version === edit.version) return cached.url;
      const url = this.objectUrl(edit.data);
      this.urls.set(entry.path, { version: edit.version, url });
      return url;
    }
    const r = this.remote.get(entry.path);
    return this.href(r ? this.remotePath(entry.path, r) : `__tf/files/${encodePath(entry.path)}`);
  }

  private setPending(extra: Partial<SaveState> = {}): void {
    const pending = [...this.edits.keys()].sort();
    const current = this.save.getState().status;
    const status = extra.status ?? (current === 'conflict' ? 'conflict' : pending.length > 0 ? 'pending' : 'saved');
    this.save.setState({ status, pending, ...(extra.error ? { error: extra.error } : {}) });
  }

  private schedule(): void {
    if (this.save.getState().status === 'conflict') return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.idleMs);
  }

  /** Commit the edits now (the Save button). Resolves when saved, or when the save failed. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.saving) await this.saving;
    if (this.edits.size === 0 || this.save.getState().status === 'conflict') return;
    this.saving = this.commit().finally(() => {
      this.saving = null;
    });
    await this.saving;
  }

  private async commit(): Promise<void> {
    this.setPending({ status: 'saving' });
    try {
      // Edits that put a file back as it is on the branch (an undo, then a
      // redo and an undo...) are dropped: they would make an empty commit.
      const batch = [];
      for (const [path, e] of this.edits) {
        const r = this.remote.get(path);
        const same =
          e.data === null ? !r : r !== undefined && r.size === e.data.length && r.sha === (await gitBlobSha(e.data));
        if (!same) batch.push({ path, ...e });
        else if (this.edits.get(path)?.version === e.version) this.edits.delete(path);
      }
      if (batch.length === 0) {
        this.setPending({ status: this.edits.size > 0 ? 'pending' : 'saved' });
        if (this.edits.size > 0) this.schedule();
        return;
      }
      const names = batch.map((b) => b.path);
      const message =
        names.length === 1
          ? `Edit ${names[0]} (TinyForge editor)`
          : `Edit ${names.length} files (TinyForge editor)\n\n${names.join('\n')}`;
      const res = await this.request('__tf/ai/github/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          base: this.head,
          message,
          changes: batch.map((b) => (b.data === null ? { path: b.path } : { path: b.path, content: base64(b.data) })),
        }),
      });
      if (res.status === 409) {
        this.setPending({
          status: 'conflict',
          error: 'The web branch changed somewhere else. Reload to get it; unsaved changes here are lost.',
        });
        return;
      }
      const { head, blobs } = (await res.json()) as { head: string; blobs: Record<string, string> };
      this.head = head;
      for (const b of batch) {
        if (b.data === null) this.remote.delete(b.path);
        else this.remote.set(b.path, { sha: blobs[b.path], size: b.data.length });
        // An edit made while saving stays for the next commit.
        if (this.edits.get(b.path)?.version === b.version) this.edits.delete(b.path);
      }
      this.setPending({ status: this.edits.size > 0 ? 'pending' : 'saved' });
      if (this.edits.size > 0) this.schedule();
    } catch (e) {
      this.setPending({ status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * The page is going away: send the edits with keepalive, which outlives the
   * page (up to 64 KB). Best effort; the conflict check still applies.
   */
  flushOnExit(): void {
    if (this.saving || this.edits.size === 0 || this.save.getState().status === 'conflict') return;
    const changes = [...this.edits].map(([path, e]) =>
      e.data === null ? { path } : { path, content: base64(e.data) },
    );
    const body = JSON.stringify({ base: this.head, message: 'Edit from the TinyForge editor', changes });
    if (body.length > 60_000) return;
    void this.fetch(this.href('__tf/ai/github/commit'), {
      method: 'POST',
      keepalive: true,
      headers: { 'X-TinyForge': '1', 'content-type': 'application/json' },
      body,
    }).catch(() => {});
  }

  /**
   * Back in the foreground: if the branch moved and nothing is pending, take
   * its files and report what changed; with edits pending, it is a conflict.
   */
  async checkRemote(): Promise<void> {
    if (this.saving || this.save.getState().status === 'conflict') return;
    const before = this.remote;
    const head = this.head;
    const tree = (await (await this.request('__tf/ai/github/tree')).json()) as {
      head: string;
      files: Array<{ path: string; size: number; sha: string }>;
    };
    if (tree.head === head) return;
    if (this.edits.size > 0) {
      this.setPending({
        status: 'conflict',
        error: 'The web branch changed somewhere else. Reload to get it; unsaved changes here are lost.',
      });
      return;
    }
    this.head = tree.head;
    this.remote = new Map(tree.files.map((f) => [f.path, { sha: f.sha, size: f.size }]));
    const changes: FileChange[] = [];
    for (const [path, r] of this.remote) {
      const old = before.get(path);
      if (!old) changes.push({ path, kind: 'add' });
      else if (old.sha !== r.sha) changes.push({ path, kind: 'change' });
    }
    for (const path of before.keys()) if (!this.remote.has(path)) changes.push({ path, kind: 'unlink' });
    if (changes.length > 0) for (const l of [...this.listeners]) l(changes);
  }
}
