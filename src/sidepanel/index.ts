import { deleteSessions, deleteSlide, listSessions, listSlides } from "../shared/db";
import type { ContentRequest, ManualCaptureResponse, RuntimeMessage, SessionRecord, SlideRecord, StatusMessage } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  session: $<HTMLSelectElement>("session"),
  deleteSession: $<HTMLButtonElement>("delete-session"),
  statusDot: $("status-dot"),
  statusText: $("status-text"),
  pause: $<HTMLButtonElement>("pause"),
  capture: $<HTMLButtonElement>("capture"),
  current: $<HTMLImageElement>("current"),
  empty: $("empty"),
  prev: $<HTMLButtonElement>("prev"),
  next: $<HTMLButtonElement>("next"),
  position: $("position"),
  latest: $<HTMLButtonElement>("latest"),
  follow: $<HTMLInputElement>("follow"),
  download: $<HTMLButtonElement>("download"),
  deleteSlide: $<HTMLButtonElement>("delete-slide"),
  thumbs: $<HTMLOListElement>("thumbs"),
};

const state = {
  sessions: [] as SessionRecord[],
  sessionId: null as string | null,
  slides: [] as SlideRecord[],
  index: -1,
  follow: true,
  activeTabId: null as number | null,
  live: null as StatusMessage | null,
};

const urls = new Map<number, string>();
function urlFor(slide: SlideRecord): string {
  let url = urls.get(slide.id);
  if (!url) urls.set(slide.id, (url = URL.createObjectURL(slide.image)));
  return url;
}
function releaseUrls(keep: Set<number>) {
  for (const [id, url] of urls) {
    if (!keep.has(id)) {
      URL.revokeObjectURL(url);
      urls.delete(id);
    }
  }
}

const timeFormat = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

// ---- data ----

async function loadSessions() {
  state.sessions = await listSessions();
  if (!state.sessions.some((s) => s.id === state.sessionId)) {
    const live = state.sessions.find((s) => s.id === state.live?.sessionId);
    state.sessionId = (live ?? state.sessions[0])?.id ?? null;
  }
  renderSessions();
}

async function loadSlides(focusId?: number) {
  const keepId = focusId ?? state.slides[state.index]?.id;
  state.slides = state.sessionId ? await listSlides(state.sessionId) : [];
  releaseUrls(new Set(state.slides.map((s) => s.id)));
  const found = state.slides.findIndex((s) => s.id === keepId);
  state.index = state.follow && focusId === undefined ? state.slides.length - 1 : found >= 0 ? found : state.slides.length - 1;
  renderSlides();
}

function go(index: number, { user = true } = {}) {
  if (state.slides.length === 0) return;
  state.index = Math.max(0, Math.min(state.slides.length - 1, index));
  // Browsing back by hand stops auto-follow; reaching the newest slide resumes it.
  if (user) setFollow(state.index === state.slides.length - 1);
  renderViewer();
}

function setFollow(on: boolean) {
  state.follow = on;
  el.follow.checked = on;
  renderViewer();
}

// ---- rendering ----

function renderSessions() {
  el.session.replaceChildren(
    ...state.sessions.map((s) => {
      const live = s.id === state.live?.sessionId ? "● " : "";
      return new Option(`${live}${s.meetingCode} · ${timeFormat.format(s.startedAt)} · ${s.slideCount}枚`, s.id, false, s.id === state.sessionId);
    }),
  );
  if (state.sessions.length === 0) el.session.append(new Option("保存された会議はありません", ""));
  el.session.disabled = state.sessions.length === 0;
  el.deleteSession.disabled = state.sessions.length === 0;
}

function renderSlides() {
  el.thumbs.replaceChildren(
    ...state.slides.map((slide, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.title = `${i + 1}枚目 · ${new Date(slide.capturedAt).toLocaleTimeString("ja-JP")}`;
      btn.addEventListener("click", () => go(i));
      const img = document.createElement("img");
      img.src = urlFor(slide);
      img.alt = `${i + 1}枚目`;
      img.loading = "lazy";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(i + 1);
      btn.append(img);
      li.append(btn, num);
      return li;
    }),
  );
  renderViewer();
}

function renderViewer() {
  const slide = state.slides[state.index];
  const n = state.slides.length;
  el.current.hidden = !slide;
  el.empty.hidden = !!slide;
  if (slide) {
    el.current.src = urlFor(slide);
    el.current.alt = `${state.index + 1}枚目のスライド`;
  }
  el.position.textContent = `${slide ? state.index + 1 : 0} / ${n}`;
  el.prev.disabled = state.index <= 0;
  el.next.disabled = state.index >= n - 1;
  el.latest.hidden = state.follow || n === 0;
  el.download.disabled = !slide;
  el.deleteSlide.disabled = !slide;

  el.thumbs.querySelectorAll("button").forEach((b, i) => {
    const current = i === state.index;
    b.setAttribute("aria-current", String(current));
    if (current) b.scrollIntoView({ block: "nearest" });
  });
}

const STATUS_TEXT: Record<string, string> = {
  watching: "画面共有を監視中",
  "no-video": "画面共有が見つかりません",
  paused: "一時停止中",
};

function renderStatus() {
  const live = state.live;
  el.statusDot.className = `dot ${live?.status ?? ""}`;
  el.statusText.textContent = live
    ? live.meetingCode
      ? STATUS_TEXT[live.status]
      : "会議に参加すると監視を始めます"
    : "Meet のタブではありません（開いていた場合は再読み込み）";
  el.pause.disabled = el.capture.disabled = !live?.meetingCode;
  el.pause.textContent = live?.status === "paused" ? "再開" : "一時停止";
}

// ---- talking to the Meet tab ----

async function askTab<T>(req: ContentRequest): Promise<T | null> {
  if (state.activeTabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(state.activeTabId, req)) as T;
  } catch {
    return null; // not a Meet tab, or the content script is not loaded yet
  }
}

async function refreshActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTabId = tab?.id ?? null;
  const prevSession = state.live?.sessionId;
  state.live = await askTab<StatusMessage>({ type: "get-status" });
  renderStatus();
  if (state.live?.sessionId && state.live.sessionId !== prevSession) {
    await loadSessions();
    if (state.sessions.some((s) => s.id === state.live!.sessionId)) await selectSession(state.live.sessionId);
  }
}

async function selectSession(id: string) {
  state.sessionId = id;
  renderSessions();
  await loadSlides();
}

// ---- events ----

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, sender) => {
  if (msg.type === "status" && sender.tab?.id === state.activeTabId) {
    state.live = msg;
    renderStatus();
  }
  if (msg.type === "slide-added") {
    void (async () => {
      const isNewSession = !state.sessions.some((s) => s.id === msg.sessionId);
      await loadSessions();
      // Jump to a newly started meeting automatically when following.
      if (isNewSession && state.follow && msg.sessionId === state.live?.sessionId) await selectSession(msg.sessionId);
      if (msg.sessionId !== state.sessionId) return;
      if (state.follow) await loadSlides(msg.slideId);
      else await loadSlides();
    })();
  }
});

chrome.tabs.onActivated.addListener(() => void refreshActiveTab());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === state.activeTabId && info.status === "complete") void refreshActiveTab();
});

el.session.addEventListener("change", () => void selectSession(el.session.value));

let deleteArmed: ReturnType<typeof setTimeout> | undefined;
el.deleteSession.addEventListener("click", async () => {
  if (!state.sessionId) return;
  if (!deleteArmed) {
    el.deleteSession.textContent = "削除する？";
    deleteArmed = setTimeout(() => {
      deleteArmed = undefined;
      el.deleteSession.textContent = "🗑";
    }, 3000);
    return;
  }
  clearTimeout(deleteArmed);
  deleteArmed = undefined;
  el.deleteSession.textContent = "🗑";
  await deleteSessions([state.sessionId]);
  state.sessionId = null;
  await loadSessions();
  await loadSlides();
});

el.prev.addEventListener("click", () => go(state.index - 1));
el.next.addEventListener("click", () => go(state.index + 1));
el.latest.addEventListener("click", () => go(state.slides.length - 1));
el.follow.addEventListener("change", () => {
  setFollow(el.follow.checked);
  if (state.follow) go(state.slides.length - 1, { user: false });
});

el.current.addEventListener("click", () => {
  const slide = state.slides[state.index];
  if (!slide) return;
  // A separate popup window keeps the Meet tab in front and is easy to close (Esc / ✕).
  const url = chrome.runtime.getURL(`sidepanel/viewer.html?src=${encodeURIComponent(urlFor(slide))}`);
  const width = Math.round(screen.availWidth * 0.8);
  const height = Math.round(screen.availHeight * 0.8);
  void chrome.windows.create({
    url,
    type: "popup",
    width,
    height,
    left: Math.round((screen.availWidth - width) / 2),
    top: Math.round((screen.availHeight - height) / 2),
  });
});

el.download.addEventListener("click", () => {
  const slide = state.slides[state.index];
  if (!slide) return;
  const session = state.sessions.find((s) => s.id === state.sessionId);
  const a = document.createElement("a");
  a.href = urlFor(slide);
  a.download = `${session?.meetingCode ?? "slide"}-${String(state.index + 1).padStart(2, "0")}.webp`;
  a.click();
});

el.deleteSlide.addEventListener("click", async () => {
  const slide = state.slides[state.index];
  if (!slide) return;
  await deleteSlide(slide.id);
  const nextId = (state.slides[state.index + 1] ?? state.slides[state.index - 1])?.id;
  await loadSessions();
  await loadSlides(nextId);
});

el.pause.addEventListener("click", async () => {
  const paused = state.live?.status !== "paused";
  state.live = (await askTab<StatusMessage>({ type: "set-paused", paused })) ?? state.live;
  renderStatus();
});

el.capture.addEventListener("click", async () => {
  el.capture.disabled = true;
  const res = await askTab<ManualCaptureResponse>({ type: "manual-capture" });
  el.capture.disabled = false;
  el.statusText.textContent = !res?.ok
    ? "保存できる映像が見つかりませんでした"
    : res.duplicate
      ? "保存済みのスライドと同じ画面です"
      : "保存しました";
  setTimeout(renderStatus, 2500);
});

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  const actions: Record<string, () => void> = {
    ArrowLeft: () => go(state.index - 1),
    ArrowUp: () => go(state.index - 1),
    ArrowRight: () => go(state.index + 1),
    ArrowDown: () => go(state.index + 1),
    Home: () => go(0),
    End: () => go(state.slides.length - 1),
  };
  const action = actions[e.key];
  if (action) {
    e.preventDefault();
    action();
  }
});

// ---- start ----

void (async () => {
  await refreshActiveTab();
  await loadSessions();
  await loadSlides();
})();
