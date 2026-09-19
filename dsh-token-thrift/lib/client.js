/**
 * dsh-token-thrift —— 浏览器半边：把教练的状态画出来。
 *
 * 教练本身是看不见的：它往上下文里塞提醒、把工具从表里摘掉，两件事都没有反馈。
 * 一个只在"花了多少"上做判断、却不告诉你在判断什么的插件，用起来只能靠猜。
 * 这个面板就是把那件事说清楚：预算烧到哪了、哪一档已经响过、工具是不是已经被遮了。
 *
 * 落在左下角，和吉祥物（右下角）错开；两者都往 `shell.overlay` 这个 list slot 里注册。
 *
 * 数据从主驾半边的 `/dsh-token-thrift/api/state` 拿。教练的状态原本只存在一个
 * 以 agent 为键的 WeakMap 里 —— 对教练来说是对的形状，对外面任何东西都是不可达的，
 * 所以主驾那边每走一步都会额外写一份按 session 归类的快照。
 *
 * @module dsh-token-thrift/client
 */
window.__ModuleLoader__.load({
	id: "dsh-token-thrift",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let React = require("react");
		let h = React.createElement;

		//#region endpoints and tuning
		const STATE_ENDPOINT = "/dsh-token-thrift/api/state";
		/**
		 * How often to ask again.
		 *
		 * The coach only moves when a tool call finishes, so a second is already faster
		 * than the thing it is watching. Polling rather than pushing because the write
		 * happens inside the tool pipeline, and a plugin that has just been taught not to
		 * fail tool calls should not be handed an event bus to fail them through.
		 */
		const POLL_MS = 1500;
		//#endregion

		//#region styles
		const CSS = `
.dsh-thrift-root { position: absolute; left: 20px; bottom: 20px; z-index: 30; pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace;
  font-size: 11px; line-height: 1.5; color: #e8eef7; font-variant-numeric: tabular-nums; }
.dsh-thrift-chip { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 11px 4px 9px; border-radius: 999px; cursor: pointer; user-select: none;
  background: rgba(12, 15, 22, .86); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 4px 14px rgba(0,0,0,.38); backdrop-filter: blur(10px); white-space: nowrap;
  transition: border-color .16s ease, transform .16s ease; }
.dsh-thrift-chip:hover { border-color: var(--dsh-thrift-tone); transform: translateY(-1px); }
.dsh-thrift-chip[data-open="1"] { border-color: var(--dsh-thrift-tone); }
.dsh-thrift-chip b { color: var(--dsh-thrift-tone); font-weight: 700; letter-spacing: .02em; }
.dsh-thrift-chip em { font-style: normal; opacity: .58; }
.dsh-thrift-bar { width: 58px; height: 6px; border-radius: 999px; overflow: hidden; position: relative;
  background: rgba(255,255,255,.13); }
.dsh-thrift-bar > i { display: block; height: 100%; width: 0; background: var(--dsh-thrift-tone);
  border-radius: 999px; transition: width .35s ease; }
.dsh-thrift-panel { pointer-events: auto; position: absolute; left: 0; bottom: calc(100% + 10px);
  width: 336px; padding: 13px 14px 12px; border-radius: 12px;
  background: linear-gradient(158deg, rgba(17,21,30,.97), rgba(9,11,17,.99));
  border: 1px solid rgba(255,255,255,.13); box-shadow: 0 16px 44px rgba(0,0,0,.5);
  backdrop-filter: blur(14px); }
.dsh-thrift-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-thrift-head b { font-size: 12px; letter-spacing: .04em; }
.dsh-thrift-head span { opacity: .5; font-size: 10px; }
.dsh-thrift-close { pointer-events: auto; cursor: pointer; opacity: .5; border: 0; background: none;
  color: inherit; font: inherit; padding: 0 2px; }
.dsh-thrift-close:hover { opacity: .95; }

/* ---------- the controls ---------- */
.dsh-thrift-label { margin: 11px 0 5px; font-size: 10px; letter-spacing: .06em; opacity: .5; }
.dsh-thrift-levels { display: flex; gap: 5px; }
.dsh-thrift-level { pointer-events: auto; flex: 1 1 0; cursor: pointer; font: inherit; font-size: 10.5px;
  padding: 5px 2px; border-radius: 6px; color: inherit; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.12); transition: border-color .15s ease, background .15s ease; }
.dsh-thrift-level:hover { border-color: var(--dsh-thrift-tone); }
.dsh-thrift-level[data-current="1"] { border-color: var(--dsh-thrift-tone); color: var(--dsh-thrift-tone);
  background: rgba(255,255,255,.09); font-weight: 700; }
.dsh-thrift-words { margin-top: 5px; font-size: 10.5px; opacity: .6; }
.dsh-thrift-budget { display: flex; gap: 5px; align-items: stretch; }
.dsh-thrift-budget input { pointer-events: auto; flex: 1 1 auto; min-width: 0; font: inherit; font-size: 11px;
  padding: 5px 8px; border-radius: 6px; color: inherit; background: rgba(0,0,0,.35);
  border: 1px solid rgba(255,255,255,.14); }
.dsh-thrift-budget input:focus { outline: none; border-color: var(--dsh-thrift-tone); }
.dsh-thrift-apply, .dsh-thrift-restore, .dsh-thrift-reset { pointer-events: auto; cursor: pointer; font: inherit;
  font-size: 10.5px; padding: 5px 10px; border-radius: 6px; color: inherit;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); }
.dsh-thrift-apply { border-color: var(--dsh-thrift-tone); color: var(--dsh-thrift-tone); }
.dsh-thrift-apply:hover, .dsh-thrift-restore:hover, .dsh-thrift-reset:hover { background: rgba(255,255,255,.11); }
.dsh-thrift-restore:disabled, .dsh-thrift-reset:disabled { opacity: .35; cursor: default; }
.dsh-thrift-configured { margin-top: 5px; font-size: 10px; opacity: .45; }
.dsh-thrift-error { margin-top: 6px; padding: 5px 8px; border-radius: 6px; font-size: 10.5px;
  background: rgba(255,95,109,.12); border: 1px solid rgba(255,95,109,.35); color: #ffb3b3; }
.dsh-thrift-rule { height: 1px; margin: 12px 0 2px; background: rgba(255,255,255,.1); }
.dsh-thrift-pending { margin-top: 8px; font-size: 10.5px; color: #ffab3d; }
.dsh-thrift-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 11px; }
.dsh-thrift-link { pointer-events: auto; font-size: 10.5px; color: var(--dsh-thrift-tone); text-decoration: none; opacity: .8; }
.dsh-thrift-link:hover { opacity: 1; text-decoration: underline; }
.dsh-thrift-session { margin-top: 7px; font-size: 10px; opacity: .35; }
.dsh-thrift-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-top: 7px; }
.dsh-thrift-row span { opacity: .55; }
.dsh-thrift-row b { font-weight: 600; }
.dsh-thrift-track { position: relative; height: 9px; margin: 9px 0 3px; border-radius: 999px;
  background: rgba(255,255,255,.1); overflow: visible; }
.dsh-thrift-track > i { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 999px;
  background: var(--dsh-thrift-tone); transition: width .35s ease; }
.dsh-thrift-tick { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 1px;
  background: rgba(255,255,255,.34); }
.dsh-thrift-tick[data-fired="1"] { background: #ffd34d; box-shadow: 0 0 6px rgba(255,211,77,.7); }
.dsh-thrift-marks { display: flex; justify-content: space-between; opacity: .45; font-size: 10px; }
.dsh-thrift-say { margin-top: 10px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,.09);
  opacity: .78; line-height: 1.62; }
.dsh-thrift-say b { color: var(--dsh-thrift-tone); }
.dsh-thrift-off { opacity: .62; line-height: 1.65; }
.dsh-thrift-tools { margin-top: 7px; display: flex; flex-wrap: wrap; gap: 5px; }
.dsh-thrift-tools code { padding: 1px 6px; border-radius: 4px; background: rgba(255,120,120,.14);
  border: 1px solid rgba(255,120,120,.3); color: #ffb3b3; font-size: 10px; }
@media (prefers-reduced-motion: reduce) {
  .dsh-thrift-chip, .dsh-thrift-bar > i, .dsh-thrift-track > i { transition: none !important; }
}
`;

		/** Insert the panel's stylesheet once per plugin lifetime. */
		function installStyles() {
			const tag = document.createElement("style");
			tag.dataset.dshPlugin = "token-thrift";
			tag.textContent = CSS;
			document.head.append(tag);
			return () => {
				tag.remove();
			};
		}
		//#endregion

		//#region formatting helpers
		/** Thousands-separated integer, or an em dash while the figure is absent. */
		function count(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			return Math.round(value).toLocaleString("en-US");
		}

		/** Compact form for the chip, where there is no room for eight digits. */
		function compact(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			if (value < 1e4) return String(Math.round(value));
			if (value < 1e6) return `${(value / 1e3).toFixed(value < 1e5 ? 1 : 0)}k`;
			return `${(value / 1e6).toFixed(2)}M`;
		}

		/**
		 * Which report belongs to the session on screen.
		 *
		 * Matched by id first, because a GUI with two sessions open must not show one
		 * session's spending beside the other's work. Falling back to the newest report
		 * covers the case where the ids come from different places in the host — a wrong
		 * label is a smaller failure than an empty panel.
		 */
		function pickReport(payload, sessionId) {
			const reports = Array.isArray(payload?.reports) ? payload.reports : [];
			if (reports.length === 0) return undefined;
			if (sessionId === undefined || sessionId === null) return reports[0];
			return reports.find((report) => report.sessionId === String(sessionId)) ?? reports[0];
		}

		/**
		 * The bar's colour, by how full the glass is.
		 *
		 * The number alone does not say whether 40% is fine; the colour does, and it is the
		 * one thing readable at a glance from across the screen.
		 */
		function tone(ratio) {
			if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "#5aa9e6";
			if (ratio >= 0.9) return "#ff5f6d";
			if (ratio >= 0.7) return "#ffab3d";
			if (ratio >= 0.4) return "#ffd34d";
			return "#4fd6a8";
		}
		//#endregion

		//#region components
		/** The endpoint that changes settings, derived from the one that reads them. */
		const SETTINGS_ENDPOINT = STATE_ENDPOINT.replace(/\/api\/state$/u, "/api/settings");
		const RESET_ENDPOINT = STATE_ENDPOINT.replace(/\/api\/state$/u, "/api/reset");
		const CONSOLE_HREF = STATE_ENDPOINT.replace(/\/api\/state$/u, "/console/");

		/**
		 * The panel and its chip.
		 *
		 * Session-scoped, because the coach's budget is per session: a root-scoped entry
		 * would have no session id to look a report up by and would end up showing whichever
		 * session happened to be newest.
		 *
		 * It is not a read-out. The three things worth doing to a coach — leaning on it
		 * harder, giving it more room, and letting a session be told again — are all here,
		 * because a panel you have to leave to act on is a panel you stop opening.
		 */
		function ThriftPanel(props) {
			const sessionId = props?.sessionId;
			const [state, setState] = React.useState(undefined);
			const [open, setOpen] = React.useState(false);
			/** Anything the host refused, shown in the panel rather than the console. */
			const [error, setError] = React.useState(undefined);
			/** A budget being typed. `undefined` means "follow the host", which is the norm. */
			const [draft, setDraft] = React.useState(undefined);

			React.useEffect(() => {
				let cancelled = false;
				const load = () => {
					fetch(STATE_ENDPOINT, { headers: { accept: "application/json" } })
						.then((response) => (response.ok ? response.json() : { ok: false, error: `http_${String(response.status)}` }))
						.then((payload) => {
							if (!cancelled) setState(payload);
						})
						.catch(() => {
							if (!cancelled) setState({ ok: false, error: "unreachable" });
						});
				};
				load();
				const timer = window.setInterval(load, POLL_MS);
				return () => {
					cancelled = true;
					window.clearInterval(timer);
				};
			}, []);

			/**
			 * Write a setting and adopt whatever the host answers with.
			 *
			 * The answer is the whole snapshot, so the panel repaints from the host's own
			 * view of the change rather than from an optimistic guess — which is what makes
			 * the two-window case behave.
			 */
			const send = (url, body) => {
				setError(undefined);
				fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				})
					.then((response) => response.json().catch(() => ({ ok: false, error: `http_${String(response.status)}` })))
					.then((payload) => {
						if (payload.ok !== true) throw new Error(payload.message ?? payload.error ?? "被拒绝");
						setState(payload);
						setDraft(undefined);
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)));
			};

			if (state === undefined) return null;

			const chip = (tone_, label, extra) => h("div", {
				className: "dsh-thrift-chip",
				"data-open": open ? "1" : "0",
				role: "button",
				tabIndex: 0,
				"aria-label": label,
				onClick: () => setOpen((value) => !value),
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") setOpen((value) => !value);
				},
			}, extra);

			/** The one line that says what this setting is doing, in words. */
			const LEVEL_WORDS = {
				off: "不劝也不遮",
				light: "只劝一次（七成），永不遮工具",
				standard: "四成 / 七成 / 九成 劝告，九成起遮",
				strict: "两成半 / 五成 / 七成 / 八成半 劝告，五成半起遮",
			};

			const header = (subtitle) => h("div", { className: "dsh-thrift-head" },
				h("b", null, "Token 节流"),
				h("span", null, subtitle ?? ""),
				h("button", { className: "dsh-thrift-close", onClick: () => setOpen(false), "aria-label": "关闭" }, "✕"));

			const levelRow = (current, levels) => h("div", { className: "dsh-thrift-levels" },
				(levels ?? []).map((name) => h("button", {
					key: name,
					type: "button",
					className: "dsh-thrift-level",
					"data-current": name === current ? "1" : "0",
					title: LEVEL_WORDS[name] ?? name,
					onClick: () => {
						if (name !== current) send(SETTINGS_ENDPOINT, { level: name });
					},
				}, name)));

			const budgetRow = (live) => h("div", { className: "dsh-thrift-budget" },
				h("input", {
					type: "number",
					min: "0",
					step: "100000",
					"aria-label": "Token 预算",
					value: draft ?? String(live),
					onChange: (event) => setDraft(event.target.value),
					onKeyDown: (event) => {
						if (event.key !== "Enter") return;
						const value = Number(String(draft ?? "").trim());
						if (!Number.isFinite(value) || value < 0) return setError("预算要是个非负数");
						send(SETTINGS_ENDPOINT, { budget: value });
					},
				}),
				h("button", {
					type: "button",
					className: "dsh-thrift-apply",
					onClick: () => {
						const value = Number(String(draft ?? "").trim());
						if (!Number.isFinite(value) || value < 0) return setError("预算要是个非负数");
						send(SETTINGS_ENDPOINT, { budget: value });
					},
				}, "应用"),
				h("button", {
					type: "button",
					className: "dsh-thrift-restore",
					disabled: state.overridden?.level !== true && state.overridden?.budget !== true,
					title: "丢掉本页的改动，回到 profile 里的值",
					onClick: () => send(SETTINGS_ENDPOINT, { budget: null, level: null }),
				}, "恢复"));

			const errorLine = error === undefined ? null : h("div", { className: "dsh-thrift-error" }, error);

			// No route, no answer: either an older host half or a page talking to something
			// else. Saying so beats an empty corner that looks like a rendering bug, and it
			// expands for the same reason — this is the state most likely to be seen, and
			// "unreachable" on its own does not tell anyone what to do about it.
			if (state.ok !== true) {
				return h("div", { className: "dsh-thrift-root", style: { "--dsh-thrift-tone": "#8b93a7" } },
					open ? h("div", { className: "dsh-thrift-panel", role: "dialog", "aria-label": "Token 节流不可用" },
						header("不可用"),
						h("div", { className: "dsh-thrift-off" },
							"读不到状态接口（",
							h("b", null, STATE_ENDPOINT),
							"）。可能的原因：主驾半边是旧版本、插件没被加载，或者面板和宿主不在同一个源。")) : null,
					chip("#8b93a7", "Token 节流不可用",
						h(React.Fragment, null, h("b", null, "thrift"), h("em", null, "状态接口不可达"))));
			}

			const report = state.enabled === true ? pickReport(state, sessionId) : undefined;
			const ratio = report?.ratio ?? 0;
			const colour = state.enabled === true ? tone(ratio) : "#8b93a7";
			const fired = new Set((report?.fired ?? []).filter((tier) => tier.at !== null).map((tier) => tier.ratio));
			// The report's own tier list, not the currently configured one: the console can
			// change the level while a session runs, and a fired mark only means anything
			// against the list it was measured with.
			const marks = report?.tiers ?? state.tiers ?? [];
			const overMask = report !== undefined && !report.masked && state.maskRatio !== null
				&& (state.maskTools ?? []).length > 0 && ratio >= state.maskRatio;

			return h("div", { className: "dsh-thrift-root", style: { "--dsh-thrift-tone": colour } },
				open ? h("div", { className: "dsh-thrift-panel", role: "dialog", "aria-label": "Token 节流" },
					header(state.enabled === true ? "运行中" : "未启用"),

					// ---- the controls, which are the point of opening it ----
					h("div", { className: "dsh-thrift-label" }, "力度"),
					levelRow(state.level, state.levels),
					h("div", { className: "dsh-thrift-words" }, LEVEL_WORDS[state.level] ?? ""),

					h("div", { className: "dsh-thrift-label" }, "预算（100% 的位置）"),
					budgetRow(state.budget),
					h("div", { className: "dsh-thrift-configured" },
						state.overridden?.level === true || state.overridden?.budget === true
							? `配置里 ${String(state.configured?.level)} / ${count(state.configured?.budget)}，已被本页覆盖（重启恢复）`
							: `配置里 ${String(state.configured?.level)} / ${count(state.configured?.budget)}`),
					errorLine,

					h("div", { className: "dsh-thrift-rule" }),

					// ---- what it is doing with them ----
					report === undefined
						? h("div", { className: "dsh-thrift-off" },
							state.enabled === true
								? "还没有会话在花 token。跑一次工具调用就会出现。"
								// Two different reasons for being off, and the fix differs: one
								// needs a number, the other needs a tier. Saying "pick a level"
								// when the budget is zero sends people to the wrong control.
								: state.budget > 0
									? "档位表是空的，所以没在工作。上面把力度挑开就会开始。"
									: "budget 是 0，所以没在工作。上面填一个正数（例如 2000000）就会开始。")
						: h(React.Fragment, null,
							h("div", { className: "dsh-thrift-row" },
								h("span", null, "已花 / 预算"),
								h("b", null, `${count(report.spent)} / ${count(state.budget)}`)),
							h("div", { className: "dsh-thrift-track" },
								h("i", { style: { width: `${String(Math.min(100, Math.round(ratio * 100)))}%` } }),
								marks.map((mark) => h("div", {
									key: String(mark),
									className: "dsh-thrift-tick",
									"data-fired": fired.has(mark) ? "1" : "0",
									style: { left: `${String(Math.min(100, Math.round(mark * 100)))}%` },
									title: `${String(Math.round(mark * 100))}%`,
								}))),
							h("div", { className: "dsh-thrift-marks" },
								h("span", null, "0%"),
								h("span", null, `${String(Math.round(ratio * 100))}%`),
								h("span", null, "100%")),
							h("div", { className: "dsh-thrift-row" },
								h("span", null, "已响档位 / 已提醒"),
								h("b", null, `${String(fired.size)} / ${String(marks.length)}  ·  ${String(report.reminders ?? 0)} 次`)),
							h("div", { className: "dsh-thrift-row" },
								h("span", null, "遮罩工具"),
								h("b", null, report.masked ? `已遮 ${String((state.maskTools ?? []).length)} 个` : "未遮")),
							report.masked ? h("div", { className: "dsh-thrift-tools" },
								(state.maskTools ?? []).map((tool) => h("code", { key: tool }, tool))) : null,
							overMask ? h("div", { className: "dsh-thrift-pending" },
								`已过遮罩阈值 —— 下一次工具调用时会摘掉 ${String((state.maskTools ?? []).length)} 个会开枝的工具。`) : null),

					h("div", { className: "dsh-thrift-actions" },
						h("button", {
							type: "button",
							className: "dsh-thrift-reset",
							disabled: report === undefined,
							title: "让这个会话的档位重新可以响（档位每会话只响一次）",
							onClick: () => send(RESET_ENDPOINT, { sessionId }),
						}, "重置本会话"),
						h("a", { className: "dsh-thrift-link", href: CONSOLE_HREF, target: "_blank", rel: "noreferrer" }, "全部会话 ↗")),
					h("div", { className: "dsh-thrift-session" }, report?.sessionId ?? "")) : null,
				chip(colour, `Token 节流 ${String(state.level ?? "")} ${String(Math.round(ratio * 100))}%`,
					h(React.Fragment, null,
						h("b", null, String(state.level ?? "thrift")),
						state.enabled === true
							? h("div", { className: "dsh-thrift-bar" }, h("i", { style: { width: `${String(Math.min(100, Math.round(ratio * 100)))}%` } }))
							: null,
						h("em", null, state.enabled === true ? `${String(Math.round(ratio * 100))}%` : "未启用"),
						report?.masked === true ? h("em", { title: "会开枝的工具已被遮罩" }, "⛔") : null,
						overMask ? h("em", { title: "已过遮罩阈值，下一次工具调用时遮罩" }, "!") : null)));
		}

		/**
		 * Root overlay entry: the corner this panel lives in.
		 *
		 * Registered into `shell.overlay` (a root-scoped list slot). The panel itself is a
		 * `session-maybe` child declared here, which is what hands it a session id — and a
		 * session id is what the report is looked up by.
		 */
		function ThriftOverlay(props) {
			return h("div", { className: "dsh-thrift-root" }, props.renderSlot("thrift.panel", {}));
		}
		//#endregion

		//#region plugin
		/** Required service: the UI slot registry. */
		const inject = ["slots"];

		/**
		 * Mount the visualiser: one entry in the root overlay list.
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", function* () {
				const removeStyles = installStyles();
				yield () => removeStyles();
				yield ctx.slots.register(
					{
						name: "shell.overlay",
						id: "token-thrift",
						// After the mascot (50), so the two corners settle in a stable order.
						order: 60,
						children: { "thrift.panel": { kind: "single", scope: "session-maybe" } },
					},
					ThriftOverlay,
				);
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// Exported so the self-test can drive the real components instead of a copy.
		exports.ThriftOverlay = ThriftOverlay;
		exports.ThriftPanel = ThriftPanel;
		exports.pickReport = pickReport;
		exports.tone = tone;
		exports.compact = compact;
		exports.installStyles = installStyles;
		return module.exports;
	},
});
