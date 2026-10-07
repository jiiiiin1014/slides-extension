import type { SessionRecord } from "../shared/messages";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Sessions not updated within `maxAgeMs` of `now`. */
export function expiredSessionIds(sessions: SessionRecord[], now: number, maxAgeMs = RETENTION_MS): string[] {
  return sessions.filter((s) => now - s.updatedAt > maxAgeMs).map((s) => s.id);
}
