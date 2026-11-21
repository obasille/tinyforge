// TinyForge Memory Map, layout version 1
// Shared memory layout constants between host and SDK.
//
// From low to high addresses:
//   0x000000  framebuffer (320 × 240 RGBA)
//   0x04B000  system block: input, mouse, sprite-table pointer, RNG seed,
//             then spare room up to 0x50000 for later additions
//   0x050000  game RAM (RAM_START), RAM_SIZE bytes as the game declares
//   RAM_START + RAM_SIZE
//             AssemblyScript static data (the compiler's memoryBase)
//   end of the module's declared memory
//             sprite table and pixels, written by the host at load time
//
// Each cartridge records the layout version it was built for in its
// tinyforge.meta section. Hosts keep a table of addresses per version
// (packages/runtime/src/layout.ts) and read addresses from it, so a later
// version can move things without breaking cartridges built for this one.

/** Memory layout version these constants describe. */
export const LAYOUT_VERSION = 1;

/** Display width in pixels */
export const SCREEN_WIDTH = 320;

/** Display height in pixels */
export const SCREEN_HEIGHT = 240;

/** Framebuffer start address */
export const FB_START = 0x000000;

/** Framebuffer size in bytes (320 * 240 * 4 = 307200) */
export const FB_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT * 4; // 0x04B000

// === Input Memory Map ===

// Keyboard state is stored at INPUT_ADDR with the following layout:
//   +0: u16 buttons     - Current button state (bitmask, little-endian)
//   +2: u16 prevButtons - Previous button state (for edge detection)
// Bits: 0-3 D-pad (up, down, left, right), 4 A, 5 B, 6 START, 7 X, 8 Y,
// 9 LT (left trigger), 10 RT (right trigger).
// A/B/X/Y form a diamond on W/A/S/D and double as a second D-pad (player 2).
// LT is Left Ctrl (player 2's fire key), RT is Right Ctrl (player 1's).
// Access via buttonDown(), buttonPressed() in input.ts

/** Keyboard input base address */
export const INPUT_ADDR = FB_START + FB_SIZE; // 0x04B000;

/** Keyboard current button state address */
export const INPUT_BUTTONS_ADDR = INPUT_ADDR + 0;

/** Keyboard previous button state address */
export const INPUT_BUTTONS_PREV_ADDR = INPUT_ADDR + 2;

// Mouse state is stored at MOUSE_ADDR with the following layout:
//   +0: i16 x          - Mouse X coordinate (0-319, or -1 if outside canvas)
//   +2: i16 y          - Mouse Y coordinate (0-239, or -1 if outside canvas)
//   +4: u8  buttons    - Current button state (bit 0=left, 1=right, 2=middle)
//   +5: u8  prevButtons - Previous button state (for edge detection)
// Access via mouseX(), mouseY(), mouseDown(), mousePressed() in input.ts

/** Mouse state base address */
export const MOUSE_ADDR = INPUT_ADDR + 8; // 0x04B008

/** Mouse X coordinate address */
export const MOUSE_X_ADDR = MOUSE_ADDR + 0;

/** Mouse Y coordinate address */
export const MOUSE_Y_ADDR = MOUSE_ADDR + 2;

/** Mouse current button state address */
export const MOUSE_BUTTONS_ADDR = MOUSE_ADDR + 4;

/** Mouse previous button state address */
export const MOUSE_BUTTONS_PREV_ADDR = MOUSE_ADDR + 5;

// === System block (input above, then these) ===

/**
 * Address of the sprite table (u32), written by the host. The table sits past
 * the cartridge's static data, so its address depends on the game.
 */
export const SPRITE_TABLE_PTR_ADDR = MOUSE_ADDR + 8; // 0x04B010

/** SDK RNG seed address (i32) */
export const SDK_RNG_SEED_ADDR = SPRITE_TABLE_PTR_ADDR + 4; // 0x04B014

/** SDK RNG seed size in bytes */
export const SDK_RNG_SEED_SIZE = 4;

/** Start of the system block (input, mouse, pointers, SDK data, spare room). */
export const SYSTEM_START = INPUT_ADDR;

/** End of the system block; the room up to here is kept for later versions. */
export const SYSTEM_END = 0x050000;

// === Game RAM ===

/** Game RAM start address */
export const RAM_START = SYSTEM_END;

/**
 * RAM size used when a game does not declare `const RAM_SIZE: i32 = ...;` in
 * its main.ts (72 KB). Static data starts right after the game's RAM.
 */
export const DEFAULT_RAM_SIZE = 0x12000;

// === Sprite table ===

// Layout, at the address in SPRITE_TABLE_PTR_ADDR:
//   header (SPRITE_TABLE_HEADER_SIZE bytes):
//     +0 u16 count, +2 u16 reserved, +4 u32 lookup offset,
//     +8 u32 info offset, +12 u32 pixel data offset (offsets from the table)
//   sprite ID lookup table (count entries, UTF-16, zero padded)
//   sprite info table (count entries)
//   sprite pixel data (RGBA, 4 bytes per pixel)
// The host sizes it to the sprites the game uses; there is no fixed cap.

/** Maximum sprite ID length (characters) */
export const SPRITE_ID_MAX_CHARS = 16;

/** Sprite table header size (bytes) */
export const SPRITE_TABLE_HEADER_SIZE = 16;

/** Sprite ID lookup entry size (UTF-16, 2 bytes each) */
export const SPRITE_ID_ENTRY_SIZE = SPRITE_ID_MAX_CHARS * 2;

/** Sprite info entry size (16 bytes) */
export const SPRITE_INFO_ENTRY_SIZE = 16;
