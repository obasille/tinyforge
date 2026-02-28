// Starline Pursuit - Random Starmap Generation
// Based on 9B. NewMapGeneration.md specification

import {
  Button,
  buttonPressed,
  c,
  clearFramebuffer,
  drawNumber,
  drawRect,
  drawString,
  fillRect,
  FixedArray,
  log,
  logi,
  pset,
  randomRange,
} from "../sdk";

import { drawStarmap } from "./starlinePursuit/drawStarmap";
import { generateStarmap } from "./starlinePursuit/generateStarmap";
import { moveTarget } from "./starlinePursuit/moveTarget";
import {
  clearStarTrackingByBeacon,
  clearStarTrackingByScan,
  initializeStarTracking,
  updateStarTracking,
} from "./starlinePursuit/starTracking";
import {
  BEACON_RANGE,
  beacons,
  edges,
  GamePhase,
  gameState,
  MAX_COMMAND_POINTS,
  MAX_EDGES,
  MAX_SENSOR_ENERGY,
  playerShips,
  SCAN_COST,
  SCAN_RADIUS,
  SE_REGEN_PER_TURN,
  ShipType,
  stars,
  STARTING_COMMAND_POINTS,
  STARTING_DEPLOYMENT_KITS,
  STARTING_SENSOR_ENERGY,
  targetShip,
  TargetType,
  TEMP_MEM_START,
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
 * Get target type name for briefing
 */
function getTargetTypeName(targetType: u8): string {
  if (targetType == TargetType.SMUGGLER) return "SMUGGLER RUNNER";
  if (targetType == TargetType.PIRATE) return "PIRATE RAIDER";
  if (targetType == TargetType.GHOST) return "GHOST PROBE";
  if (targetType == TargetType.COURIER) return "DIPLOMATIC COURIER";
  if (targetType == TargetType.DECOY_MASTER) return "DECOY MASTER";
  if (targetType == TargetType.REBEL_COMMANDER) return "REBEL COMMANDER";
  if (targetType == TargetType.SLEEPER_AGENT) return "SLEEPER AGENT";
  return "UNKNOWN";
}

/**
 * Check if any ship has reached the target
 * Returns true if Interceptor captured target (game won)
 * Logs detection if non-Interceptor found target
 */
function checkShipsAtTarget(): bool {
  for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
    const ship = playerShips.get(i);
    if (ship.currentStarIndex == targetShip.currentStarIndex) {
      if (ship.shipType == ShipType.INTERCEPTOR) {
        gameState.phase = GamePhase.WON as u8;
        log("Victory! Interceptor captured target!");
        return true;
      } else {
        // Non-Interceptor detection
        log("TARGET DETECTED! Send Interceptor to capture!");
        initializeStarTracking(targetShip.currentStarIndex);
      }
    }
  }
  return false;
}

/**
 * Find the neighbor star visually closest to a given direction
 * direction: 0=UP, 1=RIGHT, 2=DOWN, 3=LEFT
 */
function findNeighborInDirection(starIndex: i32, direction: i32): i32 {
  const currentStar = stars.get(starIndex);
  const numEdges = edges.length as i32;

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

/**
 * Draw the mission briefing overlay
 */
function drawMissionBriefing(): void {
  // Semi-transparent background
  fillRect(20, 60, 280, 134, c(0x0a0a1a));
  drawRect(20, 60, 280, 134, c(0x00aaff));
  drawRect(21, 61, 278, 132, c(0x00aaff));

  // Title
  drawString(90, 70, "MISSION BRIEFING", c(0x00aaff));

  // Target type
  const targetTypeName = getTargetTypeName(gameState.targetType);
  drawString(50, 90, "TARGET:", c(0xffffff));
  drawString(114, 90, targetTypeName, c(0xffaa00));

  // Target behavior description
  const targetType = gameState.targetType;
  if (targetType == TargetType.SMUGGLER) {
    drawString(30, 110, "LOW SENSOR VISIBILITY", c(0xaaaaaa));
    drawString(30, 125, "AVOIDS BEACON COVERAGE", c(0xaaaaaa));
  } else if (targetType == TargetType.PIRATE) {
    drawString(30, 110, "TARGETS TRADE HUBS", c(0xaaaaaa));
    drawString(30, 125, "SEMI-AGGRESSIVE PATTERN", c(0xaaaaaa));
  } else if (targetType == TargetType.GHOST) {
    drawString(30, 110, "STEALTH-HEAVY", c(0xaaaaaa));
    drawString(30, 125, "HIGHLY UNPREDICTABLE", c(0xaaaaaa));
  } else if (targetType == TargetType.COURIER) {
    drawString(30, 110, "HIGH SPEED - DIRECT ROUTES", c(0xaaaaaa));
    drawString(30, 125, "20PCT CHANCE DOUBLE JUMP", c(0xaaaaaa));
  } else if (targetType == TargetType.DECOY_MASTER) {
    drawString(30, 110, "CREATES FALSE TRAILS", c(0xaaaaaa));
    drawString(30, 125, "MISINFORMATION TACTICS", c(0xaaaaaa));
  } else if (targetType == TargetType.REBEL_COMMANDER) {
    drawString(30, 110, "STRATEGIC AND ADAPTIVE", c(0xaaaaaa));
    drawString(30, 125, "ADVANCED OPPONENT", c(0xaaaaaa));
  } else if (targetType == TargetType.SLEEPER_AGENT) {
    drawString(30, 110, "DELAYED REVEAL", c(0xaaaaaa));
    drawString(30, 125, "HIDDEN BEHAVIOR PATTERN", c(0xaaaaaa));
  }

  // Objective
  drawString(30, 145, "OBJECTIVE: CORNER AND", c(0x00ff00));
  drawString(30, 160, "CAPTURE WITH INTERCEPTOR", c(0x00ff00));

  // Instruction
  drawString(105, 178, "PRESS START", c(0xffffff));
}

// === Lifecycle Functions ===

export function init(): void {
  log("Starline Pursuit: Initializing fleet");

  // Set initial game state
  gameState.phase = GamePhase.PLAYING as u8;

  // Generate the starmap
  generateStarmap();

  const numStars = stars.length as i32;

  // Initialize target ship at a random star position
  targetShip.currentStarIndex = randomRange(numStars);
  targetShip.isActive = 1;

  // Initialize player fleet (3 ships at random different positions)
  // Use temporary memory for tracking used stars during initialization
  const usedStars = FixedArray.fromAddress<i32>(TEMP_MEM_START);
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

  const interceptor = playerShips.grow();
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

  const survey = playerShips.grow();
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

  const beacon = playerShips.grow();
  beacon.shipType = ShipType.BEACON_TENDER;
  beacon.currentStarIndex = starIndex;
  beacon.movesThisTurn = 0;

  // Initialize shared resources
  gameState.sensorEnergy = STARTING_SENSOR_ENERGY;
  gameState.commandPoints = STARTING_COMMAND_POINTS;
  gameState.deploymentKits = STARTING_DEPLOYMENT_KITS;
  gameState.activeShipIndex = 0; // Start with interceptor
  gameState.frameCounter = 0;
  gameState.scanResult = -2; // No active scan
  gameState.scanTimer = 0;
  gameState.initialRevealTimer = 0; // Don't start reveal yet - wait for briefing dismissal
  gameState.scannerY = -1; // Scanner inactive
  gameState.scannerPhase = 0;
  gameState.turnNumber = 1; // Initialize turn counter

  // Select random target type (0-4 for now, excluding advanced types)
  gameState.targetType = randomRange(5) as u8; // SMUGGLER, PIRATE, GHOST, COURIER, DECOY_MASTER
  // TODO: Add REBEL_COMMANDER (5) and SLEEPER_AGENT (6) when their behaviors are fully implemented
  gameState.missionBriefingDismissed = 0; // Show briefing, wait for START press

  // Initialize star tracking with target's starting position
  initializeStarTracking(targetShip.currentStarIndex);

  // Clear tracking for player-occupied stars (we know target isn't there)
  for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
    stars.get(playerShips.get(i).currentStarIndex).isPossibleTarget = 0;
  }

  // Initialize all beacons to inactive
  for (let i = beacons.capacity; i > 0; i--) {
    const beacon = beacons.grow();
    beacon.isActive = 0;
    beacon.starIndex = 0;
    beacon.isDetecting = 0;
  }

  log("Starmap ready");
}

export function update(): void {
  const state = gameState.phase;

  // Restart game on START button if won/lost
  if (state != GamePhase.PLAYING && buttonPressed(Button.START)) {
    init();
    return;
  }

  // Don't process game logic if not playing
  if (state != GamePhase.PLAYING) return;

  // Handle mission briefing dismissal
  if (gameState.missionBriefingDismissed == 0) {
    // Briefing is still visible, wait for START press to dismiss
    if (buttonPressed(Button.START)) {
      gameState.missionBriefingDismissed = 1;
      gameState.initialRevealTimer = 180; // Start reveal animation (3 seconds)
      log("Mission briefing acknowledged");
    }
    // Don't process game logic while briefing is visible
    return;
  }

  // Increment frame counter (for animation)
  gameState.frameCounter++;

  // Decrement scan timer if active
  if (gameState.scanTimer > 0) {
    gameState.scanTimer--;
  }

  // Decrement initial reveal timer if active
  if (gameState.initialRevealTimer > 0) {
    gameState.initialRevealTimer--;
  }

  // Decrement beacon range animation timers
  for (let i = 0; i < (beacons.length as i32); i++) {
    const beacon = beacons.get(i);
    if (beacon.isActive == 1 && beacon.rangeAnimTimer > 0) {
      beacon.rangeAnimTimer--;
    }
  }

  // Update scanner animation (runs independently)
  if (gameState.scannerY >= 0) {
    if (gameState.scannerPhase == 0) {
      // Sweep down
      gameState.scannerY += 8; // Fast sweep
      if (gameState.scannerY >= 220) {
        gameState.scannerPhase = 1; // Switch to sweep up
      }
    } else if (gameState.scannerPhase == 1) {
      // Sweep up
      gameState.scannerY -= 8;
      if (gameState.scannerY <= 10) {
        gameState.scannerPhase = 2; // Done
        gameState.scannerY = -1; // Deactivate

        // Scanner complete - trigger pending beacon animations
        for (let i = 0; i < (beacons.length as i32); i++) {
          const beacon = beacons.get(i);
          if (beacon.isActive == 1 && beacon.pendingRangeAnim == 1) {
            beacon.rangeAnimTimer = 60;
            beacon.pendingRangeAnim = 0;
          }
        }
      }
    }
  }

  // Get active ship
  let activeIndex = gameState.activeShipIndex;
  const activeShip = playerShips.get(activeIndex);

  // B button: Switch active ship
  if (buttonPressed(Button.B)) {
    activeIndex = (activeIndex + 1) % (playerShips.length as i32);
    gameState.activeShipIndex = activeIndex;
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
      if (gameState.deploymentKits > 0) {
        // Check if beacon already exists at this star
        let alreadyDeployed = false;
        for (let i = 0; i < (beacons.length as i32); i++) {
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
          for (let i = 0; i < (beacons.length as i32); i++) {
            const beacon = beacons.get(i);
            if (beacon.isActive == 0) {
              beacon.starIndex = activeShip.currentStarIndex;
              beacon.isActive = 1;

              // Check if target is within detection range
              const range2 = BEACON_RANGE * BEACON_RANGE;
              const d2 = starsDist2(
                beacon.starIndex,
                targetShip.currentStarIndex,
              );
              beacon.isDetecting = d2 <= range2 ? 1 : 0;

              // If not detecting, clear star tracking within beacon range
              if (beacon.isDetecting == 0) {
                clearStarTrackingByBeacon(beacon.starIndex, BEACON_RANGE);
              }

              // Mark for range animation (will start after scanner completes)
              beacon.pendingRangeAnim = 1;

              gameState.deploymentKits--;
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
      if (gameState.sensorEnergy >= SCAN_COST) {
        gameState.sensorEnergy -= SCAN_COST;

        // Check if target is within scan radius
        const range2 = SCAN_RADIUS * SCAN_RADIUS;
        const distance2 = starsDist2(
          activeShip.currentStarIndex,
          targetShip.currentStarIndex,
        );

        if (distance2 <= range2) {
          // Store scan result for visual display
          gameState.scanResult = targetShip.currentStarIndex;
          gameState.scanTimer = 180; // Show for 3 seconds (60 fps)
          // Lock tracking to known target location after positive scan
          initializeStarTracking(targetShip.currentStarIndex);
          logi("TARGET DETECTED by scan");
        } else {
          // No contact - clear stars within scan radius from tracking
          gameState.scanResult = -1;
          gameState.scanTimer = 120; // Show for 2 seconds
          clearStarTrackingByScan(activeShip.currentStarIndex, SCAN_RADIUS);
          log("Scan complete - No contact");
        }
      } else {
        log("Insufficient Sensor Energy");
      }
      return;
    }
  }

  // START button: End turn
  if (buttonPressed(Button.START)) {
    // Reset all ships' moves
    for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
      const ship = playerShips.get(i);
      ship.movesThisTurn = 0;
    }

    // Regenerate Sensor Energy
    const newSE = gameState.sensorEnergy + SE_REGEN_PER_TURN;
    gameState.sensorEnergy =
      newSE > MAX_SENSOR_ENERGY ? MAX_SENSOR_ENERGY : newSE;

    // Refresh Command Points
    gameState.commandPoints = MAX_COMMAND_POINTS;

    // Start scanner animation
    gameState.scannerY = 10; // Start at top of map area
    gameState.scannerPhase = 0; // Begin sweep down

    // Update target AI
    moveTarget();

    // Update star tracking based on possible target movements
    updateStarTracking();

    // Update beacon detection states
    const range2 = BEACON_RANGE * BEACON_RANGE;
    for (let i = 0; i < (beacons.length as i32); i++) {
      const beacon = beacons.get(i);
      if (beacon.isActive == 1) {
        const d2 = starsDist2(beacon.starIndex, targetShip.currentStarIndex);
        beacon.isDetecting = d2 <= range2 ? 1 : 0;

        // If beacon is not detecting, clear star tracking within its range
        // (we know target isn't there)
        if (beacon.isDetecting == 0) {
          clearStarTrackingByBeacon(beacon.starIndex, BEACON_RANGE);
        }

        // Mark for range animation (will start after scanner completes)
        beacon.pendingRangeAnim = 1;
      }
    }

    // Check if target moved onto any ship
    if (checkShipsAtTarget()) {
      return; // Game won
    }

    // Increment turn counter
    gameState.turnNumber++;

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
        "{} jumped to star {} (Moves: {})",
        activeIndex,
        targetStarIndex,
        activeShip.movesThisTurn,
      );

      // Check if ship reached target
      if (checkShipsAtTarget()) {
        return; // Game won or target detected
      }

      // If target not found at this star, mark it as impossible location
      stars.get(targetStarIndex).isPossibleTarget = 0;
    }
  }
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a1a)); // Dark blue-black space background

  // Draw the starmap
  drawStarmap();

  // Draw vertical scanner sweep OVER the starmap
  if (gameState.scannerY >= 0) {
    const scanY = gameState.scannerY;

    // Main scan line (bright green)
    for (let x: i32 = 10; x < 310; x++) {
      pset(x, scanY, c(0x00ff00));
      pset(x, scanY + 1, c(0x00ff00));
    }

    // Trailing fade lines (dimmer green)
    for (let offset: i32 = 2; offset < 8; offset++) {
      const alpha = (8 - offset) * 32; // Fade from 192 to 32
      const fadeColor = c(0x00ff00) | (alpha << 24);

      if (gameState.scannerPhase == 0) {
        // Sweeping down - trail above
        const trailY = scanY - offset;
        if (trailY >= 10) {
          for (let x: i32 = 10; x < 310; x++) {
            pset(x, trailY, fadeColor);
          }
        }
      } else {
        // Sweeping up - trail below
        const trailY = scanY + offset;
        if (trailY < 220) {
          for (let x: i32 = 10; x < 310; x++) {
            pset(x, trailY, fadeColor);
          }
        }
      }
    }
  }

  const state = gameState.phase;
  const activeIndex = gameState.activeShipIndex;
  const activeShip = playerShips.get(activeIndex);

  // Draw shared resources (top left)
  const sensorEnergy = gameState.sensorEnergy;
  const commandPoints = gameState.commandPoints;
  const deploymentKits = gameState.deploymentKits;

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
  for (let i = 0; i < (beacons.length as i32); i++) {
    if (beacons.get(i).isActive == 1) {
      activeBeacons++;
    }
  }
  drawString(230, 1, "B:", c(0xffffff));
  drawNumber(246, 1, activeBeacons, c(0xffdd00));

  // Draw turn counter (top right corner)
  drawString(265, 1, "T:", c(0xffffff));
  drawNumber(281, 1, gameState.turnNumber, c(0xaaccff));

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
  if (state == GamePhase.PLAYING) {
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

  // Draw mission briefing if not dismissed
  if (gameState.missionBriefingDismissed == 0 && state == GamePhase.PLAYING) {
    drawMissionBriefing();
  }

  // Draw win/lose message
  if (state == GamePhase.WON) {
    drawString(80, 100, "TARGET INTERCEPTED!", c(0x00ff00));
    drawString(90, 115, "PRESS START", c(0xffffff));
  } else if (state == GamePhase.LOST) {
    drawString(95, 100, "TARGET ESCAPED", c(0xff0000));
    drawString(90, 115, "PRESS START", c(0xffffff));
  }
}
