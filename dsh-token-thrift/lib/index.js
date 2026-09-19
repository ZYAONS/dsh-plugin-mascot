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

import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import z from "@deepseek-ai/schemastery";

/** The plugin's registry id; also the label stamped on every reminder it injects. */
export const name = "token-thrift";

/** The console lives beside `lib/`, so a `file:`-mounted plugin finds its own folder. */
const CONSOLE_ROOT = resolve(dirname(dirname(fileURLToPath(import.meta.url))), "console");

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

/** Where the platform lives. */
export const STATE_PATH = "/dsh-token-thrift";

/** How many sessions the platform keeps. A GUI shows one; the rest are for looking back. */
const REPORT_LIMIT = 8;

/** What the console serves, by extension. */
const CONSOLE_MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
});

/** A loopback Host is the fallback authority when no Connection service is composed. */
const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/iu;

/**
 * Decide whether a request may read or change the coach.
 *
 * A composed web host routes every browser request through Connection, whose signed
 * cookie is the authority; when that service is absent this falls back to demanding a
 * loopback Host header, which is strictly narrower than the web server's default bind.
 * Same rule as the mascot's, deliberately: two plugins on one host should not disagree
 * about who is allowed in.
 *
 * @param ctx - plugin context.
 * @param req - incoming request.
 * @returns true when the request may proceed.
 */
function authorized(ctx, req) {
  const connection = ctx.get("connection");
  if (connection !== undefined && typeof connection.isAuthenticated === "function") {
    return connection.isAuthenticated(req) === true;
  }
  const host = req.headers?.host;
  return typeof host === "string" && LOOPBACK_HOST.test(host);
}

/**
 * The coach's effective settings, config first and console overrides on top.
 *
 * Rebuilt on demand rather than computed once at load, because the console changes it
 * while the coach is running: a coach that only reads its level at startup would need a
 * restart to be told anything, which is not a platform.
 *
 * @param config - validated {@link Config}.
 * @param override - `{ level, budget }`, either of which may be null.
 */
function settingsFor(config, override) {
  const level = override.level ?? config.level;
  const budget = override.budget ?? (Number.isFinite(config.budget) ? config.budget : 0);
  const preset = LEVELS[level] ?? LEVELS.standard;
  const wanted = Array.isArray(config.tiers) && config.tiers.length > 0 ? config.tiers : preset.tiers;
  const tiers = [...wanted]
    .filter((tier) => Number.isFinite(tier.ratio) && tier.ratio > 0 && typeof tier.text === "string" && tier.text !== "")
    .sort((a, b) => a.ratio - b.ratio);
  // `Infinity` for "never": `ratio >= Infinity` is false for every real ratio, so the
  // mask simply never fires, and the comparison below stays a single expression.
  const fallback = preset.maskRatio ?? Number.POSITIVE_INFINITY;
  return {
    level,
    budget,
    tiers,
    maskRatio: Number.isFinite(config.maskRatio) && config.maskRatio > 0 ? config.maskRatio : fallback,
    maskTools: config.maskTools,
    countCache: config.countCache,
    maxReminders: config.maxReminders,
    enabled: budget > 0 && tiers.length > 0,
  };
}

/**
 * Serve the state the panel and the console read, and the console's own files.
 *
 * The coach's state lives in a `WeakMap` keyed on the agent, which is the right shape for
 * the coach and useless to anything else — nothing outside this module can reach it. So
 * each step also writes a plain snapshot into a small bounded map keyed by session id.
 *
 * Registered even when the coach is off: a console that says "disabled, budget is 0" — and
 * can turn it on — is worth more than one that looks broken.
 *
 * @param ctx - plugin context.
 * @param deps - `{ settings, override, publish, reset }`.
 * @returns nothing; the routes are owned by the plugin's effect scope.
 */
function servePlatform(ctx, deps) {
  const webServer = ctx.get("webServer");
  if (webServer === undefined || typeof webServer.register !== "function") return;

  const json = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(body);
  };

  /** Read a JSON body, capped so a stray request cannot be used to eat memory. */
  const readBody = (req) => new Promise((resolve) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > 4096) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(text.length === 0 ? {} : JSON.parse(text));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });

  const serveConsole = async (res, name) => {
    const file = name === "" || name === "/" ? "index.html" : name.replace(/^\/+/u, "");
    const full = resolve(CONSOLE_ROOT, file);
    // Only the console's own files, whatever the URL said.
    if (!full.startsWith(CONSOLE_ROOT)) {
      json(res, 403, { ok: false, error: "forbidden", message: "控制台路径越界" });
      return;
    }
    const type = CONSOLE_MIME[extname(full)];
    if (type === undefined) {
      json(res, 404, { ok: false, error: "not_found", message: `不支持的控制台资源：${file}` });
      return;
    }
    try {
      const body = await readFile(full);
      res.writeHead(200, { "content-type": type, "content-length": body.length, "cache-control": "no-store" });
      res.end(body);
    } catch {
      json(res, 404, {
        ok: false,
        error: "no_console",
        message: "控制台文件不在这个安装里——它属于源码仓库，不属于运行时",
      });
    }
  };

  const handler = async (req, res) => {
    const url = new URL(String(req.url ?? "/"), "http://localhost");
    const path = url.pathname.replace(/\/+$/u, "");
    const method = String(req.method ?? "GET").toUpperCase();

    // The console is served from this same origin, which is the whole point: the panel
    // and the page then read the state without a cross-origin request.
    if (path === `${STATE_PATH}/console` || path.startsWith(`${STATE_PATH}/console/`)) {
      if (!authorized(ctx, req)) {
        json(res, 401, { ok: false, error: "unauthorized", message: "需要 DSH Web 会话认证" });
        return;
      }
      await serveConsole(res, path.slice(`${STATE_PATH}/console`.length));
      return;
    }

    if (!authorized(ctx, req)) {
      json(res, 401, { ok: false, error: "unauthorized", message: "需要 DSH Web 会话认证" });
      return;
    }

    if (path === `${STATE_PATH}/api/state`) {
      if (method !== "GET") {
        json(res, 405, { ok: false, error: "method_not_allowed", message: "只支持 GET" });
        return;
      }
      json(res, 200, { ok: true, ...deps.snapshot() });
      return;
    }

    if (path === `${STATE_PATH}/api/settings`) {
      if (method !== "POST") {
        json(res, 405, { ok: false, error: "method_not_allowed", message: "只支持 POST" });
        return;
      }
      const body = await readBody(req);
      if (body === undefined) {
        json(res, 400, { ok: false, error: "bad_json", message: "请求体不是 JSON" });
        return;
      }
      const applied = deps.applySettings(body);
      if (applied.error !== undefined) {
        json(res, 400, { ok: false, ...applied });
        return;
      }
      json(res, 200, { ok: true, ...deps.snapshot() });
      return;
    }

    if (path === `${STATE_PATH}/api/reset`) {
      if (method !== "POST") {
        json(res, 405, { ok: false, error: "method_not_allowed", message: "只支持 POST" });
        return;
      }
      const body = (await readBody(req)) ?? {};
      deps.reset(typeof body.sessionId === "string" ? body.sessionId : undefined);
      json(res, 200, { ok: true, ...deps.snapshot() });
      return;
    }

    json(res, 404, { ok: false, error: "not_found", message: `未知路由 ${path}` });
  };

  try {
    ctx.effect(() => webServer.register({ kind: "prefix", path: STATE_PATH, handler }));
  } catch {
    // No route seam, or the context is already disposed. The coach is unaffected: this
    // whole function exists only to draw and drive it.
  }
}

/**
 * Install the coach.
 *
 * @param ctx - plugin context; listeners are scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx, config) {
  /** Console overrides on top of the config. In memory only: a restart restores the file. */
  const override = { level: null, budget: null };
  let settings = settingsFor(config, override);

  /** session id -> the last snapshot for it. Insertion-ordered, oldest evicted first. */
  const reports = new Map();

  /** Per-agent progress. A WeakMap so a finished agent's record goes away with it. */
  const spoken = new WeakMap();

  /**
   * The same records, reachable by iteration.
   *
   * A `WeakMap` cannot be walked — that is what makes it the right container for the coach
   * — but the console's reset button has to find a session's record, so the ids are kept
   * beside it. Both maps hold the agent weakly, so a finished agent still goes away; only
   * the small state object outlives it.
   */
  const spokenKeys = new Map();

  const stateOf = (agent) => {
    let state = spoken.get(agent);
    if (state === undefined) {
      // `firedAt` is for the platform only: the coach itself just needs to know that a
      // tier has been delivered, but "when" is what makes a timeline readable.
      state = { delivered: new Set(), firedAt: new Map(), masked: false, reminders: 0 };
      spoken.set(agent, state);
    }
    return state;
  };

  const publish = (sessionId, report) => {
    reports.delete(sessionId);
    reports.set(sessionId, report);
    while (reports.size > REPORT_LIMIT) reports.delete(reports.keys().next().value);
  };

  /** Everything the panel and the console read, in one shape. */
  const snapshot = () => ({
    enabled: settings.enabled,
    budget: settings.budget,
    level: settings.level,
    // `Infinity` does not survive JSON; null is the wire's word for "never".
    maskRatio: Number.isFinite(settings.maskRatio) ? settings.maskRatio : null,
    tiers: settings.tiers.map((tier) => tier.ratio),
    maskTools: settings.maskTools,
    countCache: settings.countCache,
    maxReminders: settings.maxReminders,
    // What the console needs to draw its own controls: the file's values, and whether
    // what you are looking at is the file or something someone clicked.
    configured: { budget: config.budget, level: config.level },
    overridden: { budget: override.budget !== null, level: override.level !== null },
    levels: Object.keys(LEVELS),
    // The ratio is recomputed here rather than taken from the stored report, because the
    // console can change the budget between two tool calls. Reporting the stale one made
    // changing the budget look like it had done nothing at all — the one interaction the
    // page exists for. `spent` and `budget` are both known, so the ratio is a fact.
    reports: [...reports.values()].reverse().map((report) => ({
      ...report,
      ratio: settings.budget > 0 ? Math.round((report.spent / settings.budget) * 10000) / 10000 : 0,
    })),
  });

  /**
   * Turn the coach on or off to match the current settings.
   *
   * `ctx.on` is called and disposed here rather than once at load, because the console can
   * change the budget while the session is running: switching the coach on should not need
   * a restart, and leaving it off should still cost nothing. The original reason for the
   * early return survives — a disabled plugin registers no listeners.
   */
  let stopListening = null;
  const sync = () => {
    if (settings.enabled && stopListening === null) {
      stopListening = ctx.on("tools/post-execute", listener);
    } else if (!settings.enabled && stopListening !== null) {
      stopListening();
      stopListening = null;
    }
  };

  /** Apply a console change and make the running coach match it. */
  const applySettings = (body) => {
    if (body.level !== undefined) {
      if (body.level === null) override.level = null;
      else if (typeof body.level === "string" && LEVELS[body.level] !== undefined) override.level = body.level;
      else return { error: "bad_level", message: `没有这个档位：${String(body.level)}` };
    }
    if (body.budget !== undefined) {
      if (body.budget === null) override.budget = null;
      else if (typeof body.budget === "number" && Number.isFinite(body.budget) && body.budget >= 0) override.budget = body.budget;
      else return { error: "bad_budget", message: "budget 必须是非负有限数，或 null 表示恢复配置" };
    }
    settings = settingsFor(config, override);
    sync();
    return {};
  };

  /**
   * Forget what a session has been told.
   *
   * The tiers fire once per session by design, so without this there is no way to watch
   * the coach work twice — and a platform you cannot re-run is a screenshot.
   */
  const reset = (sessionId) => {
    if (sessionId === undefined) {
      spokenKeys.clear();
      reports.clear();
      return;
    }
    for (const [agent, state] of spokenKeys) {
      if (state.sessionId === sessionId) {
        state.delivered.clear();
        state.firedAt.clear();
        state.masked = false;
        state.reminders = 0;
      }
    }
    reports.delete(sessionId);
  };

  /**
   * The agents seen so far, so `reset` can reach them.
   */
  const knownState = (agent, sessionId) => {
    const state = stateOf(agent);
    state.sessionId = sessionId;
    if (!spokenKeys.has(agent)) spokenKeys.set(agent, state);
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

    const spent = spentTokens(ctx, exec.session ?? agent.session ?? agent, settings.countCache);
    const ratio = spent / settings.budget;
    // The id the GUI can match on. Falls back rather than throwing: a host without a
    // session id still gets a working coach, just an unlabelled row in the platform.
    const sessionId = String(exec?.session?.id ?? agent?.session?.id ?? agent?.id ?? "current");
    const state = knownState(agent, sessionId);

    // Masking first: it changes what the next step may call, and doing it after a reminder
    // would let one more fan-out start before the mask lands.
    if (!state.masked && settings.maskTools.length > 0 && ratio >= settings.maskRatio) {
      state.masked = true;
      try {
        // Scoped to this agent, so a sibling working on something else keeps its tools.
        agent.ctx?.tools?.restrict?.({ deny: settings.maskTools });
      } catch {
        // A host without the restriction seam still gets the advice below; refusing to
        // continue over an unavailable optimisation would be the wrong trade.
        state.masked = false;
      }
    }

    // The cap is checked here rather than with an early return above, so that a capped
    // session still reports where it got to.
    const due = state.reminders >= settings.maxReminders
      ? []
      : settings.tiers.filter((tier) => ratio >= tier.ratio && !state.delivered.has(tier.ratio));
    for (const tier of due) {
      state.delivered.add(tier.ratio);
      state.firedAt.set(tier.ratio, Date.now());
    }
    if (due.length > 0) state.reminders += 1;

    publish(sessionId, {
      sessionId,
      at: Date.now(),
      spent,
      ratio: Math.round(ratio * 10000) / 10000,
      masked: state.masked,
      reminders: state.reminders,
      // The tier list *this report was measured against*, not whatever is configured now.
      // The console can change the level mid-session, and drawing a report's fired marks
      // against a list it never saw claims tiers fired that never did.
      tiers: settings.tiers.map((tier) => tier.ratio),
      // Every configured tier, fired or not, so the GUI can draw what is still ahead.
      fired: settings.tiers.map((tier) => ({ ratio: tier.ratio, at: state.firedAt.get(tier.ratio) ?? null })),
    });

    if (due.length === 0) return downstream;

    // One message even when several tiers came due at once: spending the remaining budget
    // on three near-identical reminders would be its own joke.
    const text = due.map((tier) => tier.text).join("\n\n");
    const percent = Math.round(ratio * 100);
    return {
      ...downstream,
      additionalContexts: prependContext(notice(text, `token-thrift ${String(percent)}%`), downstream?.additionalContexts),
    };
  }

  /** The hook, wrapped so nothing it does can fail a tool call. */
  async function listener(exec, _result, next) {
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
  }

  // The platform is served whatever the coach is doing, so it can be turned on from there.
  servePlatform(ctx, { snapshot, applySettings, reset });
  sync();
}

