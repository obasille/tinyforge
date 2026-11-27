// Workspace over HTTP: the protocol the editor's Vite plugin serves
// (apps/editor/vite/tinyforge-plugin.ts). The same protocol fits a hosted
// server, and a static copy of the project serves its read-only part
// (files.json says writable: false and watch: false).

import type { FileChange, FileEntry, Workspace, WorkspaceInfo } from './workspace.ts';
import { WorkspaceError } from './workspace.ts';

/** The part of EventSource the workspace uses. */
export interface EventStream {
  onmessage: ((e: MessageEvent<string>) => void) | null;
  close(): void;
}

export interface HttpWorkspaceOptions {
  fetch?: typeof fetch;
  /** Opens the change stream (EventSource in a browser). */
  openEvents?: (url: string) => EventStream;
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export class HttpWorkspace implements Workspace {
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly openEvents: HttpWorkspaceOptions['openEvents'];
  private canWatch = false;

  /** `base` is the URL the protocol's paths are relative to (ends with `/`). */
  constructor(base: string, options: HttpWorkspaceOptions = {}) {
    this.base = base.endsWith('/') ? base : `${base}/`;
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.openEvents =
      options.openEvents ??
      (typeof EventSource === 'function' ? (url): EventStream => new EventSource(url) : undefined);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.fetch(new URL(path, this.base).href, { cache: 'no-store', ...init });
    if (!res.ok) {
      // A web server's own error page (HTML) says nothing useful: keep only the status.
      const html = /html|xml/i.test(res.headers.get('content-type') ?? '');
      const text = html ? '' : (await res.text().catch(() => '')).slice(0, 300);
      throw new WorkspaceError(text || `HTTP ${res.status}`, res.status);
    }
    return res;
  }

  private mutate(path: string, init: RequestInit): Promise<Response> {
    return this.request(path, { ...init, headers: { ...init.headers, 'X-TinyForge': '1' } });
  }

  async list(): Promise<WorkspaceInfo> {
    const info = (await (await this.request('__tf/files.json')).json()) as WorkspaceInfo;
    this.canWatch = info.watch;
    return info;
  }

  async read(path: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request(`__tf/files/${encodePath(path)}`)).arrayBuffer());
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const body = typeof data === 'string' ? data : (data.slice() as Uint8Array<ArrayBuffer>);
    await this.mutate(`__tf/files/${encodePath(path)}`, { method: 'PUT', body });
  }

  async delete(path: string): Promise<void> {
    await this.mutate(`__tf/files/${encodePath(path)}`, { method: 'DELETE' });
  }

  async rename(from: string, to: string): Promise<void> {
    await this.mutate('__tf/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
  }

  watch(listener: (changes: FileChange[]) => void): () => void {
    if (!this.canWatch || !this.openEvents) return () => {};
    const source = this.openEvents(new URL('__tf/events', this.base).href);
    source.onmessage = (e) => {
      try {
        const { changes } = JSON.parse(e.data) as { changes: FileChange[] };
        if (changes.length > 0) listener(changes);
      } catch {
        // Not a change message.
      }
    };
    return () => source.close();
  }

  url(entry: FileEntry): string {
    return new URL(`__tf/files/${encodePath(entry.path)}?v=${entry.mtime}`, this.base).href;
  }
}
