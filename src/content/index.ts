import type { AddSlideResult } from "../shared/db";
import type {
  CaptureStatus,
  ContentRequest,
  ManualCaptureResponse,
  ResolveSessionRequest,
  ResolvedSession,
  SlideCapturedMessage,
  StatusMessage,
} from "../shared/messages";
import { DEFAULT_DETECTOR_OPTIONS, SlideDetector } from "./detector";
import { isBlank } from "../shared/image";
import { captureFrame, largestVideo, pickVideo, sampleVideo } from "./video-finder";

const SAMPLE_INTERVAL_MS = 500;
const MEETING_CODE = /^\/([a-z]{3,}-[a-z]{4,}-[a-z]{3,})(?:$|[/?#])/;

const detector = new SlideDetector();
let video: HTMLVideoElement | null = null;
let paused = false;
let busy = false;
let session: { id: string; meetingCode: string; startedAt: number } | null = null;
let lastStatus: CaptureStatus | null = null;

let resolving: string | null = null;

/** The session for the meeting in the URL. Resolved asynchronously so a rejoin continues the same session. */
function currentSession() {
  const code = MEETING_CODE.exec(location.pathname)?.[1] ?? null;
  if (session?.meetingCode !== code) {
    session = null;
    detector.reset();
    video = null;
    if (code && resolving !== code) {
      resolving = code;
      const req: ResolveSessionRequest = { type: "resolve-session", meetingCode: code };
      chrome.runtime.sendMessage(req).then(
        (r: ResolvedSession) => {
          if (resolving === code) session = { id: r.id, startedAt: r.startedAt, meetingCode: code };
        },
        (e) => console.warn("[meet-slide-rewind]", e),
      ).finally(() => {
        if (resolving === code) resolving = null;
      });
    }
  }
  return session;
}

function status(): CaptureStatus {
  return paused ? "paused" : video ? "watching" : "no-video";
}

function statusMessage(): StatusMessage {
  return { type: "status", sessionId: session?.id ?? "", meetingCode: session?.meetingCode ?? "", status: status() };
}

function reportStatus() {
  const s = status();
  if (s === lastStatus) return;
  lastStatus = s;
  // Nobody may be listening (side panel closed); that is fine.
  chrome.runtime.sendMessage(statusMessage()).catch(() => {});
}

async function save(target: HTMLVideoElement, signature: Uint8Array, manual: boolean): Promise<AddSlideResult | null> {
  const s = session;
  if (!s) return null;
  const frame = await captureFrame(target);
  const msg: SlideCapturedMessage = {
    type: "slide-captured",
    sessionId: s.id,
    meetingCode: s.meetingCode,
    startedAt: s.startedAt,
    capturedAt: Date.now(),
    width: frame.width,
    height: frame.height,
    signature: Array.from(signature),
    dataUrl: frame.dataUrl,
    manual,
  };
  return chrome.runtime.sendMessage(msg);
}

async function tick() {
  if (busy || !currentSession()) return;
  busy = true;
  try {
    if (paused) return;
    const picked = pickVideo(video, DEFAULT_DETECTOR_OPTIONS.minFlatness);
    if (picked?.video !== video) detector.reset();
    video = picked?.video ?? null;
    if (picked && detector.push(picked.sample, Date.now())) await save(picked.video, picked.sample, false);
  } catch (e) {
    console.warn("[meet-slide-rewind]", e);
  } finally {
    busy = false;
    reportStatus();
  }
}

async function manualCapture(): Promise<ManualCaptureResponse> {
  if (!currentSession()) return { ok: false };
  // Manual capture works even for pictures that do not look like slides, so fall back to the largest video.
  const target = video?.isConnected ? video : largestVideo();
  if (!target) return { ok: false };
  const sample = sampleVideo(target);
  if (isBlank(sample)) return { ok: false };
  detector.markCommitted(sample);
  const result = await save(target, sample, true);
  return { ok: !!result, duplicate: result?.duplicate };
}

chrome.runtime.onMessage.addListener((req: ContentRequest, _sender, sendResponse) => {
  switch (req.type) {
    case "get-status":
      currentSession();
      sendResponse(statusMessage());
      return false;
    case "set-paused":
      paused = req.paused;
      reportStatus();
      sendResponse(statusMessage());
      return false;
    case "manual-capture":
      manualCapture().then(sendResponse, () => sendResponse({ ok: false } satisfies ManualCaptureResponse));
      return true;
  }
});

const timer = setInterval(() => {
  // After the extension is reloaded or updated this orphaned script can no longer talk to it.
  if (!chrome.runtime?.id) return clearInterval(timer);
  tick();
}, SAMPLE_INTERVAL_MS);
