// Starline Pursuit - Random Starmap Generation
// Based on 9B. NewMapGeneration.md specification

import {
  c,
  clamp,
  clearFramebuffer,
  drawLine,
  drawNumber,
  drawString,
  fillCircle,
  FixedArray,
  FixedArrayOfObj,
  getU8,
  getU16,
  log,
  logi,
  RAM_START,
  randomRange,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  setU8,
  setU16,
  warni,
} from "../sdk";

// === Constants ===

const TOTAL_STARS: i32 = 50;
const MAX_EDGES: i32 = 200; // Increased capacity for higher star counts
const MIN_STAR_DISTANCE: i32 = 20; // Minimum pixels between stars
const NUM_CLUSTERS: i32 = 3;
const CLUSTER_STRENGTH: f32 = 0.25;
const K_NEIGHBORS: i32 = 3; // k-nearest neighbors to connect
const MAX_LANE_DISTANCE: i32 = 55; // Max lane length
const EXTRA_LOOPS: i32 = 6;
const HUB_COUNT: i32 = 4;
const EXIT_COUNT: i32 = 5;

// Element sizes for @unmanaged classes (aligned to 4 bytes)
const STAR_SIZE: u32 = 16; // x(4) + y(4) + degree(4) + isHub(1) + isExit(1) + padding(2) = 16
const EDGE_SIZE: u32 = 8; // a(4) + b(4) = 8

// Visual constants
const STAR_RADIUS: i32 = 2;
const HUB_RADIUS: i32 = 4;
const EXIT_RADIUS: i32 = 3;

// Screen bounds
const MAP_WIDTH: i32 = SCREEN_WIDTH;
const MAP_HEIGHT: i32 = SCREEN_HEIGHT;

// === @unmanaged Structures ===

/**
 * Star system node
 * Uses @unmanaged to work with FixedArray without heap allocation
 */
@unmanaged
class Star {
  x: i32;
  y: i32;
  degree: i32; // Number of connections (edges)
  isHub: u8; // 1 if hub, 0 otherwise
  isExit: u8; // 1 if exit, 0 otherwise

  constructor(x: i32 = 0, y: i32 = 0) {
    this.x = x;
    this.y = y;
    this.degree = 0;
    this.isHub = 0;
    this.isExit = 0;
  }
}

/**
 * Hyperspace lane edge
 * Connects two star systems
 */
@unmanaged
class Edge {
  a: i32;
  b: i32;

  constructor(a: i32 = 0, b: i32 = 0) {
    this.a = a;
    this.b = b;
  }
}

// === Memory Layout ===

enum Var {
  GAME_STATE = 0, // u8 (1 byte)
  NUM_STARS = 1, // u8 (1 byte)
  NUM_EDGES = 2, // u16 (2 bytes) - changed from u8 to support >255 edges
  // padding to align to 4-byte boundary
  STARS_START = 4, // FixedArrayOfObj<Star>: 4 bytes (elementSize) + 50 stars × 16 bytes = 804 bytes
  // Stars end at 4 + 804 = 808
  EDGES_START = 808, // FixedArrayOfObj<Edge>: 4 bytes (elementSize) + 200 edges × 8 bytes = 1604 bytes
  // Edges end at 808 + 1604 = 2412
  TEMP_WORK_START = 2412, // Working memory for algorithms (1024 bytes)
  // Total memory: ~3500 bytes
}

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
 * Check if an edge already exists (in either direction)
 */
function edgeExists(
  edges: FixedArrayOfObj<Edge>,
  numEdges: i32,
  a: i32,
  b: i32,
): bool {
  for (let i: i32 = 0; i < numEdges; i++) {
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
 * Add edge and update degree counts
 * Zero allocation: uses direct property assignment
 */
function addEdge(
  stars: FixedArrayOfObj<Star>,
  edges: FixedArrayOfObj<Edge>,
  numEdges: i32,
  a: i32,
  b: i32,
): i32 {
  if (a == b) return numEdges;
  if (edgeExists(edges, numEdges, a, b)) return numEdges;
  if (numEdges >= MAX_EDGES) {
    warni("Max edges reached: {}", MAX_EDGES);
    return numEdges;
  }

  // Zero allocation pattern - reinterpret existing memory
  const edge = edges.get(numEdges);
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
  stars: FixedArrayOfObj<Star>,
  count: i32,
  minDist: i32,
): i32 {
  // Calculate grid dimensions for stratified sampling
  const gridCols = i32(
    Mathf.sqrt(((count * MAP_WIDTH) as f32) / (MAP_HEIGHT as f32)),
  );
  const gridRows = i32((count as f32) / (gridCols as f32) + 0.5);
  const cellWidth = MAP_WIDTH / gridCols;
  const cellHeight = MAP_HEIGHT / gridRows;

  // Maximum jitter is half cell size minus half minDist to ensure spacing
  const jitterX = max(1, cellWidth / 2 - minDist / 2);
  const jitterY = max(1, cellHeight / 2 - minDist / 2);

  let numStars: i32 = 0;

  // Place one star per grid cell with random jitter
  for (let row: i32 = 0; row < gridRows && numStars < count; row++) {
    for (let col: i32 = 0; col < gridCols && numStars < count; col++) {
      // Calculate cell center
      const centerX = col * cellWidth + cellWidth / 2;
      const centerY = row * cellHeight + cellHeight / 2;

      // Add random jitter around center
      const x = centerX + randomRange(jitterX * 2) - jitterX;
      const y = centerY + randomRange(jitterY * 2) - jitterY;

      // Clamp to map bounds with margin
      const finalX = clamp(x, 10, MAP_WIDTH - 10);
      const finalY = clamp(y, 10, MAP_HEIGHT - 10);

      // Zero allocation pattern - reinterpret existing memory
      const star = stars.get(numStars);
      star.x = finalX;
      star.y = finalY;
      star.degree = 0;
      star.isHub = 0;
      star.isExit = 0;
      numStars++;
    }
  }

  return numStars;
}

/**
 * Step 2: Apply cluster bias to create visible clusters
 */
function applyClusterBias(
  stars: FixedArrayOfObj<Star>,
  numStars: i32,
  clusterCount: i32,
  strength: f32,
): void {
  // Generate cluster centers
  const centersX = FixedArray.fromAddress<i32>(RAM_START + Var.TEMP_WORK_START);
  const centersY = FixedArray.fromAddress<i32>(
    RAM_START + Var.TEMP_WORK_START + 16,
  );

  for (let i: i32 = 0; i < clusterCount; i++) {
    centersX.set(i, 20 + randomRange(MAP_WIDTH - 40));
    centersY.set(i, 20 + randomRange(MAP_HEIGHT - 40));
  }

  // Pull each star toward a random cluster center
  for (let i: i32 = 0; i < numStars; i++) {
    const s = stars.get(i);
    const c = randomRange(clusterCount);

    const dx = (centersX.get(c) - s.x) as f32;
    const dy = (centersY.get(c) - s.y) as f32;

    s.x += (dx * strength) as i32;
    s.y += (dy * strength) as i32;

    // Clamp to ensure we stay in bounds after clustering
    s.x = clamp(s.x, 5, MAP_WIDTH - 5);
    s.y = clamp(s.y, 5, MAP_HEIGHT - 5);
  }
}

/**
 * Step 3: Connect local k-nearest neighbors
 * OPTIMIZED: Uses simple min-finding instead of insertion sort
 * Complexity: O(n * n * k) instead of O(n * n * k^2)
 */
function connectLocalNeighbors(
  stars: FixedArrayOfObj<Star>,
  edges: FixedArrayOfObj<Edge>,
  numStars: i32,
  numEdges: i32,
  k: i32,
  maxLane: i32,
): i32 {
  const maxD2 = maxLane * maxLane;
  let edgeCount = numEdges;

  // Working arrays for candidate neighbors
  const candidateIdx = FixedArray.fromAddress<i32>(
    RAM_START + Var.TEMP_WORK_START + 32,
  );
  const candidateDist = FixedArray.fromAddress<i32>(
    RAM_START + Var.TEMP_WORK_START + 128,
  );
  const nearestIdx = FixedArray.fromAddress<i32>(
    RAM_START + Var.TEMP_WORK_START + 224,
  );

  // For each star, find k nearest neighbors and connect
  for (let i: i32 = 0; i < numStars; i++) {
    // Collect all candidates within max distance
    let candidateCount: i32 = 0;
    for (let j: i32 = 0; j < numStars; j++) {
      if (i == j) continue;

      const d = dist2(
        stars.get(i).x,
        stars.get(i).y,
        stars.get(j).x,
        stars.get(j).y,
      );
      if (d <= maxD2) {
        candidateIdx.set(candidateCount, j);
        candidateDist.set(candidateCount, d);
        candidateCount++;
      }
    }

    // Select k nearest using simple min-finding
    const connectCount = candidateCount < k ? candidateCount : k;
    for (let t: i32 = 0; t < connectCount; t++) {
      // Find minimum distance in remaining candidates
      let minIdx: i32 = t;
      let minDist: i32 = candidateDist.get(t);
      for (let c: i32 = t + 1; c < candidateCount; c++) {
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

    // Connect to k nearest neighbors
    for (let t: i32 = 0; t < connectCount; t++) {
      edgeCount = addEdge(stars, edges, edgeCount, i, nearestIdx.get(t));
    }
  }

  return edgeCount;
}

/**
 * Step 4: Flood fill to find connected components
 */
function floodFillComponent(
  stars: FixedArrayOfObj<Star>,
  edges: FixedArrayOfObj<Edge>,
  numEdges: i32,
  start: i32,
  component: FixedArray<i32>,
  visited: FixedArray<u8>,
): i32 {
  const stack = FixedArray.fromAddress<i32>(
    RAM_START + Var.TEMP_WORK_START + 256,
  );
  let stackSize: i32 = 0;
  let compSize: i32 = 0;

  stack.set(stackSize++, start);
  visited.set(start, 1);

  while (stackSize > 0) {
    const v = stack.get(--stackSize);
    component.set(compSize++, v);

    // Find all connected neighbors
    for (let i: i32 = 0; i < numEdges; i++) {
      const e = edges.get(i);
      let next: i32 = -1;

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
 */
function connectComponents(
  stars: FixedArrayOfObj<Star>,
  edges: FixedArrayOfObj<Edge>,
  numStars: i32,
  numEdges: i32,
): i32 {
  let edgeCount = numEdges;
  let continueLoop = true;
  let iterations: i32 = 0;
  const maxIterations = numStars; // Safety limit to prevent infinite loops

  while (continueLoop && iterations < maxIterations) {
    iterations++;
    // Reset visited array
    const visited = FixedArray.fromAddress<u8>(
      RAM_START + Var.TEMP_WORK_START + 512,
    );
    for (let i: i32 = 0; i < numStars; i++) {
      visited.set(i, 0);
    }

    // Find all components
    const comp1 = FixedArray.fromAddress<i32>(
      RAM_START + Var.TEMP_WORK_START + 600,
    );
    const comp2 = FixedArray.fromAddress<i32>(
      RAM_START + Var.TEMP_WORK_START + 700,
    );
    let comp1Size: i32 = 0;
    let comp2Size: i32 = 0;
    let foundSecondComponent = false;

    // Find first component
    for (let i: i32 = 0; i < numStars; i++) {
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
    for (let i: i32 = 0; i < numStars; i++) {
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

    // Find closest pair between components
    let bestA: i32 = -1;
    let bestB: i32 = -1;
    let bestD: i32 = 999999999;

    for (let i: i32 = 0; i < comp1Size; i++) {
      for (let j: i32 = 0; j < comp2Size; j++) {
        const a = comp1.get(i);
        const b = comp2.get(j);
        const d = dist2(
          stars.get(a).x,
          stars.get(a).y,
          stars.get(b).x,
          stars.get(b).y,
        );

        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }

    // Connect closest pair
    if (bestA >= 0 && bestB >= 0) {
      const prevCount = edgeCount;
      edgeCount = addEdge(stars, edges, edgeCount, bestA, bestB);
      // Safety check: if edge wasn't added, break to avoid infinite loop
      if (edgeCount == prevCount) {
        warni(
          "Failed to add bridge edge, breaking loop at iteration {}",
          iterations,
        );
        break;
      }
    } else {
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
 */
function reduceDeadEnds(
  stars: FixedArrayOfObj<Star>,
  edges: FixedArrayOfObj<Edge>,
  numStars: i32,
  numEdges: i32,
): i32 {
  let edgeCount = numEdges;
  let processed: i32 = 0;
  const maxProcessed = numStars / 2; // Process at most half the stars

  for (let i: i32 = 0; i < numStars && processed < maxProcessed; i++) {
    if (stars.get(i).degree == 1) {
      // Find nearest non-connected neighbor within reasonable distance
      let best: i32 = -1;
      let bestD: i32 = 999999999;
      const maxSearchD2 = MAX_LANE_DISTANCE * MAX_LANE_DISTANCE;

      for (let j: i32 = 0; j < numStars; j++) {
        if (i == j) continue;

        const d = dist2(
          stars.get(i).x,
          stars.get(i).y,
          stars.get(j).x,
          stars.get(j).y,
        );
        if (d > maxSearchD2) continue; // Skip distant stars
        if (d >= bestD) continue; // Not better than current best

        // Only check edgeExists if this would be our new best
        if (!edgeExists(edges, edgeCount, i, j)) {
          bestD = d;
          best = j;
        }
      }

      if (best >= 0) {
        edgeCount = addEdge(stars, edges, edgeCount, i, best);
        processed++;
      }
    }
  }

  return edgeCount;
}

/**
 * Step 6: Add extra loop edges for multiple routes
 */
function addLoops(
  stars: FixedArrayOfObj<Star>,
  edges: FixedArrayOfObj<Edge>,
  numStars: i32,
  numEdges: i32,
  extra: i32,
): i32 {
  let edgeCount = numEdges;
  const maxLoopD2 = 55 * 55;

  for (let i: i32 = 0; i < extra; i++) {
    const a = randomRange(numStars);
    const b = randomRange(numStars);

    if (a == b) continue;

    const d = dist2(
      stars.get(a).x,
      stars.get(a).y,
      stars.get(b).x,
      stars.get(b).y,
    );
    if (d < maxLoopD2) {
      edgeCount = addEdge(stars, edges, edgeCount, a, b);
    }
  }

  return edgeCount;
}

/**
 * Step 7: Mark hub stars (highest degree nodes)
 */
function markHubs(
  stars: FixedArrayOfObj<Star>,
  numStars: i32,
  hubCount: i32,
): void {
  for (let h: i32 = 0; h < hubCount; h++) {
    let best: i32 = -1;
    let bestDeg: i32 = -1;

    for (let i: i32 = 0; i < numStars; i++) {
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
 * Step 8: Mark exit stars (nodes near map edges)
 */
function markExits(
  stars: FixedArrayOfObj<Star>,
  numStars: i32,
  exitCount: i32,
): void {
  for (let e: i32 = 0; e < exitCount; e++) {
    let best: i32 = -1;
    let bestScore: i32 = -1;

    for (let i: i32 = 0; i < numStars; i++) {
      if (stars.get(i).isExit != 0) continue;

      const s = stars.get(i);
      let score: i32 = 0;
      if (s.x < 40) score++;
      if (s.x > 280) score++;
      if (s.y < 40) score++;
      if (s.y > 200) score++;

      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    if (best >= 0) {
      const star = stars.get(best);
      star.isExit = 1;
    }
  }
}

/**
 * Main starmap generation function following 9B specification
 */
function generateStarmap(): void {
  const stars = FixedArrayOfObj.fromAddress<Star>(
    RAM_START + Var.STARS_START,
    STAR_SIZE,
    true,
  );
  const edges = FixedArrayOfObj.fromAddress<Edge>(
    RAM_START + Var.EDGES_START,
    EDGE_SIZE,
    true,
  );

  // Initialize ALL stars to invalid values first to prevent garbage data
  for (let i: i32 = 0; i < TOTAL_STARS; i++) {
    const star = stars.get(i);
    star.x = -1;
    star.y = -1;
    star.degree = 0;
    star.isHub = 0;
    star.isExit = 0;
  }

  // Initialize ALL edges to invalid values to prevent garbage data
  for (let i: i32 = 0; i < MAX_EDGES; i++) {
    const edge = edges.get(i);
    edge.a = -1;
    edge.b = -1;
  }

  // Step 1: Place stars evenly using Poisson-like rejection
  const numStars = generateStars(stars, TOTAL_STARS, MIN_STAR_DISTANCE);
  setU8(Var.NUM_STARS, numStars as u8);

  // Step 2: Apply cluster bias for visible clusters
  applyClusterBias(stars, numStars, NUM_CLUSTERS, CLUSTER_STRENGTH);

  // Step 3: Connect local k-nearest neighbors
  let numEdges: i32 = 0;
  numEdges = connectLocalNeighbors(
    stars,
    edges,
    numStars,
    numEdges,
    K_NEIGHBORS,
    MAX_LANE_DISTANCE,
  );

  // Step 4: Ensure full connectivity
  numEdges = connectComponents(stars, edges, numStars, numEdges);

  // Step 5: Reduce dead ends
  numEdges = reduceDeadEnds(stars, edges, numStars, numEdges);

  // Step 6: Add extra loops for multiple routes
  numEdges = addLoops(stars, edges, numStars, numEdges, EXTRA_LOOPS);

  setU16(Var.NUM_EDGES, numEdges as u16);

  // Step 7: Mark hubs and exits
  markHubs(stars, numStars, HUB_COUNT);
  markExits(stars, numStars, EXIT_COUNT);

  logi("Starmap generated: {} stars, {} lanes", numStars, numEdges);
}

/**
 * Draw the complete starmap (stars and lanes)
 */
function drawStarmap(): void {
  const stars = FixedArrayOfObj.fromAddress<Star>(
    RAM_START + Var.STARS_START,
    STAR_SIZE,
    true,
  );
  const edges = FixedArrayOfObj.fromAddress<Edge>(
    RAM_START + Var.EDGES_START,
    EDGE_SIZE,
    true,
  );
  const numStars = getU8(Var.NUM_STARS) as i32;
  const numEdges = getU16(Var.NUM_EDGES) as i32;

  // Safety check: ensure values are reasonable
  if (numStars <= 0 || numStars > TOTAL_STARS) {
    warni("Invalid numStars: {}, expected 1-{}", numStars, TOTAL_STARS);
    return;
  }
  if (numEdges < 0 || numEdges > MAX_EDGES) {
    warni("Invalid numEdges: {}, expected 0-{}", numEdges, MAX_EDGES);
    return;
  }

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

    // Aggressively clamp with MARGIN to avoid Bresenham edge cases
    // drawLine's Bresenham can increment coords past max before loop terminates
    // So we keep 1-pixel margin from the edge
    const x0 = clamp(starA.x, 1, SCREEN_WIDTH - 2);
    const y0 = clamp(starA.y, 1, SCREEN_HEIGHT - 2);
    const x1 = clamp(starB.x, 1, SCREEN_WIDTH - 2);
    const y1 = clamp(starB.y, 1, SCREEN_HEIGHT - 2);

    // Draw lane as a line with guaranteed safe coordinates
    drawLine(x0, y0, x1, y1, c(0x444444));
  }

  // Draw stars with different colors/sizes based on type
  for (let i: i32 = 0; i < numStars; i++) {
    const star = stars.get(i);

    // Clamp coordinates with margin for safety
    const x = clamp(star.x, 1, SCREEN_WIDTH - 2);
    const y = clamp(star.y, 1, SCREEN_HEIGHT - 2);

    if (star.isExit != 0) {
      // Exit nodes: green
      fillCircle(x, y, EXIT_RADIUS, c(0x00ff00));
    } else if (star.isHub != 0) {
      // Hub nodes: orange
      fillCircle(x, y, HUB_RADIUS, c(0xffaa00));
    } else {
      // Normal stars: light blue
      fillCircle(x, y, STAR_RADIUS, c(0xaaccff));
    }
  }
}

// === Lifecycle Functions ===

export function init(): void {
  log("Starline Pursuit: Initializing");

  // Generate the starmap
  generateStarmap();

  log("Starmap ready");
}

export function update(): void {
  // For now, just maintain static display
  // Game logic will be added later
}

export function draw(): void {
  clearFramebuffer(c(0x0a0a1a)); // Dark blue-black space background

  // Draw the starmap
  drawStarmap();

  // Draw title
  // drawString(10, 10, "STARLINE PURSUIT", c(0xffffff));
  // drawString(10, 20, "Random Starmap Generation", c(0xaaaaaa));

  // Draw stats
  const numStars = getU8(Var.NUM_STARS);
  const numEdges = getU16(Var.NUM_EDGES);

  drawString(10, 220, "Stars:", c(0xaaaaaa));
  drawNumber(60, 220, numStars as i32, c(0xaaccff));

  drawString(120, 220, "Lanes:", c(0xaaaaaa));
  drawNumber(170, 220, numEdges as i32, c(0xaaccff));
}
