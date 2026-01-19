// TinyForge Memory Map
// Shared memory layout constants between host and SDK

/** Display width in pixels */
export const WIDTH = 320;

/** Display height in pixels */
export const HEIGHT = 240;

/** Framebuffer start address */
export const FB_START = 0x000000;

/** Framebuffer size in bytes (320 * 240 * 4 = 307200) */
export const FB_SIZE = WIDTH * HEIGHT * 4; // 0x04B000

// === Input Memory Map ===

// Keyboard state is stored at INPUT_ADDR with the following layout:
//   +0: u8  buttons    - Current button state (bitmask)
//   +1: u8  prevButtons - Previous button state (for edge detection)
// Access via buttonDown(), buttonPressed() in input.ts

/** Keyboard input base address */
export const INPUT_ADDR = FB_START + FB_SIZE; // 0x04B000;

/** Keyboard current button state address */
export const INPUT_BUTTONS_ADDR = INPUT_ADDR + 0;

/** Keyboard previous button state address */
export const INPUT_BUTTONS_PREV_ADDR = INPUT_ADDR + 1;

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

// === Sprite Memory Map ===

// Sprite data is stored after input memory.
// Sprite ID lookup table is stored before metadata for string->id mapping.
// Layout for each sprite entry (8 bytes of metadata per sprite):
//   Sprite N metadata at: SPRITE_METADATA + (N * 8)
//     +0: u16 width       - Sprite width in pixels
//     +2: u16 height      - Sprite height in pixels
//     +4: u32 dataOffset  - Offset to pixel data (relative to SPRITE_DATA)
//
// Pixel data starts at SPRITE_DATA and contains RGBA values (4 bytes per pixel)
// All sprite pixel data is stored sequentially after metadata table
//
// Maximum: 256 sprites (IDs 0-255), metadata table = 2048 bytes
// Sprite data region: ~128 KB available for pixel data

/** Maximum sprite ID length (characters) */
export const SPRITE_ID_MAX_CHARS = 16;

/** Sprite ID lookup entry size (UTF-16, 2 bytes each) */
export const SPRITE_ID_ENTRY_SIZE = SPRITE_ID_MAX_CHARS * 2;

/** Sprite ID lookup table size (256 entries) */
export const SPRITE_ID_TABLE_SIZE = 256 * SPRITE_ID_ENTRY_SIZE;

/** Sprite ID lookup table start address */
export const SPRITE_ID_LOOKUP_ADDR = MOUSE_ADDR + 8; // 0x04B010

/** Sprite metadata start address (after lookup table) */
export const SPRITE_METADATA_ADDR = SPRITE_ID_LOOKUP_ADDR + SPRITE_ID_TABLE_SIZE;

/** Sprite metadata entry size (8 bytes) */
export const SPRITE_METADATA_SIZE = 8;

/** Sprite pixel data start address */
export const SPRITE_DATA_ADDR = SPRITE_METADATA_ADDR + 256 * SPRITE_METADATA_SIZE;

/** Maximum sprite data size (~128 KB) */
export const SPRITE_DATA_SIZE = 0x20000;

// === SDK Reserved Memory ===

/** SDK RNG seed address (i32) */
export const SDK_RNG_SEED_ADDR = SPRITE_DATA_ADDR + SPRITE_DATA_SIZE;

/** SDK RNG seed size in bytes */
export const SDK_RNG_SEED_SIZE = 4;

// Available RAM starts after SDK reserved data

/** Game RAM start address */
export const RAM_START = SDK_RNG_SEED_ADDR + SDK_RNG_SEED_SIZE;

/** Game RAM size in bytes (256 KB) */
export const RAM_SIZE = 0x80000 - RAM_START;
