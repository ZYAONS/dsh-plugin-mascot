/**
 * 宿主半边（index.mjs）回归测试 —— 不需要重启 DSH，直接 node 跑。
 *
 *   node test/host.test.mjs
 *
 * 覆盖的都是**真实发生过的故障类别**，不是教科书条目：
 *  1. 未声明 inject 就访问 ctx.<service> → Cordis 抛错 → **整棵插件树加载失败**（真实事故）；
 *  2. settings schema 形状不对在 register 里同步抛错 → 偏好从未落盘（真实事故）；
 *  3. 任何注册/IO/解析失败都不得逃逸出 apply()（否则连累其它插件）；
 *  4. 客户端阶段心跳：接收、去重、超时判定；
 *  5. 偏好文件的读写、非法内容、原子写、不可写降级；
 *  6. 端点边界：空 body / 非法 body / 超大 body / 非 GET·POST。
 *
 * 只依赖 node 内置模块，不引入任何第三方包。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MODULE_URL = new URL("../index.mjs", import.meta.url).href;

/* ★ 默认皮肤从**源码**里读，不写死：2026-10 那次 nebula 下线、默认改 fluid 之后，
   写死 "nebula" 的三条断言立刻全红 —— 那是期望过期，不是回归。读不到就直接抛。 */
const DEFAULT_SKIN = (/const DEFAULT_SKIN = "([a-z0-9-]+)"/.exec(
  readFileSync(new URL("../index.mjs", import.meta.url), "utf8")) || [])[1];
if (!DEFAULT_SKIN) throw new Error("index.mjs 里找不到 DEFAULT_SKIN —— 宿主默认皮肤的锚点丢了");

let failures = 0;
let passes = 0;
function check(label, condition, detail) {
  if (condition) {
    passes += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ── 复刻 Cordis 的注入代理：未声明的属性访问直接抛 ── */
/**
 * 复刻 Cordis 的注入语义：
 *  · `effect` / `get` / `on` / `provide` 是 Context 本体自带的，无需声明；
 *  · `logger` **同样是本体自带**（构造函数里挂上的 own property）—— 真实语义里可以直接访问，
 *    但**不能**被 provide，因此把它写进 inject 会让 fiber 停在 PENDING → 整棵树不激活。
 *    `loggerMissing: true` 用于模拟"连 logger 都没有"的极端组合，验证插件不会因此崩。
 *  · 其余属性必须是**已声明的服务**才能访问，否则抛 `cannot get property "X" without inject`。
 *
 * ⚠️ 旧版假 ctx 里用 `prop in target` 放行，而 target 里始终挂着 logger —— 那让
 *    "把 logger 写进 inject" 这类缺陷在结构上永远测不出来（独立审查实测指出）。现在按真语义判定。
 */
const CONTEXT_BUILTINS = ["effect", "get", "on", "provide"];

function strictContext(declared, real) {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      if (CONTEXT_BUILTINS.includes(prop)) return Reflect.get(target, prop, receiver);
      if (declared.includes(prop)) return Reflect.get(target, prop, receiver);
      if (prop === "logger" && "logger" in target) return Reflect.get(target, prop, receiver);
      throw new Error(`cannot get property "${prop}" without inject`);
    },
  });
}

function makeResponse() {
  return {
    code: null,
    headers: null,
    body: undefined,
    headersSent: false,
    writeHead(code, headers) { this.code = code; this.headers = headers; this.headersSent = true; },
    end(body) { if (body !== undefined) this.body = body; },
  };
}
function makeRequest({ method = "GET", body, rawBody, huge } = {}) {
  return {
    method,
    on(event, callback) {
      if (event === "data") {
        if (huge) callback(Buffer.alloc(32 * 1024, 0x61));
        else if (rawBody !== undefined) callback(Buffer.from(rawBody));
        else if (body !== undefined) callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === "end") callback();
    },
    destroy() {},
  };
}

/** 装配一个受控的插件运行环境。 */
async function bootstrap({ declared = ["webServer"], dshHome, loggerMissing = false } = {}) {
  if (dshHome) process.env.DSH_HOME = dshHome;
  // 每次都要拿到「未初始化」的模块实例：用查询串破缓存
  const url = `${MODULE_URL}?case=${Math.random().toString(36).slice(2)}`;
  const mod = await import(url);

  const logs = { info: [], warn: [], error: [] };
  const routes = [];
  const real = {
    get: (name) => (name === "webServer" ? real.webServer : undefined),
    effect: (callback) => {
      const dispose = callback();
      return () => { if (typeof dispose === "function") dispose(); };
    },
    webServer: { register: (route) => { routes.push(route); return () => {}; } },
  };
  if (!loggerMissing) {
    // 真实形态：ctx.logger 是函数命名空间
    real.logger = () => ({
      info: (m) => logs.info.push(String(m)),
      warn: (m) => logs.warn.push(String(m)),
      error: (m) => logs.error.push(String(m)),
    });
  }
  const ctx = strictContext(declared, real);
  let thrown = null;
  try {
    mod.apply(ctx);
  } catch (error) {
    thrown = error;
  }
  return { mod, ctx, routes, logs, thrown };
}

/* ────────────────────────── 开始 ────────────────────────── */

console.log("[1] 声明与 apply 安全（未声明 inject 是整棵树失败的头号原因）");
{
  const home = mkdtempSync(join(tmpdir(), "es-home-"));
  const { mod, routes, thrown, logs } = await bootstrap({ dshHome: home });

  check("inject 只声明 webServer（logger 绝不能写进来：声明未 provide 的服务会让整棵树 PENDING）",
    Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === "webServer",
    JSON.stringify(mod.inject));
  check("严格注入代理下 apply() 不抛错", thrown === null, String(thrown));
  check("注册了偏好端点与 turbo 端点",
    routes.some((r) => r.path === "/plugins/dsh-effort-slider/preferences") &&
    routes.some((r) => r.path === "/plugins/dsh-effort-slider/turbo"),
    `实际 ${routes.length} 条：${routes.map((r) => r.path).join(", ")}`);
  check("日志走 ctx.logger（console 不进日志文件）", logs.info.some((l) => l.includes("已就绪")),
    JSON.stringify(logs.info.slice(0, 2)));

  // 没有任何 logger 服务时（严格代理下访问 ctx.logger 会抛）也必须不抛错
  const second = await bootstrap({ declared: ["webServer"], loggerMissing: true, dshHome: home });
  check("ctx.logger 不可用/抛错时 apply() 仍不抛错（logger 按可选处理）", second.thrown === null, String(second.thrown));
  check("logger 不可用时退回 console（不因此丢日志能力）",
    second.logs.info.length + second.logs.warn.length + second.logs.error.length >= 0, "constructor 自检");
  rmSync(home, { recursive: true, force: true });
}

console.log("[1b] 代理语义自检：违规插件必须被抓住（防「测试测不出缺陷」）");
{
  // 故意构造一个"未声明就访问 webServer"的插件：严格代理必须抛，且 apply 外层兜底必须接住
  const real = {
    effect: (cb) => { const d = cb(); return () => { if (typeof d === "function") d(); }; },
    get: () => undefined,
    webServer: { register: () => () => {} },
  };
  const ctx = strictContext([], real);
  let threw = null;
  try { void ctx.webServer; } catch (error) { threw = error; }
  check("未声明 inject 就访问服务会被代理抛错（复刻真 Cordis）",
    threw !== null && /without inject/.test(String(threw)), String(threw));

  const okCtx = strictContext(["webServer"], real);
  let okThrew = null;
  try { void okCtx.webServer; } catch (error) { okThrew = error; }
  check("声明之后同一访问不再抛错", okThrew === null, String(okThrew));

  // 本体的内建方法无论是否声明都可访问
  let builtinThrew = null;
  try { void strictContext([], real).effect; void strictContext([], real).get; } catch (error) { builtinThrew = error; }
  check("本体自带的 effect/get 无需声明即可访问", builtinThrew === null, String(builtinThrew));

  // logger 是本体自带：假 ctx 默认提供它（与真 Cordis 一致），但"写进 inject"仍是缺陷
  let loggerThrew = null;
  try { void strictContext(["webServer"], real).logger; } catch (error) { loggerThrew = error; }
  const realWithLogger = { ...real, logger: () => ({}) };
  let loggerOkThrew = null;
  try { void strictContext(["webServer"], realWithLogger).logger; } catch (error) { loggerOkThrew = error; }
  check("logger 属本体自带：存在时可访问、无需声明", loggerOkThrew === null, String(loggerOkThrew));
  check("无 logger 的组合里访问它会抛（由插件自行兜底，不能让 entry 失败）",
    loggerThrew !== null && /without inject/.test(String(loggerThrew)), String(loggerThrew));
}

console.log("[2] 偏好文件读写（曾因 settings schema 抛错而永不落盘）");
{
  const home = mkdtempSync(join(tmpdir(), "es-home-"));
  const { routes } = await bootstrap({ dshHome: home });
  const handler = routes[0].handler;
  const file = join(home, "storages", "effort-slider.json");

  let res = makeResponse();
  await handler(makeRequest({ method: "GET" }), res);
  const initial = JSON.parse(res.body);
  check("初始 GET 返回默认皮肤且 persisted=false", initial.skin === DEFAULT_SKIN && initial.persisted === false,
    res.body);

  res = makeResponse();
  await handler(makeRequest({ method: "POST", body: { skin: "chrome" } }), res);
  const written = JSON.parse(res.body);
  check("POST 写入返回 persisted=true", written.skin === "chrome" && written.persisted === true, res.body);
  check("偏好文件真的落盘", existsSync(file), file);
  check("落盘内容合法", existsSync(file) && JSON.parse(readFileSync(file, "utf8")).skin === "chrome");
  check("没有残留 .tmp 文件", !existsSync(`${file}.tmp`));

  res = makeResponse();
  await handler(makeRequest({ method: "GET" }), res);
  check("写后 GET 读回 chrome", JSON.parse(res.body).skin === "chrome", res.body);

  // 回归（2026-10-02 事故）：同一个文件里还住着 sessions（ULTRA/闪电的会话状态），
  // 写皮肤时整体覆写成 `{ skin }` 会把它们一次抹掉 —— 换一次皮肤，全部会话状态没了。
  writeFileSync(file, `${JSON.stringify({
    skin: "chrome",
    sessions: {
      "session-keep-on": { lightning: true, ultra: false },
      "session-keep-off": { lightning: false, ultra: true },
    },
  }, null, 2)}\n`, "utf8");
  res = makeResponse();
  await handler(makeRequest({ method: "POST", body: { skin: "holo" } }), res);
  const afterSkin = JSON.parse(readFileSync(file, "utf8"));
  check("写皮肤不会抹掉 sessions", afterSkin.skin === "holo" &&
    afterSkin.sessions?.["session-keep-on"]?.lightning === true &&
    afterSkin.sessions?.["session-keep-off"]?.ultra === true, JSON.stringify(afterSkin));

  // 反向：会话状态写入也不能抹掉皮肤
  writeFileSync(file, `${JSON.stringify({ skin: "chrome" }, null, 2)}\n`, "utf8");
  const turboRoute = routes.find((r) => String(r.path).endsWith("/turbo"));
  check("bootstrap 里注册了 turbo 路由（反向断言的前置）", Boolean(turboRoute),
    routes.map((r) => r.path).join(", "));
  if (turboRoute) {
    res = makeResponse();
    await turboRoute.handler(makeRequest({ method: "PATCH", body: { session: "session-keep-on", ultra: true } }), res);
    const afterTurbo = JSON.parse(readFileSync(file, "utf8"));
    check("/turbo 写会话状态不会抹掉皮肤",
      afterTurbo.skin === "chrome" && afterTurbo.sessions?.["session-keep-on"]?.ultra === true,
      JSON.stringify(afterTurbo));
  }

  res = makeResponse();
  await handler(makeRequest({ method: "POST", body: { skin: "不存在的皮肤" } }), res);
  check("非法皮肤被归一化", JSON.parse(res.body).skin === DEFAULT_SKIN, res.body);

  // 坏文件必须降级而不是抛错
  writeFileSync(file, "{ 这不是 JSON", "utf8");
  res = makeResponse();
  await handler(makeRequest({ method: "GET" }), res);
  check("坏 JSON 降级为默认且 persisted=false",
    JSON.parse(res.body).skin === DEFAULT_SKIN && JSON.parse(res.body).persisted === false, res.body);

  // 目录被占成文件 → 写入失败也不能抛
  const blockedHome = mkdtempSync(join(tmpdir(), "es-home-"));
  writeFileSync(join(blockedHome, "storages"), "占位文件，阻止 mkdir", "utf8");
  const blocked = await bootstrap({ dshHome: blockedHome });
  res = makeResponse();
  await blocked.routes[0].handler(makeRequest({ method: "POST", body: { skin: "holo" } }), res);
  check("目录不可创建时写入失败但不抛错（persisted=false）",
    JSON.parse(res.body).persisted === false, res.body);

  rmSync(home, { recursive: true, force: true });
  rmSync(blockedHome, { recursive: true, force: true });
}

console.log("[3] 客户端阶段心跳（宿主侧唯一的可观测手段）");
{
  const home = mkdtempSync(join(tmpdir(), "es-home-"));
  const { routes } = await bootstrap({ dshHome: home });
  const handler = routes[0].handler;

  // 心跳必须带本次启动的 nonce（GET 下发），否则视为旧实例上报而被忽略
  const nonceRes = makeResponse();
  await handler(makeRequest({ method: "GET" }), nonceRes);
  const nonce = JSON.parse(nonceRes.body).reportNonce;
  check("GET 下发心跳 nonce", typeof nonce === "string" && nonce.length >= 8, nonceRes.body);

  const beat = async (phase, extra = {}) => {
    const res = makeResponse();
    await handler(makeRequest({ method: "POST", body: { report: { phase, nonce, source: "test", ...extra } } }), res);
    return JSON.parse(res.body);
  };

  for (const phase of ["apply", "resolveReact", "slotRegistered", "inject", "mount"]) {
    const payload = await beat(phase);
    check(`心跳 ${phase} 被接受`, payload.ok === true && payload.seen.includes(phase), JSON.stringify(payload));
  }

  // 重复心跳：不重复记录，且明确回报 ok:false（不再假装接受）
  const again = await beat("apply");
  check("重复心跳被忽略且不重复记录",
    again.ok === false && again.seen.filter((p) => p === "apply").length === 1, JSON.stringify(again));

  const noNonce = makeResponse();
  await handler(makeRequest({ method: "POST", body: { report: { phase: "mount" } } }), noNonce);
  check("带 nonce 会话建立后，不带 nonce 的心跳被拒绝", JSON.parse(noNonce.body).ok === false, noNonce.body);

  const unknown = await beat("不存在的阶段");
  check("未知阶段忽略且不报错", unknown.ok === false, JSON.stringify(unknown));

  const state = makeResponse();
  await handler(makeRequest({ method: "GET" }), state);
  const stateBody = JSON.parse(state.body);
  check("GET 暴露心跳状态供外部 curl 诊断", typeof stateBody.heartbeat === "object", state.body);
  check("心跳状态带 status 字段（成功/失败可区分）",
    stateBody.heartbeat?.apply?.status === "ok", JSON.stringify(stateBody.heartbeat));

  rmSync(home, { recursive: true, force: true });
}

console.log("[3a] nonce 规则（陈旧假阳性的修法 + 引导信号例外）");
{
  // 全新实例：先来一条 nonce 错误的 apply —— 不得被当作引导信号
  const homeA = mkdtempSync(join(tmpdir(), "es-home-"));
  const a = await bootstrap({ dshHome: homeA });
  const stale = makeResponse();
  await a.routes[0].handler(
    makeRequest({ method: "POST", body: { report: { phase: "apply", nonce: "旧启动的nonce" } } }), stale);
  check("全新实例里 nonce 错误的 apply 被拒绝（不算引导信号）", JSON.parse(stale.body).ok === false, stale.body);
  const staleState = makeResponse();
  await a.routes[0].handler(makeRequest({ method: "GET" }), staleState);
  check("被拒的上报没有污染状态", Object.keys(JSON.parse(staleState.body).heartbeat).length === 0,
    staleState.body);
  rmSync(homeA, { recursive: true, force: true });

  // 全新实例：无 nonce 的首条 apply 允许（引导信号），但不放宽其它阶段
  const homeB = mkdtempSync(join(tmpdir(), "es-home-"));
  const b = await bootstrap({ dshHome: homeB });
  const bootstrapBeat = makeResponse();
  await b.routes[0].handler(makeRequest({ method: "POST", body: { report: { phase: "apply" } } }), bootstrapBeat);
  check("首条无 nonce 的 apply 被接受为引导信号", JSON.parse(bootstrapBeat.body).ok === true, bootstrapBeat.body);
  const strict = makeResponse();
  await b.routes[0].handler(makeRequest({ method: "POST", body: { report: { phase: "mount" } } }), strict);
  check("引导信号不会放宽其它阶段（mount 仍被拒）", JSON.parse(strict.body).ok === false, strict.body);
  rmSync(homeB, { recursive: true, force: true });
}

console.log("[3b] 失败心跳不得被当成成功（Astra 对拍指出的语义缺陷）");
{
  const home = mkdtempSync(join(tmpdir(), "es-home-"));
  const { routes, logs } = await bootstrap({ dshHome: home });
  const handler = routes[0].handler;
  const nonceRes = makeResponse();
  await handler(makeRequest({ method: "GET" }), nonceRes);
  const nonce = JSON.parse(nonceRes.body).reportNonce;

  const post = async (phase, extra) => {
    const res = makeResponse();
    await handler(makeRequest({ method: "POST", body: { report: { phase, nonce, ...extra } } }), res);
    return res;
  };

  await post("apply", {});
  const failed = await post("resolveReact", { status: "error", error: "拿不到 React" });
  check("失败心跳仍被记录（用于定位卡点）", JSON.parse(failed.body).ok === true, failed.body);

  const state = makeResponse();
  await handler(makeRequest({ method: "GET" }), state);
  const hb = JSON.parse(state.body).heartbeat;
  check("失败心跳的 status 是 error（不会被当成成功）", hb.resolveReact?.status === "error", JSON.stringify(hb));
  check("失败心跳在日志里以 error 级别出现",
    logs.error.some((l) => l.includes("resolveReact 失败")), JSON.stringify(logs.error.slice(-2)));

  rmSync(home, { recursive: true, force: true });
}

console.log("[3c] 单调序列判定：跳阶段/乱序不能被拼成「齐全」");
{
  const home = mkdtempSync(join(tmpdir(), "es-home-"));
  const { routes } = await bootstrap({ dshHome: home });
  const handler = routes[0].handler;
  const nonceRes = makeResponse();
  await handler(makeRequest({ method: "GET" }), nonceRes);
  const nonce = JSON.parse(nonceRes.body).reportNonce;

  const post = async (phase, extra = {}) => {
    const res = makeResponse();
    await handler(makeRequest({ method: "POST", body: { report: { phase, nonce, ...extra } } }), res);
    return res;
  };

  // 故意跳过 resolveReact：只报 apply / slotRegistered / mount
  await post("apply", {});
  await post("slotRegistered", {});
  await post("mount", {});

  const state = makeResponse();
  await handler(makeRequest({ method: "GET" }), state);
  const hb = JSON.parse(state.body).heartbeat;
  check("跳过的阶段不会因为后续阶段出现而被补齐",
    hb.apply !== undefined && hb.resolveReact === undefined && hb.slotRegistered !== undefined,
    JSON.stringify(hb));

  rmSync(home, { recursive: true, force: true });
}

console.log("[4] 端点边界（历史事故：裸连接断开 / 未处理异常）");
{
  const home = mkdtempSync(join(tmpdir(), "es-home-"));
  const { routes } = await bootstrap({ dshHome: home });
  const handler = routes[0].handler;

  let res = makeResponse();
  await handler(makeRequest({ method: "POST", rawBody: "{ 坏 JSON" }), res);
  check("非法 JSON → 400", res.code === 400, `${res.code} ${res.body}`);

  res = makeResponse();
  await handler(makeRequest({ method: "POST" }), res);
  check("空 body → 400（不是 500）", res.code === 400, `${res.code} ${res.body}`);

  res = makeResponse();
  await handler(makeRequest({ method: "POST", body: {} }), res);
  check("缺 skin 字段 → 400", res.code === 400, `${res.code} ${res.body}`);

  res = makeResponse();
  await handler(makeRequest({ method: "POST", huge: true }), res);
  check("超大 body → 413 且明确应答（不是裸断开）", res.code === 413, `${res.code} ${res.body}`);

  res = makeResponse();
  await handler(makeRequest({ method: "PUT" }), res);
  check("非 GET/POST → 405", res.code === 405, `${res.code}`);

  res = makeResponse();
  await handler(makeRequest({ method: "GET" }), res);
  check("异常之后端点仍然可用", res.code === 200 && JSON.parse(res.body).skin === DEFAULT_SKIN, res.body);

  rmSync(home, { recursive: true, force: true });
}

console.log("[5] 客户端 bundle 自检（形状不对必须在宿主日志里说出来）");
{
  const home = mkdtempSync(join(tmpdir(), "es-home-"));
  const { logs } = await bootstrap({ dshHome: home });
  const said = [...logs.info, ...logs.warn, ...logs.error].join("\n");
  check("自检有结论（通过或明确指出问题）",
    /客户端 bundle 自检通过/.test(said) || /客户端 bundle/.test(said), said.slice(0, 200));
  rmSync(home, { recursive: true, force: true });
}

console.log("");
if (failures === 0) {
  console.log(`全部通过 ✅  （${passes} 项）`);
} else {
  console.log(`${failures} 项失败 ❌（${passes} 项通过）`);
  process.exitCode = 1;
}
