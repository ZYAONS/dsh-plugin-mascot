#!/usr/bin/env node
/**
 * Render `docs/preview.png` from the real browser half.
 *
 * This is a visual smoke test rather than a mock-up. The harness loads
 * `lib/client.js` through a stub `window.__ModuleLoader__`, drives the
 * registered component exactly the way the DSH runner does, opens each panel
 * with a real DOM click, and stubs only the two seams a plain page cannot
 * supply: the session projections and the host's balance route.
 *
 * Each frame prints its own verdict underneath (the live chip text, plus any
 * clipping or scrolling it detected), so a regression shows up in the picture
 * instead of hiding behind a plausible-looking screenshot.
 *
 *   node scripts/preview.mjs
 *
 * Requires the devDependencies (`react`, `react-dom`) and a Chromium binary.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
mkdirSync(docs, { recursive: true });

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const chrome = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chrome === undefined) {
  console.error("preview: no Chromium binary found");
  process.exit(1);
}

const url = (relative) => pathToFileURL(join(root, relative)).href;

/** Fixtures mirror the wire shapes documented on `deriveStats`. */
const FIXTURES = {
  usage: { uncachedInputTokens: 18432, outputTokens: 15204, cacheReadTokens: 214784, cacheWriteTokens: 8192 },
  pressure: { pressureTokens: 241408, projectedTokens: 262144, contextWindow: 1000000 },
  sessionId: "9f2c41ab-7d33-4e8a-9c10-2b6f5ae0d711",
  frames: [
    {
      caption: "可露希尔 · 面板展开",
      character: "closure",
      open: true,
      balance: {
        ok: true,
        isAvailable: true,
        currency: "CNY",
        totalBalance: "128.42",
        toppedUpBalance: "120.00",
        grantedBalance: "8.42",
      },
    },
    {
      caption: "千石由乃 · 面板展开",
      character: "yuno",
      open: true,
      balance: { ok: false, error: "missing_credential", message: "未配置 DEEPSEEK_API_KEY，请在「设置 → 模型」中填写" },
    },
    { caption: "收起状态", character: "closure", open: false, balance: undefined },
  ],
};

const STYLE = [
  "body { margin: 0; padding: 20px; background: #0b0d12; display: flex; gap: 18px;",
  '  font-family: ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }',
  "#stage { display: flex; gap: 18px; align-items: flex-start; }",
  ".col { display: grid; gap: 10px; }",
  ".caption { font-size: 11px; line-height: 1.6; letter-spacing: .3px; color: rgba(255,255,255,.44);",
  "  width: 520px; word-break: break-word; }",
  "/* Stand-in for the DSH shell, so the overlay has somewhere to float. */",
  ".frame { position: relative; width: 520px; height: 800px; border-radius: 14px; overflow: hidden;",
  "  background: linear-gradient(180deg, #14171f, #0e1015); border: 1px solid rgba(255,255,255,.07);",
  "  box-shadow: 0 18px 40px rgba(0,0,0,.45); }",
  ".rail { position: absolute; inset: 0 auto 0 0; width: 54px; background: rgba(255,255,255,.03);",
  "  border-right: 1px solid rgba(255,255,255,.05); }",
  ".rail i { display: block; width: 26px; height: 26px; margin: 12px auto; border-radius: 8px;",
  "  background: rgba(255,255,255,.07); }",
  ".rail i:first-child { margin-top: 46px; background: rgba(94,224,216,.32); }",
  ".chat { position: absolute; left: 76px; right: 20px; top: 52px; display: grid; gap: 12px; }",
  ".bubble { height: 46px; border-radius: 10px; background: rgba(255,255,255,.045); }",
  ".bubble.me { height: 34px; width: 62%; margin-left: auto; background: rgba(93,150,255,.13); }",
  ".bubble.short { height: 62px; }",
  ".composer { position: absolute; left: 76px; right: 20px; bottom: 18px; height: 46px; border-radius: 12px;",
  "  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.07); }",
  "/* Freeze the plugin's own motion so the screenshot is byte-stable across runs;",
  "   a static image cannot show the idle bob anyway. */",
  ".dsh-mascot-btn, .dsh-mascot-panel { animation: none !important; }",
  ".dsh-mascot-bar > i { transition: none !important; }",
].join("\n  ");

const SCRIPT = [
  "const FIXTURES = " + JSON.stringify(FIXTURES) + ";",
  "",
  "// 1. Capture the bundle the way dsh-client-modules does.",
  "const registrations = [];",
  "window.__ModuleLoader__ = { load: (registration) => registrations.push(registration) };",
].join("\n");

const SCRIPT2 = `const { createElement: h, useEffect, useRef } = React;
const plugin = registrations[0].factory((spec) => {
  if (spec === "react") return React;
  throw new Error("unexpected require(" + spec + ")");
});

// 2. Drive the same ctx.slots surface the runner exposes, and prove the
//    registration is the one the plugin intends.
const registered = [];
plugin.apply({
  effect: (callback) => callback(),
  slots: {
    inject: (key, callback) => [...callback()],
    register: (options, component) => { registered.push({ options, component }); return () => {}; },
  },
});
if (registered.length !== 1 || registered[0].options.id !== "mascot") {
  throw new Error("preview: unexpected registration " + JSON.stringify(registered.map((r) => r.options)));
}

const Overlay = plugin.MascotOverlay;
const Panel = plugin.MascotPanel;

/** One column of the sheet: mock shell chrome plus a live overlay instance. */
function Frame({ spec }) {
  const host = useRef(null);
  useEffect(() => {
    const root = ReactDOM.createRoot(host.current);
    root.render(h(Overlay, {
      renderSlot: (key, owner) => h(Panel, Object.assign({}, owner, {
        useProjection: (name) => name === "tokenUsage" ? FIXTURES.usage : FIXTURES.pressure,
        sessionId: FIXTURES.sessionId,
      })),
    }));
    return () => root.unmount();
  }, [spec]);
  return h("div", { className: "col" },
    h("div", { className: "frame" },
      h("div", { className: "rail" }, h("i"), h("i"), h("i"), h("i")),
      h("div", { className: "chat" },
        h("div", { className: "bubble me" }),
        h("div", { className: "bubble short" }),
        h("div", { className: "bubble" })),
      h("div", { className: "composer" }),
      h("div", { ref: host })),
    h("div", { className: "caption" }, spec.caption));
}

// One global fetch stands in for the host route; the balance a frame sees is
// selected immediately before that frame's panel opens.
window.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(window.__BALANCE__ ?? { ok: false, error: "none" }),
});

ReactDOM.createRoot(document.getElementById("stage")).render(
  h(React.Fragment, null, FIXTURES.frames.map((spec) => h(Frame, { key: spec.caption, spec }))),
);

// 3. Open each panel with a real DOM click, pick the character through the
//    panel's own switcher, then report what actually happened.
window.PREVIEW_READY = (async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  const cols = [...document.querySelectorAll(".col")];
  for (let index = 0; index < cols.length; index += 1) {
    const spec = FIXTURES.frames[index];
    const frame = cols[index].querySelector(".frame");
    if (spec.open) {
      window.__BALANCE__ = spec.balance;
      frame.querySelector(".dsh-mascot-btn").click();
      await new Promise((resolve) => setTimeout(resolve, 90));
      if (spec.character !== "closure") {
        const buttons = frame.querySelectorAll(".dsh-mascot-switch button");
        buttons[spec.character === "yuno" ? 1 : 0].click();
        await new Promise((resolve) => setTimeout(resolve, 90));
      }
    }
    const chip = frame.querySelector(".dsh-mascot-chip");
    const panel = frame.querySelector(".dsh-mascot-panel");
    const sprite = frame.querySelector(".dsh-mascot-btn");
    const box = frame.getBoundingClientRect();
    const spriteBox = sprite.getBoundingClientRect();
    const notes = ["chip: " + (chip === null ? "MISSING" : chip.textContent)];
    if (panel !== null && panel.getBoundingClientRect().top < box.top) notes.push("PANEL CLIPPED");
    if (panel !== null && panel.scrollHeight > panel.clientHeight + 1) notes.push("PANEL SCROLLS");
    if (spriteBox.bottom > box.bottom + 0.5 || spriteBox.top < box.top) notes.push("SPRITE CLIPPED");
    if (spriteBox.right > box.right + 0.5 || spriteBox.left < box.left) notes.push("SPRITE OVERFLOWS");
    cols[index].querySelector(".caption").textContent = spec.caption + "   ·   " + notes.join("   ·   ");
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
})();`;

const page = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-plugin-mascot · preview</title>
<style>
  ${STYLE}
</style>
<script src="${url("node_modules/react/umd/react.production.min.js")}"></script>
<script src="${url("node_modules/react-dom/umd/react-dom.production.min.js")}"></script>
</head><body>
<div id="stage"></div>
<script>
${SCRIPT}
</script>
<script src="${url("lib/client.js")}"></script>
<script>
${SCRIPT2}
</script>
</body></html>`;

const previewHtml = join(docs, "preview.html");
const previewPng = join(docs, "preview.png");
writeFileSync(previewHtml, page);

execFileSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=1.5",
    "--virtual-time-budget=5000",
    `--screenshot=${previewPng}`,
    "--window-size=1668,960",
    pathToFileURL(previewHtml).href,
  ],
  { stdio: "pipe" },
);

console.log(`preview: wrote ${previewPng}`);
