// One running cartridge: its memory, imports and lifecycle calls.
//
// The module imports env.memory plus the env functions below, and exports
// init, update and draw. Memory is sized per game: the cartridge's
// tinyforge.meta gives its layout version, RAM size and the minimum memory
// its module declares; the host adds room past that for its own data (the
// sprite table). All game state lives in linear memory, so keeping the Memory
// object across a re-instantiation is what makes hot reload keep state.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tinyforge/engine/memory-map';
import { type CartridgeMeta, readMeta } from '@tinyforge/engine/tooling/cartridge-meta';
import { type InputState, NO_INPUT, writeInput } from './input.ts';
import { CURRENT_LAYOUT, layoutFor, type MemoryLayout, PAGE_SIZE, pagesFor } from './layout.ts';
import { interpolate, readString } from './strings.ts';

/** What the machine knows about the loaded cartridge's memory. */
export interface MemoryInfo {
  layout: MemoryLayout;
  /** Game RAM size in bytes, from layout.ramStart. */
  ram: number;
  /** End of the module's static data; host data (the sprite table) starts here. */
  hostDataAddr: number;
  /** Total memory size in bytes. */
  size: number;
}

export type LogLevel = 'LOG' | 'WARN' | 'ERROR' | 'TRACE' | 'ABORT';

export type AudioCommand =
  | { type: 'sfx'; id: string; volume: number }
  | { type: 'music'; id: string; volume: number }
  | { type: 'stopMusic' };

export interface MachineHost {
  log(level: LogLevel, message: string): void;
  audio(command: AudioCommand): void;
}

type Lifecycle = () => void;
interface CartridgeExports {
  init: Lifecycle;
  update: Lifecycle;
  draw: Lifecycle;
}

export class GameMachine {
  /** Replaced by each fresh prepare(); grown in place otherwise. */
  memory: WebAssembly.Memory;
  private layout: MemoryLayout = CURRENT_LAYOUT;
  private prepared: { layout: number; ram: number; hostDataAddr: number } | null = null;
  /** prepare() ran since the last load(). */
  private ready = false;
  private exports: CartridgeExports | null = null;
  private previous: InputState = { ...NO_INPUT };
  /** Set when the game aborted or threw; it stays stopped until restart. */
  aborted = false;
  /** Number of update() calls since the last init(). */
  ticks = 0;

  constructor(private readonly host: MachineHost) {
    // Enough for the framebuffer and system block until a game is prepared.
    this.memory = new WebAssembly.Memory({ initial: pagesFor(CURRENT_LAYOUT.ramStart) });
  }

  /**
   * Get memory ready for a cartridge, with `hostBytes` past its static data
   * for the host's own data (the sprite table, at info.hostDataAddr).
   *
   * With `keepState`, the current memory is kept (and grown if needed) as long
   * as the layout and RAM size did not change. Otherwise the game gets a fresh,
   * zeroed memory. Returns whether state was kept. Throws for a layout this
   * host does not know.
   */
  prepare(
    meta: Pick<CartridgeMeta, 'layout' | 'ram' | 'memory'>,
    hostBytes: number,
    { keepState = false } = {},
  ): boolean {
    const layout = layoutFor(meta.layout);
    const size = meta.memory + hostBytes;
    const kept =
      keepState && this.prepared !== null && this.prepared.layout === meta.layout && this.prepared.ram === meta.ram;
    if (kept) this.ensureSize(size);
    else {
      this.exports = null;
      this.memory = new WebAssembly.Memory({ initial: pagesFor(size) });
    }
    this.layout = layout;
    this.prepared = { layout: meta.layout, ram: meta.ram, hostDataAddr: meta.memory };
    this.ready = true;
    return kept;
  }

  /** Grow memory to at least `bytes` (more host data, e.g. reloaded sprites). */
  ensureSize(bytes: number): void {
    const missing = pagesFor(bytes) - this.memory.buffer.byteLength / PAGE_SIZE;
    if (missing > 0) this.memory.grow(missing);
  }

  /** The prepared cartridge's memory, or null before prepare(). */
  get info(): MemoryInfo | null {
    if (!this.prepared) return null;
    return {
      layout: this.layout,
      ram: this.prepared.ram,
      hostDataAddr: this.prepared.hostDataAddr,
      size: this.memory.buffer.byteLength,
    };
  }

  get loaded(): boolean {
    return this.exports !== null;
  }

  /**
   * Instantiate a cartridge into this machine's memory. With `keepState`,
   * init() is skipped so the game resumes from what memory holds (hot
   * reload). Without a prepare() call first, memory is prepared from the
   * cartridge's metadata with no host data (no sprites).
   */
  async load(bytes: BufferSource, { keepState = false } = {}): Promise<void> {
    if (!this.ready) {
      const view = ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes);
      keepState = this.prepare(cartridgeMeta(view), 0, { keepState });
    }
    this.ready = false;
    this.exports = null;
    this.aborted = false;
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, { env: this.createEnv() });
    const exp = instance.exports as Partial<CartridgeExports>;
    const missing = (['init', 'update', 'draw'] as const).filter((k) => typeof exp[k] !== 'function');
    if (missing.length > 0) {
      throw new Error(`Cartridge missing required exports: ${missing.join(', ')}`);
    }
    this.exports = exp as CartridgeExports;
    if (!keepState) this.init();
  }

  /** Run the game's init() (restart). */
  init(): void {
    if (!this.exports) return;
    this.aborted = false;
    this.ticks = 0;
    this.previous = { ...NO_INPUT };
    this.guard('init', () => this.exports?.init());
  }

  /** One fixed step: publish input, then update(). */
  tick(input: InputState): void {
    if (!this.exports || this.aborted) return;
    writeInput(this.memory.buffer, this.layout, input, this.previous);
    this.guard('update', () => this.exports?.update());
    this.previous = { ...input };
    this.ticks++;
  }

  draw(): void {
    if (!this.exports || this.aborted) return;
    this.guard('draw', () => this.exports?.draw());
  }

  /** The framebuffer as RGBA bytes (a live view, not a copy). */
  framebuffer(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.memory.buffer, this.layout.fbStart, this.layout.fbSize);
  }

  get seed(): number {
    return new DataView(this.memory.buffer).getInt32(this.layout.rngSeedAddr, true);
  }

  set seed(value: number) {
    new DataView(this.memory.buffer).setInt32(this.layout.rngSeedAddr, value | 0, true);
  }

  /** Copy of `length` bytes at `offset`, clamped to memory. */
  read(offset: number, length: number): Uint8Array {
    const size = this.memory.buffer.byteLength;
    const start = Math.max(0, Math.min(offset, size));
    const end = Math.max(start, Math.min(offset + length, size));
    return new Uint8Array(this.memory.buffer.slice(start, end));
  }

  /** Copy of all of memory: game state, framebuffer, input and sprites. */
  snapshot(): Uint8Array {
    return new Uint8Array(this.memory.buffer.slice(0));
  }

  /**
   * Put a snapshot of this game back. Memory grows if the snapshot is larger
   * (it may hold a bigger sprite table); bytes past a smaller one are cleared.
   */
  restore(bytes: Uint8Array): void {
    if (bytes.byteLength % PAGE_SIZE !== 0) {
      throw new Error(`Snapshot is ${bytes.byteLength} bytes, not a whole number of 64 KB pages`);
    }
    this.ensureSize(bytes.byteLength);
    const memory = new Uint8Array(this.memory.buffer);
    memory.set(bytes);
    memory.fill(0, bytes.byteLength);
    this.aborted = false;
  }

  private guard(phase: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      // abort() has already logged the reason before the trap that follows it.
      const reported = this.aborted;
      this.aborted = true;
      if (reported) return;
      const message = e instanceof Error ? e.message : String(e);
      this.host.log('ERROR', `Error in ${phase}(): ${message}`);
    }
  }

  private createEnv(): Record<string, WebAssembly.ImportValue> {
    const str = (ptr: number) => readString(this.memory.buffer, ptr);
    const { host } = this;
    const fb32 = () => new Uint32Array(this.memory.buffer, this.layout.fbStart, SCREEN_WIDTH * SCREEN_HEIGHT);
    const logFns = (level: LogLevel, name: string) => ({
      [`console.${name}`]: (msg: number) => host.log(level, str(msg)),
      [`console.${name}i`]: (msg: number, ...p: Array<bigint | undefined>) => host.log(level, interpolate(str(msg), p)),
      [`console.${name}f`]: (msg: number, ...p: Array<number | undefined>) => host.log(level, interpolate(str(msg), p)),
    });
    return {
      memory: this.memory,
      abort: (msg: number, file: number, line: number, column: number) => {
        this.aborted = true;
        host.log('ABORT', `Abort at ${str(file)} ${line}:${column} => ${str(msg)}`);
      },
      trace: (msg: number) => host.log('TRACE', str(msg)),
      clearFramebuffer: (color: number) => {
        fb32().fill((color | 0xff000000) >>> 0);
      },
      ...logFns('LOG', 'log'),
      ...logFns('WARN', 'warn'),
      ...logFns('ERROR', 'error'),
      'audio.playSfx': (id: number, volume: number) => host.audio({ type: 'sfx', id: str(id), volume }),
      'audio.playMusic': (id: number, volume: number) => host.audio({ type: 'music', id: str(id), volume }),
      'audio.stopMusic': () => host.audio({ type: 'stopMusic' }),
    };
  }
}

/** A cartridge's metadata; throws when it has none (built before layout v1). */
export function cartridgeMeta(bytes: Uint8Array): CartridgeMeta {
  const meta = readMeta(bytes);
  if (!meta) throw new Error('Cartridge has no tinyforge.meta section: rebuild it with this version of TinyForge');
  return meta;
}
