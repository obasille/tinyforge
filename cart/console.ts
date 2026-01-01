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

// === Fast Framebuffer Clear ===
// Efficiently clears entire framebuffer using native JS (much faster than WASM loop)
@external("env", "clearFramebuffer")
export declare function clearFramebuffer(color: u32): void;


// Generic RAM accessors
@inline
export function getI32(offset: u32): i32 {
  return load<i32>(RAM_START + offset);
}

@inline
export function setI32(offset: u32, value: i32): void {
  store<i32>(RAM_START + offset, value);
}

@inline
export function getF32(offset: u32): f32 {
  return load<f32>(RAM_START + offset);
}

@inline
export function setF32(offset: u32, value: f32): void {
  store<f32>(RAM_START + offset, value);
}

@inline
export function getU8(offset: u32): u8 {
  return load<u8>(RAM_START + offset);
}

@inline
export function setU8(offset: u32, value: u8): void {
  store<u8>(RAM_START + offset, value);
}


// === Drawing Helpers ===


@inline
export function pset(x: i32, y: i32, color: u32): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const i = (y * WIDTH + x) << 2;
  store<u32>(i, color | 0xFF000000);
}

export function fillRect(x: i32, y: i32, w: i32, h: i32, color: u32): void {
  for (let dy: i32 = 0; dy < h; dy++) {
    for (let dx: i32 = 0; dx < w; dx++) {
      pset(x + dx, y + dy, color);
    }
  }
}

export function drawRect(x: i32, y: i32, w: i32, h: i32, color: u32): void {
  for (let i: i32 = 0; i < w; i++) {
    pset(x + i, y, color);
    pset(x + i, y + h - 1, color);
  }
  for (let i: i32 = 0; i < h; i++) {
    pset(x, y + i, color);
    pset(x + w - 1, y + i, color);
  }
}

export function fillCircle(cx: i32, cy: i32, r: i32, color: u32): void {
  const r2 = r * r;
  for (let dy: i32 = -r; dy <= r; dy++) {
    for (let dx: i32 = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) {
        pset(cx + dx, cy + dy, color);
      }
    }
  }
}

export function drawNumber(x: i32, y: i32, num: i32, color: u32): void {
  // Simple 3×5 digit patterns (5 rows, 3 columns each = 15 bits)
  // Each pattern is: row0_row1_row2_row3_row4 (3 bits per row)
  let pattern: u16 = 0;
  
  if (num == 0) pattern = 0b111_101_101_101_111 as u16;      // 0
  else if (num == 1) pattern = 0b010_010_010_010_010 as u16; // 1
  else if (num == 2) pattern = 0b111_001_111_100_111 as u16; // 2
  else if (num == 3) pattern = 0b111_001_111_001_111 as u16; // 3
  else if (num == 4) pattern = 0b101_101_111_001_001 as u16; // 4
  else if (num == 5) pattern = 0b111_100_111_001_111 as u16; // 5
  else if (num == 6) pattern = 0b111_100_111_101_111 as u16; // 6
  else if (num == 7) pattern = 0b111_001_001_001_001 as u16; // 7
  else if (num == 8) pattern = 0b111_101_111_101_111 as u16; // 8
  
  if (pattern == 0 && num != 0) return;

  draw3x5Pattern(x, y, pattern, color);
}

export function drawChar(x: i32, y: i32, char: i32, color: u32): void {
  // 3×5 character patterns for uppercase letters and symbols
  let pattern: u16 = 0;
  
  if (char == 65) pattern = 0b111_101_111_101_101 as u16;      // A
  else if (char == 66) pattern = 0b110_101_110_101_110 as u16; // B
  else if (char == 67) pattern = 0b111_100_100_100_111 as u16; // C
  else if (char == 68) pattern = 0b110_101_101_101_110 as u16; // D
  else if (char == 69) pattern = 0b111_100_111_100_111 as u16; // E
  else if (char == 70) pattern = 0b111_100_111_100_100 as u16; // F
  else if (char == 71) pattern = 0b111_100_101_101_111 as u16; // G
  else if (char == 72) pattern = 0b101_101_111_101_101 as u16; // H
  else if (char == 73) pattern = 0b111_010_010_010_111 as u16; // I
  else if (char == 74) pattern = 0b111_001_001_101_111 as u16; // J
  else if (char == 75) pattern = 0b101_101_110_101_101 as u16; // K
  else if (char == 76) pattern = 0b100_100_100_100_111 as u16; // L
  else if (char == 77) pattern = 0b101_111_101_101_101 as u16; // M
  else if (char == 78) pattern = 0b101_111_111_111_101 as u16; // N
  else if (char == 79) pattern = 0b111_101_101_101_111 as u16; // O
  else if (char == 80) pattern = 0b111_101_111_100_100 as u16; // P
  else if (char == 81) pattern = 0b111_101_101_111_001 as u16; // Q
  else if (char == 82) pattern = 0b110_101_110_101_101 as u16; // R
  else if (char == 83) pattern = 0b111_100_111_001_111 as u16; // S
  else if (char == 84) pattern = 0b111_010_010_010_010 as u16; // T
  else if (char == 85) pattern = 0b101_101_101_101_111 as u16; // U
  else if (char == 86) pattern = 0b101_101_101_101_010 as u16; // V
  else if (char == 87) pattern = 0b101_101_101_111_101 as u16; // W
  else if (char == 88) pattern = 0b101_101_010_101_101 as u16; // X
  else if (char == 89) pattern = 0b101_101_111_010_010 as u16; // Y
  else if (char == 90) pattern = 0b111_001_010_100_111 as u16; // Z
  else if (char == 33) pattern = 0b010_010_010_000_010 as u16; // !
  else if (char == 63) pattern = 0b111_001_010_000_010 as u16; // ?
  else if (char == 46) pattern = 0b000_000_000_000_010 as u16; // .
  else if (char == 44) pattern = 0b000_000_000_010_100 as u16; // ,
  else if (char == 58) pattern = 0b000_010_000_010_000 as u16; // :
  else if (char == 45) pattern = 0b000_000_111_000_000 as u16; // -
  else if (char == 32) pattern = 0b000_000_000_000_000 as u16; // space
  
  if (pattern == 0) return;

  draw3x5Pattern(x, y, pattern, color);
}

function draw3x5Pattern(x: i32, y: i32, pattern: u16, color: u32): void {
  for (let dy: i32 = 0; dy < 5; dy++) {
    for (let dx: i32 = 0; dx < 3; dx++) {
      const bitPos = ((4 - dy) * 3 + (2 - dx)) as u16;
      const bit = (pattern >> bitPos) & 1;
      if (bit) {
        pset(x + dx * 2, y + dy * 2, color);
        pset(x + dx * 2 + 1, y + dy * 2, color);
        pset(x + dx * 2, y + dy * 2 + 1, color);
        pset(x + dx * 2 + 1, y + dy * 2 + 1, color);
      }
    }
  }
}

export function drawString(x: i32, y: i32, text: string, color: u32): void {
  const len = text.length;
  for (let i: i32 = 0; i < len; i++) {
    const charCode = text.charCodeAt(i);
    drawChar(x + i * 8, y, charCode, color);
  }
}
