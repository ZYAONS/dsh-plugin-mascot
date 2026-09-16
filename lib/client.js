window.__ModuleLoader__.load({
	id: "dsh-plugin-mascot",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let React = require("react");
		let h = React.createElement;

		//#region endpoints and tuning
		const LOOKS_ENDPOINT = "/dsh-mascot/api/looks";
		const BALANCE_ENDPOINT = "/dsh-mascot/api/balance";
		const BALANCE_REFRESH_MS = 120000;
		const SELECTION_KEY = "dsh.mascot.selection";
		/** How long one pose of an animated look holds before it cross-fades. */
		const FRAME_HOLD_MS = 5200;
		/** Cross-fade duration; must match the transition in the stylesheet. */
		const FRAME_FADE_MS = 900;
		/** How long a click reaction stays on the sprite. */
		const POKE_MS = 620;
		//#endregion

		//#region placeholder
		/**
		 * Neutral stand-in shown until artwork is installed.
		 *
		 * A generic "image missing" glyph, not character art: the mascots are
		 * official game art this repository does not redistribute, and a seat that
		 * renders nothing at all is a worse failure than one that says so.
		 */
		const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 172" role="img" aria-label="artwork not installed"><rect x="7" y="7" width="90" height="158" rx="16" fill="rgba(255,255,255,.035)" stroke="rgba(255,255,255,.22)" stroke-width="2" stroke-dasharray="7 7"/><g fill="none" stroke="rgba(255,255,255,.42)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><rect x="30" y="70" width="44" height="32" rx="5"/><circle cx="41" cy="80" r="3.6"/><path d="M30 96 L43 85 L52 93 L61 83 L74 96"/></g><path d="M52 118 v14 M45 125 h14" stroke="var(--dsh-mascot-accent, #37e0d8)" stroke-width="3" stroke-linecap="round"/></svg>`;
		//#endregion

		//#region themes — one app style per character
		/**
		 * A theme is a whole presentation, not a hue swap: `shape` picks the corner
		 * language, `bar` picks how a ratio is drawn, `decor` picks the ambient
		 * flourish, and `font` picks how figures are set. They are keyed by the
		 * `theme` field the art index carries per character, so a character added to
		 * `art/looks.json` themes itself by naming one of these.
		 */
		const THEMES = {
			// 可露希尔 — a Rhodes Island engineering console: cool, precise, boxy.
			rhodes: {
				label: "罗德岛 · 工程终端",
				accent: "#37e0d8",
				accentSoft: "rgba(55, 224, 216, 0.14)",
				accentLine: "rgba(55, 224, 216, 0.55)",
				surface: "linear-gradient(158deg, rgba(24,32,42,.97), rgba(11,15,21,.99))",
				hairline: "rgba(120, 200, 210, 0.18)",
				text: "#e4edf4",
				dim: "rgba(228, 237, 244, 0.52)",
				radius: "6px",
				radiusSm: "4px",
				shape: "console",
				bar: "segmented",
				decor: "scanline",
				font: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace',
			},
			// 千石由乃 — a MEWTYPE live set: warm neon, rounded, moving.
			mewtype: {
				label: "MEWTYPE · LIVE",
				accent: "#ff4d9d",
				accentSoft: "rgba(255, 77, 157, 0.16)",
				accentLine: "rgba(255, 77, 157, 0.6)",
				surface: "linear-gradient(158deg, rgba(38,22,38,.97), rgba(15,10,18,.99))",
				hairline: "rgba(255, 150, 200, 0.2)",
				text: "#f6e9f2",
				dim: "rgba(246, 233, 242, 0.55)",
				radius: "18px",
				radiusSm: "11px",
				shape: "stage",
				bar: "vu",
				decor: "pulse",
				font: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable", "Microsoft YaHei", sans-serif',
			},
		};
		/** Used before the art index arrives, and for a character naming no theme. */
		const DEFAULT_THEME = "rhodes";
		/** Theme keys the stylesheet knows how to draw. */
		const THEME_NAMES = Object.keys(THEMES);

		/** The theme object for a character record, with a safe default. */
		function themeOf(character) {
			return THEMES[character?.theme] ?? THEMES[DEFAULT_THEME];
		}
		//#endregion

		//#region fallback catalogue
		/**
		 * What the plugin shows when `/api/looks` cannot be reached — a host without
		 * artwork installed, or a request that failed. It names no image file, so it
		 * renders the placeholder and says how to install the real thing.
		 */
		const FALLBACK_LOOKS = {
			seats: {
				sprite: { width: 104, height: 172 },
				face: { width: 38, height: 50 },
			},
			characters: [
				{ id: "closure", name: "可露希尔", latin: "Closure", role: "罗德岛 · 采购 / 工程", tagline: "罗德岛工程终端", theme: "rhodes", looks: ["closure-none"] },
				{ id: "yuno", name: "千石由乃", latin: "Sengoku Yuno", role: "梦限大MewType · DJ / Manipulator", tagline: "MEWTYPE LIVE", theme: "mewtype", looks: ["yuno-none"] },
			],
			looks: [
				{ id: "closure-none", character: "closure", name: "未安装", animated: false, installed: false, frames: [], accent: THEMES.rhodes.accent },
				{ id: "yuno-none", character: "yuno", name: "未安装", animated: false, installed: false, frames: [], accent: THEMES.mewtype.accent },
			],
		};
		//#endregion

		//#region stylesheet
		const CSS = `
.dsh-mascot-root { position: absolute; right: 20px; bottom: 20px; z-index: 30; pointer-events: none;
  font-family: var(--dsh-mascot-font, ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif);
  color: var(--dsh-mascot-text, #e9eef5); }

/* ---------- dock ---------- */
.dsh-mascot-dock { pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 7px; }
.dsh-mascot-art { display: block; line-height: 0; overflow: hidden; }
.dsh-mascot-art > svg { display: block; width: 100%; height: 100%; }
.dsh-mascot-art > img { display: block; object-fit: contain; }
.dsh-mascot-sprite > img, .dsh-mascot-face > img { height: auto; }
.dsh-mascot-mini > img { width: 100%; height: 100%; }

.dsh-mascot-btn { appearance: none; border: 0; background: none; padding: 0; margin: 0; cursor: pointer;
  width: 106px; height: 176px; display: grid; place-items: center; border-radius: 18px; position: relative;
  transition: transform .2s cubic-bezier(.2,.8,.3,1.2), filter .2s ease;
  filter: drop-shadow(0 10px 18px rgba(0,0,0,.45));
  animation: dsh-mascot-idle 4.8s ease-in-out infinite; }
.dsh-mascot-btn:hover { transform: translateY(-5px) scale(1.04);
  filter: drop-shadow(0 16px 26px rgba(0,0,0,.5)) drop-shadow(0 0 18px var(--dsh-mascot-accent-soft, rgba(55,224,216,.14))); }
.dsh-mascot-btn:focus-visible { outline: 2px solid var(--dsh-mascot-accent, #37e0d8); outline-offset: 4px; }
.dsh-mascot-btn[data-open="1"] { animation: dsh-mascot-hop .5s cubic-bezier(.2,.8,.3,1.3); }
.dsh-mascot-btn[data-poke="1"] { animation: dsh-mascot-poke .62s cubic-bezier(.2,.8,.3,1.3); }
@keyframes dsh-mascot-idle { 0%,100% { transform: translateY(0) rotate(0) } 50% { transform: translateY(-6px) rotate(.7deg) } }
@keyframes dsh-mascot-hop { 0% { transform: translateY(0) } 35% { transform: translateY(-16px) scale(1.05) } 100% { transform: translateY(0) } }
@keyframes dsh-mascot-poke { 0% { transform: scale(1) } 30% { transform: scale(1.1,.92) } 60% { transform: scale(.96,1.05) } 100% { transform: scale(1) } }
.dsh-mascot-frames { display: block; width: 104px; height: 172px; position: relative;
  animation: dsh-mascot-breathe 5.6s ease-in-out infinite; }
@keyframes dsh-mascot-breathe { 0%,100% { transform: scale(1) } 50% { transform: scale(1.02) } }
.dsh-mascot-frame { position: absolute; inset: 0; transition: opacity var(--dsh-mascot-fade, 900ms) ease-in-out; }
.dsh-mascot-frame[data-on="0"] { opacity: 0; }

/* a soft ground shadow that tightens as she bounces */
.dsh-mascot-shadow { position: absolute; left: 50%; bottom: -6px; width: 64px; height: 10px; margin-left: -32px;
  border-radius: 50%; background: radial-gradient(closest-side, rgba(0,0,0,.5), transparent);
  animation: dsh-mascot-shadow 4.8s ease-in-out infinite; }
@keyframes dsh-mascot-shadow { 0%,100% { transform: scale(1); opacity:.55 } 50% { transform: scale(.86); opacity:.35 } }

/* ---------- themed ambient decor ---------- */
.dsh-mascot-decor { position: absolute; inset: 0; pointer-events: none; }
.dsh-mascot-root[data-shape="console"] .dsh-mascot-decor::before {
  content: ""; position: absolute; inset: 6px; border-radius: 8px; opacity: .5;
  background: repeating-linear-gradient(to bottom, var(--dsh-mascot-accent-line, rgba(55,224,216,.55)) 0 1px, transparent 1px 7px);
  mix-blend-mode: screen;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 40%, transparent);
  mask-image: linear-gradient(to bottom, transparent, #000 40%, transparent); }
.dsh-mascot-root[data-shape="console"] .dsh-mascot-decor::after {
  content: ""; position: absolute; inset: 6px; border-radius: 8px;
  background: linear-gradient(to bottom, transparent, var(--dsh-mascot-accent-soft, rgba(55,224,216,.14)), transparent);
  animation: dsh-mascot-scan 3.6s linear infinite; }
@keyframes dsh-mascot-scan { 0% { transform: translateY(-60%) } 100% { transform: translateY(60%) } }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-decor::before {
  content: ""; position: absolute; left: 50%; top: 46%; width: 132px; height: 132px; margin: -66px 0 0 -66px;
  border-radius: 50%; border: 2px solid var(--dsh-mascot-accent-line, rgba(255,77,157,.6));
  animation: dsh-mascot-ring 2.8s ease-out infinite; }
@keyframes dsh-mascot-ring { 0% { transform: scale(.7); opacity: .55 } 100% { transform: scale(1.25); opacity: 0 } }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-decor::after {
  content: ""; position: absolute; left: 50%; bottom: 4px; width: 46px; height: 18px; margin-left: -23px;
  background: linear-gradient(to top, var(--dsh-mascot-accent, #ff4d9d), transparent);
  -webkit-mask-image: repeating-linear-gradient(to right, #000 0 3px, transparent 3px 6px);
  mask-image: repeating-linear-gradient(to right, #000 0 3px, transparent 3px 6px);
  animation: dsh-mascot-eq 1.15s steps(4, end) infinite; transform-origin: bottom; }
@keyframes dsh-mascot-eq { 0% { transform: scaleY(.45) } 50% { transform: scaleY(1) } 100% { transform: scaleY(.6) } }

/* ---------- status chip ---------- */
.dsh-mascot-chip { pointer-events: auto; display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 999px; font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums;
  background: rgba(14, 17, 24, .84); color: var(--dsh-mascot-text, #e7ecf3);
  border: 1px solid var(--dsh-mascot-accent-line, #37e0d8);
  box-shadow: 0 4px 12px rgba(0,0,0,.35); backdrop-filter: blur(8px); white-space: nowrap; }
.dsh-mascot-chip b { color: var(--dsh-mascot-accent, #37e0d8); font-weight: 700; }
.dsh-mascot-chip span { opacity: .62; }

/* ---------- panel ---------- */
.dsh-mascot-backdrop { position: absolute; inset: 0; pointer-events: auto; background: rgba(6, 8, 12, .3); }
.dsh-mascot-panel { position: absolute; right: 0; bottom: calc(100% + 12px); width: 344px;
  max-width: calc(100vw - 40px); max-height: calc(100vh - 232px); overflow-x: hidden; overflow-y: auto;
  pointer-events: auto; border-radius: var(--dsh-mascot-radius, 18px);
  background: var(--dsh-mascot-surface, linear-gradient(158deg, rgba(30,34,44,.97), rgba(14,16,22,.98)));
  border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.09));
  box-shadow: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)) inset;
  animation: dsh-mascot-in .22s cubic-bezier(.2,.8,.3,1.1); }
@keyframes dsh-mascot-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
.dsh-mascot-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; position: relative;
  border-bottom: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.07));
  background: var(--dsh-mascot-accent-soft, rgba(55,224,216,.14)); }
.dsh-mascot-avatar { width: 38px; height: 50px; flex: none; overflow: hidden;
  border-radius: var(--dsh-mascot-radius-sm, 9px); background: rgba(0,0,0,.3); }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-avatar { border-radius: 50%; width: 46px; height: 46px;
  box-shadow: 0 0 0 2px var(--dsh-mascot-accent-line, rgba(255,77,157,.6)), 0 0 14px var(--dsh-mascot-accent-soft, rgba(255,77,157,.16)); }
.dsh-mascot-avatar .dsh-mascot-face { width: 38px; height: 50px; }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-avatar .dsh-mascot-face { width: 46px; height: 46px; }
.dsh-mascot-title { flex: 1; min-width: 0; }
.dsh-mascot-title strong { display: block; font-size: 14px; letter-spacing: .3px; }
.dsh-mascot-title small { display: block; font-size: 11px; opacity: .6; margin-top: 1px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-stamp { font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase; opacity: .55;
  color: var(--dsh-mascot-accent, #37e0d8); margin-top: 3px; display: block; }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-stamp { letter-spacing: .8px; }
.dsh-mascot-x { appearance: none; border: 0; cursor: pointer; width: 26px; height: 26px; flex: none;
  border-radius: var(--dsh-mascot-radius-sm, 9px); background: rgba(255,255,255,.07); color: #cfd6e0;
  font-size: 15px; line-height: 1; }
.dsh-mascot-x:hover { background: rgba(255,255,255,.15); color: #fff; }
.dsh-mascot-body { padding: 10px 12px 12px; display: grid; gap: 9px; }

/* ---------- metric block ---------- */
.dsh-mascot-metric { display: grid; gap: 6px; }
.dsh-mascot-metric-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsh-mascot-metric-top span { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; color: var(--dsh-mascot-dim, rgba(255,255,255,.55)); }
.dsh-mascot-metric-top b { font-size: 21px; letter-spacing: -.5px; font-variant-numeric: tabular-nums;
  font-family: var(--dsh-mascot-font, inherit); color: var(--dsh-mascot-accent, #37e0d8); }
.dsh-mascot-hint { font-size: 11px; color: var(--dsh-mascot-dim, rgba(255,255,255,.5)); line-height: 1.45; }

/* bars: segmented reads as an instrument, vu reads as a meter */
.dsh-mascot-bar { height: 7px; overflow: hidden; border-radius: var(--dsh-mascot-radius-sm, 4px);
  background: rgba(255,255,255,.08); }
.dsh-mascot-bar > i { display: block; height: 100%; transition: width .45s ease;
  background: linear-gradient(90deg, var(--dsh-mascot-accent, #37e0d8), rgba(255,255,255,.8)); }
.dsh-mascot-root[data-bar="segmented"] .dsh-mascot-bar { border-radius: 2px;
  -webkit-mask-image: repeating-linear-gradient(to right, #000 0 6px, transparent 6px 8px);
  mask-image: repeating-linear-gradient(to right, #000 0 6px, transparent 6px 8px); }
.dsh-mascot-root[data-bar="vu"] .dsh-mascot-bar { height: 8px; border-radius: 99px;
  box-shadow: 0 0 10px var(--dsh-mascot-accent-soft, rgba(255,77,157,.16)) inset; }
.dsh-mascot-root[data-bar="vu"] .dsh-mascot-bar > i { border-radius: 99px;
  box-shadow: 0 0 8px var(--dsh-mascot-accent-line, rgba(255,77,157,.6)); }

/* ---------- cells ---------- */
.dsh-mascot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.dsh-mascot-cell { background: rgba(255,255,255,.045); border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.06));
  border-radius: var(--dsh-mascot-radius-sm, 9px); padding: 5px 9px; min-width: 0; }
.dsh-mascot-root[data-shape="console"] .dsh-mascot-cell { background: rgba(255,255,255,.03); }
.dsh-mascot-cell em { display: block; font-style: normal; font-size: 9px; letter-spacing: .8px;
  text-transform: uppercase; color: var(--dsh-mascot-dim, rgba(255,255,255,.5)); margin-bottom: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-mascot-cell b { font-size: 14px; font-weight: 600; display: block; font-family: var(--dsh-mascot-font, inherit);
  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-mascot-cell.wide { grid-column: 1 / -1; }

/* ---------- balance ---------- */
.dsh-mascot-balance { display: flex; align-items: center; gap: 10px; padding: 9px 11px;
  background: rgba(255,255,255,.045); border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.06));
  border-radius: var(--dsh-mascot-radius-sm, 11px); }
.dsh-mascot-balance .amt { flex: 1; min-width: 0; }
.dsh-mascot-balance .amt b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }
.dsh-mascot-balance .amt em { display: block; font-style: normal; font-size: 11px; margin-top: 1px;
  color: var(--dsh-mascot-dim, rgba(255,255,255,.55));
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-refresh { appearance: none; cursor: pointer; flex: none; font-size: 11px; padding: 6px 10px;
  color: var(--dsh-mascot-text, #dbe2ec); background: rgba(255,255,255,.06);
  border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.12));
  border-radius: var(--dsh-mascot-radius-sm, 9px); }
.dsh-mascot-refresh:hover { background: rgba(255,255,255,.14); }
.dsh-mascot-refresh:disabled { opacity: .45; cursor: default; }

/* ---------- pickers ---------- */
.dsh-mascot-picker { display: grid; gap: 5px; }
.dsh-mascot-picker-label { font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--dsh-mascot-dim, rgba(255,255,255,.5)); }
/* One line, scrollable sideways: a picker that wraps silently grows the panel
   past its own height budget as soon as a third look is installed. */
.dsh-mascot-row { display: flex; gap: 6px; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: thin; padding-bottom: 2px; }
.dsh-mascot-row::-webkit-scrollbar { height: 5px; }
.dsh-mascot-row::-webkit-scrollbar-thumb { background: var(--dsh-mascot-hairline, rgba(255,255,255,.15)); border-radius: 99px; }
.dsh-mascot-row button { appearance: none; cursor: pointer; display: flex; align-items: center; gap: 6px;
  padding: 4px 9px; font-size: 12px; color: var(--dsh-mascot-text, #dfe5ee); flex: none; white-space: nowrap;
  background: rgba(255,255,255,.04); border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.07));
  border-radius: var(--dsh-mascot-radius-sm, 10px); }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-row button { border-radius: 999px; }
.dsh-mascot-row button:hover { background: rgba(255,255,255,.1); }
.dsh-mascot-row button[data-on="1"] { border-color: var(--dsh-mascot-accent, #37e0d8);
  background: var(--dsh-mascot-accent-soft, rgba(55,224,216,.14)); }
.dsh-mascot-row button small { display: block; font-size: 9px; opacity: .55; }
.dsh-mascot-row .mini { width: 18px; height: 30px; flex: none; }
.dsh-mascot-row .mini .dsh-mascot-mini { width: 18px; height: 30px; }

@media (prefers-reduced-motion: reduce) {
  .dsh-mascot-btn, .dsh-mascot-frames, .dsh-mascot-shadow,
  .dsh-mascot-root[data-shape] .dsh-mascot-decor::before,
  .dsh-mascot-root[data-shape] .dsh-mascot-decor::after { animation: none !important; }
  .dsh-mascot-frame { transition: none !important; }
}
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
		 * overshoot keeps its real figure rather than being flattened to 100.
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
		/** Currency glyph for the two units the balance endpoint reports. */
		function currencySymbol(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return "";
		}
		/** Stored selection, tolerating a locked-down or absent localStorage. */
		function readStoredSelection() {
			try {
				return JSON.parse(window.localStorage.getItem(SELECTION_KEY) ?? "null");
			} catch {
				return null;
			}
		}
		/** Persist the selection; a failure is never worth surfacing. */
		function writeStoredSelection(value) {
			try {
				window.localStorage.setItem(SELECTION_KEY, JSON.stringify(value));
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

		//#region transport
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

		/**
		 * Read the installed-look index. The host half has already filtered it to the
		 * artwork actually on disk, so anything returned here can be rendered.
		 *
		 * @param signal - abort signal owned by the caller's effect.
		 * @returns the index, or undefined when the host has none.
		 */
		async function fetchLooks(signal) {
			try {
				const response = await fetch(LOOKS_ENDPOINT, { signal, credentials: "same-origin", headers: { accept: "application/json" } });
				if (!response.ok) return undefined;
				const payload = await response.json();
				if (payload?.ok !== true || !Array.isArray(payload.looks) || payload.looks.length === 0) return undefined;
				return payload;
			} catch {
				return undefined;
			}
		}
		//#endregion

		//#region art
		/** Where the host half serves `art/`; tests and the preview harness override it. */
		let artBase = "/dsh-mascot/art";

		/** URL of one frame of one look. */
		function frameUrl(frame) {
			return `${artBase}/${frame.file}`;
		}

		/**
		 * One frame of art, falling back to the placeholder if it will not load.
		 * The fallback is what a fresh clone shows, so it must work offline.
		 */
		function Frame({ frame, className, seat }) {
			const url = frame === undefined ? undefined : frameUrl(frame);
			const [failed, setFailed] = React.useState(false);
			const [attempted, setAttempted] = React.useState(url);
			if (attempted !== url) {
				setAttempted(url);
				setFailed(false);
			}
			const framing = frame?.seat?.[seat];
			if (url === undefined || failed || framing === undefined) {
				return h("span", { className: `dsh-mascot-art ${className}`, dangerouslySetInnerHTML: { __html: PLACEHOLDER_SVG } });
			}
			return h(
				"span",
				{ className: `dsh-mascot-art ${className}` },
				h("img", {
					src: url,
					alt: "",
					draggable: false,
					onError: () => setFailed(true),
					style: { width: framing.width, marginLeft: framing.left, marginTop: framing.top },
				}),
			);
		}

		/**
		 * A look's artwork, cycling its frames when it has more than one.
		 *
		 * The frames are cross-faded rather than swapped, because that is what makes
		 * a two-pose sheet read as the character moving instead of teleporting. The
		 * cycle pauses while the page is hidden so a background tab is not animating.
		 */
		function Sprite({ look, className, seat }) {
			const frames = look?.frames ?? [];
			const [index, setIndex] = React.useState(0);
			const animated = frames.length > 1;
			React.useEffect(() => {
				if (!animated) return undefined;
				let timer;
				const schedule = () => {
					timer = window.setTimeout(() => {
						setIndex((value) => (value + 1) % frames.length);
						schedule();
					}, FRAME_HOLD_MS);
				};
				const onVisibility = () => {
					window.clearTimeout(timer);
					if (document.visibilityState === "visible") schedule();
				};
				if (document.visibilityState === "visible") schedule();
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					window.clearTimeout(timer);
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, [animated, frames.length, look?.id]);
			// A different look must not inherit the previous one's frame position.
			const [lastLook, setLastLook] = React.useState(look?.id);
			if (lastLook !== look?.id) {
				setLastLook(look?.id);
				setIndex(0);
			}
			if (frames.length === 0) {
				return h("span", { className: `dsh-mascot-art ${className}`, dangerouslySetInnerHTML: { __html: PLACEHOLDER_SVG } });
			}
			if (frames.length === 1) {
				return h(Frame, { frame: frames[0], className, seat });
			}
			return h(
				"span",
				{ className: `dsh-mascot-art ${className}`, style: { position: "relative", width: "100%", height: "100%" } },
				frames.map((frame, position) =>
					h(
						"span",
						{ key: frame.file, className: "dsh-mascot-frame", "data-on": position === index % frames.length ? "1" : "0" },
						h(Frame, { frame, className, seat }),
					),
				),
			);
		}
		//#endregion

		//#region components
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

		/**
		 * The stats panel. Registered as a `session-maybe` child of the overlay
		 * entry, so the renderer hands it `useProjection` / `useSession` / `sessionId`
		 * alongside the owner props this component's parent passes down.
		 */
		function MascotPanel(props) {
			const {
				look, character, looks, characters, theme, onSelectLook, onSelectCharacter,
				onClose, balance, balanceBusy, onRefresh, useProjection, sessionId,
			} = props;
			const usage = useProjection("tokenUsage");
			const pressure = useProjection("contextPressure");
			const stats = deriveStats(usage, pressure);
			const installed = (look?.frames?.length ?? 0) > 0;

			return h(
				"div",
				{ className: "dsh-mascot-panel", role: "dialog", "aria-label": `${character.name} · 用量面板` },
				h(
					"div",
					{ className: "dsh-mascot-head" },
					h("div", { className: "dsh-mascot-avatar" }, h(Sprite, { look, className: "dsh-mascot-face", seat: "face" })),
					h(
						"div",
						{ className: "dsh-mascot-title" },
						h("strong", null, character.name),
						h("small", null, `${character.latin} · ${character.role}`),
						h("span", { className: "dsh-mascot-stamp" }, `${theme.label} · ${look?.name ?? "—"}`),
					),
					h("button", { type: "button", className: "dsh-mascot-x", onClick: onClose, "aria-label": "关闭" }, "×"),
				),
				h(
					"div",
					{ className: "dsh-mascot-body" },
					installed
						? null
						: h(
								"div",
								{ className: "dsh-mascot-hint" },
								"还没有装官方素材。在插件目录运行 `npm run fetch-art`，然后刷新页面。",
							),
					// ---- cache hit
					h(
						"div",
						{ className: "dsh-mascot-metric" },
						h("div", { className: "dsh-mascot-metric-top" }, h("span", null, "Token 缓存命中"), h("b", null, stats.cacheHitText)),
						h("div", { className: "dsh-mascot-bar" }, h("i", { style: { width: `${Math.round(stats.cacheHit * 100)}%` } })),
						h(
							"div",
							{ className: "dsh-mascot-hint" },
							typeof stats.billedInput === "number"
								? `命中 ${count(stats.cacheRead)} / 计费输入 ${count(stats.billedInput)} · 命中率越高，单价越低`
								: "本会话还没有产生用量记录",
						),
					),
					// ---- tokens
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
					// ---- context
					h(
						"div",
						{ className: "dsh-mascot-metric" },
						h("div", { className: "dsh-mascot-metric-top" }, h("span", null, "上下文占用"), h("b", null, stats.occupancyText)),
						h("div", { className: "dsh-mascot-bar" }, h("i", { style: { width: `${Math.round(stats.occupancyRatio * 100)}%` } })),
						h("div", { className: "dsh-mascot-hint" }, `${count(stats.occupancy)} / ${count(stats.contextWindow)} tokens`),
					),
					// ---- balance
					h(
						"div",
						{ className: "dsh-mascot-balance" },
						h("div", { className: "amt" }, h("b", null, balanceText(balance)), h("em", null, balanceDetail(balance))),
						h("button", { type: "button", className: "dsh-mascot-refresh", onClick: onRefresh, disabled: balanceBusy === true }, balanceBusy === true ? "查询中…" : "刷新"),
					),
					// ---- character picker
					characters.length > 1
						? h(
								"div",
								{ className: "dsh-mascot-picker" },
								h("span", { className: "dsh-mascot-picker-label" }, "角色"),
								h(
									"div",
									{ className: "dsh-mascot-row" },
									characters.map((entry) =>
										h(
											"button",
											{ key: entry.id, type: "button", "data-on": entry.id === character.id ? "1" : "0", onClick: () => onSelectCharacter(entry.id) },
											h("span", null, entry.name, h("small", null, entry.tagline ?? entry.latin)),
										),
									),
								),
							)
						: null,
					// ---- look picker
					looks.length > 1
						? h(
								"div",
								{ className: "dsh-mascot-picker" },
								h("span", { className: "dsh-mascot-picker-label" }, "形象"),
								h(
									"div",
									{ className: "dsh-mascot-row" },
									looks.map((entry) =>
										h(
											"button",
											{ key: entry.id, type: "button", "data-on": entry.id === look?.id ? "1" : "0", onClick: () => onSelectLook(entry.id), title: entry.name },
											h("span", { className: "mini" }, h(Sprite, { look: entry, className: "dsh-mascot-mini", seat: "face" })),
											h("span", null, entry.name, entry.animated ? h("small", null, "动态") : null),
										),
									),
								),
							)
						: null,
					h("div", { className: "dsh-mascot-hint" }, `会话 ${shortId(sessionId)}`),
				),
			);
		}

		/**
		 * Root overlay entry: the floating sprite plus the panel seat.
		 *
		 * Registered into `shell.overlay` (a root-scoped list slot), so this file owns
		 * the frame-wide surface; the panel itself is rendered through a
		 * `session-maybe` child slot this entry declares, which is what gives it the
		 * session projections.
		 */
		function MascotOverlay(props) {
			const [open, setOpen] = React.useState(false);
			const [index, setIndex] = React.useState(undefined);
			const [selection, setSelection] = React.useState(readStoredSelection);
			const [balance, setBalance] = React.useState(undefined);
			const [balanceBusy, setBalanceBusy] = React.useState(false);
			const [refreshToken, setRefreshToken] = React.useState(0);
			const [poke, setPoke] = React.useState(false);

			// The look index is fetched once; it is small and only changes when the
			// operator installs more artwork, in which case a page refresh picks it up.
			React.useEffect(() => {
				const controller = new AbortController();
				let cancelled = false;
				fetchLooks(controller.signal).then((payload) => {
					if (!cancelled) setIndex(payload ?? FALLBACK_LOOKS);
				});
				return () => {
					cancelled = true;
					controller.abort();
				};
			}, []);

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

			// Resolve the stored selection against what the host actually installed,
			// falling back to the first available look of the first available character.
			const catalogue = index ?? FALLBACK_LOOKS;
			const characters = catalogue.characters ?? [];
			const requestedCharacter = characters.find((entry) => entry.id === selection?.character);
			const character = requestedCharacter ?? characters[0];
			const available = (catalogue.looks ?? []).filter((entry) => character !== undefined && entry.character === character.id);
			const look = available.find((entry) => entry.id === selection?.look) ?? available[0];
			const theme = themeOf(character);

			/** Persist one selection change. */
			const select = (characterId, lookId) => {
				const next = { character: characterId, look: lookId };
				setSelection(next);
				writeStoredSelection(next);
			};
			const selectCharacter = (characterId) => {
				const first = (catalogue.looks ?? []).find((entry) => entry.character === characterId);
				select(characterId, first?.id);
			};
			const selectLook = (lookId) => {
				if (character !== undefined) select(character.id, lookId);
			};

			/** Toggle the panel and react to the click. */
			const toggle = () => {
				setPoke(true);
				window.setTimeout(() => setPoke(false), POKE_MS);
				setOpen((value) => !value);
			};

			const vars = {
				"--dsh-mascot-accent": look?.accent ?? theme.accent,
				"--dsh-mascot-accent-soft": theme.accentSoft,
				"--dsh-mascot-accent-line": theme.accentLine,
				"--dsh-mascot-surface": theme.surface,
				"--dsh-mascot-hairline": theme.hairline,
				"--dsh-mascot-text": theme.text,
				"--dsh-mascot-dim": theme.dim,
				"--dsh-mascot-radius": theme.radius,
				"--dsh-mascot-radius-sm": theme.radiusSm,
				"--dsh-mascot-font": theme.font,
				"--dsh-mascot-fade": `${FRAME_FADE_MS}ms`,
			};
			// The custom properties must sit on both siblings: the backdrop is not a
			// descendant of the dock, and CSS variables only inherit down the tree.
			const shell = { ...vars, "--dsh-mascot-theme": character?.id };

			return h(
				React.Fragment,
				null,
				open ? h("div", { className: "dsh-mascot-backdrop", style: shell, onClick: () => setOpen(false) }) : null,
				h(
					"div",
					{
						className: "dsh-mascot-root",
						style: shell,
						"data-theme": character?.theme ?? DEFAULT_THEME,
						"data-shape": theme.shape,
						"data-bar": theme.bar,
						"data-decor": theme.decor,
					},
					open
						? props.renderSlot("mascot.panel", {
								look,
								character,
								characters,
								looks: available,
								theme,
								onSelectCharacter: selectCharacter,
								onSelectLook: selectLook,
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
								onClick: toggle,
								"data-open": open ? "1" : "0",
								"data-poke": poke ? "1" : "0",
								"aria-expanded": open,
								"aria-label": `${character?.name ?? "看板娘"} — 查看 Token 用量与余额`,
								title: `${character?.name ?? "看板娘"} · ${look?.name ?? "未安装"} · 点击查看 Token 命中 / 余额`,
							},
							h("span", { className: "dsh-mascot-decor" }),
							h("span", { className: "dsh-mascot-frames" }, h(Sprite, { look, className: "dsh-mascot-sprite", seat: "sprite" })),
							h("span", { className: "dsh-mascot-shadow" }),
						),
						h(
							"span",
							{ className: "dsh-mascot-chip" },
							balance?.ok === true && balance.totalBalance !== undefined
								? h(React.Fragment, null, h("span", null, "余额"), h("b", null, `${currencySymbol(balance.currency)}${balance.totalBalance}`))
								: h(React.Fragment, null, h("span", null, theme.label), h("b", null, "Token / 余额")),
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
		exports.PLACEHOLDER_SVG = PLACEHOLDER_SVG;
		exports.THEMES = THEMES;
		exports.FALLBACK_LOOKS = FALLBACK_LOOKS;
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
