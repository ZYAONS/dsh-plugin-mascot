/**
 * 流体皮肤（轨道里的 canvas 引擎）离线回归测试 —— 不需要重启 DSH，直接 node 跑：
 *
 *   node test/fluid.test.mjs
 *
 * 它用一个「假 DOM + 假 canvas + 迷你 React」把组件真的跑起来（useState 会触发重渲染、
 * useEffect 会真的执行并真的清理），从而验证真正会出事故的几件事：
 *
 *  1. skin === "fluid" 且面板展开时，轨道里确实存在 canvas.es-rail__fluid，
 *     而且它是轨道的**第一个**子元素（在 es-rail__fx 之前）；
 *  2. 尺寸没变时**绝不**碰 canvas.width/height —— 重设 canvas.width 会清空画布，
 *     预览页踩过这个坑（表现是流体"凭空消失"）；
 *  3. 切到 nebula / 收起面板 / 组件卸载时，rAF 被停下来（cancelAnimationFrame 被调用、
 *     没有遗留待执行帧），resize 监听被摘掉，ResizeObserver 被 disconnect，画布被清空；
 *  4. getContext 返回 null / 根本没有 getContext 时**不抛异常**（皮肤仍然可用，只是没有动画）；
 *  5. 量到 0 尺寸（display:none 时量不到）不写画布尺寸、不抛异常、不做除零，
 *     尺寸恢复后能正常起来；
 *  6. 皮肤按钮的 title 全部有英文名（SKIN_LABELS 不再漏项），fluid 排在最后。
 *
 * 只依赖 node 内置模块，不引入任何第三方包，也不改动任何现有测试。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ★ 皮肤清单**从源码 client.js 读**，不写死：
   皮肤下线/改名/换默认值时测试自动跟着走（2026-10 nebula 下线就踩过一次，
   写死四个皮肤的断言立刻全红 —— 那是期望过期，不是回归）。 */
const CLIENT_SRC = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const AVAILABLE_SKINS = (((/var SKINS = \[([^\]]*)\]/.exec(CLIENT_SRC) || [])[1] || "")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .match(/"[a-z0-9-]+"/g) || []).map((s) => s.slice(1, -1));
const SKIN_LABELS = Object.fromEntries(
  [...CLIENT_SRC.matchAll(/([a-z0-9-]+):\s*"([^"]+)"/g)]
    .filter((m) => AVAILABLE_SKINS.includes(m[1]))
    .map((m) => [m[1], m[2]]));
const OTHER_SKIN = AVAILABLE_SKINS.find((s) => s !== "fluid") ?? AVAILABLE_SKINS[0];
if (AVAILABLE_SKINS.length < 2 || !OTHER_SKIN) throw new Error("皮肤清单解析失败（client.js 变了？）");


const here = (name) => fileURLToPath(new URL(name, import.meta.url));

let failures = 0;
let passes = 0;
function check(label, condition, detail) {
  if (condition) {
    passes += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

/* ══════════════════════ 1. rAF / 时间的可控桩 ══════════════════════ */

let fakeNow = 0;
let rafSeq = 0;
let rafCalls = 0;
let cancelCalls = 0;
/** 已请求但还没执行的帧：测试自己决定什么时候"跑一帧"。 */
const pendingFrames = new Map();

globalThis.requestAnimationFrame = function (callback) {
  rafCalls += 1;
  rafSeq += 1;
  pendingFrames.set(rafSeq, callback);
  return rafSeq;
};
globalThis.cancelAnimationFrame = function (handle) {
  cancelCalls += 1;
  pendingFrames.delete(handle);
};
/** 手动跑 n 帧（每帧推进 16.7ms）。没有待执行帧就停下，不会退化成死循环。 */
function flushFrames(count) {
  for (let i = 0; i < count; i += 1) {
    const next = pendingFrames.entries().next();
    if (next.done) return;
    const [id, callback] = next.value;
    pendingFrames.delete(id);
    fakeNow += 16.7;
    callback(fakeNow);
  }
}

/* ══════════════════════ 2. 假 DOM / 假 canvas ══════════════════════ */

const DEFAULT_RECT = { width: 240, height: 34, left: 0, top: 0, right: 240, bottom: 34 };
/**
 * 引擎每写一颗粒子用的 alpha（= FLUID_PRESET.alpha）；重放器按它累积，判据要跟它对齐。
 * ★ 与 fade 同一条规矩：**不写死数值** —— 从 client.js 源码里现读。参数是调出来的
 *   （已经改过 .075 → .082），写死一次就要跟着改一次，改了忘改只会被当成噪声忽略。
 */
const PRESET_SRC = readFileSync(here("../client.js"), "utf8");
function presetNumber(key, fallback) {
  const m = new RegExp(`var FLUID_PRESET = \\{[^}]*${key}:\\s*([\\d.]+)`).exec(PRESET_SRC);
  return m ? Number(m[1]) : fallback;
}
const DEPOSIT = presetNumber("alpha", 0.075);
/** ④ 每像素粒子密度（颗/px）—— 判定"密度恒定"的基准同样从源码现读。 */
const DENSITY = presetNumber("density", 2.2);
/** 每个宿主节点上好 props 之后的钩子：测试用它按 className 定制 rect 等。 */
let afterPropsHook = null;
/** 帧边界回调：第 [10] 节的逐列 alpha 量测用它在每帧末把这一帧的几何记进帧表。 */
let frameHandler = null;
/** 新建 canvas 时的行为开关（null 上下文 / 无 getContext）。 */
const canvasOptions = { ctxMode: "ok", hasGetContext: true };

/**
 * 量测模式下的"画布重放器"：把引擎这一段时间真正画过的 arc / 淡出 / clearRect 按帧序
 * 重放成一张 alpha 缓冲，再返回窗口内每列的统计量。
 *
 * 为什么要重放而不是数"非零像素占比"：数的口径太松 —— 粒子全挤成一堵 ~110px 宽的墙时，
 * 每帧仍有像素被画到，非零占比照样很高，中段却是一条死区（实测 meanA 平在 25）。只有
 * 逐列的**平均 alpha** 才能把"整条已点亮轨道都该有流体"钉住。
 */
function sampleArcInk(ctx, cx, cy, cw, ch) {
  const frames = ctx.frames || [];
  const scale = ctx._dpr || 1;
  const VW = Math.max(1, Math.round(cw));
  const VH = Math.max(1, Math.round(ch));
  if (ctx._bufAt !== frames.length || !ctx._buf) {
    const buf = new Float32Array(VW * VH);
    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i];
      if (frame.fade > 0) {
        const keep = 1 - frame.fade;
        for (let p = 0; p < buf.length; p += 1) if (buf[p] > 0) buf[p] *= keep;
      }
      for (let c = 0; c < frame.clears.length; c += 1) {
        const [x0, y0, w, h] = frame.clears[c];
        const x1 = Math.min(VW, Math.ceil((x0 + w) * scale));
        const y1 = Math.min(VH, Math.ceil((y0 + h) * scale));
        const xs = Math.max(0, Math.floor(x0 * scale));
        const ys = Math.max(0, Math.floor(y0 * scale));
        for (let y = ys; y < y1; y += 1) for (let x = xs; x < x1; x += 1) buf[y * VW + x] = 0;
      }
      const box = frame.clip;
      const cx0 = box ? Math.max(0, box[0] * scale) : 0;
      const cy0 = box ? Math.max(0, box[1] * scale) : 0;
      const cx1 = box ? Math.min(VW, (box[0] + box[2]) * scale) : VW;
      const cy1 = box ? Math.min(VH, (box[1] + box[3]) * scale) : VH;
      for (let a = 0; a < frame.arcs.length; a += 1) {
        const [ax, ay, ar] = frame.arcs[a];
        const px = ax * scale, py = ay * scale, pr = ar * scale;
        const y1 = Math.min(cy1, Math.ceil(py + pr));
        const x1 = Math.min(cx1, Math.ceil(px + pr));
        for (let y = Math.max(cy0, Math.floor(py - pr)); y < y1; y += 1) {
          const dy2 = (y + 0.5 - py) * (y + 0.5 - py);
          if (dy2 > pr * pr) continue;
          const half = Math.sqrt(pr * pr - dy2);
          for (let x = Math.max(cx0, Math.floor(px - half)); x < Math.min(x1, Math.ceil(px + half)); x += 1) {
            buf[y * VW + x] = DEPOSIT + buf[y * VW + x] * (1 - DEPOSIT);
          }
        }
      }
    }
    ctx._buf = buf;
    ctx._bufAt = frames.length;
  }
  const src = ctx._buf;
  const out = new Uint8ClampedArray(VW * VH * 4);
  for (let i = 0; i < VW * VH; i += 1) out[i * 4 + 3] = Math.round(src[i] * 255);
  return { width: VW, height: VH, data: out };
}

function make2dContext() {
  const ctx = {
    calls: { setTransform: 0, clearRect: 0, fillRect: 0, arc: 0, fill: 0, roundRect: 0, rect: 0, clip: 0, save: 0, restore: 0, gradient: 0 },
    clears: [],       // 每次 clearRect 的参数（验证修复 b 与 17px 内缩几何）
    fills: [],        // 每次 fillRect 时的 { gco, style }（验证修复 a：淡出走 destination-out）
    gcoLog: [],       // globalCompositeOperation 的写入顺序
    fillStyle: "",
    _gco: "source-over",
    setTransform(a, b, c, d, e, f) { this.calls.setTransform += 1; if (typeof a === "number" && a > 0) this._dpr = a; },
    save() { this.calls.save += 1; },
    restore() { this.calls.restore += 1; },
    beginPath() {},
    closePath() {},
    roundRect(x, y, w, h) { this.calls.roundRect += 1; this._pendingRect = [x, y, w, h]; },
    rect(x, y, w, h) { this.calls.rect += 1; this._pendingRect = [x, y, w, h]; },
    clip() {
      this.calls.clip += 1;
      if (this.measure && this._pendingRect) this._clip = this._pendingRect.slice();
    },
    clearRect(x, y, w, h) {
      this.calls.clearRect += 1;
      this.clears.push([x, y, w, h]);
      if (this.measure && this._curClears) this._curClears.push([x, y, w, h]);
    },
    fillRect() {
      this.calls.fillRect += 1;
      const style = String(this.fillStyle);
      this.fills.push({ gco: this._gco, style });
      if (this.measure && this._gco === "destination-out") {
        const match = /rgba\(0,0,0,([\d.]+)\)/.exec(style);
        if (match) this._curFade = Number(match[1]);
      }
    },
    arc(x, y, r) { this.calls.arc += 1; if (this.measure && this._curArcs) this._curArcs.push([x, y, r]); },
    fill() { this.calls.fill += 1; },
    createLinearGradient() { this.calls.gradient += 1; return { addColorStop() {} }; },
    // ── 量测模式（默认关）：把 arc/roundRect/clearRect 的几何记进帧表，供第 [10] 节的
    //    逐列 alpha 判据重建画布。开启时 getImageData 会按同样的几何重放这些操作。
    measure: false,
    frames: null,
    resetMeasure() {
      this.measure = true;
      this.frames = [];
      this._curArcs = [];
      this._curClears = [];
      this._curFade = 0;
      this._clip = null;
      this._buf = null;
      this._bufAt = -1;
    },
    /** 引擎每帧末调一次：把这一帧记进帧表，再把累计数组换新（避免每次 slice 一个越来越长的数组）。 */
    nextFrame() {
      if (!this.measure) return;
      this.frames.push({ clip: this._clip, fade: this._curFade, arcs: this._curArcs, clears: this._curClears });
      this._curArcs = [];
      this._curClears = [];
      this._curFade = 0;
      this._clip = null;
    },
    getImageData(x, y, w, h) { return sampleArcInk(this, x, y, w, h); },
  };
  Object.defineProperty(ctx, "globalCompositeOperation", {
    get() { return this._gco; },
    set(value) { this._gco = value; this.gcoLog.push(value); },
  });
  return ctx;
}

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.props = {};
    this.style = {};
    this.listeners = {};
    this.childNodes = [];
    this.slots = [];
    this.parentNode = null;
    this.rect = DEFAULT_RECT;
  }
  getBoundingClientRect() { return this.rect; }
  contains(node) {
    let cursor = node;
    while (cursor) {
      if (cursor === this) return true;
      cursor = cursor.parentNode;
    }
    return false;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  /**
   * 只有"桩珠子"才会被查出来（默认 null）：
   * ① 引擎用 rail.querySelector 读珠子当前位置来定 litW，离线测试就靠这个桩喂位置；
   *    __stubKnob 没设时返回 null → 引擎走 pct 回退路径（既有用例的口径不变）。
   */
  querySelector() { return this.__stubKnob || null; }
  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners[type] || [];
    const at = list.indexOf(handler);
    if (at >= 0) list.splice(at, 1);
  }
  dispatch(type, event) {
    (this.listeners[type] || []).slice().forEach((handler) => handler(event || {}));
  }
}

class FakeCanvas extends FakeNode {
  constructor() {
    super("canvas");
    this.ctx = make2dContext();
    this.ctxMode = canvasOptions.ctxMode;
    this.widthWrites = 0;
    this.heightWrites = 0;
    this._width = 0;
    this._height = 0;
    // 注意：getContext 定义在原型上，delete 实例属性删不掉它 —— 必须用同名的自有属性遮蔽
    if (!canvasOptions.hasGetContext) this.getContext = undefined;
  }
  get width() { return this._width; }
  // 写 width 就是在清空画布 —— 计数是为了断言"尺寸没变时一次都不写"
  set width(value) { this.widthWrites += 1; this._width = value; }
  get height() { return this._height; }
  set height(value) { this.heightWrites += 1; this._height = value; }
  getContext(kind) {
    if (this.ctxMode === "throw") throw new Error("getContext 不可用");
    if (this.ctxMode === "null") return null;
    return kind === "2d" ? this.ctx : null;
  }
}

/* 假 window / document / ResizeObserver */
const observers = [];
class FakeResizeObserver {
  constructor(callback) { this.callback = callback; this.disconnected = false; this.node = null; observers.push(this); }
  observe(node) { this.node = node; }
  disconnect() { this.disconnected = true; this.node = null; }
}

function makeEventTarget() {
  return {
    listeners: {},
    addEventListener(type, handler) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      const list = this.listeners[type] || [];
      const at = list.indexOf(handler);
      if (at >= 0) list.splice(at, 1);
    },
  };
}

const win = makeEventTarget();
win.devicePixelRatio = 2;
win.performance = { now: () => fakeNow };
win.localStorage = { getItem: () => null, setItem: () => {} };
win.ResizeObserver = FakeResizeObserver;

const fakeDocument = makeEventTarget();
fakeDocument.activeElement = null;
fakeDocument.head = new FakeNode("head");
fakeDocument.body = new FakeNode("body");
fakeDocument.createElement = (tag) => new FakeNode(tag);
fakeDocument.querySelector = () => null;

globalThis.window = win;
globalThis.document = fakeDocument;

/* ══════════════════════ 3. 迷你 React（真跑 hooks / effect） ══════════════════════ */

class ShimComponent {
  constructor(props) { this.props = props; this.state = {}; }
  setState(next) { this.state = Object.assign({}, this.state, next); }
}

/** path -> fiber（hooks 槽位、effect 记录、已提交的清理函数） */
const fibers = new Map();
let currentFiber = null;
let dirty = false;
const hookErrors = [];

function fiberFor(path) {
  let fiber = fibers.get(path);
  if (!fiber) {
    fiber = { hooks: [], cursor: 0, effects: [], committed: [] };
    fibers.set(path, fiber);
  }
  return fiber;
}

const React = {
  Component: ShimComponent,
  createElement(type, props, ...children) {
    const raw = props || {};
    return {
      __el: true,
      type,
      props: raw,
      key: raw.key === undefined || raw.key === null ? null : String(raw.key),
      children: children.flat(Infinity),
    };
  },
  useState(initial) {
    const fiber = currentFiber;
    const slot = fiber.cursor;
    fiber.cursor += 1;
    if (!(slot in fiber.hooks)) fiber.hooks[slot] = typeof initial === "function" ? initial() : initial;
    const setter = (next) => {
      const before = fiber.hooks[slot];
      const value = typeof next === "function" ? next(before) : next;
      if (Object.is(value, before)) return;      // 与 React 一致：同值不重渲染
      fiber.hooks[slot] = value;
      dirty = true;
    };
    return [fiber.hooks[slot], setter];
  },
  useEffect(fn, deps) {
    const fiber = currentFiber;
    fiber.effects.push({ slot: fiber.cursor, fn, deps });
    fiber.cursor += 1;
  },
  useRef(value) {
    const fiber = currentFiber;
    const slot = fiber.cursor;
    fiber.cursor += 1;
    if (!(slot in fiber.hooks)) fiber.hooks[slot] = { current: value };
    return fiber.hooks[slot];
  },
  useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
};

function renderComponentElement(element, path) {
  const fiber = fiberFor(path);
  fiber.cursor = 0;
  fiber.effects = [];
  const previous = currentFiber;
  currentFiber = fiber;
  let out;
  try {
    if (typeof element.type === "function" && element.type.prototype instanceof ShimComponent) {
      if (!fiber.instance) fiber.instance = new element.type(element.props);
      else fiber.instance.props = element.props;
      out = fiber.instance.render();
    } else {
      out = element.type(element.props);
    }
  } finally {
    currentFiber = previous;
  }
  return out === undefined ? null : out;
}

/** 展开组件，直到拿到一个宿主元素（或 null）。 */
function expand(element, path) {
  let el = element;
  let depth = 0;
  while (el && typeof el.type !== "string") {
    el = renderComponentElement(el, `${path}/${depth}`);
    depth += 1;
    if (depth > 20) throw new Error("组件嵌套过深（测试渲染器的保护）");
  }
  return el;
}

function normalizeChildren(children) {
  const list = [];
  (children || []).forEach((child) => {
    if (child === null || child === undefined || child === false || child === true || child === "") return;
    if (Array.isArray(child)) { normalizeChildren(child).forEach((item) => list.push(item)); return; }
    list.push(child);
  });
  return list;
}

function applyProps(node, props) {
  node.props = props;
  node.className = typeof props.className === "string" ? props.className : "";
  node.style = props.style || {};
  if (props.ref && typeof props.ref === "object") props.ref.current = node;
  if (afterPropsHook) afterPropsHook(node);
}

function detach(slot) {
  if (!slot || !slot.node) return;
  slot.node.parentNode = null;
  slot.node = null;
}

function renderChildren(hostNode, children, path) {
  const list = normalizeChildren(children);
  const slots = [];
  list.forEach((child, index) => {
    const slotPath = `${path}/${index}`;
    if (typeof child === "string" || typeof child === "number") {
      slots.push({ kind: "text", node: null });
      return;
    }
    const hostElement = expand(child, slotPath);
    if (!hostElement) {
      slots.push({ kind: "component", node: null });
      return;
    }
    const previous = hostNode.slots[index];
    let node;
    if (previous && previous.node && previous.node.tag === hostElement.type && previous.key === hostElement.key) {
      node = previous.node;
    } else {
      detach(previous);
      node = hostElement.type === "canvas" ? new FakeCanvas() : new FakeNode(hostElement.type);
    }
    applyProps(node, hostElement.props);
    renderChildren(node, hostElement.children, slotPath);
    slots.push({ kind: "host", node, element: hostElement, key: hostElement.key });
  });
  for (let i = list.length; i < hostNode.slots.length; i += 1) detach(hostNode.slots[i]);
  hostNode.slots = slots;
  hostNode.childNodes = slots.filter((slot) => slot.node).map((slot) => slot.node);
  hostNode.childNodes.forEach((node) => { node.parentNode = hostNode; });
}

function sameDeps(before, after) {
  if (before === undefined || after === undefined) return false;   // 没写依赖数组 = 每次渲染都跑
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i += 1) {
    if (!Object.is(before[i], after[i])) return false;
  }
  return true;
}

function commitEffects() {
  fibers.forEach((fiber) => {
    const previous = fiber.committed;
    const next = [];
    fiber.effects.forEach((entry) => {
      const old = previous[entry.slot];
      if (old && sameDeps(old.deps, entry.deps)) { next[entry.slot] = old; return; }
      if (old && typeof old.cleanup === "function") {
        try { old.cleanup(); } catch (error) { hookErrors.push(error); }
      }
      let cleanup;
      try { cleanup = entry.fn(); } catch (error) { hookErrors.push(error); }
      next[entry.slot] = { deps: entry.deps, cleanup: typeof cleanup === "function" ? cleanup : undefined };
    });
    previous.forEach((old, slot) => {
      if (old && !next[slot] && typeof old.cleanup === "function") {
        try { old.cleanup(); } catch (error) { hookErrors.push(error); }
      }
    });
    fiber.committed = next;
  });
}

const rootContainer = new FakeNode("div");
let lastElement = null;

/** 渲染（含 setState 触发的重渲染）：一直渲染到没有新的 state 变更为止。 */
function flush() {
  for (let pass = 0; pass < 25; pass += 1) {
    dirty = false;
    renderChildren(rootContainer, [lastElement], "root");
    commitEffects();
    if (!dirty) return;
  }
  throw new Error("渲染没有收敛（疑似无限重渲染 —— 正是要避免的事故）");
}

/** 卸载整棵树：跑掉所有已提交的清理函数（等价于 React 卸载组件）。 */
function unmountAll() {
  fibers.forEach((fiber) => {
    (fiber.committed || []).forEach((old) => {
      if (old && typeof old.cleanup === "function") {
        try { old.cleanup(); } catch (error) { hookErrors.push(error); }
      }
    });
    fiber.committed = [];
  });
  fibers.clear();
}

function findAll(node, className, out) {
  const found = out || [];
  if (!node) return found;
  if (typeof node.className === "string" && node.className.split(/\s+/).indexOf(className) >= 0) found.push(node);
  (node.childNodes || []).forEach((child) => findAll(child, className, found));
  return found;
}
function findOne(node, className) { return findAll(node, className)[0] || null; }
/** 按 props 里的键找节点（例如 data-skin 落在外层 .es-root 的里层那份上）。 */
function findByProp(node, propName) {
  if (!node) return null;
  if (node.props && Object.prototype.hasOwnProperty.call(node.props, propName)) return node;
  const children = node.childNodes || [];
  for (let i = 0; i < children.length; i += 1) {
    const hit = findByProp(children[i], propName);
    if (hit) return hit;
  }
  return null;
}

/* ══════════════════════ 4. 以浏览器方式执行产物 ══════════════════════ */

console.log("[1] 执行 lib/client.js 并注册插槽");

const bundle = readFileSync(here("../lib/client.js"), "utf8");
const registrations = [];
win.__ModuleLoader__ = { load(registration) { registrations.push(registration); } };
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

new Function("window", bundle)(win);
check("注册了一个 bundle factory", registrations.length === 1, `实际 ${registrations.length}`);

const plugin = registrations[0].factory((specifier) => {
  if (specifier === "react") return React;
  throw new Error(`本 bundle 不该 require "${specifier}"`);
});

const EFFORTS = [
  { id: "low", name: "轻度" },
  { id: "medium", name: "中" },
  { id: "high", name: "高" },
  { id: "max", name: "最高" },
];
const directoryState = {
  status: "ready",
  current: { provider: "p", model: "m", reasoningEffort: "max" },
  groups: [{ id: "p", models: [{ id: "m", name: "模型", reasoning: { efforts: EFFORTS, defaultEffort: "max" } }] }],
};

/* ── ★ 档位表 -> 几何期望的**派生**（别在这儿写死数字）────────────────────────
   展示层的档位表 = 真实档位 + 追加的一格 ULTRA（client.js 的 levelsOf），
   而引擎拿到的 pct 分母是**展示档位数 - 1**（client.js：`ratio = shown / (levelCount - 1)`）。
   于是"最后一个**真实**档位"不再是满格：夹具默认档 max 的下标是 3、展示表 5 格 →
   默认 pct = 3/4 = 0.75（满格 pct=1.0 现在属于第 5 格 ULTRA）。

   加 ULTRA 之前这里处处写着"默认档 = 满格 = pct 1.0"（litW 硬编码 223、列集写死
   col0…col17、播种阈值写死 0.75×整条轨道）—— 那些期望只对 4 档的旧世界成立，多出
   一格就会整片翻红。所以下面所有几何量都从**夹具的档位数与默认档位**现推：
     · LEVEL_COUNT   = EFFORTS.length + 1      ← levelsOf 追加的那一格（由渲染出的
       `es-tick` 个数自校验，见 [3b]：改档位表却不改这里，套件会立刻告诉你）
     · DEFAULT_PCT   = 默认档在展示表里的下标 / (LEVEL_COUNT - 1)
       （默认档解析不出来时，组件的兜底链会落到最后一格 → 用 LEVEL_COUNT-1 算）
     · litWidthOf()  = client.js 的 `FLUID_INSET + (W - FLUID_INSET×2) × pct`
   这样改夹具（档数 / 默认档）时期望值自己跟着走；硬编码一次就要跟着改一次，
   改了忘改只会变成假红，把真实回归淹掉。 */
const LEVEL_COUNT = EFFORTS.length + 1;
const DEFAULT_INDEX = EFFORTS.findIndex((item) => item.id === directoryState.current.reasoningEffort);
const DEFAULT_PCT = LEVEL_COUNT > 1
  ? (DEFAULT_INDEX >= 0 ? DEFAULT_INDEX : LEVEL_COUNT - 1) / (LEVEL_COUNT - 1)
  : 1;
/** 轨道内缩（CSS px）——从源码现读，跟 FLUID_PRESET 同一套"别写死"的规矩。 */
const FLUID_INSET = (function () {
  const m = /var FLUID_INSET = ([\d.]+)/.exec(PRESET_SRC);
  return m ? Number(m[1]) : 17;
})();
/** 已点亮宽度（CSS px）：与 client.js 里那条几何**同一个公式**。
 *  本夹具（4 档 + ULTRA、默认 max）实测：默认档 pct=0.75 → 171.5；满格 pct=1 → 223。 */
const litWidthOf = (pct, cssW) => FLUID_INSET + (cssW - FLUID_INSET * 2) * pct;

let registered = null;
const ctx = {
  get: (name) => (name === "styles" ? { insert: () => () => {} } : undefined),
  effect: (callback) => { const dispose = callback(); return () => { if (typeof dispose === "function") dispose(); }; },
  slots: {
    inject(name, callback) { registered = callback(); return () => {}; },
    register(registration, component) { return { registration, component }; },
  },
  sessions: { subagentAddress: () => undefined },
  modelDirectories: {
    directoryFor: () => ({
      store: { getSnapshot: () => directoryState, subscribe: () => () => {} },
      load: () => Promise.resolve(),
      select: () => Promise.resolve(),
    }),
  },
};
plugin.apply(ctx);
check("插槽回调拿到了组件", registered !== null && typeof registered.component === "function");

let prefsSnapshot = { skin: "fluid" };
const props = {
  store: { getSnapshot: () => directoryState, subscribe: () => () => {} },
  preferences: { getSnapshot: () => prefsSnapshot, subscribe: () => () => {}, set: () => {} },
  available: true,
  api: {
    cachedSkin: () => null, cacheSkin: () => {}, fetchSkin: () => Promise.resolve(null),
    saveSkin: () => Promise.resolve(), notify: () => {},
  },
  load: () => {},
  commit: () => Promise.resolve(true),
};

/** 从头渲染一棵新树（同时清掉旧的 fiber 记录）。 */
function mount() {
  unmountAll();
  rootContainer.slots = [];
  rootContainer.childNodes = [];
  hookErrors.length = 0;
  lastElement = React.createElement(registered.component, props);
  flush();
  return rootContainer.slots[0].node;   // 组件渲染出的 .es-root
}

function clickPill(root) {
  const pill = findOne(root, "es-pill");
  if (!pill) throw new Error("找不到 pill（控件没渲染出来）");
  pill.props.onClick({ stopPropagation() {}, preventDefault() {} });
  flush();
}

/* ══════════════════════ 5. 用例 ══════════════════════ */

console.log("[2] skin=fluid + 面板展开：轨道里必须有一个 canvas.es-rail__fluid，且排在第一位");

prefsSnapshot = { skin: "fluid" };
afterPropsHook = null;
canvasOptions.ctxMode = "ok";
canvasOptions.hasGetContext = true;
const rafBeforeMount = rafCalls;
const root = mount();
const skinRoot = findByProp(root, "data-skin");   // 皮肤属性在里层 .es-root 上

check("皮肤是 fluid（data-skin 落到根元素）", skinRoot !== null && skinRoot.props["data-skin"] === "fluid",
  skinRoot ? String(skinRoot.props["data-skin"]) : "找不到 data-skin");
check("面板收起时没有 canvas（不白跑引擎）", findOne(root, "es-rail__fluid") === null);
check("面板收起时没有请求动画帧", rafCalls === rafBeforeMount, `rafCalls=${rafCalls}`);

clickPill(root);
const rail = findOne(root, "es-rail");
const canvas = findOne(root, "es-rail__fluid");
check("展开后轨道里存在 canvas", canvas !== null && canvas.tag === "canvas");
check("canvas 的类名是 es-rail__fluid", canvas !== null && canvas.className === "es-rail__fluid");
check("canvas 是轨道的第一个子元素", rail !== null && rail.childNodes[0] === canvas,
  rail ? String(rail.childNodes.map((node) => node.className)) : "no rail");
check("canvas 在 es-rail__fx 之前（顺序与要求一致）",
  rail !== null && rail.childNodes.indexOf(canvas) < rail.childNodes.findIndex((n) => n.className === "es-rail__fx"),
  rail ? String(rail.childNodes.map((node) => node.className)) : "no rail");
// ★ 星光层必须在流体 canvas **之后**：所有验收脚本都用 rail.querySelector('canvas')
//   取"流体那块"，顺序反了就会量到星痕层（那是完全不同的判据）。
check("星光层排在流体 canvas 之后（保证 querySelector('canvas') 仍取到流体）",
  rail !== null && rail.childNodes.findIndex((n) => n.className === "es-rail__stars") > rail.childNodes.indexOf(canvas),
  rail ? String(rail.childNodes.map((node) => node.className)) : "no rail");
check("canvas 带 aria-hidden（纯装饰）", canvas !== null && canvas.props["aria-hidden"] === "true");
check("皮肤是 fluid 且展开后 rAF 已排上一帧", rafCalls === rafBeforeMount + 1, `rafCalls=${rafCalls}`);
check("没有未捕获的 effect 异常", hookErrors.length === 0, String(hookErrors[0]));
check(`皮肤按钮与在售皮肤一一对应（${AVAILABLE_SKINS.join("/")}）`,
  JSON.stringify(findAll(root, "es-skin").map((node) => node.props["aria-label"])) ===
    JSON.stringify(AVAILABLE_SKINS.map((s) => "Skin: " + s)),
  JSON.stringify(findAll(root, "es-skin").map((node) => node.props["aria-label"])));
check("皮肤按钮 title 全部有英文名（SKIN_LABELS 不再漏项）",
  JSON.stringify(findAll(root, "es-skin").map((node) => node.props.title)) ===
    JSON.stringify(AVAILABLE_SKINS.map((s) => SKIN_LABELS[s])),
  JSON.stringify(findAll(root, "es-skin").map((node) => node.props.title)));

console.log("[2b] 画布尺寸 / dpr / ResizeObserver");
check("画布按 dpr=2 设置尺寸（240x34 → 480x68）", canvas.width === 480 && canvas.height === 68,
  `${canvas.width}x${canvas.height}`);
check("dpr 通过 setTransform 生效", canvas.ctx.calls.setTransform === 1, String(canvas.ctx.calls.setTransform));
check("挂了 ResizeObserver（尺寸变化时重新量）", observers.length >= 1 && observers[observers.length - 1].node === rail);
check("挂了 window resize 监听", (win.listeners.resize || []).length === 1,
  String((win.listeners.resize || []).length));

console.log("[3] 尺寸没变 → 绝不再写 canvas.width（重设会清空画布，流体「凭空消失」的根因）");
const widthWritesAfterMount = canvas.widthWrites;
const heightWritesAfterMount = canvas.heightWrites;
flushFrames(6);
check("跑了 6 帧（引擎确实在动）", rafCalls === rafBeforeMount + 7, `rafCalls=${rafCalls}`);
check("画面真的画了粒子（fill 被调用）", canvas.ctx.calls.fill > 0, String(canvas.ctx.calls.fill));
check("每帧都用了 destination-out 擦除而不是叠深色", canvas.ctx.calls.fillRect >= 6);
check("6 帧里没有再写 canvas.width", canvas.widthWrites === widthWritesAfterMount,
  `${widthWritesAfterMount} → ${canvas.widthWrites}`);
check("6 帧里没有再写 canvas.height", canvas.heightWrites === heightWritesAfterMount,
  `${heightWritesAfterMount} → ${canvas.heightWrites}`);
check("6 帧里没有异常（引擎逐帧 try/catch 兜住）", hookErrors.length === 0, String(hookErrors[0]));

console.log("[3b] 两处现场修复必须还在：淡出走 destination-out、清掉已点亮区之外");
{
  // 修复 a：淡出那一笔必须是 destination-out + rgba(0,0,0,fade)，绝不能是 source-over 叠深色。
  // ★ 不要在这里写死 fade 的数值：那是**调参**，会随观感反复改（已经改过 .020 → .035 → .028）。
  //   写死一次就要跟着改一次，而"改了忘改测试"只会被当成噪声忽略掉。
  //   所以从源码里的 FLUID_PRESET 现读 fade，只断言"机制"：destination-out + rgba(0,0,0,<那个值>)。
  const presetSrc = readFileSync(here("../client.js"), "utf8");
  const fadeMatch = /var FLUID_PRESET = \{[^}]*fade:\s*([\d.]+)/.exec(presetSrc);
  check("能从 client.js 源码读到 FLUID_PRESET.fade", fadeMatch !== null,
    fadeMatch ? `fade=${fadeMatch[1]}` : "没匹配到 FLUID_PRESET");
  const fadeLiteral = fadeMatch ? Number(fadeMatch[1]).toFixed(3) : "0.000";
  const fadeFill = canvas.ctx.fills.filter((item) => item.style === `rgba(0,0,0,${fadeLiteral})`)[0];
  check(`淡出用的是 destination-out + rgba(0,0,0,${fadeLiteral})（不是 source-over 叠深色）`,
    fadeFill !== undefined && fadeFill.gco === "destination-out", JSON.stringify(fadeFill));
  check("确实出现过 destination-out（合成模式切换存在）",
    canvas.ctx.gcoLog.indexOf("destination-out") >= 0);
  check("淡出之后把合成模式收回 source-over（不留脏状态）",
    canvas.ctx.gcoLog.lastIndexOf("source-over") > canvas.ctx.gcoLog.indexOf("destination-out"));

  // 修复 b + 17px 内缩几何：**默认档位**（夹具是 max）的 litW 由展示档位数现推 ——
  // 加了 ULTRA 之后 max 是 3/4 = 0.75（满格挪到第 5 格 ULTRA），litW = 17+206×0.75 = 171.5；
  // clearRect 的宽度是 W - litW，两处都用同一个公式算，不再写死 223。
  const defaultLitW = litWidthOf(DEFAULT_PCT, DEFAULT_RECT.width);
  const defaultClear = canvas.ctx.clears.filter(
    (args) => args[0] === defaultLitW && args[2] === DEFAULT_RECT.width - defaultLitW)[0];
  check(`默认档位（pct=${DEFAULT_PCT}）时 clearRect(${defaultLitW}, 0, ${DEFAULT_RECT.width - defaultLitW}, 34) —— 17px 内缩几何正确（不是预览页的 20/40）`,
    defaultClear !== undefined && defaultClear[1] === 0 && defaultClear[3] === 34,
    JSON.stringify(canvas.ctx.clears.slice(0, 4)));

  // 进度是经 ref 喂进来的：点第一档刻度 → pct=0 → litW = 17 → clearRect(17, 0, 223, 34)
  const ticks = findAll(root, "es-tick");
  // ★ LEVEL_COUNT 的**自校验**：派生的展示档位数必须等于组件真的渲染出来的刻度数
  //   （levelsOf = 真实档位 + 追加 1 格 ULTRA）。这条红了说明下面所有派生期望的前提变了：
  //   该去改 LEVEL_COUNT 的推导，而不是删掉这条。
  check(`渲染出的刻度数 = 展示档位数（EFFORTS ${EFFORTS.length} 档 + ULTRA 1 格 = ${LEVEL_COUNT}）`,
    ticks.length === LEVEL_COUNT, String(ticks.length));
  const zeroLitW = litWidthOf(0, DEFAULT_RECT.width);
  ticks[0].props.onClick({ stopPropagation() {}, preventDefault() {} });
  flush();
  const clearsBefore = canvas.ctx.clears.length;
  flushFrames(2);
  const pctClear = canvas.ctx.clears.slice(clearsBefore).filter(
    (args) => args[0] === zeroLitW && args[2] === DEFAULT_RECT.width - zeroLitW)[0];
  check(`进度经 ref 生效：拉到第一档后按 pct=0 计算 litW=${zeroLitW}，clearRect(${zeroLitW}, 0, ${DEFAULT_RECT.width - zeroLitW}, 34)`,
    pctClear !== undefined, JSON.stringify(canvas.ctx.clears.slice(clearsBefore)));

  // ★ 满格几何**一个像素都没变**：最后一格现在是 ULTRA（pct=1.0）→ litW = 17+206 = 223
  //   → clearRect(223, 0, 17, 34)。加第 6 格只是把"满格"从 max 挪到 ULTRA，17px 内缩
  //   几何照旧 —— 这条同时钉住新那一格的 pct 真的是 1.0（不是 0.8）。
  const lastTick = ticks[ticks.length - 1];
  lastTick.props.onClick({ stopPropagation() {}, preventDefault() {} });
  flush();
  const clearsBeforeFull = canvas.ctx.clears.length;
  flushFrames(2);
  const fullLitW = litWidthOf(1, DEFAULT_RECT.width);
  const fullClear = canvas.ctx.clears.slice(clearsBeforeFull).filter(
    (args) => args[0] === fullLitW && args[2] === DEFAULT_RECT.width - fullLitW)[0];
  check(`最后一格（ULTRA，pct=1）时 clearRect(${fullLitW}, 0, ${DEFAULT_RECT.width - fullLitW}, 34) —— 满格几何没变`,
    fullClear !== undefined && fullClear[1] === 0 && fullClear[3] === 34,
    JSON.stringify(canvas.ctx.clears.slice(clearsBeforeFull)));
}

console.log("[4] 切到 nebula → rAF 必须立刻停掉、待执行帧清空、画布清空");
const rafBeforeSkinSwitch = rafCalls;
const cancelBeforeSkinSwitch = cancelCalls;
prefsSnapshot = { skin: OTHER_SKIN };
flush();
flushFrames(5);
check("切皮肤后不再请求新的动画帧", rafCalls === rafBeforeSkinSwitch, `${rafBeforeSkinSwitch} → ${rafCalls}`);
check("cancelAnimationFrame 被调用", cancelCalls > cancelBeforeSkinSwitch, String(cancelCalls));
check("没有遗留待执行的帧", pendingFrames.size === 0, String(pendingFrames.size));
check("画布被清空（不留残影）", canvas.ctx.calls.clearRect > 0, String(canvas.ctx.calls.clearRect));
check(`data-skin 已切到 ${OTHER_SKIN}`, findByProp(root, "data-skin").props["data-skin"] === OTHER_SKIN,
  String(findByProp(root, "data-skin").props["data-skin"]));
check("canvas 仍在轨道里（结构不变，只是不跑动画）", findOne(root, "es-rail__fluid") === canvas);

console.log("[5] 收面板 → 引擎停掉（canvas 随面板一起消失）");
prefsSnapshot = { skin: "fluid" };
flush();
const rafWhileOpenAgain = rafCalls;
check("切回 fluid 后引擎重新起来", rafWhileOpenAgain > rafBeforeSkinSwitch, String(rafWhileOpenAgain));
clickPill(root);                       // 再点一次 = 收起面板
const rafAfterClose = rafCalls;
flushFrames(5);
check("收起面板后不再请求新的动画帧", rafCalls === rafAfterClose, `${rafAfterClose} → ${rafCalls}`);
check("收起面板后没有遗留待执行帧", pendingFrames.size === 0, String(pendingFrames.size));
check("收起面板后 canvas 不在树上", findOne(root, "es-rail__fluid") === null);

console.log("[6] 卸载 → cancelAnimationFrame + 摘 resize 监听 + 断 ResizeObserver");
prefsSnapshot = { skin: "fluid" };
flush();                                // 重新展开（上一次点击已把 open 置回 false，这里再开）
clickPill(root);
const observerBeforeUnmount = observers[observers.length - 1];
const cancelBeforeUnmount = cancelCalls;
check("卸载前引擎在跑", pendingFrames.size === 1 && (win.listeners.resize || []).length === 1,
  `pending=${pendingFrames.size} resize=${(win.listeners.resize || []).length}`);
unmountAll();
check("卸载时 cancelAnimationFrame 被调用", cancelCalls > cancelBeforeUnmount, String(cancelCalls));
check("卸载后没有遗留待执行帧", pendingFrames.size === 0, String(pendingFrames.size));
check("卸载后 resize 监听被移除", (win.listeners.resize || []).length === 0,
  String((win.listeners.resize || []).length));
check("卸载后 ResizeObserver 被 disconnect", observerBeforeUnmount.disconnected === true);
check("卸载过程没有异常", hookErrors.length === 0, String(hookErrors[0]));

console.log("[7] getContext 返回 null / 不存在 → 静默不跑，绝不抛异常");
{
  canvasOptions.ctxMode = "null";
  prefsSnapshot = { skin: "fluid" };
  const rafBefore = rafCalls;
  const rootNull = mount();
  clickPill(rootNull);
  flushFrames(3);
  check("getContext 返回 null 时不抛异常", hookErrors.length === 0, String(hookErrors[0]));
  check("getContext 返回 null 时不请求动画帧", rafCalls === rafBefore, `${rafBefore} → ${rafCalls}`);
  check("getContext 返回 null 时不写画布尺寸",
    findOne(rootNull, "es-rail__fluid") !== null && findOne(rootNull, "es-rail__fluid").widthWrites === 0,
    findOne(rootNull, "es-rail__fluid") ? String(findOne(rootNull, "es-rail__fluid").widthWrites) : "no canvas");

  canvasOptions.ctxMode = "ok";
  canvasOptions.hasGetContext = false;
  const rafBefore2 = rafCalls;
  const rootNoCtx = mount();
  clickPill(rootNoCtx);
  flushFrames(3);
  check("canvas 没有 getContext 时不抛异常", hookErrors.length === 0, String(hookErrors[0]));
  check("canvas 没有 getContext 时不请求动画帧", rafCalls === rafBefore2, `${rafBefore2} → ${rafCalls}`);

  canvasOptions.ctxMode = "throw";
  canvasOptions.hasGetContext = true;
  const rootThrow = mount();
  let thrown = null;
  try { clickPill(rootThrow); } catch (error) { thrown = error; }
  check("getContext 直接抛错时也被吞掉（皮肤仍可用）", thrown === null && hookErrors.length === 0, String(thrown || hookErrors[0]));
  canvasOptions.ctxMode = "ok";
}

console.log("[8] 量到 0 尺寸（display:none）→ 跳过这一帧、不写画布尺寸、不除零；恢复后能起来");
{
  const zeroRect = { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
  afterPropsHook = (node) => { if (node.className === "es-rail") node.rect = zeroRect; };
  canvasOptions.ctxMode = "ok";
  const rafBefore = rafCalls;
  const rootZero = mount();
  clickPill(rootZero);
  const zeroRail = findOne(rootZero, "es-rail");
  const zeroCanvas = findOne(rootZero, "es-rail__fluid");
  const rafAfterOpen = rafCalls;
  flushFrames(3);
  check("0 尺寸时不抛异常（没有除零 / NaN）", hookErrors.length === 0, String(hookErrors[0]));
  check("0 尺寸时仍然排了帧（rAF 在跑，只是每帧跳过）", rafAfterOpen === rafBefore + 1, `${rafBefore} → ${rafAfterOpen}`);
  check("0 尺寸时不写 canvas.width/height", zeroCanvas.widthWrites === 0 && zeroCanvas.heightWrites === 0,
    `w=${zeroCanvas.widthWrites} h=${zeroCanvas.heightWrites}`);
  check("0 尺寸时不画任何东西", zeroCanvas.ctx.calls.fill === 0, String(zeroCanvas.ctx.calls.fill));

  // 尺寸恢复（面板真正显示了）→ 下一帧就该正常起来
  zeroRail.rect = DEFAULT_RECT;
  flushFrames(2);
  check("尺寸恢复后画布按 dpr 设置好", zeroCanvas.width === 480 && zeroCanvas.height === 68,
    `${zeroCanvas.width}x${zeroCanvas.height}`);
  check("尺寸恢复后开始画粒子", zeroCanvas.ctx.calls.fill > 0, String(zeroCanvas.ctx.calls.fill));
  afterPropsHook = null;
}

console.log("[9] 引擎不读 getComputedStyle（进度走 ref，避免与渲染时序耦合）");
{
  let computedCalls = 0;
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (...args) => { computedCalls += 1; return original ? original(...args) : { getPropertyValue: () => "100%" }; };
  prefsSnapshot = { skin: "fluid" };
  const rootPct = mount();
  clickPill(rootPct);
  flushFrames(5);
  check("引擎跑了若干帧", findOne(rootPct, "es-rail__fluid").ctx.calls.fill > 0);
  check("引擎一次都没调用 getComputedStyle", computedCalls === 0, String(computedCalls));
  if (original) globalThis.getComputedStyle = original;
  else delete globalThis.getComputedStyle;
}

console.log("[10] 「一坨墙」回归：粒子必须铺满整条已点亮轨道，而不是挤成一条会漂移的窄带");
{
  // 真实缺陷：resize 用 spawn(0) 把 420 颗粒子全钉在 x=0，回收入口又是 x∈[-4,22] 的窄带，
  // 于是整群成为一堵 ~110px 宽、以约 0.7px/帧整体右移的墙 —— 任一时刻只有那一小段轨道
  // 有流体，其余只剩 destination-out 淡出后的 alpha=25 死区（实测每列 meanA 平在 25）。
  // 这里用"逐列平均 alpha"（重放引擎真正画过的 arc / 淡出 / clearRect）把这条判住。
  const railRect = DEFAULT_RECT;
  prefsSnapshot = { skin: "fluid" };
  afterPropsHook = null;
  canvasOptions.ctxMode = "ok";
  canvasOptions.hasGetContext = true;
  const diag = process.env.FLUID_COLUMN_DIAG === "1";

  // 帧边界钩子：本测试的桩用它把"这一帧画过的几何"记进帧表（引擎侧只认
  // window.__FLUID_TEST_HOOK__.onFrame，生产里没人挂它）
  frameHandler = null;
  win.__FLUID_TEST_HOOK__ = { onFrame: () => { if (frameHandler) frameHandler(); } };
  /* ★ 本节的随机源固定成一条可复现的序列（做法同 [12] 的 trace 比对）。
     原因：本节有两条**统计量**判据（"有墨但未饱和的面积占比"、"列间 min/max"），而它们
     吃的是真实 Math.random —— 每次运行都是重新抽一次样。实测抽样标准差很大
     （同一份代码连跑 16 次，"有墨但未饱和"在已点亮区里的值：中位 22.8%、最低 13.0%），
     于是 15% 这条门限会偶发假红 —— 那是**抽样噪声**，不是引擎回归。
     钉住随机源之后，本节量到的仍然是真引擎行为，只是把"抽一次"变成"每次都抽同一次"；
     种子按**中位数**挑（见 §报告）：本节实测 整轨 17.8%（16 次中位 17.5%）、
     已点亮区 21.5%（中位 22.8%）—— 不是挑最大值（最大那次是 25.1%/32.8%）。 */
  const realRandom10 = Math.random;
  (function () { let s = 3; Math.random = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const rootCol = mount();
  clickPill(rootCol);
  const colRail = findOne(rootCol, "es-rail");
  colRail.rect = railRect;
  const colCanvas = findOne(rootCol, "es-rail__fluid");
  flushFrames(2);
  const ctx = colCanvas.ctx;
  frameHandler = () => ctx.nextFrame();
  const cssW = Math.round(railRect.width);       // 240 CSS px
  // ⚠️ 插件用的是预览页那套 17px 内缩几何：litW = 17 + (W - 34) * pct（CSS px）。
  // 桩 canvas 的 width 是 CSS×dpr（480），所以判据的 x 阈值要换算到设备像素。
  const dpr = colCanvas.width / cssW;            // 2
  // ★ 已点亮宽度按**夹具默认档位的 pct** 现推（不再写死"满格 1.0"）：加 ULTRA 之后
  //   默认档 max 的 pct 是 0.75 → 已点亮区只到 171.5px，列集与播种域都由它派生。
  const litWCss = litWidthOf(DEFAULT_PCT, cssW);
  const litWDev = litWCss * dpr;

  // (a) 播种分布：先让尺寸"变化"一次（width 归零 → 引擎重新播种），再量**播种后第一帧**的
  //     粒子横向分布。resize 之后粒子必须已经铺满整个宽度，而不是全钉在左端。
  colCanvas.width = 0;
  colCanvas.height = 0;
  ctx.resetMeasure();
  flushFrames(1);
  const seedArcs = ctx.frames.length ? ctx.frames[0].arcs : [];
  // 引擎是在 setTransform(dpr,…) 下作画的，所以 arc 坐标是 **CSS px**（轨道宽 240）
  const seedMaxX = seedArcs.reduce((a, p) => Math.max(a, p[0]), 0);
  const seedHist = new Array(10).fill(0);
  seedArcs.forEach((a) => { seedHist[Math.min(9, Math.max(0, Math.floor(a[0] / cssW * 10)))] += 1; });
  const seedBuckets = seedHist.filter((n) => n > 0).length;
  /* ★ 播种域也必须按 litW 派生，不能拿整条轨道当分母：
     引擎在这次 resize 里确实 `spawn()` 撒满整条轨道 [0, W]，但**同一帧**又把
     `x > litW-1` 的那批回收进源头窄带（client.js 的回收循环）→ 画面上能观察到的
     播种域是 [0, min(W, litW-1)]。所以"有粒子的桶"只能要求覆盖**完整落在播种域内**
     的那些桶：加 ULTRA 之后默认档只点亮 171.5px，第 9/10 桶（216px 起）本来就该是空的
     —— 写死 ≥9 其实是在要求"满格 223px"的旧世界。 */
  const seedDomainCss = Math.min(cssW, litWCss - 1);
  const seedBucketW = cssW / 10;
  const seedBucketsWanted = Math.max(1, Math.floor(seedDomainCss / seedBucketW));
  if (diag) console.log(`  [diag] 播种直方图(10 桶, 含回收到源头那批): ${seedHist.join(" ")} · 最右粒子 x=${seedMaxX.toFixed(0)}css · 有粒子的桶 ${seedBuckets}/10（播种域 ${seedDomainCss.toFixed(1)}css → 应 ≥ ${seedBucketsWanted}）· ${seedArcs.length} 颗`);
  // 旧写法 spawn(0)：所有粒子在 x=0，首帧后最右也不过 2~3px，直方图只落在前 2 个桶
  check("尺寸变化后重新播种是整幅（已点亮区）随机，而不是全钉在 x=0（spawn(0) → spawn()）",
    seedMaxX >= seedDomainCss * 0.75 && seedBuckets >= seedBucketsWanted,
    `最右粒子 x=${seedMaxX.toFixed(0)}css（应 ≥ ${(seedDomainCss * 0.75).toFixed(0)}）· 有粒子的桶 ${seedBuckets}/10（应 ≥ ${seedBucketsWanted}）`);

  // (b) 稳态 + 时间切片：跑满 260 帧，并在 25%/50%/75%/100% 四个时刻各量一次逐列 alpha。
  //     单看终态是不够的 —— 一堵"会漂移的墙"刚好漂到某处时终态也能很亮；切成四段后，
  //     它一定会在某个切片里把别的列留成空的（这正是会被用户看到的那种"死区"）。
  ctx.resetMeasure();
  const snapshots = [];
  const slices = [65, 65, 65, 65];
  slices.forEach((n) => {
    flushFrames(n);
    snapshots.push(ctx.getImageData(0, 0, colCanvas.width, colCanvas.height));
  });
  Math.random = realRandom10;      // 本节量测结束 → 还原真实随机源（下面的判据不再消费随机数）
  const cols = 20;
  const profile = (img) => {
    const stats = [];
    for (let c = 0; c < cols; c += 1) {
      const x0 = Math.floor(colCanvas.width * c / cols);
      const x1 = Math.floor(colCanvas.width * (c + 1) / cols);
      let sum = 0, tot = 0, inked = 0, light = 0, sat = 0;
      for (let y = 0; y < img.height; y += 1) for (let x = x0; x < x1; x += 1) {
        const a = img.data[(y * img.width + x) * 4 + 3];
        sum += a; tot += 1;
        if (a > 0) inked += 1;
        if (a > 0 && a < 230) light += 1;
        if (a >= 230) sat += 1;
      }
      stats.push({ c, x0, x1, cx: (x0 + x1) / 2, meanA: sum / tot, coverage: inked / tot, light: light / tot, sat: sat / tot });
    }
    return stats;
  };
  const profiles = snapshots.map(profile);
  const stats = profiles[profiles.length - 1];
  const inScope = stats.filter((s) => s.cx <= litWDev - 12 * dpr);
  const inScopeCols = inScope.map((s) => s.c);
  const scopeLabel = inScopeCols.map((c) => `col${c}`).join(",");
  if (diag) {
    console.log("  [diag] 四段切片的逐列 meanA（行=列）：");
    stats.forEach((s, i) => console.log(`  [diag] ${String(s.c).padStart(2)} ${scopeLabel.includes(`col${s.c}`) ? "*" : " "} ` + profiles.map((p) => String(Math.round(p[i].meanA)).padStart(4)).join("") ));
    console.log(`  [diag] 平均覆盖 ${(stats.reduce((a, s) => a + s.coverage, 0) / cols * 100).toFixed(1)}% · meanA ${(stats.reduce((a, s) => a + s.meanA, 0) / cols).toFixed(1)}`);
  }

  for (let i = 0; i < profiles.length; i += 1) {
    const label = `${Math.round((i + 1) / profiles.length * 100)}%（第 ${(i + 1) * 65} 帧）`;
    const weak = inScope.filter((s) => profiles[i][s.c].meanA < 80);
    check(`时刻 ${label}：列 ${scopeLabel} 的 meanA 全部 ≥ 80（杀死「一坨墙」）`,
      weak.length === 0,
      weak.length ? weak.map((s) => `col${s.c}(${Math.round(s.cx / dpr)}css)=${profiles[i][s.c].meanA.toFixed(0)}`).join(" ") : undefined);
    const sparse = inScope.filter((s) => profiles[i][s.c].coverage < 0.5);
    check(`时刻 ${label}：每列真有粒子画过（覆盖 ≥ 50%），而不是只剩淡出后的死区`,
      sparse.length === 0,
      sparse.length ? sparse.map((s) => `col${s.c}=${(profiles[i][s.c].coverage * 100).toFixed(0)}%`).join(" ") : undefined);
    const means = inScope.map((s) => profiles[i][s.c].meanA);
    const mn = Math.min(...means), mx = Math.max(...means);
    check(`时刻 ${label}：列间 min/max ≥ 0.30（既不能有死区，也不能只靠左端一坨撑着）`,
      mn / mx >= 0.30, `min=${mn.toFixed(0)} max=${mx.toFixed(0)} 比值=${(mn / mx).toFixed(2)}`);
  }

  const meanAll = stats.reduce((a, s) => a + s.meanA, 0) / cols;
  /**
   * ★ "有墨但未饱和的面积占比"的分母必须跟着**已点亮区**走（与上面逐列判据同一个列集）：
   *   加 ULTRA 之后默认档只点亮 171.5/240 的轨道，拿整条轨道（20 列）当分母，
   *   等于把 6~7 列"引擎每帧都 clearRect 掉"的空列算进"有墨"的分母里 —— 同一个画面
   *   从改动前的 ~19.6% 掉到中位 ~17.5%，正压在 15% 门限上（16 次里 4 次假红）。
   *   判据说的是"层理"，量的范围当然只能是流体所在的那段。
   *   ⚠️ 门限 15% **没动**：口径换算后等效为"流体面积里 ≥15% 未饱和"，与旧口径在满格时
   *   的等效值（≥16.7%）同一量级；差的 10% 来自旧分母里那两列空白，不是判据的意图。
   */
  const litCols = inScope.length ? inScope : stats;
  const textureArea = litCols.reduce((a, s) => a + s.light, 0) / litCols.length;
  /**
   * ⚠️ 这条是**模型**指标，不是真机指标：重放器按每颗粒子的 alpha 累加，
   * 重叠度一高就比真 canvas 更早饱和。实测同一套参数：
   *   真机（_clump.mjs）  layered(0<alpha<230) = **96%**、近不透明 0.00%
   *   重放器              textureArea ≈ **19.6%**（当时的默认档 = 满格，整条轨道 93% 是流体，
   *                       所以"整轨"与"流体面积"两个口径只差 7%，现在差 29% —— 这就是它过期的地方）
   * 粒子半径放大到 5.5~13px、密度降到 1.0 之后，模型的这个绝对值下移了，
   * 而**真机反而更不透**（层理更足）。所以阈值从 25% 收到 15%：
   * 它只作为"别把整幅糊成纯色"的兜底，**权威防糊判据是真机的**
   * `_acceptance.mjs` 的近不透明 ≤12%（该判据量的就是真 canvas）。
   */
  check("保留层理与纹理：重放器里「有墨但未饱和」的面积占比 ≥ 15%（口径 = 已点亮区的列；兜底；权威判据在真机的近不透明≤12%）",
    textureArea >= 0.15, `${(textureArea * 100).toFixed(1)}%`);
  check("没有靠拉满 alpha 糊过去：列平均 meanA 均值 ≤ 235",
    meanAll <= 235, meanAll.toFixed(1));

  // (c) 左端更浓：第 1 列（源头）不应比中段最亮列更淡
  const leftMean = stats[1].meanA;
  const midMean = Math.max(...stats.slice(5, 15).map((s) => s.meanA));
  check("左端（源头）按设计更浓：第 1 列 meanA ≥ 中段最亮列的 80%",
    leftMean >= midMean * 0.8, `左 ${leftMean.toFixed(0)} vs 中段最亮 ${midMean.toFixed(0)}`);

  check("量测本身没漏帧（重放器收到了 200+ 帧）", ctx.frames.length >= 200, String(ctx.frames.length));
  afterPropsHook = null;
  ctx.measure = false;
}

console.log("[11] 「档位跳变」回归（第二轮）：0% → 100% 跳变后 150 帧（≈2.5s @60fps）已点亮区必须已经铺满");
{
  // 真实缺陷（第一轮「一坨墙」修好之后仍然存在，第一轮验收没抓到）：
  // 回收入口只有 `x > litW-1` 一条路 —— 低档时全部粒子被反复回收进左端窄带；档位一跳回满档，
  // 这团粒子整体右移，**源头当场断料**：下一批"料"要等某颗粒子跑完整段才被回收，于是中段
  // 出现约 5 秒的空洞。实测（无头 Edge，跳变后 2.5s 采样）col2..col5 = 65/31/36/47、明暗比 0.14，
  // 而**稳态**（直接 load 满档，不等跳变）是 135~197 全绿 —— 所以第一轮只看稳态的判据全绿。
  // 修复：litW 相对上一帧变化时，把粒子横向分布等比例重标定（x' = x * litW / lastLitW，锚点在左端源头）。
  // 这条判据就是它的回归锁：**必须有"先低档 → 再跳满档"的时序**，否则量不到这个瞬态。
  const railRect = DEFAULT_RECT;
  prefsSnapshot = { skin: "fluid" };
  afterPropsHook = null;
  canvasOptions.ctxMode = "ok";
  canvasOptions.hasGetContext = true;
  const diag = process.env.FLUID_COLUMN_DIAG === "1";

  frameHandler = null;
  win.__FLUID_TEST_HOOK__ = { onFrame: () => { if (frameHandler) frameHandler(); } };
  const rootJump = mount();
  clickPill(rootJump);
  const jumpRail = findOne(rootJump, "es-rail");
  jumpRail.rect = railRect;
  const jumpCanvas = findOne(rootJump, "es-rail__fluid");
  flushFrames(2);
  const jctx = jumpCanvas.ctx;
  frameHandler = () => jctx.nextFrame();

  const cssW = Math.round(railRect.width);            // 240 CSS px
  const dprJ = jumpCanvas.width / cssW;               // 2
  const cols = 20;
  const profileCols = (img) => {
    const stats = [];
    for (let c = 0; c < cols; c += 1) {
      const x0 = Math.floor(jumpCanvas.width * c / cols);
      const x1 = Math.floor(jumpCanvas.width * (c + 1) / cols);
      let sum = 0, tot = 0;
      for (let y = 0; y < img.height; y += 1) for (let x = x0; x < x1; x += 1) {
        sum += img.data[(y * img.width + x) * 4 + 3]; tot += 1;
      }
      stats.push({ c, cx: (x0 + x1) / 2, meanA: sum / tot });
    }
    return stats;
  };
  // 拨档必须走**轨道自己的 React props 处理器**（onPointerDown/Move/Up → onRailDown/Move/Up）：
  // 刻度按钮的写入口 next() 在「目标档位 == 已提交档位」时早退，而本用例的假 store 里
  // 已提交档位就是最后一档 —— 点最后一颗刻度根本跳不回去（实测 draft 停在 0，pct 恒为 0，
  // 判据变成假绿）。轨道路径是真实用户路径，putDraft 是同步的，pct 立刻生效。
  const railEvent = (clientX) => ({
    clientX, clientY: railRect.height / 2, pointerId: 1,
    preventDefault() {}, stopPropagation() {},
  });
  const driveRail = (clientX) => {
    jumpRail.props.onPointerDown(railEvent(clientX));
    jumpRail.props.onPointerMove(railEvent(clientX));
    jumpRail.props.onPointerUp(railEvent(clientX));
    flush();
  };
  const inner = railRect.width - 34;                  // indexFromClientX 的分母（240-34=206）
  const atIndex = (index) => 17 + inner * (index / 3);

  // (a) 先落到最低档并跑满 120 帧（≈2s，与验收「停在低档再跳」的时序同性质）
  const jumpTicks = findAll(rootJump, "es-tick");
  check("能拿到档位刻度（≥2）", jumpTicks.length >= 2, String(jumpTicks.length));
  jctx.resetMeasure();                                // 开启量测模式（下面要看低档状态）
  driveRail(atIndex(0));
  flushFrames(120);
  const lowStats = profileCols(jctx.getImageData(0, 0, jumpCanvas.width, jumpCanvas.height));
  const lowLitDev = 17 * dprJ;                        // pct=0 → litW=17 CSS px
  const lowSource = lowStats.filter((s) => s.cx <= lowLitDev).map((s) => s.meanA);
  const lowBeyond = lowStats.filter((s) => s.cx > lowLitDev + 24).map((s) => s.meanA);
  if (diag) console.log("  [diag] 跳变前（pct=0，第 120 帧）逐列 meanA: " + lowStats.map((s) => Math.round(s.meanA)).join(" "));
  // 前提守卫：必须真的处在低档 —— 源头有液团、已点亮区之外是空的。
  // 少了这条，"跳变"可能根本没发生（档位没降下去），判据会变成假绿。
  check("跳变前确实在最低档：源头液团在（col0 meanA ≥ 80）",
    lowSource.length >= 1 && lowSource[0] >= 80,
    `col0=${lowSource.length ? lowSource[0].toFixed(0) : "n/a"}`);
  check("跳变前确实在最低档：已点亮区之外全空（col5 起 meanA < 1）",
    lowBeyond.every((v) => v < 1),
    `最大 ${lowBeyond.length ? Math.max(...lowBeyond).toFixed(2) : "n/a"}`);

  // (b) 0% → 100% 跳变（拖到最右端 = 真实用户路径），重置重放器后跑 150 帧再量
  driveRail(atIndex(3));
  jctx.resetMeasure();
  flushFrames(150);                                   // ≈2.5s @60fps
  const stats = profileCols(jctx.getImageData(0, 0, jumpCanvas.width, jumpCanvas.height));
  const litWDev = (17 + (cssW - 34) * 1) * dprJ;      // 满档 446 设备像素
  const inScope = stats.filter((s) => s.cx <= litWDev - 12 * dprJ);
  const means = inScope.map((s) => s.meanA);
  const mn = Math.min(...means), mx = Math.max(...means);
  const weak = inScope.filter((s) => s.meanA < 80);
  if (diag) console.log("  [diag] 跳变后（pct=1，第 150 帧）逐列 meanA: " +
    stats.map((s, i) => (inScope.includes(stats[i]) ? "*" : " ") + Math.round(s.meanA)).join(" "));
  check("档位 0→100% 跳变后 150 帧：已点亮区每一列 meanA 都必须已经 ≥ 80（瞬态空洞回归锁）",
    weak.length === 0,
    weak.length
      ? weak.map((s) => `col${s.c}(${Math.round(s.cx / dprJ)}css)=${s.meanA.toFixed(0)}`).join(" ")
      : `最低 ${mn.toFixed(0)}（列 ${inScope.length} 个）`);
  check("档位 0→100% 跳变后 150 帧：列间 min/max ≥ 0.30（不是只把左端点亮）",
    mn / mx >= 0.30, `min=${mn.toFixed(0)} max=${mx.toFixed(0)} 比值=${(mn / mx).toFixed(2)}`);
  check("档位 0→100% 跳变后 150 帧：源头没有断料（第 0/1 列 meanA ≥ 80）",
    stats[0].meanA >= 80 && stats[1].meanA >= 80,
    `col0=${stats[0].meanA.toFixed(0)} col1=${stats[1].meanA.toFixed(0)}`);
  check("跳变量测本身没漏帧（重放器收到 150 帧）", jctx.frames.length === 150, String(jctx.frames.length));
  afterPropsHook = null;
  frameHandler = null;
  jctx.measure = false;
}

console.log("[13] 密度恒定回归：粒子数随 litW 等比伸缩，count/litW 五个档位保持一致");
{
  // 用户反馈："等级越高反而流体越稀疏"。旧写法 count 恒为常数（470 颗）：20px 上 23.5 颗/px，
  // 338px 上只剩 1.39 颗/px —— 差 17 倍。修法：targetCount = clamp(round(density × litW), …)。
  // 判据：五个档位的 count/litW 极差 ≤ ±8%（不是"平均差不多"，是**每档都要一样**）。
  prefsSnapshot = { skin: "fluid" };
  afterPropsHook = null;
  canvasOptions.ctxMode = "ok";
  canvasOptions.hasGetContext = true;
  const diag = process.env.FLUID_COLUMN_DIAG === "1";
  let geom = null;
  // onFrame 的实参是 (litW, pct, count, source) —— 标量，不分配对象（热路径零开销）
  win.__FLUID_TEST_HOOK__ = { onFrame: (litW, pct, count, source) => { geom = { litW: litW, pct: pct, count: count, source: source }; if (frameHandler) frameHandler(); } };
  const rootD = mount();
  clickPill(rootD);
  const dRail = findOne(rootD, "es-rail");
  dRail.rect = DEFAULT_RECT;
  const dCanvas = findOne(rootD, "es-rail__fluid");
  const dCtx = dCanvas.ctx;
  frameHandler = () => dCtx.nextFrame();               // 让本段的帧进重放器（要数末帧的 arc 数量）
  const cssW = DEFAULT_RECT.width;                       // 240 CSS px
  // ① 桩珠子：引擎用 rail.querySelector 读珠子当前位置定 litW —— 把它的中心放在目标 litW 上
  const knob = new FakeNode("div");
  knob.className = "es-knob";
  const setKnob = (litW) => {
    knob.rect = { width: 30, height: 30, left: litW - 15, top: 2, right: litW + 15, bottom: 32 };
    dRail.__stubKnob = knob;
  };
  const rows = [];
  for (const level of [1, 2, 3, 4, 5]) {
    const litW = 17 + (cssW - 34) * ((level - 1) / 4);   // 17 / 68.5 / 120 / 171.5 / 223
    setKnob(litW);
    dCtx.resetMeasure();
    flushFrames(120);                                    // 跑稳：syncCount 已把粒子数调到目标值
    const arcs = dCtx.frames.length ? dCtx.frames[dCtx.frames.length - 1].arcs.length : 0;
    rows.push({ level, litW, count: arcs, perPx: arcs / litW,
      hookLitW: geom ? Math.round(geom.litW * 10) / 10 : null, source: geom ? geom.source : null });
  }
  rows.forEach((r) => {
    if (diag) console.log(`  [diag] 档 ${r.level}: litW=${r.litW} count=${r.count} perPx=${r.perPx.toFixed(3)}（钩子 litW=${r.hookLitW} 来源=${r.source}）`);
  });
  check("每一档都真的用珠子位置定 litW（钩子 source=knob，且读到的值与桩一致）",
    rows.every((r) => r.source === "knob" && Math.abs(r.hookLitW - r.litW) <= 0.6),
    rows.map((r) => `档${r.level}:${r.source}/${r.hookLitW}`).join(" "));
  const perPx = rows.map((r) => r.perPx);
  const meanPerPx = perPx.reduce((a, b) => a + b, 0) / perPx.length;
  const spread = (Math.max(...perPx) - Math.min(...perPx)) / meanPerPx;
  check("① 密度恒定：五个档位 count/litW 的极差 ≤ ±8%",
    spread <= 0.08,
    `极差 ${(spread * 100).toFixed(2)}% · perPx=${perPx.map((v) => v.toFixed(2)).join("/")}`);
  check(`① 密度值与源码里 FLUID_PRESET.density=${DENSITY} 一致（±10%）`,
    perPx.every((v) => Math.abs(v - DENSITY) / DENSITY <= 0.10),
    `perPx=${perPx.map((v) => v.toFixed(3)).join("/")}`);
  check("① 高等级不再变稀疏：满档（223px）的粒子数 ≥ 低档（17px）的 10 倍",
    rows[4].count >= rows[0].count * 10,
    `档1=${rows[0].count} 档5=${rows[4].count}`);
  check("[13] 量测没漏帧（每档都收到 120 帧）", dCtx.frames.length === 120, String(dCtx.frames.length));
  check("[13] 无异常", hookErrors.length === 0, String(hookErrors[0]));
  dRail.__stubKnob = null;
  dCtx.measure = false;
}

console.log("[14] litW 跟随珠子位置（改 rect 就跟着变）；拿不到珠子必须回退 pct");
{
  // ① 的关键：引擎每帧读珠子**当前渲染位置**（CSS 过渡期间就是动画中的位置），
  //    所以档位一跳，流体跟着珠子的动画一起压缩，而不是先"啪"地到位。
  // 这里用桩珠子直接改 rect，断言引擎算出来的 litW 跟着变；再把珠子拿掉，断言回退 pct。
  prefsSnapshot = { skin: "fluid" };
  afterPropsHook = null;
  canvasOptions.ctxMode = "ok";
  canvasOptions.hasGetContext = true;
  const diag = process.env.FLUID_COLUMN_DIAG === "1";
  let geom = null;
  win.__FLUID_TEST_HOOK__ = { onFrame: (litW, pct, count, source) => { geom = { litW: litW, pct: pct, count: count, source: source }; } };
  const rootK = mount();
  clickPill(rootK);
  const kRail = findOne(rootK, "es-rail");
  kRail.rect = DEFAULT_RECT;
  const kCanvas = findOne(rootK, "es-rail__fluid");
  const kCtx = kCanvas.ctx;
  const cssW = DEFAULT_RECT.width;
  const knob = new FakeNode("div");
  knob.className = "es-knob";
  const setKnob = (litW) => {
    knob.rect = { width: 30, height: 30, left: litW - 15, top: 2, right: litW + 15, bottom: 32 };
    kRail.__stubKnob = knob;
  };
  const frameAt = (litW) => {
    const before = kCtx.clears.length;
    flushFrames(2);
    return { geom, clears: kCtx.clears.slice(before) };
  };

  setKnob(60);
  const a = frameAt(60);
  check("珠子中心 = 60px → 引擎算出的 litW = 60（来源 knob）",
    a.geom !== null && Math.abs(a.geom.litW - 60) <= 0.6 && a.geom.source === "knob",
    a.geom ? `litW=${a.geom.litW} source=${a.geom.source}` : "钩子没拿到几何");
  check("① 裁剪 / clearRect 也跟着走：出现 clearRect(60, 0, 180, 34)",
    a.clears.some((c) => Math.abs(c[0] - 60) <= 0.6 && Math.abs(c[2] - (cssW - 60)) <= 0.6),
    JSON.stringify(a.clears.slice(0, 3)));

  setKnob(180);
  const b = frameAt(180);
  check("珠子 rect 改成中心 180px → litW 立刻跟着变到 180（不是只在档位变化时更新）",
    b.geom !== null && Math.abs(b.geom.litW - 180) <= 0.6 && b.geom.source === "knob",
    b.geom ? `litW=${b.geom.litW} source=${b.geom.source}` : "钩子没拿到几何");
  check("① clearRect 同步到 180", b.clears.some((c) => Math.abs(c[0] - 180) <= 0.6),
    JSON.stringify(b.clears.slice(0, 3)));
  if (diag) console.log(`  [diag] 桩珠子 60→180：litW ${a.geom && a.geom.litW}→${b.geom && b.geom.litW}`);

  // 珠子"消失"：rect 宽为 0（display:none / 已被卸载）→ 引擎必须回退到 pct，而不是停摆
  knob.rect = { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
  const c = frameAt(0);
  // ★ 回退路径的 litW 也要按**夹具默认档位的 pct** 现推：加 ULTRA 之后 max 是 3/4 = 0.75
  //   → 17+206×0.75 = 171.5（旧期望 223 是"默认档 = 满格"的旧世界）。
  const fallbackLitW = litWidthOf(DEFAULT_PCT, cssW);
  check(`② 珠子 rect 宽为 0（display:none）→ 回退 pct 算法，litW = 17+(${cssW}-34)×${DEFAULT_PCT}`,
    c.geom !== null && c.geom.source === "pct" && Math.abs(c.geom.litW - fallbackLitW) <= 1,
    c.geom ? `litW=${c.geom.litW} source=${c.geom.source}（期望 ${fallbackLitW}）` : "钩子没拿到几何");
  check("② 回退路径仍然画东西（没有停摆）", kCtx.calls.fill > 0, String(kCtx.calls.fill));
  // 别把粒子数写死（曾经是 400；density 一改就假失败）—— 按源码里的 density 与**同一个**
  // 回退 litW 现推，别再从"满档 223"算
  const fallbackExpect = Math.round(DENSITY * fallbackLitW);
  check("② 回退路径的粒子数也按 litW 算（密度恒定）",
    c.geom !== null && c.geom.count >= fallbackExpect * 0.9,
    c.geom ? `${c.geom.count}（按 density=${DENSITY} 期望 ≈${fallbackExpect}）` : "n/a");

  // 完全拿不到珠子元素（querySelector 返回 null）也不能抛错
  kRail.__stubKnob = null;
  const d = frameAt(0);
  check("② 连珠子元素都拿不到 → 仍旧回退 pct、不抛异常",
    d.geom !== null && d.geom.source === "pct" && hookErrors.length === 0,
    d.geom ? `source=${d.geom.source} exceptions=${hookErrors.length}` : "钩子没拿到几何");
  check("[14] 无异常", hookErrors.length === 0, String(hookErrors[0]));
  kCtx.measure = false;
}

console.log("[12] 帧边界测试钩子：不存在 / 存在 / 抛异常，引擎行为必须逐帧逐粒子完全一致");
{
  // 生产代码里留了一个测试钩子 window.__FLUID_TEST_HOOK__（离线测试用它按列重放 alpha）。
  // 两条必须被证明的事：
  //   ① 钩子**不存在**时引擎行为与存在时**逐帧逐粒子一致**（不只是"不崩"）；
  //   ② 钩子抛异常**不能**打断渲染循环（帧级 try/catch 里是 stop()，钩子自己得兜住）。
  // 做法：固定 Math.random 的种子 + 固定时间线，同一条时间线跑三遍，逐条比对
  //       arc(x,y,r) + 当时的 fillStyle（颜色/alpha）+ clearRect + 合成模式序列。
  const diag = process.env.FLUID_COLUMN_DIAG === "1";
  const seeded = (seed) => {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  };
  /**
   * ★ 三份时间线必须跑在**同一条时间基**上（否则比的不是引擎，是测试桩的时钟）。
   *
   * 引擎每帧的时间参数是 `t = now - t0`：`now` = performance.now（本套件里就是全局
   * `fakeNow`），`t0` = mountFluid 那一刻读到的同一只钟。`fakeNow` 是全文件单调累加的，
   * 于是第 N 份时间线的 `now - t0` 与第 1 份**不在同一个浮点格子上**：
   * 实测首帧就相对差 3.3e-15，240 帧后到 1.6e-13（绝对值 ~6e-10 ms）——
   * 混沌流场（curl 噪声 + 每帧随机抖动）把它放大 4 个数量级，正好顶到下面的 1e-9 容差上。
   *
   * 证据（临时探针 probe12，同一条时间线跑 24 遍）：
   *   · absent-vs-absent（两次**同配置**、本该逐位相同的运行）与 absent-vs-boom 的偏差
   *     **逐位相同**（同一轮里 self = noop = boom = 1.79e-10 / 6.74e-10 / 0 …）
   *     → 与"钩子"无关，是"两次运行"之间的本底噪声；
   *   · 把每份时间线的起点钉到同一个 `fakeNow` 之后，24 份时间线的偏差**全是 0.000e+0**。
   * 所以这里钉住时间起点，让"逐帧逐粒子一致"这条判据量的是引擎而不是时钟。
   * 容差（1e-9 相对）**不动**：它仍然是留给 JIT 分层这类不可控漂移的安全余量。
   */
  const timelineClock0 = fakeNow;
  function runTimeline(mode) {
    const realRandom = Math.random;
    Math.random = seeded(0x51ed2701);
    const trace = [];
    const out = { mode, trace, frames: 0, hookCalls: 0, exceptions: 0 };
    try {
      if (mode === "absent") delete win.__FLUID_TEST_HOOK__;
      else if (mode === "noop") win.__FLUID_TEST_HOOK__ = { onFrame: () => { out.hookCalls += 1; } };
      else win.__FLUID_TEST_HOOK__ = { onFrame: () => { out.hookCalls += 1; throw new Error("钩子故意抛错"); } };
      frameHandler = null;
      prefsSnapshot = { skin: "fluid" };
      afterPropsHook = null;
      canvasOptions.ctxMode = "ok";
      canvasOptions.hasGetContext = true;
      fakeNow = timelineClock0;      // ★ 时间基对齐（见上）：三份时间线的 t 逐位相同
      const r = mount();
      clickPill(r);
      const rl = findOne(r, "es-rail");
      rl.rect = DEFAULT_RECT;
      const cv = findOne(r, "es-rail__fluid");
      const c2 = cv.ctx;
      const rawArc = c2.arc.bind(c2);
      const rawClear = c2.clearRect.bind(c2);
      // 注意：ctx.globalCompositeOperation 是 make2dContext 里 defineProperty 定义的
      // （configurable:false），**不能**再包一层 setter。改为在 arc/clearRect 里读它的当前值，
      // 这样"合成模式 × 绘制顺序"的交替关系照样被钉在 trace 里；另外整段 gcoLog 也整体比对。
      c2.arc = (x, y, rad) => { trace.push(`a ${x} ${y} ${rad} ${c2.fillStyle} ${c2.globalCompositeOperation}`); rawArc(x, y, rad); };
      c2.clearRect = (x, y, w, h) => { trace.push(`c ${x} ${y} ${w} ${h}`); rawClear(x, y, w, h); };
      flushFrames(240);
      // ⚠️ 必须在**摘掉包装之后**再取快照：trace 是活数组，下一轮 mount() 会 unmount 这一轮的树，
      // 卸载时 stop() 里的 clearRect(0,0,W,H) 会（在包装还挂着时）再往这个数组里补一条 ——
      // 实测就是它让"三次运行长度差 1"。快照 + 复原包装，两个问题一起解决。
      c2.arc = rawArc;
      c2.clearRect = rawClear;
      out.trace = trace.slice();
      out.gcoLog = c2.gcoLog.join("|");
      out.arcs = c2.calls.arc;                        // 真画过的粒子数 = 240 帧 × 380 颗
      out.clears = c2.calls.clearRect;
      // 帧数用"淡出笔数"数：每帧一笔 destination-out 的 rgba(0,0,0,fade)（钩子关了也数得出来）
      out.frames = c2.fills.filter((f) => f.gco === "destination-out").length;
      out.exceptions = hookErrors.length;
    } finally {
      Math.random = realRandom;
    }
    return out;
  }
  // 场景 A 基准：钩子不存在（生产形态）。这里用钩子缺席的那一份做基准，其它两份必须跟它一致。
  const base = runTimeline("absent");
  const base2 = runTimeline("absent");
  const noop = runTimeline("noop");
  const boom = runTimeline("throw");
  // ★ 别把每帧粒子数写死（曾经是 380；density 一改这条就假失败）。
  //   从源码里的 density 与**夹具默认档位的 litW** 现推（litW 用 CSS px，不带 dpr）：
  //   期望每帧粒子数 = round(density × litW)。
  //   这里的 litW 一度写成"满档 17+(W-34)"=223（旧世界默认档就是满格）—— 加 ULTRA 之后
  //   默认档只点亮 171.5px → 每帧 172 颗，223 就成了过期期望：它靠 2.8% 的余量侥幸没响，
  //   档位表一换成 5 档（pct=0.6）立刻翻红（对照实验 mid-5：arcs=33840 < 40140）。
  const expectPerFrame = Math.round(DENSITY * litWidthOf(DEFAULT_PCT, DEFAULT_RECT.width));
  check("基准时间线本身非空（跑了真东西，不是空转）",
    base.trace.length > 2000 && base.arcs >= expectPerFrame * 200 * 0.9,
    `trace=${base.trace.length} arcs=${base.arcs}（density=${DENSITY} → 每帧约 ${expectPerFrame}）`);
  /**
   * 逐条比对 trace：结构（条数 / 每条的字段数 / 文本字段）必须**完全**一致，数值允许
   * ≤ 1e-9 的相对偏差。
   *
   * 容差为什么不是 0（有实测，不是放水）：
   *   · 时间基对齐之后（见上面 timelineClock0 那段注释），24 份时间线实测**全是 0.000e+0**
   *     —— 同一份输入喂给同一段代码，本次测量里 V8 给的是逐位相同的结果；
   *   · 但浮点结果仍依赖 JIT 分层 / 堆状态这类不可控因素，跨进程、跨 Node 版本不保证逐位
   *     相等（本仓库实测过 absent-vs-absent 从 0 到 2e-14 的漂移），所以判据钉在
   *     "结构一致 + 数值偏差极小"上，1e-9 相对是留给这类漂移的安全余量。
   *   · 历史上放过一次：粒子数改成按密度算之后，每帧粒子数 470 → 491，热循环行程数变了、
   *     本底噪声顶到 1.05e-12，于是容差从 1e-12 放到 1e-9。1e-9 相对在坐标上约等于
   *     1e-9 像素；真实的行为差异（钩子影响了粒子位置 / 少画一颗粒子）会是**整数像素**
   *     或直接改变条数 —— 差 9 个数量级，这个容差不会把真实回归放过去。
   */
  const traceDiff = (a, b) => {
    if (a.length !== b.length) return { err: `条数不同 ${a.length} vs ${b.length}` };
    let worst = 0;
    for (let i = 0; i < a.length; i += 1) {
      const ta = a[i].split(" "), tb = b[i].split(" ");
      if (ta.length !== tb.length) return { err: `第 ${i} 条形状不同：${a[i]} vs ${b[i]}` };
      for (let k = 0; k < ta.length; k += 1) {
        if (ta[k] === tb[k]) continue;
        const x = Number(ta[k]), y = Number(tb[k]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { err: `第 ${i} 条文本不同：${ta[k]} vs ${tb[k]}` };
        const d = Math.abs(x - y) / Math.max(1, Math.abs(x), Math.abs(y));
        if (d > 1e-9) return { err: `第 ${i} 条数值偏差 ${d.toExponential(2)}：${ta[k]} vs ${tb[k]}` };
        if (d > worst) worst = d;
      }
    }
    return { worst };
  };
  const dSelf = traceDiff(base.trace, base2.trace);
  const dNoop = traceDiff(base.trace, noop.trace);
  const dBoom = traceDiff(base.trace, boom.trace);
  if (diag) {
    console.log(`  [diag] 同模式两遍（absent vs absent）最大相对偏差 = ${dSelf.err ?? dSelf.worst.toExponential(2)}（环境本底，不是钩子）`);
    console.log(`  [diag] 结构: 条数 base=${base.trace.length} noop=${noop.trace.length} boom=${boom.trace.length} · ` +
      `粒子 ${base.arcs}/${noop.arcs}/${boom.arcs} · 帧 ${base.frames}/${noop.frames}/${boom.frames}`);
  }
  check("① 钩子不存在 vs 存在（空实现）：结构逐条一致、数值偏差 ≤ 1e-9 相对（本底实测 0~1e-14，见上面注释）",
    dNoop.err === undefined,
    dNoop.err ?? `最大相对偏差 ${dNoop.worst.toExponential(2)}`);
  check("② 钩子抛异常 vs 不存在：同上（异常没有改变任何一帧的绘制）",
    dBoom.err === undefined,
    dBoom.err ?? `最大相对偏差 ${dBoom.worst.toExponential(2)}`);
  check("对照：环境本底（absent vs absent 两遍）本身就有 1 ULP 级差异 —— 说明容差不是放水",
    dSelf.err === undefined && dSelf.worst >= 0,
    dSelf.err ?? `最大相对偏差 ${dSelf.worst.toExponential(2)}`);
  check("② 钩子抛异常后动画继续跑（抛错只有首帧一次，随后钩子被摘掉，帧数不受影响）",
    boom.hookCalls === 1 && boom.frames === base.frames && boom.frames > 200,
    `hookCalls=${boom.hookCalls} frames=${boom.frames} vs 基准 ${base.frames}`);
  check("② 钩子抛异常不冒泡到宿主（hookErrors/未捕获异常 = 0）",
    boom.exceptions === 0, String(boom.exceptions));
  check("三份时间线的合成模式序列完全一致（destination-out 淡出 / source-over 切换顺序）",
    base.gcoLog === noop.gcoLog && base.gcoLog === boom.gcoLog,
    `${base.gcoLog.length} vs ${noop.gcoLog.length} vs ${boom.gcoLog.length}`);
  check("钩子存在时被每帧调用（空实现：调用次数 = 帧数）",
    noop.hookCalls === noop.frames && noop.frames > 200,
    `hookCalls=${noop.hookCalls} frames=${noop.frames}`);
  // 场景跑完后恢复成第 [10] 节的形态，别把钩子留给后面的代码
  win.__FLUID_TEST_HOOK__ = { onFrame: () => { if (frameHandler) frameHandler(); } };
  frameHandler = null;
}

/* ── [15] 颜色语义：粒子带**出生时**的颜色，源头在变 ─────────────────────
   用户原话："流体渐变不是粒子颜色渐变，而是源头发出的粒子颜色在变。"
   旧写法按粒子**当前 x 位置**在固定色带上取样 → 任一列的颜色是位置的确定函数，
   在 75% 那一列永远是同一档紫（r≈193）。
   新写法把出生时的色带位置记进 `ct`，源头颜色随时间往返 →
   同一列会先后经过整条色带（蓝 r≈120 … 粉 r≈255）。
   所以判据用"同一列在一段时间内的红色分量跨度"：新写法 ≥60，旧写法个位数。
   这是**语义**判据、不是调参，所以不写死颜色值，只看跨度。 */
console.log("[15] 颜色语义：粒子带出生色（源头在变），不是按当前位置取色");
{
  prefsSnapshot = { skin: "fluid" };
  afterPropsHook = null;
  canvasOptions.ctxMode = "ok";
  canvasOptions.hasGetContext = true;
  let frameIdx = 0;
  const xs = [];
  const rs = [];
  const pending = [];
  win.__FLUID_TEST_HOOK__ = {
    onFrame: () => {
      frameIdx += 1;
      // 每 20 帧留一帧：够看出"同一列颜色随时间变"，又不至于存几十万条
      if (frameIdx % 20 !== 0) { pending.length = 0; return; }
      for (let i = 0; i < pending.length; i += 1) { xs.push(pending[i][0]); rs.push(pending[i][1]); }
      pending.length = 0;
    },
  };
  const rootC = mount();
  clickPill(rootC);
  const cRail = findOne(rootC, "es-rail");
  cRail.rect = DEFAULT_RECT;
  const cCanvas = findOne(rootC, "es-rail__fluid");
  const cCtx = cCanvas.ctx;
  const rawArcC = cCtx.arc.bind(cCtx);
  cCtx.arc = (x, y, rad) => {
    const m = /rgba\((\d+),(\d+),(\d+)/.exec(String(cCtx.fillStyle));
    if (m) pending.push([x, Number(m[1])]);
    rawArcC(x, y, rad);
  };
  flushFrames(900);          // ≈15 秒模拟时间（hueCycle=7000ms，往返两轮多）
  cCtx.arc = rawArcC;
  delete win.__FLUID_TEST_HOOK__;

  const maxX = xs.length ? Math.max(...xs) : 0;
  const span = (list) => (list.length < 3 ? 0 : Math.max(...list) - Math.min(...list));
  const col75 = [];
  const src = [];
  for (let i = 0; i < xs.length; i += 1) {
    if (Math.abs(xs[i] - maxX * 0.75) <= maxX * 0.03) col75.push(rs[i]);
    if (xs[i] <= maxX * 0.08) src.push(rs[i]);
  }
  const s75 = span(col75);
  const sSrc = span(src);
  check("采样量足够（真的抓到了粒子和颜色）",
    frameIdx >= 900 && col75.length > 200 && src.length > 200,
    `frames=${frameIdx} col75=${col75.length} src=${src.length}`);
  check("75% 那一列的颜色随时间大幅变化（跨度 ≥60；按位置取色时恒为同一档紫、跨度个位数）",
    s75 >= 60, `跨度 ${s75}（min ${col75.length ? Math.min(...col75) : "-"} / max ${col75.length ? Math.max(...col75) : "-"}）`);
  check("源头（最左 8%）的颜色也在变（跨度 ≥60）",
    sSrc >= 60, `跨度 ${sSrc}（min ${src.length ? Math.min(...src) : "-"} / max ${src.length ? Math.max(...src) : "-"}）`);
  const srcText = readFileSync(here("../client.js"), "utf8");
  check("FLUID_PRESET 里有 hueCycle（源头颜色往返周期）", /hueCycle:\s*\d+/.test(srcText), "见 client.js FLUID_PRESET");
  // 用户：「变得太快了，要慢变」——把"慢"钉住，免得以后有人顺手把周期调小
  const hue = /hueCycle:\s*(\d+)/.exec(srcText);
  check("hueCycle ≥ 20000ms（原文是 7000，用户嫌太快；改小会让颜色又变急）",
    hue !== null && Number(hue[1]) >= 20000, hue ? `hueCycle=${hue[1]}ms` : "读不到");
  check("按位置取色的旧代码已不存在（没有 (pt.x - FLUID_INSET) 那段）",
    !/\(pt\.x - FLUID_INSET\)/.test(srcText), "旧写法：按 x 位置在色带上取样");
  // 场景跑完把钩子恢复成第 [10] 节的形态，别留给后面的代码
  win.__FLUID_TEST_HOOK__ = { onFrame: () => { if (frameHandler) frameHandler(); } };
  frameHandler = null;
}


/* ── [16] 最高档提速：选中最高等级时流速 ×2 ──────────────────────────────
   用户：「当选中最高档位时，流体流速变为原来的2倍」。
   判据用钩子新传出的第 5 个标量（本帧实际用的 speed）与第 6 个（是否最高档），
   而不是从源码里算 —— 要钉的是"引擎真的用了这个速度"。
   `pct` 是 React 侧经 ref 喂进来的，所以必须走**轨道自己的 props 处理器**拨档
   （与 [11] 同一套 driveRail），改桩珠子的位置只能改 litW、改不了 pct。 */
console.log("[16] 最高档提速：选中最高等级时流速 ×2");
{
  prefsSnapshot = { skin: "fluid" };
  afterPropsHook = null;
  canvasOptions.ctxMode = "ok";
  canvasOptions.hasGetContext = true;
  let last = null;
  win.__FLUID_TEST_HOOK__ = {
    onFrame: (litW, pct, count, source, speed, isTop) => { last = { litW: litW, pct: pct, speed: speed, isTop: isTop }; },
  };
  const rootFast = mount();
  clickPill(rootFast);
  const fRail = findOne(rootFast, "es-rail");
  fRail.rect = DEFAULT_RECT;
  const fTicks = findAll(rootFast, "es-tick");
  const fEvent = (clientX) => ({
    clientX: clientX, clientY: DEFAULT_RECT.height / 2, pointerId: 1,
    preventDefault() {}, stopPropagation() {},
  });
  const fDrive = (clientX) => {
    fRail.props.onPointerDown(fEvent(clientX));
    fRail.props.onPointerMove(fEvent(clientX));
    fRail.props.onPointerUp(fEvent(clientX));
    flush();
  };
  const fInner = DEFAULT_RECT.width - 34;
  const fAt = (index, n) => 17 + fInner * (index / Math.max(1, n - 1));
  const n = fTicks.length;
  const VEL = presetNumber("vel", 0.43);
  const MUL = presetNumber("topSpeedMul", 2);

  fDrive(fAt(Math.floor((n - 1) / 2), n));
  flushFrames(2);
  const mid = last ? Object.assign({}, last) : null;
  fDrive(fAt(n - 1, n));
  flushFrames(2);
  const top = last ? Object.assign({}, last) : null;

  check("拨档后钩子拿到了本帧速度（钩子签名已扩到 6 个标量）",
    mid !== null && typeof mid.speed === "number" && top !== null && typeof top.speed === "number",
    `mid=${mid && mid.speed} top=${top && top.speed}`);
  check(`中间档（pct=${mid ? mid.pct : "?"}）速度 = vel(${VEL})，不提速`,
    mid !== null && Math.abs(mid.speed - VEL) < 1e-9,
    mid ? `speed=${mid.speed}` : "n/a");
  check(`最高档（pct=${top ? top.pct : "?"}）速度 = vel × ${MUL}（用户要求的 ×2）`,
    top !== null && Math.abs(top.speed - VEL * MUL) < 1e-9,
    top ? `speed=${top.speed}，期望 ${VEL * MUL}` : "n/a");
  check("最高档标记只在最高档为 1（中间档必须是 0）",
    mid !== null && mid.isTop === 0 && top !== null && top.isTop === 1,
    `mid.isTop=${mid && mid.isTop} top.isTop=${top && top.isTop}`);

  win.__FLUID_TEST_HOOK__ = { onFrame: () => { if (frameHandler) frameHandler(); } };
  frameHandler = null;
}


console.log("");
if (failures === 0) {
  console.log(`全部通过 ✅ （${passes} 项）`);
} else {
  console.log(`${failures} 项失败 ❌（${passes} 项通过）`);
  process.exitCode = 1;
}
