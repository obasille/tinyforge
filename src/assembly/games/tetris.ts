// TETRIS - TinyForge Game
// Classic falling-block puzzle with 10x20 grid

import {
  Button,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawNumber,
  drawRect,
  drawStartMessageBox,
  drawString,
  fillRect,
  getU8,
  HEIGHT,
  log,
  RAM_START,
  randomRange,
  setU8,
  WIDTH,
} from "../sdk";

// === Constants ===
const BOARD_WIDTH: i32 = 10;
const BOARD_HEIGHT: i32 = 20;
const CELL_SIZE: i32 = 12;
const BOARD_X: i32 = (WIDTH - BOARD_WIDTH * CELL_SIZE) / 2;
const BOARD_Y: i32 = (HEIGHT - BOARD_HEIGHT * CELL_SIZE) / 2;

const INITIAL_FALL_DELAY: u8 = 60;
const MIN_FALL_DELAY: u8 = 2;
const PREVIEW_SIZE: i32 = 4;
const PREVIEW_X: i32 = BOARD_X + BOARD_WIDTH * CELL_SIZE + 16;
const PREVIEW_Y: i32 = BOARD_Y + 15;

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  GAME_OVER = 2,
}

// === RAM Layout ===
@unmanaged
class Vars {
  score: i32;            // 0
  lines: i32;            // 4
  currentX: i32;         // 8
  currentY: i32;         // 12
  state: u8;             // 16
  currentType: u8;       // 17
  currentRotation: u8;   // 18
  fallTimer: u8;         // 19
  fallDelay: u8;         // 20
  level: u8;             // 21
  nextType: u8;          // 22
}

const vars = changetype<Vars>(RAM_START);
const BOARD_START = RAM_START + sizeof<Vars>(); // 200 bytes for board

// === Tetromino Data ===
// Each piece is a 4x4 bitmask (row-major). Index = type * 4 + rotation.
const SHAPES: i32[] = [
  // I
  0x00f0, 0x2222, 0x00f0, 0x2222,
  // O
  0x0066, 0x0066, 0x0066, 0x0066,
  // T
  0x0072, 0x0262, 0x0270, 0x0232,
  // S
  0x0036, 0x0462, 0x0036, 0x0462,
  // Z
  0x0063, 0x0264, 0x0063, 0x0264,
  // J
  0x0071, 0x0226, 0x0470, 0x0322,
  // L
  0x0074, 0x0622, 0x0170, 0x0223,
];

const PIECE_COLORS: u32[] = [
  0x00ffff, // I
  0xffff00, // O
  0xaa00ff, // T
  0x00ff00, // S
  0xff0000, // Z
  0x0066ff, // J
  0xffaa00, // L
];

// === Board Helpers ===
// @ts-expect-error AssemblyScript decorator
@inline
function boardIndex(x: i32, y: i32): usize {
  return BOARD_START + (y * BOARD_WIDTH + x);
}

// @ts-expect-error AssemblyScript decorator
@inline
function getBoardCell(x: i32, y: i32): u8 {
  return getU8(boardIndex(x, y));
}

// @ts-expect-error AssemblyScript decorator
@inline
function setBoardCell(x: i32, y: i32, value: u8): void {
  setU8(boardIndex(x, y), value);
}

// @ts-expect-error AssemblyScript decorator
@inline
function shapeMask(pieceType: u8, rotation: u8): i32 {
  return SHAPES[(pieceType as i32) * 4 + (rotation as i32)];
}

function clearBoard(): void {
  const total = BOARD_WIDTH * BOARD_HEIGHT;
  for (let i: i32 = 0; i < total; i++) {
    setU8(BOARD_START + i, 0);
  }
}

function randomPiece(): u8 {
  return randomRange(7) as u8;
}

function canPlace(pieceType: u8, px: i32, py: i32, rotation: u8): bool {
  const mask = shapeMask(pieceType, rotation);
  for (let y: i32 = 0; y < 4; y++) {
    for (let x: i32 = 0; x < 4; x++) {
      if ((mask & (1 << (y * 4 + x))) == 0) continue;

      const gx = px + x;
      const gy = py + y;

      if (gx < 0 || gx >= BOARD_WIDTH || gy >= BOARD_HEIGHT) {
        return false;
      }
      if (gy >= 0 && getBoardCell(gx, gy) != 0) {
        return false;
      }
    }
  }
  return true;
}

function placeCurrentPiece(): void {
  const mask = shapeMask(vars.currentType, vars.currentRotation);
  for (let y: i32 = 0; y < 4; y++) {
    for (let x: i32 = 0; x < 4; x++) {
      if ((mask & (1 << (y * 4 + x))) == 0) continue;

      const gx = vars.currentX + x;
      const gy = vars.currentY + y;
      if (gy >= 0 && gx >= 0 && gx < BOARD_WIDTH && gy < BOARD_HEIGHT) {
        setBoardCell(gx, gy, (vars.currentType + 1) as u8);
      }
    }
  }
}

function clearLines(): i32 {
  let cleared: i32 = 0;
  let y: i32 = BOARD_HEIGHT - 1;

  while (y >= 0) {
    let full = true;
    for (let x: i32 = 0; x < BOARD_WIDTH; x++) {
      if (getBoardCell(x, y) == 0) {
        full = false;
        break;
      }
    }

    if (full) {
      cleared++;
      for (let yy: i32 = y; yy > 0; yy--) {
        for (let x: i32 = 0; x < BOARD_WIDTH; x++) {
          setBoardCell(x, yy, getBoardCell(x, yy - 1));
        }
      }
      for (let x: i32 = 0; x < BOARD_WIDTH; x++) {
        setBoardCell(x, 0, 0);
      }
    } else {
      y--;
    }
  }

  return cleared;
}

function updateFallDelay(): void {
  const level = vars.level as i32;
  let delay = INITIAL_FALL_DELAY - level;
  if (delay < (MIN_FALL_DELAY as i32)) delay = MIN_FALL_DELAY as i32;
  vars.fallDelay = delay as u8;
}

function spawnPiece(): void {
  const nextType = vars.nextType;
  const nextRotation: u8 = 0;
  const nextX = (BOARD_WIDTH / 2) - 2;
  const nextY = -1;

  if (!canPlace(nextType, nextX, nextY, nextRotation)) {
    vars.state = GameState.GAME_OVER as u8;
    log("Game Over!");
    return;
  }

  vars.currentType = nextType;
  vars.currentRotation = nextRotation;
  vars.currentX = nextX;
  vars.currentY = nextY;
  vars.nextType = randomPiece();
}

function tryMove(dx: i32, dy: i32): bool {
  const nx = vars.currentX + dx;
  const ny = vars.currentY + dy;
  if (canPlace(vars.currentType, nx, ny, vars.currentRotation)) {
    vars.currentX = nx;
    vars.currentY = ny;
    return true;
  }
  return false;
}

function tryRotate(clockwise: bool): void {
  const rot = vars.currentRotation;
  const nextRot = clockwise ? ((rot + 1) & 3) as u8 : ((rot + 3) & 3) as u8;

  if (canPlace(vars.currentType, vars.currentX, vars.currentY, nextRot)) {
    vars.currentRotation = nextRot;
    return;
  }

  // Simple wall kicks
  if (canPlace(vars.currentType, vars.currentX - 1, vars.currentY, nextRot)) {
    vars.currentX -= 1;
    vars.currentRotation = nextRot;
    return;
  }
  if (canPlace(vars.currentType, vars.currentX + 1, vars.currentY, nextRot)) {
    vars.currentX += 1;
    vars.currentRotation = nextRot;
    return;
  }
}

function stepDown(): void {
  if (tryMove(0, 1)) return;

  placeCurrentPiece();
  const cleared = clearLines();
  if (cleared > 0) {
    vars.lines += cleared;
    vars.score += cleared * 100;
    vars.level = (vars.lines / 10) as u8;
    updateFallDelay();
  }
  spawnPiece();
}

function hardDrop(): void {
  while (tryMove(0, 1)) {
    // Move down until blocked.
  }
  placeCurrentPiece();
  const cleared = clearLines();
  if (cleared > 0) {
    vars.lines += cleared;
    vars.score += cleared * 100;
    vars.level = (vars.lines / 10) as u8;
    updateFallDelay();
  }
  spawnPiece();
}

// === Lifecycle ===
export function init(): void {
  clearBoard();
  vars.score = 0;
  vars.lines = 0;
  vars.level = 0;
  vars.fallDelay = INITIAL_FALL_DELAY;
  vars.fallTimer = vars.fallDelay;
  vars.state = GameState.START_SCREEN as u8;
  vars.nextType = randomPiece();
}

export function update(): void {
  const state = vars.state;

  // Start game from start screen
  if (state == GameState.START_SCREEN && buttonPressed(Button.START)) {
    vars.state = GameState.PLAYING as u8;
    spawnPiece();
    return;
  }

  // Restart on START from game over
  if (state == GameState.GAME_OVER && buttonPressed(Button.START)) {
    init();
    return;
  }

  if (state != GameState.PLAYING) return;

  // Horizontal movement
  if (buttonPressed(Button.LEFT)) {
    tryMove(-1, 0);
  } else if (buttonPressed(Button.RIGHT)) {
    tryMove(1, 0);
  }

  // Rotation
  if (buttonPressed(Button.A)) {
    tryRotate(true);
  } else if (buttonPressed(Button.B)) {
    tryRotate(false);
  }

  // Hard drop
  if (buttonPressed(Button.UP)) {
    hardDrop();
    vars.fallTimer = vars.fallDelay;
    return;
  }

  // Soft drop
  if (buttonDown(Button.DOWN)) {
    if (tryMove(0, 1)) {
      vars.fallTimer = 2;
      vars.score += 1;
    } else {
      stepDown();
      vars.fallTimer = vars.fallDelay;
      return;
    }
  }

  // Gravity
  vars.fallTimer--;
  if (vars.fallTimer == 0) {
    stepDown();
    vars.fallTimer = vars.fallDelay;
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a0a));

  // Draw board background
  fillRect(
    BOARD_X - 2,
    BOARD_Y - 2,
    BOARD_WIDTH * CELL_SIZE + 4,
    BOARD_HEIGHT * CELL_SIZE + 4,
    c(0x111111),
  );
  drawRect(
    BOARD_X - 2,
    BOARD_Y - 2,
    BOARD_WIDTH * CELL_SIZE + 4,
    BOARD_HEIGHT * CELL_SIZE + 4,
    c(0x333333),
  );

  // Draw settled blocks
  for (let y: i32 = 0; y < BOARD_HEIGHT; y++) {
    for (let x: i32 = 0; x < BOARD_WIDTH; x++) {
      const cell = getBoardCell(x, y);
      if (cell == 0) continue;
      const color = c(PIECE_COLORS[(cell - 1) as i32]);
      const sx = BOARD_X + x * CELL_SIZE;
      const sy = BOARD_Y + y * CELL_SIZE;
      fillRect(sx + 1, sy + 1, CELL_SIZE - 2, CELL_SIZE - 2, color);
    }
  }

  // Draw current piece
  if (vars.state == GameState.PLAYING || vars.state == GameState.GAME_OVER) {
    const mask = shapeMask(vars.currentType, vars.currentRotation);
    const color = c(PIECE_COLORS[vars.currentType as i32]);
    for (let y: i32 = 0; y < 4; y++) {
      for (let x: i32 = 0; x < 4; x++) {
        if ((mask & (1 << (y * 4 + x))) == 0) continue;
        const gx = vars.currentX + x;
        const gy = vars.currentY + y;
        if (gy < 0) continue;
        const sx = BOARD_X + gx * CELL_SIZE;
        const sy = BOARD_Y + gy * CELL_SIZE;
        fillRect(sx + 1, sy + 1, CELL_SIZE - 2, CELL_SIZE - 2, color);
      }
    }
  }

  // UI
  drawString(8, 8, "SCORE", c(0xaaaaaa));
  drawNumber(8, 20, vars.score, c(0xffffff));
  drawString(8, 38, "LINES", c(0xaaaaaa));
  drawNumber(8, 50, vars.lines, c(0xffffff));
  drawString(8, 68, "LEVEL", c(0xaaaaaa));
  drawNumber(8, 80, vars.level as i32, c(0xffffff));

  // Next piece preview
  drawString(PREVIEW_X, PREVIEW_Y - 14, "NEXT", c(0xaaaaaa));
  drawRect(
    PREVIEW_X - 2,
    PREVIEW_Y - 2,
    PREVIEW_SIZE * CELL_SIZE + 4,
    PREVIEW_SIZE * CELL_SIZE + 4,
    c(0x333333),
  );
  const previewMask = shapeMask(vars.nextType, 0);
  const previewColor = c(PIECE_COLORS[vars.nextType as i32]);
  for (let y: i32 = 0; y < 4; y++) {
    for (let x: i32 = 0; x < 4; x++) {
      if ((previewMask & (1 << (y * 4 + x))) == 0) continue;
      const sx = PREVIEW_X + x * CELL_SIZE;
      const sy = PREVIEW_Y + y * CELL_SIZE;
      fillRect(sx + 1, sy + 1, CELL_SIZE - 2, CELL_SIZE - 2, previewColor);
    }
  }

  // Game messages
  if (vars.state == GameState.START_SCREEN) {
    drawStartMessageBox("TETRIS", c(0x1a1a1a), c(0x00ffcc));
  } else if (vars.state == GameState.GAME_OVER) {
    drawStartMessageBox("GAME OVER", c(0x1a1a1a), c(0xff4444));
  }
}
