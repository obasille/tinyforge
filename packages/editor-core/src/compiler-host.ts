// Main-thread side of the compile Worker, and the editor's build cache.
//
// A build reads files through ProjectFiles (so through the Workspace) when
// the Worker asks for them. Results are cached per game until a file the game
// depends on changes (affectedGames in project-layout.ts). `builds` holds the
// latest state of each game's build, with its diagnostics, for the console,
// the code editor, the Files list and the game picker.

import type { AssetKind, AssetList } from '@tinyforge/engine/tooling/asset-scan';
import { withSourceMapUrl } from '@tinyforge/engine/tooling/cartridge-meta';
import type { CompileResult, CompileTarget, Diagnostic } from '@tinyforge/engine/tooling/compiler';
import { coverIdOf } from '@tinyforge/engine/tooling/game-meta';
import { affectedGames, gameEntryPath, gameOf } from '@tinyforge/engine/tooling/project-layout';
import type { ProjectFiles } from './project-files.ts';
import { createStore, type Store } from './store.ts';
import type { FileChange } from './workspace.ts';

export type ToCompiler =
  | {
      type: 'compile';
      id: number;
      game: string;
      target: CompileTarget;
      assetFiles: Record<AssetKind, string[]>;
    }
  | { type: 'file'; requestId: number; data: string | ArrayBuffer | null };

export type FromCompiler =
  | { type: 'read'; requestId: number; path: string; binary: boolean }
  | { type: 'result'; id: number; result: CompileResult; ms: number };

/** The subset of Worker the compiler host uses (a fake in tests). */
export interface CompilerWorkerLike {
  postMessage(message: ToCompiler, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<FromCompiler>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface BuildState {
  /** 'queued': waiting for the Worker, which compiles one game at a time. */
  status: 'queued' | 'building' | 'ok' | 'failed';
  diagnostics: Diagnostic[];
  log: string;
  /** Compile time of the last finished build. */
  ms: number | null;
  /** Assets the last successful build uses (kept while a later build fails). */
  assets: AssetList | null;
}

export class CompilerHost {
  /** Latest build state per game. */
  readonly builds: Store<Record<string, BuildState>> = createStore<Record<string, BuildState>>({});
  private worker: CompilerWorkerLike | null = null;
  private nextId = 1;
  /** Compiles sent to the Worker, oldest first: the first one is running. */
  private readonly pending = new Map<number, { game: string; resolve: (result: CompileResult, ms: number) => void }>();
  private readonly cache = new Map<string, Promise<CompileResult>>();
  /** COVER id per game, to know which sprite edits need a rebuild. */
  private readonly covers = new Map<string, string | null>();

  constructor(
    private readonly files: ProjectFiles,
    private readonly createWorker: () => CompilerWorkerLike,
  ) {}

  /** Debug build of a game, compiled once until its files change. */
  build(game: string, target: CompileTarget = 'debug'): Promise<CompileResult> {
    const key = `${game}:${target}`;
    let result = this.cache.get(key);
    if (!result) {
      result = this.compile(game, target);
      this.cache.set(key, result);
    }
    return result;
  }

  /**
   * Forget the builds a batch of changes makes stale. Returns the games
   * affected, whether or not they had been built.
   */
  invalidate(changes: FileChange[]): string[] {
    const games = this.files.games;
    const affected = new Set<string>();
    for (const change of changes) {
      const game = gameOf(change.path);
      if (game && change.path === gameEntryPath(game)) this.covers.delete(game);
      const hit = affectedGames(change.path, change.kind, games, (g) => this.covers.get(g));
      for (const g of hit ?? []) affected.add(g);
    }
    for (const key of [...this.cache.keys()]) {
      if (affected.has(key.slice(0, key.lastIndexOf(':')))) this.cache.delete(key);
    }
    return [...affected].sort();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private ensureWorker(): CompilerWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => {
      // A crashed Worker fails what it was doing; the next build starts a new one.
      const message = `Compile worker error: ${event.message}`;
      for (const { resolve } of this.pending.values()) resolve({ ok: false, log: `${message}\n`, diagnostics: [] }, 0);
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private async compile(game: string, target: CompileTarget): Promise<CompileResult> {
    this.setBuild(game, (b) => ({
      status: 'queued',
      diagnostics: b?.diagnostics ?? [],
      log: b?.log ?? '',
      ms: b?.ms ?? null,
      assets: b?.assets ?? null,
    }));
    const source = await this.files.readText(gameEntryPath(game));
    this.covers.set(game, source === null ? null : coverIdOf(source));
    const id = this.nextId++;
    const done = await new Promise<{ result: CompileResult; ms: number }>((resolve) => {
      this.pending.set(id, { game, resolve: (r, t) => resolve({ result: r, ms: t }) });
      this.ensureWorker().postMessage({ type: 'compile', id, game, target, assetFiles: this.files.assetFiles });
      this.markRunning();
    });
    const { ms } = done;
    const result = this.withSourceMap(done.result);
    this.setBuild(game, (b) => ({
      status: result.ok ? 'ok' : 'failed',
      diagnostics: result.diagnostics,
      log: result.log,
      ms,
      assets: result.ok ? result.meta.assets : (b?.assets ?? null),
    }));
    return result;
  }

  /**
   * Debug builds: embed the source map (as a data: URL in the module's
   * sourceMappingURL section) with sources pointing at the Workspace's file
   * URLs, so browser DevTools show and break in the AssemblyScript source.
   */
  private withSourceMap(result: CompileResult): CompileResult {
    if (!result.ok || !result.sourceMap) return result;
    const map = JSON.parse(result.sourceMap) as { sources?: string[] };
    map.sources = map.sources?.map((p) => {
      const entry = this.files.entry(p);
      return entry ? this.files.workspace.url(entry) : p;
    });
    const bytes = new TextEncoder().encode(JSON.stringify(map));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const url = `data:application/json;base64,${btoa(binary)}`;
    return { ...result, wasm: withSourceMapUrl(result.wasm, url) };
  }

  /** The Worker compiles in order: the oldest pending compile is the one running. */
  private markRunning(): void {
    const first = this.pending.values().next().value;
    if (first && this.builds.getState()[first.game]?.status === 'queued') {
      this.setBuild(first.game, (b) => ({ ...(b as BuildState), status: 'building' }));
    }
  }

  private setBuild(game: string, update: (previous: BuildState | undefined) => BuildState): void {
    this.builds.setState((all) => ({ ...all, [game]: update(all[game]) }));
  }

  private receive(msg: FromCompiler): void {
    if (msg.type === 'result') {
      const done = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      done?.resolve(msg.result, msg.ms);
      this.markRunning();
      return;
    }
    const { requestId, path, binary } = msg;
    void (async () => {
      let data: string | ArrayBuffer | null = null;
      if (binary) {
        const bytes = await this.files.readBytes(path);
        data = bytes ? (bytes.slice().buffer as ArrayBuffer) : null;
      } else {
        data = await this.files.readText(path);
      }
      const transfer = data instanceof ArrayBuffer ? [data] : [];
      this.worker?.postMessage({ type: 'file', requestId, data }, transfer);
    })();
  }
}
