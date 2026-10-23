/**
 * 离线冒烟测试：不需要重启 DSH，直接在 node 里
 *   1) 以浏览器方式执行 lib/client.js（验证 loader 包法 + 工厂返回值）
 *   2) 用 React 替身渲染组件（验证组件逻辑不炸）
 *   3) 验证三套皮肤、自动档、单档模型、子代理等边界
 *   4) 回归「快照引用必须稳定」——第一版就是在这里无限重渲染把界面搞挂的
 *
 *   node smoke-test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

/* ★ 默认皮肤与在售皮肤列表**从源码里读**，不写死。
   client.js 的 DEFAULT_SKIN / SKINS 是唯一事实来源 —— 2026-10 就踩过：
   nebula 下线、默认改成 fluid 之后，测试里写死的 "nebula" 立刻全红（期望过期，不是回归）。
   读不到就直接抛：宁可让测试因为"锚点丢了"失败，也不要用一个猜的值继续跑。 */
const CLIENT_SRC = readFileSync(here("client.js"), "utf8");
const DEFAULT_SKIN = (/var DEFAULT_SKIN = "([a-z0-9-]+)"/.exec(CLIENT_SRC) || [])[1];
const SKIN_LIST = (((/var SKINS = \[([^\]]*)\]/.exec(CLIENT_SRC) || [])[1] || "")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .match(/"[a-z0-9-]+"/g) || []).map((s) => s.slice(1, -1));
if (!DEFAULT_SKIN) throw new Error("client.js 里找不到 DEFAULT_SKIN —— 默认皮肤的锚点丢了");
if (SKIN_LIST.length < 2) throw new Error("client.js 里解析不出皮肤列表（SKINS）");
if (!SKIN_LIST.includes(DEFAULT_SKIN)) throw new Error(`DEFAULT_SKIN(${DEFAULT_SKIN}) 不在 SKINS 里 —— 白名单与默认值不同步`);

/* ── 最小 React 替身：够执行一次渲染体并把元素树序列化成 HTML ── */
class ShimComponent {
  constructor(props) { this.props = props; this.state = {}; }
  setState(next) { this.state = { ...this.state, ...next }; }
}
const ReactShim = {
  Component: ShimComponent,
  createElement(type, props, ...children) {
    return { __el: true, type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) };
  },
  useState(initial) {
    return [typeof initial === "function" ? initial() : initial, () => {}];
  },
  useEffect() {},
  useRef(value) { return { current: value }; },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
};
const React = ReactShim;
const capturedReaders = [];

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function serialize(node) {
  if (node === null || node === undefined || node === false) return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node === "string" || typeof node === "number") return escapeHtml(node);
  if (node instanceof ShimComponent) return serialize(node.render());
  if (!node.__el) return "";
  if (typeof node.type === "function" && node.type.prototype instanceof ShimComponent) {
    return serialize(new node.type(node.props ?? {}));
  }
  if (typeof node.type === "function") {
    return serialize(node.type({ ...node.props, children: node.children }));
  }
  const props = node.props ?? {};
  const attrs = Object.keys(props)
    .filter((key) => key !== "children" && key !== "key" && key !== "ref" && props[key] !== undefined && typeof props[key] !== "function" && key !== "style")
    .map((key) => ` ${key}="${escapeHtml(props[key])}"`)
    .join("");
  const style = props.style
    ? ` style="${escapeHtml(Object.entries(props.style).map(([k, v]) => `${k}:${v}`).join(";"))}"`
    : "";
  return `<${typeof node.type === "string" ? node.type : "div"}${attrs}${style}>${serialize(node.children)}</${node.type}>`;
}

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ── 1. 用「浏览器方式」执行构建产物 ───────────────────────────────── */

console.log("[1] 执行 lib/client.js");
const bundle = readFileSync(here("./lib/client.js"), "utf8");
const registrations = [];
const win = {};
globalThis.window = win;
// 平台模块表里 React 是种子模块：官方姿势是「factory 内 require('react')」。
// 这里用替身回答 require，同时验证心跳上报的 fetch 也被兜住（不能影响渲染）。
win.__ModuleLoader__ = {
  load(registration) { registrations.push(registration); },
};
const heartbeatPayloads = [];
globalThis.fetch = (url, options) => {
  try {
    if (typeof url === "string" && url.includes("/preferences") && options?.body) {
      heartbeatPayloads.push(JSON.parse(options.body));
    }
  } catch (error) { /* 忽略 */ }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
};

new Function("window", bundle)(win);

check("注册了一个 bundle factory", registrations.length === 1, `实际 ${registrations.length}`);
check("bundle id 正确", registrations[0]?.id === "dsh-effort-slider", String(registrations[0]?.id));

// 工厂会收到外壳的 require：React 走它（官方 seed 模块），其余请求直接抛错以暴露多余依赖
const plugin = registrations[0].factory((specifier) => {
  if (specifier === "react") return React;
  throw new Error(`本 bundle 不该 require "${specifier}"`);
});
check("工厂返回插件对象", plugin !== null && typeof plugin === "object");
check("插件暴露 apply", typeof plugin?.apply === "function");
check("插件声明 inject", Array.isArray(plugin?.inject) && plugin.inject.includes("slots"),
  JSON.stringify(plugin?.inject));

/* ── 2. 用真 React 渲染组件 ───────────────────────────────────────── */

console.log("[2] 用真 React 渲染组件");

const EFFORTS = [
  { id: "low", name: "轻度", description: "最快最省。" },
  { id: "medium", name: "中", description: "日常默认档。" },
  { id: "high", name: "高", description: "多步推理。" },
  { id: "xhigh", name: "极高", description: "复杂重构。" },
  { id: "max", name: "最高", description: "压满算力。" },
];

function makeStore(state) {
  const listeners = new Set();
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    push(next) { state = next; listeners.forEach((fn) => fn()); },
  };
}

function directorySnapshot(efforts, reasoningEffort) {
  return {
    status: "ready",
    current: { provider: "p", model: "m", reasoningEffort },
    groups: [{
      id: "p",
      models: [{
        id: "m",
        name: "GPT-10 Eternal Galaxy",
        reasoning: { efforts, defaultEffort: "medium" },
      }],
    }],
  };
}

// 组件实例由 apply() 内部注册，这里直接拿注册回调来渲染
let registered = null;
const effects = [];
const ctx = {
  get(name) {
    if (name === "React") return React;
    if (name === "styles") return { insert: () => () => {} };
    return undefined;
  },
  effect(callback, label) { effects.push(String(label)); return callback(); },
  slots: {
    inject(slotName, callback) {
      ctx.slotName = slotName;
      registered = callback();
      return () => {};
    },
    register(registration, component) {
      return { registration, component };
    },
  },
  // ★ 会话列表：真实形状是 ctx.sessions.list.getSnapshot().byId[id]（DSH 自己的 UI 也这么读），
  //   投影行带 origin / parentId。
  //   subagentAddress 故意做成**一被调用就抛错**的陷阱 —— 这是回归锁：
  //   "控件显不显示"不许再依赖导航地址（它只增不删，会把主会话永久判成子代理）。
  sessions: {
    list: { getSnapshot: () => ctx.sessionList ?? { ids: [], byId: {}, current: undefined } },
    subagentAddress() {
      throw new Error("不许再用 subagentAddress 判子代理会话（addresses 只增不删，会把主会话永久判错）");
    },
  },
  modelDirectories: {
    directoryFor: () => ({
      store: ctx.directory.store,
      load: () => Promise.resolve(),
      select: (selection) => { ctx.lastSelection = selection; return Promise.resolve(); },
    }),
  },
};

function renderWith(state, overrides = {}) {
  registered = null;
  const store = makeStore(state);
  ctx.directory = { store };
  plugin.apply(ctx);
  if (registered === null) throw new Error("apply() 没有向 conversation.input.right 注册任何东西");
  const component = registered.component;
  // 皮肤偏好的 getSnapshot 也必须返回稳定引用（真实实现就是这么做的）
  const skinSnapshot = { skin: overrides.skin ?? DEFAULT_SKIN };
  const prefs = {
    getSnapshot: () => skinSnapshot,
    subscribe: () => () => {},
    set: () => {},
  };
  const element = React.createElement(component, {
    React,
    store,
    preferences: prefs,
    available: overrides.available ?? true,
    api: {
      cachedSkin: () => null,
      cacheSkin: () => {},
      fetchSkin: () => Promise.resolve(null),
      saveSkin: () => Promise.resolve(),
      notify: () => {},
    },
    load: () => {},
    commit: () => Promise.resolve(true),
  });
  return serialize(element);
}

const normal = renderWith(directorySnapshot(EFFORTS, "max"));
check("正常模型渲染出收起态胶囊", normal.includes("es-pill"), normal.slice(0, 160));
// ★ 用户明确要求删掉"MAX 左边那颗圆球"（.es-orb：进度环 + 内芯）→ 这里钉住"不许再回来"。
//   收起态现在只有档位文字，所以下面再钉一条"文字必须在"（否则删干净了也没人发现）。
check("收起态**不再**有圆球（用户要求删除 .es-orb）", !normal.includes("es-orb"), normal.slice(0, 200));
check("收起态仍有档位文字（删掉圆球后文字是唯一信息载体）",
  /es-pill__name/.test(normal), normal.slice(0, 200));
check("档位进度变量存在", (/--pct:\s*[\d.]+%/.test(normal.replace(/&quot;/g, '"')) && normal.includes("--ratio:" + ((EFFORTS.length - 1) / EFFORTS.length).toFixed(4))), normal.slice(0, 220));
check("错误边界已包在外面（不直接把裸组件塞进插槽）",
  registered.component.name === "EffortSliderBoundary", String(registered.component.name));

/* ── 回归：组件必须给 React 稳定的快照引用（第一版无限重渲染的根因）── */
console.log("[3] useSyncExternalStore 快照稳定性回归");
{
  const originalHook = ReactShim.useSyncExternalStore;
  ReactShim.useSyncExternalStore = function (_subscribe, getSnapshot) {
    capturedReaders.push(getSnapshot);
    return getSnapshot();
  };
  // 关键：只统计「同一次渲染」内的读取器，跨渲染对比没有意义
  capturedReaders.length = 0;
  renderWith(directorySnapshot(EFFORTS, "max"));
  ReactShim.useSyncExternalStore = originalHook;

  check("捕获到两个快照读取器（模型目录 + 皮肤偏好）", capturedReaders.length >= 2, `实际 ${capturedReaders.length}`);
  capturedReaders.forEach((reader, index) => {
    // React 会在渲染与提交阶段反复调用；只要有一次引用不同就会无限重渲染
    const reads = [];
    for (let i = 0; i < 5; i += 1) reads.push(reader());
    const unique = new Set(reads);
    check(`读取器#${index} 在 5 次调用中返回同一引用（否则会无限重渲染卡死界面）`,
      unique.size === 1, `得到 ${unique.size} 个不同引用`);
  });
  capturedReaders.length = 0;
}

for (const skin of SKIN_LIST) {
  const html = renderWith(directorySnapshot(EFFORTS, "medium"), { skin });
  check(`皮肤 ${skin} 落到 data-skin`, html.includes(`data-skin="${skin}"`), html.slice(0, 120));
}

const autoState = directorySnapshot(EFFORTS, undefined);
const autoHtml = renderWith(autoState);
// F5 回归：auto（模型未显式设置档位）时必须显示**真实默认档**（defaultEffort="medium" → 「中」），
// 而不是旧实现那样用 count-1 兜底成「最高」。
// 旧断言 `includes(">2<")` 永远为假（面板关闭时 readout 根本不渲染），靠 `||` 蒙混过关 —— 已修。
// ★ 2026-10-02（用户要求「全都用英文」）：这里刻意**保留中文的假目录**（本机真宿主就是中文目录），
//   于是下面这两条同时是"档位正确"与"中文目录名不上屏"的双重回归锁：
//   目录说「中 / 最高」，界面必须显示英文梯子 Medium / Max。
const autoPill = (autoHtml.match(/es-pill__name">([^<]*)</) || [])[1];
check("auto 档位显示真实默认档（medium → Medium）而不是最后一档（max）",
  autoPill === "Medium", `pill 显示「${autoPill}」`);

// 对照：显式 max 时应当显示「Max」，证明上面那条不是恒真
const explicitPill = (renderWith(directorySnapshot(EFFORTS, "max")).match(/es-pill__name">([^<]*)</) || [])[1];
check("显式最高档时显示 Max（对照，避免断言恒真）", explicitPill === "Max", `pill 显示「${explicitPill}」`);

// 反向对照：目录**给的是英文名**时必须以目录原文为准（ASCII 偏好不是"一律忽略目录"）。
{
  const enPill = (renderWith(directorySnapshot([
    { id: "low", name: "Light", description: "Light duty." },
    { id: "max", name: "Maximum", description: "Full tilt." },
  ], "max")).match(/es-pill__name">([^<]*)</) || [])[1];
  check("目录给英文名时以目录原文为准（不吞掉模型的英文档位名）",
    enPill === "Maximum", `pill 显示「${enPill}」`);
}

const oneEffort = renderWith(directorySnapshot([{ id: "only", name: "唯一" }], "only"));
// 设计变更（2026-10-01 实机事故后）：不再因为"档位不够 / store 未就绪"整体隐身。
// 真实 ModelDirectory 的 store 首帧就是 { current: null, groups: [], status: "idle" }，
// 旧实现「count<2 就 return null」把首帧时序变成了"永远不出现"（用户实测：重启后滑条消失）。
// 现在：渲染出 pill（加载态、disabled），store 一到自动填充。
check("只有一档时仍渲染出 pill（加载态，不再整体隐身）",
  oneEffort.includes("es-pill") && oneEffort.includes("es-pill--loading"), oneEffort.slice(0, 220));
check("加载态下 pill 带 disabled（不会打开空面板）",
  /disabled/.test(oneEffort), oneEffort.slice(0, 260));

const noReasoning = renderWith({
  status: "ready",
  current: { provider: "p", model: "m" },
  groups: [{ id: "p", models: [{ id: "m", name: "无推理模型" }] }],
});
check("模型无推理档位时仍渲染出 pill（加载态，不再整体隐身）",
  noReasoning.includes("es-pill"), noReasoning.slice(0, 220));

/* ── 回归：真实 ModelDirectory 首帧就是空 store，之后靠通知补数据 ── */
console.log("[3d] 首帧空 store → 收到通知后必须渲染出来（实机事故）");
{
  // 真实初始快照（从 app.asar 的 ModelDirectory 抄来）
  const emptyFirst = {
    current: null, routable: null, groups: [], failures: [], status: "idle", error: null,
  };
  const later = directorySnapshot(EFFORTS, "max");
  const store = makeStore(emptyFirst);

  ctx.directory = { store };
  registered = null;
  plugin.apply(ctx);
  const component = registered.component;
  const skinSnapshot = { skin: DEFAULT_SKIN };
  const props = {
    store,
    preferences: { getSnapshot: () => skinSnapshot, subscribe: () => () => {}, set: () => {} },
    available: true,
    api: {
      cachedSkin: () => null, cacheSkin: () => {}, fetchSkin: () => Promise.resolve(null),
      saveSkin: () => Promise.resolve(), notify: () => {},
    },
    load: () => {},
    commit: () => Promise.resolve(true),
  };

  const first = serialize(React.createElement(component, props));
  check("空 store 首帧仍渲染出 pill（不隐身）", first.includes("es-pill"), first.slice(0, 200));
  check("空 store 首帧 pill 处于加载态", first.includes("es-pill--loading"), first.slice(0, 200));

  // store 补上数据（模拟 catalog.load() 之后的 syncInputs()）
  store.push(later);
  const after = serialize(React.createElement(component, props));
  check("store 更新后渲染出真实档位（不再是加载态）",
    after.includes("es-pill") && !after.includes("es-pill--loading"), after.slice(0, 240));
  check("store 更新后档位名正确（显式 max → Max；目录给的中文名不上屏）",
    /es-pill__name">([^<]*)</.test(after) && after.match(/es-pill__name">([^<]*)</)[1] === "Max",
    String(after.match(/es-pill__name">([^<]*)</)));
}

const subHtml = renderWith(directorySnapshot(EFFORTS, "high"), { available: false });
check("子代理会话不渲染控件本体", !subHtml.includes("es-pill"), JSON.stringify(subHtml.slice(0, 120)));

/* ── 回归：偏好读不到时也必须落上默认皮肤（实测过的「灰环」事故）── */
console.log("[4] 皮肤偏好异常时的兜底回归");
{
  const brokenPrefs = [
    ["preferences 为空对象", {}],
    ["getSnapshot 返回 undefined", { getSnapshot: () => undefined, subscribe: () => () => {}, set: () => {} }],
    ["getSnapshot 返回非法皮肤", { getSnapshot: () => ({ skin: "不存在" }), subscribe: () => () => {}, set: () => {} }],
    ["preferences 直接是 null", null],
  ];
  for (const [label, preferences] of brokenPrefs) {
    const store = makeStore(directorySnapshot(EFFORTS, "max"));
    ctx.directory = { store };
    registered = null;
    plugin.apply(ctx);
    const html = serialize(React.createElement(registered.component, {
      store,
      preferences,
      available: true,
      api: {
        cachedSkin: () => null, cacheSkin: () => {}, fetchSkin: () => Promise.resolve(null),
        saveSkin: () => Promise.resolve(), notify: () => {},
      },
      load: () => {},
      commit: () => Promise.resolve(true),
    }));
    check(`${label} 时仍落上 data-skin（否则皮肤样式全失效，只剩灰环）`,
      new RegExp(`data-skin="(${SKIN_LIST.join("|")})"`).test(html), html.slice(0, 140));
  }
}

/* ── 回归：主会话被导航地址"上锁"后，控件不许再被误判成子代理而隐藏 ──────────
   2026-10-01 现场（用户："重启后看不到滑动条"）：
     判据曾经是 `ctx.sessions.subagentAddress(sessionId) === undefined`。而 SessionManager
     的 addresses **只增不删**，且 select() 只要能从目录（agents-anywhere）推导出地址就
     set 进去 —— 于是主会话 session-00000000（delegationDepth=0、无 parentSession）
     一次 select 之后被永久判成子代理，刷新/重启都看不到控件。
   这里把当时的形状原样搬进测试：**"有导航地址"≠"是子代理"**。 */
console.log("[4b] 会话可用性判据：导航地址不许再影响显隐（回归锁）");
{
  const sessionId = "session-00000000-1111-2222-3333-444444444444";
  /** 只跑 apply 并取回插槽注册对象（renderWith 会用组件渲染覆盖 registered）。 */
  function applyAndGetRegistration() {
    registered = null;
    ctx.directory = { store: makeStore(directorySnapshot(EFFORTS, "max")) };
    plugin.apply(ctx);
    if (registered === null) throw new Error("apply() 没有注册插槽");
    return registered.registration;
  }
  function injectWith(sessionList, id) {
    ctx.sessionList = sessionList;
    const registration = applyAndGetRegistration();
    let result;
    try {
      result = registration.inject(id ?? sessionId);
    } finally {
      ctx.sessionList = undefined;
    }
    return result;
  }

  // ① 主会话：投影行没有 origin（可能有 parentId，因为 fork 出来的会话也有 parentId）
  const plain = injectWith({ ids: [sessionId], byId: { [sessionId]: { id: sessionId } }, current: sessionId });
  check("主会话（投影行无 origin）→ 控件可用", plain.available === true, JSON.stringify(plain.available));

  // ② 分叉会话：有 parentId 但不是子代理运行 —— 也必须可用
  const forked = injectWith({
    ids: [sessionId],
    byId: { [sessionId]: { id: sessionId, parentId: "session-parent-0000" } },
    current: sessionId,
  });
  check("分叉会话（有 parentId、无 origin）→ 控件可用", forked.available === true, JSON.stringify(forked.available));

  // ③ 真子代理：origin=subagent → 按设计隐藏
  const child = injectWith({
    ids: [sessionId],
    byId: { [sessionId]: { id: sessionId, parentId: "session-parent-0000", origin: "subagent" } },
    current: sessionId,
  });
  check("真子代理（origin=subagent）→ 控件隐藏", child.available === false, JSON.stringify(child.available));

  // ④ 列表里还没有这颗会话（新建中）→ 放行
  const unknown = injectWith({ ids: [], byId: {}, current: undefined });
  check("会话不在列表里（新建中）→ 放行显示", unknown.available === true, JSON.stringify(unknown.available));

  // ⑤ 拿不到列表服务（老宿主 / 形状变更）→ 放行，绝不因为判据而隐藏
  const noService = (() => {
    const saved = ctx.sessions;
    ctx.sessions = undefined;
    try {
      const registration = applyAndGetRegistration();
      return registration.inject(sessionId);
    } finally { ctx.sessions = saved; }
  })();
  check("拿不到 sessions 服务 → 放行显示（fail-open）", noService.available === true, JSON.stringify(noService.available));

  // ⑥ 判据自身抛异常（getSnapshot 炸）→ 仍然放行
  const broken = injectWith({
    get byId() { throw new Error("列表投影炸了"); },
  });
  check("列表投影抛异常 → 放行显示（fail-open）", broken.available === true, JSON.stringify(broken.available));

  // ⑦ 陷阱：new 的实现**一次都不许**调用 subagentAddress（它一被调用就抛错）
  check("新判据完全不碰 sessions.subagentAddress（陷阱未被触发）",
    plain.available === true && child.available === false, "见 ctx.sessions.subagentAddress 的抛错陷阱");

  // ⑧ 隐藏时**不许渲染出可见控件**。注意错误边界会保留一个带 data-effort-slider 的
  //    空壳根节点（样式作用域要靠它），所以断言的是"没有控件本体"，不是"整个为 null"。
  const hidden = renderWith(directorySnapshot(EFFORTS, "max"), { available: false });
  check("available=false 时不渲染控件本体（没有 es-pill / es-orb 可见空壳）",
    hidden.includes("data-effort-slider") && !hidden.includes("es-pill") && !hidden.includes("es-orb"),
    String(hidden).slice(0, 160));
}

/* ── 回归：取模型目录抛错时**不许**隐藏控件 ──────────────────────────────
   2026-10-01 现场（用户："解决重启后看不到滑动条的问题"）：
     `ctx.modelDirectories.directoryFor(sessionId)` 在会话作用域还没起来时按设计抛错
     （ui-model-selection: session "…" resolved no scope / no binding）。旧实现把
     "取目录"和"判子代理"塞进同一个 try，catch 命中就返回 {available:false,store:null}
     —— 一次启动期抖动 → **永久隐身**，没有重试，日志也不说原因。
     证据：mount 心跳里的 store=no（非降级路径必定带真 store，所以只可能来自降级路径）。 */
console.log("[4c] 取模型目录抛错时不许隐藏控件（「重启后看不到滑条」的回归锁）");
{
  const sessionId = "session-00000000-0000-0000-0000-000000000000";
  const deadId = "session-ffffffff-0000-0000-0000-000000000000";   // 永远解析不出目录（测引用稳定性）
  const realStore = makeStore(directorySnapshot(EFFORTS, "max"));
  const savedDir = ctx.modelDirectories;
  let tries = 0;
  ctx.sessionList = { ids: [sessionId], byId: { [sessionId]: { id: sessionId } }, current: sessionId };
  // 前三次抛错（模拟"作用域还没起来"），之后成功 —— 检验它能不能自愈。
  // 注意次数：inject 里第 1 次、适配器构造第 2 次、第一次 getSnapshot 第 3 次。
  // deadId 永远抛错，用来验证"反复 inject 拿到的必须是同一个适配器实例"。
  ctx.modelDirectories = {
    directoryFor(id) {
      if (id === deadId) throw new Error(`ui-model-selection: session "${id}" resolved no binding`);
      tries += 1;
      if (tries <= 3) throw new Error(`ui-model-selection: session "${id}" resolved no scope`);
      return { store: realStore, load: () => Promise.resolve(), select: () => Promise.resolve() };
    },
  };
  registered = null;
  plugin.apply(ctx);
  const r = registered.registration.inject(sessionId);
  check("取目录抛错时 available 仍为 true（绝不因为内部错误隐藏控件）",
    r.available === true, JSON.stringify(r.available));
  check("取目录抛错时给出可用 store 形状（getSnapshot + subscribe）",
    !!r.store && typeof r.store.getSnapshot === "function" && typeof r.store.subscribe === "function",
    String(r.store && typeof r.store.getSnapshot));
  const firstSnap = r.store.getSnapshot();
  check("未解析时给 ModelDirectory 正规空快照（组件走加载态，而不是 count=0 的残缺控件）",
    !!firstSnap && firstSnap.status === "idle" && Array.isArray(firstSnap.groups) && firstSnap.groups.length === 0,
    JSON.stringify(firstSnap));
  const healed = r.store.getSnapshot();   // 第三次调用成功 → 自愈
  check("自愈：目录可解析后 getSnapshot 自动接上真 store（用户不用刷新/重启）",
    healed !== firstSnap && healed && healed.status !== "idle", JSON.stringify(healed && healed.status));
  check("自愈状态可诊断（retryState.resolved=true）",
    r.store.retryState().resolved === true, JSON.stringify(r.store.retryState()));
  check("取目录抛错不会让 inject 自己抛出去（插槽安全）", typeof r.commit === "function", String(r.commit));

  /* ★ 引用稳定性（无限重渲染的回归锁）：`inject` 会被反复调用，若每次都新建适配器，
     组件拿到的 store prop 每次换引用 → useSyncExternalStore 判定变了 → 重渲染 → 又新建
     → 无限循环。本插件第一版就是这么把渲染进程搞卡的，所以引用必须稳定。 */
  const d1 = registered.registration.inject(deadId);
  const d2 = registered.registration.inject(deadId);
  check("同一会话反复 inject 返回同一个 store 实例（否则无限重渲染）",
    d1.store === d2.store, `${d1.store === d2.store ? "同一实例" : "两个不同实例 ❌"}`);
  check("未解析时快照引用稳定（模块级共享 EMPTY，Object.is 成立）",
    d1.store.getSnapshot() === d2.store.getSnapshot(), "EMPTY_MODEL_SNAPSHOT 共享引用");
  check("不同会话拿到各自独立的适配器（不串会话）",
    d1.store !== r.store, d1.store === r.store ? "❌ 串了" : "各自独立");
  check("永远解析不出来的会话也不隐藏控件（available 仍为 true）",
    d1.available === true, JSON.stringify(d1.available));
  // 收拾现场：后面的用例还要用原始 ctx
  ctx.modelDirectories = savedDir;
  ctx.sessionList = undefined;
}

/* ── 回归：目录"拿到了但已失效/未加载"时必须自愈 ────────────────────────
   2026-10-01 现场（用户："一直提示档位切换失败"）：
     宿主日志 `mount 失败（hidden count=0 store=yes available=true status=idle）`
     —— 目录拿到了（store=yes），但 store 停在 `idle`、count=0。旧实现是在 inject 那一刻
     **把目录抓一次揣着用**，于是：
       · load/select 都打在这个（可能已失效 / 属于上一代 / 被 dispose 的）目录上；
       · `select()` 的拒绝被静默吞掉，只留下用户可见的"切换失败，已回到原档位。"；
       · 日志里查不到任何原因（客户端心跳还漏发 `note` 字段 —— 白名单式发送，不写就不发）。
     修法：一律走适配器 + load/commit **在调用时重新解析目录** + 失败上报心跳。 */
console.log("[4d] 目录失效/未加载时必须自愈（「一直提示档位切换失败」的回归锁）");
{
  const sessionId = "session-deadbeef-0000-0000-0000-000000000000";
  const savedDir = ctx.modelDirectories;
  const idleSnap = { current: null, routable: null, groups: [], failures: [], status: "idle", error: null };
  const goodStore = makeStore(directorySnapshot(EFFORTS, "max"));
  let healthy = false;
  let loadCalls = 0;
  let selectCalls = 0;
  const failMsg = "model selection is unavailable for addressed subagent sessions";
  const deadDir = {
    store: { getSnapshot: () => idleSnap, subscribe: () => () => {} },
    load: () => { loadCalls += 1; return Promise.reject(new Error(failMsg)); },
    select: () => { selectCalls += 1; return Promise.reject(new Error(failMsg)); },
  };
  const goodDir = {
    store: goodStore,
    load: () => { loadCalls += 1; return Promise.resolve(); },
    select: () => { selectCalls += 1; return Promise.resolve(); },
  };
  ctx.sessionList = { ids: [sessionId], byId: { [sessionId]: { id: sessionId } }, current: sessionId };
  ctx.modelDirectories = { directoryFor: () => (healthy ? goodDir : deadDir) };
  registered = null;
  plugin.apply(ctx);
  const r = registered.registration.inject(sessionId);

  check("目录存在但停在 idle 时，控件仍然显示（不隐身）", r.available === true, JSON.stringify(r.available));
  check("未加载时给 idle 空快照（组件渲染加载态，不是 count=0 的残缺控件）",
    r.store.getSnapshot().status === "idle", JSON.stringify(r.store.getSnapshot().status));

  healthy = true;
  const healed = r.store.getSnapshot();
  check("目录恢复后 store 自动接上真数据（不需要刷新或重启）",
    !!healed && healed.status !== "idle", JSON.stringify(healed && healed.status));

  // ★ 核心：commit 必须在**调用时**重新解析目录，而不是用 inject 那一刻的旧引用
  healthy = false;
  const deadResult = await r.commit({ provider: "p", model: "m", reasoningEffort: "max" });
  check("目录失效时 commit 返回 false（组件据此提示失败）", deadResult === false, String(deadResult));
  check("失效时也真的调用了 select（不是提前 return false）", selectCalls >= 1, String(selectCalls));

  healthy = true;
  const goodResult = await r.commit({ provider: "p", model: "m", reasoningEffort: "max" });
  check("★ 目录恢复后同一个控件能提交成功（commit 重新解析目录，不是抓一次揣着用）",
    goodResult === true, String(goodResult));
  check("自愈过程中确实调用过 directory.load()（否则档位永远为空）", loadCalls >= 1, String(loadCalls));

  ctx.modelDirectories = savedDir;
  ctx.sessionList = undefined;
}

check("插槽是 conversation.input.right", ctx.slotName === "conversation.input.right", String(ctx.slotName));
check("样式走 styles.insert 并登记 effect", effects.some((label) => label.includes("styles")), JSON.stringify(effects));

console.log("");
if (failures === 0) {
  console.log("全部通过 ✅");
} else {
  console.log(`${failures} 项失败 ❌`);
  process.exitCode = 1;
}
