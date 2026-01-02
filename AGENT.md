---
applyTo: "**"
---

## Guide for AI Agents: Building Games for This Console

This section provides detailed instructions for AI agents tasked with creating games for this fantasy console, based on patterns established in three reference games: **minesweeper.ts**, **pong.ts**, and **snake.ts**.

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

**Factorize message rendering with helper function:**
```ts
function drawGameOverMessage(message: string, x: i32, bgColor: u32, fgColor: u32): void {
  fillRect(75, 105, 170, 45, bgColor);
  drawRect(75, 105, 170, 45, fgColor);
  drawString(x, 112, message, fgColor);
  drawString(90, 127, "PRESS START", 0xaaaaaa);
}

export function draw(): void {
  // ... draw game
  
  const state = getU8(Var.GAME_STATE);
  if (state == GameState.GAME_OVER) {
    drawGameOverMessage("GAME OVER", 110, 0xaa5500, 0xffaa00);
  }
}
```

**Always include "PRESS START" instruction** on game over screens.

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

#### 9. Common Patterns

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
function random(): i32 {
  let seed = getI32(Var.RNG_SEED);
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  setI32(Var.RNG_SEED, seed);
  return seed;
}
```

#### 10. Build Configuration

**Update package.json when creating new games:**
```json
{
  "scripts": {
    "build:debug": "asc games/yourgame.ts -o cartridges/yourgame.wasm ..."
  }
}
```

**Or use asconfig.json targets** in the games/ directory.

#### 11. Compilation Error Patterns

**Decorator errors (`@inline`):**
- These are pre-existing and don't affect compilation
- Can be ignored unless causing actual build failures

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

#### 12. Logging and Debugging

**Use logging strategically:**
```ts
log("Game started");     // Initialization
warn("Low health");      // Important state changes  
error("Invalid state");  // Unexpected conditions
```

**Logs accept string literals only** - no dynamic strings or concatenation.

### Complete Workflow for Creating a New Game

1. **Create game file**: `games/yourgame.ts`

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

7. **Update build configuration in package.json**:
   
   Add build scripts for your new game:
   ```json
   {
     "scripts": {
       "build": "npm run build:minesweeper && npm run build:pong && npm run build:snake && npm run build:yourgame",
       "build:debug": "npm run build:minesweeper:debug && npm run build:pong:debug && npm run build:snake:debug && npm run build:yourgame:debug",
       "build:yourgame": "asc games/yourgame.ts -o cartridges/yourgame.wasm --config games/asconfig.json",
       "build:yourgame:debug": "asc games/yourgame.ts -o cartridges/yourgame.wasm --config games/asconfig.json --target debug"
     }
   }
   ```
   
   **Key points:**
   - Add both production and debug build scripts
   - Output to `cartridges/` folder
   - Update the main `build` and `build:debug` scripts to include your new game
   - Use the existing `asconfig.json` in the games folder

8. **Add game to selector in host/index.html**:
   
   Add an option to the game select dropdown:
   ```html
   <select id="game-select" class="game-selector">
     <option value="minesweeper">Minesweeper</option>
     <option value="pong">Pong</option>
     <option value="snake">Snake</option>
     <option value="yourgame">Your Game Name</option>
   </select>
   ```
   
   **Key points:**
   - The `value` attribute must match the WASM filename (without `.wasm` extension)
   - The display text can be anything user-friendly
   - Add the option inside the existing `<select id="game-select">` element

9. **Build and test**:
   ```bash
   npm run build:debug
   ```
   
   The game will be compiled to `cartridges/yourgame.wasm` and can be selected from the dropdown.

10. **Fix compilation errors**:
   - Add missing casts for enums: `as u8`, `as i32`
   - Add parentheses for operator precedence
   - Remove duplicate variable declarations
   - Check bounds and types match

11. **Test the game selector**:
   - Start the server: `npm run serve`
   - Open `http://localhost:8080/host/index.html`
   - Your game should appear in the dropdown
   - Selecting it loads the game without page refresh

12. **Verify game over flow**:
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
