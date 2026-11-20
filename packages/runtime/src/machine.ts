// One running cartridge: its memory, imports and lifecycle calls.
//
// The cartridge ABI is unchanged from the classic host: the module imports
// env.memory (1 MB, fixed) plus the env functions below, and exports init,
// update and draw. All game state lives in linear memory, so keeping the
// Memory object across a re-instantiation is what makes hot reload keep state.

import { FB_SIZE, FB_START, SCREEN_HEIGHT, SCREEN_WIDTH, SDK_RNG_SEED_ADDR } from '@tinyforge/engine/memory-map';
import { type InputState, NO_INPUT, writeInput } from './input.ts';
import { interpolate, readString } from './strings.ts';

export const MEMORY_PAGES = 16; // 16 × 64 KB = 1 MB, the size games are built for
export const MEMORY_BYTES = MEMORY_PAGES * 65536;

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
  readonly memory: WebAssembly.Memory;
  private exports: CartridgeExports | null = null;
  private previous: InputState = { ...NO_INPUT };
  /** Set when the game aborted or threw; it stays stopped until restart. */
  aborted = false;
  /** Number of update() calls since the last init(). */
  ticks = 0;

  constructor(private readonly host: MachineHost) {
    this.memory = new WebAssembly.Memory({ initial: MEMORY_PAGES, maximum: MEMORY_PAGES });
  }

  get loaded(): boolean {
    return this.exports !== null;
  }

  /**
   * Instantiate a cartridge into this machine's memory. With `keepState`,
   * init() is skipped so the game resumes from what memory holds (hot reload).
   */
  async load(bytes: BufferSource, { keepState = false } = {}): Promise<void> {
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
    writeInput(this.memory.buffer, input, this.previous);
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
    return new Uint8ClampedArray(this.memory.buffer, FB_START, FB_SIZE);
  }

  get seed(): number {
    return new DataView(this.memory.buffer).getInt32(SDK_RNG_SEED_ADDR, true);
  }

  set seed(value: number) {
    new DataView(this.memory.buffer).setInt32(SDK_RNG_SEED_ADDR, value | 0, true);
  }

  /** Copy of `length` bytes at `offset`, clamped to memory. */
  read(offset: number, length: number): Uint8Array {
    const start = Math.max(0, Math.min(offset, MEMORY_BYTES));
    const end = Math.max(start, Math.min(offset + length, MEMORY_BYTES));
    return new Uint8Array(this.memory.buffer.slice(start, end));
  }

  /** Copy of all of memory: game state, framebuffer, input and sprites. */
  snapshot(): Uint8Array {
    return new Uint8Array(this.memory.buffer.slice(0));
  }

  restore(bytes: Uint8Array): void {
    if (bytes.byteLength !== MEMORY_BYTES) {
      throw new Error(`Snapshot is ${bytes.byteLength} bytes, expected ${MEMORY_BYTES}`);
    }
    new Uint8Array(this.memory.buffer).set(bytes);
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
    const fb32 = () => new Uint32Array(this.memory.buffer, FB_START, SCREEN_WIDTH * SCREEN_HEIGHT);
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
