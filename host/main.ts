// @ts-ignore - No type definitions available for @assemblyscript/loader
import * as loader from '@assemblyscript/loader';
import { addConsoleEntry } from './console-panel.js';
import { audioManager } from './audio-manager.js';
import { spriteManager } from './sprite-manager.js';
import { INPUT_ADDR, MOUSE_ADDR } from '../memory-map.js';

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false });

const WIDTH = 320;
const HEIGHT = 240;

let hasAborted = false;
let animationFrameId = null;

const memory = new WebAssembly.Memory({
  initial: 16,   // 16 × 64 KB = 1 MB
  maximum: 16    // fixed, no growth
});

// Initialize sprite manager with memory
spriteManager.init(memory);

// Create framebuffer views (persistent across game loads)
const fb = new Uint8ClampedArray(memory.buffer, 0, WIDTH * HEIGHT * 4);
const fb32 = new Uint32Array(memory.buffer, 0, WIDTH * HEIGHT);
const image = new ImageData(fb, WIDTH, HEIGHT);

// Allow external access to memory for tools
(window as any).getMemory = () => memory;

// Open memory viewer in new window
function openMemoryViewer() {
  const viewer = window.open('memory-viewer.html', 'TinyForge Memory Viewer', 
    'width=1200,height=800,menubar=no,toolbar=no');
  if (!viewer) {
    addConsoleEntry('ERROR', 'Failed to open memory viewer. Please allow popups.');
  }
}

// WASM module state
let wasmExports;
let init, update, draw;

// Load a game cartridge
async function loadGame(gameName, { skipInit = false } = {}) {
  // Stop current game loop
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  // Stop any playing music
  audioManager.stopMusic();
  
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
    
    // Initialize the game (skip if hot reloading to preserve state)
    if (!skipInit) {
      init();
      addConsoleEntry('LOG', `${gameName} loaded successfully`);
    } else {
      addConsoleEntry('LOG', `${gameName} hot reloaded (memory preserved)`);
    }
    
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
const gameSelect = document.getElementById('game-select') as HTMLSelectElement;

// Initial load - use dropdown value (persisted by browser on reload)
let currentGame = gameSelect.value;

// WASM file watcher for auto-reload
let lastModified = null;
let watchInterval = null;

function hotReload() {
  addConsoleEntry('LOG', 'Hot reloading cartridge...');
  loadGame(currentGame, { skipInit: true });
}

async function checkWasmUpdate() {
  try {
    const response = await fetch(`../cartridges/${currentGame}.wasm`, {
      method: 'HEAD',
      cache: 'no-cache'
    });
    
    const modified = response.headers.get('Last-Modified');
    
    if (lastModified && modified && modified !== lastModified) {
      lastModified = modified;
      hotReload();
    } else if (!lastModified) {
      lastModified = modified;
    }
  } catch (e) {
    // Ignore errors (file might not exist yet, server down, etc.)
  }
}

function startWasmWatch() {
  if (watchInterval) clearInterval(watchInterval);
  lastModified = null;
  watchInterval = setInterval(checkWasmUpdate, 1000); // Check every second
}

function stopWasmWatch() {
  if (watchInterval) {
    clearInterval(watchInterval);
    watchInterval = null;
  }
}

// Load audio and sprites, then load the game
Promise.all([
  audioManager.loadAudio().then(() => {
    const sfxCount = audioManager.getSfxCount();
    const musicCount = audioManager.getMusicCount();
    const size = audioManager.getDataSize();
    addConsoleEntry('LOG', `Audio system initialized: ${sfxCount} SFX, ${musicCount} music tracks, ${(size / 1024).toFixed(1)} KB`);
  }),
  spriteManager.loadSprites().then(() => {
    const count = spriteManager.getSpriteCount();
    const size = spriteManager.getDataSize();
    addConsoleEntry('LOG', `Sprite system initialized: ${count} sprites, ${(size / 1024).toFixed(1)} KB`);
  })
]).then(() => {
  // Load game after all assets are ready
  addConsoleEntry('LOG', 'All assets loaded, starting game...');
  loadGame(currentGame);
  
  // Start watching for WASM changes
  startWasmWatch();
});

gameSelect.addEventListener('change', () => {
  const selectedGame = gameSelect.value;
  if (selectedGame !== currentGame) {
    currentGame = selectedGame;
    stopWasmWatch();
    loadGame(currentGame);
    startWasmWatch();
  }
});

// Reload button
const reloadBtn = document.getElementById('reload-game');
reloadBtn.addEventListener('click', hotReload);

// Memory viewer button
const memoryViewerBtn = document.getElementById('open-memory-viewer');
memoryViewerBtn.addEventListener('click', openMemoryViewer);

// Keyboard shortcut: R to reload
window.addEventListener('keydown', (e) => {
  if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
    hotReload();
    e.preventDefault();
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

function mapMouseButton(button) {
  if (button < 0 || button > 2) return -1;
  return button === 2 ? 1 : button === 1 ? 2 : 0; // Map right button to bit 1
}

// Track button presses (bit 0=left, bit 1=right, bit 2=middle)
canvas.addEventListener("mousedown", e => {
  const btn = mapMouseButton(e.button);
  if (btn !== -1) {
    mouseButtons |= (1 << btn);
    e.preventDefault();
  }
});

canvas.addEventListener("mouseup", e => {
  const btn = mapMouseButton(e.button);
  if (btn !== -1) {
    mouseButtons &= ~(1 << btn);
    e.preventDefault();
  }
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
      
      // Keyboard input
      // Layout: [u8 buttons][u8 prev_buttons]
      inputView.setUint8(INPUT_ADDR, inputMask);
      inputView.setUint8(INPUT_ADDR + 1, prevInputMask);
      
      // Mouse input
      // Layout: [i16 x][i16 y][u8 buttons][u8 prev_buttons]
      inputView.setInt16(MOUSE_ADDR, mouseX, true);
      inputView.setInt16(MOUSE_ADDR + 2, mouseY, true);
      inputView.setUint8(MOUSE_ADDR + 4, mouseButtons);
      inputView.setUint8(MOUSE_ADDR + 5, prevMouseButtons);
      
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
  function updatePerfMetric(samples, newValue) {
    samples.push(newValue);
    if (samples.length > PERF_SAMPLE_COUNT) samples.shift();
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }
  
  avgUpdateTime = updatePerfMetric(updateTimeSamples, totalUpdateTime);
  avgDrawTime = updatePerfMetric(drawTimeSamples, drawTime);

  // Update FPS counter
  frameCount++;
  if (now - lastFpsUpdate >= 1000) {
    fps = Math.round(frameCount * 1000 / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Update dev tools panel
  fpsEl.textContent = String(fps);
  updateTimeEl.textContent = avgUpdateTime.toFixed(2);
  drawTimeEl.textContent = avgDrawTime.toFixed(2);
  updatesEl.textContent = String(updates);
  accEl.textContent = String(Math.round(acc));
  inputEl.textContent = '0x' + inputMask.toString(16).padStart(2, '0').toUpperCase();
  mouseEl.textContent = `${mouseX}, ${mouseY}`;
  mouseButtonsEl.textContent = '0x' + mouseButtons.toString(16).padStart(2, '0').toUpperCase();

  // Continue the loop only if document is still visible and no abort occurred
  if (!document.hidden && !hasAborted) {
    animationFrameId = requestAnimationFrame(frame);
  }
}
