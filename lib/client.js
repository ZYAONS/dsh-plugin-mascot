window.__ModuleLoader__.load({
	id: "dsh-plugin-mascot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let React = require("react");
		let h = React.createElement;

		//#region placeholder artwork
		/**
		 * Neutral stand-in shown until `npm run fetch-art` has populated `art/`.
		 *
		 * This is a generic "image missing" glyph, not character art: the mascots
		 * are official game art, which this repository does not redistribute, and a
		 * seat that renders nothing at all is a worse failure than one that renders
		 * a box saying so.
		 */
		const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 172" role="img" aria-label="artwork not installed"><rect x="7" y="7" width="90" height="158" rx="16" fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.22)" stroke-width="2" stroke-dasharray="7 7"/><g fill="none" stroke="rgba(255,255,255,.42)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="70" width="44" height="32" rx="5"/><circle cx="41" cy="80" r="3.6"/><path d="M30 96 L43 85 L52 93 L61 83 L74 96"/></g><path d="M52 118 v14 M45 125 h14" stroke="var(--dsh-mascot-accent, #37e0d8)" stroke-width="3" stroke-linecap="round"/></svg>`;
				//#endregion

		//#region mascot catalogue
		/**
		 * One selectable mascot.
		 *
		 * `art` names the official Q-version artwork the host half serves. `sprite`
		 * and `face` frame that same file into the two seats it appears in — the
		 * dock sprite and the small panel portrait — as the rendered image width
		 * plus the offsets that bring the figure (or just the head) into the box.
		 * Both official files carry transparent margins, so each pair is computed
		 * from the artwork's alpha bounding box rather than guessed.
		 */
		const MASCOTS = [
			{
				id: "closure",
				name: "可露希尔",
				latin: "Closure",
				role: "罗德岛 · 采购 / 工程",
				accent: "#37e0d8",
				accentSoft: "rgba(55, 224, 216, 0.16)",
				art: "closure.png",
				// 512x640, figure at 429x520 from (41,68). Chibi proportions, so the
				// portrait window is the top 46% of the figure.
				sprite: { width: 123, left: -9, top: 7 },
				face: { width: 45, left: -3, top: 9 },
			},
			{
				id: "yuno",
				name: "千石由乃",
				latin: "Sengoku Yuno",
				role: "梦限大MewType · DJ / Manipulator",
				accent: "#ff6ea8",
				accentSoft: "rgba(255, 110, 168, 0.16)",
				art: "yuno.png",
				// 236x391 and cropped tight by scripts/cutout.mjs, so the figure fills
				// the canvas and the sprite seat needs almost no oversizing.
				sprite: { width: 103, left: 1, top: 1 },
				face: { width: 38, left: 0, top: 11 },
			},
		];
		const STORAGE_KEY = "dsh.mascot.character";
		const BALANCE_ENDPOINT = "/dsh-mascot/api/balance";
		const BALANCE_REFRESH_MS = 120000;
		/** Where the host half serves `art/`; tests and the preview harness override it. */
		let artBase = "/dsh-mascot/art";

		/** URL of one mascot's official artwork, or undefined when it has none. */
		function artUrl(mascot) {
			return mascot.art === undefined ? undefined : `${artBase}/${mascot.art}`;
		}
		//#endregion

		//#region stylesheet
		const CSS = `
.dsh-mascot-root { position: absolute; right: 20px; bottom: 20px; z-index: 30; pointer-events: none;
  font-family: var(--dsh-font-sans, ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif); }
.dsh-mascot-dock { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 6px; }
/* Art sizing lives on the wrapper this plugin renders, never on the SVG's own
   attributes, so the same source scales to every seat it appears in. Each seat
   below names its own wrapper class. */
.dsh-mascot-art { display: block; line-height: 0; overflow: hidden; }
.dsh-mascot-art > svg { display: block; width: 100%; height: 100%; }
.dsh-mascot-art > img { display: block; object-fit: contain; }
/* The official file fills the thumbnail box outright. */
.dsh-mascot-mini > img { width: 100%; height: 100%; }
/* Sprite and portrait wrappers are fixed seats; the image keeps its own aspect
   at whatever width the mascot's framing gives it, and negative offsets pull the
   figure (or just the head) into view. */
.dsh-mascot-sprite > img, .dsh-mascot-face > img { height: auto; }
.dsh-mascot-btn { appearance: none; border: 0; background: none; padding: 0; margin: 0; cursor: pointer;
  width: 106px; height: 176px; display: grid; place-items: center; border-radius: 16px;
  transition: transform .18s cubic-bezier(.2,.8,.3,1.2), filter .18s ease; filter: drop-shadow(0 10px 18px rgba(0,0,0,.42));
  animation: dsh-mascot-float 4.6s ease-in-out infinite; }
.dsh-mascot-btn:hover { transform: translateY(-4px) scale(1.035); filter: drop-shadow(0 14px 22px rgba(0,0,0,.5)); }
.dsh-mascot-btn:active { transform: translateY(-1px) scale(.985); }
.dsh-mascot-btn:focus-visible { outline: 2px solid var(--dsh-mascot-accent, #37e0d8); outline-offset: 3px; }
.dsh-mascot-btn .dsh-mascot-sprite { width: 104px; height: 172px; }
@keyframes dsh-mascot-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
@media (prefers-reduced-motion: reduce) { .dsh-mascot-btn { animation: none } }

.dsh-mascot-chip { pointer-events: auto; display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 999px; font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums;
  background: rgba(14, 17, 24, .82); color: #e7ecf3; border: 1px solid var(--dsh-mascot-accent, #37e0d8);
  box-shadow: 0 4px 12px rgba(0,0,0,.35); backdrop-filter: blur(8px); white-space: nowrap; }
.dsh-mascot-chip b { color: var(--dsh-mascot-accent, #37e0d8); font-weight: 700; }
.dsh-mascot-chip span { opacity: .65; }

.dsh-mascot-backdrop { position: absolute; inset: 0; pointer-events: auto; background: rgba(6, 8, 12, .28); }
/* The panel is anchored above the dock (204px tall plus the viewport's 20px
   inset and a 12px gap), so its own ceiling keeps it from ever growing past the
   top of the window and clipping its own header. */
.dsh-mascot-panel { position: absolute; right: 0; bottom: calc(100% + 12px); width: 344px; max-width: calc(100vw - 40px);
  max-height: calc(100vh - 244px); overflow-x: hidden; overflow-y: auto;
  pointer-events: auto; color: #e9eef5; border-radius: 18px;
  background: linear-gradient(160deg, rgba(30,34,44,.97), rgba(14,16,22,.98));
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)) inset;
  animation: dsh-mascot-in .2s cubic-bezier(.2,.8,.3,1.1); }
@keyframes dsh-mascot-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
.dsh-mascot-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px 9px;
  border-bottom: 1px solid rgba(255,255,255,.07); background: var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)); }
.dsh-mascot-avatar { width: 38px; height: 50px; flex: none; border-radius: 9px; overflow: hidden;
  background: rgba(0,0,0,.28); }
.dsh-mascot-avatar .dsh-mascot-face { width: 38px; height: 50px; }
.dsh-mascot-title { flex: 1; min-width: 0; }
.dsh-mascot-title strong { display: block; font-size: 14px; letter-spacing: .3px; }
.dsh-mascot-title small { display: block; font-size: 11px; opacity: .6; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-x { appearance: none; border: 0; cursor: pointer; width: 26px; height: 26px; border-radius: 8px;
  background: rgba(255,255,255,.07); color: #cfd6e0; font-size: 15px; line-height: 1; flex: none; }
.dsh-mascot-x:hover { background: rgba(255,255,255,.14); color: #fff; }
.dsh-mascot-body { padding: 11px 14px 13px; display: grid; gap: 10px; }

.dsh-mascot-hero { display: grid; gap: 6px; }
.dsh-mascot-hero-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsh-mascot-hero-top span { font-size: 11px; letter-spacing: .6px; text-transform: uppercase; opacity: .55; }
.dsh-mascot-hero-top b { font-size: 24px; font-variant-numeric: tabular-nums; letter-spacing: -.5px;
  color: var(--dsh-mascot-accent, #37e0d8); }
.dsh-mascot-bar { height: 6px; border-radius: 99px; background: rgba(255,255,255,.08); overflow: hidden; }
.dsh-mascot-bar > i { display: block; height: 100%; border-radius: 99px; transition: width .4s ease;
  background: linear-gradient(90deg, var(--dsh-mascot-accent, #37e0d8), rgba(255,255,255,.75)); }
.dsh-mascot-hint { font-size: 11px; opacity: .5; line-height: 1.45; }

.dsh-mascot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.dsh-mascot-cell { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06);
  border-radius: 9px; padding: 5px 9px; min-width: 0; }
.dsh-mascot-cell em { display: block; font-style: normal; font-size: 10px; letter-spacing: .4px;
  text-transform: uppercase; opacity: .5; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-mascot-cell b { font-size: 14px; font-variant-numeric: tabular-nums; font-weight: 600; display: block;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-mascot-cell.wide { grid-column: 1 / -1; }

.dsh-mascot-balance { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border-radius: 11px;
  background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.06); }
.dsh-mascot-balance .amt { flex: 1; min-width: 0; }
.dsh-mascot-balance .amt b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.dsh-mascot-balance .amt em { display: block; font-style: normal; font-size: 11px; opacity: .55; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-refresh { appearance: none; border: 1px solid rgba(255,255,255,.12); cursor: pointer; flex: none;
  background: rgba(255,255,255,.06); color: #dbe2ec; border-radius: 9px; padding: 6px 10px; font-size: 11px; }
.dsh-mascot-refresh:hover { background: rgba(255,255,255,.13); }
.dsh-mascot-refresh:disabled { opacity: .45; cursor: default; }

.dsh-mascot-switch { display: flex; gap: 8px; }
.dsh-mascot-switch button { appearance: none; cursor: pointer; flex: 1; display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07); color: #dfe5ee; font-size: 12px; text-align: left; }
.dsh-mascot-switch button:hover { background: rgba(255,255,255,.09); }
.dsh-mascot-switch button[data-on="1"] { border-color: var(--dsh-mascot-accent, #37e0d8);
  background: var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)); }
.dsh-mascot-switch .mini { width: 20px; height: 33px; flex: none; }
.dsh-mascot-switch .mini .dsh-mascot-mini { width: 20px; height: 33px; }
.dsh-mascot-switch small { display: block; font-size: 10px; opacity: .55; }
`;

		/** Insert the mascot stylesheet once per plugin lifetime. */
		function installStyles() {
			const tag = document.createElement("style");
			tag.dataset.dshPlugin = "mascot";
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
		/** Compact figure for tight cells: 12.3k / 4.5M. */
		function compact(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			if (Math.abs(value) < 1000) return String(Math.round(value));
			if (Math.abs(value) < 1e6) return `${(value / 1e3).toFixed(value < 1e4 ? 2 : 1)}k`;
			return `${(value / 1e6).toFixed(2)}M`;
		}
		/**
		 * One-decimal percentage, or an em dash when the denominator is unknown.
		 * A value that rounds to exactly 100 prints without the decimal, but an
		 * overshoot (an occupancy estimate above the context window) keeps its
		 * real figure instead of being flattened to 100.
		 */
		function percent(part, whole) {
			if (typeof part !== "number" || typeof whole !== "number" || whole <= 0) return "—";
			const rounded = Math.round((part / whole) * 1000) / 10;
			return `${rounded === 100 ? "100" : rounded.toFixed(1)}%`;
		}
		/** Clamp to [0, 1] for bar widths. */
		function ratio(part, whole) {
			if (typeof part !== "number" || typeof whole !== "number" || whole <= 0) return 0;
			return Math.max(0, Math.min(1, part / whole));
		}
		/** Short, human-sized session id for the footer line. */
		function shortId(id) {
			if (typeof id !== "string" || id.length === 0) return "—";
			return id.length <= 14 ? id : `${id.slice(0, 6)}…${id.slice(-5)}`;
		}
		/** Stored mascot choice, tolerating a locked-down or absent localStorage. */
		function readStoredCharacter() {
			try {
				const value = window.localStorage.getItem(STORAGE_KEY);
				return MASCOTS.some((m) => m.id === value) ? value : MASCOTS[0].id;
			} catch {
				return MASCOTS[0].id;
			}
		}
		/** Persist the mascot choice; a failure is never worth surfacing. */
		function writeStoredCharacter(id) {
			try {
				window.localStorage.setItem(STORAGE_KEY, id);
			} catch {
				/* storage unavailable — the choice simply does not persist */
			}
		}
		//#endregion

		//#region token statistics
		/**
		 * Derive the display statistics from the session projections.
		 *
		 * Shapes are owned by token-meter's wire views:
		 * `tokenUsage` → `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`,
		 * `contextPressure` → `{ contextWindow?, pressureTokens?, projectedTokens? }`.
		 *
		 * @param usage - the `tokenUsage` projection value, absent without a session.
		 * @param pressure - the `contextPressure` projection value, absent without a session.
		 * @returns every figure the panel renders, each `undefined` when unmeasurable.
		 */
		function deriveStats(usage, pressure) {
			const uncachedInput = usage?.uncachedInputTokens;
			const output = usage?.outputTokens;
			const cacheRead = usage?.cacheReadTokens;
			const cacheWrite = usage?.cacheWriteTokens;
			const billedInput = [uncachedInput, cacheRead, cacheWrite].every((n) => typeof n === "number")
				? uncachedInput + cacheRead + cacheWrite
				: undefined;
			const total = typeof billedInput === "number" && typeof output === "number" ? billedInput + output : undefined;
			const occupancy = typeof pressure?.projectedTokens === "number" ? pressure.projectedTokens : pressure?.pressureTokens;
			return {
				uncachedInput,
				output,
				cacheRead,
				cacheWrite,
				billedInput,
				total,
				cacheHit: billedInput === undefined ? undefined : ratio(cacheRead ?? 0, billedInput),
				cacheHitText: billedInput === undefined ? "—" : percent(cacheRead ?? 0, billedInput),
				occupancy,
				contextWindow: pressure?.contextWindow,
				occupancyRatio: pressure?.contextWindow === undefined ? 0 : ratio(occupancy, pressure.contextWindow),
				occupancyText: pressure?.contextWindow === undefined ? "—" : percent(occupancy, pressure.contextWindow),
			};
		}
		//#endregion

		//#region balance transport
		/**
		 * Read the account balance through the plugin's own host route. The API key
		 * never crosses to the browser: the host half resolves it from the
		 * credentials service and returns figures only.
		 *
		 * @param signal - abort signal owned by the caller's effect.
		 * @returns the host payload, or a synthesized failure object.
		 */
		async function fetchBalance(signal) {
			try {
				const response = await fetch(BALANCE_ENDPOINT, { signal, credentials: "same-origin", headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => undefined);
				if (!response.ok) {
					return { ok: false, error: payload?.error ?? `http_${response.status}`, message: payload?.message ?? `主机返回 HTTP ${response.status}` };
				}
				return payload ?? { ok: false, error: "empty", message: "主机返回了空响应" };
			} catch (error) {
				if (error?.name === "AbortError") return undefined;
				return { ok: false, error: "unreachable", message: "无法访问主机余额接口" };
			}
		}
		//#endregion

		//#region components
		/**
		 * The mascot's official artwork, falling back to the built-in vector art.
		 *
		 * The official art is not committed to this repository, so a 404 is a
		 * normal state rather than a fault: `onError` swaps in the vector art and
		 * the sprite still renders. `className` selects which seat's geometry the
		 * wrapper takes (dock sprite, panel portrait, or switcher thumbnail).
		 */
		function Art({ mascot, className, frame }) {
			const url = artUrl(mascot);
			const [failed, setFailed] = React.useState(false);
			// A different file means a different verdict — reset when the mascot changes.
			const [attempted, setAttempted] = React.useState(url);
			if (attempted !== url) {
				setAttempted(url);
				setFailed(false);
			}
			if (url === undefined || failed) {
				return h("span", { className: `dsh-mascot-art ${className}`, dangerouslySetInnerHTML: { __html: PLACEHOLDER_SVG } });
			}
			// `frame` overrides the seat's own sizing: the official files carry wide
			// transparent margins, so the image is rendered larger than its box and
			// pulled by negative offsets until the figure fills the seat.
			const style = frame === undefined ? undefined : { width: frame.width, marginLeft: frame.left, marginTop: frame.top };
			return h(
				"span",
				{ className: `dsh-mascot-art ${className}`, "data-art": mascot.art },
				h("img", { src: url, alt: "", draggable: false, style, onError: () => setFailed(true) }),
			);
		}

		/**
		 * The small portrait in the panel header: the same official file, framed by
		 * `mascot.face` so the head lands inside the box instead of the whole figure.
		 * Falls back to the vector art exactly as {@link Art} does.
		 */
		function Face({ mascot }) {
			const url = artUrl(mascot);
			const [failed, setFailed] = React.useState(false);
			if (url === undefined || failed || mascot.face === undefined) {
				return h("span", { className: "dsh-mascot-art dsh-mascot-face", dangerouslySetInnerHTML: { __html: PLACEHOLDER_SVG } });
			}
			return h(
				"span",
				{ className: "dsh-mascot-art dsh-mascot-face" },
				h("img", {
					src: url,
					alt: "",
					draggable: false,
					onError: () => setFailed(true),
					style: { width: mascot.face.width, marginLeft: mascot.face.left, marginTop: mascot.face.top },
				}),
			);
		}

		/**
		 * The stats panel. Registered as a `session-maybe` child of the overlay
		 * entry, so the renderer hands it `useProjection` / `useSession` / `sessionId`
		 * alongside the owner props this component's parent passes down.
		 */
		function MascotPanel(props) {
			const { mascot, mascots, onSelect, onClose, balance, balanceBusy, onRefresh, useProjection, sessionId } = props;
			const usage = useProjection("tokenUsage");
			const pressure = useProjection("contextPressure");
			const stats = deriveStats(usage, pressure);

			return h(
				"div",
				{ className: "dsh-mascot-panel", role: "dialog", "aria-label": `${mascot.name} · 用量面板` },
				h(
					"div",
					{ className: "dsh-mascot-head" },
					h("div", { className: "dsh-mascot-avatar" }, h(Face, { mascot })),
					h(
						"div",
						{ className: "dsh-mascot-title" },
						h("strong", null, mascot.name),
						h("small", null, `${mascot.latin} · ${mascot.role}`),
					),
					h("button", { type: "button", className: "dsh-mascot-x", onClick: onClose, "aria-label": "关闭" }, "×"),
				),
				h(
					"div",
					{ className: "dsh-mascot-body" },
					// ---- cache hit hero
					h(
						"div",
						{ className: "dsh-mascot-hero" },
						h(
							"div",
							{ className: "dsh-mascot-hero-top" },
							h("span", null, "Token 缓存命中"),
							h("b", null, stats.cacheHitText),
						),
						h("div", { className: "dsh-mascot-bar" }, h("i", { style: { width: `${Math.round(stats.cacheHit * 100)}%` } })),
						h(
							"div",
							{ className: "dsh-mascot-hint" },
							typeof stats.billedInput === "number"
								? `命中 ${count(stats.cacheRead)} / 计费输入 ${count(stats.billedInput)} · 命中率越高，单价越低`
								: "本会话还没有产生用量记录",
						),
					),
					// ---- token grid
					h(
						"div",
						{ className: "dsh-mascot-grid" },
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "输入 (未命中)"), h("b", null, count(stats.uncachedInput))),
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "缓存读取"), h("b", null, count(stats.cacheRead))),
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "缓存写入"), h("b", null, count(stats.cacheWrite))),
						h("div", { className: "dsh-mascot-cell" }, h("em", null, "输出"), h("b", null, count(stats.output))),
						h(
							"div",
							{ className: "dsh-mascot-cell wide" },
							h("em", null, "本会话累计 Token"),
							h("b", null, `${count(stats.total)}${typeof stats.total === "number" ? `  (${compact(stats.total)})` : ""}`),
						),
					),
					// ---- context occupancy
					h(
						"div",
						{ className: "dsh-mascot-hero" },
						h(
							"div",
							{ className: "dsh-mascot-hero-top" },
							h("span", null, "上下文占用"),
							h("b", null, stats.occupancyText),
						),
						h("div", { className: "dsh-mascot-bar" }, h("i", { style: { width: `${Math.round(stats.occupancyRatio * 100)}%` } })),
						h(
							"div",
							{ className: "dsh-mascot-hint" },
							`${count(stats.occupancy)} / ${count(stats.contextWindow)} tokens`,
						),
					),
					// ---- balance
					h(
						"div",
						{ className: "dsh-mascot-balance" },
						h(
							"div",
							{ className: "amt" },
							h("b", null, balanceText(balance)),
							h("em", null, balanceDetail(balance)),
						),
						h("button", { type: "button", className: "dsh-mascot-refresh", onClick: onRefresh, disabled: balanceBusy === true }, balanceBusy === true ? "查询中…" : "刷新"),
					),
					// ---- mascot switcher
					h(
						"div",
						{ className: "dsh-mascot-switch" },
						mascots.map((item) =>
							h(
								"button",
								{ key: item.id, type: "button", "data-on": item.id === mascot.id ? "1" : "0", onClick: () => onSelect(item.id) },
								h("span", { className: "mini" }, h(Art, { mascot: item, className: "dsh-mascot-mini" })),
								h("span", null, item.name, h("small", null, item.latin)),
							),
						),
					),
					h("div", { className: "dsh-mascot-hint" }, `会话 ${shortId(sessionId)}`),
				),
			);
		}

		/** Balance headline: the amount when known, otherwise the failure in one word. */
		function balanceText(balance) {
			if (balance === undefined) return "查询中…";
			if (balance.ok !== true) return "不可用";
			const amount = balance.totalBalance;
			if (amount === undefined || amount === null) return "—";
			return `${currencySymbol(balance.currency)}${amount}`;
		}

		/** Balance sub-line: currency source, availability, or the concrete failure. */
		function balanceDetail(balance) {
			if (balance === undefined) return "正在向 DeepSeek 查询账户余额";
			if (balance.ok !== true) return balance.message ?? balance.error ?? "查询失败";
			const parts = [];
			if (balance.currency !== undefined) parts.push(balance.currency);
			if (balance.isAvailable === false) parts.push("余额不足");
			if (balance.toppedUpBalance !== undefined) parts.push(`充值 ${currencySymbol(balance.currency)}${balance.toppedUpBalance}`);
			if (balance.grantedBalance !== undefined) parts.push(`赠送 ${currencySymbol(balance.currency)}${balance.grantedBalance}`);
			return parts.join(" · ") || "已连接";
		}

		/** Currency glyph for the two units the balance endpoint reports. */
		function currencySymbol(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return "";
		}

		/**
		 * Root overlay entry: the floating mascot plus the panel seat.
		 *
		 * Registered into `shell.overlay` (a root-scoped list slot), so this file
		 * owns the frame-wide surface; the panel itself is rendered through a
		 * `session-maybe` child slot this entry declares, which is what gives it
		 * the session projections.
		 */
		function MascotOverlay(props) {
			const [open, setOpen] = React.useState(false);
			const [character, setCharacter] = React.useState(readStoredCharacter);
			const [balance, setBalance] = React.useState(undefined);
			const [balanceBusy, setBalanceBusy] = React.useState(false);
			const [refreshToken, setRefreshToken] = React.useState(0);
			const mascot = MASCOTS.find((m) => m.id === character) ?? MASCOTS[0];

			// Balance refresh: re-runs on open and on every manual refresh, and the
			// interval only exists while the panel is open.
			React.useEffect(() => {
				if (!open) return undefined;
				const controller = new AbortController();
				let cancelled = false;
				const load = async () => {
					setBalanceBusy(true);
					const payload = await fetchBalance(controller.signal);
					if (cancelled || payload === undefined) return;
					setBalance(payload);
					setBalanceBusy(false);
				};
				load();
				const timer = window.setInterval(load, BALANCE_REFRESH_MS);
				return () => {
					cancelled = true;
					window.clearInterval(timer);
					controller.abort();
				};
			}, [open, refreshToken]);

			// Escape closes the panel; the listener exists only while it is open.
			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [open]);

			const select = (id) => {
				setCharacter(id);
				writeStoredCharacter(id);
			};

			// The custom properties must sit on both siblings: the backdrop is not a
			// descendant of the dock, and CSS variables only inherit down the tree.
			const theme = { "--dsh-mascot-accent": mascot.accent, "--dsh-mascot-accent-soft": mascot.accentSoft };

			return h(
				React.Fragment,
				null,
				open ? h("div", { className: "dsh-mascot-backdrop", style: theme, onClick: () => setOpen(false) }) : null,
				h(
					"div",
					{ className: "dsh-mascot-root", style: theme },
					open
						? props.renderSlot("mascot.panel", {
								mascot,
								mascots: MASCOTS,
								onSelect: select,
								onClose: () => setOpen(false),
								balance,
								balanceBusy,
								onRefresh: () => setRefreshToken((n) => n + 1),
							})
						: null,
					h(
						"div",
						{ className: "dsh-mascot-dock" },
						h(
							"button",
							{
								type: "button",
								className: "dsh-mascot-btn",
								onClick: () => setOpen((value) => !value),
								"aria-expanded": open,
								"aria-label": `${mascot.name} — 查看 Token 用量与余额`,
								title: `${mascot.name} · 点击查看 Token 命中 / 余额`,
							},
							h(Art, { mascot, className: "dsh-mascot-sprite", frame: mascot.sprite }),
						),
						h(
							"span",
							{ className: "dsh-mascot-chip" },
							balance?.ok === true && balance.totalBalance !== undefined
								? h(React.Fragment, null, h("span", null, "余额"), h("b", null, `${currencySymbol(balance.currency)}${balance.totalBalance}`))
								: h(React.Fragment, null, h("span", null, "点我"), h("b", null, "Token / 余额")),
						),
					),
				),
			);
		}
		//#endregion

		//#region plugin
		/** Required service: the UI slot registry. */
		const inject = ["slots"];

		/**
		 * Mount the mascot: one frame-wide overlay entry that declares its own
		 * session-scoped panel seat.
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", function* () {
				const removeStyles = installStyles();
				yield () => removeStyles();
				yield ctx.slots.register(
					{
						name: "shell.overlay",
						id: "mascot",
						order: 50,
						children: { "mascot.panel": { kind: "single", scope: "session-maybe" } },
					},
					MascotOverlay,
				);
			});
		}
		//#endregion

		exports.apply = apply;
		exports.inject = inject;
		// The runner only reads `apply`/`inject`; the rest is exported so the
		// self-test and the preview harness can drive the real components instead
		// of a copy of them.
		exports.MASCOTS = MASCOTS;
		exports.PLACEHOLDER_SVG = PLACEHOLDER_SVG;
		exports.deriveStats = deriveStats;
		exports.MascotOverlay = MascotOverlay;
		exports.MascotPanel = MascotPanel;
		/**
		 * Point the artwork loader somewhere else. The default is the host half's
		 * route, which is correct inside DSH; the preview harness uses this to read
		 * `art/` over `file:` instead, and the self-test uses it to prove the
		 * fallback path.
		 */
		exports.setArtBase = (value) => {
			artBase = String(value).replace(/\/+$/u, "");
		};
		return module.exports;
	},
});
