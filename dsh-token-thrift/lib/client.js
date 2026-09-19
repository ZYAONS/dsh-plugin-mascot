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
		/**
		 * The panel and its chip.
		 *
		 * Session-scoped, because the coach's budget is per session: a root-scoped entry
		 * would have no session id to look a report up by and would end up showing whichever
		 * session happened to be newest.
		 */
		function ThriftPanel(props) {
			const sessionId = props?.sessionId;
			const [state, setState] = React.useState(undefined);
			const [open, setOpen] = React.useState(false);

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

			if (state === undefined) return null;

			// No route, no answer: either an older host half or a page talking to something
			// else. Saying so beats an empty corner that looks like a rendering bug, and it
			// expands for the same reason — this is the state most likely to be seen, and
			// "unreachable" on its own does not tell anyone what to do about it.
			if (state.ok !== true) {
				return h("div", { className: "dsh-thrift-root", style: { "--dsh-thrift-tone": "#8b93a7" } },
					open ? h("div", { className: "dsh-thrift-panel", role: "dialog", "aria-label": "Token 节流不可用" },
						h("div", { className: "dsh-thrift-head" },
							h("b", null, "Token 节流"),
							h("button", { className: "dsh-thrift-close", onClick: () => setOpen(false) }, "✕")),
						h("div", { className: "dsh-thrift-off" },
							"读不到状态接口（",
							h("b", null, STATE_ENDPOINT),
							"）。可能的原因：主驾半边是旧版本、插件没被加载，或者面板和宿主不在同一个源。")) : null,
					h("div", { className: "dsh-thrift-chip", "data-open": open ? "1" : "0", onClick: () => setOpen((v) => !v) },
						h("b", null, "thrift"), h("em", null, "状态接口不可达")));
			}

			if (state.enabled !== true) {
				return h("div", { className: "dsh-thrift-root", style: { "--dsh-thrift-tone": "#8b93a7" } },
					h("div", { className: "dsh-thrift-chip", "data-open": open ? "1" : "0", onClick: () => setOpen((v) => !v) },
						h("b", null, "thrift"), h("em", null, "未启用")),
					open ? h("div", { className: "dsh-thrift-panel" },
						h("div", { className: "dsh-thrift-head" },
							h("b", null, "Token 节流"),
							h("button", { className: "dsh-thrift-close", onClick: () => setOpen(false) }, "✕")),
						h("div", { className: "dsh-thrift-off" },
							"教练没有装：",
							h("b", null, state.budget > 0 ? ` budget 是 ${count(state.budget)}，但档位表是空的` : " budget 是 0"),
							"。在 profile 的 patch 里给它一个正数（例如 2000000）就会开始工作。")) : null);
			}

			const report = pickReport(state, sessionId);
			if (report === undefined) {
				return h("div", { className: "dsh-thrift-root", style: { "--dsh-thrift-tone": "#5aa9e6" } },
					h("div", { className: "dsh-thrift-chip" },
						h("b", null, state.level ?? "thrift"), h("em", null, "尚无用量")));
			}

			const ratio = report.ratio ?? 0;
			const colour = tone(ratio);
			const fired = new Set((report.fired ?? []).filter((tier) => tier.at !== null).map((tier) => tier.ratio));
			const marks = state.tiers ?? [];

			return h("div", { className: "dsh-thrift-root", style: { "--dsh-thrift-tone": colour } },
				open ? h("div", { className: "dsh-thrift-panel", role: "dialog", "aria-label": "Token 节流状态" },
					h("div", { className: "dsh-thrift-head" },
						h("b", null, `Token 节流 · ${String(state.level ?? "")}`),
						h("button", { className: "dsh-thrift-close", onClick: () => setOpen(false) }, "✕")),
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
						h("span", null, "0%"), h("span", null, `${String(Math.round(ratio * 100))}%`), h("span", null, "100%")),
					h("div", { className: "dsh-thrift-row" },
						h("span", null, "已响档位"),
						h("b", null, `${String(fired.size)} / ${String(marks.length)}`)),
					h("div", { className: "dsh-thrift-row" },
						h("span", null, "已提醒"),
						h("b", null, `${String(report.reminders ?? 0)} 次（上限 ${String(state.maxReminders ?? "—")}）`)),
					h("div", { className: "dsh-thrift-row" },
						h("span", null, "遮罩工具"),
						h("b", null, report.masked ? `已遮 ${String((state.maskTools ?? []).length)} 个` : "未遮")),
					report.masked ? h("div", { className: "dsh-thrift-tools" },
						(state.maskTools ?? []).map((tool) => h("code", { key: tool }, tool))) : null,
					h("div", { className: "dsh-thrift-say" },
						state.maskRatio === null
							? h("span", null, `本档（${String(state.level ?? "")}）只劝告，`, h("b", null, "永不遮工具"), "。")
							: h("span", null,
								"烧到 ",
								h("b", null, `${String(Math.round((state.maskRatio ?? 0) * 100))}%`),
								" 时会把会开枝的工具摘掉；在那之前只劝告。")),
					h("div", { className: "dsh-thrift-row", style: { marginTop: "9px", opacity: 0.45 } },
						h("span", null, report.sessionId))) : null,
				h("div", {
					className: "dsh-thrift-chip",
					"data-open": open ? "1" : "0",
					role: "button",
					tabIndex: 0,
					"aria-label": `Token 节流 ${String(Math.round(ratio * 100))}%，预算 ${count(state.budget)}，已花 ${count(report.spent)}`,
					onClick: () => setOpen((value) => !value),
					onKeyDown: (event) => {
						if (event.key === "Enter" || event.key === " ") setOpen((value) => !value);
					},
				},
					h("b", null, String(state.level ?? "thrift")),
					h("div", { className: "dsh-thrift-bar" }, h("i", { style: { width: `${String(Math.min(100, Math.round(ratio * 100)))}%` } })),
					h("em", null, `${String(Math.round(ratio * 100))}%`),
					report.masked ? h("em", { title: "会开枝的工具已被遮罩" }, "⛔") : null));
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
