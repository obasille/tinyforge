// Dino World - Simple Platformer Game

// Import console SDK
import {
  Button,
  RAM_START,
  WIDTH,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawSprite,
  drawString,
  fillRect,
  log,
} from "../sdk";

// === Constants ===
const GRAVITY: f32 = 0.5;
const JUMP_FORCE: f32 = -8.0;
const MOVE_SPEED: f32 = 2.0;
const GROUND_Y: i32 = 200;

// Platform definition
class Platform {
  x: i32;
  y: i32;
  w: i32;
  h: i32;
}

// Define platforms (x, y, width, height)
const platforms: Platform[] = [
  { x: 0, y: GROUND_Y, w: WIDTH, h: 40 },      // Ground
  { x: 50, y: 160, w: 60, h: 8 },              // Platform 1
  { x: 150, y: 130, w: 70, h: 8 },             // Platform 2
  { x: 240, y: 100, w: 60, h: 8 },             // Platform 3
  { x: 120, y: 70, w: 80, h: 8 },              // Platform 4 (top)
];

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
}

const gameVars = changetype<GameVars>(RAM_START);

const PLAYER_WIDTH: i32 = 32;
const PLAYER_HEIGHT: i32 = 32;
const TAIL_LENGTH: i32 = 10;
const COLLISION_WIDTH: i32 = PLAYER_WIDTH - TAIL_LENGTH; // 22 pixels

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

  log("Dino World Started!");
}

export function update(): void {
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
}

export function draw(): void {
  // Sky background
  clearFramebuffer(c(0x87CEEB));

  // Draw platforms
  for (let i = 0; i < platforms.length; i++) {
    const plat = platforms[i];
    const color = i == 0 ? c(0x8B4513) : c(0x228B22); // Brown for ground, green for platforms
    fillRect(plat.x, plat.y, plat.w, plat.h, color);
  }

  // Draw player (dinosaur sprite)
  const px = <i32>gameVars.playerX;
  const py = <i32>gameVars.playerY;
  const spriteId = 1 + <u32>gameVars.animFrame;
  
  drawSprite(spriteId, px, py, gameVars.facingRight == 0);

  // Draw title
  drawString(10, 10, "DINO WORLD", c(0xFFFFFF));
}
