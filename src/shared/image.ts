/** Resolution of the downscaled grayscale "signature" used for change and duplicate detection. */
export const SIG_WIDTH = 64;
export const SIG_HEIGHT = 36;

/** Converts RGBA pixel data to 8-bit luma (BT.601). */
export function rgbaToGray(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

/**
 * Fraction (0..1) of pixels whose luma differs by more than `pixelThreshold`.
 * Robust to compression noise and blur, sensitive to new text or shapes.
 */
export function changedRatio(a: ArrayLike<number>, b: ArrayLike<number>, pixelThreshold = 24): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > pixelThreshold) changed++;
  }
  return changed / a.length;
}

/** True for frames that are (almost) a single flat color, e.g. black frames while a share is starting. */
export function isBlank(gray: ArrayLike<number>, tolerance = 6): boolean {
  if (gray.length === 0) return true;
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }
  return max - min <= tolerance;
}

/**
 * Share of pixels within ±`spread` luma of the most common value. Slides have large flat
 * backgrounds (typically > 0.4); camera images are noisy and spread out (typically < 0.2).
 */
export function flatness(gray: ArrayLike<number>, spread = 8): number {
  if (gray.length === 0) return 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let window = 0;
  for (let v = 0; v <= Math.min(255, 2 * spread); v++) window += hist[v];
  let best = window;
  for (let lo = 1; lo + 2 * spread <= 255; lo++) {
    window += hist[lo + 2 * spread] - hist[lo - 1];
    if (window > best) best = window;
  }
  return best / gray.length;
}
