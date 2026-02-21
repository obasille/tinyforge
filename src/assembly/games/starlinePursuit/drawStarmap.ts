import {
  c,
  drawLine,
  drawRect,
  fillCircle,
  fillRect,
  getU16,
  getU8,
  warni,
} from "../../sdk";

import {
  EXIT_RADIUS,
  getCaptureShip,
  getTargetShip,
  HUB_RADIUS,
  MAX_EDGES,
  MemLayout,
  NUM_CLUSTERS,
  STAR_RADIUS,
  TOTAL_STARS,
  clusters,
  edges,
  stars,
} from "./types";

/**
 * Draw cluster centers for debugging
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function drawClusterCenters(): void {
  for (let i: i32 = 0; i < NUM_CLUSTERS; i++) {
    const cluster = clusters.get(i);

    // Draw large circle for cluster center
    fillCircle(cluster.x, cluster.y, 8, c(0xff00ff)); // Magenta center

    // Draw cross hairs
    drawLine(cluster.x - 15, cluster.y, cluster.x + 15, cluster.y, c(0xff00ff));
    drawLine(cluster.x, cluster.y - 15, cluster.x, cluster.y + 15, c(0xff00ff));
  }
}

/**
 * Draw the complete starmap (stars and lanes)
 */
export function drawStarmap(): void {
  const numStars = getU8(MemLayout.NUM_STARS) as i32;
  const numEdges = getU16(MemLayout.NUM_EDGES) as i32;

  // Safety check: ensure values are reasonable
  if (numStars <= 0 || numStars > TOTAL_STARS) {
    warni("Invalid numStars: {}, expected 1-{}", numStars, TOTAL_STARS);
    return;
  }
  if (numEdges < 0 || numEdges > MAX_EDGES) {
    warni("Invalid numEdges: {}, expected 0-{}", numEdges, MAX_EDGES);
    return;
  }

  // Draw cluster centers (for debugging)
  // drawClusterCenters();

  // Clamp numEdges to prevent reading beyond MAX_EDGES
  const safeNumEdges = numEdges;

  // Draw lanes (edges) first so stars appear on top
  for (let i: i32 = 0; i < safeNumEdges; i++) {
    const edge = edges.get(i);

    // Bounds check to prevent crashes from invalid edges
    if (edge.a < 0 || edge.a >= numStars || edge.b < 0 || edge.b >= numStars) {
      continue; // Skip invalid edge
    }

    const starA = stars.get(edge.a);
    const starB = stars.get(edge.b);

    // Draw lane as a line
    drawLine(starA.x, starA.y, starB.x, starB.y, c(0x444444));
  }

  // Draw stars with different colors/sizes based on type
  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);

    if (star.isExit != 0) {
      // Exit nodes: green
      fillCircle(star.x, star.y, EXIT_RADIUS, c(0x00ff00));
    } else if (star.isHub != 0) {
      // Hub nodes: orange
      fillCircle(star.x, star.y, HUB_RADIUS, c(0xffaa00));
    } else {
      // Normal stars: light blue
      fillCircle(star.x, star.y, STAR_RADIUS, c(0xaaccff));
    }
  }

  // Draw capture ship (player ship - bright blue filled square)
  const captureShip = getCaptureShip();
  const captureStarIndex = captureShip.currentStarIndex;
  if (captureStarIndex >= 0 && captureStarIndex < numStars) {
    const captureStar = stars.get(captureStarIndex);
    const shipSize: i32 = 6;
    fillRect(
      captureStar.x - shipSize / 2,
      captureStar.y - shipSize / 2,
      shipSize,
      shipSize,
      c(0x00aaff),
    );
    // White outline for visibility
    drawRect(
      captureStar.x - shipSize / 2,
      captureStar.y - shipSize / 2,
      shipSize,
      shipSize,
      c(0xffffff),
    );
  }

  // Draw target ship (enemy ship - red hollow square)
  const targetShip = getTargetShip();
  if (targetShip.isActive != 0) {
    const targetStarIndex = targetShip.currentStarIndex;

    // Bounds check
    if (targetStarIndex >= 0 && targetStarIndex < numStars) {
      const targetStar = stars.get(targetStarIndex);

      // Draw target as a red square around the star
      const boxSize: i32 = 8;
      drawRect(
        targetStar.x - boxSize / 2,
        targetStar.y - boxSize / 2,
        boxSize,
        boxSize,
        c(0xff0000),
      );
    }
  }
}
