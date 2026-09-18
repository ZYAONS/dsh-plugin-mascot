/**
 * 用 check.mjs 的同款 harness 起真实插件，直接请求结城理精二那张图。
 *
 * 这一步回答的是："插件到底有没有把 6.9MB 的图发出去"。前面查的都是"文件在不在、索引对不对"，
 * 那些都通过了，所以问题如果存在，只可能在路由这一段。
 */
const host = await import(new URL("../lib/index.js", import.meta.url).href);

const calls = [];
let route;
const ctx = {
  get(service) {
    if (service === "connection") return { isAuthenticated: () => true };
    if (service === "credentials") return { resolve: async () => ({ value: "sk-test", source: "test" }) };
    return undefined;
  },
  effect: (callback) => callback(),
  webServer: {
    register(registered) {
      route = registered;
      return () => {};
    },
  },
};
host.apply(ctx, {});
console.log(`路由已注册: ${String(route?.path)}`);

/** One request through the real handler. */
function request(path) {
  const headers = {};
  const chunks = [];
  const res = {
    writeHead(status, sent) { this.status = status; Object.assign(headers, sent ?? {}); },
    end(body) { if (body !== undefined) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body))); this.done = true; },
  };
  const req = { url: path, method: "GET", headers: { host: "127.0.0.1:1" } };
  return Promise.resolve(route.handler(req, res)).then(() => ({
    status: res.status,
    headers,
    size: Buffer.concat(chunks).length,
    body: Buffer.concat(chunks),
  }));
}

for (const name of ["makoto-portrait.png", "makoto-chibi.png", "muelsyse-festival.png"]) {
  try {
    const result = await request(`/dsh-mascot/art/${name}`);
    const expected = (await import("node:fs")).statSync(`art/${name}`).size;
    const ok = result.size === expected;
    console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(26)} HTTP ${String(result.status)}  ${String(result.size)} 字节（磁盘上 ${String(expected)}）  ${String(result.headers["content-type"])}`);
  } catch (error) {
    console.log(`ERR  ${name}: ${error.name} ${String(error.message).slice(0, 80)}`);
  }
}

// 顺带看 API 报的索引里有没有它
const looks = await request("/dsh-mascot/api/looks");
const payload = JSON.parse(looks.body.toString());
const ids = (payload.looks ?? []).map((look) => look.id);
console.log(`\n/api/looks 报了 ${String(ids.length)} 套形象`);
console.log(`  含 makoto-portrait: ${String(ids.includes("makoto-portrait"))}`);
const makoto = (payload.characters ?? []).find((character) => character.id === "makoto");
console.log(`  结城理的形象: ${(makoto?.looks ?? []).join(" > ")}`);
