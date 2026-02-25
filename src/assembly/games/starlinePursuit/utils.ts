import { stars } from "./types";

/**
 * Calculate squared distance between two stars (avoids sqrt for performance)
 */
export function starsDist2(starA: i32, starB: i32): i32 {
  const a = stars.get(starA);
  const b = stars.get(starB);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
