// METEOR RUN - TinyForge Game
// Dodge falling meteors and survive as long as possible

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
  getU16,
  getU8,
  HEIGHT,
  log,
  RAM_START,
  randomRange,
  setU16,
  setU8,
  WIDTH,
} from "../sdk";

// === Constants ===
const PLAYER_WIDTH: i32 = 18;
const PLAYER_HEIGHT: i32 = 8;
const PLAYER_SPEED: i32 = 3;
const PLAYER_MARGIN: i32 = 10;

const METEOR_SIZE: i32 = 8;
const METEOR_COUNT: i32 = 12;
const METEOR_STRIDE: i32 = 8; // x:u16, y:u16, speed:u8, hp:u8, pad:u16

const MIN_SPEED: i32 = 1;
const SPEED_RANGE: i32 = 2;
const MAX_DIFFICULTY: i32 = 4;
const SPEED_CAP: i32 = 6;

const ARMORED_CHANCE: i32 = 5; // 1 in 5 meteors are armored
const ARMORED_HP: u8 = 2;

const BULLET_WIDTH: i32 = 3;
const BULLET_HEIGHT: i32 = 6;
const BULLET_SPEED: i32 = 6;
const FIRE_COOLDOWN: u8 = 10;

// Game states
enum GameState {
  START_SCREEN = 0,
  PLAYING = 1,
  GAME_OVER = 2,
}

// === RAM Layout ===
@unmanaged
class Vars {
  state: u8; // 0
  difficulty: u8; // 1
  bulletActive: u8; // 2
  fireCooldown: u8; // 3
  score: i32; // 4
  playerX: i32; // 8
  playerY: i32; // 12
  bulletX: i32; // 16
  bulletY: i32; // 20
}

const vars = changetype<Vars>(RAM_START);
const METEOR_DATA = RAM_START + sizeof<Vars>();

// === Meteor Helpers ===
function meteorBase(i: i32): usize {
  return METEOR_DATA + i * METEOR_STRIDE;
}

function getMeteorX(i: i32): u16 {
  return getU16(meteorBase(i));
}

function getMeteorY(i: i32): u16 {
  return getU16(meteorBase(i) + 2);
}

function getMeteorSpeed(i: i32): u8 {
  return getU8(meteorBase(i) + 4);
}

function getMeteorHp(i: i32): u8 {
  return getU8(meteorBase(i) + 5);
}

function setMeteor(i: i32, x: u16, y: u16, speed: u8): void {
  const base = meteorBase(i);
  const armored = randomRange(ARMORED_CHANCE) == 0;
  setU16(base, x);
  setU16(base + 2, y);
  setU8(base + 4, speed);
  setU8(base + 5, armored ? ARMORED_HP : 1);
  setU16(base + 6, 0);
}

function rollSpeed(): u8 {
  let speed = MIN_SPEED + randomRange(SPEED_RANGE) + (vars.difficulty as i32);
  if (speed > SPEED_CAP) speed = SPEED_CAP;
  return speed as u8;
}

function spawnMeteor(i: i32, y: u16): void {
  const maxX = WIDTH - METEOR_SIZE;
  const x = randomRange(maxX) as u16;
  setMeteor(i, x, y, rollSpeed());
}

function checkCollision(mx: i32, my: i32, px: i32, py: i32): bool {
  if (mx + METEOR_SIZE <= px) return false;
  if (mx >= px + PLAYER_WIDTH) return false;
  if (my + METEOR_SIZE <= py) return false;
  if (my >= py + PLAYER_HEIGHT) return false;
  return true;
}

function checkBulletHit(mx: i32, my: i32, bx: i32, by: i32): bool {
  if (bx + BULLET_WIDTH <= mx) return false;
  if (bx >= mx + METEOR_SIZE) return false;
  if (by + BULLET_HEIGHT <= my) return false;
  if (by >= my + METEOR_SIZE) return false;
  return true;
}

// === Lifecycle ===
export function init(): void {
  vars.state = GameState.START_SCREEN as u8;
  vars.score = 0;
  vars.difficulty = 0;
  vars.bulletActive = 0;
  vars.fireCooldown = 0;
  vars.playerX = WIDTH / 2 - PLAYER_WIDTH / 2;
  vars.playerY = HEIGHT - PLAYER_HEIGHT - PLAYER_MARGIN;
  vars.bulletX = 0;
  vars.bulletY = 0;

  for (let i: i32 = 0; i < METEOR_COUNT; i++) {
    const startY = randomRange(HEIGHT) as u16;
    spawnMeteor(i, startY);
  }

  log("Meteor Run ready");
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

  if (state != GameState.PLAYING) return;

  // Player movement
  let playerX = vars.playerX;
  if (buttonDown(Button.LEFT)) playerX -= PLAYER_SPEED;
  if (buttonDown(Button.RIGHT)) playerX += PLAYER_SPEED;
  if (playerX < 0) playerX = 0;
  if (playerX > WIDTH - PLAYER_WIDTH) playerX = WIDTH - PLAYER_WIDTH;
  vars.playerX = playerX;

  // Weapon handling
  if (vars.fireCooldown > 0) vars.fireCooldown--;
  if (
    vars.bulletActive == 0 &&
    vars.fireCooldown == 0 &&
    buttonPressed(Button.A)
  ) {
    vars.bulletActive = 1;
    vars.fireCooldown = FIRE_COOLDOWN;
    vars.bulletX = playerX + PLAYER_WIDTH / 2 - BULLET_WIDTH / 2;
    vars.bulletY = vars.playerY - BULLET_HEIGHT;
  }

  if (vars.bulletActive != 0) {
    vars.bulletY -= BULLET_SPEED;
    if (vars.bulletY < -BULLET_HEIGHT) vars.bulletActive = 0;
  }

  // Meteor updates
  const playerY = vars.playerY;
  const bulletActive = vars.bulletActive != 0;
  const bulletX = vars.bulletX;
  const bulletY = vars.bulletY;
  for (let i: i32 = 0; i < METEOR_COUNT; i++) {
    const mx = getMeteorX(i) as i32;
    let my = getMeteorY(i) as i32;
    const speed = getMeteorSpeed(i) as i32;
    my += speed;

    if (my >= HEIGHT) {
      vars.score++;
      if (vars.score % 15 == 0 && (vars.difficulty as i32) < MAX_DIFFICULTY) {
        vars.difficulty++;
      }
      spawnMeteor(i, 0 as u16);
      continue;
    }

    if (bulletActive && checkBulletHit(mx, my, bulletX, bulletY)) {
      let hp = getMeteorHp(i);
      if (hp > 1) {
        hp--;
        setU8(meteorBase(i) + 5, hp);
        vars.score++;
      } else {
        vars.score += 2;
        spawnMeteor(i, 0 as u16);
      }
      vars.bulletActive = 0;
      continue;
    }

    if (checkCollision(mx, my, playerX, playerY)) {
      vars.state = GameState.GAME_OVER as u8;
      log("Crashed");
      break;
    }

    setU16(meteorBase(i) + 2, my as u16);
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a0a));

  // Draw player
  const playerX = vars.playerX;
  const playerY = vars.playerY;
  fillRect(playerX, playerY, PLAYER_WIDTH, PLAYER_HEIGHT, c(0x00ffcc));
  fillRect(playerX + 4, playerY - 4, PLAYER_WIDTH - 8, 4, c(0x008866));

  if (vars.bulletActive != 0) {
    fillRect(
      vars.bulletX,
      vars.bulletY,
      BULLET_WIDTH,
      BULLET_HEIGHT,
      c(0xffff99),
    );
  }

  // Draw meteors
  for (let i: i32 = 0; i < METEOR_COUNT; i++) {
    const mx = getMeteorX(i) as i32;
    const my = getMeteorY(i) as i32;
    const hp = getMeteorHp(i);
    if (hp > 1) {
      fillRect(mx, my, METEOR_SIZE, METEOR_SIZE, c(0x7799ff));
      fillRect(mx + 2, my + 2, METEOR_SIZE - 4, METEOR_SIZE - 4, c(0x334488));
    } else {
      fillRect(mx, my, METEOR_SIZE, METEOR_SIZE, c(0xff8800));
      fillRect(mx + 2, my + 2, METEOR_SIZE - 4, METEOR_SIZE - 4, c(0xaa4400));
    }
  }

  // HUD
  drawString(6, 6, "SCORE", c(0xaaaaaa));
  drawNumber(54, 6, vars.score, c(0xffffff));
  drawString(6, 18, "LEVEL", c(0x666666));
  drawNumber(54, 18, (vars.difficulty as i32) + 1, c(0xffffff));

  const state = vars.state;
  if (state == GameState.START_SCREEN) {
    drawStartMessageBox("METEOR RUN", c(0x1a1a1a), c(0xff8800));
  } else if (state == GameState.GAME_OVER) {
    drawStartMessageBox("CRASHED", c(0x1a1a1a), c(0xff0000));
  }
}
