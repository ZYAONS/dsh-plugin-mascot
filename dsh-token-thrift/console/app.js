/**
 * dsh-token-thrift 的控制台。
 *
 * 两件事：把教练现在在做什么画清楚，以及**让它现在就能改**。
 * 档位和预算在这里改了立刻生效 —— 不用重启，不用改 profile。写着的是运行时覆盖，
 * 重启回到文件里的值，页面会同时显示"文件里是什么"和"现在是什么"。
 *
 * 控件只建一次，之后每次轮询只改数值：整个页面重画会把正在输入的预算框焦点冲掉。
 */
(function () {
  "use strict";

  var STATE_URL = "/dsh-token-thrift/api/state";
  var SETTINGS_URL = "/dsh-token-thrift/api/settings";
  var RESET_URL = "/dsh-token-thrift/api/reset";
  var POLL_MS = 1500;

  /** 每一档在说人话的时候是什么。键必须和主驾那边的 PRESETS 对齐。 */
  var LEVEL_TEXT = {
    off: "不劝也不遮",
    light: "只劝一次，永不遮工具",
    standard: "两三档劝告，临界才遮",
    strict: "四档劝告，五成半起遮",
  };

  var el = function (id) { return document.getElementById(id); };
  var last = null;
  /** 拖动中的值。松手才提交 —— 每移动一个像素就 POST 一次等于用一百次请求说一件事。 */
  var dialDraft = null;
  /** 调试用的模拟比例；null 表示跟着真实用量走。 */
  var simValue = null;

  function num(value) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    return Math.round(value).toLocaleString("en-US");
  }

  function pct(value) {
    if (typeof value !== "number" || !isFinite(value)) return "—";
    return String(Math.round(value * 100)) + "%";
  }

  /** 和浏览器半边同一套：数字说不出来 40% 算不算多，颜色能。 */
  function tone(ratio) {
    if (typeof ratio !== "number" || !isFinite(ratio)) return "var(--accent)";
    if (ratio >= 0.9) return "var(--alarm)";
    if (ratio >= 0.7) return "var(--warn)";
    if (ratio >= 0.4) return "#ffd34d";
    return "#4fd6a8";
  }

  function toast(message) {
    var node = el("toast");
    node.textContent = message;
    node.hidden = false;
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(function () { node.hidden = true; }, 5200);
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (response) {
      return response.json().catch(function () { return { ok: false, error: "bad_json" }; });
    }).then(function (payload) {
      if (payload.ok !== true) throw new Error(payload.message || payload.error || "请求被拒绝");
      last = payload;
      paint(payload);
      return payload;
    }).catch(function (error) {
      toast(String(error && error.message ? error.message : error));
    });
  }

  /* ---------------------------------------------------------------- 控件，只建一次 */

  /** 离当前力度最近的那个名字，让标签读起来像个词。 */
  function nameFor(intensity) {
    var value = typeof intensity === "number" && isFinite(intensity) ? intensity : 0;
    if (value <= 0) return "off";
    var presets = (last && last.presets) || {};
    var best = "light";
    var distance = Infinity;
    Object.keys(presets).forEach(function (name) {
      if (name === "off") return;
      var gap = Math.abs(presets[name] - value);
      if (gap < distance) { distance = gap; best = name; }
    });
    return best;
  }

  function buildTicks(presets) {
    var host = el("dial-ticks");
    host.textContent = "";
    Object.keys(presets || {}).forEach(function (name) {
      var mark = document.createElement("span");
      mark.style.left = presets[name] + "%";
      mark.textContent = name;
      mark.title = name + " · " + presets[name];
      host.appendChild(mark);
    });
  }

  el("dial-range").addEventListener("input", function () {
    dialDraft = Number(el("dial-range").value);
    el("dial-value").textContent = dialDraft <= 0 ? "关" : String(dialDraft);
    el("dial-words").textContent = dialDraft <= 0 ? LEVEL_TEXT.off : LEVEL_TEXT[nameFor(dialDraft)] || "";
  });
  var commitDial = function () {
    if (dialDraft === null || last === null || dialDraft === last.intensity) { dialDraft = null; return; }
    var value = dialDraft;
    dialDraft = null;
    post(SETTINGS_URL, { intensity: value });
  };
  el("dial-range").addEventListener("change", commitDial);
  el("dial-range").addEventListener("pointerup", commitDial);
  el("dial-range").addEventListener("blur", commitDial);

  el("apply").addEventListener("click", function () {
    var raw = el("budget").value.trim();
    if (raw === "") return post(SETTINGS_URL, { budget: null });
    var value = Number(raw);
    if (!isFinite(value) || value < 0) return toast("预算要是个非负数，或者留空表示回到配置");
    post(SETTINGS_URL, { budget: value });
  });

  el("restore").addEventListener("click", function () {
    post(SETTINGS_URL, { budget: null, intensity: null });
  });

  /* 全力工作：一句话把力度归零。
     这个按钮存在的理由是它对面那句话 ——「我现在要你全力干活，不在乎烧多少」。
     那件事应该是一次点击，而不是先想清楚 0 是不是等于关闭。 */
  el("fullpower").addEventListener("click", function () {
    var off = last !== null && (last.intensity || 0) <= 0;
    // 从关闭恢复到哪一档：优先用配置里的值，配置也没说过就用 standard。
    var back = last !== null && last.configured.intensity >= 0 ? last.configured.intensity : 55;
    post(SETTINGS_URL, { intensity: off ? back : 0 });
  });

  /* 模拟：不改变任何状态，只回答「烧到 X% 的时候，它会对我说什么」。 */
  el("sim").addEventListener("input", function () {
    simValue = el("sim").value.trim() === "" ? null : Number(el("sim").value);
    if (last !== null) renderLadder(last);
  });
  el("sim-clear").addEventListener("click", function () {
    el("sim").value = "";
    simValue = null;
    if (last !== null) renderLadder(last);
  });

  /* ---------------------------------------------------------------- 画 */

  function barFor(report, tiers) {
    var track = document.createElement("div");
    track.className = "track";
    var fill = document.createElement("i");
    var ratio = report.ratio || 0;
    fill.style.width = Math.min(100, Math.round(ratio * 100)) + "%";
    fill.style.background = tone(ratio);
    track.appendChild(fill);
    (tiers || []).forEach(function (mark) {
      var tick = document.createElement("div");
      tick.className = "tick";
      tick.style.left = Math.min(100, Math.round(mark * 100)) + "%";
      var hit = (report.fired || []).some(function (tier) { return tier.ratio === mark && tier.at !== null; });
      tick.dataset.fired = hit ? "1" : "0";
      tick.title = pct(mark) + (hit ? " · 已响" : " · 未响");
      track.appendChild(tick);
    });
    return track;
  }

  function fact(label, value) {
    var node = document.createElement("div");
    node.className = "fact";
    var span = document.createElement("span");
    span.textContent = label + " ";
    var strong = document.createElement("b");
    strong.textContent = value;
    node.appendChild(span);
    node.appendChild(strong);
    return node;
  }

  function currentCard(report) {
    var host = el("current");
    host.textContent = "";
    host.className = "current";
    if (!report) {
      host.className = "current empty";
      host.textContent = "还没有会话在花 token。";
      return;
    }
    // The report carries the tier list it was measured against. The page can change the
    // level, and drawing an old report's marks against the new list would claim tiers
    // fired that never did.
    var tiers = report.tiers || last.tiers || [];
    var who = document.createElement("div");
    who.className = "who";
    var name = document.createElement("b");
    name.textContent = report.sessionId;
    var when = document.createElement("span");
    when.textContent = report.at ? "更新于 " + new Date(report.at).toLocaleTimeString("zh-CN") : "";
    who.appendChild(name);
    who.appendChild(when);
    host.appendChild(who);

    host.appendChild(barFor(report, tiers));
    var scale = document.createElement("div");
    scale.className = "scale";
    ["0%", pct(report.ratio), "100%"].forEach(function (text) {
      var s = document.createElement("span");
      s.textContent = text;
      scale.appendChild(s);
    });
    host.appendChild(scale);

    var facts = document.createElement("div");
    facts.className = "facts";
    facts.appendChild(fact("已花 / 预算", num(report.spent) + " / " + num(last.budget)));
    var fired = (report.fired || []).filter(function (tier) { return tier.at !== null; }).length;
    facts.appendChild(fact("已响档位", fired + " / " + tiers.length));
    facts.appendChild(fact("已提醒", (report.reminders || 0) + " 次（上限 " + last.maxReminders + "）"));
    facts.appendChild(fact("遮罩阈值", last.maskRatio === null ? "永不遮" : pct(last.maskRatio)));
    facts.appendChild(fact("工具", report.masked ? "已遮 " + last.maskTools.length + " 个" : "未遮"));
    host.appendChild(facts);

    // The mask lands during a tool call, so between calls the ratio can be past the
    // threshold while nothing is masked yet. Saying so beats a page that looks stuck.
    if (!report.masked && last.maskRatio !== null && last.maskTools.length > 0 && (report.ratio || 0) >= last.maskRatio) {
      var pending = document.createElement("div");
      pending.className = "pending";
      pending.textContent = "已过遮罩阈值 —— 下一次工具调用时会摘掉 " + last.maskTools.length + " 个会开枝的工具。";
      host.appendChild(pending);
    }

    if (report.masked && last.maskTools.length) {
      var tools = document.createElement("div");
      tools.className = "tools";
      last.maskTools.forEach(function (tool) {
        var code = document.createElement("code");
        code.textContent = tool;
        tools.appendChild(code);
      });
      host.appendChild(tools);
    }
  }

  function sessionCard(report) {
    var node = document.createElement("div");
    node.className = "session";
    var who = document.createElement("div");
    who.className = "who";
    var left = document.createElement("div");
    var name = document.createElement("b");
    name.textContent = report.sessionId;
    left.appendChild(name);
    var meta = document.createElement("span");
    meta.textContent = "  " + num(report.spent) + " / " + num(last.budget) + "  " + pct(report.ratio)
      + (report.masked ? "  · 已遮罩" : "");
    left.appendChild(meta);
    var reset = document.createElement("button");
    reset.className = "reset";
    reset.textContent = "重置";
    reset.title = "让这个会话的档位重新可以响（档位每会话只响一次）";
    reset.addEventListener("click", function () {
      post(RESET_URL, { sessionId: report.sessionId });
    });
    who.appendChild(left);
    who.appendChild(reset);
    node.appendChild(who);
    node.appendChild(barFor(report, report.tiers || last.tiers || []));
    return node;
  }

  /**
   * 调试视图：这一档会在什么时候、对 agent 说哪一句话。
   *
   * 面板和时间轴回答的是「烧到哪了」；这张表回答的是**「它打算说什么」** ——
   * 那是唯一能判断力度调得对不对的东西，而在此之前它只存在于主驾半边的内存里。
   *
   * 模拟框只是把同一个渲染换个比例重跑一遍，不写任何状态：想知道「烧到 80% 会怎样」
   * 不该需要先真的烧掉 80%。
   */
  function renderLadder(state) {
    var ladder = state.ladder || [];
    var live = simValue !== null && isFinite(simValue) ? simValue : (state.reports[0] ? state.reports[0].ratio * 100 : 0);
    var simulating = simValue !== null && isFinite(simValue);
    el("sim-note").textContent = simulating
      ? "模拟中 · 不会真的改变任何东西"
      : (state.reports[0] ? "现在是 " + Math.round(state.reports[0].ratio * 100) + "%" : "还没有会话在花 token");

    var mask = state.maskRatio === null ? null : state.maskRatio * 100;
    var host = el("ladder");
    host.textContent = "";
    if (ladder.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "这一档不劝告。力度是 0，或者档位表是空的。";
      host.appendChild(empty);
    }
    ladder.forEach(function (rung, index) {
      var at = rung.ratio * 100;
      var reached = live >= at;
      var row = document.createElement("div");
      row.className = "rung";
      row.dataset.on = reached ? "1" : "0";
      row.dataset.next = !reached && (index === 0 || live >= ladder[index - 1].ratio * 100) ? "1" : "0";

      var head = document.createElement("div");
      head.className = "rung-head";
      var pct = document.createElement("b");
      pct.textContent = String(Math.round(at)) + "%";
      var tag = document.createElement("span");
      tag.textContent = reached ? (index === 0 || live >= at ? "会响 / 已响" : "") : "";
      head.appendChild(pct);
      head.appendChild(tag);
      row.appendChild(head);

      var text = document.createElement("p");
      text.className = "rung-text";
      text.textContent = rung.text;
      row.appendChild(text);
      host.appendChild(row);
    });

    // 遮罩那一行单独说：它是唯一会动工具表的动作，和「说一句话」不是一回事。
    el("maskline").textContent = mask === null
      ? "遮罩：永不 —— 这一档只劝告，不动工具表。"
      : "遮罩：" + Math.round(mask) + "% 起摘掉 " + (state.maskTools || []).length + " 个会开枝的工具"
        + (live >= mask ? "（已经过了）" : "（还差 " + Math.round(mask - live) + " 个点）");
    el("maskline").dataset.on = mask !== null && live >= mask ? "1" : "0";
  }

  function paint(state) {
    el("raw").textContent = JSON.stringify(state, null, 2);

    var on = state.enabled === true;
    el("state").dataset.on = on ? "1" : "0";
    el("state-text").textContent = on
      ? `${String(state.intensity)}% · ${String(state.level)} · 已启用`
      : (state.budget > 0 ? `${String(state.intensity)}% · 档位为空，没在工作` : "未启用（budget 是 0）");

    paintDial(state);
    renderLadder(state);
    el("fullpower").dataset.off = on ? "0" : "1";
    el("fullpower").title = on ? "把力度归零：不劝、不遮、不占一个 token" : "恢复力度";

    var over = [];
    if (state.overridden.intensity) over.push("力度");
    if (state.overridden.budget) over.push("预算");
    el("configured").textContent = state.overridden.intensity
      ? "配置里 力度 " + String(state.configured.intensity) + "，已被本页覆盖（重启恢复）"
      : "配置里 力度 " + String(state.configured.intensity);
    el("configured-budget").textContent = state.overridden.budget
      ? "配置里 " + num(state.configured.budget) + "，已被本页覆盖（重启恢复）"
      : "配置里 " + num(state.configured.budget) + (over.length === 2 ? "" : "（没有覆盖）");

    if (document.activeElement !== el("budget")) el("budget").value = String(state.budget);

    var reports = state.reports || [];
    currentCard(reports[0]);
    el("count").textContent = reports.length ? "共 " + reports.length + " 个" : "";
    var host = el("sessions");
    host.textContent = "";
    if (reports.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "还没有任何会话被这个教练看过。跑一次工具调用就会出现。";
      host.appendChild(empty);
    } else {
      reports.forEach(function (report) { host.appendChild(sessionCard(report)); });
    }
  }

  var ticksBuilt = "";
  /** The dial's own repaint, kept apart from `paint` because a drag must not fight it. */
  function paintDial(state) {
    var key = JSON.stringify(state.presets || {});
    if (key !== ticksBuilt) {
      ticksBuilt = key;
      buildTicks(state.presets);
    }
    var live = state.intensity || 0;
    if (dialDraft === null) el("dial-range").value = String(live);
    var shown = dialDraft === null ? live : dialDraft;
    el("dial-value").textContent = shown <= 0 ? "关" : String(shown);
    el("dial-words").textContent = shown <= 0 ? LEVEL_TEXT.off : (LEVEL_TEXT[nameFor(shown)] || "");
  }

  function load() {
    fetch(STATE_URL, { headers: { accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("状态接口返回 HTTP " + response.status);
        return response.json();
      })
      .then(function (payload) {
        last = payload;
        paint(payload);
      })
      .catch(function (error) {
        el("state").dataset.on = "err";
        el("state-text").textContent = String(error && error.message ? error.message : error);
      });
  }

  load();
  window.setInterval(load, POLL_MS);
})();
