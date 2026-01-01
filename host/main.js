import * as loader from '@assemblyscript/loader';
import { addConsoleEntry } from './console-panel.js';

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

let hasAborted = false;

const memory = new WebAssembly.Memory({
  initial: 16,   // 16 × 64 KB = 1 MB
  maximum: 16    // fixed, no growth
});

// WASM module and exports
let wasmExports;

const wasm = await (async () => {
  try {
    const wasm = await loader.instantiateStreaming(
      fetch("../cart/cartridge.wasm"),
      {
        env: {
          memory,
          abort: (msg, file, line, column) => {
            hasAborted = true;  // Stop frame loop
            msg = wasmExports.__getString(msg);
            file = wasmExports.__getString(file);
            const errorMsg =`Abort at ${file} ${line}:${column} => ${msg}`;
            addConsoleEntry('ABORT', errorMsg);
            console.error("WASM abort:", { msg, file, line, column });
          },
          trace: (msg) => {
            addConsoleEntry('TRACE', msg);
          },
          // Fast framebuffer clear using native JS fill()
          clearFramebuffer: (color) => {
            fb32.fill(color | 0xFF000000);
          },
          // Console logging functions
          'console.log': (msg) => {
            addConsoleEntry('LOG', wasmExports.__getString(msg));
          },
          'console.warn': (msg) => {
            addConsoleEntry('WARN', wasmExports.__getString(msg));
          },
          'console.error': (msg) => {
            addConsoleEntry('ERROR', wasmExports.__getString(msg));
          }
        }
      }
    );

    // Capture exports for use in import functions
    wasmExports = wasm.exports;

    // Validate required exports
    const required = ['init', 'update', 'draw'];
    const missing = required.filter(name => !wasm.instance.exports[name]);
    
    if (missing.length > 0) {
      throw new Error(
        `Cartridge missing required exports: ${missing.join(', ')}`
      );
    }
    
    return wasm;
  } catch (e) {
    addConsoleEntry('ERROR', `Failed to load cartridge: ${e.message}`);
    throw e;
  }
})();

const { init, update, draw } = wasm.instance.exports;
const WIDTH = 320;
const HEIGHT = 240;
  
// Create a Uint8ClampedArray that points to the framebuffer in WASM memory
// Note: UInt8ClampedArray type is required by ImageData
const fb = new Uint8ClampedArray(
  memory.buffer,
  0,
  WIDTH * HEIGHT * 4
);

// Create Uint32Array view for efficient clearing
const fb32 = new Uint32Array(
  memory.buffer,
  0,
  WIDTH * HEIGHT
);

const image = new ImageData(fb, WIDTH, HEIGHT);

const KEYMAP = {
  ArrowUp:    1 << 0,
  ArrowDown:  1 << 1,
  ArrowLeft:  1 << 2,
  ArrowRight: 1 << 3,
  KeyZ:       1 << 4,
  KeyX:       1 << 5,
  Enter:      1 << 6
};

let inputMask = 0;
let prevInputMask = 0;

window.addEventListener("keydown", e => {
  if (KEYMAP[e.code]) {
    inputMask |= KEYMAP[e.code];
    e.preventDefault();
  }
});

window.addEventListener("keyup", e => {
  if (KEYMAP[e.code]) {
    inputMask &= ~KEYMAP[e.code];
    e.preventDefault();
  }
});

try {
  init();
} catch (e) {
  addConsoleEntry('ERROR', `Error in init(): ${e.message}`);
  hasAborted = true;
}

// === Fixed Timestep Loop ===

// This ensures deterministic game logic regardless of actual frame rate
const TICK_HZ = 60;                    // Target simulation rate (60 updates per second)
const DT = 1000 / TICK_HZ;             // Delta time per update (16.67ms)
const MAX_UPDATES = 5;                 // Safety cap to prevent spiral of death

let last = performance.now();          // Last frame timestamp
let acc = 0;                           // Time accumulator for fixed timestep

// === Dev Tools ===
let fps = 60;
let frameCount = 0;
let lastFpsUpdate = performance.now();

const fpsEl = document.getElementById('fps');
const updatesEl = document.getElementById('updates');
const accEl = document.getElementById('acc');
const inputEl = document.getElementById('input');

// Pause game when tab is hidden, resume when visible
// This stops the animation loop entirely to save CPU when tab is in background
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Tab hidden - animation loop will stop naturally
  } else {
    // Tab visible - restart animation loop
    last = performance.now();          // Reset reference time on resume
    acc = 0;                           // Clear accumulated time
    requestAnimationFrame(frame);      // Restart the loop
  }
});

function frame(now) {
  // Stop if WASM has aborted
  if (hasAborted) {
    return;
  }

  // Accumulate time since last frame
  acc += now - last;
  last = now;

  // Run fixed timestep updates
  // This loop ensures update() is called at exactly TICK_HZ frequency
  // Multiple updates may occur per frame if rendering is slow
  let updates = 0;
  while (acc >= DT && updates < MAX_UPDATES && !hasAborted) {
    try {
      update(inputMask, prevInputMask);  // Game logic update
      prevInputMask = inputMask;         // Track previous input state
      acc -= DT;                         // Consume one timestep
      updates++;
    } catch (e) {
      addConsoleEntry('ERROR', `Error in update(): ${e.message}`);
      break;
    }
  }
  
  // If we hit the update cap, skip frames rather than spiraling
  // This prevents the game from freezing while trying to catch up
  if (updates >= MAX_UPDATES) {
    console.warn("Max updates reached, skipping frames");
    acc = 0;                           // Reset to prevent runaway
  }

  // Render current state (runs at display refresh rate)
  if (!hasAborted) {
    try {
      draw();
      ctx.putImageData(image, 0, 0);
    } catch (e) {
      addConsoleEntry('ERROR', `Error in draw(): ${e.message}`);
    }
  }

  // Update FPS counter
  frameCount++;
  if (now - lastFpsUpdate >= 1000) {
    fps = Math.round(frameCount * 1000 / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Update dev tools panel
  fpsEl.textContent = fps;
  updatesEl.textContent = updates;
  accEl.textContent = Math.round(acc);
  inputEl.textContent = '0x' + inputMask.toString(16).padStart(2, '0').toUpperCase();

  // Continue the loop only if document is still visible and no abort occurred
  if (!document.hidden && !hasAborted) {
    requestAnimationFrame(frame);
  }
}

requestAnimationFrame(frame);
