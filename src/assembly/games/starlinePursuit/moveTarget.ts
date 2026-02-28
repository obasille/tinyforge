import { log, logi, randomRange } from "../../sdk";
import { FixedArray } from "../../sdk/arrays";
import {
  BEACON_RANGE,
  ShipType,
  TEMP_MEM_START,
  TargetType,
  beacons,
  edges,
  gameState,
  playerShips,
  stars,
  targetShip,
} from "./types";
import { starsDist2 } from "./utils";

/**
 * Check if a star is within detection range of any active beacon
 */
function isStarDetected(starIndex: i32): bool {
  const range2 = BEACON_RANGE * BEACON_RANGE;
  for (let i = 0; i < (beacons.length as i32); i++) {
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
  const numEdges = edges.length as i32;
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

  for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
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
 * Behavior changes based on target type
 */
function scoreNeighbor(neighborIndex: i32, currentDistance: i32): f32 {
  // CRITICAL: Never move to a star occupied by an Interceptor
  // Other ships can be moved onto as a last resort (they detect but don't capture)
  for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
    const ship = playerShips.get(i);
    if (ship.currentStarIndex == neighborIndex) {
      if (ship.shipType == ShipType.INTERCEPTOR) {
        return -999999.0; // Instant reject - Interceptor captures
      } else {
        // Non-Interceptor ship: very heavy penalty but not instant reject
        // Only choose this if all other options are worse (cornered)
        return -500.0;
      }
    }
  }

  const targetType = gameState.targetType;
  const neighbor = stars.get(neighborIndex);
  let score: f32 = 0.0;

  // Factor A: Distance from player (primary motivation for most targets)
  const neighborDistance = getClosestPlayerDistance(neighborIndex);

  if (targetType == TargetType.PIRATE) {
    // Pirate: less aggressive fleeing, prefers tactical positions
    if (neighborDistance > currentDistance) {
      score += 60.0; // Moderate bonus for moving away
    } else if (neighborDistance < currentDistance) {
      score -= 100.0; // Moderate penalty for moving closer
    }
  } else if (targetType == TargetType.GHOST) {
    // Ghost: unpredictable, doesn't prioritize fleeing as strongly
    if (neighborDistance > currentDistance) {
      score += 50.0;
    } else if (neighborDistance < currentDistance) {
      score -= 80.0;
    }
  } else {
    // Smuggler, Courier, Decoy Master: standard fleeing behavior
    if (neighborDistance > currentDistance) {
      score += 100.0; // Strong bonus for moving away
    } else if (neighborDistance < currentDistance) {
      score -= 200.0; // Heavy penalty for moving closer
    }
  }

  // Factor B: Detection risk (beacon avoidance varies by type)
  if (isStarDetected(neighborIndex)) {
    if (targetType == TargetType.SMUGGLER) {
      score -= 120.0; // Smuggler: heavily avoids beacons
    } else if (targetType == TargetType.GHOST) {
      score -= 40.0; // Ghost: less concerned about detection
    } else if (targetType == TargetType.DECOY_MASTER) {
      score -= 60.0; // Decoy Master: moderate beacon avoidance
    } else {
      score -= 80.0; // Pirate, Courier: standard avoidance
    }
  }

  // Factor C: Route preference (varies by type)
  if (targetType == TargetType.SMUGGLER) {
    // Smuggler: prefers low sensor visibility (moderate connectivity, avoids hubs)
    if (neighbor.isHub != 0) {
      score -= 40.0; // Avoids high-traffic hubs (more sensor coverage)
    } else if (neighbor.degree == 2 || neighbor.degree == 3) {
      score += 50.0; // Prefers moderate connectivity
    } else if (neighbor.degree <= 1) {
      score -= 60.0; // Dislikes dead ends (trapped)
    }
  } else if (targetType == TargetType.PIRATE) {
    // Pirate: prefers outer rim (low degree) but not dead ends
    if (neighbor.degree == 2) {
      score += 50.0; // Ideal: edge route
    } else if (neighbor.isHub != 0) {
      score += 20.0; // Will use hubs but not preferred
    } else if (neighbor.degree <= 1) {
      score -= 30.0; // Moderate penalty for dead ends
    }
  } else if (targetType == TargetType.COURIER) {
    // Courier: prefers direct routes, avoids complex networks
    if (neighbor.degree <= 2) {
      score += 40.0; // Prefers simple paths
    } else if (neighbor.isHub != 0) {
      score -= 20.0; // Avoids busy hubs (too slow)
    }
  } else {
    // Ghost, Decoy Master: standard route preference
    if (neighbor.isHub != 0) {
      score += 30.0;
    } else if (neighbor.degree <= 1) {
      score -= 40.0;
    }
  }

  // Factor D: Unpredictability noise (varies by type)
  let noiseRange: i32 = 20;
  if (targetType == TargetType.GHOST) {
    noiseRange = 60; // Ghost: highly unpredictable
  } else if (targetType == TargetType.DECOY_MASTER) {
    noiseRange = 40; // Decoy Master: moderately unpredictable
  } else if (targetType == TargetType.COURIER) {
    noiseRange = 10; // Courier: very predictable (efficiency-focused)
  }

  const noise = (randomRange(noiseRange) as f32) - ((noiseRange / 2) as f32);
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
  const neighbors = FixedArray.fromAddress<i32>(TEMP_MEM_START);
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

    // Safety check: warn if target moved onto an Interceptor (should never happen)
    for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
      const ship = playerShips.get(i);
      if (
        ship.currentStarIndex == bestNeighbor &&
        ship.shipType == ShipType.INTERCEPTOR
      ) {
        log("ERROR: Target moved to Interceptor!");
        return;
      }
    }

    // Courier: Occasionally makes double moves (20% chance)
    if (gameState.targetType == TargetType.COURIER && randomRange(5) == 0) {
      // Get neighbors from new position for second move
      const secondNeighborCount = getAllNeighbors(bestNeighbor, neighbors);

      if (secondNeighborCount > 0) {
        const secondCurrentDistance = getClosestPlayerDistance(bestNeighbor);
        let secondBestScore: f32 = -999999.0;
        let secondBestNeighbor: i32 = -1;

        for (let i: i32 = 0; i < secondNeighborCount; i++) {
          const neighborIndex = neighbors[i];
          const score = scoreNeighbor(neighborIndex, secondCurrentDistance);

          if (score > secondBestScore) {
            secondBestScore = score;
            secondBestNeighbor = neighborIndex;
          }
        }

        if (secondBestNeighbor >= 0) {
          targetShip.currentStarIndex = secondBestNeighbor;
          log("Courier made double move!");
        }
      }
    }
  } else {
    log("WARNING: Target could not find valid move");
  }
}
