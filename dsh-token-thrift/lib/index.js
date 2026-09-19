/**
 * dsh-token-thrift —— 花得聪明，而不只是卡住上限。
 *
 * ## 与 dsh-agent-budget 的分工
 *
 * `dsh-agent-budget` 做的是**准入**：在每次请求服务商之前判断"这笔花得起吗"，
 * 花不起就拒绝。那是"限制"，也是它的价值所在 —— 它保证你不会超支。
 *
 * 本插件做的是另一半：**在还没超支的时候，让同样的活花更少**。它不拒绝任何请求，
 * 只做两件事：
 *
 *   1. **按花费升级劝告** —— 花到预算的一档，就往上下文里注入一条提醒，
 *      从"读文件前先想想要不要读"到"别再探索了，交活"。提醒是**建议**，不是拒绝。
 *   2. **遮罩昂贵的工具** —— 到了后段，把 subagent / workflow / ralph 这类
 *      "会开新枝"的工具从该 agent 的工具表里摘掉。省 token 最有效的一招不是少说几句，
 *      而是**不要再开新的分支**：每开一个子 agent，整段上下文都要重新读一遍。
 *
 * 所以两者可以同时装：一个兜底，一个省钱。
 *
 * ## 为什么是"提醒"而不是"拒绝"
 *
 * 一个跑在自动驾驶上的 agent，最贵的失败不是"多花了几千 token"，而是"被中途掐断、
 * 活没干完"。所以本插件默认只劝告；`maskTools` 是唯一的硬手段，而它遮的是**枝**，
 * 不是**活**：主线的读写、检索、编辑都还在，agent 仍然能把活干完。
 *
 * @module dsh-token-thrift
 */

import z from "@deepseek-ai/schemastery";

/** The plugin's registry id; also the label stamped on every reminder it injects. */
export const name = "token-thrift";

/**
 * What a reminder is stamped with.
 *
 * The label matters: an unlabelled prompt in derived history is indistinguishable from
 * something the user said, and the next turn's model would treat it as an instruction.
 */
const PLUGIN_SOURCE = { kind: "plugin", plugin: name };

/** Fan-out tools: each call starts work that re-reads the conversation from scratch. */
const DEFAULT_MASKED = ["subagent", "subagent_fork", "workflow", "ralph"];

/**
 * The escalating advice, in the order it is delivered.
 *
 * Each tier fires once per session, at the first tool result after its ratio is crossed.
 * Delivered as advice rather than as a refusal: the point is to change how the remaining
 * budget is spent, not to stop the work.
 */
const DEFAULT_TIERS = [
  {
    ratio: 0.4,
    text:
      "Token thrift: about 40% of this session's budget is spent. Cheaper habits from here: "
      + "read a targeted range instead of a whole file; batch independent tool calls into one "
      + "step; skip re-reading what a previous result already established; answer at the length "
      + "the question needs and no longer.",
  },
  {
    ratio: 0.7,
    text:
      "Token thrift: about 70% of this session's budget is spent. Stop exploring and start "
      + "converging. Do not start new subagents, workflows or background fan-out — each one "
      + "re-reads this conversation. Prefer finishing what is already in flight over opening "
      + "another line of investigation.",
  },
  {
    ratio: 0.9,
    text:
      "Token thrift: about 90% of this session's budget is spent. Wrap up now: state what is "
      + "done, what is verified, and what is left, in as few words as it takes. Only call a "
      + "tool if the task cannot be reported without it.",
  },
];

/**
 * The four strengths, as presets.
 *
 * `maskRatio: null` means never mask — for the two gentle levels the point is to advise,
 * and reaching for the tool table at the first sign of spending is how a coach turns into
 * an obstacle. `strict` moves the mask to just past halfway, which is the earliest it can
 * land while still leaving two tiers of advice behind it.
 */
export const LEVELS = Object.freeze({
  /** No listeners at all. The same as `budget: 0`, spelled the other way. */
  off: { tiers: [], maskRatio: null },
  /** One reminder, late, and the tool table is never touched. */
  light: {
    tiers: [
      {
        ratio: 0.7,
        text:
          "Token thrift: about 70% of this session's budget is spent. Steadier habits from here: "
          + "read a targeted range instead of a whole file, batch independent tool calls into one "
          + "step, and skip re-reading what an earlier result already established.",
      },
    ],
    maskRatio: null,
  },
  /** The default: advice in three steps, masking once the budget is nearly gone. */
  standard: { tiers: DEFAULT_TIERS, maskRatio: 0.9 },
  /** Lean early and hard, for a session that has to fit in a small budget. */
  strict: {
    tiers: [
      {
        ratio: 0.25,
        text:
          "Token thrift: a quarter of this session's budget is gone. Plan the rest before spending "
          + "it: decide what the answer needs, then read only that. One batched step beats four "
          + "small ones, and a range beats a whole file.",
      },
      {
        ratio: 0.5,
        text:
          "Token thrift: half the budget is spent. Start converging. Finish what is already in "
          + "flight before opening another line of investigation, and prefer the answer you can "
          + "give now over the one that needs three more reads.",
      },
      {
        ratio: 0.7,
        text:
          "Token thrift: about 70% is spent. Stop exploring. Do not start subagents, workflows or "
          + "background fan-out — each one re-reads this conversation from the top.",
      },
      {
        ratio: 0.85,
        text:
          "Token thrift: about 85% is spent. Wrap up: say what is done, what is verified, and what "
          + "is left, in as few words as it takes.",
      },
    ],
    maskRatio: 0.55,
  },
});

export const Config = z.object({
  /**
   * The Token budget this coach watches, in Tokens. `0` disables it: with no budget there
   * is no ratio to cross, and the plugin does nothing at all.
   *
   * Deliberately a plain number rather than a shared account: this plugin only needs to
   * know how full the glass is, and keeping its own copy means it works whether or not a
   * budget service is present.
   */
  budget: z.number().default(0),
  /**
   * How hard to lean.
   *
   * One name is easier to get right than three numbers, because the advice and the
   * masking threshold have to move together: tiers that fire long before the mask either
   * nag without effect, and a mask that lands before any advice has been given is a
   * surprise. `tiers` and `maskRatio` still override this when set.
   */
  level: z.union([z.const("off"), z.const("light"), z.const("standard"), z.const("strict")]).default("standard"),
  /** Ratios of `budget` at which to speak, paired with what to say. Empty uses `level`'s own. */
  tiers: z.array(z.object({ ratio: z.number(), text: z.string() })).default([]),
  /**
   * Tools to remove from the agent's tool table once the masking threshold is crossed.
   *
   * Empty means never mask anything, which is the safe choice for a session whose whole
   * job is fan-out.
   */
  maskTools: z.array(z.string()).default(DEFAULT_MASKED),
  /** Mask as soon as this ratio is crossed; `0` uses `level`'s own threshold. */
  maskRatio: z.number().default(0),
  /**
   * Count cached Tokens toward the spend.
   *
   * On by default because cache reads are billed and because a cache-heavy session is
   * exactly the one whose surface keeps growing. Turn it off to count only fresh input
   * and output.
   */
  countCache: z.boolean().default(true),
  /** How many reminders one session may receive, as a backstop against a bad ratio list. */
  maxReminders: z.number().default(6),
});

/**
 * Tokens in one usage record, by the same rule the rest of the harness uses.
 *
 * `reasoningTokens` is deliberately absent: it is already inside `outputTokens`, and adding
 * it again would inflate every reading by the thinking budget.
 *
 * @param usage - a provider usage record, or undefined when none has arrived yet.
 * @param countCache - whether cached Tokens count toward the total.
 * @returns the Token total this record represents.
 */
export function usageTokens(usage, countCache) {
  if (usage === null || usage === undefined || typeof usage !== "object") return 0;
  const n = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  const fresh = n(usage.inputTokens) + n(usage.outputTokens);
  const cached = countCache ? n(usage.cacheReadTokens) + n(usage.cacheWriteTokens) : 0;
  return fresh + cached;
}

/**
 * Read the cumulative Token total for one session.
 *
 * The `tokenUsage` projection is the harness's own accounting, so it is preferred over
 * anything this plugin could keep itself. It is read through a guard because a projection
 * may not exist yet on the very first step, and a missing reading is "0 spent so far",
 * not an error worth failing a tool call over.
 *
 * @param ctx - plugin context.
 * @param session - the session to read.
 * @param countCache - whether cached Tokens count.
 * @returns the spent Token total, or 0 when nothing has been recorded.
 */
export function spentTokens(ctx, session, countCache) {
  // `ctx.get`, not `ctx.sessionProjections`.
  //
  // Reading an undeclared service off the context does not hand back undefined in
  // Cordis — it *throws*: `cannot get property "sessionProjections" without inject`.
  // This line used to do exactly that, and because it runs inside `tools/post-execute`,
  // one missing declaration took down every tool call in the session. The guard on the
  // next line never got the chance to run. `ctx.get` is the documented way to reach a
  // service you have not injected, and it answers undefined when there is none — which
  // is the behaviour this function was written to expect.
  const projections = ctx.get("sessionProjections");
  if (projections === undefined || typeof projections.snapshot !== "function" || session === undefined) return 0;
  let snapshot;
  try {
    snapshot = projections.snapshot(session, ["tokenUsage"]);
  } catch {
    return 0;
  }
  const totals = snapshot?.tokenUsage?.totals;
  if (totals === null || totals === undefined) return 0;
  // A projection may report either one record or a bucket per turn; sum whatever numbers
  // are there rather than assuming a shape this plugin does not own.
  let sum = 0;
  const walk = (value) => {
    if (typeof value === "number") { sum += Number.isFinite(value) && value > 0 ? value : 0; return; }
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (value !== null && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        // `last` is the most recent call, already counted inside the totals.
        if (key === "last" || key === "turn" || key === "step") continue;
        if (/Token(s)?$/u.test(key) && !/reasoning/iu.test(key)) walk(item);
      }
    }
  };
  walk(totals);
  return sum;
}

/**
 * Turn a Tier into the message the model will read.
 *
 * @param reminder - the context entry to prepend.
 * @param downstream - whatever the rest of the tool pipeline produced.
 * @returns the same decision with this reminder in front of the other contexts.
 */
function prependContext(reminder, downstream) {
  return [reminder, ...(downstream ?? [])];
}

/** The shape every injected reminder uses. Identical to the harness's own guards. */
function notice(text, summary) {
  return {
    content: [{ type: "text", text }],
    role: "user",
    source: { ...PLUGIN_SOURCE, form: "notice", summary },
  };
}

/**
 * Install the coach.
 *
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
  const budget = Number.isFinite(config.budget) ? config.budget : 0;
  // Off is off: no budget means no ratios, no reminders, no masking, no listeners that
  // could surprise someone who mounted the plugin and left it at its defaults.
  if (budget <= 0) return;

  const preset = LEVELS[config.level] ?? LEVELS.standard;
  const wanted = Array.isArray(config.tiers) && config.tiers.length > 0 ? config.tiers : preset.tiers;
  const tiers = [...wanted]
    .filter((tier) => Number.isFinite(tier.ratio) && tier.ratio > 0 && typeof tier.text === "string" && tier.text !== "")
    .sort((a, b) => a.ratio - b.ratio);
  // `level: "off"`, or a custom tier list that filtered down to nothing.
  if (tiers.length === 0) return;

  // `Infinity` for "never": `ratio >= Infinity` is false for every real ratio, so the
  // mask simply never fires, and the comparison below stays a single expression.
  const maskRatio = Number.isFinite(config.maskRatio) && config.maskRatio > 0
    ? config.maskRatio
    : (preset.maskRatio ?? Number.POSITIVE_INFINITY);

  /** Per-agent progress. A WeakMap so a finished agent's record goes away with it. */
  const spoken = new WeakMap();

  const stateOf = (agent) => {
    let state = spoken.get(agent);
    if (state === undefined) {
      state = { delivered: new Set(), masked: false, reminders: 0 };
      spoken.set(agent, state);
    }
    return state;
  };

  /**
   * What this tool result should carry, and whether it is time to mask.
   *
   * Split out from the listener so it can be wrapped. Everything in here runs inside the
   * tool pipeline, and a throw from it fails the tool call itself — which is not
   * hypothetical: an undeclared service read in this plugin once took down every tool in
   * a session, and the error surfaced as if the *tools* were broken.
   */
  function advise(exec, downstream) {
    const agent = exec?.agent;
    if (agent === undefined) return downstream;

    const spent = spentTokens(ctx, exec.session ?? agent.session ?? agent, config.countCache);
    const ratio = spent / budget;
    const state = stateOf(agent);
    if (state.reminders >= config.maxReminders) return downstream;

    // Masking first: it changes what the next step may call, and doing it after a reminder
    // would let one more fan-out start before the mask lands.
    if (!state.masked && config.maskTools.length > 0 && ratio >= maskRatio) {
      state.masked = true;
      try {
        // Scoped to this agent, so a sibling working on something else keeps its tools.
        agent.ctx?.tools?.restrict?.({ deny: config.maskTools });
      } catch {
        // A host without the restriction seam still gets the advice below; refusing to
        // continue over an unavailable optimisation would be the wrong trade.
        state.masked = false;
      }
    }

    const due = tiers.filter((tier) => ratio >= tier.ratio && !state.delivered.has(tier.ratio));
    if (due.length === 0) return downstream;
    for (const tier of due) state.delivered.add(tier.ratio);
    state.reminders += 1;

    // One message even when several tiers came due at once: spending the remaining budget
    // on three near-identical reminders would be its own joke.
    const text = due.map((tier) => tier.text).join("\n\n");
    const percent = Math.round(ratio * 100);
    return {
      ...downstream,
      additionalContexts: prependContext(notice(text, `token-thrift ${String(percent)}%`), downstream?.additionalContexts),
    };
  }

  ctx.on("tools/post-execute", async (exec, _result, next) => {
    const downstream = await next();
    try {
      return advise(exec, downstream);
    } catch {
      // A coach that cannot count its Tokens is worth nothing. A coach that breaks the
      // tools it was mounted to make cheaper is worth less than nothing, so nothing this
      // plugin does may ever fail a tool call. Degrading to "said nothing this time" is
      // always the right trade.
      return downstream;
    }
  });
}
