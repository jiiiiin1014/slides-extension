export interface SlideRecord {
  id: number;
  sessionId: string;
  capturedAt: number;
  width: number;
  height: number;
  /** Downscaled grayscale picture (SIG_WIDTH x SIG_HEIGHT), used for duplicate detection. */
  signature: Uint8Array;
  image: Blob;
}

export interface SessionRecord {
  /** `${meetingCode}@${startedAt}` */
  id: string;
  meetingCode: string;
  startedAt: number;
  updatedAt: number;
  slideCount: number;
}

export type CaptureStatus = "watching" | "no-video" | "paused";

/** content script -> service worker */
export interface SlideCapturedMessage {
  type: "slide-captured";
  sessionId: string;
  meetingCode: string;
  startedAt: number;
  capturedAt: number;
  width: number;
  height: number;
  signature: number[];
  dataUrl: string;
  manual: boolean;
}

/** content script -> service worker; answered with `ResolvedSession` */
export interface ResolveSessionRequest {
  type: "resolve-session";
  meetingCode: string;
}
export interface ResolvedSession {
  id: string;
  startedAt: number;
}

/** content script -> anyone listening (side panel) */
export interface StatusMessage {
  type: "status";
  tabId?: number;
  sessionId: string;
  meetingCode: string;
  status: CaptureStatus;
}

/** service worker -> side panel */
export interface SlideAddedMessage {
  type: "slide-added";
  sessionId: string;
  slideId: number;
  /** True when the capture matched an already-saved slide (the presenter went back). */
  duplicate: boolean;
}

/** side panel -> content script */
export interface ManualCaptureRequest {
  type: "manual-capture";
}
export interface ManualCaptureResponse {
  ok: boolean;
  duplicate?: boolean;
}
export interface StatusRequest {
  type: "get-status";
}
export interface SetPausedRequest {
  type: "set-paused";
  paused: boolean;
}

export type ContentRequest = ManualCaptureRequest | StatusRequest | SetPausedRequest;
export type RuntimeMessage = SlideCapturedMessage | ResolveSessionRequest | StatusMessage | SlideAddedMessage;
