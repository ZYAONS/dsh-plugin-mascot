/**
 * dsh-plugin-wallpaper — 浏览器半边。
 *
 * 两件互不相干的事，分开做：
 *
 * 1. **壁纸层**：一个 `position: fixed; inset: 0; z-index: -1` 的 div，**注入到 `body`**，
 *    垫在整个界面后面。为什么不能像看板娘那样注册进 `shell.overlay` —— 那个容器是
 *    `z-index: 1000`，比界面高；而且桌面模式下它带 `transform: translateZ(0)`，
 *    里面 `fixed` 定位的后代会被困在浮层里。壁纸必须落在 body 这一层。
 *
 * 2. **控制面**：一个小按钮 + 面板，注册进 `shell.overlay`（那是**该**在界面之上的东西）。
 *
 * 可读性优先：壁纸之上永远压一层暗化，面板里的正文不会被压到看不清。
 */

window.__ModuleLoader__.load({
	id: "dsh-plugin-wallpaper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		const ROUTE = "/dsh-wallpaper";
		const STATE_ENDPOINT = `${ROUTE}/api/state`;
		/**
		 * 一个壁纸地址。
		 *
		 * 两种来源走两条路由：本机目录里的是文件名，Wallpaper Engine 工坊来的是 `we:<id>`
		 * —— 后者的文件在用户的壁纸目录之外，由宿主按 id 去工坊目录里找，路径**不由浏览器给**。
		 */
		const mediaUrl = (file) =>
			file.startsWith("we:")
				? `${ROUTE}/workshop/${encodeURIComponent(file.slice("we:".length))}`
				: `${ROUTE}/media/${encodeURIComponent(file)}`;

		/** 壁纸层的元素 id：注入一次，之后只改它的内容。 */
		const LAYER_ID = "dsh-wallpaper-layer";

		/**
		 * 能筛的作品，一个一份词表。
		 *
		 * 每个作品按**三层**写：**作品名 / 乐队名 / 角色名**。形状统一（没有乐队的作品
		 * 就留空数组，不删字段），读的人不用先想清楚"这个作品的这批词算哪一类"。
		 *
		 * 工坊是玩家自己起名的，同一个作品能写出十几种：中文全称、英文、日文、只写角色名。
		 * 所以给的是**词表**而不是正则 —— 遇到没覆盖的写法往对应那一层加一条就行。
		 *
		 * ## 三条规矩，都是这台机器上的真实壁纸教出来的
		 *
		 * 拿 `.scratch/arknights-calibrate.mjs` 校准时抓到过两个误伤：
		 * 单个字母 `w` 把 `Zero Two / DARLING in the FRANXX` 认成方舟，
		 * `夜莺` 撞了工坊一位作者名 `夜莺Night` 把《黑神话悟空》那张认成方舟。
		 *
		 * 1. **不收单字。** `w` / `年` / `夕` / `令` / `陈` / `黍` 这类一律不收。
		 *    砍掉之后逐条核过：它们**净增的命中全是误伤**（`年` 命中「年轮版」、
		 *    `w` 命中 19 张英文标题），真命中（`明日方舟 W`、`[明日方舟]令`）本来就带
		 *    作品名、已被覆盖。**所以砍掉不丢东西。**
		 * 2. **不收常用英文词。** `ling` 命中 `DARLING`、`logos` 命中别的、`layer` /
		 *    `lock` / `masking` 这类同理。
		 * 3. **不收会和工坊作者名撞车的。** `夜莺` 撞 `夜莺Night`。
		 *
		 * 加词之前先跑一遍校准，看它在真实库里多认了谁、有没有认错。
		 *
		 * ## 可信度不一样，这一点写在数据里
		 *
		 * 「明日方舟」那张**校准过**。「BanG Dream!」那张**没校准** —— 写它的时候本机
		 * 152 张里一张邦多利都没有（作品名、乐队名、角色名全零命中），没有样本就没法
		 * 验证认对了没有，所以那张表刻意更保守。`calibrated` 这个字段会被界面读出来，
		 * 明说「这个词表没校准过」。
		 */
		const CATALOGS = Object.freeze([
			{
				id: "arknights",
				label: "明日方舟",
				calibrated: true,
				works: ["明日方舟", "arknights", "arknight", "アークナイツ", "罗德岛", "rhodes island"],
				// 这个作品没有「乐队」这一层。留空数组而不是删字段，三类的形状保持一致。
				bands: [],
				characters: [
					"阿米娅", "amiya", "凯尔希", "kal'tsit", "kaltsit",
					"德克萨斯", "texas", "能天使", "exusiai", "蕾缪安", "lemuen",
					"斯卡蒂", "skadi", "幽灵鲨", "gladiia",
					"史尔特尔", "surtr", "拉普兰德", "lappland", "银灰", "silverash",
					"mon3tr", "缪尔赛思", "muelsyse", "温蒂", "weedy",
					"安洁莉娜", "angelina", "塔露拉", "talulah", "特蕾西娅", "theresa",
					"薇薇安娜", "viviana",
				],
			},
			{
				id: "bangdream",
				label: "BanG Dream!",
				// 没校准过：本机没有样本。改这张表之前先弄到样本再改。
				calibrated: false,
				works: [
					"bang dream", "bangdream", "bandori", "バンドリ", "邦多利",
					"girls band party", "少女乐团派对",
				],
				bands: [
					"poppin'party", "poppin party", "afterglow", "pastel*palettes", "pastel palettes",
					"roselia", "hello, happy world", "morfonica", "raise a suilen",
					"mygo", "ave mujica", "アヴェムジカ",
				],
				characters: [
					// MyGO!!!!! 与 Ave Mujica（近两代主角团）
					"高松灯", "千早爱音", "要乐奈", "长崎爽世", "椎名立希",
					"丰川祥子", "若叶睦", "八幡海铃", "三角初华", "祐天寺若麦",
					// Poppin'Party
					"户山香澄", "花园多惠", "牛込里美", "山吹沙绫", "市谷有咲",
					// Afterglow
					"美竹兰", "青叶摩卡", "上原绯玛丽", "宇田川巴", "羽泽鸫",
					// Pastel*Palettes
					"丸山彩", "冰川日菜", "白鹭千圣", "大和麻弥", "若宫伊芙",
					// Roselia
					"凑友希那", "冰川纱夜", "今井莉莎", "宇田川亚子", "白金燐子",
					// Hello, Happy World!
					"弦卷心", "濑田薰", "北泽育美", "松原花音", "奥泽美咲",
					// Morfonica
					"仓田真白", "桐谷透子", "广町七深", "二叶筑紫", "八潮瑠唯",
					// 本仓库看板娘里的两位
					"千石由乃",
				],
			},
		]);

		/** 一个作品的全部词，三层合起来。 */
		const wordsOf = (catalog) => [...catalog.works, ...catalog.bands, ...catalog.characters];

		/**
		 * 这张壁纸属不属于某个作品。
		 *
		 * **单向**：只从标题往词表上匹配，不反向、不做模糊、不猜。
		 * 判不出来就是判不出来 —— 宁可漏，不可错，因为筛错了会让人以为插件在乱认。
		 *
		 * @param entry - a file entry from `/api/state`.
		 * @param catalog - one of `CATALOGS`, or undefined for "不过滤".
		 * @returns true when it should be shown.
		 */
		function inCatalog(entry, catalog) {
			if (catalog === undefined) return true;
			const haystack = `${entry.title ?? ""} ${entry.file ?? ""}`.toLowerCase();
			return wordsOf(catalog).some((word) => haystack.includes(word));
		}

		/** 自由检索：标题或文件名里含这个词就留下。空串 = 不筛。 */
		function matches(entry, query) {
			if (query === "") return true;
			return `${entry.title ?? ""} ${entry.file ?? ""}`.toLowerCase().includes(query.toLowerCase());
		}

		/**
		 * 把壁纸层插进 `body`，垫在最底下。
		 *
		 * `z-index: -1` 是关键：`body` 在桌面模式下是 `background: transparent !important`，
		 * 所以负层级的东西透得出来、又压不到任何界面元素上。`pointer-events: none` 保证它
		 * 永远不吃掉点击 —— 一层铺满屏幕的东西如果接了事件，整个界面就点不动了。
		 *
		 * @returns the layer element.
		 */
		function ensureLayer() {
			let layer = document.getElementById(LAYER_ID);
			if (layer !== null) return layer;
			layer = document.createElement("div");
			layer.id = LAYER_ID;
			layer.setAttribute("aria-hidden", "true");
			layer.style.cssText = [
				"position:fixed", "inset:0", "z-index:-1",
				"pointer-events:none", "overflow:hidden", "background:transparent",
			].join(";");
			// 插在 body 的第一个孩子之前：DOM 顺序上也在最前，配合负 z-index 双保险。
			document.body.insertBefore(layer, document.body.firstChild);
			return layer;
		}

		/**
		 * 画一张壁纸。
		 *
		 * 图片和视频走同一层，只是元素不同。视频**静音**播放 —— 不静音浏览器会拒绝自动播放，
		 * 而一个不会动的壁纸比一个静音的壁纸糟得多。
		 *
		 * @param layer - the layer from `ensureLayer`.
		 * @param state - `{ file, kind, dim, blur, muted }`.
		 * @returns the created media element, or undefined when there is nothing to show.
		 */
		function paint(layer, state) {
			layer.textContent = "";
			if (typeof state.file !== "string" || state.file === "") return undefined;
			const media = document.createElement(state.kind === "video" ? "video" : "img");
			media.src = mediaUrl(state.file);
			media.setAttribute("aria-hidden", "true");
			media.style.cssText = [
				"position:absolute", "inset:0", "width:100%", "height:100%",
				"object-fit:cover", "border:0",
			].join(";");
			if (state.kind === "video") {
				media.loop = true;
				media.autoplay = true;
				media.muted = state.muted !== false;
				media.playsInline = true;
			}
			// 定位交给 `object-fit: cover`，所以这里不加任何滤镜 —— 暗化由上面那层负责。
			layer.appendChild(media);

			// 暗化层：压在壁纸之上、界面之下。可读性靠它，不是靠壁纸本身够暗。
			const shade = document.createElement("div");
			const level = Math.max(0, Math.min(1, (state.dim ?? 40) / 100));
			shade.style.cssText = `position:absolute;inset:0;background:rgba(0,0,0,${String(level)});`;
			layer.appendChild(shade);
			return media;
		}

		/** 读宿主的状态；读不到就当作"没装壁纸"，不抛。 */
		async function fetchState() {
			try {
				const response = await fetch(STATE_ENDPOINT, { headers: { accept: "application/json" } });
				if (!response.ok) return undefined;
				const payload = await response.json();
				return payload?.ok === true ? payload : undefined;
			} catch {
				return undefined;
			}
		}

		async function saveState(patch) {
			try {
				const response = await fetch(STATE_ENDPOINT, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(patch),
				});
				const payload = await response.json();
				return payload?.ok === true ? payload : undefined;
			} catch {
				return undefined;
			}
		}

		/** 壁纸层的全部行为：拉状态、画、以及"看不见时别解码"。 */
		function useWallpaper() {
			const [state, setState] = React.useState(undefined);
			const layerRef = React.useRef(undefined);
			const mediaRef = React.useRef(undefined);

			const load = React.useCallback(async () => {
				const next = await fetchState();
				if (next !== undefined) setState(next);
				return next;
			}, []);

			React.useEffect(() => {
				layerRef.current = ensureLayer();
				load();
			}, [load]);

			React.useEffect(() => {
				const layer = layerRef.current;
				if (layer === undefined || state === undefined) return undefined;
				// 选了哪张要问宿主"它是图还是视频"：状态里只存文件名。
				const entry = state.files?.find((item) => item.file === state.file);
				mediaRef.current = paint(layer, {
					file: state.file,
					kind: entry?.kind ?? "image",
					dim: state.dim,
					blur: state.blur,
					muted: state.muted,
				});
				return () => {
					layer.textContent = "";
					mediaRef.current = undefined;
				};
			}, [state]);

			/**
			 * 看不见就停解码。
			 *
			 * 视频壁纸铺满整屏，切到别的标签页还在解码是纯浪费 —— 而且这是**唯一**一件
			 * 铺满屏幕的东西，它不停谁停。参考 dsh-wallpaper-engine 的"遮挡暂停"。
			 * 手动暂停过的不在这个逻辑里：状态里没有暂停这个概念。
			 */
			React.useEffect(() => {
				const onVisibility = () => {
					const media = mediaRef.current;
					if (media === undefined) return;
					if (document.visibilityState === "visible") media.play?.().catch(() => {});
					else media.pause?.();
				};
				document.addEventListener("visibilitychange", onVisibility);
				return () => document.removeEventListener("visibilitychange", onVisibility);
			}, []);

			return { state, reload: load };
		}

		/** 控制面：一个小按钮，点开才有面板。不占地方，也不跟看板娘抢角落。 */
		function WallpaperControl() {
			const { state, reload } = useWallpaper();
			const [open, setOpen] = React.useState(false);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(undefined);
			/** 检索框里的词；空串 = 不筛。 */
			const [query, setQuery] = React.useState("");
			/**
			 * 选中的作品 id，或者 `""` 表示全部。
			 *
			 * **单选**，不是多个开关：一个作品一个开关的话，「只看明日方舟」和
			 * 「只看 BanG Dream!」同时打开该显示什么就得解释 —— 而"只看"两个字
			 * 本来就不该能同时成立。单选没有这个问题。
			 */
			const [catalogId, setCatalogId] = React.useState("");
			const catalog = CATALOGS.find((entry) => entry.id === catalogId);

			/** 当前列表里筛出来的那些。检索与作品筛选**叠加**生效。 */
			const shown = (state?.files ?? []).filter(
				(entry) => matches(entry, query) && inCatalog(entry, catalog),
			);

			const apply = async (patch) => {
				setBusy(true);
				const next = await saveState(patch);
				setBusy(false);
				// 保存失败**不静默**：说清楚，而不是让滑条看着动了、其实没落盘。
				setError(next === undefined ? "保存失败，改动没有落盘" : undefined);
				if (next !== undefined) reload();
			};

			if (state === undefined) return null;

			return h(
				"div",
				{ className: "dsh-wallpaper-root" },
				h(
					"button",
					{
						type: "button",
						className: "dsh-wallpaper-btn",
						"data-open": open ? "1" : "0",
						"aria-expanded": open,
						title: state.file === "" ? "壁纸：未选择" : `壁纸：${state.file}`,
						onClick: () => setOpen((value) => !value),
					},
					"壁纸",
				),
				open
					? h(
							"div",
							{ className: "dsh-wallpaper-panel", role: "dialog", "aria-label": "壁纸设置" },
							h(
								"div",
								{ className: "head" },
								h("b", null, "背景壁纸"),
								h("button", { type: "button", className: "x", onClick: () => setOpen(false), "aria-label": "关闭" }, "×"),
							),
							state.files.length === 0
								? h(
										"p",
										{ className: "hint" },
										`把图片或视频放进 ${state.dir}，或者在 Steam 上订阅 Wallpaper Engine 壁纸，都会出现在这里。`,
									)
								: h(
										React.Fragment,
										null,
										// 检索一行：输入框 + 作品筛选。两者叠加生效。
										h(
											"div",
											{ className: "filter" },
											h("input", {
												type: "search",
												className: "query",
												placeholder: "搜标题 / 文件名",
												value: query,
												onChange: (event) => setQuery(event.target.value),
												"aria-label": "检索壁纸",
											}),
										),
										// 作品筛选：单选。没配过的作品**数出来是 0 也照样列** ——
										// 藏起来的话，用户订阅了壁纸却找不到那个按钮，只会以为功能坏了。
										h(
											"div",
											{ className: "catalogs", role: "group", "aria-label": "按作品筛选" },
											[
												h(
													"button",
													{
														key: "all",
														type: "button",
														className: "only",
														"data-on": catalogId === "" ? "1" : "0",
														"aria-pressed": catalogId === "",
														onClick: () => setCatalogId(""),
													},
													`全部 ${String(state.files.length)}`,
												),
												...CATALOGS.map((entry) => {
													const count = state.files.filter((file) => inCatalog(file, entry)).length;
													return h(
														"button",
														{
															key: entry.id,
															type: "button",
															className: "only",
															"data-on": catalogId === entry.id ? "1" : "0",
															"aria-pressed": catalogId === entry.id,
															// 没校准过的表，把这件事写在使用处，而不是只写在源码注释里。
															title: entry.calibrated
																? `${entry.label}：${String(count)} 张（词表已按本机真实壁纸校准）`
																: `${entry.label}：${String(count)} 张（词表未校准 —— 本机没有这类壁纸可供对照）`,
															onClick: () => setCatalogId(catalogId === entry.id ? "" : entry.id),
														},
														`${entry.label} ${String(count)}`,
													);
												}),
											],
										),
										shown.length === 0
											? h("p", { className: "hint" }, `没有匹配的壁纸（共 ${String(state.files.length)} 张）。`)
											: h(
													"div",
													{ className: "grid" },
													shown.map((entry) =>
														h(
															"button",
															{
																key: entry.file,
																type: "button",
																className: "thumb",
																"data-on": entry.file === state.file ? "1" : "0",
																// 工坊壁纸没有文件名可看，标题才是人认得出的东西。
																title: entry.title === undefined ? entry.file : `${entry.title} · ${entry.file}`,
																onClick: () => apply({ file: entry.file }),
															},
															entry.kind === "video"
																? h("video", { src: mediaUrl(entry.file), muted: true, preload: "metadata" })
																: h("img", { src: mediaUrl(entry.file), alt: "", loading: "lazy" }),
															h("span", null, entry.title ?? entry.file),
														),
													),
												),
										h(
											"p",
											{ className: "hint" },
											`显示 ${String(shown.length)} / ${String(state.files.length)} 张` +
												(catalog === undefined ? "" : `　·　${catalog.label}`) +
												(catalog === undefined || catalog.calibrated ? "" : "（这个词表没校准过）"),
										),
									),
							// 收不了的工坊壁纸要说清楚有几张、为什么 —— 静默跳过会让人以为"我的壁纸没被认出来"。
							(state.workshopSkipped?.length ?? 0) === 0
								? null
								: h(
										"p",
										{ className: "hint" },
										`另外 ${String(state.workshopSkipped.length)} 张 Wallpaper Engine 壁纸这里渲染不了（场景 / 网页 / 应用程序类需要它自己的引擎）。`,
									),
							h(
								"label",
								{ className: "slider" },
								h("span", null, "暗化"),
								h("input", {
									type: "range", min: 0, max: 100, step: 1, defaultValue: state.dim,
									disabled: busy,
									// 松手才提交：每移动一像素 POST 一次等于用一百次请求说一件事。
									onChange: (event) => apply({ dim: Number(event.target.value) }),
								}),
							),
							h(
								"div",
								{ className: "actions" },
								h("button", { type: "button", disabled: busy, onClick: () => apply({ file: "" }) }, "移除壁纸"),
							),
							error === undefined ? null : h("p", { className: "err" }, error),
						)
					: null,
			);
		}

		/** Required service: the UI slot registry. */
		const inject = ["slots"];

		/**
		 * Mount: one overlay entry for the controls. The wallpaper layer itself is injected into
		 * `body` by the component, because `shell.overlay` sits above the whole interface.
		 * @param ctx - Client root context.
		 */
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", function* () {
				const removeStyles = installStyles();
				yield () => removeStyles();
				yield ctx.slots.register({ name: "shell.overlay", id: "wallpaper", order: 60 }, WallpaperControl);
			});
		}

		/** Everything this plugin adds to the document. */
		function installStyles() {
			const tag = document.createElement("style");
			tag.dataset.dshWallpaper = "1";
			tag.textContent = `
.dsh-wallpaper-root { position: fixed; right: 20px; top: 20px; z-index: 30;
  pointer-events: auto; font-family: inherit; }
.dsh-wallpaper-btn { appearance: none; border: 1px solid rgba(150,160,180,.28); cursor: pointer;
  background: rgba(14,16,22,.72); color: #e9eef5; border-radius: 999px; padding: 5px 13px;
  font-size: 12px; letter-spacing: .06em; backdrop-filter: blur(8px); }
.dsh-wallpaper-btn:hover { border-color: rgba(150,160,180,.5); }
.dsh-wallpaper-btn[data-open="1"] { border-color: #4fd6a8; color: #4fd6a8; }
.dsh-wallpaper-panel { position: absolute; right: 0; top: 34px; width: 320px; max-height: 70vh;
  overflow: auto; background: rgba(12,14,19,.94); border: 1px solid rgba(150,160,180,.22);
  border-radius: 12px; padding: 12px; color: #e9eef5; backdrop-filter: blur(14px);
  box-shadow: 0 18px 40px rgba(0,0,0,.5); }
.dsh-wallpaper-panel .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.dsh-wallpaper-panel .head b { font-size: 13px; }
.dsh-wallpaper-panel .x { appearance: none; border: 0; background: none; color: #98a2b3;
  font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px; }
.dsh-wallpaper-panel .hint { font-size: 12px; color: #98a2b3; line-height: 1.6; margin: 0; word-break: break-all; }
/* 检索行。这一段曾经漏写过 —— 检索框和作品按钮一直是浏览器默认长相（白底输入框、
   灰渐变按钮），在一个深色面板里非常显眼。所以样式和功能一起加。 */
.dsh-wallpaper-panel .filter { margin-bottom: 8px; }
.dsh-wallpaper-panel .query { appearance: none; width: 100%; box-sizing: border-box;
  background: rgba(0,0,0,.35); border: 1px solid rgba(150,160,180,.28); border-radius: 8px;
  color: #e9eef5; font: inherit; font-size: 12px; padding: 6px 9px; }
.dsh-wallpaper-panel .query::placeholder { color: #6b7480; }
.dsh-wallpaper-panel .query:focus { outline: none; border-color: #4fd6a8; }
.dsh-wallpaper-panel .catalogs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dsh-wallpaper-panel .only { appearance: none; cursor: pointer; font: inherit; font-size: 11.5px;
  padding: 4px 10px; border-radius: 999px; white-space: nowrap;
  border: 1px solid rgba(150,160,180,.28); background: rgba(255,255,255,.04); color: #c7d0dc; }
.dsh-wallpaper-panel .only:hover { border-color: rgba(150,160,180,.5); }
.dsh-wallpaper-panel .only[data-on="1"] { border-color: #4fd6a8; color: #4fd6a8; background: rgba(79,214,168,.1); }
.dsh-wallpaper-panel .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.dsh-wallpaper-panel .thumb { appearance: none; padding: 0; cursor: pointer; overflow: hidden;
  border: 1px solid rgba(150,160,180,.2); border-radius: 8px; background: #0b0e14; color: #98a2b3; }
.dsh-wallpaper-panel .thumb[data-on="1"] { border-color: #4fd6a8; box-shadow: 0 0 0 1px #4fd6a8 inset; }
.dsh-wallpaper-panel .thumb img, .dsh-wallpaper-panel .thumb video { display: block; width: 100%; height: 62px; object-fit: cover; }
.dsh-wallpaper-panel .thumb span { display: block; font-size: 10px; padding: 3px 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-wallpaper-panel .slider { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 12px; }
.dsh-wallpaper-panel .slider input { flex: 1; }
.dsh-wallpaper-panel .actions { margin-top: 12px; display: flex; gap: 8px; }
.dsh-wallpaper-panel .actions button { appearance: none; cursor: pointer; font-size: 12px;
  padding: 5px 12px; border-radius: 8px; border: 1px solid rgba(150,160,180,.28);
  background: rgba(255,255,255,.04); color: #e9eef5; }
.dsh-wallpaper-panel .err { color: #ff8a8a; font-size: 12px; margin: 10px 0 0; }
`;
			document.head.appendChild(tag);
			return () => tag.remove();
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.WallpaperControl = WallpaperControl;
		exports.ensureLayer = ensureLayer;
		exports.paint = paint;
		// 检索用的表和判定，导出给自检 —— 那两条已知误伤要能被钉住。
		exports.CATALOGS = CATALOGS;
		exports.inCatalog = inCatalog;
		exports.matches = matches;

		return module.exports;
	},
});
