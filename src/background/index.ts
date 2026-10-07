import type { RuntimeMessage, SlideAddedMessage, SlideCapturedMessage } from "../shared/messages";
import { addSlide, deleteSessions, listSessions, resolveSession } from "../shared/db";
import { expiredSessionIds } from "./retention";

async function cleanUp() {
  const expired = expiredSessionIds(await listSessions(), Date.now());
  await deleteSessions(expired);
}

async function handleCapture(msg: SlideCapturedMessage) {
  const image = await (await fetch(msg.dataUrl)).blob();
  const result = await addSlide({
    sessionId: msg.sessionId,
    meetingCode: msg.meetingCode,
    startedAt: msg.startedAt,
    capturedAt: msg.capturedAt,
    width: msg.width,
    height: msg.height,
    signature: new Uint8Array(msg.signature),
    image,
  });
  const added: SlideAddedMessage = { type: "slide-added", sessionId: msg.sessionId, ...result };
  // The side panel may be closed; nobody listening is fine.
  chrome.runtime.sendMessage(added).catch(() => {});
  return result;
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
cleanUp().catch(console.error);

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg.type === "resolve-session") {
    resolveSession(msg.meetingCode, Date.now()).then(sendResponse, (e) => {
      console.error("[slide-rewind] failed to resolve session", e);
      const now = Date.now();
      sendResponse({ id: `${msg.meetingCode}@${now}`, startedAt: now });
    });
    return true;
  }
  if (msg.type !== "slide-captured") return false;
  handleCapture(msg).then(sendResponse, (e) => {
    console.error("[slide-rewind] failed to save slide", e);
    sendResponse(null);
  });
  return true;
});
