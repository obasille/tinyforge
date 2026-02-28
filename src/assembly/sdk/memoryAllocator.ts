import {
  ArrayObjView,
  ArrayView,
  UncheckedArrayObjView,
  UncheckedArrayView,
} from "./arrayViews";
import { logi } from "./logging";

/**
 * Memory allocator with automatic offset tracking
 * Uses @unmanaged pattern - no heap allocation, just address reinterpretation
 *
 * Memory layout (at base address):
 *   [0 to sizeof<usize>-1]: usize offset (current allocation pointer)
 *
 * @example
 * ```ts
 * // Reserve space for allocator state (1 usize = 4 bytes on 32-bit)
 * enum Var {
 *   ALLOCATOR = 0,  // 4 bytes for offset tracking
 *   DATA_START = 4, // Start of actual data
 * }
 *
 * // Create allocator and initialize with starting offset
 * const mem = MemoryAllocator.fromAddress(RAM_START + Var.ALLOCATOR, RAM_START + Var.DATA_START);
 *
 * // Allocate arrays and structs
 * const stars = mem.allocArray<Star>(STAR_SIZE, MAX_STARS as u16);
 * const enemies = mem.allocArray<Enemy>(ENEMY_SIZE, MAX_ENEMIES as u16);
 * const gameState = mem.allocStruct<GameState>(GAME_STATE_SIZE);
 * ```
 */
@unmanaged
export class MemoryAllocator {
  // No fields - this class is just a type marker for the memory region
  // The offset is stored at the base address

  /**
   * Create a MemoryAllocator instance from a raw memory address
   * @param address Memory address where allocator state is stored (needs sizeof<usize> bytes)
   * @param startOffset Optional, initial offset value (where allocations begin)
   * @returns MemoryAllocator instance
   */
  @inline
  static fromAddress(address: usize): MemoryAllocator {
    const instance = changetype<MemoryAllocator>(address);
    // Initialize offset to start after the offset field
    store<usize>(address, address + sizeof<usize>());
    return instance;
  }

  /**
   * Get current offset (allocation pointer)
   * Shows where the next allocation will occur in memory
   * @returns Current offset value (memory address)
   */
  @inline
  get offset(): usize {
    const baseAddr = changetype<usize>(this);
    return load<usize>(baseAddr);
  }

  /**
   * Allocate an @unmanaged struct and advance offset
   * Returns a pointer to the allocated memory reinterpreted as type T
   *
   * @param size Size of the struct in bytes (use offsetof<T>("lastField") + sizeof<fieldType>())
   * @returns Pointer to allocated struct
   * @example
   * ```ts
   * @unmanaged class GameState { phase: u8; score: i32; }
   * const size = offsetof<GameState>("score") + sizeof<i32>();
   * const gameState = mem.allocStruct<GameState>(size);
   * gameState.phase = 0;
   * gameState.score = 100;
   * ```
   */
  @inline
  allocStruct<T>(size: u32): T {
    const ptr = changetype<T>(this.offset);
    this.addOffset(size);
    return ptr;
  }

  /**
   * Allocate an UncheckedArrayView for primitive number types and advance offset
   * Returns a fixed-size array with NO length tracking or bounds checking
   *
   * WARNING: No bounds checking - accessing out of bounds will corrupt memory!
   * WARNING: Only for primitive number types (i32, u8, f32, etc.) - NOT for @unmanaged objects!
   *
   * @param capacity Number of elements to allocate
   * @returns UncheckedArrayView instance
   * @example
   * ```ts
   * const directions = mem.allocUncheckedArray<i32>(4);  // 4 i32 values, no length tracking
   * directions.set(0, 1);
   * directions.set(1, -1);
   * ```
   */
  @inline
  allocUncheckedArray<T>(capacity: usize): UncheckedArrayView<T> {
    const size = UncheckedArrayView.getMemorySizeForCapacity<T>(capacity);
    const arr = UncheckedArrayView.fromAddress<T>(this.offset);
    this.addOffset(size);
    return arr;
  }

  /**
   * Allocate an UncheckedArrayObjView for @unmanaged objects and advance offset
   * Returns a fixed-size array with NO length tracking or bounds checking
   *
   * WARNING: No bounds checking - accessing out of bounds will corrupt memory!
   *
   * @param elementSize Size of each @unmanaged object in bytes (use offsetof<T>("lastField") + sizeof<fieldType>())
   * @param capacity Number of elements to allocate
   * @returns UncheckedArrayObjView instance
   * @example
   * ```ts
   * @unmanaged class Enemy { x: i32; y: i32; }
   * const enemySize = offsetof<Enemy>("y") + sizeof<i32>();
   * const enemies = mem.allocUncheckedObjArray<Enemy>(enemySize, 10);  // 10 enemies, no length tracking
   * ```
   */
  @inline
  allocUncheckedObjArray<T>(
    elementSize: usize,
    capacity: usize,
  ): UncheckedArrayObjView<T> {
    const size = UncheckedArrayObjView.getMemorySizeForCapacity(
      elementSize,
      capacity,
    );
    const arr = UncheckedArrayObjView.fromAddress<T>(
      this.offset,
      elementSize as u32,
    );
    this.addOffset(size);
    return arr;
  }

  /**
   * Allocate an ArrayView for primitive number types and advance offset
   * Returns a dynamic array with length/capacity tracking and bounds checking
   *
   * WARNING: Only for primitive number types (i32, u8, f32, etc.) - NOT for @unmanaged objects!
   * For objects, use allocObjArray() instead.
   *
   * @param capacity Maximum number of elements
   * @returns ArrayView instance with length initialized to 0
   * @example
   * ```ts
   * const scores = mem.allocArray<u16>(100 as u16);  // Max 100 u16 values with length tracking
   * scores.push(42);
   * scores.push(99);
   * const len = scores.length;  // 2
   * ```
   */
  @inline
  allocArray<T, U = u16>(capacity: U): ArrayView<T, U> {
    const arr = ArrayView.fromAddress<T, U>(this.offset, capacity);
    this.addOffset(arr.memorySize);
    return arr;
  }

  /**
   * Allocate an ArrayObjView for @unmanaged objects and advance offset
   * Returns a dynamic array with length/capacity tracking and bounds checking
   * Element size is automatically 4-byte aligned for optimal memory access
   *
   * @param elementSize Size of each @unmanaged object in bytes (use offsetof<T>("lastField") + sizeof<fieldType>())
   * @param capacity Maximum number of elements
   * @returns ArrayObjView instance with length initialized to 0
   * @example
   * ```ts
   * @unmanaged class Star { x: i32; y: i32; degree: i32; }
   * const starSize = offsetof<Star>("degree") + sizeof<i32>();
   * const stars = mem.allocObjArray<Star>(starSize, 50 as u16);  // Max 50 stars with length tracking
   * const star = stars.get(0);
   * star.x = 10;
   * ```
   */
  @inline
  allocObjArray<T, U = u16>(
    elementSize: usize,
    capacity: U,
  ): ArrayObjView<T, U> {
    const arr = ArrayObjView.fromAddress<T, U>(
      this.offset,
      this.alignMemSize(elementSize) as u32,
      capacity,
    );
    this.addOffset(arr.memorySize);
    return arr;
  }

  /**
   * Align size to 4-byte boundary for optimal memory access
   * @param size Unaligned size in bytes
   * @returns Aligned size (rounded up to nearest multiple of 4)
   */
  @inline
  private alignMemSize(size: usize): usize {
    return (size + 3) & ~3; // 4-byte align
  }

  /**
   * Advance the allocation offset by the given value (with alignment)
   * Updates the offset stored at the base address
   * @param value Number of bytes to advance (will be aligned to 4-byte boundary)
   */
  @inline
  private addOffset(value: usize): void {
    const baseAddr = changetype<usize>(this);
    const addr = this.alignMemSize(load<usize>(baseAddr) + value);
    store<usize>(baseAddr, addr);
  }
}
