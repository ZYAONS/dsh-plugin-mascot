/**
 * metrics.mjs —— token 速率统计（纯计算：无定时器、无 I/O、无模块级可变状态）
 *
 * 这个模块统计什么
 *   · gen        最近 windowMs 毫秒内"生成"的 token 速率（tok/s，四舍五入整数）
 *   · rate       最近 windowMs 毫秒内"(生成 + 输入)"的 token 速率（tok/s，界面上的头条大数字）
 *   · total      自 reset() 起累计的 (生成 + 输入) token
 *   · agents     setMembers 传入的成员数
 *   · generating 最近 generatingMs 毫秒内有过生成增量的成员数（呼吸灯）
 *
 * 为什么口径是这样定（改之前先读完这五条）
 *   1) 流式 chunk 里只有字符、没有 token 计数，所以"生成速率"只能估算：CJK 一个字≈1 token，
 *      西文 4 字符≈1 token。usage 帧里的 outputTokens 才是精确值，但它一轮只来一次、
 *      没有窗口内的时间戳。于是：
 *        · 速率（gen / rate）只吃带时间戳的增量估算 —— 它是唯一能定位到"这一秒"的信号；
 *        · 累计（total）逐 agent 取 max(估算累计, Σ usage.outputTokens) —— 实时靠估算增长，
 *          调用结束被精确值一次性校准；取大值而**不是相加**，同一批 token 就不会被算两遍。
 *      也**不**把 usage.outputTokens 塞进窗口：一轮 10 秒的调用结束时带着 1000 tokens 撞进
 *      1.5 秒的窗口，会把头条数字瞬间抬成十几倍，比"速率略滞后于精确值"难看得多。
 *   2) rate 含输入 token：输入是立刻要付钱的部分，用户想知道的是"这一秒烧了多少"。
 *      cacheRead 默认扣掉（命中缓存的输入便宜一个量级），includeCacheReads 可打开；
 *      cacheWrite 不额外计账 —— 它已经含在 inputTokens 里，再记一次就是重复计数。
 *   3) 只统计成员：一个会话里可能有子代理、后台任务，界面数字只对当前成员负责。
 *      非成员的 chunk 在 ingest 入口直接丢掉，连状态都不建（所以它也不进 total）。
 *   4) 没有定时器：客户端不该为一块数字长期持有 interval，窗口过期只在 ingest / sample 里
 *      惰性清理；每个 agent 只保留**窗口内**事件（窗口外立即丢弃），另有 MAX_EVENTS_PER_AGENT
 *      硬上界兜底；退场成员的累计值折叠进 retiredGen / retiredInput。因此内存不随时间线性增长，
 *      而 total 仍然满足"自 reset() 起累计"，不会因为换成员而回退。
 *   5) 任何路径都不返回 NaN / Infinity / 负数：对外数值一律过一遍 toCount()。
 *
 * 用法
 *   const meter = createFleetMeter();                        // 宿主可注入 now() 便于测试
 *   meter.setMembers(["agent-1", "agent-2"]);
 *   meter.ingest("agent-1", chunk);                          // chunk 来自 DSH 的 StreamChunk
 *   meter.sample();                                          // { rate, gen, agents, generating, total }
 */

/** 窗口默认值：1.5s 够灵敏，又不至于让数字乱跳 */
const DEFAULT_WINDOW_MS = 1500;
/** 呼吸灯默认值：比窗口略短，生成一停顿灯就先灭 */
const DEFAULT_GENERATING_MS = 800;
/**
 * 每个 agent 窗口内事件的硬上界（内存兜底）。
 * 正常流式在 1.5s 窗口里不会有几百个 chunk；真出现病态高频时，宁可让速率偏低，
 * 也不能让内存无界。
 */
const MAX_EVENTS_PER_AGENT = 2048;

/**
 * CJK 码点：这些区间按"1 字 1 token"估算。
 * 覆盖假名/中日韩标点(3000-30FF)、扩展 A(3400-4DBF)、基本区(4E00-9FFF)、
 * 兼容区(F900-FAFF)、全角形式(FF00-FFEF)，以及 BMP 之外的全部码点(>= 0x20000，扩展 B 及以后)。
 */
function isCjkCodePoint(codePoint) {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    codePoint >= 0x20000
  );
}

/**
 * 估算一段文本的 token 数（整数）：
 *   CJK 码点 1 token/字；其余字符 4 字符 = 1 token 向上取整。
 * 按**码点**遍历（for...of），所以 emoji / 扩展 B 区的代理对不会被当成两个字符。
 */
export function estimateTokens(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (isCjkCodePoint(char.codePointAt(0))) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

/** 兜底成非负整数：所有对外数值都过这里，杜绝 NaN / Infinity / 负数 / 小数 */
function toCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

/** 成员 / agentId 规范化：只认字符串和非 NaN 数字，null / undefined / 对象一律不算成员 */
function normalizeId(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** windowMs 必须是有限正数，否则退回默认值（0 / 负数会让速率除出 Infinity） */
function readWindowMs(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : DEFAULT_WINDOW_MS;
}

/** generatingMs 允许 0（等价于"必须正好落在当下"），负数 / NaN 退回默认值 */
function readGeneratingMs(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_GENERATING_MS;
}

/**
 * 把一个 chunk 解析成 { gen, out, input }；不认识 / 畸形 / 空增量一律返回 null（= 什么都不改）。
 * 只读契约里写明的那几个字段，不假设 chunk 还有别的属性。
 *   · text-delta / reasoning-delta → text 计入生成
 *   · tool-call-delta             → argumentsDelta 计入生成
 *   · usage                       → out 为精确输出、input 为计费输入
 *   · block-start / block-end / finish / 未知类型 → null（忽略）
 */
function readChunkDelta(chunk, includeCacheReads) {
  if (chunk === null || typeof chunk !== "object") return null;
  const type = chunk.type;

  if (type === "text-delta" || type === "reasoning-delta") {
    const gen = estimateTokens(chunk.text);
    return gen > 0 ? { gen, out: 0, input: 0 } : null;
  }

  if (type === "tool-call-delta") {
    const gen = estimateTokens(chunk.argumentsDelta);
    return gen > 0 ? { gen, out: 0, input: 0 } : null;
  }

  if (type === "usage") {
    const usage = chunk.usage;
    if (usage === null || typeof usage !== "object") return null;
    const out = toCount(usage.outputTokens);
    const billed = toCount(usage.inputTokens);
    // 命中缓存的输入默认不算"这一秒的输入成本"；cacheWrite 已含在 inputTokens 里，不另行计账。
    const cacheRead = includeCacheReads ? 0 : toCount(usage.cacheReadTokens);
    const input = Math.max(0, billed - cacheRead);
    return out > 0 || input > 0 ? { gen: 0, out, input } : null;
  }

  return null;
}

/**
 * 建一个舰队级速率表。
 *
 * options:
 *   windowMs          速率窗口，默认 1500
 *   generatingMs      呼吸灯窗口，默认 800
 *   includeCacheReads 是否把 cacheReadTokens 也算进输入，默认 false
 *   now               注入时钟（默认 Date.now），只在 ingest / sample 里按需调用
 */
export function createFleetMeter(options = {}) {
  const raw = options !== null && typeof options === "object" ? options : {};
  const windowMs = readWindowMs(raw.windowMs);
  const generatingMs = readGeneratingMs(raw.generatingMs);
  const includeCacheReads = raw.includeCacheReads === true;
  const now = typeof raw.now === "function" ? raw.now : () => Date.now();

  /** agentId → { estGen, usageOut, inputTotal, events[], lastGenAt, lastTouchedAt, unordered } */
  let states = new Map();
  let members = new Set();
  // 退场成员的累计值折叠到这里：既保证 total 是"自 reset 起"的，又不把过期状态长期挂在内存里
  let retiredGen = 0;
  let retiredInput = 0;
  let disposed = false;

  /** 读时钟并兜底成有限数：注入的 now() 万一返回 NaN / Infinity，也不能污染统计 */
  function clockMs() {
    const t = Number(now());
    return Number.isFinite(t) ? t : Date.now();
  }

  function stateFor(agentId, atMs) {
    let state = states.get(agentId);
    if (state === undefined) {
      state = {
        estGen: 0, // Σ 估算的生成增量
        usageOut: 0, // Σ usage.outputTokens（精确值）
        inputTotal: 0, // Σ 计费输入
        events: [], // 只放窗口内事件：{ t, gen, input }
        lastGenAt: null, // 最近一次"生成增量"的时间（呼吸灯用）
        lastTouchedAt: atMs, // 最近一次活动时间（单调取 max，用于回收退场状态）
        unordered: false, // 见过时间回退 → 下一次清理改成整表过滤
      };
      states.set(agentId, state);
    }
    return state;
  }

  /** 惰性清理：只保留 t >= refMs - windowMs 的事件（窗口下界闭区间） */
  function pruneEvents(state, refMs) {
    const cutoff = refMs - windowMs;
    if (state.unordered) {
      state.events = state.events.filter((event) => event.t >= cutoff);
      state.unordered = false;
    } else {
      // 常规情况时间单调递增，从队首丢就够（代价 = 过期条数，而不是每次 O(n)）
      while (state.events.length > 0 && state.events[0].t < cutoff) state.events.shift();
    }
    if (state.events.length > MAX_EVENTS_PER_AGENT) {
      // 病态高频兜底：宁可少算，也不让内存无界
      state.events.splice(0, state.events.length - MAX_EVENTS_PER_AGENT);
    }
  }

  /** 把状态的累计值搬进 retired 桶（数值原样搬运，total 不会因为丢状态而变小） */
  function retire(state) {
    retiredGen += Math.max(state.estGen, state.usageOut);
    retiredInput += state.inputTotal;
  }

  /**
   * 回收"已经不是成员、且最后一次活动已超出所有窗口"的状态。
   * 时间上界取 max(windowMs, generatingMs)：两者都过期后，这个状态对界面再无贡献
   * （窗口速率、呼吸灯都不再需要它），折叠掉既省内存又不影响 total。
   */
  function sweepRetired(refMs) {
    const ttl = Math.max(windowMs, generatingMs);
    for (const [agentId, state] of states) {
      if (members.has(agentId)) continue;
      if (refMs - state.lastTouchedAt <= ttl) continue;
      retire(state);
      states.delete(agentId);
    }
  }

  /**
   * 记录一个流式 chunk。atMs 省略时用注入的 now()。
   * 非成员 / 未知类型 / 空增量都在这里被丢弃，不留任何痕迹。
   */
  function ingest(agentId, chunk, atMs) {
    if (disposed) return;
    const id = normalizeId(agentId);
    if (id === null || !members.has(id)) return; // 只统计成员
    const delta = readChunkDelta(chunk, includeCacheReads);
    if (delta === null) return; // 未知类型 / 空增量：不改任何数值
    const at = typeof atMs === "number" && Number.isFinite(atMs) ? atMs : clockMs();
    const state = stateFor(id, at);
    pruneEvents(state, at);
    if (at < state.lastTouchedAt) state.unordered = true;
    state.lastTouchedAt = Math.max(state.lastTouchedAt, at);

    if (delta.gen > 0) {
      state.estGen += delta.gen;
      state.lastGenAt = at;
      state.events.push({ t: at, gen: delta.gen, input: 0 });
    }
    if (delta.out > 0) {
      // usage.outputTokens 只进累计（见文件头第 1 条），但"刚产出过"这件事同样点亮呼吸灯
      state.usageOut += delta.out;
      state.lastGenAt = at;
    }
    if (delta.input > 0) {
      state.inputTotal += delta.input;
      state.events.push({ t: at, gen: 0, input: delta.input });
    }
  }

  /** 采一次样；顺手做惰性清理。没有数据时返回全 0，绝不返回 NaN / Infinity / 负数 */
  function sample() {
    // dispose() 之后状态引用已经清空：契约只要求"不抛错"，这里统一返回全 0
    // （另一种合法选择是返回最后一次值，但引用都清了，全 0 语义更直白）。
    if (disposed) return { rate: 0, gen: 0, agents: 0, generating: 0, total: 0 };

    const at = clockMs();
    sweepRetired(at);

    let windowGenEst = 0; // 窗口内"估算生成"之和
    let windowInput = 0; // 窗口内输入之和
    let genTotal = 0; // 全部已知 agent 的生成累计
    let inputTotal = 0;
    let generating = 0;

    for (const [agentId, state] of states) {
      pruneEvents(state, at);
      // total 是"自 reset 起"的累计：退场成员的累加值照样算数（留在 state 里或已折进 retired）。
      // 被排除的只有**窗口速率和呼吸灯** —— 界面上它们不属于当前成员。
      genTotal += Math.max(state.estGen, state.usageOut);
      inputTotal += state.inputTotal;
      if (!members.has(agentId)) continue;

      let est = 0;
      let input = 0;
      for (const event of state.events) {
        est += event.gen;
        input += event.input;
      }
      windowGenEst += est;
      windowInput += input;
      if (state.lastGenAt !== null && at - state.lastGenAt <= generatingMs) generating += 1;
    }

    const windowSeconds = windowMs / 1000; // windowMs 已兜底为正数，除不出 Infinity
    return {
      rate: toCount((windowGenEst + windowInput) / windowSeconds),
      gen: toCount(windowGenEst / windowSeconds),
      agents: members.size,
      generating,
      total: toCount(retiredGen + retiredInput + genTotal + inputTotal),
    };
  }

  /**
   * 替换成员集合；ids 可以是字符串数组、Set 或任意可迭代对象。
   * 这里只记 id，不校验 agent 是否真实存在（宿主知道谁在跑）。
   * 退场成员的状态不在这里删 —— 留到 sweepRetired() 按窗口过期回收，
   * 这样"临时移出又加回来"的成员还能保住窗口与呼吸灯的连续性。
   */
  function setMembers(ids) {
    if (disposed) return;
    const next = new Set();
    if (typeof ids === "string" || typeof ids === "number") {
      const only = normalizeId(ids);
      if (only !== null) next.add(only);
    } else if (ids !== null && ids !== undefined && typeof ids[Symbol.iterator] === "function") {
      for (const value of ids) {
        const id = normalizeId(value);
        if (id !== null) next.add(id);
      }
    }
    members = next;
  }

  /**
   * 清空**全部**状态（换会话时用）：成员集合、窗口事件、累计值、退场折叠值一起归零，
   * 所以 reset() 之后 sample() 一定是全 0。换会话的调用方记得重新 setMembers()。
   */
  function reset() {
    if (disposed) return;
    states = new Map();
    members = new Set();
    retiredGen = 0;
    retiredInput = 0;
  }

  /**
   * 只清引用：本模块没有任何定时器 / 监听器需要注销（窗口过期全靠惰性清理）。
   * 之后再 sample() 不抛错，返回**全 0**；ingest / setMembers / reset 变为空操作。
   */
  function dispose() {
    disposed = true;
    states = new Map();
    members = new Set();
    retiredGen = 0;
    retiredInput = 0;
  }

  return { setMembers, ingest, sample, reset, dispose };
}
