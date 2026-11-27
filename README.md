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

The repo is a pnpm workspace. The engine (SDK, games, memory map) is shared by
two hosts that live side by side: the classic host that is deployed today, and
the new editor.

```
tinyforge/
├─ packages/
│  ├─ engine/                 # Shared by both hosts
│  │  ├─ assembly/
│  │  │  ├─ sdk/              # Game SDK (AssemblyScript)
│  │  │  ├─ games/            # One folder per game (<name>/main.ts) + asconfig.json
│  │  │  └─ tsconfig.json     # AssemblyScript config
│  │  ├─ memory-map.ts        # Shared memory constants
│  │  └─ tooling/             # compiler.ts (browser Worker and Node), compile-game.ts (Node, from disk)
│  ├─ runtime/                # Host runtime in plain TS, no DOM (Worker/Node)
│  └─ editor-core/            # Editor logic, no React: Workspace, compiler and game Workers, code editor
│
├─ apps/
│  ├─ classic/                # The current host, deployed to the site root
│  │  ├─ index.html, memory-viewer.html, styles.css, stylesVC.css, sw.js, manifest.json
│  │  ├─ icons/
│  │  ├─ src/                 # Host runtime (TypeScript)
│  │  └─ dist/                # Compiled host JS (generated)
│  └─ editor/                 # The new editor (Vite + React + Dockview)
│
├─ assets/                    # Sprites, sfx, music (shared by both hosts)
│  └─ cartridges/             # Compiled WASM files for the classic host (generated)
├─ scripts/                   # Build, watch, serve, upload
└─ package.json               # Workspace scripts
```

### `apps/classic/src/`

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

### `packages/engine/assembly/games/`

Contains only game code:

- Update logic
- Drawing logic
- Direct writes to the framebuffer

The cartridge is treated as **ROM‑like code**.

#### Game File Organization

Each game is a folder named after the game, with its entry file `main.ts`.

**Entry file:** `{gameName}/main.ts`

Contains the exported lifecycle functions `init()`, `update()`, `draw()`, and
the game's metadata as top-level string literals, read by the TinyForge tooling:

```ts
const TITLE = "Pong";
const DESCRIPTION = "Two-player pong with horizontal paddles";
const AUTHOR = "Olivier Basille";
```

**Supporting files:** any other `.ts` files in the same folder, imported with
`./` paths. The SDK is imported from `../../sdk`.

Example structure:

```
packages/engine/assembly/games/
├─ asconfig.json           # Build settings shared by all games
├─ pong/
│  └─ main.ts
└─ crocodiles/
   ├─ main.ts              # Entry file
   ├─ player.ts            # Supporting files
   ├─ types.ts
   └─ ...
```

The cartridge is built as `{gameName}.wasm`. A file anywhere in a game's folder
only triggers a rebuild of that game.

This keeps game code organized and isolated from other games.

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

Each game gets the memory it needs. The layout below is **layout version 1**
(`LAYOUT_VERSION` in `packages/engine/memory-map.ts`). Every cartridge records
the layout version it was built for, its RAM size and its minimum memory in a
`tinyforge.meta` custom section, and the host sizes memory from that.

```
Address              Size          Description
---------------------------------------------------------------
0x000000             307,200 B     Framebuffer (RGBA8888, 320×240×4)
0x04B000             4 B           Keyboard input (current + previous buttons, u16 each)
0x04B008             6 B           Mouse input (x, y, current + previous buttons)
0x04B010             4 B           Sprite table pointer (u32, written by the host)
0x04B014             4 B           SDK RNG seed (u32)
0x04B018 - 0x04FFFF  ~20 KB        Spare room in the system block, for later versions
0x050000             RAM_SIZE      Game RAM (RAM_START), 72 KB unless the game declares RAM_SIZE
RAM_START + RAM_SIZE ...           Cartridge static data (AssemblyScript memoryBase)
end of static data   as needed     Sprite table and pixels (the game's sprites only)
```

**Framebuffer (0x000000 - 0x04AFFF):**

- 320 × 240 × 4 bytes = 307,200 bytes
- Format: RGBA8888 (little-endian)
- Write-only for cartridge

**Keyboard Input (0x04B000 - 0x04B007):**

- `+0`: u16 current button state (bitmask, little-endian)
- `+2`: u16 previous button state (for edge detection)

**Mouse Input (0x04B008 - 0x04B00F):**

- `+0`: i16 mouse X coordinate (-1 if outside canvas)
- `+2`: i16 mouse Y coordinate (-1 if outside canvas)
- `+4`: u8 current button state (bit 0=left, 1=right, 2=middle)
- `+5`: u8 previous button state (for edge detection)

**Sprite table pointer (0x04B010) and table:**

- The host writes the table right after the game's static data and stores its
  address here; the SDK reads it from this slot (0 means no sprites).
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
- Pixel data (RGBA8888) follows the info table. It holds only the sprites the
  game uses, with no fixed cap (up to 256 entries).

**SDK RNG Seed (0x04B014 - 0x04B017):**

- 4-byte u32 seed used by SDK `random()` and `randomRange()`
- Initialized by the host and editable in devtools

**Game RAM (0x050000, `RAM_START`):**

- Available for game state, variables, and data structures
- Its size is set per game in `main.ts`, as a number literal (a multiple of 16):
  `const RAM_SIZE: i32 = 0x2000;`. Without it, a game gets 72 KB (`DEFAULT_RAM_SIZE`).
- Static data starts right after it, so writing past `RAM_SIZE` corrupts the
  game's own string literals and constants.
- Store persistent game state here (not in module variables)
- Use `@unmanaged` structs with `changetype<T>(RAM_START)` for type-safe access
- `getU8()`, `setI32()` and the like take an **offset** from `RAM_START`, not an address

**Notes:**

- Memory is allocated by the **host (JS)**: the module's declared minimum (end
  of its static data) plus the sprite table, rounded up to 64 KB pages
- `compileGame` sets `memoryBase` to `RAM_START + RAM_SIZE` for each game
- Memory can grow while a game runs, for example when the editor reloads a
  larger sprite; game RAM never moves, so hot reload keeps state. Changing
  `RAM_SIZE` restarts the game.
- Hosts read addresses from the cartridge's layout version
  (`packages/runtime/src/layout.ts`), so a later layout can move things
  without breaking cartridges built for this one. A cartridge without
  `tinyforge.meta` is refused: rebuild it.
- The framebuffer region should be treated as write-only by the cartridge
- Input/mouse regions are read-only for the cartridge (written by host)
- Sprite data is managed by the host (cartridge uses sprite IDs)
- All addresses are defined in `packages/engine/memory-map.ts` and shared between host and SDK

---

## Input Model

Input is **snapshot‑based**, not event‑based.

- The host collects keyboard state
- State is packed into a bitmask
- Before each `update()`, the host writes the current and previous frame masks to input memory (`INPUT_ADDR`)
- The SDK reads them for you, which allows detecting button press vs. hold

The `Button` enum is provided by the SDK:

```ts
import { Button, buttonDown, buttonPressed } from "../../sdk";

// Button values:
// UP = 1 << 0, DOWN = 1 << 1, LEFT = 1 << 2, RIGHT = 1 << 3
// A = 1 << 4, B = 1 << 5, START = 1 << 6, X = 1 << 7, Y = 1 << 8
// LT = 1 << 9, RT = 1 << 10
// P2_UP = Y, P2_DOWN = A, P2_LEFT = X, P2_RIGHT = B
// P1_FIRE = RT, P2_FIRE = LT
```

Default keys (both hosts):

| Button | Key | As player 2's D-pad |
| --- | --- | --- |
| UP / DOWN / LEFT / RIGHT | Arrow keys | |
| Y | W | `P2_UP` |
| X | A | `P2_LEFT` |
| A | S (also Z) | `P2_DOWN` |
| B | D (also X) | `P2_RIGHT` |
| START | Enter or Space | |
| LT (left trigger) | Left Ctrl | `P2_FIRE` |
| RT (right trigger) | Right Ctrl | `P1_FIRE` |

The four action buttons sit in a diamond on WASD, so a two-player game can
give player 1 the arrow keys and player 2 the WASD keys. Read player 2 with
`buttonDown(Button.P2_LEFT)` and friends, or with the axis helpers
`p2AxisX()` / `p2AxisY()` (-1, 0 or 1; `p1AxisX()` / `p1AxisY()` do the same
for the arrows). A single-player game can use all four as action buttons.

The triggers give each player a fire or dash key next to their hand:
`Button.P2_FIRE` (Left Ctrl) for the WASD player and `Button.P1_FIRE`
(Right Ctrl) for the arrows player. Two caveats:

- Many laptop keyboards, including most Mac keyboards, have no Right Ctrl
  key, so a game should not require RT on its own for single-player play.
- Ctrl+W closes the browser tab and no page can stop it, so while a trigger
  is held both hosts ask before the page unloads.

Detecting button press (not hold):

```ts
export function update(): void {
  if (buttonPressed(Button.A)) {
    // A was just pressed this frame
  }
  if (buttonDown(Button.LEFT)) {
    // LEFT is held
  }
}
```

Mouse input works the same way with `mouseX()`, `mouseY()`, `mouseDown(MouseButton.LEFT)` and `mousePressed(MouseButton.LEFT)`.

The cartridge never sees individual key events.

---

## Console Logging

The SDK provides logging functions that output to the HTML console panel.

### Basic Logging (String Literals Only)

```ts
import { log, warn, error } from "../../sdk";

log("Player initialized"); // Blue entry [LOG]
warn("Health low"); // Yellow entry [WARN]
error("Invalid state"); // Red entry [ERROR]
```

### Logging with Parameters (Zero Allocation)

To log dynamic values without string concatenation, use the interpolation variants:

```ts
import { logi, logf, warni, warnf, errori, errorf } from "../../sdk";

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

export function update(): void {
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

The games' sounds were made with the editor's chiptune synth
(`packages/editor-core/src/ai/synth.ts`). Each keeps its recipe, the synth
description that renders it, as `spec` in its sidecar (`<file>.wav.json`).
To change one, edit the recipe and render it again (ask the AI panel to
remake the sound from its sidecar).

### Audio API

```ts
import { playSfx, playMusic, stopMusic } from "../../sdk";

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

// ✅ CORRECT - Called after the user presses a button
export function update(): void {
  if (buttonPressed(Button.START)) {
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
import { Button, buttonPressed, playSfx, playMusic, stopMusic, RAM_START } from "../../sdk";

// Audio IDs
const SFX_JUMP = "jump";
const SFX_HIT = "hit";
const MUSIC_GAMEPLAY = "gameplay";

// Game state lives in RAM, not in module variables
@unmanaged
class Vars {
  gameStarted: bool;
}
const vars = changetype<Vars>(RAM_START);

export function update(): void {
  // Start music after user presses start
  if (!vars.gameStarted && buttonPressed(Button.START)) {
    vars.gameStarted = true;
    playMusic(MUSIC_GAMEPLAY, 0.6);
  }

  // Play sound effects during gameplay
  if (buttonPressed(Button.A)) {
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
import { drawSprite, s } from "../../sdk";

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
import { drawSprite, s } from "../../sdk";

// Draw a single sprite
drawSprite(s("flag"), 100, 100);

// Draw a sprite sheet frame (column, row)
drawSprite(s("tiles", 1, 0), 50, 50, true, false);

// Sprites with semi-transparent pixels will blend smoothly
drawSprite(s("shadow"), 200, 150); // Shadow sprite with alpha = 128
```

### Notes

- The editor loads the sprites the game uses (found at compile time); the classic host loads all of `assets/sprites/`
- Maximum sprite entries: 256
- Sprite data is stored after the game's static data, sized to the sprites loaded
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
  write input state to memory
  update()

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

- Imports the SDK (`packages/engine/assembly/sdk/`, imported as `"../../sdk"` from a game's main.ts from a game file)
- Exports a small, fixed API: `init()`, `update()` and `draw()`, all with no arguments
- Writes directly to the framebuffer
- Stores game state in RAM (not module variables)

The SDK provides:

- Memory declarations and memory map constants
- Display constants (`SCREEN_WIDTH`, `SCREEN_HEIGHT`)
- Input constants and helpers (`Button`, `buttonDown`, `buttonPressed`, `p1AxisX`/`p1AxisY`, `p2AxisX`/`p2AxisY`)
- Console logging functions (log, warn, error)

### Minimal cartridge

```ts
import {
  Button,
  buttonDown,
  c,
  clearFramebuffer,
  log,
  pset,
  RAM_START,
} from "../../sdk";

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

export function update(): void {
  // Movement logic - buttonDown() for continuous movement
  if (buttonDown(Button.LEFT)) vars.x--;
  if (buttonDown(Button.RIGHT)) vars.x++;
  if (buttonDown(Button.UP)) vars.y--;
  if (buttonDown(Button.DOWN)) vars.y++;
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

- Node.js 20+
- pnpm (`corepack enable` installs the version pinned in `package.json`)

### Install Dependencies

From the project root:

```
pnpm install
```

### Build

**Build everything (games + host):**

```
pnpm build
```

**Build all games (WASM only):**

```
pnpm build:games
```

**Build a single game (WASM only):**

```
pnpm build:games gameName
```

`gameName` must be the exact `.ts` filename without the extension.

**Build all games (debug):**

```
pnpm build:debug
```

**Build host only (web runtime):**

```
pnpm build:host
```

**Export and import a game as a zip:**

```
pnpm tf export gameName [--out dir]   # dir/gameName.zip
pnpm tf import gameName.zip [--replace]
```

The zip holds the game's folder and the library assets it uses, with their
sidecars, at their project paths (`games/gameName/...`, `assets/sfx/...`) and
nothing else. Export compiles the game to find its assets, so it must compile;
the editor's Export works on any game. Import refuses a game that already
exists, skips assets that are already the same, and keeps the project's copy
of an asset that differs unless `--replace` is given.

**Export a playable cartridge:**

```
pnpm tf cartridge gameName [--out dir]   # dir/gameName.wasm
```

A release build with the library files the game uses, and its cover sprite, embedded in a
`tinyforge.assets` custom section, added at the end so the code and the
metadata are unchanged. Sidecars are left out. Sounds are WAV, so a game with
music can weigh a megabyte or more (Pong is about 1.4 MB, most of it its
theme). No host plays these cartridges yet: the editor's Library imports
their assets, and a player that reads them comes with the static site.

### Watch (build on save)

**Everything at once (host + games):**

```
pnpm watch
```

This runs every `watch:*` script in parallel, with each line of output prefixed by its source (`[host]`, `[games]`) in its own color. Press Ctrl+C once to stop them all. If one watcher exits on its own, the others are stopped too.

**Web runtime:**

```
pnpm watch:host
```

**WASM games:**

```
pnpm watch:games
```

### Available Scripts

**Build scripts:**

- `pnpm build` - Build everything (host + all games), then upload if FTP is configured
- `pnpm build:host` - Build only the web runtime (TypeScript → JavaScript), then upload if FTP is configured
- `pnpm build:games` - Build all games (AssemblyScript → WASM), then upload if FTP is configured
- `pnpm build:games <gameName>` - Build a single game by name (e.g., `pnpm build:games snake`)
- `pnpm build:debug` - Build all games with debug symbols and source maps

**Watch scripts:**

- `pnpm watch` - Run all watch scripts below in parallel (Ctrl+C stops them all)
- `pnpm watch:host` - Auto-rebuild host on file changes
- `pnpm watch:games` - Auto-rebuild games on file changes

**Development scripts:**

- `pnpm serve` - Serve the classic host on http://localhost:8080 (with directory listings)
- `pnpm dev:classic` - Build the classic host and all games, then serve it
- `pnpm dev` - Start the new editor (see [The Editor](#the-editor))
- `pnpm editor:static` - Build the editor as static files with a read-only copy of the project, and serve them on http://localhost:4173 (no AI)
- `pnpm test:e2e:static` - Build the editor and check it under the deployed site's Content-Security-Policy
- `pnpm ai:setup` - Set the deployed editor's AI password and upload its key (see [The Editor](#the-editor))

**Command line (`pnpm tf help` lists them):**

- `pnpm tf export <game> [--out dir]` - Save a game as a zip (its folder and the assets it uses)
- `pnpm tf import <file.zip> [--replace]` - Add a game from such a zip
- `pnpm tf cartridge <game> [--out dir]` - Save a playable `.wasm` with its assets and cover inside

**Test scripts:**

- `pnpm test` - Unit tests (Vitest) for the runtime and editor-core, including every game booting
- `pnpm test:e2e` - Playwright smoke tests of the editor
- `pnpm test:sdk` - AssemblyScript SDK unit tests (`utility.spec.ts`)
- `pnpm typecheck`, `pnpm lint`

**Utility scripts:**

- `pnpm upload` - Manually trigger FTP upload to remote server
- `pnpm check:alloc <gameName>` - Check a game for memory allocation symbols

### Checking for Memory Allocation

The `check:alloc` script helps verify that your game doesn't contain any dynamic memory allocation:

```bash
pnpm check:alloc <gameName>
```

**What it does:**

- Builds a debug version of the specified game
- Uses `wasm-objdump` to inspect the WASM binary
- Searches for allocation-related symbols: `__new`, `__alloc`, `__realloc`, `__free`, `memory.grow`, `malloc`
- Reports any found symbols (indicating allocation code)

**Prerequisites:**

- On Windows, the script uses the bundled `tools/wasm-objdump.exe` (see `tools/README.md`)
- On macOS/Linux, `wasm-objdump` must be installed and in your PATH
- Part of the WebAssembly Binary Toolkit (WABT): https://github.com/WebAssembly/wabt

**Example usage:**

```bash
pnpm check:alloc snake
# Output: "No allocation symbols found." (good!)

pnpm check:alloc myGame
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
pnpm dev:classic
```

Then open http://localhost:8080/. `pnpm serve` alone serves without rebuilding.
It maps `/` to `apps/classic/` and `/assets/` to the shared `assets/` folder,
the same layout as the deployed site.

#### VS Code Live Server

`.vscode/settings.json` sets Live Server's root to `/apps/classic`. Live Server
can only serve files under that root, so link the shared `assets/` folder into
it once:

- Windows: run `scripts\link-classic-assets.cmd` (creates a directory junction
  with `mklink /J`; no admin rights needed).
- macOS/Linux: `ln -s ../../assets apps/classic/assets`

The link is gitignored. Build first (`pnpm build:classic`), then use
"Go Live" and open the page Live Server shows.

---

## The Editor

`apps/editor` is the new editor. It runs the same cartridges with the same
engine API (`init`/`update`/`draw`, the memory map and the `env` imports).

```
pnpm dev
```

Then open the URL Vite prints (http://localhost:5173/).

**Static editor:** `pnpm editor:static` builds the same editor as plain files
(`apps/editor/dist`, with a read-only copy of the project under `__tf/`) and
serves them at http://localhost:4173/. It runs, compiles and exports games,
but cannot change files and has no AI. The `dist` folder can be put on any
static web host.

**Deployed editor:** https://tf.basille.net, uploaded with `pnpm build:editor`
then `pnpm upload:editor` (or the Deploy editor workflow). The build writes
`.htaccess` files (`apps/editor/vite/site-headers.ts`) for Apache: HTTP
redirects to HTTPS, a strict Content-Security-Policy and other security
headers, and long caching for the hashed bundles in `assets/` only. `vite
preview` (and so `pnpm editor:static`) sends the same CSP, and
`pnpm test:e2e:static` builds the editor and checks that games compile and run
under it with no violation. `pnpm upload:editor` refuses to upload a build
that contains an API key, a GitHub token or any value from `.env`.

**AI in the deployed editor:** a small PHP proxy (`apps/editor/server/ai/index.php`,
deployed with the editor under `__tf/ai/`) answers the same routes as the dev
server and holds the Anthropic key; the browser never sees it. The AI panel
asks for a password (the browser's password manager can keep it), and the
proxy then sets a 30-day session cookie that scripts cannot read. It forwards
only the editor's models, at most 300 requests an hour, and refuses logins for
an hour after 10 wrong passwords. To set it up, put a key made for this (with
a monthly spending limit) in `.env` as `EDITOR_AI_ANTHROPIC_KEY`, deploy, then
run `pnpm ai:setup`: it asks for the password (shown as you type) and uploads the key and the
password's hash to `/.private/` on the site (refused to browsers), and checks
that the site answers. Run it again to change the password, which logs every
browser out.

**Saving from the deployed editor:** with `EDITOR_GITHUB_TOKEN` in `.env` (a
fine-grained token for this repository only, Contents read and write, with an
expiry date) when you run `pnpm ai:setup`, the site saves to GitHub once you
are logged in. Edits go to the `mobile` branch (made from `master` the first
time), never to `master`: a few seconds after the last change, or with Save in
the top bar, they become one commit. If the branch moved meanwhile (another
device, or a push), the editor shows Conflict and never overwrites it; reload
to get the latest. Files unchanged since the deploy load from the site
itself, so only changed files cost GitHub requests. Merge `mobile` into
`master` on your computer (`git pull origin mobile`), then push. The
repository is public: what you save from the phone is public at once.

- **The game runs in a Web Worker** with an `OffscreenCanvas`, so heavy gameplay
  code cannot stall the editor. Audio is played on the main thread
  (`AudioContext` does not exist in Workers). If a game hangs in an infinite
  loop, the editor notices within 3 s and offers to stop and reload it.
- **Files and code:** the Files panel shows the games, the asset library and
  the (read-only) SDK. Click a file to edit it in a code panel (CodeMirror).
  Ctrl+S saves. New game, New file, Rename and Delete are in the panel (deleting
  the running game runs another one), and
  every file change can be undone with Ctrl+Z outside the text. If a file
  changes on disk while you edit it, a clean buffer reloads and an edited one
  asks which version to keep.
- **Compiling in the browser:** the AssemblyScript compiler runs in its own
  Worker. The dev server only serves and watches files; the editor reaches
  them through one Workspace interface (an HTTP protocol, see
  `apps/editor/vite/tinyforge-plugin.ts`), so the same editor build also runs
  from a static copy of the project (`pnpm build:editor`), read-only.
- **Hot reload:** a change to a game's files, from the editor or from any
  other program, recompiles the game (debug build, using `asconfig.json`) and
  reloads it with its memory, so game state is kept. Compile errors are
  underlined in the code panel and listed in the Console. Changing the layout
  of a game's state can still leave old state in memory; use Restart.
- **Assets while typing:** the code panel checks `s()`, `playSfx()` and
  `playMusic()` IDs as you type (an unknown ID is underlined before any
  compile) and completes IDs from the library.
- **Asset library:** the Library panel (a tab next to the Console) shows the
  sprites as a grid and the sound effects and music as lists you can play.
  Search by ID, file name or tag (`#tag` matches a tag exactly, and the tag
  chips toggle it). Each asset shows the games that use it: their code (from
  a scan of every game's sources, plus unsaved edits of the current game) and
  their `COVER`. Duplicate IDs and bad sheet formats are flagged. Select an
  asset to see its frames, edit its tags, license and source, rename its ID
  or delete it (undoable; renaming does not change the games' code).
- **Importing assets:** drop images or sounds on the Library panel (or use
  Import…). Each file gets an ID from its name, checked like the compiler
  checks it (letters, digits and `_`, at most 16 characters, unique), and an
  image gets a sheet-split preview: the frame grid over the image and the
  frames played in order, with the split refused until it divides the image
  evenly. An existing ID can be replaced on purpose. The whole import is one
  undo step.
- **Sprite editor:** double-click a sprite in the Library (or use Edit pixels)
  to edit it: pencil, eraser, fill, line, rectangle and colour picker (B, E,
  G, L, R, I; right click erases, Alt+click picks), a palette of the sprite's
  own colours plus a default one, an opacity slider, zoom (wheel, + and -),
  pixel grid, onion skin and mirroring. Sheets show their frames in a strip:
  add, duplicate, delete and reorder frames ([ and ] step through them),
  resize the frame, and preview the animation at any fps. Edits have their
  own undo inside the panel; Ctrl+S saves a PNG as one undoable file change
  (a running game shows it at once). Changing the number of frames renames
  the file (`walk~4x1.png`) and its sidecar. PNGs are read and written
  pixel-exact, half-transparent pixels included; a JPEG is saved as PNG.
  New sprite… in the Library creates a blank sprite or sheet.
- **Sound player:** double-click a sound to see its waveform. Drag to select
  (Shift extends), Space plays the selection or from the cursor, Loop
  repeats it. Trim keeps the selection, Cut (Delete) removes it, and Fade
  in, Fade out and Normalize apply to the selection or the whole sound.
  Ctrl+S saves a 16-bit WAV as one undoable file change; an MP3 or OGG is
  saved as a WAV under the same ID.
- **Sprite budget:** each game gets a sprite table for the sprites its code
  uses (4 bytes per pixel, at most 256 sprites), placed after its static
  data. The Library shows what the current game uses, the Budget tab lists
  every game, and each sprite shows what it adds.
- **Asset metadata:** tags, license and source live in a sidecar next to the
  file, `<file>.json` (`coin~8x1.png.json`). It is optional, and other keys
  (such as `prompt` for a generated asset) are kept. Renaming or deleting an
  asset in the editor takes its sidecar along.
- **AI code agent (dev server only):** the AI button opens a chat with
  Claude about the current game ("Working on <game>" at the top). There is
  one chat per game and model provider, kept until the page reloads; New chat
  starts it over. It reads the game, the SDK, the other games and the asset
  list, edits files in the game's folder only (untick "Only change this
  game" to let it change other games too, for a refactor across games),
  compiles until each game it changed builds, and checks the running game's
  log. Its thinking (a summary, for Claude; the reasoning of local models
  that send one) shows as a collapsed Thinking line. On a Windows checkout
  with CRLF line endings, its edits match and keep them. Each request is one undo step,
  and the panel lists every file it changed with a diff. Model, effort and
  "show cost" are set in the panel and saved in the browser. Setup: put
  `ANTHROPIC_API_KEY=...` in a `.env` file at the repository root (it is
  git-ignored) and restart `pnpm dev`; `TF_AI_MODEL` sets the default model.
  The key stays in the dev server: the page sends requests to
  `/__tf/ai/anthropic`, which adds it. The AI routes answer only the editor
  at `localhost` (opened from another address, the panel says so) and are off
  when the server is started with `--host`. A static build has no AI. The agent's guide is `AGENTS.md`, and each game can
  keep design notes in `games/<name>/NOTES.md` that the agent reads and
  updates. The agent can also add assets the game needs: sprites drawn as a
  text grid of palette characters, and sound effects or music played on
  `synth.ts`, the synth that made the games' sounds (pulse, 16-step and
  smooth triangle, LFSR noise, saw and sine voices, with envelopes, fades,
  pitch slides, one-line note patterns and noise shared along a drum line),
  at the games' sample rates and loudness. Their sidecar keeps the request and
  the description (`spec`, the recipe), and marks them
  `"generator": "tinyforge-ai"`. The games' own sounds keep their recipe in
  their sidecar too (`"generator": "tinyforge-synth"`), so the agent can
  make a sound in their style, or change one by editing its recipe. When the
  synth lacks something a request needs, the agent says what is missing. Before
  it replaces an asset that already exists (imported or made earlier), the
  agent pauses and the panel asks: Replace or Keep (Stop counts as Keep).
  Instead of Claude (or as well), the agent can use any OpenAI-compatible
  server, such as a local Ollama: set `TF_AI_OPENAI_URL`,
  `TF_AI_OPENAI_MODELS` and, if it needs one, `TF_AI_OPENAI_KEY` in `.env`
  (see `.env.example`). The URL must be https, or http to this machine;
  any other is refused, with the reason shown in the AI panel. Its models appear in the panel's model list; it has
  no effort setting and no cost estimate. Small local models follow the
  rules less well than Claude, and need a context of 32k tokens or more.
- **Export and import:** the Files panel's Export saves the selected game (a
  game's folder or a file in it) as a zip of its folder and the assets it uses, with their
  sidecars: the same zip as `pnpm tf export`. Import adds a game from such a
  zip, as one undo step; when some of its assets differ from the project's,
  it asks whether to replace them or keep yours. A game that already exists
  is refused, and so is a zip with anything else in it (other folders, paths
  outside the project). Cartridge saves the game as a playable `.wasm` with
  the assets it uses inside (as `pnpm tf cartridge`); dropping such a
  cartridge into the Library's Import lists its assets as drafts.
- **Debugging:** debug builds carry their source map, so Chrome DevTools can
  set breakpoints in the AssemblyScript source.
- **Panels:** Game, Run (pause, single step, restart, save/load state, seed),
  Memory (hex view of the visible range, refreshed every frame), Console,
  Library. The layout is saved in the browser; Reset layout brings back the
  default.
- **Sound:** the speaker button and slider in the toolbar set the master volume
  and mute for every game. The setting is saved in the browser.
- **Shortcuts:** they work anywhere in the editor and stay clear of game keys
  (arrows, WASD, Z/X, Enter, Space, C). Button tooltips show them too.

  | Key            | Action                          |
  | -------------- | ------------------------------- |
  | F5             | Reload cartridge                |
  | Shift+F5       | Restart (run `init` again)      |
  | F8             | Pause / resume                  |
  | F10            | Step 1 tick (pauses first)      |
  | Ctrl+Z         | Undo (Cmd+Z on macOS)           |
  | Ctrl+Shift+Z   | Redo (Cmd+Shift+Z on macOS)     |

- **Dev hook:** in development, `window.__tf` exposes the editor, the project
  files, the project and session stores, and `snapshot()`, for tests and
  agents.

The classic host and its deployment are unchanged by the editor.

## FTP Upload

Builds trigger an upload via the `postbuild`, `postbuild:games`, and `postbuild:host` hooks. The upload is **optional**:

- If `FTP_HOST`, `FTP_USER` or `FTP_PASS` is not set (for example, no `.env`), the build prints `FTP upload skipped` and still succeeds.
- To skip the upload even when credentials are set, set `FTP_UPLOAD=0` in `.env` or in the shell (for example `FTP_UPLOAD=0 pnpm build`, or `set FTP_UPLOAD=0` in `cmd`).
- `pnpm upload` run by hand always tries to upload, and fails if credentials are missing.

The upload always uses **FTPS** (FTP over TLS), so the password and files are encrypted in transit. Plain, unencrypted FTP is not supported. Your host must offer FTPS, and its TLS certificate must be valid for `FTP_HOST`.

### Credentials

Create a `.env` file in the project root:

```
FTP_HOST=yourdomain.com
FTP_USER=username
FTP_PASS=password
# Optional: set to "implicit" if your host only offers implicit FTPS (port 990).
# By default explicit FTPS (AUTH TLS on port 21) is used.
# FTP_SECURE=implicit
# Optional: override the port (defaults to 21, or 990 for implicit FTPS).
# FTP_PORT=21
# Optional: set to 0 to stop builds from uploading automatically.
# FTP_UPLOAD=0
```

The file is ignored by Git.

### What Gets Synced

- `dist/` → `/dist`
- `assets/` (including built cartridges) → `/assets`
- `icons/` → `/icons`
- `*.html`, `*.css`, `manifest.json`, `sw.js` → `/`

The remote `/dist`, `/assets` and `/icons` directories are deleted and re-uploaded on every sync.

### Manual Upload

```
pnpm upload
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

- `new Array()`, `new String()`, `new Object()` or `new StaticArray()`
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

**`UncheckedArrayView<T>`** - Zero-allocation array backed by pre-allocated memory:

```ts
import { UncheckedArrayView } from "../../sdk";

// Calculate memory size needed
const GRID_SIZE = 100;
const gridBytes = UncheckedArrayView.sizeInMemory<u8>(GRID_SIZE); // 100 bytes

// Reserve memory in your RAM layout
@unmanaged
class Vars {
  playerX: i32; // 0
  playerY: i32; // 4
  // Grid data starts at offset 8
}

// Create array view over pre-allocated memory
const grid = UncheckedArrayView.fromAddress<u8>(RAM_START + 8);

// Use like a normal array
grid.set(10, 42);
const val = grid.get(10);
grid.fill(0, GRID_SIZE);

// Or use bracket notation
grid[10] = 42;
const val = grid[10];
```

**`ArrayView<T, U>`** - Array with dynamic length tracking:

```ts
import { ArrayView } from "../../sdk";

// Calculate memory size (includes metadata)
const CAPACITY = 50;
const size = ArrayView.sizeInMemory<u16>(CAPACITY); // 4 + 100 = 104 bytes

// Create array with length tracking
const items = ArrayView.fromAddress<u16>(RAM_START + 200);
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

- `UncheckedArrayView<T>` - No metadata, just raw array data. You manage length manually. No bounds checking.
- `ArrayView<T, U>` - Includes `length` and `capacity` metadata (2 \* sizeof\<U\> bytes). Includes bounds checking.
- Both use `@unmanaged` pattern - no heap allocation, just memory reinterpretation.
- Memory must be pre-allocated in your game's RAM layout.
- Use `U = u8` for small arrays (max 255 elements), `U = u16` for larger (max 65535).

#### Vec2i Helper Class

**`Vec2i`** - 2D integer vector for coordinate pairs:

```ts
import { Vec2i, RAM_START } from "../../sdk";

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
import { drawString, drawNumber } from "../../sdk";

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

## Array Types and Memory Layout Management

TinyForge uses zero-allocation array views for all game state. This ensures deterministic execution and compatibility with the stub runtime (no heap). The SDK provides several array types:

### Array Types

- **UncheckedArrayView<T>**
  - Fixed-size, no bounds checking, no length tracking.
  - Use for raw buffers or when you manage length manually.
  - Example: `const grid = UncheckedArrayView.fromAddress<u8>(RAM_START + offset);`

- **ArrayView<T>**
  - Fixed-size, with length and capacity tracking.
  - Bounds-checked, supports `push()`, `clear()`, etc.
  - Example: `const items = ArrayView.fromAddress<u16>(RAM_START + offset);`

- **UncheckedArrayObjView<T>**
  - For arrays of `@unmanaged` structs, no bounds or length tracking.
  - Use when you want direct struct access and manage length yourself.
  - Example: `const enemies = UncheckedArrayObjView.fromAddress<Enemy>(RAM_START + offset, count);`

- **ArrayObjView<T>**
  - For arrays of `@unmanaged` structs, with length/capacity tracking.
  - Bounds-checked, supports `push()`, `clear()`, etc.
  - Example: `const crocos = ArrayObjView.fromAddress<Croco>(RAM_START + offset, capacity);`

### Memory Layout Management with StaticMemoryAllocator

To avoid manual offset math and ensure all game state is stored in RAM, use `StaticMemoryAllocator`:

```ts
import { StaticMemoryAllocator } from "../sdk/memoryAllocator";

// Allocate from RAM_START
const mem = StaticMemoryAllocator.fromAddress(RAM_START);

// Allocate a struct
export const gameState = mem.allocStruct<GameState>(
  offsetof<GameState>("score") + sizeof<i32>(),
);

// Allocate arrays of primitives
export const queueBFS = mem.allocArray<u16>(256); // ArrayView<u16>
export const directionX = mem.allocUncheckedArray<i32>(4); // UncheckedArrayView<i32>

// Allocate arrays of objects
export const crocos = mem.allocUncheckedObjArray<Croco>(
  offsetof<Croco>("targetY") + sizeof<u8>(),
  NB_CROCOS,
); // UncheckedArrayObjView<Croco>
```

#### Warnings

- **UncheckedArrayView/UncheckedArrayObjView:**  
  ⚠️ No bounds checking! Accessing out of bounds will corrupt memory.
- **allocArray/allocUncheckedArray:**  
  ⚠️ Only for primitive number types (i32, u8, f32, etc.)—not for `@unmanaged` objects.

### Example: crocodiles/types.ts

```ts
export const crocos = mem.allocUncheckedObjArray<Croco>(
  offsetof<Croco>("targetY") + sizeof<u8>(),
  NB_CROCOS,
);
export const queueBFS = mem.allocArray<u16>(256);
export const directionX = mem.allocUncheckedArray<i32>(4);
```

### Example: starlinePursuit/types.ts

```ts
export const stars = mem.allocUncheckedObjArray<Star>(
  offsetof<Star>("y") + sizeof<i32>(),
  STAR_COUNT,
);
export const playerPath = mem.allocArray<u16>(MAX_PATH_LENGTH);
```

### Best Practices

- Always allocate all game state at startup using StaticMemoryAllocator.
- Never use dynamic allocation (`new Array()`, etc.).
- Access arrays directly (e.g., `crocos.get(i)`), do not use helper functions for indirection.
- Store all persistent state in RAM, not in module-level variables.

This pattern ensures your game is compatible with TinyForge’s zero-allocation runtime and supports hot reload, save states, and deterministic replay.

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
