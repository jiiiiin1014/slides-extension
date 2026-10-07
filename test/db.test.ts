import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  RESUME_WINDOW_MS,
  addSlide,
  deleteSessions,
  deleteSlide,
  listSessions,
  listSlides,
  resetDbForTests,
  resolveSession,
} from "../src/shared/db";
import { expiredSessionIds } from "../src/background/retention";
import type { SessionRecord } from "../src/shared/messages";
import { slide } from "./helpers";

beforeEach(() => {
  resetDbForTests();
  globalThis.indexedDB = new IDBFactory();
});

const base = { meetingCode: "abc-defg-hij", startedAt: 1000, width: 1280, height: 720 };
const input = (sessionId: string, lines: number, capturedAt: number) => ({
  ...base,
  sessionId,
  capturedAt,
  signature: slide(lines),
  image: new Blob([`img-${lines}`], { type: "image/webp" }),
});

describe("db", () => {
  it("adds slides in order and tracks the session", async () => {
    const a = await addSlide(input("s1", 2, 2000));
    const b = await addSlide(input("s1", 3, 3000));
    expect(a.duplicate).toBe(false);
    expect(b.slideId).not.toBe(a.slideId);

    const slides = await listSlides("s1");
    expect(slides.map((s) => s.id)).toEqual([a.slideId, b.slideId]);
    expect(await slides[0].image.text()).toBe("img-2");
    expect(slides[0]).not.toHaveProperty("meetingCode");

    const [session] = await listSessions();
    expect(session).toMatchObject({ id: "s1", meetingCode: "abc-defg-hij", slideCount: 2, updatedAt: 3000 });
  });

  it("returns the existing slide when the presenter goes back", async () => {
    const first = await addSlide(input("s1", 2, 2000));
    await addSlide(input("s1", 3, 3000));
    const again = await addSlide(input("s1", 2, 4000));
    expect(again).toEqual({ slideId: first.slideId, duplicate: true });
    expect(await listSlides("s1")).toHaveLength(2);
  });

  it("does not dedupe across sessions", async () => {
    await addSlide(input("s1", 2, 2000));
    expect((await addSlide(input("s2", 2, 2000))).duplicate).toBe(false);
  });

  it("lists sessions newest first and deletes them with their slides", async () => {
    await addSlide(input("old", 2, 2000));
    await addSlide(input("new", 2, 5000));
    expect((await listSessions()).map((s) => s.id)).toEqual(["new", "old"]);

    await deleteSessions(["old"]);
    expect((await listSessions()).map((s) => s.id)).toEqual(["new"]);
    expect(await listSlides("old")).toEqual([]);
    expect(await listSlides("new")).toHaveLength(1);
  });

  it("deletes a single slide and decrements the count", async () => {
    const a = await addSlide(input("s1", 2, 2000));
    await addSlide(input("s1", 3, 3000));
    await deleteSlide(a.slideId);
    expect(await listSlides("s1")).toHaveLength(1);
    expect((await listSessions())[0].slideCount).toBe(1);
  });
});

describe("expiredSessionIds", () => {
  it("selects sessions older than the retention window", () => {
    const day = 24 * 60 * 60 * 1000;
    const s = (id: string, updatedAt: number) => ({ id, updatedAt }) as SessionRecord;
    expect(expiredSessionIds([s("a", 0), s("b", 6 * day), s("c", 7.5 * day)], 8 * day, 7 * day)).toEqual(["a"]);
  });
});

describe("resolveSession", () => {
  it("continues a recent session of the same meeting and starts fresh otherwise", async () => {
    await addSlide(input("abc-defg-hij@1000", 2, 2000));
    expect(await resolveSession("abc-defg-hij", 2000 + 60_000)).toEqual({ id: "abc-defg-hij@1000", startedAt: 1000 });
    expect(await resolveSession("xyz-wxyz-xyz", 5000)).toEqual({ id: "xyz-wxyz-xyz@5000", startedAt: 5000 });
    const later = 2000 + RESUME_WINDOW_MS + 1;
    expect(await resolveSession("abc-defg-hij", later)).toEqual({ id: `abc-defg-hij@${later}`, startedAt: later });
  });
});
