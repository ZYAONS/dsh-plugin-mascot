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
.dsh-thrift-root { position: fixed; z-index: 40; pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace;
  font-size: 11px; line-height: 1.5; color: #e8eef7; font-variant-numeric: tabular-nums; }
/* The floating ball: fixed, and positioned by the component.
   Dragged in viewport coordinates, so it has to be fixed — an absolutely positioned ball
   would drift away from the pointer the moment anything scrolled.

   No frame and no digit: the ball is a fluid field now, painted onto the canvas below. The
   circle is cut by the canvas' own border-radius rather than by overflow:hidden on the
   ball, because the warning flags sit outside the box and would be clipped away. */
.dsh-thrift-ball { pointer-events: auto; position: relative; width: 40px; height: 40px; border-radius: 50%;
  display: grid; place-items: center; cursor: grab; user-select: none; touch-action: none;
  background: radial-gradient(circle at 38% 32%, rgba(22, 27, 36, .96), rgba(8, 11, 16, .98) 72%);
  box-shadow: 0 6px 20px rgba(0,0,0,.45), 0 0 16px -6px var(--dsh-thrift-tone);
  transition: transform .16s ease, box-shadow .16s ease; }
.dsh-thrift-ball:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,0,0,.5), 0 0 22px -4px var(--dsh-thrift-tone); }
.dsh-thrift-ball:active { cursor: grabbing; transform: scale(1.02); }
.dsh-thrift-ball[data-open="1"] { box-shadow: 0 6px 24px rgba(0,0,0,.5), 0 0 26px -3px var(--dsh-thrift-tone); }
.dsh-thrift-ball:focus-visible { outline: 2px solid var(--dsh-thrift-tone); outline-offset: 3px; }
/* The field itself. aria-hidden: it carries no text, and the ball's own aria-label is where
   the number went. pointer-events off so a drag still lands on the ball. */
.dsh-thrift-ball-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  border-radius: 50%; pointer-events: none; }
.dsh-thrift-ball-flag { position: absolute; top: -4px; right: -4px; font-size: 11px; font-style: normal;
  line-height: 1; z-index: 2; text-shadow: 0 0 4px rgba(0,0,0,.95), 0 0 9px rgba(0,0,0,.8); }
.dsh-thrift-chip { pointer-events: auto; display: inline-flex; align-items: center; gap: 8px;
  padding: 4px 11px 4px 9px; border-radius: 999px; cursor: pointer; user-select: none;
  /* Translucent on purpose: it sits over whatever the user is reading, and an opaque pill
     in the corner is a thing you close rather than a thing you glance at. */
  background: rgba(10, 13, 19, .38); border: 1px solid rgba(255,255,255,.16);
  box-shadow: 0 4px 16px rgba(0,0,0,.25); backdrop-filter: blur(14px) saturate(1.25);
  white-space: nowrap; transition: border-color .16s ease, background .16s ease, transform .16s ease; }
.dsh-thrift-chip:hover { border-color: var(--dsh-thrift-tone); background: rgba(10, 13, 19, .6); transform: translateY(-1px); }
.dsh-thrift-chip[data-open="1"] { border-color: var(--dsh-thrift-tone); }
.dsh-thrift-chip b { color: var(--dsh-thrift-tone); font-weight: 700; letter-spacing: .02em; }
.dsh-thrift-chip em { font-style: normal; opacity: .58; }
.dsh-thrift-bar { width: 58px; height: 6px; border-radius: 999px; overflow: hidden; position: relative;
  background: rgba(255,255,255,.13); }
.dsh-thrift-bar > i { display: block; height: 100%; width: 0; background: var(--dsh-thrift-tone);
  border-radius: 999px; transition: width .35s ease; }
/* Opens downward, because the ball lives at the top. Centred on the ball and pulled back
   by half its own width, so a ball dragged to either edge still opens a panel on screen. */
.dsh-thrift-panel { pointer-events: auto; position: absolute; left: 50%; margin-left: -170px; top: calc(100% + 10px);
  width: 340px; padding: 13px 14px 12px; border-radius: 13px;
  /* See the chip: translucent, and blurring what is behind it rather than hiding it. */
  background: rgba(11, 14, 21, .55); border: 1px solid rgba(255,255,255,.15);
  box-shadow: 0 18px 48px rgba(0,0,0,.42); backdrop-filter: blur(22px) saturate(1.3); }
.dsh-thrift-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.dsh-thrift-head b { font-size: 12px; letter-spacing: .04em; }
.dsh-thrift-head span { opacity: .5; font-size: 10px; }
.dsh-thrift-close { pointer-events: auto; cursor: pointer; opacity: .5; border: 0; background: none;
  color: inherit; font: inherit; padding: 0 2px; }
.dsh-thrift-close:hover { opacity: .95; }

/* ---------- the controls ---------- */
.dsh-thrift-label { margin: 11px 0 5px; font-size: 10px; letter-spacing: .06em; opacity: .5; }
.dsh-thrift-dial-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 3px; }
.dsh-thrift-dial-head b { font-size: 15px; font-variant-numeric: tabular-nums; color: var(--dsh-thrift-tone); }
.dsh-thrift-dial-head span { font-size: 10.5px; opacity: .6; }
.dsh-thrift-dial input[type="range"] { pointer-events: auto; -webkit-appearance: none; appearance: none;
  width: 100%; height: 18px; background: none; cursor: pointer; margin: 0; }
.dsh-thrift-dial input[type="range"]::-webkit-slider-runnable-track { height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(79,214,168,.55), #ffd34d 45%, #ff5f6d);
  border: 1px solid rgba(255,255,255,.12); }
.dsh-thrift-dial input[type="range"]::-moz-range-track { height: 6px; border-radius: 999px;
  background: linear-gradient(90deg, rgba(79,214,168,.55), #ffd34d 45%, #ff5f6d);
  border: 1px solid rgba(255,255,255,.12); }
.dsh-thrift-dial input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; margin-top: -5px; border-radius: 50%;
  background: #0b0e13; border: 2px solid var(--dsh-thrift-tone); box-shadow: 0 0 8px rgba(0,0,0,.5); }
.dsh-thrift-dial input[type="range"]::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%;
  background: #0b0e13; border: 2px solid var(--dsh-thrift-tone); }
.dsh-thrift-dial input[type="range"]:focus-visible { outline: 2px solid var(--dsh-thrift-tone); outline-offset: 3px; }
.dsh-thrift-dial-ticks { position: relative; height: 13px; margin-top: 1px; }
.dsh-thrift-dial-ticks span { position: absolute; transform: translateX(-50%); font-size: 9.5px; opacity: .42; white-space: nowrap; }
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
/* A refused mask is a failure, so it reads as one rather than as the same amber hint. */
.dsh-thrift-pending[data-error="1"] { color: #ff5f6d; overflow-wrap: anywhere; }
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
/* What the request actually got back. */
.dsh-thrift-why { margin-top: 7px; padding: 6px 9px; border-radius: 6px; opacity: 1;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
  color: #e8eef7; font-variant-numeric: tabular-nums; }
.dsh-thrift-why b { opacity: .55; font-weight: 400; }
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

		//#region ball
		/** Where the ball sits, if the user has moved it. */
		const BALL_KEY = "dsh-thrift.ball";
		const BALL_SIZE = 40;
		/** Movement under this many pixels is a click, not a drag. */
		const BALL_SLOP = 4;

		/** The stored position, or `undefined` when nobody has moved it yet. */
		function readBall() {
			try {
				const raw = window.localStorage.getItem(BALL_KEY);
				if (raw === null) return undefined;
				const parsed = JSON.parse(raw);
				if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return parsed;
			} catch {
				// Private mode, a hostile storage — the default position is fine either way.
			}
			return undefined;
		}

		/** Top centre, which is what "上方" means before anyone drags it somewhere better. */
		function defaultBall() {
			const width = window.innerWidth || 1200;
			return { x: Math.round(width / 2 - BALL_SIZE / 2), y: 6 };
		}

		/** Keep it on screen: a ball dragged past the edge is a ball you cannot get back. */
		function clampBall(position) {
			const width = window.innerWidth || 1200;
			const height = window.innerHeight || 800;
			return {
				x: Math.max(0, Math.min(width - BALL_SIZE, Math.round(position.x))),
				y: Math.max(0, Math.min(height - BALL_SIZE, Math.round(position.y))),
			};
		}
		//#endregion

		//#region ball fluid
		/**
		 * The ball's particles.
		 *
		 * A flow field, not random drift: each particle is pushed along a vector that is a
		 * function of where it is, so neighbours travel together and the result reads as a
		 * current rather than as snow. The rail in dsh-effort-slider runs the same idea
		 * (FLUID_PRESET: curlScale .026, fade .018, life 9s); this is retuned for a 40px disc —
		 * smaller, fewer, shorter-lived, and fading faster because there is far less area to
		 * fill before the whole thing saturates.
		 *
		 * What the border and the digit used to carry is now carried by the field:
		 *   hue               -> tone(ratio), green through yellow and orange to red
		 *   speed and density -> intensity
		 * so a hot ball is a visibly different object from a cold one without reading
		 * anything. The exact percentage survives in `title`, in `aria-label`, and in the
		 * panel — the ball was never the only place it was written.
		 */
		var BALL_FLUID = {
			/** Fraction erased each frame. Larger than the rail's .018: it is only 40px wide. */
			fade: .075,
			/** Particle count at intensity 0 and at intensity 1. */
			count: [18, 40],
			radius: [1.0, 2.8],
			alpha: [.14, .38],
			life: [500, 1400],
			/** Displacement per ms, before the intensity multiplier. */
			speed: [.012, .040],
			/** Speed multiplier at intensity 0 and at intensity 1. */
			hot: [.6, 2.1],
			/**
			 * Spatial frequency of the field.
			 *
			 * This one is not a taste knob. At the rail's scale (.026 over ~600px) several
			 * vortices fit across the bar, but the same value over 40px covers barely half a
			 * period: the whole disc then shares one direction, every particle drifts the same
			 * way, and their wakes stack into parallel stripes that read as brushed metal. It
			 * has to be raised roughly with the smaller box.
			 */
			flow: .22,
			/** Circulation about the centre. Breaks the "one direction" failure by bending it. */
			swirl: .55,
			/** Inward pull, scaled by distance from the centre, so the disc does not drain. */
			pull: .16,
		};

		/** `#rrggbb` to `rgba(r,g,b,a)`. The tone ramp hands back hex; canvas wants channels. */
		function hexA(hex, alpha) {
			var match = /^#([0-9a-f]{6})$/iu.exec(String(hex));
			if (match === null) return "rgba(139,147,167," + String(alpha) + ")";
			var n = Number.parseInt(match[1], 16);
			return "rgba(" + String((n >> 16) & 255) + "," + String((n >> 8) & 255) + ","
				+ String(n & 255) + "," + String(alpha) + ")";
		}

		/**
		 * The field: two out-of-phase waves.
		 *
		 * The point is that the vector depends on position. A uniform field would translate
		 * the whole cloud and read as drifting dots; a positional one makes them curl.
		 *
		 * `seed` offsets each particle's sample point by less than a radian. Enough that
		 * neighbours are not in perfect lockstep, little enough that they still travel
		 * together — a fully random direction per particle would be noise, not a current.
		 */
		function ballFlow(x, y, t, seed) {
			var k = BALL_FLUID.flow;
			var phase = seed ?? 0;
			return [
				Math.sin((y + t * .045) * k + phase) + Math.cos((x - t * .035) * k - phase * 1.7),
				Math.cos((x + t * .030) * k + phase * .6) - Math.sin((y - t * .040) * k + phase),
			];
		}

		/**
		 * Paint the ball until disposed.
		 *
		 * `live` is a ref read every frame rather than captured. The tone changes whenever the
		 * session's ratio crosses a tier, and the intensity whenever the dial moves; tearing
		 * the animation down on either would reset every particle and read as a flicker.
		 *
		 * @param canvas - the canvas to paint into.
		 * @param live - ref holding `{ tone, intensity }`.
		 * @param reduced - when true, paint one held frame and never animate.
		 * @returns a dispose function.
		 */
		function paintBall(canvas, live, reduced) {
			var ctx = canvas.getContext("2d");
			if (ctx === null) return function () {};
			var sprite = document.createElement("canvas");
			var spriteTone;
			var parts = [];
			var width = 0;
			var height = 0;
			var dpr = 0;
			var raf = 0;
			var last = 0;
			var stopped = false;

			function conf() {
				var at = live.current ?? {};
				return {
					tone: typeof at.tone === "string" ? at.tone : "#8b93a7",
					hot: typeof at.intensity === "number" && Number.isFinite(at.intensity)
						? Math.max(0, Math.min(1, at.intensity))
						: 0,
				};
			}

			/** One soft blob, baked in the current tone. Cheaper than a gradient per particle. */
			function buildSprite(tone) {
				var size = 48;
				sprite.width = size;
				sprite.height = size;
				var paint = sprite.getContext("2d");
				if (paint === null) return;
				var glow = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
				glow.addColorStop(0, hexA(tone, 1));
				glow.addColorStop(.4, hexA(tone, .62));
				glow.addColorStop(1, hexA(tone, 0));
				paint.fillStyle = glow;
				paint.fillRect(0, 0, size, size);
				spriteTone = tone;
			}

			/** Size the backing store to the box. Returns true when it actually changed. */
			function resize() {
				var next = Math.min(2, window.devicePixelRatio || 1);
				var box = canvas.getBoundingClientRect();
				// Not `w`/`h`: those are `width`/`height` on the painter, and a local named `h`
				// would also shadow the module-level `h = React.createElement` inside this scope.
				var boxW = Math.max(1, Math.round(box.width));
				var boxH = Math.max(1, Math.round(box.height));
				if (boxW === width && boxH === height && next === dpr) return false;
				width = boxW;
				height = boxH;
				dpr = next;
				canvas.width = Math.round(boxW * dpr);
				canvas.height = Math.round(boxH * dpr);
				ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				return true;
			}

			function spawn(part, anywhere) {
				part.x = Math.random() * width;
				part.y = Math.random() * height;
				part.r = BALL_FLUID.radius[0] + Math.random() * (BALL_FLUID.radius[1] - BALL_FLUID.radius[0]);
				part.a = BALL_FLUID.alpha[0] + Math.random() * (BALL_FLUID.alpha[1] - BALL_FLUID.alpha[0]);
				part.s = BALL_FLUID.speed[0] + Math.random() * (BALL_FLUID.speed[1] - BALL_FLUID.speed[0]);
				part.life = BALL_FLUID.life[0] + Math.random() * (BALL_FLUID.life[1] - BALL_FLUID.life[0]);
				// Under a radian: decorrelates neighbours without turning the field into noise.
				part.seed = Math.random() * .9;
				// A fresh cloud is spread through its lifetime, so it does not pulse in unison.
				part.age = anywhere ? Math.random() * part.life : 0;
				return part;
			}

			function wanted(hot) {
				var lo = BALL_FLUID.count[0];
				var hi = BALL_FLUID.count[1];
				return Math.round(lo + (hi - lo) * hot);
			}

			function draw(dt, now) {
				var at = conf();
				if (at.tone !== spriteTone) buildSprite(at.tone);

				var mul = BALL_FLUID.hot[0] + (BALL_FLUID.hot[1] - BALL_FLUID.hot[0]) * at.hot;
				var want = wanted(at.hot);
				// Grow and shrink the cloud in place: respawning it on every change would flash.
				while (parts.length > want) parts.pop();
				while (parts.length < want) parts.push(spawn({}, true));

				// Erase a fraction rather than clearing: what survives is the wake.
				ctx.globalCompositeOperation = "destination-out";
				ctx.globalAlpha = 1;
				ctx.fillStyle = "rgba(0,0,0," + String(BALL_FLUID.fade) + ")";
				ctx.fillRect(0, 0, width, height);

				ctx.globalCompositeOperation = "lighter";
				for (var i = 0; i < parts.length; i += 1) {
					var part = parts[i];
					part.age += dt;
					if (part.age >= part.life) spawn(part, false);
					// Three forces: the wave field's curl, a circulation about the centre, and an
					// inward pull that grows with distance. The pull is not decoration — with the
					// wave alone, particles random-walk out of a 40px disc and the field drains
					// from the rim inwards, leaving a bright core and empty edges.
					var push = ballFlow(part.x, part.y, now, part.seed);
					var offX = part.x - width / 2;
					var offY = part.y - height / 2;
					var away = Math.sqrt(offX * offX + offY * offY) || 1;
					var reach = away / Math.max(1, width / 2);
					var step = part.s * mul * dt * 2.2;
					part.x += (push[0] * .34 - (offY / away) * BALL_FLUID.swirl
						- (offX / away) * BALL_FLUID.pull * reach + .05) * step;
					part.y += (push[1] * .34 + (offX / away) * BALL_FLUID.swirl
						- (offY / away) * BALL_FLUID.pull * reach) * step;
					if (part.x < -10 || part.x > width + 10 || part.y < -10 || part.y > height + 10) {
						spawn(part, false);
					}
					ctx.globalAlpha = Math.max(0, part.a
						* Math.min(1, part.age / 200)
						* Math.min(1, (part.life - part.age) / 300));
					ctx.drawImage(sprite, part.x - part.r, part.y - part.r, part.r * 2, part.r * 2);
				}
				ctx.globalAlpha = 1;
				ctx.globalCompositeOperation = "source-over";
			}

			function frame(now) {
				if (stopped) return;
				raf = window.requestAnimationFrame(frame);
				// A hidden tab paints nothing; skipping the maths too keeps it off the battery.
				if (document.hidden === true) return;
				var dt = last === 0 ? 16 : Math.min(48, now - last);
				last = now;
				if (resize()) {
					parts = [];
					ctx.clearRect(0, 0, width, height);
				}
				draw(dt, now);
			}

			if (reduced === true) {
				// One frame, held. "Reduced motion" is not a request for a slower animation.
				//
				// The frame is produced by running the real integration for a second of fixed
				// clock and then stopping, rather than by painting the particles once. A single
				// pass measures about 5/255 mean opacity against the animated field's 30-59 —
				// a ball that reads as empty — because the wake is what fills it, and a still
				// has no wake. Hand-smearing was the first attempt and still only reached 9.
				// Warming up the actual loop keeps one code path, so the held frame cannot drift
				// from the animated one when the field is retuned.
				resize();
				for (var warm = 0; warm < 70; warm += 1) draw(16, warm * 16);
				return function () {};
			}

			raf = window.requestAnimationFrame(frame);
			return function dispose() {
				stopped = true;
				if (raf !== 0) window.cancelAnimationFrame(raf);
			};
		}

		/**
		 * The ball's canvas.
		 *
		 * A component rather than a bare node, because it owns the canvas and the painter is
		 * bound to *its* lifetime. The panel has two very different trees — unreachable, and
		 * live — and the ball sits at a different child index in each, so React unmounts and
		 * remounts the canvas when the panel switches between them. Painting from the panel's
		 * own effect meant painting once into a node that was no longer on the page: the
		 * canvas on screen stayed 300x150 and blank while a detached one animated happily.
		 *
		 * `live` is a ref, read every frame, so it must not be a dependency. There are none:
		 * a tier crossing or a dial drag would otherwise tear the animation down and reset
		 * every particle.
		 */
		function BallFluid({ live }) {
			const canvas = React.useRef(null);
			React.useEffect(() => {
				if (canvas.current === null) return undefined;
				const reduced = typeof window.matchMedia === "function"
					? window.matchMedia("(prefers-reduced-motion: reduce)").matches === true
					: false;
				return paintBall(canvas.current, live, reduced);
			}, []);
			return h("canvas", { className: "dsh-thrift-ball-canvas", ref: canvas, "aria-hidden": "true" });
		}
		//#endregion

		/**
		 * The panel and its ball.
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
			/** The dial while it is being dragged. Also `undefined` when it is not. */
			const [dial, setDial] = React.useState(undefined);
			/** The mask threshold while it is being dragged. Same rule as the dial. */
			const [maskDraft, setMaskDraft] = React.useState(undefined);
			/** Where the ball sits. Read once, then owned by this component. */
			const [ball, setBall] = React.useState(() => clampBall(readBall() ?? defaultBall()));
			/** The live position during a drag: state would lag a frame behind the pointer. */
			const ballRef = React.useRef(ball);
			ballRef.current = ball;
			const drag = React.useRef(undefined);
			/**
			 * What the ball's field should show right now.
			 *
			 * A ref, not state or a dependency: the painter reads it every frame, so a tier
			 * crossing or a dial drag repaints in place instead of restarting the field.
			 */
			const ballLive = React.useRef({ tone: "#8b93a7", intensity: 0 });

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
						setDial(undefined);
					})
					.catch((thrown) => setError(String(thrown?.message ?? thrown)));
			};

			if (state === undefined) return null;

			/**
			 * The floating ball: drag it to move, click it to open.
			 *
			 * One gesture does both, and the difference is distance — four pixels. A separate
			 * drag handle on a 40px circle would leave nowhere to click.
			 *
			 * The canvas comes first so the flags paint on top of it, and it is aria-hidden:
			 * it holds a picture, and the ball's own `aria-label` already says what the digit
			 * used to say.
			 */
			const ballNode = (tone_, label, extra) => h("div", {
				className: "dsh-thrift-ball",
				"data-open": open ? "1" : "0",
				role: "button",
				tabIndex: 0,
				"aria-label": label,
				title: `${label} · 拖动可以换位置`,
				onPointerDown: (event) => {
					if (event.button !== undefined && event.button !== 0) return;
					event.currentTarget.setPointerCapture?.(event.pointerId);
					drag.current = { dx: event.clientX - ballRef.current.x, dy: event.clientY - ballRef.current.y, moved: 0 };
				},
				onPointerMove: (event) => {
					const held = drag.current;
					if (held === undefined) return;
					const next = clampBall({ x: event.clientX - held.dx, y: event.clientY - held.dy });
					held.moved += Math.abs(next.x - ballRef.current.x) + Math.abs(next.y - ballRef.current.y);
					setBall(next);
				},
				onPointerUp: () => {
					const moved = drag.current?.moved ?? 0;
					drag.current = undefined;
					if (moved < BALL_SLOP) {
						setOpen((value) => !value);
						return;
					}
					// Only a real move is worth remembering: a click that nudged the ball by a
					// pixel should not rewrite the saved position.
					try {
						window.localStorage.setItem(BALL_KEY, JSON.stringify(ballRef.current));
					} catch {
						// Not being able to remember it is not a reason to refuse to move it.
					}
				},
				onKeyDown: (event) => {
					if (event.key === "Enter" || event.key === " ") setOpen((value) => !value);
				},
			},
				h(BallFluid, { live: ballLive }),
				extra);

			/**
			 * The one line that says what the dial is doing, in words.
			 *
			 * `standard` has no entry on purpose: that tier shows no sentence, only its position
			 * between `light` and `strict`. Spelled out here because a missing key reads as an
			 * oversight, and the next person would helpfully write one back in.
			 */
			const LEVEL_WORDS = {
				// Only the advising is described here. Masking used to be welded to the dial and
				// these words said so ("永不遮工具", "五成半起遮"); it is `maskAt`'s own slider
				// now, so any sentence about masking in this table would be a lie. The `off` row
				// keeps its mention because at 0 the whole coach is disabled, tiers included, and
				// a disabled coach cannot mask either.
				off: "不劝也不遮",
				light: "只劝一次",
				strict: "四档劝告，最早开始",
			};

			/** The nearest name for a dial position, so the label reads like a word. */
			const presetOf = (intensity) => {
				const value = Number.isFinite(intensity) ? intensity : 0;
				if (value <= 0) return "off";
				let best = "light";
				let distance = Number.POSITIVE_INFINITY;
				for (const [name, stop] of Object.entries(state.presets ?? {})) {
					if (name === "off") continue;
					const gap = Math.abs(stop - value);
					if (gap < distance) {
						distance = gap;
						best = name;
					}
				}
				return best;
			};

			const header = (subtitle) => h("div", { className: "dsh-thrift-head" },
				h("b", null, "Token 节流"),
				h("span", null, subtitle ?? ""),
				h("button", { className: "dsh-thrift-close", onClick: () => setOpen(false), "aria-label": "关闭" }, "✕"));

			/**
			 * The dial, 0–100.
			 *
			 * A slider rather than four words because the four words were always four points
			 * on one line: leaning harder means speaking earlier and more often, and there is
			 * no reason the middle of that line should be unreachable.
			 *
			 * It does *not* move the mask threshold. It used to, and that coupling put the
			 * mask at 55-86% of the budget, where a session never arrives — see `maskRow`.
			 *
			 * `0` keeps its own meaning — off — and is labelled as such rather than shown as
			 * a percentage of nothing.
			 *
			 * Moved locally and committed on release: a slider that POSTs on every pixel of
			 * travel would send a hundred settings changes to say one.
			 */
			const dialRow = (live, presets, draftDial, setDraftDial, commit) => h("div", { className: "dsh-thrift-dial" },
				h("div", { className: "dsh-thrift-dial-head" },
					h("b", null, live <= 0 ? "关" : String(live)),
					h("span", null, live <= 0 ? "不劝也不遮" : LEVEL_WORDS[presetOf(live)] ?? "")),
				h("input", {
					type: "range",
					min: "0",
					max: "100",
					step: "1",
					"aria-label": "节流力度",
					value: String(draftDial ?? live),
					onChange: (event) => setDraftDial(Number(event.target.value)),
					onPointerUp: commit,
					onKeyUp: commit,
					onBlur: commit,
				}),
				h("div", { className: "dsh-thrift-dial-ticks" },
					Object.entries(presets ?? {}).map(([name, stop]) => h("span", {
						key: name,
						style: { left: `${String(stop)}%` },
						title: `${name} · ${String(stop)}`,
					}, name))));

			/**
			 * The mask threshold, as its own slider.
			 *
			 * It used to be derived from the dial, and the dial's floor was 55% of the budget —
			 * at a 2M budget that is 1.1M tokens, which no ordinary session reaches. So the
			 * mask never landed, and because the failed `restrict()` was swallowed nothing said
			 * why. Making it visible and movable is half the fix; the other half is that it no
			 * longer moves when the dial does.
			 *
			 * 0 means never, and the label says so rather than showing "0%".
			 */
			const maskRow = (live, draftMaskAt, setDraftMaskAt, commit) => h("div", { className: "dsh-thrift-dial" },
				h("div", { className: "dsh-thrift-dial-head" },
					h("b", null, live <= 0 ? "关" : `${String(live)}%`),
					h("span", null, live <= 0 ? "永不遮罩" : "花到这个比例就摘掉会开枝的工具")),
				h("input", {
					type: "range",
					min: "0",
					max: "50",
					step: "1",
					"aria-label": "遮罩阈值（百分比）",
					value: String(draftMaskAt ?? live),
					onChange: (event) => setDraftMaskAt(Number(event.target.value)),
					onPointerUp: commit,
					onKeyUp: commit,
					onBlur: commit,
				}),
				h("div", { className: "dsh-thrift-dial-ticks" },
					[0, 10, 25, 50].map((stop) => h("span", {
						key: String(stop),
						// The track is 0-50, so a stop's position is `stop / 50` of its width.
						style: { left: `${String(stop * 2)}%` },
						title: stop === 0 ? "永不遮罩" : `${String(stop)}%`,
					}, stop === 0 ? "关" : String(stop)))));

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
				// Grey and cold, but still flowing: an unreachable host is a state, not a dead
				// widget, and a frozen ball is indistinguishable from a crashed one.
				ballLive.current = { tone: "#8b93a7", intensity: 0 };
				return h("div", { className: "dsh-thrift-root", style: { left: `${String(ball.x)}px`, top: `${String(ball.y)}px`, "--dsh-thrift-tone": "#8b93a7" } },
					open ? h("div", { className: "dsh-thrift-panel", role: "dialog", "aria-label": "Token 节流不可用" },
						header("不可用"),
						h("div", { className: "dsh-thrift-off" },
							"读不到状态接口（",
							h("b", null, STATE_ENDPOINT),
							"）。",
							// What actually came back. Without it the message is a list of guesses,
							// and the difference between a 404, a 401 and a dead socket is the whole
							// diagnosis — one means the route is missing, one means the session is,
							// and one means nothing answered at all.
							h("div", { className: "dsh-thrift-why" },
								h("b", null, "返回："),
								state.error === "unreachable"
									? "请求根本没到（网络层就失败了）"
									: String(state.error ?? "没有说明")),
							"可能的原因：主驾半边是旧版本、插件没被加载，或者面板和宿主不在同一个源。")) : null,
					ballNode("#8b93a7", "Token 节流不可用",
						h("i", { className: "dsh-thrift-ball-flag", title: "Token 节流不可用" }, "!")));
			}

			const report = state.enabled === true ? pickReport(state, sessionId) : undefined;
			const ratio = report?.ratio ?? 0;
			const colour = state.enabled === true ? tone(ratio) : "#8b93a7";
			// Hand the field its two inputs. The hue is the tone ramp (unchanged, and still the
			// one thing readable across the screen); the intensity drives how fast and how
			// densely it flows, which is what the missing digit used to convey.
			ballLive.current = { tone: colour, intensity: ratio };
			const fired = new Set((report?.fired ?? []).filter((tier) => tier.at !== null).map((tier) => tier.ratio));
			// The report's own tier list, not the currently configured one: the console can
			// change the level while a session runs, and a fired mark only means anything
			// against the list it was measured with.
			const marks = report?.tiers ?? state.tiers ?? [];
			const overMask = report !== undefined && !report.masked && state.maskRatio !== null
				&& (state.maskTools ?? []).length > 0 && ratio >= state.maskRatio;

			return h("div", { className: "dsh-thrift-root", style: { left: `${String(ball.x)}px`, top: `${String(ball.y)}px`, "--dsh-thrift-tone": colour } },
				open ? h("div", { className: "dsh-thrift-panel", role: "dialog", "aria-label": "Token 节流" },
					header(state.enabled === true ? "运行中" : "未启用"),

					// ---- the controls, which are the point of opening it ----
					h("div", { className: "dsh-thrift-label" }, "力度（1–100，0 是关闭）"),
					dialRow(
						state.intensity ?? 0,
						state.presets,
						dial,
						setDial,
						() => {
							if (dial === undefined || dial === state.intensity) return;
							send(SETTINGS_ENDPOINT, { intensity: dial });
						},
					),

					h("div", { className: "dsh-thrift-label" }, "预算（100% 的位置）"),
					budgetRow(state.budget),

					h("div", { className: "dsh-thrift-label" }, "遮罩（花到多少比例就摘掉会开枝的工具）"),
					maskRow(
						state.maskAt ?? 0,
						maskDraft,
						setMaskDraft,
						() => {
							if (maskDraft === undefined || maskDraft === state.maskAt) return;
							send(SETTINGS_ENDPOINT, { maskAt: maskDraft });
						},
					),

					h("div", { className: "dsh-thrift-configured" },
						state.overridden?.intensity === true
							|| state.overridden?.budget === true
							|| state.overridden?.maskAt === true
							? `配置里 力度 ${String(state.configured?.intensity)} · ${count(state.configured?.budget)} · 遮罩 ${String(state.configured?.maskAt)}%，已被本页覆盖（重启恢复）`
							: `配置里 力度 ${String(state.configured?.intensity)} · ${count(state.configured?.budget)} · 遮罩 ${String(state.configured?.maskAt)}%`),
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
								`已过遮罩阈值 —— 下一次工具调用时会摘掉 ${String((state.maskTools ?? []).length)} 个会开枝的工具。`) : null,
							// Why the mask did not land. Without this line the three possible
							// states — not reached yet, refused by the host, masked — all looked
							// the same from outside, which is how "it does nothing" gets reported.
							typeof report.maskNote === "string"
								? h("div", { className: "dsh-thrift-pending", "data-error": "1" },
									`遮罩没生效：${report.maskNote}`) : null),

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
				ballNode(colour, `Token 节流 ${String(state.level ?? "")} ${String(Math.round(ratio * 100))}%`,
					h(React.Fragment, null,
						report?.masked === true ? h("i", { className: "dsh-thrift-ball-flag", title: "会开枝的工具已被遮罩" }, "⛔") : null,
						overMask ? h("i", { className: "dsh-thrift-ball-flag", title: "已过遮罩阈值，下一次工具调用时遮罩" }, "!") : null)));
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
				/**
				 * 填进自己刚声明的那个子槽。
				 *
				 * 声明和占位是两次调用 —— `children` 只把槽登记出来，`renderSlot` 渲染的是
				 * 占位者。少了这一句，胶囊照常出现（它在 overlay 里），点开却什么都没有。
				 */
				yield ctx.slots.register({ name: "thrift.panel" }, ThriftPanel);
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
		// The field's own numbers, exported so a test can pin them. The stripe regression in
		// test/run.mjs is a case a rendering pass caught and reasoning did not.
		exports.ballFlow = ballFlow;
		exports.BALL_FLUID = BALL_FLUID;
		exports.hexA = hexA;
		exports.CSS = CSS;
		exports.compact = compact;
		exports.installStyles = installStyles;
		return module.exports;
	},
});
