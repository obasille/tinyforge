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
    store<U>(baseAddr, value); // Math.max(0, Mathf.min(value, this.capacity)));
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
    return load<T>(baseAddr + sizeof<U>() * 2 + index * sizeof<T>());
  }

  /**
   * Set element at index (zero overhead with @inline)
   * @param index Array index (should be < length)
   * @param value Value to store
   */
  @inline
  set(index: i32, value: T): void {
    const baseAddr = changetype<usize>(this);
    store<T>(baseAddr + sizeof<U>() * 2 + index * sizeof<T>(), value);
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
      this.length = ((len as i32) + 1) as U;
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

/**
 * Zero-allocation fixed-size array for @unmanaged objects with explicit element size
 * Uses @unmanaged pattern - no heap allocation, just address reinterpretation
 *
 * Memory layout (at base address):
 *   [0 to 3]:  u32 elementSize (size of each element in bytes)
 *   [4+]:      array data (elements of type T)
 *
 * This class solves the problem where sizeof<T>() returns 4 (pointer size) for @unmanaged classes
 * instead of the actual class size. The element size is stored in memory and used for indexing.
 *
 * Supports bracket notation: arr[index] = value and val = arr[index]
 *
 * @example
 * ```ts
 * @unmanaged
 * class Enemy {
 *   x: i32;      // offset 0
 *   y: i32;      // offset 4
 *   health: i32; // offset 8
 * }
 *
 * // Calculate element size using offsetof on the last field
 * const enemySize = offsetof<Enemy>("health") + sizeof<i32>();  // 12 bytes
 *
 * // Optional: align to 4-byte boundary
 * const enemySizeAligned = (enemySize + 3) & ~3;  // 12 bytes (already aligned)
 *
 * // Calculate memory requirements:
 * const size = FixedArrayOfObj.sizeInMemory(50, enemySizeAligned);  // 4 + 600 = 604 bytes
 *
 * // In your game's RAM layout:
 * enum Var {
 *   ENEMIES_START = 100,  // Reserve 604 bytes for 50 enemies
 * }
 *
 * // Create array and initialize element size:
 * const enemies = FixedArrayOfObj.fromAddress<Enemy>(RAM_START + Var.ENEMIES_START);
 * enemies.elementSize = enemySizeAligned;
 *
 * // Or use the convenience method with automatic alignment:
 * const enemies = FixedArrayOfObj.fromAddressWithSize<Enemy>(RAM_START + Var.ENEMIES_START, enemySize, true);
 *
 * // Access elements:
 * const enemy0 = enemies.get(0);
 * enemy0.x = 10;
 * enemy0.y = 20;
 *
 * // Bracket notation:
 * enemies[1].health = 100;
 * ```
 */
@unmanaged
export class FixedArrayOfObj<T> {
  // No fields - this class is just a type marker for the memory region

  /**
   * Create a FixedArrayOfObj instance and initialize element size
   * @param address Memory address of the pre-allocated array
   * @param elementSize Optional, size of each element in bytes (otherwise must be set manually in memory)
   * @param align Optional, if true, aligns elementSize to 4-byte boundary
   * @returns FixedArrayOfObj instance
   */
  @inline
  static fromAddress<T>(
    address: usize,
    elementSize: u32 = 0,
    align: bool = false,
  ): FixedArrayOfObj<T> {
    const arr = changetype<FixedArrayOfObj<T>>(address);
    if (elementSize) {
      const size = align ? (elementSize + 3) & ~3 : elementSize;
      store<u32>(address, size);
    }
    return arr;
  }

  /**
   * Calculate memory size required for array with given capacity
   * @param capacity Number of elements
   * @param elementSize Size of each element in bytes
   * @returns Size in bytes (4 bytes for metadata + capacity * elementSize)
   */
  @inline
  static sizeInMemory(capacity: i32, elementSize: u32): usize {
    return 4 + capacity * elementSize;
  }

  /**
   * Calculate memory size with automatic 4-byte alignment
   * @param capacity Number of elements
   * @param elementSize Size of each element in bytes (will be aligned)
   * @returns Size in bytes
   */
  @inline
  static sizeInMemoryAligned(capacity: i32, elementSize: u32): usize {
    const alignedSize = (elementSize + 3) & ~3;
    return 4 + capacity * alignedSize;
  }

  /**
   * Get element size stored in first 4 bytes
   */
  @inline
  get elementSize(): u32 {
    const baseAddr = changetype<usize>(this);
    return load<u32>(baseAddr);
  }

  /**
   * Set element size (should be set once during initialization)
   */
  // @ts-expect-error AssemblyScript decorator
  @inline
  set elementSize(value: u32) {
    const baseAddr = changetype<usize>(this);
    store<u32>(baseAddr, value);
  }

  /**
   * Get element at index (zero overhead with @inline)
   * @param index Array index
   * @returns Element reference at index
   */
  @inline
  get(index: i32): T {
    const baseAddr = changetype<usize>(this);
    const elemSize = load<u32>(baseAddr);
    return changetype<T>(baseAddr + 4 + index * elemSize);
  }

  /**
   * Set element at index by copying object data into array memory
   * @param index Array index
   * @param value Object to copy into the array
   */
  set(index: i32, value: T): void {
    const baseAddr = changetype<usize>(this);
    const elemSize = load<u32>(baseAddr);
    const destAddr = baseAddr + 4 + index * elemSize;
    const srcAddr = changetype<usize>(value);
    memory.copy(destAddr, srcAddr, elemSize);
  }

  /**
   * Index operator for reading: arr[index]
   */
  @inline
  @operator("[]")
  private __get(index: i32): T {
    return this.get(index);
  }
}
