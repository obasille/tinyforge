// TinyForge SDK - Fast Monochrome Text Rendering
// Optimized 6×8 pixel monochrome bitmap font for high-performance text rendering

import { blendPixel } from "./drawing";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./memory";

/**
 * 6×8 monochrome bitmap font data
 * Each character stored as 8 bytes (one byte per row)
 * Bits 7-2 represent the 6 pixel columns (MSB is leftmost)
 * Font covers ASCII 32-126 (space through ~)
 */
const FONT_DATA: StaticArray<u64> = [
  // Space (32)
  0x0000000000000000,
  // ! (33)
  0x2020202020002000,
  // " (34)
  0x5050000000000000,
  // # (35)
  0x0050F850F8500000,
  // $ (36)
  0x2078A07028702000,
  // % (37)
  0xC8D0102020589800,
  // & (38)
  0x6090906098906800,
  // ' (39)
  0x2020000000000000,
  // ( (40)
  0x1020404040201000,
  // ) (41)
  0x4020101010204000,
  // * (42)
  0x0020A870A8200000,
  // + (43)
  0x002020F820200000,
  // , (44)
  0x0000000000202040,
  // - (45)
  0x000000F800000000,
  // . (46)
  0x0000000000606000,
  // / (47)
  0x0810102020404000,
  // 0 (48)
  0x70889898A8C87000,
  // 1 (49)
  0x2060202020207000,
  // 2 (50)
  0x708808102040F800,
  // 3 (51)
  0x7088083008887000,
  // 4 (52)
  0x10305090F8101000,
  // 5 (53)
  0xF880F00808887000,
  // 6 (54)
  0x3840F08888887000,
  // 7 (55)
  0xF808102020404000,
  // 8 (56)
  0x7088887088887000,
  // 9 (57)
  0x7088887808102000,
  // : (58)
  0x0000200000200000,
  // ; (59)
  0x0000600000602040,
  // < (60)
  0x1020408040201000,
  // = (61)
  0x0000F800F8000000,
  // > (62)
  0x4020100810204000,
  // ? (63)
  0x7088081020002000,
  // @ (64)
  0x7088989898807000,
  // A (65)
  0x708888F888888800,
  // B (66)
  0xF04848704848F000,
  // C (67)
  0x3048808080483000,
  // D (68)
  0xF04848484848F000,
  // E (69)
  0xF88080E08080F800,
  // F (70)
  0xF88080F080808000,
  // G (71)
  0x3840809888887000,
  // H (72)
  0x888888F888888800,
  // I (73)
  0x7020202020207000,
  // J (74)
  0x3808080888887000,
  // K (75)
  0x888890E090888800,
  // L (76)
  0x808080808080F800,
  // M (77)
  0x88D8A88888888800,
  // N (78)
  0x88C8A8A898888800,
  // O (79)
  0x7088888888887000,
  // P (80)
  0xF08888F080808000,
  // Q (81)
  0x7088888888887018,
  // R (82)
  0xF08888F090888800,
  // S (83)
  0x7088807008887000,
  // T (84)
  0xF820202020202000,
  // U (85)
  0x8888888888887000,
  // V (86)
  0x8888885050202000,
  // W (87)
  0x888888A8A8D85000,
  // X (88)
  0x8888502050888800,
  // Y (89)
  0x8888885020202000,
  // Z (90)
  0xF80810204080F800,
  // [ (91)
  0x7040404040407000,
  // \ (92)
  0x4020201010080800,
  // ] (93)
  0x7010101010107000,
  // ^ (94)
  0x2050000000000000,
  // _ (95)
  0x000000000000F800,
  // ` (96)
  0x4020000000000000,
  // a (97)
  0x0000700878887800,
  // b (98)
  0x8080B0C888C8B000,
  // c (99)
  0x0000708080807000,
  // d (100)
  0x0808788888887800,
  // e (101)
  0x00007088F8807000,
  // f (102)
  0x3040F04040404000,
  // g (103)
  0x0000708888780870,
  // h (104)
  0x8080F08888888800,
  // i (105)
  0x2000602020207000,
  // j (106)
  0x1000301010101060,
  // k (107)
  0x808090A0C0A09000,
  // l (108)
  0x6020202020201800,
  // m (109)
  0x0000D0A8A8A8A800,
  // n (110)
  0x0000F08888888800,
  // o (111)
  0x0000708888887000,
  // p (112)
  0x0000F08888F08080,
  // q (113)
  0x0000788888780808,
  // r (114)
  0x0000B0C080808000,
  // s (115)
  0x000078806018F000,
  // t (116)
  0x2020F82020201800,
  // u (117)
  0x0000888888887800,
  // v (118)
  0x0000888850502000,
  // w (119)
  0x00008888A8A8D800,
  // x (120)
  0x0000885020508800,
  // y (121)
  0x0000888878081070,
  // z (122)
  0x0000F81020407800,
  // { (123)
  0x1820204020201800,
  // | (124)
  0x2020202020202000,
  // } (125)
  0x6010100810106000,
  // ~ (126)
  0x0040A81000000000,
];

/**
 * Draw a single character using the 6×8 monochrome font with alpha blending
 * @param x Top-left X coordinate
 * @param y Top-left Y coordinate  
 * @param char ASCII character code (32-126)
 * @param color ABGR color value (supports alpha channel for transparency)
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function printChar(x: i32, y: i32, char: i32, color: u32): void {
  // Bounds check - early exit
  if (x < -5 || x >= SCREEN_WIDTH || y < -7 || y >= SCREEN_HEIGHT) return;
  
  // Clamp character to valid range
  if (char < 32 || char > 126) char = 32; // Default to space
  
  const glyphIndex = char - 32;
  const glyph = unchecked(FONT_DATA[glyphIndex]);
  const rowStride = SCREEN_WIDTH;
  
  // Blit glyph to framebuffer with alpha blending
  // Each byte in glyph represents one row (8 rows total)
  // Byte 7 (most significant) is the top row, byte 0 is the bottom row
  for (let row: i32 = 0; row < 8; row++) {
    const yy = y + row;
    if (yy < 0 || yy >= SCREEN_HEIGHT) continue;
    
    // Extract row byte (8 bits, we use bits 7-2 for 6 pixel columns)
    // Read from byte 7 for row 0, down to byte 0 for row 7
    const rowBits = ((glyph >> ((7 - row) << 3)) & 0xFF) as u8;
    
    // Draw 6 pixels for this row (bit 7 to bit 2, MSB is leftmost)
    let baseAddr = ((yy * rowStride + x) << 2) as usize;
    
    for (let col: i32 = 0; col < 6; col++) {
      const bitMask = ((0x80 as i32) >> col) as u8;
      if (rowBits & bitMask) {
        const xx = x + col;
        if (xx >= 0 && xx < SCREEN_WIDTH) {
          blendPixel(baseAddr, color);
        }
      }
      baseAddr += 4;
    }
  }
}

/**
 * Print a string of text using the 6×8 monochrome font with alpha blending
 * Characters are 6 pixels wide with no spacing between them
 * Supports ASCII characters 32-126 (space through ~)
 * 
 * @param x Starting X coordinate
 * @param y Starting Y coordinate
 * @param text String to print (supports upper, lower, numbers, symbols)
 * @param color ABGR color value (supports alpha channel for transparency)
 */
export function print(x: i32, y: i32, text: string, color: u32): void {
  const len = text.length;
  let currentX = x;
  
  for (let i: i32 = 0; i < len; i++) {
    const charCode = text.charCodeAt(i);
    printChar(currentX, y, charCode, color);
    currentX += 6; // Each character is exactly 6 pixels wide
  }
}

/**
 * Measure the width of a string in pixels
 * @param text String to measure
 * @returns Width in pixels (6 pixels per character)
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function measureText(text: string): i32 {
  return text.length * 6;
}

/**
 * Print text centered horizontally on the screen
 * @param y Y coordinate for the text
 * @param text String to print
 * @param color ABGR color value
 */
export function printCentered(y: i32, text: string, color: u32): void {
  const width = measureText(text);
  const x = (SCREEN_WIDTH - width) >> 1;
  print(x, y, text, color);
}

/**
 * Print text right-aligned
 * @param x Right edge X coordinate
 * @param y Y coordinate for the text
 * @param text String to print
 * @param color ABGR color value
 */
export function printRight(x: i32, y: i32, text: string, color: u32): void {
  const width = measureText(text);
  print(x - width, y, text, color);
}
