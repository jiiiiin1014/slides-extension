// End-to-end harness: runs the *built* content script, service worker and side panel on one page
// with a stubbed chrome.* message bus, fed by a synthetic screen-share video.
// Serve the repo root (e.g. `python3 -m http.server 8123`) and open /harness/index.html.

const logEl = document.getElementById("log");
const log = (...a) => {
  logEl.textContent += `${((performance.now() - t0) / 1000).toFixed(1)}s ${a.join(" ")}\n`;
  console.log("[harness]", ...a);
};
const t0 = performance.now();
window.harnessEvents = [];

// ---- fake chrome.* ----
const listeners = []; // { ctx, fn }
async function dispatch(filter, msg, sender) {
  const targets = listeners.filter(filter);
  if (targets.length === 0) throw new Error("Could not establish connection. Receiving end does not exist.");
  const pending = [];
  for (const l of targets) {
    let respond;
    const p = new Promise((r) => (respond = r));
    if (l.fn(structuredClone(msg), sender, respond) === true) pending.push(p);
  }
  return pending.length ? Promise.race(pending) : undefined;
}
function makeChrome(ctx) {
  const ev = { addListener() {} };
  return {
    runtime: {
      id: "harness",
      sendMessage: (msg) => dispatch((l) => l.ctx !== "content" && l.ctx !== ctx, msg, ctx === "content" ? { tab: { id: 1 } } : {}),
      onMessage: { addListener: (fn) => listeners.push({ ctx, fn }) },
    },
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: (_id, msg) => dispatch((l) => l.ctx === "content", msg, {}),
      create: async ({ url }) => window.open(url),
      onActivated: ev,
      onUpdated: ev,
    },
    sidePanel: { setPanelBehavior: async () => {} },
  };
}
window.makeChrome = makeChrome;
listeners.push({
  ctx: "observer",
  fn: (msg) => {
    if (msg.type === "slide-added") {
      window.harnessEvents.push(msg);
      log(`slide-added id=${msg.slideId} duplicate=${msg.duplicate}`);
    }
    if (msg.type === "status") log(`status ${msg.status}`);
  },
});

async function runBundle(path, ctx) {
  const code = await (await fetch(path, { cache: "no-store" })).text();
  new Function("chrome", code)(makeChrome(ctx));
}

// ---- synthetic videos ----
function makeStream(canvas, draw) {
  const ctx = canvas.getContext("2d");
  setInterval(() => draw(ctx, (performance.now() - t0) / 1000), 66);
  return canvas.captureStream(15);
}

function drawSlide(ctx, title, bullets, opts = {}) {
  ctx.fillStyle = opts.bg ?? "#ffffff";
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = "#1a73e8";
  ctx.fillRect(0, 0, 1280, 110);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 56px sans-serif";
  ctx.fillText(title, 60, 75);
  ctx.fillStyle = "#202124";
  ctx.font = "40px sans-serif";
  bullets.forEach((b, i) => ctx.fillText(`• ${b}`, 80, 220 + i * 80));
}

/** Soft moving color blobs: looks like camera / video footage even after downscaling. */
function drawBlobs(c, w, h, t) {
  c.fillStyle = "#3a2f2a";
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = w * (0.5 + 0.4 * Math.sin(t * 1.3 + i * 2.1));
    const y = h * (0.5 + 0.4 * Math.cos(t * 0.9 + i * 1.7));
    const g = c.createRadialGradient(x, y, 0, x, y, w * 0.35);
    g.addColorStop(0, `hsla(${(i * 60 + t * 40) % 360}, 70%, 60%, 0.9)`);
    g.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}

const timeline = [
  [3, (c) => { c.fillStyle = "#000"; c.fillRect(0, 0, 1280, 720); }],
  [7, (c) => drawSlide(c, "1. はじめに", ["Slide Rewind の紹介"])],
  [7.6, (c, t) => { drawSlide(c, "2. 背景", ["共有画面は戻れない", "聞き手が置いていかれる"]); c.globalAlpha = 1 - (t - 7) / 0.6; drawSlide(c, "1. はじめに", ["Slide Rewind の紹介"]); c.globalAlpha = 1; }],
  [11, (c) => drawSlide(c, "2. 背景", ["共有画面は戻れない", "聞き手が置いていかれる"])],
  [14, (c) => drawSlide(c, "2. 背景", ["共有画面は戻れない", "聞き手が置いていかれる", "→ 手元で見返したい"])],
  [18, (c) => drawSlide(c, "3. 仕組み", ["映像を縮小して差分を取る", "1秒静止したら保存", "重複は排除"])],
  [21, (c) => drawSlide(c, "2. 背景", ["共有画面は戻れない", "聞き手が置いていかれる", "→ 手元で見返したい"])],
  [26, (c, t) => { drawSlide(c, "4. デモ", ["カーソルが動いても反応しない"]); c.fillStyle = "#000"; c.beginPath(); c.arc(300 + ((t * 200) % 700), 500, 6, 0, 7); c.fill(); }],
  // A video playing inside the slide: keeps changing, so it must never be committed automatically.
  [30, (c, t) => drawBlobs(c, 1280, 720, t)],
  [Infinity, (c) => drawSlide(c, "5. まとめ", ["見返せると理解が深まる", "ご清聴ありがとうございました"])],
];

const shareCanvas = Object.assign(document.createElement("canvas"), { width: 1280, height: 720 });
document.getElementById("share").srcObject = makeStream(shareCanvas, (c, t) => timeline.find(([end]) => t < end)[1](c, t));

const camCanvas = Object.assign(document.createElement("canvas"), { width: 640, height: 360 });
document.getElementById("camera").srcObject = makeStream(camCanvas, (c, t) => drawBlobs(c, 640, 360, t));

// ---- boot ----
(async () => {
  for (const v of document.querySelectorAll("video")) v.play().catch((e) => log(`play() failed: ${e.message}`));
  // Fresh database for every run.
  await new Promise((r) => { const req = indexedDB.deleteDatabase("meet-slide-rewind"); req.onsuccess = req.onerror = req.onblocked = r; });
  history.replaceState(null, "", "/abc-defg-hij");
  await runBundle("/dist/background/index.js", "background");
  await runBundle("/dist/content/index.js", "content");

  const html = await (await fetch("/dist/sidepanel/index.html", { cache: "no-store" })).text();
  const panel = document.getElementById("panel");
  panel.srcdoc = html.replace("<head>", '<head><base href="/dist/sidepanel/"><script>window.chrome = parent.makeChrome("panel");</script>');
  log("booted");
})();
