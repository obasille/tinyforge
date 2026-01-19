// SPACE INVADERS - TinyForge Game
// Classic arcade shooter

import {
  Button,
  buttonDown,
  buttonPressed,
  c,
  clearFramebuffer,
  drawNumber,
  drawString,
  drawStartMessageBox,
  fillRect,
  getU8,
  HEIGHT,
  log,
  playSfx,
  RAM_START,
  randomRange,
  setU8,
  WIDTH,
  setU16,
  getU16,
} from "../sdk";

// === Constants ===
const PLAYER_WIDTH: i32 = 24;
const PLAYER_HEIGHT: i32 = 14;
const PLAYER_Y: i32 = HEIGHT - 30;
const PLAYER_SPEED: f32 = 3.0;

const ALIEN_COLS: i32 = 11;
const ALIEN_ROWS: i32 = 5;
const ALIEN_WIDTH: i32 = 12;
const ALIEN_HEIGHT: i32 = 8;
const ALIEN_START_X: i32 = 20;
const ALIEN_START_Y: i32 = 40;
const ALIEN_SPACING_X: i32 = 24;
const ALIEN_SPACING_Y: i32 = 20;
const ALIEN_MOVE_SPEED: f32 = 0.0625;
const ALIEN_DROP_DISTANCE: i32 = 10;

const BULLET_WIDTH: i32 = 2;
const BULLET_HEIGHT: i32 = 6;
const BULLET_SPEED: f32 = 5.0;
const ALIEN_BULLET_SPEED: f32 = 2.5;
const MAX_PLAYER_BULLETS: i32 = 3;
const MAX_ALIEN_BULLETS: i32 = 5;

const SHIELD_COUNT: i32 = 4;
const SHIELD_WIDTH: i32 = 24;
const SHIELD_HEIGHT: i32 = 12;
const SHIELD_Y: i32 = 180;
const SHIELD_BLOCKS: i32 = 8; // 8 destructible blocks per shield

const STARTING_LIVES: i32 = 3;
const ALIEN_SHOOT_CHANCE: i32 = 180; // Lower = more frequent (1 in N per frame)

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
  playerX: f32;           // 0
  alienGridX: f32;        // 4
  alienGridY: f32;        // 8
  alienDirection: i32;    // 12 (1 = right, -1 = left)
  state: u8;              // 16
  lives: i32;             // 20
  score: i32;             // 24
  aliensRemaining: i32;   // 28
  animFrame: i32;         // 32
  animTimer: i32;         // 36
  shootCooldown: i32;     // 40
  gameTimer: i32;         // 44
  level: i32;             // 48
}

const vars = changetype<Vars>(RAM_START);

// Alien data: 1 byte per alien (0 = dead, 1 = alive)
const ALIEN_DATA = RAM_START + 60; // 55 bytes for aliens

// Player bullets: 3 bullets × 4 bytes each (x, y, active)
const PLAYER_BULLET_DATA = RAM_START + 120;

// Alien bullets: 5 bullets × 4 bytes each
const ALIEN_BULLET_DATA = RAM_START + 132;

// Shield health: 4 shields × 8 blocks each = 32 bytes (0-2 health per block)
const SHIELD_DATA = RAM_START + 152;

// === Alien Helpers ===
function getAlien(col: i32, row: i32): u8 {
  if (col < 0 || col >= ALIEN_COLS || row < 0 || row >= ALIEN_ROWS) return 0;
  return getU8(ALIEN_DATA + row * ALIEN_COLS + col);
}

function setAlien(col: i32, row: i32, value: u8): void {
  if (col < 0 || col >= ALIEN_COLS || row < 0 || row >= ALIEN_ROWS) return;
  setU8(ALIEN_DATA + row * ALIEN_COLS + col, value);
}

function initAliens(): void {
  vars.aliensRemaining = 0;
  for (let row: i32 = 0; row < ALIEN_ROWS; row++) {
    for (let col: i32 = 0; col < ALIEN_COLS; col++) {
      setAlien(col, row, 1);
      vars.aliensRemaining++;
    }
  }
  vars.alienGridX = (ALIEN_START_X as f32);
  vars.alienGridY = (ALIEN_START_Y as f32);
  vars.alienDirection = 1;
}

// === Bullet Helpers ===
function getPlayerBulletX(index: i32): i32 {
  return getU16(PLAYER_BULLET_DATA + index * 4) as i32;
}

function getPlayerBulletY(index: i32): i32 {
  return getU8(PLAYER_BULLET_DATA + index * 4 + 2) as i32;
}

function getPlayerBulletActive(index: i32): u8 {
  return getU8(PLAYER_BULLET_DATA + index * 4 + 3);
}

function setPlayerBullet(index: i32, x: i32, y: i32, active: u8): void {
  setU16(PLAYER_BULLET_DATA + index * 4, x as u16);
  setU8(PLAYER_BULLET_DATA + index * 4 + 2, y as u8);
  setU8(PLAYER_BULLET_DATA + index * 4 + 3, active);
}

function getAlienBulletX(index: i32): i32 {
  return getU16(ALIEN_BULLET_DATA + index * 4) as i32;
}

function getAlienBulletY(index: i32): i32 {
  return getU8(ALIEN_BULLET_DATA + index * 4 + 2) as i32;
}

function getAlienBulletActive(index: i32): u8 {
  return getU8(ALIEN_BULLET_DATA + index * 4 + 3);
}

function setAlienBullet(index: i32, x: i32, y: i32, active: u8): void {
  setU16(ALIEN_BULLET_DATA + index * 4, x as u16);
  setU8(ALIEN_BULLET_DATA + index * 4 + 2, y as u8);
  setU8(ALIEN_BULLET_DATA + index * 4 + 3, active);
}

// === Shield Helpers ===
function getShieldBlock(shield: i32, block: i32): u8 {
  return getU8(SHIELD_DATA + shield * SHIELD_BLOCKS + block);
}

function setShieldBlock(shield: i32, block: i32, health: u8): void {
  setU8(SHIELD_DATA + shield * SHIELD_BLOCKS + block, health);
}

function initShields(): void {
  for (let s: i32 = 0; s < SHIELD_COUNT; s++) {
    for (let b: i32 = 0; b < SHIELD_BLOCKS; b++) {
      setShieldBlock(s, b, 2); // Each block starts with 2 health (removed on 2nd hit)
    }
  }
}

// === Drawing Functions ===
function drawPlayerShip(x: i32, y: i32, color: u32): void {
  fillRect(x + 6, y, 12, 4, color);
  fillRect(x + 4, y + 4, 16, 6, color);
  fillRect(x, y + 10, 24, 4, color);
  fillRect(x + 10, y + 2, 4, 2, c(0x00ffff));
}

function drawAlienType1(x: i32, y: i32, frame: i32): void {
  const color = c(0x00ff00);
  if (frame == 0) {
    fillRect(x + 2, y, 2, 2, color);
    fillRect(x + 8, y, 2, 2, color);
    fillRect(x + 1, y + 2, 10, 4, color);
    fillRect(x, y + 6, 3, 2, color);
    fillRect(x + 9, y + 6, 3, 2, color);
  } else {
    fillRect(x + 2, y, 2, 2, color);
    fillRect(x + 8, y, 2, 2, color);
    fillRect(x + 1, y + 2, 10, 4, color);
    fillRect(x, y + 2, 2, 2, color);
    fillRect(x + 10, y + 2, 2, 2, color);
  }
}

function drawAlienType2(x: i32, y: i32, frame: i32): void {
  const color = c(0xff00ff);
  if (frame == 0) {
    fillRect(x + 1, y, 3, 2, color);
    fillRect(x + 7, y, 3, 2, color);
    fillRect(x, y + 2, 11, 3, color);
    fillRect(x, y + 5, 2, 3, color);
    fillRect(x + 4, y + 5, 3, 3, color);
    fillRect(x + 9, y + 5, 2, 3, color);
  } else {
    fillRect(x + 1, y, 3, 2, color);
    fillRect(x + 7, y, 3, 2, color);
    fillRect(x, y + 2, 11, 3, color);
    fillRect(x + 1, y + 5, 2, 3, color);
    fillRect(x + 4, y + 5, 3, 3, color);
    fillRect(x + 8, y + 5, 2, 3, color);
  }
}

function drawAlienType3(x: i32, y: i32, frame: i32): void {
  const color = c(0xffff00);
  if (frame == 0) {
    fillRect(x + 2, y, 4, 4, color);
    fillRect(x, y + 4, 2, 2, color);
    fillRect(x + 3, y + 4, 2, 2, color);
    fillRect(x + 6, y + 4, 2, 2, color);
    fillRect(x + 1, y + 6, 2, 2, color);
    fillRect(x + 5, y + 6, 2, 2, color);
  } else {
    fillRect(x + 2, y, 4, 4, color);
    fillRect(x, y + 4, 2, 2, color);
    fillRect(x + 3, y + 4, 2, 2, color);
    fillRect(x + 6, y + 4, 2, 2, color);
    fillRect(x + 2, y + 6, 2, 2, color);
    fillRect(x + 4, y + 6, 2, 2, color);
  }
}

function drawShield(x: i32, y: i32, shieldIndex: i32): void {
  const blockWidth: i32 = 6;
  const blockHeight: i32 = 6;
  
  for (let b: i32 = 0; b < SHIELD_BLOCKS; b++) {
    const health = getShieldBlock(shieldIndex, b);
    if (health > 0) {
      const bx = x + (b % 4) * blockWidth;
      const by = y + (b / 4) * blockHeight;
      
      // Color based on health
      let color: u32;
      if (health > 1) color = c(0x00ff00);
      else color = c(0xffaa00);
      
      fillRect(bx, by, blockWidth - 1, blockHeight - 1, color);
    }
  }
}

// === Lifecycle ===
export function init(): void {
  vars.playerX = ((WIDTH / 2 - PLAYER_WIDTH / 2) as f32);
  vars.state = GameState.START_SCREEN as u8;
  vars.lives = STARTING_LIVES;
  vars.score = 0;
  vars.animFrame = 0;
  vars.animTimer = 0;
  vars.shootCooldown = 0;
  vars.gameTimer = 0;
  vars.level = 1;
  
  initAliens();
  initShields();
  
  // Clear bullets
  for (let i: i32 = 0; i < MAX_PLAYER_BULLETS; i++) {
    setPlayerBullet(i, 0, 0, 0);
  }
  for (let i: i32 = 0; i < MAX_ALIEN_BULLETS; i++) {
    setAlienBullet(i, 0, 0, 0);
  }
  
}

export function update(): void {
  const state = vars.state;
  
  if (state == GameState.START_SCREEN && buttonPressed(Button.START)) {
    vars.state = GameState.PLAYING as u8;
    return;
  }
  
  if (state == GameState.GAME_OVER && buttonPressed(Button.START)) {
    init();
    return;
  }
  
  if (state == GameState.LEVEL_COMPLETE && buttonPressed(Button.START)) {
    vars.level++;
    initAliens();
    initShields();
    vars.state = GameState.PLAYING as u8;
    return;
  }
  
  if (state != GameState.PLAYING) return;
  
  vars.gameTimer++;
  
  // Update animation
  vars.animTimer++;
  if (vars.animTimer >= 30) {
    vars.animTimer = 0;
    vars.animFrame = (vars.animFrame + 1) % 2;
  }
  
  // Player movement
  let playerX = vars.playerX;
  if (buttonDown(Button.LEFT)) {
    playerX -= PLAYER_SPEED;
    if (playerX < 0.0) playerX = 0.0;
  }
  if (buttonDown(Button.RIGHT)) {
    playerX += PLAYER_SPEED;
    if (playerX > ((WIDTH - PLAYER_WIDTH) as f32)) {
      playerX = ((WIDTH - PLAYER_WIDTH) as f32);
    }
  }
  vars.playerX = playerX;
  
  // Player shooting
  if (vars.shootCooldown > 0) {
    vars.shootCooldown--;
  }
  
  if (buttonPressed(Button.A) && vars.shootCooldown == 0) {
    // Find empty bullet slot
    for (let i: i32 = 0; i < MAX_PLAYER_BULLETS; i++) {
      if (getPlayerBulletActive(i) == 0) {
        const bulletX = (playerX as i32) + PLAYER_WIDTH / 2 - 1;
        const bulletY = PLAYER_Y - BULLET_HEIGHT;
        setPlayerBullet(i, bulletX, bulletY, 1);
        vars.shootCooldown = 20;
        playSfx("tap", 0.3);
        break;
      }
    }
  }
  
  // Update player bullets
  for (let i: i32 = 0; i < MAX_PLAYER_BULLETS; i++) {
    if (getPlayerBulletActive(i) == 1) {
      let by = getPlayerBulletY(i);
      by -= (BULLET_SPEED as i32);
      
      if (by < 0) {
        setPlayerBullet(i, 0, 0, 0);
      } else {
        const bx = getPlayerBulletX(i);
        setPlayerBullet(i, bx, by, 1);
        
        // Check alien collision
        let hitAlien = false;
        for (let row: i32 = 0; row < ALIEN_ROWS && !hitAlien; row++) {
          for (let col: i32 = 0; col < ALIEN_COLS && !hitAlien; col++) {
            if (getAlien(col, row) == 1) {
              const ax = (vars.alienGridX as i32) + col * ALIEN_SPACING_X;
              const ay = (vars.alienGridY as i32) + row * ALIEN_SPACING_Y;
              
              if (bx >= ax && bx < ax + ALIEN_WIDTH &&
                  by >= ay && by < ay + ALIEN_HEIGHT) {
                setAlien(col, row, 0);
                vars.aliensRemaining--;
                setPlayerBullet(i, 0, 0, 0);
                
                // Score based on alien type
                if (row == 0) vars.score += 30;
                else if (row <= 2) vars.score += 20;
                else vars.score += 10;
                
                playSfx("tap", 0.5);
                hitAlien = true;
                
                if (vars.aliensRemaining == 0) {
                  vars.state = GameState.LEVEL_COMPLETE as u8;
                  log("Level Complete!");
                }
              }
            }
          }
        }
        
        // Check shield collision
        if (!hitAlien) {
          for (let s: i32 = 0; s < SHIELD_COUNT; s++) {
            const sx = 30 + s * 70;
            if (bx >= sx && bx < sx + SHIELD_WIDTH &&
                by >= SHIELD_Y && by < SHIELD_Y + SHIELD_HEIGHT) {
              const blockX = (bx - sx) / 6;
              const blockY = (by - SHIELD_Y) / 6;
              const blockIdx = blockY * 4 + blockX;
              
              if (blockIdx >= 0 && blockIdx < SHIELD_BLOCKS) {
                const health = getShieldBlock(s, blockIdx);
                if (health > 0) {
                  setShieldBlock(s, blockIdx, health - 1);
                  setPlayerBullet(i, 0, 0, 0);
                  break;
                }
              }
            }
          }
        }
      }
    }
  }
  
  // Move aliens
  const moveSpeed = ALIEN_MOVE_SPEED * (1.0 + (vars.level as f32) * 0.2);
  vars.alienGridX += (vars.alienDirection as f32) * moveSpeed;
  
  // Check if aliens need to drop
  let shouldDrop = false;
  if (vars.alienDirection > 0 && vars.alienGridX > ((WIDTH - ALIEN_COLS * ALIEN_SPACING_X - 5) as f32)) {
    shouldDrop = true;
    vars.alienDirection = -1;
  } else if (vars.alienDirection < 0 && vars.alienGridX < 5.0) {
    shouldDrop = true;
    vars.alienDirection = 1;
  }
  
  if (shouldDrop) {
    vars.alienGridY += (ALIEN_DROP_DISTANCE as f32);
    
    // Check if aliens reached bottom
    if (vars.alienGridY > ((SHIELD_Y - 20) as f32)) {
      vars.state = GameState.GAME_OVER as u8;
      log("Aliens reached Earth!");
    }
  }
  
  // Alien shooting
  if (randomRange(ALIEN_SHOOT_CHANCE) == 0) {
    // Find a random alive alien in bottom row
    for (let attempt: i32 = 0; attempt < 10; attempt++) {
      const col = randomRange(ALIEN_COLS);
      
      // Find bottom-most alien in this column
      for (let row: i32 = ALIEN_ROWS - 1; row >= 0; row--) {
        if (getAlien(col, row) == 1) {
          // Try to spawn bullet
          for (let i: i32 = 0; i < MAX_ALIEN_BULLETS; i++) {
            if (getAlienBulletActive(i) == 0) {
              const ax = (vars.alienGridX as i32) + col * ALIEN_SPACING_X + ALIEN_WIDTH / 2;
              const ay = (vars.alienGridY as i32) + row * ALIEN_SPACING_Y + ALIEN_HEIGHT;
              setAlienBullet(i, ax, ay, 1);
              break;
            }
          }
          break;
        }
      }
    }
  }
  
  // Update alien bullets
  for (let i: i32 = 0; i < MAX_ALIEN_BULLETS; i++) {
    if (getAlienBulletActive(i) == 1) {
      let by = getAlienBulletY(i);
      by += (ALIEN_BULLET_SPEED as i32);
      
      if (by > HEIGHT) {
        setAlienBullet(i, 0, 0, 0);
      } else {
        const bx = getAlienBulletX(i);
        setAlienBullet(i, bx, by, 1);
        
        // Check player collision
        const px = vars.playerX as i32;
        if (bx >= px && bx < px + PLAYER_WIDTH &&
            by >= PLAYER_Y && by < PLAYER_Y + PLAYER_HEIGHT) {
          vars.lives--;
          setAlienBullet(i, 0, 0, 0);
          playSfx("explosion", 0.3);
          
          if (vars.lives <= 0) {
            vars.state = GameState.GAME_OVER as u8;
            log("Game Over!");
          }
        }
        
        // Check shield collision
        for (let s: i32 = 0; s < SHIELD_COUNT; s++) {
          const sx = 30 + s * 70;
          if (bx >= sx && bx < sx + SHIELD_WIDTH &&
              by >= SHIELD_Y && by < SHIELD_Y + SHIELD_HEIGHT) {
            const blockX = (bx - sx) / 6;
            const blockY = (by - SHIELD_Y) / 6;
            const blockIdx = blockY * 4 + blockX;
            
            if (blockIdx >= 0 && blockIdx < SHIELD_BLOCKS) {
              const health = getShieldBlock(s, blockIdx);
              if (health > 0) {
                setShieldBlock(s, blockIdx, health - 1);
                setAlienBullet(i, 0, 0, 0);
                break;
              }
            }
          }
        }
      }
    }
  }
}

export function draw(): void {
  clearFramebuffer(c(0x000000));
  
  const state = vars.state;
  const animFrame = vars.animFrame;
  
  // Draw aliens
  for (let row: i32 = 0; row < ALIEN_ROWS; row++) {
    // Add wave motion: each row has delayed horizontal offset
    const rowOffset: f32 = Mathf.sin(((vars.gameTimer as f32) * 0.05) - ((row as f32) * 0.5)) * 3.0;
    
    for (let col: i32 = 0; col < ALIEN_COLS; col++) {
      if (getAlien(col, row) == 1) {
        const ax = (vars.alienGridX as i32) + col * ALIEN_SPACING_X + (rowOffset as i32);
        const ay = (vars.alienGridY as i32) + row * ALIEN_SPACING_Y;
        
        if (row == 0) {
          drawAlienType1(ax, ay, animFrame);
        } else if (row <= 2) {
          drawAlienType2(ax, ay, animFrame);
        } else {
          drawAlienType3(ax, ay, animFrame);
        }
      }
    }
  }
  
  // Draw shields
  for (let s: i32 = 0; s < SHIELD_COUNT; s++) {
    const sx = 30 + s * 70;
    drawShield(sx, SHIELD_Y, s);
  }
  
  // Draw player
  const px = vars.playerX as i32;
  drawPlayerShip(px, PLAYER_Y, c(0x00ff00));
  
  // Draw bullets
  for (let i: i32 = 0; i < MAX_PLAYER_BULLETS; i++) {
    if (getPlayerBulletActive(i) == 1) {
      const bx = getPlayerBulletX(i);
      const by = getPlayerBulletY(i);
      fillRect(bx, by, BULLET_WIDTH, BULLET_HEIGHT, c(0xffffff));
    }
  }
  
  for (let i: i32 = 0; i < MAX_ALIEN_BULLETS; i++) {
    if (getAlienBulletActive(i) == 1) {
      const bx = getAlienBulletX(i);
      const by = getAlienBulletY(i);
      fillRect(bx, by, BULLET_WIDTH, BULLET_HEIGHT, c(0xff0000));
    }
  }
  
  // Draw UI
  drawString(4, 4, "SCORE:", c(0xffffff));
  drawNumber(50, 4, vars.score, c(0xffffff));
  
  drawString(WIDTH - 85, 4, "LIVES:", c(0xffffff));
  for (let i: i32 = 0; i < vars.lives; i++) {
    fillRect(WIDTH - 35 + i * 10, 6, 8, 6, c(0x00ff00));
  }
  
  drawString(WIDTH / 2 - 25, 4, "LEVEL:", c(0xffffff));
  drawNumber(WIDTH / 2 + 20, 4, vars.level, c(0xffffff));
  
  // Game messages
  if (state == GameState.START_SCREEN) {
    drawStartMessageBox("SPACE INVADERS", c(0x1a1a1a), c(0x00ff00));
  } else if (state == GameState.GAME_OVER) {
    drawStartMessageBox("GAME OVER", c(0x1a1a1a), c(0xff0000));
  } else if (state == GameState.LEVEL_COMPLETE) {
    drawStartMessageBox("LEVEL COMPLETE!", c(0x1a1a1a), c(0xffff00));
  }
}
