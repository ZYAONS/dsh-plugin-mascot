/**
 * dsh-effort-slider — 宿主半边
 *
 * 设计原则（每条都由真实事故或独立审查换来）：
 *  A. **绝不抛出、也绝不依赖任何可能缺失的东西**：`apply()` 里同步抛错会让该 entry 加载失败；
 *     更严重的是 `inject` 里声明了从未被 provide 的服务 → fiber 停在 PENDING →
 *     启动器 `assertEntriesActivated` 抛错 → **整棵插件树被丢弃**。因此：
 *     · `inject` 只声明**确定存在**的服务（webServer）；
 *     · `logger` **不写进 inject**（它是 Context 内建，写进去反而有 PENDING 风险）；
 *     · 连 catch 里的日志都不能依赖 logger，否则二次异常会掩盖原始错误。
 *  B. **不依赖 schemastery / settings**：手写普通对象当 schema 会在 `Schema.resolve` 同步抛错，
 *     而 schemastery 从插件目录又解析不到（实测 MODULE_NOT_FOUND）。故偏好落纯 JSON 文件。
 *  C. **可观测且抗假阳性**：客户端心跳带**每次启动生成的 nonce**，旧页面/旧启动的上报一律忽略；
 *     失败上报（status:"error"）不会被当成成功；判定只在"确实观测到"时才下结论。
 *  D. **不在启动关键路径里执行客户端产物**：产物审计改为**静态检查**（读文件、查标志位），
 *     执行式深检只在显式设置 `EFFORT_SLIDER_DEEP_AUDIT=1` 时做，且失败也不阻断。
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createTurbo, TURBO_ENDPOINT } from "./turbo.mjs";

const PACKAGE_ID = "dsh-effort-slider";
const ENDPOINT = "/plugins/dsh-effort-slider/preferences";
/* 宿主端皮肤白名单 —— **必须和 client.js 里的 SKINS 完全一致**。
   宿主用它来校验 PATCH 请求：不在表里的皮肤会被归一化成 DEFAULT_SKIN，
   于是"选了流体、刷新一下又变回星云"（而且因为 touched 还是 false，
   还会把 localStorage 里缓存的 fluid 一起覆盖掉）。加皮肤时**两处都要改**。
   nebula 暂时下线（2026-10-01）：白名单里注释掉它，于是偏好文件里已存的
   `skin: "nebula"` 会被 readPreference 归一化成 DEFAULT_SKIN（fluid）。 */
const SKINS = [/* "nebula", */ "holo", "chrome", "fluid"];
const DEFAULT_SKIN = "fluid";
const MAX_BODY_BYTES = 8 * 1024;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const PHASES = ["apply", "resolveReact", "slotRegistered", "inject", "mount"];
/** 判定顺序：前面的阶段是后面阶段的前提。 */
const VERDICT_CHAIN = ["apply", "resolveReact", "slotRegistered", "mount"];

let logger = null;

function normalizeSkin(value) {
  return typeof value === "string" && SKINS.includes(value) ? value : DEFAULT_SKIN;
}

/**
 * 取 logger —— 照 dsh-imagegen 的成熟形状：可能是函数命名空间，也可能是对象，
 * 两种情况都不能抛；拿不到就退回 console（console 不进日志文件，但比崩掉好）。
 */
function loggerFor(ctx) {
  try {
    const candidate = ctx?.logger;
    if (typeof candidate === "function") return candidate(PACKAGE_ID) ?? console;
    if (candidate && typeof candidate.info === "function") return candidate;
  } catch {
    /* 落到 console */
  }
  return console;
}

function say(level, message) {
  const line = `[${PACKAGE_ID}] ${message}`;
  try {
    const sink = logger ?? console;
    if (typeof sink[level] === "function") sink[level](line);
    else if (typeof sink.log === "function") sink.log(line);
  } catch {
    try { console.log(line); } catch { /* 连 console 都没有就只能放弃 */ }
  }
}

const warn = (m) => say("warn", m);
const fail = (m) => say("error", m);
const info = (m) => say("info", m);

/* ───────────────────────── 皮肤偏好：纯 JSON 文件 ───────────────────────── */

function preferenceFilePath() {
  const home = process.env.DSH_HOME;
  const pluginDir = fileURLToPath(new URL("./", import.meta.url));
  if (typeof home === "string" && home.length > 0) return join(home, "storages", "effort-slider.json");
  return join(pluginDir, "effort-slider.json");
}

function readPreference(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed?.skin === "string" && SKINS.includes(parsed.skin)) {
      return { skin: parsed.skin, persisted: true };
    }
    warn(`偏好文件内容非法，按默认处理：${file}`);
    return { skin: DEFAULT_SKIN, persisted: false };
  } catch (error) {
    if (error?.code !== "ENOENT") warn(`读取偏好文件失败：${String(error)}`);
    return { skin: DEFAULT_SKIN, persisted: false };
  }
}

/** 写入串行化：同一进程内排队 + 每次唯一临时文件，避免并发写互相截断。 */
let writeChain = Promise.resolve();
function writePreference(file, skin) {
  writeChain = writeChain.then(async () => {
    const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      // 读-改-写：同一个文件里还住着 sessions（ULTRA/闪电的会话状态），
      // 整体覆写成 `{ skin }` 会把它们一次抹掉。
      // 2026-10-02 真实事故：用户改皮肤 → 文件只剩 `{ skin: "fluid" }` → 7 个会话的
      // ultra/lightning 全部丢失（运行中的宿主还靠内存撑着，重启就彻底没了）。
      const current = readFileState(file);
      const next = { ...current, skin };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      renameSync(temp, file);
      return true;
    } catch (error) {
      warn(`写入偏好文件失败：${String(error)}`);
      try { unlinkSync(temp); } catch { /* 残留临时文件不可怕，不能因此抛错 */ }
      return false;
    }
  }).catch(() => false);
  return writeChain;
}

/* ──────────────── turbo（ULTRA / 闪电）状态：与皮肤共用同一个 JSON ──────────────── */

/**
 * 偏好文件现在长这样：`{ skin, sessions: { "<sessionId>": { lightning, ultra } } }`。
 * 读写一律容忍脏数据：解析失败、字段类型不对、文件不存在，统统退化成"没有状态"。
 * 这一层出错只会让 ULTRA/闪电两个模式失效，**绝不允许**影响滑条本身。
 */
function readFileState(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code !== "ENOENT") warn(`读取偏好文件失败（按空状态处理）：${String(error)}`);
    return {};
  }
}

function readSessions(file) {
  const raw = readFileState(file);
  const source = raw.sessions;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return {};
  const out = {};
  for (const [id, value] of Object.entries(source)) {
    if (value === null || typeof value !== "object") continue;
    out[id] = { lightning: value.lightning === true, ultra: value.ultra === true };
  }
  return out;
}

/** 读-改-写整体串行化（与皮肤偏好共用 writeChain），每次唯一临时文件后原子 rename。 */
function writeState(file, mutate) {
  writeChain = writeChain.then(async () => {
    const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      const current = readFileState(file);
      const next = mutate(current) ?? current;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      renameSync(temp, file);
      return true;
    } catch (error) {
      warn(`写入 turbo 状态失败：${String(error)}`);
      try { unlinkSync(temp); } catch { /* 残留临时文件不可怕，不能因此抛错 */ }
      return false;
    }
  });
  return writeChain;
}

/* ───────────────────── 客户端 bundle：启动关键路径只做静态检查 ───────────────────── */

/**
 * 静态审计：只读文件、查关键标志。**不执行产物**（执行式审计若遇到损坏产物可能卡住宿主事件循环）。
 * 返回 { ok, note }；任何问题都只是 note，不阻断。
 */
function auditClientBundleStatically() {
  let bundle;
  try {
    bundle = readFileSync(fileURLToPath(new URL("./lib/client.js", import.meta.url)), "utf8");
  } catch {
    return { ok: false, note: "客户端构建产物 lib/client.js 缺失：先跑 node build.mjs，否则界面上不会有滑条" };
  }
  const problems = [];
  if (!bundle.includes(`id: "${PACKAGE_ID}"`) && !bundle.includes(`id:"${PACKAGE_ID}"`)) problems.push("bundle id 不匹配");
  if (!bundle.includes("var module = { exports: {} }")) problems.push("工厂缺少 module 绑定（物化时会 ReferenceError）");
  if (!bundle.includes("var __esRequire = require;")) problems.push("工厂没有声明 __esRequire（require('react') 这条官方路径会静默失效）");
  if (!bundle.includes("return module.exports")) problems.push("工厂没有交出 exports");
  if (bundle.includes("window.__DSH_EFFORT_SLIDER__ =")) problems.push("仍在使用已废弃的全局导出通道");
  if (!/slotRegistered|reportHeartbeat/.test(bundle)) problems.push("产物里找不到心跳打点");
  if (!/inject:\s*\[[^\]]*"slots"/.test(bundle) && !bundle.includes('"slots"')) problems.push("产物里 inject 未包含 slots");
  if (problems.length > 0) return { ok: false, note: problems.join("；") };
  // 注意：string.length 是字符数，产物里有中文注释，字节数要用 Buffer.byteLength 算
  const bytes = Buffer.byteLength(bundle, "utf8");
  return { ok: true, note: `${bytes} 字节（${bundle.length} 字符），静态检查通过` };
}

/**
 * 执行式深检：默认关闭；仅当显式设置 EFFORT_SLIDER_DEEP_AUDIT=1 时启用。
 *
 * 三道护栏（独立审查实测出来的风险）：
 *  · 沙箱**故意不提供** `module`/`exports` —— 与构建侧一致，能抓出"工厂忘了自己声明 module"
 *    这类坏产物（提供 module 反而会掩盖它）；
 *  · `factory(require)` 在**沙箱内部**调用，这样 vm 的 timeout 才覆盖它
 *    （直接调沙箱函数不受 timeout 保护，实测会让宿主永久卡死）；
 *  · 失败只告警，绝不阻断启动。
 */
async function deepAuditIfRequested() {
  if (process.env.EFFORT_SLIDER_DEEP_AUDIT !== "1") return;
  try {
    const { createContext, runInContext } = await import("node:vm");
    const bundle = readFileSync(fileURLToPath(new URL("./lib/client.js", import.meta.url)), "utf8");
    const sandbox = {
      window: {
        __ModuleLoader__: {
          // 捕获 factory，供下面的工作台在沙箱内调用（这样 timeout 才覆盖到它）
          load: (registration) => { sandbox.__factory = registration?.factory ?? null; },
        },
      },
      module: { exports: {} },
      __factory: null,
      console: { log() {}, warn() {}, error() {} },
    };
    // 工作台：factory 在沙箱内部被调用 → 受 runInContext 的 timeout 保护
    sandbox.workbench = function () {
      try {
        if (typeof sandbox.__factory !== "function") return "factory 不存在";
        const plugin = sandbox.__factory(() => { throw new Error("deep audit: no requires"); });
        if (plugin === null || typeof plugin !== "object") return "factory 返回非对象";
        if (typeof plugin.apply !== "function") return "缺少 apply";
        if (!Array.isArray(plugin.inject) || plugin.inject.indexOf("slots") < 0) return "inject 异常";
        return "ok";
      } catch (error) {
        return `factory 抛错：${String(error)}`;
      }
    };
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    const context = createContext(sandbox);

    runInContext(bundle, context, { timeout: 5000 });
    const workbenchVerdict = runInContext("workbench()", context, { timeout: 3000 });
    if (workbenchVerdict === "ok") info("深检通过（脚本可执行、factory 返回合法插件形状）");
    else info(`深检结论：${String(workbenchVerdict)}`);
  } catch (error) {
    warn(`深检失败（不影响运行）：${String(error)}`);
  }
}

/* ───────────────────────── 请求体 ───────────────────────── */

/**
 * 读请求体。三条护栏（独立审查用真 socket 实测出来的风险）：
 *  1. 限长 8KB：超限先完整写出 413，再**真的断开**（否则读循环会一直吃数据）；
 *  2. 上传超时 5s：慢速上传（slowloris）会被主动断开 —— 本地 UI 的请求都在毫秒级，
 *     5 秒足够宽裕，同时不给挂连接留空间（实测过 408 + 断开行为）；
 *  3. 任何路径都只 resolve 一次。
 */
const BODY_TIMEOUT_MS = 5_000;

function readJson(request, response) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const abort = (status, payload) => {
      try {
        if (!response.headersSent) {
          const text = JSON.stringify(payload);
          response.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Length": String(Buffer.byteLength(text)),
            Connection: "close",
          });
          response.end(text);
        }
      } catch (error) {
        warn(`回写 ${status} 失败：${String(error)}`);
      }
    };

    timer = setTimeout(() => {
      abort(408, { error: "request-timeout" });
      finish({ ok: false, timeout: true });
      try { request.destroy(); } catch { /* 已经断了 */ }
    }, BODY_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        abort(413, { error: "body-too-large" });
        finish({ ok: false, tooLarge: true });
        // 关键：应答之后必须断开，否则客户端可以继续灌数据
        try { request.destroy(); } catch { /* 已经断了 */ }
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) return finish({ ok: true, value: null });
      try {
        finish({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        finish({ ok: false, invalid: true });
      }
    });
    request.on("error", () => finish({ ok: false, invalid: true }));
    request.on("close", () => finish({ ok: false, invalid: true }));
  });
}

/* ───────────────────────── 接入 ───────────────────────── */

/**
 * 只声明 webServer：它是本组合里确定被 provide 的服务（活服务目录 + 端点实证）。
 * logger 刻意**不声明** —— 它是 Context 内建（342 个 inject 数组里 0 个含 logger），
 * 而声明一个不存在的服务会让 fiber PENDING → 整棵树不激活。
 */
export const inject = ["webServer"];

export function apply(ctx) {
  try {
    setup(ctx);
  } catch (error) {
    // 这里必须"零依赖"地报错：fail() 内部已用 console 兜底，绝不能再抛第二次
    try { console.error(`[${PACKAGE_ID}] 初始化失败，已跳过（不影响其它功能）：${String(error)}`); } catch { /* 忽略 */ }
    try { say("error", `初始化失败，已跳过（不影响其它功能）：${String(error)}`); } catch { /* 忽略 */ }
  }
}

function setup(ctx) {
  logger = loggerFor(ctx);

  const audit = auditClientBundleStatically();
  if (audit.ok) info(`客户端 bundle ${audit.note}`);
  else fail(`客户端 bundle 检查未通过（界面可能不出现滑条）：${audit.note}`);
  void deepAuditIfRequested();

  const file = preferenceFilePath();
  const runNonce = randomBytes(12).toString("hex");
  /** phase -> { status, at, source, error }；同一 phase 只接受首次上报 */
  const heartbeats = new Map();
  const timers = [];

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: "exact",
      path: ENDPOINT,
      handler: async (request, response) => {
        const headers = {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        };
        try {
          if (request.method === "GET") {
            const current = readPreference(file);
            response.writeHead(200, headers);
            response.end(JSON.stringify({
              skin: current.skin,
              persisted: current.persisted,
              reportNonce: runNonce,
              heartbeat: Object.fromEntries([...heartbeats].map(([phase, r]) => [phase, { status: r.status, at: r.at }])),
            }));
            return;
          }
          if (request.method === "POST") {
            const body = await readJson(request, response);
            if (!body.ok) {
              if (!body.tooLarge && !response.headersSent) {
                response.writeHead(400, headers);
                response.end(JSON.stringify({ error: body.tooLarge ? "body-too-large" : "invalid-body" }));
              }
              return;
            }

            const report = body.value?.report;
            if (report && typeof report.phase === "string") {
              const accepted = recordHeartbeat(heartbeats, report, runNonce);
              if (!response.headersSent) {
                response.writeHead(200, headers);
                response.end(JSON.stringify({ ok: accepted, seen: [...heartbeats.keys()] }));
              }
              return;
            }

            if (body.value === null || body.value?.skin === undefined) {
              response.writeHead(400, headers);
              response.end(JSON.stringify({ error: "invalid-body" }));
              return;
            }
            const skin = normalizeSkin(body.value.skin);
            const persisted = await writePreference(file, skin);
            if (persisted) info(`皮肤偏好已保存：${skin}`);
            response.writeHead(200, headers);
            response.end(JSON.stringify({ skin, persisted }));
            return;
          }
          response.writeHead(405, { ...headers, Allow: "GET, POST" });
          response.end();
        } catch (error) {
          warn(`偏好端点异常：${String(error)}`);
          try {
            if (!response.headersSent) response.writeHead(500, headers);
            response.end(JSON.stringify({ error: "internal" }));
          } catch { /* 连接可能已断 */ }
        }
      },
    });
    return () => dispose();
  }, "effort-slider: preferences + heartbeat endpoint");

  ctx.effect(() => {
    const timer = setTimeout(() => verdict(heartbeats, file), HEARTBEAT_TIMEOUT_MS);
    if (typeof timer.unref === "function") timer.unref();
    timers.push(timer);
    return () => clearTimeout(timer);
  }, "effort-slider: heartbeat verdict");

  /**
   * ULTRA / LIGHTNING：会话状态 + `/turbo` 路由 + 舰队 tok/s 计量 + 策略注入。
   *
   * 用 `ctx.effect` 拿到确切的卸载时机，并**整体包在 try/catch 里**：这一层是锦上添花，
   * 它坏掉绝不能让滑条跟着坏（2026-10-01「重启后看不到滑条」那次事故的形状就是
   * "一个新能力失败把整个 apply 拖下水"，那次之后所有新能力都按这个模式接线）。
   */
  ctx.effect(() => {
    let turbo = null;
    try {
      turbo = createTurbo(ctx, {
        log: (message) => info(message),
        readSessions: () => readSessions(file),
        writeSessions: (sessions) => writeState(file, (current) => ({ ...current, sessions })),
        readJson,
        endpoint: TURBO_ENDPOINT,
      });
    } catch (error) {
      fail(`turbo（ULTRA/闪电）初始化失败，已跳过（不影响滑条本身）：${String(error)}`);
    }
    return () => {
      try { turbo?.dispose?.(); } catch { /* 卸载异常不冒泡 */ }
    };
  }, "effort-slider: ultra + lightning + fleet meter");

  info(`已就绪（皮肤偏好文件：${file}；心跳 nonce：${runNonce.slice(0, 8)}…）`);
}

/**
 * 记录一次心跳。
 * · 带 nonce 的上报必须与本次启动一致（旧页面/旧启动一律忽略 —— "陈旧心跳假阳性"的修法）；
 * · 例外：在**尚未收到任何有效 nonce 心跳**之前，允许一条无 nonce 的 `apply` 作为"引导信号"
 *   （客户端的第一条心跳通常早于 GET nonce 返回）。它只用来记录"bundle 确实执行了"，
 *   不参与后续阶段的严格判定，避免"拿不到 nonce 就永远静默"。
 * · 同一 phase 只记录**首次**，status 只有 "ok" / "error"；
 * · 任何异常都不外抛（心跳永远不能影响功能）。
 */
function recordHeartbeat(heartbeats, report, runNonce) {
  try {
    if (typeof report.phase !== "string" || !PHASES.includes(report.phase)) return false;

    const hasNonce = typeof report.nonce === "string" && report.nonce === runNonce;
    // 例外：在**尚未收到任何心跳**之前，允许一条无 nonce 的 apply 作为引导信号
    // （客户端第一条心跳通常早于 GET nonce 返回）。它只证明"bundle 执行了"。
    const provisional = report.phase === "apply" && typeof report.nonce !== "string" && heartbeats.size === 0;

    // nonce 校验必须**先于**幂等短路：否则旧实例重复上报会拿到 ok:true，掩盖它已被忽略的事实
    if (!hasNonce && !provisional) {
      info(`忽略来自旧实例的心跳（phase=${report.phase}）`);
      return false;
    }
    if (heartbeats.has(report.phase)) {
      info(`心跳 ${report.phase} 重复上报，已忽略（保留首次记录）`);
      return false;
    }

    const status = report.status === "error" ? "error" : "ok";
    const record = { status, at: Date.now(), source: report.source, error: report.error, note: report.note, provisional };
    heartbeats.set(report.phase, record);
    // note 单独一条通道：它不是错误，但"为什么隐藏了控件"必须能从日志里读出来
    // —— 2026-10-01 那次"重启后看不到滑动条"就是因为日志只说了 available=false 而查了很久。
    const detail = record.error
      ? `（${String(record.error).slice(0, 200)}）`
      : record.note
        ? `（${String(record.note).slice(0, 200)}）`
        : record.source ? ` via ${record.source}` : "";
    const tag = provisional ? "（引导信号，无 nonce）" : "";
    if (status === "error") fail(`客户端心跳 ${report.phase} 失败${detail}${tag}`);
    else info(`客户端心跳 ${report.phase}${detail}${tag}`);
    return true;
  } catch (error) {
    warn(`记录心跳异常：${String(error)}`);
    return false;
  }
}

/**
 * 判定：按**单调序列**逐级检查（只认从头连续成功的前缀）。
 *
 * 要点（对拍结论）：
 * · 不能只看 `has(phase)` —— 否则乱序/跳阶段的上报也能拼成"齐全"；
 * · `status:"error"` 的 phase 必须**立刻**判定失败，不能被后续阶段掩盖；
 * · 完全没收到心跳时不下断言（用户可能只是没打开界面），只说"尚未观测到"；
 * · `mount` 的语义是"组件进入了渲染路径且首帧成功"，不等于"用户肉眼看到"（避免过度断言）。
 */
function verdict(heartbeats, file) {
  try {
    if (!heartbeats.has("apply")) {
      info("尚未观测到客户端心跳（可能界面未打开或页面未加载）；可用 GET 该端点查看 heartbeat 字段");
      return;
    }
    for (const phase of VERDICT_CHAIN) {
      const record = heartbeats.get(phase);
      if (record === undefined) {
        fail(`客户端心跳在 ${phase} 处中断：缺少该阶段上报（前序阶段已成功，详见日志与端点状态）`);
        return;
      }
      if (record.status === "error") {
        fail(`客户端在 ${phase} 阶段失败：${String(record.error ?? "未提供原因").slice(0, 200)}`);
        return;
      }
    }
    const injectRecord = heartbeats.get("inject");
    if (injectRecord === undefined) {
      info("客户端心跳齐全（apply → resolveReact → slotRegistered → mount），但尚未观测到插槽 inject（可能没有活动会话）");
    } else if (injectRecord.status === "error") {
      warn(`插槽 inject 阶段有异常记录：${String(injectRecord.error ?? "未提供原因").slice(0, 200)}`);
    } else {
      info("客户端心跳齐全，滑条应已在输入框工具行出现");
    }
  } catch (error) {
    warn(`心跳判定异常：${String(error)}`);
  }
}
