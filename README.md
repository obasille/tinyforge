# Fantasy Console (AssemblyScript + WebAssembly)

A small, **deterministic fantasy console** for building simple 2D games on the web.

The goal of this project is to provide a **console‑like programming environment** with a fixed resolution, fixed timestep, direct framebuffer access, and a strict separation between **console (host)** and **cartridge (game)**.

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
- A small fantasy console
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
fantasy-console/
├─ host/                # The console (JavaScript + HTML)
│  ├─ index.html        # Canvas and page shell
│  └─ main.js           # Input, timing, rendering, WASM loader
│
├─ cart/                # The cartridge (AssemblyScript)
│  ├─ console.ts        # Console SDK (memory map, constants, input)
│  ├─ cartridge.ts      # Game code
│  ├─ asconfig.json     # AssemblyScript configuration
│  └─ cartridge.wasm   # Compiled output
│
└─ package.json         # Build scripts and dependencies
```

### `host/`
Owns everything that would be considered *hardware* on a real console:

- RAM allocation
- Frame timing
- Input devices
- Rendering
- Cartridge loading

### `cart/`
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
0x000000       307,200 B   Framebuffer (RGBA8888)
0x04B000       256 KB      Game RAM (heap, state)
0x08B000       64 KB       Save data (optional)
0x09B000       64 KB       Debug / tooling
```

Notes:
- Memory is allocated by the **host (JS)**
- Memory size is fixed at startup
- Memory does **not** grow at runtime
- The framebuffer region should be treated as write-only by the cartridge

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

### Minimal cartridge

```ts
import { memory, WIDTH, HEIGHT, Button, RAM_START } from './console';

// Re-export for host
export { WIDTH, HEIGHT };

// Game state in RAM
const X_ADDR: usize = RAM_START;
const Y_ADDR: usize = RAM_START + 4;

export function init(): void {
  cls(0xff000000);
  store<i32>(X_ADDR, 160);
  store<i32>(Y_ADDR, 120);
}

export function update(input: i32, prevInput: i32): void {
  let x = load<i32>(X_ADDR);
  let y = load<i32>(Y_ADDR);
  
  if (input & Button.LEFT) x--;
  if (input & Button.RIGHT) x++;
  
  store<i32>(X_ADDR, x);
  store<i32>(Y_ADDR, y);
}

export function draw(): void {
  cls(0xff000000);
  const x = load<i32>(X_ADDR);
  const y = load<i32>(Y_ADDR);
  pset(x, y, 0xffffffff);
}

@inline
function pset(px: i32, py: i32, color: u32): void {
  const i = (py * WIDTH + px) << 2;
  store<u32>(i, color);
}

function cls(color: u32): void {
  let i: usize = 0;
  const end = WIDTH * HEIGHT * 4;
  while (i < end) {
    store<u32>(i, color);
    i += 4;
  }
}
```

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

From the project root:

```
npm run build
```

Or manually from the `cart/` directory:

```
asc cartridge.ts \
  -o cartridge.wasm \
  -O3 \
  --runtime stub \
  --importMemory
```

The output `cartridge.wasm` is loaded by the host.

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
  - Pre-build linting to catch `new Array()`, `new String()`, etc.
  - TypeScript type deprecation for forbidden constructs
- Sprite blitter helpers
- Tilemap helpers
- Audio (WebAudio command API)
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

