// The game loop that runs inside the Worker. Written against small injected
// interfaces (post, clock, frame scheduler, fetch, 2D context) so tests can run
// it in Node with real cartridges and no browser.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tinyforge/engine/memory-map';
import { readMeta } from '@tinyforge/engine/tooling/cartridge-meta';
import {
  FixedStepClock,
  GameMachine,
  type InputState,
  NO_INPUT,
  type SpriteImage,
  sheetLayout,
  splitSheet,
  writeSpriteTable,
} from '@tinyforge/runtime';
import type { AssetRef, FrameStats, FromWorker, RunStatus, ToWorker } from './protocol.ts';

export interface WorkerEnv {
  post(message: FromWorker, transfer?: Transferable[]): void;
  now(): number;
  requestFrame(callback: (now: number) => void): void;
  fetch(
    url: string,
  ): Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;
  /** Decode an image file to RGBA; absent where there is no image decoder. */
  decodeImage?(bytes: ArrayBuffer): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }>;
}

interface Watch {
  offset: number;
  length: number;
}

const STATS_INTERVAL_MS = 250;
const PERF_SAMPLES = 60;

export class GameWorkerCore {
  private readonly machine: GameMachine;
  private readonly clock = new FixedStepClock();
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private status: RunStatus = 'idle';
  private game: string | null = null;
  private input: InputState = { ...NO_INPUT };
  private readonly watches = new Map<number, Watch>();
  /** The sprite library by ID (every sprite a game could use). */
  private library = new Map<string, AssetRef>();
  /** Decoded sprites by URL; a changed file gets a new URL. */
  private readonly decoded = new Map<string, SpriteImage>();
  /** The current game's sprite IDs, in sprite table order. */
  private gameSprites: string[] = [];
  private frameQueued = false;
  private loadSeq = 0;
  // Stats
  private updateSamples: number[] = [];
  private drawSamples: number[] = [];
  private frames = 0;
  private lastStatsAt = 0;
  private lastUpdates = 0;

  constructor(private readonly env: WorkerEnv) {
    this.machine = new GameMachine({
      log: (level, message) => env.post({ type: 'log', level, message }),
      audio: (command) => env.post({ type: 'audio', command }),
    });
  }

  async handle(msg: ToWorker): Promise<void> {
    switch (msg.type) {
      case 'init':
        this.ctx = msg.canvas.getContext('2d', { alpha: false });
        this.setLibrary(msg.sprites);
        break;
      case 'library':
        this.setLibrary(msg.sprites);
        if (this.game && this.machine.loaded) {
          // Sprite hot reload: same IDs in the same order, new pixels.
          await this.writeSprites(this.game, this.gameSprites);
          if (this.status !== 'running') this.present();
        }
        break;
      case 'load':
        await this.load(msg.url, msg.name, msg.keepState, msg.seed);
        break;
      case 'pause':
        if (this.status === 'running') this.setStatus('paused');
        break;
      case 'resume':
        if (this.status === 'paused') {
          this.setStatus('running');
          this.clock.reset(this.env.now());
          this.queueFrame();
        }
        break;
      case 'step':
        if (this.status === 'running') this.setStatus('paused');
        if (this.status === 'paused') {
          for (let i = 0; i < msg.count && !this.machine.aborted; i++) this.machine.tick(this.input);
          this.present();
          if (this.machine.aborted) this.setStatus('aborted');
        }
        break;
      case 'restart':
        this.restart(msg.seed);
        break;
      case 'input':
        this.input = msg.input;
        break;
      case 'watch':
        this.watches.set(msg.id, { offset: msg.offset, length: msg.length });
        this.postWatches();
        break;
      case 'unwatch':
        this.watches.delete(msg.id);
        break;
      case 'snapshot': {
        const bytes = this.machine.snapshot().buffer as ArrayBuffer;
        this.env.post({ type: 'snapshot', requestId: msg.requestId, bytes }, [bytes]);
        break;
      }
      case 'restore':
        this.machine.restore(new Uint8Array(msg.bytes));
        if (this.status === 'aborted') this.setStatus('paused');
        this.present();
        this.env.post({ type: 'restored', requestId: msg.requestId });
        break;
      case 'ping':
        this.env.post({ type: 'pong', id: msg.id });
        break;
    }
  }

  private setLibrary(refs: AssetRef[]): void {
    this.library = new Map(refs.map((ref) => [ref.id, ref]));
    const urls = new Set(refs.map((ref) => ref.url));
    for (const url of this.decoded.keys()) if (!urls.has(url)) this.decoded.delete(url);
  }

  /** Decode one sprite (cached by URL), or null with a log line. */
  private async sprite(id: string): Promise<SpriteImage | null> {
    const ref = this.library.get(id);
    if (!ref) {
      this.hostLog(`Sprite ${id} is not in the library`);
      return null;
    }
    const cached = this.decoded.get(ref.url);
    if (cached) return cached;
    const decode = this.env.decodeImage;
    if (!decode) return null;
    try {
      const res = await this.env.fetch(ref.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { width, height, rgba } = await decode(await res.arrayBuffer());
      const { cols, rows } = sheetLayout(ref.format);
      const image = { id, cols, rows, ...splitSheet(rgba, width, height, cols, rows) };
      this.decoded.set(ref.url, image);
      return image;
    } catch (e) {
      this.hostLog(`Failed to load sprite ${id} from ${ref.url}: ${errorText(e)}`);
      return null;
    }
  }

  /** Decode the given sprites and write the sprite table the SDK reads. */
  private async writeSprites(game: string, ids: string[]): Promise<void> {
    const sprites: SpriteImage[] = [];
    for (const id of ids) {
      const image = await this.sprite(id);
      if (image) sprites.push(image);
    }
    const { bytes, warnings } = writeSpriteTable(this.machine.memory.buffer, sprites);
    for (const w of warnings) this.hostLog(w);
    this.env.post({ type: 'sprites', game, spriteCount: sprites.length, spriteBytes: bytes });
  }

  private async load(url: string, name: string, keepState: boolean, seed: number | null): Promise<void> {
    const seq = ++this.loadSeq;
    const resume = keepState && this.status === 'paused' ? 'paused' : 'running';
    this.setStatus('loading', name);
    try {
      const res = await this.env.fetch(url);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      if (seq !== this.loadSeq) return; // a newer load won
      const meta = readMeta(new Uint8Array(bytes));
      if (!meta) this.hostLog(`${name} has no tinyforge.meta section: no assets loaded`);
      const used = meta?.assets ?? { sprites: [], sfx: [], music: [] };
      // The sprite table is host data. A hot reload keeps the order the game
      // saw (it may hold sprite IDs in memory) and appends new sprites.
      const ids = keepState
        ? [...this.gameSprites, ...used.sprites.filter((id) => !this.gameSprites.includes(id))]
        : used.sprites;
      if (!keepState) {
        // A fresh load starts from clean memory.
        new Uint8Array(this.machine.memory.buffer).fill(0);
        this.machine.seed = pickSeed(seed);
      }
      await this.writeSprites(name, ids);
      if (seq !== this.loadSeq) return;
      this.gameSprites = ids;
      this.env.post({ type: 'assets', game: name, assets: used });
      await this.machine.load(bytes, { keepState });
      this.game = name;
      if (!keepState) this.hostLog(`RNG seed: ${formatSeed(this.machine.seed)}`);
      if (this.machine.aborted) {
        this.setStatus('aborted');
        return;
      }
      this.setStatus(resume);
      this.clock.reset(this.env.now());
      if (resume === 'running') this.queueFrame();
      else this.present();
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.env.post({ type: 'log', level: 'ERROR', message: `Failed to load ${name}: ${errorText(e)}` });
      this.setStatus('aborted', name);
    }
  }

  private restart(seed: number | null): void {
    if (!this.machine.loaded) return;
    if (seed !== null) this.machine.seed = seed;
    this.hostLog(`RNG seed: ${formatSeed(this.machine.seed)}`);
    this.machine.init();
    this.clock.reset(this.env.now());
    if (this.machine.aborted) {
      this.setStatus('aborted');
      return;
    }
    if (this.status !== 'paused') {
      this.setStatus('running');
      this.queueFrame();
    } else {
      this.present();
    }
  }

  private queueFrame(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    this.env.requestFrame((now) => {
      this.frameQueued = false;
      this.frame(now);
    });
  }

  /** One display frame: fixed-step updates, then draw and present. */
  frame(now: number): void {
    if (this.status !== 'running') return;
    const steps = this.clock.advance(now);
    const t0 = this.env.now();
    for (let i = 0; i < steps && !this.machine.aborted; i++) this.machine.tick(this.input);
    const t1 = this.env.now();
    this.present();
    const t2 = this.env.now();
    this.recordStats(now, steps, t1 - t0, t2 - t1);
    if (this.machine.aborted) {
      this.setStatus('aborted');
      return;
    }
    this.queueFrame();
  }

  /** draw(), blit to the canvas, push memory watches. */
  private present(): void {
    this.machine.draw();
    if (this.ctx) {
      this.image ??= new ImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
      this.image.data.set(this.machine.framebuffer());
      this.ctx.putImageData(this.image, 0, 0);
    }
    this.postWatches();
  }

  private postWatches(): void {
    if (this.watches.size === 0) return;
    const slices: Array<{ id: number; offset: number; bytes: ArrayBuffer }> = [];
    for (const [id, w] of this.watches) {
      slices.push({ id, offset: w.offset, bytes: this.machine.read(w.offset, w.length).buffer as ArrayBuffer });
    }
    this.env.post(
      { type: 'watches', ticks: this.machine.ticks, slices },
      slices.map((s) => s.bytes),
    );
  }

  private recordStats(now: number, updates: number, updateMs: number, drawMs: number): void {
    push(this.updateSamples, updateMs);
    push(this.drawSamples, drawMs);
    this.frames++;
    this.lastUpdates = updates;
    if (this.lastStatsAt === 0) this.lastStatsAt = now;
    const elapsed = now - this.lastStatsAt;
    if (elapsed < STATS_INTERVAL_MS) return;
    const stats: FrameStats = {
      fps: Math.round((this.frames * 1000) / elapsed),
      updateMs: avg(this.updateSamples),
      drawMs: avg(this.drawSamples),
      updates: this.lastUpdates,
      ticks: this.machine.ticks,
      seed: this.machine.seed,
    };
    this.frames = 0;
    this.lastStatsAt = now;
    this.env.post({ type: 'stats', stats });
  }

  private setStatus(status: RunStatus, game: string | null = this.game): void {
    this.status = status;
    this.game = game;
    this.env.post({ type: 'status', status, game });
  }

  private hostLog(message: string): void {
    this.env.post({ type: 'log', level: 'HOST', message });
  }
}

function push(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > PERF_SAMPLES) samples.shift();
}

function avg(samples: number[]): number {
  return samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
}

function pickSeed(seed: number | null): number {
  if (seed !== null) return seed;
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
}

export function formatSeed(value: number): string {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
