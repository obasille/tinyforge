// TinyForge SDK - Utility Functions
// Helper classes and convenience functions for common game tasks

import { fillRect, drawRect, drawString } from "./drawing";
import { c } from "./color";

/**
 * 2D integer vector class for coordinate pairs and offsets
 * Uses @unmanaged to work with stub runtime (no heap allocation)
 *
 * @example
 * ```ts
 * const pos = new Vec2i(10, 20);
 * const offset = new Vec2i(5, 5);
 * pos.x += offset.x;  // Now at (15, 25)
 * ```
 */
@unmanaged
export class Vec2i {
  /** X coordinate */
  x: i32;

  /** Y coordinate */
  y: i32;

  /**
   * Create a new 2D integer vector
   * @param x X coordinate (default: 0)
   * @param y Y coordinate (default: 0)
   */
  constructor(x: i32 = 0, y: i32 = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * Set both coordinates
   * @param x New X coordinate
   * @param y New Y coordinate
   */
  set(x: i32, y: i32): void {
    this.x = x;
    this.y = y;
  }

  /**
   * Create a copy of this vector
   * @returns A new Vec2i with the same coordinates
   */
  copy(): Vec2i {
    return new Vec2i(this.x, this.y);
  }
}

/**
 * Generate a pseudo-random integer using Linear Congruential Generator (LCG)
 * The seed is stored in RAM at the provided offset and updated on each call
 *
 * @param seedVar Memory address where the seed is stored (typically RAM_START + offset)
 * @returns Random i32 value in range [0, 0x7fffffff]
 *
 * @example
 * ```ts
 * // In your game's Var enum:
 * enum Var {
 *   RNG_SEED = 0,  // 4 bytes
 * }
 *
 * // Generate random number between 0-9:
 * const roll = random(RAM_START + Var.RNG_SEED) % 10;
 * ```
 */
@inline
export function random(seedVar: usize): i32 {
  let seed = load<i32>(seedVar);
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  store<i32>(seedVar, seed);
  return seed;
}

/**
 * Draw a styled message box with title and optional subtitle
 * All text positions are specified as offsets relative to the box corner
 *
 * @param pos Top-left corner of the box
 * @param size Width and height of the box
 * @param title Main text to display
 * @param titleOffset Position of title relative to box corner
 * @param subtitle Secondary text (use empty string "" to skip)
 * @param subtitleOffset Position of subtitle relative to box corner
 * @param bgColor Background fill color (ABGR format)
 * @param fgColor Border and text color (ABGR format)
 *
 * @example
 * ```ts
 * // Draw a centered game over message:
 * drawMessageBox(
 *   new Vec2i(60, 90), new Vec2i(200, 60),
 *   "GAME OVER", new Vec2i(70, 15),
 *   "PRESS START", new Vec2i(50, 35),
 *   c(0x000000), c(0xff0000)
 * );
 * ```
 */
export function drawMessageBox(
  pos: Vec2i,
  size: Vec2i,
  title: string,
  titleOffset: Vec2i,
  subtitle: string,
  subtitleOffset: Vec2i,
  bgColor: u32,
  fgColor: u32,
): void {
  fillRect(pos.x, pos.y, size.x, size.y, bgColor);
  drawRect(pos.x, pos.y, size.x, size.y, fgColor);
  drawString(pos.x + titleOffset.x, pos.y + titleOffset.y, title, fgColor);
  if (subtitle.length > 0) {
    drawString(
      pos.x + subtitleOffset.x,
      pos.y + subtitleOffset.y,
      subtitle,
      c(0xaaaaaa),
    );
  }
}
