// PONG - TinyForge Game
// Two-player pong with horizontal paddles (top vs bottom)

import {
  Button,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawNumber,
  drawStartMessageBox,
  drawString,
  fillRect,
  HEIGHT,
  log,
  playSfx,
  RAM_START,
  WIDTH,
} from "../sdk";

// === Constants ===
const PADDLE_WIDTH: i32 = 40;
const PADDLE_HEIGHT: i32 = 6;
const BALL_SIZE: i32 = 4;
const PADDLE_SPEED: f32 = 3.0;
const BALL_SPEED_INITIAL: f32 = 2.0;
const BALL_SPEED_INCREMENT: f32 = 0.1;
const MAX_SCORE: i32 = 5;

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  GAME_OVER = 2,
}

// === RAM Layout ===
@unmanaged
class Vars {
  // Player 1 (top paddle)
  p1X: f32; // 0
  p1Score: i32; // 4

  // Player 2 (bottom paddle)
  p2X: f32; // 8
  p2Score: i32; // 12

  // Ball
  ballX: f32; // 16
  ballY: f32; // 20
  ballVX: f32; // 24
  ballVY: f32; // 28

  // Game state
  state: u8; // 32
  winner: u8; // 33
  countdown: i32; // 36
  servingPlayer: i32; // 40
}

const vars = changetype<Vars>(RAM_START);

// === Helper Functions ===
function resetBall(servingPlayer: i32): void {
  // Center the ball
  vars.ballX = (WIDTH / 2 - BALL_SIZE / 2) as f32;
  vars.ballY = (HEIGHT / 2 - BALL_SIZE / 2) as f32;

  // Stop ball and start countdown
  vars.ballVX = 0.0;
  vars.ballVY = 0.0;
  vars.countdown = 240; // 4 seconds at 60fps
  vars.servingPlayer = servingPlayer;
}

function checkCollision(): void {
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
    playSfx("tap", 0.2);
  }

  // Top paddle collision (player 1)
  const p1X = vars.p1X;
  if (
    ballY <= (PADDLE_HEIGHT as f32) &&
    ballX + (BALL_SIZE as f32) >= p1X &&
    ballX <= p1X + (PADDLE_WIDTH as f32)
  ) {
    vars.ballY = PADDLE_HEIGHT as f32;
    ballVY = -ballVY;

    // Add horizontal velocity based on where ball hits paddle
    const hitPos = (ballX - p1X) / (PADDLE_WIDTH as f32);
    ballVX = (hitPos - 0.5) * 4.0;

    // Increase speed slightly
    const speed = Mathf.sqrt(ballVX * ballVX + ballVY * ballVY);
    const newSpeed = speed + BALL_SPEED_INCREMENT;
    ballVX = (ballVX * newSpeed) / speed;
    ballVY = (ballVY * newSpeed) / speed;

    vars.ballVX = ballVX;
    vars.ballVY = ballVY;
    playSfx("tap", 0.4);
  }

  // Bottom paddle collision (player 2)
  const p2X = vars.p2X;
  const bottomPaddleY = HEIGHT - PADDLE_HEIGHT;
  if (
    ballY + (BALL_SIZE as f32) >= (bottomPaddleY as f32) &&
    ballX + (BALL_SIZE as f32) >= p2X &&
    ballX <= p2X + (PADDLE_WIDTH as f32)
  ) {
    vars.ballY = (bottomPaddleY - BALL_SIZE) as f32;
    ballVY = -ballVY;

    // Add horizontal velocity based on where ball hits paddle
    const hitPos = (ballX - p2X) / (PADDLE_WIDTH as f32);
    ballVX = (hitPos - 0.5) * 4.0;

    // Increase speed slightly
    const speed = Mathf.sqrt(ballVX * ballVX + ballVY * ballVY);
    const newSpeed = speed + BALL_SPEED_INCREMENT;
    ballVX = (ballVX * newSpeed) / speed;
    ballVY = (ballVY * newSpeed) / speed;

    vars.ballVX = ballVX;
    vars.ballVY = ballVY;
    playSfx("tap", 0.4);
  }

  // Top edge (player 2 scores)
  if (ballY < 0.0) {
    vars.p2Score++;
    log("Player 2 scores!");
    playSfx("explosion", 0.5);

    if (vars.p2Score >= MAX_SCORE) {
      vars.state = GameState.GAME_OVER as u8;
      vars.winner = 2;
      log("Player 2 wins!");
    } else {
      resetBall(2);
    }
  }

  // Bottom edge (player 1 scores)
  if (ballY > (HEIGHT as f32)) {
    vars.p1Score++;
    log("Player 1 scores!");
    playSfx("explosion", 0.5);

    if (vars.p1Score >= MAX_SCORE) {
      vars.state = GameState.GAME_OVER as u8;
      vars.winner = 1;
      log("Player 1 wins!");
    } else {
      resetBall(1);
    }
  }
}

// === Lifecycle ===
export function init(): void {
  // Initialize paddles (centered)
  vars.p1X = (WIDTH / 2 - PADDLE_WIDTH / 2) as f32;
  vars.p2X = (WIDTH / 2 - PADDLE_WIDTH / 2) as f32;

  // Initialize scores
  vars.p1Score = 0;
  vars.p2Score = 0;
  vars.winner = 0;

  // Initialize ball
  resetBall(1);

  // Set game state
  vars.state = GameState.START_SCREEN as u8;
}

export function update(): void {
  const state = vars.state;

  // Start game from start screen
  if (state == GameState.START_SCREEN && buttonPressed(Button.START)) {
    vars.state = GameState.PLAYING as u8;
    return;
  }

  // Restart on START button
  if (state == GameState.GAME_OVER && buttonPressed(Button.START)) {
    init();
    return;
  }

  if (state != GameState.PLAYING) return;

  // Handle countdown
  if (vars.countdown > 0) {
    vars.countdown--;

    // Launch ball when countdown reaches 0
    if (vars.countdown == 0) {
      const servingPlayer = vars.servingPlayer;
      if (servingPlayer == 1) {
        vars.ballVY = BALL_SPEED_INITIAL; // Serve down toward player 2
      } else {
        vars.ballVY = -BALL_SPEED_INITIAL; // Serve up toward player 1
      }
    }
  }

  // Player 1 (top paddle) - A & B buttons
  let p1X = vars.p1X;
  if (buttonDown(Button.A)) {
    p1X -= PADDLE_SPEED;
    if (p1X < 0.0) p1X = 0.0;
  }
  if (buttonDown(Button.B)) {
    p1X += PADDLE_SPEED;
    if (p1X > ((WIDTH - PADDLE_WIDTH) as f32))
      p1X = (WIDTH - PADDLE_WIDTH) as f32;
  }
  vars.p1X = p1X;

  // Player 2 (bottom paddle) - Left & Right arrows
  let p2X = vars.p2X;
  if (buttonDown(Button.LEFT)) {
    p2X -= PADDLE_SPEED;
    if (p2X < 0.0) p2X = 0.0;
  }
  if (buttonDown(Button.RIGHT)) {
    p2X += PADDLE_SPEED;
    if (p2X > ((WIDTH - PADDLE_WIDTH) as f32))
      p2X = (WIDTH - PADDLE_WIDTH) as f32;
  }
  vars.p2X = p2X;

  // Update ball position (only if countdown is over)
  if (vars.countdown == 0) {
    vars.ballX += vars.ballVX;
    vars.ballY += vars.ballVY;

    // Check collisions
    checkCollision();
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a0a));

  const state = vars.state;
  const p1X = vars.p1X as i32;
  const p2X = vars.p2X as i32;
  const ballX = vars.ballX as i32;
  const ballY = vars.ballY as i32;

  // Draw center line
  const colorCenterLine = c(0x333333);
  for (let x: i32 = 0; x < WIDTH; x += 8) {
    fillRect(x, HEIGHT / 2 - 1, 4, 2, colorCenterLine);
  }

  // Draw paddles
  fillRect(p1X, 0, PADDLE_WIDTH, PADDLE_HEIGHT, c(0x00aaff)); // Player 1 (top) - blue
  fillRect(
    p2X,
    HEIGHT - PADDLE_HEIGHT,
    PADDLE_WIDTH,
    PADDLE_HEIGHT,
    c(0xff5500),
  ); // Player 2 (bottom) - orange

  // Draw ball
  fillRect(ballX, ballY, BALL_SIZE, BALL_SIZE, c(0xffffff));

  // Draw scores
  drawNumber(10, 10, vars.p1Score, c(0x00aaff));
  drawNumber(10, HEIGHT - 20, vars.p2Score, c(0xff5500));

  // Draw countdown
  if (state == GameState.PLAYING && vars.countdown > 0) {
    const secondsLeft = vars.countdown / 60;
    let countdownText = "";

    if (secondsLeft >= 3) {
      countdownText = "3";
    } else if (secondsLeft == 2) {
      countdownText = "2";
    } else if (secondsLeft == 1) {
      countdownText = "1";
    } else {
      countdownText = "GO!";
    }

    // Draw centered countdown text
    fillRect(WIDTH / 2 - 12, HEIGHT / 2 - 10, 24, 20, c(0x303030)); // Clear area
    const textX = secondsLeft > 0 ? WIDTH / 2 - 2 : WIDTH / 2 - 10;
    drawString(textX, HEIGHT / 2 - 4, countdownText, c(0xffff00));
  }

  // Game messages
  if (state == GameState.START_SCREEN) {
    drawStartMessageBox("PONG", c(0x1a1a1a), c(0xffffff));
  } else if (state == GameState.GAME_OVER) {
    if (vars.winner == 1) {
      drawStartMessageBox("PLAYER 1 WINS!", c(0x1a1a1a), c(0x00aaff));
    } else {
      drawStartMessageBox("PLAYER 2 WINS!", c(0x1a1a1a), c(0xff5500));
    }
  }
}
