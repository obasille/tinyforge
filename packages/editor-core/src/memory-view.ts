// Hex view of a window of game memory. It subscribes to exactly the visible
// rows, so the Worker pushes a few KB per frame and the view updates every
// frame without copying the whole memory.

import { DEFAULT_RAM_SIZE, RAM_START } from '@tinyforge/engine/memory-map';

export const BYTES_PER_ROW = 16;

export type WatchFn = (
  offset: number,
  length: number,
  listener: (bytes: Uint8Array, offset: number) => void,
) => () => void;

export function formatRows(bytes: Uint8Array, offset: number, previous?: Uint8Array): string {
  const lines: string[] = [];
  for (let row = 0; row < bytes.length; row += BYTES_PER_ROW) {
    const addr = (offset + row).toString(16).toUpperCase().padStart(6, '0');
    let hex = '';
    let ascii = '';
    for (let i = 0; i < BYTES_PER_ROW; i++) {
      const at = row + i;
      if (at >= bytes.length) {
        hex += '   ';
        continue;
      }
      const b = bytes[at];
      const changed = previous !== undefined && previous[at] !== b;
      const text = b.toString(16).toUpperCase().padStart(2, '0');
      hex += changed ? `<b>${text}</b> ` : `${text} `;
      ascii += b >= 0x20 && b < 0x7f ? escapeHtml(String.fromCharCode(b)) : '.';
    }
    lines.push(`<span class="addr">${addr}</span>  ${hex} ${ascii}`);
  }
  return lines.join('\n');
}

function escapeHtml(c: string): string {
  return c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c;
}

export class MemoryView {
  private address = 0;
  private rows = 16;
  /** Size of the game's memory; the view stays inside it. */
  private size = RAM_START + DEFAULT_RAM_SIZE;
  private unwatch: (() => void) | null = null;
  private previous: Uint8Array | undefined;
  private resizeObserver: ResizeObserver | null = null;
  /** Ticks per second the view actually received, for the status line. */
  updates = 0;

  constructor(
    private readonly output: HTMLElement,
    private readonly watch: WatchFn,
    private readonly rowHeightPx = 16,
  ) {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(output);
    this.resize();
  }

  get start(): number {
    return this.address;
  }

  /** The game's memory size changed (another game, or more sprites). */
  setSize(size: number): void {
    if (size === this.size) return;
    this.size = size;
    this.setAddress(this.address);
  }

  setAddress(address: number): void {
    const max = this.size - BYTES_PER_ROW;
    this.address = Math.max(0, Math.min(max, Math.floor(address / BYTES_PER_ROW) * BYTES_PER_ROW));
    this.previous = undefined;
    this.subscribe();
  }

  /** Scroll by whole rows. */
  scrollRows(delta: number): void {
    this.setAddress(this.address + delta * BYTES_PER_ROW);
  }

  dispose(): void {
    this.unwatch?.();
    this.unwatch = null;
    this.resizeObserver?.disconnect();
  }

  private resize(): void {
    const rows = Math.max(1, Math.floor(this.output.clientHeight / this.rowHeightPx));
    if (rows === this.rows && this.unwatch) return;
    this.rows = rows;
    this.subscribe();
  }

  private subscribe(): void {
    this.unwatch?.();
    const length = Math.min(this.rows * BYTES_PER_ROW, this.size - this.address);
    this.unwatch = this.watch(this.address, length, (bytes, offset) => {
      if (offset !== this.address) return; // a stale push from before a scroll
      this.output.innerHTML = formatRows(bytes, offset, this.previous);
      this.previous = bytes;
      this.updates++;
    });
  }
}
