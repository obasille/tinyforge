// TinyForge SDK - Memory Management
// Defines memory layout, external memory interface, and RAM accessors
// 
// Memory layout constants are synced with ../memory-map.ts

/** External WebAssembly memory shared between host and cartridge */
@external("env", "memory")
export declare const memory: WebAssembly.Memory;

// Import shared memory constants from memory-map.ts
// These are cast to AssemblyScript types for use in WASM
import * as memoryMap from '../memory-map';

/** Display width in pixels */
export const WIDTH = memoryMap.WIDTH as i32;

/** Display height in pixels */
export const HEIGHT = memoryMap.HEIGHT as i32;

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

/** Sprite metadata table base address */
export const SPRITE_METADATA_ADDR = memoryMap.SPRITE_METADATA_ADDR as usize;

/** Sprite metadata entry size (8 bytes) */
export const SPRITE_METADATA_SIZE = memoryMap.SPRITE_METADATA_SIZE as usize;

/** Sprite pixel data base address (after 256 sprite metadata entries) */
export const SPRITE_DATA_ADDR = memoryMap.SPRITE_DATA_ADDR as usize;

/** Maximum sprite data size (~128 KB) */
export const SPRITE_DATA_SIZE = memoryMap.SPRITE_DATA_SIZE as usize;

/** Game RAM start address */
export const RAM_START = memoryMap.RAM_START as usize;

/** Game RAM size in bytes (256 KB) */
export const RAM_SIZE = memoryMap.RAM_SIZE as usize;

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
