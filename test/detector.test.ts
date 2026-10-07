import { describe, expect, it } from "vitest";
import { SlideDetector } from "../src/content/detector";
import { slide, withNoise } from "./helpers";

/** Feeds `frame` every 500ms for `ms`, returns how many commits happened. */
function feed(d: SlideDetector, frame: Uint8Array, clock: { t: number }, ms: number): number {
  let commits = 0;
  for (const end = clock.t + ms; clock.t < end; clock.t += 500) {
    if (d.push(withNoise(frame, 4), clock.t)) commits++;
  }
  return commits;
}

describe("SlideDetector", () => {
  it("commits the first settled slide once", () => {
    const d = new SlideDetector();
    const clock = { t: 0 };
    expect(feed(d, slide(2), clock, 5000)).toBe(1);
  });

  it("does not commit before the picture has been still for stableMs", () => {
    const d = new SlideDetector({ stableMs: 1000 });
    expect(d.push(slide(2), 0)).toBe(false);
    expect(d.push(slide(2), 500)).toBe(false);
    expect(d.push(slide(2), 1000)).toBe(true);
  });

  it("commits each new slide, including bullet reveals", () => {
    const d = new SlideDetector();
    const clock = { t: 0 };
    let commits = 0;
    for (const s of [slide(2), slide(3), slide(4), slide(5, 3)]) commits += feed(d, s, clock, 3000);
    expect(commits).toBe(4);
  });

  it("waits out transitions and only commits the final picture", () => {
    const d = new SlideDetector();
    const clock = { t: 0 };
    feed(d, slide(2), clock, 3000);
    let commits = 0;
    for (let i = 0; i < 6; i++) {
      if (d.push(slide(3 + i, i), clock.t)) commits++;
      clock.t += 500;
    }
    expect(commits).toBe(0);
    expect(feed(d, slide(9, 5), clock, 3000)).toBe(1);
  });

  it("ignores blank frames", () => {
    const d = new SlideDetector();
    const clock = { t: 0 };
    expect(feed(d, new Uint8Array(slide(1).length), clock, 5000)).toBe(0);
  });

  it("does not re-commit after markCommitted", () => {
    const d = new SlideDetector();
    const clock = { t: 0 };
    d.markCommitted(slide(2));
    expect(feed(d, slide(2), clock, 5000)).toBe(0);
  });
});

describe("SlideDetector camera rejection", () => {
  it("never commits a still, non-flat (camera-like) picture", () => {
    const d = new SlideDetector();
    const camera = new Uint8Array(slide(1).length).map((_, i) => ((i * 2654435761) >>> 0) % 256);
    let commits = 0;
    for (let t = 0; t < 5000; t += 500) if (d.push(camera, t)) commits++;
    expect(commits).toBe(0);
  });
});
