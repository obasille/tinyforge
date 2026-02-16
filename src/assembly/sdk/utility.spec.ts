// Unit tests for utility.ts functions
// Run with: npm run test

import { random, randomRange } from "./utility";
import { RNG_SEED } from "./memory";
import { log } from "./logging";

// External test tracking functions (provided by test runner)
// @ts-expect-error AssemblyScript decorator
@external("env", "test.start")
declare function testStart(name: string): void;

// @ts-expect-error AssemblyScript decorator
@external("env", "test.fail")
declare function testFail(message: string): void;

// @ts-expect-error AssemblyScript decorator
@external("env", "test.end")
declare function testEnd(): void;

// Simple assertion helper
function assert(condition: bool, message: string): void {
  if (!condition) {
    testFail(message);
  }
}

/**
 * Test randomRange() returns values in correct range
 */
function testRandomRangeBasic(): void {
  testStart("randomRange basic bounds");

  // Reset RNG seed to known state
  store<u32>(RNG_SEED, 12345);

  // Test various max values
  for (let i = 0; i < 100; i++) {
    const val = randomRange(10);
    assert(val >= 0 && val < 10, "randomRange(10) out of bounds");
  }

  for (let i = 0; i < 100; i++) {
    const val = randomRange(6);
    assert(val >= 0 && val < 6, "randomRange(6) out of bounds");
  }

  for (let i = 0; i < 100; i++) {
    const val = randomRange(100);
    assert(val >= 0 && val < 100, "randomRange(100) out of bounds");
  }

  testEnd();
}

/**
 * Test randomRange() with edge cases
 */
function testRandomRangeEdgeCases(): void {
  testStart("randomRange edge cases");

  // Test max = 0 (should return 0)
  assert(randomRange(0) == 0, "randomRange(0) should return 0");

  // Test negative max (should return 0)
  assert(randomRange(-5) == 0, "randomRange(-5) should return 0");

  // Test max = 1 (should always return 0)
  for (let i = 0; i < 10; i++) {
    assert(randomRange(1) == 0, "randomRange(1) should always return 0");
  }

  testEnd();
}

/**
 * Test randomRange() distribution (basic check)
 */
function testRandomRangeDistribution(): void {
  testStart("randomRange distribution");

  // Reset RNG seed
  store<u32>(RNG_SEED, 54321);

  const buckets = 10;
  const samples = 1000;

  // Count distribution (simplified - just check values are in range)
  let minVal = 999999;
  let maxVal = -1;

  for (let i = 0; i < samples; i++) {
    const val = randomRange(buckets);
    if (val < minVal) minVal = val;
    if (val > maxVal) maxVal = val;
    assert(val >= 0 && val < buckets, "randomRange distribution out of bounds");
  }

  // Verify we got values across the range (allow some slack for small samples)
  if (minVal > 1) {
    testFail("Distribution should start near 0");
  }
  if (maxVal < buckets - 2) {
    testFail("Distribution should reach near max");
  }

  testEnd();
}

/**
 * Test randomRange() with large max values
 */
function testRandomRangeLarge(): void {
  testStart("randomRange large values");

  // Test with large max values
  for (let i = 0; i < 100; i++) {
    const val = randomRange(10000);
    assert(val >= 0 && val < 10000, "randomRange(10000) out of bounds");
  }

  for (let i = 0; i < 100; i++) {
    const val = randomRange(1000000);
    assert(val >= 0 && val < 1000000, "randomRange(1000000) out of bounds");
  }

  testEnd();
}

/**
 * Test random() basic functionality
 */
function testRandomBasic(): void {
  testStart("random() basic");

  // Reset RNG seed
  store<u32>(RNG_SEED, 99999);

  // Generate random numbers and verify they're valid u32 values
  // Since random() returns u32, all values [0, 0xffffffff] are valid
  let hasLowValues = false;
  let hasHighValues = false;
  
  for (let i = 0; i < 100; i++) {
    const val = random();
    // u32 is always >= 0 by definition
    // Check we're getting values across the full range
    if (val < 0x40000000) hasLowValues = true;
    if (val > 0xc0000000) hasHighValues = true;
  }

  // With 100 samples, we should see values in both low and high ranges
  assert(hasLowValues, "random() should produce some low values");
  assert(hasHighValues, "random() should produce some high values");

  testEnd();
}

/**
 * Test random() state advancement
 */
function testRandomStateAdvancement(): void {
  testStart("random() state advancement");

  // Reset to known seed
  store<u32>(RNG_SEED, 42);

  // Generate values and ensure they're not all the same
  const first = random();
  const second = random();
  const third = random();

  assert(
    first != second || second != third,
    "random() appears to not advance state",
  );

  testEnd();
}

/**
 * Run all tests
 */
export function runTests(): void {
  log("=== Running utility.ts Tests ===");
  log("");

  testRandomBasic();
  testRandomStateAdvancement();
  testRandomRangeBasic();
  testRandomRangeEdgeCases();
  testRandomRangeDistribution();
  testRandomRangeLarge();

  log("");
  log("=== Tests Complete ===");
}
