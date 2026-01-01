// Fantasy Console SDK
// This file defines the console's hardware interface and API
// All cartridges should import from this file
//
// IMPORTANT: Cartridges use --runtime stub (no heap allocator)
// Do not use: new arrays, strings, objects, or any dynamic allocation
// Only use: primitives, load/store, and stack variables

// === External Memory ===
@external("env", "memory")
export declare const memory: WebAssembly.Memory;

// === Display Constants ===
export const WIDTH: i32 = 320;
export const HEIGHT: i32 = 240;

// === Memory Map ===
export const FB_START: usize    = 0x000000;  // Framebuffer start
export const FB_SIZE: usize     = 307200;    // 320×240×4 bytes

export const RAM_START: usize   = 0x04B000;  // Game RAM start
export const RAM_SIZE: usize    = 262144;    // 256 KB

export const SAVE_START: usize  = 0x08B000;  // Save data start
export const SAVE_SIZE: usize   = 65536;     // 64 KB

export const DEBUG_START: usize = 0x09B000;  // Debug/tooling start
export const DEBUG_SIZE: usize  = 65536;     // 64 KB

// === Input Constants ===
export enum Button {
  UP    = 1 << 0,
  DOWN  = 1 << 1,
  LEFT  = 1 << 2,
  RIGHT = 1 << 3,
  A     = 1 << 4,
  B     = 1 << 5,
  START = 1 << 6
}

// === Console Logging ===
// These functions output to the HTML console panel
// Note: Accepts string literals only (no allocations)
@external("env", "console.log")
export declare function log(msg: string): void;

@external("env", "console.warn")
export declare function warn(msg: string): void;

@external("env", "console.error")
export declare function error(msg: string): void;
