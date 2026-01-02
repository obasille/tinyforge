// Fantasy Console SDK - Memory Management
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
