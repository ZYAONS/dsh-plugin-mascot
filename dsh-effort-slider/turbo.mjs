/**
 * turbo.mjs —— ULTRA / LIGHTNING 的宿主半边：状态、路由、舰队令牌计量、策略注入。
 *
 * 它把四个模块接起来：
 *   policy.mjs   → 英文策略正文（组合现成轮子，见该文件头注释）
 *   inject.mjs   → agent/pre-step 按会话精确注入（变了才注入）
 *   metrics.mjs  → 纯函数式的 tok/s 统计（按窗口、CJK 感知）
 *   本文件        → 会话状态持久化 + `/turbo` 路由 + 子代理成员集维护
 *
 * 设计纪律（每条都有出处）：
 *  1. **绝不全局注入**：注入按 `agent.id` 精确过滤，子代理与其它会话不受影响。
 *  2. **变了才注入**：策略文本只在"应当生效的文本发生变化"时进历史，
 *     与 `dsh-agent-loop` 自己的 `RuntimeContextProjection.retained` 同款做法。
 *  3. **读数绝不作假**：拿不到流数据就返回 0；宿主任何异常都退化成"不注入、读数为 0"，
 *     绝不让 `/turbo` 路由把插件带崩。
 *  4. 只统计**被跟踪会话的后代**（`origin === 'subagent'` 的会话），
 *     不把别的会话（例如长驻的微信会话）算进来。
 */

import { policyText } from "./policy.mjs";
import { createFleetMeter } from "./metrics.mjs";
import { createPolicyInjector } from "./inject.mjs";

export const TURBO_ENDPOINT = "/plugins/dsh-effort-slider/turbo";

/** 模式关闭时补的一句，避免历史里那条策略继续生效（引擎"变了才注入"的同款用法）。 */
export const OFF_NOTICE =
  "Ultra Mode and Lightning Mode are now OFF for this session. Disregard any earlier policy text from them in this conversation.";

const MAX_TRACKED_SESSIONS = 40;   // 状态文件是给人看的，别无限长
const MAX_MEMBERS = 96;            // 单次统计的舰队规模上限
const MAX_SESSION_HEADERS = 2048;  // 只保存小型祖先索引，不保留 Session / 会话历史
const MAX_ANCESTOR_DEPTH = 128;    // 异常祖先链不能阻塞宿主事件分发

function isSessionId(value) {
  return typeof value === "string" && /^session-[A-Za-z0-9._-]{4,120}$/.test(value);
}

/**
 * @param {object} ctx  宿主 Cordis 上下文
 * @param {object} options
 *   { log, readSessions: () => Record<string,{lightning?:boolean,ultra?:boolean}>,
 *     writeSessions: (sessions) => Promise<boolean>, readJson, endpoint? }
 * @returns {{ dispose: () => void, sample: () => object, stateOf: (id:string) => object }}
 */
export function createTurbo(ctx, options = {}) {
  const log = typeof options.log === "function" ? options.log : () => {};
  const readSessions = typeof options.readSessions === "function" ? options.readSessions : () => ({});
  const writeSessions = typeof options.writeSessions === "function" ? options.writeSessions : async () => false;
  const readJson = typeof options.readJson === "function" ? options.readJson : null;
  const endpoint = typeof options.endpoint === "string" ? options.endpoint : TURBO_ENDPOINT;

  const disposers = [];
  let sessions = {};
  let tracked = new Set();          // 需要统计子代理的会话（当前有模式开的）
  const everOn = new Set();         // 曾经开过（用于补"模式已关闭"那句）
  let members = new Set();
  const sessionHeaders = new Map();
  let disposed = false;

  const meter = createFleetMeter({});

  try {
    sessions = readSessions() ?? {};
  } catch (error) {
    log(`读取 turbo 状态失败，按空状态处理：${String(error)}`);
    sessions = {};
  }

  function stateOf(sessionId) {
    const raw = sessions[sessionId];
    return { lightning: raw?.lightning === true, ultra: raw?.ultra === true };
  }

  function anyOn(sessionId) {
    const state = stateOf(sessionId);
    return state.lightning || state.ultra;
  }

  /** 本会话"当前应当生效"的文本（去重交给 inject.mjs）。 */
  function activeText(sessionId) {
    try {
      if (anyOn(sessionId)) {
        everOn.add(sessionId);
        return policyText(stateOf(sessionId));
      }
      return everOn.has(sessionId) ? OFF_NOTICE : "";
    } catch (error) {
      log(`计算策略文本失败：${String(error)}`);
      return "";
    }
  }

  /** 只给界面看"现在注入了什么"，不触发 OFF 提示的落盘语义。 */
  function currentPolicy(sessionId) {
    try {
      return anyOn(sessionId) ? policyText(stateOf(sessionId)) : "";
    } catch {
      return "";
    }
  }

  const injector = createPolicyInjector(ctx, { log, resolve: activeText });

  /* ── 1. 流式计量：订阅所有 agent 的 chunk，只留成员 ───────────────────── */

  try {
    const off = ctx.on("agent/assistant-stream", (payload) => {
      try {
        if (disposed) return;
        const frame = payload?.frame;
        if (frame?.type !== "chunk") return;                       // 只要 chunk 帧
        const agentId = payload?.agent?.id;
        if (typeof agentId !== "string") return;
        // 服务暂不可用 / 插件晚加载时，可从流事件补齐当前 Session 的元数据。
        // 已收到 disposed 的会话不能由迟到的流帧重新加入。
        if (!sessionHeaders.has(agentId) && tracked.size > 0) {
          const live = liveSession(agentId);
          // 索引淘汰后也以宿主的 live store 为准；流载荷可能仍持有已退场对象。
          const session = live === undefined ? payload.agent.session : live;
          if (rememberSession(session)) refreshMembers();
        }
        if (!members.has(agentId)) return;
        meter.ingest(agentId, frame.chunk, typeof frame.time === "number" ? frame.time : undefined);
      } catch { /* 计量异常绝不影响会话 */ }
    });
    if (typeof off === "function") disposers.push(off);
  } catch (error) {
    log(`订阅 assistant-stream 失败（tok/s 读数将恒为 0）：${String(error)}`);
  }

  /* ── 2. 成员集：被跟踪会话的后代 ─────────────────────────────────────── */

  function liveSession(id) {
    try {
      const store = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
      if (typeof store?.get !== "function") return undefined;
      try { return store.get(id) ?? null; } catch { return null; }
    } catch { return undefined; }
  }

  function rememberSession(payload) {
    const session = payload?.session ?? payload;
    if (typeof session?.id !== "string" || !session.header) return false;
    const header = session.header;
    sessionHeaders.set(session.id, {
      id: session.id,
      parent: typeof header.parentSession === "string" ? header.parentSession : null,
      subagent: header.origin === "subagent",
      live: true,
    });
    while (sessionHeaders.size > MAX_SESSION_HEADERS) {
      sessionHeaders.delete(sessionHeaders.keys().next().value);
    }
    return true;
  }

  function belongsToTrackedRoot(record) {
    if (!record.live || !record.subagent) return false;
    const seen = new Set([record.id]);
    let parent = record.parent;
    for (let depth = 0; parent && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
      if (seen.has(parent)) return false;
      if (tracked.has(parent)) return true;
      seen.add(parent);
      let ancestor = sessionHeaders.get(parent);
      if (!ancestor) {
        rememberSession(liveSession(parent)); // 仅查询内存 SessionStore，不读持久化记录
        ancestor = sessionHeaders.get(parent);
      }
      if (!ancestor) return false;
      parent = ancestor.parent;
    }
    return false;
  }

  function refreshMembers() {
    if (disposed) return;
    try {
      tracked = new Set(Object.keys(sessions).filter((id) => anyOn(id)));
      const next = new Set();
      // 固定快照：补齐祖先时可能触发索引淘汰，不能延长迭代。
      for (const record of tracked.size > 0 ? [...sessionHeaders.values()] : []) {
        if (next.size >= MAX_MEMBERS) break;
        if (belongsToTrackedRoot(record)) next.add(record.id);
      }
      members = next;
      meter.setMembers(members);
    } catch (error) {
      log(`刷新子代理成员集失败（本次按空集处理）：${String(error)}`);
      members = new Set();
      try { meter.setMembers(members); } catch { /* 忽略 */ }
    }
  }

  function subscribe(name, handler) {
    try {
      const off = ctx.on(name, (...args) => {
        if (disposed) return;
        try { handler(...args); } catch { /* 计量不能影响宿主生命周期 */ }
      });
      if (typeof off === "function") disposers.push(off);
    } catch (error) { log(`订阅 ${name} 失败：${String(error)}`); }
  }

  subscribe("session/created", (session) => {
    if (rememberSession(session)) refreshMembers();
  });
  subscribe("session/disposed", (payload) => {
    const session = payload?.session ?? payload;
    const record = sessionHeaders.get(session?.id);
    if (!record) return;
    // 父会话先退场时仍保留小型祖先链，让继续运行的孙代理可归属原会话。
    record.live = false;
    refreshMembers();
  });

  try {
    const store = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
    const live = typeof store?.list === "function" ? store.list() : [];
    if (Array.isArray(live)) for (const session of live) rememberSession(session);
  } catch (error) {
    log(`读取运行中会话失败（等待生命周期 / 流事件）：${String(error)}`);
  }
  refreshMembers();

  /* ── 3. 路由 ─────────────────────────────────────────────────────────── */

  try {
    const disposeRoute = ctx.webServer.register({
      kind: "exact",
      path: endpoint,
      handler: async (request, response) => {
        const headers = {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        };
        try {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (request.method === "GET") {
            const raw = url.searchParams.get("session");
            const sessionId = isSessionId(raw) ? raw : null;
            const sample = meter.sample();
            response.writeHead(200, headers);
            response.end(JSON.stringify({
              ok: true,
              session: sessionId,
              lightning: sessionId ? stateOf(sessionId).lightning : false,
              ultra: sessionId ? stateOf(sessionId).ultra : false,
              rate: sample.rate,
              gen: sample.gen,
              agents: sample.agents,
              generating: sample.generating,
              total: sample.total,
              policy: sessionId ? currentPolicy(sessionId) : "",
              stamp: Date.now(),
            }));
            return;
          }
          if (request.method === "PATCH" || request.method === "POST") {
            if (readJson === null) {
              response.writeHead(503, headers);
              response.end(JSON.stringify({ ok: false, error: "body-reader-unavailable" }));
              return;
            }
            const body = await readJson(request, response);
            if (!body.ok) {
              if (!response.headersSent) {
                response.writeHead(400, headers);
                response.end(JSON.stringify({ ok: false, error: body.tooLarge ? "body-too-large" : "invalid-body" }));
              }
              return;
            }
            const payload = body.value ?? {};
            const sessionId = payload.session;
            if (!isSessionId(sessionId)) {
              response.writeHead(400, headers);
              response.end(JSON.stringify({ ok: false, error: "invalid-session" }));
              return;
            }
            const previous = stateOf(sessionId);
            const nextState = {
              lightning: typeof payload.lightning === "boolean" ? payload.lightning : previous.lightning,
              ultra: typeof payload.ultra === "boolean" ? payload.ultra : previous.ultra,
            };
            sessions[sessionId] = nextState;
            // 键太多就丢最早的（对象键顺序 = 插入顺序）
            const keys = Object.keys(sessions);
            if (keys.length > MAX_TRACKED_SESSIONS) {
              for (const key of keys.slice(0, keys.length - MAX_TRACKED_SESSIONS)) delete sessions[key];
            }
            refreshMembers();
            const persisted = await writeSessions(sessions);
            log(`turbo 状态更新：lightning=${nextState.lightning} ultra=${nextState.ultra}（持久化：${persisted ? "成功" : "失败"}）`);
            response.writeHead(200, headers);
            response.end(JSON.stringify({ ok: true, ...nextState, persisted }));
            return;
          }
          response.writeHead(405, { ...headers, Allow: "GET, PATCH, POST" });
          response.end();
        } catch (error) {
          log(`/turbo 端点异常：${String(error)}`);
          try {
            if (!response.headersSent) response.writeHead(500, headers);
            response.end(JSON.stringify({ ok: false, error: "internal" }));
          } catch { /* 连接可能已断 */ }
        }
      },
    });
    if (typeof disposeRoute === "function") disposers.push(disposeRoute);
  } catch (error) {
    log(`注册 /turbo 路由失败（界面上的闪电与读数将不可用）：${String(error)}`);
  }

  log(`turbo 就绪（端点 ${endpoint}；注入器：${injector ? "已挂载" : "不可用"}）`);

  return {
    sample: () => meter.sample(),
    stateOf,
    dispose() {
      if (disposed) return;
      disposed = true;
      try { injector.dispose(); } catch { /* 忽略 */ }
      for (const dispose of disposers.splice(0)) {
        try { dispose?.(); } catch { /* 卸载异常不冒泡 */ }
      }
      sessionHeaders.clear();
      tracked.clear();
      members.clear();
      everOn.clear();
      meter.dispose();
    },
  };
}

export default { createTurbo, TURBO_ENDPOINT, OFF_NOTICE };
