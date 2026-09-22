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
		/** Whether the operator wants the bone rig on, remembered across reloads. */
		const RIG_KEY = "dsh.mascot.skeleton";
		/** How long one pose of an animated look holds before it cross-fades. */
		const FRAME_HOLD_MS = 5200;
		/**
		 * Cross-fade duration; must match the transition in the stylesheet.
		 *
		 * Short on purpose. A look with several poses is one character drawn more than
		 * once — a front view and a turned one — so a slow dissolve leaves the first
		 * pose's head hanging beside the second's for as long as it lasts. This is a
		 * turn, not a morph.
		 */
		const FRAME_FADE_MS = 260;
		/** How long a click reaction stays on the sprite. */
		const POKE_MS = 620;
		/** The dock sprite's seat, in CSS pixels; mirrors `.dsh-mascot-frames`. */
		const SPRITE_SEAT = Object.freeze({ width: 104, height: 172 });
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
			// 缪尔赛思 — a Rhine Lab terminal: clean, scientific, light green. The accent
			// comes from her own artwork, the pale green hair and the acid-green cords on
			// that translucent white coat, rather than from her faction's blue; a faction
			// colour is a claim about an organisation, and the theme is a claim about who
			// is on screen. Thin rules, a hairline meter and ripple rings, and a plain sans
			// rather than the console's monospace or the stage's rounded face.
			rhine: {
				label: "莱茵生命 · 生态终端",
				accent: "#a3dd7a",
				accentSoft: "rgba(163, 221, 122, 0.14)",
				accentLine: "rgba(163, 221, 122, 0.55)",
				surface: "linear-gradient(158deg, rgba(24,32,22,.97), rgba(10,14,9,.99))",
				hairline: "rgba(180, 218, 168, 0.16)",
				text: "#eaf2e5",
				dim: "rgba(234, 242, 229, 0.5)",
				radius: "10px",
				radiusSm: "6px",
				shape: "lab",
				bar: "hairline",
				decor: "ripple",
				font: 'ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
			},
			// 丰川祥子 — Ave Mujica 的舞台：紫蓝、克制、像后台的灯。
			sakiko: {
				label: "Ave Mujica · 舞台",
				accent: "#8b7cf8",
				accentSoft: "rgba(139, 124, 248, 0.15)",
				accentLine: "rgba(139, 124, 248, 0.58)",
				surface: "linear-gradient(158deg, rgba(26,24,44,.97), rgba(11,10,20,.99))",
				hairline: "rgba(170, 160, 250, 0.17)",
				text: "#eae7fb",
				dim: "rgba(234, 231, 251, 0.5)",
				radius: "8px",
				radiusSm: "5px",
				shape: "veil",
				bar: "beam",
				decor: "ripple",
				font: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace',
			},
			// 谬因 — 天蓝，干净、平稳，像晴天的天上没有云。
			miuyin: {
				label: "明日方舟 · 深绿",
				accent: "#1f7a4d",
				accentSoft: "rgba(31, 122, 77, 0.18)",
				accentLine: "rgba(31, 122, 77, 0.6)",
				surface: "linear-gradient(158deg, rgba(16,30,44,.97), rgba(7,13,20,.99))",
				hairline: "rgba(110, 190, 150, 0.16)",
				text: "#e4f0fb",
				dim: "rgba(228, 240, 251, 0.5)",
				radius: "14px",
				radiusSm: "9px",
				shape: "sky",
				bar: "blocks",
				decor: "scanline",
				font: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable", "Microsoft YaHei", sans-serif',
			},
			// 予愿安洁莉娜 — 水蓝偏青，干净得像实验台。
			yuyuan: {
				label: "明日方舟 · 水蓝",
				accent: "#4fd6e8",
				accentSoft: "rgba(79, 214, 232, 0.15)",
				accentLine: "rgba(79, 214, 232, 0.58)",
				surface: "linear-gradient(158deg, rgba(14,34,40,.97), rgba(6,15,19,.99))",
				hairline: "rgba(120, 220, 235, 0.16)",
				text: "#e2f4f7",
				dim: "rgba(226, 244, 247, 0.5)",
				radius: "10px",
				radiusSm: "6px",
				shape: "pool",
				bar: "wave",
				decor: "pulse",
				font: 'ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
			},
			// 夕 — 水墨：深靛蓝配淡金，边缘像宣纸上的墨晕开。
			dusk: {
				label: "岁相 · 青",
				accent: "#2bb3ae",
				accentSoft: "rgba(43, 179, 174, 0.15)",
				accentLine: "rgba(43, 179, 174, 0.55)",
				surface: "linear-gradient(158deg, rgba(20,22,42,.97), rgba(9,10,20,.99))",
				hairline: "rgba(120, 210, 205, 0.15)",
				text: "#e8e9f8",
				dim: "rgba(232, 233, 248, 0.5)",
				radius: "12px",
				radiusSm: "8px",
				shape: "ink",
				bar: "brush",
				decor: "ripple",
				font: 'ui-serif, "Songti SC", "SimSun", Georgia, serif',
			},
			// 结城理 — P3R：蓝得干净利落，硬边框，四角有刻线。
			makoto: {
				label: "P3R · 蓝",
				accent: "#2f6fe0",
				accentSoft: "rgba(47, 111, 224, 0.16)",
				accentLine: "rgba(47, 111, 224, 0.6)",
				surface: "linear-gradient(158deg, rgba(12,22,44,.97), rgba(6,10,20,.99))",
				hairline: "rgba(110, 160, 240, 0.16)",
				text: "#e6eefc",
				dim: "rgba(230, 238, 252, 0.5)",
				radius: "2px",
				radiusSm: "2px",
				shape: "frame",
				bar: "ticks",
				decor: "scanline",
				font: 'ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
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
			// 望 — a Go board: two colours on a warm wooden ground, edges square, nothing
			// round. The accent is the shell stone rather than the ink one, because a dark
			// interface needs the figure that reads against it; the near-black stone is the
			// surface it sits on. `ticks` is the one bar in the set that looks like a grid,
			// which is the whole point of the reference.
			wang: {
				label: "天镜阁 · 棋局",
				accent: "#e6dfd0",
				accentSoft: "rgba(230, 223, 208, 0.13)",
				accentLine: "rgba(230, 223, 208, 0.52)",
				surface: "linear-gradient(158deg, rgba(30,28,25,.97), rgba(14,13,12,.99))",
				hairline: "rgba(214, 190, 140, 0.2)",
				text: "#efe9dd",
				dim: "rgba(239, 233, 221, 0.52)",
				radius: "3px",
				radiusSm: "2px",
				shape: "board",
				bar: "grid",
				decor: "scanline",
				font: 'ui-serif, "Songti SC", "SimSun", "Microsoft YaHei", serif',
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

		//#region skeleton
		/**
		 * Automatic rigging for a still image.
		 *
		 * The ready-made route is closed: the games' animated chibi are Spine projects
		 * in Hypergryph's modified 3.8 format, and neither usable skeleton files nor a
		 * runtime that reads them is publicly available. So the rig is derived from the
		 * silhouette profile `art-sync` measures.
		 *
		 * Three bones in a chain down the figure:
		 *
		 *   root   pivot at the feet  — the whole body's sway and bounce
		 *   spine  pivot at the hip   — the body above the hips
		 *   neck   pivot at the neck  — the head
		 *
		 * The neck is found rather than assumed: it is the band where the silhouette
		 * pinches. That matters because a chibi's head is most of the figure while a
		 * full-body portrait's head is a tenth of it, so no fixed fraction frames both.
		 *
		 * There is no attempt to separate the arms. In a single flat image the arms
		 * overlap the torso, and moving them independently would tear the artwork. This
		 * rig moves the figure the way a standing body actually idles — weight shifting,
		 * breathing, the head leading — which is what reads as alive. It is not a full
		 * character rig, and that is the honest description of it.
		 */
		const RIG = Object.freeze({
			/** Hip joint height within the figure, 0 top / 1 bottom. */
			hip: 0.72,
			/** Blend half-width around each joint, in the same units. */
			band: 0.085,
			/** Neck position used when the profile shows no clear pinch. */
			neckFallback: 0.34,
			/** Where to look for the neck, as a fraction of the figure's height. */
			neckSearch: [0.08, 0.55],
		});

		/**
		 * Find the figure's neck from a silhouette profile.
		 *
		 * The profile is a flat `[left, right, left, right, …]` list of normalised
		 * extents, one pair per horizontal band. The neck is the narrowest band in the
		 * search window, but only if it is meaningfully narrower than the bands around
		 * it — a figure wearing a cloak has no visible waist, and should rig at the
		 * default rather than at a random pinch.
		 *
		 * @param profile - the measured profile, or null.
		 * @returns `{ y, x }` in figure-normalised coordinates.
		 */
		function findNeck(profile) {
			const fallback = { y: RIG.neckFallback, x: 0.5 };
			if (!Array.isArray(profile) || profile.length < 8) return fallback;
			const rows = profile.length / 2;
			const band = (index) => {
				const left = profile[index * 2];
				const right = profile[index * 2 + 1];
				return { width: right - left, centre: (left + right) / 2, empty: right <= left };
			};
			const first = Math.max(1, Math.floor(rows * RIG.neckSearch[0]));
			const last = Math.min(rows - 2, Math.ceil(rows * RIG.neckSearch[1]));
			let best = -1;
			let bestWidth = Number.POSITIVE_INFINITY;
			for (let index = first; index <= last; index++) {
				const candidate = band(index);
				if (candidate.empty) continue;
				if (candidate.width < bestWidth) {
					bestWidth = candidate.width;
					best = index;
				}
			}
			if (best < 0) return fallback;
			// Require a real pinch: clearly narrower than the widest band above it and
			// than the widest band below it.
			let above = 0;
			let below = 0;
			for (let index = 1; index < rows; index++) {
				const candidate = band(index);
				if (candidate.empty) continue;
				if (index < best) above = Math.max(above, candidate.width);
				if (index > best) below = Math.max(below, candidate.width);
			}
			if (!(bestWidth < above * 0.82 && bestWidth < below * 0.9)) return fallback;
			return { y: (best + 0.5) / rows, x: Math.min(0.85, Math.max(0.15, band(best).centre)) };
		}

		/**
		 * Build a rig: bone pivots plus per-vertex skin weights.
		 *
		 * Weighting is purely vertical — three bones stacked down the figure, blended
		 * across a band at each joint — because that is the only axis a single flat
		 * image supports without tearing.
		 *
		 * @param profile - the silhouette profile from the art index, or null.
		 * @param options - `rows` and `cols` for the deformation mesh.
		 * @returns the rig, with pivots in figure-normalised coordinates.
		 */
		function buildRig(profile, options = {}) {
			const neck = findNeck(profile);
			const bones = [
				{ id: "root", pivot: { x: 0.5, y: 1 } },
				{ id: "spine", pivot: { x: 0.5, y: RIG.hip } },
				{ id: "neck", pivot: neck },
			];
			// Arms, when the look carries shoulder measurements. The official rig's idle
			// is mostly forearm — 28.6 degrees against the waist's 0.4 — so a three-bone
			// torso cannot reproduce it however it is tuned.
			const arms = options.arms ?? null;
			const aspect = options.aspect ?? 1;
			let armAt = null;
			let armUpper = null;
			let armLower = null;
			if (arms !== null && aspect > 0) {
				// halfWidth is in stature units; x is normalised to the width.
				const dx = arms.halfWidth / aspect;
				const shoulderY = 1 - arms.y;
				const handY = 1 - arms.hand;
				/**
				 * How long the arm is, which is not the same as how far the hand happens to be from
				 * the shoulder in the artwork.
				 *
				 * `arms.hand` is measured off the art, and these chibis stand with their arms bent —
				 * so it records the *posed* reach, not the arm. For 结城理's chibi that is 0.157 of
				 * the body height while the shoulder-to-temple span his gesture has to cover is
				 * 0.359: the arm was 44% of the distance it needed, and no combination of joint
				 * angles could close it. A sweep over elbow, upper arm and fold confirmed that — the
				 * best of 693 poses landed within two units of the straight-arm ceiling.
				 *
				 * A hanging arm reaches past the hip, so that is the floor used here. The measured
				 * value still wins when it is longer, which is the case for a figure already drawn
				 * with its arms out.
				 */
				const hanging = Math.max(0.2, RIG.hip + 0.06 - shoulderY);
				const armLength = Math.max(handY - shoulderY, hanging);
				// Two segments per arm, not one. A single shoulder rotation carries the whole arm
				// mass with it, so turning it further sweeps the arm further across the body
				// instead of folding it — measured, that put the summoned hand 31.6 units short of
				// the temple in a 200-unit figure and no larger angle helped.
				// How far down the arm the elbow sits, 0 at the shoulder and 1 at the hand. An arm
				// is not halved: the upper arm is the longer of the two, and where the joint sits
				// decides how much of the reach the fold can add. Overridable so it can be searched.
				const elbowAt = Number.isFinite(options.elbow) ? options.elbow : 0.45;
				const elbowY = shoulderY + armLength * elbowAt;
				bones.push({ id: "armL", pivot: { x: 0.5 - dx, y: shoulderY } });
				bones.push({ id: "armR", pivot: { x: 0.5 + dx, y: shoulderY } });
				bones.push({ id: "foreL", pivot: { x: 0.5 - dx, y: elbowY } });
				bones.push({ id: "foreR", pivot: { x: 0.5 + dx, y: elbowY } });
				/**
				 * The weight of one arm segment, over the half of the arm it owns.
				 *
				 * @param sign - -1 left, 1 right.
				 * @param centreY - middle of the segment.
				 * @param ry - its half-height.
				 * @returns a `(x, y) => weight` in normalised box coordinates.
				 */
				armAt = (sign, centreY, ry) => {
					const sx = 0.5 + sign * dx;
					const rx = Math.max(dx * 1.5, 0.04);
					return (x, y) => {
						// Never above the shoulder: an arm does not pull on the head.
						if (y < shoulderY - 0.04) return 0;
						const ex = (x - sx) / rx;
						const ey = (y - centreY) / ry;
						const distance = Math.sqrt(ex * ex + ey * ey);
						const body = 1 - smooth(0.5, 1.2, distance);
						// Only on its own side of the centre, and fading across it, or the
						// two arms fight over the chest and the whole figure shears.
						const side = sign < 0
							? 1 - smooth(-0.01, 0.09, x - 0.5)
							: 1 - smooth(-0.01, 0.09, 0.5 - x);
						return body * side;
					};
				};
				// Half the arm each, overlapping a little at the elbow so the two segments blend
				// rather than leaving a seam the skinning has to bridge in one step.
				armUpper = (sign) => armAt(sign, shoulderY + armLength * elbowAt * 0.5, Math.max(armLength * 0.6, 0.05));
				armLower = (sign) => armAt(sign, shoulderY + armLength * (elbowAt + (1 - elbowAt) * 0.5), Math.max(armLength * 0.6, 0.05));
			}
			const rows = options.rows ?? 26;
			const cols = options.cols ?? 18;
			const smooth = (edge0, edge1, value) => {
				const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
				return t * t * (3 - 2 * t);
			};
			const vertices = [];
			for (let row = 0; row <= rows; row++) {
				for (let col = 0; col <= cols; col++) {
					const y = row / rows;
					// 1 above the neck (head), 1 below the hip (skirt and legs).
					const head = smooth(neck.y + RIG.band, neck.y - RIG.band, y);
					const lower = smooth(RIG.hip - RIG.band, RIG.hip + RIG.band, y);
					const spine = Math.max(0, 1 - head - lower);
					if (armAt === null) {
						const total = head + spine + lower;
						vertices.push({ x: col / cols, y, w: [lower / total, spine / total, head / total] });
						continue;
					}
					const x = col / cols;
					const armL = armUpper(-1)(x, y);
					const armR = armUpper(1)(x, y);
					const foreL = armLower(-1)(x, y);
					const foreR = armLower(1)(x, y);
					const total = head + spine + lower + armL + armR + foreL + foreR;
					vertices.push({
						x,
						y,
						w: [
							lower / total, spine / total, head / total,
							armL / total, armR / total, foreL / total, foreR / total,
						],
					});
				}
			}
			return { bones, vertices, rows, cols, neck };
		}
		//#endregion

		//#region skinning
		/** A number as a GLSL float literal — `1` is not one, `1.0` is. */
		const glslFloat = (value) => (Number.isInteger(value) ? `${String(value)}.0` : String(value));

		/**
		 * Where the lid line rests inside a measured eye box, and how far it dips
		 * below that at the middle, both as fractions of the box's height.
		 *
		 * The spec this follows lays an eyelash layer onto a parabola whose middle is
		 * lowest, then keeps a sliver of thickness so a shut eye reads as a lid rather
		 * than as a stroke. The numbers are not the spec's numbers: they were fitted to
		 * this repository's own measured eye boxes, on this repository's own artwork.
		 */
		const EYE_CLOSE = Object.freeze({
			/** Where the corners of the lid line sit. */
			rest: 0.3,
			/** How much lower the middle of the lid line is than the corners. */
			dip: 0.3,
			/** Thickness the eye keeps when shut, so it does not collapse to a line. */
			keep: 0.18,
			/** How far the jelly stretches or squashes the band the eye becomes. */
			jelly: 0.14,
		});

		/**
		 * Deformation mesh resolution, per look.
		 *
		 * The coarse mesh is sized to the figure and serves a body that sways. A blink
		 * bends an eye across its own height, and an eye is under a tenth of a figure
		 * tall — the coarse mesh puts fewer than two rows inside one, which is not
		 * enough to bend anything. A look that carries measured eyes gets the finer
		 * mesh so there is something to bend; every other look gets what it always had.
		 *
		 * Both stay well inside the 65535 vertices a `UNSIGNED_SHORT` index allows.
		 */
		const BODY_MESH = Object.freeze({ rows: 26, cols: 18 });
		const EYE_MESH = Object.freeze({ rows: 108, cols: 64 });

		/** A zero-width eye box, for a look that has none: the shader ignores it. */
		const NO_EYE = new Float32Array([0, 0, 0, 0]);

		/**
		 * Vertex shader: five bone matrices blended per vertex (linear blend skinning),
		 * then a blink.
		 *
		 * The UV comes from the REST position, not the deformed one, so the artwork is
		 * sampled where it was painted and only the geometry moves.
		 */
		const SKIN_VERTEX_SHADER = [
			"#version 300 es",
			"in vec2 aPos;",
			// Five bones, so the weights need two attributes: a vertex attribute is at
			// most a vec4, and four bones would leave nowhere for the fifth.
			"in vec4 aBone;",
			"in float aBone2;",
			// Seven bones now: the two forearms are their own segments, because one rotation about
			// the shoulder can only swing a whole arm — it cannot fold an elbow, and folding is what
			// puts a hand at a temple rather than across a chest.
			"in vec2 aBone3;",
			"uniform mat3 uBones[7];",
			"uniform mat3 uProject;",
			"uniform vec2 uImageSize;",
			// The eyes as `x, y, width, height` in image pixels, then how shut they are
			// and how far the jelly has pulled them.
			"uniform vec4 uEyeA;",
			"uniform vec4 uEyeB;",
			"uniform float uBlink;",
			"uniform float uJelly;",
			"out vec2 vUv;",
			"",
			"// Shut one eye by moving its own pixels, rather than by covering them.",
			"//",
			"// Nothing is drawn here, and that is the whole point. An earlier attempt at",
			"// blinking drew a shape over the eye, and on artwork this finely outlined a",
			"// shape laid on top reads as a patch rather than as a lid. Here the vertices",
			"// inside the box collapse onto a parabola whose middle is lowest, which is",
			"// where a shutting lid comes to rest, and the texture is still sampled at the",
			"// rest position, so what closes is the painted eye itself.",
			"vec2 closeEye(vec2 p, vec4 eye, float amount, float jelly) {",
			"  if (amount <= 0.0 || eye.z <= 0.0) return p;",
			"  vec2 halfSize = eye.zw * 0.5;",
			"  vec2 local = (p - eye.xy - halfSize) / halfSize;",
			"  // Fade to nothing outside the box. The cheek is not part of the eye, and",
			"  // pulling it in would tear the face.",
			"  float weight = (1.0 - smoothstep(0.80, 1.30, abs(local.x)))",
			"               * (1.0 - smoothstep(0.80, 1.45, abs(local.y)));",
			"  if (weight <= 0.0) return p;",
			"  float across = clamp(local.x, -1.0, 1.0);",
			`  float lid = eye.y + eye.w * (${glslFloat(EYE_CLOSE.rest)} + ${glslFloat(EYE_CLOSE.dip)} * (1.0 - across * across));`,
			"  // Collapse onto the lid line but keep a sliver, so a shut eye is a lid and",
			"  // not an aliased stroke.",
			`  p.y = lid + (p.y - lid) * mix(1.0, ${glslFloat(EYE_CLOSE.keep)}, amount * weight);`,
			"  // The jelly rides on top of the collapse, so shutting does not damp it: the",
			"  // band the eye has become squashes as it shuts and stretches as it opens.",
			`  p.y = eye.y + halfSize.y + (p.y - eye.y - halfSize.y) * (1.0 + jelly * ${glslFloat(EYE_CLOSE.jelly)} * weight);`,
			"  return p;",
			"}",
			"",
			"void main() {",
			"  // Closed in REST space, then carried by the bones. In rest space the box",
			"  // still lines up with the face it was measured on; after the bones have moved",
			"  // the head, it no longer would.",
			"  vec2 rest = closeEye(aPos, uEyeA, uBlink, uJelly);",
			"  rest = closeEye(rest, uEyeB, uBlink, uJelly);",
			"  vec3 p = vec3(rest, 1.0);",
			"  vec2 skinned = aBone.x * (uBones[0] * p).xy",
			"               + aBone.y * (uBones[1] * p).xy",
			"               + aBone.z * (uBones[2] * p).xy",
			"               + aBone.w * (uBones[3] * p).xy",
			"               + aBone2  * (uBones[4] * p).xy",
			"               + aBone3.x * (uBones[5] * p).xy",
			"               + aBone3.y * (uBones[6] * p).xy;",
			"  gl_Position = vec4((uProject * vec3(skinned, 1.0)).xy, 0.0, 1.0);",
			"  vUv = aPos / uImageSize;",
			"}",
		].join("\n");

		/**
		 * Fragment shader. The texture is uploaded premultiplied
		 * (`UNPACK_PREMULTIPLY_ALPHA_WEBGL`), so filtering across the figure's edge
		 * blends toward transparent black rather than leaving a dark fringe, and the
		 * matching blend function is `ONE, ONE_MINUS_SRC_ALPHA`.
		 */
		const SKIN_FRAGMENT_SHADER = [
			"#version 300 es",
			"precision mediump float;",
			"in vec2 vUv;",
			"uniform sampler2D uTexture;",
			"out vec4 outColour;",
			"void main() { outColour = texture(uTexture, vUv); }",
		].join("\n");

		/** Compile one shader stage, returning undefined on failure. */
		function compileShader(gl, type, source) {
			const shader = gl.createShader(type);
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
			gl.deleteShader(shader);
			return undefined;
		}

		/** Why the last rig attempt was abandoned, for the preview harness and tests. */
		let lastRigError;

		/**
		 * Build a WebGL renderer that deforms one image with a bone rig.
		 *
		 * Returns undefined when WebGL2 is unavailable or anything fails to compile,
		 * which is the caller's signal to fall back to a plain `<img>`: a plugin that
		 * renders nothing because a GPU context was refused would be a worse outcome
		 * than one that renders a still.
		 *
		 * @param image - a loaded HTMLImageElement.
		 * @param rig - the rig from {@link buildRig}.
		 * @param framing - `{ width, left, top }` for this seat, from the art index.
		 * @param box - the figure's bounding box in image pixels; the mesh covers it.
		 * @param seat - the seat's pixel size.
		 * @param eyes - the two eye boxes in image pixels, or null for a look that has
		 *   none. They are `[x, y, width, height]` each, already converted: the art
		 *   index keeps them as fractions of the figure's **body** box, which is a
		 *   different denominator from the box above.
		 * @returns a renderer, or undefined.
		 */
		function createSkinner(image, rig, framing, box, seat, eyes) {
			const give = (reason) => {
				lastRigError = reason;
				return undefined;
			};
			try {
				const canvas = document.createElement("canvas");
				const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: true });
				if (gl === null || gl === undefined) return give("no webgl2 context");
				const vertex = compileShader(gl, gl.VERTEX_SHADER, SKIN_VERTEX_SHADER);
				if (vertex === undefined) return give(`vertex shader: ${gl.getShaderInfoLog(gl.createShader(gl.VERTEX_SHADER)) ?? "failed"}`);
				const fragment = compileShader(gl, gl.FRAGMENT_SHADER, SKIN_FRAGMENT_SHADER);
				if (fragment === undefined) return give("fragment shader failed");
				const program = gl.createProgram();
				gl.attachShader(program, vertex);
				gl.attachShader(program, fragment);
				gl.linkProgram(program);
				if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return give(`link: ${gl.getProgramInfoLog(program) ?? "failed"}`);
				gl.useProgram(program);

				// The mesh covers the figure's bounding box only: the transparent margin
				// around official art is often most of the file, and vertices spent there
				// buy nothing.
				if (!Array.isArray(box)) return give("the frame carries no measured box");
				const positions = new Float32Array(rig.vertices.length * 2);
				// Four weights ride in a vec4, the fifth in a float and the last two in a vec2: a
				// vertex attribute is at most a vec4, so seven bones cannot share one.
				const weights = new Float32Array(rig.vertices.length * 4);
				const weightsTail = new Float32Array(rig.vertices.length);
				const weightsTail2 = new Float32Array(rig.vertices.length * 2);
				rig.vertices.forEach((vertexSpec, index) => {
					positions[index * 2] = box[0] + vertexSpec.x * box[2];
					positions[index * 2 + 1] = box[1] + vertexSpec.y * box[3];
					const w = vertexSpec.w;
					// A three- or five-bone rig from an older index has no forearm weights; pad
					// rather than read past the end and skin everything into NaN.
					weights[index * 4] = w[0] ?? 0;
					weights[index * 4 + 1] = w[1] ?? 0;
					weights[index * 4 + 2] = w[2] ?? 0;
					weights[index * 4 + 3] = w[3] ?? 0;
					weightsTail[index] = w[4] ?? 0;
					weightsTail2[index * 2] = w[5] ?? 0;
					weightsTail2[index * 2 + 1] = w[6] ?? 0;
				});
				const indices = [];
				const stride = rig.cols + 1;
				for (let row = 0; row < rig.rows; row++) {
					for (let col = 0; col < rig.cols; col++) {
						const a = row * stride + col;
						indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
					}
				}
				const positionBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
				const weightBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, weightBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, weights, gl.STATIC_DRAW);
				const weightTailBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, weightTailBuffer);
				gl.bufferData(gl.ARRAY_BUFFER, weightsTail, gl.STATIC_DRAW);
				const weightTail2Buffer = gl.createBuffer();
				gl.bindBuffer(gl.ARRAY_BUFFER, weightTail2Buffer);
				gl.bufferData(gl.ARRAY_BUFFER, weightsTail2, gl.STATIC_DRAW);
				const indexBuffer = gl.createBuffer();
				gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
				gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

				const aPos = gl.getAttribLocation(program, "aPos");
				const aBone = gl.getAttribLocation(program, "aBone");
				const aBone2 = gl.getAttribLocation(program, "aBone2");
				const aBone3 = gl.getAttribLocation(program, "aBone3");
				const texture = gl.createTexture();
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, texture);
				gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);
				// `getUniformLocation('uBones')` names element 0; one 45-float upload
				// fills the whole array in a single call.
				const uBones = gl.getUniformLocation(program, "uBones");
				const uProject = gl.getUniformLocation(program, "uProject");
				const uEyeA = gl.getUniformLocation(program, "uEyeA");
				const uEyeB = gl.getUniformLocation(program, "uEyeB");
				const uBlink = gl.getUniformLocation(program, "uBlink");
				const uJelly = gl.getUniformLocation(program, "uJelly");
				gl.uniform2f(gl.getUniformLocation(program, "uImageSize"), image.naturalWidth, image.naturalHeight);
				// A look with no eyes gets a zero-width box, which `closeEye` returns from
				// before it divides anything — so the uniforms can be uploaded every frame
				// without a branch here.
				gl.uniform4fv(uEyeA, eyes?.[0] ?? NO_EYE);
				gl.uniform4fv(uEyeB, eyes?.[1] ?? NO_EYE);
				gl.enable(gl.BLEND);
				gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
				gl.clearColor(0, 0, 0, 0);

				// Image space -> seat pixels (the same framing the <img> path uses) ->
				// clip space.
				const scale = framing.width / image.naturalWidth;
				const project = new Float32Array([
					(2 * scale) / seat.width, 0, 0,
					0, (-2 * scale) / seat.height, 0,
					(2 * framing.left) / seat.width - 1, 1 - (2 * framing.top) / seat.height, 1,
				]);
				const vertexCount = indices.length;
				// Five mat3s: root, spine, neck and the two arms.
				const packed = new Float32Array(63);
				return {
					canvas,
					/** Resize the drawing buffer; returns true when it changed. */
					resize(width, height) {
						if (canvas.width === width && canvas.height === height) return false;
						canvas.width = width;
						canvas.height = height;
						gl.viewport(0, 0, width, height);
						return true;
					},
					/**
					 * Draw one posed frame.
					 * @param matrices - three 2D affine matrices in image space.
					 * @param pose - `{ close, jelly }`: how shut the eyes are, 0 open to 1
					 *   shut, and how far the jelly has pulled them. Omitted means open.
					 */
					draw(matrices, pose) {
						gl.clear(gl.COLOR_BUFFER_BIT);
						gl.useProgram(program);
						// A NaN here would take the eye with it, and the eye is the one part of
						// the figure a viewer is actually looking at. Clamp rather than trust.
						const close = Number.isFinite(pose?.close) ? Math.min(1, Math.max(0, pose.close)) : 0;
						const jelly = Number.isFinite(pose?.jelly) ? Math.min(1, Math.max(-1, pose.jelly)) : 0;
						gl.uniform1f(uBlink, close);
						gl.uniform1f(uJelly, jelly);
						for (let index = 0; index < Math.min(7, matrices.length); index++) packed.set(matrices[index], index * 9);
						gl.uniformMatrix3fv(uBones, false, packed);
						gl.uniformMatrix3fv(uProject, false, project);
						gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
						gl.enableVertexAttribArray(aPos);
						gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
						gl.bindBuffer(gl.ARRAY_BUFFER, weightBuffer);
						gl.enableVertexAttribArray(aBone);
						gl.vertexAttribPointer(aBone, 4, gl.FLOAT, false, 0, 0);
						gl.bindBuffer(gl.ARRAY_BUFFER, weightTailBuffer);
						gl.enableVertexAttribArray(aBone2);
						gl.vertexAttribPointer(aBone2, 1, gl.FLOAT, false, 0, 0);
						gl.bindBuffer(gl.ARRAY_BUFFER, weightTail2Buffer);
						gl.enableVertexAttribArray(aBone3);
						gl.vertexAttribPointer(aBone3, 2, gl.FLOAT, false, 0, 0);
						gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
						gl.drawElements(gl.TRIANGLES, vertexCount, gl.UNSIGNED_SHORT, 0);
					},
				};
			} catch (error) {
				return give(`threw: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
		//#endregion

		
		//#region pose
		/* MOTION-START */
		/**
		 * The idle and the greeting, measured from the official chibi rather than
		 * invented, one bundle per character. GENERATED by scripts/motion-literal.mjs
		 * from art/motion.json — edit neither by hand; re-run `npm run measure:motion`
		 * and then that script.
		 *
		 * Values are bone rotations in degrees, sampled every `step` seconds and
		 * looped. `waist` drives the spine, and `chest + head` accumulate into the
		 * neck, which is how the game's own chain adds up: each bone is relative to
		 * its parent and this rig has no separate chest.
		 *
		 * Keyed by character, because that is what the client has when it draws. A
		 * character with no entry falls back to MOTION_DEFAULT rather than to nothing:
		 * a still figure is a worse failure than a borrowed idle.
		 */
		const SPINE_MOTION = {
			closure: {
				idle: {
					loop: 8,
					step: 0.24,
					waist: [0.03, -0.06, -0.15, -0.24, -0.32, -0.27, -0.18, -0.09, 0, -0.03, -0.12, -0.21, -0.3, -0.3, -0.21, -0.12, -0.03, 0, -0.09, -0.18, -0.27, -0.32, -0.24, -0.15, -0.06, 0.03, -0.06, -0.15, -0.24, -0.32, -0.27, -0.18, -0.09, 0, 0.03],
					chest: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					head: [-3.48, -3.21, -2.94, -2.68, -2.68, -2.93, -3.17, -3.42, -3.53, -3.3, -3.03, -2.77, -2.6, -2.84, -3.09, -3.34, -3.58, -3.39, -3.12, -2.85, -2.59, -2.76, -3.01, -3.26, -3.5, -3.48, -3.21, -2.94, -2.68, -2.68, -2.93, -3.17, -3.42, -3.53, -3.48],
				},
				greet: {
					loop: 3.367,
					step: 0.16,
					waist: [0.03, -9.03, -4.14, -7.88, -12.37, -16.85, -17.35, -16.86, -16.23, -15.45, -14.68, -14.64, -15.1, -15.55, -16.01, -13.02, -9.47, -5.92, -2.69, -1.78, -0.88, 0.03],
					chest: [0, -7.07, -3.28, 4.09, 3.7, 2.26, 1.12, 1.36, 1.59, 2.45, 3.39, 4.32, 4.53, 4.17, 3.81, 3.38, 2.68, 1.99, 1.29, 0.75, 0.38, 0],
					head: [-3.48, -3.82, -3.13, -0.42, 0.7, -0.02, -0.74, -0.48, 0.09, 0.26, -0.03, -0.31, -0.59, -0.94, -1.29, -1.64, -1.8, -1.93, -2.05, -2.22, -2.85, -3.48],
				},
				move: {
					loop: 8,
					step: 0.24,
					waist: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
					chest: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					head: [0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74, 0.74],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 20.7,
					idle: { loop: 8, step: 0.08, close: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20.7, 20.7, 17.48, 17.48, 17.48, 0.727, 0.727, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20.7, 20.7, 17.48, 17.48, 17.48, 0.727, 0.727, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
					greet: { loop: 3.367, step: 0.08, close: [0, 0, 20.7, 20.7, 17.48, 17.48, 17.48, 5.175, 0, 0, 20.7, 17.48, 17.48, 0.727, 0.727, 0.727, 0, 0, 0, 0, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 5.916, 17.48, 0.727, 0] },
				},
			},
			muelsyse: {
				idle: {
					loop: 5.333,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					head: [-3.16, -3.42, -3.67, -3.82, -3.57, -3.31, -3.27, -3.52, -3.78, -3.72, -3.46, -3.2, -3.37, -3.63, -3.86, -3.52, -3.18, -6.81, -6.38, -5.95, -5.3, -4.38, -3.46, -3.16],
				},
				greet: {
					loop: 1.667,
					step: 0.16,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					head: [-3.16, -4.74, 0.5, 2.61, 2.81, 2.73, 2.65, 0.23, -2.42, -4.45, -3.59, -3.16],
				},
				move: {
					loop: 1.333,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0],
					head: [-3.16, -3.41, -3.67, -3.83, -3.58, -3.33, -3.16],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 0,
				},
			},
			miuyin: {
				idle: {
					loop: 5.333,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					chest: [-0.07, 0.25, 0.44, 0.07, -0.3, -0.66, -1.03, -1.4, -1.31, -0.92, -0.53, -0.13, 0.2, 0.5, 0.13, -0.23, -0.6, -0.97, -1.34, -1.38, -0.99, -0.59, -0.2, -0.07],
					head: [-1.52, -1.14, -0.77, -0.55, -0.92, -1.3, -1.68, -2.05, -2.43, -2.33, -1.96, -1.58, -1.21, -0.83, -0.49, -0.86, -1.24, -1.61, -1.99, -2.37, -2.4, -2.02, -1.64, -1.52],
				},
				greet: {
					loop: 3.1,
					step: 0.16,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					chest: [-0.07, -1.23, -0.97, 2.3, 5.5, 4.74, 3.97, 3.21, 2.45, 1.69, 0.93, 0.17, -0.28, 0.19, 0.66, 1.13, 1.59, 1.39, 0.8, 0.22, -0.07],
					head: [-1.52, -3.24, -3.58, -1, 1.58, 4.16, 4.99, 2.39, -0.22, -2.82, -5.42, -8.03, -10.63, -10.91, -7.97, -5.03, -2.1, -0.6, -0.97, -1.34, -1.52],
				},
				move: {
					loop: 1.6,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0, 0],
					chest: [-0.07, -0.07, -0.07, -0.07, -0.07, -0.07, -0.07],
					head: [-3.41, -4.84, -3.82, -3.08, -4.41, -4.26, -2.93, -3.41],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 0,
				},
			},
			yuyuan: {
				idle: {
					loop: 5,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					chest: [-0.51, 0.64, 0.71, 0.64, 0.56, 0.66, 1.04, 1.42, 0.85, 0.71, 0.64, 0.56, 0.54, 0.62, 0.69, 0.77, -0.42, -1.79, -3.15, -3.44, -1.98, -0.51],
					head: [0.01, 0.97, 1.59, 1.84, 2.08, 2.33, 1.2, 0.01, -1.19, -1.29, -0.1, 1.1, 2.29, -0.22, -2.88, -5.55, -5.7, -2.91, -0.12, 2.68, 1.43, 0.01],
				},
				greet: {
					loop: 2,
					step: 0.16,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					chest: [-0.51, -2.46, -2.48, -0.86, -0.13, -0.46, -0.8, -0.65, -0.35, -0.05, -0.17, -0.55, -0.61, -0.51],
					head: [0.01, -2.14, -3.05, 4.74, 12.53, 13.36, 12.8, 12.37, 12.84, 13.3, 12.2, 5.17, -0.79, 0.01],
				},
				move: {
					loop: 1.333,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0],
					chest: [-0.43, -0.11, 0.12, -0.47, -0.02, 0, -0.43],
					head: [-2.13, -3.09, -0.67, -3.18, -2.68, -0.95, -2.13],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 0,
				},
			},
			dusk: {
				idle: {
					loop: 13.333,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					head: [3.14, 3.55, 3.97, 3.58, 3.12, 2.66, 2.19, 1.73, 1.59, 2.05, 2.52, 2.98, 3.44, 3.9, 3.64, 3.18, 2.72, 2.26, 1.8, 1.54, 2.03, 2.52, 3.01, 3.44, 3.86, 3.7, 3.24, 2.78, 2.32, 1.86, 1.47, 1.93, 2.39, 2.85, 3.32, 3.78, 3.77, 3.3, 2.84, 2.38, 1.92, 1.46, 1.9, 2.39, 2.88, 3.33, 3.75, 3.83, 3.37, 2.9, 2.44, 1.98, 1.52, 1.83, 2.32, 2.81, 3.14],
				},
				greet: {
					loop: 8,
					step: 0.16,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					head: [3.14, 3.42, 3.69, 3.97, 3.73, 3.42, 3.12, 2.81, 2.5, 2.19, 1.88, 1.57, 1.6, 1.91, 2.22, 2.52, 2.83, 3.14, 3.45, 3.76, 3.94, 3.63, 3.32, 3.01, 2.7, 2.4, 2.09, 1.78, 1.47, 1.72, 2.05, 2.37, 2.7, 3.03, 3.32, 3.6, 3.88, 3.84, 3.53, 3.22, 2.91, 2.6, 2.29, 1.98, 1.68, 1.5, 1.83, 2.15, 2.48, 2.81, 3.14],
				},
				move: {
					loop: 10.667,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1.26, -2.94, -4.62, -6.06, -6.06, -6.06, -6.06, -6.06, -6.06, -6.06, -6.06, -6.06, -6.06, -5.48, -4.2, -2.91, -1.62, -0.34, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					head: [-0.99, -1.3, -0.51, -1.17, -1.11, -0.56, -1.35, -0.93, -0.74, -1.53, -0.75, -0.93, -1.36, -0.57, -1.11, -1.18, -0.5, -1.29, -1, -0.68, -1.47, -0.82, -0.86, -1.43, -0.64, -1.04, -1.25, -0.46, -1.22, -1.06, -0.61, -1.4, -0.88, -0.79, -1.49, -0.7, -0.97, -1.31, -0.52, -1.16, -1.13, -0.55, -1.34, -0.95, -0.73, -0.99],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 0,
				},
			},
			wang: {
				idle: {
					loop: 4,
					step: 0.24,
					waist: [0.82, 0.79, 0.75, 0.71, 0.67, 0.67, 0.72, 0.76, 0.81, 0.8, 0.76, 0.72, 0.68, 0.66, 0.7, 0.75, 0.79, 0.82],
					chest: [2.88, 2.97, 2.88, 2.76, 2.64, 2.52, 2.58, 2.71, 2.84, 2.94, 2.92, 2.8, 2.68, 2.56, 2.54, 2.67, 2.8, 2.88],
					head: [-3.57, -3.51, -3.47, -3.53, -3.58, -3.64, -3.69, -3.65, -3.59, -3.53, -3.47, -3.51, -3.56, -3.62, -3.67, -3.67, -3.61, -3.57],
				},
				greet: {
					loop: 3.267,
					step: 0.16,
					waist: [0.82, 0.62, 0.74, 1.12, 0.81, 0.73, 0.73, 0.73, 0.73, 0.7, 0.64, 0.59, 0.79, 1.06, 1.08, 1.1, 1, 0.87, 0.74, 0.73, 0.79, 0.82],
					chest: [2.88, 2.68, 2.8, 3.18, 2.87, 2.79, 2.79, 2.79, 2.79, 2.76, 2.7, 2.65, 2.85, 3.12, 3.14, 3.16, 3.07, 2.94, 2.81, 2.79, 2.85, 2.88],
					head: [-3.57, -3.72, -3.81, -3.37, -4.1, -4.57, -4.46, -4.36, -4.26, -4.21, -4.33, -4.46, -4.29, -3.6, -3.58, -3.56, -3.59, -3.7, -3.81, -3.87, -3.67, -3.57],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 0,
					idle: { loop: 4, step: 0.08, close: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
					greet: { loop: 3.267, step: 0.08, close: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
				},
			},
			makoto: {
				suppressGreet: true,
				idle: {
					loop: 3,
					step: 0.24,
					waist: [8.67, 8.67, 8.67, 8.67, 8.67, 8.67, 8.67, 8.67, 8.67, 8.67, 8.67, 8.67, 8.67],
					chest: [-3.83, -3.54, -3.24, -3.47, -3.77, -3.6, -3.3, -3.4, -3.7, -3.67, -3.37, -3.34, -3.63, -3.83],
					head: [-5.73, -6.36, -6.99, -6.5, -5.87, -6.22, -6.85, -6.64, -6.01, -6.08, -6.71, -6.78, -6.15, -5.73],
				},
				greet: {
					loop: 1,
					step: 0.16,
					waist: [8.67, 3.81, 3.81, 3.81, 3.81, 3.87, 7.07, 8.67],
					chest: [-3.83, 3.99, 6.34, 6.34, 6.34, 6.23, -0.48, -3.83],
					head: [-5.73, -5.73, -5.73, -5.73, -5.73, -5.73, -5.73],
				},
				move: {
					loop: 2.4,
					step: 0.24,
					waist: [0.01, -0.74, -0.29, -0.36, -0.59, 0.01, -0.74, -0.29, -0.36, -0.59, 0.01],
					chest: [2.26, 2.17, 1.84, 2.64, 1.67, 2.26, 2.17, 1.84, 2.64, 1.67, 2.26],
					head: [-1.71, -2.24, -1.92, -1.98, -2.14, -1.71, -2.24, -1.92, -1.98, -2.14, -1.71],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 0,
				},
			},
			sakiko: {
				idle: {
					loop: 4,
					step: 0.24,
					waist: [5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3, 5.3],
					chest: [1.5, 1.45, 1.51, 1.59, 1.66, 1.74, 1.7, 1.61, 1.53, 1.46, 1.48, 1.56, 1.64, 1.71, 1.73, 1.64, 1.56, 1.5],
					head: [0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36, 0.36],
				},
				greet: {
					loop: 5.633,
					step: 0.16,
					waist: [5.3, 3.88, 2.45, 2.35, 2.35, 2.35, 2.35, 2.35, 2.24, 2.05, 1.85, 1.66, 2.78, 5.86, 8.94, 8.61, 4.92, 1.23, -1, -1, -1, -1, -1, -1, -1.13, -1.85, -2.57, -3.28, -3.88, -1.64, 0.59, 2.82, 5.05, 5.63, 5.46, 5.3],
					chest: [1.5, 1.31, 1.12, 0.92, 0.69, 0.45, 0.22, 0.7, 1.38, -0.21, -2, -3.78, -5.56, -5.58, -5.1, -4.62, -4.76, -4.98, -5.2, -5.25, -5.25, -5.25, -5.25, -5.25, -5.25, -5.52, -5.87, -6.22, -6.57, -5.11, -3.3, -1.48, 0.34, 1.63, 1.57, 1.5],
					head: [0.36, 0.16, -0.04, -0.24, -0.48, -0.72, -0.97, -0.96, -0.55, -1.23, -2.99, -4.75, -6.51, -7.13, -5.81, -4.49, -3.84, -3.94, -4.04, -4.06, -3.91, -3.76, -3.61, -3.46, -3.32, -3.46, -4.14, -4.82, -5.5, -5.29, -3.85, -2.41, -0.97, 0.36, 0.36, 0.36],
				},
				move: {
					loop: 3.333,
					step: 0.24,
					waist: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
					chest: [8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17, 8.17],
					head: [-3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09, -3.09],
				},
				/** Zero is open and `peak` is shut: the channel is a lid angle rather than
				 *  an openness, so it is divided by `peak` before use. */
				blink: { peak: 0,
				},
			},
		};
		/** Used for a character with no measurement of its own. */
		const MOTION_DEFAULT = "closure";
		/* MOTION-END */

		/**
		 * The motion bundle for a character.
		 *
		 * Falls back to `MOTION_DEFAULT` rather than to nothing: a character nobody has measured
		 * borrows the default character's idle, which is a slightly wrong walk and still a living
		 * mascot. Returning `undefined` here would mean a figure that never moves at all, and that
		 * reads as a bug rather than as missing data.
		 *
		 * **The borrowed motion is damped, and that is the whole reason this function is not a
		 * one-liner.** The measurements are absolute bone angles taken from one character's
		 * skeleton. Applying Closure's 28.6° forearm — or his 12.1° leg — to a body drawn with
		 * different proportions does not read as "a slightly wrong walk": it drags the geometry
		 * into a shape that is not a person. Borrowing the *rhythm* is what makes a figure look
		 * alive; borrowing the *amplitude* is what deforms it.
		 *
		 * `blink` is deliberately left alone — it is a schedule, not an angle, and how often a
		 * character blinks does not depend on whose skeleton the sway was measured from.
		 *
		 * @param id - the character id, or `undefined` when there is none.
		 * @returns that character's bundle, or a damped version of the default one.
		 */
		function motionFor(id) {
			const own = SPINE_MOTION[id];
			if (own !== undefined) return own;
			return dampedMotion(SPINE_MOTION[MOTION_DEFAULT]);
		}

		/** How much of a borrowed motion survives. See `motionFor`. */
		const BORROW_DAMP = 0.3;
		const dampedCache = new WeakMap();

		/** A copy of a bundle with its angle channels scaled down. Memoised; bundles are frozen. */
		function dampedMotion(bundle) {
			if (bundle === null || typeof bundle !== "object") return bundle;
			const cached = dampedCache.get(bundle);
			if (cached !== undefined) return cached;
			/**
			 * Scale one animation's angle channels.
			 *
			 * The generated literal puts the channels **directly on the animation** —
			 * `idle.waist`, `idle.chest` — not under a `channels` key. Reading the wrong shape
			 * here is a silent no-op: the spread copies `waist` through untouched and the copy
			 * looks perfectly well-formed while damping nothing at all.
			 */
			const scale = (animation) => {
				if (animation === null || typeof animation !== "object") return animation;
				const copy = { ...animation };
				for (const [name, value] of Object.entries(animation)) {
					// `loop`, `step` and `blink` are not angles: scaling them would change how the
					// animation is *read* rather than how far the figure moves.
					if (name === "loop" || name === "step" || name === "blink") continue;
					if (Array.isArray(value) && value.every((entry) => typeof entry === "number")) {
						copy[name] = value.map((entry) => entry * BORROW_DAMP);
					}
				}
				return copy;
			};
			const copy = { ...bundle, idle: scale(bundle.idle), greet: scale(bundle.greet) };
			dampedCache.set(bundle, copy);
			return copy;
		}

/**
		 * One channel of a measured animation, at a moment in seconds.
		 *
		 * Values are evenly spaced by step, so this is a lerp between two neighbours.
		 * A looping animation wraps; the greeting does not, so it clamps at its end.
		 */
		function sampleMotion(animation, channel, time, looping) {
			const values = animation?.[channel];
			if (values === undefined || values.length === 0) return 0;
			const span = animation.loop;
			const wrapped = looping ? ((time % span) + span) % span : Math.max(0, Math.min(span, time));
			const position = wrapped / animation.step;
			const index = Math.floor(position);
			const ratio = position - index;
			const next = looping ? (index + 1) % values.length : Math.min(values.length - 1, index + 1);
			const a = values[Math.min(values.length - 1, index)];
			const b = values[next];
			return a + (b - a) * ratio;
		}

		/**
		 * The greeting's cross-fade at an age: 0 outside it, 1 in its body.
		 *
		 * Shared by the spine curves and the blink so the two cross-fade on the same
		 * clock — a blink that faded in on its own schedule would drift against the
		 * head it belongs to.
		 */
		function greetBlend(greetAge, loop) {
			return Math.max(0, Math.min(1, greetAge / 0.25, (loop - greetAge) / 0.25));
		}

		/**
		 * Smoothstep between two edges, eased at both ends.
		 *
		 * `buildRig` has one of these too, but it is scoped to that function — so reaching for it
		 * from out here is a `ReferenceError` at the moment the gesture runs, not at the moment
		 * it is written. Which is how the summoning gesture first shipped: it compiled, the
		 * rig-level test passed because it calls `poseRig` directly, and every real click threw
		 * inside the animation frame. The test that caught it was the one that called this
		 * function rather than the thing it feeds.
		 */
		function smoothstep(edge0, edge1, value) {
			const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
			return t * t * (3 - 2 * t);
		}

		/**
		 * The summoning gesture: raise, hold, lower.
		 *
		 * 结城理 holds his Evoker to his temple and pulls the trigger. His official collab chibi
		 * does not contain that pose — every one of its six animations was traced and the hand
		 * never comes within 68.8 units of the head, against 75.6 at rest, so it moves *away* —
		 * which is why this one is written rather than measured.
		 *
		 * Three phases rather than a curve, because the gesture is three phases: the arm comes
		 * up, it stays there while the trigger is pulled, and it comes down. The hold is the
		 * longest part and the only part that reads as *aiming*; a single sine would spend most
		 * of its time at an angle the pose is never at.
		 *
		 * @param age - seconds since the click, or `undefined` when there was none.
		 * @returns 0..1 — how far into the pose the arm is.
		 */
		function summonBlend(age) {
			if (typeof age !== "number" || age < 0) return 0;
			if (age >= SUMMON.total) return 0;
			if (age < SUMMON.raise) return smoothstep(0, SUMMON.raise, age);
			if (age < SUMMON.raise + SUMMON.hold) return 1;
			return 1 - smoothstep(SUMMON.raise + SUMMON.hold, SUMMON.total, age);
		}

		/**
		 * How shut the eyes are at a moment: 0 open, 1 shut.
		 *
		 * The measured channel is a lid angle rather than an openness — it sits at
		 * zero and spikes — so it is divided by the peak it reaches. Read from the
		 * idle, and cross-faded into the greeting's own blinks, so a blink during the
		 * greeting is the game's blink and not this rig's guess.
		 */
		function sampleBlink(time, greetAge, bundle) {
			// The blink is measured per character along with everything else, and it rides in the
			// same bundle. Falling back rather than returning zero keeps one story for the whole
			// rig: a character nobody has measured borrows the default's motion, blink included.
			// `motionFor` is what decides that, and the caller has normally already called it.
			const blink = (bundle ?? motionFor(undefined))?.blink;
			if (blink?.idle === undefined) return 0;
			const idle = sampleMotion(blink.idle, "close", time, true) / blink.peak;
			const greet = blink.greet;
			if (greet === undefined) return idle;
			if (greetAge === undefined || greetAge < 0 || greetAge >= greet.loop) return idle;
			const blend = greetBlend(greetAge, greet.loop);
			const during = sampleMotion(greet, "close", greetAge, false) / blink.peak;
			return idle * (1 - blend) + during * blend;
		}

		/**
		 * The eye's jelly: a damped spring that trails the lid and overshoots.
		 *
		 * The constants are the spec's — a natural frequency of about 9.3 rad/s and a
		 * damping ratio of 0.57 — so the eye squashes as it shuts and springs a little
		 * wide as it opens. The deviation from the lid is what the shader wants; where
		 * the spring has got to on its own is not interesting.
		 *
		 * Where the lid line itself rests is `EYE_CLOSE`, up in the skinning region:
		 * that one belongs to the shader, and this one to the clock.
		 */
		const JELLY = Object.freeze({ stiffness: 86, damping: 10.5 });

		/**
		 * The summoning gesture's timing, in seconds.
		 *
		 * The whole thing has to fit inside the poke's own 1.6 s life, or the arm would still be
		 * coming down when the impulse that raised it is thrown away.
		 */
		const SUMMON = Object.freeze({ raise: 0.34, hold: 0.86, total: 1.54 });

		/**
		 * How far the arm swings, in degrees, and which way.
		 *
		 * Split in two now that there is an elbow. The upper arm carries the arm up to roughly
		 * shoulder height and the forearm folds the rest of the way, which is what puts a hand
		 * beside a head. One bone could only do the first half: it reached 31.6 units short of
		 * the temple and turning it further swung the arm across the chest instead.
		 *
		 * The sum is close to the 158 the single bone used, because the total travel is the same
		 * journey — the difference is that it now bends in the middle rather than sweeping.
		 */
		const SUMMON_UPPER = 140;
		const SUMMON_FOLD = 120;

		/**
		 * Advance the jelly spring by `dt` seconds toward a lid position.
		 *
		 * @param spring - `{ v, form }` from the previous step.
		 * @param close - how shut the eyes are now, 0 open and 1 shut.
		 * @param dt - seconds since the previous step.
		 */
		function stepJelly(spring, close, dt) {
			// A hidden tab resumes with a `dt` of whole seconds. A spring integrated
			// over a step that large does not converge, it explodes, and the eye ends
			// up somewhere off the face.
			const step = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
			const drive = 1 - close;
			const pull = JELLY.stiffness * (drive - spring.form) - JELLY.damping * spring.v;
			const v = spring.v + pull * step;
			const form = spring.form + v * step;
			return { v, form, deviation: Math.max(-1, Math.min(1, form - drive)) };
		}

		/**
		 * Turn a clock and a pointer/impulse state into three bone matrices.
		 *
		 * Every bone is a rotation about its own pivot, composed down the chain: the
		 * neck's pose includes the spine's and the root's, which is what makes the head
		 * follow the body rather than slide against it.
		 *
		 * @param rig - the rig being posed.
		 * @param box - the figure's bounding box in image pixels.
		 * @param state - `{ time, pokeAge, greetAge }` — seconds since mount, seconds
		 *   since the last click, and seconds since the greeting started. The last two
		 *   are undefined when they have not happened.
		 * @returns three 2D affine matrices in image space.
		 */
		function poseRig(rig, box, state) {
			const t = state.time;
			const toImage = (normalised) => ({
				x: box[0] + normalised.x * box[2],
				y: box[1] + normalised.y * box[3],
			});
			const rad = Math.PI / 180;
			// Amplitudes and timing measured from the game rather than guessed. Closure's
			// base chibi ships as a Spine 3.8 model whose idle (`Relax`, 8.00 s) can be
			// sampled: its head turns through about 0.5 degrees and its hip about 0.2,
			// both on a 2.00 s beat. What this used to do — 2.4 degrees of nod drifting
			// over eight seconds — was several times too far and too slow, which is why
			// it read as a slow lean rather than as breathing.
			//
			// The degrees are not a straight copy: the game rigs 297 bones and this rigs
			// three, so an angle does not mean the same thing in both. The period does,
			// and so does the order of magnitude.
			// One loop, and every layer rides a whole number of cycles inside it — 4 for
			// the breath (the 2.00 s beat the model was sampled at), 1 for the weight
			// shift, 3 for a secondary ripple between them. Whole numbers keep the loop
			// seamless; different numbers keep the layers from moving together, which is
			// what stops a long idle from looking like a short one on repeat.
			// The measured idle and greeting. The rotations below are the game's own, not
			// a curve someone picked: Relax moves the waist 0.4 degrees and the head
			// 1.0 over eight seconds, and Interact moves them 17.6 and 4.9.
			// This character's own measured curves. `motion` comes from the caller because the
			// rig does not know who it is drawing; the default is the character the plugin was
			// built around, so a character nobody has measured still breathes.
			const bundle = state.motion ?? motionFor(undefined);
			const idle = bundle.idle;
			const idleWaist = sampleMotion(idle, "waist", t, true);
			const idleChest = sampleMotion(idle, "chest", t, true);
			const idleHead = sampleMotion(idle, "head", t, true);

			// The greeting is a separate animation in the game, not a lengthened idle, so
			// it replaces the idle while it runs. Cross-faded at both ends: cutting
			// straight in and out shows as a jump.
			const greetAge = state.greetAge;
			const greet = bundle.greet;
			// Which clock the arm curves are read on: the greeting is a separate animation
			// with its own timeline, so during it the arm follows that one.
			const at = greetAge !== undefined && greetAge >= 0 && greetAge < greet.loop ? greetAge : t;
			let waist = idleWaist;
			let chest = idleChest;
			let head = idleHead;
			let greeting = 0;
			if (greetAge !== undefined && greetAge >= 0 && greetAge < greet.loop) {
				const blend = greetBlend(greetAge, greet.loop);
				greeting = blend * blend * (3 - 2 * blend);
				waist += (sampleMotion(greet, "waist", greetAge, false) - idleWaist) * greeting;
				chest += (sampleMotion(greet, "chest", greetAge, false) - idleChest) * greeting;
				head += (sampleMotion(greet, "head", greetAge, false) - idleHead) * greeting;
			}

			// Each Spine bone's rotation is relative to its parent, and this rig has no
			// chest bone, so the chest accumulates into the neck along with the head.
			const spineAngle = waist * rad;
			const nod = (chest + head) * rad;
			// The sway and the breath are still this rig's own: the game spreads them
			// across a hundred bones, and three cannot reproduce that distribution.
			const cycles = (count, phase) => Math.sin((Math.PI * 2 * count * t) / idle.loop + (phase ?? 0));

			/**
			 * Walking in, when the character on screen has just changed.
			 *
			 * `Move` is the one of the four animations the rig does not otherwise use that has
			 * anything in it: measuring every bone's translation span across all six shows
			 * `F_IK_L_Foot_I` and `F_IK_R_Foot_I` swinging 89 units — a real walk cycle — while
			 * `Sleep` moves three bones by at most 2.2 and `Sit`'s largest translation is an
			 * eyeball. So Move is the one worth inlining, and this is where it earns its place:
			 * a figure that has just been swapped in walks to its spot instead of appearing there.
			 *
			 * The channels loop, because Move is a loop; the offset does not, because arriving is
			 * a one-way trip. It decays to zero so the figure settles rather than sliding forever.
			 */
			const move = bundle.move;
			let walking = 0;
			let walkShift = 0;
			const walkAge = state.walkAge;
			if (move !== undefined && walkAge !== undefined && walkAge >= 0 && walkAge < move.loop) {
				const blend = greetBlend(walkAge, move.loop);
				walking = blend * blend * (3 - 2 * blend);
				waist += (sampleMotion(move, "waist", walkAge, true) - idleWaist) * walking;
				chest += (sampleMotion(move, "chest", walkAge, true) - idleChest) * walking;
				head += (sampleMotion(move, "head", walkAge, true) - idleHead) * walking;
				walkShift = (1 - walkAge / move.loop) * 0.14;
			}
			const sway = cycles(3, 0.5) * 0.12 * rad;
			const breathe = 1 + cycles(4) * 0.006 + cycles(8) * 0.0016;
			const bounce = cycles(4, Math.PI / 2) * box[3] * 0.003;
			// The legs carry the weight shift in the game; with no leg bones the hip
			// moves by a scaled version of the same signal.
			const shift = sampleMotion(idle, "leg", t, true) * box[2] * 0.0006 + greeting * box[2] * 0.004 + walkShift * box[2];
			const shiftLean = sampleMotion(idle, "leg", t, true) * 0.02 * rad;
			const greetLift = greeting * box[3] * 0.008;
			// The head's share of that lift, in degrees.
			//
			// It has to be its own number. `greetLift` is a *distance* — box height times
			// 0.008, so about four pixels on a chibi — and it was being subtracted from
			// the neck's angle as well, which is a radian quantity. Four pixels of lift
			// is 1.45 when read as radians: 83 degrees. The greeting was folding the
			// character's head onto its shoulder, and it went unnoticed because the
			// result is finite, bounded, and only ever appeared while the greet played.
			const greetNod = greeting * 4 * rad;
			// The click impulse is anchored to the click, not to the page clock, so it
			// decays and rings out from the moment it happened. Both terms are guarded:
			// `0 * Math.sin(undefined)` is NaN, not zero, and one NaN bone matrix blanks
			// the whole sprite.
			const age = state.pokeAge;
			const decay = age === undefined ? 0 : Math.exp(-age * 3.4);
			const squash = age === undefined ? 1 : 1 + decay * Math.sin(age * 22) * 0.055;
			const headKick = age === undefined ? 0 : decay * Math.sin(age * 17 + 0.6) * 8 * rad;

			const rootPivot = toImage(rig.bones[0].pivot);
			const spinePivot = toImage(rig.bones[1].pivot);
			const neckPivot = toImage(rig.bones[2].pivot);

			const mul = (a, b) => {
				const out = new Float32Array(9);
				for (let col = 0; col < 3; col++) {
					for (let row = 0; row < 3; row++) {
						let sum = 0;
						for (let k = 0; k < 3; k++) sum += a[k * 3 + row] * b[col * 3 + k];
						out[col * 3 + row] = sum;
					}
				}
				return out;
			};
			const rig2d = (pivot, angle, scaleX, scaleY, offsetX, offsetY) => {
				const cos = Math.cos(angle);
				const sin = Math.sin(angle);
				const a = cos * scaleX;
				const b = sin * scaleX;
				const c = -sin * scaleY;
				const d = cos * scaleY;
				return new Float32Array([
					a, b, 0,
					c, d, 0,
					pivot.x + offsetX - (a * pivot.x + c * pivot.y),
					pivot.y + offsetY - (b * pivot.x + d * pivot.y),
					1,
				]);
			};

			const root = rig2d(rootPivot, sway + shiftLean, squash, (2 - squash) * breathe, shift, bounce - greetLift - greetLift * 0.35);
			// The greeting is already inside spineAngle and nod: its measured curves are blended
			// into the idle above, so there is nothing extra to add here.
			const spineLocal = rig2d(spinePivot, spineAngle - shiftLean * 0.5, 1, 1, 0, 0);
			const neckLocal = rig2d(neckPivot, nod + headKick - greetNod, 1, 1, 0, 0);
			const spine = mul(root, spineLocal);
			const neck = mul(spine, neckLocal);
			if (rig.bones.length < 5) return [root, spine, neck];

			// The arm's measured rotation: the game's chain is upper arm → forearm → hand
			// and this rig has one bone per side, so the two rotations accumulate.
			//
			// The model only supplies a left arm, because it stands still — mirroring that
			// curve onto the right is more defensible than inventing a second one.
			const armAngle = (source) => (sampleMotion(source, "upperArm", at, source === greet) + sampleMotion(source, "forearm", at, source === greet)) * rad;
			const idleArm = armAngle(idle);
			const greetArm = armAngle(greet);
			const arm = greeting > 0 ? idleArm + (greetArm - idleArm) * greeting : idleArm;
			const armPivotL = toImage(rig.bones[3].pivot);
			const armPivotR = toImage(rig.bones[4].pivot);
			// The hand kick is the click impulse: a small swing, not a full gesture.
			const armLocalL = rig2d(armPivotL, arm + headKick * 0.4, 1, 1, 0, 0);
			// The summoning gesture rides on the right arm, and only on it: the left arm keeps
			// doing whatever the measured idle says, which is what stops the pose from reading
			// as the whole body flinching.
			const summon = state.summon ?? 0;
			// The two angles are constants, but they are overridable so a sweep can search them
			// against a measured hand-to-head distance instead of one guess per run. The defaults
			// are what the app uses; nothing at runtime passes these.
			const upperAngle = (state.summonUpper ?? SUMMON_UPPER) * rad;
			const foldAngle = (state.summonFold ?? SUMMON_FOLD) * rad;
			const armLocalR = rig2d(armPivotR, -arm - headKick * 0.4 - summon * upperAngle, 1, 1, 0, 0);
			// The forearm folds relative to the upper arm. At rest it adds nothing — the game's
			// measured idle is already a shoulder rotation — so it only contributes to the
			// summoning gesture, which is the one pose that needs an elbow.
			const forearmPivotL = toImage(rig.bones[5].pivot);
			const forearmPivotR = toImage(rig.bones[6].pivot);
			const fold = summon * foldAngle;
			const armWorldL = mul(spine, armLocalL);
			const armWorldR = mul(spine, armLocalR);
			return [
				root, spine, neck, armWorldL, armWorldR,
				mul(armWorldL, rig2d(forearmPivotL, fold, 1, 1, 0, 0)),
				mul(armWorldR, rig2d(forearmPivotR, -fold, 1, 1, 0, 0)),
			];
		}
		//#endregion

		

//#region voice
/**
 * Speaking, when the mascot is clicked.
 *
 * Only recordings. The voice lines this used to synthesise were written for the project
 * rather than taken from the game, and a synthetic sentence shown under a character's
 * name reads as that character's line — which it is not. So there is one source now: the
 * official recordings the user puts in `voices/`, named after the character id.
 *
 * A character with no recording is silent. That is the honest outcome: nothing is said,
 * so nothing is shown either.
 */

/**
 * What each official recording says, where the text has been transcribed.
 *
 * Taken from the same voice entry the downloaded file belongs to — the tap response,
 * "戳一下". Where it has not been transcribed the label alone is shown, because a missing
 * sentence is honest and a wrong one is not.
 */
const VOICE_FILE_LINES = {
  closure: { label: "戳一下", ja: "", zh: "别急，我还在算呢。" },
  miuyin: { label: "戳一下", ja: "", zh: "我会把这当作坏孩子的恶作剧，博士。" },
  muelsyse: { label: "戳一下", ja: "ん？", zh: "嗯？" },
  // 「ひらり～っと」是她的招牌台词（部署1），也是那句被念成 "haralido" 的语音。
  yuyuan: { label: "部署1", ja: "ひらり～っと。", zh: "轻轻地……嘿咻。" },
  dusk: { label: "戳一下", ja: "ちょ、墨がこぼれる！", zh: "墨汁要洒了！" },
  makoto: { label: "戳一下", ja: "", zh: "嗯。" },
};

/** The audio element currently speaking, so a second line can cut the first one off. */
let playing;

/**
 * Character id -> URL of the official recording, as reported by the host.
 *
 * Empty on the published page, where there is no voice directory and therefore nothing
 * to play.
 */
let voiceUrls = {};

/** Record the host's voice manifest. */
function setVoiceUrls(map) {
  voiceUrls = map ?? {};
}

/**
 * Play a character's official recording.
 *
 * @returns `{ ja, zh, label, spoke, source, reason }`. `spoke` is false when there is no
 *   recording, which is not an error — it is simply a character without one.
 */
function speakLine(characterId, options = {}) {
  const file = typeof options.url === "string" && options.url !== "" ? options.url : voiceUrls[characterId];
  const official = VOICE_FILE_LINES[characterId] ?? {};
  if (typeof file !== "string" || file === "") {
    return { ja: "", zh: "", label: "", spoke: false, source: null, reason: null };
  }
  try {
    // Held so a second click can stop the first: overlapping lines are unintelligible.
    if (playing !== undefined) {
      playing.pause();
      playing = undefined;
    }
    const audio = new Audio(file);
    audio.volume = options.volume ?? 1;
    playing = audio;
    audio.addEventListener("ended", () => { if (playing === audio) playing = undefined; });
    // `play()` rejects when the page has not been interacted with yet. A click is an
    // interaction, so this only fires in odd cases, and it must not look like a crash.
    audio.play().catch(() => {});
    return {
      ja: official.ja ?? "",
      zh: official.zh ?? "",
      label: official.label ?? "",
      spoke: true,
      source: "file",
      reason: null,
    };
  } catch (error) {
    return {
      ja: "",
      zh: "",
      label: official.label ?? "",
      spoke: false,
      source: "file",
      reason: `the recording could not be played: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Why the last attempt stayed silent, or null when it spoke or had nothing to say. */
function voiceStatus() {
  return playing === undefined ? null : "playing";
}
//#endregion

//#region stylesheet
		const CSS = `
/* Fixed, not absolute: the figure is dragged in viewport coordinates, and an absolutely
   positioned one would slide away from the pointer the moment anything scrolled. The
   right/bottom values are the default seat; a stored position overrides them inline. */
.dsh-mascot-root { position: fixed; right: 20px; bottom: 20px; z-index: 30; pointer-events: none;
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
.dsh-mascot-frame { position: absolute; inset: 0; transition: opacity var(--dsh-mascot-fade, 260ms) ease-in-out; }
.dsh-mascot-frame[data-on="0"] { opacity: 0; }

/* a soft ground shadow that tightens as she bounces */
.dsh-mascot-shadow { position: absolute; left: 50%; bottom: -6px; width: 64px; height: 10px; margin-left: -32px;
  border-radius: 50%; background: radial-gradient(closest-side, rgba(0,0,0,.5), transparent);
  animation: dsh-mascot-shadow 4.8s ease-in-out infinite; }
@keyframes dsh-mascot-shadow { 0%,100% { transform: scale(1); opacity:.55 } 50% { transform: scale(.86); opacity:.35 } }

/* ---------- themed ambient decor ---------- */
.dsh-mascot-decor { position: absolute; inset: 0; pointer-events: none; }

/* ---------- 望：an actual Go board ----------
   The one shape in the set that is a flat square of wood with a grid ruled on it, and the
   one bar that is a grid rather than a quantity being filled. Everything else here is a
   variation on a lit panel; this is a board with stones on it, which is the reference. */
.dsh-mascot-root[data-shape="board"] .dsh-mascot-avatar { border-radius: 2px; }
.dsh-mascot-root[data-shape="board"] .dsh-mascot-decor::before {
  left: 50%; top: 14px; width: 74px; height: 74px; margin-left: -37px; border-radius: 2px;
  background:
    repeating-linear-gradient(0deg, rgba(26,20,12,.5) 0 1px, transparent 1px 9.25px),
    repeating-linear-gradient(90deg, rgba(26,20,12,.5) 0 1px, transparent 1px 9.25px);
  border: 1px solid rgba(26, 20, 12, .65); box-shadow: 0 6px 16px rgba(0,0,0,.4); }
.dsh-mascot-root[data-shape="board"] .dsh-mascot-decor::after {
  left: 50%; top: 14px; width: 74px; height: 74px; margin-left: -37px;
  /* Three stones — two black, one shell — placed off the star points. */
  background:
    radial-gradient(circle at 27% 26%, #0d0c0a 0 4.5px, transparent 5px),
    radial-gradient(circle at 63% 42%, #f4efe4 0 4.5px, transparent 5px),
    radial-gradient(circle at 41% 68%, #0d0c0a 0 4.5px, transparent 5px),
    radial-gradient(circle at 76% 74%, #f4efe4 0 4.5px, transparent 5px); }
.dsh-mascot-root[data-bar="grid"] .dsh-mascot-bar { height: 8px; border-radius: 1px;
  background:
    repeating-linear-gradient(90deg, rgba(255,255,255,.14) 0 1px, transparent 1px 6px),
    rgba(0,0,0,.35); }
.dsh-mascot-root[data-bar="grid"] .dsh-mascot-bar > i { border-radius: 1px; }
/* The drawn room, for a machine that has not downloaded the real one. */
.dsh-mascot-root[data-shape="board"] .dsh-mascot-scene {
  background:
    linear-gradient(to top, #221a11 0 20%, transparent 20%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.2) 0 1px, transparent 1px 13px),
    repeating-linear-gradient(90deg, rgba(0,0,0,.2) 0 1px, transparent 1px 13px),
    linear-gradient(168deg, #6d5432, #3a2c1a 72%); }
.dsh-mascot-root[data-shape="board"] .dsh-mascot-scene::before {
  left: 50%; bottom: 21%; width: 58px; height: 58px; margin-left: -29px; border-radius: 2px;
  background: linear-gradient(160deg, #d8b877, #a8853f);
  box-shadow: 0 3px 0 rgba(0,0,0,.35), inset 0 0 0 1px rgba(90, 66, 28, .7); }
.dsh-mascot-root[data-shape="board"] .dsh-mascot-scene::after {
  left: 50%; bottom: 21%; width: 58px; height: 58px; margin-left: -29px;
  background:
    radial-gradient(circle at 32% 34%, #0d0c0a 0 4px, transparent 4.5px),
    radial-gradient(circle at 66% 58%, #f4efe4 0 4px, transparent 4.5px); }

/* ---------- the room behind the figure ----------
   A backdrop per character, drawn from gradients and pseudo-elements: a wall, a floor, and
   two pieces of furniture. Nothing here is anybody's artwork — the reference is the *kind*
   of room a character belongs in, the way a dormitory furniture set is a kind of room
   rather than a picture of one. Only two pseudo-elements are available per box, so each
   room is a wall, a floor, and two shapes; that budget is the reason these read as
   silhouettes rather than as illustrations, and it is the right trade here — the figure is
   what the eye should land on. */
.dsh-mascot-scene { position: absolute; left: 50%; top: 16px; bottom: -2px; width: 134px; margin-left: -67px;
  border-radius: 15px; overflow: hidden; pointer-events: none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 12px 30px rgba(0,0,0,.36); }
/* A real picture, when the machine has one: it replaces the drawn furniture, and the drawn
   wall and floor go with it — a photo of a room with a drawn floor in front of it is worse
   than either alone. The art directory is gitignored, so nothing here is ever committed. */
.dsh-mascot-scene[data-image="1"] { background: #0f131d center / cover no-repeat; }
.dsh-mascot-scene[data-image="1"]::before, .dsh-mascot-scene[data-image="1"]::after { content: none; }
.dsh-mascot-scene::before, .dsh-mascot-scene::after { content: ""; position: absolute; }

/* 可露希尔的万能空间 —— 参考官方家具套装的构图：深蓝房间、L 形白桌、两块屏幕、
   桌下青色灯带、墙上海报与搁板上的小机器人、以及那块印着触手纹的蓝地毯。
   一个元素 + 两个伪元素画完整间房，每一层都是 background 里的一条渐变。 */
.dsh-mascot-root[data-shape="console"] .dsh-mascot-scene {
  background:
    linear-gradient(to top, #1a2130 0 22%, transparent 22%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 22px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.035) 0 1px, transparent 1px 22px),
    linear-gradient(168deg, #232c40, #0f131d 72%); }
.dsh-mascot-root[data-shape="console"] .dsh-mascot-scene::before {
  inset: 0;
  background:
    /* 桌下的青色灯带 —— 这套家具最容易认的一笔 */
    linear-gradient(to right, transparent, rgba(96, 232, 255, .75), transparent) 22px 112px / 92px 2px no-repeat,
    /* 桌前挡板 */
    linear-gradient(180deg, #98a4b6, #5e6a7d) 6px 96px / 122px 17px no-repeat,
    /* 桌面 */
    linear-gradient(180deg, #dee5ee, #aab6c6) 4px 90px / 126px 6px no-repeat,
    /* 右屏：代码。屏幕压暗一档 —— 它们是背光的面板，不是纸 */
    linear-gradient(180deg, #cddcec, #7f93ad) 72px 60px / 42px 30px no-repeat,
    /* 左屏：蓝图 */
    linear-gradient(180deg, #d6e2f0, #8699b2) 12px 58px / 44px 32px no-repeat,
    /* 墙上搁板，和架上的小机器人 */
    linear-gradient(180deg, #93a0b2, #5c677a) 8px 32px / 36px 3px no-repeat,
    linear-gradient(180deg, #e3eaf3, #93a0b2) 17px 19px / 18px 13px no-repeat; }
.dsh-mascot-root[data-shape="console"] .dsh-mascot-scene::after {
  inset: 0;
  background:
    /* 地毯本身：深蓝底，浅色包边 */
    linear-gradient(180deg, #23395f, #16233c) 12px 124px / 110px 30px no-repeat,
    linear-gradient(180deg, rgba(255,255,255,.5), rgba(255,255,255,.16)) 12px 124px / 110px 2px no-repeat,
    /* 三块触手纹：蓝底、白圈、中间一点 */
    radial-gradient(ellipse at 50% 50%, #2f6bb8 0 44%, rgba(226,240,255,.8) 45% 56%, transparent 57%) 20px 132px / 34px 19px no-repeat,
    radial-gradient(ellipse at 50% 50%, #3a7ed0 0 44%, rgba(226,240,255,.8) 45% 56%, transparent 57%) 56px 136px / 40px 21px no-repeat,
    radial-gradient(ellipse at 50% 50%, #2f6bb8 0 44%, rgba(226,240,255,.8) 45% 56%, transparent 57%) 98px 130px / 26px 16px no-repeat,
    /* 墙上的海报，右上角那张 */
    linear-gradient(170deg, rgba(244, 206, 82, .92), rgba(198, 146, 36, .78)) 102px 18px / 24px 30px no-repeat,
    linear-gradient(170deg, rgba(120, 160, 210, .5), rgba(60, 90, 130, .5)) 74px 24px / 18px 22px no-repeat; }

/* 莱茵生命实验室 —— 白瓷砖、培养舱、仪器架。 */
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-scene {
  background:
    linear-gradient(to top, #1d241f 0 20%, transparent 20%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 18px),
    repeating-linear-gradient(90deg, rgba(255,255,255,.05) 0 1px, transparent 1px 18px),
    linear-gradient(168deg, #26302a, #141a17 72%); }
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-scene::before {
  left: 9px; bottom: 20%; width: 26px; height: 62px; border-radius: 6px 6px 3px 3px;
  background: linear-gradient(to top, rgba(163, 221, 122, .38), rgba(163, 221, 122, .07));
  border: 1px solid rgba(163, 221, 122, .5); box-shadow: inset 0 8px 14px rgba(163,221,122,.16); }
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-scene::after {
  right: 10px; bottom: 20%; width: 30px; height: 40px;
  background: linear-gradient(160deg, rgba(255,255,255,.12), rgba(255,255,255,.03));
  border: 1px solid rgba(255,255,255,.16); border-radius: 3px;
  box-shadow: 0 0 12px rgba(163, 221, 122, .18); }

/* 露台 —— 一扇落地窗、外面的天、一株绿植。 */
.dsh-mascot-root[data-shape="sky"] .dsh-mascot-scene,
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-scene {
  background:
    linear-gradient(to top, #1a2430 0 19%, transparent 19%),
    linear-gradient(168deg, #1d2a3a, #0f1620 72%); }
.dsh-mascot-root[data-shape="sky"] .dsh-mascot-scene::before,
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-scene::before {
  left: 8px; right: 8px; top: 14px; height: 96px; border-radius: 10px;
  /* Dimmed on purpose: a window onto a bright day is the brightest thing in any of these
     rooms, and at full strength it out-shouts the figure standing in front of it. The
     backdrop's job is to say where the character is, not to be the picture. */
  background: linear-gradient(to top, #3d7ba6 0 18%, #74b6db 18% 40%, #1f547c 40% 100%);
  border: 2px solid rgba(255,255,255,.16);
  box-shadow: inset 0 0 30px rgba(0, 0, 0, .45), inset 0 0 18px rgba(255,255,255,.1); }
.dsh-mascot-root[data-shape="sky"] .dsh-mascot-scene::after,
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-scene::after {
  right: 12px; bottom: 19%; width: 22px; height: 30px;
  background: radial-gradient(ellipse at 50% 100%, rgba(63, 169, 245, .5), transparent 72%);
  border-radius: 50% 50% 20% 20%; }

/* 岁相 —— 宣纸、挂轴、水墨。 */
.dsh-mascot-root[data-shape="ink"] .dsh-mascot-scene {
  background:
    linear-gradient(to top, #14181c 0 18%, transparent 18%),
    repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 1px, transparent 1px 9px),
    linear-gradient(168deg, #1c2430, #0d1116 72%); }
.dsh-mascot-root[data-shape="ink"] .dsh-mascot-scene::before {
  left: 12px; top: 8px; width: 30px; height: 112px; border-radius: 3px;
  background: linear-gradient(to bottom, rgba(232,233,248,.14), rgba(91,111,216,.28));
  border: 1px solid rgba(232, 233, 248, .2);
  box-shadow: inset 0 0 18px rgba(0,0,0,.4); }
.dsh-mascot-root[data-shape="ink"] .dsh-mascot-scene::after {
  left: 14px; top: 40px; width: 26px; height: 34px;
  background: radial-gradient(ellipse at 40% 40%, rgba(20, 24, 30, .85), transparent 68%);
  border-radius: 60% 40% 55% 45%; }

/* 宿舍 —— 一张床、一张海报（结城理那间蓝得发冷的房间）。 */
.dsh-mascot-root[data-shape="frame"] .dsh-mascot-scene {
  background:
    linear-gradient(to top, #141a2a 0 20%, transparent 20%),
    repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 22px),
    linear-gradient(168deg, #1b2338, #0c1019 72%); }
.dsh-mascot-root[data-shape="frame"] .dsh-mascot-scene::before {
  left: 8px; right: 8px; bottom: 19%; height: 26px;
  background: linear-gradient(to top, #2c3a5c, #223050);
  border-radius: 4px 4px 2px 2px; box-shadow: 0 2px 0 rgba(47, 111, 224, .45); }
.dsh-mascot-root[data-shape="frame"] .dsh-mascot-scene::after {
  right: 12px; top: 16px; width: 26px; height: 34px;
  background: linear-gradient(150deg, rgba(47,111,224,.5), rgba(47,111,224,.12));
  border: 1px solid rgba(47, 111, 224, .5); }

/* 舞台 —— 桁架、灯束、音箱（后台那一侧）。 */
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-scene,
.dsh-mascot-root[data-shape="veil"] .dsh-mascot-scene {
  background:
    linear-gradient(to top, #120e1a 0 22%, transparent 22%),
    linear-gradient(168deg, #1d1830, #0b0913 70%); }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-scene::before,
.dsh-mascot-root[data-shape="veil"] .dsh-mascot-scene::before {
  inset: 0;
  background:
    conic-gradient(from 200deg at 22% 0%, rgba(255, 77, 157, .3), transparent 16deg),
    conic-gradient(from 158deg at 78% 0%, rgba(139, 124, 248, .32), transparent 16deg); }
.dsh-mascot-root[data-shape="stage"] .dsh-mascot-scene::after,
.dsh-mascot-root[data-shape="veil"] .dsh-mascot-scene::after {
  left: 10px; bottom: 21%; width: 20px; height: 34px;
  background: linear-gradient(to bottom, #2a2440, #171326);
  border: 1px solid rgba(255,255,255,.14); border-radius: 3px; }

/* 有的房间只用得上一个形状，另一个让给它空着 —— 留白也是构图。 */
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-scene::after { opacity: .55; }
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
/* The separators are elements rather than text so the gap stays even and a separator never
   ends up trailing a figure that failed to render. */
.dsh-mascot-chip-sep { width: 1px; height: 9px; background: currentColor; opacity: .22; }

/* ---------- music ---------- */
.dsh-mascot-music { display: flex; align-items: center; gap: 8px; margin: 0 12px 12px;
  padding: 8px 10px; border-radius: var(--dsh-mascot-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsh-mascot-accent, #37e0d8) 7%, transparent);
  border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.08)); }
.dsh-mascot-music-label { flex: none; font-size: 10px; letter-spacing: .06em; opacity: .55; }
.dsh-mascot-music-name { flex: 1 1 auto; min-width: 0; display: grid; }
.dsh-mascot-music-name b { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-music-name small { opacity: .5; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-mascot-music button { flex: none; cursor: pointer; font: inherit; font-size: 11px; line-height: 1;
  padding: 5px 10px; border-radius: 999px; color: inherit; background: transparent;
  border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.14)); }
.dsh-mascot-music button:hover { border-color: var(--dsh-mascot-accent, #37e0d8); }
.dsh-mascot-music button[data-on="1"] { color: var(--dsh-mascot-accent, #37e0d8); border-color: var(--dsh-mascot-accent, #37e0d8); }

/* ---------- panel ---------- */
.dsh-mascot-backdrop { position: absolute; inset: 0; pointer-events: auto; background: rgba(6, 8, 12, .18); }
/* A translucent window rather than an opaque card.
   The per-character surface gradient was ~.97 alpha, which is the same thing as a solid
   panel wearing a gradient: nothing behind it could be seen, so the blur had nothing to
   blur. Instead the glass is mixed from the character's own accent over a near-black, so
   the window is tinted by whoever is standing behind it and the page keeps showing through.
   The solid colour stays as the base of the mix, which is what keeps the text legible when
   the page behind it happens to be light. */
.dsh-mascot-panel { position: absolute; right: 0; bottom: calc(100% + 12px); width: 344px;
  max-width: calc(100vw - 40px);
  /* The ceiling is the space above the dock, and it is worth writing out because guessing it
     wrong is invisible until the panel is full: the dock sits 20px off the bottom and is about
     207px tall (a 172px sprite plus the chip), and the panel leaves a 12px gap below itself, so
     what is left is 100vh minus 239 — rounded to 248 for a margin. Measured, not estimated: with
     the panel's content at 692px, a 900px window gives it 652 and it scrolls instead of putting
     its own heading above the frame. */
  max-height: calc(100vh - 248px); overflow-x: hidden; overflow-y: auto;
  pointer-events: auto; border-radius: var(--dsh-mascot-radius, 18px);
  background:
    linear-gradient(158deg,
      color-mix(in srgb, var(--dsh-mascot-accent, #37e0d8) 13%, rgba(10, 13, 19, .52)),
      color-mix(in srgb, var(--dsh-mascot-accent, #37e0d8) 5%, rgba(7, 9, 14, .66)));
  border: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.09));
  backdrop-filter: blur(26px) saturate(1.35);
  box-shadow: 0 24px 60px rgba(0,0,0,.5), 0 0 0 1px var(--dsh-mascot-accent-soft, rgba(55,224,216,.16)) inset;
  animation: dsh-mascot-in .22s cubic-bezier(.2,.8,.3,1.1); }
@keyframes dsh-mascot-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
.dsh-mascot-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; position: relative;
  border-bottom: 1px solid var(--dsh-mascot-hairline, rgba(255,255,255,.07));
  background: color-mix(in srgb, var(--dsh-mascot-accent, #37e0d8) 10%, transparent); }
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

/* ---------- lab: Rhine Lab, clean and scientific ---------- */
/* Ripples on still water, rather than a scanline sweep or a stage pulse. */
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-decor::before,
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-decor::after {
  content: ""; position: absolute; left: 50%; bottom: 10px; border-radius: 50%;
  border: 1px solid var(--dsh-mascot-accent-line, rgba(95,184,240,.55));
  animation: dsh-mascot-ripple 4.2s ease-out infinite; }
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-decor::before { width: 90px; height: 22px; margin-left: -45px; }
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-decor::after { width: 90px; height: 22px; margin-left: -45px; animation-delay: 2.1s; }
@keyframes dsh-mascot-ripple {
  0% { transform: scale(.5); opacity: .7 }
  100% { transform: scale(2.1); opacity: 0 } }
/* A thin ring instead of a filled plate or a circle: a lens, not a badge. */
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-avatar {
  border-radius: 7px; box-shadow: 0 0 0 1px var(--dsh-mascot-accent-line, rgba(95,184,240,.55)) inset; }
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-cell { background: transparent;
  border-style: dashed; border-color: var(--dsh-mascot-hairline, rgba(140,200,240,.16)); }
.dsh-mascot-root[data-shape="lab"] .dsh-mascot-stamp { letter-spacing: 1.4px; text-transform: uppercase; }

/* A hairline meter: a single 2px rule with a bead riding its end, rather than a
   segmented strip or a glowing tube. */
.dsh-mascot-root[data-bar="hairline"] .dsh-mascot-bar {
  height: 2px; border-radius: 0; background: var(--dsh-mascot-hairline, rgba(140,200,240,.16)); }
.dsh-mascot-root[data-bar="hairline"] .dsh-mascot-bar > i {
  border-radius: 0; height: 2px;
  box-shadow: 0 0 6px var(--dsh-mascot-accent-line, rgba(95,184,240,.55)); }
.dsh-mascot-root[data-bar="hairline"] .dsh-mascot-bar > i::after {
  content: ""; position: absolute; right: -2px; top: -3px; width: 8px; height: 8px;
  border-radius: 50%; background: var(--dsh-mascot-accent, #5fb8f0);
  box-shadow: 0 0 8px var(--dsh-mascot-accent-line, rgba(95,184,240,.55)); }

/* ---------- veil: Ave Mujica 的幕布 ---------- */
/* 一块从上方垂下的暗蓝幕布，缓慢呼吸，没有扫描线。 */
.dsh-mascot-root[data-shape="veil"] .dsh-mascot-decor::before {
  content: ""; position: absolute; inset: 0; opacity: .55;
  background: linear-gradient(to bottom, var(--dsh-mascot-accent-soft, rgba(139,124,248,.15)), transparent 62%); }
.dsh-mascot-root[data-shape="veil"] .dsh-mascot-decor::after {
  content: ""; position: absolute; left: 12%; right: 12%; top: 0; height: 1px;
  background: var(--dsh-mascot-accent-line, rgba(139,124,248,.58));
  animation: dsh-mascot-veil 5.2s ease-in-out infinite; }
@keyframes dsh-mascot-veil {
  0%, 100% { opacity: .35; transform: translateY(0) }
  50% { opacity: .9; transform: translateY(4px) } }
.dsh-mascot-root[data-shape="veil"] .dsh-mascot-avatar { border-radius: 4px 4px 14px 14px; }

/* ---------- sky: 晴空，上方一片开阔的光 ---------- */
.dsh-mascot-root[data-shape="sky"] .dsh-mascot-decor::before {
  content: ""; position: absolute; left: 50%; top: -34px; width: 150px; height: 92px; margin-left: -75px;
  border-radius: 50%; background: radial-gradient(circle, var(--dsh-mascot-accent-soft, rgba(63,169,245,.15)), transparent 70%);
  animation: dsh-mascot-sky 6.4s ease-in-out infinite; }
@keyframes dsh-mascot-sky {
  0%, 100% { transform: scale(1); opacity: .7 }
  50% { transform: scale(1.12); opacity: 1 } }
.dsh-mascot-root[data-shape="sky"] .dsh-mascot-decor::after { content: none; }
.dsh-mascot-root[data-shape="sky"] .dsh-mascot-avatar { border-radius: 50% 50% 42% 42%; }

/* ---------- pool: 一池静水，同心环从底部漫上来 ---------- */
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-decor::before,
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-decor::after {
  content: ""; position: absolute; left: 50%; bottom: 2px; width: 120px; height: 30px; margin-left: -60px;
  border-radius: 50%; border: 1px solid var(--dsh-mascot-accent-line, rgba(79,214,232,.58));
  animation: dsh-mascot-pool 5.6s ease-out infinite; }
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-decor::after { animation-delay: 2.8s; }
@keyframes dsh-mascot-pool {
  0% { transform: scale(.35); opacity: .75 }
  100% { transform: scale(2.4); opacity: 0 } }
.dsh-mascot-root[data-shape="pool"] .dsh-mascot-avatar { border-radius: 999px 999px 8px 8px; }

/* ---------- beam: 一条细线，前端一颗亮点 ---------- */
.dsh-mascot-root[data-bar="beam"] .dsh-mascot-bar {
  height: 1px; border-radius: 0; background: var(--dsh-mascot-hairline, rgba(170,160,250,.17)); }
.dsh-mascot-root[data-bar="beam"] .dsh-mascot-bar > i { border-radius: 0; height: 1px; position: relative; }
.dsh-mascot-root[data-bar="beam"] .dsh-mascot-bar > i::after {
  content: ""; position: absolute; right: -3px; top: -2px; width: 6px; height: 5px;
  background: var(--dsh-mascot-accent, #8b7cf8);
  box-shadow: 0 0 10px var(--dsh-mascot-accent-line, rgba(139,124,248,.58)); }

/* ---------- blocks: 大块方砖，像加载进度 ---------- */
.dsh-mascot-root[data-bar="blocks"] .dsh-mascot-bar { border-radius: 3px; }
.dsh-mascot-root[data-bar="blocks"] .dsh-mascot-bar > i {
  border-radius: 3px;
  -webkit-mask-image: repeating-linear-gradient(to right, #000 0 12px, transparent 12px 17px);
  mask-image: repeating-linear-gradient(to right, #000 0 12px, transparent 12px 17px); }

/* ---------- wave: 明暗交替的波纹 ---------- */
.dsh-mascot-root[data-bar="wave"] .dsh-mascot-bar { border-radius: 99px; height: 7px; }
.dsh-mascot-root[data-bar="wave"] .dsh-mascot-bar > i {
  border-radius: 99px;
  -webkit-mask-image: repeating-linear-gradient(115deg, #000 0 7px, rgba(0,0,0,.45) 7px 14px);
  mask-image: repeating-linear-gradient(115deg, #000 0 7px, rgba(0,0,0,.45) 7px 14px); }

/* ---------- ink: 水墨，边缘像宣纸上的墨晕开 ---------- */
.dsh-mascot-root[data-shape="ink"] .dsh-mascot-decor::before {
  content: ""; position: absolute; inset: -6px; border-radius: 40% 55% 45% 60%;
  background: radial-gradient(ellipse at 30% 20%, var(--dsh-mascot-accent-soft, rgba(91,111,216,.15)), transparent 68%);
  filter: blur(5px); animation: dsh-mascot-ink 9s ease-in-out infinite; }
.dsh-mascot-root[data-shape="ink"] .dsh-mascot-decor::after {
  content: ""; position: absolute; left: 8%; right: 8%; bottom: 0; height: 2px;
  background: linear-gradient(to right, transparent, var(--dsh-mascot-accent-line, rgba(91,111,216,.55)) 35%, transparent);
  animation: dsh-mascot-ink-line 6s ease-in-out infinite; }
@keyframes dsh-mascot-ink {
  0%, 100% { transform: scale(1) rotate(0deg); opacity: .75 }
  50% { transform: scale(1.08) rotate(-2deg); opacity: 1 } }
@keyframes dsh-mascot-ink-line {
  0%, 100% { opacity: .4; transform: scaleX(.9) }
  50% { opacity: .95; transform: scaleX(1) } }
.dsh-mascot-root[data-shape="ink"] .dsh-mascot-avatar { border-radius: 46% 54% 50% 50% / 40% 44% 56% 60%; }

/* ---------- frame: 硬边框 + 四角刻线 ---------- */
.dsh-mascot-root[data-shape="frame"] .dsh-mascot-decor::before {
  content: ""; position: absolute; inset: 3px; border: 1px solid var(--dsh-mascot-hairline, rgba(110,160,240,.16)); }
.dsh-mascot-root[data-shape="frame"] .dsh-mascot-decor::after {
  content: ""; position: absolute; left: 0; top: 0; width: 14px; height: 14px;
  border-left: 2px solid var(--dsh-mascot-accent, #2f6fe0); border-top: 2px solid var(--dsh-mascot-accent, #2f6fe0);
  animation: dsh-mascot-frame 4.4s steps(2, end) infinite; }
@keyframes dsh-mascot-frame { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }
.dsh-mascot-root[data-shape="frame"] .dsh-mascot-avatar { border-radius: 0; }

/* ---------- brush: 收锋的笔画 ---------- */
.dsh-mascot-root[data-bar="brush"] .dsh-mascot-bar { height: 5px; border-radius: 0 3px 3px 0; }
.dsh-mascot-root[data-bar="brush"] .dsh-mascot-bar > i {
  border-radius: 0 3px 3px 0;
  -webkit-mask-image: linear-gradient(to right, #000 55%, rgba(0,0,0,.35));
  mask-image: linear-gradient(to right, #000 55%, rgba(0,0,0,.35)); }

/* ---------- ticks: 刻度条 ---------- */
.dsh-mascot-root[data-bar="ticks"] .dsh-mascot-bar { height: 9px; border-radius: 0; background: transparent; }
.dsh-mascot-root[data-bar="ticks"] .dsh-mascot-bar > i {
  border-radius: 0;
  -webkit-mask-image: repeating-linear-gradient(to right, #000 0 3px, transparent 3px 6px);
  mask-image: repeating-linear-gradient(to right, #000 0 3px, transparent 3px 6px); }

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
/* A label sharing a line with its control rather than taking a row of its own. */
.dsh-mascot-inline { align-items: center; overflow: visible; }
.dsh-mascot-inline .dsh-mascot-picker-label { flex: none; }
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
		/**
		 * The remembered bone-rig preference.
		 * @returns true/false when the operator has chosen, or undefined when they
		 *   never have — which is what lets the plugin config supply the default
		 *   without overriding a deliberate choice made in the panel.
		 */
		function readStoredRig() {
			try {
				const value = window.localStorage.getItem(RIG_KEY);
				if (value === "on") return true;
				if (value === "off") return false;
				return undefined;
			} catch {
				return undefined;
			}
		}
		/** Persist the bone-rig preference. */
		function writeStoredRig(value) {
			try {
				window.localStorage.setItem(RIG_KEY, value ? "on" : "off");
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
				// The user's own voice files, if any are in the host's voice directory. The
				// repository ships none: this is whatever is on this machine.
				if (payload.voiceBase !== undefined && payload.voices !== undefined) {
					const base = String(payload.voiceBase).replace(/\/+$/u, "");
					setVoiceUrls(Object.fromEntries(Object.entries(payload.voices).map(([id, file]) => [id, `${base}/${encodeURIComponent(String(file))}`])));
				}
				return payload;
			} catch {
				return undefined;
			}
		}
		//#endregion

		//#region art
		/** Where the host half serves `art/`; tests and the preview harness override it. */
		let artBase = "/dsh-mascot/art";
		/** Whether the skinned renderer runs; the panel can switch it off. */
		let skeletonEnabled = true;

		/** URL of one frame of one look. */
		function frameUrl(frame) {
			return `${artBase}/${frame.file}`;
		}

		/** URL of a character's own backdrop picture, when the machine has one. */
		function roomUrl(file) {
			return `${artBase}/${file}`;
		}

		/** Where the daily spend ledger lives; derived from the art base so it follows the prefix. */
		function usageUrl() {
			return `${artBase.replace(/\/art$/u, "")}/api/usage`;
		}

		/**
		 * Tell the host what this session has spent, and read back the day's total.
		 *
		 * The session's figure is the browser's to know — it comes from the session
		 * projection. The day's is the host's, because a session that ended took its
		 * numbers with it. Sending a cumulative total rather than a delta means a dropped
		 * request costs nothing: the next one carries the same information.
		 *
		 * @param sessionId - the session being reported on.
		 * @param total - its cumulative spend.
		 * @returns the day's total, or `undefined` when the host could not answer.
		 */
		async function reportUsage(sessionId, total) {
			try {
				const response = await fetch(usageUrl(), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId, total }),
				});
				if (!response.ok) return undefined;
				const payload = await response.json();
				return payload?.ok === true && typeof payload.today === "number" ? payload.today : undefined;
			} catch {
				return undefined;
			}
		}

		/** Read the day's total without reporting anything. */
		async function readToday() {
			try {
				const response = await fetch(usageUrl(), { headers: { accept: "application/json" } });
				if (!response.ok) return undefined;
				const payload = await response.json();
				return payload?.ok === true && typeof payload.today === "number" ? payload.today : undefined;
			} catch {
				return undefined;
			}
		}

		/**
		 * The day's spend, kept in step with the session's.
		 *
		 * Debounced rather than throttled: a session reports once things stop changing, and
		 * the cleanup cancels a report a newer total has already superseded. That is one
		 * request per quiet moment instead of one per projection update.
		 *
		 * @param sessionId - the session being reported on.
		 * @param total - its cumulative spend, or `undefined` while it is unknown.
		 * @returns the day's total, or `undefined` if it has never been measured.
		 */
		function useTodaySpend(sessionId, total) {
			const [today, setToday] = React.useState(undefined);
			React.useEffect(() => {
				let cancelled = false;
				readToday().then((value) => {
					if (!cancelled && value !== undefined) setToday(value);
				});
				return () => {
					cancelled = true;
				};
			}, []);
			React.useEffect(() => {
				if (typeof total !== "number" || typeof sessionId !== "string" || sessionId === "") return undefined;
				let cancelled = false;
				const timer = window.setTimeout(() => {
					reportUsage(sessionId, total).then((value) => {
						if (!cancelled && value !== undefined) setToday(value);
					});
				}, 500);
				return () => {
					cancelled = true;
					window.clearTimeout(timer);
				};
			}, [sessionId, total]);
			return today;
		}

		/** A figure that fits a chip: 812,400 → "812k", 1,240,000 → "1.2M". */
		function compact(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			if (value < 1000) return String(Math.round(value));
			if (value < 1000000) return `${String(Math.round(value / 1000))}k`;
			if (value < 1000000000) return `${(value / 1000000).toFixed(value < 10000000 ? 1 : 0)}M`;
			return `${(value / 1000000000).toFixed(1)}B`;
		}

		/**
		 * Whether the bone rig may run at all. The per-look answer also needs the look
		 * to carry a measured silhouette, which `Sprite` checks.
		 */
		function rigAvailable() {
			return skeletonEnabled;
		}

		/**
		 * The sprite drawn by the bone rig.
		 *
		 * Loads the frame's image, builds the auto-rig from the measured silhouette and
		 * drives it from one animation-frame loop. If anything in that chain fails — no
		 * WebGL2, a refused context, a broken image — it renders the plain still
		 * instead, so this can only ever add motion, never remove the mascot.
		 */
		function SkinnedSprite({ look, className, seat, seatSize, onUnavailable, gesture, motion }) {
			const frame = look?.frames?.[0];
			const framing = frame?.seat?.[seat];
			// The figure's bounds live on the frame's measurement, not on the seat
			// framing: the mesh covers the figure, while the framing positions the
			// whole image inside the seat.
			const box = frame?.measured?.box;
			// The eye boxes arrive as fractions of the figure's **body** box — the same
			// denominator the anatomy prior uses, which is why the two can be compared at
			// all — while the mesh is laid over `box`, which is the whole silhouette
			// including anything the figure is holding. Convert once, here, so the
			// skinner only ever deals in image pixels and never has to know which
			// normalisation it was handed.
			const body = frame?.body;
			// `blinkable` is the art index saying these boxes were checked against the
			// artwork. It is a stricter thing than `eyes` being present: a blink collapses
			// everything inside the box onto the lid line, so a box that sits beside the
			// eye rather than on it drags the fringe down instead of closing anything.
			const eyes = frame?.blinkable === true && Array.isArray(frame?.eyes) && frame.eyes.length >= 2 && body !== undefined
				? frame.eyes.slice(0, 2).map((eye) => [
					body.x + eye[0] * body.w,
					body.y + eye[1] * body.h,
					eye[2] * body.w,
					eye[3] * body.h,
				])
				: null;
			const host = React.useRef(null);
			const [ready, setReady] = React.useState(false);
			const pokeRef = React.useRef(undefined);
			/** The jelly spring's state. `form` starts open, which is where the eyes are. */
			const jellyRef = React.useRef({ v: 0, form: 1 });
			/** Seconds since the greeting started, or undefined while it is not playing. */
			const greetRef = React.useRef(undefined);
			/** Seconds since the figure started walking to its spot, or undefined when it has arrived. */
			const walkRef = React.useRef(undefined);
			/**
			 * Walk in whenever the look changes.
			 *
			 * Done during render, the same way the frame picker resets on a look change: this is a
			 * reaction to a prop changing, not to an event, and `useEffect` would run it one frame
			 * late — which for a one-shot entrance animation is a visible stutter at the start.
			 */
			const [walkedIn, setWalkedIn] = React.useState(look?.id);
			if (walkedIn !== look?.id) {
				setWalkedIn(look?.id);
				walkRef.current = 0;
			}
			/**
			 * Whether this character may be greeted at all.
			 *
			 * A ref because the effect below runs once, while the motion bundle is a fresh
			 * object on every render. 结城理's measured greeting comes out of the rig as a
			 * deformation rather than as a gesture, so his bundle says so and nothing plays —
			 * a figure that holds still is a smaller wrong than one that folds in half.
			 */
			const greetAllowed = React.useRef(true);
			greetAllowed.current = motion?.suppressGreet !== true;
			/** Greet once when the sprite first appears, and again on each hover. */
			React.useEffect(() => {
				greetRef.current = greetAllowed.current ? 0 : undefined;
				const node = host.current;
				if (node === null) return undefined;
				const onEnter = () => {
					if (!greetAllowed.current) return;
					// Restart rather than ignore: pointing at the mascot is a fresh
					// greeting, not a duplicate one.
					greetRef.current = 0;
				};
				node.addEventListener("pointerenter", onEnter);
				return () => node.removeEventListener("pointerenter", onEnter);
			}, []);
			const unavailable = React.useRef(onUnavailable);
			unavailable.current = onUnavailable;

			// Reaches the pose from the click handler without forcing a re-render.
			React.useEffect(() => {
				if (host.current !== null) host.current.__poke = () => { pokeRef.current = 0; };
			});

			React.useEffect(() => {
				if (host.current === null || frame === undefined || framing === undefined || box === undefined) return undefined;
				let cancelled = false;
				let raf;
				let skinner;
				let observer;
				let last;
				let age;
				let greetAge;
				const image = new Image();
				image.decoding = "async";
				image.onload = () => {
					if (cancelled || host.current === null) return;
					// The arms are what carry the measured idle and the summoning gesture, and this
					// call used to leave them off: `poseRig` returns three bones when the rig has
					// fewer than five, so everything downstream of that early return — the whole
					// arm channel, the pose 结城理 is meant to strike — was computed and discarded.
					// The artwork's shoulder measurements have been in the index all along.
					const rig = buildRig(frame.profile, {
						...(eyes === null ? BODY_MESH : EYE_MESH),
						arms: frame.arms ?? null,
						// `halfWidth` is in stature units and the rig normalises x to the box width,
						// which is why the two have to be divided.
						aspect: box !== undefined && Array.isArray(box) && box[3] > 0 ? box[2] / box[3] : 1,
					});
					const built = createSkinner(image, rig, framing, box, seatSize, eyes);
					if (built === undefined) {
						unavailable.current?.();
						return;
					}
					skinner = built;
					host.current.append(skinner.canvas);

					skinner.canvas.style.width = "100%";
					skinner.canvas.style.height = "100%";
					skinner.canvas.style.display = "block";
					const dpr = Math.min(2, window.devicePixelRatio || 1);
					skinner.resize(Math.round(seatSize.width * dpr), Math.round(seatSize.height * dpr));
					const started = performance.now();
					const loop = (now) => {
						if (cancelled) return;
						raf = window.requestAnimationFrame(loop);
						const elapsed = (now - started) / 1000;
						const step = (now - (last ?? now)) / 1000;
						if (pokeRef.current !== undefined) {
							pokeRef.current += step;
							if (pokeRef.current > 1.6) pokeRef.current = undefined;
							age = pokeRef.current;
						} else {
							age = undefined;
						}
						if (greetRef.current !== undefined) {
							greetRef.current += step;
							if (greetRef.current > motion.greet.loop) greetRef.current = undefined;
							greetAge = greetRef.current;
						} else {
							greetAge = undefined;
						}
						last = now;
						let walkAge;
						if (walkRef.current !== undefined) {
							walkRef.current += step;
							if (walkRef.current > (motion.move?.loop ?? 0)) walkRef.current = undefined;
							walkAge = walkRef.current;
						}
						// The blink is read from the clock, not accumulated, so a dropped
						// frame cannot make it drift; the jelly is integrated, because a
						// spring's whole point is where it has been.
						const close = sampleBlink(elapsed, greetAge, motion);
						jellyRef.current = stepJelly(jellyRef.current, close, step);
						skinner.draw(
							poseRig(rig, box, {
								time: elapsed,
								pokeAge: age,
								greetAge,
								// Only a character that declares the gesture gets it. An arm flung to
								// the temple on everyone would be a bug wearing a feature's clothes.
								summon: gesture === "evoker" ? summonBlend(age) : 0,
								motion,
								walkAge,
							}),
							{ close, jelly: jellyRef.current.deviation },
						);
					};
					raf = window.requestAnimationFrame(loop);
					// A dock that is off-screen should not keep a GPU busy. Chrome already
					// throttles hidden tabs, but scrolling it out of view is different.
					if (typeof IntersectionObserver === "function") {
						observer = new IntersectionObserver((entries) => {
							const visible = entries.every((entry) => entry.isIntersecting);
							if (visible && raf === undefined) raf = window.requestAnimationFrame(loop);
							if (!visible && raf !== undefined) {
								window.cancelAnimationFrame(raf);
								raf = undefined;
							}
						});
						observer.observe(skinner.canvas);
					}
					setReady(true);
				};
				image.onerror = () => {
					unavailable.current?.();
				};
				image.src = frameUrl(frame);
				return () => {
					cancelled = true;
					window.cancelAnimationFrame(raf);
					if (observer !== undefined) observer.disconnect();
					if (skinner !== undefined) skinner.canvas.remove();
				};
			}, [frame, framing, box, seatSize]);

			return h(
				"span",
				{ className: `dsh-mascot-art ${className}`, ref: host, "data-rig": ready ? "1" : "0" },
				ready ? null : h(Frame, { frame, className: "dsh-mascot-rig-still", seat }),
			);
		}

		/**
		 * Resolve which character and look to show.
		 *
		 * The operator's config outranks a stored preference: an install configured
		 * from the web page to use one character must not be quietly overridden by a
		 * stale localStorage entry left over from clicking around.
		 *
		 * @param catalogue - the index the host served, or the fallback catalogue.
		 * @param stored - the last choice made in the panel, if any.
		 * @param preset - `{ character, look }` from the plugin config, if set.
		 * @returns the resolved character and look records.
		 */
		function resolveSelection(catalogue, stored, preset) {
			const characters = catalogue.characters ?? [];
			const looks = catalogue.looks ?? [];
			const pickCharacter = (id) => characters.find((entry) => entry.id === id && entry.looks.length > 0);
			const pickLook = (owner, id) => (id === undefined || id === null || id === "" ? undefined : looks.find((entry) => entry.character === owner.id && entry.id === id));
			const firstOf = (owner) => looks.find((entry) => entry.character === owner.id);
			if (characters.length === 0) return { character: undefined, look: undefined };
			const forced = pickCharacter(preset?.character);
			if (forced !== undefined) return { character: forced, look: pickLook(forced, preset?.look) ?? firstOf(forced) };
			const requested = pickCharacter(stored?.character);
			const character = requested ?? characters[0];
			return { character, look: pickLook(character, stored?.look) ?? firstOf(character) };
		}

		/** One frame of art, falling back to the placeholder if it will not load.
		 * The fallback is what a fresh clone shows, so it must work offline.
		 */
		function Frame({ frame, className, seat }) {
			const url = frame === undefined ? null : frameUrl(frame);
			const [failed, setFailed] = React.useState(false);
			const [attempted, setAttempted] = React.useState(url);
			if (attempted !== url) {
				setAttempted(url);
				setFailed(false);
			}
			const framing = frame?.seat?.[seat];
			if (url === null || failed || framing === undefined) {
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
		function Sprite({ look, className, seat, seatSize, useRig, onUnavailable, gesture }) {
			const frames = look?.frames ?? [];
			const [index, setIndex] = React.useState(0);
			// The bone rig supersedes the frame cross-fade: both at once would have the
			// pose change and the deformation fighting over the same pixels. A look with
			// no measured silhouette, or a session where the context was refused, keeps
			// whichever simpler path applies.
			// Only the chibi figures are rigged. A portrait has a measured profile too, so
			// "has a profile" was never the right question — the declaration is.
			const still = frames[0]?.still === true;
			const rigged = useRig === true && !still && seatSize !== undefined && frames[0]?.profile != null;
			const animated = frames.length > 1 && !rigged && !still;
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
			if (rigged) {
				return h(SkinnedSprite, { look, className, seat, seatSize, onUnavailable, gesture, motion: motionFor(look?.character) });
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
			// An account can hold more than one currency and the headline shows one of
			// them. Showing the rest beats dropping them: a USD balance sitting next to a
			// CNY one is information, not noise, and it is what makes the choice visible.
			const others = Array.isArray(balance.wallets) ? balance.wallets.filter((wallet) => wallet.currency !== balance.currency) : [];
			for (const wallet of others) parts.push(`${wallet.currency} ${currencySymbol(wallet.currency)}${wallet.totalBalance ?? "0.00"}`);
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
				rigOn, rigFailed, onToggleRig, showBalance, siren, songs,
			} = props;
			const usage = useProjection("tokenUsage");
			const pressure = useProjection("contextPressure");
			const stats = deriveStats(usage, pressure);
			const installed = (look?.frames?.length ?? 0) > 0;

			/**
			 * This character's music, if there is any.
			 *
			 * Two sources, and the order between them is the point: the Siren Records album the
			 * character belongs to comes first because it is the game's own label, and the Apple
			 * preview underneath is only there for the two characters Siren does not cover.
			 * Neither file is ever fetched by this plugin — `src` is a URL on the rights holder's
			 * CDN, and the browser streams it from there.
			 */
			const record = siren?.[character?.id];
			const song = songs?.[character?.id];
			const music =
				typeof record?.track?.src === "string"
					? { label: "塞壬唱片", title: record.track.name, sub: record.album, src: record.track.src, detail: record.event ?? "" }
					: typeof song?.src === "string"
						? { label: song.kind ?? "主题曲", title: song.title, sub: song.band ?? "", src: song.src, detail: song.work ?? "" }
						: undefined;
			const [playing, setPlaying] = React.useState(false);
			const audioRef = React.useRef(null);
			// Leaving the panel stops the music. A mascot that keeps playing after you close it is
			// a mascot you mute in the mixer, and then never turn back on.
			React.useEffect(() => () => { audioRef.current?.pause(); }, []);
			const toggleMusic = () => {
				if (music === undefined) return;
				if (playing) {
					audioRef.current?.pause();
					setPlaying(false);
					return;
				}
				const audio = audioRef.current ?? new Audio(music.src);
				// The CDN serves a browser; a page that sends a Referer from a localhost origin is
				// the shape of thing it is entitled to refuse.
				audio.referrerPolicy = "no-referrer";
				audio.addEventListener("ended", () => setPlaying(false), { once: true });
				audioRef.current = audio;
				audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
			};

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
						h(
							"div",
							{ className: "dsh-mascot-hint" },
							`${count(stats.occupancy)} / ${count(stats.contextWindow)} tokens · 会话 ${shortId(sessionId)}`,
						),
					),
					// ---- balance (absent when the operator turned it off, which also means
					// the browser never touches the provider at all)
					showBalance
						? h(
								"div",
								{ className: "dsh-mascot-balance" },
								h("div", { className: "amt" }, h("b", null, balanceText(balance)), h("em", null, balanceDetail(balance))),
								h("button", { type: "button", className: "dsh-mascot-refresh", onClick: onRefresh, disabled: balanceBusy === true }, balanceBusy === true ? "查询中…" : "刷新"),
							)
						: null,
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
					// The motion toggle shares its line with its label: the panel has a
					// height budget, and a full label row per setting spends it fast.
					h(
						"div",
						{ className: "dsh-mascot-row dsh-mascot-inline" },
						h("span", { className: "dsh-mascot-picker-label" }, "动效"),
						h(
							"button",
							{
								type: "button",
								"data-on": rigOn && rigFailed === false ? "1" : "0",
								onClick: onToggleRig,
								title: "骨骼动效：按轮廓自动绑三根骨头，用网格蒙皮做待机摆动与呼吸",
							},
							h("span", null, "骨骼动效", h("small", null, rigFailed ? "本机不可用" : rigOn ? "开" : "关")),
						),
					),
					// ---- music
					music === undefined
						? null
						: h(
								"div",
								{ className: "dsh-mascot-music" },
								h("span", { className: "dsh-mascot-music-label" }, music.label),
								h(
									"span",
									{ className: "dsh-mascot-music-name" },
									h("b", null, music.title),
									music.sub === "" ? null : h("small", null, music.sub),
								),
								h(
									"button",
									{
										type: "button",
										"data-on": playing ? "1" : "0",
										onClick: toggleMusic,
										title: music.detail,
										"aria-label": playing ? "停止播放" : "播放",
									},
									playing ? "■" : "▶",
								),
							),
				),
				/**
				 * 别人可以坐进来的一个位置。
				 *
				 * 看板娘不该知道 Token 节流是什么，就像它不该知道余额是怎么查的 ——
				 * 它只提供这张椅子，谁来坐由注册方决定。dsh-token-thrift 会把
				 * 推拉条 + 全力开关注册进 `mascot.thrift`；没装它的时候这里就是空的。
				 */
				props.renderSlot("mascot.thrift", { sessionId: props.sessionId }),
			);
		}

		//#region seat
		/** Where the figure was dragged to, if anybody has dragged it. */
		const SEAT_KEY = "dsh.mascot.seat";
		/** Movement under this many pixels is a click, not a drag. */
		const SEAT_SLOP = 4;

		/** The stored seat, or `undefined` when the figure is still in its default corner. */
		function readSeat() {
			try {
				const raw = window.localStorage.getItem(SEAT_KEY);
				if (raw === null) return undefined;
				const parsed = JSON.parse(raw);
				if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return parsed;
			} catch {
				// Private mode, or storage the page may not touch. The default corner is fine.
			}
			return undefined;
		}

		/**
		 * Keep the figure on screen.
		 *
		 * The size comes from the element rather than from a constant: it is per character, so
		 * a number written here would be wrong for eight of the nine. Dragged off the edge, it
		 * would be gone with no way to bring it back.
		 */
		function clampSeat(position, node) {
			const width = window.innerWidth || 1200;
			const height = window.innerHeight || 800;
			const box = node?.getBoundingClientRect?.();
			const w = box?.width ?? 0;
			const h = box?.height ?? 0;
			return {
				x: Math.max(0, Math.min(width - w, Math.round(position.x))),
				y: Math.max(0, Math.min(height - h, Math.round(position.y))),
			};
		}
		//#endregion

		/**
		 * Root overlay entry: the floating sprite plus the panel seat.
		 *
		 * Registered into `shell.overlay` (a root-scoped list slot), so this file owns
		 * the frame-wide surface; the panel itself is rendered through a
		 * `session-maybe` child slot this entry declares, which is what gives it the
		 * session projections.
		 */
		/**
		 * How big a box this look needs to be drawn in, in CSS pixels.
		 *
		 * It used to be the constant `SPRITE_SEAT` — 104×172 — for every character, and that
		 * was fine while Yuno's chibi (102×170) was the only one: she is what those numbers
		 * were measured from. Every character added since is drawn bigger, and a bigger
		 * drawing in a fixed box is a character with its right side sliced off. Ten of the
		 * eleven looks were clipped, `dusk-chibi` by 107 px.
		 *
		 * The framing already says how wide the drawing is (`framing.width`, scaled from the
		 * image's own pixels), and `measured.box` says where the character sits inside that
		 * image. Adding them up gives the box the drawing actually occupies, which is the
		 * only honest answer to "how big should this be".
		 *
		 * @param look - the look about to be drawn.
		 * @returns `{ width, height }` in CSS pixels, falling back to the constant when the
		 *   measurements a look needs are not in the index.
		 */
		function seatFor(look) {
			const frame = look?.frames?.[0];
			const framing = frame?.seat?.sprite;
			const measured = frame?.measured;
			const box = measured?.box;
			if (framing === undefined || !Array.isArray(box) || box.length < 4 || !(measured.width > 0)) return SPRITE_SEAT;
			const scale = framing.width / measured.width;
			return {
				width: Math.ceil(framing.left + (box[0] + box[2]) * scale),
				height: Math.ceil(framing.top + (box[1] + box[3]) * scale),
			};
		}

		function MascotOverlay(props) {
			const [open, setOpen] = React.useState(false);
			const [index, setIndex] = React.useState(undefined);
			const [selection, setSelection] = React.useState(readStoredSelection);
			const [balance, setBalance] = React.useState(undefined);
			const [balanceBusy, setBalanceBusy] = React.useState(false);
			const [refreshToken, setRefreshToken] = React.useState(0);
			const [poke, setPoke] = React.useState(false);
			const [rigFailed, setRigFailed] = React.useState(false);
			// A deliberate choice in the panel wins; the plugin config supplies the
			// default for an install nobody has toggled yet.
			const storedRig = React.useRef(readStoredRig());
			const [rigOn, setRigOn] = React.useState(storedRig.current ?? true);
			const spriteRef = React.useRef(null);
			/**
			 * Which character is on screen, for the click handler.
			 *
			 * A ref rather than the state directly: the click can arrive between a selection
			 * change and the render that follows it, and the spoken line should belong to the
			 * character that was actually showing.
			 */
			const currentCharacterRef = React.useRef(null);
			// Read from the config up here, not beside the panel props: the balance
			// effect lists it as a dependency, and a dependency array is evaluated
			// during render — which is inside the temporal dead zone of a `const`
			// declared further down.
			const configPreset = (index ?? FALLBACK_LOOKS).config;
			const showBalance = configPreset?.balance !== false;
			// The chip's two live figures. The session projection is the source for both —
			// the host is told the total so it can keep the day's running sum.
			const sessionId = props.sessionId;
			const usageProjection = typeof props.useProjection === "function" ? props.useProjection("tokenUsage") : undefined;
			const chipStats = deriveStats(usageProjection, undefined);
			const todaySpend = useTodaySpend(sessionId, chipStats.total);

			// The look index is fetched once; it is small and only changes when the
			// operator installs more artwork, in which case a page refresh picks it up.
			React.useEffect(() => {
				const controller = new AbortController();
				let cancelled = false;
				fetchLooks(controller.signal).then((payload) => {
					if (cancelled) return;
					setIndex(payload ?? FALLBACK_LOOKS);
					// Apply the config's rig default only when nobody has chosen.
					const preset = payload?.config;
					if (preset !== undefined && storedRig.current === undefined) {
						skeletonEnabled = preset.skeleton !== false;
						setRigOn(skeletonEnabled);
					}
				});
				return () => {
					cancelled = true;
					controller.abort();
				};
			}, []);

			// Balance refresh: re-runs on open and on every manual refresh, and the
			// interval only exists while the panel is open.
			React.useEffect(() => {
				if (!open || !showBalance) return undefined;
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
			}, [open, refreshToken, showBalance]);

			// Escape closes the panel; the listener exists only while it is open.
			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [open]);

			// Resolve the selection against what the host actually installed. The
			// operator's config outranks a stored preference: an install configured from
			// the web page to use one character must not be overridden by a stale
			// localStorage entry left over from clicking around.
			const catalogue = index ?? FALLBACK_LOOKS;
			const preset = catalogue.config;
			const characters = catalogue.characters ?? [];
			const resolved = resolveSelection(catalogue, preset?.character ? null : selection, preset);
			currentCharacterRef.current = resolved?.character ?? null;
			const character = resolved.character;
			const available = (catalogue.looks ?? []).filter((entry) => character !== undefined && entry.character === character.id);
			const look = resolved.look;
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
			/** Flip the bone rig. The module flag is what `Sprite` consults. */
			const toggleRig = () => {
				const next = !rigOn;
				skeletonEnabled = next;
				writeStoredRig(next);
				setRigOn(next);
			};

			/**
			 * Where the figure stands, once somebody has dragged it.
			 *
			 * Same gesture as the thrift ball, and for the same reason: one thing you can grab
			 * should not need two gestures depending on where on it you grabbed. The difference
			 * between moving and clicking is distance.
			 */
			const [seat, setSeat] = React.useState(readSeat);
			const seatRef = React.useRef(seat);
			seatRef.current = seat;
			const seatDrag = React.useRef(undefined);
			/** `toggle` ignores a click that was really a drag; see the pointer handlers. */
			const seatMoved = React.useRef(0);

			/** Toggle the panel and react to the click. */
			const toggle = () => {
				if (seatMoved.current >= SEAT_SLOP) return;
				// The rig's click impulse is deliberately outside React: re-rendering the
				// tree to start a 1.6-second wobble would be pure overhead.
				const rig = spriteRef.current?.querySelector("[data-rig]");
				if (rig?.__poke !== undefined) rig.__poke();
				// The same click pokes it and speaks it: one gesture, two expressions of the
				// same thing. Silent when the machine has no Japanese voice — see the voice
				// region for why that is the right failure.
				speakLine(currentCharacterRef.current, { url: voiceUrls[currentCharacterRef.current] });
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
			const shell = {
				...vars,
				"--dsh-mascot-theme": character?.id,
				// Once dragged, the default corner is overridden: a `right`/`bottom` pair and a
				// `left`/`top` pair describing the same box would fight, and the loser depends on
				// the browser. So a stored seat clears the other two.
				...(seat === undefined ? {} : { left: `${String(seat.x)}px`, top: `${String(seat.y)}px`, right: "auto", bottom: "auto" }),
			};
			/** 这一张立绘实际要占多大，按它自己的构图算出来，而不是一套写死的数字。 */
			const seatSize = seatFor(look);
			/**
			 * 房间要比站在里面的人宽。
			 *
			 * 134px 是当年每张立绘都是 104px 宽时定下的；座位改成按角色算之后房间没跟上，
			 * 于是大一点的角色会站到自己房间的外面 —— 一个 Q 版小人怼在一条灰色细条前面。
			 * 每边多留 15px，和原来 104 → 134 的留白一致。
			 */
			const sceneWidth = Math.max(134, seatSize.width + 30);
			/**
			 * This character's own backdrop picture, if the machine has one.
			 *
			 * Read from the look index rather than probed with a request: a 404 per character
			 * per page load is a lot of noise to answer a question the host already knows.
			 */
			const roomFile = index?.rooms?.[character?.id];

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
								rigOn,
								rigFailed,
								onToggleRig: toggleRig,
								siren: index?.siren,
								songs: index?.songs,
								showBalance,
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
								onPointerDown: (event) => {
									if (event.button !== undefined && event.button !== 0) return;
									event.currentTarget.setPointerCapture?.(event.pointerId);
									const box = event.currentTarget.getBoundingClientRect();
									// Anchored by where inside the figure it was grabbed, so it does not
									// jump under the pointer on the first move.
									seatDrag.current = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: 0 };
									seatMoved.current = 0;
								},
								onPointerMove: (event) => {
									const held = seatDrag.current;
									if (held === undefined) return;
									const next = clampSeat({ x: event.clientX - held.dx, y: event.clientY - held.dy }, event.currentTarget);
									held.moved += Math.abs(next.x - seatRef.current.x) + Math.abs(next.y - seatRef.current.y);
									seatMoved.current = held.moved;
									setSeat(next);
								},
								onPointerUp: () => {
									const held = seatDrag.current;
									seatDrag.current = undefined;
									if (held === undefined || held.moved < SEAT_SLOP) return;
									try {
										window.localStorage.setItem(SEAT_KEY, JSON.stringify(seatRef.current));
									} catch {
										// Not being able to remember the spot is not a reason to refuse to move.
									}
								},
								"data-open": open ? "1" : "0",
								"data-poke": poke ? "1" : "0",
								"aria-expanded": open,
								"aria-label": `${character?.name ?? "看板娘"} — 查看 Token 用量与余额`,
								title: `${character?.name ?? "看板娘"} · ${look?.name ?? "未安装"} · 点击查看 Token 命中 / 余额`,
							},
							h("span", {
								className: "dsh-mascot-scene",
								// A real backdrop, when the machine has one for this character.
								// Everything else falls through to the drawn room, which is what
								// the repository ships: official furniture art belongs to
								// whoever drew it, and never lands in `docs/`.
								"data-image": roomFile === undefined ? "0" : "1",
								// The room has to be at least as wide as the figure standing in it.
								// It was a constant 134px from when every figure was 104px wide;
								// the seat became per-character and the room did not follow, so a
								// bigger character spilled out of her own room — a chibi standing
								// in front of a grey sliver.
								style: {
									width: `${String(sceneWidth)}px`,
									marginLeft: `${String(-sceneWidth / 2)}px`,
									...(roomFile === undefined ? {} : { backgroundImage: `url("${roomUrl(roomFile)}")` }),
								},
							}),
							h("span", { className: "dsh-mascot-decor" }),
							h("span", { className: "dsh-mascot-frames", ref: spriteRef, style: { width: `${String(seatSize.width)}px`, height: `${String(seatSize.height)}px` } }, h(Sprite, { look, className: "dsh-mascot-sprite", seat: "sprite", seatSize, useRig: rigOn && !rigFailed, gesture: character?.gesture, onUnavailable: () => setRigFailed(true) })),
							h("span", { className: "dsh-mascot-shadow" }),
						),
						h(
							"span",
							{ className: "dsh-mascot-chip" },
							balance?.ok === true && balance.totalBalance !== undefined
								? h(React.Fragment, null, h("span", null, "余额"), h("b", null, `${currencySymbol(balance.currency)}${balance.totalBalance}`))
								: h(React.Fragment, null, h("span", null, theme.label), h("b", null, "Token / 余额")),
							chipStats.cacheHitText !== "—"
								? h(React.Fragment, null, h("i", { className: "dsh-mascot-chip-sep" }), h("span", null, "命中"), h("b", null, chipStats.cacheHitText))
								: null,
							typeof todaySpend === "number"
								? h(React.Fragment, null, h("i", { className: "dsh-mascot-chip-sep" }), h("span", null, "今天"), h("b", null, compact(todaySpend)))
								: null,
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
				/**
				 * 填进自己刚声明的那个子槽。
				 *
				 * 声明一个子槽和占住它是**两次调用**：`children` 只是把槽登记出来，
				 * `renderSlot` 渲染的是占位者。少了这一句，`mascot.panel` 就一直是空的 ——
				 * 立绘和胶囊照常出现（它们在 overlay 里），点开却什么都没有。
				 *
				 * 预览脚本看不出来：它把 `renderSlot` 直接换成了 `h(MascotPanel, ...)`，
				 * 于是截图里一直有面板，而产品里一直没有。
				 */
				yield ctx.slots.register(
					{
						name: "mascot.panel",
						// A seat for whoever wants it — the thrift card lives here, but this
						// file must not know that. Declared, not filled: filling it is the
						// other plugin's one line.
						children: { "mascot.thrift": { kind: "single", scope: "session-maybe" } },
					},
					MascotPanel,
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
		exports.seatFor = seatFor;
		exports.clampSeat = clampSeat;
		exports.readSeat = readSeat;
		exports.motionFor = motionFor;
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
		/**
		 * Turn the bone rig off. Exported so a test or the preview harness can force
		 * the still path without a GPU, and so the click handler can fall back when a
		 * context is refused.
		 */
		exports.setSkeletonEnabled = (value) => {
			skeletonEnabled = value === true;
		};
		// Rigging is pure geometry, so it is testable without a browser.
		exports.buildRig = buildRig;
		exports.findNeck = findNeck;
		exports.poseRig = poseRig;
		exports.RIG = RIG;
		// The blink is pure arithmetic too: a schedule read from a measured channel and
		// a spring, neither of which needs a GPU to be wrong.
		exports.sampleBlink = sampleBlink;
		exports.stepJelly = stepJelly;
		exports.greetBlend = greetBlend;
		exports.summonBlend = summonBlend;
		exports.SUMMON = SUMMON;
		exports.SUMMON_UPPER = SUMMON_UPPER;
		exports.SUMMON_FOLD = SUMMON_FOLD;
		exports.EYE_CLOSE = EYE_CLOSE;
		exports.JELLY = JELLY;
		exports.BODY_MESH = BODY_MESH;
		exports.EYE_MESH = EYE_MESH;
		/** Why the bone rig was abandoned, or null when it never was. */
		exports.rigStatus = () => lastRigError ?? null;
		return module.exports;
	},
});
