import type { MemoryLayout } from './layout.ts';

/** Button bits, matching the SDK's `Button` enum. */
export const Button = {
  up: 1 << 0,
  down: 1 << 1,
  left: 1 << 2,
  right: 1 << 3,
  a: 1 << 4,
  b: 1 << 5,
  start: 1 << 6,
  x: 1 << 7,
  y: 1 << 8,
  lt: 1 << 9,
  rt: 1 << 10,
} as const;

/** The trigger bits (Left / Right Ctrl). */
export const TRIGGERS = Button.lt | Button.rt;

/** Mouse button bits: 0 = left, 1 = right, 2 = middle. */
export const MouseButton = {
  left: 1 << 0,
  right: 1 << 1,
  middle: 1 << 2,
} as const;

/** What the host knows about input at one moment. */
export interface InputState {
  buttons: number;
  /** Game pixel coordinates, or -1 when the pointer is outside the screen. */
  mouseX: number;
  mouseY: number;
  mouseButtons: number;
}

export const NO_INPUT: Readonly<InputState> = {
  buttons: 0,
  mouseX: -1,
  mouseY: -1,
  mouseButtons: 0,
};

/** Write the current and previous input state where the SDK reads it. */
export function writeInput(buffer: ArrayBuffer, layout: MemoryLayout, current: InputState, previous: InputState): void {
  const view = new DataView(buffer);
  view.setUint16(layout.inputButtonsAddr, current.buttons & 0xffff, true);
  view.setUint16(layout.inputButtonsPrevAddr, previous.buttons & 0xffff, true);
  view.setInt16(layout.mouseXAddr, current.mouseX, true);
  view.setInt16(layout.mouseYAddr, current.mouseY, true);
  view.setUint8(layout.mouseButtonsAddr, current.mouseButtons & 0xff);
  view.setUint8(layout.mouseButtonsPrevAddr, previous.mouseButtons & 0xff);
}
