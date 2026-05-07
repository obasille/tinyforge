import {
  c,
  drawCircle,
  drawLine,
  drawRect,
  fillCircle,
  fillRect,
  pset,
  UncheckedArrayView,
  withAlpha,
} from "../../sdk";

import {
  BEACON_RANGE,
  beacons,
  Colors,
  edges,
  EXIT_RADIUS,
  gameState,
  HUB_RADIUS,
  nebulas,
  playerShips,
  SCAN_RADIUS,
  ShipType,
  STAR_RADIUS,
  stars,
  targetShip,
  TEMP_MEM_START,
} from "./types";

const DEBUG_ALWAYS_SHOW_TARGET_AND_TRAILS = false;
const POSSIBLE_TARGET_RADIUS = 7; // Radius for possible target markers

// eslint-disable-next-line @typescript-eslint/no-unused-vars
/**
 * Draw cluster centers for debugging.
 */
function drawClusterCenters(): void {
  for (let i: i32 = 0; i < NUM_CLUSTERS; i++) {
    const cluster = clusters.get(i);

    // Draw large circle for cluster center
    fillCircle(cluster.x, cluster.y, 8, Colors.ClusterMagenta); // Magenta center

    // Draw cross hairs
    drawLine(
      cluster.x - 15,
      cluster.y,
      cluster.x + 15,
      cluster.y,
      Colors.ClusterMagenta,
    );
    drawLine(
      cluster.x,
      cluster.y - 15,
      cluster.x,
      cluster.y + 15,
      Colors.ClusterMagenta,
    );
  }
}

// --- Helper: Draw 9x9 monochrome icon for each ship type ---
function drawPlayerShipIcon7x7(x: i32, y: i32, shipType: i32): void {
  // Centered at (x, y), 7x7
  const color = Colors.TextWhite;
  if (shipType == ShipType.INTERCEPTOR) {
    // Interceptor: 7x7 filled square with border
    fillRect(x - 3, y - 3, 7, 7, Colors.BriefingBorder);
    drawRect(x - 3, y - 3, 7, 7, color);
  } else if (shipType == ShipType.SCOUT) {
    // Scout: 7x7 diamond
    for (let dy: i32 = -3; dy <= 3; dy++) {
      const w = 3 - (dy >= 0 ? dy : -dy);
      drawLine(x - w, y + dy, x + w, y + dy, Colors.StarBlue);
    }
    pset(x, y, color);
  } else if (shipType == ShipType.SURVEY_CRUISER) {
    // Survey Cruiser: 7x7 hollow circle
    drawCircle(x, y, 3, Colors.ClusterPurpleShip);
    drawCircle(x, y, 2, Colors.ClusterPurpleShip);
  } else if (shipType == ShipType.BEACON_TENDER) {
    // Beacon Tender: 7x7 filled triangle (point up)
    for (let dy: i32 = 0; dy < 4; dy++) {
      const w = dy;
      drawLine(x - w, y + 3 - dy, x + w, y + 3 - dy, Colors.HubOrange);
    }
    // Outline
    drawLine(x, y - 3, x - 3, y + 3, Colors.HubOrange);
    drawLine(x, y - 3, x + 3, y + 3, Colors.HubOrange);
    drawLine(x - 3, y + 3, x + 3, y + 3, Colors.HubOrange);
  }
}
//
function drawTrails(numStars: i32): void {
  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);
    if (star.trailHeat == 0) continue;
    if (!DEBUG_ALWAYS_SHOW_TARGET_AND_TRAILS && star.trailKnown == 0) continue;

    const ringRadius = POSSIBLE_TARGET_RADIUS;

    if (star.trailHeat >= 4) {
      drawCircle(
        star.x,
        star.y,
        ringRadius,
        withAlpha(Colors.TextYellow, 0xd0),
      );
      drawCircle(
        star.x,
        star.y,
        ringRadius + 1,
        withAlpha(Colors.TextYellow, 0xb0),
      );
    } else if (star.trailHeat == 3) {
      drawCircle(
        star.x,
        star.y,
        ringRadius,
        withAlpha(Colors.TextYellow, 0x90),
      );
      drawCircle(
        star.x,
        star.y,
        ringRadius + 1,
        withAlpha(Colors.TextYellow, 0x70),
      );
    } else if (star.trailHeat == 2) {
      drawCircle(
        star.x,
        star.y,
        ringRadius,
        withAlpha(Colors.TextYellow, 0xa0),
      );
    } else {
      drawCircle(
        star.x,
        star.y,
        ringRadius,
        withAlpha(Colors.TextYellow, 0x50),
      );
    }
  }
}

/**
 * Draw the complete starmap (stars and lanes)
 */
export function drawStarmap(): void {
  const numStars = stars.length as i32;
  const numEdges = edges.length as i32;
  const numNebulas = nebulas.length as i32;
  const frameCounter = gameState.frameCounter;

  // Draw nebulas first (background layer)
  for (let i: i32 = 0; i < numNebulas; i++) {
    const nebula = nebulas.get(i);
    // Draw multi-layer cloud effect with semi-transparent circles
    const r = nebula.radius;
    // Outer glow layer (purple/pink hue)
    fillCircle(nebula.x, nebula.y, r, withAlpha(Colors.ClusterPurple, 0x20));
    // Middle layer (slightly brighter)
    fillCircle(
      nebula.x,
      nebula.y,
      (r * 2) / 3,
      withAlpha(Colors.ClusterPurple, 0x30),
    );
    // Inner core (brightest)
    fillCircle(
      nebula.x,
      nebula.y,
      r / 3,
      withAlpha(Colors.ClusterPurple, 0x40),
    );
  }

  // Draw cluster centers (for debugging)
  // drawClusterCenters();

  // Draw subtle markers for all possible target stars
  // These are stars the target might currently occupy based on movement history
  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);
    if (star.isPossibleTarget == 1) {
      fillCircle(
        star.x,
        star.y,
        POSSIBLE_TARGET_RADIUS,
        withAlpha(Colors.StarBlue, 0x40),
      ); // Semi-transparent blue
    }
  }

  // Draw lanes (edges) first so stars appear on top
  for (let i: i32 = 0; i < numEdges; i++) {
    const edge = edges.get(i);

    // Bounds check to prevent crashes from invalid edges
    if (edge.a < 0 || edge.a >= numStars || edge.b < 0 || edge.b >= numStars) {
      continue; // Skip invalid edge
    }

    const starA = stars.get(edge.a);
    const starB = stars.get(edge.b);

    // Draw lane as a line
    drawLine(starA.x, starA.y, starB.x, starB.y, Colors.TextDarkGray);
  }

  // Draw stars with different colors/sizes based on type
  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);

    // Draw purple circle around stars within nebulas
    if (star.inNebula != 0) {
      const r =
        star.isExit != 0
          ? EXIT_RADIUS
          : star.isHub != 0
            ? HUB_RADIUS
            : STAR_RADIUS;
      drawCircle(star.x, star.y, r + 1, Colors.ClusterPurple); // Purple circle
    }

    if (star.isExit != 0) {
      // Exit nodes: green
      fillCircle(star.x, star.y, EXIT_RADIUS, Colors.ObjectiveGreen);
    } else if (star.isHub != 0) {
      // Hub nodes: orange
      fillCircle(star.x, star.y, HUB_RADIUS, Colors.HubOrange);
    } else {
      // Normal stars: light blue
      fillCircle(star.x, star.y, STAR_RADIUS, Colors.StarBlue);
    }
  }

  // Draw trails after stars so markers stay visible above star fills.
  drawTrails(numStars);

  // Draw command base marker
  const baseIndex = gameState.commandBaseStarIndex;
  if (baseIndex >= 0 && baseIndex < numStars) {
    const baseStar = stars.get(baseIndex);
    drawCircle(baseStar.x, baseStar.y, 9, Colors.BriefingBorder);
    drawRect(baseStar.x - 2, baseStar.y - 2, 5, 5, Colors.TextWhite);
  }

  // Draw player ships as 9x9 monochrome icons arranged around their star
  const activeIndex = gameState.activeShipIndex;

  // 1. Group ships by star index
  // For up to MAX_PLAYER_SHIPS, this is efficient enough
  for (let starIdx: i32 = 0; starIdx < numStars; starIdx++) {
    // Collect all ships at this star (zero-allocation, UncheckedArrayView)
    const stationed = UncheckedArrayView.fromAddress<i32>(TEMP_MEM_START);
    let stationedCount: i32 = 0;
    for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
      const ship = playerShips.get(i);
      if (ship.currentStarIndex == starIdx) {
        stationed.set(stationedCount, i);
        stationedCount++;
      }
    }
    if (stationedCount == 0) continue;

    // Arrange icons in a circle around the star
    const star = stars.get(starIdx);
    const cx = star.x;
    const cy = star.y;
    const radius: f32 = 9.0; // Distance from star center to icon center (moved 1px closer)
    for (let k: i32 = 0; k < stationedCount; k++) {
      // Compute angle for this ship
      let angle: f32 = 0.0;
      if (stationedCount == 1) {
        angle = -Mathf.PI / 2.0; // 12 o'clock
      } else {
        angle =
          -Mathf.PI / 2.0 + (2.0 * Mathf.PI * <f32>k) / <f32>stationedCount;
      }
      const iconX = cx + <i32>Mathf.round(radius * Mathf.cos(angle));
      const iconY = cy + <i32>Mathf.round(radius * Mathf.sin(angle));
      const shipIdx = stationed.get(k);
      const ship = playerShips.get(shipIdx);
      // Draw the 7x7 icon for this ship type
      drawPlayerShipIcon7x7(iconX, iconY, ship.shipType);

      if (shipIdx == activeIndex) {
        const frameCounter = gameState.frameCounter;
        const pulsePhase = frameCounter % 30;
        const shouldDraw = pulsePhase < 15;
        if (shouldDraw) {
          const outlineSize: i32 = 11;
          drawRect(
            iconX - outlineSize / 2,
            iconY - outlineSize / 2,
            outlineSize,
            outlineSize,
            Colors.TextWhite,
          );
        }
      }
    }
  }
}
