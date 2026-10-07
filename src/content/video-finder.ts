import { SIG_HEIGHT, SIG_WIDTH, flatness, isBlank, rgbaToGray } from "../shared/image";

const MIN_VIDEO_WIDTH = 320;
/** Tiles at least this fraction of the biggest tile's area count as "the largest". */
const LARGEST_TILE_RATIO = 0.9;

const sigCanvas = document.createElement("canvas");
sigCanvas.width = SIG_WIDTH;
sigCanvas.height = SIG_HEIGHT;
const sigCtx = sigCanvas.getContext("2d", { willReadFrequently: true })!;

/** Downscaled grayscale picture of the video's current frame. */
export function sampleVideo(video: HTMLVideoElement): Uint8Array {
  sigCtx.drawImage(video, 0, 0, SIG_WIDTH, SIG_HEIGHT);
  return rgbaToGray(sigCtx.getImageData(0, 0, SIG_WIDTH, SIG_HEIGHT).data);
}

function renderedArea(video: HTMLVideoElement): number {
  const r = video.getBoundingClientRect();
  return Math.max(0, r.width) * Math.max(0, r.height);
}

/** Self-view tiles are mirrored with a negative scaleX transform. */
function isMirrored(video: HTMLVideoElement): boolean {
  for (let el: Element | null = video; el && el !== document.body; el = el.parentElement) {
    const t = getComputedStyle(el).transform;
    if (t.startsWith("matrix(-")) return true;
  }
  return false;
}

function playableVideos(): HTMLVideoElement[] {
  return Array.from(document.querySelectorAll("video")).filter(
    (v) => v.readyState >= 2 && v.videoWidth >= MIN_VIDEO_WIDTH && renderedArea(v) > 0 && !isMirrored(v),
  );
}

/** The largest visible, non-mirrored video, regardless of what it shows. */
export function largestVideo(): HTMLVideoElement | null {
  return playableVideos().sort((a, b) => renderedArea(b) - renderedArea(a))[0] ?? null;
}

export interface Candidate {
  video: HTMLVideoElement;
  sample: Uint8Array;
}

/**
 * Picks the video showing the screen share. Only the largest tiles are considered (Meet shows a
 * presentation as the biggest tile), which keeps small camera tiles out even if they look flat.
 * Among those, the current video is kept as long as it stays one of the largest, even when it
 * briefly shows something that is not slide-like (e.g. a demo), so detection is not reset.
 */
export function pickVideo(current: HTMLVideoElement | null, minFlatness: number): Candidate | null {
  const videos = playableVideos().map((video) => ({ video, area: renderedArea(video) }));
  const maxArea = Math.max(0, ...videos.map((v) => v.area));
  const largest = videos.filter((v) => v.area >= maxArea * LARGEST_TILE_RATIO).sort((a, b) => b.area - a.area);

  const cur = largest.find((v) => v.video === current);
  if (cur) return { video: cur.video, sample: sampleVideo(cur.video) };
  for (const { video } of largest) {
    const sample = sampleVideo(video);
    if (!isBlank(sample) && flatness(sample) >= minFlatness) return { video, sample };
  }
  return null;
}

/** Full-resolution WebP of the current frame, scaled down to at most `maxWidth`. */
export async function captureFrame(
  video: HTMLVideoElement,
  maxWidth = 1920,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { dataUrl, width, height };
}
