# TinyForge Testing Framework

This directory contains unit tests for the TinyForge SDK, written in AssemblyScript and executed in a Node.js environment.

## Running Tests

To run all utility tests:

```bash
npm run test        # Shorthand
```

## Test Structure

Tests are written in AssemblyScript and follow these conventions:

### File Naming

Test files should be named `*.spec.ts` and placed in `src/assembly/sdk/`.

### Test Pattern

```typescript
import { log, logi, warn } from "./logging";

// Test counters
let passCount: i32 = 0;
let failCount: i32 = 0;

// Assertion helper
function assert(condition: bool, testName: string): void {
  if (!condition) {
    warn(testName);
    failCount++;
  } else {
    passCount++;
  }
}

// Test function
function testSomething(): void {
  log("Test: something");

  const result = functionToTest();
  assert(result == expected, "Test description");

  log("PASS: something");
}

// Main test runner (must be exported)
export function runTests(): void {
  log("=== Running Tests ===");
  log("");

  testSomething();
  // ... more tests

  log("");
  log("=== Tests Complete ===");
  logi("Passed: {}", passCount as i64);
  logi("Failed: {}", failCount as i64);
}
```

### Key Points

1. **Zero Allocation**: Use SDK logging functions (log, logi, logf, warn, etc.) instead of string concatenation
2. **Type Casting**: Cast i32 counters to i64 when passing to logi/warni functions
3. **Naming**: Use descriptive test names for better error reporting
4. **Export**: The main runner function must be exported

## Available Assertion Helpers

```typescript
// Basic assertion
function assert(condition: bool, testName: string): void;

// Range check
function assertRange(value: i32, min: i32, max: i32, testName: string): void;
```

## Example: utility.spec.ts

The utility tests demonstrate testing of the random number generation functions:

- **testRandomBasic**: Verifies random() returns non-negative values
- **testRandomStateAdvancement**: Ensures RNG state advances correctly
- **testRandomRangeBasic**: Tests randomRange() bounds checking
- **testRandomRangeEdgeCases**: Tests edge cases (0, negative, 1)
- **testRandomRangeDistribution**: Basic distribution check
- **testRandomRangeLarge**: Tests with large max values

## Adding New Tests

1. Create `src/assembly/sdk/yourmodule.spec.ts`
2. Import the functions to test
3. Write test functions following the pattern above
4. Export a `runTests()` function
5. Create a test runner script in `scripts/test-yourmodule.js` (based on test-utility.js)
6. Add npm script to package.json:
   ```json
   "test:yourmodule": "node scripts/test-yourmodule.js"
   ```

## Test Runner Implementation

Test runners (`scripts/test-*.js`) provide:

- AssemblyScript compilation with proper flags (stub runtime, importMemory, memoryBase)
- WebAssembly memory instantiation (2MB, 32 pages)
- Console logging function imports (log, logi, logf, warn, warni, warnf, error, errori, errorf)
- UTF-16 string decoding (AssemblyScript strings are UTF-16)
- Parameter interpolation for logging functions

## Compilation Flags

Tests are compiled with these flags to match game cartridge behavior:

```bash
asc src/assembly/sdk/utility.spec.ts \
  --runtime stub \
  --importMemory \
  --memoryBase 524288 \
  --exportRuntime \
  --use abort= \
  --disable bulk-memory \
  -o tmp/utility.test.wasm \
  --sourceMap
```

## Troubleshooting

### "memory access out of bounds"

- Ensure `--memoryBase 524288` is set
- Ensure `--importMemory` is enabled
- Verify memory is created with at least 32 pages

### String interpolation shows "{}"

- Check UTF-16 string decoding in test runner
- Verify parameters are cast to i64 (for logi/warni) or f64 (for logf/warnf)
- Ensure interpolation replaces each "{}" in sequence

### "Cannot find name" errors

- Import required functions from SDK modules
- Check that test file imports match actual exports

## Best Practices

1. **Group Related Tests**: Put tests for related functions in one test function
2. **Clear Test Names**: Use descriptive names that explain what's being tested
3. **Log Progress**: Use log() to mark test start/end for better output readability
4. **Count Assertions**: Track pass/fail counts for test coverage visibility
5. **Test Edge Cases**: Always test boundary conditions and error cases
6. **Keep Tests Fast**: Avoid excessive iterations; 100-1000 samples is usually sufficient
