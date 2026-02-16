// Starline Pursuit - Random Starmap Generation
// Based on game design documents and StarMap.md Step 7 pseudocode

import {
  c,
  clearFramebuffer,
  drawLine,
  fillCircle,
  drawString,
  drawNumber,
  FixedArray,
  RAM_START,
  random,
  randomRange,
  log,
  logi,
  logf,
  getU8,
  setU8,
} from "../sdk";

// === Constants ===

const NUM_CLUSTERS: i32 = 5;
const STARS_PER_CLUSTER: i32 = 6;
const TOTAL_STARS: i32 = NUM_CLUSTERS * STARS_PER_CLUSTER; // 30 stars
const CLUSTER_SPREAD: i32 = 45; // pixels for cluster distribution
const MAX_EDGES: i32 = 40; // MST has 29, plus extra for loops
const EXTRA_EDGES: i32 = 8; // Additional edges beyond MST

// Visual constants
const STAR_RADIUS: i32 = 2;
const HUB_RADIUS: i32 = 3;
const MIN_HUB_CONNECTIONS: i32 = 4;
const MIN_STAR_DISTANCE: i32 = 15; // Minimum pixels between any two stars

// Screen bounds for cluster centers
const CLUSTER_MIN_X: i32 = 40;
const CLUSTER_MAX_X: i32 = 280;
const CLUSTER_MIN_Y: i32 = 40;
const CLUSTER_MAX_Y: i32 = 200;

// === @unmanaged Structures ===

/**
 * Star system node
 * Uses @unmanaged to work with FixedArray without heap allocation
 */
@unmanaged
class Star {
  x: i32;
  y: i32;
  connections: i32; // Track number of connections for hub detection

  constructor(x: i32 = 0, y: i32 = 0) {
    this.x = x;
    this.y = y;
    this.connections = 0;
  }
}

/**
 * Hyperspace lane edge
 * Connects two star systems
 */
@unmanaged
class Edge {
  from: u8;
  to: u8;

  constructor(from: u8 = 0, to: u8 = 0) {
    this.from = from;
    this.to = to;
  }
}

// === Memory Layout ===

enum Var {
  GAME_STATE = 0, // u8 (1 byte)
  NUM_STARS = 1, // u8 (1 byte)
  NUM_EDGES = 2, // u8 (1 byte)
  // padding to align to 4-byte boundary
  STARS_START = 4, // Star array: 30 stars × 12 bytes = 360 bytes
  // Stars end at 4 + 360 = 364
  EDGES_START = 368, // Edge array: 40 edges × 4 bytes = 160 bytes
  // Edges end at 368 + 160 = 528
  // Total memory: 528 bytes
}

// === Helper Functions ===

/**
 * Simple approximation of Gaussian distribution using Box-Muller transform
 * Returns a value centered around 'mean' with standard deviation 'stddev'
 * Uses f32 for precision in distribution
 */
function gaussian(mean: f32, stddev: f32): f32 {
  // Generate two uniform random values [0, 1)
  const u1 = (random() as f32) / 4294967296.0; // random() returns u32 [0, 2^32 - 1]
  const u2 = (random() as f32) / 4294967296.0;

  // Box-Muller transform
  const z0 = Mathf.sqrt(-2.0 * Mathf.log(u1)) * Mathf.cos(2.0 * Mathf.PI * u2);

  return mean + z0 * stddev;
}

/**
 * Calculate Manhattan distance between two stars
 * Used for MST edge selection (faster than Euclidean)
 */
function distance(stars: FixedArray<Star>, a: i32, b: i32): i32 {
  const starA = stars.get(a);
  const starB = stars.get(b);
  const dx = starA.x - starB.x;
  const dy = starA.y - starB.y;
  // Use absolute values for Manhattan distance
  return (dx >= 0 ? dx : -dx) + (dy >= 0 ? dy : -dy);
}

/**
 * Check if an edge already exists (in either direction)
 */
function edgeExists(
  edges: FixedArray<Edge>,
  numEdges: i32,
  a: u8,
  b: u8,
): bool {
  for (let i: i32 = 0; i < numEdges; i++) {
    const edge = edges.get(i);
    if ((edge.from == a && edge.to == b) || (edge.from == b && edge.to == a)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a position is too close to any existing star
 * Returns true if position is valid (not too close to others)
 */
function isValidStarPosition(
  stars: FixedArray<Star>,
  numStars: i32,
  x: i32,
  y: i32,
): bool {
  for (let i: i32 = 0; i < numStars; i++) {
    const existing = stars.get(i);
    const dx = existing.x - x;
    const dy = existing.y - y;
    const distSquared = dx * dx + dy * dy;
    const minDistSquared = MIN_STAR_DISTANCE * MIN_STAR_DISTANCE;

    if (distSquared < minDistSquared) {
      return false; // Too close to existing star
    }
  }
  return true; // Position is valid
}

/**
 * Generate random starmap with clusters and lanes
 * Implements algorithm from StarMap.md Step 7
 */
function generateStarmap(): void {
  const stars = FixedArray.fromAddress<Star>(RAM_START + Var.STARS_START);
  const edges = FixedArray.fromAddress<Edge>(RAM_START + Var.EDGES_START);

  let starIndex: i32 = 0;

  // Step 1: Place stars in clusters using grid-based placement for better coverage
  // Divide screen into a grid and place one cluster per grid cell
  const gridCols: i32 = 3;
  const gridRows: i32 = 2;
  const cellWidth: i32 = (CLUSTER_MAX_X - CLUSTER_MIN_X) / gridCols;
  const cellHeight: i32 = (CLUSTER_MAX_Y - CLUSTER_MIN_Y) / gridRows;

  for (let cluster: i32 = 0; cluster < NUM_CLUSTERS; cluster++) {
    // Calculate grid cell for this cluster (distribute evenly with wraparound)
    const gridX: i32 = cluster % gridCols;
    const gridY: i32 = (cluster / gridCols) % gridRows;

    // Pick cluster center within this grid cell with some randomness
    const cellMinX: i32 = CLUSTER_MIN_X + gridX * cellWidth;
    const cellMaxX: i32 = CLUSTER_MIN_X + (gridX + 1) * cellWidth;
    const cellMinY: i32 = CLUSTER_MIN_Y + gridY * cellHeight;
    const cellMaxY: i32 = CLUSTER_MIN_Y + (gridY + 1) * cellHeight;

    const cx = (randomRange(cellMaxX - cellMinX) + cellMinX) as f32;
    const cy = (randomRange(cellMaxY - cellMinY) + cellMinY) as f32;

    // Place stars around cluster center using Gaussian distribution
    // With collision detection to prevent stars from overlapping
    for (let i: i32 = 0; i < STARS_PER_CLUSTER; i++) {
      let placed = false;
      let attempts = 0;
      const maxAttempts = 50;

      while (!placed && attempts < maxAttempts) {
        const x = gaussian(cx, CLUSTER_SPREAD as f32);
        const y = gaussian(cy, CLUSTER_SPREAD as f32);

        // Clamp to screen bounds (with margins)
        let finalX = x as i32;
        let finalY = y as i32;
        if (finalX < 10) finalX = 10;
        if (finalX > 310) finalX = 310;
        if (finalY < 10) finalY = 10;
        if (finalY > 230) finalY = 230;

        // Check if position is valid (not too close to other stars)
        if (isValidStarPosition(stars, starIndex, finalX, finalY)) {
          stars[starIndex] = new Star(finalX, finalY);
          starIndex++;
          placed = true;
        }

        attempts++;
      }

      // If we couldn't place the star after max attempts, place it anyway
      // This ensures we always get the expected number of stars
      if (!placed) {
        const x = gaussian(cx, CLUSTER_SPREAD as f32);
        const y = gaussian(cy, CLUSTER_SPREAD as f32);
        let finalX = x as i32;
        let finalY = y as i32;
        if (finalX < 10) finalX = 10;
        if (finalX > 310) finalX = 310;
        if (finalY < 10) finalY = 10;
        if (finalY > 230) finalY = 230;
        stars[starIndex] = new Star(finalX, finalY);
        starIndex++;
      }
    }
  }

  setU8(Var.NUM_STARS, TOTAL_STARS as u8);

  // Step 2: Connect stars using Minimum Spanning Tree (Prim's algorithm)
  let edgeCount: i32 = 0;

  // Track which stars are connected
  const connected = FixedArray.fromAddress<u8>(
    RAM_START + Var.EDGES_START + 160,
  );
  const unconnected = FixedArray.fromAddress<u8>(
    RAM_START + Var.EDGES_START + 160 + 40,
  );

  // Initialize: first star is connected, rest are unconnected
  connected[0] = 0;
  let connectedCount: i32 = 1;
  let unconnectedCount: i32 = TOTAL_STARS - 1;

  for (let i: i32 = 1; i < TOTAL_STARS; i++) {
    unconnected[i - 1] = i as u8;
  }

  // Build MST
  while (unconnectedCount > 0) {
    let minDist: i32 = 999999;
    let bestConnected: i32 = -1;
    let bestUnconnected: i32 = -1;
    let bestUnconnectedIndex: i32 = -1;

    // Find shortest edge from connected to unconnected
    for (let c: i32 = 0; c < connectedCount; c++) {
      const connectedStar = connected[c] as i32;
      for (let u: i32 = 0; u < unconnectedCount; u++) {
        const unconnectedStar = unconnected[u] as i32;
        const dist = distance(stars, connectedStar, unconnectedStar);

        if (dist < minDist) {
          minDist = dist;
          bestConnected = connectedStar;
          bestUnconnected = unconnectedStar;
          bestUnconnectedIndex = u;
        }
      }
    }

    // Add edge
    if (bestConnected >= 0 && bestUnconnected >= 0) {
      edges[edgeCount] = new Edge(bestConnected as u8, bestUnconnected as u8);
      edgeCount++;

      // Update connection counts
      stars[bestConnected].connections++;
      stars[bestUnconnected].connections++;

      // Move star from unconnected to connected
      connected[connectedCount] = bestUnconnected as u8;
      connectedCount++;

      // Remove from unconnected (shift remaining elements)
      for (let i: i32 = bestUnconnectedIndex; i < unconnectedCount - 1; i++) {
        unconnected[i] = unconnected[i + 1];
      }
      unconnectedCount--;
    } else {
      break; // Safety exit
    }
  }

  // Step 3: Add extra random edges for loops and alternate paths
  let extraAdded: i32 = 0;
  let attempts: i32 = 0;
  const maxAttempts: i32 = 50;

  while (extraAdded < EXTRA_EDGES && attempts < maxAttempts) {
    const a = randomRange(TOTAL_STARS) as u8;
    const b = randomRange(TOTAL_STARS) as u8;
    attempts++;

    // Don't connect star to itself, and don't add duplicate edges
    if (a == b) continue;
    if (edgeExists(edges, edgeCount, a, b)) continue;

    // Check distance isn't too large (keeps map readable)
    const dist = distance(stars, a as i32, b as i32);
    if (dist < 100) {
      // Max lane distance to prevent clutter
      edges[edgeCount] = new Edge(a, b);
      edgeCount++;
      stars[a as i32].connections++;
      stars[b as i32].connections++;
      extraAdded++;
    }
  }

  setU8(Var.NUM_EDGES, edgeCount as u8);

  logi("Starmap generated: {} stars, {} lanes", TOTAL_STARS, edgeCount);
}

/**
 * Draw the complete starmap (stars and lanes)
 */
function drawStarmap(): void {
  const stars = FixedArray.fromAddress<Star>(RAM_START + Var.STARS_START);
  const edges = FixedArray.fromAddress<Edge>(RAM_START + Var.EDGES_START);
  const numEdges = getU8(Var.NUM_EDGES) as i32;

  // Draw lanes (edges) first so stars appear on top
  for (let i: i32 = 0; i < numEdges; i++) {
    const edge = edges.get(i);
    const starA = stars.get(edge.from as i32);
    const starB = stars.get(edge.to as i32);

    // Draw lane as a line
    drawLine(starA.x, starA.y, starB.x, starB.y, c(0x444444));
  }

  // Draw stars
  for (let i: i32 = 0; i < TOTAL_STARS; i++) {
    const star = stars.get(i);

    // Hub stars (4+ connections) are larger and colored differently
    if (star.connections >= MIN_HUB_CONNECTIONS) {
      fillCircle(star.x, star.y, HUB_RADIUS, c(0xffaa00)); // Orange hubs
    } else {
      fillCircle(star.x, star.y, STAR_RADIUS, c(0xaaccff)); // Blue normal stars
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
