import {
  INPUT_BUTTONS_ADDR,
  INPUT_BUTTONS_PREV_ADDR,
  MOUSE_BUTTONS_ADDR,
  MOUSE_BUTTONS_PREV_ADDR,
  MOUSE_X_ADDR,
  MOUSE_Y_ADDR,
} from '@tinyforge/engine/memory-map';

/** Button bits, matching the SDK's `Button` enum. */
export const Button = {
  up: 1 << 0,
  down: 1 << 1,
  left: 1 << 2,
  right: 1 << 3,
  a: 1 << 4,
  b: 1 << 5,
  start: 1 << 6,
} as const;

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
export function writeInput(buffer: ArrayBuffer, current: InputState, previous: InputState): void {
  const view = new DataView(buffer);
  view.setUint8(INPUT_BUTTONS_ADDR, current.buttons & 0xff);
  view.setUint8(INPUT_BUTTONS_PREV_ADDR, previous.buttons & 0xff);
  view.setInt16(MOUSE_X_ADDR, current.mouseX, true);
  view.setInt16(MOUSE_Y_ADDR, current.mouseY, true);
  view.setUint8(MOUSE_BUTTONS_ADDR, current.mouseButtons & 0xff);
  view.setUint8(MOUSE_BUTTONS_PREV_ADDR, previous.mouseButtons & 0xff);
}
