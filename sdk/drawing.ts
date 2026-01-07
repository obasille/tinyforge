// TinyForge SDK - Drawing Primitives
// Low-level and high-level drawing functions for rendering graphics

import { toColor } from "./color";
import { WIDTH, HEIGHT, SPRITE_METADATA_ADDR, SPRITE_DATA_ADDR } from "./memory";

/**
 * Efficiently clears entire framebuffer using native JS
 * Much faster than a WASM loop for clearing the full screen
 * @param color ABGR color to fill the framebuffer with
 */
@external("env", "clearFramebuffer")
export declare function clearFramebuffer(color: u32): void;

/**
 * Set a single pixel in the framebuffer
 * Coordinates are clipped to screen bounds
 * @param x X coordinate (0-319)
 * @param y Y coordinate (0-239)
 * @param color ABGR color value
 */
@inline
export function pset(x: i32, y: i32, color: u32): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const i = (y * WIDTH + x) << 2;
  store<u32>(i, color | 0xff000000);
}

/**
 * Draw a filled rectangle
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param w Width in pixels
 * @param h Height in pixels
 * @param color ABGR color value
 */
export function fillRect(x: i32, y: i32, w: i32, h: i32, color: u32): void {
  for (let dy: i32 = 0; dy < h; dy++) {
    for (let dx: i32 = 0; dx < w; dx++) {
      pset(x + dx, y + dy, color);
    }
  }
}

/**
 * Draw a rectangle outline
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param w Width in pixels
 * @param h Height in pixels
 * @param color ABGR color value
 */
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

/**
 * Draw a filled circle using midpoint algorithm
 * @param cx Center X coordinate
 * @param cy Center Y coordinate
 * @param r Radius in pixels
 * @param color ABGR color value
 */
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

/**
 * Draw a single digit (0-9) using 3×5 bitmap patterns
 * Each pixel is rendered as a 2×2 block for better visibility
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param num Digit to draw (0-9)
 * @param color ABGR color value
 */
export function drawNumber(x: i32, y: i32, num: i32, color: u32): void {
  // Simple 3×5 digit patterns (5 rows, 3 columns each = 15 bits)
  // Each pattern is: row0_row1_row2_row3_row4 (3 bits per row)
  let pattern: u16 = 0;

  if (num == 0)
    pattern = 0b111_101_101_101_111 as u16; // 0
  else if (num == 1)
    pattern = 0b010_110_010_010_111 as u16; // 1
  else if (num == 2)
    pattern = 0b111_001_111_100_111 as u16; // 2
  else if (num == 3)
    pattern = 0b111_001_111_001_111 as u16; // 3
  else if (num == 4)
    pattern = 0b101_101_111_001_001 as u16; // 4
  else if (num == 5)
    pattern = 0b111_100_111_001_111 as u16; // 5
  else if (num == 6)
    pattern = 0b111_100_111_101_111 as u16; // 6
  else if (num == 7)
    pattern = 0b111_001_001_001_001 as u16; // 7
  else if (num == 8)
    pattern = 0b111_101_111_101_111 as u16; // 8
  else if (num == 9) pattern = 0b111_101_111_001_111 as u16; // 9

  if (pattern == 0 && num != 0) return;

  draw3x5Pattern(x, y, pattern, color);
}

/**
 * Draw a single character using 3×5 bitmap patterns
 * Supports uppercase letters (A-Z), digits (0-9), and basic punctuation
 * Each pixel is rendered as a 2×2 block, resulting in 6×10 pixel characters
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param char ASCII character code
 * @param color ABGR color value
 */
export function drawChar(x: i32, y: i32, char: i32, color: u32): void {
  // 3×5 character patterns for uppercase letters and symbols
  let pattern: u16 = 0;

  if (char == 65)
    pattern = 0b111_101_111_101_101 as u16; // A
  else if (char == 66)
    pattern = 0b110_101_110_101_110 as u16; // B
  else if (char == 67)
    pattern = 0b111_100_100_100_111 as u16; // C
  else if (char == 68)
    pattern = 0b110_101_101_101_110 as u16; // D
  else if (char == 69)
    pattern = 0b111_100_111_100_111 as u16; // E
  else if (char == 70)
    pattern = 0b111_100_111_100_100 as u16; // F
  else if (char == 71)
    pattern = 0b111_100_101_101_111 as u16; // G
  else if (char == 72)
    pattern = 0b101_101_111_101_101 as u16; // H
  else if (char == 73)
    pattern = 0b111_010_010_010_111 as u16; // I
  else if (char == 74)
    pattern = 0b111_001_001_101_111 as u16; // J
  else if (char == 75)
    pattern = 0b101_101_110_101_101 as u16; // K
  else if (char == 76)
    pattern = 0b100_100_100_100_111 as u16; // L
  else if (char == 77)
    pattern = 0b101_111_101_101_101 as u16; // M
  else if (char == 78)
    pattern = 0b101_111_111_111_101 as u16; // N
  else if (char == 79)
    pattern = 0b111_101_101_101_111 as u16; // O
  else if (char == 80)
    pattern = 0b111_101_111_100_100 as u16; // P
  else if (char == 81)
    pattern = 0b111_101_101_111_001 as u16; // Q
  else if (char == 82)
    pattern = 0b110_101_110_101_101 as u16; // R
  else if (char == 83)
    pattern = 0b111_100_111_001_111 as u16; // S
  else if (char == 84)
    pattern = 0b111_010_010_010_010 as u16; // T
  else if (char == 85)
    pattern = 0b101_101_101_101_111 as u16; // U
  else if (char == 86)
    pattern = 0b101_101_101_101_010 as u16; // V
  else if (char == 87)
    pattern = 0b101_101_101_111_101 as u16; // W
  else if (char == 88)
    pattern = 0b101_101_010_101_101 as u16; // X
  else if (char == 89)
    pattern = 0b101_101_111_010_010 as u16; // Y
  else if (char == 90)
    pattern = 0b111_001_010_100_111 as u16; // Z
  else if (char == 33)
    pattern = 0b010_010_010_000_010 as u16; // !
  else if (char == 63)
    pattern = 0b111_001_010_000_010 as u16; // ?
  else if (char == 46)
    pattern = 0b000_000_000_000_010 as u16; // .
  else if (char == 44)
    pattern = 0b000_000_000_010_100 as u16; // ,
  else if (char == 58)
    pattern = 0b000_010_000_010_000 as u16; // :
  else if (char == 45)
    pattern = 0b000_000_111_000_000 as u16; // -
  else if (char == 32) pattern = 0b000_000_000_000_000 as u16; // space

  if (pattern != 0) {
    draw3x5Pattern(x, y, pattern, color);
  } else {
    // Try with digits '0'-'9'
    const digit = char - 48;
    drawNumber(x, y, digit, color);
  }
}

/**
 * Draw a 3×5 bitmap pattern with each bit rendered as a 2×2 pixel block
 * Used internally by drawChar and drawNumber
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param pattern 15-bit pattern (3 bits × 5 rows)
 * @param color ABGR color value
 */
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

/**
 * Draw a string of text using bitmap font
 * Characters are spaced 8 pixels apart horizontally
 * @param x Starting X coordinate
 * @param y Starting Y coordinate
 * @param text String to draw
 * @param color ABGR color value
 */
export function drawString(x: i32, y: i32, text: string, color: u32): void {
  const len = text.length;
  for (let i: i32 = 0; i < len; i++) {
    const charCode = text.charCodeAt(i);
    drawChar(x + i * 8, y, charCode, color);
  }
}

/**
 * Draw a sprite at the specified position
 * Supports alpha blending for semi-transparent sprites
 * @param id Sprite ID
 * @param x X coordinate (top-left)
 * @param y Y coordinate (top-left)
 * @example
 * ```typescript
 * drawSprite(0, 100, 100); // Draw sprite 0 at (100, 100)
 * ```
 */
export function drawSprite(id: u32, x: i32, y: i32): void {
  // Read sprite metadata
  const metadataAddr = SPRITE_METADATA_ADDR + (id as usize) * 8;
  const width = load<u16>(metadataAddr + 0) as i32;
  const height = load<u16>(metadataAddr + 2) as i32;
  const dataOffset = load<u32>(metadataAddr + 4);

  // Early exit if sprite has no size (not loaded)
  if (width == 0 || height == 0) return;

  // Calculate visible region (clip to screen bounds)
  const startX = max(0, -x);
  const startY = max(0, -y);
  const endX = min(width, WIDTH - x);
  const endY = min(height, HEIGHT - y);

  // Early exit if sprite is completely off-screen
  if (startX >= endX || startY >= endY) return;

  // Draw sprite pixels (only visible region)
  const spriteDataAddr = SPRITE_DATA_ADDR + dataOffset;

  for (let dy: i32 = startY; dy < endY; dy++) {
    for (let dx: i32 = startX; dx < endX; dx++) {
      const pixelOffset = ((dy * width + dx) * 4) as usize;
      const pixelAddr = spriteDataAddr + pixelOffset;

      const srcR = load<u8>(pixelAddr + 0);
      const srcG = load<u8>(pixelAddr + 1);
      const srcB = load<u8>(pixelAddr + 2);
      const srcA = load<u8>(pixelAddr + 3);

      // Skip fully transparent pixels
      if (srcA == 0) continue;

      const screenX = x + dx;
      const screenY = y + dy;

      // If fully opaque, no blending needed
      if (srcA == 255) {
        pset(screenX, screenY, toColor(srcR, srcG, srcB, 255));
      } else {
        // Alpha blending required
        const fbAddr = ((screenY * WIDTH + screenX) << 2) as usize;
        const dstPixel = load<u32>(fbAddr);

        // Extract destination RGB from ABGR format
        const dstR = (dstPixel >> 16) & 0xff;
        const dstG = (dstPixel >> 8) & 0xff;
        const dstB = dstPixel & 0xff;

        // Blend: result = src * alpha + dst * (1 - alpha)
        const alpha = srcA as u32;
        const invAlpha = 255 - alpha;

        const blendR = ((srcR as u32 * alpha + dstR * invAlpha) / 255) as u8;
        const blendG = ((srcG as u32 * alpha + dstG * invAlpha) / 255) as u8;
        const blendB = ((srcB as u32 * alpha + dstB * invAlpha) / 255) as u8;

        pset(screenX, screenY, toColor(blendR, blendG, blendB, 255));
      }
    }
  }
}

/**
 * Draw a sprite with optional horizontal and vertical flipping
 * Supports transparency (alpha < 128 treated as transparent)
 * @param id Sprite ID (0-255)
 * @param x X coordinate (top-left)
 * @param y Y coordinate (top-left)
 * @param flipH Flip horizontally
 * @param flipV Flip vertically
 * @example
 * ```typescript
 * drawSpriteFlip(0, 100, 100, true, false); // Draw sprite 0 flipped horizontally
 * ```
 */
export function drawSpriteFlip(
  id: u8,
  x: i32,
  y: i32,
  flipH: bool,
  flipV: bool,
): void {
  // Read sprite metadata
  const metadataAddr = SPRITE_METADATA_ADDR + (id as usize) * 8;
  const width = load<u16>(metadataAddr + 0);
  const height = load<u16>(metadataAddr + 2);
  const dataOffset = load<u32>(metadataAddr + 4);

  // Early exit if sprite has no size (not loaded)
  if (width == 0 || height == 0) return;

  // Draw sprite pixels with flipping
  const spriteDataAddr = SPRITE_DATA_ADDR + dataOffset;

  for (let dy: i32 = 0; dy < height; dy++) {
    for (let dx: i32 = 0; dx < width; dx++) {
      const srcX = flipH ? width - 1 - dx : dx;
      const srcY = flipV ? height - 1 - dy : dy;

      const pixelOffset = ((srcY * width + srcX) * 4) as usize;
      const pixelAddr = spriteDataAddr + pixelOffset;

      const r = load<u8>(pixelAddr + 0);
      const g = load<u8>(pixelAddr + 1);
      const b = load<u8>(pixelAddr + 2);
      const a = load<u8>(pixelAddr + 3);

      // Skip transparent pixels (alpha < 128)
      if (a < 128) continue;

      // Convert RGBA to ABGR and draw
      pset(x + dx, y + dy, toColor(r, g, b, a));
    }
  }
}

/**
 * Draw a scaled sprite (2x upscaling)
 * Supports transparency (alpha < 128 treated as transparent)
 * @param id Sprite ID (0-255)
 * @param x X coordinate (top-left)
 * @param y Y coordinate (top-left)
 * @example
 * ```typescript
 * drawSprite2x(0, 100, 100); // Draw sprite 0 scaled 2x
 * ```
 */
export function drawSprite2x(id: u8, x: i32, y: i32): void {
  // Read sprite metadata
  const metadataAddr = SPRITE_METADATA_ADDR + (id as usize) * 8;
  const width = load<u16>(metadataAddr + 0);
  const height = load<u16>(metadataAddr + 2);
  const dataOffset = load<u32>(metadataAddr + 4);

  // Early exit if sprite has no size (not loaded)
  if (width == 0 || height == 0) return;

  // Draw sprite pixels scaled 2x
  const spriteDataAddr = SPRITE_DATA_ADDR + dataOffset;

  for (let dy: i32 = 0; dy < height; dy++) {
    for (let dx: i32 = 0; dx < width; dx++) {
      const pixelOffset = ((dy * width + dx) * 4) as usize;
      const pixelAddr = spriteDataAddr + pixelOffset;

      const r = load<u8>(pixelAddr + 0);
      const g = load<u8>(pixelAddr + 1);
      const b = load<u8>(pixelAddr + 2);
      const a = load<u8>(pixelAddr + 3);

      // Skip transparent pixels (alpha < 128)
      if (a < 128) continue;

      // Convert RGBA to ABGR
      const color = toColor(r, g, b, a);

      // Draw 2x2 block
      pset(x + dx * 2, y + dy * 2, color);
      pset(x + dx * 2 + 1, y + dy * 2, color);
      pset(x + dx * 2, y + dy * 2 + 1, color);
      pset(x + dx * 2 + 1, y + dy * 2 + 1, color);
    }
  }
}
