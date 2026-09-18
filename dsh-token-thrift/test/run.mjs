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
import { apply, Config, name, spentTokens, usageTokens } from "../lib/index.js";

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
 */
function fakeContext() {
  const listeners = new Map();
  const restrictions = [];
  let total = 0;
  return {
    listeners,
    restrictions,
    setTotal(value) { total = value; },
    on(event, handler) { listeners.set(event, handler); },
    sessionProjections: {
      snapshot: () => ({ tokenUsage: { totals: { inputTokens: total, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } }),
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

await it("a host with no projections reads as zero spend, not a crash", () => {
  assert.equal(spentTokens({}, {}, true), 0);
  assert.equal(spentTokens({ sessionProjections: {} }, {}, true), 0);
});

await it("a throwing projection is swallowed", () => {
  const ctx = { sessionProjections: { snapshot: () => { throw new Error("no session"); } } };
  assert.equal(spentTokens(ctx, {}, true), 0);
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

console.log(`\ntoken-thrift: ${String(passed)} passed, ${String(failed)} failed`);
if (failed > 0) process.exit(1);
