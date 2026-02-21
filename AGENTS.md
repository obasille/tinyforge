---
applyTo: "**"
---

## Guide for AI Agents: Building Games for TinyForge

This section provides detailed instructions for AI agents tasked with creating games for TinyForge, based on patterns established in three reference games: **minesweeper.ts**, **pong.ts**, and **snake.ts**.

### Project Layout (Current)

- `index.html`, `memory-viewer.html` live at the repo root
- `styles.css` and `stylesVC.css` are at the repo root
- `icons/` holds favicon/app icons
- `src/web/` contains host/runtime TypeScript
- `src/assembly/sdk/` contains the AssemblyScript SDK
- `src/assembly/games/` contains game cartridges (AssemblyScript)
- `src/memory-map.ts` is the shared memory map source
- `dist/web/` contains built host JS
- `dist/memory-map.js` is the built memory map module
- `assets/` holds sprites, sfx, and music
- `assets/cartridges/` contains built WASM cartridges

### Core Architecture Patterns

#### 1. File Structure

Every game follows this structure:

- **Import helpers from console.ts**: All drawing functions and system APIs
- **Define constants**: Grid sizes, speeds, scores using `@inline` or `const`
- **Define enums**: Game states, directions, flags for type safety
- **Define RAM layout**: Memory addresses for all game state via `enum Var`
- **Implement helper functions**: Game-specific logic (collision, scoring, etc.)
- **Export lifecycle functions**: `init()`, `update(input, prevInput)`, `draw()`

#### 2. Memory Management - Critical Rules

**ALWAYS store game state in RAM using the memory API:**

```ts
// Define memory layout
enum Var {
  GAME_STATE = 0, // u8
  SCORE = 1, // i32
  PLAYER_X = 5, // i32
  // ... etc
}

// Read/write state
const state = getU8(Var.GAME_STATE);
setI32(Var.SCORE, 100);
```

**NEVER use module-level variables for game state:**

```ts
// ❌ WRONG - will not persist across hot reloads
let playerX: i32 = 0;
let score: i32 = 0;

// ✅ CORRECT - stored in RAM
setI32(Var.PLAYER_X, 0);
setI32(Var.SCORE, 0);
```

**Memory address allocation rules:**

- Start at offset 0 (or use RAM_START constant if available)
- `u8` takes 1 byte
- `i32` takes 4 bytes (align to 4-byte boundaries)
- Arrays: reserve contiguous blocks (e.g., 100 cells = 100 bytes)
- Leave gaps for alignment when needed
- SDK RNG seed is reserved in SDK memory; do not allocate it in game RAM

#### 3. Type System and Enums

**Use enums instead of constants for related values:**

```ts
// ❌ WRONG - old pattern
const STATE_PLAYING: u8 = 0;
const STATE_GAME_OVER: u8 = 1;

// ✅ CORRECT - type-safe enums
enum GameState {
  PLAYING = 0,
  GAME_OVER = 1,
}
```

**CRITICAL: Enum casting rules:**

- AssemblyScript enums are `i32` by default
- When storing to `u8` memory, MUST cast explicitly
- When comparing with `u8` values, can compare directly

```ts
// Storing - MUST cast
setU8(Var.GAME_STATE, GameState.PLAYING as u8);

// Reading and comparing - no cast needed
const state = getU8(Var.GAME_STATE);
if (state == GameState.PLAYING) {
  /* ... */
}
```

**Common enum patterns:**

```ts
enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3,
}

enum GameState {
  PLAYING = 0,
  GAME_OVER = 1,
  PAUSED = 2,
}

// Bit flags (for cell states, etc)
enum CellFlag {
  MINE = 1 << 7,
  FLAGGED = 1 << 6,
  REVEALED = 1 << 5,
  COUNT_MASK = 0x0f,
}
```

#### 4. Drawing System

**Always import drawing helpers from console.ts:**

```ts
import {
  clearFramebuffer,
  pset,
  fillRect,
  drawRect,
  fillCircle,
  drawString,
  drawNumber,
} from "./console";
```

**NEVER define local drawing helpers** - they belong in console.ts.

**Color format: 0xAABBGGRR (with alpha forced to 0xFF):**

```ts
clearFramebuffer(0x000000); // Black background
pset(x, y, 0xff0000); // Red pixel
fillRect(10, 10, 50, 50, 0x00ff00); // Green rectangle
```

**Text rendering limitations:**

```ts
// ✅ CORRECT - drawString() only supports uppercase letters, numbers, and some punctuation
drawString(10, 10, "SCORE: 1000", 0xffffff);
drawString(10, 20, "PRESS START", 0xffaa00);
drawString(10, 30, "LEVEL: 5", 0x00ff00);

// ❌ WRONG - lowercase letters will not render correctly
drawString(10, 10, "Score: 1000", 0xffffff); // "core" won't display properly
drawString(10, 20, "Press Start", 0xffaa00); // "ress tart" won't display properly
```

**CRITICAL: Always use UPPERCASE for all text in drawString().**
Supported characters: A-Z, 0-9, space, and punctuation: `:!?.,-/\`'+\_\*[]()"`
Lowercase letters are not in the font and will render incorrectly or as blank spaces.

**Frame clearing:**

```ts
export function draw(): void {
  clearFramebuffer(0x0a0a0a); // Always clear first
  // ... draw game
}
```

#### 5. Input Handling Pattern

**Button press detection (not hold):**

```ts
export function update(input: i32, prevInput: i32): void {
  const pressed = input & ~prevInput; // Detect new presses

  if (pressed & Button.A) {
    /* A just pressed */
  }
  if (pressed & Button.START) {
    /* START just pressed */
  }
}
```

**Button hold detection:**

```ts
if (input & Button.LEFT) {
  /* LEFT is held down */
}
```

**Always declare `pressed` once at the start** to avoid duplicate declarations.

#### 6. Game State Management

**Standard game state flow:**

```ts
export function init(): void {
  // Clear all game state in RAM
  setU8(Var.GAME_STATE, GameState.PLAYING as u8);
  setI32(Var.SCORE, 0);
  // ... initialize all variables
  log("Game initialized");
}

export function update(input: i32, prevInput: i32): void {
  const state = getU8(Var.GAME_STATE);
  const pressed = input & ~prevInput;

  // Handle restart from game over
  if (state != GameState.PLAYING && pressed & Button.START) {
    init();
    return;
  }

  // Don't process game logic if not playing
  if (state != GameState.PLAYING) return;

  // ... game logic
}
```

#### 7. Game Over Screen Pattern

**Use drawStartMessageBox for consistent message screens:**

```ts
export function draw(): void {
  // ... draw game

  const state = getU8(Var.GAME_STATE);
  if (state == GameState.START_SCREEN) {
    drawStartMessageBox("GAME NAME", c(0x1a1a1a), c(0x00ff00));
  } else if (state == GameState.GAME_OVER) {
    drawStartMessageBox("GAME OVER", c(0xaa5500), c(0xffaa00));
  }
}
```

**drawStartMessageBox provides:**

- Centered message box (170x50 at position 75,95)
- Automatic "PRESS START" instruction
- Consistent styling across all games
- Custom background and foreground colors

#### 8. Operator Precedence - CRITICAL

**The `as` cast operator has LOWER precedence than comparison operators:**

```ts
// ❌ WRONG - compiles as: x < (WIDTH as f32)
if ((x < WIDTH) as f32) {
}

// ✅ CORRECT - parentheses force proper order
if (x < (WIDTH as f32)) {
}

// ❌ WRONG
ballX = (WIDTH - BALL_SIZE) as f32;

// ✅ CORRECT
ballX = (WIDTH - BALL_SIZE) as f32;
```

**When in doubt, add parentheses** around expressions before casting.

#### 9. Type Strictness in Arithmetic Operations

**AssemblyScript is strict about mixing numeric types in operations:**

Unlike TypeScript, AssemblyScript does not allow arithmetic operations between different numeric types (e.g., `f32` and `i32`) without explicit casting. This prevents accidental precision loss and ensures type safety.

**Common scenarios requiring casts:**

**1. Adding/subtracting integers to floats:**

```ts
const BALL_SIZE: i32 = 0;
const paddleX: f32 = 0;
const paddleY: f32 = 0;

// ❌ WRONG - cannot add i32 to f32
ballX = paddleX + WIDTH / 2;

// ✅ CORRECT - cast integer to f32 first
ballX = paddleX + ((WIDTH / 2) as f32);

// ❌ WRONG - cannot subtract i32 from f32
ballY = (paddleY - BALL_SIZE) as f32;

// ✅ CORRECT - perform subtraction first, then cast
ballY = (paddleX - BALL_SIZE) as f32;
```

**2. Comparisons between different types:**

```ts
// ❌ WRONG - comparing f32 with i32 result
if (ballY + (BALL_SIZE as f32) <= PADDLE_Y + PADDLE_HEIGHT) {
}

// ✅ CORRECT - cast the entire right side
if (ballY + (BALL_SIZE as f32) <= ((PADDLE_Y + PADDLE_HEIGHT) as f32)) {
}
```

**3. Complex expressions with mixed types:**

```ts
// ❌ WRONG - multiple type mismatches
const hitPos = (((ballX + SIZE / 2) as f32) - paddleX) / (WIDTH as f32);

// ✅ CORRECT - wrap each operation properly
const hitPos = (ballX + ((SIZE / 2) as f32) - paddleX) / (WIDTH as f32);
```

**4. Division and multiplication:**

```ts
// Integer division stays integer
const half: i32 = WIDTH / 2; // i32

// Float division needs explicit types
const half: f32 = (WIDTH as f32) / 2.0; // f32
```

**Best practices:**

- Cast constants at the point of use, not at declaration
- Use parentheses liberally to group operations before casting
- When in doubt, cast each subexpression individually
- Prefer `((expr) as f32)` over `expr as f32` for clarity

**Error messages to watch for:**

- `Operator '+' cannot be applied to types 'f32' and 'i32'`
- `Operator '-' cannot be applied to types 'f32' and 'i32'`
- `Operator '<=' cannot be applied to types 'f32' and 'i32'`

These errors mean you need to cast one side to match the other type.

#### 10. Arithmetic Right-Shift vs Integer Division - CRITICAL

**NEVER use arithmetic right-shift (`>>`) as a substitute for integer division when working with potentially negative numbers:**

Arithmetic right-shift performs **sign extension**, not division. For negative numbers, this produces incorrect results:

```ts
// ❌ WRONG - Sign extension gives wrong result
let err = -1 >> 1; // Result: -1 (binary: ...11111111 >> 1 = ...11111111)

// ✅ CORRECT - Integer division gives correct result
let err = -1 / 2; // Result: 0 (proper truncation toward zero)
```

**Real-world example from Bresenham's line algorithm:**

```ts
// ❌ WRONG - Breaks diagonal lines when dx or dy is negative
let err = (dx > dy ? dx : -dy) >> 1;
// For a diagonal where dx=1, dy=1: err = -1 >> 1 = -1 ❌

// ✅ CORRECT - Works correctly for all line directions
let err = (dx > dy ? dx : -dy) / 2;
// For a diagonal where dx=1, dy=1: err = -1 / 2 = 0 ✅
```

**Why this matters:**

- The `>> 1` operator is faster for positive numbers, but mathematically wrong for negative ones
- Algorithms like Bresenham rely on proper integer division behavior
- Using `>>` with negative numbers causes subtle bugs like lines skipping pixels or going off-screen

**Best practice:**

- Use `/` for division when negative numbers are possible
- Only use `>>` when you're certain the value is non-negative
- When in doubt, use division (`/`)

#### 11. Common Patterns

**Cursor/player movement with bounds:**

```ts
let x = getI32(Var.PLAYER_X);
if (pressed & Button.LEFT) {
  x--;
  if (x < 0) x = 0;
}
if (pressed & Button.RIGHT) {
  x++;
  if (x >= MAX_X) x = MAX_X - 1;
}
setI32(Var.PLAYER_X, x);
```

**Score tracking with win condition:**

```ts
const score = getI32(Var.SCORE) + 1;
setI32(Var.SCORE, score);
if (score >= WIN_SCORE) {
  setU8(Var.GAME_STATE, GameState.GAME_OVER as u8);
}
```

**Grid-based collision:**

```ts
function getCellData(x: i32, y: i32): u8 {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return 0;
  return getU8(Var.GRID_START + (y * GRID_SIZE + x));
}
```

**Random number generation:**

**CRITICAL: NEVER use modulo (%) to cap random values - ALWAYS use randomRange():**

```ts
// ❌ WRONG - Modulo introduces bias
const roll = random() % 10; // Numbers 0-5 appear more often than 6-9
const x = random() % WIDTH; // Biased distribution

// ✅ CORRECT - Use randomRange for unbiased random values
const roll = randomRange(10); // Uniform distribution [0, 10)
const x = randomRange(WIDTH); // Uniform distribution [0, WIDTH)
const index = randomRange(7); // Uniform distribution [0, 7)
```

**Why modulo causes bias:** When the random number space (e.g., 0 to 2^32-1) doesn't evenly divide by your range, some values appear more frequently. The `randomRange()` function uses rejection sampling to ensure truly uniform distribution by discarding values that would cause bias.

**Safety checks and validation:**

**CRITICAL: ALWAYS log a warning when safety checks fail:**

Safety checks that silently fail make debugging extremely difficult. When bounds checks, validation, or sanity checks don't pass, always log a warning with relevant context.

```ts
// ❌ WRONG - Silent failure, impossible to debug
function getEnemy(index: i32): Enemy {
  if (index < 0 || index >= MAX_ENEMIES) {
    return Enemy.NONE; // What went wrong? Which index? Why?
  }
  return enemies[index];
}

// ✅ CORRECT - Log warnings for failed checks
function getEnemy(index: i32): Enemy {
  if (index < 0 || index >= MAX_ENEMIES) {
    warni("Invalid enemy index: {}, max: {}", index, MAX_ENEMIES);
    return Enemy.NONE;
  }
  return enemies[index];
}

// Another example - bounds checking
function updatePlayer(x: i32, y: i32): void {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) {
    warni("Player out of bounds: ({}, {}), max: ({}, {})", x, y, WIDTH, HEIGHT);
    return;
  }
  // ... update logic
}

// Data validation example
function spawnItem(itemType: i32): void {
  if (itemType < 0 || itemType >= ITEM_TYPE_COUNT) {
    warni("Unknown item type: {}", itemType);
    return;
  }
  // ... spawn logic
}
```

**Benefits of logging failed checks:**

- Reveals logic bugs during development
- Shows when assumptions are violated
- Provides context for unexpected behavior
- Helps trace the source of invalid state
- Makes debugging orders of magnitude easier

**Use the appropriate logging function:**

- `warni()` for integer values (indices, counts, types)
- `warnf()` for floating-point values (positions, velocities)
- `warn()` for simple messages without dynamic values

#### 12. Build Configuration

**Update package.json when creating new games:**

```json
{
  "scripts": {
    "build:debug": "asc src/assembly/games/gameName.ts -o assets/cartridges/gameName.wasm ..."
  }
}
```

**Or use asconfig.json targets** in the src/assembly/games/ directory.

**Build optimization - selective rebuilds:**

- When modifying a **game file** (e.g., `src/assembly/games/dinoWorld.ts`), rebuild only that game:
  ```bash
  npm run build:games gameName
  # Example: npm run build:games dinoWorld
  ```
- When modifying an **SDK file** (e.g., `src/assembly/sdk/drawing.ts`, `src/assembly/sdk/input.ts`), rebuild all games:
  ```bash
  npm run build:games
  ```
- After any change in **src/web** (host/runtime), rebuild host output:
  ```bash
  npm run build:host
  ```
- This saves time by avoiding unnecessary recompilation of unchanged games.

#### 13. Compilation Error Patterns

**Decorator errors (`@inline`):**

- These are pre-existing and don't affect compilation
- Can be ignored unless causing actual build failures
- For TypeScript IntelliSense, add `// @ts-expect-error AssemblyScript decorator` before `@inline` and `@external`

**"Cannot redeclare block-scoped variable":**

- Caused by declaring `const pressed` multiple times
- Declare once at function start, reuse throughout

**"Type X is not assignable to type Y":**

- Often needs explicit cast
- Check if mixing `i32` enum with `u8` storage
- Add `as u8` or `as i32` as appropriate

**"Decorator are not valid here":**

- AssemblyScript version may not support `@inline` on constants
- Can be safely ignored if build succeeds

**"Cannot find name 'WebAssemblyMemory'" / "Cannot find namespace 'WebAssembly'":**

- Some TS tooling doesn't include AssemblyScript's WebAssembly types
- Add a minimal local `WebAssembly` namespace with a `Memory` class in `src/assembly/sdk/memory.ts`

#### 14. Logging and Debugging

**Basic logging (string literals only):**

```ts
log("Game started"); // Initialization
warn("Low health"); // Important state changes
error("Invalid state"); // Unexpected conditions
```

**Logging with dynamic values (zero allocation):**

```ts
// ❌ WRONG - This allocates memory!
warn("Crocodile " + index.toString() + " not found");

// ✅ CORRECT - Zero allocation with interpolation
warni("Crocodile {} not found", index);
logi("Score: {}, Lives: {}", score, lives);
logf("Position: ({}, {})", playerX, playerY);
```

**Available interpolation functions:**

- `logi()`, `warni()`, `errori()` - Accept up to 4 integer parameters (i64)
- `logf()`, `warnf()`, `errorf()` - Accept up to 4 floating-point parameters (f64)
- Use `{}` as placeholders in the message string
- Parameters are interpolated on the JavaScript side (zero WASM allocation)

**Important notes:**

- Basic logs accept **string literals only** - no dynamic strings or concatenation
- Use interpolation functions to log dynamic values without allocation
- All messages are timestamped in the console panel

#### 15. Zero-Allocation Utilities

**CRITICAL: Never use dynamic allocation** - the runtime uses `--runtime stub` with zero heap.

**What causes allocation (FORBIDDEN):**

```ts
// ❌ WRONG - All of these allocate memory and will fail!
new Array<i32>(10);
new String("text");
const arr = [1, 2, 3];
const msg = "Score: " + score.toString();
```

**Zero-allocation alternatives:**

**1. Use interpolation for logging dynamic values:**

```ts
// ❌ WRONG - String concatenation allocates
warn(
  "Player " +
    id.toString() +
    " at (" +
    x.toString() +
    ", " +
    y.toString() +
    ")",
);

// ✅ CORRECT - Interpolation is zero allocation
warni("Player {} at ({}, {})", id, x, y);
```

**2. Use FixedArray for static-size arrays:**

```ts
import { FixedArray, RAM_START } from "./console";

// Calculate memory size needed
const GRID_SIZE = 100;
const gridBytes = FixedArray.sizeInMemory<u8>(GRID_SIZE); // 100 bytes

// Reserve in RAM layout
enum Var {
  GAME_STATE = 0, // u8
  SCORE = 1, // i32
  // Grid starts at offset 8, needs 100 bytes
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

**3. Use FixedArrayWithCount for dynamic-length tracking:**

```ts
import { FixedArrayWithCount, RAM_START } from "./console";

// Calculate memory size (includes length/capacity metadata)
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
- `FixedArrayWithCount<T, U>` - Includes `length` and `capacity` metadata (2 \* sizeof<U> bytes).
- Both use `@unmanaged` pattern - no heap allocation, just memory reinterpretation.
- Memory must be pre-allocated in your game's RAM layout.
- Use `U = u8` for small arrays (max 255 elements), `U = u16` for larger (max 65535).

**4. Use Vec2i.fromAddress() for coordinate pairs (NEVER use new Vec2i()):**

```ts
import { Vec2i, RAM_START } from "./console";

// Vec2i is @unmanaged but 'new' STILL ALLOCATES!
// ❌ WRONG - Triggers __alloc even with @unmanaged
const playerPos = new Vec2i(10, 20);
const enemyPos = new Vec2i(50, 100);

// ✅ CORRECT - Zero allocation with fromAddress
enum Var {
  GAME_STATE = 0, // u8 (1 byte)
  SCORE = 1, // i32 (4 bytes)
  PLAYER_POS = 8, // Vec2i (8 bytes: x, y as i32)
  ENEMY_POS = 16, // Vec2i (8 bytes)
}

const playerPos = Vec2i.fromAddress(RAM_START + Var.PLAYER_POS);
playerPos.x = 10;
playerPos.y = 20;

const enemyPos = Vec2i.fromAddress(RAM_START + Var.ENEMY_POS);
enemyPos.set(50, 100); // Set both at once

// Access in game logic
if (playerPos.x < 0) playerPos.x = 0;
if (playerPos.y > HEIGHT) playerPos.y = HEIGHT;
```

**CRITICAL:** The `@unmanaged` decorator prevents garbage collection tracking but does NOT prevent allocation from the `new` keyword. Always use `fromAddress()` to reinterpret pre-allocated memory as a Vec2i.

**Memory allocation strategy:**

```ts
// 1. Calculate all memory requirements
const gridSize = FixedArray.sizeInMemory<u8>(100); // 100 bytes
const itemsSize = FixedArrayWithCount.sizeInMemory<u16>(50); // 104 bytes

// 2. Define RAM layout with all sizes
enum Var {
  GAME_STATE = 0, // u8 (1 byte)
  SCORE = 1, // i32 (4 bytes)
  PLAYER_X = 5, // i32 (4 bytes)
  PLAYER_Y = 9, // i32 (4 bytes)
  GRID_START = 16, // 100 bytes for grid
  ITEMS_START = 116, // 104 bytes for items array
  // Total: 220 bytes
}

// 3. Create views over the allocated regions
const grid = FixedArray.fromAddress<u8>(RAM_START + Var.GRID_START);
const items = FixedArrayWithCount.fromAddress<u16>(RAM_START + Var.ITEMS_START);
```

### Complete Workflow for Creating a New Game

1. **Create game file**: `src/assembly/games/gameName.ts`

2. **Import required APIs**:

   ```ts
   import {
     clearFramebuffer,
     Button,
     logi,
     getI32,
     setI32,
     getU8,
     setU8,
     fillRect,
     drawRect,
     drawString,
     drawNumber,
     FixedArray,
     FixedArrayWithCount,
     RAM_START,
   } from "./console";
   ```

3. **Define constants and enums**:

   ```ts
   const GRID_SIZE: i32 = 10;
   const SPEED: i32 = 5;

   enum GameState {
     PLAYING = 0,
     GAME_OVER = 1,
   }
   ```

4. **Define RAM layout**:

   ```ts
   enum Var {
     GAME_STATE = 0,
     SCORE = 1,
     PLAYER_X = 5,
     PLAYER_Y = 9,
     // ... etc
   }
   ```

5. **Implement game logic functions**:

   ```ts
   function checkCollision(): boolean {
     /* ... */
   }
   function updatePlayer(): void {
     /* ... */
   }
   ```

6. **Implement lifecycle exports**:

   ```ts
   export function init(): void {
     setU8(Var.GAME_STATE, GameState.PLAYING as u8);
     setI32(Var.SCORE, 0);
     log("Game ready");
   }

   export function update(input: i32, prevInput: i32): void {
     const state = getU8(Var.GAME_STATE);
     const pressed = input & ~prevInput;

     if (state != GameState.PLAYING && pressed & Button.START) {
       init();
       return;
     }

     if (state != GameState.PLAYING) return;

     // Game logic...
   }

   export function draw(): void {
     clearFramebuffer(0x000000);
     // Draw game...

     const state = getU8(Var.GAME_STATE);
     if (state == GameState.GAME_OVER) {
       drawGameOverMessage("GAME OVER", 110, 0xaa5500, 0xffaa00);
     }
   }
   ```

7. **Do NOT update the game selector in index.html**:

   The game list is now populated at runtime by scanning `assets/cartridges/` for WASM files.
   Adding or removing `<option>` entries in `index.html` is a leftover pattern and should be avoided.

8. **Build and test (use CLI so postbuild uploads)**:

   ```bash
   npm run build:games gameName
   ```

   `gameName` must be the exact `.ts` filename without the extension.
   Run builds from the command line so the `postbuild` step runs and auto-uploads.
   **Always build after creating a game or making any game changes.**
   The game will be compiled to `assets/cartridges/gameName.wasm` and can be selected from the dropdown.

9. **Fix compilation errors**:
   - Add missing casts for enums: `as u8`, `as i32`
   - Add parentheses for operator precedence
   - Remove duplicate variable declarations
   - Check bounds and types match

10. **Test the game selector**:

- Start the server: `npm run serve`
- Open `http://localhost:8080/index.html`
- Your game should appear in the dropdown once its WASM exists in `assets/cartridges/`
- Selecting it loads the game without page refresh

11. **Verify game over flow**:
    - Game transitions to GAME_OVER state
    - "PRESS START" message displays
    - START button calls `init()` to restart

### Reference Game Summaries

**minesweeper.ts** (283 lines):

- Grid-based reveal logic with flood fill
- Bit flags enum for cell states (MINE, FLAGGED, REVEALED)
- Cursor-based navigation
- Win/lose conditions with colored messages
- Helper function for game over screen

**pong.ts** (268 lines):

- Floating-point physics for ball and paddles
- Two-player competitive (top vs bottom paddles)
- Score tracking with max score win condition
- Ball collision with paddles and walls
- Restart on START from game over

**snake.ts** (312 lines):

- Direction enum with invalid reverse detection
- Food spawning and collision
- Snake body tracking in grid array
- Growth mechanic with score
- Movement timer for speed control

All three games follow identical patterns for:

- GameState enum usage
- Memory-based state storage
- Button press detection
- Game over screen with restart
- Drawing optimization with clearFramebuffer
