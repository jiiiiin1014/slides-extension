import { changedRatio, flatness, isBlank } from "../shared/image";

export interface DetectorOptions {
  /** Changed-pixel ratio vs. the last committed slide that counts as "something new". */
  changeRatio: number;
  /** Changed-pixel ratio between consecutive samples below which the picture counts as still. */
  stillRatio: number;
  /** How long the picture must stay still before it is committed as a slide. */
  stableMs: number;
  /** Minimum `flatness` for a picture to be considered a slide rather than a camera image. */
  minFlatness: number;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  changeRatio: 0.005,
  stillRatio: 0.002,
  stableMs: 1000,
  minFlatness: 0.3,
};

/**
 * Decides when a new slide has appeared. Feed it downscaled grayscale samples;
 * it returns true exactly once per new, settled picture (including the first one).
 */
export class SlideDetector {
  private committed: Uint8Array | null = null;
  private previous: Uint8Array | null = null;
  private stillSince: number | null = null;
  private readonly opts: DetectorOptions;

  constructor(opts: Partial<DetectorOptions> = {}) {
    this.opts = { ...DEFAULT_DETECTOR_OPTIONS, ...opts };
  }

  push(sample: Uint8Array, now: number): boolean {
    const previous = this.previous;
    this.previous = sample;

    if (isBlank(sample) || flatness(sample) < this.opts.minFlatness) {
      this.stillSince = null;
      return false;
    }
    if (this.committed && changedRatio(sample, this.committed) < this.opts.changeRatio) {
      this.stillSince = null;
      return false;
    }
    if (!previous || changedRatio(sample, previous) >= this.opts.stillRatio) {
      // Still animating / transitioning: restart the stability timer from this sample.
      this.stillSince = now;
      return false;
    }
    this.stillSince ??= now;
    if (now - this.stillSince < this.opts.stableMs) return false;

    this.committed = sample;
    this.stillSince = null;
    return true;
  }

  /** Marks the given picture as already captured (e.g. after a manual capture). */
  markCommitted(sample: Uint8Array): void {
    this.committed = sample;
    this.stillSince = null;
  }

  /** Forget everything, e.g. when the shared video element changes. */
  reset(): void {
    this.committed = null;
    this.previous = null;
    this.stillSince = null;
  }
}
