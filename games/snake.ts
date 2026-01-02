// SNAKE - Fantasy Console Game
// Classic snake game with grid-based movement

import { WIDTH, HEIGHT, Button, log, getI32, setI32, getU8, setU8, clearFramebuffer, pset, fillRect, drawRect, drawNumber, drawChar, drawString, c, random, drawMessageBox, RAM_START, Vec2i } from './console';

// === Constants ===
@inline
const GRID_SIZE: i32 = 16;           // Size of each grid cell in pixels
@inline
const GRID_WIDTH: i32 = WIDTH / GRID_SIZE;   // 20 cells wide
@inline
const GRID_HEIGHT: i32 = HEIGHT / GRID_SIZE; // 15 cells tall
@inline
const MAX_SNAKE_LENGTH: i32 = GRID_WIDTH * GRID_HEIGHT; // Maximum possible length

@inline
const INITIAL_SPEED: u8 = 10;       // Frames between moves (lower = faster)
@inline
const SPEED_INCREMENT: u8 = 1;      // Speed increase per food eaten

// Directions
enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3
}

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  GAME_OVER = 2
}

// === RAM Layout ===
enum Var {
  SNAKE_LENGTH = 0,        // i32 - current snake length
  SNAKE_DIR = 4,           // u8 - current direction
  NEXT_DIR = 5,            // u8 - queued direction (for turning)
  FOOD_X = 6,              // u8 - food X position
  FOOD_Y = 7,              // u8 - food Y position
  GAME_STATE = 8,          // u8 - game state
  SCORE = 9,               // u8 - current score
  SPEED = 10,              // u8 - current game speed
  MOVE_TIMER = 11,         // u8 - countdown timer for movement
  RNG_SEED = 12,           // i32 - PRNG seed
  SNAKE_DATA = 16,         // 400 bytes - snake body (2 bytes per segment: x, y)
}



function randomRange(max: i32): i32 {
  return (random(RAM_START + Var.RNG_SEED) % max);
}

// === Snake Helpers ===
function getSegmentX(index: i32): u8 {
  return getU8(Var.SNAKE_DATA + index * 2);
}

function getSegmentY(index: i32): u8 {
  return getU8(Var.SNAKE_DATA + index * 2 + 1);
}

function setSegment(index: i32, x: u8, y: u8): void {
  setU8(Var.SNAKE_DATA + index * 2, x);
  setU8(Var.SNAKE_DATA + index * 2 + 1, y);
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
    const length = getI32(Var.SNAKE_LENGTH);
    for (let i: i32 = 0; i < length; i++) {
      if (getSegmentX(i) == fx && getSegmentY(i) == fy) {
        occupied = true;
        break;
      }
    }
    
    if (!occupied) {
      setU8(Var.FOOD_X, fx);
      setU8(Var.FOOD_Y, fy);
      return;
    }
    
    attempts++;
  }
  
  // Fallback: place at 0,0 (shouldn't happen unless grid is full)
  setU8(Var.FOOD_X, 0);
  setU8(Var.FOOD_Y, 0);
}

function checkCollision(x: u8, y: u8): bool {
  // Wall collision
  if (x >= (GRID_WIDTH as u8) || y >= (GRID_HEIGHT as u8)) {
    return true;
  }
  
  // Self collision (check against all body segments except head)
  const length = getI32(Var.SNAKE_LENGTH);
  for (let i: i32 = 1; i < length; i++) {
    if (getSegmentX(i) == x && getSegmentY(i) == y) {
      return true;
    }
  }
  
  return false;
}

function moveSnake(): void {
  const dir = getU8(Var.SNAKE_DIR);
  const length = getI32(Var.SNAKE_LENGTH);
  
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
    setU8(Var.GAME_STATE, GameState.GAME_OVER as u8);
    log("Game Over!");
    return;
  }
  
  // Check if food is eaten
  const foodX = getU8(Var.FOOD_X);
  const foodY = getU8(Var.FOOD_Y);
  let grow = false;
  
  if (headX == foodX && headY == foodY) {
    grow = true;
    setU8(Var.SCORE, getU8(Var.SCORE) + 1);
    
    // Increase speed
    const currentSpeed = getU8(Var.SPEED);
    if (currentSpeed > 2) {
      setU8(Var.SPEED, currentSpeed - SPEED_INCREMENT);
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
      setI32(Var.SNAKE_LENGTH, newLength);
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
  log("Snake starting...");
  
  // Initialize snake (start in center, length 3, moving right)
  const startX = (GRID_WIDTH / 2) as u8;
  const startY = (GRID_HEIGHT / 2) as u8;
  
  setI32(Var.SNAKE_LENGTH, 3);
  setSegment(0, startX, startY);
  setSegment(1, (startX - 1) as u8, startY);
  setSegment(2, (startX - 2) as u8, startY);
  
  setU8(Var.SNAKE_DIR, Direction.RIGHT as u8);
  setU8(Var.NEXT_DIR, Direction.RIGHT as u8);
  setU8(Var.GAME_STATE, GameState.START_SCREEN as u8);
  setU8(Var.SCORE, 0);
  setU8(Var.SPEED, INITIAL_SPEED);
  setU8(Var.MOVE_TIMER, INITIAL_SPEED);
  
  // Initialize RNG
  setI32(Var.RNG_SEED, 12345);
  
  // Spawn first food
  spawnFood();
  
  log("Snake ready!");
}

export function update(input: i32, prevInput: i32): void {
  const state = getU8(Var.GAME_STATE);
  
  const pressed = input & ~prevInput;
  
  // Start game from start screen
  if (state == GameState.START_SCREEN && (pressed & Button.START)) {
    setU8(Var.GAME_STATE, GameState.PLAYING as u8);
    return;
  }
  
  // Restart on START button
  if (state == GameState.GAME_OVER && (pressed & Button.START)) {
    init();
    return;
  }
  
  if (state != GameState.PLAYING) return;
  
  // Handle input (queue direction change)
  const currentDir = getU8(Var.SNAKE_DIR);
  
  if (pressed & Button.UP) {
    if (currentDir != Direction.DOWN) setU8(Var.NEXT_DIR, Direction.UP as u8);
  } else if (pressed & Button.DOWN) {
    if (currentDir != Direction.UP) setU8(Var.NEXT_DIR, Direction.DOWN as u8);
  } else if (pressed & Button.LEFT) {
    if (currentDir != Direction.RIGHT) setU8(Var.NEXT_DIR, Direction.LEFT as u8);
  } else if (pressed & Button.RIGHT) {
    if (currentDir != Direction.LEFT) setU8(Var.NEXT_DIR, Direction.RIGHT as u8);
  }
  
  // Update movement timer
  let timer = getU8(Var.MOVE_TIMER);
  timer--;
  
  if (timer == 0) {
    // Apply queued direction
    setU8(Var.SNAKE_DIR, getU8(Var.NEXT_DIR));
    
    // Move snake
    moveSnake();
    
    // Reset timer
    timer = getU8(Var.SPEED);
  }
  
  setU8(Var.MOVE_TIMER, timer);
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a0a));
  
  const state = getU8(Var.GAME_STATE);
  const length = getI32(Var.SNAKE_LENGTH);
  
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
  const foodX = (getU8(Var.FOOD_X) as i32) * GRID_SIZE;
  const foodY = (getU8(Var.FOOD_Y) as i32) * GRID_SIZE;
  fillRect(foodX + 2, foodY + 2, GRID_SIZE - 4, GRID_SIZE - 4, c(0xff0000));
  
  // Draw score
  const score = getU8(Var.SCORE);
  drawString(4, 4, "SCORE:", c(0xaaaaaa));
  drawNumber(50, 4, score as i32, c(0xffffff));
  
  // Game messages
  if (state == GameState.START_SCREEN) {
    drawMessageBox(new Vec2i(60, HEIGHT / 2 - 30), new Vec2i(200, 60), "SNAKE", new Vec2i(70, 15), "PRESS START", new Vec2i(25, 35), c(0x1a1a1a), c(0x00ff00));
  } else if (state == GameState.GAME_OVER) {
    fillRect(60, HEIGHT / 2 - 30, 200, 60, c(0x000000));
    drawRect(60, HEIGHT / 2 - 30, 200, 60, c(0xff0000));
    
    drawString(80, HEIGHT / 2 - 20, "GAME OVER!", c(0xff0000));
    drawString(80, HEIGHT / 2 - 5, "SCORE:", c(0xaaaaaa));
    drawNumber(130, HEIGHT / 2 - 5, score as i32, c(0xffffff));
    drawString(80, HEIGHT / 2 + 10, "PRESS START", c(0xaaaaaa));
  }
}

