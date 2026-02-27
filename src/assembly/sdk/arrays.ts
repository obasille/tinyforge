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
   * Get element size stored in first 4 bytes
   */
  @inline
  get elementSize(): u32 {
    return sizeof<T>();
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
   * @param elementSize Optional, size of each element in bytes (not used for FixedArrayWithCount but included for consistency with FixedArrayOfObjWithCount)
   * @param capacity Optional, maximum number of elements (sets capacity in memory)
   * @param align Optional, if true, aligns elementSize to 4-byte boundary (not used for FixedArrayWithCount but included for consistency)
   * @returns FixedArrayWithCount instance
   */
  @inline
  static fromAddress<T, U = u16>(
    address: usize,
    elementSize: u32 = 0,
    capacity: U = 0 as U,
    align: bool = false,
  ): FixedArrayWithCount<T, U> {
    const instance = changetype<FixedArrayWithCount<T, U>>(address);
    if (elementSize) {
      const size = align ? (elementSize + 3) & ~3 : elementSize;
      store<u32>(address, size);
    }
    if (capacity) {
      store<U>(address + 4, 0 as U);
      store<U>(address + 4 + sizeof<U>(), capacity);
    }
    return instance;
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
   * Get element size
   */
  @inline
  get elementSize(): u32 {
    return sizeof<T>();
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
    const checkedSize =
      value < 0 ? 0 : value > this.capacity ? this.capacity : value;
    store<U>(baseAddr, checkedSize as U);
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
   * Return the base address of the array data (after metadata)
   * @returns Memory address where array elements start
   */
  @inline
  get dataStart(): usize {
    return changetype<usize>(this) + sizeof<U>() * 2;
  }

  /**
   * Get memory size with automatic 4-byte alignment
   * @returns Size in bytes
   */
  @inline
  get alignedMemorySize(): usize {
    const elemSize = this.elementSize;
    return (sizeof<U>() * 2 + elemSize * (this.capacity as i32) + 3) & ~3;
  }

  /**
   * Get element at index (zero overhead with @inline)
   * @param index Array index (should be < length)
   * @returns Element value at index
   */
  @inline
  get(index: i32): T {
    this.checkIndex(index);
    const baseAddr = changetype<usize>(this);
    return load<T>(this.dataStart + index * sizeof<T>());
  }

  /**
   * Set element at index (zero overhead with @inline)
   * @param index Array index (should be < length)
   * @param value Value to store
   */
  @inline
  set(index: i32, value: T): void {
    this.checkIndex(index);
    const baseAddr = changetype<usize>(this);
    store<T>(this.dataStart + index * sizeof<T>(), value);
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
   * @return true if element was added, false if at capacity
   */
  @inline
  push(value: T): boolean {
    const len = this.length;
    const cap = this.capacity;
    if ((len as i32) >= (cap as i32)) {
      return false;
    }
    this.set(len as i32, value);
    this.length = ((len as i32) + 1) as U;
    return true;
  }

  /**
   * Grow the array by one element and return pointer to it
   * Increases length by 1 and returns reference to the new last element
   * @returns Reference to the newly allocated element at the end
   * @throws Error if array is at capacity
   */
  @inline
  grow(): T {
    const len = this.length;
    const cap = this.capacity;
    if (len >= cap) {
      throw new Error("FixedArrayOfObjWithCount: Cannot grow, at capacity");
    }
    this.length = (len + 1) as U;
    return this.get(len);
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

  private checkIndex(index: i32): void {
    if (index < 0) {
      throw new Error("FixedArrayWithCount: Index cannot be negative");
    }
    if (index >= (this.length as i32)) {
      throw new Error("FixedArrayWithCount: Index exceeds length");
    }
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
   * Get element size stored in first 4 bytes
   */
  @inline
  get elementSize(): u32 {
    const baseAddr = changetype<usize>(this);
    return load<u32>(baseAddr);
  }

  /**
   * Return the base address of the array data (after metadata)
   * @returns Memory address where array elements start
   */
  @inline
  get dataStart(): usize {
    return changetype<usize>(this) + 4;
  }

  /**
   * Get element at index (zero overhead with @inline)
   * @param index Array index
   * @returns Element reference at index
   */
  @inline
  get(index: i32): T {
    return changetype<T>(this.dataStart + index * this.elementSize);
  }

  /**
   * Set element at index by copying object data into array memory
   * @param index Array index
   * @param value Object to copy into the array
   */
  set(index: i32, value: T): void {
    const elemSize = this.elementSize;
    const destAddr = this.dataStart + index * elemSize;
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

/**
 * Zero-allocation fixed-size array for @unmanaged objects with length tracking
 * Combines FixedArrayOfObj (element size metadata) with FixedArrayWithCount (length/capacity tracking)
 * Uses @unmanaged pattern - no heap allocation, just address reinterpretation
 *
 * Memory layout (at base address):
 *   [0 to 3]:                      u32 elementSize (size of each element in bytes)
 *   [4 to 4+sizeof<U>-1]:          U length (current count)
 *   [4+sizeof<U> to 4+2*sizeof<U>-1]: U capacity (maximum count)
 *   [4+2*sizeof<U>+]:              array data (elements of type T)
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
 * // Calculate memory requirements:
 * const size = FixedArrayOfObjWithCount.sizeInMemory(50, enemySize);  // 4 + 4 + 600 = 608 bytes (with u16 counters)
 *
 * // Create array and initialize:
 * const enemies = FixedArrayOfObjWithCount.fromAddress<Enemy>(RAM_START + 100, enemySize);
 * enemies.capacity = 50;
 * enemies.clear();
 *
 * // Or with alignment:
 * const enemies = FixedArrayOfObjWithCount.fromAddress<Enemy>(RAM_START + 100, enemySize, true);
 * enemies.capacity = 50;
 *
 * // Usage with methods:
 * const enemy = enemies.get(0);
 * enemy.x = 10;
 * enemy.health = 100;
 * enemies.push(enemy);              // Add element
 * const len = enemies.length;       // Get current length
 * enemies.clear();                  // Reset length to 0
 *
 * // Bracket notation:
 * enemies[0].x = 20;
 * const e = enemies[0];
 * ```
 */
@unmanaged
export class FixedArrayOfObjWithCount<T, U = u16> {
  // No fields - this class is just a type marker for the memory region

  /**
   * Create a FixedArrayOfObjWithCount instance and initialize element size
   * @param address Memory address of the pre-allocated array
   * @param elementSize Optional, size of each element in bytes (otherwise must be set manually in memory)
   * @param capacity Optional, maximum number of elements (sets capacity in memory)
   * @param align Optional, if true, aligns elementSize to 4-byte boundary
   * @returns FixedArrayOfObjWithCount instance
   */
  @inline
  static fromAddress<T, U = u16>(
    address: usize,
    elementSize: u32 = 0,
    capacity: U = 0 as U,
    align: bool = false,
  ): FixedArrayOfObjWithCount<T, U> {
    const instance = changetype<FixedArrayOfObjWithCount<T, U>>(address);
    if (elementSize) {
      const size = align ? (elementSize + 3) & ~3 : elementSize;
      store<u32>(address, size);
    }
    if (capacity) {
      store<U>(address + 4, 0 as U);
      store<U>(address + 4 + sizeof<U>(), capacity);
    }
    return instance;
  }

  /**
   * Calculate memory size required for array with given capacity
   * Includes metadata (elementSize + length + capacity) and data storage
   * @param capacity Number of elements
   * @param elementSize Size of each element in bytes
   * @returns Size in bytes (4 bytes for elementSize + 2*sizeof<U> for counters + capacity * elementSize)
   */
  @inline
  static sizeInMemory<U = u16>(capacity: i32, elementSize: u32): usize {
    return 4 + sizeof<U>() * 2 + capacity * elementSize;
  }

  /**
   * Get element size
   */
  @inline
  get elementSize(): u32 {
    const baseAddr = changetype<usize>(this);
    return load<u32>(baseAddr);
  }

  /**
   * Get current length (number of elements in use)
   */
  @inline
  get length(): U {
    const baseAddr = changetype<usize>(this);
    return load<U>(baseAddr + 4);
  }

  /**
   * Set current length (number of elements in use)
   */
  // @ts-expect-error AssemblyScript decorator
  @inline
  set length(value: U) {
    const baseAddr = changetype<usize>(this);
    const checkedSize =
      value < 0 ? 0 : value > this.capacity ? this.capacity : value;
    store<U>(baseAddr + 4, checkedSize as U);
  }

  /**
   * Get maximum capacity
   */
  @inline
  get capacity(): U {
    const baseAddr = changetype<usize>(this);
    return load<U>(baseAddr + 4 + sizeof<U>());
  }

  /**
   * Return the base address of the array data (after metadata)
   * @returns Memory address where array elements start
   */
  @inline
  get dataStart(): usize {
    return changetype<usize>(this) + 4 + sizeof<U>() * 2;
  }

  /**
   * Get memory size with automatic 4-byte alignment
   * @returns Size in bytes
   */
  @inline
  get alignedMemorySize(): usize {
    return (
      (4 + sizeof<U>() * 2 + this.elementSize * (this.capacity as i32) + 3) & ~3
    );
  }

  /**
   * Get element at index (zero overhead with @inline)
   * @param index Array index (should be < length)
   * @returns Element reference at index
   */
  @inline
  get(index: i32): T {
    this.checkIndex(index);
    return changetype<T>(this.dataStart + index * this.elementSize);
  }

  /**
   * Set element at index by copying object data into array memory
   * @param index Array index (should be < length)
   * @param value Object to copy into the array
   */
  set(index: i32, value: T): void {
    this.checkIndex(index);
    const baseAddr = changetype<usize>(this);
    const elemSize = load<u32>(baseAddr);
    const destAddr = this.dataStart + index * this.elementSize;
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

  /**
   * Index operator for writing: arr[index] = value
   * Note: This copies the object data into the array
   */
  @inline
  @operator("[]=")
  private __set(index: i32, value: T): void {
    this.set(index, value);
  }

  /**
   * Append element to end of array if not at capacity
   * @param value Object to append (will be copied)
   */
  push(value: T): void {
    const len = this.length;
    const cap = this.capacity;
    if ((len as i32) < (cap as i32)) {
      this.set(len as i32, value);
      this.length = ((len as i32) + 1) as U;
    }
  }

  /**
   * Grow the array by one element and return pointer to it
   * Increases length by 1 and returns reference to the new last element
   * @returns Reference to the newly allocated element at the end
   * @throws Error if array is at capacity
   */
  @inline
  grow(): T {
    const len = this.length;
    const cap = this.capacity;
    if (len >= cap) {
      throw new Error("FixedArrayOfObjWithCount: Cannot grow, at capacity");
    }
    this.length = (len + 1) as U;
    return this.get(len);
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
  removeAt(index: i32): void {
    const len = this.length as i32;
    if (index >= 0 && index < len) {
      const baseAddr = changetype<usize>(this);
      const elemSize = load<u32>(baseAddr);
      const dataStart = this.dataStart;

      // Shift elements left
      for (let i = index; i < len - 1; i++) {
        const destAddr = dataStart + i * this.elementSize;
        const srcAddr = dataStart + (i + 1) * this.elementSize;
        memory.copy(destAddr, srcAddr, elemSize);
      }
      this.length = (len - 1) as U;
    }
  }

  /**
   * Get index of first element matching a predicate
   * Note: For object comparison, you need to implement custom comparison logic
   * @param index Index to start searching from
   * @param predicate Function that returns true for matching elements
   * @returns Index if found, -1 otherwise
   */
  @inline
  findIndex(startIndex: i32, predicate: (element: T) => bool): i32 {
    const len = this.length as i32;
    for (let i = startIndex; i < len; i++) {
      if (predicate(this.get(i))) return i;
    }
    return -1;
  }

  private checkIndex(index: i32): void {
    if (index < 0) {
      throw new Error("FixedArrayOfObjWithCount: Index cannot be negative");
    }
    if (index >= (this.length as i32)) {
      throw new Error("FixedArrayOfObjWithCount: Index exceeds length");
    }
  }
}
