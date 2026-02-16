// Starline Pursuit - Random Starmap Generation
// Based on 9B. NewMapGeneration.md specification

import {
  c,
  clearFramebuffer,
  drawLine,
  drawNumber,
  drawString,
  fillCircle,
  FixedArray,
  getU8,
  log,
  logi,
  RAM_START,
  randomRange,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  setU8,
} from "../sdk";

// === Constants ===

const TOTAL_STARS: i32 = 25;
const MAX_EDGES: i32 = 80; // Generous capacity for edges
const MIN_STAR_DISTANCE: i32 = 20; // Minimum pixels between stars
const NUM_CLUSTERS: i32 = 3;
const CLUSTER_STRENGTH: f32 = 0.25;
const K_NEIGHBORS: i32 = 3; // k-nearest neighbors to connect
const MAX_LANE_DISTANCE: i32 = 55; // Max lane length
const EXTRA_LOOPS: i32 = 6;
const HUB_COUNT: i32 = 4;
const EXIT_COUNT: i32 = 5;

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
  NUM_EDGES = 2, // u8 (1 byte)
  // padding to align to 4-byte boundary
  STARS_START = 4, // Star array: 25 stars × 20 bytes = 500 bytes
  // Stars end at 4 + 500 = 504
  EDGES_START = 512, // Edge array: 80 edges × 8 bytes = 640 bytes
  // Edges end at 512 + 640 = 1152
  TEMP_WORK_START = 1152, // Working memory for algorithms (1024 bytes)
  // Total memory: ~2200 bytes
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
  edges: FixedArray<Edge>,
  numEdges: i32,
  a: i32,
  b: i32,
): bool {
  for (let i: i32 = 0; i < numEdges; i++) {
    const edge = edges.get(i);
    if ((edge.a == a && edge.b == b) || (edge.a == b && edge.b == a)) {
      return true;
    }
  }
  return false;
}

/**
 * Add edge and update degree counts
 */
function addEdge(
  stars: FixedArray<Star>,
  edges: FixedArray<Edge>,
  numEdges: i32,
  a: i32,
  b: i32,
): i32 {
  if (a == b) return numEdges;
  if (edgeExists(edges, numEdges, a, b)) return numEdges;

  edges[numEdges] = new Edge(a, b);
  stars[a].degree++;
  stars[b].degree++;
  return numEdges + 1;
}

/**
 * Step 1: Generate evenly spaced stars using Poisson-like rejection sampling
 */
function generateStars(stars: FixedArray<Star>, count: i32, minDist: i32): i32 {
  let numStars: i32 = 0;
  const minD2 = minDist * minDist;
  const maxAttempts = count * 200;
  let attempts = 0;

  while (numStars < count && attempts < maxAttempts) {
    attempts++;

    const x = 10 + randomRange(MAP_WIDTH - 20);
    const y = 10 + randomRange(MAP_HEIGHT - 20);
    logi("Placed star at ({}, {})", x, y);

    let ok = true;
    for (let i: i32 = 0; i < numStars; i++) {
      const s = stars.get(i);
      if (dist2(x, y, s.x, s.y) < minD2) {
        ok = false;
        break;
      }
    }

    if (ok) {
      logi("Placed star at ({}, {})", x, y);
      stars[numStars] = new Star(x, y);
      numStars++;
    }
  }

  return numStars;
}

/**
 * Step 2: Apply cluster bias to create visible clusters
 */
function applyClusterBias(
  stars: FixedArray<Star>,
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
    centersX[i] = 20 + randomRange(MAP_WIDTH - 40);
    centersY[i] = 20 + randomRange(MAP_HEIGHT - 40);
  }

  // Pull each star toward a random cluster center
  for (let i: i32 = 0; i < numStars; i++) {
    const s = stars.get(i);
    const c = randomRange(clusterCount);

    const dx = (centersX[c] - s.x) as f32;
    const dy = (centersY[c] - s.y) as f32;

    s.x += (dx * strength) as i32;
    s.y += (dy * strength) as i32;

    stars[i] = s;
  }
}

/**
 * Step 3: Connect local k-nearest neighbors
 */
function connectLocalNeighbors(
  stars: FixedArray<Star>,
  edges: FixedArray<Edge>,
  numStars: i32,
  numEdges: i32,
  k: i32,
  maxLane: i32,
): i32 {
  const maxD2 = maxLane * maxLane;
  let edgeCount = numEdges;

  // For each star, find k nearest neighbors and connect
  for (let i: i32 = 0; i < numStars; i++) {
    // Store nearest neighbors (index, distance squared)
    const nearestIdx = FixedArray.fromAddress<i32>(
      RAM_START + Var.TEMP_WORK_START + 32,
    );
    const nearestDist = FixedArray.fromAddress<i32>(
      RAM_START + Var.TEMP_WORK_START + 128,
    );
    let nearestCount: i32 = 0;

    // Find k nearest neighbors
    for (let j: i32 = 0; j < numStars; j++) {
      if (i == j) continue;

      const d = dist2(stars[i].x, stars[i].y, stars[j].x, stars[j].y);
      if (d > maxD2) continue;

      // Insert sorted by distance
      let inserted = false;
      for (let t: i32 = 0; t < nearestCount; t++) {
        if (d < nearestDist[t]) {
          // Shift everything right
          for (let s: i32 = nearestCount - 1; s >= t; s--) {
            if (s + 1 < k) {
              nearestIdx[s + 1] = nearestIdx[s];
              nearestDist[s + 1] = nearestDist[s];
            }
          }
          nearestIdx[t] = j;
          nearestDist[t] = d;
          inserted = true;
          if (nearestCount < k) nearestCount++;
          break;
        }
      }

      if (!inserted && nearestCount < k) {
        nearestIdx[nearestCount] = j;
        nearestDist[nearestCount] = d;
        nearestCount++;
      }
    }

    // Connect to nearest neighbors
    for (let t: i32 = 0; t < nearestCount; t++) {
      edgeCount = addEdge(stars, edges, edgeCount, i, nearestIdx[t]);
    }
  }

  return edgeCount;
}

/**
 * Step 4: Flood fill to find connected components
 */
function floodFillComponent(
  stars: FixedArray<Star>,
  edges: FixedArray<Edge>,
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

  stack[stackSize++] = start;
  visited[start] = 1;

  while (stackSize > 0) {
    const v = stack[--stackSize];
    component[compSize++] = v;

    // Find all connected neighbors
    for (let i: i32 = 0; i < numEdges; i++) {
      const e = edges.get(i);
      let next: i32 = -1;

      if (e.a == v) next = e.b;
      else if (e.b == v) next = e.a;

      if (next >= 0 && visited[next] == 0) {
        visited[next] = 1;
        stack[stackSize++] = next;
      }
    }
  }

  return compSize;
}

/**
 * Step 4: Ensure full connectivity by bridging disconnected components
 */
function connectComponents(
  stars: FixedArray<Star>,
  edges: FixedArray<Edge>,
  numStars: i32,
  numEdges: i32,
): i32 {
  let edgeCount = numEdges;
  let continueLoop = true;

  while (continueLoop) {
    // Reset visited array
    const visited = FixedArray.fromAddress<u8>(
      RAM_START + Var.TEMP_WORK_START + 512,
    );
    for (let i: i32 = 0; i < numStars; i++) {
      visited[i] = 0;
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
      if (visited[i] == 0) {
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
      if (visited[i] == 0) {
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
        const a = comp1[i];
        const b = comp2[j];
        const d = dist2(stars[a].x, stars[a].y, stars[b].x, stars[b].y);

        if (d < bestD) {
          bestD = d;
          bestA = a;
          bestB = b;
        }
      }
    }

    // Connect closest pair
    if (bestA >= 0 && bestB >= 0) {
      edgeCount = addEdge(stars, edges, edgeCount, bestA, bestB);
    } else {
      break;
    }
  }

  return edgeCount;
}

/**
 * Step 5: Reduce dead ends by connecting them to second-nearest neighbor
 */
function reduceDeadEnds(
  stars: FixedArray<Star>,
  edges: FixedArray<Edge>,
  numStars: i32,
  numEdges: i32,
): i32 {
  let edgeCount = numEdges;

  for (let i: i32 = 0; i < numStars; i++) {
    if (stars[i].degree == 1) {
      // Find nearest non-connected neighbor
      let best: i32 = -1;
      let bestD: i32 = 999999999;

      for (let j: i32 = 0; j < numStars; j++) {
        if (i == j) continue;
        if (edgeExists(edges, edgeCount, i, j)) continue;

        const d = dist2(stars[i].x, stars[i].y, stars[j].x, stars[j].y);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }

      if (best >= 0) {
        edgeCount = addEdge(stars, edges, edgeCount, i, best);
      }
    }
  }

  return edgeCount;
}

/**
 * Step 6: Add extra loop edges for multiple routes
 */
function addLoops(
  stars: FixedArray<Star>,
  edges: FixedArray<Edge>,
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

    const d = dist2(stars[a].x, stars[a].y, stars[b].x, stars[b].y);
    if (d < maxLoopD2) {
      edgeCount = addEdge(stars, edges, edgeCount, a, b);
    }
  }

  return edgeCount;
}

/**
 * Step 7: Mark hub stars (highest degree nodes)
 */
function markHubs(stars: FixedArray<Star>, numStars: i32, hubCount: i32): void {
  for (let h: i32 = 0; h < hubCount; h++) {
    let best: i32 = -1;
    let bestDeg: i32 = -1;

    for (let i: i32 = 0; i < numStars; i++) {
      if (stars[i].isHub != 0) continue;
      if (stars[i].degree > bestDeg) {
        bestDeg = stars[i].degree;
        best = i;
      }
    }

    if (best >= 0) {
      stars[best].isHub = 1;
    }
  }
}

/**
 * Step 8: Mark exit stars (nodes near map edges)
 */
function markExits(
  stars: FixedArray<Star>,
  numStars: i32,
  exitCount: i32,
): void {
  for (let e: i32 = 0; e < exitCount; e++) {
    let best: i32 = -1;
    let bestScore: i32 = -1;

    for (let i: i32 = 0; i < numStars; i++) {
      if (stars[i].isExit != 0) continue;

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
      stars[best].isExit = 1;
    }
  }
}

/**
 * Main starmap generation function following 9B specification
 */
function generateStarmap(): void {
  const stars = FixedArray.fromAddress<Star>(RAM_START + Var.STARS_START);
  const edges = FixedArray.fromAddress<Edge>(RAM_START + Var.EDGES_START);

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

  setU8(Var.NUM_EDGES, numEdges as u8);

  // Step 7: Mark hubs and exits
  markHubs(stars, numStars, HUB_COUNT);
  markExits(stars, numStars, EXIT_COUNT);

  logi("Starmap generated: {} stars, {} lanes", numStars, numEdges);
}

/**
 * Draw the complete starmap (stars and lanes)
 */
function drawStarmap(): void {
  const stars = FixedArray.fromAddress<Star>(RAM_START + Var.STARS_START);
  const edges = FixedArray.fromAddress<Edge>(RAM_START + Var.EDGES_START);
  const numStars = getU8(Var.NUM_STARS) as i32;
  const numEdges = getU8(Var.NUM_EDGES) as i32;

  // Draw lanes (edges) first so stars appear on top
  for (let i: i32 = 0; i < numEdges; i++) {
    const edge = edges.get(i);
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
  const numEdges = getU8(Var.NUM_EDGES);

  drawString(10, 220, "Stars:", c(0xaaaaaa));
  drawNumber(60, 220, numStars as i32, c(0xaaccff));

  drawString(120, 220, "Lanes:", c(0xaaaaaa));
  drawNumber(170, 220, numEdges as i32, c(0xaaccff));
}
