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
 * Check if a button was just pressed this frame (rising edge)
 * @param pad Gamepad identifier (0-3)
 * @param button Button bit flag to check
 * @returns true if the button was pressed this frame
 */
@external("env", "gamepad.pressed")
export declare function gamepadPressed(pad: Gamepad, button: Button): bool;
