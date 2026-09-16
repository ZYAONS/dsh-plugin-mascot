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
 *   4. inlined artwork    — both mascots present and well-formed enough to
 *                           render as SVG.
 *
 * Run with `npm test` (or `npm run check` to add `node --check` on both halves).
 */

import assert from "node:assert/strict";
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

//#region 3 — statistics
const { deriveStats, MASCOTS } = exports_;

await it("both mascots ship with inlined, well-formed SVG", () => {
  assert.equal(MASCOTS.length, 2);
  for (const mascot of MASCOTS) {
    assert.ok(mascot.svg.startsWith("<svg"), `${mascot.id}: art must start with <svg`);
    assert.ok(mascot.svg.trimEnd().endsWith("</svg>"), `${mascot.id}: art must be closed`);
    assert.ok(mascot.svg.length > 4000, `${mascot.id}: art looks truncated`);
    assert.match(mascot.svg, /viewBox="[^"]+"/u, `${mascot.id}: art needs a viewBox to scale`);
    assert.ok(!mascot.svg.includes("NaN"), `${mascot.id}: art contains a NaN coordinate`);
    assert.equal((mascot.svg.match(/<svg/gu) ?? []).length, 1, `${mascot.id}: exactly one root <svg>`);
  }
  assert.deepEqual(
    MASCOTS.map((m) => m.id),
    ["closure", "yuno"],
  );
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
  assert.ok(
    !/^\s*import\s/mu.test(hostSource),
    "the host half must import nothing: that is what lets an absolute-path mount work without installing into the profile",
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
async function request(harness, path, { method = "GET" } = {}) {
  const captured = { status: undefined, headers: undefined, body: "" };
  const res = {
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
    },
    end(body) {
      captured.body = body ?? "";
    },
  };
  await harness.route.current.handler({ method, url: path, headers: { host: "127.0.0.1:43120" } }, res);
  return { ...captured, json: captured.body.length > 0 ? JSON.parse(captured.body) : undefined };
}

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
  assert.equal((await request(harness, "/dsh-mascot/api/nope")).status, 404);
  assert.equal((await request(harness, "/dsh-mascot/api/balance", { method: "POST" })).status, 405);

  const stranger = hostHarness({ authenticated: false });
  const denied = await request(stranger, "/dsh-mascot/api/balance");
  assert.equal(denied.status, 401);
  assert.equal(stranger.calls.length, 0, "an unauthenticated read must not reach the provider");
});
//#endregion

console.log(`\ndsh-plugin-mascot: ${String(checks)} checks passed`);
