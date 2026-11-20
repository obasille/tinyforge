// Turns keyboard and pointer events into the InputState the game reads.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tinyforge/engine/memory-map';
import { Button, type InputState, NO_INPUT } from '@tinyforge/runtime';

/** Same keys as the classic host. */
export const DEFAULT_KEYS: Readonly<Record<string, number>> = {
  ArrowUp: Button.up,
  ArrowDown: Button.down,
  ArrowLeft: Button.left,
  ArrowRight: Button.right,
  KeyZ: Button.a,
  KeyX: Button.b,
  Enter: Button.start,
  Space: Button.start,
};

/** Map a DOM mouse button (0 left, 1 middle, 2 right) to the SDK's bit. */
export function mouseBit(button: number): number {
  if (button === 0) return 1 << 0;
  if (button === 2) return 1 << 1;
  if (button === 1) return 1 << 2;
  return 0;
}

/**
 * Convert a client position to game pixels, for a canvas whose content is
 * drawn letterboxed (object-fit: contain) inside `rect`. Returns -1, -1
 * outside the picture.
 */
export function toGamePixel(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const aspect = SCREEN_WIDTH / SCREEN_HEIGHT;
  let w = rect.width;
  let h = rect.height;
  if (w / h > aspect) w = h * aspect;
  else h = w / aspect;
  const ox = rect.left + (rect.width - w) / 2;
  const oy = rect.top + (rect.height - h) / 2;
  const x = Math.floor(((clientX - ox) * SCREEN_WIDTH) / w);
  const y = Math.floor(((clientY - oy) * SCREEN_HEIGHT) / h);
  if (x < 0 || y < 0 || x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT) return { x: -1, y: -1 };
  return { x, y };
}

/** Accumulates input and reports each change. */
export class InputTracker {
  private state: InputState = { ...NO_INPUT };

  constructor(
    private readonly onChange: (state: InputState) => void,
    private readonly keys: Readonly<Record<string, number>> = DEFAULT_KEYS,
  ) {}

  get current(): InputState {
    return this.state;
  }

  /** Returns true when the key is a game key (the caller may preventDefault). */
  key(code: string, down: boolean): boolean {
    const bit = this.keys[code];
    if (bit === undefined) return false;
    this.update({ buttons: down ? this.state.buttons | bit : this.state.buttons & ~bit });
    return true;
  }

  pointer(x: number, y: number): void {
    this.update({ mouseX: x, mouseY: y });
  }

  mouseButton(button: number, down: boolean): void {
    const bit = mouseBit(button);
    if (!bit) return;
    this.update({ mouseButtons: down ? this.state.mouseButtons | bit : this.state.mouseButtons & ~bit });
  }

  /** Release everything (focus lost). */
  clear(): void {
    this.update({ buttons: 0, mouseButtons: 0, mouseX: -1, mouseY: -1 });
  }

  private update(patch: Partial<InputState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.buttons === this.state.buttons &&
      next.mouseX === this.state.mouseX &&
      next.mouseY === this.state.mouseY &&
      next.mouseButtons === this.state.mouseButtons
    ) {
      return;
    }
    this.state = next;
    this.onChange(next);
  }
}
