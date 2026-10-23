/**
 * 把 client.js + effort-slider.css 打进 lib/client.js ——
 * 官方 checklist 第 5 条：「Rebuild the bundle before probing a live dsh web server —
 * the registry serves lib/client.js, not sources.」所以每次改完源码要跑一次：
 *
 *   node build.mjs
 *
 * ── 导出通道（2026-10 改版，已被官方实现取证）────────────────────────────
 * loader 的物化实现是（app.asar @22577096，client-modules 的 materialize()）：
 *
 *     const registered = this.factories.get(id);
 *     const record = { id, exports: registered(this.makeRequire(edges)), … };
 *
 * 即 **工厂的返回值就是模块 exports**，loader 只做一次 `factory(require)`，
 * **不注入 `module` / `exports` 绑定**。官方 bundle（如 @agents-anywhere/dsh-bridge-next）
 * 因此都在工厂内部自己声明：
 *
 *     var module = { exports: {} };  var exports = module.exports;  …  return module.exports;
 *
 * 本脚本照此办理：工厂自己声明 `module`，模块体用 `module.exports = { apply, inject }` 导出。
 * ⚠️ 官方 bundle 里还有一行 `var exports = module.exports;` —— 那是给 `exports.xxx = …`
 * 赋值用的；本插件全树只有一处 `module.exports = {…}` 赋值（**没有任何 `exports.xxx` 写入**），
 * 所以这里**故意不声明 `exports`**：留一个死绑定只会误导读者以为走的是 exports 通道；
 * 而且将来真有人在模块体里写 `exports.xxx`，IIFE 的严格模式会立刻 ReferenceError 报出来，
 * 比"看起来有 exports 通道其实没有"要好。产物形状断言里也钉住了这一点（见第 4 节）。
 * 旧的 `window.__DSH_EFFORT_SLIDER__` 全局通道已废弃 —— materialize() 先查
 * loadCache，已物化就不再重跑模块体，读全局会拿到陈旧导出（HMR/重物化会踩）。
 * 导出里也**不再有静默空插件兜底**：导出不对就抛错，让失败响亮。
 *
 * ── 四条硬规矩 ──────────────────────────────────────────────────────────
 *  1. 所有断言都在内存里跑完才落盘：先写临时文件 → 复读校验 → 原子改名。
 *     任何一步失败都**不覆盖**已有产物，也不会留下半成品。
 *  2. 产物必须真的能解析、真的能物化：解析（vm.Script）+ 在「没有 module/exports
 *     全局」的沙箱里按真实约定 `factory(require)` 调一次，验 apply/inject。
 *  3. 旧版第 17 行要求 client.js **必须**含样式占位符，第 24 行又因 client.js
 *     **含**占位符而抛错 —— 两条互斥断言让脚本 100% 跑不通，产物因此长期停在更早
 *     一代配方上。现在按真实语义拆开：client.js 必须含（那是注入点），
 *     effort-slider.css 不许含，**产物**不许有残留。
 *  4. **源漂移防线**：这个插件有多人并行改，读取时记下 client.js / effort-slider.css
 *     的指纹，落盘前再读一次比对；构建期间源码变了就整轮作废、不落盘（见第 6 节）。
 *     摘要里也打印来源指纹，谁都能看出"这份产物是从哪一版源码构建的"。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const PACKAGE_ID = "dsh-effort-slider";
const PLACEHOLDER = "__EFFORT_SLIDER_CSS__";
const OUT_FILE = here("./lib/client.js");
const LIB_DIR = here("./lib/");

/** 断言失败即中止：此刻还没有写过任何文件。 */
function assert(condition, label, detail) {
  if (!condition) {
    throw new Error(`[build] 断言失败：${label}${detail === undefined ? "" : `\n        ↳ ${detail}`}`);
  }
  return true;
}

const sha = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
const bytes = (text) => Buffer.byteLength(text, "utf8");

/** 从 openIndex 处的括号开始做配对扫描，返回括号内文本（跳过字符串与注释）。 */
function readBalanced(text, openIndex, open, close) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i += 1; i < text.length; i += 1) {
        if (text[i] === "\\") { i += 1; continue; }
        if (text[i] === ch) break;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") { const nl = text.indexOf("\n", i); i = nl === -1 ? text.length : nl; continue; }
    if (ch === "/" && text[i + 1] === "*") { const end = text.indexOf("*/", i + 2); i = end === -1 ? text.length : end + 1; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) { depth -= 1; if (depth === 0) return text.slice(openIndex + 1, i); }
  }
  return null;
}

/** 读出一个 JSON 字符串字面量（含引号），用于从产物里反推内嵌 CSS。 */
function readJsonStringLiteral(text, quoteIndex) {
  for (let i = quoteIndex + 1; i < text.length; i += 1) {
    if (text[i] === "\\") { i += 1; continue; }
    if (text[i] === '"') return text.slice(quoteIndex, i + 1);
  }
  return null;
}

/**
 * 按真实 loader 的约定执行产物：跑一遍脚本 → 取 bundle factory →
 * 用**恰好一个参数** `factory(require)` 调用，并把返回值当模块 exports。
 * 沙箱里**故意不提供** module / exports 全局：工厂必须自给自足。
 */
function materializeArtifact(artifact, filename) {
  const registrations = [];
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: {
      head: { append() {} },
      body: {},
      createElement: () => ({ dataset: {}, style: {}, append() {}, remove() {} }),
      querySelector: () => null,
    },
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
    fetch: () => Promise.resolve({ ok: false }),
    localStorage: { getItem: () => null, setItem() {} },
  };
  sandbox.globalThis = sandbox;
  // 注意：这里没有 module / exports —— 与浏览器里工厂的真实作用域一致
  const context = vm.createContext(sandbox);
  new vm.Script(artifact, { filename }).runInContext(context);

  assert(registrations.length === 1, `产物应当只注册一个 bundle factory，实际 ${registrations.length}`);
  const registration = registrations[0];
  assert(
    registration.id === PACKAGE_ID,
    "产物注册的 id 与包名不一致（row id 必须等于包名）",
    String(registration.id),
  );
  assert(typeof registration.factory === "function", "产物的 factory 不是函数");

  // 只传 require：多传 module/exports 会把「工厂不自足」这个错误掩盖掉
  const stubRequire = () => { throw new Error("构建期不应真的 require 任何模块"); };
  const exports = registration.factory(stubRequire);
  return { exports, registrations, context };
}

/* ────────────────────── 1. 读源码 ────────────────────── */

/* 行尾归一：CI 的 Windows runner 用 core.autocrlf=true 检出（工作区是 CRLF），而
   effort-slider.css 的原文会被整段嵌进产物 —— 不归一的话同一份源码会在 Windows 上
   构建出与仓库里那份**不同**的产物，「产物是否过期」那一步必然变红。
   仓库里另有一份 .gitattributes 强制 LF，这里是第二道保险（防本机 autocrlf=true）。 */
const toLf = (text) => text.replace(/\r\n?/g, "\n");

const source = toLf(readFileSync(here("./client.js"), "utf8"));
const css = toLf(readFileSync(here("./effort-slider.css"), "utf8"));

/* ────────────────────── 2. 源码前置断言 ────────────────────── */
/* 缺任何一条，产物都会「构建成功但界面什么都没有」，所以这里必须炸。 */

assert(source.includes(PLACEHOLDER), `client.js 缺少样式占位符 ${PLACEHOLDER}`);
assert(
  source.includes("createApply"),
  "client.js 里找不到 createApply：导出拿不到真身 apply，控件静默不挂载",
);
assert(
  /module\.exports\s*=/.test(source),
  "client.js 没有用 module.exports 导出（免全局的导出通道要求模块体自己赋值）",
);
assert(
  /module\.exports\s*=\s*\{[\s\S]{0,200}?apply\s*:/m.test(source),
  "client.js 的 module.exports 没有 apply 成员",
);
assert(
  /module\.exports\s*=\s*\{[\s\S]{0,200}?inject\s*:\s*inject\b/m.test(source),
  "client.js 的 module.exports 没有 inject: inject —— 工厂会拿到空 inject 数组，插槽形同虚设",
);
assert(
  !/window\.__DSH_EFFORT_SLIDER__\s*=/.test(source),
  "client.js 又出现了 window.__DSH_EFFORT_SLIDER__ = … 全局导出通道："
  + "materialize() 先查 loadCache，重物化不重跑模块体，读全局会拿到陈旧导出（HMR 会踩）",
);

// inject 数组：必须含 slots（ctx.slots.inject 是唯一合法的插槽贡献方式）
const injectKey = source.search(/var\s+inject\s*=/);
assert(injectKey >= 0, "client.js 顶层找不到 var inject = [...]");
const injectBracket = source.indexOf("[", injectKey);
assert(injectBracket > injectKey, "var inject = 后面不是数组字面量");
const injectBody = readBalanced(source, injectBracket, "[", "]");
assert(injectBody !== null, "var inject = [...] 的括号不配对");
let INJECT = null;
try {
  // readBalanced 给的是括号**内部**文本，这里补回数组方括号才能当 JSON 解析
  INJECT = JSON.parse(`[${injectBody}]`);
} catch (error) {
  assert(false, "var inject = [...] 不是合法 JSON 数组（请用双引号字符串）", String(error));
}
assert(Array.isArray(INJECT), `inject 必须是数组，实际 ${typeof INJECT}`);
assert(
  INJECT.includes("slots"),
  'inject 数组必须包含 "slots"，否则 ctx.slots.inject 不会被 Cordis 等待，插槽不会注册',
  JSON.stringify(INJECT),
);

/* ────────────────────── 3. 字符卫生 ────────────────────── */

for (const [label, text] of [["client.js", source], ["effort-slider.css", css]]) {
  assert(!/<\/script/i.test(text), `${label} 含 </script>，会截断脚本标签`);
  assert(!/[\u2028\u2029]/.test(text), `${label} 含 U+2028/U+2029，会破坏 JS 字符串字面量`);
}
assert(
  !css.includes(PLACEHOLDER),
  "effort-slider.css 含样式占位符本身（占位符只应出现在 client.js 的 var CSS = … 注入点）",
);

/* ────────────────────── 4. 生成产物（纯内存，未落盘） ────────────────────── */

// 占位符在赋值语句里出现，直接替换成 JSON 字符串字面量
const body = source.split(PLACEHOLDER).join(JSON.stringify(css));
const banner = [
  "/* 由 build.mjs 生成，请勿直接编辑；改 client.js 或 effort-slider.css 后重新构建。 */",
  "window.__ModuleLoader__.load({",
  `  id: ${JSON.stringify(PACKAGE_ID)},`,
  "  factory: function (require) {",
  // loader 不注入 module：工厂必须自己声明，返回值才是模块 exports（官方 bundle 同形）
  "    var module = { exports: {} };",
  // 这里**故意没有** `var exports = module.exports;`：官方 bundle 有那一行，是因为它们用
  // `exports.xxx = …` 赋值；本插件全树只有一处 `module.exports = {…}` 赋值（无 exports.xxx
  // 写入），留着就是死绑定、还会误导读者以为走的是 exports 通道。第 4 节有断言钉住。
  // 必须出现在模块体之前：模块体（含 createReactResolver 的闭包）从模块顶层读它，
  // 缺了它 typeof 判false → require('react') 这条官方路径会**静默跳过**
  "    var __esRequire = require;",
  body,
  "    if (module.exports && typeof module.exports.apply === 'function') return module.exports;",
  "    throw new Error('dsh-effort-slider: bundle 未设置导出（require 或模块体有问题）');",
  "  },",
  "});",
  "",
].join("\n");

/* 产物形状断言：包装层不能被改写掉，否则 source 里的真身就白写了 */
assert(banner.includes(`id: ${JSON.stringify(PACKAGE_ID)}`), "产物里 bundle id 与包名不一致");
assert(
  banner.indexOf("var module = { exports: {} };") < banner.indexOf("var CSS = "),
  "工厂的 var module = { exports: {} }; 必须出现在模块体之前（loader 不注入 module）",
);
assert(
  banner.indexOf("var __esRequire = require;") < banner.indexOf("var CSS = "),
  "工厂的 var __esRequire = require; 必须出现在模块体之前（否则 require('react') 静默失效）",
);
assert(banner.includes("return module.exports;"), "产物工厂没有把 module.exports 交回给 loader");
// 死绑定防线：client.js 全树只有一处 `module.exports = {…}`、没有任何 `exports.xxx` 写入，
// 所以工厂里不该出现 `var exports = module.exports;`（行首匹配，注释里的提及不算）。
assert(
  !/^[ \t]*var\s+exports\s*=\s*module\.exports\s*;/m.test(banner),
  "产物工厂里又出现了死绑定 var exports = module.exports;（本插件没有 exports.xxx 写入）",
);
assert(
  banner.includes("bundle 未设置导出"),
  "产物工厂丢了「导出不对就抛错」的响亮失败分支（会退回静默空插件）",
);
assert(!banner.includes(PLACEHOLDER), "产物里仍有样式占位符残留（替换没生效）");

/* ────────────── 5. 产物级校验：真的解析一遍、真的物化一遍 ────────────── */

const PARSED = { ok: false };
try {
  // 产物会成为 <script> 的内容：按经典脚本（非 ESM）编译，只解析不执行。
  // 顶层 import/export、语法错误、被截断的字符串都会在这里炸掉。
  new vm.Script(banner, { filename: "lib/client.js" });
  PARSED.ok = true;
} catch (error) {
  assert(false, "产物无法被 JS 引擎解析，绝不落盘", String(error && error.message ? error.message : error));
}

const LOADED = { ok: false, id: null, applyOk: false, applyReal: false, inject: null };
{
  const { exports, context } = materializeArtifact(banner, "lib/client.js");
  LOADED.id = PACKAGE_ID;
  assert(exports !== null && typeof exports === "object", "工厂没有返回 exports 对象");
  assert(typeof exports.apply === "function", "exports.apply 不是函数（loader 会拿不到可激活的插件）");
  assert(
    Array.isArray(exports.inject) && exports.inject.includes("slots"),
    'exports.inject 不含 "slots"：插槽不会注册',
    JSON.stringify(exports.inject),
  );

  // 关键：确认拿到的是 createApply() 的真身，而不是静默的空插件
  const applySource = String(exports.apply);
  assert(applySource.includes("slots.inject"), "exports.apply 不像真身（函数体里没有 slots.inject）");
  assert(
    !applySource.includes("未被正确物化"),
    "exports.apply 是旧的未物化占位实现",
  );
  LOADED.applyOk = true;

  // 全局通道必须已经不存在：沙箱里没有 window.__DSH_EFFORT_SLIDER__，导出依然完整
  assert(
    context.window.__DSH_EFFORT_SLIDER__ === undefined,
    "产物不该再往 window.__DSH_EFFORT_SLIDER__ 上挂导出通道",
  );
  LOADED.applyReal = true;
  LOADED.ok = true;
}

/* 反向校验：从产物里把内嵌 CSS 抠出来，跟 effort-slider.css 逐字节比对 */
const CSS_EMBED = { ok: false, bytes: 0 };
{
  const marker = "var CSS = ";
  const markerAt = banner.indexOf(marker);
  assert(markerAt >= 0, "产物里找不到 var CSS = …（样式没有内嵌）");
  assert(
    banner.indexOf(marker, markerAt + marker.length) === -1,
    "产物里出现多处 var CSS = …，无法确定内嵌样式",
  );
  const quoteAt = banner.indexOf('"', markerAt + marker.length);
  assert(quoteAt > markerAt, "var CSS = 后面不是 JSON 字符串字面量");
  const literal = readJsonStringLiteral(banner, quoteAt);
  assert(literal !== null, "内嵌 CSS 字符串字面量没有闭合");
  const embedded = JSON.parse(literal);
  assert(
    embedded === css,
    "产物内嵌的 CSS 与 effort-slider.css 不一致",
    `embedded ${bytes(embedded)} bytes / file ${bytes(css)} bytes`,
  );
  CSS_EMBED.ok = true;
  CSS_EMBED.bytes = bytes(embedded);
}

/* 负向校验：把导出故意改坏，工厂必须「响亮抛错」而不是返回静默空插件 */
const GUARD = { tested: false, loud: false };
{
  const anchor = "apply: createApply(__initialRequire)";
  const first = banner.indexOf(anchor);
  if (first >= 0 && banner.indexOf(anchor, first + anchor.length) === -1) {
    const broken = banner.slice(0, first) + "apply: 0" + banner.slice(first + anchor.length);
    let message = "";
    try {
      materializeArtifact(broken, "lib/client.js (导出故意改坏)");
    } catch (error) {
      message = String(error && error.message ? error.message : error);
    }
    GUARD.tested = true;
    assert(
      message.includes("bundle 未设置导出"),
      "导出坏掉时工厂没有命中「响亮抛错」分支（静默空插件会把真错误伪装成 inject 异常）",
      message || "（居然没有抛错）",
    );
    GUARD.loud = true;
  }
}

/* ────────────────────── 6. 落盘：先临时文件，校验通过再原子改名 ────────────────────── */

/* 源漂移防线：本仓库有多人并行改同一个插件，绝不能用一份「半路读到的」源码落盘。
   读取时记指纹，落盘前再读一次比对；不一致就整轮作废（不创建临时文件、不动已有产物）。 */
const SOURCE_AT_READ = { client: sha(source), css: sha(css) };
function readSourceNow() {
  try {
    return { client: sha(toLf(readFileSync(here("./client.js"), "utf8"))), css: sha(toLf(readFileSync(here("./effort-slider.css"), "utf8"))) };
  } catch (error) {
    return { client: `read-error: ${String(error && error.message ? error.message : error)}`, css: "" };
  }
}
const SOURCE_NOW = readSourceNow();
assert(
  SOURCE_NOW.client === SOURCE_AT_READ.client && SOURCE_NOW.css === SOURCE_AT_READ.css,
  "构建期间源码被改动（有人在并发编辑），本次产物作废、不落盘 —— 请等源码稳定后重跑",
  `读取时 client.js ${SOURCE_AT_READ.client.slice(0, 16)} / css ${SOURCE_AT_READ.css.slice(0, 16)}`
  + `；现在 client.js ${SOURCE_NOW.client.slice(0, 16)} / css ${SOURCE_NOW.css.slice(0, 16)}`,
);

mkdirSync(LIB_DIR, { recursive: true });
const previous = existsSync(OUT_FILE) ? toLf(readFileSync(OUT_FILE, "utf8")) : null;
const previousBytes = previous === null ? 0 : bytes(previous);

let writeState;
if (previous === banner) {
  writeState = "unchanged（内容一致，未写盘 —— 幂等）";
} else {
  const tmpFile = `${OUT_FILE}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpFile, banner, "utf8");
    const reread = readFileSync(tmpFile, "utf8");
    assert(reread === banner, "临时文件复读与内存产物不一致");
    // 磁盘上的字节也要再解析一次：这一步过了才允许改名上台
    new vm.Script(reread, { filename: "lib/client.js (tmp)" });
    renameSync(tmpFile, OUT_FILE);
  } catch (error) {
    if (existsSync(tmpFile)) rmSync(tmpFile, { force: true });
    assert(
      false,
      `写入失败（已有产物未被改动，仍是 ${previousBytes} bytes）`,
      String(error && error.message ? error.message : error),
    );
  }
  writeState = `written ${bytes(banner)} bytes（临时文件校验通过 → 原子改名；旧产物 ${previousBytes} bytes）`;
}

/* ────────────────────── 7. 摘要 ────────────────────── */

const flag = (on) => (on ? "yes" : "no");
console.log("[build] dsh-effort-slider -> lib/client.js");
console.log(`  artifact     ${bytes(banner)} bytes  sha256 ${sha(banner)}`);
console.log(`  source       client.js ${SOURCE_AT_READ.client.slice(0, 16)} | effort-slider.css ${SOURCE_AT_READ.css.slice(0, 16)}`);
console.log(`  embedded css ${CSS_EMBED.bytes} bytes  identical to effort-slider.css: ${flag(CSS_EMBED.ok)}`);
console.log(`  export       module.exports.apply: ${flag(LOADED.applyOk)}`
  + ` | inject[slots]: ${flag(INJECT.includes("slots"))}`
  + ` | global channel: removed`
  + ` | loud throw on bad exports: ${GUARD.tested ? flag(GUARD.loud) : "skipped(no anchor)"}`);
console.log(`  inject       ${JSON.stringify(INJECT)}`);
console.log(`  checks       parse(vm.Script): ${flag(PARSED.ok)}`
  + ` | materialized as factory(require): ${flag(LOADED.ok)}`
  + ` | bundle id: ${LOADED.id}`
  + ` | apply is real: ${flag(LOADED.applyReal)}`
  + ` | esRequire declared before body: yes`
  + ` | placeholder residue: none`);
console.log(`  write        ${writeState}`);
