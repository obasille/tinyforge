import {
  FixedArrayOfObj,
  RAM_START,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from "../../sdk";

// === Constants ===
export const TOTAL_STARS: i32 = 50;
export const MAX_EDGES: i32 = 200; // Increased capacity for higher star counts
export const MIN_STAR_DISTANCE: i32 = 20; // Minimum pixels between stars
export const NUM_CLUSTERS: i32 = 3;
export const CLUSTER_STRENGTH: f32 = 0.25;
export const K_NEIGHBORS: i32 = 3; // k-nearest neighbors to connect
export const MAX_LANE_DISTANCE: i32 = 55; // Max lane length
export const EXTRA_LOOPS: i32 = 6;
export const HUB_COUNT: i32 = 4;
export const EXIT_COUNT: i32 = 3;

// Element sizes for @unmanaged classes (aligned to 4 bytes)
const STAR_SIZE: u32 = 16; // x(4) + y(4) + degree(4) + isHub(1) + isExit(1) + padding(2) = 16
const EDGE_SIZE: u32 = 8; // a(4) + b(4) = 8
const CLUSTER_SIZE: u32 = 8; // x(4) + y(4) = 8

// Visual constants
export const STAR_RADIUS: i32 = 2;
export const HUB_RADIUS: i32 = 4;
export const EXIT_RADIUS: i32 = 3;

// Screen bounds
export const MAP_WIDTH: i32 = SCREEN_WIDTH;
export const MAP_HEIGHT: i32 = SCREEN_HEIGHT;

// === @unmanaged Structures ===

/**
 * Star system node
 */
@unmanaged
export class Star {
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
export class Edge {
  a: i32;
  b: i32;

  constructor(a: i32 = 0, b: i32 = 0) {
    this.a = a;
    this.b = b;
  }
}

/**
 * Cluster center for star grouping
 * Used in the generation algorithm to create star clusters
 * Not directly rendered, but can be drawn for debugging
 */
@unmanaged
export class Cluster {
  x: i32;
  y: i32;

  constructor(x: i32 = 0, y: i32 = 0) {
    this.x = x;
    this.y = y;
  }
}

// === Memory Layout ===

export enum MemLayout {
  GAME_STATE = 0, // u8 (1 byte)
  NUM_STARS = 1, // u8 (1 byte)
  NUM_EDGES = 2, // u16 (2 bytes) - changed from u8 to support >255 edges
  // padding to align to 4-byte boundary
  STARS_START = 4, // StarArray: 4 bytes (elementSize) + 50 stars × 16 bytes = 804 bytes
  // Stars end at 4 + 804 = 808
  EDGES_START = 808, // EdgeArray: 4 bytes (elementSize) + 200 edges × 8 bytes = 1604 bytes
  // Edges end at 808 + 1604 = 2412
  CLUSTERS_START = 2412, // 3 clusters × 4 bytes = 12 bytes
  TEMP_WORK_START = 2424, // Working memory for algorithms (1024 bytes)
  // Total memory: ~3500 bytes
}

export type StarArray = FixedArrayOfObj<Star>;
export const stars: StarArray = FixedArrayOfObj.fromAddress<Star>(
  RAM_START + MemLayout.STARS_START,
  STAR_SIZE,
  true,
);

export type EdgeArray = FixedArrayOfObj<Edge>;
export const edges: EdgeArray = FixedArrayOfObj.fromAddress<Edge>(
  RAM_START + MemLayout.EDGES_START,
  EDGE_SIZE,
  true,
);

export type ClusterArray = FixedArrayOfObj<Cluster>;
export const clusters: ClusterArray = FixedArrayOfObj.fromAddress<Cluster>(
  RAM_START + MemLayout.CLUSTERS_START,
  CLUSTER_SIZE,
  true,
);
