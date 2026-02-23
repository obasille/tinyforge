// TinyForge SDK - Memory Management
// Defines memory layout, external memory interface, and RAM accessors
// 
// Memory layout constants are synced with ../../memory-map.ts

// Some tooling doesn't include AssemblyScript's WebAssembly types.
// Declare a minimal type so TS tooling is satisfied.
declare namespace WebAssembly {
  class Memory {}
}

/** External WebAssembly memory shared between host and cartridge */
// @ts-expect-error AssemblyScript decorator
@external("env", "memory")
export declare const memory: WebAssembly.Memory;

// Import shared memory constants from memory-map.ts
// These are cast to AssemblyScript types for use in WASM
import * as memoryMap from '../../memory-map';

/** Display width in pixels */
export const SCREEN_WIDTH = memoryMap.SCREEN_WIDTH as i32;

/** Display height in pixels */
export const SCREEN_HEIGHT = memoryMap.SCREEN_HEIGHT as i32;

/** Framebuffer start address (0x000000) */
export const FB_START = memoryMap.FB_START as usize;

/** Framebuffer size in bytes */
export const FB_SIZE = memoryMap.FB_SIZE as usize;

// === Input Memory Map ===

/** Keyboard input base address */
export const INPUT_ADDR = memoryMap.INPUT_ADDR as usize;

/** Keyboard current button state address */
export const INPUT_BUTTONS_ADDR = memoryMap.INPUT_BUTTONS_ADDR as usize;

/** Keyboard previous button state address */
export const INPUT_BUTTONS_PREV_ADDR = memoryMap.INPUT_BUTTONS_PREV_ADDR as usize;

/** Mouse state base address */
export const MOUSE_ADDR = memoryMap.MOUSE_ADDR as usize;

/** Mouse X coordinate address */
export const MOUSE_X_ADDR = memoryMap.MOUSE_X_ADDR as usize;

/** Mouse Y coordinate address */
export const MOUSE_Y_ADDR = memoryMap.MOUSE_Y_ADDR as usize;

/** Mouse current button state address */
export const MOUSE_BUTTONS_ADDR = memoryMap.MOUSE_BUTTONS_ADDR as usize;

/** Mouse previous button state address */
export const MOUSE_BUTTONS_PREV_ADDR = memoryMap.MOUSE_BUTTONS_PREV_ADDR as usize;

// === Sprite Memory Map ===

/** Maximum sprite ID length (characters) */
export const SPRITE_ID_MAX_CHARS = memoryMap.SPRITE_ID_MAX_CHARS as i32;

/** Sprite ID lookup entry size (bytes) */
export const SPRITE_ID_ENTRY_SIZE = memoryMap.SPRITE_ID_ENTRY_SIZE as usize;

/** Sprite table header size (bytes) */
export const SPRITE_TABLE_HEADER_SIZE = memoryMap.SPRITE_TABLE_HEADER_SIZE as usize;

/** Sprite table base address */
export const SPRITE_TABLE_ADDR = memoryMap.SPRITE_TABLE_ADDR as usize;

/** Sprite info entry size (16 bytes) */
export const SPRITE_INFO_ENTRY_SIZE = memoryMap.SPRITE_INFO_ENTRY_SIZE as usize;

/** Sprite pixel data base address (after max tables) */
export const SPRITE_DATA_ADDR = memoryMap.SPRITE_DATA_ADDR as usize;

/** Maximum sprite data size (~128 KB) */
export const SPRITE_DATA_SIZE = memoryMap.SPRITE_DATA_SIZE as usize;

// === SDK Reserved Memory ===

/** SDK RNG seed address (i32) */
export const SDK_RNG_SEED_ADDR = memoryMap.SDK_RNG_SEED_ADDR as usize;

/** SDK RNG seed size in bytes */
export const SDK_RNG_SEED_SIZE = memoryMap.SDK_RNG_SEED_SIZE as usize;

/** SDK RNG seed address (i32) */
export const RNG_SEED = memoryMap.SDK_RNG_SEED_ADDR as usize;

/** Game RAM start address */
export const RAM_START = memoryMap.RAM_START as usize;

/** Game RAM size in bytes (~72 KB) */
export const RAM_SIZE = memoryMap.RAM_SIZE as usize;

/**
 * Read a 32-bit signed integer from game RAM
 * @param offset Byte offset from RAM_START
 * @returns The i32 value at the specified offset
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function getI32(offset: usize): i32 {
  return load<i32>(RAM_START + offset);
}

/**
 * Write a 32-bit signed integer to game RAM
 * @param offset Byte offset from RAM_START
 * @param value The i32 value to store
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function setI32(offset: usize, value: i32): void {
  store<i32>(RAM_START + offset, value);
}

/**
 * Read a 32-bit floating point number from game RAM
 * @param offset Byte offset from RAM_START
 * @returns The f32 value at the specified offset
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function getF32(offset: usize): f32 {
  return load<f32>(RAM_START + offset);
}

/**
 * Write a 32-bit floating point number to game RAM
 * @param offset Byte offset from RAM_START
 * @param value The f32 value to store
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function setF32(offset: usize, value: f32): void {
  store<f32>(RAM_START + offset, value);
}

/**
 * Read an 8-bit unsigned integer from game RAM
 * @param offset Byte offset from RAM_START
 * @returns The u8 value at the specified offset
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function getU8(offset: usize): u8 {
  return load<u8>(RAM_START + offset);
}

/**
 * Write an 8-bit unsigned integer to game RAM
 * @param offset Byte offset from RAM_START
 * @param value The u8 value to store
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function setU8(offset: usize, value: u8): void {
  store<u8>(RAM_START + offset, value);
}

// @ts-expect-error AssemblyScript decorator
@inline
export function getU16(offset: usize): u16 {
  return load<u16>(RAM_START + offset);
}

// @ts-expect-error AssemblyScript decorator
@inline
export function setU16(offset: usize, value: u16): void {
  store<u16>(RAM_START + offset, value);
}
