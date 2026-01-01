// Compiler with asc
// asc cartridge.ts -o cartridge.wasm -O3 --runtime stub --importMemory

// Console RAM
@external("env", "memory")
declare const memory: WebAssembly.Memory;

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

// === lifecycle ===
export function init(): void {
  cls(0xFF000000); // black
}

let px: i32 = 160;
let py: i32 = 120;

export function update(input: i32): void {
  // game logic
  if (input & Button.LEFT)  px--;
  if (input & Button.RIGHT) px++;
  if (input & Button.UP)    py--;
  if (input & Button.DOWN)  py++;
}

export function draw(): void {
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
