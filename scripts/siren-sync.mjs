#!/usr/bin/env node
/**
 * 把角色映射到塞壬唱片的专辑，写出 art/siren.json。
 *
 *   npm run siren:sync
 *
 * 思路是"按活动反推"：塞壬按活动发专辑，命名规律是 `<活动名>OST`，所以先知道角色出自哪个
 * 活动，再找那个活动的专辑。映射写在下面的 EVENTS 里并注明依据 —— 它是查证结果，不是猜的。
 *
 * 专辑的封面上传在官方 CDN（web.hycdn.cn），音源在 res01.hycdn.cn，两者都只做**热链**，
 * 不下载、不再分发；进仓库的只有 cid 与曲名。
 *
 * BanG Dream 的两位没有塞壬唱片 —— 那是鹰角的厂牌，与 Bushiroad 无关。
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://monster-siren.hypergryph.com";
const HEADERS = { "user-agent": "dsh-plugin-mascot/0.1 (+https://github.com/ZYAONS/dsh-plugin-mascot)", accept: "application/json" };

/**
 * Character -> the event its music belongs to.
 *
 * Each entry records *why* that event: the mapping is a research result, and a bare list would
 * be impossible to check later.
 */
const EVENTS = {
  closure: { album: "相变临界OST", why: "七周年上岛，对应 2026-05-01 的七周年活动专辑" },
  muelsyse: { album: "孤星OST", why: "登场活动「孤星」（Lone Trail）" },
  miuyin: { album: "丛林症结OST", why: "登场活动「丛林症结」（SideStory）" },
  yuyuan: { album: "直到大地变成一颗酸橙OST", why: "夏季限定干员，对应 2026 夏日活动专辑" },
  dusk: { album: "画中人OST", why: "登场活动「画中人」（Who is Real）" },
  wang: { album: "辞岁行OST", why: "登场活动「辞岁行」（2026 春节 SideStory，2026-02-10 ~ 03-10）" },
  makoto: { album: "月行水上", why: "明日方舟 × 女神异闻录3 Reload 联动专辑" },
};

const api = async (path) => {
  const response = await fetch(BASE + path, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${path} → HTTP ${String(response.status)}`);
  return (await response.json())?.data;
};

const albums = (await api("/api/albums")) ?? [];
const songs = (await api("/api/songs"))?.list ?? [];
console.log(`塞壬唱片：${String(albums.length)} 张专辑，${String(songs.length)} 首曲目`);

const records = {};
const missing = [];
for (const [character, entry] of Object.entries(EVENTS)) {
  // Trimmed: at least one album title in the catalogue carries a leading space, and an
  // exact match silently missed it.
  const album = albums.find((item) => String(item.name).trim() === entry.album.trim());
  if (album === undefined) {
    missing.push(`${character}: 没有专辑「${entry.album}」`);
    continue;
  }
  const inAlbum = songs.filter((song) => String(song.albumCid) === String(album.cid));
  // 每张专辑的第一首作为试听曲：顺序即官方顺序，挑第一首不需要额外判断。
  const first = inAlbum[0];
  const detail = first === undefined ? undefined : await api(`/api/song/${String(first.cid)}`);
  records[character] = {
    album: album.name,
    albumCid: String(album.cid),
    cover: album.coverUrl ?? null,
    tracks: inAlbum.length,
    track: first === undefined ? null : { name: first.name, cid: String(first.cid), src: detail?.sourceUrl ?? null },
    event: entry.why,
  };
  console.log(`  ${character.padEnd(10)} ${album.name.padEnd(20)} ${String(inAlbum.length)} 首  试听：${first?.name ?? "-"}`);
}

for (const note of missing) console.warn(`  ⚠ ${note}`);

const target = join(root, "art", "siren.json");
writeFileSync(target, `${JSON.stringify({
  source: "塞壬唱片-MSR · monster-siren.hypergryph.com",
  note: "album cids and titles only; covers and audio are hotlinked from the official CDN and never redistributed",
  records,
}, null, 2)}\n`);
console.log(`siren:sync 写出 ${target}（${String(Object.keys(records).length)} 位角色）`);
