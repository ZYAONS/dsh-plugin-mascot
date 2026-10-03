/**
 * dsh-plugin-wallpaper — 宿主半边。
 *
 * 只做三件事：**找壁纸、发壁纸、记住选了哪张**。
 *
 * 为什么需要宿主：浏览器拿不到用户硬盘上的文件，也没法把任意路径的图当背景 ——
 * `<img src="D:\\图\\a.png">` 在网页里是不允许的。所以由宿主扫目录、按名字发给浏览器，
 * 浏览器只认识 `/dsh-wallpaper/media/<文件名>` 这一种地址。
 *
 * 和 `dsh-plugin-mascot` 共用同一套边界写法：会话认证、跨站栅栏、路径包含检查、
 * `no-store`。那几条是这个仓库里已经验过的，不再另发明一套。
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, join, normalize, sep } from "node:path";
import { homedir } from "node:os";

/** Services required before a route can be registered. */
export const inject = ["webServer"];

export const name = "wallpaper";

/**
 * Wallpaper Engine 在 Steam 上的 app id。
 *
 * 创意工坊的内容按 appid 分目录：`steamapps/workshop/content/431960/<壁纸 id>/`，
 * 每张壁纸一个目录，里面是 `project.json` 加它的媒体文件。
 */
export const WE_APP_ID = "431960";

/**
 * 只收**视频**类壁纸。
 *
 * Wallpaper Engine 把壁纸分四类，其中三类做不了：
 *
 *   Video         ✅ 一个 mp4/webm，浏览器直接播 —— 就是这个插件会做的事
 *   Scene         ❌ 需要 Wallpaper Engine 自己的 3D 引擎实时渲染
 *   Web           ❌ 需要一个隔离的 HTML 运行时
 *   Application   ❌ 要宿主直接跑第三方可执行程序，这个能力本插件不提供
 *
 * 所以扫描时把另外三类**明确列出来但不收**：静默跳过会让人以为"我的壁纸没被认出来"，
 * 说清楚"这一类这里渲染不了"才是诚实的做法。
 */
const WE_PLAYABLE = new Set(["video"]);

/** 认得的图片与视频。视频靠浏览器自己解，宿主不转码。 */
const IMAGE_MIME = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
});

const VIDEO_MIME = Object.freeze({
  ".mp4": "video/mp4",
  ".webm": "video/webm",
});

const MIME = Object.freeze({ ...IMAGE_MIME, ...VIDEO_MIME });

/** Defaults for every knob; the patch row may omit `config` entirely. */
const DEFAULTS = Object.freeze({
  routePrefix: "/dsh-wallpaper",
  /** 壁纸目录。默认在家目录下，和 DSH 自己的东西放在一起。 */
  dir: join(homedir(), ".dsh-wallpaper", "wallpapers"),
  /** 暗化 0–100：文字压在上面时靠它保可读性。 */
  dim: 42,
  /** 磨砂 0–40 px。 */
  blur: 6,
  /** 视频壁纸静音播放 —— 不静音的话浏览器会拒绝自动播放。 */
  muted: true,
});

/** 状态文件：选了哪张、以及两个滑条的值。 */
const STATE_FILE = "state.json";

/**
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
  // 跨站请求一律拒掉，先于会话检查：会话 cookie 跟着同源请求走，所以"能让浏览器发请求"
  // 就等于"拿到一张有效会话票"。两道判据用的都是浏览器自己加、脚本伪造不了的头。
  //
  // `Sec-Fetch-Site` 是**主要**那道 —— DSH 框架自己的请求闸门用的也是它
  // （`lib/src-DGihCtmE.js` 的 `isCrossSite`）。
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string" && site.toLowerCase() === "cross-site") return false;

  // `Origin` 是窄补充，判据刻意收得很紧：**只有能解析出、而且确实不同源**才拒。
  //
  //   1. **框架自己压根不查 Origin**（`permits()` 只看 Host 白名单 + 非跨站），
  //      这条不该比框架还严 —— 严出去的部分挡的是正当请求，不是攻击；
  //   2. `Origin: null` 是合法值（沙箱 iframe、不透明来源）；
  //   3. **伪造者本来就能随便写 Origin**，拒绝解析不出来的值对伪造毫无作用，只会误伤。
  //
  // 桌面壳里插件路由是同源的：GET 不带 Origin，POST 带的与 Host 相同 —— 都从这里放行。
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0 && origin !== "null") {
    const host = req.headers.host;
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = undefined;
    }
    if (originHost !== undefined && (typeof host !== "string" || originHost !== host)) return false;
  }

  const connection = ctx.get("connection");
  if (connection !== undefined && typeof connection.isAuthenticated === "function") {
    return connection.isAuthenticated(req) === true;
  }
  const host2 = req.headers.host;
  return typeof host2 === "string" && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/u.test(host2);
}

/** Merge the patch row over the defaults, ignoring anything the wrong shape. */
export function readConfig(source = {}) {
  const num = (key, min, max) => {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : DEFAULTS[key];
  };
  const text = (key) => (typeof source[key] === "string" && source[key].trim().length > 0 ? source[key].trim() : DEFAULTS[key]);
  return {
    // A trailing slash would double up when routes are concatenated.
    routePrefix: text("routePrefix").replace(/\/+$/u, ""),
    dir: text("dir"),
    dim: num("dim", 0, 100),
    blur: num("blur", 0, 40),
    muted: source.muted === undefined ? DEFAULTS.muted : source.muted !== false,
  };
}

/** Write a JSON response with no-store caching. */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

/** 读状态文件；坏了就当没选过，而不是拒绝启动。 */
async function readState(dir) {
  try {
    const parsed = JSON.parse(await readFile(join(dir, STATE_FILE), "utf8"));
    return {
      file: typeof parsed?.file === "string" ? parsed.file : "",
      dim: typeof parsed?.dim === "number" ? parsed.dim : undefined,
      blur: typeof parsed?.blur === "number" ? parsed.blur : undefined,
    };
  } catch {
    return { file: "" };
  }
}

async function writeState(dir, state) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/** 目录里认得的壁纸，按文件名排。 */
async function listWallpapers(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // 目录还不存在不是错误：第一次用本来就没有。
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    const mime = MIME[ext];
    if (mime === undefined) continue;
    found.push({ file: entry.name, kind: mime.startsWith("video/") ? "video" : "image" });
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

/** 缓存一次 Steam 库的查找结果：它一次运行里不会变，而 `reg query` 是起进程。 */
let steamCache;

/**
 * 本机的 Steam 库目录。
 *
 * 顺序：**环境变量** `DSH_WALLPAPER_STEAM`（分号分隔，覆盖一切 —— 注册表探测失败、
 * 库在别的盘、或者自检要造一个假的库，都靠它）→ 注册表 `HKCU\Software\Valve\Steam`
 * 的 `SteamPath` → 再顺着每个库的 `libraryfolders.vdf` 把**声明过的其它盘**加进来。
 *
 * 最后一步是必须的：Steam 的库经常跨盘，注册表只给主库。**任何一步失败都不算错误** ——
 * 没装 Steam、不在 Windows、注册表读不到，结果都是"没有库"，而不是把插件弄坏。
 *
 * @returns the library roots, or `[]`.
 */
export function steamLibraries() {
  if (steamCache !== undefined) return steamCache;
  const roots = new Map();
  /** 同一个库会以不同写法出现，按归一化后的键去重。 */
  const add = (path) => {
    const trimmed = String(path).trim();
    if (trimmed.length === 0) return;
    roots.set(canonicalRoot(trimmed), trimmed);
  };
  const override = process.env.DSH_WALLPAPER_STEAM;
  if (typeof override === "string" && override.trim().length > 0) {
    for (const part of override.split(";")) add(part);
    steamCache = [...roots.values()];
    return steamCache;
  }
  if (process.platform === "win32") {
    try {
      const out = execFileSync("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], {
        encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"],
      });
      const found = /SteamPath\s+REG_SZ\s+(.+)$/mu.exec(out);
      // 注册表里写的是正斜杠：`d:/delta force/steam`。
      if (found !== null) add(found[1]);
    } catch {
      // 没装 Steam 不是错误。
    }
  }
  for (const root of [...roots.values()]) {
    for (const extra of declaredLibraries(root)) add(extra);
  }
  steamCache = [...roots.values()];
  return steamCache;
}

/**
 * 库路径的归一化键。
 *
 * 注册表给的是 `d:/delta force/steam`（正斜杠、小写盘符），`libraryfolders.vdf` 给的是
 * `D:\Delta Force\steam`（反斜杠、大写盘符）—— **同一个目录**。不归一化的话它会被扫两遍，
 * 每一张壁纸都出现两次。Windows 的路径大小写不敏感，所以直接小写 + 统一分隔符。
 *
 * @param path - a library root.
 * @returns a key two spellings of the same directory share.
 */
function canonicalRoot(path) {
  const slashed = path.replace(/[\\/]+/gu, sep);
  if (process.platform !== "win32") return slashed;
  return slashed.replace(/^([a-z]):/u, (_, letter) => `${letter.toUpperCase()}:`).toLowerCase();
}

/**
 * 一个 Steam 库里 `libraryfolders.vdf` 声明过的其它库。
 *
 * 这是 VDF 的**一个特例**，不是通用解析器：只要 `"path"` 后面的那个字符串。
 * 文件不存在、格式变了、读不动 —— 都返回空。
 *
 * @param root - a Steam root.
 * @returns additional library roots.
 */
function declaredLibraries(root) {
  const file = join(root, "steamapps", "libraryfolders.vdf");
  let text;
  try {
    // 同步读：调用它的 `steamLibraries()` 是同步的，而它一次运行只跑一次。
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const found = [];
  for (const match of text.matchAll(/"path"\s+"([^"]+)"/gu)) {
    // VDF 里反斜杠是转义的：`D:\\Steam`。
    found.push(match[1].replace(/\\\\/gu, "\\"));
  }
  return found;
}

/** 测试与自检用：把缓存清掉，好让它们喂假的库路径。 */
export function resetSteamCache() {
  steamCache = undefined;
}

/**
 * Wallpaper Engine 的工坊壁纸。
 *
 * 每个壁纸一个目录，里面有 `project.json`。读到什么算什么 —— 目录结构是别人的，
 * 一次读不动不该让整个列表消失。
 *
 * @param libraries - Steam 库根目录；默认问 `steamLibraries()`。
 * @returns `{ playable, skipped }` —— 能渲染的，和被跳过的（带原因）。
 */
export async function workshopWallpapers(libraries = steamLibraries()) {
  const playable = [];
  const skipped = [];
  for (const library of libraries) {
    const root = join(library, "steamapps", "workshop", "content", WE_APP_ID);
    let ids;
    try {
      ids = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of ids) {
      if (!entry.isDirectory()) continue;
      let project;
      try {
        project = JSON.parse(await readFile(join(root, entry.name, "project.json"), "utf8"));
      } catch {
        continue;
      }
      const type = typeof project?.type === "string" ? project.type.toLowerCase() : "";
      const title = typeof project?.title === "string" && project.title.trim().length > 0 ? project.title.trim() : entry.name;
      if (!WE_PLAYABLE.has(type)) {
        // 说清楚为什么没收，而不是让它凭空消失。
        skipped.push({ id: entry.name, title, type: type === "" ? "unknown" : type });
        continue;
      }
      // `file` 是作者在 project.json 里写的相对名；没写就自己找第一个视频。
      let file = typeof project?.file === "string" ? project.file : "";
      if (file === "" || MIME[extname(file).toLowerCase()] === undefined) {
        try {
          const inside = await readdir(join(root, entry.name), { withFileTypes: true });
          const video = inside.find((item) => item.isFile() && MIME[extname(item.name).toLowerCase()]?.startsWith("video/"));
          file = video?.name ?? "";
        } catch {
          file = "";
        }
      }
      if (file === "") {
        skipped.push({ id: entry.name, title, type: "video-without-a-file" });
        continue;
      }
      // 作者在 `project.json` 里写的路径可能是 `..\..\evil.mp4`。**在扫描时就挡掉**，
      // 而不是等到发送那一步 —— 一张点了就 403 的卡片比不列出来更糟。
      const home = normalize(join(root, entry.name));
      if (!normalize(join(home, file)).startsWith(home + sep)) {
        skipped.push({ id: entry.name, title, type: "file-outside-the-wallpaper" });
        continue;
      }
      playable.push({ id: entry.name, title, file, dir: home });
    }
  }
  playable.sort((a, b) => a.title.localeCompare(b.title));
  skipped.sort((a, b) => a.title.localeCompare(b.title));
  return { playable, skipped };
}

/**
 * 发一个工坊壁纸的视频。
 *
 * 路径**不是从请求里来的**：每次重新扫一遍工坊目录，按 id 找到那张壁纸自己的
 * `project.json`，再用它里面的路径。客户端只能报一个 id，报不出路径 ——
 * 这是这个路由不需要路径包含检查的原因，也是它必须这样写的原因。
 *
 * @param res - response.
 * @param id - the workshop id from the URL.
 */
async function serveWorkshop(res, id) {
  if (!/^\d{1,20}$/u.test(id)) {
    sendJson(res, 404, { ok: false, error: "not_found", message: "工坊 id 不是数字" });
    return;
  }
  const { playable } = await workshopWallpapers();
  const entry = playable.find((item) => item.id === id);
  if (entry === undefined) {
    sendJson(res, 404, { ok: false, error: "not_found", message: `工坊里没有这张能渲染的壁纸：${id}` });
    return;
  }
  const target = normalize(join(entry.dir, entry.file));
  const mime = MIME[extname(target).toLowerCase()];
  // 作者写的路径可能带 `..`；照样按目录包含检查一遍。
  if (!target.startsWith(normalize(entry.dir) + sep) || mime === undefined) {
    sendJson(res, 403, { ok: false, error: "forbidden", message: "这张壁纸的路径不合法" });
    return;
  }
  let body;
  try {
    body = await readFile(target);
  } catch {
    sendJson(res, 404, { ok: false, error: "not_found", message: "壁纸文件读不到" });
    return;
  }
  res.writeHead(200, {
    "content-type": mime,
    "content-length": body.length,
    "cache-control": "private, max-age=300",
  });
  res.end(body);
}

/** 读请求体，带上限。 */
function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** 发一个媒体文件。路径包含检查在调用方之前做完。 */
async function serveMedia(res, dir, name) {
  const root = normalize(dir);
  const target = normalize(join(root, name));
  // 越界在**碰磁盘之前**就挡掉：`..`、编码过的分隔符都在这里变成 403。
  if (target !== root && !target.startsWith(root + sep)) {
    sendJson(res, 403, { ok: false, error: "forbidden", message: "壁纸路径越界" });
    return;
  }
  const mime = MIME[extname(target).toLowerCase()];
  if (mime === undefined) {
    sendJson(res, 404, { ok: false, error: "not_found", message: "不支持的壁纸类型" });
    return;
  }
  let body;
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    body = await readFile(target);
  } catch {
    sendJson(res, 404, { ok: false, error: "not_found", message: `找不到壁纸：${name}` });
    return;
  }
  res.writeHead(200, {
    "content-type": mime,
    "content-length": body.length,
    // 壁纸换了名字就换了地址，所以可以短缓存；但目录内容随时可能变，不能长缓存。
    "cache-control": "private, max-age=30",
  });
  res.end(body);
}

/**
 * 把一个请求交给插件处理。
 *
 * 拆出来是为了自检能直接调它 —— 和 `dsh-plugin-mascot` 一样的做法：路由注册那一段
 * 在测试里没有 webServer 可用，而处理逻辑才是要测的东西。
 *
 * @param ctx - plugin context.
 * @param req - incoming request.
 * @param res - response.
 * @param config - merged config.
 * @returns a promise that settles when the response is written.
 */
export async function handle(ctx, req, res, config) {
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed", message: "只支持 GET / POST" });
    return;
  }
  const pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
  const route = decodeURIComponent(pathname.slice(config.routePrefix.length) || "/");

  if (!authorized(ctx, req)) {
    sendJson(res, 401, { ok: false, error: "unauthorized", message: "需要 DSH Web 会话认证" });
    return;
  }

  if (route === "/api/state") {
    if (method === "POST") {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {
        sendJson(res, 400, { ok: false, error: "bad_json", message: "请求体不是 JSON" });
        return;
      }
      const current = await readState(config.dir);
      const next = {
        file: typeof body.file === "string" ? body.file : current.file,
        dim: typeof body.dim === "number" ? Math.max(0, Math.min(100, body.dim)) : current.dim,
        blur: typeof body.blur === "number" ? Math.max(0, Math.min(40, body.blur)) : current.blur,
      };
      // 只允许选真的存在的那张：状态文件是可以被手改的，而它决定发哪个文件出去。
      // 工坊的壁纸用 `we:<id>` 表示，id 也要在这一刻真实存在于扫描结果里。
      if (next.file !== "" && !(await isSelectable(config, next.file))) {
        sendJson(res, 400, { ok: false, error: "unknown_file", message: `没有这张壁纸：${next.file}` });
        return;
      }
      await writeState(config.dir, next);
      sendJson(res, 200, { ok: true, ...(await answer(config)) });
      return;
    }
    sendJson(res, 200, { ok: true, ...(await answer(config)) });
    return;
  }

  if (method === "POST") {
    sendJson(res, 405, { ok: false, error: "method_not_allowed", message: "这个路由只支持 GET" });
    return;
  }

  if (route.startsWith("/media/")) {
    await serveMedia(res, config.dir, route.slice("/media/".length));
    return;
  }

  // 工坊壁纸走自己的路由：它的文件在用户的壁纸目录之外，而且路径由 project.json 决定，
  // 不由请求决定。
  if (route.startsWith("/workshop/")) {
    await serveWorkshop(res, route.slice("/workshop/".length));
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found", message: `没有这个路由：${route}` });
}

/** 状态接口的正文：装了什么、选了什么、当前生效的两个值。 */
async function answer(config) {
  const [local, state, workshop] = await Promise.all([
    listWallpapers(config.dir),
    readState(config.dir),
    // Wallpaper Engine 没装就是空的 —— 那不是错误，是这台机器上没有它。
    workshopWallpapers().catch((error) => ({ playable: [], skipped: [], error: messageOf(error) })),
  ]);
  const files = [
    ...local.map((entry) => ({ ...entry, source: "local" })),
    ...(workshop.playable ?? []).map((entry) => ({
      file: `we:${entry.id}`,
      kind: "video",
      source: "workshop",
      title: entry.title,
    })),
  ];
  return {
    dir: config.dir,
    files,
    // 选了哪张：本机的是文件名，工坊的是 `we:<id>`。
    file: files.some((entry) => entry.file === state.file) ? state.file : "",
    dim: state.dim ?? config.dim,
    blur: state.blur ?? config.blur,
    muted: config.muted,
    // 收不了的工坊壁纸，连同原因一起报出去。
    workshopSkipped: workshop.skipped ?? [],
    steamLibraries: steamLibraries(),
  };
}

/** 从任意错误里取一句话，不让 undefined 漏进响应。 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 这个 id 现在选不选得了。
 *
 * 每次都重新扫，不用缓存：状态文件能被人手改，而"这个 id 现在真的存在"必须是**这一刻**的
 * 事实。工坊那张也一样 —— 用户可能在 WE 里取消订阅。
 *
 * @param config - merged config.
 * @param file - a local filename, or `we:<id>`.
 * @returns true when it can be selected.
 */
async function isSelectable(config, file) {
  if (file.startsWith("we:")) {
    const id = file.slice("we:".length);
    if (!/^\d{1,20}$/u.test(id)) return false;
    const { playable } = await workshopWallpapers();
    return playable.some((entry) => entry.id === id);
  }
  const local = await listWallpapers(config.dir);
  return local.some((entry) => entry.file === file);
}

/**
 * Mount the plugin: claim one route prefix.
 * @param ctx - Client root context.
 * @param source - the patch row's `config`, if any.
 */
export function apply(ctx, source) {
  const config = readConfig(source);
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: config.routePrefix,
      handler: (req, res) => handle(ctx, req, res, config),
    }),
  );
}
