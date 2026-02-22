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

// Game constants - Resources
export const STARTING_SENSOR_ENERGY: i32 = 10;
export const MAX_SENSOR_ENERGY: i32 = 10;
export const SE_REGEN_PER_TURN: i32 = 3;
export const STARTING_COMMAND_POINTS: i32 = 3;
export const MAX_COMMAND_POINTS: i32 = 3;
export const STARTING_DEPLOYMENT_KITS: i32 = 3;

// Fleet constants
export const MAX_PLAYER_SHIPS: i32 = 3;

// Detection constants
export const MAX_BEACONS: i32 = 10;
export const BEACON_RANGE: i32 = 45; // Detection radius in pixels
export const SCAN_RADIUS: i32 = 70; // Survey Cruiser active scan range
export const SCAN_COST: i32 = 2; // Sensor Energy cost for active scan

// Element sizes for @unmanaged classes (aligned to 4 bytes)
const STAR_SIZE: u32 = 16; // x(4) + y(4) + degree(4) + isHub(1) + isExit(1) + padding(2) = 16
const EDGE_SIZE: u32 = 8; // a(4) + b(4) = 8
const CLUSTER_SIZE: u32 = 8; // x(4) + y(4) = 8
const TARGET_SHIP_SIZE: u32 = 8; // currentStarIndex(4) + isActive(1) + padding(3) = 8
const PLAYER_SHIP_SIZE: u32 = 12; // shipType(4) + currentStarIndex(4) + movesThisTurn(4) = 12
const BEACON_SIZE: u32 = 8; // starIndex(4) + isActive(1) + isDetecting(1) + padding(2) = 8

// Visual constants
export const STAR_RADIUS: i32 = 2;
export const HUB_RADIUS: i32 = 4;
export const EXIT_RADIUS: i32 = 3;

// Screen bounds (with margins)
export const MAP_MARGIN: i32 = 7; // Top and bottom margin in pixels
export const MAP_WIDTH: i32 = SCREEN_WIDTH;
export const MAP_HEIGHT: i32 = SCREEN_HEIGHT - 2 * MAP_MARGIN; // 240 - 14 = 226
export const MAP_OFFSET_Y: i32 = MAP_MARGIN; // Offset to shift stars down from top

// === Enums ===

export enum GameState {
  PLAYING = 0,
  WON = 1,
  LOST = 2,
}

export enum ShipType {
  INTERCEPTOR = 0,
  SCOUT = 1,
  SURVEY_CRUISER = 2,
  BEACON_TENDER = 3,
}

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

/**
 * Target ship entity
 * The ship the player is trying to intercept
 */
@unmanaged
export class TargetShip {
  currentStarIndex: i32; // Index of the star the target is currently at
  isActive: u8; // 1 if target is in play, 0 otherwise

  constructor(starIndex: i32 = 0) {
    this.currentStarIndex = starIndex;
    this.isActive = 1;
  }
}

/**
 * Player ship (fleet unit)
 * Different types have different capabilities
 */
@unmanaged
export class PlayerShip {
  shipType: i32; // ShipType enum value
  currentStarIndex: i32; // Current star location
  movesThisTurn: i32; // Number of jumps used this turn

  constructor(type: i32 = ShipType.INTERCEPTOR, starIndex: i32 = 0) {
    this.shipType = type;
    this.currentStarIndex = starIndex;
    this.movesThisTurn = 0;
  }
}

/**
 * Beacon entity
 * Persistent sensor placed by Beacon Tender ships
 */
@unmanaged
export class Beacon {
  starIndex: i32; // Star where beacon is deployed
  isActive: u8; // 1 if deployed, 0 if slot is empty
  isDetecting: u8; // 1 if target is within range, 0 otherwise

  constructor(starIndex: i32 = 0, isActive: u8 = 0) {
    this.starIndex = starIndex;
    this.isActive = isActive;
    this.isDetecting = 0;
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
  CLUSTERS_START = 2412, // 3 clusters × 8 bytes = 24 bytes
  // Clusters end at 2412 + 24 = 2436
  TARGET_SHIP = 2436, // TargetShip: 8 bytes
  // Target ship ends at 2436 + 8 = 2444
  PLAYER_SHIPS_START = 2444, // PlayerShipArray: 4 bytes (elementSize) + 3 ships × 12 bytes = 40 bytes
  // Player ships end at 2444 + 40 = 2484
  BEACONS_START = 2484, // BeaconArray: 4 bytes (elementSize) + 10 beacons × 8 bytes = 84 bytes
  // Beacons end at 2484 + 84 = 2568
  ACTIVE_SHIP_INDEX = 2568, // i32 (4 bytes)
  SENSOR_ENERGY = 2572, // i32 (4 bytes)
  COMMAND_POINTS = 2576, // i32 (4 bytes)
  DEPLOYMENT_KITS = 2580, // i32 (4 bytes)
  TURN_COUNTER = 2584, // i32 (4 bytes) - for animation/pulsing
  SCAN_RESULT = 2588, // i32 (4 bytes) - target star index if detected, -1 if no contact, -2 if no active scan
  SCAN_TIMER = 2592, // i32 (4 bytes) - countdown frames for displaying scan result
  // End at 2596
  TEMP_WORK_START = 2596, // Working memory for algorithms (1024 bytes)
  // Total memory: ~3620 bytes
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

export type PlayerShipArray = FixedArrayOfObj<PlayerShip>;
export const playerShips: PlayerShipArray =
  FixedArrayOfObj.fromAddress<PlayerShip>(
    RAM_START + MemLayout.PLAYER_SHIPS_START,
    PLAYER_SHIP_SIZE,
    true,
  );

export type BeaconArray = FixedArrayOfObj<Beacon>;
export const beacons: BeaconArray = FixedArrayOfObj.fromAddress<Beacon>(
  RAM_START + MemLayout.BEACONS_START,
  BEACON_SIZE,
  true,
);

// Target ship instance (reinterprets memory at TARGET_SHIP address)
export function getTargetShip(): TargetShip {
  return changetype<TargetShip>(RAM_START + MemLayout.TARGET_SHIP);
}
