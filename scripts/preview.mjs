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
 *   node scripts/preview.mjs              → docs/preview.png
 *        Built-in vector art: what a fresh clone shows, and what gets committed.
 *   node scripts/preview.mjs --official   → docs/preview-official.png
 *        The real thing, reading art/ over `file:`. Gitignored, because that
 *        picture contains official artwork this repository does not own.
 *
 * Requires the devDependencies (`react`, `react-dom`) and a Chromium binary.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChromium } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(root, "docs");
mkdirSync(docs, { recursive: true });

/** `--official` renders against the artwork in `art/` instead of the placeholder. */
const official = process.argv.includes("--official");
const artBase = official ? pathToFileURL(join(root, "art")).href : "";

/** The host half's look index, replayed to the client so the real catalogue renders. */
const lookIndex = existsSync(join(root, "art", "index.json"))
  ? JSON.parse(readFileSync(join(root, "art", "index.json"), "utf8"))
  : { seats: {}, characters: [], looks: [] };

const chrome = findChromium();

const url = (relative) => pathToFileURL(join(root, relative)).href;

/** Fixtures mirror the wire shapes documented on `deriveStats`. */
const FIXTURES = {
  usage: { uncachedInputTokens: 18432, outputTokens: 15204, cacheReadTokens: 214784, cacheWriteTokens: 8192 },
  pressure: { pressureTokens: 241408, projectedTokens: 262144, contextWindow: 1000000 },
  sessionId: "9f2c41ab-7d33-4e8a-9c10-2b6f5ae0d711",
  frames: [
    {
      caption: "可露希尔 · 罗德岛工程终端",
      character: "closure",
      characterName: "可露希尔",
      look: "基建小人",
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
      caption: "千石由乃 · 常服（粉发眼镜）",
      character: "yuno",
      characterName: "千石由乃",
      look: "常服",
      open: true,
      balance: { ok: false, error: "missing_credential", message: "未配置 DEEPSEEK_API_KEY，请在「设置 → 模型」中填写" },
    },
    {
      caption: "千石由乃 · Q 版（两帧动态）",
      character: "yuno",
      characterName: "千石由乃",
      look: "Q 版",
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
    { caption: "收起状态", character: "closure", characterName: "可露希尔", look: undefined, open: false, balance: undefined },
  ],
};

const STYLE = [
  "body { margin: 0; padding: 20px; background: #0b0d12; display: flex; gap: 18px;",
  '  font-family: ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; }',
  "#stage { display: flex; gap: 18px; align-items: flex-start; }",
  ".col { display: grid; gap: 10px; }",
  ".caption { font-size: 11px; line-height: 1.6; letter-spacing: .3px; color: rgba(255,255,255,.44);",
  "  width: 400px; word-break: break-word; }",
  "/* Stand-in for the DSH shell, so the overlay has somewhere to float. */",
  ".frame { position: relative; width: 400px; height: 860px; border-radius: 14px; overflow: hidden;",
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
  "const LOOK_INDEX = " + JSON.stringify({ ok: true, ...lookIndex }) + ";",
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

// The default base is the host half's route; over file: this points at art/.
plugin.setArtBase(${JSON.stringify(artBase)});

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

// One global fetch stands in for the host routes: the look index is answered once
// and cached in the page, so which look a frame shows is driven through the
// panel's own pickers rather than by swapping the fixture per frame.
window.fetch = (input) => {
  const url = String(input);
  if (url.includes("/api/looks")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(LOOK_INDEX) });
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve(window.__BALANCE__ ?? { ok: false, error: "none" }),
  });
};

ReactDOM.createRoot(document.getElementById("stage")).render(
  h(React.Fragment, null, FIXTURES.frames.map((spec) => h(Frame, { key: spec.caption, spec }))),
);

// 3. Open each panel with a real DOM click, pick the character through the
//    panel's own switcher, then report what actually happened.
window.PREVIEW_READY = (async () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const cols = [...document.querySelectorAll(".col")];
  for (let index = 0; index < cols.length; index += 1) {
    const spec = FIXTURES.frames[index];
    const frame = cols[index].querySelector(".frame");
    if (spec.open) {
      window.__BALANCE__ = spec.balance;
      frame.querySelector(".dsh-mascot-btn").click();
      await settle();
      // Rows appear only once the panel is open: the first is characters, the
      // second is that character's looks.
      const rows = frame.querySelectorAll(".dsh-mascot-row");
      if (rows.length > 0 && spec.character !== "closure") {
        const names = [...rows[0].querySelectorAll("button")];
        const target = names.find((button) => button.textContent.includes(spec.characterName));
        if (target !== undefined) { target.click(); await settle(); }
      }
      if (rows.length > 1 && spec.look !== undefined) {
        const looks = [...frame.querySelectorAll(".dsh-mascot-row")][1].querySelectorAll("button");
        const target = [...looks].find((button) => button.textContent.includes(spec.look));
        if (target !== undefined) { target.click(); await settle(); }
      }
    }
    const chip = frame.querySelector(".dsh-mascot-chip");
    const panel = frame.querySelector(".dsh-mascot-panel");
    const sprite = frame.querySelector(".dsh-mascot-btn");
    const box = frame.getBoundingClientRect();
    const spriteBox = sprite.getBoundingClientRect();
    const notes = ["chip: " + (chip === null ? "MISSING" : chip.textContent)];
    if (panel !== null && panel.getBoundingClientRect().top < box.top) notes.push("PANEL CLIPPED");
    if (panel !== null && panel.scrollHeight > panel.clientHeight + 1) {
      notes.push("panel scrollable " + String(panel.scrollHeight) + ">" + String(panel.clientHeight));
    }
    if (spriteBox.bottom > box.bottom + 0.5 || spriteBox.top < box.top) notes.push("SPRITE CLIPPED");
    if (spriteBox.right > box.right + 0.5 || spriteBox.left < box.left) notes.push("SPRITE OVERFLOWS");
    const shown = frame.querySelectorAll(".dsh-mascot-sprite .dsh-mascot-frame");
    if (shown.length > 1) notes.push("frames: " + String(shown.length));
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

const previewHtml = join(docs, official ? "preview-official.html" : "preview.html");
const previewPng = join(docs, official ? "preview-official.png" : "preview.png");
writeFileSync(previewHtml, page);

execFileSync(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--force-device-scale-factor=1.35",
    "--virtual-time-budget=5000",
    `--screenshot=${previewPng}`,
    "--window-size=1740,1210",
    pathToFileURL(previewHtml).href,
  ],
  { stdio: "pipe" },
);

console.log(`preview: wrote ${previewPng}`);
