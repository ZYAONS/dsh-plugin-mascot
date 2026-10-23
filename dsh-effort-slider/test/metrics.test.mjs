/**
 * metrics.mjs 的离线单测 —— 不依赖 DSH、不依赖网络、不依赖任何第三方包：
 *
 *   node test/metrics.test.mjs        （工作目录 = 插件目录）
 *
 * 全部用 node:assert/strict 断言；每条用例记一次"检查"，
 * 跑完打印检查条数，有失败就 process.exit(1)，全过 process.exit(0)。
 */
import assert from "node:assert/strict";
import { createFleetMeter, estimateTokens } from "../metrics.mjs";

let checks = 0;
let failed = 0;

function test(label, fn) {
  checks += 1;
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failed += 1;
    const message = String((error && error.message) || error).split("\n").join("\n       ");
    console.log(`  FAIL ${label}\n       ${message}`);
  }
}

/** 可注入时钟：时间完全由测试推进，不依赖真实时间 */
function clocked(options = {}) {
  const box = { t: 0 };
  const meter = createFleetMeter({ ...options, now: () => box.t });
  return {
    meter,
    set: (value) => {
      box.t = value;
    },
  };
}

const COUNTERS = ["rate", "gen", "agents", "generating", "total"];

/* ── 1. 空状态 ── */
test("空状态 sample() 全 0，且每个字段都是非负整数", () => {
  const { meter } = clocked({ windowMs: 1000 });
  const sample = meter.sample();
  assert.deepEqual(sample, { rate: 0, gen: 0, agents: 0, generating: 0, total: 0 });
  for (const key of COUNTERS) {
    assert.ok(Number.isInteger(sample[key]), `${key} 必须是整数`);
    assert.ok(sample[key] >= 0, `${key} 不能是负数`);
  }
});

/* ── 2. 单 agent text-delta ── */
test("单个 agent 的 text-delta：gen/rate/total 与估算函数一致（windowMs=1000 → 数值即窗口 token 数）", () => {
  const { meter, set } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  set(1000);
  meter.ingest("a", { type: "text-delta", text: "hello world" }); // 省略 atMs → 走注入的 now()
  assert.equal(estimateTokens("hello world"), 3); // 11 个字符 → ceil(11/4)
  const sample = meter.sample();
  assert.equal(sample.gen, 3);
  assert.equal(sample.rate, 3);
  assert.equal(sample.total, 3);
  assert.equal(sample.agents, 1);
  assert.equal(sample.generating, 1, "刚生成过 → 呼吸灯计数为 1");
});

/* ── 3. 速率按秒归一化 ── */
test("速率按秒归一化：默认 windowMs=1500 时 15 token → 10 tok/s，total 不归一化", () => {
  const { meter } = clocked(); // 默认 windowMs=1500 / generatingMs=800
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "text-delta", text: "a".repeat(60) }, 0); // ceil(60/4)=15
  assert.equal(estimateTokens("a".repeat(60)), 15);
  const sample = meter.sample();
  assert.equal(sample.gen, 10);
  assert.equal(sample.rate, 10);
  assert.equal(sample.total, 15);
});

/* ── 4. reasoning-delta ── */
test("reasoning-delta 同样计入生成", () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "reasoning-delta", text: "abcd" }, 5); // ceil(4/4)=1
  const sample = meter.sample();
  assert.equal(sample.gen, 1);
  assert.equal(sample.rate, 1);
  assert.equal(sample.total, 1);
});

/* ── 5. CJK 与 ASCII 的估算比例 ── */
test("CJK 逐字 1 token、ASCII 4 字符 1 token：等长 CJK 明显更多", () => {
  assert.equal(estimateTokens("中".repeat(8)), 8);
  assert.equal(estimateTokens("a".repeat(8)), 2);
  assert.equal(estimateTokens("中ab"), 2); // 1 + ceil(2/4)
  assert.equal(estimateTokens("\u{20000}\u{20001}"), 2); // BMP 之外：1 字 1 token
  assert.equal(estimateTokens("\u3000"), 1); // 全角空格落在 3000-30FF
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(null), 0);
  const cjk = estimateTokens("中".repeat(64));
  const ascii = estimateTokens("a".repeat(64));
  assert.ok(cjk >= ascii * 3, `等长 CJK ${cjk} 必须明显多于 ASCII ${ascii}`);
});

/* ── 6. 窗口过期 ── */
test("窗口过期：超过 windowMs 后 gen/rate 归零，total 不回退；呼吸灯先按 generatingMs 熄灭", () => {
  const { meter, set } = clocked({ windowMs: 1000, generatingMs: 400 });
  meter.setMembers(["a"]);
  set(5000);
  meter.ingest("a", { type: "text-delta", text: "a".repeat(40) }); // 10 token
  let sample = meter.sample();
  assert.equal(sample.gen, 10);
  assert.equal(sample.generating, 1);

  set(5400); // 恰好是 generatingMs 边界（下界闭区间）
  assert.equal(meter.sample().generating, 1, "边界上仍算生成中");

  set(5401);
  sample = meter.sample();
  assert.equal(sample.generating, 0, "超过 generatingMs 后呼吸灯熄灭");
  assert.equal(sample.gen, 10, "窗口还没过，速率不变");

  set(6000); // 恰好等于 t - windowMs
  assert.equal(meter.sample().gen, 10, "窗口下界闭区间：t - windowMs 的事件仍在窗口内");

  set(6001);
  sample = meter.sample();
  assert.equal(sample.gen, 0);
  assert.equal(sample.rate, 0);
  assert.equal(sample.total, 10, "累计不随窗口过期消失");
});

/* ── 7. 非成员被忽略 ── */
test("非成员 agent 的 chunk 一律忽略：gen/rate/total 都不动", () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  meter.ingest("b", { type: "text-delta", text: "a".repeat(400) }, 10);
  meter.ingest("b", { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } }, 10);
  const sample = meter.sample();
  assert.equal(sample.gen, 0);
  assert.equal(sample.rate, 0);
  assert.equal(sample.total, 0);
  assert.equal(sample.generating, 0);
  assert.equal(sample.agents, 1);
});

/* ── 8. setMembers 换空集合 ── */
test('setMembers 换成空集合后 agents === 0；已累计的 token 仍满足"自 reset() 起累计"', () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a", "b", "c"]);
  assert.equal(meter.sample().agents, 3);
  meter.ingest("a", { type: "text-delta", text: "a".repeat(40) }, 10); // 10 token
  assert.equal(meter.sample().total, 10);

  meter.setMembers([]);
  let sample = meter.sample();
  assert.equal(sample.agents, 0);
  assert.equal(sample.gen, 0, "没有成员 → 窗口速率为 0");
  assert.equal(sample.rate, 0);
  assert.equal(sample.total, 10, "成员退场不抹掉历史累计");

  meter.setMembers(new Set(["x", "y"]));
  assert.equal(meter.sample().agents, 2);
  meter.setMembers(new Set());
  assert.equal(meter.sample().agents, 0);
  meter.setMembers(undefined);
  sample = meter.sample();
  assert.equal(sample.agents, 0);
  assert.equal(sample.total, 10);
});

/* ── 9. usage 输入计账 ── */
test("usage 帧把输入计入 rate/total；includeCacheReads=false 扣 cacheRead，cacheWrite 不额外计", () => {
  const off = clocked({ windowMs: 1000 }).meter;
  off.setMembers(["a"]);
  off.ingest(
    "a",
    { type: "usage", usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 60, cacheWriteTokens: 30 } },
    10,
  );
  let sample = off.sample();
  assert.equal(sample.rate, 40, "100 - 60 = 40（cacheWrite 已含在 inputTokens 内，不再加）");
  assert.equal(sample.total, 40);
  assert.equal(sample.gen, 0, "输入不算生成");

  const on = clocked({ windowMs: 1000, includeCacheReads: true }).meter;
  on.setMembers(["a"]);
  on.ingest("a", { type: "usage", usage: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 60 } }, 10);
  sample = on.sample();
  assert.equal(sample.rate, 100);
  assert.equal(sample.total, 100);

  const dirty = clocked({ windowMs: 1000 }).meter;
  dirty.setMembers(["a"]);
  dirty.ingest("a", { type: "usage", usage: { inputTokens: 10, cacheReadTokens: 99 } }, 0);
  sample = dirty.sample();
  assert.equal(sample.rate, 0, "cacheRead > inputTokens 时不能算出负数");
  assert.equal(sample.total, 0);
});

/* ── 10. 精确化不重复计数 ── */
test("精确化：估算 10 + usage.outputTokens 25 → 累计取 25（max，不重复计数）", () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "text-delta", text: "x".repeat(40) }, 1000); // 估算 10
  assert.equal(meter.sample().total, 10);

  meter.ingest("a", { type: "usage", usage: { outputTokens: 25, inputTokens: 0 } }, 1000);
  let sample = meter.sample();
  assert.equal(sample.total, 25, "取 max(10, 25)，不是 10 + 25");
  assert.equal(sample.gen, 10, "usage 的 lump 不进窗口：窗口只认带时间戳的增量估算");

  meter.ingest("a", { type: "usage", usage: { outputTokens: 25, inputTokens: 0 } }, 1000);
  assert.equal(meter.sample().total, 50, "Σusage.outputTokens 是累加后再和估算比");

  meter.ingest("a", { type: "text-delta", text: "y".repeat(400) }, 1000); // 估算累计 10 + 100
  sample = meter.sample();
  assert.equal(sample.total, 110, "估算追上来之后取估算");
  assert.equal(sample.gen, 110);
});

/* ── 11. tool-call-delta ── */
test("tool-call-delta 的 argumentsDelta 计入生成；空值 / 非字符串不改数值", () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "tool-call-delta", argumentsDelta: '{"path":"a"}' }, 100); // 12 字符 → 3
  assert.equal(estimateTokens('{"path":"a"}'), 3);
  let sample = meter.sample();
  assert.equal(sample.gen, 3);
  assert.equal(sample.rate, 3);
  assert.equal(sample.total, 3);
  assert.equal(sample.generating, 1);

  meter.ingest("a", { type: "tool-call-delta", argumentsDelta: "" }, 100);
  meter.ingest("a", { type: "tool-call-delta" }, 100);
  meter.ingest("a", { type: "tool-call-delta", argumentsDelta: { partial: true } }, 100);
  sample = meter.sample();
  assert.equal(sample.total, 3);
  assert.equal(sample.gen, 3);
});

/* ── 12. 未知 / 畸形 chunk ── */
test("未知 / 畸形 chunk 不抛错、不改数值", () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "usage", usage: { inputTokens: 8 } }, 1000);
  const before = meter.sample();

  const junk = [
    { type: "block-start", id: "x" },
    { type: "block-end", id: "x" },
    { type: "finish", reason: "stop" },
    { type: "text-delta" },
    { type: "text-delta", text: 123 },
    { type: "reasoning-delta", text: "" },
    { type: "tool-call-delta", argumentsDelta: null },
    { type: "usage" },
    { type: "usage", usage: null },
    { type: "usage", usage: { inputTokens: "100", outputTokens: "5" } },
    {
      type: "usage",
      usage: { inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY, cacheReadTokens: -5 },
    },
    null,
    undefined,
    42,
    "chunk",
    [],
    {},
  ];
  for (const chunk of junk) {
    assert.doesNotThrow(() => meter.ingest("a", chunk), `chunk=${JSON.stringify(chunk)} 不应抛错`);
  }
  const after = meter.sample();
  assert.deepEqual(after, before, "畸形 chunk 不能改变任何数值");
  assert.ok(Number.isInteger(after.total));
});

/* ── 13. reset ── */
test("reset() 后 total 归零（成员集合也清空），之后可继续复用", () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "text-delta", text: "a".repeat(40) }, 0);
  meter.ingest("a", { type: "usage", usage: { inputTokens: 20, outputTokens: 30 } }, 0);
  assert.ok(meter.sample().total > 0);

  meter.reset();
  assert.deepEqual(meter.sample(), { rate: 0, gen: 0, agents: 0, generating: 0, total: 0 });

  meter.setMembers(["a"]);
  meter.ingest("a", { type: "text-delta", text: "abcd" }, 1);
  assert.equal(meter.sample().total, 1, "reset 之后还能继续用");
});

/* ── 14. dispose ── */
test("dispose() 之后 sample() 不抛错且返回全 0；ingest / setMembers / reset 变空操作", () => {
  const { meter } = clocked({ windowMs: 1000 });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "text-delta", text: "a".repeat(40) }, 0);
  assert.equal(meter.sample().total, 10);

  assert.doesNotThrow(() => meter.dispose());
  assert.deepEqual(meter.sample(), { rate: 0, gen: 0, agents: 0, generating: 0, total: 0 });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "text-delta", text: "a".repeat(40) }, 0);
  meter.reset();
  assert.deepEqual(meter.sample(), { rate: 0, gen: 0, agents: 0, generating: 0, total: 0 });
});

/* ── 15. 实例之间无共享状态 ── */
test("两个 meter 实例互不影响（没有模块级共享状态）", () => {
  const one = clocked({ windowMs: 1000 });
  const two = clocked({ windowMs: 1000 });
  one.meter.setMembers(["a"]);
  two.meter.setMembers(["a"]);
  one.meter.ingest("a", { type: "text-delta", text: "a".repeat(40) }, 0);
  assert.equal(one.meter.sample().total, 10);
  assert.equal(two.meter.sample().total, 0);
});

/* ── 16. 非法 options ── */
test("非法 options 不产生 NaN / Infinity：windowMs=0 / NaN / 负数 / 字符串都被兜底", () => {
  const optionSets = [
    { windowMs: 0 },
    { windowMs: Number.NaN },
    { windowMs: -100 },
    { windowMs: "1000" },
    { windowMs: 1000, generatingMs: -1 },
    { windowMs: 1000, now: null },
  ];
  for (const options of optionSets) {
    const { meter, set } = clocked(options);
    meter.setMembers(["a"]);
    set(1000);
    meter.ingest("a", { type: "text-delta", text: "a".repeat(40) });
    const sample = meter.sample();
    for (const key of COUNTERS) {
      assert.ok(
        Number.isFinite(sample[key]) && Number.isInteger(sample[key]) && sample[key] >= 0,
        `options=${JSON.stringify(options)} → ${key}=${sample[key]}`,
      );
    }
  }

  // 注入一个只会返回垃圾的 now 也不能污染结果
  const meter = createFleetMeter({ windowMs: 1000, now: () => Number.NaN });
  meter.setMembers(["a"]);
  meter.ingest("a", { type: "text-delta", text: "abcd" });
  const sample = meter.sample();
  for (const key of COUNTERS) {
    assert.ok(
      Number.isFinite(sample[key]) && Number.isInteger(sample[key]) && sample[key] >= 0,
      `now 返回 NaN → ${key}=${sample[key]}`,
    );
  }
});

/* ── 17. 随机压力：非负整数 + total 单调不减 ── */
test("500 次随机 ingest（含时间回退、成员增减）：字段恒为非负整数，total 单调不减", () => {
  let t = 0;
  const meter = createFleetMeter({ windowMs: 1500, generatingMs: 800, now: () => t });
  const pool = ["a", "b", "c", "d"];
  let expectedMembers = new Set();
  meter.setMembers(["a", "b"]);
  expectedMembers = new Set(["a", "b"]);
  let prevTotal = 0;

  for (let i = 0; i < 500; i += 1) {
    t += Math.floor(Math.random() * 400) - 50; // 允许小幅时间回退，模拟乱序 / 注入时钟抖动

    if (Math.random() < 0.05) {
      const next = pool.filter(() => Math.random() < 0.6);
      meter.setMembers(next);
      expectedMembers = new Set(next);
    }

    const agentId = pool[Math.floor(Math.random() * pool.length)];
    const roll = Math.random();
    let chunk;
    if (roll < 0.35) {
      chunk = { type: "text-delta", text: "中".repeat(1 + Math.floor(Math.random() * 20)) };
    } else if (roll < 0.5) {
      chunk = { type: "reasoning-delta", text: "x".repeat(Math.floor(Math.random() * 40)) };
    } else if (roll < 0.6) {
      chunk = { type: "tool-call-delta", argumentsDelta: '{"k":1}' };
    } else if (roll < 0.8) {
      chunk = {
        type: "usage",
        usage: {
          inputTokens: Math.floor(Math.random() * 500),
          outputTokens: Math.floor(Math.random() * 500),
          cacheReadTokens: Math.floor(Math.random() * 400),
        },
      };
    } else {
      chunk = { type: "finish" };
    }

    assert.doesNotThrow(() => meter.ingest(agentId, chunk, t));
    const sample = meter.sample();

    for (const key of COUNTERS) {
      assert.ok(
        Number.isInteger(sample[key]) && Number.isFinite(sample[key]) && sample[key] >= 0,
        `第 ${i} 轮 ${key}=${sample[key]} 必须是非负整数`,
      );
    }
    assert.equal(sample.agents, expectedMembers.size, `第 ${i} 轮 agents 应等于成员数`);
    assert.ok(sample.generating <= sample.agents, `第 ${i} 轮 generating 不能超过 agents`);
    assert.ok(sample.rate >= sample.gen, `第 ${i} 轮 rate 含输入，不应小于 gen`);
    assert.ok(sample.total >= prevTotal, `第 ${i} 轮 total 单调：${prevTotal} → ${sample.total}`);
    prevTotal = sample.total;
  }
});

console.log("");
console.log(`检查条数: ${checks}，通过: ${checks - failed}，失败: ${failed}`);
if (failed > 0) {
  console.log("有失败 ❌");
  process.exit(1);
}
console.log("全部通过 ✅");
process.exit(0);
