// Starline Pursuit - Random Starmap Generation
// Based on 9B. NewMapGeneration.md specification

import {
  c,
  clearFramebuffer,
  drawNumber,
  drawString,
  getU16,
  getU8,
  log,
} from "../sdk";

import { drawStarmap } from "./starlinePursuit/drawStarmap";
import { generateStarmap } from "./starlinePursuit/generateStarmap";
import { MemLayout } from "./starlinePursuit/types";

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
  const numStars = getU8(MemLayout.NUM_STARS);
  const numEdges = getU16(MemLayout.NUM_EDGES);

  drawString(10, 220, "Stars:", c(0xaaaaaa));
  drawNumber(60, 220, numStars as i32, c(0xaaccff));

  drawString(120, 220, "Lanes:", c(0xaaaaaa));
  drawNumber(170, 220, numEdges as i32, c(0xaaccff));
}
