import {
  c,
  drawCircle,
  drawLine,
  drawRect,
  fillCircle,
  fillRect,
  getI32,
  getU16,
  getU8,
  toColor,
  warni,
} from "../../sdk";

import {
  beacons,
  EXIT_RADIUS,
  getTargetShip,
  HUB_RADIUS,
  MAX_BEACONS,
  MAX_EDGES,
  MAX_PLAYER_SHIPS,
  MemLayout,
  NUM_CLUSTERS,
  playerShips,
  SCAN_RADIUS,
  ShipType,
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

  // Draw player ships with distinct visuals
  const activeIndex = getI32(MemLayout.ACTIVE_SHIP_INDEX);
  const turnCounter = getI32(MemLayout.TURN_COUNTER);

  for (let i: i32 = 0; i < MAX_PLAYER_SHIPS; i++) {
    const ship = playerShips.get(i);
    const shipStarIndex = ship.currentStarIndex;

    if (shipStarIndex >= 0 && shipStarIndex < numStars) {
      const shipStar = stars.get(shipStarIndex);
      const isActive = i == activeIndex;

      // Draw ship based on type
      if (ship.shipType == ShipType.INTERCEPTOR) {
        // Interceptor: Blue filled square
        const size: i32 = 6;
        fillRect(
          shipStar.x - size / 2,
          shipStar.y - size / 2,
          size,
          size,
          c(0x00aaff),
        );
        drawRect(
          shipStar.x - size / 2,
          shipStar.y - size / 2,
          size,
          size,
          c(0xffffff),
        );
      } else if (ship.shipType == ShipType.SURVEY_CRUISER) {
        // Survey Cruiser: Purple hollow circle
        drawCircle(shipStar.x, shipStar.y, 4, c(0xaa00ff));
        drawCircle(shipStar.x, shipStar.y, 3, c(0xaa00ff));
      } else if (ship.shipType == ShipType.BEACON_TENDER) {
        // Beacon Tender: Yellow filled triangle (approximated with lines)
        const size: i32 = 5;
        // Draw filled triangle by drawing multiple horizontal lines
        for (let dy: i32 = 0; dy < size; dy++) {
          const width = ((((dy * 2) as f32) / (size as f32)) *
            (size as f32)) as i32;
          drawLine(
            shipStar.x - width / 2,
            shipStar.y - size / 2 + dy,
            shipStar.x + width / 2,
            shipStar.y - size / 2 + dy,
            c(0xffaa00),
          );
        }
        // Draw triangle outline
        drawLine(
          shipStar.x,
          shipStar.y - size,
          shipStar.x - size,
          shipStar.y + size / 2,
          c(0xffaa00),
        );
        drawLine(
          shipStar.x,
          shipStar.y - size,
          shipStar.x + size,
          shipStar.y + size / 2,
          c(0xffaa00),
        );
        drawLine(
          shipStar.x - size,
          shipStar.y + size / 2,
          shipStar.x + size,
          shipStar.y + size / 2,
          c(0xffaa00),
        );
      }

      // Draw pulsing outline for active ship
      if (isActive) {
        // Pulse between frames 0-30
        const pulsePhase = turnCounter % 30;
        const shouldDraw = pulsePhase < 15; // Draw for first half of cycle

        if (shouldDraw) {
          const outlineSize: i32 = 10;
          drawRect(
            shipStar.x - outlineSize / 2,
            shipStar.y - outlineSize / 2,
            outlineSize,
            outlineSize,
            c(0xffffff),
          );
        }
      }
    }
  }

  // Draw scan radius effect if scan just performed
  const scanTimer = getI32(MemLayout.SCAN_TIMER);
  const scanResult = getI32(MemLayout.SCAN_RESULT);
  // Show green scan only during first 60 frames based on detection result
  // Target detected (starts at 180): show green from 180-121
  // No contact (starts at 120): show green from 120-61
  const justScanned =
    (scanResult >= 0 && scanTimer > 120) || (scanResult == -1 && scanTimer > 60);
  if (justScanned) {
    // Show scan radius expanding (30 frames) then fading (30 frames) = 1 second total
    const activeIndex = getI32(MemLayout.ACTIVE_SHIP_INDEX);
    const activeShip = playerShips.get(activeIndex);
    if (activeShip.shipType == ShipType.SURVEY_CRUISER) {
      const shipStarIndex = activeShip.currentStarIndex;
      if (shipStarIndex >= 0 && shipStarIndex < numStars) {
        const shipStar = stars.get(shipStarIndex);
        // Calculate animation phase (0-59) based on which timer range
        const scanPhase = scanResult >= 0 ? 180 - scanTimer : 120 - scanTimer;

        if (scanPhase < 30) {
          // Phase 1: Expanding from center (0-29 frames)
          const radius = (scanPhase * SCAN_RADIUS) / 30;
          drawCircle(shipStar.x, shipStar.y, radius, c(0x00ff00));
          if (scanPhase < 15) {
            drawCircle(shipStar.x, shipStar.y, radius - 2, c(0x00ff00));
          }
        } else {
          // Phase 2: Full size with alpha fade (30-59 frames)
          const fadePhase = scanPhase - 30; // 0-29
          const alpha = (255 * (30 - fadePhase)) / 30; // 255->0
          const color = toColor(0, 255, 0, alpha as u8);
          drawCircle(shipStar.x, shipStar.y, SCAN_RADIUS, color);
          if (fadePhase < 15) {
            const alphaInner = (255 * (15 - fadePhase)) / 15; // 255->0
            const colorInner = toColor(0, 255, 0, alphaInner as u8);
            drawCircle(shipStar.x, shipStar.y, SCAN_RADIUS - 2, colorInner);
          }
        }
      }
    }
  }

  // Highlight target star if scan detected it (after pulse animation)
  if (scanTimer > 0 && scanTimer <= 120) {
    if (scanResult >= 0 && scanResult < numStars) {
      const targetStar = stars.get(scanResult);
      // Pulsing ring effect (period: 40 frames)
      const highlightPhase = (120 - scanTimer) % 40;
      const pulseExpand = highlightPhase < 20;
      const baseRadius = pulseExpand
        ? 8 + highlightPhase / 2
        : 8 + (40 - highlightPhase) / 2;
      // Draw red pulsing rings
      drawCircle(targetStar.x, targetStar.y, baseRadius, c(0xff0000));
      drawCircle(targetStar.x, targetStar.y, baseRadius + 2, c(0xff0000));
      drawCircle(targetStar.x, targetStar.y, baseRadius + 4, c(0xff3333));
    }
  }

  // Draw beacons (deployed sensors)
  const pulsePhase = turnCounter % 30;
  const beaconPulse = pulsePhase < 15; // Alternate flash

  for (let i: i32 = 0; i < MAX_BEACONS; i++) {
    const beacon = beacons.get(i);
    if (beacon.isActive == 1) {
      const beaconStarIndex = beacon.starIndex;
      if (beaconStarIndex >= 0 && beaconStarIndex < numStars) {
        const beaconStar = stars.get(beaconStarIndex);

        if (beacon.isDetecting == 1) {
          // Target detected: red alert beacon
          fillCircle(beaconStar.x, beaconStar.y, 3, c(0xff0000));
          // Draw red alert ring
          drawCircle(beaconStar.x, beaconStar.y, 5, c(0xff0000));
          if (beaconPulse) {
            drawCircle(beaconStar.x, beaconStar.y, 7, c(0xff0000));
          }
        } else {
          // Normal beacon: yellow
          fillCircle(beaconStar.x, beaconStar.y, 3, c(0xffdd00));
          // Draw pulsing outline
          if (beaconPulse) {
            drawCircle(beaconStar.x, beaconStar.y, 5, c(0xffdd00));
          }
        }
      }
    }
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
