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
- `dist/cartridges/` contains built WASM cartridges
- `dist/memory-map.js` is the built memory map module
- `assets/` holds sprites, sfx, and music

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
  GAME_STATE = 0,     // u8
  SCORE = 1,          // i32
  PLAYER_X = 5,       // i32
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
  GAME_OVER = 1
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
if (state == GameState.PLAYING) { /* ... */ }
```

**Common enum patterns:**
```ts
enum Direction {
  UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3
}

enum GameState {
  PLAYING = 0, GAME_OVER = 1, PAUSED = 2
}

// Bit flags (for cell states, etc)
enum CellFlag {
  MINE = 1 << 7,
  FLAGGED = 1 << 6,
  REVEALED = 1 << 5,
  COUNT_MASK = 0x0F
}
```

#### 4. Drawing System

**Always import drawing helpers from console.ts:**
```ts
import { 
  clearFramebuffer, pset, fillRect, drawRect, 
  fillCircle, drawString, drawNumber 
} from './console';
```

**NEVER define local drawing helpers** - they belong in console.ts.

**Color format: 0xAABBGGRR (with alpha forced to 0xFF):**
```ts
clearFramebuffer(0x000000);  // Black background
pset(x, y, 0xff0000);       // Red pixel
fillRect(10, 10, 50, 50, 0x00ff00);  // Green rectangle
```

**Frame clearing:**
```ts
export function draw(): void {
  clearFramebuffer(0x0a0a0a);  // Always clear first
  // ... draw game
}
```

#### 5. Input Handling Pattern

**Button press detection (not hold):**
```ts
export function update(input: i32, prevInput: i32): void {
  const pressed = input & ~prevInput;  // Detect new presses
  
  if (pressed & Button.A) { /* A just pressed */ }
  if (pressed & Button.START) { /* START just pressed */ }
}
```

**Button hold detection:**
```ts
if (input & Button.LEFT) { /* LEFT is held down */ }
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
  if (state != GameState.PLAYING && (pressed & Button.START)) {
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
if (x < WIDTH as f32) { }

// ✅ CORRECT - parentheses force proper order
if (x < (WIDTH as f32)) { }

// ❌ WRONG
ballX = WIDTH - BALL_SIZE as f32;

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
ballX = paddleX + (WIDTH / 2);

// ✅ CORRECT - cast integer to f32 first
ballX = paddleX + ((WIDTH / 2) as f32);

// ❌ WRONG - cannot subtract i32 from f32
ballY = (paddleY - BALL_SIZE) as f32;

// ✅ CORRECT - perform subtraction first, then cast
ballY = ((paddleX - BALL_SIZE) as f32);
```

**2. Comparisons between different types:**
```ts
// ❌ WRONG - comparing f32 with i32 result
if (ballY + (BALL_SIZE as f32) <= PADDLE_Y + PADDLE_HEIGHT) { }

// ✅ CORRECT - cast the entire right side
if (ballY + (BALL_SIZE as f32) <= ((PADDLE_Y + PADDLE_HEIGHT) as f32)) { }
```

**3. Complex expressions with mixed types:**
```ts
// ❌ WRONG - multiple type mismatches
const hitPos = (ballX + (SIZE / 2) as f32 - paddleX) / (WIDTH as f32);

// ✅ CORRECT - wrap each operation properly
const hitPos = (ballX + ((SIZE / 2) as f32) - paddleX) / (WIDTH as f32);
```

**4. Division and multiplication:**
```ts
// Integer division stays integer
const half: i32 = WIDTH / 2;  // i32

// Float division needs explicit types
const half: f32 = (WIDTH as f32) / 2.0;  // f32
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

#### 10. Common Patterns

**Cursor/player movement with bounds:**
```ts
let x = getI32(Var.PLAYER_X);
if (pressed & Button.LEFT)  { x--; if (x < 0) x = 0; }
if (pressed & Button.RIGHT) { x++; if (x >= MAX_X) x = MAX_X - 1; }
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
```ts
// Use the SDK RNG seed in shared memory.
const roll = random() % 10;
const index = randomRange(7); // [0, 7)
```

#### 11. Build Configuration

**Update package.json when creating new games:**
```json
{
  "scripts": {
    "build:debug": "asc src/assembly/games/yourgame.ts -o dist/cartridges/yourgame.wasm ..."
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

#### 12. Compilation Error Patterns

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

#### 13. Logging and Debugging

**Use logging strategically:**
```ts
log("Game started");     // Initialization
warn("Low health");      // Important state changes  
error("Invalid state");  // Unexpected conditions
```

**Logs accept string literals only** - no dynamic strings or concatenation.

### Complete Workflow for Creating a New Game

1. **Create game file**: `src/assembly/games/yourgame.ts`

2. **Import required APIs**:
   ```ts
   import { 
     clearFramebuffer, Button, log, 
     getI32, setI32, getU8, setU8,
     fillRect, drawRect, drawString, drawNumber
   } from './console';
   ```

3. **Define constants and enums**:
   ```ts
   const GRID_SIZE: i32 = 10;
   const SPEED: i32 = 5;
   
   enum GameState { PLAYING = 0, GAME_OVER = 1 }
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
   function checkCollision(): boolean { /* ... */ }
   function updatePlayer(): void { /* ... */ }
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
     
     if (state != GameState.PLAYING && (pressed & Button.START)) {
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
   
   The game list is now populated at runtime by scanning `dist/cartridges/` for WASM files.
   Adding or removing `<option>` entries in `index.html` is a leftover pattern and should be avoided.

8. **Build and test (use CLI so postbuild uploads)**:
   ```bash
   npm run build:games gameName
   ```
  
   `gameName` must be the exact `.ts` filename without the extension.
   Run builds from the command line so the `postbuild` step runs and auto-uploads.
   **Always build after creating a game or making any game changes.**
   The game will be compiled to `dist/cartridges/yourgame.wasm` and can be selected from the dropdown.

9. **Fix compilation errors**:
   - Add missing casts for enums: `as u8`, `as i32`
   - Add parentheses for operator precedence
   - Remove duplicate variable declarations
   - Check bounds and types match

10. **Test the game selector**:
   - Start the server: `npm run serve`
   - Open `http://localhost:8080/index.html`
   - Your game should appear in the dropdown once its WASM exists in `dist/cartridges/`
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
