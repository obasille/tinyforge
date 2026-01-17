// TinyForge SDK - Color Management
// Color format conversion utilities

/**
 * Convert RGB color format to ABGR format with full alpha
 *
 * Colors in code use the standard RGB format (0xRRGGBB) for readability,
 * but the framebuffer uses ABGR format (0xAABBGGRR). This function converts
 * between the two formats automatically.
 *
 * @param rgb Color in RGB format (0xRRGGBB)
 * @returns Color in ABGR format with full alpha (0xFFBBGGRR)
 *
 * @example
 * ```ts
 * const red = c(0xff0000);    // Converts to 0xff0000ff
 * const green = c(0x00ff00);  // Converts to 0xff00ff00
 * const blue = c(0x0000ff);   // Converts to 0xffff0000
 * ```
 */
@inline
export function c(rgb: u32): u32 {
  const r = (rgb >> 16) & 0xff;
  const g = rgb & 0x00ff00;
  const b = (rgb & 0xff) << 16;
  return 0xff000000 | b | g | r;
}

/**
 * Convert individual RGBA components to ABGR format
 *
 * Takes separate red, green, blue, and alpha values and combines them
 * into a single 32-bit color value in ABGR format used by the framebuffer.
 *
 * @param r Red component (0-255)
 * @param g Green component (0-255)
 * @param b Blue component (0-255)
 * @param a Alpha component (0-255)
 * @returns Color in ABGR format (0xAABBGGRR)
 *
 * @example
 * ```ts
 * const red = toColor(255, 0, 0, 255);      // Opaque red
 * const semiTransparent = toColor(255, 128, 64, 128); // Semi-transparent orange
 * ```
 */
@inline
export function toColor(r: u8, g: u8, b: u8, a: u8): u32 {
  return ((a as u32) << 24) | ((b as u32) << 16) | ((g as u32) << 8) | (r as u32);
}