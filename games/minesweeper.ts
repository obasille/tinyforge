// MINESWEEPER - TinyForge Game
// 10×10 grid, 15 mines, retro terminal aesthetic

import {
  clearFramebuffer,
  Button,
  buttonPressed,
  log,
  getI32,
  setI32,
  getU8,
  setU8,
  drawNumber,
  drawRect,
  fillCircle,
  fillRect,
  c,
  random,
  drawMessageBox,
  RAM_START,
  Vec2i,
  mouseX,
  mouseY,
  mousePressed,
  MouseButton,
  playSfx,
  playMusic,
  stopMusic,
  drawSprite,
} from "../sdk";

// === Constants ===
@inline
const GRID_SIZE: i32 = 10;
@inline
const MINE_COUNT: i32 = 15;
@inline
const CELL_SIZE: i32 = 24;
@inline
const GRID_OFFSET_X: i32 = 40; // Center 240px grid in 320px width
@inline
const GRID_OFFSET_Y: i32 = 0;

// Audio IDs
enum SFX {
  FLAG = 0,      // Flag placement/removal
  EXPLODE = 1,   // Mine explosion
  WIN = 2,       // Victory sound
  REVEAL = 4,    // Cell reveal sound
}

enum Music {
  GAMEPLAY = 0,  // Background music
}

// Cell bit flags
enum CellFlag {
  MINE = 1 << 7, // bit 7: has mine
  FLAGGED = 1 << 6, // bit 6: flagged by player
  REVEALED = 1 << 5, // bit 5: revealed
  COUNT_MASK = 0x0f, // bits 0-3: adjacent mine count (0-8)
}

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  WON = 2,
  LOST = 3,
}

// === RAM Layout ===
enum Var {
  CURSOR_X = 0, // i32 - cursor X (0-9)
  CURSOR_Y = 4, // i32 - cursor Y (0-9)
  GAME_STATE = 8, // u8  - game state
  REVEALED_COUNT = 9, // u8  - revealed cells
  FLAG_COUNT = 10, // u8  - flags placed
  RNG_SEED = 12, // i32 - PRNG seed
  GRID_START = 16, // 100 bytes - grid data (10×10)
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

@inline
function randomRange(max: i32): i32 {
  return random(RAM_START + Var.RNG_SEED) % max;
}

// === Game Logic ===
function placeMines(): void {
  let placed: i32 = 0;
  while (placed < MINE_COUNT) {
    const x = randomRange(GRID_SIZE);
    const y = randomRange(GRID_SIZE);
    const cell = getCellData(x, y);

    if ((cell & CellFlag.MINE) == 0) {
      setCellData(x, y, (cell | CellFlag.MINE) as u8);
      placed++;
    }
  }
}

function calculateAdjacentMines(): void {
  for (let y: i32 = 0; y < GRID_SIZE; y++) {
    for (let x: i32 = 0; x < GRID_SIZE; x++) {
      const cell = getCellData(x, y);
      if (cell & CellFlag.MINE) continue;

      let count: i32 = 0;
      for (let dy: i32 = -1; dy <= 1; dy++) {
        for (let dx: i32 = -1; dx <= 1; dx++) {
          if (dx == 0 && dy == 0) continue;
          const neighbor = getCellData(x + dx, y + dy);
          if (neighbor & CellFlag.MINE) count++;
        }
      }

      setCellData(x, y, ((cell & ~CellFlag.COUNT_MASK) | (count as u8)) as u8);
    }
  }
}

function revealCell(x: i32, y: i32): void {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;

  let cell = getCellData(x, y);
  if (cell & CellFlag.REVEALED || cell & CellFlag.FLAGGED) return;

  // Reveal this cell
  cell |= CellFlag.REVEALED as u8;
  setCellData(x, y, cell);
  setU8(Var.REVEALED_COUNT, getU8(Var.REVEALED_COUNT) + 1);

  // If mine, game over
  if (cell & CellFlag.MINE) {
    setU8(Var.GAME_STATE, GameState.LOST as u8);
    playSfx(SFX.EXPLODE, 0.8);
    stopMusic();
    log("Game Over!");
    return;
  }

  // Play reveal sound
  playSfx(SFX.REVEAL, 0.3);

  // If zero mines adjacent, flood fill (iterative)
  if ((cell & CellFlag.COUNT_MASK) == 0) {
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
  if (cell & CellFlag.REVEALED) return;

  if (cell & CellFlag.FLAGGED) {
    cell &= ~(CellFlag.FLAGGED as u8);
    setU8(Var.FLAG_COUNT, getU8(Var.FLAG_COUNT) - 1);
    playSfx(SFX.FLAG, 0.4);
  } else if ((getU8(Var.FLAG_COUNT) as i32) < MINE_COUNT) {
    cell |= CellFlag.FLAGGED as u8;
    setU8(Var.FLAG_COUNT, getU8(Var.FLAG_COUNT) + 1);
    playSfx(SFX.FLAG, 0.4);
  }
  setCellData(x, y, cell);
}

function checkWin(): void {
  const revealed = getU8(Var.REVEALED_COUNT) as i32;
  const target = GRID_SIZE * GRID_SIZE - MINE_COUNT;
  if (revealed >= target) {
    setU8(Var.GAME_STATE, GameState.WON as u8);
    playSfx(SFX.WIN, 0.8);
    stopMusic();
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
  setU8(Var.GAME_STATE, GameState.START_SCREEN as u8);
  setU8(Var.REVEALED_COUNT, 0);
  setU8(Var.FLAG_COUNT, 0);
  setI32(Var.RNG_SEED, 12345);

  // Setup game
  placeMines();
  calculateAdjacentMines();

  log("Minesweeper ready!");
}

export function update(): void {
  const state = getU8(Var.GAME_STATE);

  // Start game from start screen
  if (
    state == GameState.START_SCREEN &&
    (buttonPressed(Button.START) ||
      mousePressed(MouseButton.LEFT) ||
      mousePressed(MouseButton.RIGHT))
  ) {
    setU8(Var.GAME_STATE, GameState.PLAYING as u8);
    // Start music after user interaction
    playMusic(Music.GAMEPLAY, 0.5);
    return;
  }

  // Restart on START button or mouse click
  if (
    (state == GameState.WON || state == GameState.LOST) &&
    (buttonPressed(Button.START) ||
      mousePressed(MouseButton.LEFT) ||
      mousePressed(MouseButton.RIGHT))
  ) {
    init();
    return;
  }

  if (state != GameState.PLAYING) return;

  // Get mouse position and convert to grid coordinates
  const mx = mouseX();
  const my = mouseY();

  let cx = getI32(Var.CURSOR_X);
  let cy = getI32(Var.CURSOR_Y);

  // Update cursor position based on mouse hover
  if (mx >= 0 && my >= 0) {
    const gridX = (mx - GRID_OFFSET_X) / CELL_SIZE;
    const gridY = (my - GRID_OFFSET_Y) / CELL_SIZE;

    if (gridX >= 0 && gridX < GRID_SIZE && gridY >= 0 && gridY < GRID_SIZE) {
      cx = gridX;
      cy = gridY;
      setI32(Var.CURSOR_X, cx);
      setI32(Var.CURSOR_Y, cy);
    }
  }

  // Left click to reveal cell
  if (mousePressed(MouseButton.LEFT)) {
    revealCell(cx, cy);
    checkWin();
  }

  // Right click to toggle flag
  if (mousePressed(MouseButton.RIGHT)) {
    toggleFlag(cx, cy);
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a0a));

  const state = getU8(Var.GAME_STATE);
  const cx = getI32(Var.CURSOR_X);
  const cy = getI32(Var.CURSOR_Y);

  // Pre-convert colors
  const colorBg = c(0x1a1a1a);
  const colorBgRevealed = c(0x000000);
  const colorBorder = c(0x333333);
  const colorCursor = c(0x00ff00);
  const colorMine = c(0xff0000);
  const colorNumber = c(0x00ff00);
  const colorFlag = c(0xffaa00);

  // Draw grid
  for (let y: i32 = 0; y < GRID_SIZE; y++) {
    for (let x: i32 = 0; x < GRID_SIZE; x++) {
      const cell = getCellData(x, y);
      const sx = GRID_OFFSET_X + x * CELL_SIZE;
      const sy = GRID_OFFSET_Y + y * CELL_SIZE;

      // Cell background
      if (cell & CellFlag.REVEALED) {
        fillRect(sx + 1, sy + 1, CELL_SIZE - 2, CELL_SIZE - 2, colorBgRevealed);
      } else {
        fillRect(sx + 1, sy + 1, CELL_SIZE - 2, CELL_SIZE - 2, colorBg);
      }

      // Cell border
      if (x == cx && y == cy) {
        drawRect(sx, sy, CELL_SIZE, CELL_SIZE, colorCursor); // Green cursor
      } else {
        drawRect(sx, sy, CELL_SIZE, CELL_SIZE, colorBorder);
      }

      // Cell content
      if (cell & CellFlag.REVEALED) {
        if (cell & CellFlag.MINE) {
          // Draw mine (red circle)
          fillCircle(sx + 12, sy + 12, 6, colorMine);
        } else {
          const count = cell & CellFlag.COUNT_MASK;
          if (count > 0) {
            drawNumber(sx + 8, sy + 8, count, colorNumber);
          }
        }
      } else if (cell & CellFlag.FLAGGED) {
        // Draw flag sprite
        drawSprite(0, sx + 4, sy + 4);
      } else if (state == GameState.LOST && cell & CellFlag.MINE) {
        // Reveal all mines when lost
        fillCircle(sx + 12, sy + 12, 6, colorMine);
      }
    }
  }

  // Status bar
  const flagCount = getU8(Var.FLAG_COUNT);
  const remaining = MINE_COUNT - flagCount;

  // Draw mine count indicator
  for (let i: i32 = 0; i < remaining && i < 15; i++) {
    fillCircle(10, 10 + i * 8, 3, c(0xff0000));
  }

  // Game messages
  if (state == GameState.START_SCREEN) {
    drawGameFinishedMessage("MINESWEEPER", c(0x1a1a1a), c(0x00ff00));
  } else if (state == GameState.WON) {
    drawGameFinishedMessage("YOU WIN!", c(0x0044aa), c(0x00aaff));
  } else if (state == GameState.LOST) {
    drawGameFinishedMessage("GAME OVER", c(0xaa5500), c(0xffaa00));
  }
}

function drawGameFinishedMessage(
  message: string,
  bgColor: u32,
  fgColor: u32,
): void {
  drawMessageBox(
    new Vec2i(75, 95),
    new Vec2i(170, 50),
    message,
    new Vec2i(50, 12),
    "PRESS START",
    new Vec2i(40, 27),
    bgColor,
    fgColor,
  );
}
