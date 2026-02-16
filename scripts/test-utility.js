#!/usr/bin/env node

/**
 * Test runner for utility.ts unit tests
 * Compiles and executes utility.spec.ts
 */

// import * as loader from '@assemblyscript/loader';
import { execSync } from 'child_process';
import { readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = dirname(__dirname);

console.log('Building utility tests...\n');

// Ensure tmp directory exists
try {
  mkdirSync(`${rootDir}/tmp`, { recursive: true });
} catch {
  // Directory may already exist
}

// Compile test file
try {
  execSync(
    `npx asc src/assembly/sdk/utility.spec.ts ` +
      `--runtime stub ` +
      `--importMemory ` +
      `--memoryBase 524288 ` +
      `--exportRuntime ` +
      `--use abort= ` +
      `--disable bulk-memory ` +
      `-o tmp/utility.test.wasm ` +
      `--sourceMap`,
    {
      cwd: rootDir,
      stdio: 'inherit',
    },
  );
} catch {
  console.error('Failed to compile tests');
  process.exit(1);
}

console.log('\nRunning tests...\n');

// Load and execute the test WASM module
try {
  const wasmBuffer = readFileSync(`${rootDir}/tmp/utility.test.wasm`);

  // Create shared memory (2 MB = 32 pages of 64KB each)
  // This matches the memory layout expected by TinyForge games
  const memory = new WebAssembly.Memory({
    initial: 32,
    maximum: 32,
  });

  // Will be set after instantiation
  let wasmExports;

  // Manual UTF-16 string reading for stub runtime (no __getString export)
  const readStringManually = (ptr) => {
    if (!ptr) return '';
    const byteLength = new Uint32Array(memory.buffer, ptr - 4, 1)[0];
    const charLength = byteLength / 2;
    const view = new Uint16Array(memory.buffer, ptr, charLength);
    return String.fromCharCode(...Array.from(view));
  };

  // String getter (uses __getString from AssemblyScript runtime if available)
  const getString = (value) =>
    wasmExports?.__getString
      ? wasmExports.__getString(value)
      : readStringManually(value);

  // Test tracking state
  let currentTestName = null;
  let currentTestFailed = false;
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  // Test lifecycle functions
  const testStart = (namePtr) => {
    currentTestName = getString(namePtr);
    currentTestFailed = false;
    totalTests++;
    console.log(`Test: ${currentTestName}`);
  };

  const testFail = (messagePtr) => {
    const message = getString(messagePtr);
    console.warn('  FAIL: ' + message);
    currentTestFailed = true;
  };

  const testEnd = () => {
    if (!currentTestFailed) {
      console.log(`  PASS: ${currentTestName}`);
      passedTests++;
    } else {
      failedTests++;
    }
    currentTestName = null;
    currentTestFailed = false;
  };

  // Helper for console logging with interpolation (same as main.ts)
  const logWithParams = (type, msg, params) => {
    const text = getString(msg);
    const interpolated = params
      .filter((p) => p !== undefined)
      .reduce((str, param) => str.replace('{}', String(param)), text);
    if (type === 'WARN') {
      console.warn(interpolated);
    } else if (type === 'ERROR') {
      console.error(interpolated);
    } else {
      console.log(interpolated);
    }
  };

  const wasmModule = await WebAssembly.instantiate(wasmBuffer, {
    env: {
      memory: memory,
      abort: (msg, file, line, column) => {
        const msgText = getString(msg);
        const fileText = getString(file);
        console.error(`Abort at ${fileText} ${line}:${column} => ${msgText}`);
      },
      // Test tracking functions
      'test.start': testStart,
      'test.fail': testFail,
      'test.end': testEnd,
      'console.log': (msg) => {
        console.log(getString(msg));
      },
      'console.logi': (msg, p1, p2, p3, p4) => {
        logWithParams('LOG', msg, [p1, p2, p3, p4]);
      },
      'console.logf': (msg, p1, p2, p3, p4) => {
        logWithParams('LOG', msg, [p1, p2, p3, p4]);
      },
      'console.warn': (msg) => {
        console.warn(getString(msg));
      },
      'console.warni': (msg, p1, p2, p3, p4) => {
        logWithParams('WARN', msg, [p1, p2, p3, p4]);
      },
      'console.warnf': (msg, p1, p2, p3, p4) => {
        logWithParams('WARN', msg, [p1, p2, p3, p4]);
      },
      'console.error': (msg) => {
        console.error(getString(msg));
      },
      'console.errori': (msg, p1, p2, p3, p4) => {
        logWithParams('ERROR', msg, [p1, p2, p3, p4]);
      },
      'console.errorf': (msg, p1, p2, p3, p4) => {
        logWithParams('ERROR', msg, [p1, p2, p3, p4]);
      },
    },
  });

  // Capture exports for use in getString (same pattern as main.ts)
  wasmExports = wasmModule.instance.exports;

  // Run the tests
  wasmModule.instance.exports.runTests();

  // Print test summary
  console.log(`Passed: ${passedTests} / ${totalTests}`);
  console.log(`Failed: ${failedTests}`);

  console.log('\n✓ Test execution complete');

  // Exit with error code if any tests failed
  if (failedTests > 0) {
    process.exit(1);
  }
} catch (error) {
  console.error('\n✗ Test execution failed:');
  console.error(error);
  process.exit(1);
}
