import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/clock.ts';

describe('FixedStepClock', () => {
  it('runs one step right after a reset', () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    expect(clock.advance(0)).toBe(1);
  });

  it('runs 60 steps per second regardless of frame rate', () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    clock.advance(0);
    let steps = 0;
    for (let t = 1; t <= 1000; t += 1) steps += clock.advance(t); // 1000 Hz frames
    expect(steps).toBe(60);
  });

  it('caps steps per frame and drops the backlog', () => {
    const clock = new FixedStepClock({ maxSteps: 5 });
    clock.reset(0);
    clock.advance(0);
    expect(clock.advance(2000)).toBe(5);
    expect(clock.dropped).toBe(true);
    expect(clock.advance(2001)).toBe(0);
  });
});
