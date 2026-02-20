// @ts-expect-error - No type definitions available for @assemblyscript/loader
import * as loader from '@assemblyscript/loader';
import {
  INPUT_ADDR,
  MOUSE_ADDR,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  SDK_RNG_SEED_ADDR,
} from '../memory-map.js';
import { audioManager } from './audio-manager.js';
import { addConsoleEntry } from './console-panel.js';
import { spriteManager } from './sprite-manager.js';

type WasmLifecycle = () => void;
type WasmInstanceExports = WebAssembly.Exports & {
  __getString?: (ptr: number) => string;
  init?: WasmLifecycle;
  update?: WasmLifecycle;
  draw?: WasmLifecycle;
};

type LoaderResult = {
  exports: WasmInstanceExports;
  instance: WebAssembly.Instance & { exports: WasmInstanceExports };
};

const requireElement = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element: ${id}`);
  }
  return el as T;
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}

const getOrientationAngle = (): number => {
  const legacyOrientation = (window as Window & { orientation?: number })
    .orientation;
  return screen.orientation?.angle ?? legacyOrientation ?? 0;
};

const setLandscapeClass = (): void => {
  const angle = getOrientationAngle();
  document.body.classList.toggle('landscape-left', angle === 90);
  document.body.classList.toggle('landscape-right', angle === 270);
};

window.addEventListener('orientationchange', setLandscapeClass);
window.addEventListener('load', setLandscapeClass);

const canvas = requireElement<HTMLCanvasElement>('screen');
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) {
  throw new Error('Failed to acquire 2D rendering context.');
}
const ctx2d = ctx;

let hasAborted = false;
let animationFrameId: number | null = null;

const memory = new WebAssembly.Memory({
  initial: 16, // 16 × 64 KB = 1 MB
  maximum: 16, // fixed, no growth
});

function formatGameDisplayName(gameName: string): string {
  if (!gameName) return '';
  const withSpaces = gameName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function formatSeedHex(value: number): string {
  return '0x' + (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function parseSeedValue(text: string): number {
  const cleaned = text.trim().toLowerCase();
  const parsed = cleaned.startsWith('0x')
    ? parseInt(cleaned, 16)
    : parseInt(cleaned, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error('Seed must be a number');
  }
  return (parsed >>> 0) & 0x7fffffff;
}

function getRngSeed(): number {
  const view = new DataView(memory.buffer);
  return view.getInt32(SDK_RNG_SEED_ADDR, true);
}

function setRngSeed(value: number): void {
  const view = new DataView(memory.buffer);
  view.setInt32(SDK_RNG_SEED_ADDR, value | 0, true);
}

function initializeRngSeed(): void {
  const view = new DataView(memory.buffer);
  const current = view.getInt32(SDK_RNG_SEED_ADDR, true);
  if (current === 0) {
    const seed =
      (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
    view.setInt32(SDK_RNG_SEED_ADDR, seed, true);
  }
}

// Initialize sprite manager with memory
spriteManager.init(memory);
initializeRngSeed();

// Create framebuffer views (persistent across game loads)
const fb = new Uint8ClampedArray(
  memory.buffer,
  0,
  SCREEN_WIDTH * SCREEN_HEIGHT * 4,
);
const fb32 = new Uint32Array(memory.buffer, 0, SCREEN_WIDTH * SCREEN_HEIGHT);
const image = new ImageData(fb, SCREEN_WIDTH, SCREEN_HEIGHT);

// Allow external access to memory for tools
(window as Window & { getMemory?: () => WebAssembly.Memory }).getMemory = () =>
  memory;

// Open memory viewer in new window
function openMemoryViewer(): void {
  const viewer = window.open(
    'memory-viewer.html',
    'TinyForge Memory Viewer',
    'width=1200,height=800,menubar=no,toolbar=no',
  );
  if (!viewer) {
    addConsoleEntry(
      'ERROR',
      'Failed to open memory viewer. Please allow popups.',
    );
  }
}

// WASM module state
let wasmExports: WasmInstanceExports | null = null;
let init: WasmLifecycle | null = null;
let update: WasmLifecycle | null = null;
let draw: WasmLifecycle | null = null;

// Load a game cartridge
async function loadGame(
  gameName: string,
  { skipInit = false }: { skipInit?: boolean } = {},
): Promise<void> {
  // Stop current game loop
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  // Stop any playing music
  audioManager.stopMusic();

  hasAborted = false;
  const displayName = formatGameDisplayName(gameName);
  addConsoleEntry('LOG', `Loading ${displayName}...`);

  try {
    const getString = (value: number): string =>
      wasmExports?.__getString ? wasmExports.__getString(value) : String(value);
    // Helper for console logging with interpolation
    const logWithParams = (
      type: 'LOG' | 'WARN' | 'ERROR',
      msg: number,
      params: Array<bigint | number | undefined>,
    ): void => {
      const text = getString(msg);
      const interpolated = params
        .filter((p) => p !== undefined)
        .reduce((str, param) => str.replace('{}', String(param)), text);
      addConsoleEntry(type, interpolated);
    };
    const wasm = (await loader.instantiateStreaming(
      fetch(`./assets/cartridges/${gameName}.wasm`),
      {
        env: {
          memory,
          abort: (msg: number, file: number, line: number, column: number) => {
            // See AS __getString implementation in wasm-string.js
            hasAborted = true;
            const msgText = getString(msg);
            const fileText = getString(file);
            const errorMsg = `Abort at ${fileText} ${line}:${column} => ${msgText}`;
            addConsoleEntry('ABORT', errorMsg);
            console.error('WASM abort:', {
              msg: msgText,
              file: fileText,
              line,
              column,
            });
          },
          // Fast framebuffer clear using native JS fill()
          clearFramebuffer: (color: number) => {
            fb32.fill(color | 0xff000000);
          },
          // Console logging functions
          trace: (msg: number) => {
            addConsoleEntry('TRACE', getString(msg));
          },
          'console.log': (msg: number) => {
            addConsoleEntry('LOG', getString(msg));
          },
          'console.logi': (
            msg: number,
            p1?: bigint,
            p2?: bigint,
            p3?: bigint,
            p4?: bigint,
          ) => {
            logWithParams('LOG', msg, [p1, p2, p3, p4]);
          },
          'console.logf': (
            msg: number,
            p1?: number,
            p2?: number,
            p3?: number,
            p4?: number,
          ) => {
            logWithParams('LOG', msg, [p1, p2, p3, p4]);
          },
          'console.warn': (msg: number) => {
            addConsoleEntry('WARN', getString(msg));
          },
          'console.warni': (
            msg: number,
            p1?: bigint,
            p2?: bigint,
            p3?: bigint,
            p4?: bigint,
          ) => {
            logWithParams('WARN', msg, [p1, p2, p3, p4]);
          },
          'console.warnf': (
            msg: number,
            p1?: number,
            p2?: number,
            p3?: number,
            p4?: number,
          ) => {
            logWithParams('WARN', msg, [p1, p2, p3, p4]);
          },
          'console.error': (msg: number) => {
            addConsoleEntry('ERROR', getString(msg));
          },
          'console.errori': (
            msg: number,
            p1?: bigint,
            p2?: bigint,
            p3?: bigint,
            p4?: bigint,
          ) => {
            logWithParams('ERROR', msg, [p1, p2, p3, p4]);
          },
          'console.errorf': (
            msg: number,
            p1?: number,
            p2?: number,
            p3?: number,
            p4?: number,
          ) => {
            logWithParams('ERROR', msg, [p1, p2, p3, p4]);
          },
          // Audio functions
          'audio.playSfx': (id: number, volume: number) => {
            const idString = wasmExports?.__getString
              ? wasmExports.__getString(id)
              : String(id);
            audioManager.playSfx(idString, volume);
          },
          'audio.playMusic': (id: number, volume: number) => {
            const idString = wasmExports?.__getString
              ? wasmExports.__getString(id)
              : String(id);
            audioManager.playMusic(idString, volume);
          },
          'audio.stopMusic': () => {
            audioManager.stopMusic();
          },
        },
      },
    )) as LoaderResult;

    // Capture exports for use in import functions
    wasmExports = wasm.exports;

    // Validate required exports
    const required = ['init', 'update', 'draw'] as const;
    const missing = required.filter(
      (name) => typeof wasm.instance.exports[name] !== 'function',
    );

    if (missing.length > 0) {
      throw new Error(
        `Cartridge missing required exports: ${missing.join(', ')}`,
      );
    }

    // Assign lifecycle functions
    init = wasm.instance.exports.init ?? null;
    update = wasm.instance.exports.update ?? null;
    draw = wasm.instance.exports.draw ?? null;

    // Initialize the game (skip if hot reloading to preserve state)
    if (!skipInit) {
      addConsoleEntry('LOG', `RNG Seed: ${formatSeedHex(getRngSeed())}`);
      init?.();
      addConsoleEntry('LOG', `${displayName} loaded successfully`);
    } else {
      addConsoleEntry('LOG', `${displayName} hot reloaded (memory preserved)`);
    }

    // Start game loop
    last = performance.now();
    acc = DT; // Start with one frame of accumulated time to ensure first frame runs update()
    inputMask = 0;
    prevInputMask = 0;
    requestAnimationFrame(frame);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    addConsoleEntry('ERROR', `Failed to load ${displayName}: ${message}`);
    if (e instanceof Error && e.stack) {
      console.error('Stack trace:', e.stack);
    }
    hasAborted = true;
  }
}

// Game selector UI
const gameSelect = requireElement<HTMLSelectElement>('game-select');
const GAME_STORAGE_KEY = 'tinyforge.selectedGame';

function getStoredGame(): string {
  try {
    return localStorage.getItem(GAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredGame(gameName: string): void {
  try {
    if (gameName) {
      localStorage.setItem(GAME_STORAGE_KEY, gameName);
    } else {
      localStorage.removeItem(GAME_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors (private mode, disabled storage, etc.)
  }
}

function setGameSelectPlaceholder(label: string): void {
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
async function fetchWasmGameList(): Promise<string[]> {
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
  } catch {
    return [];
  }
}

// Rebuild the dropdown from the current WASM list, preserving selection.
async function populateGameSelector(): Promise<string[]> {
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
let lastModified: string | null = null;
let watchInterval: number | null = null;

function hotReload(): void {
  addConsoleEntry('LOG', 'Hot reloading cartridge...');
  loadGame(currentGame, { skipInit: true });
}

async function checkWasmUpdate(): Promise<void> {
  try {
    const response = await fetch(`./assets/cartridges/${currentGame}.wasm`, {
      method: 'HEAD',
      cache: 'no-cache',
    });

    const modified = response.headers.get('Last-Modified');

    if (lastModified && modified && modified !== lastModified) {
      lastModified = modified;
      hotReload();
    } else if (!lastModified) {
      lastModified = modified;
    }
  } catch {
    // Ignore errors (file might not exist yet, server down, etc.)
  }
}

function startWasmWatch(): void {
  if (watchInterval !== null) clearInterval(watchInterval);
  lastModified = null;
  watchInterval = setInterval(checkWasmUpdate, 1000); // Check every second
}

function stopWasmWatch(): void {
  if (watchInterval !== null) {
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
    addConsoleEntry(
      'LOG',
      `Audio system initialized: ${sfxCount} SFX, ${musicCount} music tracks, ${(size / 1024).toFixed(1)} KB`,
    );
  }),
  spriteManager.loadSprites().then(() => {
    const count = spriteManager.getSpriteCount();
    const size = spriteManager.getDataSize();
    addConsoleEntry(
      'LOG',
      `Sprite system initialized: ${count} sprites, ${(size / 1024).toFixed(1)} KB`,
    );
  }),
  populateGameSelector(),
] as const).then(([, , games]) => {
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
const restartBtn = requireElement<HTMLButtonElement>('restart-game');

// Safe restart that resets timing state
function restartGame(): void {
  if (!init) return;

  // Cancel next scheduled frame
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  // Reset game state
  addConsoleEntry('LOG', `RNG Seed: ${formatSeedHex(getRngSeed())}`);
  init();
  const displayName = formatGameDisplayName(currentGame);
  addConsoleEntry('LOG', `${displayName} reloaded successfully`);

  // Reset timing variables
  last = performance.now();
  acc = DT; // Start with one frame of accumulated time to ensure first frame runs update()
  lastFpsUpdate = last;
  frameCount = 0;
  prevInputMask = inputMask;
  prevMouseButtons = mouseButtons;

  // Restart loop if not paused and not aborted
  if (!isPaused && !hasAborted) {
    animationFrameId = requestAnimationFrame(frame);
  }
}

restartBtn.addEventListener('click', restartGame);

// Toggle pause state
const pauseBtn = requireElement<HTMLButtonElement>('pause-game');

function togglePause(): void {
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? 'Resume (P)' : 'Pause (P)';

  if (isPaused) {
    addConsoleEntry('LOG', 'Game paused');
    // Stop animation loop
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else {
    addConsoleEntry('LOG', 'Game resumed');
    // Restart animation loop
    if (!animationFrameId && !hasAborted) {
      const now = performance.now();
      last = now;
      acc = DT; // Start with one frame of accumulated time to ensure first frame runs update()
      lastFpsUpdate = now;
      frameCount = 0;
      animationFrameId = requestAnimationFrame(frame);
    }
  }
}

// Pause button
pauseBtn.addEventListener('click', togglePause);

// Memory viewer button
const memoryViewerBtn = requireElement<HTMLButtonElement>('open-memory-viewer');
memoryViewerBtn.addEventListener('click', openMemoryViewer);

function toggleFullscreen(): void {
  const target = canvas;
  const requestFullscreen = target.requestFullscreen?.bind(target);
  const exitFullscreen = document.exitFullscreen?.bind(document);

  if (!document.fullscreenElement && requestFullscreen) {
    requestFullscreen().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      addConsoleEntry('ERROR', `Failed to enter fullscreen: ${message}`);
    });
  } else if (document.fullscreenElement && exitFullscreen) {
    exitFullscreen();
  }
}

// Fullscreen button
const fullscreenBtn = document.getElementById(
  'fullscreen-btn',
) as HTMLButtonElement | null;
fullscreenBtn?.addEventListener('click', toggleFullscreen);

function formatScreenshotFilename(gameName: string): string {
  const safeName = (gameName || 'game').replace(/[^a-z0-9-_]+/gi, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `tinyforge-${safeName}-${stamp}.png`;
}

function triggerDownload(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function takeScreenshot(): void {
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
const screenshotBtn = document.getElementById(
  'screenshot-btn',
) as HTMLButtonElement | null;
screenshotBtn?.addEventListener('click', takeScreenshot);

// Keyboard shortcuts: R to restart, P to pause, F for fullscreen, C to copy color
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
    restartGame();
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
  } else if ((e.key === 'c' || e.key === 'C') && !e.repeat) {
    const colorValue = colorRgbEl?.textContent;
    if (colorValue && colorValue !== '--') {
      navigator.clipboard
        .writeText(colorValue)
        .then(() => {
          addConsoleEntry('LOG', `Copied color: ${colorValue}`);
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          addConsoleEntry('ERROR', `Failed to copy color: ${message}`);
        });
    }
    e.preventDefault();
  }
});

// Input handling
const keyMap = {
  up: 1 << 0,
  down: 1 << 1,
  left: 1 << 2,
  right: 1 << 3,
  a: 1 << 4,
  b: 1 << 5,
  start: 1 << 6,
} as const;

const keyCodeMap: Record<string, number> = {
  ArrowUp: keyMap.up,
  ArrowDown: keyMap.down,
  ArrowLeft: keyMap.left,
  ArrowRight: keyMap.right,
  KeyZ: keyMap.a,
  KeyX: keyMap.b,
  Enter: keyMap.start,
  Space: keyMap.start,
};

let inputMask = 0;
let prevInputMask = 0;
let isPaused = false;

const blockTouchScroll = window.matchMedia('(pointer: coarse)').matches;
const preventIfTouchScrollBlocked = (event: Event): void => {
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

window.addEventListener('keydown', (e: KeyboardEvent) => {
  const mapped = keyCodeMap[e.code];
  if (mapped !== undefined) {
    inputMask |= mapped;
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e: KeyboardEvent) => {
  const mapped = keyCodeMap[e.code];
  if (mapped !== undefined) {
    inputMask &= ~mapped;
    e.preventDefault();
  }
});

// Mouse input
// Tracks mouse position and button state, scaled to virtual 320×240 coordinates

const updateMouseFromClient = (clientX: number, clientY: number): void => {
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

  const x = clientX - rect.left - offsetX;
  const y = clientY - rect.top - offsetY;
  const scaleX = canvas.width / drawWidth;
  const scaleY = canvas.height / drawHeight;
  mouseX = Math.floor(x * scaleX);
  mouseY = Math.floor(y * scaleY);
};

// Update mouse position when cursor moves over canvas
canvas.addEventListener('mousemove', (e: MouseEvent) => {
  updateMouseFromClient(e.clientX, e.clientY);
});

// Set coordinates to -1 when mouse leaves canvas
canvas.addEventListener('mouseleave', () => {
  mouseX = -1;
  mouseY = -1;
});

function mapMouseButton(button: number): number {
  if (button < 0 || button > 2) return -1;
  return button === 2 ? 1 : button === 1 ? 2 : 0; // Map right button to bit 1
}

// Track button presses (bit 0=left, bit 1=right, bit 2=middle)
canvas.addEventListener('mousedown', (e: MouseEvent) => {
  const btn = mapMouseButton(e.button);
  if (btn !== -1) {
    mouseButtons |= 1 << btn;
    e.preventDefault();
  }
});

canvas.addEventListener('mouseup', (e: MouseEvent) => {
  const btn = mapMouseButton(e.button);
  if (btn !== -1) {
    mouseButtons &= ~(1 << btn);
    e.preventDefault();
  }
});

// Touch input: map taps to left mouse button.
canvas.addEventListener(
  'touchstart',
  (event: TouchEvent) => {
    preventIfTouchScrollBlocked(event);
    const touch = event.touches[0];
    if (!touch) return;
    updateMouseFromClient(touch.clientX, touch.clientY);
    mouseButtons |= 1;
  },
  { passive: false },
);

canvas.addEventListener(
  'touchmove',
  (event: TouchEvent) => {
    preventIfTouchScrollBlocked(event);
    const touch = event.touches[0];
    if (!touch) return;
    updateMouseFromClient(touch.clientX, touch.clientY);
  },
  { passive: false },
);

canvas.addEventListener(
  'touchend',
  (event: TouchEvent) => {
    preventIfTouchScrollBlocked(event);
    mouseButtons &= ~1;
    if (event.touches.length === 0) {
      mouseX = -1;
      mouseY = -1;
    }
  },
  { passive: false },
);

canvas.addEventListener(
  'touchcancel',
  (event: TouchEvent) => {
    preventIfTouchScrollBlocked(event);
    mouseButtons &= ~1;
    mouseX = -1;
    mouseY = -1;
  },
  { passive: false },
);

// Onscreen buttons

document
  .querySelectorAll<HTMLButtonElement>('[data-input]')
  .forEach((button) => {
    const input = button.dataset.input as keyof typeof keyMap | undefined;
    if (input && input in keyMap) {
      const press = () => {
        inputMask |= keyMap[input];
      };
      const release = () => {
        inputMask &= ~keyMap[input];
      };
      button.addEventListener(
        'touchstart',
        (event: TouchEvent) => {
          preventIfTouchScrollBlocked(event);
          press();
        },
        { passive: false },
      );
      button.addEventListener(
        'touchend',
        (event: TouchEvent) => {
          preventIfTouchScrollBlocked(event);
          release();
        },
        { passive: false },
      );
      button.addEventListener(
        'touchcancel',
        (event: TouchEvent) => {
          preventIfTouchScrollBlocked(event);
          release();
        },
        { passive: false },
      );
      button.addEventListener('mousedown', press);
      button.addEventListener('mouseup', release);
      button.addEventListener('mouseleave', release);
    }
  });

const pressStart = (event: Event): void => {
  preventIfTouchScrollBlocked(event);
  inputMask |= keyMap.start;
};
const releaseStart = (event: Event): void => {
  preventIfTouchScrollBlocked(event);
  inputMask &= ~keyMap.start;
};
canvas.addEventListener('mousedown', pressStart);
window.addEventListener('mouseup', releaseStart);

// Next button: switch to next game
document
  .querySelectorAll<HTMLButtonElement>("[data-action='next']")
  .forEach((button) => {
    const press = () => {
      const select = document.getElementById(
        'game-select',
      ) as HTMLSelectElement;
      if (select) {
        const options = Array.from(select.options);
        const idx = options.findIndex((opt) => opt.value === select.value);
        const nextIdx = (idx + 1) % options.length;
        select.selectedIndex = nextIdx;
        select.dispatchEvent(new Event('change'));
      }
    };
    button.addEventListener(
      'touchstart',
      (event: TouchEvent) => {
        preventIfTouchScrollBlocked(event);
        press();
      },
      { passive: false },
    );
    button.addEventListener('mousedown', press);
  });

// Prevent context menu on right-click
canvas.addEventListener('contextmenu', (e: MouseEvent) => {
  e.preventDefault();
});

// === Fixed Timestep Loop ===

// This ensures deterministic game logic regardless of actual frame rate
const TICK_HZ = 60; // Target simulation rate (60 updates per second)
const DT = 1000 / TICK_HZ; // Delta time per update (16.67ms)
const MAX_UPDATES = 5; // Safety cap to prevent spiral of death

let last = performance.now(); // Last frame timestamp
let acc = 0; // Time accumulator for fixed timestep

// === Dev Tools ===
let fps = 60;
let frameCount = 0;
let lastFpsUpdate = performance.now();

// Performance timing
let avgUpdateTime = 0;
let avgDrawTime = 0;
const PERF_SAMPLE_COUNT = 60; // Average over 60 frames
const updateTimeSamples: number[] = [];
const drawTimeSamples: number[] = [];

const fpsEl = requireElement<HTMLElement>('fps');
const updateTimeEl = requireElement<HTMLElement>('update-time');
const drawTimeEl = requireElement<HTMLElement>('draw-time');
const updatesEl = requireElement<HTMLElement>('updates');
const accEl = requireElement<HTMLElement>('acc');
const inputEl = requireElement<HTMLElement>('input');
const mouseEl = requireElement<HTMLElement>('mouse');
const mouseButtonsEl = requireElement<HTMLElement>('mouse-buttons');
const colorArgbEl = requireElement<HTMLElement>('color-argb');
const colorRgbEl = requireElement<HTMLElement>('color-rgb');
const colorSwatchEl = document.getElementById(
  'color-swatch',
) as HTMLSpanElement | null;
const rngSeedInput = document.getElementById(
  'rng-seed-input',
) as HTMLInputElement | null;
const rngSeedApply = document.getElementById(
  'rng-seed-apply',
) as HTMLButtonElement | null;
const rngSeedRandom = document.getElementById(
  'rng-seed-random',
) as HTMLButtonElement | null;

const applyRngSeedInput = (): void => {
  if (!rngSeedInput) return;
  // Capture the value immediately before any other operations
  const inputValue = rngSeedInput.value;
  try {
    const nextSeed = parseSeedValue(inputValue);
    setRngSeed(nextSeed);
    rngSeedInput.value = formatSeedHex(nextSeed);
    restartGame();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    addConsoleEntry('ERROR', `Invalid RNG seed: ${message}`);
  }
};

const randomizeRngSeed = (): void => {
  const nextSeed =
    (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
  setRngSeed(nextSeed);
  if (rngSeedInput) {
    rngSeedInput.value = formatSeedHex(nextSeed);
  }
  restartGame();
};

if (rngSeedApply) {
  rngSeedApply.addEventListener('click', applyRngSeedInput);
}

if (rngSeedRandom) {
  rngSeedRandom.addEventListener('click', randomizeRngSeed);
}

if (rngSeedInput) {
  rngSeedInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      applyRngSeedInput();
    }
  });
  rngSeedInput.value = formatSeedHex(getRngSeed());
}

// Pause game when tab is hidden, resume when visible
// This stops the animation loop entirely to save CPU when tab is in background
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab hidden - animation loop will stop naturally
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  } else {
    // Tab visible - restart animation loop
    if (!animationFrameId && !hasAborted) {
      last = performance.now(); // Reset reference time on resume
      acc = DT; // Start with one frame to ensure first frame runs update()
      animationFrameId = requestAnimationFrame(frame);
    }
  }
});

function frame(now: number): void {
  animationFrameId = null; // Clear ID since this frame is running

  // Stop if WASM has aborted
  if (hasAborted) {
    return;
  }

  if (!update || !draw) {
    hasAborted = true;
    addConsoleEntry('ERROR', 'Missing game lifecycle exports');
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

      update(); // Game logic update
      prevInputMask = inputMask; // Track previous input state
      prevMouseButtons = mouseButtons; // Track previous mouse state
      acc -= DT; // Consume one timestep
      updates++;

      totalUpdateTime += performance.now() - updateStart;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addConsoleEntry('ERROR', `Error in update(): ${message}`);
      if (e instanceof Error && e.stack) {
        console.error('Stack trace:', e.stack);
      }
      hasAborted = true;
      break;
    }
  }

  // If we hit the update cap, skip frames rather than spiraling
  // This prevents the game from freezing while trying to catch up
  if (updates >= MAX_UPDATES) {
    console.warn('Max updates reached, skipping frames');
    acc = 0; // Reset to prevent runaway
  }

  // Render current state (runs at display refresh rate)
  let drawTime = 0;
  if (!hasAborted) {
    try {
      const drawStart = performance.now();
      draw();
      ctx2d.putImageData(image, 0, 0);
      drawTime = performance.now() - drawStart;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      addConsoleEntry('ERROR', `Error in draw(): ${message}`);
      if (e instanceof Error && e.stack) {
        console.error('Stack trace:', e.stack);
      }
      hasAborted = true;
    }
  }

  // Update performance metrics (rolling average)
  function updatePerfMetric(samples: number[], newValue: number): number {
    samples.push(newValue);
    if (samples.length > PERF_SAMPLE_COUNT) samples.shift();
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }

  avgUpdateTime = updatePerfMetric(updateTimeSamples, totalUpdateTime);
  avgDrawTime = updatePerfMetric(drawTimeSamples, drawTime);

  // Update FPS counter
  frameCount++;
  if (now - lastFpsUpdate >= 1000) {
    fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
    frameCount = 0;
    lastFpsUpdate = now;
  }

  // Update dev tools panel
  fpsEl.textContent = String(fps);
  updateTimeEl.textContent = avgUpdateTime.toFixed(2);
  drawTimeEl.textContent = avgDrawTime.toFixed(2);
  updatesEl.textContent = String(updates);
  accEl.textContent = String(Math.round(acc));
  inputEl.textContent =
    '0x' + inputMask.toString(16).padStart(2, '0').toUpperCase();
  mouseEl.textContent = `${mouseX}, ${mouseY}`;
  mouseButtonsEl.textContent =
    '0x' + mouseButtons.toString(16).padStart(2, '0').toUpperCase();
  if (colorArgbEl && colorRgbEl) {
    if (
      mouseX >= 0 &&
      mouseX < SCREEN_WIDTH &&
      mouseY >= 0 &&
      mouseY < SCREEN_HEIGHT
    ) {
      const pixel = fb32[mouseY * SCREEN_WIDTH + mouseX] >>> 0;
      const r = pixel & 0xff;
      const g = (pixel >> 8) & 0xff;
      const b = (pixel >> 16) & 0xff;
      const a = (pixel >>> 24) & 0xff;
      const argb = '0x' + pixel.toString(16).toUpperCase().padStart(8, '0');
      const rgb =
        `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
      colorArgbEl.textContent = argb;
      colorRgbEl.textContent = rgb;
      if (colorSwatchEl) {
        const bgColor = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
        colorSwatchEl.style.setProperty(
          'background-color',
          bgColor,
          'important',
        );
      }
    } else {
      colorArgbEl.textContent = '--';
      colorRgbEl.textContent = '--';
      if (colorSwatchEl) {
        colorSwatchEl.style.setProperty(
          'background-color',
          'transparent',
          'important',
        );
      }
    }
  }
  if (
    rngSeedInput &&
    document.activeElement !== rngSeedInput &&
    document.activeElement !== rngSeedApply &&
    document.activeElement !== rngSeedRandom
  ) {
    rngSeedInput.value = formatSeedHex(getRngSeed());
  }

  // Continue the loop only if document is still visible and no abort occurred
  if (!document.hidden && !hasAborted) {
    animationFrameId = requestAnimationFrame(frame);
  }
}
