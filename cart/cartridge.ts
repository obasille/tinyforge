// Compiler with asc
// asc cartridge.ts -o cartridge.wasm -O3 --runtime stub --importMemory

// Console RAM
@external("env", "memory")
declare const memory: WebAssembly.Memory;

import { FB_START, RAM_START } from './memory';

// === constants ===
export const WIDTH: i32 = 320;
export const HEIGHT: i32 = 240;

enum Button {
  UP    = 1 << 0,
  DOWN  = 1 << 1,
  LEFT  = 1 << 2,
  RIGHT = 1 << 3,
  A     = 1 << 4,
  B     = 1 << 5,
  START = 1 << 6
}

// === Memory offsets for game state ===
const PX_ADDR: usize = RAM_START;      // Player X position (i32)
const PY_ADDR: usize = RAM_START + 4;  // Player Y position (i32)

// === RAM accessors ===
@inline
function getPX(): i32 {
  return load<i32>(PX_ADDR);
}

@inline
function setPX(value: i32): void {
  store<i32>(PX_ADDR, value);
}

@inline
function getPY(): i32 {
  return load<i32>(PY_ADDR);
}

@inline
function setPY(value: i32): void {
  store<i32>(PY_ADDR, value);
}

// === lifecycle ===
export function init(): void {
  cls(0xFF000000); // black
  
  // Initialize player position in RAM
  setPX(160);
  setPY(120);
}

export function update(input: i32, prevInput: i32): void {
  // Load player position from RAM
  let px = getPX();
  let py = getPY();
  
  // game logic
  if (input & Button.LEFT)  px--;
  if (input & Button.RIGHT) px++;
  if (input & Button.UP)    py--;
  if (input & Button.DOWN)  py++;
  
  // Store updated position back to RAM
  setPX(px);
  setPY(py);
  
  // Example: detect button press (not hold)
  // const pressed = input & ~prevInput;
  // if (pressed & Button.A) { /* do something once */ }
}

export function draw(): void {
  // Load player position from RAM
  const px = getPX();
  const py = getPY();
  
  // test pattern
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const r = x & 255;
      const g = y & 255;
      const b = 128;
      pset(x, y, 0xFF000000 | (r << 16) | (g << 8) | b);
    }
  }
  // draw player
  pset(px, py, 0xffffffff);
}

// === framebuffer helpers ===
@inline
function pset(x: i32, y: i32, color: u32): void {
  const i = (y * WIDTH + x) << 2;
  store<u32>(i, color);
}

@inline
function cls(color: u32): void {
  let i = 0;
  const end = WIDTH * HEIGHT * 4;
  while (i < end) {
    store<u32>(i, color);
    i += 4;
  }
}
