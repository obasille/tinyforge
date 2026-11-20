// TinyForge SDK - Utility Functions
// Helper classes and convenience functions for common game tasks

import { c } from "./color";
import {
  drawRect,
  fillRect,
} from "./drawing";
import { RNG_SEED } from "./memory";
import { drawString } from "./strings";

/**
 * 2D integer vector class for coordinate pairs and offsets
 * Uses @unmanaged to work with stub runtime (no heap allocation)
 * 
 * **WARNING:** Even though marked @unmanaged, using `new Vec2i()` still allocates memory
 * and will cause __alloc symbol to appear. For zero-allocation usage, pre-allocate memory
 * in your RAM layout and use `Vec2i.fromAddress()` to reinterpret that memory as a Vec2i.
 * 
 * Only use `new Vec2i()` in temporary contexts where allocation is acceptable,
 * or use `fromAddress()` for zero-allocation access to pre-allocated memory.
 *
 * @example
 * ```ts
 * // ❌ WRONG - This allocates memory!
 * const pos = new Vec2i(10, 20);
 * 
 * // ✅ CORRECT - Zero allocation with fromAddress
 * enum Var {
 *   PLAYER_POS = 0,  // 8 bytes (x: i32, y: i32)
 * }
 * const pos = Vec2i.fromAddress(RAM_START + Var.PLAYER_POS);
 * pos.x = 10;
 * pos.y = 20;
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
   * Create a Vec2i instance from a raw memory address
   * Useful for treating pre-allocated memory as a Vec2i without allocation
   * @param address Memory address of the Vec2i data (8 bytes: x, y as i32)
   * @returns Vec2i instance
   */
  @inline
  static fromAddress(address: usize): Vec2i {
    return changetype<Vec2i>(address);
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
 * Generate a pseudo-random unsigned 32-bit integer using PCG (RXS-M-XS, 32-bit state)
 * This variant keeps a 32-bit state so it works with the current RNG_SEED layout.
 * Properly separates state advancement from output permutation.
 * @returns Random u32 value in full range [0, 0xffffffff]
 */
// @ts-expect-error AssemblyScript decorator
@inline
export function random(): u32 {
  // Load current state
  let state = load<u32>(RNG_SEED);
  
  // PCG: Advance state (LCG step)
  state = (state * 747796405 + 2891336453) as u32;
  
  // Store NEW STATE (not output)
  store<u32>(RNG_SEED, state);
  
  // Generate output by permuting state (RXS-M-XS output function)
  let word = ((state >> ((state >> 28) + 4)) ^ state) * 277803737;
  word = (word >> 22) ^ word;
  
  // Return full 32-bit output (required for Lemire's algorithm in randomRange)
  return word;
}

/**
 * Generate a pseudo-random integer in range [0, max) using Lemire's debiased method
 * This algorithm is faster and simpler than rejection with modulo, using 64-bit
 * multiplication to achieve unbiased results with minimal rejection.
 * 
 * Based on Daniel Lemire's "Fast Random Integer Generation in an Interval"
 * https://arxiv.org/abs/1805.10941
 * 
 * @param max Exclusive upper bound (must be > 0)
 * @returns Random integer in [0, max)
 * 
 * @example
 * ```ts
 * const diceRoll = randomRange(6);     // 0-5
 * const enemyIndex = randomRange(10);  // 0-9
 * ```
 */
export function randomRange(max: i32): i32 {
  if (max <= 0) return 0;
  
  // Generate random value and compute 64-bit product: random() * max
  let x = random();  // Already u32, no cast needed
  let m = (x as u64) * (max as u64);
  let l = m as u32;  // Low 32 bits
  
  // Check if we need rejection sampling to eliminate bias
  if (l < (max as u32)) {
    // Compute threshold: t = (2^32 mod max) = (-max mod max)
    let t = (-(max as u32)) % (max as u32);
    
    // Reject and resample if l < t (rare: happens only when biased)
    while (l < t) {
      x = random();  // Already u32, no cast needed
      m = (x as u64) * (max as u64);
      l = m as u32;
    }
  }
  
  // Return high 32 bits as result (equivalent to: (x * max) / 2^32)
  return (m >> 32) as i32;
}

/**
 * Clamp a value between a minimum and maximum
 * @param value The value to clamp
 * @param min Minimum bound (inclusive)
 * @param max Maximum bound (inclusive)
 * @returns Clamped value in [min, max]
 * 
 * @example
 * ```ts
 * const x = clamp(playerX, 0, SCREEN_WIDTH);  // Keep player in bounds
 * const health = clamp(damage, 0, 100);       // Cap health at 0-100
 * ```
 */
export function clamp(value: i32, min: i32, max: i32): i32 {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Draw a styled message box with title and optional subtitle
 * @param posX Box X position
 * @param posY Box Y position
 * @param sizeX Box width
 * @param sizeY Box height
 * @param title Main message text
 * @param titleOffsetX Title X offset from box position
 * @param titleOffsetY Title Y offset from box position
 * @param subtitle Secondary message text (e.g., "PRESS START")
 * @param subtitleOffsetX Subtitle X offset from box position
 * @param subtitleOffsetY Subtitle Y offset from box position
 * @param bgColor Background fill color (ABGR format)
 * @param fgColor Border and text color (ABGR format)
 *
 * @example
 * ```ts
 * // Draw a centered game over message:
 * drawMessageBox(
 *   60, 90, 200, 60,
 *   "GAME OVER", 70, 15,
 *   "PRESS START", 50, 35,
 *   c(0x000000), c(0xff0000)
 * );
 * ```
 */
export function drawMessageBox(
  posX: i32,
  posY: i32,
  sizeX: i32,
  sizeY: i32,
  title: string,
  titleOffsetX: i32,
  titleOffsetY: i32,
  subtitle: string,
  subtitleOffsetX: i32,
  subtitleOffsetY: i32,
  bgColor: u32,
  fgColor: u32,
): void {
  fillRect(posX, posY, sizeX, sizeY, bgColor);
  drawRect(posX, posY, sizeX, sizeY, fgColor);
  drawString(posX + titleOffsetX, posY + titleOffsetY, title, fgColor);
  if (subtitle.length > 0) {
    drawString(
      posX + subtitleOffsetX,
      posY + subtitleOffsetY,
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
    75, 95,
    170, 50,
    message,
    50, 12,
    "PRESS START",
    40, 27,
    bgColor,
    fgColor,
  );
}
