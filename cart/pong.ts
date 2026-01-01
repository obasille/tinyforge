// PONG - Fantasy Console Game
// Two-player pong with horizontal paddles (top vs bottom)

import { WIDTH, HEIGHT, Button, log, getI32, setI32, getF32, setF32, getU8, setU8, clearFramebuffer, drawString, drawNumber, drawRect, fillRect } from './console';

// === Constants ===
@inline
const PADDLE_WIDTH: i32 = 40;
@inline
const PADDLE_HEIGHT: i32 = 6;
@inline
const BALL_SIZE: i32 = 4;
@inline
const PADDLE_SPEED: f32 = 3.0;
@inline
const BALL_SPEED_INITIAL: f32 = 2.0;
@inline
const BALL_SPEED_INCREMENT: f32 = 0.1;
@inline
const MAX_SCORE: i32 = 5;

// Game states
enum GameState {
  PLAYING = 0,
  GAME_OVER = 1
}

// === RAM Layout ===
enum Var {
  // Player 1 (top paddle)
  P1_X = 0,              // f32 - paddle X position
  P1_SCORE = 4,          // i32 - player 1 score
  
  // Player 2 (bottom paddle)
  P2_X = 8,              // f32 - paddle X position
  P2_SCORE = 12,         // i32 - player 2 score
  
  // Ball
  BALL_X = 16,           // f32 - ball X position
  BALL_Y = 20,           // f32 - ball Y position
  BALL_VX = 24,          // f32 - ball X velocity
  BALL_VY = 28,          // f32 - ball Y velocity
  
  // Game state
  GAME_STATE = 32,       // u8 - current game state
  WINNER = 33,           // u8 - winning player (1 or 2)
}

// === Helper Functions ===
function resetBall(servingPlayer: i32): void {
  // Center the ball
  setF32(Var.BALL_X, (WIDTH / 2 - BALL_SIZE / 2) as f32);
  setF32(Var.BALL_Y, (HEIGHT / 2 - BALL_SIZE / 2) as f32);
  
  // Set velocity (serve toward the player who lost the point)
  setF32(Var.BALL_VX, 0.0);
  if (servingPlayer == 1) {
    setF32(Var.BALL_VY, BALL_SPEED_INITIAL);  // Serve down toward player 2
  } else {
    setF32(Var.BALL_VY, -BALL_SPEED_INITIAL); // Serve up toward player 1
  }
}

function checkCollision(): void {
  const ballX = getF32(Var.BALL_X);
  const ballY = getF32(Var.BALL_Y);
  let ballVX = getF32(Var.BALL_VX);
  let ballVY = getF32(Var.BALL_VY);
  
  // Left/right wall collisions
  if (ballX <= 0.0) {
    setF32(Var.BALL_X, 0.0);
    ballVX = -ballVX;
    setF32(Var.BALL_VX, ballVX);
  } else if (ballX >= ((WIDTH - BALL_SIZE) as f32)) {
    setF32(Var.BALL_X, (WIDTH - BALL_SIZE) as f32);
    ballVX = -ballVX;
    setF32(Var.BALL_VX, ballVX);
  }
  
  // Top paddle collision (player 1)
  const p1X = getF32(Var.P1_X);
  if (ballY <= (PADDLE_HEIGHT as f32) && 
      (ballX + (BALL_SIZE as f32)) >= p1X && 
      ballX <= (p1X + (PADDLE_WIDTH as f32))) {
    setF32(Var.BALL_Y, PADDLE_HEIGHT as f32);
    ballVY = -ballVY;
    
    // Add horizontal velocity based on where ball hits paddle
    const hitPos = (ballX - p1X) / (PADDLE_WIDTH as f32);
    ballVX = (hitPos - 0.5) * 4.0;
    
    // Increase speed slightly
    const speed = Mathf.sqrt(ballVX * ballVX + ballVY * ballVY);
    const newSpeed = speed + BALL_SPEED_INCREMENT;
    ballVX = ballVX * newSpeed / speed;
    ballVY = ballVY * newSpeed / speed;
    
    setF32(Var.BALL_VX, ballVX);
    setF32(Var.BALL_VY, ballVY);
  }
  
  // Bottom paddle collision (player 2)
  const p2X = getF32(Var.P2_X);
  const bottomPaddleY = HEIGHT - PADDLE_HEIGHT;
  if ((ballY + (BALL_SIZE as f32)) >= (bottomPaddleY as f32) && 
      (ballX + (BALL_SIZE as f32)) >= p2X && 
      ballX <= (p2X + (PADDLE_WIDTH as f32))) {
    setF32(Var.BALL_Y, (bottomPaddleY - BALL_SIZE) as f32);
    ballVY = -ballVY;
    
    // Add horizontal velocity based on where ball hits paddle
    const hitPos = (ballX - p2X) / (PADDLE_WIDTH as f32);
    ballVX = (hitPos - 0.5) * 4.0;
    
    // Increase speed slightly
    const speed = Mathf.sqrt(ballVX * ballVX + ballVY * ballVY);
    const newSpeed = speed + BALL_SPEED_INCREMENT;
    ballVX = ballVX * newSpeed / speed;
    ballVY = ballVY * newSpeed / speed;
    
    setF32(Var.BALL_VX, ballVX);
    setF32(Var.BALL_VY, ballVY);
  }
  
  // Top edge (player 2 scores)
  if (ballY < 0.0) {
    const p2Score = getI32(Var.P2_SCORE) + 1;
    setI32(Var.P2_SCORE, p2Score);
    log("Player 2 scores!");
    
    if (p2Score >= MAX_SCORE) {
      setU8(Var.GAME_STATE, GameState.GAME_OVER as u8);
      setU8(Var.WINNER, 2);
      log("Player 2 wins!");
    } else {
      resetBall(2);
    }
  }
  
  // Bottom edge (player 1 scores)
  if (ballY > (HEIGHT as f32)) {
    const p1Score = getI32(Var.P1_SCORE) + 1;
    setI32(Var.P1_SCORE, p1Score);
    log("Player 1 scores!");
    
    if (p1Score >= MAX_SCORE) {
      setU8(Var.GAME_STATE, GameState.GAME_OVER as u8);
      setU8(Var.WINNER, 1);
      log("Player 1 wins!");
    } else {
      resetBall(1);
    }
  }
}

// === Lifecycle ===
export function init(): void {
  log("Pong starting...");
  
  // Initialize paddles (centered)
  setF32(Var.P1_X, (WIDTH / 2 - PADDLE_WIDTH / 2) as f32);
  setF32(Var.P2_X, (WIDTH / 2 - PADDLE_WIDTH / 2) as f32);
  
  // Initialize scores
  setI32(Var.P1_SCORE, 0);
  setI32(Var.P2_SCORE, 0);
  
  // Initialize ball
  resetBall(1);
  
  // Set game state
  setU8(Var.GAME_STATE, GameState.PLAYING as u8);
  
  log("Pong ready! First to 5 wins!");
}

export function update(input: i32, prevInput: i32): void {
  const state = getU8(Var.GAME_STATE);
  
  // Restart on START button
  if (state == GameState.GAME_OVER && (input & Button.START)) {
    init();
    return;
  }
  
  if (state != GameState.PLAYING) return;
  
  // Player 1 (top paddle) - A & B buttons
  let p1X = getF32(Var.P1_X);
  if (input & Button.A) {
    p1X -= PADDLE_SPEED;
    if (p1X < 0.0) p1X = 0.0;
  }
  if (input & Button.B) {
    p1X += PADDLE_SPEED;
    if (p1X > ((WIDTH - PADDLE_WIDTH) as f32)) p1X = ((WIDTH - PADDLE_WIDTH) as f32);
  }
  setF32(Var.P1_X, p1X);
  
  // Player 2 (bottom paddle) - Left & Right arrows
  let p2X = getF32(Var.P2_X);
  if (input & Button.LEFT) {
    p2X -= PADDLE_SPEED;
    if (p2X < 0.0) p2X = 0.0;
  }
  if (input & Button.RIGHT) {
    p2X += PADDLE_SPEED;
    if (p2X > ((WIDTH - PADDLE_WIDTH) as f32)) p2X = ((WIDTH - PADDLE_WIDTH) as f32);
  }
  setF32(Var.P2_X, p2X);
  
  // Update ball position
  const ballX = getF32(Var.BALL_X);
  const ballY = getF32(Var.BALL_Y);
  const ballVX = getF32(Var.BALL_VX);
  const ballVY = getF32(Var.BALL_VY);
  
  setF32(Var.BALL_X, ballX + ballVX);
  setF32(Var.BALL_Y, ballY + ballVY);
  
  // Check collisions
  checkCollision();
}

export function draw(): void {
  clearFramebuffer(0x0a0a0a);
  
  const state = getU8(Var.GAME_STATE);
  const p1X = getF32(Var.P1_X) as i32;
  const p2X = getF32(Var.P2_X) as i32;
  const ballX = getF32(Var.BALL_X) as i32;
  const ballY = getF32(Var.BALL_Y) as i32;
  
  // Draw center line
  for (let x: i32 = 0; x < WIDTH; x += 8) {
    fillRect(x, HEIGHT / 2 - 1, 4, 2, 0x333333);
  }
  
  // Draw paddles
  fillRect(p1X, 0, PADDLE_WIDTH, PADDLE_HEIGHT, 0x00aaff);           // Player 1 (top) - blue
  fillRect(p2X, HEIGHT - PADDLE_HEIGHT, PADDLE_WIDTH, PADDLE_HEIGHT, 0xff5500); // Player 2 (bottom) - orange
  
  // Draw ball
  fillRect(ballX, ballY, BALL_SIZE, BALL_SIZE, 0xffffff);
  
  // Draw scores
  const p1Score = getI32(Var.P1_SCORE);
  const p2Score = getI32(Var.P2_SCORE);
  
  drawNumber(10, 10, p1Score, 0x00aaff);
  drawNumber(10, HEIGHT - 20, p2Score, 0xff5500);
  
  // Game over message
  if (state == GameState.GAME_OVER) {
    const winner = getU8(Var.WINNER);
    fillRect(60, HEIGHT / 2 - 20, 200, 40, 0x000000);
    drawRect(60, HEIGHT / 2 - 20, 200, 40, 0xffffff);
    
    if (winner == 1) {
      drawString(80, HEIGHT / 2 - 10, "PLAYER 1 WINS!", 0x00aaff);
    } else {
      drawString(80, HEIGHT / 2 - 10, "PLAYER 2 WINS!", 0xff5500);
    }
    drawString(70, HEIGHT / 2 + 5, "PRESS START", 0xaaaaaa);
  }
}
