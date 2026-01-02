// TinyForge SDK - Memory Management
// Defines memory layout, external memory interface, and RAM accessors

/** External WebAssembly memory shared between host and cartridge */
@external("env", "memory")
export declare const memory: WebAssembly.Memory;

/** Display width in pixels */
export const WIDTH: i32 = 320;

/** Display height in pixels */
export const HEIGHT: i32 = 240;

/** Framebuffer start address (0x000000) */
export const FB_START: usize = 0x000000;

/** Framebuffer size in bytes (320×240×4) */
export const FB_SIZE: usize = 307200;

/** Game RAM start address (0x04B000) */
export const RAM_START: usize = 0x04B000;

/** Game RAM size in bytes (256 KB) */
export const RAM_SIZE: usize = 262144;

/** Save data start address (0x08B000) */
export const SAVE_START: usize = 0x08B000;

/** Save data size in bytes (64 KB) */
export const SAVE_SIZE: usize = 65536;

/** Debug/tooling start address (0x09B000) */
export const DEBUG_START: usize = 0x09B000;

/** Debug/tooling size in bytes (64 KB) */
export const DEBUG_SIZE: usize = 65536;

// === Input Memory Map ===

// Keyboard state is stored at 0x0AB000 with the following layout:
//   +0: u8  buttons    - Current button state (bitmask)
//   +1: u8  prevButtons - Previous button state (for edge detection)
// Access via buttonDown(), buttonPressed() in input.ts

/** Keyboard input base address (0x0AB000) */
export const INPUT_ADDR: usize = 0x0AB000;

/** Keyboard current button state address (0x0AB000) */
export const INPUT_BUTTONS: usize = INPUT_ADDR + 0;

/** Keyboard previous button state address (0x0AB001) */
export const INPUT_BUTTONS_PREV: usize = INPUT_ADDR + 1;

// Mouse state is stored at 0x0AB010 with the following layout:
//   +0: i16 x          - Mouse X coordinate (0-319, or -1 if outside canvas)
//   +2: i16 y          - Mouse Y coordinate (0-239, or -1 if outside canvas)
//   +4: u8  buttons    - Current button state (bit 0=left, 1=right, 2=middle)
//   +5: u8  prevButtons - Previous button state (for edge detection)
// Access via mouseX(), mouseY(), mouseDown(), mousePressed() in input.ts

/** Mouse state base address (0x0AB010) */
export const MOUSE_ADDR: usize = 0x0AB010;

/** Mouse X coordinate address (0x0AB010) */
export const MOUSE_X_ADDR: usize = MOUSE_ADDR + 0;

/** Mouse Y coordinate address (0x0AB012) */
export const MOUSE_Y_ADDR: usize = MOUSE_ADDR + 2;

/** Mouse current button state address (0x0AB014) */
export const MOUSE_BUTTONS_ADDR: usize = MOUSE_ADDR + 4;

/** Mouse previous button state address (0x0AB015) */
export const MOUSE_BUTTONS_PREV_ADDR: usize = MOUSE_ADDR + 5;

// === Sprite Memory Map ===

// Sprite data is stored starting at 0x0AB100 (after input memory)
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

/** Sprite metadata table base address (0x0AB100) */
export const SPRITE_METADATA: usize = 0x0AB100;

/** Sprite metadata entry size (8 bytes) */
export const SPRITE_METADATA_SIZE: u32 = 8;

/** Sprite pixel data base address (0x0AB900 - after 256 sprite metadata entries) */
export const SPRITE_DATA: usize = SPRITE_METADATA + (256 * SPRITE_METADATA_SIZE);

/** Maximum sprite data size (~128 KB) */
export const SPRITE_DATA_SIZE: usize = 131072;

/**
 * Read a 32-bit signed integer from game RAM
 * @param offset Byte offset from RAM_START
 * @returns The i32 value at the specified offset
 */
@inline
export function getI32(offset: u32): i32 {
  return load<i32>(RAM_START + offset);
}

/**
 * Write a 32-bit signed integer to game RAM
 * @param offset Byte offset from RAM_START
 * @param value The i32 value to store
 */
@inline
export function setI32(offset: u32, value: i32): void {
  store<i32>(RAM_START + offset, value);
}

/**
 * Read a 32-bit floating point number from game RAM
 * @param offset Byte offset from RAM_START
 * @returns The f32 value at the specified offset
 */
@inline
export function getF32(offset: u32): f32 {
  return load<f32>(RAM_START + offset);
}

/**
 * Write a 32-bit floating point number to game RAM
 * @param offset Byte offset from RAM_START
 * @param value The f32 value to store
 */
@inline
export function setF32(offset: u32, value: f32): void {
  store<f32>(RAM_START + offset, value);
}

/**
 * Read an 8-bit unsigned integer from game RAM
 * @param offset Byte offset from RAM_START
 * @returns The u8 value at the specified offset
 */
@inline
export function getU8(offset: u32): u8 {
  return load<u8>(RAM_START + offset);
}

/**
 * Write an 8-bit unsigned integer to game RAM
 * @param offset Byte offset from RAM_START
 * @param value The u8 value to store
 */
@inline
export function setU8(offset: u32, value: u8): void {
  store<u8>(RAM_START + offset, value);
}
