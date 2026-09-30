/**
 * 接线检查：**有值，但没人消费**。
 *
 * 这一类 bug 测试拦不住，因为测试测的是"那段代码"，不是"那段接线"。真实发生过三次：
 *
 *   1. `gesture` 传给了 `Sprite`，但真正画图的是 `SkinnedSprite`，它没收到这个 prop ——
 *      于是"举召唤器"这个功能每次点击都在动画帧里抛 `gesture is not defined`；
 *   2. `buildRig` 支持 `arms`，客户端却从来没传过 —— 手臂那一整段代码算完就扔，
 *      从来没执行过一次；
 *   3. 面板声明了 `mascot.panel` 子槽却没人填 —— 预览的桩把它挡住了，装到机器上点开是空的。
 *
 * 前两个是同一件事：**调用点写了这个 prop，组件那边没接**。这个脚本就查这一条 ——
 * 静态、快、不需要浏览器。
 *
 * 借鉴自 dsh-whale-widget：它也为这个 bug 类加了一条专门的 CI 检查
 * （起因是一个音量滑块拖了没用，因为消费方读的是另一个值）。
 *
 *   node scripts/check-wiring.mjs                       # 查 lib/client.js
 *   node scripts/check-wiring.mjs ../x/lib/client.js    # 查指定的文件
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.slice(2);
const files = targets.length > 0 ? targets : [join(root, "lib", "client.js")];

/** React 自己会消费的 key，传了但组件不解构不算问题。 */
const REACT_OWN = new Set(["key", "ref", "__self", "__source"]);

/**
 * 组件定义：`function Name({ a, b })` 或 `function Name(props)`。
 * 后者的 props 是整体用的，静态查不出哪些没被读 —— 记成 `null`，跳过检查。
 */
function components(text) {
  const found = new Map();
  for (const match of text.matchAll(/function ([A-Z][A-Za-z0-9]*)\(\{([^}]*)\}\)/gu)) {
    const names = match[2]
      .split(",")
      .map((part) => part.split(/[:=]/u)[0].trim())
      .filter((name) => name !== "");
    found.set(match[1], names);
  }
  for (const match of text.matchAll(/function ([A-Z][A-Za-z0-9]*)\(props\)/gu)) found.set(match[1], null);
  return found;
}

/** 调用点：`h(Component, { a, b })` —— 只认字面量对象，带展开的（`...x`）整条跳过。 */
function callSites(text) {
  const sites = [];
  for (const match of text.matchAll(/h\(([A-Z][A-Za-z0-9]*), \{/gu)) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = text.slice(start + 1, end);
    if (body.includes("...")) continue;
    const keys = body
      .split(",")
      .map((part) => part.split(":")[0].trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/u.test(name));
    const line = text.slice(0, match.index).split("\n").length;
    sites.push({ component: match[1], keys, line });
  }
  return sites;
}

const problems = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const defined = components(source);
  const sites = callSites(source);
  let checked = 0;
  for (const site of sites) {
    if (!defined.has(site.component)) continue;
    const accepted = defined.get(site.component);
    if (accepted === null) continue;
    checked++;
    for (const key of site.keys) {
      if (REACT_OWN.has(key)) continue;
      if (!accepted.includes(key)) {
        problems.push(`${relative(root, file)}:${String(site.line)}  h(${site.component}, { ${key} })  —— 组件没解构这个 prop`);
      }
    }
  }
  console.log(`  ${relative(root, file).padEnd(24)} ${String(sites.length)} 个调用点，${String(checked)} 个可静态核对，${String(defined.size)} 个组件`);
}

if (problems.length > 0) {
  console.log("\n传了但没人接的 prop：");
  for (const line of problems) console.log("  " + line);
  console.log("\n这一类 bug 不会让构建失败，只会让功能静默失效 —— 补上消费方，或把调用点删掉。");
  process.exit(1);
}
console.log("每一个传出去的 prop 都有消费方。");
