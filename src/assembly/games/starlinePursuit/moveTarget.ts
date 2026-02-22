import { RAM_START, log, logi, randomRange } from "../../sdk";
import { FixedArray } from "../../sdk/arrays";
import {
  BEACON_RANGE,
  MAX_BEACONS,
  MAX_PLAYER_SHIPS,
  MemLayout,
  beacons,
  edges,
  gameState,
  targetShip,
  playerShips,
  stars,
} from "./types";
import { starsDist2 } from "./utils";

/**
 * Check if a star is within detection range of any active beacon
 */
function isStarDetected(starIndex: i32): bool {
  const range2 = BEACON_RANGE * BEACON_RANGE;
  for (let i: i32 = 0; i < MAX_BEACONS; i++) {
    const beacon = beacons.get(i);
    if (beacon.isActive == 1) {
      if (starsDist2(beacon.starIndex, starIndex) <= range2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get all neighboring stars connected to a given star
 * Stores neighbor indices in provided array, returns count
 */
function getAllNeighbors(starIndex: i32, neighbors: FixedArray<i32>): i32 {
  const numEdges = gameState.numEdges as i32;
  let count: i32 = 0;

  for (let i: i32 = 0; i < numEdges; i++) {
    const edge = edges.get(i);
    let neighborIndex: i32 = -1;

    if (edge.a == starIndex) {
      neighborIndex = edge.b;
    } else if (edge.b == starIndex) {
      neighborIndex = edge.a;
    }

    if (neighborIndex >= 0 && count < 10) {
      neighbors[count] = neighborIndex;
      count++;
    }
  }

  return count;
}

/**
 * Get squared distance to the closest player ship from a given star
 */
function getClosestPlayerDistance(starIndex: i32): i32 {
  let minDist2: i32 = 999999;

  for (let i: i32 = 0; i < MAX_PLAYER_SHIPS; i++) {
    const ship = playerShips.get(i);
    const d2 = starsDist2(starIndex, ship.currentStarIndex);
    if (d2 < minDist2) {
      minDist2 = d2;
    }
  }

  return minDist2;
}

/**
 * Score a neighbor star for target AI decision making
 * Higher scores are preferred
 */
function scoreNeighbor(neighborIndex: i32, currentDistance: i32): f32 {
  // CRITICAL: Never move to a star occupied by a player ship
  for (let i: i32 = 0; i < MAX_PLAYER_SHIPS; i++) {
    const ship = playerShips.get(i);
    if (ship.currentStarIndex == neighborIndex) {
      return -999999.0; // Instant reject
    }
  }

  let score: f32 = 0.0;

  // Factor A: Distance from player (primary motivation: flee)
  const neighborDistance = getClosestPlayerDistance(neighborIndex);
  if (neighborDistance > currentDistance) {
    // Moving away from player: strong bonus
    score += 100.0;
  } else if (neighborDistance < currentDistance) {
    // Moving closer to player: heavy penalty
    score -= 200.0;
  }
  // Same distance: neutral (score += 0)

  // Factor B: Detection risk (avoid beacon zones)
  if (isStarDetected(neighborIndex)) {
    score -= 80.0; // Strong penalty for watched space
  }

  // Factor C: Route freedom (prefer hubs with many exits)
  const neighbor = stars.get(neighborIndex);
  if (neighbor.isHub != 0) {
    score += 30.0; // Hubs provide escape options
  } else if (neighbor.degree <= 1) {
    score -= 40.0; // Dead ends are dangerous
  }

  // Factor F: Unpredictability noise (avoid determinism)
  const noise = (randomRange(20) as f32) - 10.0; // Random [-10, +10]
  score += noise;

  return score;
}

/**
 * Target AI: Choose and execute next move
 * Called at the end of each turn
 */
export function moveTarget(): void {
  const currentStar = targetShip.currentStarIndex;

  // Use temp memory for neighbor list
  const neighbors = FixedArray.fromAddress<i32>(
    RAM_START + MemLayout.TEMP_WORK,
  );
  const neighborCount = getAllNeighbors(currentStar, neighbors);

  if (neighborCount == 0) {
    // No neighbors - target is trapped (shouldn't happen with proper map)
    log("WARNING: Target has no escape routes");
    return;
  }

  // Calculate current distance to player for comparison
  const currentDistance = getClosestPlayerDistance(currentStar);

  // Score all neighbors
  let bestScore: f32 = -999999.0;
  let bestNeighbor: i32 = -1;

  for (let i: i32 = 0; i < neighborCount; i++) {
    const neighborIndex = neighbors[i];
    const score = scoreNeighbor(neighborIndex, currentDistance);

    if (score > bestScore) {
      bestScore = score;
      bestNeighbor = neighborIndex;
    }
  }

  // Execute move to best neighbor
  if (bestNeighbor >= 0) {
    targetShip.currentStarIndex = bestNeighbor;
    logi("Target moved to star {}", bestNeighbor, 0, 0);

    // Safety check: ensure target didn't accidentally move to occupied star
    for (let i: i32 = 0; i < MAX_PLAYER_SHIPS; i++) {
      const ship = playerShips.get(i);
      if (ship.currentStarIndex == bestNeighbor) {
        // This should NEVER happen with proper scoring
        log("ERROR: Target moved to occupied star!");
        return;
      }
    }
  } else {
    log("WARNING: Target could not find valid move");
  }
}
