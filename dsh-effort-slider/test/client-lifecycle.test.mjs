import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

// Existing smoke tests deliberately omit effects and subscriptions. Execute the
// same source in an isolated VM with real promises, controllable transports and
// committed hook effects so cancellation races are exercised without a live app.
const source = readFileSync(new URL("../client.js", import.meta.url), "utf8")
  .replace("module.exports = {", "module.exports = { __test: { turboFetch, createLazyDirectoryStore, hostSubscribe, EffortSlider, setReact: function (value) { React = value; } },");
const flushPromises = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = (body) => ({ ok: true, json: () => Promise.resolve(body) });
function environment() {
  let now = 10000, timerId = 0;
  const timers = new Map(), requests = [];
  class FakeDate extends Date { static now() { return now; } }
  const sandbox = {
    module: { exports: {} }, __EFFORT_SLIDER_CSS__: "", AbortController,
    Date: FakeDate, console: { info() {}, warn() {}, error() {} },
    window: { localStorage: { getItem: () => null, setItem() {} }, matchMedia: () => ({ matches: true }) },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, init = {}) {
      if (!url.includes("/turbo")) return Promise.resolve(response({}));
      const transport = deferred();
      requests.push({ url, init, ...transport });
      return transport.promise; // Intentionally ignores abort, like a broken transport.
    },
  };
  vm.runInNewContext(source, sandbox, { filename: "client.js" });
  return {
    sandbox, plugin: sandbox.module.exports, helpers: sandbox.module.exports.__test, timers, requests,
    advance(ms) {
      const end = now + ms;
      for (let count = 0; count < 1000; count += 1) {
        const next = [...timers].filter(([, entry]) => entry.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = end; return; }
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
      }
      throw new Error("timer loop did not converge");
    },
  };
}

const snapshot = (effort = "max") => ({
  status: "ready", current: { provider: "p", model: "m", reasoningEffort: effort },
  groups: [{ id: "p", models: [{ id: "m", name: "Model", reasoning: {
    efforts: ["low", "medium", "high", "xhigh", "max"].map((id) => ({ id })), defaultEffort: "medium",
  } }] }],
});
function trackedStore(value = snapshot()) {
  const listeners = new Set();
  let subscriptions = 0, unsubscriptions = 0;
  return {
    getSnapshot: () => value,
    subscribe(fn) { subscriptions += 1; listeners.add(fn); return () => { unsubscriptions += 1; listeners.delete(fn); }; },
    push(next) { value = next; [...listeners].forEach((fn) => fn()); },
    get size() { return listeners.size; }, get subscriptions() { return subscriptions; },
    get unsubscriptions() { return unsubscriptions; },
  };
}
function directory(store) { return { store, load: () => Promise.resolve(), select: () => Promise.resolve() }; }

function hookHarness(env, props = {}) {
  const slots = [], committed = new Map(), committedMemos = new Map();
  let pendingMemos = new Map();
  let cursor = 0, effects = [], dirty = true, tree, mounted = true, updates = 0, unmountedUpdates = 0;
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const React = {
    createElement(type, properties, ...children) { return { type, props: properties || {}, children: children.flat(Infinity) }; },
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial;
      return [slots[id], (next) => {
        const value = typeof next === "function" ? next(slots[id]) : next;
        if (!mounted) unmountedUpdates += 1;
        if (!Object.is(value, slots[id])) { slots[id] = value; dirty = true; updates += 1; }
      }];
    },
    useRef(initial) { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useMemo(factory, deps) {
      const id = cursor++, previous = committedMemos.get(id);
      const value = previous && same(previous.deps, deps) ? previous.value : factory();
      pendingMemos.set(id, { value, deps }); return value;
    },
    useEffect(fn, deps) { effects.push({ id: cursor++, fn, deps }); },
    useSyncExternalStore(subscribe, read) {
      const id = cursor++;
      effects.push({ id, deps: [subscribe], fn: () => subscribe(() => { dirty = true; }) });
      return read();
    },
  };
  env.helpers.setReact(React);
  const modelStore = trackedStore();
  const prefs = Object.freeze({ skin: "holo" });
  let properties = {
    sessionId: "a", available: true, store: modelStore,
    preferences: { getSnapshot: () => prefs, subscribe: () => () => {}, set() {} },
    api: { notify() {} }, load() {}, commit: () => Promise.resolve(true), ...props,
  };
  function renderOnly(next) {
    if (next) properties = { ...properties, ...next };
    cursor = 0; effects = []; pendingMemos = new Map(); dirty = false;
    tree = env.helpers.EffortSlider(properties);
    return tree;
  }
  function commit() {
    pendingMemos.forEach((entry, id) => committedMemos.set(id, entry));
    // React cleans up changed effects before running their replacements.
    for (const entry of effects) {
      const previous = committed.get(entry.id);
      if (previous && !same(previous.deps, entry.deps)) previous.cleanup?.();
    }
    for (const entry of effects) {
      const previous = committed.get(entry.id);
      if (previous && same(previous.deps, entry.deps)) continue;
      committed.set(entry.id, { ...entry, cleanup: entry.fn() });
    }
  }
  function flush(next) {
    for (let i = 0; i < 30; i += 1) {
      renderOnly(i === 0 ? next : undefined); commit();
      if (!dirty) return tree;
    }
    throw new Error("hook render did not converge");
  }
  function find(className, node = tree) {
    if (!node || typeof node !== "object") return undefined;
    if ((node.props?.className || "").split(" ").includes(className)) return node;
    return node.children?.map((child) => find(className, child)).find(Boolean);
  }
  return {
    flush, renderOnly, commit, find, get tree() { return tree; }, get updates() { return updates; },
    get unmountedUpdates() { return unmountedUpdates; },
    replayEffects() { for (const entry of committed.values()) entry.cleanup?.(); committed.clear(); dirty = true; flush(); },
    unmount() { mounted = false; for (const entry of committed.values()) entry.cleanup?.(); committed.clear(); },
  };
}

test("turbo requests settle and abort on timeout, including a hanging JSON body", async () => {
  const env = environment();
  const request = env.helpers.turboFetch("/turbo");
  const rejected = assert.rejects(request, { name: "TimeoutError" });
  env.requests[0].resolve({ ok: true, json: () => new Promise(() => {}) });
  await flushPromises();
  env.advance(5000);
  await rejected;
  assert.equal(env.requests[0].init.signal.aborted, true);
  assert.equal(env.timers.size, 0);
});

test("external abort settles even when fetch ignores it; synchronous errors clear timers", async () => {
  const env = environment(), controller = new AbortController();
  const request = env.helpers.turboFetch("/turbo", { signal: controller.signal });
  const rejected = assert.rejects(request, { name: "AbortError" });
  controller.abort();
  await rejected;
  assert.equal(env.requests[0].init.signal.aborted, true);
  env.requests[0].resolve(response({ ok: true }));
  await flushPromises();
  env.sandbox.fetch = () => { throw new Error("offline"); };
  await assert.rejects(env.helpers.turboFetch("/turbo"), /offline/);
  assert.equal(env.timers.size, 0);
});

test("lazy adapters use one host subscription, release replacements and survive StrictMode", async () => {
  const env = environment(), one = trackedStore(), two = trackedStore(snapshot("low"));
  let current = directory(one), notifications = 0;
  const adapter = env.helpers.createLazyDirectoryStore({ modelDirectories: { directoryFor: () => current } }, "a", () => {});
  assert.equal(one.size, 0, "rendering an adapter must not subscribe to its host");
  const stop1 = adapter.subscribe(() => { notifications += 1; });
  const stop2 = adapter.subscribe(() => { notifications += 1; });
  assert.equal(one.size, 1);
  assert.equal(env.helpers.hostSubscribe(adapter), env.helpers.hostSubscribe(adapter));
  current = directory(two);
  adapter.resolveDirectory();
  assert.equal(one.size, 0);
  assert.equal(two.size, 1);
  stop1(); stop1(); stop2();
  assert.equal(two.size, 0);
  const before = notifications;
  one.push(snapshot("high")); two.push(snapshot("high"));
  assert.equal(notifications, before, "unsubscribed stores cannot notify an idle adapter");
  const stop3 = adapter.subscribe(() => { notifications += 1; });
  assert.equal(two.size, 1, "StrictMode subscription replay reconnects the same adapter");
  adapter.dispose(true); stop3();
  assert.equal(two.size, 0);
  adapter.subscribe(() => {});
  assert.equal(two.size, 0, "plugin disposal permanently closes the adapter");
  await flushPromises();
});

test("lazy retry has one timer, notifies on recovery, and stops after last unsubscribe", () => {
  const env = environment(), store = trackedStore();
  let ready = false, notifications = 0;
  const adapter = env.helpers.createLazyDirectoryStore({ modelDirectories: { directoryFor() {
    if (!ready) throw new Error("no scope"); return directory(store);
  } } }, "a", () => {});
  const stop = adapter.subscribe(() => { notifications += 1; });
  for (let i = 0; i < 3; i += 1) adapter.getSnapshot();
  assert.equal(env.timers.size, 1);
  ready = true; env.advance(2000);
  assert.equal(store.size, 1);
  assert.ok(notifications > 0, "retry recovery must wake useSyncExternalStore");
  stop();
  assert.equal(env.timers.size, 0);
  assert.equal(store.size, 0);
});

test("adapter cache keeps active references, bounds idle entries and disposes with the plugin", async () => {
  const env = environment(), host = trackedStore(), effects = [];
  let registration;
  const React = { Component: class {}, createElement() {} };
  env.sandbox.window.React = React;
  env.plugin.apply({
    get: (name) => name === "styles" ? { insert: () => () => {} } : undefined,
    effect(fn) { const cleanup = fn(); effects.push(cleanup); return cleanup; },
    slots: { inject(_name, fn) { return fn(); }, register(spec) { registration = spec; return () => {}; } },
    sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
    modelDirectories: { directoryFor: () => directory(host) },
  });
  const active = registration.inject("active").store;
  const stop = active.subscribe(() => {});
  const oldest = registration.inject("oldest").store;
  for (let i = 0; i < 60; i += 1) registration.inject(`idle-${i}`);
  env.advance(0);
  assert.equal(registration.inject("active").store, active);
  assert.equal(oldest.getSnapshot().status, "idle", "the old idle adapter released its host references");
  const resumed = oldest.subscribe(() => {});
  assert.equal(oldest.getSnapshot().status, "ready", "a held render reference can subscribe after eviction");
  stop();
  effects.forEach((cleanup) => cleanup?.());
  assert.equal(host.size, 0);
  resumed();
  assert.equal(env.timers.size, 0);
  await flushPromises();
});

test("unmount cancels an in-flight poll and its promise cannot schedule another timer", async () => {
  const env = environment(), harness = hookHarness(env);
  harness.flush();
  env.requests[0].resolve(response({ lightning: true, ultra: false, rate: 20 }));
  await flushPromises(); harness.flush();
  // Settle the Ultra correction, then let the poll begin.
  env.requests.filter((r) => r.init.method === "PATCH").forEach((r) => r.resolve(response({ ok: true })));
  await flushPromises(); env.advance(1000);
  const poll = env.requests.filter((r) => !r.init.method).at(-1);
  assert.notEqual(poll, env.requests[0]);
  harness.unmount();
  assert.equal(poll.init.signal.aborted, true);
  poll.resolve(response({ lightning: true, rate: 999 }));
  await flushPromises(); env.advance(20000); await flushPromises();
  assert.equal(env.timers.size, 0);
  assert.equal(harness.unmountedUpdates, 0);
  assert.equal(env.requests.filter((r) => !r.init.method).length, 2);
});

test("a response after a new session commits cannot update the new session", async () => {
  const env = environment(), harness = hookHarness(env);
  harness.flush();
  const old = env.requests[0];
  harness.renderOnly({ sessionId: "b", store: trackedStore(snapshot("low")) });
  harness.commit(); harness.flush();
  const updates = harness.updates;
  old.resolve(response({ lightning: true, ultra: true, rate: 999 }));
  await flushPromises();
  assert.equal(harness.updates, updates);
  assert.equal(old.init.signal.aborted, true);
  assert.ok(env.requests.at(-1).url.endsWith("session=b"));
  env.requests.at(-1).resolve(response({ lightning: false, ultra: false, rate: 0 }));
  await flushPromises(); harness.flush();
  assert.equal(harness.tree.props["data-lightning"], undefined);
  harness.unmount(); await flushPromises();
});

test("an abandoned concurrent render leaves the committed session's scope working", async () => {
  const env = environment(), store = trackedStore(), harness = hookHarness(env, { store });
  harness.flush();
  harness.renderOnly({ sessionId: "b" }); // React starts and then abandons this render.
  harness.renderOnly({ sessionId: "a", store }); harness.commit();
  env.requests[0].resolve(response({ lightning: true, ultra: false, rate: 12 }));
  await flushPromises(); harness.flush();
  assert.equal(harness.tree.props["data-lightning"], "1");
  assert.equal(env.requests.filter((r) => !r.init.method).length, 1);
  harness.unmount(); await flushPromises();
  assert.equal(env.timers.size, 0);
});

test("StrictMode effect replay aborts its first read and issues a fresh unthrottled read", async () => {
  const env = environment(), harness = hookHarness(env);
  harness.flush();
  const first = env.requests[0];
  harness.replayEffects();
  assert.equal(first.init.signal.aborted, true);
  assert.equal(env.requests.length, 2);
  first.resolve(response({ lightning: true, ultra: true, rate: 999 }));
  env.requests[1].resolve(response({ lightning: false, ultra: false, rate: 0 }));
  await flushPromises(); harness.flush();
  assert.equal(harness.tree.props["data-lightning"], undefined);
  assert.equal(harness.tree.props["data-ultra"], undefined);
  harness.unmount(); await flushPromises();
  assert.equal(env.timers.size, 0);
});

test("initial persisted Ultra survives hydration and still commits the real max effort", async () => {
  const env = environment(), selections = [];
  const harness = hookHarness(env, { commit(selection) { selections.push(selection); return Promise.resolve(true); } });
  harness.flush();
  assert.equal(env.requests.length, 1, "no corrective PATCH may race the first authoritative read");
  env.requests[0].resolve(response({ lightning: false, ultra: true, rate: 0 }));
  await flushPromises(); harness.flush(); await flushPromises(); harness.flush();
  assert.equal(harness.tree.props["data-ultra"], "1");
  assert.equal(selections[0].reasoningEffort, "max");
  const patches = env.requests.filter((r) => r.init.method === "PATCH");
  assert.ok(patches.some((r) => JSON.parse(r.init.body).ultra === true));
  assert.ok(patches.every((r) => JSON.parse(r.init.body).ultra !== false));
  harness.unmount(); await flushPromises();
});

test("changing effort before hydration ignores stale Ultra while still restoring independent lightning", async () => {
  const env = environment(), store = trackedStore();
  const harness = hookHarness(env, { store, commit(selection) {
    store.push(snapshot(selection.reasoningEffort)); return Promise.resolve(true);
  } });
  harness.flush();
  harness.find("es-pill").props.onClick({ stopPropagation() {} }); harness.flush();
  harness.find("es-rail").props.onKeyDown({ key: "ArrowLeft", preventDefault() {} }); harness.flush();
  await flushPromises(); harness.flush();
  env.requests[0].resolve(response({ lightning: true, ultra: true, rate: 0 }));
  await flushPromises(); harness.flush();
  assert.equal(harness.tree.props["data-lightning"], "1");
  assert.equal(harness.tree.props["data-ultra"], undefined);
  assert.equal(store.getSnapshot().current.reasoningEffort, "xhigh");
  harness.unmount(); await flushPromises();
  assert.equal(env.timers.size, 0);
});

test("late PATCH and model commit completions cannot roll back or relock another session", async () => {
  const env = environment(), modelCommit = deferred();
  const harness = hookHarness(env, { commit: () => modelCommit.promise });
  harness.flush(); env.requests[0].resolve(response({ lightning: false, ultra: false, rate: 0 }));
  await flushPromises(); harness.flush();
  env.requests.filter((r) => r.init.method === "PATCH").forEach((r) => r.resolve(response({ ok: true })));
  await flushPromises();
  harness.find("es-pill").props.onClick({ stopPropagation() {} }); harness.flush();
  harness.find("es-pill__bolt").props.onClick({ stopPropagation() {} }); harness.flush();
  const patch = env.requests.at(-1);
  harness.find("es-rail").props.onKeyDown({ key: "ArrowLeft", preventDefault() {} }); harness.flush();
  assert.equal(harness.tree.props["data-busy"], "1");
  harness.flush({ sessionId: "b", store: trackedStore(snapshot("medium")) });
  const before = harness.updates;
  patch.reject(new Error("late failure")); modelCommit.resolve(false);
  await flushPromises();
  assert.equal(harness.updates, before);
  harness.flush();
  assert.equal(harness.tree.props["data-busy"], "0");
  assert.equal(harness.tree.props["data-failed"], "0");
  harness.unmount(); await flushPromises();
});

test("an unresolved model selection releases the slider after ten seconds without cancelling the host", async () => {
  const env = environment(), modelCommit = deferred();
  const harness = hookHarness(env, { commit: () => modelCommit.promise });
  harness.flush(); env.requests[0].resolve(response({ lightning: false, ultra: false, rate: 0 }));
  await flushPromises(); harness.flush();
  env.requests.filter((r) => r.init.method === "PATCH").forEach((r) => r.resolve(response({ ok: true })));
  await flushPromises();
  harness.find("es-pill").props.onClick({ stopPropagation() {} }); harness.flush();
  harness.find("es-rail").props.onKeyDown({ key: "ArrowLeft", preventDefault() {} }); harness.flush();
  assert.equal(harness.tree.props["data-busy"], "1");
  env.advance(10000); await flushPromises(); harness.flush();
  assert.equal(harness.tree.props["data-busy"], "0");
  assert.equal(harness.tree.props["data-failed"], "1");
  const before = harness.updates, requests = env.requests.length;
  modelCommit.resolve(true); await flushPromises();
  assert.equal(harness.updates, before, "a late success cannot revive the expired UI operation");
  assert.equal(env.requests.length, requests, "an expired selection cannot send a late Ultra PATCH");
  harness.unmount(); await flushPromises();
  assert.equal(env.timers.size, 0);
});

test("returning to the committed level clears a previous selection's busy flag and deadline", async () => {
  const env = environment(), modelCommit = deferred();
  const harness = hookHarness(env, { commit: () => modelCommit.promise });
  harness.flush();
  harness.find("es-pill").props.onClick({ stopPropagation() {} }); harness.flush();
  harness.find("es-rail").props.onKeyDown({ key: "ArrowLeft", preventDefault() {} }); harness.flush();
  assert.equal(harness.tree.props["data-busy"], "1");
  harness.find("es-rail").props.onKeyDown({ key: "ArrowRight", preventDefault() {} }); harness.flush();
  assert.equal(harness.tree.props["data-busy"], "0");
  modelCommit.resolve(false); await flushPromises(); harness.flush();
  assert.equal(harness.tree.props["data-failed"], "0");
  harness.unmount(); await flushPromises();
  assert.equal(env.timers.size, 0);
});
