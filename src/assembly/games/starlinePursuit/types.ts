import {
  FixedArrayOfObjWithCount,
  RAM_START,
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
} from "../../sdk";

// === Constants ===
export const MAX_TOTAL_STARS: i32 = 50;
export const MAX_EDGES: i32 = 200; // Increased capacity for higher star counts
export const MIN_STAR_DISTANCE: i32 = 20; // Minimum pixels between stars
export const NUM_CLUSTERS: i32 = 3;
export const CLUSTER_STRENGTH: f32 = 0.25;
export const K_NEIGHBORS: i32 = 3; // k-nearest neighbors to connect
export const MAX_LANE_DISTANCE: i32 = 55; // Max lane length
export const EXTRA_LOOPS: i32 = 6;
export const HUB_COUNT: i32 = 4;
export const EXIT_COUNT: i32 = 3;
export const MIN_NEBULAS: i32 = 2;
export const MAX_NEBULAS: i32 = 4;

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

export enum GamePhase {
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

export enum TargetType {
  SMUGGLER = 0, // Baseline evasive, prefers low sensor visibility
  PIRATE = 1, // Semi-aggressive, visits trade hubs
  GHOST = 2, // Stealth-heavy, highly unpredictable
  COURIER = 3, // High-speed, direct routes, 20% double jump
  DECOY_MASTER = 4, // Misinformation-based, creates false trails
  REBEL_COMMANDER = 5, // Strategic and adaptive opponent
  SLEEPER_AGENT = 6, // Hidden behavior, delayed reveal
}

// === @unmanaged Structures ===

/**
 * Star system node
 */
@unmanaged
export class Star {
  x: i32 = 0;
  y: i32 = 0;
  degree: i32 = 0; // Number of connections (edges)
  isHub: u8 = 0; // 1 if hub, 0 otherwise
  isExit: u8 = 0; // 1 if exit, 0 otherwise
  isPossibleTarget: u8 = 0; // 1 if target might be at this star, 0 otherwise
  inNebula: u8 = 0; // 1 if star is within a nebula cloud, 0 otherwise
}
const STAR_SIZE: u32 = 16; // x(4) + y(4) + degree(4) + isHub(1) + isExit(1) + isPossibleTarget(1) + inNebula(1) = 16 bytes

/**
 * Hyperspace lane edge
 * Connects two star systems
 */
@unmanaged
export class Edge {
  a: i32 = 0;
  b: i32 = 0;
}
const EDGE_SIZE: u32 = 8; // a(4) + b(4) = 8

/**
 * Cluster center for star grouping
 * Used in the generation algorithm to create star clusters
 * Not directly rendered, but can be drawn for debugging
 */
@unmanaged
export class Cluster {
  x: i32 = 0;
  y: i32 = 0;
}
const CLUSTER_SIZE: u32 = 8; // x(4) + y(4) = 8

/**
 * Nebula cloud region
 * Visual decoration on the starmap
 */
@unmanaged
export class Nebula {
  x: i32 = 0;
  y: i32 = 0;
  radius: i32 = 0;
}
const NEBULA_SIZE: u32 = 12; // x(4) + y(4) + radius(4) = 12

/**
 * Target ship entity
 * The ship the player is trying to intercept
 */
@unmanaged
export class TargetShip {
  currentStarIndex: i32 = 0; // Index of the star the target is currently at
  isActive: u8 = 1; // 1 if target is in play, 0 otherwise
}
const TARGET_SHIP_SIZE: u32 = 8; // currentStarIndex(4) + isActive(1) + padding(3) = 8

/**
 * Player ship (fleet unit)
 * Different types have different capabilities
 */
@unmanaged
export class PlayerShip {
  shipType: i32 = 0; // ShipType enum value
  currentStarIndex: i32 = 0; // Current star location
  movesThisTurn: i32 = 0; // Number of jumps used this turn
}
const PLAYER_SHIP_SIZE: u32 = 12; // shipType(4) + currentStarIndex(4) + movesThisTurn(4) = 12

/**
 * Beacon entity
 * Persistent sensor placed by Beacon Tender ships
 */
@unmanaged
export class Beacon {
  starIndex: i32 = 0; // Star where beacon is deployed
  isActive: u8 = 0; // 1 if deployed, 0 if slot is empty
  isDetecting: u8 = 0; // 1 if target is within range, 0 otherwise
  rangeAnimTimer: u8 = 0; // Animation timer for showing beacon range (60 frames = 1 second)
  pendingRangeAnim: u8 = 0; // 1 if animation should start after scanner completes, 0 otherwise
}
const BEACON_SIZE: u32 = 8; // starIndex(4) + isActive(1) + isDetecting(1) + rangeAnimTimer(1) + pendingRangeAnim(1) = 8

/**
 * Game state data
 * Consolidated game state fields in a single @unmanaged structure
 */
@unmanaged
export class GameState {
  phase: u8 = 0; // GamePhase enum value
  targetType: u8 = 0; // TargetType enum value
  scannerPhase: u8 = 0; // 0=sweep down, 1=sweep up, 2=done
  // 1 byte padding for alignment
  sensorEnergy: i32 = 0;
  commandPoints: i32 = 0;
  deploymentKits: i32 = 0;
  activeShipIndex: i32 = 0;
  frameCounter: i32 = 0;
  scanResult: i32 = -2; // Target star index if detected, -1 if no contact, -2 if no active scan
  scanTimer: i32 = 0; // Countdown frames for displaying scan result
  initialRevealTimer: i32 = 0; // Countdown frames for initial target reveal animation
  scannerY: i32 = -1; // Vertical scanner position (-1 = inactive)
  missionBriefingDismissed: i32 = 0; // 0 = show briefing, 1 = briefing dismissed
  turnNumber: i32 = 0; // Current turn number (starts at 1)
}
const GAME_STATE_DATA_SIZE: u32 = 44; // phase(1) + targetType(1) + scannerPhase(1) + padding(1) + 10 i32 fields(40) = 44 bytes

// === Memory Layout ===

export type StarArray = FixedArrayOfObjWithCount<Star>;
export const stars: StarArray = FixedArrayOfObjWithCount.fromAddress<Star>(
  RAM_START,
  STAR_SIZE,
  MAX_TOTAL_STARS as u16,
  true,
);

export type EdgeArray = FixedArrayOfObjWithCount<Edge>;
export const edges: EdgeArray = FixedArrayOfObjWithCount.fromAddress<Edge>(
  changetype<usize>(stars) + stars.alignedMemorySize,
  EDGE_SIZE,
  MAX_EDGES as u16,
  true,
);

export type ClusterArray = FixedArrayOfObjWithCount<Cluster>;
export const clusters: ClusterArray =
  FixedArrayOfObjWithCount.fromAddress<Cluster>(
    changetype<usize>(edges) + edges.alignedMemorySize,
    CLUSTER_SIZE,
    NUM_CLUSTERS as u16,
    true,
  );

export type NebulaArray = FixedArrayOfObjWithCount<Nebula>;
export const nebulas: NebulaArray =
  FixedArrayOfObjWithCount.fromAddress<Nebula>(
    changetype<usize>(clusters) + clusters.alignedMemorySize,
    NEBULA_SIZE,
    MAX_NEBULAS as u16,
    true,
  );

export type PlayerShipArray = FixedArrayOfObjWithCount<PlayerShip>;
export const playerShips: PlayerShipArray =
  FixedArrayOfObjWithCount.fromAddress<PlayerShip>(
    changetype<usize>(nebulas) + nebulas.alignedMemorySize,
    PLAYER_SHIP_SIZE,
    MAX_PLAYER_SHIPS as u16,
    true,
  );

export type BeaconArray = FixedArrayOfObjWithCount<Beacon>;
export const beacons: BeaconArray =
  FixedArrayOfObjWithCount.fromAddress<Beacon>(
    changetype<usize>(playerShips) + playerShips.alignedMemorySize,
    BEACON_SIZE,
    MAX_BEACONS as u16,
    true,
  );

// Target ship instance (reinterprets memory at TARGET_SHIP address)
export const targetShip: TargetShip = changetype<TargetShip>(
  changetype<usize>(beacons) + beacons.alignedMemorySize,
);

// Game state data instance (reinterprets memory at GAME_STATE_DATA address)
export const gameState: GameState = changetype<GameState>(
  changetype<usize>(targetShip) + TARGET_SHIP_SIZE,
);

// Starting address for temporary arrays during calculations
export const TEMP_MEM_START: usize =
  changetype<usize>(gameState) + GAME_STATE_DATA_SIZE;
