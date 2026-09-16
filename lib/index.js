/**
 * `dsh-plugin-mascot` — host half.
 *
 * The browser half renders a clickable mascot and reads every token figure
 * straight off the client's own session projections. The one figure the browser
 * cannot reach is the account balance: answering it needs the DeepSeek API key,
 * which must never leave the host process.
 *
 * So this half owns exactly one job — a small same-origin JSON route the
 * mascot calls:
 *
 *     GET <routePrefix>/api/balance   → account balance, cached
 *     GET <routePrefix>/api/health    → route liveness, for debugging
 *
 * The key is resolved per request through the credentials service (so a rotated
 * key takes effect on the next call without restarting anything) and is used
 * only as a bearer header. It is never echoed into a response body, a log line,
 * or an error message.
 *
 * This module deliberately imports nothing. Cordis skips config validation when
 * a plugin exports no `Config` schema (`resolveConfig` returns the raw config),
 * so the whole half runs on Node globals alone — which is what lets the plugin
 * be mounted from an absolute path without installing it into the profile's
 * dependency tree.
 *
 * @module dsh-plugin-mascot
 */

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
});

/** Loopback authorities a Host header may carry when no Connection service is present. */
const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u;

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

	const infos = payload !== null && typeof payload === "object" ? payload.balance_infos : undefined;
	const first = Array.isArray(infos) ? infos[0] : undefined;
	return {
		ok: true,
		isAvailable: payload?.is_available === true,
		currency: typeof first?.currency === "string" ? first.currency : undefined,
		totalBalance: stringOrUndefined(first?.total_balance),
		grantedBalance: stringOrUndefined(first?.granted_balance),
		toppedUpBalance: stringOrUndefined(first?.topped_up_balance),
		fetchedAt: Date.now(),
	};
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
		if (!authorized(ctx, req)) {
			sendJson(res, 401, { ok: false, error: "unauthorized", message: "需要 DSH Web 会话认证" });
			return;
		}
		const pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
		const route = pathname.slice(config.routePrefix.length) || "/";
		if (route === "/api/health") {
			sendJson(res, 200, { ok: true, routePrefix: config.routePrefix, baseUrl: config.baseUrl });
			return;
		}
		if (route !== "/api/balance") {
			sendJson(res, 404, { ok: false, error: "not_found", message: `未知路由 ${route}` });
			return;
		}
		sendJson(res, 200, await balance());
	}

	ctx.effect(
		() => ctx.webServer.register({ kind: "prefix", path: config.routePrefix, handler: handle }),
		"mascot: balance route",
	);
}

export { apply, inject, name };
