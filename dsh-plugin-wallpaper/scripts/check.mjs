/**
 * dsh-plugin-wallpaper 自检。
 *
 * 测的是**路由行为**，不是"文件存在"。写法照 `dsh-plugin-mascot`：
 * 造一个假 ctx、一个假 req/res，直接调 `handle()` —— 路由注册那一段在自检里没有
 * webServer 可用，而处理逻辑才是要测的东西。
 *
 *   node scripts/check.mjs
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 让自检**不依赖这台机器**。
 *
 * 本机装了 Wallpaper Engine 的工坊内容（47 张能渲染的），如果让它去走真实探测，
 * 断言"列表里只有 a.png 和 b.jpg"就会因为多出 47 条而失败 —— 第一次写这几条时就是这样，
 * 测试红得毫无道理。所以钉死库目录到一个空文件夹，真实探测的事由下面那组工坊测试
 * 自己造一棵假的库树来验。
 */
const FAKE_STEAM = mkdtempSync(join(tmpdir(), "wallpaper-steam-"));
process.env.DSH_WALLPAPER_STEAM = FAKE_STEAM;

const host = await import(new URL("../lib/index.js", import.meta.url).href);
host.resetSteamCache();

let passed = 0;
const failures = [];
async function it(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${label}`);
  } catch (error) {
    failures.push(label);
    console.log(`  FAIL  ${label}`);
    console.log(`        ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 一个临时壁纸目录，里面放几张认得和不认得的文件。 */
function wallpaperDir() {
  const dir = mkdtempSync(join(tmpdir(), "wallpaper-check-"));
  // 一张最小的合法 PNG（1×1 透明），够让 readFile 有东西可发。
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  writeFileSync(join(dir, "a.png"), png);
  writeFileSync(join(dir, "b.jpg"), png);
  writeFileSync(join(dir, "notes.txt"), "not a wallpaper");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "c.png"), png);
  return dir;
}

/** 假 ctx：`authenticated` 决定会话是否有效。 */
function fakeContext({ authenticated = true } = {}) {
  return { get: (service) => (service === "connection" ? { isAuthenticated: () => authenticated } : undefined) };
}

/** 假 req/res，返回状态码、响应头和正文。 */
function call(config, { path, method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    if (body !== undefined) chunks.push(Buffer.from(body, "utf8"));
    const req = {
      method,
      url: path,
      headers: { host: "127.0.0.1:43120", ...headers },
      on(event, handler) {
        if (event === "data") for (const chunk of chunks) handler(chunk);
        if (event === "end") handler();
        return this;
      },
      destroy() {},
    };
    const captured = { status: undefined, headers: undefined, body: undefined };
    const res = {
      writeHead(status, head) {
        captured.status = status;
        captured.headers = head;
      },
      end(payload) {
        captured.body = payload;
        resolve(captured);
      },
    };
    host.handle(fakeContext(), req, res, config);
  });
}

const withDir = (dir, extra = {}) => host.readConfig({ dir, ...extra });
const json = (answer) => JSON.parse(String(answer.body));

//#region config
await it("config clamps and defaults", () => {
  const base = host.readConfig({});
  assert.equal(base.routePrefix, "/dsh-wallpaper");
  assert.equal(base.dim, 42);
  assert.equal(base.muted, true);
  // 越界被夹住，而不是原样相信。
  assert.equal(host.readConfig({ dim: 500 }).dim, 100);
  assert.equal(host.readConfig({ dim: -20 }).dim, 0);
  assert.equal(host.readConfig({ blur: 999 }).blur, 40);
  // 尾斜杠会让路由拼出来双斜杠。
  assert.equal(host.readConfig({ routePrefix: "/x/" }).routePrefix, "/x");
});

//#endregion

//#region routes
await it("a session-less request gets 401 and no listing", async () => {
  const dir = wallpaperDir();
  try {
    const config = withDir(dir);
    const req = {
      method: "GET", url: `${config.routePrefix}/api/state`, headers: { host: "127.0.0.1:43120" }, on: () => req, destroy() {},
    };
    const answer = await new Promise((resolve) => {
      host.handle({ get: () => ({ isAuthenticated: () => false }) }, req, { writeHead: (s, hh) => resolve({ status: s, headers: hh }), end: () => {} }, config);
    });
    assert.equal(answer.status, 401);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await it("a cross-site request is refused, but only on evidence the browser itself supplies", async () => {
  const dir = wallpaperDir();
  try {
    const config = withDir(dir);
    // 主要那道：和 DSH 框架自己用的是同一个头。
    const site = await call(config, { path: `${config.routePrefix}/api/state`, headers: { "sec-fetch-site": "cross-site" } });
    assert.equal(site.status, 401);

    // 能解析出、确实不同源：拒。
    const origin = await call(config, { path: `${config.routePrefix}/api/state`, headers: { origin: "https://evil.example" } });
    assert.equal(origin.status, 401);

    // `Origin: null` 是合法值（沙箱 iframe / 不透明来源），不该当成伪造拒掉。
    const opaque = await call(config, { path: `${config.routePrefix}/api/state`, headers: { origin: "null" } });
    assert.equal(opaque.status, 200);

    // 解析不出来的 Origin 是**未知**，不是敌意：伪造者本来就能随便写 Origin，
    // 拒绝解析不出来的值对伪造毫无作用。交给会话判。
    const junk = await call(config, { path: `${config.routePrefix}/api/state`, headers: { origin: "not a url" } });
    assert.equal(junk.status, 200);

    // 会话那一道不受影响：不透明来源不是绕过会话的路。
    const denied = await new Promise((resolve) => {
      const req = {
        method: "GET", url: `${config.routePrefix}/api/state`,
        headers: { host: "127.0.0.1:43120", origin: "null" }, on: () => req, destroy() {},
      };
      host.handle({ get: () => ({ isAuthenticated: () => false }) }, req,
        { writeHead: (status, hh) => resolve({ status, headers: hh }), end: () => {} }, config);
    });
    assert.equal(denied.status, 401, "an opaque Origin is not a way past the session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await it("the listing holds only recognised media, and never a directory", async () => {
  const dir = wallpaperDir();
  try {
    const config = withDir(dir);
    const answer = json(await call(config, { path: `${config.routePrefix}/api/state` }));
    assert.equal(answer.ok, true);
    assert.deepEqual(answer.files.map((f) => f.file), ["a.png", "b.jpg"]);
    assert.deepEqual(answer.files.map((f) => f.kind), ["image", "image"]);
    // 目录不算壁纸，不认的扩展名也不算。
    assert.equal(answer.files.some((f) => f.file === "sub"), false);
    assert.equal(answer.files.some((f) => f.file === "notes.txt"), false);
    // 一个都没有时，选中的必须是空的 —— 不能留着一个指不到文件的 id。
    assert.equal(answer.file, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await it("a missing directory is empty, not an error", async () => {
  const config = withDir(join(tmpdir(), "wallpaper-does-not-exist-at-all"));
  const answer = json(await call(config, { path: `${config.routePrefix}/api/state` }));
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.files, []);
});

await it("choosing a wallpaper persists it, and it comes back on the next read", async () => {
  const dir = wallpaperDir();
  try {
    const config = withDir(dir);
    const saved = json(await call(config, { path: `${config.routePrefix}/api/state`, method: "POST", body: JSON.stringify({ file: "b.jpg" }) }));
    assert.equal(saved.ok, true);
    assert.equal(saved.file, "b.jpg");
    const read = json(await call(config, { path: `${config.routePrefix}/api/state` }));
    assert.equal(read.file, "b.jpg", "the choice did not survive the round trip");
    // 暗化也跟着存。
    const dimmed = json(await call(config, { path: `${config.routePrefix}/api/state`, method: "POST", body: JSON.stringify({ dim: 80 }) }));
    assert.equal(dimmed.dim, 80);
    assert.equal(dimmed.file, "b.jpg", "changing one field must not clear another");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await it("a file that is not in the directory cannot be chosen", async () => {
  // 状态文件决定发哪个文件出去，所以它不能变成一个任意路径读取口。
  const dir = wallpaperDir();
  try {
    const config = withDir(dir);
    const answer = await call(config, { path: `${config.routePrefix}/api/state`, method: "POST", body: JSON.stringify({ file: "../../etc/passwd" }) });
    assert.equal(answer.status, 400);
    assert.equal(json(answer).error, "unknown_file");
    // 而且没有被写进去。
    assert.equal(json(await call(config, { path: `${config.routePrefix}/api/state` })).file, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await it("media is served with its type, and the path cannot leave the directory", async () => {
  const dir = wallpaperDir();
  try {
    const config = withDir(dir);
    const png = await call(config, { path: `${config.routePrefix}/media/a.png` });
    assert.equal(png.status, 200);
    assert.equal(png.headers["content-type"], "image/png");
    assert.ok(png.body.length > 0, "an empty body is not a wallpaper");

    // 越界：编码过的和没编码的都要挡住，而且是在碰磁盘之前。
    assert.equal((await call(config, { path: `${config.routePrefix}/media/..%2F..%2Fetc%2Fpasswd` })).status, 403);
    assert.equal((await call(config, { path: `${config.routePrefix}/media/..%2Fstate.json` })).status, 403);
    // 目录不是文件，不认的扩展名不发。
    assert.equal((await call(config, { path: `${config.routePrefix}/media/sub` })).status, 404);
    assert.equal((await call(config, { path: `${config.routePrefix}/media/notes.txt` })).status, 404);
    assert.equal((await call(config, { path: `${config.routePrefix}/media/nope.png` })).status, 404);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await it("unknown routes and methods are answered, not left hanging", async () => {
  const dir = wallpaperDir();
  try {
    const config = withDir(dir);
    assert.equal((await call(config, { path: `${config.routePrefix}/nope` })).status, 404);
    assert.equal((await call(config, { path: `${config.routePrefix}/api/state`, method: "POST", body: "not json" })).status, 400);
    assert.equal((await call(config, { path: `${config.routePrefix}/media/a.png`, method: "POST" })).status, 405);
    assert.equal((await call(config, { path: `${config.routePrefix}/api/state`, method: "DELETE" })).status, 405);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

//#endregion

//#region workshop
/** 造一棵假的 Steam 库树，按 Wallpaper Engine 的工坊布局。 */
function fakeSteamTree() {
  const steamm = mkdtempSync(join(tmpdir(), "wallpaper-workshop-"));
  const content = join(steamm, "steamapps", "workshop", "content", host.WE_APP_ID);
  const write = (id, project, extra = {}) => {
    mkdirSync(join(content, id), { recursive: true });
    writeFileSync(join(content, id, "project.json"), JSON.stringify(project));
    for (const [name, body] of Object.entries(extra)) writeFileSync(join(content, id, name), body);
  };
  write("111", { type: "video", title: "A video", file: "clip.mp4" }, { "clip.mp4": "MP4DATA" });
  // 没写 file：应当自己找目录里第一个视频。
  write("222", { type: "video", title: "B no file field" }, { "loop.webm": "WEBDATA", "cover.jpg": "JPG" });
  // 三类做不了的，各一张。
  write("333", { type: "scene", title: "C scene" }, { "scene.pkg": "PKG" });
  write("444", { type: "web", title: "D web" }, { "index.html": "<html>" });
  write("555", { type: "application", title: "E app" }, {});
  // 损坏的 project.json：应当整条跳过，而不是让扫描炸掉。
  mkdirSync(join(content, "666"), { recursive: true });
  writeFileSync(join(content, "666", "project.json"), "{ not json");
  // 声明了 video 但目录里没有视频文件。
  write("777", { type: "video", title: "F video without a file" }, { "readme.txt": "x" });
  // 作者写的路径想往外走。
  write("888", { type: "video", title: "G escape", file: "..\\..\\evil.mp4" }, {});
  return steamm;
}

await it("workshop scanning takes the videos and names why it left the rest", async () => {
  const steamm = fakeSteamTree();
  const previous = process.env.DSH_WALLPAPER_STEAM;
  try {
    process.env.DSH_WALLPAPER_STEAM = steamm;
    host.resetSteamCache();
    const { playable, skipped } = await host.workshopWallpapers(host.steamLibraries());
    assert.deepEqual(playable.map((entry) => entry.id), ["111", "222"]);
    // 没写 `file` 的那张自己找到了 webm。
    assert.equal(playable.find((entry) => entry.id === "222").file, "loop.webm");
    // 收不了的要说清是哪一类，而不是凭空消失。
    const reasons = Object.fromEntries(skipped.map((entry) => [entry.id, entry.type]));
    assert.equal(reasons["333"], "scene");
    assert.equal(reasons["444"], "web");
    assert.equal(reasons["555"], "application");
    assert.equal(reasons["777"], "video-without-a-file");
    // 作者写的路径想往外走：扫描时就不列出来，而不是列出来点了才发现发不出去。
    assert.equal(reasons["888"], "file-outside-the-wallpaper");
    assert.equal(playable.some((entry) => entry.id === "888"), false, "a wallpaper that escapes its own folder must not be listed");
    // 坏的 project.json 整条跳过，既不进列表也不报成"收不了"。
    assert.equal(skipped.some((entry) => entry.id === "666"), false, "a broken project.json is skipped, not reported");
    assert.equal(playable.some((entry) => entry.id === "666"), false);
  } finally {
    process.env.DSH_WALLPAPER_STEAM = previous;
    host.resetSteamCache();
    rmSync(steamm, { recursive: true, force: true });
  }
});

await it("a workshop video can be chosen, served, and cannot be used to escape its folder", async () => {
  const steamm = fakeSteamTree();
  const dir = wallpaperDir();
  const previous = process.env.DSH_WALLPAPER_STEAM;
  try {
    process.env.DSH_WALLPAPER_STEAM = steamm;
    host.resetSteamCache();
    const config = withDir(dir);

    const listed = json(await call(config, { path: `${config.routePrefix}/api/state` }));
    assert.deepEqual(listed.files.map((entry) => entry.file), ["a.png", "b.jpg", "we:111", "we:222"]);
    assert.equal(listed.files.find((entry) => entry.file === "we:111").kind, "video");
    assert.equal(listed.steamLibraries.length, 1);

    // 选中它，并且能读回来。
    const chosen = json(await call(config, { path: `${config.routePrefix}/api/state`, method: "POST", body: JSON.stringify({ file: "we:111" }) }));
    assert.equal(chosen.file, "we:111");
    assert.equal(json(await call(config, { path: `${config.routePrefix}/api/state` })).file, "we:111");

    // 真的把文件发出来了。
    const media = await call(config, { path: `${config.routePrefix}/workshop/111` });
    assert.equal(media.status, 200);
    assert.equal(media.headers["content-type"], "video/mp4");
    assert.equal(String(media.body), "MP4DATA");

    // 收不了的那些、不存在的、以及不是数字的 id，都发不出去。
    assert.equal((await call(config, { path: `${config.routePrefix}/workshop/333` })).status, 404);
    assert.equal((await call(config, { path: `${config.routePrefix}/workshop/999` })).status, 404);
    assert.equal((await call(config, { path: `${config.routePrefix}/workshop/..%2F..%2Fetc` })).status, 404);

    // 作者在 project.json 里写 `..\..\evil.mp4` 的那张：根本不在列表里，选不了也发不出去。
    const escape = await call(config, { path: `${config.routePrefix}/workshop/888` });
    assert.equal(escape.status, 404, "a wallpaper that escapes its own folder must not be reachable");
    const escapeSelect = await call(config, { path: `${config.routePrefix}/api/state`, method: "POST", body: JSON.stringify({ file: "we:888" }) });
    assert.equal(escapeSelect.status, 400);

    // 选一张不存在的工坊壁纸要被拒。
    const bogus = await call(config, { path: `${config.routePrefix}/api/state`, method: "POST", body: JSON.stringify({ file: "we:424242" }) });
    assert.equal(bogus.status, 400);
  } finally {
    process.env.DSH_WALLPAPER_STEAM = previous;
    host.resetSteamCache();
    rmSync(steamm, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

await it("no Steam installed is an empty list, not a failure", async () => {
  const previous = process.env.DSH_WALLPAPER_STEAM;
  try {
    process.env.DSH_WALLPAPER_STEAM = join(tmpdir(), "no-such-steam-library-at-all");
    host.resetSteamCache();
    const dir = wallpaperDir();
    try {
      const config = withDir(dir);
      const listed = json(await call(config, { path: `${config.routePrefix}/api/state` }));
      assert.deepEqual(listed.files.map((entry) => entry.file), ["a.png", "b.jpg"]);
      assert.deepEqual(listed.workshopSkipped, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    process.env.DSH_WALLPAPER_STEAM = previous;
    host.resetSteamCache();
  }
});

//#endregion

//#region client half
//#region the Arknights filter
/**
 * 客户端半边是给 `__ModuleLoader__` 用的，但工厂是纯函数，可以在这里跑起来。
 * 检索的表和判定从**源码**取，不另抄一份 —— 抄一份就多一个会腐化的副本。
 */
function clientHalf() {
  const captured = [];
  const previous = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: (entry) => captured.push(entry) } };
  try {
    const source = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "lib", "client.js"), "utf8");
    // eslint-disable-next-line no-new-func
    new Function(source)();
  } finally {
    globalThis.window = previous;
  }
  return captured[0].factory((spec) => {
    if (spec === "react") return { createElement: () => null, Fragment: Symbol("f"), useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({}), useCallback: (f) => f };
    throw new Error(`unexpected require(${spec})`);
  });
}

await it("the catalogue filter takes the game and its characters, and not the wallpapers in between", () => {
  // 这张表是拿本机真实的 152 张工坊壁纸校准出来的，两条误伤是真的抓到过：
  //   · 单个字母 `w` 把 `Zero Two / DARLING in the FRANXX [AR]` 认成了方舟；
  //   · `夜莺` 撞了工坊里一位作者 `夜莺Night`，于是 `黑神话悟空——夜莺Night` 被认成方舟。
  // 所以下面两条既是回归，也是这个表为什么长这样的说明。
  const client = clientHalf();
  const ark = client.CATALOGS.find((entry) => entry.id === "arknights");
  const inArk = (title) => client.inCatalog({ title, file: "we:1" }, ark);

  // 认得出来的：游戏名、以及只写角色名的那种。
  for (const title of [
    "明日方舟 能天使",
    "Arknights 德克萨斯 by g-nai",
    "「4K」明日方舟Arknights-夕-林中",
    "德克萨斯",
    "mon3tr",
    "蕾缪安 身体检查 | Lemuen Check-up",
    "薇薇安娜 | Viviana",
  ]) assert.equal(inArk(title), true, `应认成方舟：${title}`);

  // 认不出来的：别的游戏、以及两个真实误伤。
  for (const title of [
    "Zero Two / DARLING in the FRANXX [4K] [AR]",
    "【4k 高度自定义 景深视差】黑神话悟空——夜莺Night Black Myth",
    "Fate Stay Night - Sakura Mato (Dark) Cybust",
    "Winter Artoria Pendragon | Fate/Zero [4K]",
    "Nissan GTR R34 [Pneumatic Tokyo]",
  ]) assert.equal(inArk(title), false, `不该认成方舟：${title}`);

  // 单字与常用词不进表 —— 这一类是误伤的来源。
  const all = [...ark.works, ...ark.bands, ...ark.characters];
  for (const word of ["w", "年", "夕", "令", "陈", "shu", "dusk", "logos", "夜莺", "nightingale"]) {
    assert.equal(all.includes(word), false, `"${word}" 太宽，不该在表里`);
  }

  // 「不过滤」就是全过。
  assert.equal(client.inCatalog({ title: "随便什么", file: "x" }, undefined), true);

  // 自由检索：子串、大小写不敏感、空串不筛。
  const entry = { title: "Arknights Texas", file: "we:9" };
  assert.equal(client.matches(entry, ""), true);
  assert.equal(client.matches(entry, "texas"), true);
  assert.equal(client.matches(entry, "TEXAS"), true);
  assert.equal(client.matches(entry, "能天使"), false);
});

await it("the BanG Dream! table is honest about not having been calibrated", () => {
  // 本机 152 张工坊壁纸里一张邦多利都没有（作品名 / 乐队名 / 角色名全零命中，
  // 见 .scratch/bangdream-calibrate.mjs）。所以这张表**没有真实样本可对照** ——
  // 这件事要写在数据里让界面能说出来，而不是只写在源码注释里等着被忽略。
  const client = clientHalf();
  const bang = client.CATALOGS.find((entry) => entry.id === "bangdream");
  assert.ok(bang !== undefined, "BanG Dream! 应该在目录里");
  assert.equal(bang.calibrated, false, "没校准过就要标成没校准过");
  assert.equal(client.CATALOGS.find((entry) => entry.id === "arknights").calibrated, true, "方舟那张是校准过的");

  const inBang = (title) => client.inCatalog({ title, file: "we:1" }, bang);

  // 认得出来的：作品名、乐队名、角色全名。
  for (const title of [
    "BanG Dream! It's MyGO!!!!! 高松灯",
    "バンドリ 丰川祥子",
    "Ave Mujica 若叶睦",
    "Roselia 凑友希那 4K",
    "Poppin'Party 户山香澄",
    "千石由乃 常服",
  ]) assert.equal(inBang(title), true, `应认成邦多利：${title}`);

  // 认不出来的：别的作品。
  for (const title of [
    "明日方舟 能天使",
    "Zero Two / DARLING in the FRANXX [4K]",
    "Nissan GTR R34 [Pneumatic Tokyo]",
  ]) assert.equal(inBang(title), false, `不该认成邦多利：${title}`);

  // 没校准的表要**更保守**：不收任何单字，也不收那些同时是常用英文词的成员代号。
  const all = [...bang.works, ...bang.bands, ...bang.characters];
  for (const word of ["layer", "lock", "masking", "pareo", "chuchu", "灯", "睦", "兰", "彩"]) {
    assert.equal(all.includes(word), false, `"${word}" 太宽或太泛，没校准的表不该收`);
  }
  // 三层都要有东西：作品名、乐队名、角色名 —— 少一层就是这张表没写完。
  for (const layer of ["works", "bands", "characters"]) {
    assert.ok(bang[layer].length > 0, `BanG Dream! 的 ${layer} 是空的`);
  }
  assert.ok(bang.bands.length >= 8, `乐队名只有 ${String(bang.bands.length)} 个，这张表大概漏了`);
  assert.ok(bang.characters.length >= 30, `角色名只有 ${String(bang.characters.length)} 个，这张表大概漏了一大片`);
});

//#endregion

//#region client half
await it("the client half registers under its own id", () => {  const source = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "lib", "client.js"), "utf8");
  assert.match(source, /__ModuleLoader__\.load\(/u);
  assert.match(source, /id:\s*"dsh-plugin-wallpaper"/u);
  // 包名 = 运行期标识，四处必须一致：这里至少守住注册 id 与 package.json 的 name。
  const pkg = JSON.parse(readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "package.json"), "utf8"));
  assert.match(source, new RegExp(`id:\\s*"${pkg.name}"`, "u"), "the loader id and the package name must agree");
});

await it("the wallpaper layer is injected into body, not into a slot", () => {
  // `shell.overlay` 是 z-index 1000，比界面高，壁纸放进去会盖住整个应用。
  const source = readFileSync(join(fileURLToPath(new URL("..", import.meta.url)), "lib", "client.js"), "utf8");
  assert.match(source, /document\.body\.insertBefore/u, "the layer must go into body");
  assert.match(source, /z-index:-1/u, "and behind everything");
  assert.match(source, /pointer-events:none/u, "and must never eat clicks");
});

//#endregion

console.log(`\nwallpaper: ${String(passed)} passed, ${String(failures.length)} failed`);
if (failures.length > 0) process.exit(1);
