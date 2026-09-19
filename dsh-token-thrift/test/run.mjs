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
import { apply, Config, LEVELS, name, spentTokens, usageTokens } from "../lib/index.js";

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
function fakeContext({ projections = true } = {}) {
  const listeners = new Map();
  const restrictions = [];
  let total = 0;
  let broken = false;
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
    on(event, handler) { listeners.set(event, handler); },
    /**
     * The documented way to reach a service you have not injected. Absent services answer
     * undefined here rather than throwing — that is the whole difference from a property
     * read, and the reason `spentTokens` uses this one.
     */
    get(service) {
      if (broken) throw new Error("the projection service is unreachable");
      return services[service];
    },
    /** Fire the post-execute hook the way the harness would. */
    async postExecute(agent, downstream = { kind: "ok" }) {
      const handler = listeners.get("tools/post-execute");
      assert.ok(handler !== undefined, "tools/post-execute was never registered");
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

// ---------------------------------------------------------------- levels
await it("level off installs nothing, the same as budget 0", () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, level: "off" }));
  assert.equal(ctx.listeners.size, 0, "off means off");
});

await it("light advises late and never touches the tool table", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, level: "light" }));
  const agent = ctx.agent();
  ctx.setTotal(600);
  assert.equal((await ctx.postExecute(agent)).additionalContexts, undefined, "light is quiet at 60%");
  ctx.setTotal(750);
  assert.equal((await ctx.postExecute(agent)).additionalContexts?.length, 1, "and speaks at 70%");
  ctx.setTotal(1000);
  await ctx.postExecute(agent);
  assert.equal(ctx.restrictions.length, 0, "light never masks, however full the glass is");
});

await it("strict leans earlier than standard, and masks earlier still", async () => {
  const speaks = async (level, percent) => {
    const ctx = fakeContext();
    apply(ctx, config({ budget: 1000, level }));
    ctx.setTotal(percent * 10);
    return (await ctx.postExecute(ctx.agent())).additionalContexts !== undefined;
  };
  const masks = async (level, percent) => {
    const ctx = fakeContext();
    apply(ctx, config({ budget: 1000, level }));
    ctx.setTotal(percent * 10);
    await ctx.postExecute(ctx.agent());
    return ctx.restrictions.length > 0;
  };

  assert.equal(await speaks("standard", 30), false, "standard is quiet at 30%");
  assert.equal(await speaks("light", 30), false, "light is quiet at 30%");
  assert.equal(await speaks("strict", 30), true, "strict has already spoken at 30%");

  assert.equal(await speaks("standard", 75), true, "standard speaks by 75%");
  assert.equal(await speaks("light", 75), true, "and so does light");

  assert.equal(await masks("standard", 60), false, "standard leaves the tool table alone at 60%");
  assert.equal(await masks("strict", 60), true, "strict masks at 60%");
  assert.equal(await masks("standard", 95), true, "standard masks once the budget is nearly gone");
  assert.equal(await masks("light", 100), false, "light never masks");
});

await it("a hand-written tier list still overrides the level", async () => {
  const ctx = fakeContext();
  apply(ctx, config({ budget: 1000, level: "strict", tiers: [{ ratio: 0.95, text: "mine" }], maskTools: [] }));
  const agent = ctx.agent();
  ctx.setTotal(500);
  assert.equal((await ctx.postExecute(agent)).additionalContexts, undefined, "the level's own tiers must not fire");
  ctx.setTotal(960);
  const result = await ctx.postExecute(agent);
  assert.match(result.additionalContexts[0].content[0].text, /mine/u);
});

await it("every level is a name the schema accepts", () => {
  for (const level of Object.keys(LEVELS)) {
    assert.equal(Config({ level }).level, level, `${level} must survive validation`);
  }
  assert.throws(() => Config({ level: "turbo" }), "an unknown level must be rejected, not silently ignored");
});

console.log(`\ntoken-thrift: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
