#!/usr/bin/env node
/**
 * Download one furniture-set backdrop per character into `art/`.
 *
 * The plugin draws a room for every character from gradients, which is what the repository
 * ships. This script is for the other thing: putting the real furniture artwork of the
 * character's own set behind them. The images are official game art owned by Hypergryph,
 * so they live on the machine that runs this and are gitignored — exactly like the looks.
 *
 *   npm run fetch-rooms            # download what is missing
 *   npm run fetch-rooms -- --force # re-download even if the file is already there
 *   npm run fetch-rooms -- --list  # show what is declared, download nothing
 *
 * Per entry in art/rooms.json:
 *   1. try each `urls` entry until one returns a non-empty body;
 *   2. check it looks like an image (content type, and a size a banner would plausibly be);
 *   3. write `art/room-<character>.<ext>`.
 *
 * The host finds them by name — `readRooms` in lib/index.js — so there is no index to
 * rebuild afterwards.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artDir = join(root, "art");
const argv = process.argv.slice(2);
const force = argv.includes("--force");
const listOnly = argv.includes("--list");

/** Image types the host will serve, and so the only ones worth writing. */
const EXTENSIONS = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg" };

/** A backdrop smaller than this is a placeholder, an error page, or a thumbnail. */
const MIN_BYTES = 12 * 1024;

/** Fetch one url as bytes, or undefined when it fails or is empty. */
async function grab(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
      // Some wiki CDNs hand a browser-friendly image to a browser-looking client and a
      // challenge page to anything else. This one says what it is, which is the polite
      // version of the same thing.
      headers: { accept: "image/*", "user-agent": "dsh-plugin-mascot/fetch-rooms (+https://github.com/ZYAONS/dsh-plugin-mascot)" },
    });
    if (!response.ok) {
      console.error(`      ${String(response.status)} ${response.statusText} — ${url}`);
      return undefined;
    }
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = EXTENSIONS[type] ?? EXTENSIONS[type.replace("image/jpg", "image/jpeg")];
    if (extension === undefined) {
      console.error(`      not an image (${type || "no content-type"}) — ${url}`);
      return undefined;
    }
    if (buffer.length < MIN_BYTES) {
      console.error(`      suspiciously small (${String(buffer.length)} bytes) — ${url}`);
      return undefined;
    }
    return { buffer, extension };
  } catch (error) {
    console.error(`      ${error instanceof Error ? error.message : String(error)} — ${url}`);
    return undefined;
  }
}

const declaration = JSON.parse(readFileSync(join(artDir, "rooms.json"), "utf8"));
const entries = declaration.rooms ?? [];

if (listOnly) {
  for (const entry of entries) {
    const installed = Object.values(EXTENSIONS).some((extension) => existsSync(join(artDir, `room-${entry.character}.${extension}`)));
    console.log(`${installed ? "✓" : " "} ${entry.character.padEnd(10)} ${entry.set}${entry.operatorSet === false ? "（同题材，非本人套装）" : ""}`);
  }
  console.log(`\n${String(entries.length)} 个角色，${String(entries.filter((e) => Object.values(EXTENSIONS).some((x) => existsSync(join(artDir, `room-${e.character}.${x}`)))).length)} 个已下载`);
  process.exit(0);
}

console.log(
  "这些是鹰角网络的官方家具素材。下载到本机自己看没问题，**不要提交进仓库**\n"
  + "（art/ 已被 gitignore，npm test 也会盯着这件事）。\n",
);

mkdirSync(artDir, { recursive: true });
let written = 0;
let skipped = 0;
let failed = 0;

for (const entry of entries) {
  const installed = Object.values(EXTENSIONS).some((extension) => existsSync(join(artDir, `room-${entry.character}.${extension}`)));
  if (installed && !force) {
    console.log(`  skip  ${entry.character} — 已经有了`);
    skipped += 1;
    continue;
  }
  console.log(`  get   ${entry.character} — ${entry.set}`);
  let done = false;
  for (const url of entry.urls ?? []) {
    const got = await grab(url);
    if (got === undefined) continue;
    writeFileSync(join(artDir, `room-${entry.character}.${got.extension}`), got.buffer);
    console.log(`        ${String(Math.round(got.buffer.length / 1024))} KB → room-${entry.character}.${got.extension}`);
    written += 1;
    done = true;
    break;
  }
  if (!done) {
    console.error(`        全部地址都失败了`);
    failed += 1;
  }
}

console.log(`\n写了 ${String(written)} 个，跳过 ${String(skipped)} 个，失败 ${String(failed)} 个。`);
console.log("重启 DSH 后生效：宿主按文件名找它们（lib/index.js 的 readRooms）。");
if (failed > 0) process.exit(1);
