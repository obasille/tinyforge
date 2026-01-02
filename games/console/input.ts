// Fantasy Console SDK - Input System
// Button constants and gamepad state checking

/** Button bit flags for gamepad input */
export enum Button {
  UP    = 1 << 0,
  DOWN  = 1 << 1,
  LEFT  = 1 << 2,
  RIGHT = 1 << 3,
  A     = 1 << 4,
  B     = 1 << 5,
  START = 1 << 6
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
 * Check if a button was just pressed this frame (rising edge)
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
  return load<i16>(0x0AB000);
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
  return load<i16>(0x0AB002);
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
  return (load<u8>(0x0AB004) & button) != 0;
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
  const current = load<u8>(0x0AB004);
  const prev = load<u8>(0x0AB005);
  return (current & button) != 0 && (prev & button) == 0;
}
