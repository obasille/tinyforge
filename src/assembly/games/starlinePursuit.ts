// Starline Pursuit - Random Starmap Generation
// Based on 9B. NewMapGeneration.md specification

import {
  Button,
  buttonPressed,
  clearFramebuffer,
  drawRect,
  fillRect,
  log,
  logi,
  print,
  printNumber,
  pset,
  randomRange,
  UncheckedArrayView,
} from "../sdk";

import { withAlpha } from "../sdk/color";
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
  clusters,
  Colors,
  edges,
  GamePhase,
  gameState,
  MAX_COMMAND_POINTS,
  MAX_EDGES,
  MAX_SENSOR_ENERGY,
  MAP_HEIGHT,
  MAP_OFFSET_Y,
  MAP_WIDTH,
  nebulas,
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

const MIN_BASE_EXIT_JUMPS: i32 = 4;
const ACTION_CP_COST: i32 = 1;

// === Helper Functions ===

/**
 * Get the maximum moves per turn for a ship type
 */
function getShipMoveLimit(shipType: i32): i32 {
  if (shipType == ShipType.INTERCEPTOR) return 3;
  if (shipType == ShipType.SCOUT) return 2;
  if (shipType == ShipType.SURVEY_CRUISER) return 1;
  return 1;
}

/**
 * Get ship type name for display
 */
function getShipTypeName(shipType: i32): string {
  if (shipType == ShipType.INTERCEPTOR) return "INTERCEPTOR";
  if (shipType == ShipType.SCOUT) return "SCOUT";
  if (shipType == ShipType.SURVEY_CRUISER) return "DEEP SCAN";
  return "UNKNOWN";
}

function areStarsConnected(starA: i32, starB: i32): bool {
  const numEdges = edges.length as i32;
  for (let i: i32 = 0; i < numEdges; i++) {
    const edge = edges.get(i);
    if (
      (edge.a == starA && edge.b == starB) ||
      (edge.a == starB && edge.b == starA)
    ) {
      return true;
    }
  }
  return false;
}

function getJumpDistance(startStar: i32, endStar: i32): i32 {
  if (startStar == endStar) return 0;

  const numStars = stars.length as i32;
  const visited = UncheckedArrayView.fromAddress<i32>(TEMP_MEM_START);
  const queue = UncheckedArrayView.fromAddress<i32>(TEMP_MEM_START + 256);
  const depth = UncheckedArrayView.fromAddress<i32>(TEMP_MEM_START + 512);

  for (let i: i32 = 0; i < numStars; i++) {
    visited[i] = 0;
  }

  let head: i32 = 0;
  let tail: i32 = 0;
  queue[tail] = startStar;
  depth[tail] = 0;
  tail++;
  visited[startStar] = 1;

  while (head < tail) {
    const current = queue[head];
    const currentDepth = depth[head];
    head++;

    if (current == endStar) {
      return currentDepth;
    }

    for (let n: i32 = 0; n < numStars; n++) {
      if (visited[n] == 0 && areStarsConnected(current, n)) {
        visited[n] = 1;
        queue[tail] = n;
        depth[tail] = currentDepth + 1;
        tail++;
      }
    }
  }

  return 9999;
}

function getMinJumpsToAnyExit(starIndex: i32): i32 {
  const numStars = stars.length as i32;
  let minJumps: i32 = 9999;

  for (let i: i32 = 0; i < numStars; i++) {
    if (stars.get(i).isExit != 0) {
      const jumps = getJumpDistance(starIndex, i);
      if (jumps < minJumps) {
        minJumps = jumps;
      }
    }
  }

  return minJumps;
}

function pickCommandBaseStar(): i32 {
  const numStars = stars.length as i32;
  const centerX = MAP_WIDTH / 2;
  const centerY = MAP_OFFSET_Y + MAP_HEIGHT / 2;

  let bestIndex: i32 = -1;
  let bestScore: i32 = -999999;

  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);
    if (star.isExit != 0 || star.inNebula != 0) continue;

    const minExitJumps = getMinJumpsToAnyExit(i);
    if (minExitJumps < MIN_BASE_EXIT_JUMPS) continue;

    const dx = star.x - centerX;
    const dy = star.y - centerY;
    const manhattan = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);

    const score = 1200 - manhattan * 5 + star.degree * 12 + randomRange(7);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0) return bestIndex;

  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);
    if (star.isExit == 0 && star.inNebula == 0) {
      return i;
    }
  }

  return 0;
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
  fillRect(20, 60, 280, 134, Colors.BriefingBox);
  drawRect(20, 60, 280, 134, Colors.BriefingBorder);
  drawRect(21, 61, 278, 132, Colors.BriefingBorder);

  // Title
  print(90, 70, "MISSION BRIEFING", Colors.BriefingTitle);

  // Target type
  const targetTypeName = getTargetTypeName(gameState.targetType);
  print(50, 90, "TARGET:", Colors.TextWhite);
  print(106, 90, targetTypeName, Colors.TextYellow);

  // Target behavior description
  const targetType = gameState.targetType;
  if (targetType == TargetType.SMUGGLER) {
    print(30, 110, "LOW SENSOR VISIBILITY", Colors.TextGray);
    print(30, 125, "AVOIDS BEACON COVERAGE", Colors.TextGray);
  } else if (targetType == TargetType.PIRATE) {
    print(30, 110, "TARGETS TRADE HUBS", Colors.TextGray);
    print(30, 125, "SEMI-AGGRESSIVE PATTERN", Colors.TextGray);
  } else if (targetType == TargetType.GHOST) {
    print(30, 110, "STEALTH-HEAVY", Colors.TextGray);
    print(30, 125, "HIGHLY UNPREDICTABLE", Colors.TextGray);
  } else if (targetType == TargetType.COURIER) {
    print(30, 110, "HIGH SPEED - DIRECT ROUTES", Colors.TextGray);
    print(30, 125, "20PCT CHANCE DOUBLE JUMP", Colors.TextGray);
  } else if (targetType == TargetType.DECOY_MASTER) {
    print(30, 110, "CREATES FALSE TRAILS", Colors.TextGray);
    print(30, 125, "MISINFORMATION TACTICS", Colors.TextGray);
  } else if (targetType == TargetType.REBEL_COMMANDER) {
    print(30, 110, "STRATEGIC AND ADAPTIVE", Colors.TextGray);
    print(30, 125, "ADVANCED OPPONENT", Colors.TextGray);
  } else if (targetType == TargetType.SLEEPER_AGENT) {
    print(30, 110, "DELAYED REVEAL", Colors.TextGray);
    print(30, 125, "HIDDEN BEHAVIOR PATTERN", Colors.TextGray);
  }

  // Objective
  print(30, 145, "OBJECTIVE: CORNER AND", Colors.ObjectiveGreen);
  print(30, 160, "CAPTURE WITH INTERCEPTOR", Colors.ObjectiveGreen);

  // Instruction
  print(105, 178, "PRESS START", Colors.TextWhite);
}

// === Lifecycle Functions ===

export function init(): void {
  log("Starline Pursuit: Initializing fleet");

  // Set initial game state
  gameState.phase = GamePhase.PLAYING as u8;

  // Reset all arrays
  stars.length = 0;
  edges.length = 0;
  clusters.length = 0;
  nebulas.length = 0;
  playerShips.length = 0;
  beacons.length = 0;

  // Generate the starmap
  generateStarmap();

  const numStars = stars.length as i32;

  // Pick command base near center and away from exits/nebulas
  const commandBase = pickCommandBaseStar();
  gameState.commandBaseStarIndex = commandBase;

  // Initialize target ship at the command base (same system as player)
  targetShip.currentStarIndex = commandBase;
  targetShip.isActive = 1;

  // Initialize player fleet at command base (docked, not launched)
  const scoutA = playerShips.grow();
  scoutA.shipType = ShipType.SCOUT;
  scoutA.currentStarIndex = commandBase;
  scoutA.movesThisTurn = 0;
  scoutA.isLaunched = 0;
  scoutA.launchTurn = 0;

  const scoutB = playerShips.grow();
  scoutB.shipType = ShipType.SCOUT;
  scoutB.currentStarIndex = commandBase;
  scoutB.movesThisTurn = 0;
  scoutB.isLaunched = 0;
  scoutB.launchTurn = 0;

  const interceptor = playerShips.grow();
  interceptor.shipType = ShipType.INTERCEPTOR;
  interceptor.currentStarIndex = commandBase;
  interceptor.movesThisTurn = 0;
  interceptor.isLaunched = 0;
  interceptor.launchTurn = 0;

  const scanner = playerShips.grow();
  scanner.shipType = ShipType.SURVEY_CRUISER;
  scanner.currentStarIndex = commandBase;
  scanner.movesThisTurn = 0;
  scanner.isLaunched = 0;
  scanner.launchTurn = 0;

  // Initialize shared resources
  gameState.sensorEnergy = STARTING_SENSOR_ENERGY;
  gameState.commandPoints = STARTING_COMMAND_POINTS;
  gameState.deploymentKits = STARTING_DEPLOYMENT_KITS;
  gameState.activeShipIndex = 0; // Start with first scout
  gameState.frameCounter = 0;
  gameState.scanResult = -2; // No active scan
  gameState.scanTimer = 0;
  gameState.initialRevealTimer = 0;
  gameState.scannerY = -1; // Scanner inactive
  gameState.scannerPhase = 0;
  gameState.turnNumber = 1; // Initialize turn counter

  // Select random target type (0-4 for now, excluding advanced types)
  gameState.targetType = randomRange(5) as u8; // SMUGGLER, PIRATE, GHOST, COURIER, DECOY_MASTER
  // TODO: Add REBEL_COMMANDER (5) and SLEEPER_AGENT (6) when their behaviors are fully implemented
  gameState.missionBriefingDismissed = 0; // Show briefing, wait for START press

  // Initialize star tracking from the known start system, then propagate through hidden head-start moves
  initializeStarTracking(commandBase);

  // Hidden head start: target moves 2-3 turns before player acts
  const hiddenHeadStartTurns = 2 + randomRange(2);
  for (let i: i32 = 0; i < hiddenHeadStartTurns; i++) {
    moveTarget();
    updateStarTracking();
  }

  // Initialize all beacons to inactive
  for (let i = beacons.capacity; i > 0; i--) {
    const beacon = beacons.grow();
    beacon.isActive = 0;
    beacon.starIndex = 0;
    beacon.isDetecting = 0;
  }
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
    // Launch docked ships (consumes a turn-equivalent action)
    if (activeShip.isLaunched == 0) {
      if (gameState.commandPoints < ACTION_CP_COST) {
        log("Insufficient Command Points");
        return;
      }

      activeShip.isLaunched = 1;
      activeShip.launchTurn = gameState.turnNumber;
      activeShip.movesThisTurn = getShipMoveLimit(activeShip.shipType);
      gameState.commandPoints -= ACTION_CP_COST;
      logi(
        "Ship launched from base at star {}",
        activeShip.currentStarIndex,
        0,
        0,
      );
      return;
    }

    if (
      activeShip.launchTurn == gameState.turnNumber ||
      activeShip.movesThisTurn > 0
    ) {
      log("Ship already committed this turn");
      return;
    }

    // Scouts and Interceptor can deploy beacons (buoys)
    if (
      activeShip.shipType == ShipType.SCOUT ||
      activeShip.shipType == ShipType.INTERCEPTOR
    ) {
      if (gameState.commandPoints < ACTION_CP_COST) {
        log("Insufficient Command Points");
        return;
      }

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
              gameState.commandPoints -= ACTION_CP_COST;
              activeShip.movesThisTurn = getShipMoveLimit(activeShip.shipType);
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
      if (gameState.commandPoints < ACTION_CP_COST) {
        log("Insufficient Command Points");
        return;
      }

      if (gameState.sensorEnergy >= SCAN_COST) {
        gameState.commandPoints -= ACTION_CP_COST;
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
          activeShip.movesThisTurn = getShipMoveLimit(activeShip.shipType);
          logi("TARGET DETECTED by scan");
        } else {
          // No contact - clear stars within scan radius from tracking
          gameState.scanResult = -1;
          gameState.scanTimer = 120; // Show for 2 seconds
          clearStarTrackingByScan(activeShip.currentStarIndex, SCAN_RADIUS);
          activeShip.movesThisTurn = getShipMoveLimit(activeShip.shipType);
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
  if (
    activeShip.isLaunched == 1 &&
    activeShip.launchTurn < gameState.turnNumber &&
    activeShip.movesThisTurn < moveLimit
  ) {
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
  clearFramebuffer(Colors.Background); // Dark blue-black space background

  // Draw the starmap
  drawStarmap();

  // Draw vertical scanner sweep OVER the starmap
  if (gameState.scannerY >= 0) {
    const scanY = gameState.scannerY;

    // Main scan line (bright green)
    for (let x: i32 = 10; x < 310; x++) {
      pset(x, scanY, Colors.ScannerGreen);
      pset(x, scanY + 1, Colors.ScannerGreen);
    }

    // Trailing fade lines (dimmer green)
    for (let offset: i32 = 2; offset < 8; offset++) {
      const alpha = (8 - offset) * 32; // Fade from 192 to 32
      const fadeColor = withAlpha(Colors.ScannerFade, alpha as u8);

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

  print(10, 1, "SE:", Colors.TextWhite);
  printNumber(28, 1, sensorEnergy, Colors.BriefingBorder);
  print(46, 1, "/", Colors.TextDarkGray);
  printNumber(52, 1, MAX_SENSOR_ENERGY, Colors.TextDarkGray);

  print(85, 1, "CP:", Colors.TextWhite);
  printNumber(103, 1, commandPoints, Colors.ObjectiveGreen);

  print(135, 1, "DK:", Colors.TextWhite);
  printNumber(153, 1, deploymentKits, Colors.TextYellow);

  // Count active beacons
  let activeBeacons: i32 = 0;
  for (let i = 0; i < (beacons.length as i32); i++) {
    if (beacons.get(i).isActive == 1) {
      activeBeacons++;
    }
  }
  print(205, 1, "B:", Colors.TextWhite);
  printNumber(217, 1, activeBeacons, Colors.BeaconYellow);

  // Draw turn counter (top right corner)
  print(245, 1, "T:", Colors.TextWhite);
  printNumber(257, 1, gameState.turnNumber, Colors.TextBlue);

  // Draw active ship info (second row)
  const shipTypeName = getShipTypeName(activeShip.shipType);
  print(1, 229, shipTypeName, Colors.TextBlue);
  print(1 + shipTypeName.length * 6, 229, ":", Colors.TextWhite);

  const moveLimit = getShipMoveLimit(activeShip.shipType);
  let movesRemaining = moveLimit - activeShip.movesThisTurn;
  if (
    activeShip.isLaunched == 0 ||
    activeShip.launchTurn == gameState.turnNumber
  ) {
    movesRemaining = 0;
  }

  print(85, 229, "MOVES:", Colors.TextWhite);
  printNumber(121, 229, movesRemaining, Colors.TextBlue);
  print(129, 229, "/", Colors.TextDarkGray);
  printNumber(135, 229, moveLimit, Colors.TextDarkGray);

  // Show ship-specific action
  if (state == GamePhase.PLAYING) {
    if (activeShip.isLaunched == 0) {
      print(170, 229, "A:LAUNCH (1CP)", Colors.TextYellow);
    } else if (
      activeShip.shipType == ShipType.SCOUT ||
      activeShip.shipType == ShipType.INTERCEPTOR
    ) {
      print(170, 229, "A:DEPLOY BUOY", Colors.TextYellow);
    } else if (activeShip.shipType == ShipType.SURVEY_CRUISER) {
      print(170, 229, "A:DEEP SCAN", Colors.ObjectiveGreen);
      print(236, 229, "(", Colors.TextDarkGray);
      printNumber(242, 229, SCAN_COST, Colors.TextDarkGray);
      print(250, 229, "SE)", Colors.TextDarkGray);
    }
  }

  // Draw map info (bottom)
  // print(10, 229, "STARS:", c(0xaaaaaa));
  // printNumber(46, 229, numStars as i32, c(0x666666));

  // print(85, 229, "LANES:", c(0xaaaaaa));
  // printNumber(146, 229, numEdges as i32, c(0x666666));

  // Draw instructions (bottom right)
  // if (state == GameState.PLAYING) {
  //   print(155, 220, "B:SWITCH", c(0xaaaaaa));
  //   print(155, 229, "START:END", c(0xaaaaaa));
  // }

  // Draw mission briefing if not dismissed
  if (gameState.missionBriefingDismissed == 0 && state == GamePhase.PLAYING) {
    drawMissionBriefing();
  }

  // Draw win/lose message
  if (state == GamePhase.WON) {
    print(82, 100, "TARGET INTERCEPTED!", Colors.ObjectiveGreen);
    print(99, 115, "PRESS START", Colors.TextWhite);
  } else if (state == GamePhase.LOST) {
    print(91, 100, "TARGET ESCAPED", Colors.TargetRed);
    print(99, 115, "PRESS START", Colors.TextWhite);
  }
}
