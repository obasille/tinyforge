// Main-thread side of the game Worker. The editor talks to the running game
// only through this class: load, pause, step, restart, input, memory watches,
// snapshots. It also watches for a hung game (an update() that never returns)
// and can kill and restart the Worker without touching the editor.

import type { AudioCommand, InputState, LogLevel } from '@tinyforge/runtime';
import type { AssetRef, FrameStats, FromWorker, RunStatus, ToWorker } from './protocol.ts';
import { createStore, type Store } from './store.ts';

/** The subset of Worker that GameHost uses (a fake in tests). */
export interface WorkerLike {
  postMessage(message: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

export interface GameHostOptions {
  createWorker(): WorkerLike;
  /**
   * A fresh canvas for each Worker. A canvas can be transferred only once, so
   * after a kill the viewport has to swap in a new element.
   */
  createCanvas(): { transferControlToOffscreen(): OffscreenCanvas };
  sprites: AssetRef[];
  onLog?(level: LogLevel | 'HOST', message: string): void;
  onAudio?(command: AudioCommand): void;
  /** Time without a reply to a ping before the game counts as hung. */
  hangTimeoutMs?: number;
  pingIntervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface GameSession {
  status: RunStatus;
  game: string | null;
  stats: FrameStats | null;
  spriteCount: number;
  /** Bumped each time the Worker is replaced. */
  generation: number;
}

export type WatchListener = (bytes: Uint8Array, offset: number, ticks: number) => void;

export class GameHost {
  readonly session: Store<GameSession>;
  private worker!: WorkerLike;
  private readonly watches = new Map<number, { offset: number; length: number; listener: WatchListener }>();
  private nextId = 1;
  private readonly pending = new Map<number, (value: ArrayBuffer | null) => void>();
  private lastLoad: Extract<ToWorker, { type: 'load' }> | null = null;
  private lastInput: InputState | null = null;
  private pingTimer: unknown = null;
  private lastPong = 0;
  private outstandingPing = 0;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;
  private disposed = false;
  private statusBeforeHang: RunStatus = 'running';

  constructor(private readonly options: GameHostOptions) {
    this.setTimer = options.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
    this.session = createStore<GameSession>({ status: 'idle', game: null, stats: null, spriteCount: 0, generation: 0 });
    this.start();
  }

  load(name: string, url: string, { keepState = false, seed = null as number | null } = {}): void {
    this.lastLoad = { type: 'load', name, url, keepState, seed };
    this.send(this.lastLoad);
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  resume(): void {
    this.send({ type: 'resume' });
  }

  step(count = 1): void {
    this.send({ type: 'step', count });
  }

  restart(seed: number | null = null): void {
    this.send({ type: 'restart', seed });
  }

  setInput(input: InputState): void {
    this.lastInput = input;
    this.send({ type: 'input', input });
  }

  /**
   * Receive a copy of `length` bytes at `offset` after every drawn frame (and
   * after steps and restores while paused). Returns an unsubscribe function.
   */
  watch(offset: number, length: number, listener: WatchListener): () => void {
    const id = this.nextId++;
    this.watches.set(id, { offset, length, listener });
    this.send({ type: 'watch', id, offset, length });
    return () => {
      if (this.watches.delete(id)) this.send({ type: 'unwatch', id });
    };
  }

  /** Copy of all game memory (1 MB). */
  snapshot(): Promise<Uint8Array> {
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, (bytes) =>
        bytes ? resolve(new Uint8Array(bytes)) : reject(new Error('Game worker was restarted')),
      );
      this.send({ type: 'snapshot', requestId });
    });
  }

  restore(bytes: Uint8Array): Promise<void> {
    const requestId = this.nextId++;
    const copy = bytes.slice().buffer as ArrayBuffer;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, (ok) => (ok ? resolve() : reject(new Error('Game worker was restarted'))));
      this.send({ type: 'restore', requestId, bytes: copy }, [copy]);
    });
  }

  /**
   * Kill the Worker (for example a game stuck in an infinite loop) and start
   * a new one. With `reload`, the last game is loaded again from scratch.
   */
  kill({ reload = true } = {}): void {
    this.stop();
    this.options.onLog?.('HOST', 'Game worker stopped');
    this.start();
    if (reload && this.lastLoad) this.send({ ...this.lastLoad, keepState: false });
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  private start(): void {
    const worker = this.options.createWorker();
    this.worker = worker;
    worker.onmessage = (event) => this.receive(event.data);
    worker.onerror = (event) => {
      this.options.onLog?.('ERROR', `Game worker error: ${event.message}`);
    };
    const canvas = this.options.createCanvas().transferControlToOffscreen();
    worker.postMessage({ type: 'init', canvas, sprites: this.options.sprites }, [canvas]);
    for (const [id, w] of this.watches) worker.postMessage({ type: 'watch', id, offset: w.offset, length: w.length });
    if (this.lastInput) worker.postMessage({ type: 'input', input: this.lastInput });
    this.session.setState((s) => ({ ...s, status: 'idle', stats: null, generation: s.generation + 1 }));
    this.lastPong = Date.now();
    const interval = this.options.pingIntervalMs ?? 500;
    this.pingTimer = this.setTimer(() => this.checkAlive(), interval);
  }

  private stop(): void {
    if (this.pingTimer !== null) this.clearTimer(this.pingTimer);
    this.pingTimer = null;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }

  private checkAlive(): void {
    if (this.disposed) return;
    const timeout = this.options.hangTimeoutMs ?? 3000;
    const s = this.session.getState();
    if (Date.now() - this.lastPong > timeout && s.status !== 'hung' && s.status !== 'idle') {
      this.statusBeforeHang = s.status;
      this.session.setState((prev) => ({ ...prev, status: 'hung' }));
      this.options.onLog?.('ERROR', `Game has not responded for ${Math.round(timeout / 1000)} s (infinite loop?)`);
    }
    if (this.outstandingPing === 0) {
      this.outstandingPing = this.nextId++;
      this.worker.postMessage({ type: 'ping', id: this.outstandingPing });
    }
  }

  private send(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case 'ready':
        this.session.setState((s) => ({ ...s, spriteCount: msg.spriteCount }));
        this.options.onLog?.('HOST', `Sprites loaded: ${msg.spriteCount} (${(msg.spriteBytes / 1024).toFixed(1)} KB)`);
        break;
      case 'status':
        this.session.setState((s) => ({ ...s, status: msg.status, game: msg.game }));
        break;
      case 'log':
        this.options.onLog?.(msg.level, msg.message);
        break;
      case 'audio':
        this.options.onAudio?.(msg.command);
        break;
      case 'stats':
        this.session.setState((s) => ({ ...s, stats: msg.stats }));
        break;
      case 'watches':
        for (const slice of msg.slices) {
          this.watches.get(slice.id)?.listener(new Uint8Array(slice.bytes), slice.offset, msg.ticks);
        }
        break;
      case 'snapshot':
        this.pending.get(msg.requestId)?.(msg.bytes);
        this.pending.delete(msg.requestId);
        break;
      case 'restored':
        this.pending.get(msg.requestId)?.(new ArrayBuffer(0));
        this.pending.delete(msg.requestId);
        break;
      case 'pong':
        if (msg.id === this.outstandingPing) this.outstandingPing = 0;
        this.lastPong = Date.now();
        if (this.session.getState().status === 'hung') {
          // It came back (a very slow frame, not an infinite loop).
          this.session.setState((s) => ({ ...s, status: this.statusBeforeHang }));
        }
        break;
    }
  }
}
