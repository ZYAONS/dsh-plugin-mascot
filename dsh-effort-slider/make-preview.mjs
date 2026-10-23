/**
 * 生成一张「真 CSS + 真类名」的静态核对图，用来在重启 DSH 之前
 * 确认插件里的样式和之前迭代定稿的预览一致。
 *
 *   node make-preview.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const css = readFileSync(here("./effort-slider.css"), "utf8");

const EFFORTS = [
  ["轻度", "最快最省，适合改写、翻译这类不需要深想的活。"],
  ["中", "日常默认档，常规问答与普通代码改动。"],
  ["高", "多步推理、调试与方案设计，明显更慢但更稳。"],
  ["极高", "复杂重构、长链路排障，token 消耗显著上升。"],
  ["最高", "压满算力啃硬骨头：架构级设计与疑难 bug 攻坚。"],
];

/* 皮肤清单 —— 必须和 index.mjs / client.js 里的 SKINS 保持一致，
   否则这个开发预览页会少渲染一套皮肤（踩过：加了 fluid 但这里没加）。 */
const SKINS = [
  ["nebula", "A 星际星云"],
  ["holo", "B 全息能量"],
  ["chrome", "C 液态金属"],
  ["fluid", "D 流体"],
];

function panel(skin, index) {
  const pct = (index / (EFFORTS.length - 1)) * 100;
  const name = EFFORTS[index][0];
  const ticks = EFFORTS.map(([label], i) => {
    const left = (i / (EFFORTS.length - 1)) * 100;
    return `<span class="es-tick" data-on="${i === index ? 1 : 0}" style="left:${left.toFixed(3)}%">${label}</span>`;
  }).join("");
  const grid = [1, 2, 3].map((g) => `<i style="left:${((g / (EFFORTS.length - 1)) * 100).toFixed(3)}%"></i>`).join("");
  return `
  <div class="es-root" data-effort-slider="dsh-effort-slider" data-skin="${skin}"
       data-open="1" data-snap="0" data-busy="0" data-failed="0"
       style="--pct:${pct.toFixed(3)}%;--ratio:${(index / (EFFORTS.length - 1)).toFixed(4)}">
    <div class="es-panel" role="dialog">
      <div class="es-head"><span class="es-title">推理等级</span><span class="es-model">GPT-10 Eternal Galaxy</span></div>
      <div class="es-desc">${EFFORTS[index][1]}</div>
      <div class="es-railWrap">
        <div class="es-rail">
          <div class="es-rail__fx"></div>
          <div class="es-rail__fill"></div>
          <div class="es-rail__grid">${grid}</div>
          <div class="es-sparks"></div>
          <div class="es-knob"></div>
        </div>
        <div class="es-ticks">${ticks}</div>
      </div>
      <div class="es-foot">
        <div class="es-readout">
          <span class="es-readout__lvl">${index + 1}</span>
          <span class="es-readout__of">/ ${EFFORTS.length}</span>
          <span class="es-readout__name">${name}</span>
        </div>
        <div class="es-skins">
          ${SKINS.map(([id]) => `<button type="button" class="es-skin" data-on="${id === skin ? 1 : 0}" aria-label="${id}"></button>`).join("")}
        </div>
      </div>
      <div class="es-energy"><i></i></div>
    </div>
    <button type="button" class="es-pill">
      <span class="es-orb"><span class="es-orb__ring"></span><span class="es-orb__core"></span></span>
      <span class="es-pill__name">${name}</span>
    </button>
  </div>`;
}

function collapsed(skin) {
  return `
  <div class="es-root" data-effort-slider="dsh-effort-slider" data-skin="${skin}"
       data-open="0" data-snap="0" data-busy="0" data-failed="0" style="--pct:60%;--ratio:0.6">
    <button type="button" class="es-pill">
      <span class="es-orb"><span class="es-orb__ring"></span><span class="es-orb__core"></span></span>
      <span class="es-pill__name">高</span>
    </button>
  </div>`;
}

const rows = [
  ["nebula", 4], ["holo", 4], ["chrome", 4], ["fluid", 4],
  ["nebula", 1], ["holo", 1], ["chrome", 1], ["fluid", 1],
].map(([skin, index]) => `
  <section class="card">
    <div class="toolrow">
      <span class="tool">＋</span><span class="tool">◍</span><span class="tool wide">◇ Auto</span>
      <span class="spacer"></span>
      ${panel(skin, index)}
      <span class="send">↑</span>
    </div>
  </section>`).join("");

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>插件真样式核对图</title>
<style>
${css}
body{margin:0;background:#0b0c10;color:#e9edf6;font:400 14px/1.5 "Segoe UI","Microsoft YaHei",system-ui;
  display:flex;flex-direction:column;align-items:center;gap:230px;padding:60px 24px}
.card{width:min(780px,94vw);border:1px solid rgba(255,255,255,.10);border-radius:26px;background:#181b21;
  box-shadow:0 22px 54px rgba(0,0,0,.5);padding:14px 16px 10px}
.toolrow{display:flex;align-items:center;gap:9px;min-height:34px}
.tool{width:30px;height:30px;border-radius:99px;display:grid;place-items:center;color:#8e97a8;background:rgba(255,255,255,.05);font-size:14px}
.tool.wide{width:auto;padding:0 11px;gap:6px;display:flex;font-size:13px}
.spacer{flex:1}
.send{width:32px;height:32px;border-radius:99px;display:grid;place-items:center;background:#2b6cff;color:#fff;font-size:15px}
.collapsedrow{display:flex;gap:14px;align-items:center;margin-top:8px}
</style></head>
<body>
${rows}
<section class="card"><div class="toolrow"><span class="spacer"></span>
  <div class="collapsedrow">${SKINS.map(([s]) => collapsed(s)).join("")}</div>
  <span class="send">↑</span></div></section>
</body></html>`;

mkdirSync(here("./preview/"), { recursive: true });
writeFileSync(here("./preview/real-css.html"), html, "utf8");
console.log("wrote preview/real-css.html");
