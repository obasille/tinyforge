// === constants ===
export const WIDTH: i32 = 320;
export const HEIGHT: i32 = 240;
export const FB_PTR: usize = 0;

// === lifecycle ===
export function init(): void {
  cls(0xFF000000); // black
}

export function update(): void {
  // game logic
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
