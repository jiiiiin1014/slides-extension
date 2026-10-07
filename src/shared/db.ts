import { changedRatio } from "./image";
import type { SessionRecord, SlideRecord } from "./messages";

// Used by the service worker (writes) and the side panel (reads/deletes); both run on the extension origin.
const DB_NAME = "meet-slide-rewind";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const SLIDES = "slides";

/** Captures closer than this to an existing slide in the same session are treated as the same slide. */
export const DUPLICATE_RATIO = 0.005;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(SESSIONS, { keyPath: "id" });
      const slides = db.createObjectStore(SLIDES, { keyPath: "id", autoIncrement: true });
      slides.createIndex("sessionId", "sessionId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

/** Test hook: drop the cached connection so a fresh fake IndexedDB can be used. */
export function resetDbForTests(): void {
  dbPromise?.then((db) => db.close());
  dbPromise = null;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export interface NewSlide {
  sessionId: string;
  meetingCode: string;
  startedAt: number;
  capturedAt: number;
  width: number;
  height: number;
  signature: Uint8Array;
  image: Blob;
}

export interface AddSlideResult {
  slideId: number;
  duplicate: boolean;
}

/** Saves a slide unless an equivalent one already exists in the session, and keeps the session row up to date. */
export async function addSlide(input: NewSlide): Promise<AddSlideResult> {
  const db = await openDb();
  const tx = db.transaction([SESSIONS, SLIDES], "readwrite");
  const finished = done(tx);
  const sessions = tx.objectStore(SESSIONS);
  const slides = tx.objectStore(SLIDES);

  const existing = await result(slides.index("sessionId").getAll(input.sessionId) as IDBRequest<SlideRecord[]>);
  const match = existing.find((s) => changedRatio(s.signature, input.signature) < DUPLICATE_RATIO);
  const session = (await result(sessions.get(input.sessionId) as IDBRequest<SessionRecord | undefined>)) ?? {
    id: input.sessionId,
    meetingCode: input.meetingCode,
    startedAt: input.startedAt,
    updatedAt: input.capturedAt,
    slideCount: 0,
  };

  let slideId: number;
  if (match) {
    slideId = match.id;
  } else {
    const { meetingCode: _m, startedAt: _s, ...record } = input;
    slideId = (await result(slides.add(record))) as number;
    session.slideCount++;
  }
  session.updatedAt = input.capturedAt;
  sessions.put(session);
  await finished;
  return { slideId, duplicate: !!match };
}

export async function listSessions(): Promise<SessionRecord[]> {
  const db = await openDb();
  const all = await result(db.transaction(SESSIONS).objectStore(SESSIONS).getAll() as IDBRequest<SessionRecord[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Sessions of the same meeting updated within this window are continued (e.g. after rejoining). */
export const RESUME_WINDOW_MS = 3 * 60 * 60 * 1000;

/** The session to record into for `meetingCode`: the most recent one if still fresh, otherwise a new one. */
export async function resolveSession(meetingCode: string, now: number): Promise<{ id: string; startedAt: number }> {
  const recent = (await listSessions()).find((s) => s.meetingCode === meetingCode && now - s.updatedAt <= RESUME_WINDOW_MS);
  return recent ? { id: recent.id, startedAt: recent.startedAt } : { id: `${meetingCode}@${now}`, startedAt: now };
}

export async function listSlides(sessionId: string): Promise<SlideRecord[]> {
  const db = await openDb();
  const store = db.transaction(SLIDES).objectStore(SLIDES);
  const all = await result(store.index("sessionId").getAll(sessionId) as IDBRequest<SlideRecord[]>);
  return all.sort((a, b) => a.capturedAt - b.capturedAt || a.id - b.id);
}

export async function deleteSessions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  const tx = db.transaction([SESSIONS, SLIDES], "readwrite");
  const finished = done(tx);
  const slides = tx.objectStore(SLIDES);
  for (const id of ids) {
    tx.objectStore(SESSIONS).delete(id);
    const keys = await result(slides.index("sessionId").getAllKeys(id));
    for (const key of keys) slides.delete(key);
  }
  await finished;
}

export async function deleteSlide(slideId: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SESSIONS, SLIDES], "readwrite");
  const finished = done(tx);
  const slides = tx.objectStore(SLIDES);
  const slide = await result(slides.get(slideId) as IDBRequest<SlideRecord | undefined>);
  if (slide) {
    slides.delete(slideId);
    const sessions = tx.objectStore(SESSIONS);
    const session = await result(sessions.get(slide.sessionId) as IDBRequest<SessionRecord | undefined>);
    if (session) sessions.put({ ...session, slideCount: Math.max(0, session.slideCount - 1) });
  }
  await finished;
}
