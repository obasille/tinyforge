// Fixed-timestep clock, the same policy as the classic host: update() runs at
// exactly `hz` per second of real time, at most `maxSteps` times per frame;
// past that cap the backlog is dropped instead of spiralling.

export interface ClockOptions {
  hz?: number;
  maxSteps?: number;
}

export class FixedStepClock {
  readonly stepMs: number;
  readonly maxSteps: number;
  private acc = 0;
  private last: number | null = null;
  /** True when the last advance() hit maxSteps and dropped time. */
  dropped = false;

  constructor({ hz = 60, maxSteps = 5 }: ClockOptions = {}) {
    this.stepMs = 1000 / hz;
    this.maxSteps = maxSteps;
  }

  /** Forget the elapsed time and run one step on the next advance(). */
  reset(now: number): void {
    this.last = now;
    this.acc = this.stepMs;
    this.dropped = false;
  }

  /** How many fixed steps to run for a frame at time `now` (ms). */
  advance(now: number): number {
    if (this.last === null) this.reset(now);
    this.acc += now - (this.last ?? now);
    this.last = now;
    // The epsilon keeps float drift from losing a step on exact boundaries.
    let steps = Math.floor(this.acc / this.stepMs + 1e-9);
    this.dropped = steps > this.maxSteps;
    if (this.dropped) {
      steps = this.maxSteps;
      this.acc = 0;
    } else {
      this.acc = Math.max(0, this.acc - steps * this.stepMs);
    }
    return steps;
  }

  get accumulated(): number {
    return this.acc;
  }
}
