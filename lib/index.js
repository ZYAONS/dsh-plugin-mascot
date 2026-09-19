/**
 * `dsh-plugin-mascot` — host half.
 *
 * The browser half renders a clickable mascot and reads every token figure
 * straight off the client's own session projections. The one figure the browser
 * cannot reach is the account balance: answering it needs the DeepSeek API key,
 * which must never leave the host process.
 *
 * So this half owns three jobs:
 *
 *     GET <routePrefix>/api/balance   → account balance, cached
 *     GET <routePrefix>/api/health    → route liveness, for debugging
 *     GET <routePrefix>/api/looks     → which artwork is installed, with framing
 *     GET <routePrefix>/art/<file>    → mascot artwork from the plugin's art/
 *
 * `/api/looks` is what makes the plugin self-configuring: `art/index.json` is
 * written by `scripts/art-sync.mjs`, and this route re-reads it and drops any
 * look whose files are not on disk, so dropping a new image into `art/` and
 * refreshing the page is enough to offer it. Nothing in the browser half names
 * a file or carries a coordinate.
 *
 * The key is resolved per request through the credentials service (so a rotated
 * key takes effect on the next call without restarting anything) and is used
 * only as a bearer header. It is never echoed into a response body, a log line,
 * or an error message.
 *
 * The artwork route exists because the official character art is deliberately
 * not committed to this repository — see `art/looks.json`. Keeping it on disk
 * and serving it keeps the browser bundle small and lets the art be swapped
 * without rebuilding anything.
 *
 * This module imports nothing but Node builtins. Cordis skips config validation
 * when a plugin exports no `Config` schema (`resolveConfig` returns the raw
 * config), so the whole half runs without a single installed dependency — which
 * is what lets the plugin be mounted from an absolute path without touching the
 * profile's dependency tree.
 *
 * @module dsh-plugin-mascot
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Stable Cordis plugin name. */
const name = "dsh-plugin-mascot";

/** Services required before the balance route can be registered. */
const inject = ["webServer"];

/** Defaults for every knob; the patch row may omit `config` entirely. */
const DEFAULTS = Object.freeze({
	routePrefix: "/dsh-mascot",
	baseUrl: "https://api.deepseek.com",
	apiKeyRef: "DEEPSEEK_API_KEY",
	cacheTtlMs: 60000,
	timeoutMs: 10000,
	/** Character shown first; "" means whichever the art index lists first. */
	character: "",
	/** Look shown first within that character; "" means its first installed look. */
	look: "",
	/** Which looks to offer at all; an empty list means every installed look. */
	looks: [],
	/** Whether the bone rig starts on. */
	skeleton: true,
	/** Whether the panel shows the balance row and queries the provider at all. */
	balance: true,
	/**
	 * Which currency the balance headline is shown in.
	 *
	 * The provider answers with one entry per currency the account has, and the order
	 * is not part of the contract: this account gets CNY then USD, and reading the
	 * first one happened to give yuan. Reading `balance_infos[0]` is a coin flip, so
	 * the choice is named here instead, and every other currency is shown beside it.
	 */
	currency: "CNY",
});

/** Artwork lives beside `lib/`, so a `file:`-mounted plugin finds its own folder. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Content types the artwork route will serve, keyed by extension. */
const ART_MIME = Object.freeze({
	".png": "image/png",
	".webp": "image/webp",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
});

/** Loopback authorities a Host header may carry when no Connection service is present. */
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u;

/** Content types the console route will serve, keyed by extension. */
const CONSOLE_MIME = Object.freeze({
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
});

/**
 * Serve the configuration console from the plugin's own origin.
 *
 * The console normally lives on GitHub Pages, where it can configure and download
 * but cannot show the mascot: its live preview reads the artwork, and that route is
 * behind the DSH session. A cross-origin page cannot carry that cookie — measured,
 * not assumed: a fetch from the public origin to a local DSH comes back blocked
 * before any plugin code runs, so no allowlist inside the plugin could help.
 *
 * Serving the same page from here puts it on the origin that already has the
 * session, where the artwork, the look index and the skeleton all simply work. The
 * public copy stays the front door; this is where the mascot actually moves.
 *
 * Only the console's own files are reachable — `docs/index.html` and `docs/site/*`
 * — and the resolved path is re-checked for containment.
 *
 * @param res - response owned by this handler.
 * @param name - the path below `/console/`, or "" for the index.
 */
async function serveConsole(res, name) {
	const relative = name === "" || name.endsWith("/") ? `${name}index.html` : name;
	const root = join(PLUGIN_ROOT, "docs");
	const target = normalize(join(root, relative));
	if (target !== root && !target.startsWith(root + sep)) {
		sendJson(res, 403, { ok: false, error: "forbidden", message: "控制台路径越界" });
		return;
	}
	const mime = CONSOLE_MIME[extname(target).toLowerCase()];
	if (mime === undefined) {
		sendJson(res, 404, { ok: false, error: "not_found", message: `不支持的控制台资源：${name}` });
		return;
	}
	let body;
	try {
		const info = await stat(target);
		if (!info.isFile()) throw new Error("not a file");
		body = await readFile(target);
	} catch {
		sendJson(res, 404, {
			ok: false,
			error: "no_console",
			message: "这个安装里没有控制台文件；直接从仓库打开 docs/index.html 也一样能用",
		});
		return;
	}
	res.writeHead(200, { "content-type": mime, "content-length": body.length, "cache-control": "no-store" });
	res.end(body);
}

/** Credentials references are POSIX shell identifiers; validate before resolving. */
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/**
 * Apply the documented defaults to whatever the patch row supplied. Values of
 * the wrong type fall back rather than propagating a surprise into a URL or a
 * timer, because a mis-typed config would otherwise fail far from its cause.
 *
 * @param raw - the config object Cordis handed the plugin, if any.
 * @returns a fully populated configuration.
 */
function normalizeConfig(raw) {
	const source = raw !== null && typeof raw === "object" ? raw : {};
	/** A trimmed, non-empty string override, or the default. */
	const text = (key) => {
		const value = source[key];
		return typeof value === "string" && value.trim().length > 0 ? value.trim() : DEFAULTS[key];
	};
	/** A finite, non-negative number override, or the default. */
	const span = (key) => {
		const value = source[key];
		return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : DEFAULTS[key];
	};
	return {
		// A trailing slash would double up when routes are concatenated.
		routePrefix: text("routePrefix").replace(/\/+$/u, "") || DEFAULTS.routePrefix,
		baseUrl: text("baseUrl"),
		apiKeyRef: text("apiKeyRef"),
		cacheTtlMs: span("cacheTtlMs"),
		timeoutMs: span("timeoutMs"),
		artDir: typeof source.artDir === "string" && source.artDir.trim().length > 0 ? source.artDir.trim() : join(PLUGIN_ROOT, "art"),
		// Where a user's own voice files live. Never shipped: the repository carries the
		// convention and the code, the audio stays on the machine that owns it.
		voiceDir: typeof source.voiceDir === "string" && source.voiceDir.trim().length > 0 ? source.voiceDir.trim() : join(PLUGIN_ROOT, "voices"),
		// An unset string key keeps its sentinel rather than becoming the default
		// text, so "choose for me" stays distinguishable from "choose closure".
		character: typeof source.character === "string" ? source.character.trim() : DEFAULTS.character,
		look: typeof source.look === "string" ? source.look.trim() : DEFAULTS.look,
		looks: Array.isArray(source.looks) ? source.looks.filter((entry) => typeof entry === "string" && entry.length > 0) : DEFAULTS.looks,
		skeleton: source.skeleton === undefined ? DEFAULTS.skeleton : source.skeleton !== false,
		balance: source.balance === undefined ? DEFAULTS.balance : source.balance !== false,
		// Upper-cased so `cny` in a patch row still matches the provider's `CNY`.
		currency: text("currency").toUpperCase(),

	};
}

/**
 * Write a JSON response with no-store caching.
 * @param res - response owned by this handler.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body),
		"cache-control": "no-store",
	});
	res.end(body);
}

/**
 * Decide whether a request may read the balance.
 *
 * A composed web host routes every browser request through Connection, whose
 * signed cookie is the authority; when that service is absent this falls back to
 * demanding a loopback Host header, which is strictly narrower than the
 * webserver's default loopback bind.
 *
 * @param ctx - plugin context.
 * @param req - incoming request.
 * @returns true when the request may proceed.
 */
function authorized(ctx, req) {
	const connection = ctx.get("connection");
	if (connection !== undefined && typeof connection.isAuthenticated === "function") {
		return connection.isAuthenticated(req) === true;
	}
	const host = req.headers.host;
	return typeof host === "string" && LOOPBACK_HOST.test(host);
}

/**
 * Resolve the API key through the credentials service.
 *
 * @param ctx - plugin context.
 * @param ref - credentials reference name.
 * @returns the key, or undefined when the seam is absent or the reference is unset.
 */
async function resolveApiKey(ctx, ref) {
	if (!REF_PATTERN.test(ref)) return undefined;
	const credentials = ctx.get("credentials");
	if (credentials === undefined || typeof credentials.resolve !== "function") return undefined;
	const hit = await credentials.resolve(ref);
	const value = hit === undefined || hit === null ? undefined : hit.value;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Pass a provider figure through only when it is a usable string. */
function stringOrUndefined(value) {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** One-line description of an unknown thrown value. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Ask the provider for the account balance.
 *
 * @param ctx - plugin context.
 * @param config - normalized plugin configuration.
 * @returns the browser-facing payload; `ok` is false for every failure, and the
 *   message is written for a human reading the mascot panel.
 */
async function readBalance(ctx, config) {
	let key;
	try {
		key = await resolveApiKey(ctx, config.apiKeyRef);
	} catch (error) {
		return { ok: false, error: "credential_error", message: `读取凭据失败：${messageOf(error)}` };
	}
	if (key === undefined) {
		return {
			ok: false,
			error: "missing_credential",
			message: `未配置 ${config.apiKeyRef}，请在「设置 → 模型」中填写 DeepSeek API Key`,
		};
	}

	let endpoint;
	try {
		endpoint = new URL("/user/balance", config.baseUrl).href;
	} catch {
		return { ok: false, error: "bad_base_url", message: `baseUrl 不是合法地址：${config.baseUrl}` };
	}

	let response;
	try {
		response = await fetch(endpoint, {
			headers: { authorization: `Bearer ${key}`, accept: "application/json" },
			signal: AbortSignal.timeout(config.timeoutMs),
		});
	} catch (error) {
		const timedOut = error !== null && typeof error === "object" && error.name === "TimeoutError";
		return {
			ok: false,
			error: timedOut ? "timeout" : "unreachable",
			message: timedOut ? "余额接口超时" : `无法连接余额接口：${messageOf(error)}`,
		};
	}

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		return {
			ok: false,
			error: response.status === 401 ? "unauthorized" : `http_${String(response.status)}`,
			message:
				response.status === 401
					? "DeepSeek 拒绝了这个 API Key"
					: `余额接口返回 HTTP ${String(response.status)}${detail.length > 0 ? `：${detail.slice(0, 140)}` : ""}`,
		};
	}

	let payload;
	try {
		payload = await response.json();
	} catch (error) {
		return { ok: false, error: "bad_payload", message: `余额接口返回了非 JSON 响应：${messageOf(error)}` };
	}

	// One entry per currency the account holds. The order is not part of the contract —
	// this account gets CNY then USD — so the preferred one is picked by name rather
	// than by position, and the rest ride along to be shown beside it.
	const infos = payload !== null && typeof payload === "object" ? payload.balance_infos : undefined;
	const wallets = (Array.isArray(infos) ? infos : [])
		.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.currency === "string")
		.map((entry) => ({
			currency: entry.currency,
			totalBalance: stringOrUndefined(entry.total_balance),
			grantedBalance: stringOrUndefined(entry.granted_balance),
			toppedUpBalance: stringOrUndefined(entry.topped_up_balance),
		}));
	const preferred = wallets.find((wallet) => wallet.currency.toUpperCase() === config.currency) ?? wallets[0];
	return {
		ok: true,
		isAvailable: payload?.is_available === true,
		currency: preferred?.currency,
		totalBalance: preferred?.totalBalance,
		grantedBalance: preferred?.grantedBalance,
		toppedUpBalance: preferred?.toppedUpBalance,
		// Everything the account holds, so a second currency is shown rather than lost.
		wallets,
		fetchedAt: Date.now(),
	};
}

/**
 * Serve one mascot artwork file out of the plugin's `art/` directory.
 *
 * `art/` is deliberately not in the repository (see `art/looks.json`), so a
 * missing file is an ordinary, expected state rather than an error — the
 * browser half falls back to its built-in vector art when this answers 404.
 *
 * @param res - response owned by this handler.
 * @param config - normalized plugin configuration.
 * @param name - the requested file name, straight from the URL path.
 */
async function serveArt(res, config, name) {
	// The name is a URL path segment, so a traversal attempt arrives percent-encoded
	// or with separators; resolving and re-checking containment is the only safe
	// read, and it runs before anything else so the refusal is unambiguous.
	const target = normalize(join(config.artDir, name));
	if (target !== config.artDir && !target.startsWith(config.artDir + sep)) {
		sendJson(res, 403, { ok: false, error: "forbidden", message: "素材路径越界" });
		return;
	}
	const mime = ART_MIME[extname(name).toLowerCase()];
	if (mime === undefined) {
		sendJson(res, 404, { ok: false, error: "not_found", message: `不支持的素材类型：${name}` });
		return;
	}
	let body;
	try {
		const info = await stat(target);
		if (!info.isFile()) throw new Error("not a file");
		body = await readFile(target);
	} catch {
		sendJson(
			res,
			404,
			{
				ok: false,
				error: "no_art",
				message: `未找到素材 ${name}；在插件目录运行 \`npm run fetch-art\` 可下载官方立绘`,
			},
		);
		return;
	}
	res.writeHead(200, {
		"content-type": mime,
		"content-length": body.length,
		// The art only changes when the operator swaps the file, so a short cache
		// keeps a replacement from needing a hard reload.
		"cache-control": "private, max-age=300",
	});
	res.end(body);
}



/**
 * Read `art/index.json` and drop anything whose files are not on disk.
 *
 * The index is generated, but a fresh clone has it without the artwork, and a
 * clone that fetched only one character should not be offered the other. Doing
 * the filtering here means the browser never has to probe for missing files.
 *
 * `config.looks`, when non-empty, is an allowlist applied on top of that: an
 * operator who configured the plugin from the web page gets exactly the looks
 * they picked, and a look they left out is not merely hidden but absent.
 *
 * @param config - normalized plugin configuration.
 * @returns the installed subset of the index, or undefined when there is none.
 */
async function readLookIndex(config) {
	let parsed;
	try {
		parsed = JSON.parse(await readFile(join(config.artDir, "index.json"), "utf8"));
	} catch {
		return undefined;
	}
	if (!Array.isArray(parsed?.looks)) return undefined;
	const allow = config.looks.length > 0 ? new Set(config.looks) : undefined;
	const installed = [];
	for (const look of parsed.looks) {
		if (!Array.isArray(look?.frames) || look.frames.length === 0) continue;
		if (allow !== undefined && !allow.has(look.id)) continue;
		let present = true;
		for (const frame of look.frames) {
			if (typeof frame?.file !== "string" || !(await exists(join(config.artDir, frame.file)))) {
				present = false;
				break;
			}
		}
		if (present) installed.push(look);
	}
	const ids = new Set(installed.map((look) => look.id));
	const characters = (Array.isArray(parsed.characters) ? parsed.characters : [])
		.map((character) => ({ ...character, looks: (character.looks ?? []).filter((id) => ids.has(id)) }))
		.filter((character) => character.looks.length > 0);
	return { seats: parsed.seats, characters, looks: installed };
}


/** Audio extensions a voice file may use, in the order they are preferred. */
const VOICE_EXTENSIONS = ["mp3", "ogg", "m4a", "wav"];

/**
 * Which characters have a voice file installed, and under what name.
 *
 * One file per character, named after the character id — `voices/closure.mp3`. A directory
 * of arbitrary audio would need a manifest and a naming argument; an id is already the key
 * the rest of the plugin uses.
 */
async function readVoices(config) {
	const found = {};
	let entries;
	try {
		entries = await readdir(config.voiceDir);
	} catch {
		return found;
	}
	const present = new Set(entries.map((entry) => entry.toLowerCase()));
	for (const entry of present) {
		const dot = entry.lastIndexOf(".");
		if (dot <= 0) continue;
		const id = entry.slice(0, dot);
		const extension = entry.slice(dot + 1);
		if (!VOICE_EXTENSIONS.includes(extension)) continue;
		// First extension wins, so adding an mp3 beside an ogg does not silently change
		// which one plays.
		const rank = VOICE_EXTENSIONS.indexOf(extension);
		if (found[id] === undefined || rank < found[id].rank) {
			found[id] = { file: entry, rank };
		}
	}
	return Object.fromEntries(Object.entries(found).map(([id, value]) => [id, value.file]));
}

/** Whether a path exists as a file, without throwing. */
async function exists(target) {
	try {
		return (await stat(target)).isFile();
	} catch {
		return false;
	}
}

/**
 * Claim the plugin's route prefix and serve balance reads.
 *
 * @param ctx - plugin context carrying the webserver service.
 * @param rawConfig - the patch row's `config`, if it had one.
 */
function apply(ctx, rawConfig) {
	const config = normalizeConfig(rawConfig);
	/** Last successful answer plus its timestamp; failures are never cached. */
	let cached;
	/** Coalesces concurrent reads onto one upstream request. */
	let inflight;

	/**
	 * Answer one balance question, reusing a fresh cached value.
	 * @returns the browser-facing payload.
	 */
	async function balance() {
		const now = Date.now();
		if (cached !== undefined && now - cached.at < config.cacheTtlMs) return cached.value;
		if (inflight !== undefined) return inflight;
		const pending = readBalance(ctx, config);
		inflight = pending;
		try {
			const value = await pending;
			if (value.ok === true) cached = { at: Date.now(), value };
			return value;
		} finally {
			if (inflight === pending) inflight = undefined;
		}
	}

	/**
	 * Route handler for everything under the configured prefix.
	 * @param req - incoming request.
	 * @param res - response owned by this handler.
	 */
	async function handle(req, res) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			sendJson(res, 405, { ok: false, error: "method_not_allowed", message: "只支持 GET" });
			return;
		}
		const pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
		const route = decodeURIComponent(pathname.slice(config.routePrefix.length) || "/");

		if (!authorized(ctx, req)) {
			sendJson(res, 401, { ok: false, error: "unauthorized", message: "需要 DSH Web 会话认证" });
			return;
		}
		if (route.startsWith("/art/")) {
			await serveArt(res, config, route.slice("/art/".length));
			return;
		}
		// The console is served from this same origin, which is the whole point:
		// same-origin means the session cookie rides along and the preview can read
		// the artwork without any cross-origin arrangement at all.
		if (route === "/console" || route.startsWith("/console/")) {
			// Slicing past the end of a bare "/console" yields "", which is the index.
			await serveConsole(res, route.slice("/console/".length));
			return;
		}
		if (route === "/api/health") {
			sendJson(res, 200, { ok: true, routePrefix: config.routePrefix, baseUrl: config.baseUrl });
			return;
		}
		if (route === "/api/balance") {
			sendJson(res, 200, await balance());
			return;
		}
		if (route.startsWith("/voice/")) {
			const name = decodeURIComponent(route.slice("/voice/".length));
			const target = normalize(join(config.voiceDir, name));
			// Same containment check the artwork route uses: a path that escapes the
			// directory is refused rather than served.
			if (target !== config.voiceDir && !target.startsWith(config.voiceDir + sep)) {
				sendJson(res, 403, { ok: false, error: "forbidden", message: "路径越界" });
				return;
			}
			let body;
			try {
				body = await readFile(target);
			} catch {
				sendJson(res, 404, { ok: false, error: "not_found", message: "没有这个语音文件" });
				return;
			}
			const type = { ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav" }[extname(target).toLowerCase()] ?? "application/octet-stream";
			res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
			res.end(body);
			return;
		}
		if (route === "/api/looks") {
			const index = await readLookIndex(config);
			if (index === undefined) {
				sendJson(res, 404, {
					ok: false,
					error: "no_index",
					message: "还没有素材索引；在插件目录运行 `npm run fetch-art`（或 `npm run art:sync`）",
				});
				return;
			}
			sendJson(res, 200, {
				ok: true,
				artBase: `${config.routePrefix}/art`,
				// Which characters have the user's own audio installed. The repository
				// ships none of it; this is whatever is in voiceDir on this machine.
				voiceBase: `${config.routePrefix}/voice`,
				voices: await readVoices(config),
				// The operator's choices, handed to the browser so it does not have to be
				// told twice: the page that generated this config and the plugin that
				// honours it read the same fields.
				config: {
					character: config.character,
					look: config.look,
					skeleton: config.skeleton,
					balance: config.balance,
					looks: config.looks,
				},
				...index,
			});
			return;
		}
		sendJson(res, 404, { ok: false, error: "not_found", message: `未知路由 ${route}` });
	}

	ctx.effect(
		() => ctx.webServer.register({ kind: "prefix", path: config.routePrefix, handler: handle }),
		"mascot: routes",
	);
}

export { apply, inject, name };
