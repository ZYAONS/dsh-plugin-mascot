#!/usr/bin/env node
/**
 * Self-check for the configuration console in `docs/`.
 *
 * The console is the one artefact here that cannot be unit-tested by importing it,
 * so this drives it over the Chrome DevTools Protocol instead: a real browser, real
 * dispatched clicks, real console output. The rule the assertions follow is that a
 * claim must be a fact produced by running the page, not an inference from reading
 * its source.
 *
 *   npm run check:site                 # check docs/index.html over file:
 *   npm run check:site -- https://…/   # check a deployed copy over http(s)
 *   npm run check:site -- --shot       # also write the theme screenshots
 *
 * Two viewports are exercised, desktop and a genuinely narrow one set through
 * `Emulation.setDeviceMetricsOverride` — a headless `--window-size` is not the
 * layout viewport, it crops a wider one, which turns "text overflows" into a
 * phantom failure.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChromium } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = join(root, "docs", "index.html");
const shot = process.argv.includes("--shot");
const explicit = process.argv.find((argument) => /^https?:\/\//iu.test(argument));
const targetUrl = explicit ?? pathToFileURL(index).href;
const overHttp = explicit !== undefined;
/** The same page with a query string; the console reads theme/character/preview from it. */
const withQuery = (query) => `${targetUrl}${targetUrl.includes("?") ? "&" : "?"}${query}`;
/**
 * The interactive runs use the built-in test pattern: with no DSH on the checking
 * machine there is no artwork to fetch, and the pattern is what exercises
 * measure -> auto-rig -> skin -> animate without a host.
 */
const previewUrl = withQuery("preview=test");

if (!existsSync(index)) {
  console.error("check-site: docs/index.html is missing");
  process.exit(1);
}

let failures = 0;
let passes = 0;
const ok = (name, pass, detail = "") => {
  if (pass) {
    passes += 1;
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail === "" ? "" : `\n          → ${detail}`}`);
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Poll to a terminal state; a fixed sleep is what makes a suite pass locally and fail in CI. */
async function until(check, timeout = 8000, step = 100) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() - started > timeout) return undefined;
    await wait(step);
  }
}

//#region static checks
//#region rig freshness
/** The three regions build-site lifts out of the plugin, and their generated home. */
function rigRegions(source) {
  const names = ["skeleton", "skinning", "pose"];
  const out = [];
  for (const name of names) {
    const start = source.indexOf(`\t\t//#region ${name}\n`);
    if (start < 0) throw new Error(`lib/client.js has no #region ${name}`);
    const end = source.indexOf("//#endregion", start);
    out.push(source.slice(start, end));
  }
  return out.join("");
}

const clientSource = readFileSync(join(root, "lib", "client.js"), "utf8");
const rigSource = readFileSync(join(root, "docs", "site", "rig.js"), "utf8");
// The generated module must carry every line the plugin's regions carry. Compared
// as a set of lines so the wrapper and the de-indentation cannot cause a false
// failure, while a real edit to the rig still does.
const wanted = new Set(rigRegions(clientSource).split("\n").map((line) => line.trim()).filter((line) => line.length > 0));
const present = new Set(rigSource.split("\n").map((line) => line.trim()));
const missing = [...wanted].filter((line) => !present.has(line));
ok(
  "docs/site/rig.js is in sync with the plugin's own skeleton",
  missing.length === 0,
  missing.length === 0 ? "" : `${String(missing.length)} line(s) missing, e.g. "${missing[0] ?? ""}" — run \`npm run build:site\``,
);

// The console previews with the plugin's rig, so a WebGL failure there has to be
// reportable, which means rig.js must export the reason accessor too.
ok("the generated rig exposes rigStatus()", /export\s*\{[^}]*rigStatus[^}]*\}/u.test(rigSource), "rigStatus is not exported");
//#endregion

//#region catalogue
const catalog = JSON.parse(readFileSync(join(root, "docs", "site", "catalog.json"), "utf8"));
ok(`catalogue loaded: ${String(catalog.characters.length)} characters, ${String(catalog.looks.length)} looks`, catalog.characters.length > 0 && catalog.looks.length > 0);

// The console is English-only, so every record it renders needs an English name.
const untranslated = [
  ...catalog.characters.filter((entry) => !entry.nameEn || !entry.roleEn).map((entry) => `character ${entry.id}`),
  ...catalog.looks.filter((entry) => !entry.nameEn).map((entry) => `look ${entry.id}`),
];
ok("every character and look has an English name", untranslated.length === 0, untranslated.join(", "));

// The page must be English: the only Chinese left belongs to the rights notice,
// where the original names are the attribution.
const html = readFileSync(index, "utf8");
const cjk = html.match(/[\u4e00-\u9fff]+/gu) ?? [];
const strayCjk = cjk.filter((run) => run !== "可露希尔" && run !== "千石由乃");
ok(
  `no Chinese outside the rights notice (${String(cjk.length)} permitted occurrence(s))`,
  strayCjk.length === 0,
  strayCjk.slice(0, 6).join(" / "),
);

// Scripts and stylesheets must be modules/relative and present, or the page loads
// but does nothing — a failure that looks exactly like a styling bug.
for (const asset of ["site/site.css", "site/site.js", "site/preview.js", "site/rig.js", "site/catalog.json"]) {
  ok(`${asset} exists`, existsSync(join(root, "docs", asset)));
}
ok("site.js is loaded as a module", /<script type="module" src="site\/site\.js">/u.test(html));
//#endregion

//#region themes
const css = readFileSync(join(root, "docs", "site", "site.css"), "utf8");
const tokensOf = (selector) => {
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "u").exec(css);
  if (block === null) return {};
  const tokens = {};
  for (const match of block[1].matchAll(/(--[a-z-]+):\s*([^;]+);/gu)) tokens[match[1]] = match[2].trim();
  return tokens;
};
const closureTheme = { ...tokensOf(":root"), ...tokensOf('\\[data-theme="closure"\\]') };
const yunoTheme = tokensOf('\\[data-theme="yuno"\\]');
for (const token of ["--signal", "--ink", "--panel", "--radius", "--tape-a", "--label-font"]) {
  const a = closureTheme[token];
  const b = yunoTheme[token];
  ok(
    `theme token ${token} differs between the two themes`,
    a !== undefined && b !== undefined && a !== b,
    a === b ? `both are ${String(a)} — that is a hue swap, not a theme` : `closure=${String(a)} yuno=${String(b)}`,
  );
}
ok(
  "the Yuno theme replaces the corner brackets with a glow",
  /\[data-theme="yuno"\]\s+\.card::before/u.test(css) && /\[data-theme="yuno"\]\s+\.card\[data-on="1"\]\s*\{\s*box-shadow/u.test(css),
  "the selection cue is not overridden",
);
//#endregion
//#endregion

//#region browser
/** A tiny CDP client over Node's built-in WebSocket. */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.next = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error !== undefined) entry?.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry?.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  static async attach(webSocketDebuggerUrl) {
    const socket = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("could not open the DevTools socket")), { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  send(method, params = {}) {
    const id = (this.next += 1);
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result.value;
  }

  /**
   * Click an element the way a person does: scroll it into view, then dispatch a
   * real press and release at its centre.
   *
   * The scroll is not incidental. A dispatched mouse event whose coordinates fall
   * outside the layout viewport lands on nothing at all, so a control below the
   * fold would silently never be clicked and the assertion would fail as though the
   * handler were broken — the most misleading failure this suite can produce.
   */
  async click(selector) {
    const found = await this.evaluate(
      `(() => { const n = document.querySelector(${JSON.stringify(selector)});
        if (!n) return false; n.scrollIntoView({ block: "center", inline: "center" }); return true; })()`,
    );
    if (found !== true) throw new Error(`no element matches ${selector}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const box = await this.evaluate(
      `(() => { const n = document.querySelector(${JSON.stringify(selector)});
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    if (box === null) throw new Error(`${selector} has no clickable area`);
    const inView = await this.evaluate(`(${String(Math.round(box.x))} <= window.innerWidth) && (${String(Math.round(box.y))} <= window.innerHeight)`);
    if (inView !== true) {
      throw new Error(`${selector} is still outside the viewport after scrolling (${String(Math.round(box.x))}, ${String(Math.round(box.y))})`);
    }
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
  }

  close() {
    try {
      this.socket.close();
    } catch {
      /* already gone */
    }
  }
}

/** Launch a headless browser and attach to its first page target. */
async function launch(chrome) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), "dsh-mascot-check-"));
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--allow-file-access-from-files",
      // Software WebGL: the preview draws a skinned mesh, and headless Chromium
      // refuses a GL context without this.
      "--enable-unsafe-swiftshader",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    // Piped stdio is refused under some sandboxes, and nothing here needs it: the
    // port is polled over HTTP instead of parsed out of stderr.
    { stdio: "ignore" },
  );
  const target = await until(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`);
      const list = await response.json();
      return list.find((entry) => entry.type === "page")?.webSocketDebuggerUrl;
    } catch {
      return undefined;
    }
  }, 20000, 150);
  if (target === undefined) {
    child.kill();
    throw new Error("the browser never opened a DevTools endpoint");
  }
  return { child, cdp: await Cdp.attach(target) };
}

/**
 * The in-page suite.
 *
 * Written as a string because it runs inside the browser, and built without
 * template literals so it cannot collide with the ones around it. It returns raw
 * facts; every judgement is made in Node, where a failure can print a value.
 */
const pageSuite = (expected) => `(async () => {
  const facts = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms, step) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return undefined;
      await wait(step || 100);
    }
  };
  const box = (node) => { const r = node.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.left, y: r.top }; };

  facts.stylesheet = getComputedStyle(document.body).backgroundColor;
  facts.sections = document.querySelectorAll("section").length;
  facts.headings = [...document.querySelectorAll("section h2")].map((n) => n.textContent.replace(/\\s+/g, " ").trim()).filter(Boolean);
  facts.title = (document.querySelector("h1") || {}).textContent || "";
  facts.charactersMeta = (document.getElementById("m-characters") || {}).textContent;
  facts.looksMeta = (document.getElementById("m-looks") || {}).textContent;
  facts.cards = document.querySelectorAll(".card").length;
  facts.charCards = document.querySelectorAll("#characters .card").length;
  facts.lookCards = document.querySelectorAll("#looks .card").length;
  facts.theme = document.documentElement.dataset.theme;
  facts.litThemeButton = (document.querySelector("#theme button[data-on='1']") || {}).dataset ? document.querySelector("#theme button[data-on='1']").dataset.themeChoice : null;
  facts.overflow = { scroll: document.documentElement.scrollWidth, inner: window.innerWidth };

  // Every section must actually occupy space; a section that renders at zero
  // height is the failure mode a DOM-presence assertion misses.
  const invisible = [];
  for (const section of document.querySelectorAll("section")) {
    const r = section.getBoundingClientRect();
    if (r.height < 20 || r.width < 50) invisible.push((section.id || section.querySelector("h2").textContent) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  facts.invisibleSections = invisible;

  // ---- real clicks -------------------------------------------------------
  // Theme: click the Yuno button and read what the document actually becomes.
  const yunoButton = document.querySelector("#theme button[data-theme-choice='yuno']");
  if (yunoButton) { const r = yunoButton.getBoundingClientRect(); facts.yunoButtonAt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  facts.outputBefore = (document.getElementById("output") || {}).textContent || "";
  const yunoCard = document.querySelector("#characters .card:nth-child(2)");
  if (yunoCard) { const r = yunoCard.getBoundingClientRect(); facts.yunoCardAt = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  facts.previewHost = (() => {
    const host = document.getElementById("preview-host");
    if (!host) return null;
    const canvas = host.querySelector("canvas");
    return { canvas: canvas !== null, width: canvas ? canvas.width : 0, height: canvas ? canvas.height : 0, texts: host.textContent.trim().slice(0, 120) };
  })();
  facts.previewStatus = (document.getElementById("preview-status") || {}).textContent || "";
  facts.previewStage = (() => { const n = document.querySelector(".preview-stage"); return n ? box(n) : null; })();

  facts.expected = ${JSON.stringify(expected)};
  return facts;
})()`;

const chrome = findChromium();
console.log(`check-site: ${overHttp ? targetUrl : "docs/index.html (file:)"} in ${chrome}\n`);

const browser = await launch(chrome);
const { cdp } = browser;
/** Uncaught exceptions and console errors are failures, not noise. */
const pageProblems = [];
cdp.on("Runtime.exceptionThrown", (params) => {
  pageProblems.push(`uncaught: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "?"}`);
});
cdp.on("Log.entryAdded", (params) => {
  if (params.entry?.level === "error") pageProblems.push(`console: ${params.entry.text}`);
});
cdp.on("Runtime.consoleAPICalled", (params) => {
  if (params.type === "error") pageProblems.push(`console.error: ${(params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")}`);
});
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");
await cdp.send("Page.enable");

/** Navigate and wait until the console has drawn its catalogued cards. */
async function visit(url, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile ?? false });
  await cdp.send("Page.navigate", { url });
  // Poll for the terminal state rather than sleeping: the catalogue arrives over
  // fetch, and the preview finishes on an image decode after that.
  // `#output` exists from the first paint and holds "Generating…" until the first
  // render, so waiting for it to merely exist returns while the page is still
  // starting. Waiting for real content is the difference between a terminal state
  // and a hopeful sleep.
  const ready = await until(
    () => cdp.evaluate("document.querySelectorAll('.card').length > 0 && (document.getElementById('output')||{}).textContent.trim().length > 60").catch(() => false),
    20000,
    120,
  );
  if (ready === undefined) throw new Error(`the console never rendered for ${url}`);
  await wait(300);
}

const expected = { characters: catalog.characters.length, looks: catalog.looks.length };

// ---- desktop ---------------------------------------------------------------
await visit(previewUrl, { width: 1360, height: 900 });
const desktop = await cdp.evaluate(pageSuite(expected));

ok("the stylesheet applied (body has a background)", desktop.stylesheet !== "rgba(0, 0, 0, 0)" && desktop.stylesheet.startsWith("rgb"), `background-color=${desktop.stylesheet}`);
ok("the page has a title", desktop.title.trim().length > 0, `h1="${desktop.title.trim()}"`);
ok("every section rendered with real size", desktop.invisibleSections.length === 0, desktop.invisibleSections.join("; "));
ok(
  `the console reports the catalogue it loaded (${String(expected.characters)} characters, ${String(expected.looks)} looks)`,
  desktop.charactersMeta === String(expected.characters) && desktop.looksMeta === String(expected.looks),
  `page says ${String(desktop.charactersMeta)}/${String(desktop.looksMeta)}`,
);
ok("the preview stage is present and sized", desktop.previewStage !== null && desktop.previewStage.w > 100 && desktop.previewStage.h > 100, JSON.stringify(desktop.previewStage));

// The preview must have produced a canvas, which only happens when the shaders
// compiled and a texture uploaded — the still-image fallback produces no canvas.
ok("the preview rendered a WebGL canvas", desktop.previewHost?.canvas === true, `host contains: ${desktop.previewHost?.texts ?? "(nothing)"}`);
ok(
  "the canvas is backed at the device pixel ratio, not 0×0",
  desktop.previewHost !== null && desktop.previewHost.width >= 104 && desktop.previewHost.height >= 172,
  `${String(desktop.previewHost?.width)}×${String(desktop.previewHost?.height)}`,
);
ok("the preview reported success rather than a fallback", /test pattern|Connected/i.test(desktop.previewStatus), desktop.previewStatus.slice(0, 160));

//#region layout
// Horizontal overflow is the cheapest layout regression there is, and the one a
// headless screenshot passes right over.
ok(
  "no horizontal overflow at 1360px",
  desktop.overflow.scroll <= desktop.overflow.inner + 1,
  `scrollWidth=${String(desktop.overflow.scroll)} innerWidth=${String(desktop.overflow.inner)}`,
);
//#endregion

// ---- real interaction ------------------------------------------------------
// Clicked through Input.dispatchMouseEvent: a handler that is bound but never
// reached, or a control covered by an overlay, shows up here and nowhere else.
await cdp.click("#theme button[data-theme-choice='yuno']");
await wait(250);
const afterThemeClick = await cdp.evaluate(
  "({ theme: document.documentElement.dataset.theme, lit: (document.querySelector(\"#theme button[data-on='1']\")||{dataset:{}}).dataset.themeChoice, ink: getComputedStyle(document.body).backgroundColor })",
);
ok("clicking the Yuno theme button switches the document theme", afterThemeClick.theme === "yuno", `data-theme=${String(afterThemeClick.theme)}`);
ok("the clicked button is the lit one", afterThemeClick.lit === "yuno", `lit=${String(afterThemeClick.lit)}`);
ok("the switch repainted the page", afterThemeClick.ink !== desktop.stylesheet, `was ${desktop.stylesheet}, now ${String(afterThemeClick.ink)}`);

await cdp.click("#theme button[data-theme-choice='closure']");
await wait(250);
const afterClosureClick = await cdp.evaluate("document.documentElement.dataset.theme");
ok("clicking the Closure theme button switches back", afterClosureClick === "closure", `data-theme=${String(afterClosureClick)}`);

// Selecting a character must drive both the panel and the preview.
await cdp.click("#characters .card:nth-child(2)");
await wait(500);
const afterCharacterClick = await cdp.evaluate(
  "(() => { const y = document.querySelector(\".dsh-yaml\") ; return { lookCards: document.querySelectorAll('#looks .card').length, firstLookId: (document.querySelector('#looks .card .code')||{}).textContent || '', output: document.getElementById('output').textContent, previewCanvas: document.querySelector('#preview-host canvas') !== null }; })()",
);
ok("selecting a character swaps the look cards", afterCharacterClick.lookCards > 0 && /yuno/u.test(afterCharacterClick.firstLookId), `first look card = "${afterCharacterClick.firstLookId}"`);
ok("the generated config follows the character", /character: yuno/u.test(afterCharacterClick.output), afterCharacterClick.output.split("\n").filter((l) => l.includes("character:")).join(" | "));
ok("the preview survived the switch", afterCharacterClick.previewCanvas === true, "the canvas is gone");

// Toggling a look off must remove it from the allowlist, not merely grey the card.
const beforeToggle = await cdp.evaluate("document.getElementById('output').textContent");
const toggledId = await cdp.evaluate("document.querySelector('#looks .card .code').textContent.trim()");
await cdp.click("#looks .card:nth-child(1)");
await wait(200);
const afterToggle = await cdp.evaluate("({ output: document.getElementById('output').textContent, on: document.querySelector('#looks .card').dataset.on })");
ok("clicking a look card unticks it", afterToggle.on === "0", `data-on=${String(afterToggle.on)}`);
const listedBefore = (beforeToggle.match(/^ {10}- (.+)$/gmu) ?? []).map((line) => line.trim().slice(2));
const listedAfter = (afterToggle.output.match(/^ {10}- (.+)$/gmu) ?? []).map((line) => line.trim().slice(2));
ok(
  `the allowlist lost exactly "${toggledId}"`,
  listedBefore.includes(toggledId) && !listedAfter.includes(toggledId) && listedAfter.length === listedBefore.length - 1,
  `before=[${listedBefore.join(", ")}] after=[${listedAfter.join(", ")}]`,
);

// Turning the plugin off must produce the disabled block rather than a broken one.
await cdp.click("#t-plugin");
await wait(200);
const disabled = await cdp.evaluate("document.getElementById('output').textContent");
ok("disabling the plugin produces a commented-out block", disabled.includes("#") && /disabled/iu.test(disabled) && !/^- insert:$/mu.test(disabled), disabled.split("\n")[0] ?? "");
await cdp.click("#t-plugin");
await wait(200);

// ---- narrow viewport -------------------------------------------------------
await visit(previewUrl, { width: 390, height: 780, mobile: true });
const narrow = await cdp.evaluate(pageSuite(expected));
// The probe that separates a real overflow from the headless minimum-width trap.
ok("the narrow viewport really is 390px wide", Math.abs(narrow.overflow.inner - 390) <= 1, `innerWidth=${String(narrow.overflow.inner)}`);
ok(
  "no horizontal overflow at 390px",
  narrow.overflow.scroll <= narrow.overflow.inner + 1,
  `scrollWidth=${String(narrow.overflow.scroll)} innerWidth=${String(narrow.overflow.inner)}`,
);
ok("every section still rendered at 390px", narrow.invisibleSections.length === 0, narrow.invisibleSections.join("; "));
ok("the preview still rendered at 390px", narrow.previewHost?.canvas === true, `host contains: ${narrow.previewHost?.texts ?? "(nothing)"}`);

// ---- does it actually move? ------------------------------------------------
// The page claims the sprite is animated. This samples the compositor twice and
// requires the pixels to differ, which is the only assertion here that cannot be
// satisfied by code that merely exists.
await visit(previewUrl, { width: 1360, height: 900 });
const stage = await cdp.evaluate("(() => { const n = document.querySelector('.preview-stage'); const r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()");
const capture = async () => (await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...stage, scale: 1 } })).data;
const first = await capture();
await wait(700);
const second = await capture();
ok(
  "the preview is genuinely animating (two frames differ)",
  first !== second,
  "the two captures are byte-identical, so nothing is moving",
);

if (shot) {
  // Served over HTTP rather than opened as a file. On `file:` an image taints the
  // canvas, so the rig refuses it and the screenshots would show stills of a page
  // that rigs perfectly when it is actually hosted — the README would be lying.
  // A plain static server over docs/ is exactly what Pages does.
  const statics = createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname).replace(/^\/+/u, "") || "index.html";
    const file = join(root, "docs", relative);
    if (!file.startsWith(join(root, "docs"))) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const body = readFileSync(file);
      const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png" }[extname(file)] ?? "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => statics.listen(0, "127.0.0.1", resolve));
  const staticUrl = `http://127.0.0.1:${String(statics.address().port)}/index.html`;

  // Every parameter is pinned. The interaction run above writes to localStorage,
  // which survives navigation in this profile, so a screenshot taken without
  // pinning the character would silently record whatever was clicked last.
  for (const [name, query] of [
    ["preview.png", "theme=closure&character=closure"],
    ["preview-yuno.png", "theme=yuno&character=yuno"],
  ]) {
    await visit(`${staticUrl}?${query}`, { width: 1180, height: 2100 });
    await wait(900);
    const data = (await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })).data;
    writeFileSync(join(root, "docs", "site", name), Buffer.from(data, "base64"));
    console.log(`  ok    wrote docs/site/${name}`);
  }
  statics.close();
}

// ---- served by the real plugin, on its own origin --------------------------
// The whole point of serving the console from the plugin is that the preview then
// runs same-origin and can read the artwork. This starts the plugin's actual host
// half behind a real HTTP server — not a stub of it — and drives the page through
// that, which is the only way to know the two halves agree about the contract.
let localServer;
let localUrl;
try {
  const plugin = await import(pathToFileURL(join(root, "lib", "index.js")).href);
  let registered;
  const ctx = {
    get: () => undefined,
    effect: (callback) => callback(),
    webServer: {
      register(entry) {
        registered = entry;
        return () => {};
      },
    },
  };
  await plugin.apply(ctx, {});
  localServer = createServer((request, response) => {
    // A loopback Host is what the plugin's own fallback authorization wants when no
    // Connection service is composed, which is exactly this situation.
    registered.handler(request, response).catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolve) => localServer.listen(0, "127.0.0.1", resolve));
  localUrl = `http://127.0.0.1:${String(localServer.address().port)}/dsh-mascot/console/`;
} catch (error) {
  console.error(`  FAIL  could not start the plugin's host half for the same-origin check\n          → ${String(error.message)}`);
  failures += 1;
}

if (localUrl !== undefined) {
  await visit(localUrl, { width: 1360, height: 900 });
  const local = await cdp.evaluate(
    "({ note: document.getElementById('preview-note').textContent, status: document.getElementById('preview-status').textContent, canvas: document.querySelector('#preview-host canvas') !== null, still: document.querySelector('#preview-host .preview-still') !== null, empty: (document.getElementById('preview-host').textContent||'').trim().length })",
  );
  ok(
    "the status line reports the live view rather than the boot placeholder",
    /Live from this machine/iu.test(local.status),
    `status="${local.status.slice(0, 120)}"`,
  );
  ok(
    "served by the plugin, the console recognises its own origin",
    /reading the artwork installed/iu.test(local.note),
    `note="${local.note.slice(0, 120)}"`,
  );
  ok(
    "and renders the artwork installed on this machine",
    local.canvas === true,
    `canvas=${String(local.canvas)} still=${String(local.still)} host text="${String(local.empty).slice(0, 90)}" status="${local.status.slice(0, 120)}"`,
  );
  const localRig = await cdp.evaluate("window.__dshRigReason === undefined ? null : window.__dshRigReason");
  ok("with the rig actually running, not the still fallback", localRig === null, `rig reported: ${String(localRig)}`);

  // And it must move here too, against real artwork rather than a test pattern.
  const localStage = await cdp.evaluate("(() => { const n = document.querySelector('.preview-stage'); const r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()");
  const shotA = (await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...localStage, scale: 1 } })).data;
  await wait(700);
  const shotB = (await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...localStage, scale: 1 } })).data;
  ok("the live artwork is genuinely animating (two frames differ)", shotA !== shotB, "the two captures are byte-identical, so the sprite is frozen");

  // Switching character must swap what is drawn — the request that started all this.
  const beforeSwitch = await cdp.evaluate("document.querySelector('#preview-host canvas') !== null");
  await cdp.click("#characters .card:nth-child(2)");
  await wait(900);
  const afterSwitch = await cdp.evaluate(
    "({ canvas: document.querySelector('#preview-host canvas') !== null, status: document.getElementById('preview-status').textContent })",
  );
  ok("switching character re-renders the preview in place", beforeSwitch && afterSwitch.canvas === true, `before=${String(beforeSwitch)} after=${JSON.stringify(afterSwitch)}`);
}

// ---- the published copy, with no host of any kind --------------------------
// This is the front door: a visitor with nothing installed. It now shows the
// characters anyway, loading each look from where the artwork already lives.
// Pinned, because localStorage survives navigation in this profile: without it the
// "before" state is whatever the previous section clicked last, and a switch test
// that starts on the destination proves nothing.
await visit(withQuery("character=closure&theme=closure"), { width: 1360, height: 900 });
const published = await cdp.evaluate(
  "({ canvas: document.querySelector('#preview-host canvas') !== null, stills: document.querySelectorAll('#preview-host img').length, notice: (document.querySelector('#preview-host .preview-empty')||{}).textContent || '', cards: document.querySelectorAll('#looks .card').length, output: document.getElementById('output').textContent.length, status: document.getElementById('preview-status').textContent })",
);
ok(
  "the published copy shows the mascot with nothing installed",
  published.canvas || published.stills > 0,
  `canvas=${String(published.canvas)} stills=${String(published.stills)} notice="${published.notice.slice(0, 110)}"`,
);
ok(
  "and says where the pixels came from",
  /source|CORS|as-is|rigged/iu.test(published.status),
  `status="${published.status.slice(0, 140)}"`,
);
// Attribution belongs on screen, with the artwork — that is the whole reason the
// project can show someone else's character at all.
const credit = await cdp.evaluate("document.getElementById('preview-credit').textContent");
ok(
  "the character on screen is attributed to its rights holder",
  /©/u.test(credit) && /Hypergryph|Bushiroad/u.test(credit) && /not affiliated/iu.test(credit),
  `credit="${credit.slice(0, 160)}"`,
);

ok("the rest of the console is unaffected", published.cards > 0 && published.output > 200, `look cards=${String(published.cards)} output=${String(published.output)} chars`);

// Switching character must swap the picture here too — that is the request this
// whole section exists to satisfy. Compared at the compositor, not by reading an
// element: a rigged look renders into a canvas, and two canvases look identical to
// anything that only inspects the DOM.
const stageBox = async () =>
  cdp.evaluate("(() => { const n = document.querySelector('.preview-stage'); const r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()");
const shootStage = async () => (await cdp.send("Page.captureScreenshot", { format: "png", clip: { ...(await stageBox()), scale: 1 } })).data;

const closureLook = await cdp.evaluate("document.querySelector('#looks .card .code').textContent.trim()");
ok("the published copy starts on the pinned character", /^closure-/u.test(closureLook), `first look card = "${closureLook}"`);
const closureShot = await shootStage();
await cdp.click("#characters .card:nth-child(2)");
await wait(1400);
const yunoShot = await shootStage();
const yunoLook = await cdp.evaluate("document.querySelector('#looks .card .code').textContent.trim()");
ok(
  `switching character moves the console to Yuno (${closureLook} → ${yunoLook})`,
  /^yuno-/u.test(yunoLook),
  `look cards now start at "${yunoLook}"`,
);
ok(
  "and the published frame is redrawn, not left showing the previous character",
  closureShot !== yunoShot,
  "the two compositor captures are byte-identical",
);

// The Q-version specifically: two drawn poses cut out of one download, hotlinked as
// the download. This is the case that needs the crop rectangle to map the measured
// geometry onto the image the browser actually holds.
// Pinned through the deep link rather than by clicking: the look cards are allowlist
// toggles, so clicking one that is already ticked would remove it from the very set
// the frame resolves against, and the frame would fall back to another look.
await visit(withQuery("theme=yuno&character=yuno&look=yuno-chibi"), { width: 1360, height: 900 });
await wait(1600);
const qVersion = await cdp.evaluate(
  "({ rig: document.querySelector('#preview-host .css-rig') !== null, poses: document.querySelectorAll('#preview-host .css-rig .rig-pose').length, heads: document.querySelectorAll('#preview-host .rig-head-layer').length, cut: (document.querySelector('.css-rig')||{style:{}}).style.getPropertyValue('--cut'), status: document.getElementById('preview-status').textContent })",
);
ok(
  "the two-pose Q-version renders as a layered rig",
  qVersion.rig && qVersion.poses === 2 && qVersion.heads === 2,
  `rig=${String(qVersion.rig)} poses=${String(qVersion.poses)} head layers=${String(qVersion.heads)}`,
);
ok(
  "its geometry was mapped onto the image the browser actually holds",
  /%$/u.test(qVersion.cut) && Number.parseFloat(qVersion.cut) > 30,
  `mask line at ${String(qVersion.cut)}; unmapped it would sit near 21%, above her head`,
);
const qA = await shootStage();
await wait(800);
const qB = await shootStage();
ok("and the Q-version is moving", qA !== qB, "the two compositor captures are byte-identical");

// And Yuno must actually be on screen, not an empty frame.
const drawn = await cdp.evaluate(
  "({ canvas: document.querySelector('#preview-host canvas') !== null, stills: document.querySelectorAll('#preview-host img').length, notice: (document.querySelector('#preview-host .preview-empty')||{}).textContent || '' })",
);
ok(
  "and Yuno is actually rendered on the published copy",
  drawn.canvas || drawn.stills > 0,
  `canvas=${String(drawn.canvas)} stills=${String(drawn.stills)} notice="${drawn.notice.slice(0, 110)}"`,
);
ok(
  "the page raised no uncaught exception and logged no error",
  pageProblems.length === 0,
  pageProblems.slice(0, 5).join(" | "),
);

cdp.close();
browser.child.kill();
if (localServer !== undefined) localServer.close();
//#endregion

console.log(`\ncheck-site: ${String(passes)} passed, ${String(failures)} failed`);
process.exit(failures === 0 ? 0 : 1);
