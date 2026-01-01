// MINESWEEPER - Fantasy Console Game
// 10×10 grid, 15 mines, retro terminal aesthetic

import { clearFramebuffer, Button, log, getI32, setI32, getU8, setU8, drawNumber, drawString, drawRect, fillCircle, fillRect } from './console';

// === Constants ===
const GRID_SIZE: i32 = 10;
const MINE_COUNT: i32 = 15;
const CELL_SIZE: i32 = 24;
const GRID_OFFSET_X: i32 = 40;  // Center 240px grid in 320px width
const GRID_OFFSET_Y: i32 = 0;

// Cell bit flags
const CELL_MINE: u8 = 1 << 7;      // bit 7: has mine
const CELL_FLAGGED: u8 = 1 << 6;   // bit 6: flagged by player
const CELL_REVEALED: u8 = 1 << 5;  // bit 5: revealed
const CELL_COUNT_MASK: u8 = 0x0F;  // bits 0-3: adjacent mine count (0-8)

// Game states
const STATE_PLAYING: u8 = 0;
const STATE_WON: u8 = 1;
const STATE_LOST: u8 = 2;

// === RAM Layout ===
enum Var {
  CURSOR_X = 0,       // i32 - cursor X (0-9)
  CURSOR_Y = 4,       // i32 - cursor Y (0-9)
  GAME_STATE = 8,     // u8  - game state
  REVEALED_COUNT = 9, // u8  - revealed cells
  FLAG_COUNT = 10,    // u8  - flags placed
  RNG_SEED = 12,      // i32 - PRNG seed
  GRID_START = 16,    // 100 bytes - grid data (10×10)
}

// === Grid Helpers ===
@inline
function getCellData(x: i32, y: i32): u8 {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return 0;
  return getU8(Var.GRID_START + (y * GRID_SIZE + x));
}

@inline
function setCellData(x: i32, y: i32, data: u8): void {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  setU8(Var.GRID_START + (y * GRID_SIZE + x), data);
}

// === PRNG ===
@inline
function random(): i32 {
  let seed = getI32(Var.RNG_SEED);
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  setI32(Var.RNG_SEED, seed);
  return seed;
}

@inline
function randomRange(max: i32): i32 {
  return (random() % max);
}

// === Game Logic ===
function placeMines(): void {
  let placed: i32 = 0;
  while (placed < MINE_COUNT) {
    const x = randomRange(GRID_SIZE);
    const y = randomRange(GRID_SIZE);
    const cell = getCellData(x, y);
    
    if ((cell & CELL_MINE) == 0) {
      setCellData(x, y, cell | CELL_MINE);
      placed++;
    }
  }
}

function calculateAdjacentMines(): void {
  for (let y: i32 = 0; y < GRID_SIZE; y++) {
    for (let x: i32 = 0; x < GRID_SIZE; x++) {
      const cell = getCellData(x, y);
      if (cell & CELL_MINE) continue;
      
      let count: i32 = 0;
      for (let dy: i32 = -1; dy <= 1; dy++) {
        for (let dx: i32 = -1; dx <= 1; dx++) {
          if (dx == 0 && dy == 0) continue;
          const neighbor = getCellData(x + dx, y + dy);
          if (neighbor & CELL_MINE) count++;
        }
      }
      
      setCellData(x, y, (cell & ~CELL_COUNT_MASK) | (count as u8));
    }
  }
}

function revealCell(x: i32, y: i32): void {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
  
  let cell = getCellData(x, y);
  if ((cell & CELL_REVEALED) || (cell & CELL_FLAGGED)) return;
  
  // Reveal this cell
  cell |= CELL_REVEALED;
  setCellData(x, y, cell);
  setU8(Var.REVEALED_COUNT, getU8(Var.REVEALED_COUNT) + 1);
  
  // If mine, game over
  if (cell & CELL_MINE) {
    setU8(Var.GAME_STATE, STATE_LOST);
    log("Game Over!");
    return;
  }
  
  // If zero mines adjacent, flood fill (iterative)
  if ((cell & CELL_COUNT_MASK) == 0) {
    for (let dy: i32 = -1; dy <= 1; dy++) {
      for (let dx: i32 = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) continue;
        revealCell(x + dx, y + dy);
      }
    }
  }
}

function toggleFlag(x: i32, y: i32): void {
  let cell = getCellData(x, y);
  if (cell & CELL_REVEALED) return;
  
  if (cell & CELL_FLAGGED) {
    cell &= ~CELL_FLAGGED;
    setU8(Var.FLAG_COUNT, getU8(Var.FLAG_COUNT) - 1);
  } else if ((getU8(Var.FLAG_COUNT) as i32) < MINE_COUNT) {
    cell |= CELL_FLAGGED;
    setU8(Var.FLAG_COUNT, getU8(Var.FLAG_COUNT) + 1);
  }
  setCellData(x, y, cell);
}

function checkWin(): void {
  const revealed = getU8(Var.REVEALED_COUNT) as i32;
  const target = GRID_SIZE * GRID_SIZE - MINE_COUNT;
  if (revealed >= target) {
    setU8(Var.GAME_STATE, STATE_WON);
    log("You Win!");
  }
}

// === Lifecycle ===
export function init(): void {
  log("Minesweeper starting...");
  
  // Clear grid
  for (let i: i32 = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    setU8(Var.GRID_START + i, 0);
  }
  
  // Initialize state
  setI32(Var.CURSOR_X, 5);
  setI32(Var.CURSOR_Y, 5);
  setU8(Var.GAME_STATE, STATE_PLAYING);
  setU8(Var.REVEALED_COUNT, 0);
  setU8(Var.FLAG_COUNT, 0);
  setI32(Var.RNG_SEED, 12345);
  
  // Setup game
  placeMines();
  calculateAdjacentMines();
  
  log("Minesweeper ready!");
}

export function update(input: i32, prevInput: i32): void {
  const state = getU8(Var.GAME_STATE);
  if (state != STATE_PLAYING) return;
  
  let cx = getI32(Var.CURSOR_X);
  let cy = getI32(Var.CURSOR_Y);
  
  // Detect button presses
  const pressed = input & ~prevInput;
  
  // Move cursor
  if (pressed & Button.LEFT)  { cx--; if (cx < 0) cx = 0; }
  if (pressed & Button.RIGHT) { cx++; if (cx >= GRID_SIZE) cx = GRID_SIZE - 1; }
  if (pressed & Button.UP)    { cy--; if (cy < 0) cy = 0; }
  if (pressed & Button.DOWN)  { cy++; if (cy >= GRID_SIZE) cy = GRID_SIZE - 1; }
  
  setI32(Var.CURSOR_X, cx);
  setI32(Var.CURSOR_Y, cy);
  
  // Actions
  if (pressed & Button.A) {
    revealCell(cx, cy);
    checkWin();
  }
  
  if (pressed & Button.B) {
    toggleFlag(cx, cy);
  }
}

export function draw(): void {
  clearFramebuffer(0x0a0a0a);
  
  const state = getU8(Var.GAME_STATE);
  const cx = getI32(Var.CURSOR_X);
  const cy = getI32(Var.CURSOR_Y);
  
  // Draw grid
  for (let y: i32 = 0; y < GRID_SIZE; y++) {
    for (let x: i32 = 0; x < GRID_SIZE; x++) {
      const cell = getCellData(x, y);
      const sx = GRID_OFFSET_X + x * CELL_SIZE;
      const sy = GRID_OFFSET_Y + y * CELL_SIZE;
      
      // Cell background
      let bgColor: u32 = 0x1a1a1a;
      if (cell & CELL_REVEALED) {
        bgColor = 0x000000;
      }
      fillRect(sx + 1, sy + 1, CELL_SIZE - 2, CELL_SIZE - 2, bgColor);
      
      // Cell border
      let borderColor: u32 = 0x333333;
      if (x == cx && y == cy) {
        borderColor = 0x00ff00; // Green cursor
      }
      drawRect(sx, sy, CELL_SIZE, CELL_SIZE, borderColor);
      
      // Cell content
      if (cell & CELL_REVEALED) {
        if (cell & CELL_MINE) {
          // Draw mine (red circle)
          fillCircle(sx + 12, sy + 12, 6, 0xff0000);
        } else {
          const count = cell & CELL_COUNT_MASK;
          if (count > 0) {
            drawNumber(sx + 8, sy + 8, count, 0x00ff00);
          }
        }
      } else if (cell & CELL_FLAGGED) {
        // Draw flag (yellow)
        fillRect(sx + 10, sy + 6, 4, 12, 0xffaa00);
      } else if (state == STATE_LOST && (cell & CELL_MINE)) {
        // Reveal all mines when lost
        fillCircle(sx + 12, sy + 12, 6, 0xff0000);
      }
    }
  }
  
  // Status bar
  const flagCount = getU8(Var.FLAG_COUNT);
  const remaining = MINE_COUNT - flagCount;
  
  // Draw mine count indicator
  for (let i: i32 = 0; i < remaining && i < 15; i++) {
    fillCircle(10, 10 + i * 8, 3, 0xff0000);
  }
  
  // Game over messages
  if (state == STATE_WON) {
    // Draw background frame
    fillRect(75, 105, 170, 30, 0x0044aa);
    drawRect(75, 105, 170, 30, 0x00aaff);
    drawString(120, 115, "YOU WIN!", 0x00aaff);
  } else if (state == STATE_LOST) {
    // Draw background frame
    fillRect(75, 105, 170, 30, 0xaa5500);
    drawRect(75, 105, 170, 30, 0xffaa00);
    drawString(120, 115, "GAME OVER", 0xffaa00);
  }
}
