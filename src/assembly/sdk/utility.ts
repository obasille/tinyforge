// TinyForge SDK - Utility Functions
// Helper classes and convenience functions for common game tasks

import { fillRect, drawRect } from "./drawing";
import { drawString } from "./strings";
import { c } from "./color";
import { RNG_SEED } from "./memory";

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
 * Generate a pseudo-random integer using Xorshift32
 * The seed is stored in SDK memory at RNG_SEED and updated on each call
 * @returns Random i32 value in range [0, 0x7fffffff]
 *
 * @example
 * ```ts
 * // Generate random number between 0-9:
 * const roll = random() % 10;
 * ```
 */
export function randomXorshift32(seed: i32): i32 {
  let x = seed as u32;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x;
}

/**
 * Generate a higher-quality pseudo-random integer using SplitMix32
 * Useful when you need better diffusion than xorshift
 * @returns Random i32 value in range [0, 0x7fffffff]
 */
export function randomSplitMix32(seed: i32): i32 {
  let x = (seed as u32) + 0x9e3779b9;
  x = (x ^ (x >>> 16)) * 0x85ebca6b;
  x = (x ^ (x >>> 13)) * 0xc2b2ae35;
  x ^= x >>> 16;
  return x;
}

/**
 * Generate a pseudo-random integer using PCG (RXS-M-XS, 32-bit state)
 * This variant keeps a 32-bit state so it works with the current RNG_SEED layout.
 * @returns Random i32 value in range [0, 0x7fffffff]
 */
export function randomPcg(seed: i32): i32 {
  let state = seed as u32;
  state = (state * 747796405 + 2891336453) as u32;
  let word = ((state >> ((state >> 28) + 4)) ^ state) * 277803737;
  word = (word >> 22) ^ word;
  return word as i32;
}

/**
 * Generate a pseudo-random integer
 * The seed is stored in SDK memory at RNG_SEED and updated on each call
 * @returns Random i32 value in range [0, 0x7fffffff]
 *
 * @example
 * ```ts
 * // Generate random number between 0-9:
 * const roll = random() % 10;
 * ```
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function random(): i32 {
  const seed = load<i32>(RNG_SEED);
  const r = randomPcg(seed);
  store<i32>(RNG_SEED, r);
  return r & 0x7fffffff;
}

/**
 * Generate a pseudo-random integer in range [0, max)
 * @param max Exclusive upper bound (must be > 0)
 */
export function randomRange(max: i32): i32 {
  if (max <= 0) return 0;
  // Choose how many bits to use
  let bits: u32;
  if (max <= 0x100) bits = 8;
  else if (max <= 0x10000) bits = 16;
  else if (max <= 0x1000000) bits = 24;
  else bits = 32;

  const limit: u32 = ((1 << bits) / max) * max;

  let r: u32;
  do {
    r = random() >>> (32 - bits);
  } while (r >= limit);

  return r % max;
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

/**
 * Draw a centered message box with "PRESS START" prompt
 * Standard size and positioning for game start/end screens
 * @param message Main message to display (e.g., "GAME OVER", "YOU WIN!")
 * @param bgColor Background fill color (ABGR format)
 * @param fgColor Border and text color (ABGR format)
 *
 * @example
 * ```ts
 * // Draw game over message:
 * drawStartMessageBox("GAME OVER", c(0xaa5500), c(0xffaa00));
 * ```
 */
export function drawStartMessageBox(
  message: string,
  bgColor: u32,
  fgColor: u32,
): void {
  drawMessageBox(
    new Vec2i(75, 95),
    new Vec2i(170, 50),
    message,
    new Vec2i(50, 12),
    "PRESS START",
    new Vec2i(40, 27),
    bgColor,
    fgColor,
  );
}
