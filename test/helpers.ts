import { SIG_HEIGHT, SIG_WIDTH } from "../src/shared/image";

/** A synthetic "slide": white background with `lines` dark text bars. */
export function slide(lines: number, seed = 0): Uint8Array {
  const g = new Uint8Array(SIG_WIDTH * SIG_HEIGHT).fill(240);
  for (let l = 0; l < lines; l++) {
    const y = 4 + l * 4 + (seed % 2);
    const len = 20 + ((l * 7 + seed * 13) % 30);
    for (let x = 6; x < 6 + len; x++) g[y * SIG_WIDTH + x] = 30;
  }
  return g;
}

export function withNoise(g: Uint8Array, amount = 8): Uint8Array {
  return g.map((v, i) => Math.max(0, Math.min(255, v + (((i * 2654435761) >>> 0) % (amount * 2 + 1)) - amount)));
}
