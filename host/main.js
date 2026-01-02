import * as loader from '@assemblyscript/loader';
import { addConsoleEntry } from './console-panel.js';
import { audioManager } from './audio-manager.js';

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { alpha: false });

const WIDTH = 320;
const HEIGHT = 240;

let hasAborted = false;
let animationFrameId = null;

const memory = new WebAssembly.Memory({
  initial: 16,   // 16 × 64 KB = 1 MB
  maximum: 16    // fixed, no growth
});

// Create framebuffer views (persistent across game loads)
const fb = new Uint8ClampedArray(memory.buffer, 0, WIDTH * HEIGHT * 4);
const fb32 = new Uint32Array(memory.buffer, 0, WIDTH * HEIGHT);
const image = new ImageData(fb, WIDTH, HEIGHT);

// WASM module state
let wasmExports;
let init, update, draw;

// Load a game cartridge
async function loadGame(gameName) {
  // Stop current game loop
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  hasAborted = false;
  addConsoleEntry('LOG', `Loading ${gameName}...`);
  
  try {
    const wasm = await loader.instantiateStreaming(
      fetch(`../cartridges/${gameName}.wasm`),
      {
        env: {
          memory,
          abort: (msg, file, line, column) => {
            // See AS __getString implementation in wasm-string.js
            hasAborted = true;
            msg = wasmExports.__getString(msg);
            file = wasmExports.__getString(file);
            const errorMsg = `Abort at ${file} ${line}:${column} => ${msg}`;
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
          },
          // Audio functions
          'audio.playSfx': (id, volume) => {
            audioManager.playSfx(id, volume);
          },
          'audio.playMusic': (id, volume) => {
            audioManager.playMusic(id, volume);
          },
          'audio.stopMusic': () => {
            audioManager.stopMusic();
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
      throw new Error(`Cartridge missing required exports: ${missing.join(', ')}`);
    }
    
    // Assign lifecycle functions
    init = wasm.instance.exports.init;
    update = wasm.instance.exports.update;
    draw = wasm.instance.exports.draw;
    
    // Initialize the game
    init();
    addConsoleEntry('LOG', `${gameName} loaded successfully`);
    
    // Start game loop
    last = performance.now();
    acc = 0;
    inputMask = 0;
    prevInputMask = 0;
    requestAnimationFrame(frame);
    
  } catch (e) {
    addConsoleEntry('ERROR', `Failed to load ${gameName}: ${e.message}`);
    hasAborted = true;
  }
}

// Game selector UI
const gameSelect = document.getElementById('game-select');

// Initial load - use dropdown value (persisted by browser on reload)
let currentGame = gameSelect.value;

// Load audio files on startup
audioManager.loadAudio().then(() => {
  addConsoleEntry('LOG', 'Audio system initialized');
});

loadGame(currentGame);

gameSelect.addEventListener('change', () => {
  const selectedGame = gameSelect.value;
  if (selectedGame !== currentGame) {
    currentGame = selectedGame;
    loadGame(currentGame);
  }
});

// Input handling
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

// Mouse state
// Coordinates are in virtual screen space (0-319, 0-239)
// Set to -1 when mouse is outside canvas
let mouseX = -1;
let mouseY = -1;
// Mouse buttons bitmask: bit 0=left, bit 1=right, bit 2=middle
let mouseButtons = 0;
let prevMouseButtons = 0;

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

// Mouse input
// Tracks mouse position and button state, scaled to virtual 320×240 coordinates

// Update mouse position when cursor moves over canvas
canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = WIDTH / rect.width;
  const scaleY = HEIGHT / rect.height;
  mouseX = Math.floor((e.clientX - rect.left) * scaleX);
  mouseY = Math.floor((e.clientY - rect.top) * scaleY);
});

// Set coordinates to -1 when mouse leaves canvas
canvas.addEventListener("mouseleave", () => {
  mouseX = -1;
  mouseY = -1;
});

// Track button presses (bit 0=left, bit 1=right, bit 2=middle)
canvas.addEventListener("mousedown", e => {
  mouseButtons |= (1 << e.button);
  e.preventDefault();
});

canvas.addEventListener("mouseup", e => {
  mouseButtons &= ~(1 << e.button);
  e.preventDefault();
});

// Prevent context menu on right-click
canvas.addEventListener("contextmenu", e => {
  e.preventDefault();
});

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

// Performance timing
let avgUpdateTime = 0;
let avgDrawTime = 0;
const PERF_SAMPLE_COUNT = 60;  // Average over 60 frames
let updateTimeSamples = [];
let drawTimeSamples = [];

const fpsEl = document.getElementById('fps');
const updateTimeEl = document.getElementById('update-time');
const drawTimeEl = document.getElementById('draw-time');
const updatesEl = document.getElementById('updates');
const accEl = document.getElementById('acc');
const inputEl = document.getElementById('input');
const mouseEl = document.getElementById('mouse');
const mouseButtonsEl = document.getElementById('mouse-buttons');

// Pause game when tab is hidden, resume when visible
// This stops the animation loop entirely to save CPU when tab is in background
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Tab hidden - animation loop will stop naturally
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else {
    // Tab visible - restart animation loop
    if (!animationFrameId && !hasAborted) {
      last = performance.now();          // Reset reference time on resume
      acc = 0;                           // Clear accumulated time
      animationFrameId = requestAnimationFrame(frame);
    }
  }
});

function frame(now) {
  animationFrameId = null;  // Clear ID since this frame is running
  
  // Stop if WASM has aborted
  if (hasAborted) {
    return;
  }

  // Performance timing
  const frameTime = now - last;

  // Accumulate time since last frame
  acc += frameTime;
  last = now;

  // Run fixed timestep updates
  // This loop ensures update() is called at exactly TICK_HZ frequency
  // Multiple updates may occur per frame if rendering is slow
  let updates = 0;
  let totalUpdateTime = 0;
  
  while (acc >= DT && updates < MAX_UPDATES && !hasAborted) {
    try {
      const updateStart = performance.now();
      
      // Write input state to WASM memory
      const inputView = new DataView(memory.buffer);
      
      // Keyboard input at 0x0AB000 (INPUT_ADDR)
      // Layout: [u8 buttons][u8 prev_buttons]
      // Games access via buttonDown(), buttonPressed()
      inputView.setUint8(0x0AB000, inputMask);        // Current buttons
      inputView.setUint8(0x0AB001, prevInputMask);    // Previous buttons
      
      // Mouse input at 0x0AB010 (MOUSE_ADDR)
      // Layout: [i16 x][i16 y][u8 buttons][u8 prev_buttons]
      // Games access via mouseX(), mouseY(), mouseDown(), mousePressed()
      inputView.setInt16(0x0AB010, mouseX, true);     // Mouse X (little-endian)
      inputView.setInt16(0x0AB012, mouseY, true);     // Mouse Y (little-endian)
      inputView.setUint8(0x0AB014, mouseButtons);     // Current buttons
      inputView.setUint8(0x0AB015, prevMouseButtons); // Previous buttons
      
      update();                          // Game logic update
      prevInputMask = inputMask;         // Track previous input state
      prevMouseButtons = mouseButtons;   // Track previous mouse state
      acc -= DT;                         // Consume one timestep
      updates++;
      
      totalUpdateTime += performance.now() - updateStart;
    } catch (e) {
      addConsoleEntry('ERROR', `Error in update(): ${e.message}`);
      hasAborted = true;
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
  let drawTime = 0;
  if (!hasAborted) {
    try {
      const drawStart = performance.now();
      draw();
      ctx.putImageData(image, 0, 0);
      drawTime = performance.now() - drawStart;
    } catch (e) {
      addConsoleEntry('ERROR', `Error in draw(): ${e.message}`);
      hasAborted = true;
    }
  }

  // Update performance metrics (rolling average)
  updateTimeSamples.push(totalUpdateTime);
  if (updateTimeSamples.length > PERF_SAMPLE_COUNT) updateTimeSamples.shift();
  avgUpdateTime = updateTimeSamples.reduce((a, b) => a + b, 0) / updateTimeSamples.length;
  
  drawTimeSamples.push(drawTime);
  if (drawTimeSamples.length > PERF_SAMPLE_COUNT) drawTimeSamples.shift();
  avgDrawTime = drawTimeSamples.reduce((a, b) => a + b, 0) / drawTimeSamples.length;

  // Update FPS counter
  frameCount++;
  if (now - lastFpsUpdate >= 1000) {
    fps = Math.round(frameCount * 1000 / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Update dev tools panel
  fpsEl.textContent = fps;
  updateTimeEl.textContent = avgUpdateTime.toFixed(2);
  drawTimeEl.textContent = avgDrawTime.toFixed(2);
  updatesEl.textContent = updates;
  accEl.textContent = Math.round(acc);
  inputEl.textContent = '0x' + inputMask.toString(16).padStart(2, '0').toUpperCase();
  mouseEl.textContent = `${mouseX}, ${mouseY}`;
  mouseButtonsEl.textContent = '0x' + mouseButtons.toString(16).padStart(2, '0').toUpperCase();

  // Continue the loop only if document is still visible and no abort occurred
  if (!document.hidden && !hasAborted) {
    animationFrameId = requestAnimationFrame(frame);
  }
}
