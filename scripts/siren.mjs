#!/usr/bin/env node
/**
 * 塞壬唱片（Monster Siren Records）小工具。
 *
 * 明日方舟的原声由官方厂牌「塞壬唱片-MSR」发行，官网有一套公开的 JSON API：
 *
 *   GET /api/albums        全部专辑（cid / name / coverUrl / artistes），293 张
 *   GET /api/songs         全部曲目（cid / name / albumCid / artists）
 *   GET /api/song/<cid>    单曲详情，含 sourceUrl —— 官方 CDN 上可直接播放的音频
 *
 * 官网页面上没有音频直链（它是单页应用），所以只能走 API。
 *
 * 用法：
 *   node scripts/siren.mjs albums [关键词]     列专辑，可按关键词过滤
 *   node scripts/siren.mjs songs  [关键词]     列曲目
 *   node scripts/siren.mjs resolve <专辑名>    给出某张专辑的第一首歌与可播音源
 *
 * 注意：音频与封面都在官方 CDN 上，本工具只做查询，不下载、不再分发。
 */

const BASE = "https://monster-siren.hypergryph.com";

/** 取一个 JSON 端点，失败时抛出可读的错误。 */
async function api(path) {
  const response = await fetch(BASE + path, {
    headers: { "user-agent": "dsh-plugin-mascot/0.1 (+https://github.com/ZYAONS/dsh-plugin-mascot)", accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`${path} → HTTP ${String(response.status)}`);
  const payload = await response.json();
  if (payload?.code !== undefined && payload.code !== 0 && payload.data === undefined) {
    throw new Error(`${path} → ${String(payload.msg ?? "unknown error")}`);
  }
  return payload?.data;
}

const [command, ...rest] = process.argv.slice(2);
const keyword = rest.join(" ").trim();

try {
  if (command === "albums") {
    const data = await api("/api/albums");
    const albums = (data ?? []).filter((album) => keyword === "" || String(album.name).includes(keyword));
    console.log(`${String(albums.length)} 张专辑${keyword === "" ? "" : `（含 "${keyword}"）`}`);
    for (const album of albums.slice(0, 40)) {
      console.log(`  ${String(album.cid).padEnd(7)} ${album.name}`);
    }
  } else if (command === "songs") {
    const data = await api("/api/songs");
    const songs = (data?.list ?? []).filter((song) => keyword === "" || String(song.name).includes(keyword));
    console.log(`${String(songs.length)} 首曲目${keyword === "" ? "" : `（含 "${keyword}"）`}`);
    for (const song of songs.slice(0, 40)) {
      console.log(`  ${String(song.cid).padEnd(8)} album=${String(song.albumCid).padEnd(7)} ${song.name}`);
    }
  } else if (command === "resolve") {
    if (keyword === "") throw new Error("用法：node scripts/siren.mjs resolve <专辑名>");
    const albums = (await api("/api/albums")) ?? [];
    const album = albums.find((entry) => String(entry.name) === keyword) ?? albums.find((entry) => String(entry.name).includes(keyword));
    if (album === undefined) throw new Error(`没有找到专辑 "${keyword}"`);
    const songs = ((await api("/api/songs"))?.list ?? []).filter((song) => String(song.albumCid) === String(album.cid));
    console.log(`专辑 ${album.name}（cid ${String(album.cid)}）${String(songs.length)} 首`);
    console.log(`  封面 ${String(album.coverUrl ?? "-")}`);
    for (const song of songs.slice(0, 6)) {
      const detail = await api(`/api/song/${String(song.cid)}`);
      console.log(`  ${song.name}`);
      console.log(`     音源 ${String(detail?.sourceUrl ?? "(无)")}`);
    }
  } else {
    console.log("用法：");
    console.log("  node scripts/siren.mjs albums [关键词]");
    console.log("  node scripts/siren.mjs songs  [关键词]");
    console.log("  node scripts/siren.mjs resolve <专辑名>");
  }
} catch (error) {
  console.error(`siren: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
