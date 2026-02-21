# TinyForge (AssemblyScript + WebAssembly)

A **simplified game platform** for rapidly prototyping and experimenting with 2D game ideas on the web.

The goal of this project is to provide a **streamlined game development environment** with a fixed resolution, fixed timestep, direct framebuffer access, and a strict separation between **runtime (host)** and **game (cartridge)**.

This is _not_ a game engine and not a framework. It is intentionally minimal, opinionated, and low‑level.

---

## Design Goals

- **Console / Cartridge split**
  - The WASM file _is the cartridge_ (code only)
  - The host (JavaScript) _is the console_ (RAM, input, timing, rendering)

- **Deterministic execution**
  - Fixed 60 Hz update loop
  - No clocks or async APIs exposed to the cartridge
  - Replay‑ and save‑state‑friendly by design

- **Direct framebuffer access**
  - 320 × 240 resolution
  - 32‑bit RGBA framebuffer (24‑bit color, alpha unused)
  - Cartridge writes pixels directly into shared memory

- **Web‑native**
  - Runs in any modern browser
  - Zero‑copy rendering via `<canvas>`
  - Simple HTML‑based dev tooling

- **Fast iteration**
  - Simple build pipeline
  - Designed for hot reload and debugging

---

## What This Is (and Is Not)

### This **is**:

- A simplified game platform for rapid prototyping
- A learning and experimentation platform
- A software‑rendered, pixel‑based system
- Close to retro hardware programming models

### This **is not**:

- A full game engine
- A scene graph or ECS framework
- A high‑performance GPU renderer
- A general WebAssembly application template

---

## High‑Level Architecture

```
┌──────────────────────────────┐
│        Host (JavaScript)     │
│  - Canvas rendering          │
│  - Input collection          │
│  - Fixed timestep            │
│  - RAM allocation            │
│  - Cartridge loading         │
└──────────────┬───────────────┘
               │ shared memory
┌──────────────┴───────────────┐
│   Cartridge (AssemblyScript) │
│  - Game logic                │
│  - Software rendering        │
│  - Deterministic state       │
└──────────────────────────────┘
```

The cartridge has **no access** to:

- DOM APIs
- Time
- Events
- Storage
- Rendering APIs

It only sees memory and exported functions.

---

## Project Structure

```
tinyforge/
├─ index.html           # Canvas and page shell
├─ memory-viewer.html   # Memory inspector UI
├─ styles.css           # Host styling
├─ stylesVC.css         # Virtual console controls styling (mobile and WPA)
├─ icons/
│  └─ favicon.svg
│
├─ src/
│  ├─ web/              # Host runtime (TypeScript)
│  ├─ assembly/
│  │  ├─ sdk/           # Game SDK (AssemblyScript)
│  │  ├─ games/         # Game cartridges (AssemblyScript)
│  │  └─ tsconfig.json  # AssemblyScript config
│  └─ memory-map.ts     # Shared memory constants
│
├─ dist/
│  ├─ web/              # Compiled host JS
│  └─ memory-map.js
├─ assets/
│  └─ cartridges/       # Compiled WASM files
│
└─ package.json         # Build scripts and dependencies
```

### `src/web/`

Owns everything that would be considered _hardware_ on a real console:

- RAM allocation
- Frame timing
- Input devices
- Rendering
- Cartridge loading

#### Game selector (WASM auto-discovery)

The host populates the game dropdown by fetching the `assets/cartridges/` directory
listing and extracting `.wasm` filenames. This is meant for local dev servers
that expose directory indexes. If your hosting setup hides directory listings,
add a fallback list or provide a manifest endpoint.

### `src/assembly/games/`

Contains only game code:

- Update logic
- Drawing logic
- Direct writes to the framebuffer

The cartridge is treated as **ROM‑like code**.

---

## Framebuffer

- Resolution: **320 × 240**
- Format: **RGBA8888** (little-endian)
- Size: **307,200 bytes**

```
Offset 0x000000 ──────────────────────
Framebuffer (320 × 240 × 4)
```

Pixels are written directly by the cartridge using integer math.

The host creates a zero-copy `ImageData` view into WASM memory and blits it to a `<canvas>`.

---

## Memory Map

The console exposes a **fixed, shared linear memory** to the cartridge.

All offsets are **absolute** and part of the hardware contract.

```
Address        Size        Description
----------------------------------------------
0x000000       307,200 B   Framebuffer (RGBA8888, 320×240×4)
0x04B000       2 B         Keyboard Input (current + previous buttons)
0x04B008       6 B         Mouse Input (x, y, current + previous buttons)
0x04B010       16 B        Sprite Table Header
0x04B020       N entries   Sprite Name Lookup (N × 32 bytes)
...           N entries   Sprite Info Table (N × 16 bytes)
...           ~128 KB      Sprite Pixel Data (RGBA)
0x06B810       4 B         SDK RNG Seed (i32)
0x06B814       ~82 KB      Game RAM (available for game state)
```

**Detailed Layout:**

**Framebuffer (0x000000 - 0x04AFFF):**

- 320 × 240 × 4 bytes = 307,200 bytes
- Format: RGBA8888 (little-endian)
- Write-only for cartridge

**Keyboard Input (0x04B000 - 0x04B007):**

- `+0`: u8 current button state (bitmask)
- `+1`: u8 previous button state (for edge detection)

**Mouse Input (0x04B008 - 0x04B00F):**

- `+0`: i16 mouse X coordinate (-1 if outside canvas)
- `+2`: i16 mouse Y coordinate (-1 if outside canvas)
- `+4`: u8 current button state (bit 0=left, 1=right, 2=middle)
- `+5`: u8 previous button state (for edge detection)

**Sprite Tables (0x04B010+):**

- Table header (16 bytes):
  - `+0`: u16 entry count (N)
  - `+4`: u32 name lookup offset (from table base)
  - `+8`: u32 info table offset (from table base)
  - `+12`: u32 pixel data offset (from table base)
- Name lookup table (N entries, UTF-16, max 16 chars = 32 bytes each)
- Sprite info table (N entries, 16 bytes each):
  - `+0`: u32 dataOffset (absolute address)
  - `+4`: u32 dataSize (bytes per frame)
  - `+8`: u16 width
  - `+10`: u16 height
  - `+12`: u8 cols
  - `+13`: u8 rows

**Sprite Pixel Data (follows info table):**

- RGBA8888 (4 bytes per pixel)
- Managed by host, loaded from `assets/sprites/`

**SDK RNG Seed (0x06B810 - 0x06B813):**

- 4-byte u32 seed used by SDK `random()` and `randomRange()`
- Initialized by the host and editable in devtools

**Game RAM (0x06B814+):**

- Available for game state, variables, and data structures
- Use `RAM_START` constant from SDK
- Store persistent game state here (not in module variables)
- Use `@unmanaged` structs with `changetype<T>(RAM_START)` for type-safe access

**Notes:**

- Memory is allocated by the **host (JS)** at 1 MB total (16 pages)
- Memory size is fixed at startup
- Memory does **not** grow at runtime
- The framebuffer region should be treated as write-only by the cartridge
- Input/mouse regions are read-only for the cartridge (written by host)
- Sprite data is managed by the host (cartridge uses sprite IDs)
- All addresses are defined in `src/memory-map.ts` and shared between host and SDK

---

## Input Model

Input is **snapshot‑based**, not event‑based.

- The host collects keyboard state
- State is packed into a bitmask
- Both current and previous frame masks are passed to the cartridge
- This allows detecting button press vs. hold

The `Button` enum is provided by the console SDK:

```ts
import { Button } from "./console";

// Button values:
// UP = 1 << 0, DOWN = 1 << 1, LEFT = 1 << 2, RIGHT = 1 << 3
// A = 1 << 4, B = 1 << 5, START = 1 << 6
```

Detecting button press (not hold):

```ts
export function update(input: i32, prevInput: i32): void {
  const pressed = input & ~prevInput;
  if (pressed & Button.A) {
    // A was just pressed this frame
  }
}
```

The cartridge never sees individual key events.

---

## Console Logging

The console SDK provides logging functions that output to the HTML console panel.

### Basic Logging (String Literals Only)

```ts
import { log, warn, error } from "./console";

log("Player initialized"); // Blue entry [LOG]
warn("Health low"); // Yellow entry [WARN]
error("Invalid state"); // Red entry [ERROR]
```

### Logging with Parameters (Zero Allocation)

To log dynamic values without string concatenation, use the interpolation variants:

```ts
import { logi, logf, warni, warnf, errori, errorf } from "./console";

// Integer parameters (i64)
logi("Score: {}, Lives: {}", score, lives);
warni("Low health: {}", health);
errori("Invalid state: {}", state);

// Floating-point parameters (f64)
logf("Position: ({}, {})", playerX, playerY);
warnf("Low speed: {}", velocity);
errorf("Invalid position: {}", x);
```

**Available functions:**

- `logi()`, `warni()`, `errori()` - Accept up to 4 integer parameters (i64)
- `logf()`, `warnf()`, `errorf()` - Accept up to 4 floating-point parameters (f64)
- Use `{}` as placeholders in the message string
- Parameters are interpolated on the JavaScript side (zero allocation in WASM)

**Important notes:**

- All functions accept **string literals only** for the message
- No string concatenation or manipulation in WASM
- Parameters are automatically converted to strings by the host
- All messages are timestamped in the console panel

**Examples:**

```ts
export function init(): void {
  log("Game started");
  logi("Level: {}", currentLevel);
}

export function update(input: i32, prevInput: i32): void {
  if (playerHealth < 20) {
    warni("Low health: {}", playerHealth);
  }

  if (score > highScore) {
    logi("New high score: {} (old: {})", score, highScore);
  }

  if (invalidCondition) {
    errori("Invalid state: {}", gameState);
  }
}
```

Each log type appears with a distinct color in the console panel below the game canvas.

---

## Audio System

The console provides a Web Audio API-based audio system with support for sound effects and background music.

### Audio Files

Audio files are organized in two directories:

```
assets/
├─ sfx/           # Sound effects
│  ├─ 0-tap.wav
│  ├─ 1-explosion.wav
│  └─ ...
└─ music/         # Background music
   ├─ 0-gameplay.wav
   └─ ...
```

Files are **ID-based**: the filename ID is a string parsed from the prefix before `~`/`-`.
Only the ID is required, and it must be ≤ 16 characters.

### Audio API

```ts
import { playSfx, playMusic, stopMusic } from './console';

// Play a sound effect
playSfx(sfxId: string, volume: f32);  // volume: 0.0 - 1.0

// Play background music (loops automatically)
playMusic(musicId: string, volume: f32);

// Stop background music
stopMusic();
```

### Browser Autoplay Policy

**⚠️ CRITICAL:** Browsers prevent audio from playing until after a user interaction (click, key press, etc.).

**This means:**

- Audio files load during startup
- Audio **will not play** until the user interacts with the page
- Calling `playMusic()` in `init()` will fail silently

**Best Practice:**

```ts
// ❌ WRONG - Called in init(), before user interaction
export function init(): void {
  playMusic("gameplay", 0.7); // Will fail silently
}

// ✅ CORRECT - Called after user clicks start button
export function update(input: i32, prevInput: i32): void {
  if (startButtonPressed) {
    playMusic("gameplay", 0.7); // Works!
  }
}
```

**Standard pattern:**

1. Show a "Press Start" screen in `init()`
2. Wait for user to click or press a button
3. Start music in `update()` after detecting the button press
4. Play sound effects normally during gameplay

### Example Usage

```ts
import { playSfx, playMusic, stopMusic } from "./console";

// Audio IDs
const SFX_JUMP = "jump";
const SFX_COIN = "coin";
const SFX_HIT = "hit";

const MUSIC_GAMEPLAY = "gameplay";
const MUSIC_GAME_OVER = "game_over";

let gameStarted = false;

export function update(input: i32, prevInput: i32): void {
  // Start music after user presses start
  if (!gameStarted && input & Button.START) {
    gameStarted = true;
    playMusic(MUSIC_GAMEPLAY, 0.6);
  }

  // Play sound effects during gameplay
  const pressed = input & ~prevInput;
  if (pressed & Button.A) {
    playSfx(SFX_JUMP, 0.5);
  }

  // Stop music on game over
  if (playerDied) {
    stopMusic();
    playSfx(SFX_HIT, 0.8);
  }
}
```

### Notes

- Music loops automatically until `stopMusic()` is called
- Multiple sound effects can play simultaneously
- Only one music track plays at a time
- Volume range: `0.0` (silent) to `1.0` (full volume)
- Audio files are loaded at startup but decoded on-demand after first interaction

---

## Sprite System

The console provides a sprite system for drawing images with transparency and alpha blending support.

### Sprite Files

Sprite images are stored in the `assets/sprites/` directory:

```
assets/
└─ sprites/         # Sprite images
   ├─ flag.png
   ├─ player-test#1.png
   ├─ someTiles~4x3.png  # Sprite sheet: 4x3 grid
   └─ ...
```

**Single sprites:**

- Format: `{id}.png`, `{id}-{info}.png`, or `{id}~{props}.png`
- The string `id` (≤ 16 chars) becomes the sprite name

**Sprite sheets:**

- Format: `{id}~{COLS}x{ROWS}-name.png` (e.g., `tiles~4x3.png`)
- Automatically split into frames
- Grid dimensions: COLS (across) × ROWS (down)
- Order: left-to-right, top-to-bottom
- Everything after dimensions is optional/ignored

**Example sprite sheet:**

```
File: tiles~4x3.png (128x96 pixels)
Grid: 4 columns × 3 rows = 12 sprites
Each sprite: 32×32 pixels
```

**Supported formats:**

- PNG (with transparency)
- JPG (no transparency)

### Sprite API

```ts
import { drawSprite, s } from './console';

// Resolve sprite by name (and optional sheet coords)
s(name: string, x: i32 = 0, y: i32 = 0): i32;

// Draw sprite at position (packed ID from s())
drawSprite(id: i32, x: i32, y: i32, flipX?: bool, flipY?: bool);
```

### Alpha Blending

The sprite system supports full alpha blending:

- **Fully transparent** (alpha = 0): Pixel is skipped
- **Fully opaque** (alpha = 255): Pixel is drawn directly (no blending)
- **Semi-transparent** (0 < alpha < 255): Pixel is alpha-blended with framebuffer

The blending formula is: `result = src * alpha + dst * (1 - alpha)`

All pixels written to the framebuffer have alpha = 255 (fully opaque).

### Example Usage

```ts
import { drawSprite, s } from "./console";

// Draw a single sprite
drawSprite(s("flag"), 100, 100);

// Draw a sprite sheet frame (column, row)
drawSprite(s("tiles", 1, 0), 50, 50, true, false);

// Sprites with semi-transparent pixels will blend smoothly
drawSprite(s("shadow"), 200, 150); // Shadow sprite with alpha = 128
```

### Notes

- Sprites are loaded at startup from `assets/sprites/`
- Maximum sprite entries: 256
- Sprite data is stored after the sprite tables in shared memory
- Transparency is handled automatically
- Alpha blending works with any alpha value (0-255)

---

## Timing Model

- Fixed timestep: **60 Hz**
- Update and render are decoupled
- The host owns all timing

Flow:

```
while accumulator >= dt:
  update(input)

draw()
blit framebuffer
```

This guarantees deterministic simulation regardless of frame rate.

---

## Memory Ownership

Memory is **allocated by the host**, not the cartridge.

- The host creates a fixed `WebAssembly.Memory`
- The cartridge imports it
- Memory does not grow at runtime

This mirrors real hardware:

- Console owns RAM
- Cartridge assumes a known memory map

This also enables:

- Hot reload
- Save states
- Memory inspection

---

## Writing a Cartridge (Quickstart)

A cartridge is a **pure AssemblyScript module** that:

- Imports the console SDK (`console.ts`)
- Exports a small, fixed API (`init`, `update`, `draw`, `WIDTH`, `HEIGHT`)
- Writes directly to the framebuffer
- Stores game state in RAM (not module variables)

The SDK provides:

- Memory declarations and memory map constants
- Display constants (WIDTH, HEIGHT)
- Input constants (Button enum)
- Console logging functions (log, warn, error)

### Minimal cartridge

```ts
import { clearFramebuffer, pset, Button, RAM_START } from "./console";

// Game state persisted in RAM using @unmanaged struct
@unmanaged
class Vars {
  x: i32; // 0 - player x
  y: i32; // 4 - player y
}

const vars = changetype<Vars>(RAM_START);

// === lifecycle ===

export function init(): void {
  clearFramebuffer(0xff000000);

  // Initialize player position in RAM
  vars.x = 160;
  vars.y = 120;

  log("Starting!");
}

export function update(input: i32, prevInput: i32): void {
  // Movement logic - use buttonDown() for continuous movement
  if (input & Button.LEFT) vars.x--;
  if (input & Button.RIGHT) vars.x++;
  if (input & Button.UP) vars.y--;
  if (input & Button.DOWN) vars.y++;
}

export function draw(): void {
  // Clear buffer
  clearFramebuffer(0x000000);
  // And draw point at player's position
  pset(vars.x, vars.y, c(0xffffff));
}
```

**Why @unmanaged structs?**

The `@unmanaged` decorator tells AssemblyScript to not use automatic memory management for this class. This allows us to:

- Cast a memory address directly to a struct type using `changetype<T>(address)`
- Access game state as struct fields instead of manual offset calculations
- Get better type safety and IDE autocomplete
- Avoid manual `getI32`/`setI32` calls for every variable access

**Important notes:**

- Struct fields are laid out sequentially in memory (x at offset 0, y at offset 4)
- The struct size must fit within your allocated RAM region
- All cartridges share the same RAM starting at `RAM_START`

The cartridge:

- Has no access to time
- Has no access to events
- Has no access to rendering APIs

All interaction happens through memory and exported functions.

---

## Building the Cartridge

### Prerequisites

- Node.js
- AssemblyScript

### Install Dependencies

From the project root:

```
npm install
```

### Build

**Build everything (games + host):**

```
npm run build
```

**Build all games (WASM only):**

```
npm run build:games
```

**Build a single game (WASM only):**

```
npm run build:games gameName
```

`gameName` must be the exact `.ts` filename without the extension.

**Build all games (debug):**

```
npm run build:debug
```

**Build host only (web runtime):**

```
npm run build:host
```

### Watch (build on save)

**Web runtime:**

```
npm run watch:host
```

**WASM games:**

```
npm run watch:games
```

### Available Scripts

**Build scripts:**

- `npm run build` - Build everything (host + all games), then upload
- `npm run build:host` - Build only the web runtime (TypeScript → JavaScript), then upload
- `npm run build:games` - Build all games (AssemblyScript → WASM), then upload
- `npm run build:games <gameName>` - Build a single game by name (e.g., `npm run build:games snake`)
- `npm run build:debug` - Build all games with debug symbols and source maps

**Watch scripts:**

- `npm run watch:host` - Auto-rebuild host on file changes
- `npm run watch:games` - Auto-rebuild games on file changes

**Development scripts:**

- `npm run serve` - Start local HTTP server on port 8080
- `npm run dev` - Build everything, then start server

**Utility scripts:**

- `npm run upload` - Manually trigger FTP upload to remote server
- `npm run check:alloc <gameName>` - Check a game for memory allocation symbols

### Checking for Memory Allocation

The `check:alloc` script helps verify that your game doesn't contain any dynamic memory allocation:

```bash
npm run check:alloc <gameName>
```

**What it does:**

- Builds a debug version of the specified game
- Uses `wasm-objdump` to inspect the WASM binary
- Searches for allocation-related symbols: `__new`, `__alloc`, `__realloc`, `__free`, `memory.grow`, `malloc`
- Reports any found symbols (indicating allocation code)

**Prerequisites:**

- Requires `wasm-objdump` to be installed and in your PATH
- Part of the WebAssembly Binary Toolkit (WABT): https://github.com/WebAssembly/wabt

**Example usage:**

```bash
npm run check:alloc snake
# Output: "No allocation symbols found." (good!)

npm run check:alloc myGame
# Output: "Found allocation symbol: __new" (bad - fix allocation code!)
```

**When to use:**

- After writing new game code with arrays or strings
- When debugging runtime errors related to missing `__new` function
- To validate that zero-allocation patterns are working correctly
- Before committing new games

**Troubleshooting:**

- If `wasm-objdump` is not found, install WABT for your platform
- The script builds to `tmp/debug-builds/` to avoid overwriting production builds
- Debug builds include all symbols, making allocation detection reliable

### Switching Games

The console includes a game selector in the devtools panel. Use the dropdown to select a game and click "Load Game" to switch between cartridges at runtime without refreshing the page.

---

## Running the Console

You must serve the project over **HTTP** (not `file://`).

### Simple local server

From the project root:

```
python -m http.server 8080
```

Then open:

```
http://localhost:8080/index.html
```

A VS Code Live Server or any static server also works.

---

## FTP Upload

Builds trigger an FTP sync via the `postbuild`, `postbuild:games`, and `postbuild:host` hooks.

### Credentials

Create a `.env` file in the project root:

```
FTP_HOST=yourdomain.com
FTP_USER=username
FTP_PASS=password
```

The file is ignored by Git.

### What Gets Synced

- `dist/` → `/dist`
- `*.html`, `*.css`, `manifest.json`, `sw.js` → `/`

### Manual Upload

```
npm run upload
```

---

## Development Notes

### No Dynamic Allocation

The cartridge uses `--runtime stub` which provides **zero heap allocation**.

**This is enforced at runtime (not compile time):**

- `lowMemoryLimit: 0` - No heap memory available
- `memoryBase: 0` - No runtime bookkeeping memory
- `exportRuntime: false` - No runtime functions exported
- If allocation code exists, the WASM will fail to instantiate (missing `__new` function)
- AssemblyScript does not prevent writing allocation code, it just won't run

**What you CANNOT use:**

- `new Array()`, `new String()`, `new Object()`
- String concatenation or manipulation
- Closures that capture variables
- Any standard library function that allocates

**What you CAN use:**

- Primitive types: `i32`, `f32`, `u32`, `i64`, etc.
- `load<T>()` and `store<T>()` for memory access
- Local variables (stored on the stack)
- Inline functions
- Fixed-size loops
- **Zero-allocation utilities** (see below)

**Why this constraint:**

- Guarantees deterministic execution (no GC pauses)
- Simplifies reasoning about memory layout
- Matches retro hardware programming model
- Enables save states and hot reload

### Zero-Allocation Utilities

The SDK provides utilities that work within the no-allocation constraint:

#### Logging with Dynamic Values

Instead of string concatenation:

```ts
// ❌ WRONG - This allocates memory!
warn("Crocodile " + index.toString() + " not found");

// ✅ CORRECT - Zero allocation
warni("Crocodile {} not found", index);
```

Use `logi/logf`, `warni/warnf`, `errori/errorf` for interpolation (see Console Logging section).

#### Fixed-Size Arrays

**`FixedArray<T>`** - Zero-allocation array backed by pre-allocated memory:

```ts
import { FixedArray } from "./console";

// Calculate memory size needed
const GRID_SIZE = 100;
const gridBytes = FixedArray.sizeInMemory<u8>(GRID_SIZE); // 100 bytes

// Reserve memory in your RAM layout
@unmanaged
class Vars {
  playerX: i32; // 0
  playerY: i32; // 4
  // Grid data starts at offset 8
}

// Create array view over pre-allocated memory
const grid = FixedArray.fromAddress<u8>(RAM_START + 8);

// Use like a normal array
grid.set(10, 42);
const val = grid.get(10);
grid.fill(0, GRID_SIZE);

// Or use bracket notation
grid[10] = 42;
const val = grid[10];
```

**`FixedArrayWithCount<T, U>`** - Array with dynamic length tracking:

```ts
import { FixedArrayWithCount } from "./console";

// Calculate memory size (includes metadata)
const CAPACITY = 50;
const size = FixedArrayWithCount.sizeInMemory<u16>(CAPACITY); // 4 + 100 = 104 bytes

// Create array with length tracking
const items = FixedArrayWithCount.fromAddress<u16>(RAM_START + 200);
items.capacity = CAPACITY;
items.clear();

// Dynamic operations
items.push(42); // Add element
const val = items.get(0); // Get element (42)
const len = items.length; // Current length (1)
const found = items.includes(42); // Search (true)
items.clear(); // Reset to empty

// Bracket notation supported
items[0] = 99;
const x = items[0];
```

**Key differences:**

- `FixedArray<T>` - No metadata, just raw array data. You manage length manually.
- `FixedArrayWithCount<T, U>` - Includes `length` and `capacity` metadata (2 \* sizeof\<U\> bytes).
- Both use `@unmanaged` pattern - no heap allocation, just memory reinterpretation.
- Memory must be pre-allocated in your game's RAM layout.
- Use `U = u8` for small arrays (max 255 elements), `U = u16` for larger (max 65535).

#### Vec2i Helper Class

**`Vec2i`** - 2D integer vector for coordinate pairs:

```ts
import { Vec2i, RAM_START } from "./console";

// WARNING: Using 'new Vec2i()' allocates memory!
// For zero allocation, pre-allocate in RAM and use fromAddress()

// Define RAM layout (Vec2i needs 8 bytes: x and y as i32)
enum Var {
  PLAYER_POS = 0, // 8 bytes
  ENEMY_POS = 8, // 8 bytes
}

// ❌ WRONG - This allocates memory!
const pos = new Vec2i(10, 20);

// ✅ CORRECT - Zero allocation
const playerPos = Vec2i.fromAddress(RAM_START + Var.PLAYER_POS);
playerPos.x = 10;
playerPos.y = 20;

const enemyPos = Vec2i.fromAddress(RAM_START + Var.ENEMY_POS);
enemyPos.set(50, 100); // Set both coordinates at once
```

**Important:** Even though `Vec2i` is marked `@unmanaged`, the `new` keyword still triggers allocation. Always use `fromAddress()` for zero-allocation access to pre-allocated memory.

#### Text Rendering

The SDK provides `drawString()` and `drawNumber()` for rendering text:

```ts
import { drawString, drawNumber } from "./console";

// Draw text (UPPERCASE ONLY)
drawString(10, 10, "SCORE:", 0xffffffff);
drawNumber(60, 10, score, 0xffffffff);
```

**Important limitations:**

- `drawString()` only supports **UPPERCASE letters (A-Z)**, numbers (0-9), and punctuation
- Supported punctuation: `:!?.,-/\`'+\_\*[]()"`
- Lowercase letters will not render correctly
- Always use uppercase strings: `"GAME OVER"` not `"Game Over"`
- Characters are 6×10 pixels, spaced 8 pixels apart horizontally
- Use `drawNumber()` for rendering integer values without string allocation

### Other Guidelines

- No floating‑point math in hot paths
- Prefer integer arithmetic
- Think like a software renderer
- **Store game state in RAM** (using load/store), not module variables
  - This enables hot reload and save states
  - Module variables don't persist across WASM reloads

This project intentionally favors **clarity and control** over abstraction.

---

## Planned / Possible Extensions

- **Build-time allocation detection**
  - Pre-build linting to catch dynamic allocation such as `new Array()`, `new String()`, etc.
  - TypeScript type deprecation for forbidden constructs
- Sprite blitter helpers
- Tilemap helpers
- Hot reload preserving RAM
- Save states and replays

None of these are required to make games.

---

## Philosophy

This project treats WebAssembly as a **virtual console CPU**, not as a web optimization target.

Constraints are a feature.

By removing time, events, and rendering APIs from the cartridge, games become:

- Easier to reason about
- Easier to debug
- Easier to replay
- Easier to port

If you enjoy programming close to the metal, this project is for you.

---

## License

MIT (or choose your own)

---

Happy hacking 🚀
