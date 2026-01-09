// SNAKE - TinyForge Game
// Classic snake game with grid-based movement

import {
  Button,
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
  pset,
  RAM_START,
  random,
  setU8,
  WIDTH,
} from "../sdk";

// === Constants ===
const GRID_SIZE: i32 = 16; // Size of each grid cell in pixels
const GRID_WIDTH: i32 = WIDTH / GRID_SIZE; // 20 cells wide
const GRID_HEIGHT: i32 = HEIGHT / GRID_SIZE; // 15 cells tall
const MAX_SNAKE_LENGTH: i32 = GRID_WIDTH * GRID_HEIGHT; // Maximum possible length

const INITIAL_SPEED: u8 = 10; // Frames between moves (lower = faster)
const SPEED_INCREMENT: u8 = 1; // Speed increase per food eaten

// Directions
enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3,
}

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  GAME_OVER = 2,
}

// === RAM Layout ===
@unmanaged
class GameVars {
  length: i32 = 0;    // 0
  dir: u8 = 0;        // 4
  nextDir: u8 = 0;    // 5
  foodX: u8 = 0;      // 6
  foodY: u8 = 0;      // 7
  state: u8 = 0;      // 8
  score: u8 = 0;      // 9
  speed: u8 = 0;      // 10
  moveTimer: u8 = 0;  // 11
  rngSeed: i32 = 0;   // 12
}

const gameVars = changetype<GameVars>(RAM_START);
const SNAKE_DATA = RAM_START + 16; // 400 bytes - snake body (2 bytes per segment: x, y)

function randomRange(max: i32): i32 {
  return random(RAM_START + 12) % max; // rngSeed offset
}

// === Snake Helpers ===
function getSegmentX(index: i32): u8 {
  return getU8(SNAKE_DATA + index * 2);
}

function getSegmentY(index: i32): u8 {
  return getU8(SNAKE_DATA + index * 2 + 1);
}

function setSegment(index: i32, x: u8, y: u8): void {
  setU8(SNAKE_DATA + index * 2, x);
  setU8(SNAKE_DATA + index * 2 + 1, y);
}

function spawnFood(): void {
  // Try to find empty position (with timeout to prevent infinite loop)
  let attempts: i32 = 0;
  const maxAttempts: i32 = 100;

  while (attempts < maxAttempts) {
    const fx = randomRange(GRID_WIDTH) as u8;
    const fy = randomRange(GRID_HEIGHT) as u8;

    // Check if position is occupied by snake
    let occupied = false;
    const length = gameVars.length;
    for (let i: i32 = 0; i < length; i++) {
      if (getSegmentX(i) == fx && getSegmentY(i) == fy) {
        occupied = true;
        break;
      }
    }

    if (!occupied) {
      gameVars.foodX = fx;
      gameVars.foodY = fy;
      return;
    }

    attempts++;
  }

  // Fallback: place at 0,0 (shouldn't happen unless grid is full)
  gameVars.foodX = 0;
  gameVars.foodY = 0;
}

function checkCollision(x: u8, y: u8): bool {
  // Wall collision
  if (x >= (GRID_WIDTH as u8) || y >= (GRID_HEIGHT as u8)) {
    return true;
  }

  // Self collision (check against all body segments except head)
  const length = gameVars.length;
  for (let i: i32 = 1; i < length; i++) {
    if (getSegmentX(i) == x && getSegmentY(i) == y) {
      return true;
    }
  }

  return false;
}

function moveSnake(): void {
  const dir = gameVars.dir;
  const length = gameVars.length;

  // Get current head position
  let headX = getSegmentX(0);
  let headY = getSegmentY(0);

  // Calculate new head position
  if (dir == Direction.UP) headY = (headY - 1) as u8;
  else if (dir == Direction.DOWN) headY = (headY + 1) as u8;
  else if (dir == Direction.LEFT) headX = (headX - 1) as u8;
  else if (dir == Direction.RIGHT) headX = (headX + 1) as u8;

  // Check collision
  if (checkCollision(headX, headY)) {
    gameVars.state = GameState.GAME_OVER as u8;
    log("Game Over!");
    return;
  }

  // Check if food is eaten
  const foodX = gameVars.foodX;
  const foodY = gameVars.foodY;
  let grow = false;

  if (headX == foodX && headY == foodY) {
    grow = true;
    gameVars.score++;

    // Increase speed
    if (gameVars.speed > 2) {
      gameVars.speed -= SPEED_INCREMENT;
    }

    spawnFood();
  }

  // Move body segments
  if (grow) {
    // Growing: shift all segments and add new head
    const newLength = length + 1;
    if (newLength <= MAX_SNAKE_LENGTH) {
      for (let i: i32 = length; i > 0; i--) {
        setSegment(i, getSegmentX(i - 1), getSegmentY(i - 1));
      }
      gameVars.length = newLength;
    }
  } else {
    // Not growing: shift all segments (tail disappears)
    for (let i: i32 = length - 1; i > 0; i--) {
      setSegment(i, getSegmentX(i - 1), getSegmentY(i - 1));
    }
  }

  // Set new head position
  setSegment(0, headX, headY);
}

// === Lifecycle ===
export function init(): void {
  // Initialize snake (start in center, length 3, moving right)
  const startX = (GRID_WIDTH / 2) as u8;
  const startY = (GRID_HEIGHT / 2) as u8;

  gameVars.length = 3;
  setSegment(0, startX, startY);
  setSegment(1, (startX - 1) as u8, startY);
  setSegment(2, (startX - 2) as u8, startY);

  gameVars.dir = Direction.RIGHT as u8;
  gameVars.nextDir = Direction.RIGHT as u8;
  gameVars.state = GameState.START_SCREEN as u8;
  gameVars.score = 0;
  gameVars.speed = INITIAL_SPEED;
  gameVars.moveTimer = INITIAL_SPEED;

  // Initialize RNG
  gameVars.rngSeed = 12345;

  // Spawn first food
  spawnFood();
}

export function update(): void {
  const state = gameVars.state;

  // Start game from start screen
  if (state == GameState.START_SCREEN && buttonPressed(Button.START)) {
    gameVars.state = GameState.PLAYING as u8;
    return;
  }

  // Restart on START button
  if (state == GameState.GAME_OVER && buttonPressed(Button.START)) {
    init();
    return;
  }

  if (state != GameState.PLAYING) return;

  // Handle input (queue direction change)
  const currentDir = gameVars.dir;

  if (buttonPressed(Button.UP)) {
    if (currentDir != Direction.DOWN) gameVars.nextDir = Direction.UP as u8;
  } else if (buttonPressed(Button.DOWN)) {
    if (currentDir != Direction.UP) gameVars.nextDir = Direction.DOWN as u8;
  } else if (buttonPressed(Button.LEFT)) {
    if (currentDir != Direction.RIGHT) gameVars.nextDir = Direction.LEFT as u8;
  } else if (buttonPressed(Button.RIGHT)) {
    if (currentDir != Direction.LEFT) gameVars.nextDir = Direction.RIGHT as u8;
  }

  // Update movement timer
  gameVars.moveTimer--;

  if (gameVars.moveTimer == 0) {
    // Apply queued direction
    gameVars.dir = gameVars.nextDir;

    // Move snake
    moveSnake();

    // Reset timer
    gameVars.moveTimer = gameVars.speed;
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a0a));

  const state = gameVars.state;
  const length = gameVars.length;

  // Draw grid lines (subtle)
  const colorGrid = c(0x1a1a1a);
  for (let x: i32 = 0; x < WIDTH; x += GRID_SIZE) {
    for (let y: i32 = 0; y < HEIGHT; y++) {
      pset(x, y, colorGrid);
    }
  }
  for (let y: i32 = 0; y < HEIGHT; y += GRID_SIZE) {
    for (let x: i32 = 0; x < WIDTH; x++) {
      pset(x, y, colorGrid);
    }
  }

  // Draw snake
  const colorBody = c(0x00ff00);
  const colorHead = c(0x00ffaa);
  for (let i: i32 = 0; i < length; i++) {
    const sx = (getSegmentX(i) as i32) * GRID_SIZE;
    const sy = (getSegmentY(i) as i32) * GRID_SIZE;

    if (i == 0) {
      fillRect(sx + 1, sy + 1, GRID_SIZE - 2, GRID_SIZE - 2, colorHead);
    } else {
      fillRect(sx + 1, sy + 1, GRID_SIZE - 2, GRID_SIZE - 2, colorBody);
    }
  }

  // Draw food
  const foodX = (gameVars.foodX as i32) * GRID_SIZE;
  const foodY = (gameVars.foodY as i32) * GRID_SIZE;
  fillRect(foodX + 2, foodY + 2, GRID_SIZE - 4, GRID_SIZE - 4, c(0xff0000));

  // Draw score
  drawString(4, 4, "SCORE:", c(0xaaaaaa));
  drawNumber(50, 4, gameVars.score as i32, c(0xffffff));

  // Game messages
  if (state == GameState.START_SCREEN) {
    drawStartMessageBox("SNAKE", c(0x1a1a1a), c(0x00ff00));
  } else if (state == GameState.GAME_OVER) {
    drawStartMessageBox("GAME OVER", c(0x1a1a1a), c(0xff0000));
  }
}
