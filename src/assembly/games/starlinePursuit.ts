// Starline Pursuit - Random Starmap Generation
// Based on 9B. NewMapGeneration.md specification

import {
  Button,
  buttonPressed,
  c,
  clearFramebuffer,
  drawNumber,
  drawString,
  getU16,
  getU8,
  log,
  logi,
  pset,
  randomRange,
  setU8,
} from "../sdk";

import { drawStarmap } from "./starlinePursuit/drawStarmap";
import { generateStarmap } from "./starlinePursuit/generateStarmap";
import {
  edges,
  FUEL_PER_JUMP,
  GameState,
  getCaptureShip,
  getTargetShip,
  JUMPS_PER_TURN,
  MAX_EDGES,
  MemLayout,
  stars,
  STARTING_FUEL,
  TOTAL_STARS,
} from "./starlinePursuit/types";

// === Helper Functions ===

/**
 * Find the neighbor star visually closest to a given direction
 * direction: 0=UP, 1=RIGHT, 2=DOWN, 3=LEFT
 */
function findNeighborInDirection(starIndex: i32, direction: i32): i32 {
  const currentStar = stars.get(starIndex);
  const numEdges = getU16(MemLayout.NUM_EDGES) as i32;

  let bestIndex: i32 = -1;
  let bestScore: f32 = -999999.0;

  // Iterate through edges to find neighbors and score them
  for (let i: i32 = 0; i < numEdges && i < MAX_EDGES; i++) {
    const edge = edges.get(i);
    let neighborIndex: i32 = -1;

    // Check if this edge connects to our star
    if (edge.a == starIndex) {
      neighborIndex = edge.b;
    } else if (edge.b == starIndex) {
      neighborIndex = edge.a;
    }

    // If we found a neighbor, score it
    if (neighborIndex >= 0) {
      const nStar = stars.get(neighborIndex);
      const dx = (nStar.x - currentStar.x) as f32;
      const dy = (nStar.y - currentStar.y) as f32;

      let score: f32 = 0.0;

      // Score based on direction
      if (direction == 0) {
        // UP (negative y)
        score = -dy; // Prefer negative dy
      } else if (direction == 1) {
        // RIGHT (positive x)
        score = dx;
      } else if (direction == 2) {
        // DOWN (positive y)
        score = dy;
      } else if (direction == 3) {
        // LEFT (negative x)
        score = -dx;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = neighborIndex;
      }
    }
  }

  return bestIndex;
}

// === Lifecycle Functions ===

export function init(): void {
  log("Starline Pursuit: Initializing");

  // Set initial game state
  setU8(MemLayout.GAME_STATE, GameState.PLAYING as u8);

  // Generate the starmap
  generateStarmap();

  const numStars = getU8(MemLayout.NUM_STARS) as i32;

  // Initialize target ship at a random star position
  const targetShip = getTargetShip();
  targetShip.currentStarIndex = randomRange(numStars);
  targetShip.isActive = 1;

  // Initialize capture ship at a different random position
  const captureShip = getCaptureShip();
  let captureStart: i32;
  do {
    captureStart = randomRange(numStars);
  } while (captureStart == targetShip.currentStarIndex);

  captureShip.currentStarIndex = captureStart;
  captureShip.fuel = STARTING_FUEL;
  captureShip.jumpsThisTurn = 0;

  logi(
    "Target at star {}, Capture ship at star {}",
    targetShip.currentStarIndex,
    captureStart,
  );
  log("Starmap ready");
}

export function update(): void {
  const state = getU8(MemLayout.GAME_STATE);
  const captureShip = getCaptureShip();
  const targetShip = getTargetShip();

  // Restart game on START button if won/lost
  if (state != GameState.PLAYING && buttonPressed(Button.START)) {
    init();
    return;
  }

  // Don't process game logic if not playing
  if (state != GameState.PLAYING) return;

  // Check win condition
  if (captureShip.currentStarIndex == targetShip.currentStarIndex) {
    setU8(MemLayout.GAME_STATE, GameState.WON as u8);
    log("Victory! Target intercepted!");
    return;
  }

  // End turn on START button (resets jump counter, starts new turn)
  if (buttonPressed(Button.START)) {
    captureShip.jumpsThisTurn = 0;
    log("New turn started - jumps reset");
    return;
  }

  // Handle movement input (D-pad for direction selection)
  if (
    captureShip.jumpsThisTurn < JUMPS_PER_TURN &&
    captureShip.fuel >= FUEL_PER_JUMP
  ) {
    let targetStarIndex: i32 = -1;

    if (buttonPressed(Button.UP)) {
      targetStarIndex = findNeighborInDirection(
        captureShip.currentStarIndex,
        0,
      );
    } else if (buttonPressed(Button.RIGHT)) {
      targetStarIndex = findNeighborInDirection(
        captureShip.currentStarIndex,
        1,
      );
    } else if (buttonPressed(Button.DOWN)) {
      targetStarIndex = findNeighborInDirection(
        captureShip.currentStarIndex,
        2,
      );
    } else if (buttonPressed(Button.LEFT)) {
      targetStarIndex = findNeighborInDirection(
        captureShip.currentStarIndex,
        3,
      );
    }

    // Execute jump if valid neighbor found
    if (targetStarIndex >= 0) {
      captureShip.currentStarIndex = targetStarIndex;
      captureShip.fuel -= FUEL_PER_JUMP;
      captureShip.jumpsThisTurn++;
      logi(
        "Jumped to star {} (Fuel: {}, Jumps: {}/{})",
        targetStarIndex,
        captureShip.fuel,
        captureShip.jumpsThisTurn,
      );

      // Check win condition after movement
      if (captureShip.currentStarIndex == targetShip.currentStarIndex) {
        setU8(MemLayout.GAME_STATE, GameState.WON as u8);
        log("Victory! Target intercepted!");
        return;
      }
    }
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a1a)); // Dark blue-black space background

  // Draw the starmap
  drawStarmap();

  const state = getU8(MemLayout.GAME_STATE);
  const captureShip = getCaptureShip();
  const numStars = getU8(MemLayout.NUM_STARS);
  const numEdges = getU16(MemLayout.NUM_EDGES);

  // Draw game stats (top left)
  drawString(10, 1, "FUEL:", c(0xffffff));
  drawNumber(48, 1, captureShip.fuel, c(0x00ff00));

  drawString(85, 1, "JUMPS:", c(0xffffff));
  const jumpsRemaining = JUMPS_PER_TURN - captureShip.jumpsThisTurn;
  drawNumber(132, 1, jumpsRemaining, c(0xaaccff));
  drawString(142, 1, "/", c(0x666666));
  drawNumber(152, 1, JUMPS_PER_TURN, c(0x666666));

  // Draw map info (bottom)
  drawString(10, 229, "STARS:", c(0xaaaaaa));
  drawNumber(56, 229, numStars as i32, c(0x666666));

  drawString(100, 229, "LANES:", c(0xaaaaaa));
  drawNumber(146, 229, numEdges as i32, c(0x666666));

  // Draw win/lose message
  if (state == GameState.WON) {
    drawString(80, 100, "TARGET INTERCEPTED!", c(0x00ff00));
    drawString(90, 115, "PRESS START", c(0xffffff));
  } else if (state == GameState.LOST) {
    drawString(95, 100, "TARGET ESCAPED", c(0xff0000));
    drawString(90, 115, "PRESS START", c(0xffffff));
  }
}
