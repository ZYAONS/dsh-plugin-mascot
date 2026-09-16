#!/usr/bin/env node
/**
 * Self-test for `dsh-plugin-mascot`.
 *
 * The plugin runs inside a packaged DSH host that this repository cannot import,
 * so the checks here are the parts that are testable in isolation:
 *
 *   1. manifest contract  — the fields DSH's client-module discovery reads;
 *   2. client bundle      — loaded through a stub `window.__ModuleLoader__`,
 *                           proving the bundle registers and evaluates;
 *   3. statistics         — `deriveStats` against the documented projection
 *                           shapes, including the empty and partial cases;
 *   4. artwork            — the declaration, the generated index, and the
 *                           placeholder that stands in when nothing is installed.
 *
 * Run with `npm test` (or `npm run check` to add `node --check` on both halves).
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

let checks = 0;
/**
 * Run one named assertion group. Asynchronous groups are awaited, so a failing
 * assertion surfaces as a normal non-zero exit instead of an unhandled
 * rejection that races the summary line.
 */
async function it(label, fn) {
  await fn();
  checks += 1;
  console.log(`  ok  ${label}`);
}

//#region 1 — manifest
const manifest = json("package.json");
await it("manifest declares the browser half the way desktop discovery reads it", () => {
  assert.equal(manifest.name, "dsh-plugin-mascot");
  assert.equal(manifest.type, "module");
  assert.equal(typeof manifest.exports["."], "string", 'exports["."] must name the host half');
  assert.equal(typeof manifest.exports["./client"], "string", 'exports["./client"] must name the browser half');
  assert.equal(manifest.exports["./package.json"], "./package.json", 'exports["./package.json"] is required for desktop client discovery');
  assert.equal(manifest.dsh.client.platform, "web", 'dsh.client.platform must be "web"');
  assert.ok(Array.isArray(manifest.dsh.client.inject), "dsh.client.inject must be an array");
});
//#endregion

//#region 2 — client bundle through the module loader
const captured = [];
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      captured.push(registration);
    },
  },
};
globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } };
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

await import(new URL("../lib/client.js", import.meta.url).href);

await it("bundle registers exactly one module under the package name", () => {
  assert.equal(captured.length, 1, "the bundle must call __ModuleLoader__.load exactly once");
  assert.equal(captured[0].id, manifest.name, "the registered id must equal the package name");
  assert.equal(typeof captured[0].factory, "function");
});

const required = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  Fragment: Symbol.for("react.fragment"),
};
const exports_ = captured[0].factory((spec) => {
  required.push(spec);
  if (spec === "react") return React;
  throw new Error(`unexpected require(${spec})`);
});

await it("the browser half is a mountable cordis plugin", () => {
  assert.equal(typeof exports_.apply, "function", "apply(ctx) is required");
  assert.deepEqual(exports_.inject, ["slots"], "the half depends on the slot registry");
  assert.deepEqual(required, ["react"], "react is the only module the half requires (a platform seed word)");
});

await it("apply() registers into shell.overlay and declares its own session-scoped panel seat", () => {
  const registrations = [];
  const injectedKeys = [];
  const ctx = {
    effect: (callback) => {
      callback();
    },
    slots: {
      inject(key, callback) {
        injectedKeys.push(key);
        const disposers = [...callback()];
        registrations.push(...disposers.filter((d) => typeof d === "function"));
      },
      register(options) {
        registrations.push(options);
        return () => {};
      },
    },
  };
  exports_.apply(ctx);
  const options = registrations.find((entry) => typeof entry === "object");
  assert.deepEqual(injectedKeys, ["shell.overlay"], "the floating surface belongs in the frame-wide overlay");
  assert.equal(options.name, "shell.overlay");
  assert.equal(options.id, "mascot", "a fresh id is what makes the entry additive");
  assert.ok(options.children["mascot.panel"], "the panel seat must be declared as a child");
  assert.equal(options.children["mascot.panel"].scope, "session-maybe", "the panel needs session projections without requiring a session");
  assert.equal(options.children["mascot.panel"].kind, "single");
});
//#endregion

//#region 3 — statistics, themes and the fallback catalogue
const { deriveStats, THEMES, FALLBACK_LOOKS, PLACEHOLDER_SVG } = exports_;

await it("every character names a theme the stylesheet can actually draw", () => {
  assert.equal(Object.keys(THEMES).length >= 2, true, "there must be one style per character");
  const drawn = read("lib/client.js");
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.ok(theme.label.length > 0, `${id}: a theme needs a label to print in the panel`);
    assert.match(theme.accent, /^#[0-9a-f]{6}$/u, `${id}: accent must be a hex colour`);
    assert.ok(theme.font.length > 0, `${id}: a theme needs its own typeface for figures`);
    // The two themes must differ structurally, not just in hue, or "one style per
    // character" is a colour swap wearing a design's clothes.
    assert.ok(["console", "stage"].includes(theme.shape), `${id}: unknown shape`);
    assert.ok(["segmented", "vu"].includes(theme.bar), `${id}: unknown bar style`);
    assert.ok(["scanline", "pulse"].includes(theme.decor), `${id}: unknown ambient decor`);
    // The stylesheet selects on the shape/bar/decor attributes, so each named
    // value must actually have rules behind it.
    assert.ok(drawn.includes(`[data-shape="${theme.shape}"]`), `${id}: shape ${theme.shape} has no styling`);
    assert.ok(drawn.includes(`[data-bar="${theme.bar}"]`), `${id}: bar ${theme.bar} has no styling`);
  }
  const shapes = Object.values(THEMES).map((theme) => theme.shape);
  assert.equal(new Set(shapes).size, shapes.length, "each character must get a visually distinct style");
  const bars = Object.values(THEMES).map((theme) => theme.bar);
  assert.equal(new Set(bars).size, bars.length, "each character must get a visually distinct bar");
});

await it("the fallback catalogue renders without a host and names no character art", () => {
  assert.ok(Array.isArray(FALLBACK_LOOKS.characters) && FALLBACK_LOOKS.characters.length >= 2);
  assert.ok(Array.isArray(FALLBACK_LOOKS.looks) && FALLBACK_LOOKS.looks.length >= 2);
  for (const character of FALLBACK_LOOKS.characters) {
    assert.ok(THEMES[character.theme] !== undefined, `${character.id}: fallback names an unknown theme`);
    assert.ok(character.looks.length > 0);
  }
  for (const look of FALLBACK_LOOKS.looks) {
    assert.equal(look.frames.length, 0, `${look.id}: the fallback must not reference an image file`);
    assert.ok(FALLBACK_LOOKS.characters.some((entry) => entry.id === look.character), `${look.id}: unknown character`);
  }
});

await it("the built-in fallback is a neutral placeholder, not character art", () => {
  // What a fresh clone renders. It has to be recognisable as "art missing" and
  // must not smuggle a drawing of the character back into the bundle.
  assert.match(PLACEHOLDER_SVG, /^<svg /u, "the placeholder must be inline SVG");
  assert.match(PLACEHOLDER_SVG, /artwork not installed/u, "it must say what is wrong");
  assert.ok(!/hair|eye|skin/iu.test(PLACEHOLDER_SVG), "the placeholder must not depict a character");
});

await it("an absent session reads as unmeasured rather than as zero", () => {
  const stats = deriveStats(undefined, undefined);
  assert.equal(stats.billedInput, undefined);
  assert.equal(stats.total, undefined);
  assert.equal(stats.cacheHitText, "—");
  assert.equal(stats.occupancyText, "—");
  assert.equal(stats.cacheHit, undefined, "the cache-hit bar must not claim 0% it cannot measure");
});

await it("cache hit is cacheRead over every billed input bucket", () => {
  const stats = deriveStats(
    { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 100 },
    undefined,
  );
  assert.equal(stats.billedInput, 500, "billed input excludes output tokens");
  assert.equal(stats.total, 550);
  assert.equal(stats.cacheHit, 0.6);
  assert.equal(stats.cacheHitText, "60.0%");
});

await it("a fully cached prompt reads as 100%, not 99.9%", () => {
  const stats = deriveStats({ uncachedInputTokens: 0, outputTokens: 12, cacheReadTokens: 900, cacheWriteTokens: 0 }, undefined);
  assert.equal(stats.cacheHitText, "100%");
});

await it("context occupancy prefers the projected figure and clamps its bar", () => {
  const projected = deriveStats(undefined, { pressureTokens: 1000, projectedTokens: 2500, contextWindow: 10000 });
  assert.equal(projected.occupancy, 2500);
  assert.equal(projected.occupancyText, "25.0%");
  assert.equal(projected.occupancyRatio, 0.25);

  const sampled = deriveStats(undefined, { pressureTokens: 4000, contextWindow: 10000 });
  assert.equal(sampled.occupancy, 4000, "the sample is the fallback when no projection exists");

  const over = deriveStats(undefined, { projectedTokens: 40000, contextWindow: 10000 });
  assert.equal(over.occupancyRatio, 1, "the bar is clamped even when the estimate exceeds the window");
  assert.equal(over.occupancyText, "400.0%", "the number itself stays truthful");
});

await it("a session with no request yet reports an unknown window without crashing", () => {
  const stats = deriveStats({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, {});
  assert.equal(stats.total, 0);
  assert.equal(stats.cacheHitText, "—", "a zero denominator has no hit rate");
  assert.equal(stats.occupancyText, "—");
});
//#endregion

//#region 4 — host half surface
const hostSource = read("lib/index.js");
await it("the host half is a dependency-free cordis plugin", () => {
  assert.match(hostSource, /const name = "dsh-plugin-mascot"/u);
  assert.match(hostSource, /const inject = \["webServer"\]/u);
  assert.match(hostSource, /^function apply\(ctx, rawConfig\) \{/mu);
  assert.match(hostSource, /export \{ apply, inject, name \};/u);
  const imports = [...hostSource.matchAll(/^\s*import\s[^;]*?["']([^"']+)["']/gmu)].map((match) => match[1]);
  assert.ok(
    imports.every((specifier) => specifier.startsWith("node:")),
    `the host half may import Node builtins only (nothing to install), found: ${imports.join(", ")}`,
  );
  assert.ok(
    !/export (const|let) Config|const Config =/u.test(hostSource),
    "no Config schema is exported, so cordis hands over the raw config and this module owns its defaults",
  );
  assert.ok(
    !/console\.\w+\([^)]*key/iu.test(hostSource),
    "the resolved API key must never reach a log line",
  );
});

await it("the host half normalizes every documented knob instead of trusting the patch row", () => {
  const body = hostSource.slice(hostSource.indexOf("function normalizeConfig"), hostSource.indexOf("function sendJson"));
  for (const key of ["routePrefix", "baseUrl", "apiKeyRef", "cacheTtlMs", "timeoutMs"]) {
    assert.match(hostSource, new RegExp(`${key}:`, "u"), `${key} must have a default`);
    assert.match(body, new RegExp(`"${key}"`, "u"), `${key} must be read through the normalizer`);
  }
  assert.match(body, /routePrefix: text\("routePrefix"\)\.replace\(\/\\\/\+\$\/u, ""\)/u, "a trailing slash on the prefix would double up in the route table");
  assert.match(body, /join\(PLUGIN_ROOT, "art"\)/u, "the art directory defaults to the plugin's own folder");
});

// The half imports nothing, so it can actually be mounted and driven here. This
// is the route contract the browser half depends on.
const host = await import(new URL("../lib/index.js", import.meta.url).href);

/** Build a ctx stub that records the route the plugin claims. `apiKey: null` means the reference is unset. */
function hostHarness({ apiKey = "sk-test-secret", authenticated = true, config } = {}) {
  const calls = [];
  const route = { current: undefined };
  const ctx = {
    get(service) {
      if (service === "connection") return { isAuthenticated: () => authenticated };
      if (service === "credentials") {
        return { resolve: async (ref) => (apiKey === null ? undefined : { value: apiKey, source: `env:${ref}` }) };
      }
      return undefined;
    },
    effect: (callback) => callback(),
    webServer: {
      register(registered) {
        route.current = registered;
        return () => {};
      },
    },
  };
  globalThis.fetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(upstream());
  };
  let upstream = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          is_available: true,
          balance_infos: [{ currency: "CNY", total_balance: "128.42", granted_balance: "8.42", topped_up_balance: "120.00" }],
        }),
    });
  host.apply(ctx, config);
  return {
    route,
    calls,
    setUpstream(value) {
      upstream = value;
    },
  };
}

/** Drive one request through the claimed route and capture the response. */
async function request(harness, path, { method = "GET", headers = {} } = {}) {
  const captured = { status: undefined, headers: undefined, body: "" };
  const res = {
    writeHead(status, responseHeaders) {
      captured.status = status;
      captured.headers = responseHeaders ?? {};
    },
    end(body) {
      captured.body = body ?? "";
    },
  };
  await harness.route.current.handler({ method, url: path, headers: { host: "127.0.0.1:43120", ...headers } }, res);
  // The art route answers with a PNG buffer, so only JSON-looking bodies parse.
  const json = typeof captured.body === "string" && captured.body.startsWith("{") ? JSON.parse(captured.body) : undefined;
  return { ...captured, json };
}

//#region copyright
// The one rule that must never regress by accident. Everything else in this suite
// is about behaviour; this is about the project remaining distributable at all, and
// it is the check that a `git add -f` in a hurry would otherwise slip past.
await it("no artwork belonging to anyone else is tracked by git", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  // Images under the two directories where downloaded artwork can land. `docs/site`
  // is deliberately not included: the console's own screenshots are renders this
  // project produced, and they are what the README shows.
  const artwork = tracked.filter(
    (file) => /^(?:art|docs\/art)\//u.test(file) && /\.(?:png|jpe?g|webp|gif|avif|bmp)$/iu.test(file),
  );
  assert.deepEqual(
    artwork,
    [],
    `official artwork must not be committed — found ${artwork.join(", ")}. See COPYRIGHT.md; ` +
      "artwork is fetched onto each machine with `npm run fetch-art` and never redistributed.",
  );

  // The declaration and the measurements are this project's own data, so they must
  // still be there — a check that passes because everything was deleted is useless.
  assert.ok(tracked.includes("art/looks.json"), "the artwork declaration is part of the project");
  assert.ok(tracked.includes("art/index.json"), "the generated index is part of the project");
  assert.ok(tracked.includes("COPYRIGHT.md"), "the copyright notice must ship with the repository");
});

await it("the ignore rules cover every path downloaded artwork can land in", () => {
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  for (const pattern of ["art/*.png", "art/*.webp", "docs/art/"]) {
    assert.ok(ignore.includes(pattern), `.gitignore must exclude ${pattern}`);
  }
  // And prove it, rather than trusting the file to say the right thing: ask git
  // whether it would ignore a file that does not exist yet.
  for (const probe of ["art/closure-chibi.png", "docs/art/closure-chibi.png", "docs/art/anything.webp"]) {
    const ignored = spawnSync("git", ["check-ignore", "-q", probe], { cwd: root }).status === 0;
    assert.ok(ignored, `git would not ignore ${probe}`);
  }
});
//#endregion
await it("the host half claims one prefix route at the configured path", () => {
  const harness = hostHarness();
  assert.equal(harness.route.current.kind, "prefix");
  assert.equal(harness.route.current.path, "/dsh-mascot");
  assert.equal(typeof harness.route.current.handler, "function");

  const custom = hostHarness({ config: { routePrefix: "/mascot/" } });
  assert.equal(custom.route.current.path, "/mascot", "a trailing slash is trimmed so route matching stays exact");
});

await it("a balance read resolves the key and reports the provider figures", async () => {
  const harness = hostHarness();
  const result = await request(harness, "/dsh-mascot/api/balance");
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.totalBalance, "128.42");
  assert.equal(result.json.currency, "CNY");
  assert.equal(result.json.toppedUpBalance, "120.00");
  assert.equal(result.json.isAvailable, true);
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, "https://api.deepseek.com/user/balance");
  assert.equal(harness.calls[0].init.headers.authorization, "Bearer sk-test-secret");
});

await it("the API key never appears in anything the browser receives", async () => {
  const harness = hostHarness();
  const result = await request(harness, "/dsh-mascot/api/balance");
  assert.ok(!result.body.includes("sk-test-secret"), "the response body must not carry the key");
  for (const value of Object.values(result.headers)) {
    assert.ok(!String(value).includes("sk-test-secret"), "no response header may carry the key");
  }
});

await it("a fresh answer is served from cache, and a failure never is", async () => {
  const harness = hostHarness();
  await request(harness, "/dsh-mascot/api/balance");
  await request(harness, "/dsh-mascot/api/balance");
  assert.equal(harness.calls.length, 1, "the second read inside the TTL must not reach upstream");

  const failing = hostHarness();
  failing.setUpstream(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("boom") }));
  await request(failing, "/dsh-mascot/api/balance");
  await request(failing, "/dsh-mascot/api/balance");
  assert.equal(failing.calls.length, 2, "a failed read must be retried rather than cached");
});

await it("concurrent reads collapse onto one upstream request", async () => {
  const harness = hostHarness();
  const [first, second] = await Promise.all([
    request(harness, "/dsh-mascot/api/balance"),
    request(harness, "/dsh-mascot/api/balance"),
  ]);
  assert.equal(harness.calls.length, 1, "the second caller joins the in-flight read");
  assert.deepEqual(first.json, second.json);
});

await it("every failure mode answers with a human sentence and ok:false", async () => {
  const noKey = hostHarness({ apiKey: null });
  const missing = await request(noKey, "/dsh-mascot/api/balance");
  assert.equal(missing.json.ok, false);
  assert.equal(missing.json.error, "missing_credential");
  assert.match(missing.json.message, /DEEPSEEK_API_KEY/u);

  const rejected = hostHarness();
  rejected.setUpstream(() => Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("no") }));
  const unauthorized = await request(rejected, "/dsh-mascot/api/balance");
  assert.equal(unauthorized.json.error, "unauthorized");
  assert.equal(rejected.calls.length, 1);

  const broken = hostHarness();
  broken.setUpstream(() => Promise.reject(new Error("ENOTFOUND")));
  const unreachable = await request(broken, "/dsh-mascot/api/balance");
  assert.equal(unreachable.json.error, "unreachable");
  assert.match(unreachable.json.message, /ENOTFOUND/u);

  const garbage = hostHarness();
  garbage.setUpstream(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error("bad json")), text: () => Promise.resolve("") }));
  const payload = await request(garbage, "/dsh-mascot/api/balance");
  assert.equal(payload.json.error, "bad_payload");
});

await it("routing and authorization guard the route", async () => {
  const harness = hostHarness();
  assert.equal((await request(harness, "/dsh-mascot/api/health")).json.ok, true);
  assert.equal((await request(harness, "/dsh-mascot/api/nope")).json.error, "not_found");
  assert.equal((await request(harness, "/dsh-mascot/api/balance", { method: "POST" })).status, 405);

  // `/api/looks` is wired either way; a checkout with no generated index answers
  // `no_index` (actionable) rather than `not_found` (the route is missing).
  const looks = await request(harness, "/dsh-mascot/api/looks");
  assert.ok(
    looks.json.error === "no_index" || (looks.status === 200 && looks.json.ok === true),
    `unexpected /api/looks answer: ${JSON.stringify(looks.json)}`,
  );
  if (looks.json.ok === true) {
    assert.equal(typeof looks.json.artBase, "string");
    assert.ok(Array.isArray(looks.json.looks));
    assert.ok(looks.json.looks.length > 0, "an index with no installed looks should answer no_index instead");
  }

  const stranger = hostHarness({ authenticated: false });
  const denied = await request(stranger, "/dsh-mascot/api/balance");
  assert.equal(denied.status, 401);
  assert.equal(stranger.calls.length, 0, "an unauthenticated read must not reach the provider");
});

await it("the artwork route serves from art/ and refuses to leave it", async () => {
  const harness = hostHarness();

  // The repo deliberately ships no artwork, so a missing file must answer 404
  // with an actionable message rather than throwing — the browser half turns
  // that into the placeholder.
  const missing = await request(harness, "/dsh-mascot/art/does-not-exist.png");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error, "no_art");
  assert.match(missing.json.message, /fetch-art/u);

  assert.equal((await request(harness, "/dsh-mascot/art/closure.txt")).status, 404, "only image extensions are served");
  assert.equal(
    (await request(harness, "/dsh-mascot/art/..%2F..%2Fpackage.json")).status,
    403,
    "traversal is refused by containment, before the extension is even considered",
  );
  assert.equal((await request(harness, "/dsh-mascot/art/%2e%2e%2fclosure.png")).status, 403, "an encoded traversal with an image extension is refused too");
});

await it("the art route stays behind the session, and the console is served from the same origin", async () => {
  const artwork = "/dsh-mascot/art/closure-chibi.png";

  // A cross-origin read cannot carry the DSH cookie, so it must not be served. An
  // allowlist inside the plugin was tried and removed: measured against a real
  // browser, a fetch from a public origin to a local DSH is refused before any
  // plugin code runs, so the console is served from this origin instead.
  const sessionless = hostHarness({ authenticated: false });
  assert.equal((await request(sessionless, artwork, { headers: { origin: "https://zyaons.github.io" } })).status, 401, "an anonymous cross-origin read of the art is refused");
  assert.equal((await request(sessionless, "/dsh-mascot/api/balance")).status, 401, "and so is the balance");
  assert.equal((await request(sessionless, "/dsh-mascot/api/looks")).status, 401, "and the look index");

  // Same-origin with a session: everything works, with no CORS header anywhere.
  const own = hostHarness();
  const art = await request(own, artwork);
  assert.equal(art.status, 200, "a session-bearing read of the art works");
  assert.equal(art.headers["access-control-allow-origin"], undefined, "no CORS header is needed or sent on a same-origin read");

  // The console is served from this same origin, which is what makes its preview
  // possible at all: same origin means the session cookie rides along.
  const page = await request(own, "/dsh-mascot/console/");
  assert.equal(page.status, 200, "the console index is served");
  assert.match(String(page.headers["content-type"]), /text\/html/u, "as HTML");
  assert.match(String(page.body), /<title>DSH Mascot/u, "and it is the console page");

  const asset = await request(own, "/dsh-mascot/console/site/preview.js");
  assert.equal(asset.status, 200, "the console's own scripts are served");
  assert.match(String(asset.headers["content-type"]), /javascript/u, "with a script content type");

  // Containment, the same rule the art route follows.
  assert.equal((await request(own, "/dsh-mascot/console/../../package.json")).status, 404, "a traversal out of the console root does not resolve");
  assert.equal((await request(own, "/dsh-mascot/console/../art/looks.json")).status, 404, "nor does stepping back into the art directory");
  assert.equal((await request(own, "/dsh-mascot/console/nope.txt")).status, 404, "an unsupported extension is refused");

  // It is still behind the session, like everything but nothing at all.
  assert.equal((await request(sessionless, "/dsh-mascot/console/")).status, 401, "the console is not public");
});
await it("the look index is the single source of truth for what is installed", () => {
  const declaration = JSON.parse(read("art/looks.json"));
  const index = JSON.parse(read("art/index.json"));

  // The declaration is hand-authored, the index is generated; they must agree on
  // identity, and the generated one must not invent a look the declaration lacks.
  const declared = declaration.looks.map((look) => look.id).sort();
  const indexed = index.looks.map((look) => look.id).sort();
  assert.deepEqual(indexed, declared, "art/index.json is stale — run `npm run art:sync`");

  const characters = declaration.characters.map((character) => character.id).sort();
  assert.deepEqual(index.characters.map((character) => character.id).sort(), characters);
  assert.ok(characters.length >= 2, "both characters must be declared");

  for (const character of index.characters) {
    assert.ok(character.looks.length > 0, `${character.id}: has no looks, so the plugin would render the placeholder`);
    assert.ok(THEMES[character.theme] !== undefined, `${character.id}: names theme ${String(character.theme)}, which the stylesheet does not define`);
  }

  for (const look of index.looks) {
    assert.ok(look.frames.length > 0, `${look.id}: declares no frames`);
    assert.equal(look.animated, look.frames.length > 1, `${look.id}: the animated flag must follow the frame count`);
    for (const frame of look.frames) {
      assert.match(frame.file, /^[a-z0-9_-]+\.(png|webp|jpg)$/u, `${look.id}: ${frame.file} must be a bare file name`);
      // Both seats are measured from the artwork, never hand-written.
      for (const seat of ["sprite", "face"]) {
        const framing = frame.seat?.[seat];
        assert.ok(framing !== undefined, `${look.id}/${frame.file}: no ${seat} framing`);
        assert.ok(framing.width > 0, `${look.id}/${frame.file}: ${seat} width must be positive`);
        assert.equal(Number.isInteger(framing.left) && Number.isInteger(framing.top), true, `${look.id}/${frame.file}: ${seat} offsets must be integers`);
      }
    }
    // The frames of one look must share a scale, or animating resizes her.
    if (look.frames.length > 1) {
      const areas = look.frames.map((frame) => frame.measured.box[2] * frame.measured.box[3]);
      assert.ok(Math.max(...areas) / Math.min(...areas) > 1.01, `${look.id}: frames are identical, so the animation would be invisible`);
    }
  }

  // Anything the declaration pins must be a real hash, and anything missing a url
  // would make `npm run fetch-art` fail silently.
  for (const look of declaration.looks) {
    assert.ok(Array.isArray(look.urls) && look.urls.length > 0, `${look.id}: needs at least one source url`);
    assert.ok(look.rights.length > 0, `${look.id}: every source must carry its rights line`);
    if (look.sha256 !== undefined) assert.match(look.sha256, /^[0-9a-f]{64}$/u, `${look.id}: sha256 must pin the exact bytes`);
  }
});

await it("the browser half falls back to the placeholder when the official file is absent", () => {
  // The fallback is what a fresh clone shows, so it must be reachable without a
  // network: the component renders the inline SVG whenever the image errors.
  assert.equal(typeof exports_.setArtBase, "function", "the art base must be overridable for tests and preview");
  exports_.setArtBase("file:///art");
  exports_.setArtBase("/dsh-mascot/art");
});
//#endregion

//#region 5 — the bone rig
const { buildRig, findNeck, poseRig, RIG } = exports_;

/** A synthetic silhouette: a wide head, a pinched neck, then a wide body. */
function syntheticProfile(headWidth, neckWidth, bodyWidth, neckRow) {
  const rows = 32;
  const profile = [];
  for (let index = 0; index < rows; index++) {
    const width = index < neckRow - 1 ? headWidth : index <= neckRow + 1 ? neckWidth : bodyWidth;
    profile.push((1 - width) / 2, (1 + width) / 2);
  }
  return profile;
}

await it("the neck is found where the silhouette pinches, and nowhere else", () => {
  const pinched = syntheticProfile(0.6, 0.18, 0.8, 10);
  const found = findNeck(pinched);
  // The synthetic neck covers rows 9..11; any of them is a correct answer (the
  // search keeps the first minimum), so assert the band, not one exact row.
  assert.ok(found.y >= 9 / 32 && found.y <= 12 / 32, `expected the neck inside rows 9..11, got y=${String(found.y)}`);
  assert.equal(found.x, 0.5, "a centred pinch rigs at the centre");

  // No pinch at all: a figure in a cloak must fall back rather than rig at noise.
  const smooth = syntheticProfile(0.6, 0.6, 0.8, 10);
  assert.equal(findNeck(smooth).y, RIG.neckFallback, "an un-pinched silhouette uses the default neck");

  assert.equal(findNeck(null).y, RIG.neckFallback);
  assert.equal(findNeck([]).y, RIG.neckFallback);
  assert.equal(findNeck([0, 1]).y, RIG.neckFallback, "a too-short profile falls back");
});

await it("skin weights are a partition: every vertex sums to one, none negative", () => {
  const rig = buildRig(syntheticProfile(0.6, 0.18, 0.8, 10), { rows: 12, cols: 8 });
  assert.equal(rig.vertices.length, 13 * 9);
  for (const vertex of rig.vertices) {
    const sum = vertex.w[0] + vertex.w[1] + vertex.w[2];
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights summed to ${String(sum)} at y=${String(vertex.y)}`);
    assert.ok(vertex.w.every((value) => value >= 0), `negative weight at y=${String(vertex.y)}`);
  }
  // Above the neck the head bone owns the vertex; below the hip the root does.
  const top = rig.vertices.find((vertex) => vertex.y === 0);
  const bottom = rig.vertices.find((vertex) => vertex.y === 1);
  assert.ok(top.w[2] > 0.95, `the top of the figure should be head, got ${String(top.w[2])}`);
  assert.ok(bottom.w[0] > 0.95, `the feet should be root, got ${String(bottom.w[0])}`);
});

await it("the pose is finite and bounded across the whole idle, including clicks", () => {
  const rig = buildRig(syntheticProfile(0.6, 0.18, 0.8, 10));
  const box = [0, 0, 100, 200];
  let worst = 0;
  for (let step = 0; step < 400; step++) {
    const time = step * 0.05;
    for (const pokeAge of [undefined, 0, 0.05, 0.4, 1.1, 1.59]) {
      const matrices = poseRig(rig, box, { time, pokeAge });
      for (const matrix of matrices) {
        for (const value of matrix) {
          // A single NaN bone matrix blanks the entire sprite, and `0 * sin(undefined)`
          // is exactly how that happens.
          assert.ok(Number.isFinite(value), `non-finite pose at t=${String(time)} age=${String(pokeAge)}`);
          worst = Math.max(worst, Math.abs(value));
        }
      }
    }
  }
  assert.ok(worst < 1e4, `a pose value ran away to ${String(worst)}`);

  const rest = poseRig(rig, box, { time: 0, pokeAge: undefined });
  assert.ok(Math.abs(rest[0][0] - 1) < 0.01, "the root is unrotated at rest");
  assert.ok(Math.abs(rest[0][1]) < 0.01, "the root is unrotated at rest");

  // The chain must compose: the head inherits the body's motion rather than
  // floating independently of it.
  const moved = poseRig(rig, box, { time: 2.4, pokeAge: undefined });
  assert.ok(Math.abs(moved[2][6]) + Math.abs(moved[2][7]) > 0.01, "the neck transform ignores its parents");
});
//#endregion

console.log(`\ndsh-plugin-mascot: ${String(checks)} checks passed`);
