# TinyForge (AssemblyScript + WebAssembly)

A **simplified game platform** for rapidly prototyping and experimenting with 2D game ideas on the web.

The goal of this project is to provide a **streamlined game development environment** with a fixed resolution, fixed timestep, direct framebuffer access, and a strict separation between **runtime (host)** and **game (cartridge)**.

This is *not* a game engine and not a framework. It is intentionally minimal, opinionated, and low‑level.

---

## Design Goals

- **Console / Cartridge split**
  - The WASM file *is the cartridge* (code only)
  - The host (JavaScript) *is the console* (RAM, input, timing, rendering)

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
├─ host/                # The runtime (JavaScript + HTML)
│  ├─ index.html        # Canvas and page shell
│  └─ main.js           # Input, timing, rendering, WASM loader
│
├─ sdk/                # The game SDK (AssemblyScript)
│  ├─ index.ts          # SDK entry point
│  ├─ memory.ts         # Memory map and constants
│  ├─ input.ts          # Input functions
│  ├─ drawing.ts        # Drawing primitives
│  └─ ...               # Other SDK modules
│
├─ games/              # Game cartridges (AssemblyScript)
│  ├─ asconfig.json     # AssemblyScript configuration
│  ├─ minesweeper.ts    # Game code
│  └─ ...               # More games
│
├─ cartridges/         # Compiled WASM files
│  └─ minesweeper.wasm
│
└─ package.json        # Build scripts and dependencies
```

### `host/`
Owns everything that would be considered *hardware* on a real console:

- RAM allocation
- Frame timing
- Input devices
- Rendering
- Cartridge loading

### `games/`
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
0x04B010       2,048 B     Sprite Metadata (256 sprites × 8 bytes)
0x04B810       128 KB      Sprite Pixel Data (~128 KB, RGBA)
0x06B810       ~421 KB     Game RAM (available for game state)
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

**Sprite Metadata (0x04B010 - 0x04B80F):**
- 256 sprite entries × 8 bytes per entry
- Each entry:
  - `+0`: u16 width (pixels)
  - `+2`: u16 height (pixels)
  - `+4`: u32 dataOffset (relative to SPRITE_DATA_ADDR)

**Sprite Pixel Data (0x04B810 - 0x06B80F):**
- ~128 KB available for sprite pixel data
- Format: RGBA8888 (4 bytes per pixel)
- Managed by host, loaded from `assets/sprites/`

**Game RAM (0x06B810+):**
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
- All addresses are defined in `memory-map.ts` and shared between host and SDK

---

## Input Model

Input is **snapshot‑based**, not event‑based.

- The host collects keyboard state
- State is packed into a bitmask
- Both current and previous frame masks are passed to the cartridge
- This allows detecting button press vs. hold

The `Button` enum is provided by the console SDK:

```ts
import { Button } from './console';

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

The console SDK provides logging functions that output to the HTML console panel:

```ts
import { log, warn, error } from './console';

log("Player initialized");      // Blue entry [LOG]
warn("Health low");              // Yellow entry [WARN]
error("Invalid state");          // Red entry [ERROR]
```

**Important notes:**
- These functions accept **string literals only** (no dynamic strings)
- No string concatenation or interpolation is possible due to no-allocation constraints
- Use these for debugging and important state notifications
- All messages are timestamped in the console panel

**Examples:**

```ts
export function init(): void {
  log("Game started");
  // Initialize game state...
}

export function update(input: i32, prevInput: i32): void {
  if (playerHealth < 20) {
    warn("Low health");
  }
  
  if (invalidCondition) {
    error("Detected invalid state");
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

Files are **ID-based**: the filename must start with a number (0-255) which becomes the audio ID.

### Audio API

```ts
import { playSfx, playMusic, stopMusic } from './console';

// Play a sound effect
playSfx(sfxId: i32, volume: f32);  // volume: 0.0 - 1.0

// Play background music (loops automatically)
playMusic(musicId: i32, volume: f32);

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
  playMusic(0, 0.7);  // Will fail silently
}

// ✅ CORRECT - Called after user clicks start button
export function update(input: i32, prevInput: i32): void {
  if (startButtonPressed) {
    playMusic(0, 0.7);  // Works!
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
import { playSfx, playMusic, stopMusic } from './console';

// Audio IDs
enum SFX {
  JUMP = 0,
  COIN = 1,
  HIT = 2
}

enum Music {
  GAMEPLAY = 0,
  GAME_OVER = 1
}

let gameStarted = false;

export function update(input: i32, prevInput: i32): void {
  // Start music after user presses start
  if (!gameStarted && (input & Button.START)) {
    gameStarted = true;
    playMusic(Music.GAMEPLAY, 0.6);
  }
  
  // Play sound effects during gameplay
  const pressed = input & ~prevInput;
  if (pressed & Button.A) {
    playSfx(SFX.JUMP, 0.5);
  }
  
  // Stop music on game over
  if (playerDied) {
    stopMusic();
    playSfx(SFX.HIT, 0.8);
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
   ├─ 0-flag.png
   ├─ 1-player.png
   ├─ 2~4x3-tiles.png  # Sprite sheet: 4x3 grid
   └─ ...
```

**Single sprites:**
- Format: `{ID}-name.png` (e.g., `0-flag.png`)
- The numeric ID (0-255) becomes the sprite ID

**Sprite sheets:**
- Format: `{ID}~{COLS}x{ROWS}-name.png` (e.g., `10~4x3-tiles.png`)
- Automatically split into individual sprites
- Grid dimensions: COLS (across) × ROWS (down)
- Sprites assigned sequential IDs starting from base ID
- Order: left-to-right, top-to-bottom
- Everything after dimensions is optional/ignored

**Example sprite sheet:**
```
File: 10~4x3-tiles.png (128x96 pixels)
Grid: 4 columns × 3 rows = 12 sprites
Each sprite: 32×32 pixels
Assigned IDs: 10-21
```

**Supported formats:**
- PNG (with transparency)
- JPG (no transparency)

### Sprite API

```ts
import { drawSprite, drawSpriteFlip, drawSprite2x } from './console';

// Draw sprite at position
drawSprite(id: u32, x: i32, y: i32);

// Draw sprite with flipping
drawSpriteFlip(id: u8, x: i32, y: i32, flipH: bool, flipV: bool);

// Draw sprite scaled 2x
drawSprite2x(id: u8, x: i32, y: i32);
```

### Alpha Blending

The sprite system supports full alpha blending:

- **Fully transparent** (alpha = 0): Pixel is skipped
- **Fully opaque** (alpha = 255): Pixel is drawn directly (no blending)
- **Semi-transparent** (0 < alpha < 255): Pixel is alpha-blended with framebuffer

The blending formula is: `result = src * alpha + dst * (1 - alpha)`

All pixels written to the framebuffer have alpha = 255 (fully opaque).

### Performance Optimization

`drawSprite()` is optimized for performance:
- Calculates visible region once before drawing
- Only iterates over pixels that are on-screen
- Early exit if sprite is completely off-screen
- Skips per-pixel bounds checking in the loop

### Example Usage

```ts
import { drawSprite, drawSpriteFlip } from './console';

// Draw a flag sprite
drawSprite(0, 100, 100);

// Draw a player sprite facing left
drawSpriteFlip(1, 50, 50, true, false);

// Sprites with semi-transparent pixels will blend smoothly
drawSprite(2, 200, 150); // Shadow sprite with alpha = 128
```

### Notes

- Sprites are loaded at startup from `assets/sprites/`
- Maximum sprite ID: 255
- Sprite data is stored in dedicated memory region
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
import { clearFramebuffer, pset, Button, RAM_START } from './console';

// Game state persisted in RAM using @unmanaged struct
@unmanaged
class GameVars {
  x: i32;  // 0 - player x
  y: i32;  // 4 - player y
}

const gameVars = changetype<GameVars>(RAM_START);

// === lifecycle ===

export function init(): void {
  clearFramebuffer(0xff000000);

  // Initialize player position in RAM
  gameVars.x = 160;
  gameVars.y = 120;

  log("Starting!");
}

export function update(input: i32, prevInput: i32): void {
  // Movement logic - use buttonDown() for continuous movement
  if (input & Button.LEFT)  gameVars.x--;
  if (input & Button.RIGHT) gameVars.x++;
  if (input & Button.UP)    gameVars.y--;
  if (input & Button.DOWN)  gameVars.y++;
}

export function draw(): void {
  // Clear buffer
  clearFramebuffer(0x000000);
  // And draw point at player's position
  pset(gameVars.x, gameVars.y, c(0xffffff));
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

The project includes three games: **minesweeper**, **pong**, and **snake**. Each compiles to its own WASM file.

**Build all games:**
```
npm run build:debug
```

**Build individual games:**
```
npm run build:minesweeper:debug
npm run build:pong:debug
npm run build:snake:debug
```

**Production builds (optimized):**
```
npm run build
```

This creates:
- `cartridges/minesweeper.wasm`
- `cartridges/pong.wasm`
- `cartridges/snake.wasm`

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
http://localhost:8080/host/index.html
```

A VS Code Live Server or any static server also works.

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

**Why this constraint:**
- Guarantees deterministic execution (no GC pauses)
- Simplifies reasoning about memory layout
- Matches retro hardware programming model
- Enables save states and hot reload

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
