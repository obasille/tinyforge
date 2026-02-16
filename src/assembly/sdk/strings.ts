// TinyForge SDK - Bitmap Text Rendering
// String and character drawing utilities

import { pset } from "./drawing";

/**
 * Draw a single digit (0-9) using 3×5 bitmap patterns
 * Each pixel is rendered as a 2×2 block for better visibility
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param digit Digit to draw (0-9)
 * @param color ABGR color value
 */
export function drawDigit(x: i32, y: i32, digit: i32, color: u32): void {
  // Simple 3×5 digit patterns (5 rows, 3 columns each = 15 bits)
  // Each pattern is: row0_row1_row2_row3_row4 (3 bits per row)
  let pattern: u16 = 0;

  if (digit == 0)
    pattern = 0b111_101_101_101_111 as u16; // 0
  else if (digit == 1)
    pattern = 0b010_110_010_010_111 as u16; // 1
  else if (digit == 2)
    pattern = 0b111_001_111_100_111 as u16; // 2
  else if (digit == 3)
    pattern = 0b111_001_111_001_111 as u16; // 3
  else if (digit == 4)
    pattern = 0b101_101_111_001_001 as u16; // 4
  else if (digit == 5)
    pattern = 0b111_100_111_001_111 as u16; // 5
  else if (digit == 6)
    pattern = 0b111_100_111_101_111 as u16; // 6
  else if (digit == 7)
    pattern = 0b111_001_001_001_001 as u16; // 7
  else if (digit == 8)
    pattern = 0b111_101_111_101_111 as u16; // 8
  else if (digit == 9) pattern = 0b111_101_111_001_111 as u16; // 9

  if (pattern == 0 && digit != 0) return;

  draw3x5Pattern(x, y, pattern, color);
}

/**
 * Draw a number (positive or negative, multi-digit) using 3×5 bitmap patterns
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate
 * @param num Number to draw
 * @param color ABGR color value
 */
export function drawNumber(x: i32, y: i32, num: i32, color: u32): void {
  let currentX = x;

  // Handle negative numbers
  if (num < 0) {
    drawChar(currentX, y, 45, color); // Draw '-' character
    currentX += 8; // Each character is 6 pixels wide + 2 pixel spacing
    num = -num;
  }

  // Handle zero specially
  if (num == 0) {
    drawDigit(currentX, y, 0, color);
    return;
  }

  // Count digits to determine starting position
  let temp = num;
  let digitCount: i32 = 0;
  while (temp > 0) {
    digitCount++;
    temp /= 10;
  }

  // Draw digits from right to left
  for (let i: i32 = digitCount - 1; i >= 0; i--) {
    const digit = num % 10;
    drawDigit(currentX + i * 8, y, digit, color);
    num /= 10;
  }
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
    drawDigit(x, y, digit, color);
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
 *
 * NOTE: Only uppercase letters (A-Z), numbers (0-9), and basic punctuation
 * are supported. Lowercase letters will not render correctly.
 * Always use uppercase strings with this function.
 *
 * @param x Starting X coordinate
 * @param y Starting Y coordinate
 * @param text String to draw (use UPPERCASE only)
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
 * Measure string width in pixels for drawString()
 * @param text String to measure
 * @returns Width in pixels
 */
export function measureString(text: string): i32 {
  return text.length * 8;
}

/**
 * Draw a string centered on a given point
 * @param cx Center X coordinate
 * @param y Top Y coordinate
 * @param text String to draw
 * @param color ABGR color value
 */
export function drawStringCentered(
  cx: i32,
  y: i32,
  text: string,
  color: u32,
): void {
  const width = measureString(text);
  drawString(cx - (width >> 1), y, text, color);
}
