import { describe, expect, it } from "vitest";
import { changedRatio, flatness, isBlank, rgbaToGray } from "../src/shared/image";
import { slide, withNoise } from "./helpers";

describe("rgbaToGray", () => {
  it("converts pure colors to BT.601 luma", () => {
    const g = rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect(Array.from(g)).toEqual([255, 0, 76]);
  });
});

describe("changedRatio", () => {
  it("is 0 for identical and noisy-identical frames", () => {
    expect(changedRatio(slide(3), slide(3))).toBe(0);
    expect(changedRatio(slide(3), withNoise(slide(3)))).toBe(0);
  });
  it("detects a single added bullet line", () => {
    expect(changedRatio(slide(3), slide(4))).toBeGreaterThan(0.005);
  });
  it("treats size mismatch as fully changed", () => {
    expect(changedRatio(new Uint8Array(4), new Uint8Array(8))).toBe(1);
  });
});

describe("isBlank", () => {
  it("flags flat frames only", () => {
    expect(isBlank(new Uint8Array(100))).toBe(true);
    expect(isBlank(withNoise(new Uint8Array(100).fill(128), 2))).toBe(true);
    expect(isBlank(slide(1))).toBe(false);
  });
});

describe("flatness", () => {
  it("is high for slides and low for camera-like noise", () => {
    expect(flatness(withNoise(slide(4), 6))).toBeGreaterThan(0.6);
    const camera = new Uint8Array(2304).map((_, i) => ((i * 2654435761) >>> 0) % 256);
    expect(flatness(camera)).toBeLessThan(0.2);
  });
});
