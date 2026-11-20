// Color of the game pixel under the mouse. It watches the 4 framebuffer bytes
// of that one pixel, so the value follows the game every frame and also
// updates when paused and single-stepping.

import { FB_START, SCREEN_HEIGHT, SCREEN_WIDTH } from '@tinyforge/engine/memory-map';
import type { WatchFn } from './memory-view.ts';

export interface PixelInfo {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 0xAABBGGRR, the u32 value games write (same format as the classic host). */
export function pixelAbgr(p: PixelInfo): string {
  const value = ((p.a << 24) | (p.b << 16) | (p.g << 8) | p.r) >>> 0;
  return `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
}

/** #RRGGBB, for CSS and copying. */
export function pixelHex(p: PixelInfo): string {
  return `#${[p.r, p.g, p.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export class PixelProbe {
  private x = -1;
  private y = -1;
  private unwatch: (() => void) | null = null;
  private last: PixelInfo | null = null;

  constructor(
    private readonly watch: WatchFn,
    private readonly onChange: (pixel: PixelInfo | null) => void,
  ) {}

  get current(): PixelInfo | null {
    return this.last;
  }

  /** Follow the pixel at game coordinates (x, y); -1 means off the screen. */
  setPosition(x: number, y: number): void {
    if (x === this.x && y === this.y) return;
    this.x = x;
    this.y = y;
    this.unwatch?.();
    this.unwatch = null;
    if (x < 0 || y < 0 || x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT) {
      this.emit(null);
      return;
    }
    const offset = FB_START + (y * SCREEN_WIDTH + x) * 4;
    this.unwatch = this.watch(offset, 4, (bytes, at) => {
      if (at !== offset || bytes.length < 4) return;
      this.emit({ x, y, r: bytes[0], g: bytes[1], b: bytes[2], a: bytes[3] });
    });
  }

  dispose(): void {
    this.unwatch?.();
    this.unwatch = null;
  }

  private emit(pixel: PixelInfo | null): void {
    const prev = this.last;
    if (
      prev === pixel ||
      (prev &&
        pixel &&
        prev.x === pixel.x &&
        prev.y === pixel.y &&
        prev.r === pixel.r &&
        prev.g === pixel.g &&
        prev.b === pixel.b &&
        prev.a === pixel.a)
    ) {
      return;
    }
    this.last = pixel;
    this.onChange(pixel);
  }
}
