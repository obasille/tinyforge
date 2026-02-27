import { UncheckedArrayView } from "../../sdk";
import { edges, playerShips, stars, TEMP_MEM_START } from "./types";

/**
 * Initialize star tracking with single star (used at game start)
 */
export function initializeStarTracking(starIndex: i32): void {
  const numStars = stars.length as i32;
  // Clear all tracking
  for (let i: i32 = 0; i < numStars; i++) {
    stars.get(i).isPossibleTarget = 0;
  }
  // Mark only the target's starting location
  stars.get(starIndex).isPossibleTarget = 1;
}

/**
 * Update star tracking to show all possible locations the target could have moved to
 * Called at the end of each turn after the target moves
 */
export function updateStarTracking(): void {
  const numStars = stars.length as i32;
  const numEdges = edges.length as i32;

  // Use TEMP_WORK for temporary arrays
  const tempWork = UncheckedArrayView.fromAddress<i32>(TEMP_MEM_START);

  // Get list of player-occupied stars (forbidden locations)
  let forbiddenCount: i32 = 0;
  for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
    const ship = playerShips.get(i);
    tempWork[i] = ship.currentStarIndex;
    forbiddenCount++;
  }

  // Create new possibility map in temp memory (starting after forbidden list)
  const newTrackingOffset = playerShips.length as i32;
  for (let i: i32 = 0; i < numStars; i++) {
    tempWork[newTrackingOffset + i] = 0;
  }

  // For each currently possible star, mark it AND its neighbors as possible
  for (let starIdx: i32 = 0; starIdx < numStars; starIdx++) {
    if (stars.get(starIdx).isPossibleTarget == 1) {
      // This star is currently a possible target location

      // First, check if the target could stay at this star (not forbidden)
      let currentStarForbidden = false;
      for (let f: i32 = 0; f < forbiddenCount; f++) {
        if (tempWork[f] == starIdx) {
          currentStarForbidden = true;
          break;
        }
      }

      // If not forbidden, target could stay here
      if (!currentStarForbidden) {
        tempWork[newTrackingOffset + starIdx] = 1;
      }

      // Add all its neighbors to the new possibility map
      for (let edgeIdx: i32 = 0; edgeIdx < numEdges; edgeIdx++) {
        const edge = edges.get(edgeIdx);
        let neighborIdx: i32 = -1;

        if (edge.a == starIdx) {
          neighborIdx = edge.b;
        } else if (edge.b == starIdx) {
          neighborIdx = edge.a;
        }

        if (neighborIdx >= 0) {
          // Check if this neighbor is forbidden (player-occupied)
          let isForbidden = false;
          for (let f: i32 = 0; f < forbiddenCount; f++) {
            if (tempWork[f] == neighborIdx) {
              isForbidden = true;
              break;
            }
          }

          // Only mark as possible if not forbidden
          if (!isForbidden) {
            tempWork[newTrackingOffset + neighborIdx] = 1;
          }
        }
      }
    }
  }

  // Copy new tracking back to Star objects
  for (let i: i32 = 0; i < numStars; i++) {
    stars.get(i).isPossibleTarget = tempWork[newTrackingOffset + i] as u8;
  }
}

/**
 * Clear star tracking for all stars within scan radius of a given position
 * Called when a scan shows "no contact" to eliminate possibilities
 */
export function clearStarTrackingByScan(
  scanCenterStarIndex: i32,
  scanRadius: i32,
): void {
  const numStars = stars.length as i32;
  const scanCenter = stars.get(scanCenterStarIndex);
  const radius2 = scanRadius * scanRadius;

  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);
    if (star.isPossibleTarget == 1) {
      // Check if this possible star is within scan radius
      const dx = star.x - scanCenter.x;
      const dy = star.y - scanCenter.y;
      const dist2 = dx * dx + dy * dy;

      if (dist2 <= radius2) {
        // This star was cleared by the scan
        star.isPossibleTarget = 0;
      }
    }
  }
}

/**
 * Clear star tracking for all stars within beacon range when beacon is not detecting
 * Called when a beacon shows no detection to eliminate possibilities
 */
export function clearStarTrackingByBeacon(
  beaconStarIndex: i32,
  beaconRange: i32,
): void {
  const numStars = stars.length as i32;
  const beaconStar = stars.get(beaconStarIndex);
  const range2 = beaconRange * beaconRange;

  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);
    if (star.isPossibleTarget == 1) {
      // Check if this possible star is within beacon range
      const dx = star.x - beaconStar.x;
      const dy = star.y - beaconStar.y;
      const dist2 = dx * dx + dy * dy;

      if (dist2 <= range2) {
        // This star is within beacon range but no detection = target not here
        star.isPossibleTarget = 0;
      }
    }
  }
}
