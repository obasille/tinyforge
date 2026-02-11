// BREAKOUT - TinyForge Game
// Classic brick-breaking game

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
  playSfx,
  RAM_START,
  setU8,
  WIDTH,
} from "../sdk";

// === Constants ===
const PADDLE_WIDTH: i32 = 50;
const PADDLE_HEIGHT: i32 = 8;
const PADDLE_SPEED: f32 = 4.0;
const PADDLE_Y: i32 = HEIGHT - 20;

const BALL_SIZE: i32 = 6;
const BALL_SPEED_INITIAL: f32 = 3.0;
const BALL_SPEED_MAX: f32 = 6.0;

const BRICK_WIDTH: i32 = 32;
const BRICK_HEIGHT: i32 = 12;
const BRICK_COLS: i32 = 10;
const BRICK_ROWS: i32 = 6;
const BRICK_OFFSET_X: i32 = 0;
const BRICK_OFFSET_Y: i32 = 30;

const STARTING_LIVES: i32 = 3;

// Brick colors by row
const BRICK_COLORS: u32[] = [
  0xff0000, // Red
  0xff7700, // Orange
  0xffff00, // Yellow
  0x00ff00, // Green
  0x0088ff, // Blue
  0xff00ff, // Purple
];

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  GAME_OVER = 2,
  LEVEL_COMPLETE = 3,
}

// === RAM Layout ===
@unmanaged
class Vars {
  paddleX: f32; // 0
  ballX: f32; // 4
  ballY: f32; // 8
  ballVX: f32; // 12
  ballVY: f32; // 16
  state: u8; // 20
  lives: i32; // 24
  score: i32; // 28
  bricksRemaining: i32; // 32
  ballLaunched: u8; // 36
}

const vars = changetype<Vars>(RAM_START);
const BRICK_DATA = RAM_START + 40; // 60 bytes - brick state (1 byte per brick, 0 = destroyed, 1 = active)

// === Brick Helpers ===
function getBrick(col: i32, row: i32): u8 {
  return getU8(BRICK_DATA + row * BRICK_COLS + col);
}

function setBrick(col: i32, row: i32, value: u8): void {
  setU8(BRICK_DATA + row * BRICK_COLS + col, value);
}

function initBricks(): void {
  vars.bricksRemaining = 0;
  for (let row: i32 = 0; row < BRICK_ROWS; row++) {
    for (let col: i32 = 0; col < BRICK_COLS; col++) {
      setBrick(col, row, 1);
      vars.bricksRemaining++;
    }
  }
}

function resetBall(): void {
  // Position ball on paddle
  vars.ballX =
    vars.paddleX + ((PADDLE_WIDTH / 2) as f32) - ((BALL_SIZE / 2) as f32);
  vars.ballY = (PADDLE_Y - BALL_SIZE) as f32;
  vars.ballVX = 0.0;
  vars.ballVY = 0.0;
  vars.ballLaunched = 0;
}

function launchBall(): void {
  vars.ballVX = BALL_SPEED_INITIAL * 0.7;
  vars.ballVY = -BALL_SPEED_INITIAL;
  vars.ballLaunched = 1;
}

function checkCollisions(): void {
  const ballX = vars.ballX;
  const ballY = vars.ballY;
  let ballVX = vars.ballVX;
  let ballVY = vars.ballVY;

  // Left/right wall collisions
  if (ballX <= 0.0) {
    vars.ballX = 0.0;
    ballVX = -ballVX;
    vars.ballVX = ballVX;
    playSfx("tap", 0.3);
  } else if (ballX >= ((WIDTH - BALL_SIZE) as f32)) {
    vars.ballX = (WIDTH - BALL_SIZE) as f32;
    ballVX = -ballVX;
    vars.ballVX = ballVX;
    playSfx("tap", 0.3);
  }

  // Top wall collision
  if (ballY <= 0.0) {
    vars.ballY = 0.0;
    ballVY = -ballVY;
    vars.ballVY = ballVY;
    playSfx("tap", 0.3);
  }

  // Paddle collision
  const paddleX = vars.paddleX;
  if (
    ballY + (BALL_SIZE as f32) >= (PADDLE_Y as f32) &&
    ballY + (BALL_SIZE as f32) <= ((PADDLE_Y + PADDLE_HEIGHT) as f32) &&
    ballX + (BALL_SIZE as f32) >= paddleX &&
    ballX <= paddleX + (PADDLE_WIDTH as f32)
  ) {
    vars.ballY = (PADDLE_Y - BALL_SIZE) as f32;

    // Bounce angle based on hit position
    const hitPos =
      (ballX + ((BALL_SIZE / 2) as f32) - paddleX) / (PADDLE_WIDTH as f32);
    ballVX = (hitPos - 0.5) * 6.0;
    ballVY = -Mathf.abs(ballVY);

    // Limit speed
    const speed = Mathf.sqrt(ballVX * ballVX + ballVY * ballVY);
    if (speed > BALL_SPEED_MAX) {
      ballVX = (ballVX * BALL_SPEED_MAX) / speed;
      ballVY = (ballVY * BALL_SPEED_MAX) / speed;
    }

    vars.ballVX = ballVX;
    vars.ballVY = ballVY;
    playSfx("tap", 0.4);
  }

  // Bottom edge (lose life)
  if (ballY > (HEIGHT as f32)) {
    vars.lives--;
    playSfx("explosion", 0.2);

    if (vars.lives <= 0) {
      vars.state = GameState.GAME_OVER as u8;
      log("Game Over!");
    } else {
      resetBall();
    }
  }

  // Brick collisions
  for (let row: i32 = 0; row < BRICK_ROWS; row++) {
    for (let col: i32 = 0; col < BRICK_COLS; col++) {
      if (getBrick(col, row) == 0) continue;

      const brickX = BRICK_OFFSET_X + col * BRICK_WIDTH;
      const brickY = BRICK_OFFSET_Y + row * BRICK_HEIGHT;

      // Check collision with brick
      if (
        ballX + (BALL_SIZE as f32) >= (brickX as f32) &&
        ballX <= ((brickX + BRICK_WIDTH) as f32) &&
        ballY + (BALL_SIZE as f32) >= (brickY as f32) &&
        ballY <= ((brickY + BRICK_HEIGHT) as f32)
      ) {
        // Destroy brick
        setBrick(col, row, 0);
        vars.bricksRemaining--;
        vars.score += 10 * (row + 1); // Higher rows worth more
        playSfx("tap", 0.5);

        // Determine bounce direction based on hit side
        const prevBallX = ballX - ballVX;
        const prevBallY = ballY - ballVY;

        const fromLeft = prevBallX + (BALL_SIZE as f32) <= (brickX as f32);
        const fromRight = prevBallX >= ((brickX + BRICK_WIDTH) as f32);
        const fromTop = prevBallY + (BALL_SIZE as f32) <= (brickY as f32);
        const fromBottom = prevBallY >= ((brickY + BRICK_HEIGHT) as f32);

        if (fromLeft || fromRight) {
          vars.ballVX = -ballVX;
        }
        if (fromTop || fromBottom) {
          vars.ballVY = -ballVY;
        }

        // Check for level complete
        if (vars.bricksRemaining == 0) {
          vars.state = GameState.LEVEL_COMPLETE as u8;
          log("Level Complete!");
        }

        return; // Only handle one brick per frame
      }
    }
  }
}

// === Lifecycle ===
export function init(): void {
  // Initialize paddle
  vars.paddleX = (WIDTH / 2 - PADDLE_WIDTH / 2) as f32;

  // Initialize ball
  resetBall();

  // Initialize bricks
  initBricks();

  // Initialize game state
  vars.lives = STARTING_LIVES;
  vars.score = 0;
  vars.state = GameState.START_SCREEN as u8;
}

export function update(): void {
  const state = vars.state;

  // Start game from start screen
  if (state == GameState.START_SCREEN && buttonPressed(Button.START)) {
    vars.state = GameState.PLAYING as u8;
    return;
  }

  // Restart from game over
  if (state == GameState.GAME_OVER && buttonPressed(Button.START)) {
    init();
    return;
  }

  // Next level from level complete
  if (state == GameState.LEVEL_COMPLETE && buttonPressed(Button.START)) {
    initBricks();
    resetBall();
    vars.state = GameState.PLAYING as u8;
    return;
  }

  if (state != GameState.PLAYING) return;

  // Paddle movement
  let paddleX = vars.paddleX;
  if (buttonDown(Button.LEFT)) {
    paddleX -= PADDLE_SPEED;
    if (paddleX < 0.0) paddleX = 0.0;
  }
  if (buttonDown(Button.RIGHT)) {
    paddleX += PADDLE_SPEED;
    if (paddleX > ((WIDTH - PADDLE_WIDTH) as f32)) {
      paddleX = (WIDTH - PADDLE_WIDTH) as f32;
    }
  }
  vars.paddleX = paddleX;

  // Launch ball
  if (vars.ballLaunched == 0 && buttonPressed(Button.A)) {
    launchBall();
  }

  // Update ball position (if launched)
  if (vars.ballLaunched == 1) {
    vars.ballX += vars.ballVX;
    vars.ballY += vars.ballVY;
    checkCollisions();
  } else {
    // Keep ball on paddle before launch
    vars.ballX =
      vars.paddleX + ((PADDLE_WIDTH / 2) as f32) - ((BALL_SIZE / 2) as f32);
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a0a));

  const state = vars.state;
  const paddleX = vars.paddleX as i32;
  const ballX = vars.ballX as i32;
  const ballY = vars.ballY as i32;

  // Draw bricks
  for (let row: i32 = 0; row < BRICK_ROWS; row++) {
    const color = c(BRICK_COLORS[row]);
    for (let col: i32 = 0; col < BRICK_COLS; col++) {
      if (getBrick(col, row) == 1) {
        const brickX = BRICK_OFFSET_X + col * BRICK_WIDTH;
        const brickY = BRICK_OFFSET_Y + row * BRICK_HEIGHT;
        fillRect(
          brickX + 1,
          brickY + 1,
          BRICK_WIDTH - 2,
          BRICK_HEIGHT - 2,
          color,
        );
        drawRect(brickX, brickY, BRICK_WIDTH, BRICK_HEIGHT, c(0x444444));
      }
    }
  }

  // Draw paddle
  fillRect(paddleX, PADDLE_Y, PADDLE_WIDTH, PADDLE_HEIGHT, c(0x00aaff));

  // Draw ball
  fillRect(ballX, ballY, BALL_SIZE, BALL_SIZE, c(0xffffff));

  // Draw UI
  drawString(4, 4, "SCORE:", c(0xaaaaaa));
  drawNumber(50, 4, vars.score, c(0xffffff));

  drawString(WIDTH - 60, 4, "LIVES:", c(0xaaaaaa));
  drawNumber(WIDTH - 15, 4, vars.lives, c(0xff0000));

  // Game messages
  if (state == GameState.START_SCREEN) {
    drawStartMessageBox("BREAKOUT", c(0x1a1a1a), c(0x00aaff));
  } else if (state == GameState.GAME_OVER) {
    drawStartMessageBox("GAME OVER", c(0x1a1a1a), c(0xff0000));
  } else if (state == GameState.LEVEL_COMPLETE) {
    drawStartMessageBox("LEVEL COMPLETE!", c(0x1a1a1a), c(0x00ff00));
  } else if (vars.ballLaunched == 0) {
    // Show launch instruction
    drawString(WIDTH / 2 - 40, HEIGHT - 40, "PRESS A TO LAUNCH", c(0xffff00));
  }
}
