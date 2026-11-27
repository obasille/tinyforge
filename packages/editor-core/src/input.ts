// Turns keyboard and pointer events into the InputState the game reads.

import { SCREEN_HEIGHT, SCREEN_WIDTH } from '@tinyforge/engine/memory-map';
import { Button, type InputState, NO_INPUT } from '@tinyforge/runtime';

/**
 * Same keys as the classic host. The action buttons form a diamond on WASD
 * (Y top, X left, A bottom, B right) so games can use them as player 2's
 * D-pad. Z and X stay as aliases for A and B. Left and Right Ctrl are the
 * LT and RT triggers (player 2's and player 1's fire keys).
 */
export const DEFAULT_KEYS: Readonly<Record<string, number>> = {
  ArrowUp: Button.up,
  ArrowDown: Button.down,
  ArrowLeft: Button.left,
  ArrowRight: Button.right,
  KeyW: Button.y,
  KeyA: Button.x,
  KeyS: Button.a,
  KeyD: Button.b,
  KeyZ: Button.a,
  KeyX: Button.b,
  Enter: Button.start,
  Space: Button.start,
  ControlLeft: Button.lt,
  ControlRight: Button.rt,
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

/**
 * Accumulates input and reports each change. Keyboard keys and on-screen
 * (touch) controls are tracked apart and combined into one button mask, so
 * releasing one never releases a button the other still holds, and each can
 * be cleared on its own (keyboard on blur, touch on a cancelled pointer).
 */
export class InputTracker {
  private state: InputState = { ...NO_INPUT };
  private readonly held = new Set<string>();
  /** Buttons held by each on-screen control, by a caller-chosen id (one per pointer). */
  private readonly touches = new Map<string, number>();

  constructor(
    private readonly onChange: (state: InputState) => void,
    private readonly keys: Readonly<Record<string, number>> = DEFAULT_KEYS,
  ) {}

  get current(): InputState {
    return this.state;
  }

  /** Returns true when the key is a game key (the caller may preventDefault). */
  key(code: string, down: boolean): boolean {
    if (this.keys[code] === undefined) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    this.updateButtons();
    return true;
  }

  /** The buttons an on-screen control holds for `id` (0 releases them). */
  touch(id: string, buttons: number): void {
    if (buttons) this.touches.set(id, buttons);
    else this.touches.delete(id);
    this.updateButtons();
  }

  /** Release the keyboard keys only (the game view lost focus). */
  clearKeys(): void {
    this.held.clear();
    this.updateButtons();
  }

  /** Release every on-screen control. */
  clearTouch(): void {
    this.touches.clear();
    this.updateButtons();
  }

  pointer(x: number, y: number): void {
    this.update({ mouseX: x, mouseY: y });
  }

  mouseButton(button: number, down: boolean): void {
    const bit = mouseBit(button);
    if (!bit) return;
    this.update({ mouseButtons: down ? this.state.mouseButtons | bit : this.state.mouseButtons & ~bit });
  }

  /** Release everything (page hidden, game restarted). */
  clear(): void {
    this.held.clear();
    this.touches.clear();
    this.update({ buttons: 0, mouseButtons: 0, mouseX: -1, mouseY: -1 });
  }

  private updateButtons(): void {
    // Several keys can share a button (S and Z are both A), so rebuild the
    // mask from everything held instead of clearing the bit on release.
    let buttons = 0;
    for (const held of this.held) buttons |= this.keys[held] ?? 0;
    for (const bits of this.touches.values()) buttons |= bits;
    this.update({ buttons });
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
