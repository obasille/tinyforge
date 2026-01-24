// CROCODILES - TinyForge Game
// Pacman-like chase on a single screen with a 16x16 grid.
// You control a blocky head while crocodiles patrol the maze.
// Avoid crocodiles; press START to restart after game over.

import {
  Button,
  RAM_START,
  WIDTH,
  HEIGHT,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawStartMessageBox,
  drawRect,
  fillRect,
  randomRange,
} from "../sdk";

// === Constants ===
const GRID_SIZE: i32 = 16;
const GRID_WIDTH: i32 = WIDTH / GRID_SIZE;
const GRID_HEIGHT: i32 = HEIGHT / GRID_SIZE;

const PLAYER_MOVE_DELAY: u8 = 6;
const CROC_MOVE_DELAY: u8 = 10;

const COLOR_BG: u32 = c(0x0a0a10);
const COLOR_GRID_DARK: u32 = c(0x141428);
const COLOR_GRID_LIGHT: u32 = c(0x1c1c36);
const COLOR_PLAYER: u32 = c(0xf2c9a0);
const COLOR_PLAYER_EYE: u32 = c(0x1b1b1b);
const COLOR_CROC: u32 = c(0x1c8b3a);
const COLOR_CROC_EYE: u32 = c(0xffffff);
const COLOR_CROC_TOOTH: u32 = c(0xe6e6e6);

enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3,
}

enum GameState {
  PLAYING = 0,
  GAME_OVER = 1,
}

// === RAM Variable System ===
@unmanaged
class Vars {
  playerX: u8; // 0
  playerY: u8; // 1
  state: u8; // 2
  playerMoveTimer: u8; // 3
  crocMoveTimer: u8; // 4
  croc0X: u8; // 5
  croc0Y: u8; // 6
  croc0Dir: u8; // 7
  croc1X: u8; // 8
  croc1Y: u8; // 9
  croc1Dir: u8; // 10
  croc2X: u8; // 11
  croc2Y: u8; // 12
  croc2Dir: u8; // 13
}

const vars = changetype<Vars>(RAM_START);

// === Helpers ===
function canMove(x: i32, y: i32): bool {
  return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
}

function dirDeltaX(dir: u8): i32 {
  if (dir == Direction.LEFT) return -1;
  if (dir == Direction.RIGHT) return 1;
  return 0;
}

function dirDeltaY(dir: u8): i32 {
  if (dir == Direction.UP) return -1;
  if (dir == Direction.DOWN) return 1;
  return 0;
}

function chooseValidDir(x: u8, y: u8, dir: u8): u8 {
  let nextDir = dir;
  let tries: i32 = 0;
  while (tries < 4) {
    const nx = (x as i32) + dirDeltaX(nextDir);
    const ny = (y as i32) + dirDeltaY(nextDir);
    if (canMove(nx, ny)) return nextDir;
    nextDir = randomRange(4) as u8;
    tries++;
  }
  return dir;
}

function moveCroc(x: u8, y: u8, dir: u8): u32 {
  const nextDir = chooseValidDir(x, y, dir);
  const nx = ((x as i32) + dirDeltaX(nextDir)) as u8;
  const ny = ((y as i32) + dirDeltaY(nextDir)) as u8;
  return ((nextDir as u32) << 16) | ((ny as u32) << 8) | (nx as u32);
}

function drawGrid(): void {
  for (let y: i32 = 0; y < GRID_HEIGHT; y++) {
    for (let x: i32 = 0; x < GRID_WIDTH; x++) {
      const color = ((x + y) & 1) == 0 ? COLOR_GRID_DARK : COLOR_GRID_LIGHT;
      fillRect(x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE, color);
    }
  }
}

function drawPlayerHead(x: u8, y: u8): void {
  const baseX = (x as i32) * GRID_SIZE;
  const baseY = (y as i32) * GRID_SIZE;
  const headSize: i32 = 12;
  const inset: i32 = (GRID_SIZE - headSize) / 2;
  fillRect(baseX + inset, baseY + inset, headSize, headSize, COLOR_PLAYER);
  drawRect(baseX + inset, baseY + inset, headSize, headSize, COLOR_PLAYER_EYE);
  fillRect(baseX + inset + 3, baseY + inset + 4, 2, 2, COLOR_PLAYER_EYE);
  fillRect(baseX + inset + 7, baseY + inset + 4, 2, 2, COLOR_PLAYER_EYE);
}

function drawCroc(x: u8, y: u8): void {
  const baseX = (x as i32) * GRID_SIZE;
  const baseY = (y as i32) * GRID_SIZE;
  fillRect(baseX + 2, baseY + 5, 12, 7, COLOR_CROC);
  drawRect(baseX + 1, baseY + 4, 14, 9, COLOR_CROC);
  fillRect(baseX + 4, baseY + 6, 2, 2, COLOR_CROC_EYE);
  fillRect(baseX + 9, baseY + 6, 2, 2, COLOR_CROC_EYE);
  fillRect(baseX + 4, baseY + 12, 2, 2, COLOR_CROC_TOOTH);
  fillRect(baseX + 8, baseY + 12, 2, 2, COLOR_CROC_TOOTH);
}

function checkPlayerHit(px: u8, py: u8): bool {
  return (
    (vars.croc0X == px && vars.croc0Y == py) ||
    (vars.croc1X == px && vars.croc1Y == py) ||
    (vars.croc2X == px && vars.croc2Y == py)
  );
}

// === lifecycle ===
export function init(): void {
  vars.playerX = (GRID_WIDTH / 2) as u8;
  vars.playerY = (GRID_HEIGHT / 2) as u8;
  vars.state = GameState.PLAYING as u8;
  vars.playerMoveTimer = 0;
  vars.crocMoveTimer = 0;

  vars.croc0X = 1;
  vars.croc0Y = 1;
  vars.croc0Dir = Direction.RIGHT as u8;
  vars.croc1X = (GRID_WIDTH - 2) as u8;
  vars.croc1Y = 1;
  vars.croc1Dir = Direction.DOWN as u8;
  vars.croc2X = 1;
  vars.croc2Y = (GRID_HEIGHT - 2) as u8;
  vars.croc2Dir = Direction.UP as u8;
}

export function update(): void {
  const state = vars.state;
  if (state != GameState.PLAYING && buttonPressed(Button.START)) {
    init();
    return;
  }
  if (state != GameState.PLAYING) return;

  if (vars.playerMoveTimer > 0) vars.playerMoveTimer--;
  if (vars.crocMoveTimer > 0) vars.crocMoveTimer--;

  if (vars.playerMoveTimer == 0) {
    let dx: i32 = 0;
    let dy: i32 = 0;
    if (buttonDown(Button.LEFT)) dx = -1;
    else if (buttonDown(Button.RIGHT)) dx = 1;
    else if (buttonDown(Button.UP)) dy = -1;
    else if (buttonDown(Button.DOWN)) dy = 1;

    if (dx != 0 || dy != 0) {
      const nx = (vars.playerX as i32) + dx;
      const ny = (vars.playerY as i32) + dy;
      if (canMove(nx, ny)) {
        vars.playerX = nx as u8;
        vars.playerY = ny as u8;
      }
      vars.playerMoveTimer = PLAYER_MOVE_DELAY;
    }
  }

  if (vars.crocMoveTimer == 0) {
    let packed = moveCroc(vars.croc0X, vars.croc0Y, vars.croc0Dir);
    vars.croc0X = (packed & 0xff) as u8;
    vars.croc0Y = ((packed >> 8) & 0xff) as u8;
    vars.croc0Dir = ((packed >> 16) & 0xff) as u8;

    packed = moveCroc(vars.croc1X, vars.croc1Y, vars.croc1Dir);
    vars.croc1X = (packed & 0xff) as u8;
    vars.croc1Y = ((packed >> 8) & 0xff) as u8;
    vars.croc1Dir = ((packed >> 16) & 0xff) as u8;

    packed = moveCroc(vars.croc2X, vars.croc2Y, vars.croc2Dir);
    vars.croc2X = (packed & 0xff) as u8;
    vars.croc2Y = ((packed >> 8) & 0xff) as u8;
    vars.croc2Dir = ((packed >> 16) & 0xff) as u8;

    vars.crocMoveTimer = CROC_MOVE_DELAY;
  }

  if (checkPlayerHit(vars.playerX, vars.playerY)) {
    vars.state = GameState.GAME_OVER as u8;
  }
}

export function draw(): void {
  clearFramebuffer(COLOR_BG);
  drawGrid();

  drawCroc(vars.croc0X, vars.croc0Y);
  drawCroc(vars.croc1X, vars.croc1Y);
  drawCroc(vars.croc2X, vars.croc2Y);

  drawPlayerHead(vars.playerX, vars.playerY);

  if (vars.state == GameState.GAME_OVER) {
    drawStartMessageBox("CHOMPED!", c(0x2a1a1a), c(0xffaa00));
  }
}