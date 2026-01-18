// @ts-ignore - No type definitions available for @assemblyscript/loader
import * as loader from '@assemblyscript/loader';
import { addConsoleEntry } from './console-panel.js';
import { audioManager } from './audio-manager.js';
import { spriteManager } from './sprite-manager.js';
import { INPUT_ADDR, MOUSE_ADDR, SDK_RNG_SEED_ADDR } from '../memory-map.js';

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js");
  });
}

const getOrientationAngle = () => {
  const legacyOrientation = (window as Window & { orientation?: number }).orientation;
  return screen.orientation?.angle ?? legacyOrientation ?? 0;
};

const setLandscapeClass = () => {
  const angle = getOrientationAngle();
  document.body.classList.toggle("landscape-left", angle === 90);
  document.body.classList.toggle("landscape-right", angle === 270);
};

window.addEventListener("orientationchange", setLandscapeClass);
window.addEventListener("load", setLandscapeClass);

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

function formatGameDisplayName(gameName) {
  if (!gameName) return '';
  const withSpaces = gameName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function formatSeedHex(value) {
  return '0x' + (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function parseSeedValue(text) {
  const cleaned = text.trim().toLowerCase();
  const parsed = cleaned.startsWith('0x')
    ? parseInt(cleaned, 16)
    : parseInt(cleaned, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error('Seed must be a number');
  }
  return (parsed >>> 0) & 0x7fffffff;
}

function getRngSeed() {
  const view = new DataView(memory.buffer);
  return view.getInt32(SDK_RNG_SEED_ADDR, true);
}

function setRngSeed(value) {
  const view = new DataView(memory.buffer);
  view.setInt32(SDK_RNG_SEED_ADDR, value | 0, true);
}

function initializeRngSeed() {
  const view = new DataView(memory.buffer);
  const current = view.getInt32(SDK_RNG_SEED_ADDR, true);
  if (current === 0) {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
    view.setInt32(SDK_RNG_SEED_ADDR, seed, true);
  }
}

// Initialize sprite manager with memory
spriteManager.init(memory);
initializeRngSeed();

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
  const displayName = formatGameDisplayName(gameName);
  addConsoleEntry('LOG', `Loading ${displayName}...`);
  
  try {
    const wasm = await loader.instantiateStreaming(
      fetch(`./assets/cartridges/${gameName}.wasm`),
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
      addConsoleEntry('LOG', `${displayName} loaded successfully`);
    } else {
      addConsoleEntry('LOG', `${displayName} hot reloaded (memory preserved)`);
    }
    
    // Start game loop
    last = performance.now();
    acc = 0;
    inputMask = 0;
    prevInputMask = 0;
    requestAnimationFrame(frame);
    
  } catch (e) {
    addConsoleEntry('ERROR', `Failed to load ${displayName}: ${e.message}`);
    hasAborted = true;
  }
}

// Game selector UI
const gameSelect = document.getElementById('game-select') as HTMLSelectElement;
const GAME_STORAGE_KEY = 'tinyforge.selectedGame';

function getStoredGame() {
  try {
    return localStorage.getItem(GAME_STORAGE_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setStoredGame(gameName) {
  try {
    if (gameName) {
      localStorage.setItem(GAME_STORAGE_KEY, gameName);
    } else {
      localStorage.removeItem(GAME_STORAGE_KEY);
    }
  } catch (e) {
    // Ignore storage errors (private mode, disabled storage, etc.)
  }
}

function setGameSelectPlaceholder(label) {
  gameSelect.innerHTML = '';
  const option = document.createElement('option');
  option.value = '';
  option.textContent = label;
  option.disabled = true;
  option.selected = true;
  gameSelect.appendChild(option);
}

// Discover cartridge names by listing assets/cartridges/ directory.
// This relies on the dev server exposing a directory index.
async function fetchWasmGameList() {
  try {
    const response = await fetch('./assets/cartridges/', { cache: 'no-cache' });
    if (!response.ok) return [];
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const links = Array.from(doc.querySelectorAll('a'));
    const games = links
      .map((link) => link.getAttribute('href') || '')
      .filter((href) => href.endsWith('.wasm'))
      .map((href) => href.split('/').pop() || '')
      .map((file) => file.replace(/\.wasm$/, ''));
    return Array.from(new Set(games)).sort();
  } catch (e) {
    return [];
  }
}

// Rebuild the dropdown from the current WASM list, preserving selection.
async function populateGameSelector() {
  const previous = gameSelect.value;
  const stored = getStoredGame();
  setGameSelectPlaceholder('Loading...');

  const games = await fetchWasmGameList();
  if (games.length === 0) {
    setGameSelectPlaceholder('No games found');
    return [];
  }

  gameSelect.innerHTML = '';
  games.forEach((game) => {
    const option = document.createElement('option');
    option.value = game;
    option.textContent = formatGameDisplayName(game);
    gameSelect.appendChild(option);
  });
  if (stored && games.includes(stored)) {
    gameSelect.value = stored;
  } else if (previous && games.includes(previous)) {
    gameSelect.value = previous;
  }
  return games;
}

// Initial load - use dropdown value (persisted by browser on reload)
let currentGame = '';

// WASM file watcher for auto-reload
let lastModified = null;
let watchInterval = null;

function hotReload() {
  addConsoleEntry('LOG', 'Hot reloading cartridge...');
  loadGame(currentGame, { skipInit: true });
}

async function checkWasmUpdate() {
  try {
    const response = await fetch(`./assets/cartridges/${currentGame}.wasm`, {
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

// Load audio, sprites, and game list in parallel
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
  }),
  populateGameSelector()
]).then(([_, __, games]) => {
  // Load game after assets and game list are ready
  addConsoleEntry('LOG', 'All assets loaded, starting game...');
  currentGame = gameSelect.value || games[0] || '';
  if (!currentGame) {
    addConsoleEntry('ERROR', 'No game cartridges found.');
    return;
  }
  setStoredGame(currentGame);
  loadGame(currentGame);

  // Start watching for WASM changes
  startWasmWatch();
});

gameSelect.addEventListener('change', () => {
  const selectedGame = gameSelect.value;
  if (selectedGame !== currentGame) {
    currentGame = selectedGame;
    setStoredGame(currentGame);
    stopWasmWatch();
    loadGame(currentGame);
    startWasmWatch();
  }
});

// Restart button - resets game state
const restartBtn = document.getElementById('restart-game');
restartBtn.addEventListener('click', () => {
  if (init) {
    init();
    addConsoleEntry('LOG', 'Game restarted');
  }
});

// Toggle pause state
function togglePause() {
  const pauseBtn = document.getElementById('pause-game') as HTMLButtonElement;
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? 'Resume (P)' : 'Pause (P)';
  
  if (isPaused) {
    addConsoleEntry('LOG', 'Game paused');
    // Stop animation loop
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else {
    addConsoleEntry('LOG', 'Game resumed');
    // Restart animation loop
    if (!animationFrameId && !hasAborted) {
      const now = performance.now();
      last = now;
      acc = 0;
      lastFpsUpdate = now;
      frameCount = 0;
      animationFrameId = requestAnimationFrame(frame);
    }
  }
}

// Pause button
const pauseBtn = document.getElementById('pause-game') as HTMLButtonElement;
pauseBtn.addEventListener('click', togglePause);

// Memory viewer button
const memoryViewerBtn = document.getElementById('open-memory-viewer');
memoryViewerBtn.addEventListener('click', openMemoryViewer);

function toggleFullscreen() {
  const target = canvas;
  const requestFullscreen = target.requestFullscreen?.bind(target);
  const exitFullscreen = document.exitFullscreen?.bind(document);

  if (!document.fullscreenElement && requestFullscreen) {
    requestFullscreen().catch(err => {
      addConsoleEntry('ERROR', `Failed to enter fullscreen: ${err.message}`);
    });
  } else if (document.fullscreenElement && exitFullscreen) {
    exitFullscreen();
  }
}

// Fullscreen button
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement | null;
fullscreenBtn?.addEventListener('click', toggleFullscreen);

function formatScreenshotFilename(gameName) {
  const safeName = (gameName || 'game').replace(/[^a-z0-9-_]+/gi, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `tinyforge-${safeName}-${stamp}.png`;
}

function triggerDownload(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function takeScreenshot() {
  const filename = formatScreenshotFilename(currentGame);
  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (!blob) {
        addConsoleEntry('ERROR', 'Screenshot failed (no data).');
        return;
      }
      const url = URL.createObjectURL(blob);
      triggerDownload(url, filename);
      URL.revokeObjectURL(url);
      addConsoleEntry('LOG', 'Screenshot saved.');
    }, 'image/png');
  } else {
    const dataUrl = canvas.toDataURL('image/png');
    triggerDownload(dataUrl, filename);
    addConsoleEntry('LOG', 'Screenshot saved.');
  }
}

// Screenshot button
const screenshotBtn = document.getElementById('screenshot-btn') as HTMLButtonElement | null;
screenshotBtn?.addEventListener('click', takeScreenshot);

// Keyboard shortcuts: R to restart, P to pause, F for fullscreen
window.addEventListener('keydown', (e) => {
  if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
    if (init) {
      init();
      addConsoleEntry('LOG', 'Game restarted');
    }
    e.preventDefault();
  } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
    togglePause();
    e.preventDefault();
  } else if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
    toggleFullscreen();
    e.preventDefault();
  } else if ((e.key === 's' || e.key === 'S') && !e.repeat) {
    takeScreenshot();
    e.preventDefault();
  }
});

// Input handling
const keyMap = {
  up:    1 << 0,
  down:  1 << 1,
  left:  1 << 2,
  right: 1 << 3,
  a:     1 << 4,
  b:     1 << 5,
  start: 1 << 6,
};

const keyCodeMap = {
  ArrowUp: keyMap.up,
  ArrowDown: keyMap.down,
  ArrowLeft: keyMap.left,
  ArrowRight: keyMap.right,
  KeyZ: keyMap.a,
  KeyX: keyMap.b,
  Enter: keyMap.start,
};

let inputMask = 0;
let prevInputMask = 0;
let isPaused = false;

const blockTouchScroll = window.matchMedia("(pointer: coarse)").matches;
const preventIfTouchScrollBlocked = (event: Event) => {
  if (blockTouchScroll) {
    event.preventDefault();
  }
};

// Mouse state
// Coordinates are in virtual screen space (0-319, 0-239)
// Set to -1 when mouse is outside canvas
let mouseX = -1;
let mouseY = -1;
// Mouse buttons bitmask: bit 0=left, bit 1=right, bit 2=middle
let mouseButtons = 0;
let prevMouseButtons = 0;

window.addEventListener("keydown", e => {
  const mapped = keyCodeMap[e.code];
  if (mapped !== undefined) {
    inputMask |= mapped;
    e.preventDefault();
  }
});

window.addEventListener("keyup", e => {
  const mapped = keyCodeMap[e.code];
  if (mapped !== undefined) {
    inputMask &= ~mapped;
    e.preventDefault();
  }
});

// Mouse input
// Tracks mouse position and button state, scaled to virtual 320×240 coordinates

// Update mouse position when cursor moves over canvas
canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  const viewWidth = rect.width;
  const viewHeight = rect.height;
  const aspect = canvas.width / canvas.height;
  const viewAspect = viewWidth / viewHeight;

  // In fullscreen the canvas stretches to fill the screen, but the game still renders
  // into a 4:3 area with letterboxing. Compute the drawn area so mouse input maps
  // to the actual content instead of the full stretched canvas.
  let drawWidth = viewWidth;
  let drawHeight = viewHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (viewAspect > aspect) {
    // Extra horizontal space (pillarbox): center the 4:3 content.
    drawHeight = viewHeight;
    drawWidth = drawHeight * aspect;
    offsetX = (viewWidth - drawWidth) / 2;
  } else {
    // Extra vertical space (letterbox): center the 4:3 content.
    drawWidth = viewWidth;
    drawHeight = drawWidth / aspect;
    offsetY = (viewHeight - drawHeight) / 2;
  }

  const x = e.clientX - rect.left - offsetX;
  const y = e.clientY - rect.top - offsetY;
  const scaleX = canvas.width / drawWidth;
  const scaleY = canvas.height / drawHeight;
  mouseX = Math.floor(x * scaleX);
  mouseY = Math.floor(y * scaleY);
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

// Onscreen buttons

document.querySelectorAll<HTMLButtonElement>("[data-input]").forEach((button) => {
  const input = button.dataset.input as keyof typeof keyMap | undefined;
  if (input && input in keyMap) {
    const press = () => {
      inputMask |= keyMap[input];
    };
    const release = () => {
      inputMask &= ~keyMap[input];
    };
    button.addEventListener("touchstart", (event) => {
      preventIfTouchScrollBlocked(event);
      press();
    }, { passive: false });
    button.addEventListener("touchend", (event) => {
      preventIfTouchScrollBlocked(event);
      release();
    }, { passive: false });
    button.addEventListener("touchcancel", (event) => {
      preventIfTouchScrollBlocked(event);
      release();
    }, { passive: false });
    button.addEventListener("mousedown", press);
    button.addEventListener("mouseup", release);
    button.addEventListener("mouseleave", release);
  }
});

const pressStart = (event: Event) => {
  preventIfTouchScrollBlocked(event);
  inputMask |= keyMap.start;
};
const releaseStart = (event: Event) => {
  preventIfTouchScrollBlocked(event);
  inputMask &= ~keyMap.start;
};
canvas.addEventListener("touchstart", pressStart, { passive: false });
canvas.addEventListener("touchend", releaseStart, { passive: false });
canvas.addEventListener("touchcancel", releaseStart, { passive: false });
canvas.addEventListener("touchmove", (event) => preventIfTouchScrollBlocked(event), { passive: false });
canvas.addEventListener("mousedown", pressStart);
window.addEventListener("mouseup", releaseStart);

// Next button: switch to next game
document
  .querySelectorAll<HTMLButtonElement>("[data-action='next']")
  .forEach((button) => {
    const press = () => {
      const select = document.getElementById('game-select') as HTMLSelectElement;
      if (select) {
        const options = Array.from(select.options);
        const idx = options.findIndex(opt => opt.value === select.value);
        const nextIdx = (idx + 1) % options.length;
        select.selectedIndex = nextIdx;
        select.dispatchEvent(new Event('change'));
      }
    };
    button.addEventListener("touchstart", (event) => {
      preventIfTouchScrollBlocked(event);
      press();
    }, { passive: false });
    button.addEventListener("mousedown", press);
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
const rngSeedInput = document.getElementById('rng-seed-input') as HTMLInputElement | null;
const rngSeedApply = document.getElementById('rng-seed-apply') as HTMLButtonElement | null;

const applyRngSeedInput = () => {
  if (!rngSeedInput) return;
  try {
    const nextSeed = parseSeedValue(rngSeedInput.value);
    setRngSeed(nextSeed);
    rngSeedInput.value = formatSeedHex(nextSeed);
  } catch (e) {
    addConsoleEntry('ERROR', `Invalid RNG seed: ${e.message}`);
  }
};

if (rngSeedApply) {
  rngSeedApply.addEventListener('click', applyRngSeedInput);
}

if (rngSeedInput) {
  rngSeedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      applyRngSeedInput();
    }
  });
  rngSeedInput.value = formatSeedHex(getRngSeed());
}

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
  if (rngSeedInput && document.activeElement !== rngSeedInput) {
    rngSeedInput.value = formatSeedHex(getRngSeed());
  }

  // Continue the loop only if document is still visible and no abort occurred
  if (!document.hidden && !hasAborted) {
    animationFrameId = requestAnimationFrame(frame);
  }
}
