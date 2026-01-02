// Fantasy Console SDK - Input System
// Keyboard and mouse input via memory-mapped I/O
//
// Input State Memory Layout:
//   0x0AB000: Keyboard input (2 bytes)
//     +0: u8  buttons     - Current button state (bitmask)
//     +1: u8  prevButtons - Previous button state (for edge detection)
//
//   0x0AB010: Mouse input (6 bytes)
//     +0: i16 x          - Mouse X (0-319, or -1 if outside)
//     +2: i16 y          - Mouse Y (0-239, or -1 if outside)
//     +4: u8  buttons    - Current button state (bit 0=left, 1=right, 2=middle)
//     +5: u8  prevButtons - Previous button state (for edge detection)
//
// Usage:
//   - Use buttonDown() / mouseDown() for continuous actions (held buttons)
//   - Use buttonPressed() / mousePressed() for one-time actions (button just pressed)

import { INPUT_BUTTONS, INPUT_BUTTONS_PREV, MOUSE_X_ADDR, MOUSE_Y_ADDR, MOUSE_BUTTONS_ADDR, MOUSE_BUTTONS_PREV_ADDR } from './memory';

/** Button bit flags for keyboard input */
export enum Button {
  UP    = 1 << 0,
  DOWN  = 1 << 1,
  LEFT  = 1 << 2,
  RIGHT = 1 << 3,
  A     = 1 << 4,  // Mapped to Z key
  B     = 1 << 5,  // Mapped to X key
  START = 1 << 6   // Mapped to Enter key
}

/** Gamepad identifiers */
export enum Gamepad {
  ONE = 0,
  TWO = 1,
  THREE = 2,
  FOUR = 3
}

/**
 * Mouse button bit flags
 * 
 * Mouse buttons are tracked as a bitmask where each bit represents a button state.
 * Use with mouseDown() and mousePressed() functions.
 * 
 * @example
 * ```typescript
 * if (mousePressed(MouseButton.LEFT)) {
 *   // Handle left click
 * }
 * ```
 */
export enum MouseButton {
  LEFT   = 1 << 0,  // Bit 0: Left mouse button
  RIGHT  = 1 << 1,  // Bit 1: Right mouse button
  MIDDLE = 1 << 2   // Bit 2: Middle mouse button (wheel click)
}

/**
 * Check if a button is currently held down
 * @param button Button bit flag to check
 * @returns true if the button is currently pressed
 * @example
 * ```typescript
 * if (buttonDown(Button.A)) {
 *   // A button is being held
 * }
 * ```
 */
export function buttonDown(button: Button): bool {
  return (load<u8>(INPUT_BUTTONS) & button) != 0;
}

/**
 * Check if a button was just pressed this frame (rising edge)
 * @param button Button bit flag to check
 * @returns true if the button was pressed this frame
 * @example
 * ```typescript
 * if (buttonPressed(Button.START)) {
 *   // Start button was just pressed
 * }
 * ```
 */
export function buttonPressed(button: Button): bool {
  const current = load<u8>(INPUT_BUTTONS);
  const prev = load<u8>(INPUT_BUTTONS_PREV);
  return (current & button) != 0 && (prev & button) == 0;
}

/**
 * Check if a button was just pressed this frame (rising edge) - deprecated
 * @deprecated Use buttonPressed() instead
 * @param pad Gamepad identifier (0-3)
 * @param button Button bit flag to check
 * @returns true if the button was pressed this frame
 */
@external("env", "gamepad.pressed")
export declare function gamepadPressed(pad: Gamepad, button: Button): bool;

/**
 * Get mouse X position (screen coordinates)
 * @returns Mouse X coordinate (0-319), or -1 if outside canvas
 * @example
 * ```typescript
 * const x = mouseX();
 * if (x >= 0) {
 *   // Mouse is over canvas
 * }
 * ```
 */
export function mouseX(): i16 {
  return load<i16>(MOUSE_X_ADDR);
}

/**
 * Get mouse Y position (screen coordinates)
 * @returns Mouse Y coordinate (0-239), or -1 if outside canvas
 * @example
 * ```typescript
 * const y = mouseY();
 * if (y >= 0) {
 *   // Mouse is over canvas
 * }
 * ```
 */
export function mouseY(): i16 {
  return load<i16>(MOUSE_Y_ADDR);
}

/**
 * Check if a mouse button is currently held down
 * @param button Mouse button bit flag to check
 * @returns true if the button is currently pressed
 * @example
 * ```typescript
 * if (mouseDown(MouseButton.LEFT)) {
 *   // Left button is being held
 * }
 * ```
 */
export function mouseDown(button: MouseButton): bool {
  return (load<u8>(MOUSE_BUTTONS_ADDR) & button) != 0;
}

/**
 * Check if a mouse button was just pressed this frame (rising edge)
 * @param button Mouse button bit flag to check
 * @returns true if the button was pressed this frame
 * @example
 * ```typescript
 * if (mousePressed(MouseButton.LEFT)) {
 *   const x = mouseX();
 *   const y = mouseY();
 *   // Handle click at (x, y)
 * }
 * ```
 */
export function mousePressed(button: MouseButton): bool {
  const current = load<u8>(MOUSE_BUTTONS_ADDR);
  const prev = load<u8>(MOUSE_BUTTONS_PREV_ADDR);
  return (current & button) != 0 && (prev & button) == 0;
}
