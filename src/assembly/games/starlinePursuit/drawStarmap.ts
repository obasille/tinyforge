import {
  c,
  drawCircle,
  drawLine,
  drawRect,
  fillCircle,
  fillRect,
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
} from "./types";

/**
 * Draw cluster centers for debugging
       Colors.HubOrange,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function drawClusterCenters(): void {
  for (let i: i32 = 0; i < NUM_CLUSTERS; i++) {
    const cluster = clusters.get(i);

    // Draw large circle for cluster center
    fillCircle(cluster.x, cluster.y, 8, Colors.ClusterMagenta); // Magenta center

    // Draw cross hairs
    drawLine(cluster.x - 15, cluster.y, cluster.x + 15, cluster.y, Colors.ClusterMagenta);
    drawLine(cluster.x, cluster.y - 15, cluster.x, cluster.y + 15, Colors.ClusterMagenta);
  }
}

/**
 * Draw the complete starmap (stars and lanes)
 */
export function drawStarmap(): void {
  const numStars = stars.length as i32;
  const numEdges = edges.length as i32;
  const numNebulas = nebulas.length as i32;

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
      fillCircle(star.x, star.y, 7, withAlpha(Colors.StarBlue, 0x40)); // Semi-transparent blue
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

  // Draw player ships with distinct visuals
  const activeIndex = gameState.activeShipIndex;
  const frameCounter = gameState.frameCounter;

  for (let i: i32 = 0; i < (playerShips.length as i32); i++) {
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
          Colors.BriefingBorder,
        );
        drawRect(
          shipStar.x - size / 2,
          shipStar.y - size / 2,
          size,
          size,
          Colors.TextWhite,
        );
      } else if (ship.shipType == ShipType.SURVEY_CRUISER) {
        // Survey Cruiser: Purple hollow circle
        drawCircle(shipStar.x, shipStar.y, 4, Colors.ClusterPurpleShip);
        drawCircle(shipStar.x, shipStar.y, 3, Colors.ClusterPurpleShip);
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
            Colors.HubOrange,
          );
        }
        // Draw triangle outline
        drawLine(
          shipStar.x,
          shipStar.y - size,
          shipStar.x - size,
          shipStar.y + size / 2,
          Colors.HubOrange,
        );
        drawLine(
          shipStar.x,
          shipStar.y - size,
          shipStar.x + size,
          shipStar.y + size / 2,
          Colors.HubOrange,
        );
        drawLine(
          shipStar.x - size,
          shipStar.y + size / 2,
          shipStar.x + size,
          shipStar.y + size / 2,
          Colors.HubOrange,
        );
      }

      // Draw pulsing outline for active ship
      if (isActive) {
        // Pulse between frames 0-30
        const pulsePhase = frameCounter % 30;
        const shouldDraw = pulsePhase < 15; // Draw for first half of cycle

        if (shouldDraw) {
          const outlineSize: i32 = 10;
          drawRect(
            shipStar.x - outlineSize / 2,
            shipStar.y - outlineSize / 2,
            outlineSize,
            outlineSize,
            Colors.TextWhite,
          );
        }
      }
    }
  }

  // Draw scan radius effect if scan just performed
  const scanTimer = gameState.scanTimer;
  const scanResult = gameState.scanResult;

  // Show initial target location reveal animation at game start
  if (
    gameState.initialRevealTimer > 0 &&
    targetShip.currentStarIndex < numStars
  ) {
    const startStar = stars.get(targetShip.currentStarIndex);
    const revealPhase = 180 - gameState.initialRevealTimer;

    if (revealPhase < 30) {
      // Expanding pulse
      const radius = (revealPhase * SCAN_RADIUS) / 30;
      drawCircle(startStar.x, startStar.y, radius, Colors.TargetRed);
      if (revealPhase < 15 && radius > 2) {
        drawCircle(startStar.x, startStar.y, radius - 2, Colors.TargetRed);
      }
    } else if (revealPhase < 60) {
      // Fade out pulse
      const fadePhase = revealPhase - 30;
      const alpha = (255 * (30 - fadePhase)) / 30;
      const color = withAlpha(Colors.TargetRed, alpha as u8);
      drawCircle(startStar.x, startStar.y, SCAN_RADIUS, color);
      if (fadePhase < 15) {
        const alphaInner = (255 * (15 - fadePhase)) / 15;
        const colorInner = withAlpha(Colors.TargetRed, alphaInner as u8);
        drawCircle(startStar.x, startStar.y, SCAN_RADIUS - 2, colorInner);
      }
    }

    // Keep the start star highlighted while reveal timer is active
    drawCircle(startStar.x, startStar.y, 8, Colors.TargetRed);
    drawCircle(startStar.x, startStar.y, 10, Colors.TargetLightRed);
  }

  // Show green scan only during first 60 frames based on detection result
  // Target detected (starts at 180): show green from 180-121
  // No contact (starts at 120): show green from 120-61
  const justScanned =
    (scanResult >= 0 && scanTimer > 120) ||
    (scanResult == -1 && scanTimer > 60);
  if (justScanned) {
    // Show scan radius expanding (30 frames) then fading (30 frames) = 1 second total
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
          drawCircle(shipStar.x, shipStar.y, radius, Colors.ObjectiveGreen);
          if (scanPhase < 15) {
            drawCircle(
              shipStar.x,
              shipStar.y,
              radius - 2,
              Colors.ObjectiveGreen,
            );
          }
        } else {
          // Phase 2: Full size with alpha fade (30-59 frames)
          const fadePhase = scanPhase - 30; // 0-29
          const alpha = (255 * (30 - fadePhase)) / 30; // 255->0
          const color = withAlpha(Colors.ObjectiveGreen, alpha as u8);
          drawCircle(shipStar.x, shipStar.y, SCAN_RADIUS, color);
          if (fadePhase < 15) {
            const alphaInner = (255 * (15 - fadePhase)) / 15; // 255->0
            const colorInner = withAlpha(
              Colors.ObjectiveGreen,
              alphaInner as u8,
            );
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
  const pulsePhase = frameCounter % 30;
  const beaconPulse = pulsePhase < 15; // Alternate flash

  for (let i = 0; i < (beacons.length as i32); i++) {
    const beacon = beacons.get(i);
    if (beacon.isActive == 1) {
      const beaconStarIndex = beacon.starIndex;
      if (beaconStarIndex >= 0 && beaconStarIndex < numStars) {
        const beaconStar = stars.get(beaconStarIndex);

        // Draw beacon range animation if timer is active
        if (beacon.rangeAnimTimer > 0) {
          const animPhase = 60 - (beacon.rangeAnimTimer as i32);

          if (animPhase < 30) {
            // Expanding pulse (0-30 frames)
            const radius = (animPhase * BEACON_RANGE) / 30;
            const alpha = (255 * (30 - animPhase)) / 30; // Fade out as it expands
            const color =
              beacon.isDetecting == 1
                ? withAlpha(Colors.TargetRed, alpha as u8) // Red for detecting
                : withAlpha(Colors.BeaconYellow, alpha as u8); // Yellow for normal
            drawCircle(beaconStar.x, beaconStar.y, radius, color);
            if (radius > 3) {
              drawCircle(beaconStar.x, beaconStar.y, radius - 2, color);
            }
          } else if (animPhase < 60) {
            // Static full range with fade (30-60 frames)
            const fadePhase = animPhase - 30;
            const alpha = (255 * (30 - fadePhase)) / 30;
            const color =
              beacon.isDetecting == 1
                ? withAlpha(Colors.TargetRed, alpha as u8)
                : withAlpha(Colors.BeaconYellow, alpha as u8);
            drawCircle(beaconStar.x, beaconStar.y, BEACON_RANGE, color);
            if (fadePhase < 15) {
              const alphaInner = (255 * (15 - fadePhase)) / 15;
              const colorInner =
                beacon.isDetecting == 1
                  ? withAlpha(Colors.TargetRed, alphaInner as u8)
                  : withAlpha(Colors.BeaconYellow, alphaInner as u8);
              drawCircle(
                beaconStar.x,
                beaconStar.y,
                BEACON_RANGE - 2,
                colorInner,
              );
            }
          }
        }

        // Draw beacon icon
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
          fillCircle(beaconStar.x, beaconStar.y, 3, Colors.BeaconYellow);
          // Draw pulsing outline
          if (beaconPulse) {
            drawCircle(beaconStar.x, beaconStar.y, 5, Colors.BeaconYellow);
          }
        }
      }
    }
  }

  // Draw target ship (enemy ship - red hollow square)
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
        Colors.TargetRed,
      );
    }
  }
}
