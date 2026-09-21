/**
 * dsh-token-thrift 的测试。
 *
 * 不启 DSH：造一个够用的伪 ctx，把钩子拿出来直接驱动。这样测的是插件的**逻辑**——
 * 哪一档该响、响几次、什么时候遮工具——而不是 DSH 能不能起来（那是另一回事，
 * 用 `dsh --profile desktop --dump-config` 验）。
 *
 * 断言都带实际值，不看"跑通了"。
 */

import assert from "node:assert/strict";
import { apply, Config, ladderFor, name, PRESETS, presetOf, spentTokens, usageTokens } from "../lib/index.js";

let passed = 0;
let failed = 0;

/** One test, with its failure reported rather than thrown into the void. */
async function it(label, body) {
  try {
    await body();
    passed += 1;
    console.log(`  ok  ${label}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    console.log(`        → ${String(error?.message ?? error)}`);
    // The lines, because "0 !== 1" on its own does not say which assertion produced it.
    const frames = String(error?.stack ?? "").split("\n").filter((line) => line.includes("run.mjs:")).slice(0, 3);
    for (const frame of frames) console.log(`        ${frame.trim()}`);
  }
}

/**
 * A plugin context that records what was registered and lets a test fire the hooks.
 *
 * Only the surface this plugin touches is implemented. A fake that implements more would
 * hide the fact that the plugin depends on it.
 *
 * `get()` and the throwing property read are both here on purpose, because the difference
 * between them is what took this plugin down once. It read `ctx.sessionProjections`
 * directly, which Cordis answers by *throwing* rather than by returning undefined; an
 * earlier fake handed back a service object, so every test passed while the real plugin
 * failed every tool call in a session.
 */
function fakeContext({ projections = true, webServer = true } = {}) {
  const listeners = new Map();
  const restrictions = [];
  let total = 0;
  let broken = false;
  let route;
  const services = projections
    ? {
        sessionProjections: {
          snapshot: () => ({ tokenUsage: { totals: { inputTokens: total, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
        },
      }
    : {};
  const target = {
    listeners,
    restrictions,
    setTotal(value) { total = value; },
    /** Make the next service read fail, to prove the hook degrades instead of throwing. */
    break() { broken = true; },
    /**
     * `ctx.on` hands back a disposer, and the plugin now leans on that: it installs and
     * removes the tool listener as the console switches the coach on and off. A fake that
     * returned undefined made the removal a TypeError, which surfaced as this test hanging
     * rather than failing.
     */
    on(event, handler) {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
    effect(callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
    /**
     * The documented way to reach a service you have not injected. Absent services answer
     * undefined here rather than throwing — that is the whole difference from a property
     * read, and the reason `spentTokens` uses this one.
     */
    get(service) {
      if (broken) throw new Error("the projection service is unreachable");
      if (service === "webServer") {
        return webServer ? { register(entry) { route = entry; return () => {}; } } : undefined;
      }
      return services[service];
    },
    /** The route the plugin registered, for tests that drive it. */
    get route() { return route; },
    /** Fire the post-execute hook the way the harness would. */
    async postExecute(agent, downstream = { kind: "ok" }) {
      const handler = listeners.get("tools/post-execute");
      assert.ok(handler !== undefined, `tools/post-execute was never registered (have: ${[...listeners.keys()].join(", ") || "nothing"})`);
      return handler({ agent, name: "pwsh" }, downstream, async () => downstream);
    },
    /** An agent whose scoped tools.restrict() is observable. */
    agent() {
      const record = { restricted: [] };
      return {
        record,
        ctx: { tools: { restrict: (filter) => restrictions.push(filter) } },
      };
    },
  };
  // Cordis does not hand back undefined for a service you did not inject: it throws
  // `cannot get property "x" without inject`. This proxy does the same, so a regression
  // to a bare property read fails here rather than in someone's session.
  return new Proxy(target, {
    get(object, property, receiver) {
      if (typeof property === "symbol" || property in object) return Reflect.get(object, property, receiver);
      throw new Error(`cannot get property "${String(property)}" without inject`);
    },
  });
}

const config = (overrides = {}) => Config(overrides);

// ---------------------------------------------------------------- usageTokens
await it("usage counts fresh input and output", () => {
  assert.equal(usageTokens({ inputTokens: 100, outputTokens: 50 }, true), 150);
});

await it("usage counts cached tokens only when asked", () => {
  const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, cacheWriteTokens: 500 };
  assert.equal(usageTokens(usage, true), 1650, "with countCache the cached tokens are billed");
  assert.equal(usageTokens(usage, false), 150, "without it they are ignored");
});

await it("reasoning is not added on top of output", () => {
  // It is already inside outputTokens; adding it would inflate every reading.
  assert.equal(usageTokens({ outputTokens: 200, reasoningTokens: 180 }, true), 200);
});

await it("a missing or malformed usage record is zero, not NaN", () => {
  assert.equal(usageTokens(undefined, true), 0);
  assert.equal(usageTokens(null, true), 0);
  assert.equal(usageTokens({ inputTokens: "many" }, true), 0);
  assert.equal(usageTokens({ inputTokens: -5 }, true), 0);
});

// ---------------------------------------------------------------- spentTokens
await it("spend is read from the tokenUsage projection", () => {
  const ctx = fakeContext();
  ctx.setTotal(4200);
  assert.equal(spentTokens(ctx, {}, true), 4200);
});

await it("reading a service does not require having declared it", () => {
  // The regression this guards. `ctx.sessionProjections` throws in Cordis when the
  // service is not in the plugin's inject list, and because the read happens inside the
  // tool pipeline the throw failed *every tool call in the session* — the error read as
  // if the tools themselves were broken. `ctx.get` is the way to read a service you have
  // not injected, and the fake above throws exactly like Cordis does.
  const ctx = fakeContext();
  assert.doesNotThrow(() => spentTokens(ctx, {}, true), "accessing the projection must not throw");
  ctx.setTotal(4200);
  assert.equal(spentTokens(ctx, {}, true), 4200);
});

await it("a host with no projections reads as zero spend, not a crash", () => {
  assert.equal(spentTokens({ get: () => undefined }, {}, true), 0);
  assert.equal(spentTokens(fakeContext({ projections: false }), {}, true), 0);
});

await it("a throwing projection is swallowed", () => {
  const ctx = { get: () => ({ snapshot: () => { throw new Error("no session"); } }) };
  assert.equal(spentTokens(ctx, {}, true), 0);
});

await it("nothing this plugin does can fail a tool call", async () => {
  // It already happened once, and from the outside it looked like the *tools* were
  // broken: every call in the session returned the same host error. A coach that cannot
  // count its Tokens is worth nothing; one that breaks the tools it was mounted to make
  // cheaper is worth less than nothing. So the hook swallows anything it cannot handle
  // and passes the tool result straight through.
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, level: "strict" }));
  ctx.break();
  const result = await ctx.postExecute(ctx.agent());
  assert.deepEqual(result, { kind: "ok" }, "the tool result must survive untouched");
  assert.equal(ctx.restrictions.length, 0, "and nothing may be masked on the way out");
});

// ---------------------------------------------------------------- the coach
await it("the plugin is named and exports a config schema", () => {
  assert.equal(name, "token-thrift");
  assert.ok(Config !== undefined);
});

await it("budget 0 installs nothing at all", () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 0 }));
  assert.equal(ctx.listeners.size, 0, "a disabled plugin must not register listeners");
});

await it("the first tier speaks once, at its ratio", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, tiers: [{ ratio: 0.5, text: "half" }], maskTools: [] }));

  // One agent for the whole test. The plugin keys its progress on the agent object, so a
  // fresh agent per call would look like a fresh session and the reminder would repeat —
  // which is what the first version of this test accidentally proved.
  const agent = ctx.agent();

  ctx.setTotal(400);
  const below = await ctx.postExecute(agent);
  assert.equal(below.additionalContexts, undefined, "40% is below a 50% tier");

  ctx.setTotal(500);
  const at = await ctx.postExecute(agent);
  assert.equal(at.additionalContexts?.length, 1);
  assert.match(at.additionalContexts[0].content[0].text, /half/u);

  ctx.setTotal(900);
  const again = await ctx.postExecute(agent);
  assert.equal(again.additionalContexts, undefined, "a tier speaks once per session");
});

await it("two agents keep separate progress", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0.5, text: "x" }], maskTools: [] }));
  ctx.setTotal(60);
  const first = await ctx.postExecute(ctx.agent());
  const second = await ctx.postExecute(ctx.agent());
  assert.equal(first.additionalContexts?.length, 1, "the first agent is told");
  assert.equal(second.additionalContexts?.length, 1, "a sibling agent gets its own reminder, not silence");
});

await it("the reminder is labelled as a plugin notice", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0.5, text: "x" }], maskTools: [] }));
  ctx.setTotal(60);
  const result = await ctx.postExecute(ctx.agent());
  const source = result.additionalContexts[0].source;
  assert.equal(source.kind, "plugin");
  assert.equal(source.plugin, "token-thrift", "an unlabelled notice is indistinguishable from the user");
  assert.equal(source.form, "notice");
});

await it("several tiers coming due at once speak in one message", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0.4, text: "a" }, { ratio: 0.9, text: "b" }], maskTools: [] }));
  ctx.setTotal(95);
  const result = await ctx.postExecute(ctx.agent());
  assert.equal(result.additionalContexts.length, 1, "two tiers must not cost two reminders");
  assert.match(result.additionalContexts[0].content[0].text, /a/u);
  assert.match(result.additionalContexts[0].content[0].text, /b/u);
});

await it("downstream contexts are preserved, ours in front", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0.5, text: "x" }], maskTools: [] }));
  ctx.setTotal(60);
  const existing = { content: [{ type: "text", text: "from another plugin" }] };
  const result = await ctx.postExecute(ctx.agent(), { kind: "ok", additionalContexts: [existing] });
  assert.equal(result.additionalContexts.length, 2);
  assert.equal(result.additionalContexts[1], existing, "another plugin's context must survive");
});

await it("a blocked decision stays blocked", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0.5, text: "x" }], maskTools: [] }));
  ctx.setTotal(60);
  const result = await ctx.postExecute(ctx.agent(), { kind: "block", feedback: "denied" });
  assert.equal(result.kind, "block", "advice must not turn a refusal into a run");
  assert.equal(result.feedback, "denied");
  assert.equal(result.additionalContexts.length, 1);
});

await it("fan-out tools are masked once the mask ratio is crossed", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0.5, text: "x" }], maskTools: ["subagent", "workflow"], maskRatio: 0.8 }));

  const agent = ctx.agent();
  ctx.setTotal(50);
  await ctx.postExecute(agent);
  assert.equal(ctx.restrictions.length, 0, "nothing is masked while there is budget left");

  ctx.setTotal(85);
  await ctx.postExecute(agent);
  assert.equal(ctx.restrictions.length, 1, "the mask lands exactly once");
  assert.deepEqual(ctx.restrictions[0].deny, ["subagent", "workflow"]);
});

await it("a host without the restriction seam still gets the advice", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0.5, text: "x" }], maskTools: ["subagent"], maskRatio: 0.5 }));
  ctx.setTotal(90);
  const broken = { ctx: { tools: { restrict: () => { throw new Error("no seam"); } } } };
  const result = await ctx.postExecute(broken);
  assert.equal(result.additionalContexts?.length, 1, "the reminder must still arrive");
});

await it("maxReminders caps a session", async () => {
  const ctx = fakeContext();
  const tiers = Array.from({ length: 8 }, (_, index) => ({ ratio: (index + 1) / 10, text: `t${String(index)}` }));
  apply(ctx, config({ budget: 100, tiers, maskTools: [], maxReminders: 3 }));
  const agent = ctx.agent();
  let sent = 0;
  for (let percent = 10; percent <= 80; percent += 10) {
    ctx.setTotal(percent);
    const result = await ctx.postExecute(agent);
    if (result.additionalContexts !== undefined) sent += 1;
  }
  assert.equal(sent, 3, "the backstop must hold");
});

await it("malformed tiers are dropped rather than trusted", () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0, text: "zero" }, { ratio: 0.5, text: "" }, { ratio: 0.6, text: "keep" }], maskTools: [] }));
  assert.equal(ctx.listeners.size, 1, "the listener registers as long as one tier survives");
});

await it("a tier list with nothing usable installs nothing", () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, tiers: [{ ratio: 0, text: "zero" }], maskTools: [] }));
  assert.equal(ctx.listeners.size, 0);
});

// ---------------------------------------------------------------- the dial
await it("the dial is monotonic: leaning harder speaks earlier, more often, and masks sooner", () => {
  let previousFirst = 2;
  let previousCount = 0;
  let previousMask = 2;
  for (let value = 1; value <= 100; value++) {
    const { tiers, maskRatio } = ladderFor(value);
    assert.ok(tiers.length >= 1, `intensity ${String(value)} produced no tiers`);

    const first = tiers[0].ratio;
    assert.ok(first <= previousFirst + 1e-9, `intensity ${String(value)} starts later than ${String(value - 1)}`);
    assert.ok(tiers.length >= previousCount, `intensity ${String(value)} has fewer tiers than ${String(value - 1)}`);
    assert.ok(tiers.length <= 4, `intensity ${String(value)} produced ${String(tiers.length)} tiers`);

    // Every tier sits inside (0, 1] and they are strictly increasing.
    for (const tier of tiers) {
      assert.ok(tier.ratio > 0 && tier.ratio <= 1, `intensity ${String(value)} has a tier at ${String(tier.ratio)}`);
      assert.ok(tier.text.length > 0, `intensity ${String(value)} has a silent tier`);
    }
    for (let index = 1; index < tiers.length; index++) {
      assert.ok(tiers[index].ratio > tiers[index - 1].ratio, `intensity ${String(value)} has an out-of-order tier`);
    }

    if (maskRatio !== null) {
      assert.ok(maskRatio <= previousMask + 1e-9, `intensity ${String(value)} masks later than ${String(value - 1)}`);
      assert.ok(maskRatio > 0.4 && maskRatio <= 1, `intensity ${String(value)} masks at an impossible ratio`);
    }
    previousFirst = first;
    previousCount = tiers.length;
    previousMask = maskRatio ?? previousMask;
  }
  // The ends, spelled out, because they are what the two words used to mean.
  assert.deepEqual(ladderFor(100).tiers.map((tier) => tier.ratio), [0.25, 0.47, 0.68, 0.9]);
  assert.equal(ladderFor(100).maskRatio, 0.55, "the harsh end lands on the old `strict` threshold");
  assert.equal(ladderFor(1).tiers.length, 1, "the gentle end says one thing");
  assert.equal(ladderFor(1).maskRatio, null, "and never touches the tool table");
  assert.deepEqual(ladderFor(0), { tiers: [], maskRatio: null }, "zero is off");
});

await it("a tier's words follow where it sits, not which one it is", () => {
  // The dial changes how many tiers there are, so tier #2 of a gentle setting sits where
  // tier #4 of a harsh one does. If the words came from the index, a setting with one tier
  // would politely suggest cheaper habits at 90% spent.
  const at = (value) => ladderFor(value).tiers.map((tier) => `${tier.ratio}:${tier.text.slice(15, 26)}`);
  assert.match(ladderFor(100).tiers[3].text, /wrap up/u, "the 90% tier of the harsh end wraps up");
  assert.match(ladderFor(1).tiers[0].text, /wrap up/u, "and so does the only tier of the gentle end, at 89%");
  assert.match(ladderFor(25).tiers[0].text, /stop exploring/u, "74% says stop exploring");
  assert.match(ladderFor(40).tiers[0].text, /converging/u, "64% says start converging");
  assert.match(ladderFor(40).tiers[1].text, /wrap up/u, "and its 90% tier still wraps up");
  assert.equal(at(100).length, 4);
});

await it("the old names are now stops on the dial, and still mean something", () => {
  assert.equal(PRESETS.off, 0);
  assert.ok(PRESETS.light < PRESETS.standard && PRESETS.standard < PRESETS.strict, "the stops stay ordered");
  for (const [word, stop] of Object.entries(PRESETS)) {
    assert.equal(presetOf(stop), word, `${word} should be the name of its own stop`);
  }
  assert.equal(presetOf(0), "off");
  assert.equal(presetOf(100), "strict");
  assert.equal(presetOf(undefined), "off", "an absent dial is off, not a crash");
});

await it("a profile patch written before the dial still configures the same thing", async () => {
  // `level: strict` has to keep working: it is in somebody's patch file.
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, level: "strict" }));
  const agent = ctx.agent();
  ctx.setTotal(300);
  assert.ok((await ctx.postExecute(agent)).additionalContexts?.length > 0, "strict has already spoken at 30%");
  ctx.setTotal(600);
  await ctx.postExecute(agent);
  assert.equal(ctx.restrictions.length, 1, "and masks past its 55% threshold");

  const quiet = fakeContext();
  apply(quiet, config({ budget: 1000, level: "off" }));
  assert.equal(quiet.listeners.size, 0, "off means off");

  // And an explicit intensity beats it.
  const dialled = fakeContext();
  apply(dialled, config({ budget: 1000, level: "strict", intensity: 20 }));
  dialled.setTotal(300);
  assert.equal((await dialled.postExecute(dialled.agent())).additionalContexts, undefined, "20 is gentle again");
  assert.equal(dialled.restrictions.length, 0, "and it does not mask");
});

await it("the dial turns the coach on and off, from the config alone", () => {
  // The route-driven version of this lives with the platform tests, below; this one is
  // here because it is really a statement about `settingsFor`.
  const off = fakeContext();
  apply(off, config({ budget: 1000, intensity: 0 }));
  assert.equal(off.listeners.size, 0, "zero installs nothing — and 0 must not mean `unset`");

  const on = fakeContext();
  apply(on, config({ budget: 1000, intensity: 100 }));
  assert.equal(on.listeners.size, 1);
  assert.equal(on.restrictions.length, 0);
});

await it("a hand-written tier list still overrides the dial", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, intensity: 100, tiers: [{ ratio: 0.95, text: "mine" }], maskTools: [] }));
  const agent = ctx.agent();
  ctx.setTotal(500);
  assert.equal((await ctx.postExecute(agent)).additionalContexts, undefined, "the level's own tiers must not fire");
  ctx.setTotal(960);
  const result = await ctx.postExecute(agent);
  assert.match(result.additionalContexts[0].content[0].text, /mine/u);
});

await it("the schema takes a dial position and refuses nonsense", () => {
  assert.equal(Config({ intensity: 0 }).intensity, 0, "zero is a position, not an absent value");
  assert.equal(Config({ intensity: 57 }).intensity, 57);
  assert.equal(Config({}).intensity, -1, "and the default is the sentinel for `nobody said`");
  for (const level of Object.keys(PRESETS)) {
    assert.equal(Config({ level }).level, level, `${level} must still survive validation`);
  }
  assert.throws(() => Config({ level: "turbo" }), "an unknown level must be rejected, not silently ignored");
});

/**
 * Drive a registered route the way the web server would, and return its answer.
 *
 * The request is a real enough object for the handler's own contract: a method, a Host
 * header for the authorization fallback, and an event emitter for the body.
 */
function ask(route, url, { method = "GET", body, host = "127.0.0.1:8080" } = {}) {
  return new Promise((resolve, reject) => {
    const listeners = new Map();
    const req = {
      url,
      method,
      headers: host === null ? {} : { host },
      on(event, handler) {
        listeners.set(event, handler);
        return this;
      },
      destroy() {},
    };
    const res = {
      status: 0,
      headers: {},
      body: "",
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers ?? {};
      },
      end(text) {
        this.body = typeof text === "string" ? text : "";
        resolve(this);
      },
    };
    // The handler runs synchronously up to its first await, and that is where the body
    // listeners are attached — so firing `end` now is the same order the server uses.
    //
    // A handler that throws is rejected through rather than swallowed: swallowing it left
    // the promise unsettled and the whole file hanging with no output, which is a much
    // worse way to learn about a bug than a stack trace.
    Promise.resolve(route.handler(req, res)).catch(reject);
    if (body !== undefined) listeners.get("data")?.(JSON.stringify(body));
    listeners.get("end")?.();
  });
}

/** The parsed body of an answer, for the many assertions that only care about JSON. */
const jsonOf = (answer) => JSON.parse(answer.body);

// ---------------------------------------------------------------- the platform
await it("the platform route answers with what the coach is doing", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, intensity: 100 }));
  assert.equal(ctx.route?.path, "/dsh-token-thrift", "the state route must be claimed");
  assert.equal(ctx.route?.kind, "prefix");

  ctx.setTotal(600);
  await ctx.postExecute(ctx.agent());

  const answer = await ask(ctx.route, "/dsh-token-thrift/api/state");
  assert.equal(answer.status, 200);
  const payload = jsonOf(answer);
  assert.equal(payload.ok, true);
  assert.equal(payload.enabled, true);
  assert.equal(payload.budget, 1000);
  assert.equal(payload.intensity, 100, "the dial is what the platform reports");
  assert.equal(payload.level, "strict", "and the old word is derived from it, for labels");
  assert.equal(payload.maskRatio, 0.55, "the harsh end masks past halfway");
  assert.deepEqual(payload.tiers, [0.25, 0.47, 0.68, 0.9]);
  // The console's debug view needs the words, not just the positions: "what is this about to
  // say to me, and at what point" is the question the dial raises, and `tiers` cannot answer it.
  assert.deepEqual(payload.ladder.map((rung) => rung.ratio), [0.25, 0.47, 0.68, 0.9]);
  for (const rung of payload.ladder) {
    assert.ok(typeof rung.text === "string" && rung.text.length > 20, `the ${String(rung.ratio)} rung must carry what it would say`);
  }
  // And the words are the ones that get spoken, not a generic placeholder.
  assert.match(payload.ladder[3].text, /wrap up/u, "the last rung of a harsh dial says wrap up");

  assert.equal(payload.reports.length, 1, "one session, one row");
  const [report] = payload.reports;
  assert.equal(report.spent, 600);
  assert.equal(report.ratio, 0.6);
  assert.equal(report.masked, true, "60% is past the mask threshold");
  // Fired or not is per tier, which is what makes a timeline drawable.
  assert.deepEqual(report.fired.map((tier) => tier.ratio), [0.25, 0.47, 0.68, 0.9]);
  assert.deepEqual(report.fired.map((tier) => tier.at !== null), [true, true, false, false]);
  // And the report carries the list it was measured against, because the console can
  // change the level afterwards and a fired mark only means something against its own list.
  assert.deepEqual(report.tiers, [0.25, 0.47, 0.68, 0.9]);
});

await it("the reported ratio follows the budget, not the last tool call", async () => {
  // Changing the budget is the one interaction the console exists for. Reporting the ratio
  // the coach computed at the previous tool call made that change look like it did nothing.
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000 }));
  ctx.setTotal(400);
  await ctx.postExecute(ctx.agent());
  assert.equal(jsonOf(await ask(ctx.route, "/dsh-token-thrift/api/state")).reports[0].ratio, 0.4);

  await ask(ctx.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { budget: 2000 } });
  assert.equal(jsonOf(await ask(ctx.route, "/dsh-token-thrift/api/state")).reports[0].ratio, 0.2, "halving the budget halves the ratio");

  await ask(ctx.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { budget: 0 } });
  assert.equal(jsonOf(await ask(ctx.route, "/dsh-token-thrift/api/state")).reports[0].ratio, 0, "no budget, no ratio");
});

await it("the console can turn the dial, and the running coach follows", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, intensity: 20 }));
  const agent = ctx.agent();

  ctx.setTotal(300);
  await ctx.postExecute(agent);
  assert.equal(jsonOf(await ask(ctx.route, "/dsh-token-thrift/api/state")).reports[0].masked, false, "a gentle dial never masks");

  // Turn it up from the console. No restart, no reload: the listener is a live thing,
  // which is the difference between a screenshot and a platform.
  const changed = await ask(ctx.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { intensity: 100 } });
  assert.equal(changed.status, 200);
  const after = jsonOf(changed);
  assert.equal(after.intensity, 100);
  assert.equal(after.level, "strict", "the word follows the dial");
  assert.equal(after.maskRatio, 0.55);
  assert.deepEqual(after.tiers, [0.25, 0.47, 0.68, 0.9]);
  assert.deepEqual(after.overridden, { budget: false, intensity: true }, "the console must say what it changed");
  assert.equal(after.configured.intensity, 20, "and what the file still says");

  await ctx.postExecute(agent);
  const at30 = jsonOf(await ask(ctx.route, "/dsh-token-thrift/api/state")).reports[0];
  // 300/1000 is past the first tier (25%) but not the mask threshold (55%).
  assert.ok(at30.fired.some((tier) => tier.ratio === 0.25 && tier.at !== null), "the 25% tier fires now that the dial is up");
  assert.equal(at30.masked, false, "30% is still below the 55% mask threshold");

  ctx.setTotal(600);
  await ctx.postExecute(agent);
  const at60 = jsonOf(await ask(ctx.route, "/dsh-token-thrift/api/state")).reports[0];
  assert.equal(at60.masked, true, "60% is past it, so the tools are masked");
  assert.ok(at60.fired.some((tier) => tier.ratio === 0.47 && tier.at !== null), "and the second tier fires");
});

await it("the console can turn a disabled coach on, and off again", async () => {
  const off = fakeContext();
  apply(off, config({ budget: 0 }));
  assert.equal(off.listeners.size, 0, "off still costs nothing");

  const bad = await ask(off.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { intensity: 140 } });
  assert.equal(bad.status, 400, "an out-of-range dial must be refused, not clamped silently");
  assert.equal(jsonOf(bad).error, "bad_intensity");
  assert.equal(jsonOf(await ask(off.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { budget: -5 } })).error, "bad_budget");

  const on = await ask(off.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { budget: 1000, intensity: 100 } });
  assert.equal(jsonOf(on).enabled, true);
  assert.equal(off.listeners.size, 1, "turning it on from the console installs the listener");

  off.setTotal(600);
  assert.ok((await off.postExecute(off.agent())).additionalContexts?.length > 0, "and it now coaches");

  await ask(off.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { budget: null, intensity: null } });
  assert.equal(jsonOf(await ask(off.route, "/dsh-token-thrift/api/state")).enabled, false, "null restores the file's value");
  assert.equal(off.listeners.size, 0, "and the listener goes away with it");

  // The old word still works as a way to say a position on the dial — but it is only a
  // position, so it needs a budget to actually run: restoring `budget: null` above put the
  // file's 0 back, and a coach with no budget is off whatever the dial says.
  const worded = await ask(off.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { level: "strict", budget: 1000 } });
  assert.equal(jsonOf(worded).intensity, PRESETS.strict, "`level: strict` is just a stop on the dial");
  assert.equal(off.listeners.size, 1, "and with a budget it runs again");
});

await it("turning the dial down mid-session switches the coach off again", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, intensity: 100 }));
  assert.equal(ctx.listeners.size, 1);

  ctx.setTotal(300);
  assert.ok((await ctx.postExecute(ctx.agent())).additionalContexts?.length > 0, "it is coaching");

  const off = await ask(ctx.route, "/dsh-token-thrift/api/settings", { method: "POST", body: { intensity: 0 } });
  assert.equal(jsonOf(off).enabled, false, "zero stops it");
  assert.equal(ctx.listeners.size, 0, "and the listener goes with it");
  // There is no hook left to fire, which is the point — so the check is that the platform
  // says so, not that a hook declines to speak.
  assert.equal(jsonOf(await ask(ctx.route, "/dsh-token-thrift/api/state")).enabled, false);
});

await it("a session can be reset, so the coach can be watched working twice", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 100, level: "standard", tiers: [{ ratio: 0.5, text: "half" }], maskTools: [] }));
  const agent = ctx.agent();
  ctx.setTotal(60);

  const first = await ctx.postExecute(agent);
  assert.equal(first.additionalContexts?.length, 1, "the tier fires");
  assert.equal((await ctx.postExecute(agent)).additionalContexts, undefined, "and only once per session");

  const cleared = await ask(ctx.route, "/dsh-token-thrift/api/reset", { method: "POST", body: { sessionId: "current" } });
  assert.equal(cleared.status, 200);
  assert.deepEqual(jsonOf(cleared).reports, [], "the row is gone too");

  const again = await ctx.postExecute(agent);
  assert.equal(again.additionalContexts?.length, 1, "after a reset the same tier fires again");
});

await it("a disabled coach still answers, so the console can say why", async () => {
  const off = fakeContext();
  apply(off, config({ budget: 0 }));
  const payload = jsonOf(await ask(off.route, "/dsh-token-thrift/api/state"));
  assert.equal(payload.ok, true);
  assert.equal(payload.enabled, false, "the console needs to distinguish off from broken");
  assert.equal(payload.budget, 0);
  assert.deepEqual(payload.reports, []);
  assert.deepEqual(payload.presets, { off: 0, light: 25, standard: 55, strict: 100 }, "the console labels its dial from this");

  // And `level: "off"` with a real budget is the same story.
  const levelled = fakeContext();
  apply(levelled, config({ budget: 1000, level: "off" }));
  assert.equal(jsonOf(await ask(levelled.route, "/dsh-token-thrift/api/state")).enabled, false);
});

await it("nothing gets in without the host's authority", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000 }));
  // No Host header and no Connection service: the loopback fallback refuses it.
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/api/state", { host: null })).status, 401);
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/api/settings", { method: "POST", host: null, body: { level: "off" } })).status, 401);
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/console/", { host: null })).status, 401);
});

await it("the state route is the only thing it serves", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000 }));
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/api/state")).status, 200);
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/api/state?x=1")).status, 200, "a query string is not a different route");
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/api/secret")).status, 404);
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/api/settings")).status, 405, "GET is not how settings change");
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/api/reset")).status, 405);
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/")).status, 404);
});

await it("the console offers only its own files", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000 }));
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/console/")).status, 200, "the index is served");
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/console/app.js")).status, 200);
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/console/app.css")).status, 200);
  // Extensions outside the allowlist never reach the filesystem.
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/console/../../lib/index.js")).status, 404);
  assert.equal((await ask(ctx.route, "/dsh-token-thrift/console/nope.js")).status, 404);
});

await it("a host with no web server still gets a working coach", async () => {
  const ctx = fakeContext({ webServer: false });
  apply(ctx, config({ budget: 1000 }));
  assert.equal(ctx.route, undefined, "no route seam, no route");
  ctx.setTotal(600);
  const result = await ctx.postExecute(ctx.agent());
  assert.ok(result.additionalContexts?.length > 0, "the coach must not depend on being visible");
});

// ---------------------------------------------------------------- the browser half
const registrations = [];
globalThis.window = {
  __ModuleLoader__: { load(entry) { registrations.push(entry); } },
  // The client retries the mascot's seat on a timer; browsers have these, Node does not.
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};
globalThis.document = { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } };
await import("../lib/client.js");
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  // The panel keeps the ball's live position in a ref during a drag; state would lag the pointer.
  useRef: (initial) => ({ current: initial }),
  Fragment: Symbol.for("react.fragment"),
};
const client = registrations[0].factory((spec) => {
  if (spec === "react") return React;
  throw new Error(`unexpected require(${spec})`);
});

await it("the browser half registers under the package name, like the mascot does", () => {
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, "dsh-token-thrift", "the registered id must equal the package name");
  assert.deepEqual(client.inject, ["slots"], "the half depends on the slot registry");
});

await it("the panel mounts into the overlay list beside the mascot", () => {
  const injected = [];
  const registered = [];
  const ctx = {
    slots: {
      /**
       * The registry takes a generator and drives it: each `yield` hands back a disposer.
       *
       * A fake that just called `body()` would get an unstarted generator and assert
       * nothing at all — which is exactly what this test did before it was fixed.
       */
      inject(name, body) {
        injected.push(name);
        const iterator = body();
        if (iterator === undefined || typeof iterator.next !== "function") return;
        let step = iterator.next();
        while (step.done !== true) step = iterator.next();
      },
      register(declaration = {}, Component) { registered.push({ declaration, Component }); },
    },
    // Real Cordis runs an effect's callback and keeps its disposer; the retry for the
    // mascot's seat goes through one, so the stub has to have it.
    effect(callback) {
      const dispose = callback();
      return typeof dispose === "function" ? dispose : () => {};
    },
  };
  client.apply(ctx);
  assert.deepEqual(injected, ["shell.overlay"]);
  // Two registrations: the overlay, and the panel that fills the slot it declares. Declaring
  // a slot and occupying it are separate calls, and this file used to do only the first — the
  // ball rendered and the panel it opened did not. A count is the only thing that catches
  // that, so the count is asserted.
  //
  // It used to be three: a card also sat inside the mascot's panel. That is gone — the
  // floating ball is the one surface now, and two places showing the same dial is how you end
  // up tuning the wrong one.
  assert.equal(registered.length, 2, "the overlay, and the panel that fills the slot it declares");
  assert.equal(registered[0].declaration.name, "shell.overlay");
  assert.equal(registered[1].declaration.name, "thrift.panel", "the declared child slot must be occupied");
  assert.equal(registered[1].Component, client.ThriftPanel, "by the panel itself");
  assert.equal(registered[0].declaration.children["thrift.panel"].scope, "session-maybe", "and it is declared before it is filled");
  assert.equal(client.ThriftCard, undefined, "the mascot-hosted card is gone, not merely unregistered");

  // The seat belongs to the other plugin and the load order is not this file's to decide,
  // so the ask has to survive not being answerable yet.
  const late = [];
  const lateCtx = {
    slots: {
      inject(key, callback) {
        const iterator = callback();
        let step = iterator.next();
        while (step.done !== true) step = iterator.next();
      },
      // The first three succeed; the fourth (the mascot's seat) is not declared yet.
      register(options, component) {
        // The real registry's wording, verbatim: the retry only retries on *this* message, so
        // a stub that says something else is testing a path the product never takes.
        if (options.name === "mascot.thrift") throw new Error('slot "mascot.thrift" is not declared (a parent entry\'s children table must declare it)');
        late.push(options.name);
        return () => {};
      },
    },
    effect(callback) {
      const dispose = callback();
      // Dispose at once: the retry would otherwise keep rescheduling and the test process
      // would never exit. The first attempt has already happened, which is what is
      // being asserted.
      if (typeof dispose === "function") dispose();
      return () => {};
    },
  };
  client.apply(lateCtx);
  assert.deepEqual(late, ["shell.overlay", "thrift.panel"], "an undeclared seat must not take the whole plugin down");
  assert.equal(registered[0].declaration.id, "token-thrift");
  // The child slot is what hands the panel a session id, and the report is found by it.
  assert.deepEqual(Object.keys(registered[0].declaration.children), ["thrift.panel"]);
  assert.equal(registered[0].declaration.children["thrift.panel"].scope, "session-maybe");
  assert.equal(registered[0].Component, client.ThriftOverlay);
});

await it("a report is matched by session, so two windows do not share one number", () => {
  const payload = { reports: [{ sessionId: "b", spent: 200 }, { sessionId: "a", spent: 100 }] };
  assert.equal(client.pickReport(payload, "a").spent, 100, "the session on screen wins over the newest");
  assert.equal(client.pickReport(payload, "b").spent, 200);
  // An id from somewhere else in the host is a smaller failure than an empty panel.
  assert.equal(client.pickReport(payload, "zzz").spent, 200, "an unknown id falls back to the newest");
  assert.equal(client.pickReport(payload, undefined).spent, 200);
  assert.equal(client.pickReport({ reports: [] }, "a"), undefined);
  assert.equal(client.pickReport({}, "a"), undefined);
  assert.equal(client.pickReport(undefined, "a"), undefined);
});

await it("the bar's colour turns before the number does", () => {
  assert.equal(client.tone(0), "#4fd6a8");
  assert.equal(client.tone(0.39), "#4fd6a8");
  assert.equal(client.tone(0.4), "#ffd34d");
  assert.equal(client.tone(0.7), "#ffab3d");
  assert.equal(client.tone(0.9), "#ff5f6d");
  assert.equal(client.tone(1.4), "#ff5f6d", "over budget is still the alarm colour");
  assert.equal(client.tone(undefined), "#5aa9e6", "an unknown ratio must not throw");
});

await it("the panel is a control surface, not a read-out", () => {
  // The controls are the reason to open it. A panel you have to leave in order to act on
  // is a panel you stop opening, so all three things worth doing live in it: lean harder,
  // give it room, and let a session be told again.
  //
  // Rendered with the state already loaded and already open, by seeding the hook queue —
  // the panel returns null until its first poll lands, so rendering it for real would
  // assert nothing at all.
  const loaded = {
    ok: true, enabled: true, budget: 1000, intensity: 55, level: "standard", maskRatio: 0.75,
    tiers: [0.54, 0.9], maskTools: ["workflow"], countCache: true, maxReminders: 6,
    presets: { off: 0, light: 25, standard: 55, strict: 100 },
    configured: { budget: 1000, intensity: -1 }, overridden: { budget: false, intensity: false },
    reports: [{ sessionId: "s1", at: 1, spent: 400, ratio: 0.4, masked: false, reminders: 1,
      tiers: [0.54, 0.9],
      fired: [{ ratio: 0.54, at: 1 }, { ratio: 0.9, at: null }] }],
  };
  const queue = [loaded, true];
  const Hooks = {
    createElement: (type, props, ...children) => ({
      type,
      props: props ?? {},
      children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
    }),
    useState: (initial) => [queue.length > 0 ? queue.shift() : initial, () => {}],
    useEffect: () => {},
    // Seeded from the queue too: the ball's position is a hook, and rendering the panel
    // without one would exercise a component the product never builds.
    useRef: (initial) => ({ current: queue.length > 0 && initial !== undefined ? queue.shift() : initial }),
    Fragment: Symbol.for("react.fragment"),
  };
  const rendered = registrations[0]
    .factory((spec) => {
      if (spec === "react") return Hooks;
      throw new Error(`unexpected require(${spec})`);
    })
    .ThriftPanel({ sessionId: "s1" });

  // Collected as pairs, because counting bare strings double-counts: the chip carries the
  // current level's name too, so "standard" appears twice and a name-only filter sees five.
  const found = [];
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const cls = typeof node.props?.className === "string" ? node.props.className : undefined;
    const text = typeof node.children?.[0] === "string" ? node.children[0] : undefined;
    if (cls !== undefined) found.push({ cls, text });
    (node.children ?? []).forEach(walk);
  };
  walk(rendered);

  const levelButtons = found.filter((node) => node.cls === "dsh-thrift-level").map((node) => node.text).sort();
  assert.deepEqual(levelButtons, [], "the four buttons are gone — the dial replaced them");
  assert.ok(found.some((node) => node.cls === "dsh-thrift-dial"), "the dial must be in the panel");
  assert.ok(found.some((node) => node.cls === "dsh-thrift-budget"), "the budget must be settable from the panel");
  assert.ok(found.some((node) => node.cls === "dsh-thrift-apply"), "with a way to submit it");
  assert.ok(found.some((node) => node.cls === "dsh-thrift-restore"), "and a way back to the file's value");
  assert.ok(found.some((node) => node.cls === "dsh-thrift-reset"), "a session must be resettable from here too");
  // It is still a read-out as well: the bar and the fired marks have to survive.
  assert.ok(found.some((node) => node.cls === "dsh-thrift-track"), "the progress bar must stay");
  assert.equal(found.filter((node) => node.cls === "dsh-thrift-tick").length, 2, "one mark per tier of this dial position");

  // And the dial is a range input spanning the whole 0–100, not a set of stops.
  const ranges = [];
  const walkRanges = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walkRanges); return; }
    if (node.type === "input" && node.props?.type === "range") ranges.push(node.props);
    (node.children ?? []).forEach(walkRanges);
  };
  walkRanges(rendered);
  assert.equal(ranges.length, 1, "exactly one dial");
  assert.equal(ranges[0].min, "0");
  assert.equal(ranges[0].max, "100");
  assert.equal(ranges[0].step, "1");
  assert.equal(ranges[0].value, "55", "and it shows where the dial currently is");
});

console.log(`\ntoken-thrift: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
