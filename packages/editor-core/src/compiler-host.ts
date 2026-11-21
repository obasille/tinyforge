// Main-thread side of the compile Workers, and the editor's build cache.
// Up to `maxWorkers` games compile at the same time, one per Worker; the
// others wait in a queue.
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
  /** 'queued': waiting for a free compile Worker. */
  status: 'queued' | 'building' | 'ok' | 'failed';
  diagnostics: Diagnostic[];
  log: string;
  /** Compile time of the last finished build. */
  ms: number | null;
  /** Assets the last successful build uses (kept while a later build fails). */
  assets: AssetList | null;
}

/** A compile waiting for, or running in, a Worker. */
interface Job {
  id: number;
  game: string;
  target: CompileTarget;
  resolve: (result: CompileResult, ms: number) => void;
}

/** A compile Worker; it compiles one game at a time. */
interface Slot {
  worker: CompilerWorkerLike;
  job: Job | null;
}

export class CompilerHost {
  /** Latest build state per game. */
  readonly builds: Store<Record<string, BuildState>> = createStore<Record<string, BuildState>>({});
  /** Up to `maxWorkers` Workers, started when needed and kept for the next builds. */
  private readonly slots: Slot[] = [];
  /** Compiles waiting for a free Worker, oldest first. */
  private readonly queue: Job[] = [];
  private nextId = 1;
  private readonly cache = new Map<string, Promise<CompileResult>>();
  /** COVER id per game, to know which sprite edits need a rebuild. */
  private readonly covers = new Map<string, string | null>();

  constructor(
    private readonly files: ProjectFiles,
    private readonly createWorker: () => CompilerWorkerLike,
    /** Games compiled at the same time. Each Worker holds its own compiler. */
    private readonly maxWorkers = 1,
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
    for (const slot of this.slots.splice(0)) slot.worker.terminate();
  }

  /** Start queued compiles on free Workers (starting Workers up to maxWorkers). */
  private dispatch(): void {
    while (this.queue.length > 0) {
      let slot = this.slots.find((s) => !s.job);
      if (!slot && this.slots.length < this.maxWorkers) slot = this.startWorker();
      if (!slot) return;
      const job = this.queue.shift() as Job;
      slot.job = job;
      this.setBuild(job.game, (b) => ({ ...(b as BuildState), status: 'building' }));
      const { id, game, target } = job;
      slot.worker.postMessage({ type: 'compile', id, game, target, assetFiles: this.files.assetFiles });
    }
  }

  private startWorker(): Slot {
    const slot: Slot = { worker: this.createWorker(), job: null };
    slot.worker.onmessage = (event) => this.receive(slot, event.data);
    slot.worker.onerror = (event) => {
      // A crashed Worker fails what it was doing; the next build starts a new one.
      slot.worker.terminate();
      this.slots.splice(this.slots.indexOf(slot), 1);
      const message = `Compile worker error: ${event.message}\n`;
      slot.job?.resolve({ ok: false, log: message, diagnostics: [] }, 0);
      this.dispatch();
    };
    this.slots.push(slot);
    return slot;
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
    const done = await new Promise<{ result: CompileResult; ms: number }>((resolve) => {
      this.queue.push({ id: this.nextId++, game, target, resolve: (r, t) => resolve({ result: r, ms: t }) });
      this.dispatch();
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

  private setBuild(game: string, update: (previous: BuildState | undefined) => BuildState): void {
    this.builds.setState((all) => ({ ...all, [game]: update(all[game]) }));
  }

  private receive(slot: Slot, msg: FromCompiler): void {
    if (msg.type === 'result') {
      const job = slot.job;
      slot.job = null;
      if (job?.id === msg.id) job.resolve(msg.result, msg.ms);
      this.dispatch();
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
      slot.worker.postMessage({ type: 'file', requestId, data }, transfer);
    })();
  }
}
