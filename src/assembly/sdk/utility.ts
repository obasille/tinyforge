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

/**
 * Zero-allocation fixed-size array backed by pre-allocated memory
 * Uses @unmanaged pattern - no heap allocation, just address reinterpretation
 * 
 * Memory must be pre-allocated in your game's RAM layout before use.
 * The class stores no data itself - methods access memory via the base address.
 * 
 * Supports bracket notation: arr[index] = value and val = arr[index]
 * 
 * @example
 * ```ts
 * // Calculate memory requirements:
 * const size = FixedArray.sizeInMemory<u8>(100);  // 100 bytes for 100 u8 elements
 * 
 * // In your game's RAM layout:
 * @unmanaged
 * class Vars {
 *   playerX: i32;     // 0
 *   playerY: i32;     // 4
 *   // Reserve 100 bytes starting at offset 8 for grid
 * }
 * 
 * const vars = changetype<Vars>(RAM_START);
 * const grid = FixedArray.fromAddress<u8>(RAM_START + 8);
 * 
 * // Usage with methods:
 * grid.set(10, 42);        // Set element
 * const val = grid.get(10); // Get element
 * grid.fill(0, 100);       // Clear all elements
 * 
 * // Usage with bracket notation:
 * grid[10] = 42;           // Set element
 * const val = grid[10];    // Get element
 * ```
 */
@unmanaged
export class FixedArray<T> {
  // No fields - this class is just a type marker for the memory region
  // Methods access 'this' as the base address

  /**
   * Create a FixedArray instance from a raw memory address
   * The caller must ensure the memory at this address is properly allocated
   * and sized for the intended use
   * @param address Memory address of the pre-allocated array
   * @returns FixedArray instance
   */
  @inline
  static fromAddress<T>(address: usize): FixedArray<T> {
    return changetype<FixedArray<T>>(address);
  }
  
  /**
   * Calculate memory size required for array with given capacity
   * @param capacity Number of elements
   * @returns Size in bytes
   */
  @inline
  static sizeInMemory<T>(capacity: i32): usize {
    return capacity * sizeof<T>();
  }
  
  /**
   * Get element at index (zero overhead with @inline)
   * @param index Array index
   * @returns Element value at index
   */
  @inline
  get(index: i32): T {
    const baseAddr = changetype<usize>(this);
    return load<T>(baseAddr + index * sizeof<T>());
  }
  
  /**
   * Set element at index (zero overhead with @inline)
   * @param index Array index
   * @param value Value to store
   */
  @inline
  set(index: i32, value: T): void {
    const baseAddr = changetype<usize>(this);
    store<T>(baseAddr + index * sizeof<T>(), value);
  }
  
  /**
   * Index operator for reading: arr[index]
   */
  @inline
  @operator("[]")
  private __get(index: i32): T {
    return this.get(index);
  }
  
  /**
   * Index operator for writing: arr[index] = value
   */
  @inline
  @operator("[]=")
  private __set(index: i32, value: T): void {
    this.set(index, value);
  }
  
  /**
   * Fill array with a value
   * @param value Value to fill with
   * @param count Number of elements to fill
   */
  @inline
  fill(value: T, count: i32): void {
    for (let i = 0; i < count; i++) {
      this.set(i, value);
    }
  }
}

/**
 * Zero-allocation fixed-size array with dynamic length tracking
 * Uses @unmanaged pattern - no heap allocation, just address reinterpretation
 * 
 * Memory layout (at base address):
 *   [0 to sizeof<U>-1]:           U count (current length)
 *   [sizeof<U> to 2*sizeof<U>-1]: U capacity (maximum length)
 *   [2*sizeof<U>+]:               array data (elements of type T)
 * 
 * Supports bracket notation: arr[index] = value and val = arr[index]
 * 
 * @example
 * ```ts
 * // Calculate memory requirements:
 * const size1 = FixedArrayWithCount.sizeInMemory<u16>(50);      // 4 + 100 = 104 bytes (u16 counters)
 * const size2 = FixedArrayWithCount.sizeInMemory<u16, u8>(20);  // 2 + 40 = 42 bytes (u8 counters)
 * 
 * // Using fromAddress helper:
 * const items = FixedArrayWithCount.fromAddress<u16>(RAM_START + 100);
 * items.capacity = 50;
 * items.clear();
 * 
 * const scores = FixedArrayWithCount.fromAddress<i32>(RAM_START + 200);
 * scores.capacity = 10;
 * 
 * // Small arrays with u8 counters (2 bytes metadata, max 255 elements):
 * const small = FixedArrayWithCount.fromAddress<u16, u8>(RAM_START + 300);
 * small.capacity = 20;
 * 
 * // Large arrays with u16 counters (4 bytes metadata, max 65535 elements):
 * const large = FixedArrayWithCount.fromAddress<u32, u16>(RAM_START + 400);
 * large.capacity = 1000;
 * 
 * // Usage with methods:
 * items.push(42);                // Add element
 * const val = items.get(0);      // Get element (42)
 * const len = items.length;      // Get current length (1)
 * const found = items.includes(42); // Search (true)
 * items.clear();                 // Reset length to 0
 * 
 * // Usage with bracket notation:
 * items[0] = 99;                 // Set element
 * const x = items[0];            // Get element (99)
 * ```
 */
@unmanaged
export class FixedArrayWithCount<T, U = u16> {
  // No fields - this class is just a type marker for the memory region
  
  /**
   * Create a FixedArrayWithCount instance from a raw memory address
   * The caller must ensure the memory at this address is properly allocated
   * and sized for the intended use (2*sizeof<U> for metadata + capacity*sizeof<T> for data)
   * @param address Memory address of the pre-allocated array
   * @returns FixedArrayWithCount instance
   */
  @inline
  static fromAddress<T, U = u16>(address: usize): FixedArrayWithCount<T, U> {
    return changetype<FixedArrayWithCount<T, U>>(address);
  }
  
  /**
   * Calculate memory size required for array with given capacity
   * Includes metadata (length + capacity) and data storage
   * @param capacity Maximum number of elements
   * @returns Size in bytes
   */
  @inline
  static sizeInMemory<T, U = u16>(capacity: i32): usize {
    return sizeof<U>() * 2 + capacity * sizeof<T>();
  }
  
  /**
   * Get current length (number of elements in use)
   */
  @inline
  get length(): U {
    const baseAddr = changetype<usize>(this);
    return load<U>(baseAddr);
  }
  
  /**
   * Set current length (number of elements in use)
   */
  // @ts-expect-error AssemblyScript decorator
  @inline
  set length(value: U) {
    const baseAddr = changetype<usize>(this);
    store<U>(baseAddr, value);
  }
  
  /**
   * Get maximum capacity
   */
  @inline
  get capacity(): U {
    const baseAddr = changetype<usize>(this);
    return load<U>(baseAddr + sizeof<U>());
  }
  
  /**
   * Set maximum capacity (should be set once during initialization)
   */
  // @ts-expect-error AssemblyScript decorator
  @inline
  set capacity(value: U) {
    const baseAddr = changetype<usize>(this);
    store<U>(baseAddr + sizeof<U>(), value);
  }
  
  /**
   * Get element at index (zero overhead with @inline)
   * @param index Array index (should be < length)
   * @returns Element value at index
   */
  @inline
  get(index: i32): T {
    const baseAddr = changetype<usize>(this);
    return load<T>(baseAddr + (sizeof<U>() * 2) + index * sizeof<T>());
  }
  
  /**
   * Set element at index (zero overhead with @inline)
   * @param index Array index (should be < length)
   * @param value Value to store
   */
  @inline
  set(index: i32, value: T): void {
    const baseAddr = changetype<usize>(this);
    store<T>(baseAddr + (sizeof<U>() * 2) + index * sizeof<T>(), value);
  }
  
  /**
   * Index operator for reading: arr[index]
   */
  @inline
  @operator("[]")
  private __get(index: i32): T {
    return this.get(index);
  }
  
  /**
   * Index operator for writing: arr[index] = value
   */
  @inline
  @operator("[]=")
  private __set(index: i32, value: T): void {
    this.set(index, value);
  }
  
  /**
   * Append element to end of array if not at capacity
   * @param value Value to append
   */
  @inline
  push(value: T): void {
    const len = this.length;
    const cap = this.capacity;
    if ((len as i32) < (cap as i32)) {
      this.set(len as i32, value);
      this.length = (len as i32 + 1) as U;
    }
  }
  
  /**
   * Check if array contains a value
   * @param value Value to search for
   * @returns true if found, false otherwise
   */
  @inline
  includes(value: T): bool {
    const len = this.length as i32;
    for (let i = 0; i < len; i++) {
      if (this.get(i) == value) return true;
    }
    return false;
  }
  
  /**
   * Clear array (sets length to 0, doesn't modify data)
   */
  @inline
  clear(): void {
    this.length = 0 as U;
  }
  
  /**
   * Remove element at index by shifting remaining elements
   * @param index Index of element to remove
   */
  @inline
  removeAt(index: i32): void {
    const len = this.length as i32;
    if (index >= 0 && index < len) {
      for (let i = index; i < len - 1; i++) {
        this.set(i, this.get(i + 1));
      }
      this.length = (len - 1) as U;
    }
  }
  
  /**
   * Find index of first occurrence of value
   * @param value Value to search for
   * @returns Index if found, -1 otherwise
   */
  @inline
  indexOf(value: T): i32 {
    const len = this.length as i32;
    for (let i = 0; i < len; i++) {
      if (this.get(i) == value) return i;
    }
    return -1;
  }
}
