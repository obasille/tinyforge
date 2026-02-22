// Starline Pursuit - Random Starmap Generation
// Based on 9B. NewMapGeneration.md specification

import {
  Button,
  buttonPressed,
  c,
  clearFramebuffer,
  drawNumber,
  drawString,
  FixedArray,
  getI32,
  getU16,
  getU8,
  log,
  logi,
  RAM_START,
  randomRange,
  setI32,
  setU8,
} from "../sdk";

import { drawStarmap } from "./starlinePursuit/drawStarmap";
import { generateStarmap } from "./starlinePursuit/generateStarmap";
import { moveTarget } from "./starlinePursuit/moveTarget";
import {
  BEACON_RANGE,
  beacons,
  edges,
  GameState,
  getTargetShip,
  MAX_BEACONS,
  MAX_COMMAND_POINTS,
  MAX_EDGES,
  MAX_PLAYER_SHIPS,
  MAX_SENSOR_ENERGY,
  MemLayout,
  playerShips,
  SCAN_COST,
  SCAN_RADIUS,
  SE_REGEN_PER_TURN,
  ShipType,
  stars,
  STARTING_COMMAND_POINTS,
  STARTING_DEPLOYMENT_KITS,
  STARTING_SENSOR_ENERGY,
} from "./starlinePursuit/types";
import { starsDist2 } from "./starlinePursuit/utils";

// === Helper Functions ===

/**
 * Get the maximum moves per turn for a ship type
 */
function getShipMoveLimit(shipType: i32): i32 {
  if (shipType == ShipType.INTERCEPTOR) return 3;
  if (shipType == ShipType.SCOUT) return 2;
  if (shipType == ShipType.SURVEY_CRUISER) return 1;
  if (shipType == ShipType.BEACON_TENDER) return 1;
  return 1;
}

/**
 * Get ship type name for display
 */
function getShipTypeName(shipType: i32): string {
  if (shipType == ShipType.INTERCEPTOR) return "INTERCEPTOR";
  if (shipType == ShipType.SCOUT) return "SCOUT";
  if (shipType == ShipType.SURVEY_CRUISER) return "SURVEY";
  if (shipType == ShipType.BEACON_TENDER) return "BEACON";
  return "UNKNOWN";
}

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
  log("Starline Pursuit: Initializing fleet");

  // Set initial game state
  setU8(MemLayout.GAME_STATE, GameState.PLAYING as u8);

  // Generate the starmap
  generateStarmap();

  const numStars = getU8(MemLayout.NUM_STARS) as i32;

  // Initialize target ship at a random star position
  const targetShip = getTargetShip();
  targetShip.currentStarIndex = randomRange(numStars);
  targetShip.isActive = 1;

  // Initialize player fleet (3 ships at random different positions)
  // Use temporary memory for tracking used stars during initialization
  const usedStars = FixedArray.fromAddress<i32>(
    RAM_START + MemLayout.TEMP_WORK_START,
  );
  usedStars[0] = targetShip.currentStarIndex;
  let usedCount: i32 = 1;

  // Ship 0: Interceptor
  let starIndex: i32;
  do {
    starIndex = randomRange(numStars);
    let valid = true;
    for (let i: i32 = 0; i < usedCount; i++) {
      if (usedStars[i] == starIndex) {
        valid = false;
        break;
      }
    }
    if (valid) break;
  } while (true);
  usedStars[usedCount++] = starIndex;

  const interceptor = playerShips.get(0);
  interceptor.shipType = ShipType.INTERCEPTOR;
  interceptor.currentStarIndex = starIndex;
  interceptor.movesThisTurn = 0;

  // Ship 1: Survey Cruiser
  do {
    starIndex = randomRange(numStars);
    let valid = true;
    for (let i: i32 = 0; i < usedCount; i++) {
      if (usedStars[i] == starIndex) {
        valid = false;
        break;
      }
    }
    if (valid) break;
  } while (true);
  usedStars[usedCount++] = starIndex;

  const survey = playerShips.get(1);
  survey.shipType = ShipType.SURVEY_CRUISER;
  survey.currentStarIndex = starIndex;
  survey.movesThisTurn = 0;

  // Ship 2: Beacon Tender
  do {
    starIndex = randomRange(numStars);
    let valid = true;
    for (let i: i32 = 0; i < usedCount; i++) {
      if (usedStars[i] == starIndex) {
        valid = false;
        break;
      }
    }
    if (valid) break;
  } while (true);

  const beacon = playerShips.get(2);
  beacon.shipType = ShipType.BEACON_TENDER;
  beacon.currentStarIndex = starIndex;
  beacon.movesThisTurn = 0;

  // Initialize shared resources
  setI32(MemLayout.SENSOR_ENERGY, STARTING_SENSOR_ENERGY);
  setI32(MemLayout.COMMAND_POINTS, STARTING_COMMAND_POINTS);
  setI32(MemLayout.DEPLOYMENT_KITS, STARTING_DEPLOYMENT_KITS);
  setI32(MemLayout.ACTIVE_SHIP_INDEX, 0); // Start with interceptor
  setI32(MemLayout.TURN_COUNTER, 0);
  setI32(MemLayout.SCAN_RESULT, -2); // No active scan
  setI32(MemLayout.SCAN_TIMER, 0);

  // Initialize all beacons to inactive
  for (let i: i32 = 0; i < MAX_BEACONS; i++) {
    const beacon = beacons.get(i);
    beacon.isActive = 0;
    beacon.starIndex = 0;
    beacon.isDetecting = 0;
  }

  logi("Fleet deployed - Target at star {}", targetShip.currentStarIndex, 0, 0);
  log("Starmap ready");
}

export function update(): void {
  const state = getU8(MemLayout.GAME_STATE);
  const targetShip = getTargetShip();

  // Restart game on START button if won/lost
  if (state != GameState.PLAYING && buttonPressed(Button.START)) {
    init();
    return;
  }

  // Don't process game logic if not playing
  if (state != GameState.PLAYING) return;

  // Increment turn counter (for animation)
  const turnCounter = getI32(MemLayout.TURN_COUNTER);
  setI32(MemLayout.TURN_COUNTER, turnCounter + 1);

  // Decrement scan timer if active
  const scanTimer = getI32(MemLayout.SCAN_TIMER);
  if (scanTimer > 0) {
    setI32(MemLayout.SCAN_TIMER, scanTimer - 1);
  }

  // Get active ship
  let activeIndex = getI32(MemLayout.ACTIVE_SHIP_INDEX);
  const activeShip = playerShips.get(activeIndex);

  // B button: Switch active ship
  if (buttonPressed(Button.B)) {
    activeIndex = (activeIndex + 1) % MAX_PLAYER_SHIPS;
    setI32(MemLayout.ACTIVE_SHIP_INDEX, activeIndex);
    logi(
      "Switched to {} at star {}",
      activeIndex,
      playerShips.get(activeIndex).currentStarIndex,
    );
    return;
  }

  // A button: Ship-specific actions
  if (buttonPressed(Button.A)) {
    // Beacon Tender: Deploy beacon
    if (activeShip.shipType == ShipType.BEACON_TENDER) {
      const deploymentKits = getI32(MemLayout.DEPLOYMENT_KITS);
      if (deploymentKits > 0) {
        // Check if beacon already exists at this star
        let alreadyDeployed = false;
        for (let i: i32 = 0; i < MAX_BEACONS; i++) {
          const beacon = beacons.get(i);
          if (
            beacon.isActive == 1 &&
            beacon.starIndex == activeShip.currentStarIndex
          ) {
            alreadyDeployed = true;
            break;
          }
        }

        if (alreadyDeployed) {
          log("Beacon already deployed here");
        } else {
          // Find empty beacon slot
          let deployed = false;
          for (let i: i32 = 0; i < MAX_BEACONS; i++) {
            const beacon = beacons.get(i);
            if (beacon.isActive == 0) {
              beacon.starIndex = activeShip.currentStarIndex;
              beacon.isActive = 1;
              beacon.isDetecting = 0;
              setI32(MemLayout.DEPLOYMENT_KITS, deploymentKits - 1);
              logi(
                "Beacon deployed at star {}",
                activeShip.currentStarIndex,
                0,
                0,
              );
              deployed = true;
              break;
            }
          }
          if (!deployed) {
            log("Maximum beacons deployed");
          }
        }
      } else {
        log("No deployment kits available");
      }
      return;
    }

    // Survey Cruiser: Active scan
    if (activeShip.shipType == ShipType.SURVEY_CRUISER) {
      const sensorEnergy = getI32(MemLayout.SENSOR_ENERGY);
      if (sensorEnergy >= SCAN_COST) {
        setI32(MemLayout.SENSOR_ENERGY, sensorEnergy - SCAN_COST);

        // Check if target is within scan radius
        const targetShip = getTargetShip();
        const range2 = SCAN_RADIUS * SCAN_RADIUS;
        const distance2 = starsDist2(
          activeShip.currentStarIndex,
          targetShip.currentStarIndex,
        );

        if (distance2 <= range2) {
          // Store scan result for visual display
          setI32(MemLayout.SCAN_RESULT, targetShip.currentStarIndex);
          setI32(MemLayout.SCAN_TIMER, 180); // Show for 3 seconds (60 fps)
          logi(
            "TARGET DETECTED AT STAR {}!",
            targetShip.currentStarIndex,
            0,
            0,
          );
        } else {
          // No contact
          setI32(MemLayout.SCAN_RESULT, -1);
          setI32(MemLayout.SCAN_TIMER, 120); // Show for 2 seconds
          log("Scan complete - No contact");
        }
      } else {
        log("Insufficient Sensor Energy");
      }
      return;
    }
  }

  // Check win condition (any ship reaches target)
  for (let i: i32 = 0; i < MAX_PLAYER_SHIPS; i++) {
    const ship = playerShips.get(i);
    if (ship.currentStarIndex == targetShip.currentStarIndex) {
      setU8(MemLayout.GAME_STATE, GameState.WON as u8);
      log("Victory! Target intercepted!");
      return;
    }
  }

  // START button: End turn
  if (buttonPressed(Button.START)) {
    // Reset all ships' moves
    for (let i: i32 = 0; i < MAX_PLAYER_SHIPS; i++) {
      const ship = playerShips.get(i);
      ship.movesThisTurn = 0;
    }

    // Regenerate Sensor Energy
    const currentSE = getI32(MemLayout.SENSOR_ENERGY);
    const newSE = currentSE + SE_REGEN_PER_TURN;
    setI32(
      MemLayout.SENSOR_ENERGY,
      newSE > MAX_SENSOR_ENERGY ? MAX_SENSOR_ENERGY : newSE,
    );

    // Refresh Command Points
    setI32(MemLayout.COMMAND_POINTS, MAX_COMMAND_POINTS);

    // Update target AI
    moveTarget();

    // Update beacon detection states
    const targetShip = getTargetShip();
    const range2 = BEACON_RANGE * BEACON_RANGE;
    for (let i: i32 = 0; i < MAX_BEACONS; i++) {
      const beacon = beacons.get(i);
      if (beacon.isActive == 1) {
        const d2 = starsDist2(beacon.starIndex, targetShip.currentStarIndex);
        beacon.isDetecting = d2 <= range2 ? 1 : 0;
      }
    }

    // Check if target was cornered and moved onto a player ship (should never happen with proper scoring)
    for (let i: i32 = 0; i < MAX_PLAYER_SHIPS; i++) {
      const ship = playerShips.get(i);
      if (ship.currentStarIndex == targetShip.currentStarIndex) {
        setU8(MemLayout.GAME_STATE, GameState.WON as u8);
        log("Target cornered! Victory!");
        return;
      }
    }

    log("Turn ended - resources refreshed");
    return;
  }

  // Handle movement input (D-pad for direction selection)
  const moveLimit = getShipMoveLimit(activeShip.shipType);
  if (activeShip.movesThisTurn < moveLimit) {
    let targetStarIndex: i32 = -1;

    if (buttonPressed(Button.UP)) {
      targetStarIndex = findNeighborInDirection(activeShip.currentStarIndex, 0);
    } else if (buttonPressed(Button.RIGHT)) {
      targetStarIndex = findNeighborInDirection(activeShip.currentStarIndex, 1);
    } else if (buttonPressed(Button.DOWN)) {
      targetStarIndex = findNeighborInDirection(activeShip.currentStarIndex, 2);
    } else if (buttonPressed(Button.LEFT)) {
      targetStarIndex = findNeighborInDirection(activeShip.currentStarIndex, 3);
    }

    // Execute jump if valid neighbor found
    if (targetStarIndex >= 0) {
      activeShip.currentStarIndex = targetStarIndex;
      activeShip.movesThisTurn++;
      logi(
        "{} jumped to star {} (Moves: {}/{})",
        activeIndex,
        targetStarIndex,
        activeShip.movesThisTurn,
      );

      // Check win condition after movement
      if (activeShip.currentStarIndex == targetShip.currentStarIndex) {
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
  const turnCounter = getI32(MemLayout.TURN_COUNTER);
  const activeIndex = getI32(MemLayout.ACTIVE_SHIP_INDEX);
  const activeShip = playerShips.get(activeIndex);
  // const numStars = getU8(MemLayout.NUM_STARS);
  // const numEdges = getU16(MemLayout.NUM_EDGES);

  // Draw shared resources (top left)
  const sensorEnergy = getI32(MemLayout.SENSOR_ENERGY);
  const commandPoints = getI32(MemLayout.COMMAND_POINTS);
  const deploymentKits = getI32(MemLayout.DEPLOYMENT_KITS);

  drawString(10, 1, "SE:", c(0xffffff));
  drawNumber(34, 1, sensorEnergy, c(0x00aaff));
  drawString(52, 1, "/", c(0x666666));
  drawNumber(60, 1, MAX_SENSOR_ENERGY, c(0x666666));

  drawString(100, 1, "CP:", c(0xffffff));
  drawNumber(122, 1, commandPoints, c(0x00ff00));

  drawString(160, 1, "DK:", c(0xffffff));
  drawNumber(182, 1, deploymentKits, c(0xffaa00));

  // Count active beacons
  let activeBeacons: i32 = 0;
  for (let i: i32 = 0; i < MAX_BEACONS; i++) {
    if (beacons.get(i).isActive == 1) {
      activeBeacons++;
    }
  }
  drawString(230, 1, "B:", c(0xffffff));
  drawNumber(246, 1, activeBeacons, c(0xffdd00));

  // Draw active ship info (second row)
  const shipTypeName = getShipTypeName(activeShip.shipType);
  drawString(1, 229, shipTypeName, c(0xaaccff));
  drawString(1 + shipTypeName.length * 8, 229, ":", c(0xffffff));

  const moveLimit = getShipMoveLimit(activeShip.shipType);
  const movesRemaining = moveLimit - activeShip.movesThisTurn;

  drawString(100, 229, "MOVES:", c(0xffffff));
  drawNumber(146, 229, movesRemaining, c(0xaaccff));
  drawString(154, 229, "/", c(0x666666));
  drawNumber(162, 229, moveLimit, c(0x666666));

  // Show ship-specific action
  if (state == GameState.PLAYING) {
    if (activeShip.shipType == ShipType.BEACON_TENDER) {
      drawString(200, 229, "A:DEPLOY BEACON", c(0xffaa00));
    } else if (activeShip.shipType == ShipType.SURVEY_CRUISER) {
      drawString(200, 229, "A:SCAN", c(0x00ff00));
      drawString(260, 229, "(", c(0x666666));
      drawNumber(268, 229, SCAN_COST, c(0x666666));
      drawString(276, 229, "SE)", c(0x666666));
    }
  }

  // Draw map info (bottom)
  // drawString(10, 229, "STARS:", c(0xaaaaaa));
  // drawNumber(56, 229, numStars as i32, c(0x666666));

  // drawString(100, 229, "LANES:", c(0xaaaaaa));
  // drawNumber(146, 229, numEdges as i32, c(0x666666));

  // Draw instructions (bottom right)
  // if (state == GameState.PLAYING) {
  //   drawString(180, 220, "B:SWITCH", c(0xaaaaaa));
  //   drawString(180, 229, "START:END", c(0xaaaaaa));
  // }

  // Draw win/lose message
  if (state == GameState.WON) {
    drawString(80, 100, "TARGET INTERCEPTED!", c(0x00ff00));
    drawString(90, 115, "PRESS START", c(0xffffff));
  } else if (state == GameState.LOST) {
    drawString(95, 100, "TARGET ESCAPED", c(0xff0000));
    drawString(90, 115, "PRESS START", c(0xffffff));
  }
}
