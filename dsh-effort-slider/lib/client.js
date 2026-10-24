/* 由 build.mjs 生成，请勿直接编辑；改 client.js 或 effort-slider.css 后重新构建。 */
window.__ModuleLoader__.load({
  id: "dsh-effort-slider",
  factory: function (require) {
    var module = { exports: {} };
    var __esRequire = require;
/**
 * dsh-effort-slider — 浏览器半边（源码，由宿主读入并包进 loader 工厂）
 *
 * 自绘组件，不套用任何现成 UI 框架：
 *  · 收起态 = 输入框里的一枚发光核心（外环刻着当前档位进度）
 *  · 展开态 = 悬浮能量条 + 档位刻度 + 读数 + 皮肤切换
 *  · 数据   = ctx.modelDirectories.directoryFor(sessionId).store（真实档位、真实写回）
 *  · 偏好   = 宿主端点 /plugins/dsh-effort-slider/preferences
 */
(function () {
  "use strict";

  var PACKAGE_ID = "dsh-effort-slider";
  // 默认皮肤 = DEFAULT_SKIN（当前 fluid）；数组顺序即界面上的按钮顺序。
  // nebula 暂时下线（2026-10-01）：只把它从数组注释掉，SKIN_LABELS 与全部 CSS 规则都保留，
  // 想恢复就把 "nebula" 放回数组即可（DEFAULT_SKIN 想改回它也只需改这一处）。
  var DEFAULT_SKIN = "fluid";
  var SKINS = [/* "nebula", */ "holo", "chrome", "fluid"];
  /**
   * 皮肤显示名。用对象查而不是三目链 —— 三目链每加一个皮肤都得改一处、
   * 漏了就会把英文键名当中文标题显示出来（本文件历史上就是这么漏过一次的）。
   */
  var SKIN_LABELS = { nebula: "Nebula", holo: "Hologram", chrome: "Liquid metal", fluid: "Fluid" };
  /** 未知皮肤名退回键名本身：绝不返回 undefined（title 会变成 "undefined"）。 */
  function skinLabel(skin) {
    return Object.prototype.hasOwnProperty.call(SKIN_LABELS, skin) ? SKIN_LABELS[skin] : String(skin);
  }
  var STORAGE_KEY = "dsh-effort-slider.skin";
  var ENDPOINT = "/plugins/dsh-effort-slider/preferences";
  /**
   * ★ 界面文案**全英文**（用户 2026-10-02 要求：「全都用英文」）。
   * 档位名 / 档位说明优先用模型目录里的原文，但**只接受 ASCII**：
   * 中文宿主（本机 DSH 就是）的目录会给回「轻度 / 中 / 高 / 极高 / 最高」这类本地化名字，
   * 直接采信就又把中文带进界面了。非 ASCII、空串、非字符串一律回退到下面的英文梯子。
   * 判定刻意放宽到可打印 ASCII 全区间（不追求严格语言检测）——只要没有非英文字符就放行。
   */
  function asciiOnly(value) {
    return (typeof value === "string" && value !== "" && /^[\x20-\x7e]+$/.test(value)) ? value : "";
  }
  /** 英文档位梯子（按**位置**取，与目录的语言无关）；含追加的 ULTRA 格在内共 6 条。 */
  var FALLBACK_NAMES = ["Low", "Medium", "High", "Very High", "Max", "Full"];
  /** 写回失败时的统一文案：面板描述行 + 收起态提示都用它，避免两处文案漂移。 */
  var FAIL_HINT = "Switch failed — reverted to the previous level.";

  /* ─────────────────── TURBO：ULTRA 档位 / 闪电 / tok/s 读数 ─────────────────── */

  /**
   * 宿主路由（TURBO-CONTRACT.md §3.4）。
   *  · GET   ?session=<id> → { ok, lightning, ultra, rate, gen, agents, generating, total, policy, stamp }
   *  · PATCH body { session, lightning?, ultra? } → { ok, lightning, ultra }
   * 全部 best-effort：404 / 网络失败 / 非 JSON 一律当作「没有数据」，绝不冒泡。
   */
  var TURBO_ENDPOINT = "/plugins/dsh-effort-slider/turbo";
  /** 读数轮询周期。只在「闪电开启 或 rate > 0」时跑，且页面隐藏时整轮跳过。 */
  var TURBO_POLL_MS = 1000;
  /** 连续失败到这个次数就彻底停止轮询（宿主没有这条路由时不要一直打请求）。 */
  var TURBO_MAX_FAILURES = 3;
  /** 轮询/请求之间的最短间隔：两个 effect 会各拉一次，避免同一帧重复打宿主。 */
  var TURBO_MIN_FETCH_GAP_MS = 400;
  /** A disconnected route must release both the request and the UI promise. */
  var TURBO_REQUEST_TIMEOUT_MS = 5000;
  /** Only the slider's wait is bounded; the host selection itself is not cancelled. */
  var MODEL_SELECTION_TIMEOUT_MS = 10000;
  /**
   * `--es-rate` 的归一化分母（**纯视觉强度**，不是数据口径）。
   * 读数本身永远显示真实整数；这里只把 0~20000 tok/s 映射成 CSS 用的 0~1 发光强度，
   * 超过就夹到 1（发光到顶不再变），所以它不影响任何显示出来的数字。
   */
  var RATE_FULL_SCALE = 20000;

  /** 这个会话的 turbo 端点；拿不到 sessionId 时返回 ""（调用方据此跳过 fetch）。 */
  function turboURL(sessionId) {
    if (sessionId === undefined || sessionId === null || sessionId === "") return "";
    return TURBO_ENDPOINT + "?session=" + encodeURIComponent(String(sessionId));
  }

  /**
   * 展示层档位表 = 模型目录里真实可用的 efforts **+ 追加的 ULTRA 格**。
   *
   * 只加显示层，**不动** pickEffort 的读取逻辑：efforts 为空（模型没有档位）时保持原样，
   * 不追加 ULTRA —— 否则一个没有 reasoning 的模型会凭空多出一格。
   * 按 efforts 的**引用**缓存结果数组：同一份目录快照永远拿到同一个数组，
   * 免得每次渲染都新建（下游 effect 依赖它时会看见"新数组"）。
   */
  var levelCache = { source: undefined, sourceLength: -1, levels: null };
  var ULTRA_LEVEL = {
    id: "ultra",
    // ★ 必须带 `name` / `description`：effortName 优先用 `effort.name`，
    //   而 ULTRA 是**我们自己追加的合成档位**，模型目录里没有它 ——
    //   不给名字就会掉进 FALLBACK_NAMES 的中文兜底（用户原话：
    //   "ultra 怎么莫名其妙翻译成中文了"）。命名与说明一律英文。
    //   用户明确要求大小写是 **Ultra**（不是全大写 `ULTRA`）——所以 CSS 里那条
    //   `text-transform:uppercase` 也一并撤掉了，否则改名字符串根本不生效。
    name: "Ultra",
    label: "Ultra",
    //   说明要**短**（用户："注释太长了，不高级"）：面板那是给档位名做注脚的一行小字，
    //   不是文档。ULTRA 的完整契约在注入的策略正文里（policy.mjs），这里只留一句口号。
    description: "MAX effort, maximum rigor.",
    ultra: true,
  };
  function levelsOf(efforts) {
    if (!Array.isArray(efforts) || efforts.length === 0) return [];
    if (levelCache.source === efforts && levelCache.sourceLength === efforts.length) return levelCache.levels;
    var levels = efforts.concat([ULTRA_LEVEL]);
    levelCache = { source: efforts, sourceLength: efforts.length, levels: levels };
    return levels;
  }

  /** 顶格判定的相对容差：只用来吸收 index/(n-1) 的浮点误差。
   *  实测 `0.8 * 4 = 3.1999999999999997` → 取整会掉成 3，MAX 刚好**不**顶格。
   *  （加 ULTRA 后 MAX 的 pct 就成了 4/5 = 0.8，正好踩中这一类误差。） */
  var TOP_PCT_EPSILON = 1e-4;

  /**
   * 「顶格」判据 —— **按索引**，不按比例。
   *
   * 加了 ULTRA 之后档位数从 5 变 6：MAX 的 pct 从 1.0 掉到 0.8，旧的 `pct > 0.999`
   * 会让 MAX 丢掉「×2 流速 + 星流」，这是回归（真实档位 5 个 → 顶格索引 = 4）。
   * 现在拿 pct 与「顶格那一格的位置」比：
   *   lastTopIndex / (lastTopIndex + 1) = 4/5 = 0.8  ← MAX 与 ULTRA 都在这一格或右边
   * MAX 与 ULTRA **都算顶格**，两者行为完全一致。
   * 相对容差只吸收浮点误差，拖动到 0.798 以下仍然不算顶格（不会提前触发）。
   */
  function isTopPct(pct, lastTopIndex) {
    if (!(lastTopIndex >= 0)) return false;
    if (typeof pct !== "number" || !isFinite(pct)) return false;
    var levels = lastTopIndex + 1;
    var threshold = lastTopIndex / levels;
    var epsilon = TOP_PCT_EPSILON / levels;
    return pct >= threshold - epsilon;
  }

  /** 任何情况下都给出一个合法皮肤名：读不到就用默认，绝不让样式整体失效。 */
  function skinOf(prefs) {
    if (prefs && typeof prefs === "object" && SKINS.indexOf(prefs.skin) >= 0) return prefs.skin;
    return DEFAULT_SKIN;
  }

  /** 偏好缺失时的稳定兜底快照（引用固定，符合 useSyncExternalStore 的要求）。 */
  var DEFAULT_PREFS_SNAPSHOT = Object.freeze({ skin: DEFAULT_SKIN });
  function readDefaultPrefs() {
    return DEFAULT_PREFS_SNAPSHOT;
  }

  /** 空动作。降级路径（inject 失败）用它顶替 load，保证 props 形状永远是完整的。 */
  function noop() {}

  /**
   * best-effort 的 JSON fetch：拿不到就返回 rejected Promise，由调用方各自兜住。
   * ⚠️ 这里**故意**不吞异常 —— 调用方要用"失败"来驱动 fail-open 分支（回滚 / 停止轮询）。
   */
  function turboFetch(url, init) {
    return new Promise(function (resolve, reject) {
      var options = Object.assign({}, init || {});
      var externalSignal = options.signal;
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var settled = false;
      var timer = null;
      function finish(error, value) {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        if (externalSignal && typeof externalSignal.removeEventListener === "function") {
          externalSignal.removeEventListener("abort", abort);
        }
        if (error) reject(error); else resolve(value);
      }
      function cancel(name, message) {
        var error = new Error(message);
        error.name = name;
        // Settle first: even a transport that ignores abort cannot keep callers pending.
        finish(error);
        if (controller) controller.abort();
      }
      function abort() { cancel("AbortError", "turbo request cancelled"); }
      if (externalSignal && externalSignal.aborted) { abort(); return; }
      if (externalSignal && typeof externalSignal.addEventListener === "function") {
        externalSignal.addEventListener("abort", abort, { once: true });
      }
      if (controller) options.signal = controller.signal;
      timer = setTimeout(function () {
        cancel("TimeoutError", "turbo request timed out");
      }, TURBO_REQUEST_TIMEOUT_MS);
      try {
        Promise.resolve(fetch(url, options)).then(function (response) {
          if (!response || !response.ok) throw new Error("turbo http " + String(response && response.status));
          return response.json();
        }).then(function (body) { finish(null, body); }, function (error) { finish(error); });
      } catch (error) { finish(error); }
    });
  }

  /** 把宿主给的值收成非负整数；脏数据一律当 0（绝不显示 NaN / 负数）。 */
  function safeCount(value) {
    var num = Number(value);
    if (!isFinite(num) || num <= 0) return 0;
    return Math.floor(num);
  }

  /* ────────────────────── 读取模型推理档位 ────────────────────── */

  var pickCache = { raw: undefined, picked: null };

  function pickEffort(raw) {
    if (raw === pickCache.raw) return pickCache.picked;
    pickCache = { raw: raw, picked: computePick(raw) };
    return pickCache.picked;
  }

  function computePick(raw) {
    if (!raw || !raw.current) return null;
    var current = raw.current;
    var groups = raw.groups || [];
    var group = null;
    for (var i = 0; i < groups.length; i += 1) {
      if (groups[i] && groups[i].id === current.provider) { group = groups[i]; break; }
    }
    if (!group) return null;
    var models = group.models || [];
    var model = null;
    for (var j = 0; j < models.length; j += 1) {
      if (models[j] && models[j].id === current.model) { model = models[j]; break; }
    }
    if (!model || !model.reasoning) return null;
    // 脏数据守卫：必须是真数组且非空 —— 组件里要用 efforts.map / 下标取值，
    // 数组类对象（或 null）混进来就会在渲染期炸开。拿不到就当「这个模型没有档位」，
    // 组件自然不渲染（比抛异常让错误边界吞掉更干净）。
    var efforts = model.reasoning.efforts;
    if (!Array.isArray(efforts) || efforts.length === 0) return null;

    var wanted = current.reasoningEffort;
    // 「没显式设置」= 模型侧没给 reasoningEffort；此时退回模型的默认档。
    var auto = wanted === undefined || wanted === null;
    if (auto) wanted = model.reasoning.defaultEffort;
    var index = -1;
    for (var k = 0; k < efforts.length; k += 1) {
      // 元素也可能是 null/脏对象，取 id 前先判空，否则这里就抛了
      var item = efforts[k];
      if (item && item.id !== undefined && item.id !== null && item.id === wanted) { index = k; break; }
    }
    return {
      selection: { provider: current.provider, model: current.model },
      modelName: model.name || model.id,
      efforts: efforts,
      index: index,
      // auto 只表示「档位来自模型默认值」，不再用来丢弃 index：
      // 默认档能不能解析出来，看下面的 index 是否 >= 0。
      auto: auto || index < 0,
    };
  }

  function effortName(effort, index, total) {
    var name = asciiOnly(effort && effort.name);
    if (name) return name;
    if (total <= 1) return "Default";
    var at = Math.round((index / (total - 1)) * (FALLBACK_NAMES.length - 1));
    return FALLBACK_NAMES[Math.min(FALLBACK_NAMES.length - 1, Math.max(0, at))];
  }
  function effortDesc(effort, index, total) {
    var desc = asciiOnly(effort && effort.description);
    if (desc) return desc;
    if (index === 0) return "Fastest and cheapest — good for small, direct jobs.";
    if (index === total - 1) return "Full power for hard problems; highest token cost.";
    return "Level " + String(index + 1) + " / " + String(total) + ": slower as you go up, and steadier.";
  }

  /**
   * 把外部 store 包成 useSyncExternalStore 可接受的形式。
   *
   * ⚠️ 必须返回**稳定引用**：React 渲染后会比对快照，若 getSnapshot 每次都返回新对象，
   * 它判定「变了」→ 立即重渲染 → 无限循环 → 整个渲染进程卡死。
   * 本插件第一版就是这么把界面搞超时的：这里用 WeakMap 按 store 缓存读取器，
   * 只要底层引用不变，同一 store 永远给出同一个外层对象。
   */
  var snapshotReaders = new WeakMap();
  var snapshotSubscribers = new WeakMap();
  function hostSubscribe(store) {
    if (!store || typeof store.subscribe !== "function") return function () { return noop; };
    var cached = snapshotSubscribers.get(store);
    if (cached) return cached;
    var subscribe = function (listener) { return store.subscribe(listener); };
    snapshotSubscribers.set(store, subscribe);
    return subscribe;
  }
  function hostSnapshot(store) {
    if (!store || typeof store !== "object" || typeof store.getSnapshot !== "function") {
      return function () { return null; };
    }
    var cached = snapshotReaders.get(store);
    if (cached !== undefined) return cached;
    var raw;
    var wrapped;
    var seen = false;
    var reader = function () {
      var next = store.getSnapshot();
      if (!seen || next !== raw) {
        seen = true;
        raw = next;
        wrapped = next === null || next === undefined ? null : { raw: next };
      }
      return wrapped;
    };
    snapshotReaders.set(store, reader);
    return reader;
  }

  /* ─────────────── 流体皮肤引擎（移植自 effort-slider-preview 的 fluid=a） ───────────────
     这里是**移植**，不是重做：多尺度 curl 噪声、随机涡旋、源头在左端、整体向右流、
     destination-out 淡出、末端高光，全部与预览页逐段同源。只有下面几处是插件环境
     **必须**改的（改动清单见注释，别的地方逐字保留）：

       · 进度：不再读 getComputedStyle('--pct')。插件里 --pct 是 React 渲染时写到根元素上的，
         组件内本来就有这个数，所以改为每帧读传入的 pctRef.current（0~1 的数值）——
         rAF 与 React 渲染彻底解耦（React 更新 ref 不影响已在跑的帧）。
       · 几何：插件的轨道内缩是 17px（珠子 30px、填充条 calc(17px + (100% - 34px) * --pct)），
         所以 litW = 17 + (W - 34) * pct，取色分母同步换成 (W - 34)。预览页那套 20/40 不适用。
       · 生命周期：只在 skin === "fluid" 且面板展开时跑；尺寸没变**绝不**碰 canvas.width
         （重设 canvas.width 会清空整块画布 —— 预览页踩过，表现是流体"凭空消失"，截图里就是它）；
         量到 0 尺寸（display:none / 未布局）直接跳过这一帧，不做任何除法。
       · 防御：任何异常都不冒泡到宿主 —— 入口 try/catch、每帧 try/catch，出错就静默停掉动画
         （皮肤照常可用，只是没有动画）。

     两处现场修复逐字保留：
       a. 淡出用 globalCompositeOperation = "destination-out" 真"擦除"，
          **绝不**用 source-over 叠深色（会累加成不透明黑块）；
       b. 每帧 clearRect(litW, 0, W - litW, H) 并回收 x > litW 的粒子
          （否则往左拖会留下定格的颜色）。 */

  /** 色带：与预览页一字不差（nebula 同源）。 */
  var FLUID_STOPS = [
    [0.00, [120, 150, 255]],
    [0.32, [ 95, 112, 255]],
    [0.62, [168,  92, 255]],
    [0.86, [214, 106, 208]],
    [1.00, [255, 158, 214]]
  ];
  /** fluid=a 的那一套参数 —— 只移植 a，**不**带 b/c 那些另做的版本。
   *
   *  参数来历（每次都是实测调出来的，不要凭感觉改回去）：
   *   · count 420→380、fade .020→.035：420 颗铺满全宽后"近不透明像素"冲到 32.6%，
   *     糊成一片没有层理；380/.035 反而纹理更好。
   *   · count 380→470、vel .62→.43：用户嫌"流体不够多、流得太快"。
   *     vel 只降不涨：它同时决定回收入口 `x > litW-2` 的循环周期，
   *     降速会让**每一帧**留在画面上的粒子更多（拖尾更长），观感更黏更慢。
   *     ⚠️ 改 count 必须同步改 fade：两者共同决定叠加后的不透明度。
   *     count↑ 而不动 fade 会让画面重新糊死，所以这里 fade .035→.028 抵掉。
   *
   *  ── 第三轮（用户反馈：高等级反而更稀疏 / 整体不够浓）──
   *   · **count 不再是常数**：恒定 470 颗时 litW 越大越稀（实测 470 颗在 20px 上是
   *     23.5 颗/px、在 338px 上只剩 1.39 颗/px，差 17 倍）。现在改成每像素密度恒定：
   *     targetCount = clamp(round(density * litW), countMin, countMax)，粒子数随已点亮
   *     宽度等比伸缩（见 targetCount / syncCount）。
   *   · 因此 fade / alpha 要按"新密度"重新标定：密度 1.39 → 3.0 颗/px（×2.16）之后
   *     同样的 fade 会把画面直接推糊（实测满档"近不透明像素"10% → 44%）。
   *     实测（358×30 轨道、满档 litW=338~341，逐列 meanA + 近不透明直方图）：
   *       旧参数 1.39/.028/.075 → 已点亮列 meanA 均值 196、近不透明 10.3%（基线）
   *       2.2/.026/.082        → 218 / 44%（糊死）
   *       3.0/.020/.044        → 209~216 / 10~19%（不稳定，跑几次有超线）
   *       3.0/.021/.043        → 206~217 / 9.7~13.7%（5 次里 3 次 ≥12%，仍贴线）
   *       3.0/.022/.042 ← 现在 → 204~207 / 5.3~10.8%、midAlpha 204~222
   *     litMean ≥210 已经贴着"近不透明 ≤12%"的红线：再加墨（alpha .044+）litMean 能到
   *     214-216，但近不透明立刻 13-19%。红线（不许糊死）优先，所以停在这一点上。 */
  /**
   * ── 第四轮（用户反馈：运动不够随机 / 流体要更大团）──
   *  两条一起调，但它们的旋钮不同，别混：
   *   · **更随机** ← `swirl`（流场对方向的支配力，原来硬编码 0.55）、涡旋数量/频率/半径/强度、
   *     `speed` 与 `jitter` 的分布宽度。方向随机度主要来自 curl 噪声 + 涡旋。
   *   · **更大团** ← `r`（粒子半径）、`curlScale`（噪声的空间尺度，越大结构越大）、
   *     涡旋半径。⚠️ r 变大后必须同时降 `density`：覆盖面积按 r² 涨，不降就是糊死。
   *  实测口径见 `_clump.mjs`：团的**特征尺度 k90**（相隔 k 像素的 alpha 差达到平台 90% 的 k）。
   *  调之前 k90=16px、D1=4（细碎）、覆盖 98%、meanA 201、sdA 32。
   *  另外：原来的 `curl: 22` 是**从未被读取**的死配置，已删除（真在用的是 curlScale / swirl）。
   */
  var FLUID_PRESET = { fade: 0.018, vel: 0.43, speed: [0.35, 2.1], curlScale: 0.026, life: 9000, r: [5.5, 13], alpha: .030, blend: "source-over", jitter: 1.8,
    /** 最高档（选中最高等级）时的流速倍率：用户要求 ×2。 */
    topSpeedMul: 2,
    /** 最高档叠加的星痕（曲率跃迁感）：星点往**左**高速划过，快的会拉出长线。
     *  0 = 关掉这一层。速度单位是 px/帧 —— 流体只有 0.43，这里快 7~30 倍。
     *  用户第二次要求：「星星少一点，大一点」→ 数量 46→20、线宽 0.7~1.6→1.6~3.4、
     *  长度上限 64→96px。少而粗才像"跃迁时擦身而过的几颗亮星"，多了就成噪点。 */
    starCount: 20,
    starSpeed: [4, 15],
    /** 进入最高档后速度爬升到满值的时间（ms）。用户要"速度慢慢提高"（跃迁加速感）。 */
    starRampMs: 2600,
    /** 斜坡起点：刚进入最高档时速度只有基准的这么多倍（不从 0 起，否则星星看着像卡住）。 */
    starRampStart: 0.16,
    /** 流场对方向的支配力：dirX = 1 + cv·swirl·s，dirY = cv·swirl·s。越大越"乱"、越不像整片平移。 */
    swirl: 0.9,
    /** 每像素粒子密度（颗/px）—— count 由它和 litW 现算，不再是常数。
     *  3.0 → 1.0：粒子半径几乎翻倍后必须减量，否则糊死（r² 关系）。 */
    density: 1.0,
    /** 粒子数夹取区间：低档也要看得见、高档不失控。
     *  ⚠️ countMin 必须 ≤ density × 最低档的 litW，否则**最低档会被夹住**、
     *     密度恒定立刻失效（实测：density=1.0 时最低档 litW=17 → 只有 17 颗，
     *     而 countMin=36 会把它抬到 36 → 每像素密度变成 2.12，极差 91%）。
     *     旧值 36 是给 density=3.0 配的，密度降到 1.0 后必须跟着降。 */
    countMin: 16,
    countMax: 1400,
    /**
     * 源头颜色的往返周期（毫秒）：0→1→0 走完这么多时间。
     * 用户要求"源头发出的粒子颜色在变"，所以颜色是**源头的时间函数**，粒子带出生色走。
     * 这个值决定颜色变得有多快：**越小变得越快**（轨道上色带也越多、越"彩虹"）。
     * 7000 太急（用户：「变得太快了，要慢变」）→ 30000：满档一列的颜色变化周期约 30s，
     * 观感是缓慢漂移而不是来回刷色。
     */
    hueCycle: 30000,
    /**
     * 主方向的强度：dirX = bias + cv·swirl·s。
     *
     * 1 是"整条往右流"。调到接近 0 就没有主方向了 —— 粒子只在原地被流场搅。
     */
    bias: 1 };
  /** 轨道内缩：珠子直径 30px → 左右各内缩 17px（填充条 / 珠子共用这套几何）。 */
  var FLUID_INSET = 17;

  /**
   * 每个皮肤在同一台引擎上的**参数覆盖**。
   *
   * 引擎只有一台（旋度流场 + destination-out 擦拖尾 + 最高档星痕层），皮肤改的是
   * 「这台引擎被调成什么样」。fluid 原样不动。
   *
   *   holo —— 全息仪表：擦得极快（fade .22）、寿命短（700ms）、粒子细如扫描线
   *           （r 1.0~2.8），画的是**竖线**不是圆点（见 step 里的 shape 分支）；
   *           星痕层加量到 34，因为它本来就是"能量仪表"。alpha 要够亮 —— 这个皮肤的
   *           填充条是透明的，粒子**就是**"已点亮到哪"的唯一读数。
   *
   *   nebula 试过并退回了 CSS 渐变，原因写在下面 holo 上面的那段注释里。
   *
   * 数字都是照着"这块画布只有 30px 高"调的；轨道高度变了要重新看。
   */
  var FLUID_SKINS = {
    fluid: {},
    /* nebula 试过，退回来了。五轮参数（大云块 → 小星点 → 提 fade）之后，它在截图里
       始终只是"更暗更平的 fluid"：轨道只有 30px 高，任何盖满这条轨道的粒子数都会让 α
       饱和成一条平带（实测整块画布平均 alpha 一直是 203~208，fluid 是 205）。要它真的
       不一样得改**画法**，不是改数字。所以它退回 CSS 渐变 —— 一个像暗流体的星云比原来的
       渐变更差。这条记在这儿，免得下次有人以为只是没调好。 */
    holo: {
      fade: 0.22, vel: 0.95, speed: [0.6, 3.4], curlScale: 0.02, life: 700,
      r: [1.0, 2.8], alpha: 0.24, jitter: 0.35, topSpeedMul: 2.3,
      starCount: 34, bias: 1.6, swirl: 0.45, density: 2.4, countMin: 40, hueCycle: 12000,
    },
  };

  /**
   * 把流体引擎挂到某个 canvas + rail 上，返回 stop()（幂等，可重复调用）。
   *
   * @param pctRef           0~1 的目标进度（档位比例）
   * @param lastTopIndexRef  「顶格」在档位表里的索引 = **真实档位数 - 1**
   *                         （展示表 = 真实档位 + ULTRA，所以它也是 levels.length - 2）。
   *                         引擎用它把 pct 反算成索引来判顶格（见 isTopPct），
   *                         这样 MAX 与 ULTRA 的行为完全一致。取不到时按 -1 处理
   *                         = 永不顶格（退回"没有附加奖励"，不会误触发）。
   *
   * 契约：
   *  · **永不抛异常**。拿不到 window / canvas / 2D 上下文、启动或单帧出错，一律退化成
   *    "没有动画"（返回 noop 或静默自停），皮肤与控件本身照常可用。
   *  · 返回的 stop() 会 cancelAnimationFrame、摘掉 resize 监听与 ResizeObserver、
   *    清空画布 —— 调用方（React effect 的清理函数）必须调它。
   */
  function mountFluid(canvas, rail, pctRef, lastTopIndexRef, skin) {
    var win = typeof window !== "undefined" ? window : null;
    if (!win) return noop;
    // 帧边界钩子：**只**给离线测试用（离线测试拿不到闭包里的 parts，必须在帧边界上收集
    // 这一帧真正画过的几何来按列重放 alpha）。生产里没人挂它 —— 默认 null，零开销。
    var onFrame = null;
    try {
      var testHook = win.__FLUID_TEST_HOOK__;
      if (testHook && typeof testHook.onFrame === "function") onFrame = testHook.onFrame;
    } catch (error) { onFrame = null; }
    if (!canvas || typeof canvas.getContext !== "function") return noop;
    if (!rail || typeof rail.getBoundingClientRect !== "function") return noop;
    var ctx2d = null;
    // ── 最高档星光层：独立 canvas（见 drawStars）。拿不到就为 null，整层静默关闭。 ──
    var starCanvas = null;
    var starCtx2d = null;
    var starW = 0;
    var starH = 0;
    /** 本帧的 litW 与时间：drawStars 要用（避免把 step 的局部量一路传参）。 */
    var railLitWCurrent = 0;
    var tNow = 0;
    /** 进入最高档的时刻（-1 = 不在最高档）。星痕的加速斜坡从它开始算。 */
    var starEnterAt = -1;
    try { ctx2d = canvas.getContext("2d"); } catch (error) { ctx2d = null; }
    // 拿不到 2D 上下文（无头 / 被禁用 / 桩返回 null）：静默不跑，皮肤仍然可用
    if (!ctx2d) return noop;

    // 星光层的 canvas：**取不到就当这一层不存在**（预设 starCount/scene 仍然有效，
    // 只是没有星光）——绝不因为多了一层就把整条流体停掉。
    (function bindStars() {
      try {
        var el = rail && typeof rail.querySelector === "function" ? rail.querySelector(".es-rail__stars") : null;
        if (!el || typeof el.getContext !== "function") return;
        var c2 = el.getContext("2d");
        if (!c2) return;
        starCanvas = el;
        starCtx2d = c2;
      } catch (error) { starCanvas = null; starCtx2d = null; }
    })();

    var dpr = Math.min(2, win.devicePixelRatio || 1);
    // 皮肤只覆盖它要改的那几个键，其余沿用 FLUID_PRESET。
    var mode = typeof skin === "string" && FLUID_SKINS[skin] !== undefined ? skin : "fluid";
    var PRESET = mode === "fluid" ? FLUID_PRESET : Object.assign({}, FLUID_PRESET, FLUID_SKINS[mode]);
    var STOPS = FLUID_STOPS;
    /**
     * 源头当前的色带位置（0~1），每帧由 step() 按时间更新。
     * spawn() 会把它记进粒子的 `ct`，粒子就带着出生时的颜色流到右端。
     */
    var sourceT = 0;

    /** 夹到 [0,1]：颜色参数用，别让它越界（越界后 colorAt 的插值会取错段）。 */
    function clamp01(value) {
      return value < 0 ? 0 : (value > 1 ? 1 : value);
    }

    function clock() {
      try {
        if (win.performance && typeof win.performance.now === "function") return win.performance.now();
      } catch (error) { /* 落到 Date.now */ }
      return Date.now();
    }
    // rAF / cAF 按名取：浏览器里就是全局，个别宿主（测试桩 / 无头）挂在 window 上
    function requestFrame(callback) {
      if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
      if (typeof win.requestAnimationFrame === "function") return win.requestAnimationFrame(callback);
      return 0;
    }
    function cancelFrame(handle) {
      if (!handle) return;
      try {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
        else if (typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(handle);
      } catch (error) { /* 忽略 */ }
    }

    var W = 0, H = 0, parts = [], raf = 0, stopped = false, observer = null;
    // 修复 d（第二轮：档位跳变后 2.5 秒内的"源头断料 / 中段空洞"）用：
    // 上一帧的已点亮宽度。0 = 尚未标定（刚播种 / 刚重排，这一帧只记录不缩放）。
    var lastLitW = 0;
    // ① 珠子跟随：litW 不再只看 pct，而是取**珠子当前渲染位置**（CSS 过渡期间就是动画中的
    //    位置），这样档位一跳，流体跟着珠子的动画一起压缩，不会先"啪"地瞬间到位。
    //    轨道自身不动 → 它的 rect 缓存；珠子每帧读一次 rect。
    var knobEl = null, railLeftCache = null, railLeftTick = 0;
    var t0 = clock();
    var seeds = [];
    for (var s = 0; s < 6; s += 1) seeds.push({ p: Math.random() * Math.PI * 2, f: 0.6 + Math.random() * 1.4, a: 0.6 + Math.random() * 0.8 });
    var vortices = [];

    function colorAt(t) {
      t = Math.min(1, Math.max(0, t));
      for (var i = 1; i < STOPS.length; i += 1) {
        if (t <= STOPS[i][0]) {
          var a = STOPS[i - 1], b = STOPS[i];
          var k = (t - a[0]) / (b[0] - a[0] || 1);
          return [Math.round(a[1][0] + (b[1][0] - a[1][0]) * k),
                  Math.round(a[1][1] + (b[1][1] - a[1][1]) * k),
                  Math.round(a[1][2] + (b[1][2] - a[1][2]) * k)];
        }
      }
      return STOPS[STOPS.length - 1][1];
    }

    /* ───────────── 最高档星光层：曲率跃迁式的**星痕** ─────────────
       用户：「星星要快速向左划过，就像是曲率飞船启动时看到四周划过的繁星。」
       所以不是慢飘的小点，而是**高速向左的拖线**：
         · 每颗星是一个"头部 + 身后拖尾"的线段（因为它往左跑，拖尾落在右边）；
         · 拖尾长度 ∝ 速度（这就是"跃迁"观感的来源：越快越长）；
         · 速度远大于流体（流体 0.43 px/帧，星痕 3~13 px/帧，快 7~30 倍）；
         · 从右端重新进场，形成"不断有星从右侧射过来"的持续感。
       独立 canvas：每帧全清重画，所以星痕是**锐利的线**而不是被流体拖尾糊开的糊团，
       也不会污染流体那块的 alpha 统计（验收/离线判据量的都是流体画布）。
       只在最高档运行；离开最高档由 clearStars() 立刻抹掉，不留残痕。 */
    var stars = [];
    /**
     * 星痕的出生点：**永远在轨道的右端**（用户：「以最右端为源头」）。
     *
     * ⚠️ 这里**不能**用"已点亮区的右边界 litW"：从低档切到最高档时 `isTop` 立刻为真，
     *   而 litW 还在吸附动画中（level 2 时只有轨道的 ~28%），于是头几颗星会生在**轨道中间**
     *   —— 正是用户抱怨的"星星突然出现"（子代理真机实测：首采样质心只有轨道的 28.5%）。
     *   用轨道右端 `W + 4` 之后，无论档位与动画处于哪一帧，星星都从最右边进场。
     *   `drawStars` 里那条 `s2.x > litW + 4 → 不画` 的门槛仍然保留：没被点亮的地方不出现星痕。
     */
    function spawnStar(atX) {
      var rightEdge = Math.max(2, W) + 4;
      return {
        x: atX !== undefined ? atX : rightEdge + Math.random() * 36,
        y: Math.random() * H,
        // 速度取 [min,max] 的平方分布：多数是中速，少数特别快（快的那几道最像跃迁）
        v: (function () {
          var k = Math.random();
          return PRESET.starSpeed[0] + (PRESET.starSpeed[1] - PRESET.starSpeed[0]) * k * k;
        })(),
        w: 1.6 + Math.random() * 1.8,                        // 线宽（"大一点"：0.7~1.6 → 1.6~3.4）
        tw: Math.random() * Math.PI * 2,
        a: 0.55 + Math.random() * 0.45
      };
    }
    function ensureStars(litW) {
      // 星痕只在"已点亮"的区间里跑：短进度时也不该铺满整条空轨道
      var want = Math.max(0, Math.min(PRESET.starCount, Math.round(PRESET.starCount * Math.min(1, litW / Math.max(1, W)))));
      if (stars.length > want) stars.length = want;
      while (stars.length < want) stars.push(spawnStar());
    }
    function clearStars() {
      if (starCtx2d === null) return;
      if (stars.length) stars.length = 0;
      try { starCtx2d.clearRect(0, 0, starW, starH); } catch (error) { /* 忽略 */ }
    }
    function drawStars() {
      var litW = railLitWCurrent;
      ensureStars(litW);
      var vMax = PRESET.starSpeed[1] || 1;
      /**
       * ★ 速度**由慢渐快**（用户：「速度慢慢提高」）——这就是"跃迁启动"的加速感。
       *   进入最高档那一刻 ramp=0，实际速度只有基准的 starRampStart 倍；
       *   之后在 starRampMs 内按 ramp² 爬升到 1（平方让它"先慢后猛"，线性会像开关）。
       *   拖尾长度与亮度都跟着**实际速度**走，所以进场时是短的小划痕、随后拉成长线。
       */
      var ramp = starEnterAt < 0 ? 0 : Math.min(1, Math.max(0, (tNow - starEnterAt) / PRESET.starRampMs));
      var vScale = PRESET.starRampStart + (1 - PRESET.starRampStart) * (ramp * ramp);
      try {
        starCtx2d.clearRect(0, 0, starW, starH);
        starCtx2d.lineCap = "round";
        for (var i = 0; i < stars.length; i += 1) {
          var s2 = stars[i];
          var vs = s2.v * vScale;                            // 实际速度（含加速）
          s2.x -= vs;                                        // ★ 高速向左划过
          if (s2.x < -6) {                                   // 出左边界 → 从**轨道右端**重新射入
            stars[i] = spawnStar();                          // 不传 atX：与进场第一批同一条规则
            continue;
          }
          // 纵向只留极小的偏移：跃迁时星痕基本是水平直线，晃动多了就不像"划过"
          s2.y += Math.sin(tNow * 0.0025 + s2.tw) * 0.10;
          if (s2.y < 1) s2.y = 1;
          if (s2.y > H - 1) s2.y = H - 1;
          if (s2.x > litW + 4) continue;                     // 还没进已点亮区
          // 拖尾长度 ∝ **实际**速度（越快越长），并随速度提亮 —— 这两条是"跃迁感"的核心
          var len = Math.min(96, 10 + vs * 5.2);
          var a = s2.a * (0.40 + 0.60 * Math.min(1, vs / vMax));
          var headX = s2.x;
          var tailX = s2.x + len;                             // 往左跑 → 拖尾在右侧
          if (tailX > litW + 4) tailX = litW + 4;
          // 线本身：从亮头渐隐到暗尾，读起来是"一道光划过去"
          var g = starCtx2d.createLinearGradient(headX, 0, tailX, 0);
          g.addColorStop(0, "rgba(226,251,248," + a.toFixed(3) + ")");
          g.addColorStop(0.35, "rgba(55,224,216," + (a * 0.55).toFixed(3) + ")");
          g.addColorStop(1, "rgba(55,224,216,0)");
          starCtx2d.strokeStyle = g;
          starCtx2d.lineWidth = s2.w;
          starCtx2d.beginPath();
          starCtx2d.moveTo(headX, s2.y);
          starCtx2d.lineTo(tailX, s2.y);
          starCtx2d.stroke();
          // 头部一个小亮点（星核）：只有够快的才有，避免满屏都是亮点
          if (vs > vMax * 0.55) {
            starCtx2d.beginPath();
            starCtx2d.fillStyle = "rgba(226,251,248," + Math.min(1, a * 1.15).toFixed(3) + ")";
            starCtx2d.arc(headX, s2.y, s2.w * 0.85, 0, Math.PI * 2);
            starCtx2d.fill();
          }
        }
      } catch (error) { starCtx2d = null; }   // 画星失败只关掉这一层，绝不影响流体
    }

    // 涡旋中心：随机出现、位置随机、强度衰减（"动力搅散"）
    // 第四轮：半径与强度都放大（大涡旋才搅得出"大团"），寿命也拉长一点。
    function spawnVortex() {
      vortices.push({
        x: W * (0.02 + Math.random() * 0.96),
        y: H * (0.1 + Math.random() * 0.8),
        r: H * (0.9 + Math.random() * 2.1),
        s: (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 1.1),
        born: clock(),
        ttl: 1800 + Math.random() * 2600
      });
    }

    function spawn(atX) {
      return {
        x: atX !== undefined ? atX : Math.random() * W,
        y: Math.random() * H,
        vx: 0, vy: 0,
        r: PRESET.r[0] + Math.random() * (PRESET.r[1] - PRESET.r[0]),
        // ★ 出生时的**颜色参数**：粒子带着它走完一生（不再按当前位置取色）。
        //   源头的颜色随时间在色带上往返（见 frame() 里的 sourceT），
        //   所以整条轨道是"一列颜色不断变化的流体带向右推"，而不是一条固定的位置渐变。
        //   加一点点抖动，免得同一时刻的粒子颜色完全一致、带子边缘像色阶断层。
        ct: clamp01(sourceT + (Math.random() - 0.5) * 0.06),
        a: PRESET.alpha * (0.6 + Math.random() * 0.8),
        // "性格"：每颗粒子对流场的响应强度不同，否则整片会像一堵墙一起动（实测到的问题）
        s: 0.35 + Math.random() * 1.1,
        // 每颗粒子**持久**的速度倍率：速度差让同时回收的粒子自然拉开成流体，而不是齐步走。
        // （"一坨墙"的第二个成因：旧写法所有粒子速度完全一样，只会整体平移。）
        sp: PRESET.speed[0] + Math.random() * (PRESET.speed[1] - PRESET.speed[0]),
        ph: Math.random() * Math.PI * 2,
        age: 0,
        life: PRESET.life * (0.6 + Math.random() * 0.9)
      };
    }

    // 多尺度 curl 噪声：低尺度给大涡、高尺度给细丝，叠加后才有"流体"的层次
    function curl(x, y, t) {
      var vx = 0, vy = 0;
      for (var i = 0; i < seeds.length; i += 1) {
        var s2 = seeds[i];
        var f = s2.f * PRESET.curlScale * 8;
        vx += Math.sin(y * f + t * 0.00072 * s2.f + s2.p) * s2.a;
        vy += Math.cos(x * f + t * 0.00061 * s2.f + s2.p * 1.7) * s2.a;
        // 高频细丝
        vx += Math.sin(y * f * 3.7 + t * 0.0011 + s2.p * 2.3) * s2.a * 0.35;
        vy += Math.cos(x * f * 3.1 + t * 0.0009 + s2.p * 3.1) * s2.a * 0.35;
      }
      return [vx, vy];
    }

    /** 量轨道尺寸。display:none 时量到 0 —— 调用方必须容忍 0 并跳过这一帧。 */
    function measure() {
      var rect = rail.getBoundingClientRect();
      return {
        w: Math.max(0, Math.round(rect.width || 0)),
        h: Math.max(0, Math.round(rect.height || 0))
      };
    }

    /* ─────────── ① 珠子跟随 + ④ 密度恒定：两个小工具函数 ─────────── */

    /**
     * 轨道左边界（缓存：轨道本身不动，不必每帧量）。
     * ⚠️ 面板有 0.34s 的入场动画（transform 缩放/上移），动画期间量到的 rect 是**被变换过**的；
     * 所以每 20 帧（≈0.33s）重新量一次：入场结束后自动纠正，长期也不会漂。
     */
    function railLeft() {
      if (!railLeftCache || (railLeftTick += 1) % 20 === 0) {
        var rr = rail.getBoundingClientRect();
        railLeftCache = { left: rr.left };
      }
      return railLeftCache.left;
    }

    /**
     * ① 已点亮宽度 = 珠子**当前渲染位置**相对轨道左端的距离（CSS px）。
     * 读数取 getBoundingClientRect（CSS 过渡期间拿到的就是动画中的位置），所以档位一跳，
     * 流体跟珠子一起压缩，而不是瞬间到位。
     * 返回 -1 = 拿不到珠子 / 没宽度（display:none / 桩 DOM 没有 querySelector）→
     * 调用方回退到原来的 pct 算法。**绝不抛错**（外面还有一层 try/catch）。
     */
    function knobLitW() {
      try {
        if (!knobEl) {
          if (typeof rail.querySelector !== "function") return -1;
          knobEl = rail.querySelector('.es-knob, .rail__knob, [class*="knob"]');
        }
        if (!knobEl || typeof knobEl.getBoundingClientRect !== "function") return -1;
        var kr = knobEl.getBoundingClientRect();
        if (!(kr.width > 0)) { knobEl = null; return -1; }   // 隐藏 / 已失效：下一帧重新找
        var value = kr.left + kr.width / 2 - railLeft();
        if (!isFinite(value)) return -1;
        return value;
      } catch (error) {
        knobEl = null;
        return -1;
      }
    }

    /** pctRef 的当前值（0~1，取不到按满格）—— 回退路径与初始播种共用。 */
    function currentPct() {
      var pct = 1;
      try { pct = pctRef ? Number(pctRef.current) : 1; } catch (error) { pct = 1; }
      if (!(pct >= 0)) pct = 1;                       // NaN / 取不到：按满格
      return Math.min(1, Math.max(0, pct));
    }

    /**
     * ④ targetCount：每像素粒子密度恒定。
     * 旧写法 count 恒为常数 → litW 越大越稀（470 颗在 20px 上 23.5 颗/px、在 338px 上
     * 只剩 1.39 颗/px，差 17 倍，就是用户说的"高等级反而稀疏"）。
     */
    function targetCount(litW) {
      var want = Math.round(PRESET.density * litW);
      if (!(want > PRESET.countMin)) want = PRESET.countMin;
      if (want > PRESET.countMax) want = PRESET.countMax;
      return want;
    }

    /**
     * ④ 档位变化时平滑增删粒子：不够就在 [0, litW] 上均匀补一批（直接能融进流场），
     * 多了就把**离源头最远**（x 最大）的那批裁掉。litW 动画期间是连续变化的，所以这里
     * 每帧只增删一两颗，观感是"浓度不变"，不是"突然换了一批粒子"。
     */
    function syncCount(litW) {
      var want = targetCount(litW);
      if (parts.length === want) return;
      if (!(want > 0)) return;
      if (want > parts.length) {
        while (parts.length < want) parts.push(spawn(Math.random() * litW));
        return;
      }
      parts.sort(function (a, b) { return a.x - b.x; });   // 升序：靠源头的留下
      parts.length = want;
    }

    /** 初始播种的粒子数：按**当前** litW 算（不再用固定的 PRESET.count）。 */
    function seedCount() {
      var lit = knobLitW();
      if (!(lit > 0) && W > 0) lit = FLUID_INSET + (W - FLUID_INSET * 2) * currentPct();
      if (!(lit > 0)) lit = FLUID_INSET;
      return targetCount(Math.min(Math.max(lit, 2), Math.max(2, W)));
    }

    /**
     * 只在尺寸**真的**变了才写 canvas.width / height。
     * ⚠️ 重设 canvas.width 会清空整块画布：若每帧都写一次，流体就会"凭空消失"
     *    （预览页踩过这个坑，截图里流体不见了就是它）。返回 false = 量不到尺寸，
     *    这一帧应当整个跳过（不做任何除法）。
     */
    function resizeIfNeeded() {
      var size = measure();
      if (size.w <= 0 || size.h <= 0) return false;
      if (size.w === W && size.h === H && canvas.width > 0) return true;
      W = size.w;
      H = size.h;
      railLeftCache = null;                       // 轨道刚动过，缓存作废
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 星光层单独一块 canvas（尺寸跟着轨道走）；拿不到就整层静默关掉，不影响流体
      if (starCtx2d !== null) {
        starW = W;
        starH = H;
        starCanvas.width = Math.round(W * dpr);
        starCanvas.height = Math.round(H * dpr);
        starCtx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        stars.length = 0;
      }
      // 与预览页一致（修复 c「一坨墙」）：尺寸变化后**整幅宽度均匀随机播种**，
      // 而不是全钉在左端 x=0 —— 后者配合下面窄带回收入口会让 420 颗粒子挤成一堵
      // 约 110px 宽、齐步右移的墙，整条轨道只剩那一小段有流体。
      parts = [];
      var seedN = seedCount();                    // ④ 按当前 litW 定粒子数（密度恒定）
      for (var i = 0; i < seedN; i += 1) parts.push(spawn());
      // 重排后整幅宽度均匀播种：横向分布与任何 litW 都无关了，所以清掉标定值 ——
      // 下一帧只记录新的 litW，不做"重标定缩放"（否则会把刚播好的均匀分布按旧比例拉歪）。
      lastLitW = 0;
      return true;
    }

    /** 单帧。就是预览页 frame() 的函数体（去掉 rAF 自举），进度改为读 ref。 */
    function step(now) {
      if (!resizeIfNeeded()) return;                 // 0 尺寸：跳过这一帧
      if (typeof now !== "number" || !isFinite(now)) now = clock();
      // 固定步进：推进量不按 dt 缩放（无头 / 低帧率下 dt 可能极小，会让流体"站着不动"）。
      var t = now - t0;
      tNow = t;                                      // 星光层读它做闪烁/飘动

      // ★ 源头颜色：随时间在色带上**往返**（三角波 0→1→0）。
      //   用往返而不是"0→1 后跳回 0"：色带的两端是蓝和粉，直接回绕会在接缝处出现
      //   粉/蓝硬边；往返则颜色连续折返，看不出接缝。
      //   每个粒子把出生时的 sourceT 记进 pt.ct 并带一辈子 —— 这就是"源头在变、
      //   粒子颜色随之在变"的流体带（而不是按位置染色的固定渐变）。
      var huePhase = (t % PRESET.hueCycle) / PRESET.hueCycle;
      sourceT = huePhase < 0.5 ? huePhase * 2 : (1 - huePhase) * 2;

      // 进度：只让"已点亮"的那段有流体；源头在轨道左端，向右流，右侧未点亮区保持空的。
      // 进度由 React 侧经 ref 喂进来（不再读 getComputedStyle —— 那既慢又和渲染时序耦合）。
      var pct = currentPct();
      // 插件几何：填充条宽度 = calc(17px + (100% - 34px) * --pct/100)
      var fallbackLitW = FLUID_INSET + (W - FLUID_INSET * 2) * pct;
      // ① 优先读**珠子当前渲染位置**：CSS 过渡期间拿到的就是动画中的位置，于是流体
      //    跟着珠子的吸附动画一起压缩，而不是先"啪"一下到位。拿不到珠子（桩 DOM /
      //    display:none / rect 宽为 0）才回退到 pct 算法 —— 引擎绝不停摆、绝不抛错。
      var litW = knobLitW();
      var litSource = "knob";
      if (!(litW > 0)) { litW = fallbackLitW; litSource = "pct"; }
      litW = Math.min(W, Math.max(2, litW));          // 认 pct 还是珠子，都要夹到 [2, W]
      railLitWCurrent = litW;                         // 星光层读它（星星只铺在已点亮区里）
      // 颜色采样必须与 litW 用同一个几何：从 litW 反推"有效进度"（珠子过冲时也跟着过冲）
      pct = Math.min(1, Math.max(0, (litW - FLUID_INSET) / Math.max(1, W - FLUID_INSET * 2)));

      // ── 修复 d（第二轮）：档位一变，把整团粒子的横向分布**同步重标定**到新的已点亮宽度 ──
      // 缺陷（第一轮验收未抓到的瞬态）：低档时全部粒子被下面那段回收挤在源头窄带里
      // （实测 --pct=25% 时 380 颗粒子全在 x∈[-3,100]，histX 前 6 桶已占满）。档位一跳回 100%，
      // 这团粒子整体向右平移，**源头当场断料**；下一批"料"要等某颗粒子跑完整段才被回收，
      // 于是中段出现一个约 5 秒的空洞（实测跳变后 2.5s：col0..col4 = 12/14/23/69/116）。
      // 稳态（直接 load 满档）量不到这个 —— 它只存在于"档位刚变过"的窗口里。
      // 等比例重标定 x' = x * litW/lastLitW（锚点 = 左端源头 x=0）：拖到哪流体就铺到哪，
      // 松手时已经是满的；观感仍然是"左端是源头、整体向右流、涡旋搅散"，不是把粒子均匀撒满。
      // ⚠️ 阈值 0.5 → 0.01：现在 litW 是**逐帧连续变化**的（跟着珠子动画），单帧步长很小，
      //    阈值太大就会被跳过 —— 那样 lastLitW 不更新、下一帧的缩放比例会一次性累积成跳变。
      if (lastLitW > 0 && Math.abs(litW - lastLitW) > 0.01) {
        var litScale = litW / lastLitW;
        for (var ri = 0; ri < parts.length; ri += 1) parts[ri].x *= litScale;
      }
      // ④ 粒子数随 litW 等比伸缩（每像素密度恒定）：压缩时平滑删、拉伸时平滑补。
      //    放在重标定**之后**：新补的粒子已经在 [0, litW] 内均匀撒好，不该再被缩放一次。
      syncCount(litW);
      lastLitW = litW;

      // 修复 b：把进度往左拉时，右边原来的像素不再处于裁剪区内，光靠"淡出"永远清不掉，
      // 于是留下定格的颜色（实机发现的 bug）。直接清掉已点亮区以外的部分，
      // 并把越界的粒子回收 —— 这样缩回去就是干净的底色。
      if (litW < W - 1) {
        ctx2d.globalCompositeOperation = "source-over";
        ctx2d.clearRect(litW, 0, W - litW, H);
      }
      for (var q2 = 0; q2 < parts.length; q2 += 1) {
        var recycleX = Math.random() * Math.min(26, litW * 0.35) - 4;
        if (parts[q2].x > litW - 1) parts[q2] = spawn(recycleX);
      }

      ctx2d.save();
      ctx2d.beginPath();
      // 圆角矩形裁剪：流体不会溢出轨道圆角
      if (ctx2d.roundRect) ctx2d.roundRect(0, 0, litW, H, H / 2);
      else ctx2d.rect(0, 0, litW, H);
      ctx2d.clip();

      // 修复 a：缓慢淡出必须用 destination-out 真正"擦除"旧粒子，
      // 而不是盖一层深色（盖深色会累加到不透明黑，形成拖影残留）。
      // 擦除后露出的是 .es-rail 自己的深色渐变，观感一致。
      ctx2d.globalCompositeOperation = "destination-out";
      ctx2d.fillStyle = "rgba(0,0,0," + PRESET.fade.toFixed(3) + ")";
      ctx2d.fillRect(0, 0, W, H);
      ctx2d.globalCompositeOperation = "source-over";

      // 第四轮：涡旋上限 3 → 6、出现概率 0.025 → 0.05（搅动更多更随机）
      if (vortices.length < 6 && Math.random() < 0.05) spawnVortex();
      var alive = [];
      for (var i = 0; i < vortices.length; i += 1) {
        var v = vortices[i];
        if (now - v.born < v.ttl) alive.push(v);
      }
      vortices = alive;

      ctx2d.globalCompositeOperation = PRESET.blend;
      // ★ 最高档奖励：流速 ×2（用户：「当选中最高档位时，流体流速变为原来的2倍」）。
      //   判据用**目标** pct（pctRef）而不是珠子当前位置：这样"一进入最高档"就生效，
      //   不必等吸附动画跑完。
      //   ⚠️ 原来是 `pct > 0.999`：加上第 6 格 ULTRA 之后档位分母变成 5，MAX 的 pct
      //      只有 0.8，旧判据会让 MAX **丢掉**这个效果。现在改成按索引判定
      //      （isTopPct 拿 pct 与「顶格那一格的位置」= lastTopIndex/(lastTopIndex+1) 比），
      //      MAX 与 ULTRA 都算顶格 —— lastTopIndexRef 就是「真实档位数 - 1」，
      //      所以档位表没变（真实 N 档）时这里的取值与旧实现逐值等价（已验证 2~7 档）。
      //      物理常数一个没动，星流逻辑也没动。
      var isTop = isTopPct(pct, lastTopIndexRef ? lastTopIndexRef.current : -1);
      var speed = PRESET.vel * (isTop ? PRESET.topSpeedMul : 1);
      for (var p = 0; p < parts.length; p += 1) {
        var pt = parts[p];
        // 运动学：速度大小恒定，curl 与涡旋只改变**方向**。
        // （旧写法把 curl 当加速度累加，vx 会飙到 ±4，粒子被推回去、整段流体堆在左端。）
        var cv = curl(pt.x, pt.y + pt.ph, t);
        // 第四轮：0.55 → PRESET.swirl(0.9)。局部流场对方向的支配力更强，不再是
        // "整片朝右平移、只是略有起伏"，而是每颗粒子都跟着当地流场乱走（用户："运动不够随机"）。
        // 仍然保留 `1 +`：主方向还是向右，只是被搅得更厉害。
        var dirX = PRESET.bias + cv[0] * PRESET.swirl * pt.s;      // 主方向：向右（响应强度各不相同）
        var dirY = cv[1] * PRESET.swirl * pt.s;          // 横向搅动
        var wob = Math.sin(t * 0.0016 + pt.ph) * 0.34 * pt.s;   // 个体摆动：把"一堵墙"打散成丝絮（0.22→0.34）
        dirY += wob;
        for (var vi = 0; vi < vortices.length; vi += 1) {
          var vo = vortices[vi];
          var dx = pt.x - vo.x, dy = pt.y - vo.y;
          var d2 = dx * dx + dy * dy;
          var k = vo.s * (vo.r * vo.r) / (d2 + vo.r * vo.r * 0.6);
          dirX += -dy * k * 0.012;                // 切向：把流体卷起来
          dirY += dx * k * 0.012;
        }
        var len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
        pt.vx = pt.vx * 0.80 + (dirX / len) * 0.20;
        pt.vy = pt.vy * 0.80 + (dirY / len) * 0.20;
        pt.x += speed * pt.sp * (1 + pt.vx * 0.6);
        pt.y += speed * pt.vy * 1.6 + (Math.random() - 0.5) * PRESET.jitter * 0.35;
        if (pt.y < -4) pt.y = H + 3;
        if (pt.y > H + 4) pt.y = -3;
        pt.age += 16.7;
        // 回收：只按位置（流到液面 / 被卷出左边界），不按年龄 ——
        // 年龄回收会让粒子来不及穿过整段就被换掉，流体同样堆在源头。
        if (pt.x > litW - 2 || pt.x < -6) {
          // 回收位置随"已点亮宽度"分布：短进度时也摊开在源头附近，
          // 不会全挤在 x∈[0,8] 叠加饱和成白（实测到的白色残留）。
          parts[p] = spawn(Math.random() * Math.min(26, litW * 0.35) - 4);
          pt = parts[p];
        }
        ctx2d.beginPath();
        // ★ 颜色取**出生时**的那一档（pt.ct），不按当前位置取。
        //   用户原话："流体渐变不是粒子颜色渐变，而是源头发出的粒子颜色在变。"
        //   所以源头的颜色随时间在色带上往返（frame() 里的 sourceT），
        //   粒子把这个颜色带到底 —— 读起来是一列"颜色在变的流体带"被推向右边。
        //   （旧写法按 x 位置取样，整条轨道是固定渐变：左蓝右粉，位置决定颜色。）
        var cc = colorAt(pt.ct);
        // 老化只让粒子淡一点点（0.45 → 0.15）：用户不喜欢"渐变不透明"那种越流越淡的
        // 烟状拖尾，要的是能看出流动方向的实心流体。层理由涡旋与速度差给出，不靠变淡。
        var alpha = pt.a * (1 - 0.15 * Math.min(1, pt.age / pt.life));
        ctx2d.fillStyle = "rgba(" + cc[0] + "," + cc[1] + "," + cc[2] + "," + alpha.toFixed(3) + ")";
        if (mode === "holo") {
          // 全息画**竖线**，不画圆点：这条轨道在这里是一台仪表，读数靠刻线而不是一团雾。
          // 高度跟着半径走（holo 的 r 是 1.0~2.8 → 线高 5~14px）；x 取整，否则 1px 宽的线
          // 落在分数像素上会被抗锯齿糊成一条灰带。
          var lineH = pt.r * 5;
          ctx2d.fillRect(Math.round(pt.x), pt.y - lineH / 2, 1, lineH);
        } else {
          ctx2d.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
          ctx2d.fill();
        }
      }
      ctx2d.globalCompositeOperation = "source-over";

      // ★ 这里原来有一段"液面高光"：在 litW 处画一条 14px 宽、向 rgba(214,226,255,.16)
      //   收口的白色渐变。它被 `destination-out` 每帧擦掉 2.8%、又每帧重画一次，
      //   于是稳定在不透明白 —— 再被 `roundRect(0,0,litW,H,H/2)` 的右圆头一裁，
      //   就变成贴着珠子的一枚白色残月，拖动时跟着跑（用户报的"白色半圆 + 残影"）。
      //   已删除：流体的前沿本来就由 clearRect 切出锐边，不需要再加白。
      ctx2d.restore();

      // ══ 最高档奖励：星光往**左**流 ═══════════════════════════════════════
      // 用户：「然后有星光即一点点的星星往左流动的特效叠加在上面」
      // 之后追加：「从低档位切换到最高档位，星星不要突然出现，而是以最右端为源头，
      //            而且速度慢慢提高」→ 见 starEnterAt / starRampMs：
      //   进入最高档那一刻记下时间，星星从**最右端**进场，速度在 starRampMs 内由
      //   starRampStart 倍爬到 1 倍（ramp²，先慢后猛）。
      // 画在**另一块 canvas** 上（.es-rail__stars），不是流体那块：
      // 流体画布靠 destination-out 累积拖尾，星星要是画上去会被"糊"进拖尾里发虚，
      // 而且会污染流体的 alpha 统计（验收/离线判据量的都是流体那块画布）。
      // 只在最高档出现；离开最高档立刻清空（不能留残星）。
      if (starCtx2d !== null) {
        if (isTop) {
          if (starEnterAt < 0) starEnterAt = t;              // 刚进入最高档：开始计时并清空重来
          drawStars();
        } else {
          starEnterAt = -1;
          clearStars();
        }
      }

      // 调试钩子（不参与逻辑、默认空实现）：离线测试用它在**帧边界**上收集这一帧真正画过的
      // 几何，从而按列重放 alpha 并判"粒子有没有铺满整条已点亮轨道"（"一坨墙"回归）。
      // 钩子自己抛错只摘掉钩子、**不**让异常走到外层的帧级 try/catch —— 那里会把动画整个停掉。
      // 本帧的几何（litW / pct / 粒子数 / litW 来源 / 实际流速）作为**标量实参**传出去：
      // 给离线/无头验收读"珠子跟随 + 密度恒定 + 最高档提速"用。老钩子（不接参数）忽略它们即可；
      // 刻意不传对象 —— 热路径里一次分配都不做，免得改变 JIT 时序（[12] 的逐帧 trace 比对很敏感）。
      if (typeof onFrame === "function") {
        try { onFrame(litW, pct, parts.length, litSource, speed, isTop ? 1 : 0); } catch (error) { onFrame = null; }
      }
    }

    /** rAF 自举 + 每帧兜底：出错就静默停掉（绝不冒泡到宿主 / React）。 */
    function frame(now) {
      raf = 0;
      if (stopped) return;
      var ok = true;
      try { step(now); } catch (error) { ok = false; }
      if (!ok) { stop(); return; }
      raf = requestFrame(frame);
    }

    /** resize 只做"重新量尺寸"；量不到（隐藏中）就什么都不做。 */
    function onWindowResize() {
      try { resizeIfNeeded(); } catch (error) { /* 忽略 */ }
    }

    /** 停：cancelAnimationFrame + 摘监听 + 断 ResizeObserver + 清画布。幂等。 */
    function stop() {
      if (stopped) return;
      stopped = true;
      cancelFrame(raf);
      raf = 0;
      try {
        if (win.removeEventListener) win.removeEventListener("resize", onWindowResize);
      } catch (error) { /* 忽略 */ }
      if (observer) {
        try { observer.disconnect(); } catch (error) { /* 忽略 */ }
        observer = null;
      }
      parts = [];
      vortices = [];
      // 停掉后不留残影：整块画布清干净（切皮肤 / 面板收起时走这里）
      try { ctx2d.clearRect(0, 0, Math.max(W, 1), Math.max(H, 1)); } catch (error) { /* 忽略 */ }
    }

    // 启动：先量一次尺寸，再挂监听（整段同一个 try —— 任何一步失败都退化成"没有动画"）
    try {
      resizeIfNeeded();
      if (win.addEventListener) win.addEventListener("resize", onWindowResize);
      if (typeof win.ResizeObserver === "function") {
        observer = new win.ResizeObserver(onWindowResize);
        observer.observe(rail);
      }
    } catch (error) {
      stop();           // 启动失败：把已经挂上的副作用摘干净，画布也清掉
      return noop;
    }
    raf = requestFrame(frame);
    return stop;
  }

  /* ────────────────────────── 组件 ────────────────────────── */

  function EffortSlider(props) {
    var store = props.store;
    var preferences = props.preferences;
    var loadDirectory = props.load;
    var commit = props.commit;
    var available = props.available;
    var api = props.api;

    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useSyncExternalStore = React.useSyncExternalStore;

    var boltRef = useRef(null);

    /**
     * 系统是否要求"减少动态效果"。
     * 本文件原先只在 CSS 里用 @media 处理，JS 侧没有判据 —— 这里补一个**局部**判据
     * （不装全局监听：滑动条是单实例、只在挂载时判一次，切系统设置刷新即可生效）。
     * matchMedia 在极少数环境不存在，所以整段带兜底，永远返回布尔。
     */
    function reduceMotion() {
      try {
        return typeof window !== "undefined"
          && typeof window.matchMedia === "function"
          && window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
      } catch (error) { return false; }
    }

    /**
     * ★ 闪电形状：**内联 SVG**（无外部图片/SVG 文件、无额外请求）。
     *
     * 为什么必须改成 SVG 描边：旧画法
     *   `.es-pill__bolt::after{inset:1.5px;padding:1.9px;mask:linear-gradient(#000 0 0)…
     *    …content-box,…;mask-composite:exclude}` + `clip-path:闪电多边形`
     * 看着像描边，其实那圈环是按**矩形盒子的周长**算出来的，再与闪电 clip-path 求交，
     * 只剩闪电最外缘几段残片 —— 取证图 bolt-probe.png（×2 全页）里面板右上角只有
     * 一小段白短线，既不是闪电也不是轮廓。所以「白边看不到」是**几何问题**，
     * 把 opacity .34→.62、颜色换 #fff、描边加粗 1.5→1.9px 全都治不了它。
     * `stroke` 沿路径中心线两侧各画一半宽度，轮廓才是几何精确的。
     *
     * 路径沿用 Anthropic 那套 24×24 闪电（与旧 clip-path 的多边形同源，不引新资源）。
     * 渐变/流动全部由 CSS 承担（`stroke:url(#es-bolt-flow)` + stroke-dashoffset 动画），
     * 这样减少动态效果的 @media 一进门就能把动画全停掉，JS 侧不用管动画。
     *
     * ⚠️ 用 `h("svg", …)` 而不是 innerHTML / dangerouslySetInnerHTML：
     *    · innerHTML 不走命名空间，`<path>` 会被造到 HTML 命名空间里（不渲染）；
     *    · dangerouslySetInnerHTML 是字符串处理，且与 children 互斥，未来加一个子节点
     *      就会直接抛错。React 对 `h("svg")` 会走 createElementNS 的 SVG 命名空间
     *      （本文件里 `<canvas>` / `.es-rail__fluid` 都靠这套渲染，同一个 runtime）。
     *    下面 `boltTree()` 里还对命名空间做了断言——万一某个宿主 React 版本行为不同，
     *    返回 null 也不影响按钮本身（只剩 aria-label 与透明背景，不会出现白色方块）。
     */
    var BOLT_PATH = "M13 2 L3 14 h9 l-1 8 10-12 h-9 l1-8 z";
    // 渐变 id：CSS 里 `.es-pill__bolt[data-on="1"] .es-bolt__line{stroke:url(#es-bolt-flow)}`
    // 就是按这个名字找的。**两边必须一致** —— 改这里必须同时改 CSS（否则描边会整条不画）。
    var BOLT_GRADIENT_ID = "es-bolt-flow";

    function boltTree() {
      var line = h("path", { key: "bolt-line", className: "es-bolt__line", d: BOLT_PATH });
      // 命名空间自检：不在 SVG 命名空间里就整块放弃（宁可不画，也不要画出一个隐形黑块）
      if (line && typeof line.namespaceURI === "string"
        && line.namespaceURI.indexOf("2000/svg") === -1) return null;
      // ★ 通电描边用的渐变。**必须真的给出这个 <linearGradient>**：
      //   CSS 里的 `stroke:url(#es-bolt-flow)` 一旦找不到元素，按规范这条 paint 就是
      //   "无效引用" → 整条描边**不画**（不是回退到 currentColor）。实测过这个坑：
      //   通电态只剩一颗流动的小亮点（电流包），闪电轮廓整个消失。
      //   ⚠️ "流动"不在 SVG 侧做：`<animate attributeName="x1">` 只能覆盖元素上**已存在**的
      //   属性，而这个渐变没有 x1/x2 时 SMIL 不会凭空造一个（实测：animate 在 DOM 里、
      //   值恒为空串、渐变不动）。所以 x1/x2 走 CSS @property + @keyframes（见
      //   effort-slider.css 的 es-bolt-sweep）：这里只把几何接到那两个变量上。
      //   ⚠️ 必须写 `var(--es-bolt-x1, 0)` 而**不能**写 `inherit`：presentation attribute
      //   写 inherit 时继承的是同名属性（x1），而不是我的自定义属性 —— 实测过，
      //   那样动画照跑、渐变却一动不动。逗号后的 0 / 24 是"变量没定义"时的静态兜底。
      var gradient = h("linearGradient", {
        id: BOLT_GRADIENT_ID,
        x1: "var(--es-bolt-x1, 0)", y1: "0",
        x2: "var(--es-bolt-x2, 24)", y2: "24",
        gradientUnits: "userSpaceOnUse",
      },
        h("stop", { offset: "0%", stopColor: "#ffffff" }),
        h("stop", { offset: "45%", stopColor: "var(--es-bolt-a, #e8faf7)" }),
        h("stop", { offset: "100%", stopColor: "var(--es-bolt-b, #37e0d8)" }),
      );
      // 减少动态效果时**不生成**"电流包"这一层：它是纯装饰，reduce 下连静态残影都不该有。
      //   （CSS 里另有 @media 兜底，两道保险 —— matchMedia 不可用时 CSS 仍然生效。）
      // ⚠️ 数组形式的 children 必须逐个带 key，否则 React 在真宿主里会打
      //   `Each child in a list should have a unique "key" prop` —— 这是从**真产物 harness 控制台**
      //   里抓到的（harness 的 console.error 计数 = 1，栈顶是 `at defs`）。所以这里给 defs 与
      //   两条 path 都补上稳定的 key；将来再加子节点也必须带。
      var children = [h("defs", { key: "bolt-defs" }, gradient), line];
      if (!reduceMotion()) {
        // "电流包"：一条短亮线沿闪电轮廓流动，由 CSS 用实测 path 长度做 stroke-dashoffset
        children.push(h("path", { key: "bolt-glowline", className: "es-bolt__glowline", d: BOLT_PATH }));
      }
      return h("svg", {
        className: "es-bolt__svg",
        viewBox: "0 0 24 24",
        // 只当装饰：语义由 button 的 aria-label / aria-pressed 承担
        "aria-hidden": "true",
        focusable: "false",
      }, children);
    }

    // 必须用稳定引用版本，否则 React 判定快照每次都变 → 无限重渲染 → 卡死界面
    var readStore = hostSnapshot(store);

    var snapshot = useSyncExternalStore(
      hostSubscribe(store),
      readStore,
      readStore,
    );
    // 偏好对象缺失时也要能渲染出默认皮肤（防御式读取，见 skinOf）
    var prefsSubscribe = preferences && typeof preferences.subscribe === "function"
      ? preferences.subscribe
      : function () { return function () {}; };
    var prefsRead = preferences && typeof preferences.getSnapshot === "function"
      ? preferences.getSnapshot
      : readDefaultPrefs;
    var prefs = useSyncExternalStore(prefsSubscribe, prefsRead, prefsRead);
    var state = snapshot === null || snapshot === undefined ? null : snapshot.raw;

    var effort = pickEffort(state);
    var efforts = effort ? effort.efforts : [];
    var count = efforts.length;
    /**
     * ★ 展示层档位表 = 真实档位 + 追加的 ULTRA 格（契约 §2）。
     *
     * **不碰**上面的读取逻辑（computePick / pickEffort 一字未改）：efforts 是模型目录里
     * 真实可用的档位，levelsOf 只在这份列表之上"加一格显示"。
     * 于是：
     *   · count        = 真实档位数（仍是 loading 判据、仍是提交时的守卫边界）
     *   · levelCount   = 展示档位数（刻度 / aria-valuemax / 索引 / pct 全部用它）
     *   · realEffortCount - 1 = **顶格索引**（MAX）：MAX 与它右边的 ULTRA 都算顶格
     */
    var levels = levelsOf(efforts);
    var levelCount = levels.length;
    var realEffortCount = count;
    /** 本组件所属会话（宿主 inject 时传入）：turbo 路由靠它精确定位，子代理/其它会话不受影响。 */
    var sessionId = props.sessionId || "";
    // committed 的语义：0-based 的当前档位下标；-1 专指「拿不到有效档位」。
    // 模型没显式设档（auto）时 pickEffort 已经把默认档解析成 index 了，这里必须照用：
    // 旧写法把 auto 一律判成 -1，UI 只好用 count - 1（最后一档）兜底 → 显示错档位。
    var committed = effort && effort.index >= 0 ? effort.index : -1;

    var openState = useState(false);
    var open = openState[0];
    var setOpen = openState[1];
    var draftState = useState(committed);
    var draft = draftState[0];
    var setDraft = draftState[1];
    var busyState = useState(false);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var failedState = useState(false);
    var failed = failedState[0];
    var setFailed = failedState[1];
    var snapState = useState(false);
    var snap = snapState[0];
    var setSnap = snapState[1];
    var pulseState = useState(0);
    var pulse = pulseState[0];
    var bumpPulse = pulseState[1];
    // ── TURBO 状态（闪电默认关：真正的默认值在宿主侧持久化，这里只做页面内的即时状态）──
    var lightningState = useState(false);
    var lightning = lightningState[0];
    var setLightning = lightningState[1];
    // 最近窗口的 token 吞吐（tok/s，整数，宿主算好）。0 = 没有数据 → 读数整块隐藏。
    var rateState = useState(0);
    var rate = rateState[0];
    var setRate = rateState[1];
    // 策略原文（英文）。空串 = 两个模式都没开 → chip 显示"未注入策略"且不可展开。
    var policyState = useState("");
    var policy = policyState[0];
    var setPolicy = policyState[1];
    var policyOpenState = useState(false);
    var policyOpen = policyOpenState[0];
    var setPolicyOpen = policyOpenState[1];
    /**
     * ULTRA 位（宿主持久化的那个）。
     * 页面加载时从宿主读回 → 刷新后**第 6 格仍然是选中的**（否则会跳回 MAX，
     * 而宿主那边还在注入 rigor 策略，界面与后端不一致）。
     * 用户每次换档会覆盖它（真实档位 = false，ULTRA = true），之后不再被心跳覆盖。
     */
    var ultraOnState = useState(false);
    var ultraOn = ultraOnState[0];
    var setUltraOn = ultraOnState[1];
    var turboReadyState = useState(false);
    var turboReady = turboReadyState[0];
    var setTurboReady = turboReadyState[1];

    var rootRef = useRef(null);
    var railRef = useRef(null);
    /** TURBO 轮询的失败计数 / 停止闸：连续 TURBO_MAX_FAILURES 次失败就不再打请求。 */
    var turboFailuresRef = useRef(0);
    var turboStoppedRef = useRef(false);
    /** 两次 turbo 请求的最小间隔（见 TURBO_MIN_FETCH_GAP_MS）。 */
    var turboFetchedAtRef = useRef(0);
    /** 最近一次真正写进 --es-rate 的强度：用来判断"要不要清掉"上次残留的发光。 */
    var rateVarRef = useRef(-1);
    /**
     * 最近一次 push 给宿主的 ULTRA 状态（null = 还没推过）。
     * 拖动经过顶格两格时会反复触发渲染，靠它去重，避免同一状态反复 PATCH。
     */
    var ultraSentRef = useRef(null);
    /**
     * 顶格索引（= 真实档位数 - 1），渲染期写入、rAF 里读。
     * 用它让引擎按索引判顶格（isTopPct）：加不加 ULTRA 格，MAX 的效果都不变。
     */
    var lastTopIndexRef = useRef(-1);
    /**
     * 当前渲染这一轮的「推 ULTRA 位」函数（每次渲染重新赋值）。
     * 之所以走 ref：`next()` 里有一条"档位没变、只有 ULTRA 位要变"的早退分支，
     * 它必须能在**不改目录**的前提下把位推给宿主，而那个函数要用到闭包里的 wantUltra。
     */
    var pushUltraRef = useRef(noop);
    /** 宿主返回的 ultra 是否已经采纳过一次（只采纳首次，之后以本地最新操作为准）。 */
    var ultraSyncedRef = useRef(false);
    // React owns each candidate scope until commit. An abandoned concurrent
    // render must not invalidate the still-visible session's effects.
    var turboScopeRef = useRef(null);
    var turboScopeMemoRef = useRef(null);
    function newTurboScope() {
      return { sessionId: sessionId, active: false, generation: 0,
        controllers: new Set(), readVersion: 0, mutationVersion: 0, lightningVersion: 0,
        commitVersion: 0, ultraVersion: 0, hydrated: false, selection: null };
    }
    var turboScope;
    if (typeof React.useMemo === "function") {
      turboScope = React.useMemo(newTurboScope, [sessionId]);
    } else {
      // Older hosts and the existing offline render shims omit useMemo.
      if (!turboScopeMemoRef.current || turboScopeMemoRef.current.sessionId !== sessionId) {
        turboScopeMemoRef.current = newTurboScope();
      }
      turboScope = turboScopeMemoRef.current;
    }
    function turboCurrent(scope, generation) {
      return scope === turboScopeRef.current && scope.active && scope.generation === generation;
    }
    function scopedTurboFetch(url, init, scope, owner) {
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      if (controller) {
        scope.controllers.add(controller);
        if (owner) owner.controller = controller;
        init = Object.assign({}, init, { signal: controller.signal });
      }
      function release() {
        if (controller) scope.controllers.delete(controller);
        if (owner && owner.controller === controller) owner.controller = null;
      }
      return turboFetch(url, init).then(function (body) { release(); return body; }, function (error) {
        release(); throw error;
      });
    }
    // ② 吸附动画：珠子本体（往它身上写内联 transition-duration，覆盖 CSS 里的固定时长）
    var knobRef = useRef(null);
    // 流体引擎的落点：canvas 挂在轨道里（见下面的 es-rail__fluid）
    var fluidCanvasRef = useRef(null);
    // 流体进度（0~1）。每帧由引擎直接读这个 ref —— 不读 getComputedStyle，
    // 也不进 rAF 的依赖：React 更新 ref 不影响已经在跑的那一帧。
    var fluidPctRef = useRef(1);
    var draggingRef = useRef(false);
    // 拖拽期间 draft 的最新值。React 状态下一次渲染才生效，pointerup 可能落在旧闭包上，
    // 所以提交时以 ref 为准（state 只负责驱动画面）。
    var draftRef = useRef(committed);

    /**
     * 写 draft 的唯一入口：ref 与 state 一起更新。
     * draft 只表示「画面当前该显示的档位」——合法下标，或 -1 表示「没有本地草稿，跟随 committed」。
     * 旧版曾用 setDraft(-1) 当「让 next() 走提交分支」的哨兵，那会让 shown 瞬间回落到
     * committed、读数跳一档，这里彻底去掉：提交走 next(target, true) 这条显式路径。
     */
    function putDraft(value) {
      draftRef.current = value;
      setDraft(value);
    }

    /* ────────────── TURBO：宿主读写（闪电 / ULTRA / 舰队 tok/s）──────────────
       全部 fail-open —— 这个插件的全部历史就是"静默失效"：宿主没有这些路由
       （404）、网络断了、返回非 JSON，都必须只是"没有数据"，
       绝不允许冒泡成渲染异常（渲染异常会被错误边界整块隐身，用户直接丢控件）。 */

    /**
     * 这轮要不要继续轮询：**只在闪电开启或已经有读数时跑**。
     * 两个模式都没开时一次都不打请求（不做无意义的后台流量）。
     */
    var turboPolling = lightning || rate > 0;

    /**
     * 从宿主读一次 turbo 快照。返回的 Promise：
     *   · resolve = 本轮心跳（成功或已停止轮询，都算"正常结束"）
     *   · reject  = 这一次真的失败了（调用方据此决定是否停表）
     * 组件卸载后不再 setState（否则 React 会警告，虽然不影响观感）。
     */
    function turboRead(owner) {
      var scope = turboScope;
      var generation = scope.generation;
      var url = turboURL(sessionId);
      if (url === "" || !turboCurrent(scope, generation) || turboStoppedRef.current) return Promise.resolve();
      var now = Date.now();
      if (now - turboFetchedAtRef.current < TURBO_MIN_FETCH_GAP_MS) return Promise.resolve();
      turboFetchedAtRef.current = now;
      var version = ++scope.readVersion;
      var mutation = scope.mutationVersion;
      var lightningVersion = scope.lightningVersion;
      var ultraVersion = scope.ultraVersion;
      function current() {
        return turboCurrent(scope, generation) && version === scope.readVersion
          && (!owner || owner.active);
      }
      return scopedTurboFetch(url, { headers: { Accept: "application/json" } }, scope, owner).then(function (body) {
        if (!current()) return;
        turboFailuresRef.current = 0;
        if (!body || typeof body !== "object") return;
        // 宿主回的是权威值：闪电开关 / ULTRA 位 / 读数都靠它读回（页面刷新后也能恢复）
        if (lightningVersion === scope.lightningVersion) setLightning(body.lightning === true);
        if (ultraVersion === scope.ultraVersion) setUltraOn(body.ultra === true);
        setRate(safeCount(body.rate));
        if (mutation === scope.mutationVersion) setPolicy(typeof body.policy === "string" ? body.policy : "");
        scope.hydrated = true;
        setTurboReady(true);
      }, function (error) {
        if (!current() || (error && error.name === "AbortError")) return;
        turboFailuresRef.current += 1;
        // 连续失败到阈值就停表：宿主要么没实现这条路由，要么就是连不上，
        // 继续打只是浪费 —— 控件本身照旧可用（本地乐观状态）。
        if (turboFailuresRef.current >= TURBO_MAX_FAILURES) turboStoppedRef.current = true;
        throw error;
      });
    }

    /**
     * 写回闪电 / ULTRA 状态（PATCH）。
     * **不吞异常**：调用方拿失败来做乐观回滚（.then(ok, rollback) 的 ok 分支）。
     */
    function turboPatch(patch) {
      var scope = turboScope;
      var generation = scope.generation;
      var url = turboURL(sessionId);
      if (url === "" || !turboCurrent(scope, generation) || turboStoppedRef.current) return Promise.resolve(false);
      var mutation = ++scope.mutationVersion;
      var payload = { session: sessionId };
      if (patch && patch.lightning !== undefined) payload.lightning = patch.lightning === true;
      if (patch && patch.ultra !== undefined) {
        payload.ultra = patch.ultra === true;
        scope.ultraVersion += 1;
      }
      return scopedTurboFetch(TURBO_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, scope).then(function (body) {
        if (!turboCurrent(scope, generation)) return false;
        if (!body || body.ok !== true) throw new Error("turbo patch rejected");
        // 宿主回的字段是权威值；缺字段就沿用我们发出去的那个（别把开关闪一下）
        if (mutation === scope.mutationVersion && typeof body.lightning === "boolean") setLightning(body.lightning);
        return true;
      });
    }

    /**
     * 点击闪电：**乐观更新 + 失败回滚**。
     * 整段包在 try/catch 里 —— 任何异常（fetch 同步抛 / 闭包里的旧状态）都不许冒泡到 pill，
     * 更不能让 pill 的 onClick 抛错后吞掉后续交互。
     */
    function toggleLightning(event) {
      if (event && typeof event.stopPropagation === "function") event.stopPropagation();
      var previous = lightning;
      var nextValue = !previous;
      var scope = turboScope;
      var generation = scope.generation;
      var operation = ++scope.lightningVersion;
      setLightning(nextValue);
      try {
        turboPatch({ lightning: nextValue }).then(function (ok) {
          if (!ok && turboCurrent(scope, generation) && operation === scope.lightningVersion) setLightning(previous);
        }, function () {
          if (turboCurrent(scope, generation) && operation === scope.lightningVersion) setLightning(previous);
        });
      } catch (error) {
        if (turboCurrent(scope, generation) && operation === scope.lightningVersion) setLightning(previous);
      }
    }

    // 挂载时（或会话变化时）读一次：闪电的默认值（关）与读数都持久化在宿主侧，页面加载要读回来。
    var useScopeEffect = typeof React.useLayoutEffect === "function" ? React.useLayoutEffect : useEffect;
    useScopeEffect(function () {
      var scope = turboScope;
      turboScopeRef.current = scope;
      scope.active = true;
      scope.generation += 1;
      scope.hydrated = false;
      turboFailuresRef.current = 0;
      turboStoppedRef.current = false;
      turboFetchedAtRef.current = 0;
      ultraSentRef.current = null;
      ultraSyncedRef.current = false;
      setLightning(false);
      setUltraOn(false);
      setRate(0);
      setPolicy("");
      setPolicyOpen(false);
      setBusy(false);
      setFailed(false);
      setTurboReady(false);
      putDraft(committed);
      try {
        turboRead().catch(noop);
      } catch (error) { /* 端点不可用：全部保持本地默认值 */ }
      return function () {
        scope.active = false;
        scope.generation += 1;
        scope.controllers.forEach(function (controller) { controller.abort(); });
        scope.controllers.clear();
        if (scope.selection) scope.selection.cancel();
      };
    }, [sessionId]);

    // 读数轮询：仅「闪电开启 或 rate > 0」时进行；隐藏页整轮跳过；卸载清表。
    useEffect(function () {
      if (!turboPolling) return undefined;
      var timer = null;
      var owner = { active: true, controller: null };
      var scope = turboScope;
      var generation = scope.generation;
      function current() { return owner.active && turboCurrent(scope, generation); }
      function tick() {
        timer = null;
        if (!current() || turboStoppedRef.current) return;
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          timer = setTimeout(tick, TURBO_POLL_MS);   // 隐藏时跳过本轮，仍然保活
          return;
        }
        var request;
        try { request = turboRead(owner); } catch (error) { request = Promise.reject(error); }
        request.catch(noop).then(function () {
          if (!current() || turboStoppedRef.current) return;
          timer = setTimeout(tick, TURBO_POLL_MS);
        });
      }
      timer = setTimeout(tick, TURBO_POLL_MS);
      return function () {
        owner.active = false;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        if (owner.controller) owner.controller.abort();
      };
    }, [turboPolling, sessionId]);

    // 发光强度：把速率归一到 0~1 写到根节点的 CSS 变量上（纯视觉，不影响任何显示的数字）。
    // 用 .style.setProperty 而不是 React style —— 数字每秒都在变，走渲染会白白重渲染整棵子树。
    useEffect(function () {
      var node = rootRef.current;
      if (!node || !node.style || typeof node.style.setProperty !== "function") return;
      try {
        var strength = rate > 0 ? Math.min(1, rate / RATE_FULL_SCALE) : 0;
        if (rateVarRef.current === strength) return;
        rateVarRef.current = strength;
        node.style.setProperty("--es-rate", strength.toFixed(3));
      } catch (error) { /* 写样式失败不影响读数本身 */ }
    });

    /**
     * ★ 实测闪电 path 的总长，写进 `--es-bolt-len`（给 CSS 的"电流包"虚线用）。
     *   · stroke-dasharray / stroke-dashoffset 是**像素量**，没法用百分比，
     *     所以必须有一次真实测量。拿不到长度就退回 CSS 的兜底值 64。
     *   · `getTotalLength()` 在"元素还没布局 / 不在 SVG 命名空间"时会抛，
     *     整段包在 try/catch 里 —— 量不到只是少了流动的电流包，静态描边与渐变照旧。
     *   · reduce 环境下不测量也不影响：CSS 的 @media 已经把流动动画停掉。
     */
    useEffect(function () {
      var node = boltRef.current;
      if (!node || typeof node.querySelector !== "function") return;
      try {
        var path = node.querySelector(".es-bolt__line");
        if (path && typeof path.getTotalLength === "function") {
          var len = path.getTotalLength();
          if (isFinite(len) && len > 0) node.style.setProperty("--es-bolt-len", len.toFixed(2) + "px");
        }
      } catch (error) { /* 量不到长度：CSS 兜底，绝不影响按钮交互 */ }
    }, []);

    /**
     * 把宿主返回的 `ultra` 补回**本地还没表态过**时的显示。
     * 只在首次采纳（ultraSyncedRef）——之后以用户操作为准，否则每秒一次的心跳会和
     * 用户刚点的档位打架（"怎么又跳回 ULTRA 了"）。
     * 判据用**本地 draft**（用户刚点的那个），而不是 committed：committed 反映的是
     * 模型目录，而 ULTRA 与 MAX 在目录里是同一个 effort id，分不出来。
     */
    useEffect(function () {
      if (!turboReady || !turboScope.hydrated || ultraSyncedRef.current || loading) return;
      if (draftRef.current !== realEffortCount && draftRef.current !== realEffortCount - 1) return;
      ultraSyncedRef.current = true;
      if (!ultraOn) return;
      // ★ 用 `next()` 而不是 `putDraft()`（用户新要求：「ultra 要自动把推理等级切换到 MAX」）。
      //   `putDraft` 只搬动界面上的那一格，**不写模型目录** —— 于是"刷新后界面停在 ULTRA、
      //   实际推理等级却还停在上次那个档"这种界面与后端不一致的状态会活下来。
      //   走 `next(realEffortCount)` 才是唯一写入口：它会把最后一个真实档位（MAX）的 id
      //   写进模型目录，并顺带把 ULTRA 位推给宿主（去重后是 no-op）。
      //   不变量：**只要界面是 ULTRA，实际推理等级就一定是 MAX**。
      next(realEffortCount);
    }, [turboReady, ultraOn, loading, realEffortCount]);

    /**
     * ★ Ultra 位的**纠偏**效果。
     *
     * 起因（用户实测）：「策略切换确实正确吗？我用的可是 low 等级，理论上你不应该收到策略吧。」
     * —— 用户的推理是对的，而且当时确实注入了 Ultra 策略。
     *
     * 根因：宿主那边的 `ultra` 位此前**只在 `next()` 提交成功之后**推。可档位还能被**别的入口**改掉：
     *   · DSH 自己的模型菜单（下面那条「外部入口改了档位，收起态与读数跟随」的效果）；
     *   · 宿主里上一次留下的持久化值（重启后客户端会把它读回来）。
     * 这些路径**都不会**推 `ultra:false`，于是宿主一直以为你还停在 Ultra 上 ——
     * 策略就被一直注入。问题不在注入逻辑，而在**这个位没有人维护**。
     *
     * 修法：把 `ultra` 当成**展示态的派生物**持续纠偏 —— 只要界面不在 Ultra 那一格，就补推一次
     * `false`（去重 + fail-open）。推 `true` 仍然只走提交成功那条路（避免"档位没切成、策略却注入了"）。
     */
    useEffect(function () {
      if (!turboReady || !turboScope.hydrated || loading || !sessionId) return;
      if (shown === realEffortCount || draftRef.current === realEffortCount) return;
      if (ultraSentRef.current === false) return;  // 已经纠偏过
      ultraSentRef.current = false;
      var scope = turboScope;
      var generation = scope.generation;
      try {
        turboPatch({ ultra: false }).then(noop, function () {
          if (turboCurrent(scope, generation) && ultraSentRef.current === false) ultraSentRef.current = null;
        });
      } catch (error) { if (turboCurrent(scope, generation)) ultraSentRef.current = null; }
    }, [turboReady, shown, realEffortCount, loading, sessionId]);

    useEffect(function () {
      if (available) loadDirectory();
    }, [available, loadDirectory]);

    // 外部入口（模型菜单等）改了档位，收起态与读数跟随。
    // committed 为 -1（没有有效档位）时也照传：draft = -1 只表示「没有本地草稿」，
    // 由下面的 shown 兜底链决定显示哪一档，不会显示成负数。
    useEffect(function () {
      if (draggingRef.current || busy) return;
      // ★ 绝不能把"合法的 ULTRA 草稿"当成失步拉回去。
      //   ULTRA 的展示下标 === realEffortCount，而 committed（模型目录里真实存在的档位）
      //   最多只能到 realEffortCount - 1 —— **两者本来就该不同**，不是失步。
      //   少了这条守卫，`next(realEffortCount)` 提交完成、busy 从 1 变 0 时会触发本效果，
      //   把界面从 ULTRA 拉回 MAX：ULTRA 只活一帧（独立取证实测 2.0ms，点刻度那次 1.4ms），
      //   于是"ULTRA 的英文名与说明在正常操作下根本看不到"。
      //   （提交失败的回滚在 `next()` 的 rollback 里显式 putDraft(committed)，那条路不受影响。）
      if (draftRef.current === realEffortCount && committed === realEffortCount - 1) return;
      putDraft(committed);
    }, [committed, busy, realEffortCount]);

    useEffect(function () {
      if (!open) return undefined;
      function onDown(event) {
        var node = rootRef.current;
        if (node && !node.contains(event.target)) setOpen(false);
      }
      function onKey(event) {
        if (event.key !== "Escape") return;
        // R8：只有焦点还在本控件（pill / 轨道 / 皮肤按钮）里时才认 Esc。
        // 否则用户在输入框或别的弹层里按 Esc，会被我们顺手把这里的面板关掉 —— 误伤宿主交互。
        var node = rootRef.current;
        if (!node) return;
        if (!node.contains(event.target)
          && !(document.activeElement && node.contains(document.activeElement))) return;
        setOpen(false);
      }
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey);
      return function () {
        document.removeEventListener("pointerdown", onDown, true);
        document.removeEventListener("keydown", onKey);
      };
    }, [open]);

    // 阶段 5：mount 心跳。必须放在所有早退 return null 之前（hooks 规则）。
    // 只有「真的渲染出控件」才算挂载成功；隐身路径上报 error 并带原因，便于外部定位。
    var mountStateRef = useRef("");
    var visible = count >= 2;
    useEffect(function () {
      var hiddenReason = visible ? "ok" : ("hidden count=" + String(count) +
        " store=" + (store ? "yes" : "no") +
        " available=" + String(available) +
        " status=" + String(state && state.status));
      if (mountStateRef.current === hiddenReason) return;
      mountStateRef.current = hiddenReason;
      if (visible) reportHeartbeat("mount", { status: "ok" });
      else reportHeartbeat("mount", { status: "error", error: hiddenReason });
    }, [visible, count, available, store, state && state.status]);

    /**
     * 流体皮肤引擎的生命周期（hooks 规则：必须在任何早退 return null 之前）。
     *
     * 只在「皮肤是 fluid」且「面板展开」时才启动 rAF；其余情况 effect 直接返回 undefined，
     * 而 React 会先把上一轮的清理函数（mountFluid 返回的 stop）跑掉 ——
     * stop 负责 cancelAnimationFrame + 摘 resize 监听 + 断 ResizeObserver + 清空画布。
     *
     * 依赖只有这两项：面板收起时 canvas 根本不在树上（不需要更多条件，
     * 也不该把 canvas 节点本身放进依赖 —— 那会让每次重渲染都重启引擎）。
     */
    var activeSkin = skinOf(prefs);
    // 有粒子引擎的皮肤。chrome 不在这里 —— 液态金属没有粒子，铺上就把"金属"变成"雾"。
    // nebula 也不在：它试过，退回了 CSS 渐变（原因见 FLUID_SKINS 那段注释）。
    var particleSkin = activeSkin === "fluid" || activeSkin === "holo";
    useEffect(function () {
      if (!particleSkin || !open) return undefined;
      var canvas = fluidCanvasRef.current;
      var node = railRef.current;
      if (!canvas || !node) return undefined;
      // mountFluid 自己吞掉所有启动异常：拿不到上下文 / 环境不对就返回 noop
      return mountFluid(canvas, node, fluidPctRef, lastTopIndexRef, activeSkin);
    }, [activeSkin, open]);

    // 只有子代理会话不显示（这是设计）。其它情况一律渲染出控件 ——
    // 真实 ModelDirectory 的 store 首帧就是 { current: null, groups: [], status: "idle" }，
    // 旧实现用「count<2 就整体 return null」把首帧时序变成了"永远不出现"的风险（实测踩过）。
    if (!available) return null;

    // 显示档位的兜底链固定三条：合法 draft → 合法 committed → 最后一档。
    // draft / committed 都只把 -1 当「没有有效档位」，不存在拿负数当哨兵去驱动流程的写法
    // （旧版 onRailUp 里的 setDraft(-1) 会让 shown 先回落到 committed，读数瞬间跳错一档）。
    var draftOk = draft >= 0 && draft < levelCount;
    var committedOk = committed >= 0 && committed < levelCount;
    var shown = draftOk ? draft : (committedOk ? committed : levelCount - 1);
    // pct 的分母是**展示档位数 - 1**（契约：index / (LEVELS.length - 1)）：
    // 5 个真实档位 + ULTRA = 6 格 → 0, 0.2, 0.4, 0.6, 0.8, 1.0。
    var ratio = levelCount > 1 ? shown / (levelCount - 1) : 1;
    var pct = ratio * 100;
    // 把同一个进度数值喂给流体引擎（0~1）。放在渲染体里赋值：提交后引擎读到的
    // 一定是最新进度，不必额外排一次 effect，也不会漏掉「拖动中」的中间值。
    fluidPctRef.current = ratio;
    // ★ 顶格判据的索引（= 真实档位数 - 1）：MAX 在这一格，ULTRA 在它右边一格，
    //   两格都算顶格（见 isTopPct）。用 ref 交给 rAF 里的引擎 —— 引擎不该被
    //   React 重渲染重启，所以走 ref 而不是闭包/依赖。
    lastTopIndexRef.current = realEffortCount - 1;
    var current = levels[shown];
    // store 未就绪时的可见占位：控件照常出现（不再整体隐身），面板显示"正在读取档位"
    var loading = !store || count < 2;
    var currentName = loading ? "…" : effortName(current, shown, levelCount);
    // ULTRA 态：最后一格（真实档位之外的那一格）。别用 pct 判 —— 那是比例，会被分母骗。
    var isUltra = !loading && realEffortCount > 0 && shown === realEffortCount;
    // 策略 chip 的展开态：**没策略就永远不展开**（不可展开，见下面 .es-policy 的渲染）
    var policyOpenNow = !!(policy && policyOpen);

    function indexFromClientX(clientX) {
      var node = railRef.current;
      if (!node) return shown;
      var rect = node.getBoundingClientRect();
      if (rect.width <= 0) return shown;
      var inner = Math.max(1, rect.width - 34);
      var raw = (clientX - rect.left - 17) / inner;
      // 刻度按**展示档位**分布（含 ULTRA），所以这里也用 levelCount
      return Math.round(Math.min(1, Math.max(0, raw)) * (levelCount - 1));
    }

    /**
     * ② 吸附动画的时长：与**移动距离**成正比（速度恒定），不再用固定时长。
     *
     * 常数来由（实测，别凭感觉改）：
     *   · 原来插件走 CSS 的 `[data-snap="1"] .es-knob{transition:left .32s cubic-bezier(...)}`，
     *     满量程（W-34 ≈ 324px）实测 ≈ 320ms → 约 1.0 px/ms。用户要"降到一半" →
     *     0.5 px/ms → **SNAP_MS_PER_PX = 2.0**（满量程 ≈ 640ms）。
     *   · 这个常数两份拷贝共用（预览页 / 插件），否则同一档位在两处的节奏会不一样。
     * 用内联 transition-duration 覆盖 CSS 里的 .32s：内联优先级最高，但**只覆盖时长**，
     * 弹性曲线仍然来自 CSS。拖拽（onRailDown）会把内联时长清掉 → 还是短的跟手过渡。
     */
    var SNAP_MS_PER_PX = 2.0;
    var SNAP_MS_MIN = 120;
    var SNAP_MS_MAX = 900;
    function armSnapDuration(targetIndex) {
      var knob = knobRef.current;
      var railNode = railRef.current;
      if (!knob || !knob.style || !railNode || typeof railNode.getBoundingClientRect !== "function") return;
      if (typeof knob.getBoundingClientRect !== "function") return;
      try {
        var rect = railNode.getBoundingClientRect();
        if (!(rect.width > 0)) return;
        var kr = knob.getBoundingClientRect();
        if (!(kr.width > 0)) return;
        var from = kr.left + kr.width / 2 - rect.left;
        var travel = Math.max(1, rect.width - 34);
        // 刻度按展示档位分布（含 ULTRA），目标位置也必须用 levelCount 算
        var to = 17 + travel * (levelCount > 1 ? targetIndex / (levelCount - 1) : 1);
        var ms = SNAP_MS_PER_PX * Math.abs(to - from);
        ms = Math.max(SNAP_MS_MIN, Math.min(SNAP_MS_MAX, ms));
        knob.style.transitionDuration = ms.toFixed(0) + "ms";
      } catch (error) { /* 拿不到几何：退回 CSS 里的固定时长，不抛出去 */ }
    }
    /** 拖拽路径：清掉吸附留下的内联时长，让 CSS 的 .07s 跟手过渡重新生效。 */
    function clearSnapDuration() {
      var knob = knobRef.current;
      if (knob && knob.style) knob.style.transitionDuration = "";
    }

    /**
     * 唯一写入口。
     * 守卫顺序是有意的，不能调换：
     *   1) 下标必须是 number 且落在 [0, levelCount) —— NaN / undefined / 越界一律原地返回；
     *   2) levels[nextIndex] 必须是有非空字符串 id 的对象 —— 脏数据同样原地返回，
     *      绝不让 target.id 取值抛出去；
     *   3) 之后才轮到「目标档位就是已提交档位 → 早退」。这条不能提到最前：
     *      上一次提交还没落地的窗口里，它会把合法提交一起吞掉。
     *
     * ★ ULTRA 的提交语义（契约 §2 / 需求 A）：
     *   · reasoningEffort 永远写**真实档位**的 id —— 选中 ULTRA 时写最后一档（MAX）的 id，
     *     因为"ULTRA"根本不是模型目录里的档位，写进去只会被目录拒掉。
     *   · 同时把 `ultra: true/false` 单独推给宿主（turbo 路由），由宿主去注入策略。
     *   · 推 ULTRA 位是 fail-open 的旁路：它失败**不**回滚档位（回了反而更糟：
     *     模型档位明明写成功了却给用户报失败）。
     */
    function next(nextIndex, fromDrag) {
      if (typeof nextIndex !== "number" || !(nextIndex >= 0) || nextIndex >= levelCount) return;
      var target = levels[nextIndex];
      if (!target || typeof target.id !== "string" || target.id === "") return;
      if (!effort || !effort.selection) return;
      var scope = turboScope;
      var generation = scope.generation;
      var operation = ++scope.commitVersion;
      scope.mutationVersion += 1;
      scope.ultraVersion += 1;
      if (scope.selection) scope.selection.cancel();
      function currentCommit() { return turboCurrent(scope, generation) && operation === scope.commitVersion; }
      // ULTRA 提交语义：ULTRA 只是展示层的最后一格，写进模型目录的必须是最后一个
      // **真实** effort 的 id（也就是 MAX 的值）；ULTRA 位另走 turbo 路由推给宿主。
      var wantUltra = nextIndex > realEffortCount - 1;
      var effortTarget = wantUltra ? efforts[realEffortCount - 1] : target;
      if (!effortTarget || typeof effortTarget.id !== "string" || effortTarget.id === "") return;

      /** 把 ULTRA 位推给宿主。去重后只发变化；任何失败都吞掉（旁路信息，不影响档位）。 */
      var pushUltra = function () {
        if (!currentCommit()) return;
        if (ultraSentRef.current === wantUltra) return;
        ultraSentRef.current = wantUltra;
        try {
          turboPatch({ ultra: wantUltra }).then(noop, function () {
            // 推送失败：把去重标记回退，下一次换档会重新尝试（不回滚档位）
            if (currentCommit() && ultraSentRef.current === wantUltra) ultraSentRef.current = null;
          });
        } catch (error) { if (currentCommit()) ultraSentRef.current = null; }
      };
      pushUltraRef.current = pushUltra;

      if (nextIndex === committed) {
        setBusy(false);
        setFailed(false);
        putDraft(committed);
        // 没换档（含 ULTRA 位也已同步）：点刻度 / 方向键这类非拖拽路径取消弹回动画即可；
        // 拖拽路径刚由 onRailUp 打开弹回动画（setSnap(true)），这里别把它关掉。
        // ⚠️ 只比下标、**不**比 ultraSentRef：否则「首次点亮 ULTRA」会被误判成"没换档"
        //    而把 ULTRA 位吞掉（committed 是真实档位下标，ULTRA 与 MAX 共用同一个 index 值）。
        if (!fromDrag) setSnap(false);
        if (ultraSentRef.current === wantUltra) return;
        // 档位没变但 ULTRA 位要变（MAX ↔ 宿主侧 ultra=false 的自愈）→ 只推位，不重写目录。
        pushUltraRef.current();
        return;
      }
      // ② 吸附路径（点刻度 / 方向键）：按**移动距离**定时长，让速度恒定。
      //    必须在下面的 putDraft 触发重渲染之前算 —— 那一刻珠子还在旧位置，量到的才是真距离。
      if (!fromDrag) armSnapDuration(nextIndex);
      if (!fromDrag) setSnap(true);
      putDraft(nextIndex);
      setUltraOn(wantUltra);      // 本地表态：之后再来的心跳不再覆盖这一格
      bumpPulse(function (n) { return n + 1; });
      setBusy(true);
      setFailed(false);
      var selection = { finished: false, timer: null, cancel: function () {
        if (selection.finished) return;
        selection.finished = true;
        if (selection.timer !== null) clearTimeout(selection.timer);
        selection.timer = null;
        if (scope.selection === selection) scope.selection = null;
      } };
      scope.selection = selection;
      function finishSelection() {
        if (selection.finished || !currentCommit()) return false;
        selection.cancel();
        return true;
      }
      var rollback = function () {
        if (!currentCommit()) return;
        setBusy(false);
        setFailed(true);
        putDraft(committed);
        if (api && typeof api.notify === "function") api.notify("Failed to switch reasoning effort");
      };
      selection.timer = setTimeout(function () {
        if (finishSelection()) rollback();
      }, MODEL_SELECTION_TIMEOUT_MS);
      try {
        Promise.resolve(commit({
          provider: effort.selection.provider,
          model: effort.selection.model,
          reasoningEffort: effortTarget.id,
        })).then(function (ok) {
          if (!finishSelection()) return;
          setBusy(false);
          if (!ok) { rollback(); return; }
          pushUltra();                     // 档位写成功了才动宿主状态，避免"档位没切成、策略却注入了"
        }, function () { if (finishSelection()) rollback(); });
      } catch (error) {
        // commit 同步抛（目录被销毁之类）：走同一条回滚路径，绝不冒泡成未处理异常
        if (finishSelection()) rollback();
      }
    }

    function onRailDown(event) {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = true;
      setSnap(false);
      // ② 拖拽路径：清掉吸附留下的内联时长 → 回到 CSS 的 .07s 跟手过渡（拖起来不黏）
      clearSnapDuration();
      if (railRef.current && railRef.current.setPointerCapture) {
        try { railRef.current.setPointerCapture(event.pointerId); } catch (error) { /* 忽略 */ }
      }
      var at = indexFromClientX(event.clientX);
      // 和 ref 比而不是和这一帧的 draft 比：拖拽时同一帧内可能连来多个 pointer 事件
      if (at !== draftRef.current) { putDraft(at); bumpPulse(function (n) { return n + 1; }); }
    }
    function onRailMove(event) {
      if (!draggingRef.current) return;
      var at = indexFromClientX(event.clientX);
      if (at !== draftRef.current) { putDraft(at); bumpPulse(function (n) { return n + 1; }); }
    }
    function onRailUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      // ② 松手落位也是吸附：按**离目标刻度的距离**定时长（真拖拽时珠子已经跟到目标附近，
      //    距离≈0 就退化成 120ms 的最小值；但如果这次拖动是被"按下即松手"一步跳到位，
      //    距离就是整段——这一条同时保住了无头测试用 props 直调时的真实路径）。
      var target0 = draftRef.current;
      // ⚠️ 边界必须是 **levelCount（展示档位数）**，不是 count（真实档位数）。
      //    这是 2026-10 用户报的那个真 bug 的根因：「切换到 Ultra 时没有自动切换到
      //    max 推理」。ULTRA 的下标恰好等于 count（第 6 格 = 5），旧写法
      //    `target < count` 于是把它当成越界直接 return —— 拖动松手时**什么都不提交**，
      //    而 draft 已经搬到第 6 格了，所以界面显示 ULTRA、实际推理等级留在原处。
      //    （点刻度 / 方向键走的是 next(index)，那条路本来就按 levelCount 守卫，
      //      所以只有"拖到最右再松手"这一条路径会静默失败 —— 恰恰是人的主用法。）
      if (target0 >= 0 && target0 < levelCount) armSnapDuration(target0);
      setSnap(true);          // 松手弹回动画：拖拽提交路径必须保留
      // 提交走显式路径 next(target, true)。
      // 旧版这里是 setDraft(-1) 再 next(target)——那个 -1 哨兵会让 shown 先回落到 committed，
      // 读数瞬间跳到错误档位，现已彻底删除；draft 全程只存合法下标。
      var target = draftRef.current;
      if (!(target >= 0 && target < levelCount)) return;   // 越界/脏数据：原地放弃，不动任何状态
      next(target, true);
    }

    /**
     * 玻璃"接光"：把指针位置写进 CSS 变量 `--es-gx/--es-gy`，高光跟着指针走。
     *
     * 为什么直接写 style 而不进 React state：pointermove 每帧都发，走 setState 的话
     * 会引发重渲染风暴（面板里有 canvas 与 rail）。这里只做一次 style 写入，零重渲染。
     * 用 `event.currentTarget` 定位，所以面板与胶囊可以共用同一个处理函数。
     * 全部包在 try/catch 里：接光失败绝不能影响开合、拖动与提交。
     */
    function glassLight(event) {
      try {
        var el = event && event.currentTarget;
        if (!el || !el.style || typeof el.style.setProperty !== "function") return;
        var rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        var x = ((event.clientX - rect.left) / rect.width) * 100;
        var y = ((event.clientY - rect.top) / rect.height) * 100;
        el.style.setProperty("--es-gx", x.toFixed(2) + "%");
        el.style.setProperty("--es-gy", y.toFixed(2) + "%");
        el.style.setProperty("--es-go", "1");   // 光斑显隐由这个变量控制（不用 :hover：拖动时 pointer capture 会让 hover 不可靠）
      } catch (error) { /* 忽略 */ }
    }
    function glassLightOff(event) {
      try {
        var el = event && event.currentTarget;
        if (!el || !el.style || typeof el.style.removeProperty !== "function") return;
        el.style.removeProperty("--es-gx");
        el.style.removeProperty("--es-gy");
        el.style.removeProperty("--es-go");
      } catch (error) { /* 忽略 */ }
    }

    var core = h("button", {
      type: "button",
      className: "es-pill" + (loading ? " es-pill--loading" : ""),
      "aria-haspopup": "dialog",
      "aria-expanded": open ? "true" : "false",
      // F7：失败不能只留在 console 里 —— data-failed 会让 pill 边框变红（CSS 已有规则），
      // 这里再补上原生 tooltip / 无障碍名，收起态也能看懂「为什么红了」。
      // 加载态也给一句明确文案：能看到控件就说明它没被时序杀死。
      "aria-label": loading ? "Reasoning effort: reading this model's levels" : ("Reasoning effort: " + currentName + (failed ? " (" + FAIL_HINT + ")" : "")),
      title: loading ? "Reasoning effort · reading this model's levels…" : ("Reasoning effort · " + currentName + (failed ? " · " + FAIL_HINT : "")),
      disabled: loading,
      onClick: function (event) { event.stopPropagation(); if (loading) return; setOpen(!open); },
      onPointerDown: function (event) { event.stopPropagation(); },
      // 灵动：胶囊也接光（同一个处理函数，靠 currentTarget 定位）
      onPointerMove: glassLight,
      onPointerLeave: glassLightOff,
    },
      // 用户要求删掉"MAX 左边那颗圆球"（.es-orb：进度环 + 内芯）—— 收起态只剩档位文字。
      // 档位进度仍然由展开后的轨道本体与读数表达；收起态不再有环。
      h("span", { className: "es-pill__name" }, currentName),
      // 收起态**只有档位文字** —— 一行都不许多。
      //   · 用户先后要求删掉 MAX 左边那颗圆球（.es-orb）与 MAX 右边的闪电：
      //     "闪电不应该放这里，应该展开之后才能看到"。
      //   · 所以闪电挪进了展开后的面板（见下面 .es-foot 里的 .es-pill__bolt）。
    );

    // 刻度按**展示档位**（含 ULTRA）分布。
    // ★ 位置必须和旋钮走**同一套几何**：CSS 里 .es-knob / .es-rail__fill / 轨道高光都是
    //   `calc(17px + (100% - 34px) * t)` —— 旋钮中心从 17px 起、到 width-17px 止，
    //   **不是** 0% ~ 100%。旧写法 `t * 100%` 相当于把首尾两格各向外多偏 17px，
    //   标签于是顶到面板左右边缘（用户：「off 和 Ultra 都太靠边了，需要往中间靠一点」）。
    var ticks = levels.map(function (item, index) {
      var ratio = levelCount > 1 ? index / (levelCount - 1) : 0.5;
      var left = levelCount > 1
        ? "calc(17px + (100% - 34px) * " + ratio.toFixed(4) + ")"
        : "50%";
      var ultraTick = !!(item && item.ultra === true);
      // 脏元素（null / 没有 id）不能让整棵子树在渲染期抛出去（那会被错误边界整体隐身）：
      // key 退化成下标，文案交给 effortName 兜底。点它时 next() 的守卫会原地返回。
      return h("span", {
        key: "tick-" + String(item && item.id !== undefined && item.id !== null ? item.id : index),
        className: "es-tick" + (ultraTick ? " es-tick--ultra" : ""),
        "data-on": index === shown ? "1" : "0",
        style: { left: left },
        onClick: function (event) {
          event.stopPropagation();
          next(index);
        },
      }, effortName(item, index, levelCount));
    });

    var gridLines = [];
    for (var g = 1; g < levelCount - 1; g += 1) {
      gridLines.push(h("i", {
        key: "grid-" + String(g),
        style: { left: ((g / (levelCount - 1)) * 100).toFixed(3) + "%" },
      }));
    }

    var skinChips = SKINS.map(function (skin) {
      return h("button", {
        key: skin,
        type: "button",
        className: "es-skin",
        "data-on": skinOf(prefs) === skin ? "1" : "0",
        // 显示名走 SKIN_LABELS：加皮肤时不会因为漏改三目链而显示成键名
        title: skinLabel(skin),
        "aria-label": "Skin: " + skin,
        onClick: function (event) { event.stopPropagation(); preferences.set(skin); },
      });
    });

    var panel = h("div", {
      className: "es-panel",
      role: "dialog",
      "aria-label": "Reasoning effort",
      onPointerDown: function (event) { event.stopPropagation(); },
      // 灵动：玻璃接光。注意拖轨道时 pointermove 会冒泡到这里 —— 正好，光标在哪光就在哪。
      onPointerMove: glassLight,
      onPointerLeave: glassLightOff,
    },
      h("div", { className: "es-head" },
        h("span", { className: "es-title" }, "Reasoning effort"),
        h("span", { className: "es-model" }, effort ? effort.modelName : "Loading…"),
        // ★ 闪电控件：面板**右上角**，脱离文档流。
        //   用户反馈原文：「闪电的位置一直在跳动当拉动滑动条时…闪电应该放到一个角落而不是居中」。
        //   根因：它原来是 `.es-foot` 的第二个 flex 子元素，而那一行是
        //   `justify-content:space-between` —— 拖动滑条时读数文字（"5 / ULTRA" → "3 / HIGH"）
        //   宽度在变，等于每帧给中间元素重新分配空间，于是闪电跟着左右跳。
        //   放进 `.es-head`（本身 position:relative）并绝对定位 → 位置与任何文字宽度无关。
        //   类名仍沿用 `.es-pill__bolt`：CSS 按这个名字写死了方块与发光，
        //   改类名要同时动 CSS 与检查脚本、收益为零。
        h("button", {
          type: "button",
          className: "es-pill__bolt",
          // 形状 = 内联 SVG 描边（见 boltTree() 的注释：旧 clip-path+mask 那套是几何错误）。
          // React 对 `h("svg")` 会自动走 SVG 命名空间；boltTree() 里还有一次命名空间自检。
          ref: boltRef,
          "data-on": lightning ? "1" : "0",
          "aria-pressed": lightning ? "true" : "false",
          "aria-label": "Lightning mode: the parent agent only orchestrates and fans out to subagents",
          title: "Lightning mode: the parent agent only orchestrates and fans out to subagents",
          disabled: loading,
          onClick: toggleLightning,
          onPointerDown: function (event) { event.stopPropagation(); },
        }, boltTree()),
      ),
      h("div", { className: "es-desc" }, failed ? FAIL_HINT : effortDesc(current, shown, levelCount)),
      h("div", { className: "es-railWrap" },
        h("div", {
          className: "es-rail",
          ref: railRef,
          role: "slider",
          tabIndex: 0,
          "aria-valuemin": 1,
          // ★ 档位数含追加的 ULTRA 格（契约：所有"第几格"都用 LEVELS）
          "aria-valuemax": levelCount,
          "aria-valuenow": shown + 1,
          "aria-valuetext": currentName,
          onPointerDown: onRailDown,
          onPointerMove: onRailMove,
          onPointerUp: onRailUp,
          onPointerCancel: onRailUp,
          onKeyDown: function (event) {
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              event.preventDefault();
              next(Math.min(levelCount - 1, shown + 1));
            } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              event.preventDefault();
              next(Math.max(0, shown - 1));
            }
          },
        },
          // 流体皮肤的 canvas：必须是轨道的**第一个**子元素（垫在其它层之下）。
          // 非 fluid 皮肤时它不被启动（引擎根本没跑），可见性由 CSS 决定。
          h("canvas", { className: "es-rail__fluid", "aria-hidden": "true", ref: fluidCanvasRef }),
          // 最高档星光层：**放在流体 canvas 之后**，所以 rail.querySelector('canvas')
          // 仍然返回流体那块 —— 所有验收脚本量的都是流体，别被这一层抢走（很关键）。
          h("canvas", { className: "es-rail__stars", "aria-hidden": "true" }),
          h("div", { className: "es-rail__fx" }),
          h("div", { className: "es-rail__fill" }),
          h("div", { className: "es-rail__grid" }, gridLines),
          h("div", { className: "es-sparks", key: "sparks-" + String(pulse) }),
          // ★ ULTRA 白炽核心层（契约 §4 + CSS 段①）：三层 span 由 CSS 上色/呼吸，
          //   JS 只提供结构（`.es-rail__core span` 是绝对定位层，缺了它们这层就是空盒子）。
          //   必须放在 .es-knob **之前**，且仍然不能插到两块 canvas 前面（验收脚本按
          //   rail.querySelector('canvas') 取流体那块 —— 顺序是硬的）。
          h("div", { className: "es-rail__core", "aria-hidden": "true" },
            h("span", { className: "es-rail__core__glow" }),
            h("span", { className: "es-rail__core__tint" }),
            h("span", { className: "es-rail__core__ember" }),
          ),
          h("div", { className: "es-knob" + (isUltra ? " es-knob--ultra" : ""), ref: knobRef }),
        ),
        h("div", { className: "es-ticks" }, ticks),
      ),
      h("div", { className: "es-foot" },
        h("div", { className: "es-readout" },
          busy
            ? h("span", { className: "es-readout__spinner" })
            : h("span", { className: "es-readout__lvl" }, String(shown + 1)),
          h("span", { className: "es-readout__of" }, "/ " + String(levelCount)),
          h("span", { className: "es-readout__name" + (isUltra ? " es-panel__level--ultra" : "") }, currentName),
        ),
        // ★ 舰队 tok/s 读数：**始终在树里**，靠 data-idle 控制显隐（契约 §4：data-idle="1"
        //   时整块隐藏）。CSS 给 .es-rate 留了 min-width 与等宽数字（tabular-nums），
        //   数字变化不会让 pill 抖一下。rate 是宿主算好的整数 tok/s，
        //   这里只做安全收口（NaN / 负数一律当 0）+ toLocaleString 千分位 ——
        //   **绝不** k/M 缩写（用户明确要求"显示大数字有逼格"）。
        h("div", {
          className: "es-rate",
          "data-idle": rate > 0 ? "0" : "1",
          title: "Fleet token throughput for this session (generation + input)",
        },
          h("span", { className: "es-rate__num" }, rate.toLocaleString("en-US")),
          h("span", { className: "es-rate__unit" }, "tok/s"),
        ),
        h("div", { className: "es-skins" }, skinChips),
      ),
      // ★ 策略 chip **已按用户要求整块删除**（原话：「不需要显示策略」）。
      //   策略正文仍然会**注入到提示词里**（那是功能本体，走宿主 policy.mjs 的 agent/pre-step），
      //   只是界面上不再展示：用户不需要在面板里读一份英文契约。
      //   CSS 里的 `.es-policy*` 规则保留未删 —— 那是"样式表里有、渲染时不用"，
      //   与"渲染出来却永远 display:none"（§3-L 的 .es-rail__core 事故）不是一回事；
      //   删它反而会让 CSS 契约检查（⑥ 选择器齐全）失去锚点，收益为零。
      // 扁进度指示条（.es-energy）与收起态圆球（.es-orb*）也都已按用户要求删除：
      // 档位进度只由轨道本体 + 面板读数（es-readout）两处表达。
    );

    var rootProps = {
      className: "es-root",
      "data-effort-slider": PACKAGE_ID,
      // 兜底：无论偏好读取是否正常，data-skin 一定有值 —— 否则三套皮肤样式全不匹配，
      // 控件只剩一层几乎看不见的白环（实测就是这个现象）。
      "data-skin": skinOf(prefs),
      "data-open": open ? "1" : "0",
      "data-snap": snap ? "1" : "0",
      "data-busy": busy ? "1" : "0",
      "data-failed": failed ? "1" : "0",
      ref: rootRef,
      style: { "--pct": pct.toFixed(3) + "%", "--ratio": ratio.toFixed(4) },
    };
    // ★ 根状态（契约 §4）：ULTRA 时才有 data-ultra="1"；闪电开启时才有 data-lightning="1"。
    //   用条件赋值而不是 `{...cond && {...}}` / 对象展开 —— 后者要 Babel 的
    //   object-rest-spread 插件，宿主加载器不做转译，老引擎上会直接语法错。
    if (isUltra) rootProps["data-ultra"] = "1";
    if (lightning) rootProps["data-lightning"] = "1";
    return h("div", rootProps, open ? panel : null, core);
  }

  /**
   * 错误边界：本控件任何渲染异常都只让自己隐身，绝不把异常冒泡到宿主，
   * 更不会让整个界面卡住（第一版就是因为无限重渲染把渲染进程拖死的）。
   * 类在 apply() 注入 React 之后才创建，因此模块顶层不需要 React。
   */
  var BoundaryClass = null;
  function boundary() {
    if (BoundaryClass !== null) return BoundaryClass;
    BoundaryClass = class EffortSliderBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false };
      }
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        // 阶段 5（失败分支）：执行到了但渲染失败 —— 必须显式报 error，
        // 否则宿主会把它当成"mount 已达成"，与「根本没执行」区分不开
        reportHeartbeat("mount", {
          status: "error",
          error: String(error && error.message ? error.message : error),
        });
        console.error("[effort-slider] 渲染异常，控件已隐身：", error);
      }
      render() {
        if (this.state.failed) return null;
        return React.createElement("div", { className: "es-root", "data-effort-slider": PACKAGE_ID },
          React.createElement(EffortSlider, this.props));
      }
    };
    return BoundaryClass;
  }

  /* ────────────────────────── 皮肤偏好 ────────────────────────── */

  function createPreferences(api) {
    var initial = api.cachedSkin();
    // 已下线的皮肤（例如 localStorage 里还缓存着 nebula）在这里被归一化成默认皮肤，
    // 否则会渲染出一个已经不在 SKINS 里的皮肤。
    if (SKINS.indexOf(initial) < 0) initial = DEFAULT_SKIN;
    var skin = initial;
    var snapshot = { skin: skin };
    var listeners = new Set();
    // R6：用户是否已经手动改过皮肤。fetchSkin() 是异步的，若用户在远端值回来之前就点了皮肤，
    // 那个「远端初始值」不允许再覆盖用户的选择（否则点了也没用，观感回跳）。
    var touched = false;
    function emit() {
      listeners.forEach(function (listener) {
        try { listener(); } catch (error) { /* 单个订阅者出错不影响其他 */ }
      });
    }
    function setSkin(next, persist) {
      if (SKINS.indexOf(next) < 0 || next === skin) return;
      skin = next;
      snapshot = { skin: skin };
      api.cacheSkin(skin);
      emit();
      if (persist) {
        // 持久化失败不影响当前观感；连同步抛也要吞掉（不能连累点击事件）
        try { api.saveSkin(skin); } catch (error) { /* 忽略 */ }
      }
    }
    try {
      api.fetchSkin().then(function (remote) {
        if (touched) return;   // 用户已手动选过：本地选择优先，远端初始值作废
        setSkin(remote, false);
      }, function () { /* 端点不可用时沿用本地值 */ });
    } catch (error) {
      // fetchSkin 同步抛（fetch 不可用之类）：偏好退回「只在页面本地记住」
      console.warn("[effort-slider] 皮肤偏好同步失败：" + String(error));
    }

    return {
      // 同一个 skin 永远返回同一个对象：useSyncExternalStore 依赖引用比较
      getSnapshot: function () { return snapshot; },
      subscribe: function (listener) {
        listeners.add(listener);
        return function () { listeners.delete(listener); };
      },
      set: function (next) {
        touched = true;
        setSkin(next, true);
      },
    };
  }

  /* ────────────────────────── 样式与接入 ────────────────────────── */

  var CSS = "/* dsh-effort-slider — 组件样式\n   设计要点：全部变量作用在 .es-root 内，不污染宿主；四套皮肤由 [data-skin] 切换；\n   收起态是一枚发光核心（环上刻着当前档位），展开态是悬浮能量条。 */\n\n.es-root{position:relative;display:flex;align-items:center;font-family:inherit}\n\n/* ── 收起态：档位文字（圆球已按用户要求删除）───────────────── */\n.es-pill{\n  -webkit-appearance:none;appearance:none;margin:0;cursor:pointer;position:relative;\n  display:flex;align-items:center;gap:8px;height:32px;padding:0 12px;border-radius:999px;\n  background:transparent;border:1px solid rgba(255,255,255,.14);color:var(--dsw-alias-label-primary,#e4edf4);\n  font:inherit;transition:transform .2s cubic-bezier(.22,1.1,.36,1),box-shadow .25s,border-color .25s;\n}\n.es-pill:hover{transform:translateY(-1px)}\n.es-pill:active{transform:translateY(0) scale(.985)}\n.es-pill__name{font-size:12.5px;font-weight:600;white-space:nowrap;letter-spacing:.01em}\n/* 用户：「删除展开按钮旁边、对话框里 MAX 旁边的 UI」= 收起态胶囊里那颗带进度环的圆球。\n   所以 .es-orb / __ring / __core 三组规则**已删除**，胶囊现在只有档位文字一个子元素\n   （内边距也从 0 11px 0 7px 改成对称的 0 12px —— 旧值是在给左边的圆球留位）。\n   收起态不再有进度环；档位进度由**展开后**的轨道本体与读数表达。 */\n\n/* ── 最高档星光层 ────────────────────────────────────────────\n   单独一块 canvas 叠在流体之上，星星往**左**流（与流体反向）。\n   基础规则 display:none，只有流体皮肤打开（与 .es-rail__fluid 同一套条件）。\n   ⚠️ 它在 DOM 里排在 .es-rail__fluid **之后**：所有验收脚本用\n   `rail.querySelector('canvas')` 取\"流体那块\"，顺序不能反。 */\n.es-rail__stars{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none;border-radius:inherit}\n[data-effort-slider][data-skin=\"fluid\"] .es-rail__stars{display:block}\n\n/* ── 展开态：悬浮能量条 ─────────────────────────────────── */\n.es-panel{\n  position:absolute;bottom:calc(100% + 10px);right:0;width:392px;max-width:calc(100vw - 32px);\n  z-index:60;display:flex;flex-direction:column;gap:9px;padding:14px 16px;border-radius:20px;\n  transform-origin:calc(100% - 30px) calc(100% + 10px);\n  animation:es-in .34s cubic-bezier(.16,1.02,.28,1.02) both;\n}\n@keyframes es-in{\n  from{opacity:0;transform:translateY(12px) scale(.72,.9)}\n  to{opacity:1;transform:none}\n}\n.es-head{display:flex;align-items:center;justify-content:space-between;gap:10px;position:relative;z-index:1}\n.es-title{font-size:13.5px;font-weight:650;letter-spacing:.02em}\n.es-model{\n  font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;opacity:.55;\n  max-width:56%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\n}\n.es-desc{position:relative;z-index:1;font-size:12.5px;opacity:.72;margin-top:-3px;\n  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.es-railWrap{position:relative;z-index:1}\n.es-rail{\n  position:relative;height:30px;border-radius:999px;overflow:hidden;isolation:isolate;\n  cursor:ew-resize;touch-action:none;outline:none;\n}\n.es-rail:focus-visible{box-shadow:0 0 0 2px var(--es-focus,rgba(55,224,216,.6))}\n.es-rail__fx{position:absolute;inset:0;pointer-events:none}\n/* 皮肤 D（流体）的 canvas 图层：流体视觉 100% 由它承担。\n   默认 display:none —— 只有 [data-skin=\"fluid\"] 才打开（见\"皮肤 D\"段的 display:block），\n   其它皮肤下它不占位、不绘制。border-radius:inherit 让画布跟着轨道圆角裁切。 */\n.es-rail__fluid{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:inherit;display:none}\n/* 填充从**轨道左边缘**起算、一直画到珠子中心（珠子中心 = 17px + (W-34px)·pct）。\n   旧写法 left:17px + width:(W-34px)·pct 会让最低档时左端露出 17px 空档（实机可见的 bug）。 */\n.es-rail__fill{position:absolute;top:0;bottom:0;left:0;width:calc(17px + (100% - 34px) * var(--pct) / 100%);border-radius:999px}\n.es-rail__grid{position:absolute;inset:0;pointer-events:none}\n.es-rail__grid i{position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,.13);transform:translateX(-.5px)}\n.es-sparks{position:absolute;inset:0;pointer-events:none;overflow:hidden;border-radius:inherit}\n/* 吸附脉冲环：环体与它的辉光都必须\"夹\"在轨道内。\n   关键是**动画的终态**：旧写法在别的皮肤上把 scale 拉到 2.9，26px 的环会变成 75px，\n   而轨道只有 30px 高 —— .es-sparks 的 overflow:hidden + border-radius 会把超出部分\n   裁成一块贴着圆角的\"白色半圆\"，再配上 opacity → 0，看起来就是\"残影、还会慢慢消失\"。\n   这里锁死：24px × 1.05 = 25.2px ≤ 30px，辉光也从 18px 收到 10px。 */\n.es-sparks::before{\n  content:\"\";position:absolute;top:50%;left:calc(17px + (100% - 34px) * var(--pct) / 100%);\n  width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:999px;\n  border:1px solid currentColor;box-shadow:0 0 10px currentColor;\n  animation:es-ring .62s cubic-bezier(.2,.7,.3,1) both;\n}\n@keyframes es-ring{from{transform:scale(.6);opacity:.85}to{transform:scale(1.05);opacity:0}}\n.es-knob{\n  position:absolute;top:50%;left:calc(17px + (100% - 34px) * var(--pct) / 100%);\n  z-index:2;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:999px;\n  transition:left .07s linear;will-change:left;\n}\n.es-knob::after{\n  content:\"\";position:absolute;left:18%;right:18%;top:11%;height:26%;border-radius:999px;\n  background:linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,0));opacity:.8;\n}\n/* 吸附动画（点刻度 / 方向键 / 松手落位）：\n   · 时长不再写死 —— 组件按**移动距离**往珠子上写内联 transition-duration\n     （= SNAP_MS_PER_PX × |Δpx|，2.0ms/px，clamp [120,900]），速度恒定；\n     这里只保留弹性曲线，同时作为\"拿不到几何\"时的固定 .32s 兜底。\n   · 过冲量从 1.45 收到 1.38（曲线上限 ≈1.046 倍行程）：1.45 时满量程实测珠子冲到\n     x=362.4，而轨道/画布只有 358 宽 —— 流体画不到画布外，判据\n     \"|珠子中心-流体右边界| ≤ 4px\"就在过冲那 ~100ms 里被顶破（实测 5.4px）。\n     1.38 时峰值 ≈356（行程 324），回弹照旧可见，全程贴合。 */\n.es-root[data-snap=\"1\"] .es-knob{transition:left .32s cubic-bezier(.2,1.38,.4,1)}\n.es-ticks{position:relative;height:16px;margin-top:4px}\n.es-tick{\n  position:absolute;top:0;transform:translateX(-50%);cursor:pointer;user-select:none;\n  font-size:10.5px;line-height:16px;white-space:nowrap;opacity:.6;transition:opacity .2s,color .2s,text-shadow .2s;\n}\n.es-tick[data-on=\"1\"]{font-weight:700;opacity:1}\n.es-foot{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:2px}\n.es-readout{display:flex;align-items:baseline;gap:7px;min-height:24px}\n.es-readout__lvl{font-size:24px;font-weight:750;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}\n.es-readout__of{font-size:11.5px;opacity:.5}\n.es-readout__name{font-size:13px;font-weight:650}\n.es-readout__spinner{width:16px;height:16px;border-radius:999px;border:2px solid currentColor;border-top-color:transparent;\n  animation:es-spin .7s linear infinite;opacity:.8}\n@keyframes es-spin{to{transform:rotate(360deg)}}\n.es-skins{display:flex;align-items:center;gap:6px}\n.es-skin{\n  -webkit-appearance:none;appearance:none;cursor:pointer;width:20px;height:20px;padding:0;border-radius:999px;\n  border:1px solid rgba(255,255,255,.22);background:transparent;position:relative;transition:transform .2s,border-color .2s;\n}\n.es-skin:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.5)}\n.es-skin[data-on=\"1\"]{border-color:currentColor;box-shadow:0 0 0 2px rgba(255,255,255,.12),0 0 10px currentColor}\n.es-skin::after{content:\"\";position:absolute;inset:3px;border-radius:999px;background:currentColor;opacity:.85}\n/* 扁进度指示条（.es-energy）已删除：与轨道填充重复。档位由轨道 + 读数 + 收起态环表达。 */\n.es-root[data-busy=\"1\"] .es-rail{cursor:progress}\n.es-root[data-failed=\"1\"] .es-pill{border-color:var(--dsw-alias-state-error-primary,#e43c3c)}\n\n/* ── 皮肤 A：星际星云 ────────────────────────────────────── */\n[data-effort-slider][data-skin=\"nebula\"]{--es-ring-on:#37e0d8;--es-focus:rgba(55,224,216,.65);color:#b8f2ec}\n[data-effort-slider][data-skin=\"nebula\"] .es-pill{background:linear-gradient(180deg,#18202a,#0b0f15);\n  box-shadow:0 6px 20px rgba(4,8,12,.5),0 0 0 1px rgba(120,200,210,.08) inset}\n[data-effort-slider][data-skin=\"nebula\"] .es-pill:hover{border-color:rgba(55,224,216,.5);box-shadow:0 8px 26px rgba(55,224,216,.3)}\n[data-effort-slider][data-skin=\"nebula\"] .es-panel{border:1px solid rgba(120,200,210,.22);\n  background:radial-gradient(140% 130% at 10% 0%,#1a2630 0%,#131b23 44%,#0b0f15 100%);\n  box-shadow:0 28px 64px rgba(4,8,12,.72),0 0 0 1px rgba(255,255,255,.03) inset,0 0 40px rgba(55,224,216,.18)}\n[data-effort-slider][data-skin=\"nebula\"] .es-panel::before{content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;\n  background-image:\n    radial-gradient(1.4px 1.4px at 10% 24%,#fff 50%,transparent),\n    radial-gradient(1.2px 1.2px at 27% 72%,#cff6f3 50%,transparent),\n    radial-gradient(1.6px 1.6px at 43% 30%,#fff 50%,transparent),\n    radial-gradient(1.1px 1.1px at 58% 82%,#b9eae7 50%,transparent),\n    radial-gradient(1.5px 1.5px at 72% 20%,#fff 50%,transparent),\n    radial-gradient(1.1px 1.1px at 88% 62%,#d7f7f4 50%,transparent),\n    radial-gradient(1.3px 1.3px at 95% 38%,#fff 50%,transparent);\n  animation:es-twinkle 3.8s ease-in-out infinite}\n@keyframes es-twinkle{0%,100%{opacity:.42}50%{opacity:1}}\n[data-effort-slider][data-skin=\"nebula\"] .es-rail{background:linear-gradient(180deg,#080c12,#151d26);\n  box-shadow:0 0 0 1px rgba(80,232,224,.36) inset,0 0 22px rgba(55,224,216,.14) inset,0 5px 16px rgba(4,8,12,.7) inset,0 1px 0 rgba(120,220,224,.18)}\n[data-effort-slider][data-skin=\"nebula\"] .es-rail__fx{background:\n  radial-gradient(58% 130% at 16% 50%,rgba(55,224,216,.42),transparent 70%),\n  radial-gradient(54% 130% at 76% 50%,rgba(55,224,216,.34),transparent 70%),\n  linear-gradient(180deg,rgba(255,255,255,.10),transparent 42%,rgba(4,8,12,.32))}\n[data-effort-slider][data-skin=\"nebula\"] .es-rail__fill{\n  background:linear-gradient(180deg,#37e0d8 0%,#2fbfb8 34%,#37e0d8 72%,#1d7d78 100%);\n  box-shadow:0 0 16px rgba(55,224,216,.7),0 0 36px rgba(55,224,216,.42)}\n/* 扫光必须屏蔽两端圆头：旧写法把白色渐变扫过 border-radius:999px 的圆头，\n   走到右端时被弧线裁出一块白色区域 —— 用户反馈的\"最右端白色半圆 + 拖影\"。\n   mask 让它离两端 20px 就淡出，永远画不进圆头。 */\n[data-effort-slider][data-skin=\"nebula\"] .es-rail__fill::after{content:\"\";position:absolute;inset:0;border-radius:inherit;\n  background:linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent);\n  background-size:34% 100%;background-repeat:no-repeat;animation:es-flow 2.4s linear infinite;\n  -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 20px,#000 calc(100% - 20px),transparent 100%);\n  mask-image:linear-gradient(90deg,transparent 0,#000 20px,#000 calc(100% - 20px),transparent 100%)}\n@keyframes es-flow{from{background-position:-45% 0}to{background-position:145% 0}}\n[data-effort-slider][data-skin=\"nebula\"] .es-knob{background:\n  radial-gradient(circle at 36% 28%,#fff 0 26%,#f2fbfa 46%,#c3eeea 72%,#3ec9c2 100%);\n  box-shadow:0 0 0 1px rgba(255,255,255,.75),0 0 14px rgba(255,255,255,.75),0 0 34px rgba(48,214,208,.85),0 2px 8px rgba(4,8,12,.5)}\n[data-effort-slider][data-skin=\"nebula\"] .es-tick[data-on=\"1\"]{color:#eafaf7;text-shadow:0 0 10px rgba(55,224,216,.9)}\n[data-effort-slider][data-skin=\"nebula\"] .es-readout__lvl{background:linear-gradient(180deg,#fff,#8feee6);-webkit-background-clip:text;background-clip:text;color:transparent}\n\n/* ── 皮肤 B：全息能量 ────────────────────────────────────── */\n[data-effort-slider][data-skin=\"holo\"]{--es-ring-on:#37e0d8;--es-focus:rgba(55,224,216,.7);color:#6ff0e6}\n[data-effort-slider][data-skin=\"holo\"] .es-pill{background:linear-gradient(180deg,#10303a,#08171e);\n  border-color:rgba(55,224,216,.42);box-shadow:0 6px 20px rgba(4,8,12,.5),0 0 14px rgba(55,224,216,.16)}\n[data-effort-slider][data-skin=\"holo\"] .es-pill:hover{border-color:rgba(55,224,216,.9);box-shadow:0 0 24px rgba(55,224,216,.4)}\n[data-effort-slider][data-skin=\"holo\"] .es-panel{border:1px solid rgba(55,224,216,.34);\n  background:linear-gradient(180deg,#0e1c22,#08131a 94%);\n  box-shadow:0 28px 64px rgba(4,8,12,.76),0 0 40px rgba(55,224,216,.18)}\n[data-effort-slider][data-skin=\"holo\"] .es-panel::before{content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:.5;\n  background:repeating-linear-gradient(180deg,rgba(55,224,216,.07) 0 1px,transparent 1px 4px)}\n[data-effort-slider][data-skin=\"holo\"] .es-panel::after{content:\"\";position:absolute;left:14px;right:14px;top:0;height:1px;\n  background:linear-gradient(90deg,transparent,rgba(120,240,236,.9),transparent)}\n[data-effort-slider][data-skin=\"holo\"] .es-rail{border-radius:9px;background:linear-gradient(180deg,#061016,#0e2830);\n  box-shadow:0 0 0 1px rgba(120,200,210,.55) inset,0 0 22px rgba(55,224,216,.22) inset,0 5px 14px rgba(4,8,12,.7) inset}\n[data-effort-slider][data-skin=\"holo\"] .es-rail__fill{border-radius:9px;\n  background:linear-gradient(180deg,#a9ffff 0%,#35e6e6 32%,#12b3bf 68%,#0a6f7c 100%);\n  box-shadow:0 0 20px rgba(55,224,216,.85)}\n[data-effort-slider][data-skin=\"holo\"] .es-rail__fill::after{content:\"\";position:absolute;inset:0;border-radius:inherit;\n  background:repeating-linear-gradient(90deg,rgba(2,32,38,.42) 0 1px,transparent 1px 11px);\n  animation:es-scan 1.1s linear infinite;opacity:.75}\n@keyframes es-scan{from{background-position:0 0}to{background-position:11px 0}}\n[data-effort-slider][data-skin=\"holo\"] .es-rail__fx{background:\n  linear-gradient(90deg,transparent,rgba(55,224,216,.10) 50%,transparent),\n  linear-gradient(180deg,rgba(255,255,255,.09),transparent 42%,rgba(4,8,12,.4))}\n[data-effort-slider][data-skin=\"holo\"] .es-knob{border-radius:9px;\n  background:linear-gradient(180deg,#fff,#5eeae0 46%,#0f8f96);\n  box-shadow:0 0 0 1px rgba(255,255,255,.7),0 0 20px rgba(120,240,236,.95),0 0 38px rgba(55,224,216,.6)}\n[data-effort-slider][data-skin=\"holo\"] .es-tick[data-on=\"1\"]{color:#d8fbf7;text-shadow:0 0 10px rgba(55,224,216,.95)}\n[data-effort-slider][data-skin=\"holo\"] .es-title{color:#d8fbf7;text-shadow:0 0 10px rgba(55,224,216,.5)}\n[data-effort-slider][data-skin=\"holo\"] .es-readout__lvl{color:#d8fbf7;text-shadow:0 0 14px rgba(55,224,216,.6)}\n\n/* ── 皮肤 C：液态金属 ────────────────────────────────────── */\n[data-effort-slider][data-skin=\"chrome\"]{--es-ring-on:#eafaf7;--es-focus:rgba(214,248,245,.7);color:#d5e6e6}\n[data-effort-slider][data-skin=\"chrome\"] .es-pill{background:linear-gradient(180deg,#2b333b,#171c22);\n  border-color:rgba(255,255,255,.22);box-shadow:0 6px 20px rgba(4,8,12,.5),0 1px 0 rgba(255,255,255,.2) inset}\n[data-effort-slider][data-skin=\"chrome\"] .es-pill:hover{border-color:rgba(255,255,255,.5);box-shadow:0 8px 24px rgba(150,225,224,.22)}\n[data-effort-slider][data-skin=\"chrome\"] .es-panel{border:1px solid rgba(255,255,255,.2);\n  background:linear-gradient(168deg,#2b333b,#1a2027 60%,#10151a);\n  box-shadow:0 30px 66px rgba(4,8,12,.74),0 1px 0 rgba(255,255,255,.2) inset}\n[data-effort-slider][data-skin=\"chrome\"] .es-rail{background:linear-gradient(180deg,#20272e,#0b0f14);\n  box-shadow:0 0 0 1px rgba(255,255,255,.22) inset,0 1px 0 rgba(255,255,255,.14) inset,0 6px 16px rgba(4,8,12,.75) inset}\n[data-effort-slider][data-skin=\"chrome\"] .es-rail__fx{background:linear-gradient(180deg,rgba(255,255,255,.12),transparent 44%,rgba(4,8,12,.42))}\n[data-effort-slider][data-skin=\"chrome\"] .es-rail__fill{\n  background:linear-gradient(180deg,#ffffff 0%,#e2efee 26%,#aabfbe 58%,#6c7d7c 100%);\n  box-shadow:0 0 14px rgba(200,246,242,.35)}\n[data-effort-slider][data-skin=\"chrome\"] .es-knob{background:\n  radial-gradient(circle at 32% 24%,#fff 0 22%,#f0faf9 42%,#c2dedb 66%,#7d9a99 88%,#464f4e);\n  box-shadow:0 0 0 1px rgba(255,255,255,.6),0 2px 8px rgba(4,8,12,.6),0 9px 18px rgba(4,8,12,.42)}\n[data-effort-slider][data-skin=\"chrome\"] .es-knob::before{content:\"\";position:absolute;inset:1px;border-radius:999px;overflow:hidden;\n  background:conic-gradient(from 140deg,rgba(255,255,255,.9),transparent 32%,rgba(255,255,255,.6) 62%,transparent 82%);\n  opacity:.45;animation:es-spin 6s linear infinite}\n[data-effort-slider][data-skin=\"chrome\"] .es-knob::after{left:16%;right:16%;top:9%;height:22%;opacity:.95}\n[data-effort-slider][data-skin=\"chrome\"] .es-tick[data-on=\"1\"]{color:#fff;text-shadow:0 0 9px rgba(214,248,245,.85)}\n[data-effort-slider][data-skin=\"chrome\"] .es-readout__lvl{background:linear-gradient(180deg,#fff,#96aead);-webkit-background-clip:text;background-clip:text;color:transparent}\n\n/* ── 皮肤 D：流体 ────────────────────────────────────────── */\n/* 色系沿用 nebula（蓝 → 紫 → 粉），星点闪烁改名 es-fluid-twinkle，避免和皮肤 A 的 es-twinkle 撞名。 */\n[data-effort-slider][data-skin=\"fluid\"]{--es-ring-on:#37e0d8;--es-focus:rgba(55,224,216,.65);color:#b8f2ec}\n/* 收起态的胶囊与核心：\n   基础样式里 .es-pill / .es-orb__core 是**没有底色**的，底色全靠每套皮肤自己给。\n   漏掉这两条的话，流体皮肤在收起态就只剩一层几乎看不见的白环（这个坑皮肤 A 早期踩过一次）。 */\n/* 收起态胶囊的底色/投影已由文件末尾的 \"Apple Liquid Glass\" 段接管（高透明底 + 镜面亮边）。\n   旧的两条（不透明深蓝底 + 重投影）与\"更透、更扁平\"相反，已删除，避免两处定义打架。 */\n/* 面板本身不再在这里写死底色/描边/投影 —— 它已由文件末尾的 \"Apple Liquid Glass\" 段接管\n   （那里是高透明底 + backdrop-filter + 渐变镜面亮边）。旧的那版是深色径向底 + 厚投影 +\n   1px 描边，属于\"靠画厚度表达材质\"，与\"更扁平\"的方向相反，已删除，避免两处定义打架。 */\n/* 星点闪烁层（.es-panel::before）也按\"更扁平\"删掉了：在玻璃上它读起来像灰尘，\n   而且它是唯一给面板加\"深度装饰\"的东西。要找回深空感的话，把这一层加回来即可。 */\n/* canvas 图层：只有本皮肤打开（基础规则里是 display:none），流体不溢出轨道圆角。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-rail__fluid{display:block}\n[data-effort-slider][data-skin=\"fluid\"] .es-rail{background:linear-gradient(180deg,#0b0f16,#141b24);\n  /* 扁平化：原来的 `0 5px 16px rgba(4,8,12,.7) inset` 是一道很深的凹槽阴影（拟物），\n     改成薄薄一层 + 保留 1px 细边 —— 凹陷感明显减弱，但轨道依然\"嵌在玻璃里\"。 */\n  box-shadow:0 0 0 1px rgba(55,224,216,.30) inset,0 0 18px rgba(55,224,216,.14) inset,0 2px 7px rgba(4,8,12,.42) inset}\n/* fx 层的球面高光在 border-radius:999px 的圆头处同样会被裁成\"白色半圆\"，本皮肤直接关掉它。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-rail__fx{display:none}\n[data-effort-slider][data-skin=\"fluid\"] .es-rail__grid i{background:rgba(255,255,255,.10)}\n/* 填充条：**完全透明**。它是 border-radius:999px 的胶囊，任何画在它上面的白色\n   （inset 高光、半透明白底）都会被圆头裁成\"最右端一个白色半圆\"，拖动时还跟着 --pct\n   变宽变窄 → 就是用户看到的白半圆拖影。流体皮肤的视觉 100% 由 canvas 承担，填充条不该存在。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-rail__fill{background:transparent;box-shadow:none;border:none}\n/* 珠子：白色**实心球**（用户明确要求，不要透明、不要空心描边）。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-knob{\n  background:radial-gradient(circle at 36% 28%,#ffffff 0 22%,#eefaf8 44%,#c8f0ec 72%,#37e0d8 100%);\n  box-shadow:0 0 0 1px rgba(255,255,255,.7),0 0 12px rgba(255,255,255,.65),0 0 26px rgba(48,214,208,.7),0 2px 8px rgba(4,8,12,.5)}\n[data-effort-slider][data-skin=\"fluid\"] .es-knob::after{display:none}\n/* 吸附脉冲环：**必须显式指定颜色**。不写的话 border-color/box-shadow 继承的 currentColor\n   会落到接近白色的文本色；而 .es-sparks 带 overflow:hidden + border-radius:inherit，\n   白色环一旦越出轨道就被圆角裁成贴着弧线的\"白色半圆\"，再配 opacity → 0，\n   就是\"最右端一个白色半圆、有残影、还会慢慢消失\"。\n   环的尺寸仍由全局 .es-sparks::before / @keyframes es-ring 锁死（≤ 轨道高度），这里只改颜色。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-sparks::before{border-color:rgba(140,230,226,.9);\n  box-shadow:0 0 10px rgba(48,210,203,.55)}\n[data-effort-slider][data-skin=\"fluid\"] .es-tick[data-on=\"1\"]{color:#eafaf7;text-shadow:0 0 10px rgba(55,224,216,.9)}\n[data-effort-slider][data-skin=\"fluid\"] .es-readout__lvl{background:linear-gradient(180deg,#fff,#8feee6);-webkit-background-clip:text;background-clip:text;color:transparent}\n\n/* ══ 皮肤 D：Apple Liquid Glass 外壳（面板 + 收起态胶囊）══════════════════\n   用户迭代要求：① 透明度更激进 ② UI 更扁平 ③ 模仿苹果的高级液态玻璃。\n   范围仍然**只限控件自己**（.es-panel / .es-pill），本文件依旧没有\n   :root / html / body / !important（见 DOCS-ALIGNMENT §2-①）。\n\n   Apple Liquid Glass 的观感来自三件事，而不是\"堆很多层渐变\"：\n     ① **高透明度 + 强模糊**：底色只是一层几乎没有的膜，背后内容要看得清；\n     ② **镜面边缘（specular rim）**：一圈 1px 的亮边，左上最亮、向右下渐隐 ——\n        这是\"玻璃\"最强的识别特征，也是\"液体\"感的来源；\n     ③ **扁平**：不要深色径向底、不要斜向扫掠、不要厚重投影、不要内侧暗线。\n        靠模糊 + 亮边表达材质，而不是靠画厚度。\n   所以这一版相对上一版**删掉**了：深色径向底、镜面扫掠层、色散层、内侧暗线、\n   厚重投影、以及本皮肤的星点闪烁层（.es-panel::before）—— 全部是为了\"更扁平\"。\n\n   ⚠️ 底色必须半透明：不透明色会让 backdrop-filter 背后没有可透内容，玻璃就不成立。\n   ⚠️ ::after 用 mask + counter-mask 做出\"只有 1px 边框着色\"的渐变亮边。\n      Chromium 支持 -webkit-mask-composite: xor / mask-composite: exclude；\n      （万一 mask 失效，这层会变成整片覆盖的白色 —— 所以必须用截图验证，见 §4-K。） */\n/* ── K-3：再激进一档 + 灵动 ────────────────────────────────────────────\n   用户：\"透明度太保守了，激进！！！灵动！\"\n   ① 透明度：白膜 .12→.065、压暗 .20→.075（有效 ≈.30 → **≈.13**，几乎是\"只有模糊和亮边\"）；\n      模糊 28→34px、饱和 190→200%，用\"糊得更彻底\"而不是\"压得更暗\"来保证文字能读。\n   ② 灵动：玻璃**接光** —— 高光跟着指针走。JS 只写 CSS 变量 `--es-gx/--es-gy`（不进 state，\n      不触发重渲染），这里用 radial-gradient 画出一团跟着走的光斑；悬停淡入。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-panel{\n  border:1px solid transparent;              /* 亮边由 ::after 画；留 1px 透明边框是为了不改盒子尺寸 */\n  border-radius:26px;                        /* 更接近苹果那种连续大圆角 */\n  background:\n    linear-gradient(180deg,rgba(255,255,255,.065),rgba(255,255,255,.028) 46%,rgba(255,255,255,.012)),\n    rgba(6,12,16,.075);                      /* 几乎不压暗：亮度全靠模糊后的背景本身 */\n  box-shadow:\n    0 6px 20px rgba(4,8,12,.18),              /* 扁平：轻到几乎只是一层柔光 */\n    0 1px 2px rgba(4,8,12,.12);\n  -webkit-backdrop-filter:blur(34px) saturate(200%) brightness(1.05);\n  backdrop-filter:blur(34px) saturate(200%) brightness(1.05);\n}\n/* 灵动：跟着指针走的光斑（指针位置由 JS 写进 --es-gx/--es-gy）。\n   显隐用 JS 写的 `--es-go` 而不是 `:hover`：拖轨道时轨道上有 setPointerCapture，\n   hover 状态可能不可靠；而且变量开关是\"有没有真的看到指针\"，语义更准。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-panel::before{\n  content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0;\n  background:radial-gradient(240px 240px at var(--es-gx,50%) var(--es-gy,-12%),\n    rgba(255,255,255,.30),rgba(255,255,255,.08) 36%,rgba(255,255,255,0) 68%);\n  opacity:var(--es-go,0);transition:opacity .30s ease;\n}\n/* 渐变镜面亮边：1px，左上 .72 → 渐隐 → 右下回到 .22（光线绕边走的错觉）。\n   身体越透，这圈越关键 —— 它才是\"玻璃\"的识别特征。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-panel::after{\n  content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:2;\n  padding:1px;\n  background:linear-gradient(150deg,\n    rgba(255,255,255,.72) 0%,rgba(255,255,255,.20) 26%,rgba(255,255,255,.03) 52%,\n    rgba(255,255,255,.07) 74%,rgba(255,255,255,.22) 100%);\n  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);\n  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);\n  -webkit-mask-composite:xor;\n  mask-composite:exclude;\n}\n/* 玻璃上的文字：苹果不加投影，但我们的背景不可控（可能是亮页面）。\n   越是激进透明，这层\"保底\"越重要 —— 否则白字落在被模糊的亮底上会糊掉。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-head,\n[data-effort-slider][data-skin=\"fluid\"] .es-desc,\n[data-effort-slider][data-skin=\"fluid\"] .es-tick,\n[data-effort-slider][data-skin=\"fluid\"] .es-readout{text-shadow:0 1px 3px rgba(4,8,12,.55),0 0 10px rgba(4,8,12,.30)}\n\n/* 收起态胶囊：同一套配方（模糊收窄一档），内部流体核心保持不透明。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-pill{\n  border:1px solid transparent;   /* 同上：亮边交给 ::before，透明边框只为保住原盒子尺寸（差 2px 会挪动工具行） */\n  background:\n    linear-gradient(180deg,rgba(255,255,255,.085),rgba(255,255,255,.035) 52%,rgba(255,255,255,.015)),\n    rgba(6,12,16,.065);\n  box-shadow:0 4px 14px rgba(4,8,12,.18),0 1px 2px rgba(4,8,12,.12);\n  -webkit-backdrop-filter:blur(22px) saturate(190%) brightness(1.05);\n  backdrop-filter:blur(22px) saturate(190%) brightness(1.05);\n}\n/* 胶囊的镜面亮边：和面板同一套 mask 做法（用它而不是 inset 高光：\n   inset 阴影在这种 999px 圆角上曾经出过\"右端白半圆\"的坑）。 */\n[data-effort-slider][data-skin=\"fluid\"] .es-pill::before{\n  content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:2;\n  padding:1px;\n  background:linear-gradient(150deg,\n    rgba(255,255,255,.78) 0%,rgba(255,255,255,.22) 30%,rgba(255,255,255,.04) 55%,\n    rgba(255,255,255,.08) 78%,rgba(255,255,255,.26) 100%);\n  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);\n  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);\n  -webkit-mask-composite:xor;\n  mask-composite:exclude;\n}\n/* 胶囊也接光（同一条 --es-gx/--es-gy，由同一个 JS 处理函数写；显隐同用 --es-go） */\n[data-effort-slider][data-skin=\"fluid\"] .es-pill::after{\n  content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:1;\n  background:radial-gradient(64px 64px at var(--es-gx,50%) var(--es-gy,50%),\n    rgba(255,255,255,.30),rgba(255,255,255,0) 70%);\n  opacity:var(--es-go,0);transition:opacity .25s ease;\n}\n[data-effort-slider][data-skin=\"fluid\"] .es-pill:hover{\n  background:\n    linear-gradient(180deg,rgba(255,255,255,.13),rgba(255,255,255,.055) 52%,rgba(255,255,255,.025)),\n    rgba(6,12,16,.05);\n  box-shadow:0 6px 18px rgba(4,8,12,.20),0 1px 2px rgba(4,8,12,.12);\n}\n\n@media (max-width:560px){\n  .es-panel{width:min(392px,calc(100vw - 20px));padding:12px 13px}\n  .es-tick{font-size:9.5px}\n}\n@media (prefers-reduced-motion:reduce){\n  .es-panel{animation-duration:.01ms}\n  .es-rail__fill::after,.es-panel::before,.es-knob::before{animation:none}\n  .es-knob{transition:none}\n}\n\n/* 加载态：store 还没就绪时的可见占位 —— 控件必须出现（首帧时序不该让它消失）。\n   不写 !important、不加全局规则，只作用于本控件自己的类。 */\n.es-pill--loading{opacity:.72;cursor:default}\n.es-pill--loading:hover{transform:none}\n@keyframes es-loading-pulse{0%,100%{opacity:.45}50%{opacity:1}}\n\n/* ══════════════════════════════════════════════════════════════════════════════\n   ★ ULTRA 档位层 + 闪电控件 / tok·s⁻¹ 读数 / 策略 chip\n   （本段为纯追加：不重排、不覆盖任何既有规则；JS 侧写入的 DOM 契约见下）\n\n   DOM 契约（由 JS 提供，本段只负责长相）：\n     · 根节点 [data-effort-slider] 上挂  data-ultra=\"1\" / data-lightning=\"1\"\n     · 轨道内 .es-rail__core（默认 display:none，仅 data-ultra=1 出现）\n     · 旋钮附加态 .es-knob--ultra\n     · 面板档位文字 .es-panel__level--ultra\n     · 闪电 .es-pill__bolt[data-on=\"0|1\"]\n     · 读数 .es-rate > .es-rate__num + .es-rate__unit，[data-idle=\"1\"] 整块隐藏\n     · 策略 .es-policy > .es-policy__body，[data-open=\"1\"] 展开\n     · 发光强度由 JS 写 CSS 变量 --es-rate(0–1，未定义按 0 处理) 驱动\n\n   设计方向：铂金 / 白炽 / 冰白。只用\"亮度层次 + 发丝级 1px + 内阴影\"做质感，\n   不用粗边框、不用霓虹彩虹。所有动画都是 5s 量级的慢呼吸或低振幅微抖\n   （无高频闪烁，无癫痫风险）；prefers-reduced-motion: reduce 下全部静态化。\n   本段同样**没有** :root / html / body / !important，全部选择器挂在\n   [data-effort-slider] 或 .es- 类下，不污染宿主页面。\n   ⚠️ 本段**不碰** .es-rail__stars / .es-rail__fluid（星星与流体画布层）任何规则。\n   ────────────────────────────────────────────────────────────────────────────── */\n\n/* ── 全局局部变量（只挂在控件根上，不写 :root）────────────────────────────────\n   --es-hair   ：发丝线 / 1px 描边用的白（各皮肤同值，暗底上都读得出来）\n   --es-cool   ：白炽核心的冷蓝端；用 color-mix 从各皮肤主色轻微偏冷后得到，\n                 这样核心在 nebula/fluid 偏蓝紫、holo 偏青、chrome 近中性 ——\n                 四套皮肤都不会出现\"一块不属于自己的色\"。\n   --es-bolt-off/--es-bolt-on：闪电未通电 / 通电时的描边色，逐皮肤覆盖。 */\n[data-effort-slider]{\n  --es-hair:rgba(255,255,255,.22);\n  --es-hair-strong:rgba(255,255,255,.42);\n  --es-cool:color-mix(in srgb,currentColor 30%,#ffffff);\n  --es-bolt-off:rgba(255,255,255,.72);\n  --es-bolt-on:currentColor;\n}\n\n/* ── ① ULTRA 白炽核心层：绝对定位覆盖在轨道上 ────────────────────────────────\n   默认 display:none（**必须**，见验收脚本 ⑤），只有 [data-ultra=\"1\"] 才出现。\n   三层辉光都在轨道内部：轨道自带 overflow:hidden + border-radius:999px，\n   所以\"任何生硬边缘\"都会被圆角吃掉；这里再补 border-radius:inherit 兜底。\n   呼吸统一 5.2s ease-in-out：core 的 tint 层与 knob 的外发光**同一时长、无延迟**，\n   相位因此天然对齐（--es-rate 只改强度，不改节奏）。 */\n.es-rail__core{position:absolute;inset:0;border-radius:inherit;pointer-events:none;display:none;\n  mix-blend-mode:screen;isolation:auto;opacity:clamp(.35,calc(.45 + .55 * var(--es-rate,0)),1)}\n[data-effort-slider][data-ultra=\"1\"] .es-rail__core{display:block}\n.es-rail__core span{position:absolute;inset:0;pointer-events:none;border-radius:inherit}\n/* 热核：中心几乎纯白的软糖球，用 radial-gradient 做柔边（绝无硬边） */\n.es-rail__core__glow{\n  background:\n    radial-gradient(52% 190% at 50% 50%,rgba(255,255,255,.98) 0%,rgba(255,255,255,.62) 26%,\n      rgba(210,248,244,.30) 52%,rgba(190,242,238,.10) 74%,transparent 100%),\n    radial-gradient(88% 220% at 50% 50%,rgba(190,242,238,.45) 0%,rgba(150,225,224,.16) 46%,transparent 76%);\n  filter:blur(.4px) saturate(108%);\n  animation:es-core-breathe 5.2s ease-in-out infinite;\n}\n/* 冷蓝呼吸层：白 → 淡蓝的\"温度漂移\"，与热核同相位 */\n.es-rail__core__tint{\n  background:radial-gradient(58% 210% at 50% 50%,color-mix(in srgb,var(--es-cool,#d8fbf7) 78%,transparent) 0%,\n    color-mix(in srgb,var(--es-cool,#d8fbf7) 30%,transparent) 44%,transparent 78%);\n  animation:es-core-cool 5.2s ease-in-out infinite;\n}\n/* 余烬层：贴着轨道两端渐隐的一条 1px 冷白亮线，只是\"边缘还有温度\"的暗示 */\n.es-rail__core__ember{\n  inset:auto 0 0;height:1px;opacity:calc(.10 + .34 * var(--es-rate,0));\n  background:linear-gradient(90deg,transparent,var(--es-core-line,rgba(226,251,248,.75)) 32%,\n    var(--es-core-line,rgba(226,251,248,.75)) 68%,transparent);\n  -webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);\n  mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);\n}\n@keyframes es-core-breathe{0%,100%{opacity:.40}50%{opacity:.98}}\n@keyframes es-core-cool{0%,100%{opacity:.14}50%{opacity:.56}}\n\n/* ── ② ULTRA 旋钮附加态：1px 细环 + 外发光 + 与核心同相位呼吸 ─────────────────\n   不写死底色 —— 底色仍由各皮肤块定义，这里只**追加**一圈 1px 白细环与外发光。\n   复合选择器 [data-effort-slider] .es-root…：即使 data-ultra 挂在根上，\n   只要 .es-knob--ultra 出现就生效。 */\n[data-effort-slider][data-ultra=\"1\"] .es-knob--ultra{\n  box-shadow:\n    0 0 0 1px rgba(255,255,255,.92),                                   /* 细环 */\n    0 0 0 3px rgba(200,246,242,.13),                                   /* 环外一线冷白（亚像素层次） */\n    0 0 calc(6px + 14px * var(--es-rate,0)) rgba(255,255,255,.62),     /* 随 --es-rate 走的外发光 */\n    0 0 calc(16px + 26px * var(--es-rate,0)) rgba(150,225,224,.40),\n    0 2px 8px rgba(4,8,12,.45);\n  animation:es-knob-ultra 5.2s ease-in-out infinite;\n  transition:transform .4s cubic-bezier(.22,1,.36,1),filter .4s ease;\n}\n[data-effort-slider][data-ultra=\"1\"] .es-knob--ultra::after{opacity:.95}\n@keyframes es-knob-ultra{\n  0%,100%{box-shadow:0 0 0 1px rgba(255,255,255,.80),0 0 0 3px rgba(200,246,242,.09),\n    0 0 5px rgba(255,255,255,.42),0 0 14px rgba(150,225,224,.26),0 2px 8px rgba(4,8,12,.45)}\n  50%{box-shadow:0 0 0 1px rgba(255,255,255,1),0 0 0 3px rgba(200,246,242,.18),\n    0 0 17px rgba(255,255,255,.80),0 0 40px rgba(150,225,224,.46),0 2px 8px rgba(4,8,12,.45)}\n}\n\n/* ── ③ 面板 ULTRA 文字：全大写 + 0.18em 字距 + 铂金白 + 1px 发丝线 ─────────────\n   发丝线用 ::after 画，**不动**文字基线（不占行高、不挤版面）。\n   铂金白：4 套皮肤统一取同一条铂金渐变，字色写在两边（color + -webkit-text-fill-color），\n   防止皮肤里已有的 background-clip:text 把字吃掉；-webkit-text-stroke 只补 0.2px 冷白。 */\n/* 用户明确要求档位名的大小写是 **Ultra**（不是全大写 ULTRA）：\n   所以这条规则里**不能**留 `text-transform:uppercase`（否则改名不生效），\n   连带把只为全大写服务的 `letter-spacing:.18em` 与固定的 10.5px 字号也撤掉 ——\n   这个类现在挂在**面板的档位名**（.es-readout__name，13px）上，字号必须跟随宿主。\n   只保留\"铂金白 + 冷白描边 + 发丝下划线\"这三个纯视觉特征。 */\n.es-panel__level--ultra{position:relative;white-space:nowrap;\n  color:#eefaf8;-webkit-text-fill-color:#eefaf8;\n  text-shadow:0 0 10px rgba(200,246,242,.42),0 1px 2px rgba(4,8,12,.5);\n  -webkit-text-stroke:.2px rgba(255,255,255,.32)}\n.es-panel__level--ultra::after{content:\"\";position:absolute;left:0;right:.18em;bottom:-4px;height:1px;\n  background:linear-gradient(90deg,transparent,rgba(226,251,248,.62) 16%,rgba(190,242,238,.30) 62%,transparent);\n  pointer-events:none}\n\n/* ── ④ 闪电按钮（旧版：clip-path 画形状，不引外部图片/SVG）────────────────────\n   ⚠️ 这段的形状实现**已被 ④-b 的内联 SVG 取代**，仅保留下面这行盒子模型\n   （position/尺寸/过渡），它同时被 `.es-head` 里的绝对定位覆盖规则命中。\n   把 `--es-bolt-shape` 留着是给旧检查脚本/旧截图做参照，不再参与任何绘制。 */\n.es-pill__bolt{\n  --es-bolt-shape:polygon(60% 0%,16% 56%,46% 56%,38% 100%,86% 40%,53% 40%);\n  position:relative;display:inline-flex;align-items:center;justify-content:center;\n  width:19px;height:19px;min-width:19px;flex:0 0 auto;cursor:inherit;box-sizing:border-box;\n  color:var(--es-bolt-on,currentColor);\n  transition:color .22s ease,opacity .22s ease,transform .16s ease;\n}\n/* ── ④-b 闪电改由**内联 SVG 描边**画（2026 复核：clip-path+mask 那套是几何错误）─────\n   旧写法（`.es-pill__bolt::after{inset:1.5px;padding:1.9px;mask:linear-gradient(...)\n   content-box,...;mask-composite:exclude}` + `clip-path:var(--es-bolt-shape)`）看着像\n   \"描边\"，其实是**按矩形盒子的周长**算出来的一圈框，再与闪电 clip-path 求交 ——\n   交集只剩闪电最外缘的几段残片。独立取证图 `bolt-probe.png`（×2 全页）里，面板右上角\n   只有一小段白短线，既不是闪电也没有轮廓。所以\"白边看不到\"是几何问题，不是亮度问题，\n   把 opacity 从 .34 抬到 .62 / #fff / padding 1.9px 都治不了它。\n   现在改成**内联 <svg> + path + stroke**：stroke 天生沿路径中心线两侧各画一半宽度，\n   轮廓是几何精确的（不引任何外部图片/SVG 文件，无额外请求）。\n   JS 侧 DOM（client.js 的 .es-pill__bolt 内）：\n     <svg class=\"es-bolt__svg\" viewBox=\"0 0 24 24\" aria-hidden=\"true\">\n       <defs><linearGradient id=\"es-bolt-flow\" x1=\"0\" y1=\"0\" x2=\"24\" y2=\"24\"\n         gradientUnits=\"userSpaceOnUse\">\n         <stop offset=\"0%\" stop-color=\"#ffffff\"/>\n         <stop offset=\"42%\" stop-color=\"var(--es-bolt-a)\"/>\n         <stop offset=\"100%\" stop-color=\"var(--es-bolt-b)\"/>\n         <animate attributeName=\"x1\" values=\"-24;24\" dur=\"2.6s\" repeatCount=\"indefinite\"/>\n         <animate attributeName=\"x2\" values=\"0;48\"  dur=\"2.6s\" repeatCount=\"indefinite\"/>\n       </linearGradient></defs>\n       <path class=\"es-bolt__glowline\" d=\"…\" />\n       <path class=\"es-bolt__line\" d=\"…\" />\n     </svg>\n   这里的坐标是 SVG 用户单位，与 CSS 无关；`vector-effect:non-scaling-stroke` 让 1.7px\n   在任何缩放/CTM 下都是 1.7px，不会被 viewBox 缩放成别的粗细。 */\n.es-bolt__svg{width:100%;height:100%;display:block;overflow:visible;pointer-events:none}\n/* 未点亮（用户：「闪电在没被点击时很不明显，给他做个白色描边」）：\n   **纯白 #fff**、线宽 1.7px、圆角接头，四套皮肤的深色面板上都清清楚楚；\n   填充保持 none —— 没通电就是一条空心轮廓，不做任何填充。 */\n.es-bolt__line{\n  fill:none;stroke:#ffffff;stroke-width:1.7;\n  stroke-linejoin:round;stroke-linecap:round;\n  vector-effect:non-scaling-stroke;\n  opacity:.95;transition:opacity .22s ease,stroke .22s ease,stroke-width .22s ease;\n}\n/* 通电：换成本皮肤色系的**流动渐变**，再补一圈很淡的白色外发光 → \"电弧在轮廓上跑\"。\n   stroke-width 只加 0.05，避免点亮瞬间轮廓粗一圈导致视觉跳动。\n\n   ⚠️ 流动为什么不靠 SVG `<animate>`：`<animate attributeName=\"x1\">` 只能覆盖\n   **元素上已经存在**的属性；`<linearGradient>` 没写 x1/x2 时 SMIL 不会凭空造一个\n   （独立实测量过：animate 元素在、值是空串、渐变一年不动）。所以改成\n   **CSS @property 注册的 --es-bolt-x1/--es-bolt-x2**（注册成 <number> 才能插值；\n   直接动画未注册的自定义属性只会得到离散跳变），元素上只写 `inherit` 默认值，\n   动画在 `.es-bolt__svg` 上跑 —— stroke 的渐变于是真的在扫。\n   万一宿主 Chromium 不支持 @property：变量不合法 → 渐变退化成默认的 0%→100%\n   静态斜向过渡，闪电照样亮，只是不流动。 */\n@property --es-bolt-x1{syntax:\"<number>\";inherits:true;initial-value:0}\n@property --es-bolt-x2{syntax:\"<number>\";inherits:true;initial-value:24}\n.es-pill__bolt[data-on=\"1\"] .es-bolt__line{\n  stroke:url(#es-bolt-flow);stroke-width:1.75;opacity:1;\n}\n.es-pill__bolt[data-on=\"1\"] .es-bolt__svg{\n  animation:es-bolt-sweep 2.6s linear infinite;\n}\n@keyframes es-bolt-sweep{\n  from{--es-bolt-x1:-24;--es-bolt-x2:0}\n  to{--es-bolt-x1:24;--es-bolt-x2:48}\n}\n[data-effort-slider][data-lightning=\"1\"] .es-pill__bolt[data-on=\"1\"] .es-bolt__line{\n  filter:drop-shadow(0 0 .8px rgba(255,255,255,.85))\n         drop-shadow(0 0 calc(2px + 4px * var(--es-rate,0)) rgba(190,242,238,.55));\n}\n/* 描边上的\"电流包\"：一条短的亮白虚线沿轮廓走动（dashoffset 由 CSS 动画驱动，\n   虚线长度 --es-bolt-len 由 JS 实测 path 总长后写入，未写入时用一个保守兜底值）。 */\n.es-bolt__glowline{\n  fill:none;stroke:#ffffff;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;\n  vector-effect:non-scaling-stroke;\n  opacity:0;\n  stroke-dasharray:calc(var(--es-bolt-len,64px) * .30) calc(var(--es-bolt-len,64px) * .70);\n}\n.es-pill__bolt[data-on=\"1\"] .es-bolt__glowline{opacity:.9;\n  animation:es-bolt-run 1.9s linear infinite,es-bolt-run-fade 3.8s ease-in-out infinite}\n@keyframes es-bolt-run{\n  from{stroke-dashoffset:calc(var(--es-bolt-len,64px) * 1)}\n  to{stroke-dashoffset:0}\n}\n@keyframes es-bolt-run-fade{0%,100%{opacity:.42}50%{opacity:.95}}\n/* ⚠️ 描边**不再**用任何 ::before/::after 画。旧的两层 clip-path 规则已从本文件删除；\n   若日后又在 CSS 里出现盖在 SVG 上的 `content:\"\"` 伪元素，用户看到的就会再次是那截白残片。 */\n/* 旧描边层与旧填充层（`.es-pill__bolt::before` 的 scaleY 爬升 + `::after` 的 mask 环 +\n   通电流动渐变）**已全部删除** —— 它们都是 clip-path/mask 几何路线的产物，\n   根因见上面 ④-b 段。形状、描边、流动、发光现在全部由内联 SVG 承担。 */\n/* 通电：外部发光（跟着轮廓）＋ 短周期低振幅亮度抖动（电弧），强度跟 --es-rate 走。\n   抖动幅度固定 ±3% 亮度（视觉上几乎只是\"电流声\"），不属于闪烁。 */\n.es-pill__bolt[data-on=\"1\"]{opacity:.7}\n[data-effort-slider][data-lightning=\"1\"] .es-pill__bolt[data-on=\"1\"]{\n  opacity:1;\n  filter:drop-shadow(0 0 calc(3px + 6px * var(--es-rate,0)) rgba(255,255,255,.65))\n         drop-shadow(0 0 calc(8px + 12px * var(--es-rate,0)) rgba(190,242,238,.35));\n  animation:es-bolt-breathe 5.2s ease-in-out infinite,es-bolt-arc .42s steps(2,jump-none) infinite;\n}\n.es-pill__bolt[data-on=\"1\"]:hover{transform:translateY(-1px)}\n/* 悬停不给\"未通电\"的闪电加粗或发光：没通电就没有理由发光。 */\n.es-pill__bolt[data-on=\"0\"]:hover{opacity:1}\n@keyframes es-bolt-breathe{0%,100%{opacity:.86}50%{opacity:1}}\n@keyframes es-bolt-arc{0%{filter:brightness(1)}50%{filter:brightness(calc(1 + .035 * var(--es-rate,0)))}100%{filter:brightness(1)}}\n\n/* ── ⑤ tok/s 读数：等宽 + tabular-nums + 预留宽度（数字变化不得抖 pill）────────\n   注意：有自己的一套排版，所以这个块里**不复用** .es-readout 的 min-width。\n   [data-idle=\"1\"] 时整块 display:none；父级 .es-foot 的 min-height:18px 把高度锁住，\n   所以\"显示/隐藏读数\"不会让 pill 行高跳一下。 */\n.es-rate{display:inline-flex;align-items:baseline;gap:2px;min-width:54px;min-height:18px;\n  white-space:nowrap;line-height:1;font-variant-numeric:tabular-nums lining-nums;\n  font-feature-settings:\"tnum\" 1,\"lnum\" 1;\n  font-family:ui-monospace,SFMono-Regular,\"SF Mono\",Menlo,Consolas,\"Liberation Mono\",monospace;\n  letter-spacing:.01em;transition:opacity .25s ease}\n.es-rate__num{display:inline-block;min-width:6.6ch;text-align:right;\n  font-weight:600;font-size:13px;font-variant-numeric:tabular-nums;\n  text-shadow:0 0 calc(3px + 7px * var(--es-rate,0)) rgba(255,255,255,.22)}\n.es-rate__unit{font-size:10px;font-weight:600;opacity:.5;letter-spacing:.04em;\n  margin-left:1px;text-transform:none}\n.es-rate[data-idle=\"1\"]{display:none}\n\n/* ── ⑥ 策略 chip（幽灵按钮）＋ 展开原文块（等宽 / 暗色 / 可滚动 / max-height 过渡）─ */\n/* ── ⑦ 2026 反馈修订：ULTRA 刻度对齐 / 闪电进角落 / 脚注行不再随文字抖动 ──────\n   事故一（用户：「ultra 的位置没有对齐其它选项」）：ULTRA 刻度借用了\n   `.es-panel__level--ultra`，而那条规则含 `position:relative;display:inline-block`\n   —— 同权重、后写胜，它**覆盖**了 `.es-tick` 的 `position:absolute`，于是 ULTRA\n   那一格掉出绝对定位、和其它刻度对不齐。现在刻度改用只含视觉、不含布局的\n   `.es-tick--ultra`；带布局属性的 `.es-panel__level--ultra` 只留给面板里的档位文字。\n   事故二（用户：「闪电的位置一直在跳动当拉动滑动条时…应该放到一个角落而不是居中」）：\n   它原来是 `.es-foot` 的中间 flex 子元素，而那一行是 `justify-content:space-between`\n   —— 拖动时读数文字（\"5 / ULTRA\" → \"3 / HIGH\"）宽度在变，等于每帧重新分配空间。\n   现在它在 `.es-head` 内绝对定位，钉在面板右上角，位置与任何文字宽度无关。\n   事故三（顺带）：脚注行改 grid 三列固定归属，读数再长也不会把右边的读数/皮肤挤走。 */\n.es-foot{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px;min-height:18px}\n.es-foot>.es-readout{grid-column:1}\n.es-foot>.es-rate{grid-column:2}\n.es-foot>.es-skins{grid-column:3}\n.es-head{padding-right:26px}\n.es-pill__bolt{position:absolute;top:-1px;right:0;z-index:4}\n.es-tick--ultra{color:#f0fbf9;-webkit-text-fill-color:#f0fbf9;font-weight:700}\n[data-effort-slider][data-skin=\"holo\"] .es-tick--ultra{color:#d8fbf7;-webkit-text-fill-color:#d8fbf7}\n[data-effort-slider][data-skin=\"chrome\"] .es-tick--ultra{color:#ffffff;-webkit-text-fill-color:#ffffff}\n[data-effort-slider][data-skin=\"fluid\"] .es-tick--ultra{color:#eafaf7;-webkit-text-fill-color:#eafaf7}\n\n/* ── ⑧ 2026 反馈：闪电两态重做 / 策略面板浮出不再溢出 / 说明不许被截断 ─────────\n   事故（独立取证 + 用户实测）：`<button>` 没做 UA 复位时是**浅灰底 rgb(240,240,240)\n   + 黑 outset 边框 + radius 0** 的系统按钮，于是面板右上角出现一个**白方块**；\n   闪电描边压在自家白底上合成对比度只有 ≈1.06:1 ⇒ 根本看不见，\n   用户的原话就是\"感觉点不亮也点不掉\"。\n   现在是：**未点亮 = 透明（露出面板自己的背景）+ 发丝描边始终可见**；\n   点亮 = 形状内填充**同色系流动渐变**（逐皮肤给色，渐变横向流动，不引新 DOM）。 */\n.es-pill__bolt,.es-policy__chip{\n  appearance:none;-webkit-appearance:none;background:none;background-color:transparent;\n  border:0;margin:0;padding:0;font:inherit;color:inherit;cursor:pointer;\n  -webkit-tap-highlight-color:transparent}\n/* 断电态（用户：「闪电在没被点击时很不明显，给他做个白色描边」）：\n   · **纯白**描边，不再跟皮肤着色走（--es-bolt-off 那套逐皮肤色一律让位给 #fff）；\n   · 轮廓由内联 SVG 的 `stroke:#ffffff` 提供（线宽 1.7px，见 ④-b 段）。\n   ⚠️ 这里原来是 `.es-pill__bolt[data-on=\"0\"]::after{background:#ffffff;padding:1.9px;…}`\n   —— 它沿**矩形盒子周长**裁一圈、再与闪电 clip-path 求交，只剩一小段白残片（几何错误，\n   见 ④-b 段与 bolt-probe.png）。白描边现在由 SVG path 的 stroke 承担，所以这条**整条删除**。\n   外发光不过滤到 SVG 上：挂在按钮上的 filter 会与 `::before` 时代的旧画法混淆，\n   而且按钮本身就是 19×19 的方形盒，drop-shadow 会变成\"方块的阴影\"。 */\n/* 通电：同色系流动渐变。渐变现在是 SVG 里的 <linearGradient x1/x2 + <animate>>，\n   逐皮肤配色仍由 --es-bolt-a/--es-bolt-b 提供（见下方四条）。 */\n[data-effort-slider][data-skin=\"nebula\"]{--es-bolt-a:#e8faf7;--es-bolt-b:#37e0d8}\n[data-effort-slider][data-skin=\"holo\"]{--es-bolt-a:#d8fbf7;--es-bolt-b:#37e0d8}\n[data-effort-slider][data-skin=\"chrome\"]{--es-bolt-a:#ffffff;--es-bolt-b:#a8ccca}\n[data-effort-slider][data-skin=\"fluid\"]{--es-bolt-a:#eafaf7;--es-bolt-b:#4fe6dc}\n\n/* 策略正文浮出：容器从\"胶囊行\"切成\"列\"（chip 在上、正文在下），高度交给内容。\n   旧写法容器固定 height:22px，148px 的正文以它为中心**上下各溢出 ~63px**\n   （实测底边越出面板 ~49px、顶部压住刻度行与读数）。 */\n.es-policy[data-open=\"1\"],[data-effort-slider] :where([data-open=\"1\"])>.es-policy,\n[data-effort-slider][data-open=\"1\"]>.es-policy{\n  display:flex;flex-direction:column;align-items:stretch;gap:0;\n  height:auto;min-height:22px;padding:0;\n  border-color:transparent;background:transparent;box-shadow:none;opacity:1}\n.es-policy[data-open=\"1\"]>.es-policy__chip{\n  display:inline-flex;align-items:center;justify-content:center;\n  height:22px;padding:0 8px;border-radius:999px;\n  border:1px solid var(--es-hair,rgba(255,255,255,.22));\n  background:rgba(255,255,255,.06);opacity:.92}\n/* 说明行：ULTRA 的英文说明有 175 字，旧规则 nowrap+ellipsis 把它截成半句读不到。\n   放宽到两行（仍是硬上限，不会把面板撑高）。 */\n.es-desc{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n@media (prefers-reduced-motion:reduce){\n  /* 闪电的流动（SVG <animate> 由 JS 在 reduce 下停掉；CSS 侧的\"电流包\"在这里停） */\n  .es-bolt__glowline{animation:none;opacity:.55}\n  .es-pill__bolt[data-on=\"1\"]{animation:none}\n}\n\n/* 切到 Ultra 时标签从 ~25px 变 ~38px → pill 变宽 → 整块控件横移（独立取证实测 +12.75px，\n   而面板 `right:0` 锚在 root 上，所以连轨道一起挪）。给档位名预留一格宽度并居中：\n   常见档位名（含 \"Ultra\"）都落在里面，切换档位不再位移。更长的模型自带档次名仍会撑开 ——\n   那是模型目录的数据，不能为了不动而截断它的语义。 */\n.es-pill__name{min-width:3.3em;text-align:center}\n/* 读数预留：6.6ch 只覆盖 ≤6 字符，到 \"1,234,567\" 会撑宽 ~18.3px 把 tok/s 顶走。\n   7.6ch 覆盖到 \"999,999\"（现实量级够用），百万级仍会略微变宽，但不再是常见跳变。 */\n.es-rate__num{min-width:7.6ch}\n/* 收起态的幽灵胶囊原来是面板列里的 flex 子项，默认 align-items:stretch → 被拉满整行 358px，\n   看着像\"面板底下孤零零多出一行\"。让它按内容宽度靠左。 */\n.es-policy{align-self:flex-start}\n.es-policy{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;\n  flex:0 0 auto;white-space:nowrap;cursor:inherit;user-select:none;border-radius:999px;\n  background:transparent;border:1px solid var(--es-hair,rgba(255,255,255,.22));\n  color:inherit;opacity:.66;\n  font-size:10.5px;font-weight:600;letter-spacing:.05em;\n  transition:opacity .2s ease,border-color .2s ease,background .2s ease,box-shadow .2s ease}\n/* :not([data-open=\"1\"]) 是必须的 —— 否则展开态被悬停态盖掉（同权重下后写者胜，\n   而悬停那组选择器更长）。这是折叠 chip 常见的一处\"悬停把展开样式吃掉\"的坑。 */\n.es-policy:not([data-open=\"1\"]):hover{border-color:var(--es-hair-strong,rgba(255,255,255,.42));\n  box-shadow:0 0 0 1px var(--es-hair-strong,rgba(255,255,255,.42)) inset,\n    0 0 calc(5px + 9px * var(--es-rate,0)) rgba(255,255,255,.14);\n  opacity:1}\n.es-policy:focus-visible{outline:none;\n  box-shadow:0 0 0 2px var(--es-focus,rgba(55,224,216,.6));opacity:1}\n/* 展开态：数据属性由 JS 写。三种落点都支持，且**每种都锁在控件自己的子树里**：\n   ㈠ .es-policy 自身  ㈡ 直接父节点（工具行 / .es-foot，用 :where() 归零权重，不干扰它人）\n   ㈢ 控件根 [data-effort-slider]。\n   注意**不能**写裸的 `[data-open=\"1\"]>.es-policy` —— 那会命中宿主页面里任何\n   带 data-open 的元素（选择器越界，见验收脚本 ⑫）。 */\n.es-policy[data-open=\"1\"],[data-effort-slider] :where([data-open=\"1\"])>.es-policy,\n[data-effort-slider][data-open=\"1\"]>.es-policy{border-color:transparent;opacity:.92;\n  background:rgba(255,255,255,.06);box-shadow:0 0 0 1px var(--es-hair,rgba(255,255,255,.22)) inset}\n.es-policy__body{margin:0;padding:0 10px;max-height:0;opacity:0;\n  overflow:hidden auto;overscroll-behavior:contain;\n  scrollbar-width:thin;\n  font-family:ui-monospace,SFMono-Regular,\"SF Mono\",Menlo,Consolas,\"Liberation Mono\",monospace;\n  font-size:11px;line-height:1.62;letter-spacing:.005em;\n  color:rgba(214,248,245,.80);-webkit-text-fill-color:currentColor;\n  white-space:pre-wrap;overflow-wrap:anywhere;\n  background:rgba(4,8,12,.04);border-radius:10px;\n  transition:max-height .34s cubic-bezier(.22,1,.36,1),opacity .22s ease,padding .28s ease}\n/* 暗色底：面板本身是深色时只补一点点压暗（避免硬黑块），\n   玻璃面板（fluid / Apple 段）需要更明显的压暗才读得出等宽原文\n   —— 这就是\"与皮肤底色耦合\"的部分，按皮肤分别处理。 */\n[data-effort-slider][data-skin=\"nebula\"] .es-policy__body{background:rgba(4,10,12,.26)}\n[data-effort-slider][data-skin=\"holo\"] .es-policy__body{background:rgba(3,18,24,.30)}\n[data-effort-slider][data-skin=\"chrome\"] .es-policy__body{background:rgba(8,13,15,.28)}\n[data-effort-slider][data-skin=\"fluid\"] .es-policy__body{background:rgba(4,10,13,.34)}\n.es-policy__body::-webkit-scrollbar{width:6px}\n.es-policy__body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:99px}\n.es-policy__body::-webkit-scrollbar-track{background:transparent}\n/* 展开：data-open 落在自身 / 直接父节点 / 控件根，三种写法都能命中（同样全部锁在控件子树内） */\n.es-policy__body[data-open=\"1\"],[data-effort-slider] :where([data-open=\"1\"])>.es-policy__body,\n[data-effort-slider][data-open=\"1\"]>.es-policy__body{\n  max-height:148px;opacity:1;padding:8px 10px;\n  box-shadow:0 0 0 1px rgba(255,255,255,.10) inset;\n  -webkit-mask-image:linear-gradient(180deg,transparent 0,#000 9px,#000 calc(100% - 9px),transparent 100%);\n  mask-image:linear-gradient(180deg,transparent 0,#000 9px,#000 calc(100% - 9px),transparent 100%)}\n\n/* ── ⑦ 控制错位：面板多了一行时的轻推（不写死任何既有间距）───────────────\n   只对 ULTRA + 闪电的组合生效，且都落在 --es-pct 体系之外，不影响轨道几何。 */\n[data-effort-slider][data-ultra=\"1\"] .es-pill__name{letter-spacing:.02em}\n\n/* ── ⑧ 各皮肤对 ULTRA / 闪电的适配（暗底白炽一律成立：4 套皮肤都是暗底）──────\n   逐皮肤只调两样东西：① 闪电的描边色（保证暗底可见、通电色跟皮肤主色一致）\n   ② 白光核心的冷蓝端（避免在暖/青色皮肤上飘出违和的蓝）。 */\n[data-effort-slider][data-skin=\"nebula\"]{--es-bolt-off:rgba(190,242,238,.78);--es-bolt-on:#e8faf7}\n[data-effort-slider][data-skin=\"nebula\"] .es-panel__level--ultra{color:#f0fbf9;-webkit-text-fill-color:#f0fbf9}\n[data-effort-slider][data-skin=\"holo\"]{--es-bolt-off:rgba(184,246,242,.78);--es-bolt-on:#d8fbf7}\n[data-effort-slider][data-skin=\"holo\"] .es-panel__level--ultra{\n  color:#eafdfb;-webkit-text-fill-color:#eafdfb;\n  text-shadow:0 0 10px rgba(190,248,244,.45),0 1px 2px rgba(4,8,12,.5)}\n[data-effort-slider][data-skin=\"chrome\"]{--es-bolt-off:rgba(226,251,248,.80);--es-bolt-on:#ffffff}\n[data-effort-slider][data-skin=\"chrome\"] .es-panel__level--ultra{\n  color:#fff;-webkit-text-fill-color:#fff;text-shadow:0 1px 2px rgba(4,8,12,.55)}\n[data-effort-slider][data-skin=\"chrome\"] .es-rate__num{text-shadow:none}\n[data-effort-slider][data-skin=\"fluid\"]{--es-bolt-off:rgba(200,246,242,.78);--es-bolt-on:#eafaf7}\n[data-effort-slider][data-skin=\"fluid\"] .es-panel__level--ultra{color:#f2fbfa;-webkit-text-fill-color:#f2fbfa}\n/* 后两套皮肤的主色本来就偏冷/中性，冷蓝端收紧一点更接近\"冰白\" */\n[data-effort-slider][data-skin=\"holo\"] .es-rail__core__tint{\n  background:radial-gradient(58% 210% at 50% 50%,color-mix(in srgb,var(--es-cool,#d8fbf7) 58%,transparent) 0%,\n    color-mix(in srgb,var(--es-cool,#d8fbf7) 22%,transparent) 44%,transparent 74%)}\n[data-effort-slider][data-skin=\"chrome\"] .es-rail__core__tint{\n  background:radial-gradient(58% 210% at 50% 50%,rgba(255,255,255,.34) 0%,rgba(190,242,238,.14) 44%,transparent 74%)}\n\n/* ── ⑨ reduced-motion：所有新增动画停掉，只留静态态（核心/细环/发光仍在，只是不呼吸）─ */\n@media (prefers-reduced-motion:reduce){\n  .es-rail__core__glow,.es-rail__core__tint{animation:none}\n  .es-rail__core__glow{opacity:.74}\n  .es-rail__core__tint{opacity:.30}\n  /* 核心层的 --es-rate 强度保留在 .es-rail__core 上（不在这里复位），只是不再呼吸 */\n  .es-rail__core__ember{opacity:.16}\n  [data-effort-slider][data-ultra=\"1\"] .es-knob--ultra{animation:none}\n  [data-effort-slider][data-lightning=\"1\"] .es-pill__bolt[data-on=\"1\"]{animation:none}\n  .es-pill__bolt::before,.es-policy,.es-policy__body,.es-rate{transition-duration:.01ms}\n}\n\n/* 安全网：万一宿主/皮肤某条既有规则把核心层设成了可见，这里保证\"未 ULTRA 时绝不显示\"。\n   与上面 [data-ultra=\"1\"] 的 display:block 同权重(0,2,0) —— 本段在文件末尾且条件排除 ULTRA，\n   所以不会和它互相打架。不使用 !important。 */\n/* ⚠️ 这里曾有 `[data-effort-slider]:not([data-ultra=\"1\"]) .es-rail__core{display:none}` 当\"安全网\"，\n   它把 ULTRA 白炽核心层变成了**永远不绘制的死代码**：\n   · 它与 `[data-effort-slider][data-ultra=\"1\"] .es-rail__core{display:block}` 同权重 (0,3,0)，且写在后面；\n   · 外层还有一层 `.es-root[data-effort-slider]`（错误边界）**不带** data-ultra，`:not()` 恒成立；\n   ⇒ ULTRA 时两条都命中，\"后写胜\"把 display 压回 none。\n   基础规则 `.es-rail__core` 自己已经是 `display:none`，这个安全网是多余的 —— 已删除，**别再补回来**。\n   （独立取证实测：ULTRA 与非 ULTRA 时 display 都是 none、rect 0×0，mix-blend-mode 设了却从不绘制。） */\n\n/* ══ ⑩ ULTRA 专属特效：白炽环 + 内缘亮线 + 缓慢扫过的微光（2026 第二轮）══════════\n   用户反馈原文：「Ultra 专属特效也要做呢」。加了这一层之后，\"切到 Ultra\"不再是\n   \"轨道里多了一点白雾\"，而是**轨道这一格整体换了个材质**：一圈镀白炽的外壳在呼吸。\n\n   设计（仍然克制动人 —— 白金/白炽，不是霓虹）：\n     ① `.es-rail` 外侧一圈**镀白炽外壳**：1.5px 白环 + 冷蓝大范围外发光 + 亮内缘\n        （box-shadow 链：外发光 → 实白 1.5px 环 → 内侧一圈亮线）。\n        ⚠️ 用 `0 0 0 1.5px` 的**扩散环**而不是 `1.5px` 的 border：不改盒子尺寸，\n           轨道几何 / 珠子落点 / 拖拽热区一律不动。\n     ② `.es-rail__core::after` 一层**缓慢扫过的微光**（5.2s，与核心呼吸同相）。\n        ⚠️ 用 core 的伪元素而不是 `.es-rail::before`：`.es-rail` 自带\n        `overflow:hidden;border-radius:999px`，扫光会被两端圆头**裁出生硬边缘**；\n        core 是同一个盒子但只在 ULTRA 时 `display:block`，条件天然正确，\n        再叠一层 mask 让两端渐隐 —— 扫光永远画不进圆头。\n     ③ `--es-rate` 仍然只改强度，不改节奏（呼吸统一 5.2s ease-in-out）。\n   全部新增规则都带 `[data-ultra=\"1\"]`，非 ULTRA 时一条都不命中。 */\n[data-effort-slider][data-ultra=\"1\"] .es-rail{\n  /* ⚠️ 外壳的 R 角必须与轨道**本体**逐一相等（2026-10 用户缺陷：「Ultra 外框的圆角似乎\n     和我们一贯设计的圆角不太一样，R 角有差别，需要统一」）。\n     轨道圆角是**逐皮肤**的：基础 `.es-rail{border-radius:999px}`（nebula / chrome / fluid\n     都沿用），但 **holo 那套是 `border-radius:9px`**（`.es-rail__fill` / `.es-knob` 在 holo 下\n     也一并是 9px）。\n     而 `box-shadow` 的 **spread 环不会跟随 border-radius**：`0 0 0 1.5px` 这类扩散环的\n     描边盒半径是 `r + spread` —— holo 下就是 9 + 1.5 = **10.5px**，比轨道本体的 9px 大\n     1.5px，这就是\"R 角对不上\"的来源。\n     所以实白外壳一律用 `inset` 环**向内画**，宿主自己的圆角就是最终可见轮廓\n     （⚠️ 只把外环挪到 `::after` 上、写 `border-radius:inherit` 是**等价改写**、修不到点：\n        inherit 只让盒子半径相等，外环半径仍是 r+spread，见下方 ::after 处的完整说明）。\n     冷白外发光仍留在 .es-rail 上（它半径本来就该更大，且正是\"光晕\"该有的样子）。 */\n  box-shadow:\n    0 0 calc(12px + 26px * var(--es-rate,0)) rgba(120,200,210,.42),   /* 冷白外发光（随 rate） */\n    0 0 12px rgba(255,255,255,.34) inset,                             /* 内缘亮线 */\n    0 0 0 1px rgba(55,224,216,.32) inset;                            /* 内缘冷蓝细边 */\n  animation:es-rail-ultra-glow 5.2s ease-in-out infinite;\n  transition:box-shadow .35s ease;\n}\n/* 实白 1.5px 外壳：**必须向内画（inset）**。\n   ⚠️ `border-radius:inherit` 只让这个 ::after **盒子**的半径等于宿主，**不会**让 spread 环同步：\n      外环的可见半径永远是 `r + spread` —— holo 下 9+1.5 = 10.5px（第二圈 11.5px），\n      而轨道本体是 9px，这就是用户报的「Ultra 外框的圆角和一贯设计不一样」。\n      （2026-10-01 子代理第一版就是把同一个外环从 .es-rail 挪到这里并写 inherit —— 几何上\n       是**等价改写**，没修到点；它用来\"证明\"的 `::after { border-radius }` 是 inherit 出来的\n       常数，永远不会失败，属假绿。）\n      改成 inset 环后，可见轮廓 = 宿主自己的圆角（holo 9px / 其余 999px），四皮肤自动统一；\n      模糊外发光（blur）不产生可辨认的 R 角，继续留在盒子外。\n   ⚠️ 环的颜色/宽度可以调，但**不要再加不带 inset 的硬环**，否则 R 角又会比设计大一圈。 */\n[data-effort-slider][data-ultra=\"1\"] .es-rail::after{\n  content:\"\";position:absolute;inset:0;border-radius:inherit;pointer-events:none;\n  box-shadow:\n    0 0 0 1.5px rgba(255,255,255,.92) inset,\n    0 0 0 2.5px rgba(190,242,238,.26) inset;\n}\n/* 只呼吸**外发光**：半径/亮度变化，但不再动那圈 1.5px 外壳（避免任何半径漂移） */\n@keyframes es-rail-ultra-glow{\n  0%,100%{box-shadow:\n    0 0 calc(9px + 16px * var(--es-rate,0)) rgba(120,200,210,.28),\n    0 0 8px rgba(255,255,255,.22) inset,\n    0 0 0 1px rgba(55,224,216,.22) inset}\n  50%{box-shadow:\n    0 0 calc(16px + 34px * var(--es-rate,0)) rgba(190,242,238,.56),\n    0 0 16px rgba(255,255,255,.48) inset,\n    0 0 0 1px rgba(120,200,210,.46) inset}\n}\n/* 扫光：只在 ULTRA 的 core 上出现。mask 让它离两端 16% 就淡出，绝不被圆头裁成白半圆；用`width`动画而不是 `transform:translateX()` —— 后者在 46% 宽的色带上会把色带推出盒子，\n被圆头裁出一块生硬的白色直角（本文件历史上反复踩过的同一个坑）。 */\n[data-effort-slider][data-ultra=\"1\"] .es-rail__core::after{\n  content:\"\";position:absolute;top:0;bottom:0;left:-46%;width:46%;pointer-events:none;\n  background:linear-gradient(90deg,transparent,rgba(255,255,255,.55) 42%,rgba(214,248,245,.30) 62%,transparent);\n  filter:blur(.5px);opacity:.55;\n  -webkit-mask-image:linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent);\n  mask-image:linear-gradient(90deg,transparent,#000 16%,#000 84%,transparent);\n  animation:es-core-sweep 5.2s ease-in-out infinite;\n}\n@keyframes es-core-sweep{\n  0%{left:-46%;width:46%;opacity:0}\n  22%{opacity:.55}\n  62%{opacity:.5}\n  100%{left:100%;width:46%;opacity:0}\n}\n/* 旋钮：ULTRA 时再多一圈雪白细环 + 更强的外发光呼吸（与核心/外壳同一 5.2s 相位，\n   叠加在 ② 段的 es-knob-ultra 之上，不替换它）。 */\n@keyframes es-knob-ultra-halo{\n  0%,100%{transform:scale(1);filter:drop-shadow(0 0 3px rgba(255,255,255,.45))}\n  50%{transform:scale(1.035);filter:drop-shadow(0 0 calc(5px + 7px * var(--es-rate,0)) rgba(255,255,255,.75))}\n}\n[data-effort-slider][data-ultra=\"1\"] .es-knob--ultra{\n  animation:es-knob-ultra 5.2s ease-in-out infinite,es-knob-ultra-halo 5.2s ease-in-out infinite;\n}\n@media (prefers-reduced-motion:reduce){\n  [data-effort-slider][data-ultra=\"1\"] .es-rail{animation:none;\n    box-shadow:\n      0 0 calc(12px + 26px * var(--es-rate,0)) rgba(120,200,210,.42),\n      0 0 12px rgba(255,255,255,.34) inset,\n      0 0 0 1px rgba(55,224,216,.32) inset}\n  /* 外壳（::after，border-radius:inherit）在 reduce 下保持静态，仍与轨道同半径 */\n  [data-effort-slider][data-ultra=\"1\"] .es-rail__core::after{animation:none;opacity:0}\n  [data-effort-slider][data-ultra=\"1\"] .es-knob--ultra{\n    animation:none;transform:none;filter:drop-shadow(0 0 5px rgba(255,255,255,.6))}\n}\n\n/* ══════════════════════════════════════════════════════════════════════════════\n   ★ 罗德岛 · 工程终端 —— 把默认皮肤（fluid / Apple 液态玻璃）的**物质**换掉\n\n   为什么必须单独写这一段：\n   fluid 皮肤的颜色不在任何色值里 —— 面板底色是一层几乎透明的白膜\n   （rgba(255,255,255,.065→.012) 压在 rgba(8,12,24,.075) 上），观感完全由\n   backdrop-filter 后面的页面背景决定。所以上面那轮 literal 重映射\n   （214 处、rhodes-verify.mjs 复核 0 漏网）只收回了**强调色**，\n   \"白霜玻璃\"这个物质本身一点没动 —— 而罗德岛的表面不是白玻璃，是**蓝黑**。\n\n   罗德岛的配方（与 dsh-plugin-mascot 的 THEMES.rhodes 同一套）：\n     surface  rgba(24,32,42) -> rgba(11,15,21)\n     hairline rgba(120,200,210,.18)\n     accent   #37e0d8\n     text     #e4edf4\n   再加一层 scanline（1px/4px）—— 罗德岛终端的那点\"屏幕感\"主要来自它。\n\n   保留的：backdrop-filter（玻璃的\"透\"还在，只是从\"白霜\"变成\"深色玻璃\"）、\n   ::before 跟指针的光斑（改成青色）、::after 的 1px 镜面亮边（改成青色渐变）。\n   只作用于 [data-skin=\"fluid\"]，其余三个皮肤靠色值重映射已经是蓝黑了。\n   本文件依旧没有 :root / html / body / !important，不影响宿主。\n   ══════════════════════════════════════════════════════════════════════════════ */\n\n/* ── 展开面板 ── */\n[data-effort-slider][data-skin=\"fluid\"] .es-panel{\n  color:#e4edf4;\n  background:\n    repeating-linear-gradient(180deg,rgba(120,200,210,.055) 0 1px,transparent 1px 4px),\n    linear-gradient(158deg,rgba(24,32,42,.94),rgba(11,15,21,.97));\n  box-shadow:\n    0 18px 44px rgba(4,8,12,.55),\n    0 0 34px rgba(55,224,216,.10);\n  -webkit-backdrop-filter:blur(22px) saturate(150%) brightness(.92);\n  backdrop-filter:blur(22px) saturate(150%) brightness(.92);\n}\n/* 跟指针走的光斑：白 -> 青 */\n[data-effort-slider][data-skin=\"fluid\"] .es-panel::before{\n  background:radial-gradient(240px 240px at var(--es-gx,50%) var(--es-gy,-12%),\n    rgba(55,224,216,.22),rgba(120,200,210,.07) 36%,rgba(55,224,216,0) 68%);\n}\n/* 镜面亮边：白 -> 青（左上最亮、向右下渐隐，光线绕边走的错觉保留） */\n[data-effort-slider][data-skin=\"fluid\"] .es-panel::after{\n  background:linear-gradient(150deg,\n    rgba(120,200,210,.72) 0%,rgba(120,200,210,.22) 26%,rgba(55,224,216,.05) 52%,\n    rgba(120,200,210,.08) 74%,rgba(120,200,210,.24) 100%);\n}\n\n/* ── 收起态胶囊 ── */\n[data-effort-slider][data-skin=\"fluid\"] .es-pill{\n  color:#e4edf4;\n  background:\n    repeating-linear-gradient(180deg,rgba(120,200,210,.05) 0 1px,transparent 1px 4px),\n    linear-gradient(158deg,rgba(24,32,42,.94),rgba(11,15,21,.97));\n  box-shadow:\n    0 4px 14px rgba(4,8,12,.42),\n    0 0 18px rgba(55,224,216,.10);\n  -webkit-backdrop-filter:blur(16px) saturate(150%) brightness(.92);\n  backdrop-filter:blur(16px) saturate(150%) brightness(.92);\n}\n[data-effort-slider][data-skin=\"fluid\"] .es-pill::before{\n  background:linear-gradient(150deg,\n    rgba(120,200,210,.78) 0%,rgba(120,200,210,.24) 30%,rgba(55,224,216,.06) 55%,\n    rgba(120,200,210,.09) 78%,rgba(120,200,210,.28) 100%);\n}\n[data-effort-slider][data-skin=\"fluid\"] .es-pill::after{\n  background:radial-gradient(64px 64px at var(--es-gx,50%) var(--es-gy,50%),\n    rgba(55,224,216,.26),rgba(55,224,216,0) 70%);\n}\n[data-effort-slider][data-skin=\"fluid\"] .es-pill:hover{\n  background:\n    repeating-linear-gradient(180deg,rgba(120,200,210,.06) 0 1px,transparent 1px 4px),\n    linear-gradient(158deg,rgba(30,40,52,.96),rgba(14,19,26,.98));\n  box-shadow:\n    0 6px 18px rgba(4,8,12,.48),\n    0 0 24px rgba(55,224,216,.20);\n}\n\n/* ── 轨道：蓝黑本体 + 罗德岛青色细边（fluid 的填充由 canvas 画，见 client.js 彗尾） ── */\n[data-effort-slider][data-skin=\"fluid\"] .es-rail{\n  background:linear-gradient(180deg,rgba(24,32,42,.92),rgba(11,15,21,.96));\n  box-shadow:\n    0 0 0 1px rgba(120,200,210,.18) inset,\n    0 2px 10px rgba(4,8,12,.45) inset;\n}\n/* 刻度线：白 -> 罗德岛 hairline 青 */\n[data-effort-slider][data-skin=\"fluid\"] .es-rail__grid i{background:rgba(120,200,210,.20)}\n\n/* ══════════════════════════════════════════════════════════════════════════════\n   ★ 罗德岛 · 旋钮与 chrome 皮肤\n\n   为什么色值重映射没管这里：\n   旋钮的白来自 #fff / #ffffff —— 色度 0，rhodes-verify.mjs 会（正确地）\n   把它判成\"中性\"放过。但面板玻璃的白色高光**该留白**（那是反光），\n   旋钮的实心白球**不该**：它是一颗珠子，罗德岛的珠子是青的。\n   所以白球只能按选择器改，不能按色值一刀切。\n\n   chrome 皮肤另当别论：它本来是银白液态金属（填充 #ffffff→#6c7d7c、\n   珠子白银径向），收成\"罗德岛金属\"要连填充和珠子一起换，光换强调色不够。\n   holo 皮肤本来就是青的，渲染确认无误，不动。\n   ══════════════════════════════════════════════════════════════════════════════ */\n\n/* ── 白珍珠 -> 青色能量珠（fluid / nebula）── */\n[data-effort-slider][data-skin=\"fluid\"] .es-knob,\n[data-effort-slider][data-skin=\"nebula\"] .es-knob{\n  background:radial-gradient(circle at 36% 28%,#e8fbf8 0 20%,#8feee6 44%,#37e0d8 72%,#1d7d78 100%);\n  box-shadow:\n    0 0 0 1px rgba(216,251,247,.75),\n    0 0 12px rgba(55,224,216,.70),\n    0 0 26px rgba(55,224,216,.50),\n    0 2px 8px rgba(4,8,12,.5);\n}\n\n/* ── chrome：银白液态金属 -> 罗德岛金属（青）── */\n[data-effort-slider][data-skin=\"chrome\"] .es-knob{\n  background:radial-gradient(circle at 32% 24%,#eafaf7 0 20%,#b8f2ec 42%,#37e0d8 68%,#12474a 100%);\n  box-shadow:\n    0 0 0 1px rgba(216,251,247,.6),\n    0 2px 8px rgba(4,8,12,.6),\n    0 9px 18px rgba(4,8,12,.42);\n}\n[data-effort-slider][data-skin=\"chrome\"] .es-rail__fill{\n  background:linear-gradient(180deg,#d8fbf7 0%,#8feee6 26%,#37e0d8 58%,#1d7d78 100%);\n  box-shadow:0 0 14px rgba(55,224,216,.40);\n}\n[data-effort-slider][data-skin=\"chrome\"] .es-rail{\n  box-shadow:\n    0 0 0 1px rgba(120,200,210,.28) inset,\n    0 1px 0 rgba(216,251,247,.18) inset,\n    0 6px 16px rgba(4,8,12,.75) inset;\n}\n[data-effort-slider][data-skin=\"chrome\"] .es-panel{border-color:rgba(120,200,210,.28)}\n[data-effort-slider][data-skin=\"chrome\"] .es-pill{border-color:rgba(120,200,210,.24)}\n\n/* ══════════════════════════════════════════════════════════════════════════════\n   ★ 粒子引擎接上 holo\n\n   引擎只有一台（旋度流场 + destination-out 擦拖尾 + 最高档星痕层），皮肤在 FLUID_SKINS\n   里改参数（client.js）。这里只做两件事：让 canvas 显示出来，并把填充条让给 canvas ——\n   否则 CSS 渐变会盖在粒子上，等于白画。\n\n   只接 holo。nebula 试过，退了回来（理由见 client.js 里 FLUID_SKINS 那段注释）；\n   chrome 是液态金属，铺粒子会把金属变成雾。\n   ══════════════════════════════════════════════════════════════════════════════ */\n\n[data-effort-slider][data-skin=\"holo\"] .es-rail__fluid{display:block}\n[data-effort-slider][data-skin=\"holo\"] .es-rail__stars{display:block}\n\n/* 填充让位。::after 那层故意留着：它是 holo 的识别特征 —— 那排 11px 的暗色分隔线，\n   \"仪表刻度\"就是它给的，粒子在它底下扫。 */\n[data-effort-slider][data-skin=\"holo\"] .es-rail__fill{background:transparent;box-shadow:none}\n";

  /**
   * React 运行时。模块顶层就要可用：错误边界类在定义时就会读 React.Component。
   * 由 apply(ctx) 在挂载时经 resolveReact() 注入，尚未注入时先为 null。
   */
  var React = null;

  /**
   * 阶段心跳的可调用句柄：模块级，初值 noop。
   * createApply 里用真正的 report() 覆盖它 —— 组件与错误边界都在模块作用域，
   * 这样它们也能打点，而不用知道端点、fetch 这些细节（组件本来也不该接触 ctx）。
   */
  var reportHeartbeat = noop;

  /**
   * 模块请求器：由 bundle 工厂注入（工厂签名是 `factory(require)`）。
   * 官方规范里 React 是 PLATFORM_MODULES 的 seed，取法是 **在工厂里 require('react')**，
   * 而不是某个叫 React 的 Cordis 服务（那种服务不存在）。
   * 这里把它存下来给 apply() 用；拿不到就返回 null，由 apply 走兜底链。
   */
  function createReactResolver() {
    return function resolve() {
      // 1) 官方姿势：module 表里的 seed 模块
      try {
        if (typeof __esRequire === "function") {
          var mod = __esRequire("react");
          var candidate = mod && (mod.default && mod.default.createElement ? mod.default : mod);
          if (candidate && typeof candidate.createElement === "function") {
            return { React: candidate, source: "require('react')" };
          }
        }
      } catch (error) {
        console.warn("[effort-slider] require('react') 失败：" + String(error));
      }

      // 2) 兜底：全局
      var win = typeof window !== "undefined" ? window : null;
      if (win && win.React && typeof win.React.createElement === "function") {
        return { React: win.React, source: "window.React" };
      }

      // 3) 兜底：从已有 DOM 节点的 React 内部键反查（未文档化，仅作最后手段）
      try {
        var probe = document.querySelector("textarea, [data-composer-card], #root *") || document.body;
        if (probe) {
          var keys = Object.keys(probe);
          for (var i = 0; i < keys.length; i += 1) {
            if (keys[i].indexOf("__reactContainer$") !== 0 && keys[i].indexOf("__reactFiber$") !== 0) continue;
            var node = probe[keys[i]];
            var hops = node && node.return ? node.return : node;
            for (var hop = 0; hops && hop < 60; hop += 1) {
              var owner = hops.stateNode;
              if (owner && typeof owner.createElement === "function") return { React: owner, source: "DOM fiber owner" };
              hops = hops.return;
            }
          }
        }
      } catch (error) { /* 忽略 */ }

      return null;
    };
  }

  var inject = ["slots", "sessions", "modelDirectories", "remote", "remote.session"];

  /**
   * 官方 API 面只导出 apply / inject。工厂会把自己收到的 require 传进来
   * （见文件末尾：`createApply(__initialRequire)`），函数体里没有任何模块级副作用。
   */
  /**
   * 这颗会话是不是**子代理会话**（决定滑条显不显示）。
   *
   * ⚠️ 绝对不要用 `ctx.sessions.subagentAddress(id)` 判 —— 它是**导航**概念
   * （"这颗会话在目录里挂在哪个父下、面包屑怎么走"），不是"这是不是一次子代理运行"：
   *   · `SessionManager` 构造时会把**持久化**的 `selection.subagentAddress` 重新种进 `addresses`；
   *   · `select()` 只要 `navigationAddress()` 能从**目录**推导出地址，就 `addresses.set()` 进去；
   *   · `addresses` **只增不删**（整个实现里没有任何一处 `delete`）。
   * 于是只要这颗会话在某个目录里被列为 child（本机装了 agents-anywhere），一次 select 之后
   * `subagentAddress(id)` 就永远返回 defined → 控件**永久隐藏**，而且刷新、重启都照旧。
   *
   * 2026-10-01 现场（用户：重启后看不到滑动条）：
   *   主会话 `session-<某个真实主会话 id>`，会话头 `delegationDepth=0`、没有 `parentSession`；
   *   渲染器持久化选择里只有 `{"sessionId":"session-<同上>"}`，**没有** subagentAddress
   *   —— 说明那个地址不是从磁盘恢复的，而是 `select()` 从目录推导后**当场上锁**的。
   *   日志证据：`inject` 心跳是 ok 且**没有** degraded 标记（所以不是异常降级），
   *   紧接着 `mount 失败（available=false）`。
   *
   * 正确判据用会话自身的持久事实：客户端列表投影里的 `byId[id].origin === 'subagent'`。
   * （DSH 自己的 UI 也是这么读的：`ctx.sessions.list.getSnapshot().byId[current]`。）
   * 注意投影把 `parentSessionId` 改名成了 `parentId`，而**分叉（fork）出来的会话也有 parentId
   * 却不是子代理运行** —— 所以只认 `origin`，不认 parentId。
   *
   * 读不到摘要时**放行**（fail-open）：组件本身在没有推理档位时会自己渲染 null，
   * 放行最多是"多显示一次"，判错则会让用户彻底看不到控件 —— 两种代价不对称。
   */
  function isSubagentSession(ctx, sessionId) {
    try {
      var sessions = ctx && ctx.sessions;
      if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return false;
      var snapshot = sessions.list.getSnapshot();
      var byId = snapshot && snapshot.byId;
      if (!byId) return false;
      var row = typeof byId.get === "function" ? byId.get(sessionId) : byId[sessionId];
      if (!row) return false;                       // 列表里还没这颗会话（新建中）→ 放行
      return row.origin === "subagent";
    } catch (error) {
      return false;                                 // 判据自身出错也放行，绝不因此隐藏控件
    }
  }

  /**
   * ModelDirectory 的正规初始快照（与 app.asar 里的一致；smoke-test 也从那里抄了一份）。
   *
   * ★ 必须是**模块级共享的同一个对象**：组件用 `useSyncExternalStore` 消费 store，
   *   靠 `Object.is` 比对快照。如果每次都给一个新字面量，React 会判定"变了" →
   *   重渲染 → 又拿一个新字面量 → **无限重渲染**（这个插件第一版就是这么把界面搞卡的）。
   */
  var EMPTY_MODEL_SNAPSHOT = { current: null, routable: null, groups: [], failures: [], status: "idle", error: null };

  /**
   * 懒解析 + **自愈**的模型目录 store 适配器。
   *
   * 为什么需要它（2026-10-01 现场："重启后看不到滑动条"）：
   *   `ctx.modelDirectories.directoryFor(sessionId)` 在会话作用域还没起来时会**按设计抛错**：
   *     · `ui-model-selection: session "…" resolved no scope`
   *     · `ui-model-selection: session "…" resolved no binding`
   *   旧实现把「取目录」和「判子代理」塞在**同一个 try** 里，catch 一旦命中就返回
   *   `{ available:false, store:null }` —— 于是"启动期一次时序抖动"被放大成
   *   **永久隐身**：控件消失，日志只留一句 `available=false` 不说原因，而且**没有任何重试**。
   *   证据：mount 心跳里的 `store=no`。非降级路径必定带 `directory.store`
   *   （对象、恒为真 —— DSH 自己的 /model 选择器就读 `directory.store.getSnapshot()`），
   *   所以 `store=no` 只可能来自降级路径。
   *
   * 这个适配器的作用：**永不抛错**，拿不到真 store 就先给出 ModelDirectory 的正规空快照
   * （组件会渲染"加载态"胶囊，而不是一块 count=0 的残缺控件），并在有人订阅时按退避重试，
   * 一旦作用域就绪就自动接上真 store → 控件自己出现，**不需要用户刷新或重启**。
   */
  function createLazyDirectoryStore(ctx, sessionId, onFailure, onIdle, onActive) {
    var EMPTY = EMPTY_MODEL_SNAPSHOT;
    var listeners = [];
    var timer = null;
    var inner = null;          // 解析成功后的真 store
    var innerUnsubscribe = null;
    var subscribedInner = null;
    var subscriptionGeneration = 0;
    var liveDirectory = null;  // 解析成功后的真目录（load/select 都在它身上）
    var attempts = 0;
    var lastError = null;
    var stopped = false;
    var closed = false;
    var lastKick = 0;          // getSnapshot 里"限流重试 load"的时间戳
    var MAX_ATTEMPTS = 10;

    function notify() {
      var snapshot = listeners.slice();
      for (var i = 0; i < snapshot.length; i += 1) {
        try { snapshot[i](); } catch (error) { /* 订阅者自己的异常不关我们的事 */ }
      }
    }
    function later(fn, ms) {
      if (timer !== null || stopped || listeners.length === 0) return;
      try {
        if (typeof setTimeout === "function") { timer = setTimeout(fn, ms); return; }
      } catch (error) { /* 落到下面 */ }
      timer = null;   // 没有定时器就只靠 getSnapshot 同步重试
    }
    function detachInner() {
      subscriptionGeneration += 1;
      var unsubscribe = innerUnsubscribe;
      innerUnsubscribe = null;
      subscribedInner = null;
      if (typeof unsubscribe === "function") {
        try { unsubscribe(); } catch (error) { /* Host cleanup is best effort. */ }
      }
    }
    function attachInner() {
      if (!inner || stopped || listeners.length === 0 || subscribedInner === inner) return;
      if (typeof inner.subscribe !== "function") return;
      var generation = ++subscriptionGeneration;
      subscribedInner = inner;
      try {
        innerUnsubscribe = inner.subscribe(function () {
          if (!stopped && generation === subscriptionGeneration && listeners.length > 0) notify();
        });
      } catch (error) { subscribedInner = null; innerUnsubscribe = null; }
    }
    /** 采纳一个目录：订阅它的 store、立刻 load、必要时通知订阅者。永不抛错。 */
    function adopt(fresh, quiet) {
      if (fresh.store !== inner) detachInner();
      liveDirectory = fresh;
      inner = fresh.store;
      attachInner();
      // ★ 目录一就绪就**主动 load**：不 load 的话 store 会停在 `idle`（`count=0`），
      //   面板里没有任何档位，而每次点档位都会走到 select 并被拒 —— 用户看到的
      //   "一直提示档位切换失败"就是这个状态。失败原因必须报出去（见 onFailure）。
      kickLoad("adopt");
      if (!quiet) notify();
      return inner;
    }
    /** 调一次 directory.load()（吞掉同步抛与异步拒绝，但把原因报出去）。 */
    function kickLoad(stage) {
      if (stopped || liveDirectory === null || typeof liveDirectory.load !== "function") return;
      var now = Date.now();
      if (lastKick && now - lastKick < 400) return;
      lastKick = now;
      var directory = liveDirectory;
      try {
        Promise.resolve(directory.load()).catch(function (error) {
          if (!stopped && directory === liveDirectory) onFailure(stage, error);
        });
      } catch (error) { onFailure(stage, error); }
    }
    /** store 是否"已经载入过"：停在 idle/error 的都算没就绪。 */
    function storeUsable(store) {
      if (!store) return false;
      try {
        var snap = store.getSnapshot();
        return !!(snap && snap.status && snap.status !== "idle" && snap.status !== "error");
      } catch (error) { return false; }
    }
    /** 重新解析一次目录。不同实例就采纳；解析失败保留旧的。永不抛错。 */
    function resolveFresh(quiet) {
      if (stopped) return null;
      attempts += 1;
      try {
        var fresh = ctx.modelDirectories.directoryFor(sessionId);
        if (fresh && fresh.store && typeof fresh.store.getSnapshot === "function") {
          if (fresh !== liveDirectory) adopt(fresh, quiet);
          return liveDirectory;
        }
        lastError = new Error("directoryFor 返回的目录不完整");
      } catch (error) {
        lastError = error;
      }
      // 退避重试：60ms → 240ms → 540ms …（最多 10 次，约 2 秒），避免永远打转
      if (!stopped && inner === null && attempts < MAX_ATTEMPTS && listeners.length > 0) {
        later(function () { timer = null; resolveFresh(false); }, Math.min(2000, 60 * attempts * attempts));
      }
      return null;
    }

    resolveFresh(true);   // 先同步试一次（绝大多数情况一次就成）

    var adapter = {
      getSnapshot: function () {
        if (stopped) return EMPTY;
        if (inner !== null) {
          if (storeUsable(inner)) {
            try { return inner.getSnapshot(); } catch (error) { return EMPTY; }
          }
          // 停在 idle/error：可能是上一次 load 失败（例如会话作用域还没就绪）。
          // 重新解析一次（也许已经换到就绪的目录上），并**限流地重试 load** ——
          // 但这里在渲染路径上，绝不能同步 notify（会变成渲染期更新别的组件）。
          var fresh = resolveFresh(true);
          if (fresh !== null && storeUsable(inner)) {
            try { return inner.getSnapshot(); } catch (error) { /* 落到下面 */ }
          }
          kickLoad("retry");
          try { return inner.getSnapshot(); } catch (error) { return EMPTY; }
        }
        var resolved = resolveFresh(true);
        if (resolved !== null && storeUsable(inner)) {
          try { return inner.getSnapshot(); } catch (error) { /* 落到下面 */ }
        }
        return EMPTY;
      },
      /**
       * 取当前可用的**真目录**（含 load/select）。每次调用都重新解析一遍：
       * DSH 侧 `directoryFor` 对同一会话是缓存的（廉价），但会话作用域被重建、
       * 或上次拿到的是失效目录时，只有这样才接得上新的那个。
       * `load` / `commit` **必须**在调用时走这里，不能用 inject 那一刻抓到的引用 ——
       * 那个引用可能已经失效，一次抖动就会变成永久坏的控件（用户实测的"一直提示档位切换失败"）。
       * 解析失败时返回上一次成功拿到的目录（至少 store 还能读），没有就返回 null。
       */
      resolveDirectory: function () {
        var fresh = resolveFresh(false);
        return fresh !== null ? fresh : liveDirectory;
      },
      subscribe: function (listener) {
        if (closed) return noop;
        if (listeners.length === 0) {
          stopped = false;
          attempts = 0;
        }
        listeners.push(listener);
        if (listeners.length === 1 && typeof onActive === "function") onActive(adapter);
        resolveFresh(true);
        attachInner();
        var unsubscribed = false;
        return function () {
          if (unsubscribed) return;
          unsubscribed = true;
          var i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
          // 只停"重试定时器"，**不**把适配器标记为永久停止：
          // React 的 StrictMode 会订阅/退订各跑一次，标成 stopped 会把后续重试一起掐死。
          if (listeners.length === 0 && timer !== null) {
            try { clearTimeout(timer); } catch (error) { /* 忽略 */ }
            timer = null;
          }
          if (listeners.length === 0) {
            detachInner();
            if (typeof onIdle === "function") onIdle(adapter);
          }
        };
      },
      hasSubscribers: function () { return listeners.length > 0; },
      // Idle eviction is reversible for a render that already holds this store;
      // closing the plugin permanently disables future work.
      dispose: function (permanent) {
        stopped = true;
        if (permanent) { closed = true; listeners.length = 0; }
        if (timer !== null) clearTimeout(timer);
        timer = null;
        detachInner();
        inner = null;
        liveDirectory = null;
        attempts = 0;
        lastKick = 0;
      },
      /** 诊断（心跳 note 用）：解析状态，不参与渲染。 */
      retryState: function () {
        return {
          resolved: liveDirectory !== null,
          usable: storeUsable(inner),
          attempts: attempts,
          error: lastError ? String((lastError && lastError.message) || lastError) : null,
        };
      },
    };
    return adapter;
  }

  /**
   * 一句话说明"控件这次为什么显示/隐藏"——直接进宿主日志的 inject 心跳。
   * 只做字符串拼装，不碰任何服务，永不抛错。
   *
   * ★ `addr=` 是**诊断**，不是判据：DSH 自己的 `ModelDirectory.available()` 就是
   *   `sessions.subagentAddress(sessionId) === undefined`（见 app.asar 的 directoryFor），
   *   而 `assertAvailable()` 会在 `load()` / `select()` 的第一行抛
   *   "model selection is unavailable for addressed subagent sessions"。
   *   所以只要这个值是 defined，DSH 就会拒绝加载与写回 —— 控件会显示但永远是空的、
   *   点档位必失败。把它写进日志才能一眼区分"地址被上锁"和"目录被 dispose"。
   *   **不要再拿它当显隐判据**：那是导航状态，只增不删（§4-I）。
   */
  function degradedNote(ctx, sessionId, subagent, directoryError, lazy) {
    var parts = [];
    if (subagent) parts.push("本会话 origin=subagent，控件按设计隐藏");
    else parts.push("本会话非子代理，控件应显示");
    try {
      var address = ctx && ctx.sessions && typeof ctx.sessions.subagentAddress === "function"
        ? ctx.sessions.subagentAddress(sessionId) : null;
      parts.push("addr=" + (address === undefined || address === null
        ? "clear" : "defined(" + String(address.parentSessionId || "?") + ")"));
    } catch (error) { parts.push("addr=读不到"); }
    if (directoryError) {
      parts.push("取模型目录抛错：" + String((directoryError && directoryError.message) || directoryError));
    }
    if (lazy) {
      try {
        var state = lazy.retryState();
        parts.push("resolve=" + JSON.stringify(state));
      } catch (error) { /* 诊断失败不影响返回 */ }
    }
    return parts.join("；");
  }

  function createApply(__esRequire) {
    var resolveReact = createReactResolver();

    /**
     * 心跳代次 nonce：宿主每次 apply 生成一个随机串，客户端 GET 同一端点读 `reportNonce`。
     * 取用是异步的、绝不阻塞任何东西；拿不到就保持 null —— 心跳照发（宿主按代次忽略），
     * 但绝不因为取不到 nonce 而报错、重试或改变行为。
     *
     * ⚠️ 现场事故（2026-10-01）：POST 心跳与 GET nonce 是并发的，早发的几条会在 nonce 还没
     * 回来时被宿主按「旧实例」拒收 —— 表现是只剩 apply（宿主接受的首个引导信号）和 nonce
     * 就绪后的 inject，中间的 resolveReact / slotRegistered / mount 整段丢失，宿主据此误判
     * "卡在 resolveReact"，而界面其实完全正常。所以：nonce 未就绪时先排队，拿到后按原顺序补发。
     */
    var nonce = null;
    var nonceReady = false;
    var pendingReports = [];              // 等 nonce 补发的上报（有界，见 MAX_PENDING_REPORTS）
    var MAX_PENDING_REPORTS = 8;
    try {
      fetch(ENDPOINT, { headers: { Accept: "application/json" } }).then(function (response) {
        return response && response.ok ? response.json() : null;
      }).then(function (body) {
        if (nonceReady) return;   // 幂等：只认第一次拿到的代次，后续再拿到也不重复排队/补发
        if (!body || typeof body.reportNonce !== "string" || body.reportNonce === "") return;
        nonce = body.reportNonce;
        nonceReady = true;
        // 按原顺序补发：此时 nonce 已就绪，每条都会带上它，宿主才会接受
        var queue = pendingReports;
        pendingReports = [];
        for (var i = 0; i < queue.length; i += 1) sendReport(queue[i].phase, queue[i].extra);
      }).catch(noop);
    } catch (error) { /* 取 nonce 失败：心跳照旧（不带 nonce），其余一切不受影响 */ }

    /**
     * 真正把一条心跳发出去。best-effort：不 await、不重试、不抛错；
     * fetch 的拒绝、甚至 fetch 本身同步抛（环境里没有 fetch / 相对 URL 不可用）都吞掉。
     *
     * 载荷契约：{ report: { phase, status, nonce?, source?, error?, sessionId?, degraded? } }
     *  · status："ok" = 该阶段成功；"error" = 该阶段失败（必带 error）。
     *    **失败也必须上报** —— 否则宿主把它当成「该阶段已达成」，就会误判成"成功了只是没挂载"。
     *  · nonce：本页面代次。宿主只认与当前代次一致的上报，旧页面 / 旧启动残留的心跳因此失效。
     */
    function sendReport(phase, extra) {
      try {
        var options = extra || {};
        var payload = { report: { phase: phase, status: options.status ? String(options.status) : "ok" } };
        if (nonce) payload.report.nonce = nonce;
        if (options.source) payload.report.source = String(options.source);
        if (options.error) payload.report.error = String(options.error);
        if (options.sessionId) payload.report.sessionId = String(options.sessionId);
        if (options.degraded) payload.report.degraded = String(options.degraded);
        // ★ note 必须在这里显式转发：sendReport 是**白名单**，不写就不会发出去 ——
        //   宿主那边加好渲染了、客户端却没送，结果就是"日志里仍然没有原因"（踩过）。
        if (options.note) payload.report.note = String(options.note);
        fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(noop);
      } catch (error) { /* 打点失败一律忽略 */ }
    }

    /**
     * 上报一个阶段（对外唯一入口，组件 / 错误边界经 reportHeartbeat 也走这里）。
     * nonce 未就绪时不能直发（会被宿主当旧实例拒收），先排队等补发；
     * 例外是 apply：宿主明确接受「尚无任何心跳时」的无 nonce 引导信号，先报出去让宿主
     * 尽早看到 bundle 执行了，而且它不进队列 —— 补发只会是同一阶段的重复上报。
     */
    function report(phase, extra) {
      if (nonceReady && nonce) { sendReport(phase, extra); return; }
      if (phase === "apply") { sendReport(phase, extra); return; }
      if (pendingReports.length >= MAX_PENDING_REPORTS) pendingReports.shift();   // 有界：丢最旧的
      pendingReports.push({ phase: phase, extra: extra });
    }
    // 接上模块级句柄：组件挂载 / 错误边界抛错时也要能打点
    reportHeartbeat = report;

    return function apply(ctx) {
      report("apply", { status: "ok" });   // 阶段 1：进入 apply 即 ok —— 能报到就说明模块体执行了
      var found = resolveReact();
        if (!found) {
          // 阶段 2（失败分支）：三条取 React 的路都断了，宿主应当能看到"卡在 resolveReact"
          report("resolveReact", { status: "error", error: "React 运行时不可用：require('react') / window.React / DOM 兜底都失败" });
          console.error("[effort-slider] 拿不到 React 运行时（require('react') / window.React / DOM 三条路都失败），控件不会挂载");
          return;
        }
        // 阶段 2（成功分支）：带上来源，宿主一眼知道是走哪条路拿到的
        report("resolveReact", { status: "ok", source: found.source });
        React = found.React;
        console.info("[effort-slider] React 运行时来源: " + found.source);

      var styles = ctx.get("styles");
      if (styles && typeof styles.insert === "function") {
        ctx.effect(function () { return styles.insert(CSS); }, "effort-slider: styles");
      } else {
        var node = document.createElement("style");
        node.dataset.plugin = PACKAGE_ID;
        node.textContent = CSS;
        document.head.append(node);
        ctx.effect(function () { return function () { node.remove(); }; }, "effort-slider: styles");
      }

      var api = {
        cachedSkin: function () {
          try { return window.localStorage.getItem(STORAGE_KEY); } catch (error) { return null; }
        },
        cacheSkin: function (skin) {
          try { window.localStorage.setItem(STORAGE_KEY, skin); } catch (error) { /* 忽略 */ }
        },
        fetchSkin: function () {
          return fetch(ENDPOINT, { headers: { Accept: "application/json" } }).then(function (response) {
            return response.ok ? response.json() : null;
          }).then(function (body) {
            return body && typeof body.skin === "string" ? body.skin : null;
          });
        },
        saveSkin: function (skin) {
          return fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ skin: skin }),
          }).catch(function () { /* 持久化失败不影响当前观感 */ });
        },
        notify: function (message) {
          console.warn("[effort-slider] " + message);
        },
      };

      var preferences = createPreferences(api);

      /**
       * 自愈适配器的**按会话缓存**。
       *
       * ★ 必须缓存实例：`inject` 会被插槽系统反复调用，若每次都新建适配器，组件拿到的
       *   `store` prop 就每次都换引用 → `useSyncExternalStore` 判定快照变了 → 重渲染 →
       *   又新建一个适配器 → **无限重渲染**。保留活跃与最近使用的适配器引用；
       * 闲置缓存最多 32 个，淘汰时释放资源。已渲染的旧引用仍可再次订阅。
       */
      var lazyDirectoryStores = new Map();
      // A concurrently held render can subscribe after idle cache eviction.
      // Track those adapters only while subscribed so plugin cleanup still owns them.
      var activeDirectoryStores = new Set();
      var MAX_IDLE_DIRECTORY_STORES = 32;
      var directoryCacheTimer = null;
      var directoryCacheClosed = false;
      function trimDirectoryStores() {
        directoryCacheTimer = null;
        var idle = [];
        lazyDirectoryStores.forEach(function (store, id) {
          if (!store.hasSubscribers()) idle.push(id);
        });
        for (var i = 0; i < idle.length - MAX_IDLE_DIRECTORY_STORES; i += 1) {
          var store = lazyDirectoryStores.get(idle[i]);
          if (!store || store.hasSubscribers()) continue;
          lazyDirectoryStores.delete(idle[i]);
          store.dispose(false);
        }
      }
      function scheduleDirectoryTrim() {
        if (!directoryCacheClosed && directoryCacheTimer === null) {
          directoryCacheTimer = setTimeout(trimDirectoryStores, 0);
        }
      }
      ctx.effect(function () {
        return function () {
          directoryCacheClosed = true;
          if (directoryCacheTimer !== null) clearTimeout(directoryCacheTimer);
          directoryCacheTimer = null;
          lazyDirectoryStores.forEach(function (store) { store.dispose(true); });
          activeDirectoryStores.forEach(function (store) { store.dispose(true); });
          lazyDirectoryStores.clear();
          activeDirectoryStores.clear();
        };
      }, "effort-slider: model directory stores");
      /**
       * 模型目录的失败上报。**必须能到宿主日志** —— 之前 load/select 的拒绝被静默吞掉，
       * 于是"档位切换失败"只有一个用户可见的提示，日志里查不到任何原因。
       * 只报第一条（同一条错误会随每次点击重复），避免刷屏。
       */
      var directoryFailureReported = false;
      function reportDirectoryFailure(stage, error) {
        var message = stage + "：" + String((error && error.message) || error);
        try { console.warn("[effort-slider] 模型目录 " + message); } catch (ignore) { /* 忽略 */ }
        if (directoryFailureReported) return;
        directoryFailureReported = true;
        try { report("directory", { status: "error", error: message }); } catch (ignore) { /* 打点失败不影响功能 */ }
      }
      function lazyDirectoryStoreFor(sessionId) {
        var cached = lazyDirectoryStores.get(sessionId);
        if (cached !== undefined) {
          lazyDirectoryStores.delete(sessionId);
          lazyDirectoryStores.set(sessionId, cached);
          return cached;
        }
        var created = createLazyDirectoryStore(ctx, sessionId, reportDirectoryFailure,
          function (store) { activeDirectoryStores.delete(store); scheduleDirectoryTrim(); },
          function (store) { activeDirectoryStores.add(store); });
        if (directoryCacheClosed) { created.dispose(true); return created; }
        lazyDirectoryStores.set(sessionId, created);
        scheduleDirectoryTrim();
        return created;
      }

      try {
        ctx.slots.inject("conversation.input.right", function () {
          var registration;
          try {
            registration = ctx.slots.register({
              name: "conversation.input.right",
              id: "effort-slider",
              order: 30,
              label: function () { return "Reasoning effort"; },
            inject: function (sessionId) {
              // F6：这段是插槽系统直接调的，任何异常都不能抛回插槽/输入区（那会连累宿主）。
              //
              // ⚠️ 但"不抛错"≠"降级成不显示"。—— 2026-10-01 事故就是这么来的：
              //    取目录和判子代理共用一个 try，`directoryFor()` 在会话作用域还没起来时
              //    按设计抛错（resolved no scope / no binding），一次启动期抖动就被放大成
              //    **永久隐身**，而且没有重试。所以现在**分三段各自兜住**，且只有
              //    "确实是子代理会话"才隐藏；内部错误一律走自愈适配器，绝不隐藏控件。
              var subagent = isSubagentSession(ctx, sessionId);   // 自带 try/catch，失败按"不是"处理
              var available = !subagent;

              var directory = null;
              var directoryError = null;
              try {
                directory = ctx.modelDirectories.directoryFor(sessionId);
              } catch (error) {
                directoryError = error;
              }
              // ★ 一律走适配器（即使这次拿到了目录）。"抓一次目录揣着用"是有害的：
              //   目录可能属于上一代 / 已被 dispose / store 停在 idle，那时 `load`/`commit`
              //   会一直失败 —— 用户实测的"一直提示档位切换失败"就是这种永久坏控件。
              //   适配器按会话缓存实例（store 引用稳定，不会无限重渲染），并且：
              //   · 目录一就绪就主动 load（否则 count=0，面板里没有档位）
              //   · load/commit 在**调用时**重新解析目录，所以它自己会恢复
              //   · 失败原因经 onFailure 上报（宿主日志能看到，不再静默）
              var lazy = lazyDirectoryStoreFor(sessionId);
              var store = lazy;
              var note = degradedNote(ctx, sessionId, subagent, directoryError, lazy);
              // 阶段 4：插槽回调确实被执行了就算 ok。
              // 只报一条（宿主按阶段名去重、只记第一次），但 note 必须能说出"为什么"——
              // 这条事故之所以难查，就是因为日志只说了 available=false 而没说是谁导致的。
              reportHeartbeat("inject", {
                status: "ok",
                sessionId: sessionId,
                degraded: directoryError !== null,
                note: note,
              });

              return {
                api: api,
                preferences: preferences,
                // ★ 会话 id 必须往组件里传：turbo 路由（GET/PATCH）靠它精确定位到这一颗会话。
                //   宿主实现侧会读；拿不到时组件自己会跳过全部 turbo 请求（fail-open）。
                sessionId: sessionId,
                available: available,
                store: store,
                load: function () {
                  if (!available) return;
                  var target = lazy.resolveDirectory();
                  if (!target) return;   // 目录还没就绪，适配器会自己在重试定时器里 load
                  try {
                    Promise.resolve(target.load()).catch(function (error) { reportDirectoryFailure("load", error); });
                  } catch (error) { reportDirectoryFailure("load", error); }
                },
                commit: function (selection) {
                  if (!available) return Promise.resolve(false);
                  var target = lazy.resolveDirectory();
                  if (!target) {
                    reportDirectoryFailure("select", new Error("模型目录不可用（directoryFor 仍未成功）"));
                    return Promise.resolve(false);
                  }
                  try {
                    return Promise.resolve(target.select(selection)).then(
                      function () { return true; },
                      function (error) { reportDirectoryFailure("select", error); return false; },
                    );
                  } catch (error) {
                    // select 同步抛：等价于「没写成功」，交给调用方走回滚，别冒泡
                    reportDirectoryFailure("select", error);
                    return Promise.resolve(false);
                  }
                },
              };
            },
          }, boundary());
          } catch (error) {
            // 阶段 3（失败分支）：注册抛错必须显式报 error，否则宿主只会看到"slotRegistered 没来"，
            // 分不清是没执行还是注册炸了；报完照旧往外抛，让外层 catch 记录日志
            report("slotRegistered", { status: "error", error: String(error && error.message ? error.message : error) });
            throw error;
          }
          // 阶段 3（成功分支）
          report("slotRegistered", { status: "ok" });
          return registration;
        });
        console.info("[effort-slider] 已挂载：conversation.input.right");
      } catch (error) {
        // 注册失败只意味着这个控件不出现，绝不影响宿主其它部分
        console.error("[effort-slider] 插槽注册失败，控件不会出现：", error);
      }
    };
  }

  /**
   * 模块导出 —— 官方形状就是「factory 的返回值 = 模块 exports」。
   *
   * 这里**不再**用 `window.__DSH_EFFORT_SLIDER__` 当导出通道：模块系统的
   * `materialize()` 会先查 `loadCache`，已物化就不再重跑模块体，
   * 于是「新 factory 读旧全局」会拿到陈旧导出（HMR / 重物化路径会踩）。
   * 直接把导出交给 module.exports，导出与「被物化的那个实例」永远一致。
   *
   * `__esRequire` 由构建包装在工厂里提供（`var __esRequire = require;`，必须出现在模块体之前）；
   * 拿不到就传 null —— createApply 里的 resolveReact 会退回 window / DOM 兜底。
   */
  var __initialRequire = (typeof __esRequire === "function") ? __esRequire : null;
  module.exports = {
    apply: createApply(__initialRequire),
    inject: inject,
  };
})();

    if (module.exports && typeof module.exports.apply === 'function') return module.exports;
    throw new Error('dsh-effort-slider: bundle 未设置导出（require 或模块体有问题）');
  },
});
