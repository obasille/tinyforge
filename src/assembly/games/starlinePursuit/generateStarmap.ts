import { clamp, FixedArray, logi, randomRange, s, warni } from "../../sdk";

import {
  CLUSTER_STRENGTH,
  clusters,
  EdgeArray,
  edges,
  EXIT_COUNT,
  EXTRA_LOOPS,
  HUB_COUNT,
  K_NEIGHBORS,
  MAP_HEIGHT,
  MAP_OFFSET_Y,
  MAP_WIDTH,
  MAX_LANE_DISTANCE,
  MAX_NEBULAS,
  MIN_NEBULAS,
  MIN_STAR_DISTANCE,
  NebulaArray,
  nebulas,
  NUM_CLUSTERS,
  StarArray,
  stars,
  TEMP_MEM_START,
} from "./types";

// === Helper Functions ===

/**
 * Calculate distance squared (fast, no sqrt needed)
 */
function dist2(ax: i32, ay: i32, bx: i32, by: i32): i32 {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Orientation test for segment intersection
 * Returns the cross product to determine if three points are clockwise or counterclockwise
 */
function orient(ax: i32, ay: i32, bx: i32, by: i32, cx: i32, cy: i32): i32 {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/**
 * Check if two line segments intersect
 * Based on 9B3. ImprovedLaneGeneration.md specification
 * Uses orientation test to detect if segments cross
 * Ignores collinear cases (extremely rare with grid+jitter)
 */
function segmentsIntersect(
  a1x: i32,
  a1y: i32,
  a2x: i32,
  a2y: i32,
  b1x: i32,
  b1y: i32,
  b2x: i32,
  b2y: i32,
): bool {
  const o1 = orient(a1x, a1y, a2x, a2y, b1x, b1y);
  const o2 = orient(a1x, a1y, a2x, a2y, b2x, b2y);
  const o3 = orient(b1x, b1y, b2x, b2y, a1x, a1y);
  const o4 = orient(b1x, b1y, b2x, b2y, a2x, a2y);

  // Ignore collinear edge cases (grid+jitter makes them extremely rare)
  if (o1 == 0 || o2 == 0 || o3 == 0 || o4 == 0) return false;

  // Segments intersect if orientations differ on both sides
  return o1 > 0 != o2 > 0 && o3 > 0 != o4 > 0;
}

/**
 * Check if an edge already exists (in either direction)
 */
function edgeExists(edges: EdgeArray, numEdges: i32, a: i32, b: i32): bool {
  for (let i = 0; i < numEdges; i++) {
    const edge = edges.get(i);
    // Skip invalid edges
    if (edge.a < 0 || edge.b < 0) continue;
    if ((edge.a == a && edge.b == b) || (edge.a == b && edge.b == a)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a proposed edge would cross any existing edges
 * Returns true if the edge (a, b) intersects any existing edge
 */
function wouldCrossEdges(
  stars: StarArray,
  edges: EdgeArray,
  numEdges: i32,
  a: i32,
  b: i32,
): bool {
  const starA = stars.get(a);
  const starB = stars.get(b);

  for (let e = 0; e < numEdges; e++) {
    const edge = edges.get(e);

    // Skip invalid edges
    if (edge.a < 0 || edge.b < 0) continue;

    // Ignore shared endpoints (edges sharing a vertex can't "cross")
    if (edge.a == a || edge.a == b || edge.b == a || edge.b == b) {
      continue;
    }

    // Test if new edge (a, b) intersects existing edge
    if (
      segmentsIntersect(
        starA.x,
        starA.y,
        starB.x,
        starB.y,
        stars.get(edge.a).x,
        stars.get(edge.a).y,
        stars.get(edge.b).x,
        stars.get(edge.b).y,
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Add edge and update degree counts
 * Zero allocation: uses direct property assignment
 */
function addEdge(stars: StarArray, edges: EdgeArray, a: i32, b: i32): i32 {
  const numEdges = edges.length as i32;
  if (a == b) return numEdges;
  if (edgeExists(edges, numEdges, a, b)) return numEdges;
  const maxEdges = edges.capacity as i32;
  if (numEdges >= maxEdges) {
    warni("Max edges reached: {}", maxEdges);
    return numEdges;
  }

  // Add edge to array
  const edge = edges.grow();
  edge.a = a;
  edge.b = b;

  const starA = stars.get(a);
  starA.degree++;

  const starB = stars.get(b);
  starB.degree++;

  return numEdges + 1;
}

/**
 * Step 1: Generate evenly spaced stars using Poisson-like rejection sampling
 */
/**
 * Generates stars using stratified sampling for even distribution.
 * Divides the map into a grid and places one star per cell with jitter.
 */
function generateStars(
  stars: StarArray,
  gridCols: i32,
  gridRows: i32,
  minDist: i32,
): void {
  const cellWidth = MAP_WIDTH / gridCols;
  const cellHeight = MAP_HEIGHT / gridRows;

  // Maximum jitter is half cell size minus half minDist to ensure spacing
  const jitterX = max(1, cellWidth / 2 - minDist / 2);
  const jitterY = max(1, cellHeight / 2 - minDist / 2);

  // Place one star per grid cell with random jitter
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      // Calculate cell center
      const centerX = col * cellWidth + cellWidth / 2;
      const centerY = row * cellHeight + cellHeight / 2;

      // Add random jitter around center
      const x = centerX + randomRange(jitterX * 2) - jitterX;
      const y = centerY + randomRange(jitterY * 2) - jitterY;

      // Clamp to map bounds with margin
      const finalX = clamp(x, 10, MAP_WIDTH - 10);
      const finalY = clamp(y, 10, MAP_HEIGHT - 10) + MAP_OFFSET_Y;

      // Add star to array
      const star = stars.grow();
      star.x = finalX;
      star.y = finalY;
      star.degree = 0;
      star.isHub = 0;
      star.isExit = 0;
    }
  }
}

/**
 * Step 2: Apply cluster bias to create visible clusters
 * Based on 9B2. ImprovedClusterPull.md specification
 */
function applyClusterBias(
  stars: StarArray,
  clusterCount: i32,
  strength: f32,
): void {
  const MARGIN = 40;
  const MIN_CLUSTER_DIST = 80;
  const INFLUENCE_RADIUS = 100;
  const RELAXATION_ITERATIONS = 2;

  // Step 2.1: Place cluster centers using grid-based distribution
  // Divide map into 3x2 grid for 320x240
  const gridCols = 3;
  const gridRows = 2;
  const cellWidth = (MAP_WIDTH - 2 * MARGIN) / gridCols;
  const cellHeight = (MAP_HEIGHT - 2 * MARGIN) / gridRows;

  // Place each cluster in a random grid cell with jitter
  for (let c = 0; c < clusterCount; c++) {
    let attempts = 0;
    let placed = false;

    while (!placed && attempts < 50) {
      attempts++;

      // Pick random cell
      const cellX = randomRange(gridCols);
      const cellY = randomRange(gridRows);

      // Calculate cell center with margin
      const centerX = MARGIN + cellX * cellWidth + cellWidth / 2;
      const centerY = MARGIN + cellY * cellHeight + cellHeight / 2;

      // Add jitter (up to 25% of cell size)
      const jitterX = cellWidth / 4;
      const jitterY = cellHeight / 4;
      const cx = centerX + randomRange(jitterX * 2) - jitterX;
      const cy = centerY + randomRange(jitterY * 2) - jitterY;

      // Clamp to map bounds with margin
      const finalX = clamp(cx, MARGIN, MAP_WIDTH - MARGIN);
      const finalY = clamp(cy, MARGIN, MAP_HEIGHT - MARGIN) + MAP_OFFSET_Y;

      // Check minimum distance from existing clusters
      let tooClose = false;
      const numClusters = clusters.length as i32;
      for (let i = 0; i < numClusters; i++) {
        const existing = clusters.get(i);
        const d2 = dist2(finalX, finalY, existing.x, existing.y);
        if (d2 < MIN_CLUSTER_DIST * MIN_CLUSTER_DIST) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        const cluster = clusters.grow();
        cluster.x = finalX;
        cluster.y = finalY;
        placed = true;
      }
    }
  }

  // Step 2.2: Pull stars toward nearest cluster
  const influenceR2 = INFLUENCE_RADIUS * INFLUENCE_RADIUS;
  const numStars = stars.length as i32;
  const numClusters = clusters.length as i32;

  for (let i = 0; i < numStars; i++) {
    const star = stars.get(i);

    // Find nearest cluster
    let nearestCluster = -1;
    let nearestDist2 = 999999999;

    for (let c = 0; c < numClusters; c++) {
      const cluster = clusters.get(c);
      const d2 = dist2(star.x, star.y, cluster.x, cluster.y);
      if (d2 < nearestDist2) {
        nearestDist2 = d2;
        nearestCluster = c;
      }
    }

    // Apply pull if within influence radius
    if (nearestCluster >= 0 && nearestDist2 < influenceR2) {
      const cluster = clusters.get(nearestCluster);
      const dist = i32(Mathf.sqrt(nearestDist2 as f32));

      // Calculate pull strength: (1 - d / influenceRadius) * randomFactor
      const basePull = 1.0 - (dist as f32) / (INFLUENCE_RADIUS as f32);
      const randomFactor = 0.8 + (randomRange(400) as f32) / 1000.0; // 0.8 to 1.2
      const pullStrength = basePull * randomFactor * strength;

      // Pull toward cluster center
      const dx = cluster.x - star.x;
      const dy = cluster.y - star.y;
      const moveX = i32((dx as f32) * pullStrength);
      const moveY = i32((dy as f32) * pullStrength);

      star.x += moveX;
      star.y += moveY;

      // Clamp to map bounds
      star.x = clamp(star.x, 10, MAP_WIDTH - 10);
      star.y = clamp(star.y - MAP_OFFSET_Y, 10, MAP_HEIGHT - 10) + MAP_OFFSET_Y;
    }
  }

  // Step 2.3: Enforce minimum star spacing using relaxation
  const minDist2 = MIN_STAR_DISTANCE * MIN_STAR_DISTANCE;

  for (let iter = 0; iter < RELAXATION_ITERATIONS; iter++) {
    for (let i = 0; i < numStars; i++) {
      const starA = stars.get(i);

      for (let j = i + 1; j < numStars; j++) {
        const starB = stars.get(j);
        const d2 = dist2(starA.x, starA.y, starB.x, starB.y);

        if (d2 > 0 && d2 < minDist2) {
          // Stars too close, push apart
          const d = i32(Mathf.sqrt(d2 as f32));
          const overlap = MIN_STAR_DISTANCE - d;
          const pushDist = overlap / 2 + 1;

          const dx = starB.x - starA.x;
          const dy = starB.y - starA.y;

          // Normalize direction and apply push
          if (d > 0) {
            const pushX = (dx * pushDist) / d;
            const pushY = (dy * pushDist) / d;

            starA.x -= pushX;
            starA.y -= pushY;
            starB.x += pushX;
            starB.y += pushY;

            // Clamp both stars to bounds
            starA.x = clamp(starA.x, 10, MAP_WIDTH - 10);
            starA.y =
              clamp(starA.y - MAP_OFFSET_Y, 10, MAP_HEIGHT - 10) + MAP_OFFSET_Y;
            starB.x = clamp(starB.x, 10, MAP_WIDTH - 10);
            starB.y =
              clamp(starB.y - MAP_OFFSET_Y, 10, MAP_HEIGHT - 10) + MAP_OFFSET_Y;
          }
        }
      }
    }
  }
}

/**
 * Step 3: Connect local k-nearest neighbors with edge-crossing rejection
 * Based on 9B3. ImprovedLaneGeneration.md specification
 *
 * This creates clean, planar graphs by:
 * - Connecting each star to its k nearest neighbors
 * - Rejecting edges that would cross existing edges
 * - Limiting maximum lane length for tactical clarity
 *
 * OPTIMIZED: Uses simple min-finding instead of insertion sort
 * Complexity: O(n * n * k * e) where e is edge count
 *
 * Result: Clean lanes with no spaghetti intersections, stable for AI pathfinding
 */
function connectLocalNeighbors(
  stars: StarArray,
  edges: EdgeArray,
  k: i32,
  maxLane: i32,
): i32 {
  const maxD2 = maxLane * maxLane;
  let edgeCount = edges.length as i32;

  // Working arrays for candidate neighbors
  const candidateIdx = FixedArray.fromAddress<i32>(TEMP_MEM_START + 32);
  const candidateDist = FixedArray.fromAddress<i32>(TEMP_MEM_START + 128);
  const nearestIdx = FixedArray.fromAddress<i32>(TEMP_MEM_START + 224);

  // For each star, find k nearest neighbors and connect
  const numStars = stars.length as i32;
  for (let i = 0; i < numStars; i++) {
    const starI = stars.get(i);

    // Collect all candidates within max distance
    let candidateCount = 0;
    for (let j = 0; j < numStars; j++) {
      if (i == j) continue;

      const d = dist2(starI.x, starI.y, stars.get(j).x, stars.get(j).y);
      if (d <= maxD2) {
        candidateIdx.set(candidateCount, j);
        candidateDist.set(candidateCount, d);
        candidateCount++;
      }
    }

    // Select k nearest using simple min-finding
    const connectCount = candidateCount < k ? candidateCount : k;
    for (let t = 0; t < connectCount; t++) {
      // Find minimum distance in remaining candidates
      let minIdx = t;
      let minDist = candidateDist.get(t);
      for (let c = t + 1; c < candidateCount; c++) {
        if (candidateDist.get(c) < minDist) {
          minDist = candidateDist.get(c);
          minIdx = c;
        }
      }

      // Swap to position t
      if (minIdx != t) {
        const tempIdx = candidateIdx.get(t);
        const tempDist = candidateDist.get(t);
        candidateIdx.set(t, candidateIdx.get(minIdx));
        candidateDist.set(t, candidateDist.get(minIdx));
        candidateIdx.set(minIdx, tempIdx);
        candidateDist.set(minIdx, tempDist);
      }

      nearestIdx.set(t, candidateIdx.get(t));
    }

    // Connect to k nearest neighbors with crossing rejection
    for (let t = 0; t < connectCount; t++) {
      const j = nearestIdx.get(t);

      // Avoid duplicate edges (only add if i < j)
      if (j <= i) continue;

      // Check if edge already exists
      if (edgeExists(edges, edgeCount, i, j)) continue;

      const starJ = stars.get(j);
      let valid = true;

      // Check crossing against all existing edges
      for (let e = 0; e < edgeCount; e++) {
        const edge = edges.get(e);

        // Ignore shared endpoints (edges sharing a vertex can't "cross")
        if (edge.a == i || edge.a == j || edge.b == i || edge.b == j) {
          continue;
        }

        // Test if new edge (i, j) intersects existing edge (edge.a, edge.b)
        if (
          segmentsIntersect(
            starI.x,
            starI.y,
            starJ.x,
            starJ.y,
            stars.get(edge.a).x,
            stars.get(edge.a).y,
            stars.get(edge.b).x,
            stars.get(edge.b).y,
          )
        ) {
          valid = false;
          break;
        }
      }

      // Only add edge if it doesn't cross any existing edges
      if (valid) {
        edgeCount = addEdge(stars, edges, i, j);
      }
    }
  }

  return edgeCount;
}

/**
 * Step 4: Flood fill to find connected components
 */
function floodFillComponent(
  stars: StarArray,
  edges: EdgeArray,
  numEdges: i32,
  start: i32,
  component: FixedArray<i32>,
  visited: FixedArray<u8>,
): i32 {
  const stack = FixedArray.fromAddress<i32>(TEMP_MEM_START + 256);
  let stackSize = 0;
  let compSize = 0;

  stack.set(stackSize++, start);
  visited.set(start, 1);

  while (stackSize > 0) {
    const v = stack.get(--stackSize);
    component.set(compSize++, v);

    // Find all connected neighbors
    for (let i = 0; i < numEdges; i++) {
      const e = edges.get(i);
      let next = -1;

      if (e.a == v) next = e.b;
      else if (e.b == v) next = e.a;

      if (next >= 0 && visited.get(next) == 0) {
        visited.set(next, 1);
        stack.set(stackSize++, next);
      }
    }
  }

  return compSize;
}

/**
 * Step 4: Ensure full connectivity by bridging disconnected components
 * Now includes crossing rejection to maintain planar graph property
 */
function connectComponents(stars: StarArray, edges: EdgeArray): i32 {
  const numStars = stars.length as i32;
  const numEdges = edges.length as i32;

  let edgeCount = numEdges;
  let continueLoop = true;
  let iterations = 0;
  const maxIterations = numStars; // Safety limit to prevent infinite loops

  while (continueLoop && iterations < maxIterations) {
    iterations++;
    // Reset visited array
    const visited = FixedArray.fromAddress<u8>(TEMP_MEM_START + 512);
    for (let i = 0; i < numStars; i++) {
      visited.set(i, 0);
    }

    // Find all components
    const comp1 = FixedArray.fromAddress<i32>(TEMP_MEM_START + 600);
    const comp2 = FixedArray.fromAddress<i32>(TEMP_MEM_START + 700);
    let comp1Size = 0;
    let comp2Size = 0;
    let foundSecondComponent = false;

    // Find first component
    for (let i = 0; i < numStars; i++) {
      if (visited.get(i) == 0) {
        comp1Size = floodFillComponent(
          stars,
          edges,
          edgeCount,
          i,
          comp1,
          visited,
        );
        break;
      }
    }

    // Find second component (if exists)
    for (let i = 0; i < numStars; i++) {
      if (visited.get(i) == 0) {
        comp2Size = floodFillComponent(
          stars,
          edges,
          edgeCount,
          i,
          comp2,
          visited,
        );
        foundSecondComponent = true;
        break;
      }
    }

    if (!foundSecondComponent) {
      // Only one component, we're done
      continueLoop = false;
      break;
    }

    // Find closest non-crossing pair between components
    let bestA = -1;
    let bestB = -1;
    let bestD = 999999999;

    for (let i = 0; i < comp1Size; i++) {
      for (let j = 0; j < comp2Size; j++) {
        const a = comp1.get(i);
        const b = comp2.get(j);
        const d = dist2(
          stars.get(a).x,
          stars.get(a).y,
          stars.get(b).x,
          stars.get(b).y,
        );

        // Only consider this pair if it's closer AND doesn't cross existing edges
        if (d < bestD && !wouldCrossEdges(stars, edges, edgeCount, a, b)) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }

    // Connect closest non-crossing pair
    if (bestA >= 0 && bestB >= 0) {
      const prevCount = edgeCount;
      edgeCount = addEdge(stars, edges, bestA, bestB);
      // Safety check: if edge wasn't added, break to avoid infinite loop
      if (edgeCount == prevCount) {
        warni(
          "Failed to add bridge edge, breaking loop at iteration {}",
          iterations,
        );
        break;
      }
    } else {
      // No valid non-crossing connection found
      warni("No non-crossing bridge found at iteration {}", iterations);
      break;
    }
  }

  if (iterations >= maxIterations) {
    warni("connectComponents hit max iterations: {}", maxIterations);
  }

  return edgeCount;
}

/**
 * Step 5: Reduce dead ends by connecting them to second-nearest neighbor
 * OPTIMIZED: Limits the number of dead ends processed to avoid excessive iterations
 * Now includes crossing rejection to maintain planar graph property
 */
function reduceDeadEnds(stars: StarArray, edges: EdgeArray): i32 {
  const numStars = stars.length as i32;
  const numEdges = edges.length as i32;
  let edgeCount = numEdges;
  let processed = 0;
  const maxProcessed = numStars / 2; // Process at most half the stars

  for (let i = 0; i < numStars && processed < maxProcessed; i++) {
    if (stars.get(i).degree == 1) {
      // Find nearest non-connected, non-crossing neighbor within reasonable distance
      let best = -1;
      let bestD = 999999999;
      const maxSearchD2 = MAX_LANE_DISTANCE * MAX_LANE_DISTANCE;

      for (let j = 0; j < numStars; j++) {
        if (i == j) continue;

        const d = dist2(
          stars.get(i).x,
          stars.get(i).y,
          stars.get(j).x,
          stars.get(j).y,
        );
        if (d > maxSearchD2) continue; // Skip distant stars
        if (d >= bestD) continue; // Not better than current best

        // Check if edge doesn't already exist AND doesn't cross existing edges
        if (
          !edgeExists(edges, edgeCount, i, j) &&
          !wouldCrossEdges(stars, edges, edgeCount, i, j)
        ) {
          bestD = d;
          best = j;
        }
      }

      if (best >= 0) {
        edgeCount = addEdge(stars, edges, i, best);
        processed++;
      }
    }
  }

  return edgeCount;
}

/**
 * Step 6: Add extra loop edges for multiple routes
 * Now includes crossing rejection to maintain planar graph property
 */
function addLoops(stars: StarArray, edges: EdgeArray, extra: i32): i32 {
  const numStars = stars.length as i32;
  const numEdges = edges.length as i32;

  let edgeCount = numEdges;
  const maxLoopD2 = 55 * 55;
  let attempts = 0;
  let added = 0;
  const maxAttempts = extra * 10; // Try up to 10x the desired count

  while (added < extra && attempts < maxAttempts) {
    attempts++;

    const a = randomRange(numStars);
    const b = randomRange(numStars);

    if (a == b) continue;

    const d = dist2(
      stars.get(a).x,
      stars.get(a).y,
      stars.get(b).x,
      stars.get(b).y,
    );

    // Only add if within distance AND doesn't cross existing edges
    if (d < maxLoopD2 && !wouldCrossEdges(stars, edges, edgeCount, a, b)) {
      const prevCount = edgeCount;
      edgeCount = addEdge(stars, edges, a, b);
      if (edgeCount > prevCount) {
        added++;
      }
    }
  }

  return edgeCount;
}

/**
 * Step 7: Mark hub stars (highest degree nodes)
 */
function markHubs(stars: StarArray, hubCount: i32): void {
  const numStars = stars.length as i32;
  for (let h = 0; h < hubCount; h++) {
    let best = -1;
    let bestDeg = -1;

    for (let i = 0; i < numStars; i++) {
      if (stars.get(i).isHub != 0) continue;
      if (stars.get(i).degree > bestDeg) {
        bestDeg = stars.get(i).degree;
        best = i;
      }
    }

    if (best >= 0) {
      const star = stars.get(best);
      star.isHub = 1;
    }
  }
}

/**
 * Map a perimeter position to a star index in the grid
 * Perimeter goes: top (left→right), right (top→bottom), bottom (right→left), left (bottom→top)
 */
function getPerimeterStarIndex(
  perimPos: i32,
  gridCols: i32,
  gridRows: i32,
): i32 {
  const topLen = gridCols; // All columns in row 0
  const rightLen = gridRows - 1; // All rows except top, in last column
  const bottomLen = gridCols - 1; // All columns except last, in last row

  let row: i32;
  let col: i32;

  if (perimPos < topLen) {
    // Top edge: row=0, col=perimPos
    row = 0;
    col = perimPos;
  } else if (perimPos < topLen + rightLen) {
    // Right edge: rows 1 to gridRows-1 in last column
    row = perimPos - topLen + 1;
    col = gridCols - 1;
  } else if (perimPos < topLen + rightLen + bottomLen) {
    // Bottom edge: going right to left along last row
    const bottomOffset = perimPos - topLen - rightLen;
    row = gridRows - 1;
    col = gridCols - 2 - bottomOffset;
  } else {
    // Left edge: going bottom to top along first column
    const leftOffset = perimPos - topLen - rightLen - bottomLen;
    row = gridRows - 2 - leftOffset;
    col = 0;
  }

  return row * gridCols + col;
}

/**
 * Check if two stars are directly connected by an edge
 */
function areStarsConnected(
  edges: EdgeArray,
  numEdges: i32,
  starA: i32,
  starB: i32,
): bool {
  for (let i = 0; i < numEdges; i++) {
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

/**
 * Check if a potential exit star is directly connected to any existing exit
 */
function isConnectedToAnyExit(
  stars: StarArray,
  edges: EdgeArray,
  numStars: i32,
  numEdges: i32,
  candidateIdx: i32,
): bool {
  for (let i = 0; i < numStars; i++) {
    if (i == candidateIdx) continue;
    if (stars.get(i).isExit != 0) {
      if (areStarsConnected(edges, numEdges, candidateIdx, i)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Flag stars that are within nebula clouds
 */
function flagStarsInNebulas(stars: StarArray, nebulas: NebulaArray): void {
  const numStars = stars.length as i32;
  const numNebulas = nebulas.length as i32;

  for (let i = 0; i < numStars; i++) {
    const star = stars.get(i);
    star.inNebula = 0; // Reset flag

    // Check if star is within any nebula
    for (let n = 0; n < numNebulas; n++) {
      const nebula = nebulas.get(n);
      const d2 = dist2(star.x, star.y, nebula.x, nebula.y);
      const r2 = nebula.radius * nebula.radius;

      if (d2 <= r2) {
        star.inNebula = 1;
        break; // No need to check other nebulas
      }
    }
  }
}

/**
 * Generate nebula clouds for visual decoration
 * Uses grid-based placement to guarantee all nebulas are placed
 */
function generateNebulas(nebulas: NebulaArray, nebulaCount: i32): void {
  const MARGIN = 50;
  const MIN_RADIUS = 25;
  const MAX_RADIUS = 45;

  // Use grid-based placement to guarantee all nebulas are placed
  // Calculate grid dimensions to fit the required number of nebulas
  const gridCols = i32(Mathf.sqrt(nebulaCount as f32) + 0.5);
  const gridRows = (nebulaCount + gridCols - 1) / gridCols; // Ceiling division

  const cellWidth = (MAP_WIDTH - 2 * MARGIN) / gridCols;
  const cellHeight = (MAP_HEIGHT - 2 * MARGIN) / gridRows;

  // Calculate jitter to keep nebulas centered in cells while adding variety
  const jitterX = cellWidth / 3;
  const jitterY = cellHeight / 3;

  // Place one nebula per grid cell with random jitter
  const numNebulas = nebulas.length as i32;
  for (let row = 0; row < gridRows && numNebulas < nebulaCount; row++) {
    for (let col = 0; col < gridCols && numNebulas < nebulaCount; col++) {
      // Calculate cell center
      const centerX = MARGIN + col * cellWidth + cellWidth / 2;
      const centerY = MARGIN + row * cellHeight + cellHeight / 2;

      // Add random jitter around center
      const x = centerX + randomRange(jitterX * 2) - jitterX;
      const y = centerY + randomRange(jitterY * 2) - jitterY + MAP_OFFSET_Y;

      // Random radius
      const radius = MIN_RADIUS + randomRange(MAX_RADIUS - MIN_RADIUS + 1);

      // Place nebula (guaranteed placement, no rejection)
      const nebula = nebulas.grow();
      nebula.x = x;
      nebula.y = y;
      nebula.radius = radius;
    }
  }
}

/**
 * Step 8: Mark exit stars (nodes on the perimeter of the grid)
 * Uses the grid placement pattern to directly select perimeter stars
 * Ensures exits are not directly connected to each other by star lanes
 */
function markExits(
  stars: StarArray,
  edges: EdgeArray,
  gridCols: i32,
  gridRows: i32,
  exitCount: i32,
): void {
  const numStars = stars.length as i32;
  const numEdges = edges.length as i32;

  // Calculate perimeter length: 2*cols + 2*rows - 4 (for the 4 corners counted once)
  const perimeterLength = 2 * gridCols + 2 * gridRows - 4;

  // Mark exits by sampling random positions along the perimeter
  for (let e = 0; e < exitCount; e++) {
    let attempts = 0;
    let placed = false;

    // Try to find an unmarked, non-connected perimeter star
    while (!placed && attempts < 50) {
      attempts++;

      // Generate random position along perimeter
      const perimPos = randomRange(perimeterLength);

      // Map perimeter position to star index
      const starIdx = getPerimeterStarIndex(perimPos, gridCols, gridRows);

      // Check bounds and validate candidate
      if (starIdx >= 0 && starIdx < numStars) {
        const star = stars.get(starIdx);

        // Check: not already an exit AND not directly connected to any existing exit
        if (
          star.isExit == 0 &&
          !isConnectedToAnyExit(stars, edges, numStars, numEdges, starIdx)
        ) {
          star.isExit = 1;
          placed = true;
        }
      }
    }

    // If we couldn't find a valid exit after many attempts, warn but continue
    if (!placed) {
      warni("Could not place exit {} without lane conflicts", e);
    }
  }
}

/**
 * Main starmap generation function following 9B specification
 */
export function generateStarmap(): void {
  const totalStars = stars.capacity;
  // Calculate grid dimensions (same logic as generateStars)
  const gridCols = i32(
    Mathf.sqrt(((totalStars * MAP_WIDTH) as f32) / (MAP_HEIGHT as f32)),
  );
  const gridRows = i32((totalStars as f32) / (gridCols as f32) + 0.5);

  // Step 1: Place stars evenly using Poisson-like rejection
  generateStars(stars, gridCols, gridRows, MIN_STAR_DISTANCE);

  // Step 2: Apply cluster bias for visible clusters
  applyClusterBias(stars, NUM_CLUSTERS, CLUSTER_STRENGTH);

  // Step 3: Connect local k-nearest neighbors
  connectLocalNeighbors(stars, edges, K_NEIGHBORS, MAX_LANE_DISTANCE);

  // Step 4: Ensure full connectivity
  connectComponents(stars, edges);

  // Step 5: Reduce dead ends
  reduceDeadEnds(stars, edges);

  // Step 6: Add extra loops for multiple routes
  addLoops(stars, edges, EXTRA_LOOPS);

  // Step 7: Mark hubs and exits
  markHubs(stars, HUB_COUNT);
  markExits(stars, edges, gridCols, gridRows, EXIT_COUNT);

  // Step 8: Generate nebulas
  const numNebulas = MIN_NEBULAS + randomRange(MAX_NEBULAS - MIN_NEBULAS + 1);
  generateNebulas(nebulas, numNebulas);

  // Step 9: Flag stars within nebulas
  flagStarsInNebulas(stars, nebulas);

  logi(
    "Starmap generated: {} stars, {} lanes, {} nebulas",
    stars.length,
    edges.length,
    nebulas.length,
  );
}
