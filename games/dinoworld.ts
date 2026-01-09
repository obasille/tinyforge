// Dino World - Simple Platformer Game

// Import console SDK
import {
  Button,
  RAM_START,
  WIDTH,
  HEIGHT,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawNumber,
  drawSprite,
  drawString,
  drawStartMessageBox,
  fillRect,
  fillCircle,
  log,
  playSfx,
  Vec2i,
} from "../sdk";

// === Constants ===
const GRAVITY: f32 = 0.5;
const JUMP_FORCE: f32 = -8.0;
const MOVE_SPEED: f32 = 2.0;
const GROUND_Y: i32 = 200;

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  GAME_OVER = 2,
}

// Platform definition
class Platform {
  x: i32;
  y: i32;
  w: i32;
  h: i32;
}

// Spike trap definition
class Spike {
  x: f32;
  y: f32;
  speed: f32;
  active: bool;
}

// Coin collectible definition
class Coin {
  x: i32;
  y: i32;
  active: bool;
}

// Define platforms (x, y, width, height)
const platforms: Platform[] = [
  { x: 0, y: GROUND_Y, w: WIDTH, h: 40 },      // Ground
  { x: 50, y: 160, w: 60, h: 8 },              // Platform 1
  { x: 150, y: 130, w: 70, h: 8 },             // Platform 2
  { x: 240, y: 100, w: 60, h: 8 },             // Platform 3
  { x: 120, y: 70, w: 80, h: 8 },              // Platform 4 (top)
];

// Spike traps that fall from the sky
const SPIKE_COUNT: i32 = 3;
const spikes: Spike[] = [
  { x: 100, y: -20, speed: 1.5, active: false },
  { x: 200, y: -20, speed: 1.8, active: false },
  { x: 280, y: -20, speed: 1.3, active: false },
];

// Collectible coin (one at a time)
const coin: Coin = { x: 0, y: 0, active: false };

// RNG seed for random coin placement
let coinRngSeed: i32 = 54321;

// Helper function to get random number
function randomCoinInt(max: i32): i32 {
  coinRngSeed = (coinRngSeed * 1103515245 + 12345) & 0x7fffffff;
  return (coinRngSeed % max);
}

// Spawn a new coin at a random platform location
function spawnRandomCoin(): void {
  const platformIndex = randomCoinInt(platforms.length);
  const plat = platforms[platformIndex];
  
  // Random X position on the platform (with some margin)
  const margin = 20;
  const coinX = plat.x + margin + randomCoinInt(plat.w - margin * 2);
  
  // Y position just above the platform (24x24 sprite)
  const coinY = plat.y - 24;
  
  coin.x = coinX;
  coin.y = coinY;
  coin.active = true;
}

// === RAM Variable System ===
// RAM allocation for persistent game state

@unmanaged
class GameVars {
  playerX: f32 = 0;       // 0
  playerY: f32 = 0;       // 4
  velocityX: f32 = 0;     // 8
  velocityY: f32 = 0;     // 12
  grounded: u8 = 0;       // 16
  facingRight: u8 = 1;    // 17
  animFrame: i32 = 0;     // 20
  animTimer: i32 = 0;     // 24
  lives: i32 = 0;         // 28
  state: u8 = 0;          // 32
  invulnTimer: i32 = 0;   // 36 (invulnerability after hit)
  gameTimer: i32 = 0;     // 40
  coinsCollected: i32 = 0; // 44
}

const gameVars = changetype<GameVars>(RAM_START);

const PLAYER_WIDTH: i32 = 32;
const PLAYER_HEIGHT: i32 = 32;
const TAIL_LENGTH: i32 = 10;
const COLLISION_WIDTH: i32 = PLAYER_WIDTH - TAIL_LENGTH; // 22 pixels
const STARTING_LIVES: i32 = 5;
const INVULN_TIME: i32 = 120; // 2 seconds at 60fps
const DIFFICULTY_SCALE: f32 = 1800.0; // Lower = faster difficulty increase (1800 = +1 every 30 seconds)

// === lifecycle ===
  
export function init(): void {
  clearFramebuffer(c(0x87CEEB)); // Sky blue

  // Initialize player position
  gameVars.playerX = 50;
  gameVars.playerY = 50;
  gameVars.velocityX = 0;
  gameVars.velocityY = 0;
  gameVars.grounded = 0;
  gameVars.facingRight = 1;
  gameVars.animFrame = 0;
  gameVars.animTimer = 0;
  gameVars.lives = STARTING_LIVES;
  gameVars.state = GameState.START_SCREEN as u8;
  gameVars.invulnTimer = 0;
  gameVars.gameTimer = 0;
  gameVars.coinsCollected = 0;

  // Spawn first coin
  coinRngSeed = 54321 + gameVars.gameTimer; // Add some variation
  spawnRandomCoin();

  // Reset spikes
  for (let i = 0; i < SPIKE_COUNT; i++) {
    spikes[i].y = -20;
    spikes[i].active = false;
  }

  log("Dino World Started!");
}

export function update(): void {
  const state = gameVars.state;

  // Start game from start screen
  if (state == GameState.START_SCREEN && buttonPressed(Button.START)) {
    gameVars.state = GameState.PLAYING as u8;
    return;
  }

  // Restart from game over
  if (state == GameState.GAME_OVER && buttonPressed(Button.START)) {
    init();
    return;
  }

  if (state != GameState.PLAYING) return;

  // Increment game timer
  gameVars.gameTimer++;

  // Decrement invulnerability timer
  if (gameVars.invulnTimer > 0) {
    gameVars.invulnTimer--;
  }

  // Horizontal movement
  gameVars.velocityX = 0;
  
  if (buttonDown(Button.LEFT)) {
    gameVars.velocityX = -MOVE_SPEED;
    gameVars.facingRight = 0;
  }
  if (buttonDown(Button.RIGHT)) {
    gameVars.velocityX = MOVE_SPEED;
    gameVars.facingRight = 1;
  }

  // Jump
  if (buttonPressed(Button.A) && gameVars.grounded) {
    gameVars.velocityY = JUMP_FORCE;
    gameVars.grounded = 0;
  }

  // Apply gravity
  if (!gameVars.grounded) {
    gameVars.velocityY += GRAVITY;
  }

  // Update position
  gameVars.playerX += gameVars.velocityX;
  gameVars.playerY += gameVars.velocityY;

  // Keep player in horizontal bounds (accounting for tail position)
  const tailOffset = gameVars.facingRight ? TAIL_LENGTH : 0;
  if (gameVars.playerX < <f32>(-tailOffset)) gameVars.playerX = <f32>(-tailOffset);
  const maxX = <f32>(WIDTH - PLAYER_WIDTH + tailOffset);
  if (gameVars.playerX > maxX) gameVars.playerX = maxX;

  // Platform collision (use collision box, not full sprite)
  gameVars.grounded = 0;
  
  const px = <i32>gameVars.playerX;
  const py = <i32>gameVars.playerY;
  
  // Calculate collision box position (exclude tail)
  const collisionX = gameVars.facingRight ? px + TAIL_LENGTH : px;
  const collisionW = COLLISION_WIDTH;
  const collisionH = PLAYER_HEIGHT;

  for (let i = 0; i < platforms.length; i++) {
    const plat = platforms[i];
    
    // Check if collision box is overlapping platform horizontally
    const overlapX = collisionX + collisionW > plat.x && collisionX < plat.x + plat.w;
    
    // Check if player is falling and their feet are at or below platform top
    if (overlapX && gameVars.velocityY >= 0) {
      const prevY = py - <i32>gameVars.velocityY;
      const prevBottom = prevY + collisionH;
      const currBottom = py + collisionH;
      
      // Check if player crossed platform surface this frame
      if (prevBottom <= plat.y && currBottom >= plat.y) {
        gameVars.playerY = <f32>(plat.y - collisionH);
        gameVars.velocityY = 0;
        gameVars.grounded = 1;
        break;
      }
    }
  }

  // Update animation
  if (gameVars.velocityX != 0 && gameVars.grounded) {
    gameVars.animTimer++;
    if (gameVars.animTimer >= 5) {
      gameVars.animTimer = 0;
      gameVars.animFrame = (gameVars.animFrame + 1) % 9;
    }
  } else {
    gameVars.animFrame = 0;
    gameVars.animTimer = 0;
  }

  // Update spikes
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const spike = spikes[i];
    
    // Increase difficulty over time: spikes spawn faster and move faster
    const difficultyMultiplier = 1.0 + (<f32>gameVars.gameTimer) / DIFFICULTY_SCALE;
    const minInterval = 60; // Don't spawn faster than every second
    const baseInterval = 180 + i * 60;
    const adjustedInterval = max(minInterval, <i32>((<f32>baseInterval) / difficultyMultiplier));

    // Activate spikes periodically (faster as time goes on)
    if (!spike.active && gameVars.gameTimer % adjustedInterval == 0) {
      spike.active = true;
      spike.y = -20;
      spike.x = 30 + <f32>(i * 100);
      // Increase speed over time
      const baseSpeeds: f32[] = [1.5, 1.8, 1.3];
      spike.speed = <f32>(baseSpeeds[i] * difficultyMultiplier);
    }

    if (spike.active) {
      spike.y += spike.speed;

      // Reset spike if it goes off screen
      if (spike.y > <f32>HEIGHT) {
        spike.active = false;
      }

      // Check collision with player (if not invulnerable)
      if (gameVars.invulnTimer <= 0) {
        const px = <i32>gameVars.playerX;
        const py = <i32>gameVars.playerY;
        const sx = <i32>spike.x;
        const sy = <i32>spike.y;

        // Simple box collision
        if (px + PLAYER_WIDTH > sx && px < sx + 16 &&
            py + PLAYER_HEIGHT > sy && py < sy + 16) {
          // Hit! Lose a life
          gameVars.lives--;
          gameVars.invulnTimer = INVULN_TIME;
          log("Hit by spike!");

          // Check for game over
          if (gameVars.lives <= 0) {
            gameVars.state = GameState.GAME_OVER as u8;
            log("Game Over!");
          }

          // Deactivate spike
          spike.active = false;
        }
      }
    }
  }

  // Check coin collection
  if (coin.active) {
    const px = <i32>gameVars.playerX;
    const py = <i32>gameVars.playerY;
    const collisionX = gameVars.facingRight ? px + TAIL_LENGTH : px;

    // Coin is 24x24 pixels
    if (
      collisionX < coin.x + 24 &&
      collisionX + COLLISION_WIDTH > coin.x &&
      py < coin.y + 24 &&
      py + PLAYER_HEIGHT > coin.y
    ) {
      gameVars.coinsCollected++;
      playSfx(0, 0.6); // Coin collect sound
      
      // Spawn new coin at random location
      spawnRandomCoin();
    }
  }
}

export function draw(): void {
  // Sky background
  clearFramebuffer(c(0x87CEEB));

  const state = gameVars.state;

  // Draw platforms
  for (let i = 0; i < platforms.length; i++) {
    const plat = platforms[i];
    const color = i == 0 ? c(0x8B4513) : c(0x228B22); // Brown for ground, green for platforms
    fillRect(plat.x, plat.y, plat.w, plat.h, color);
  }

  // Draw spikes (red triangular hazards)
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const spike = spikes[i];
    if (spike.active) {
      const sx = <i32>spike.x;
      const sy = <i32>spike.y;
      // Draw as red squares for simplicity
      fillRect(sx, sy, 16, 16, c(0xFF0000));
      // Draw inner dark square for depth
      fillRect(sx + 4, sy + 4, 8, 8, c(0x880000));
    }
  }

  // Draw coin (animated sprite 10-17)
  if (coin.active) {
    // Animate through 8 frames (10-17) every 8 frames
    const coinFrame = (gameVars.gameTimer / 8) % 8;
    const coinSpriteId = 10 + coinFrame;
    drawSprite(coinSpriteId, coin.x, coin.y);
  }

  // Draw player (dinosaur sprite) - flash when invulnerable
  if (gameVars.invulnTimer <= 0 || (gameVars.invulnTimer / 5) % 2 == 0) {
    const px = <i32>gameVars.playerX;
    const py = <i32>gameVars.playerY;
    const spriteId = 1 + <u32>gameVars.animFrame;
    
    drawSprite(spriteId, px, py, gameVars.facingRight == 0);
  }

  // Draw title and lives
  drawString(10, 10, "DINO WORLD", c(0xFFFFFF));
  
  // Draw lives as hearts
  for (let i: i32 = 0; i < gameVars.lives && i < STARTING_LIVES; i++) {
    fillCircle(10 + i * 15, 30, 4, c(0xFF0000));
  }

  // Draw coins collected in top-right
  drawSprite(14, WIDTH - 70, 2);
  // Number of coins
  drawNumber(WIDTH - 40, 8, gameVars.coinsCollected, c(0xFFFFFF));

  // Draw messages
  if (state == GameState.START_SCREEN) {
    drawStartMessageBox("DINO WORLD", c(0x1a1a1a), c(0x00ff00));
  } else if (state == GameState.GAME_OVER) {
    drawStartMessageBox("GAME OVER", c(0xaa5500), c(0xffaa00));
  }
}
