#!/usr/bin/env node
/**
 * Download the mascot artwork declared in `art/sources.json`.
 *
 * Why this exists: the artwork is official game art owned by Hypergryph and
 * Bushiroad. Committing it here would redistribute someone else's copyrighted
 * asset, so the repository ships the vector fallback plus this script, and the
 * operator pulls the real art onto their own machine (art/ is gitignored).
 *
 *   npm run fetch-art            # download anything missing
 *   npm run fetch-art -- --force # re-download even when the hash matches
 *
 * Files are verified against the sha256 pinned in the manifest. A mismatch is
 * reported loudly rather than silently accepted — an upstream that changed
 * under us is worth knowing about — but the file is still written, so a moved
 * asset never leaves the plugin with nothing to render.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artDir = join(root, "art");
const force = process.argv.includes("--force");

const manifest = JSON.parse(readFileSync(join(artDir, "sources.json"), "utf8"));
mkdirSync(artDir, { recursive: true });

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** Fetch one url as bytes, or undefined when it fails or is empty. */
async function grab(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
      headers: { accept: "image/*", "user-agent": "dsh-plugin-mascot/fetch-art" },
    });
    if (!response.ok) {
      console.error(`      ${String(response.status)} ${response.statusText} — ${url}`);
      return undefined;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      console.error(`      empty body — ${url}`);
      return undefined;
    }
    return buffer;
  } catch (error) {
    console.error(`      ${error instanceof Error ? error.message : String(error)} — ${url}`);
    return undefined;
  }
}

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const image of manifest.images) {
  const target = join(artDir, image.file);
  console.log(`\n${image.file}  (${image.character})`);

  if (!force && existsSync(target)) {
    const current = sha256(readFileSync(target));
    if (current === image.sha256) {
      console.log(`  ok    already present and verified`);
      skipped += 1;
      continue;
    }
    console.log(`  note  present but the hash differs — re-fetching`);
  }

  let body;
  for (const url of image.urls) {
    console.log(`  try   ${url}`);
    body = await grab(url);
    if (body !== undefined) break;
  }
  if (body === undefined) {
    console.error(`  FAIL  every source failed`);
    failed += 1;
    continue;
  }

  const actual = sha256(body);
  writeFileSync(target, body);
  downloaded += 1;
  if (actual === image.sha256) {
    console.log(`  ok    ${String(Math.round(body.length / 1024))} KB, hash verified`);
  } else {
    console.log(`  warn  ${String(Math.round(body.length / 1024))} KB, written anyway`);
    console.log(`        expected sha256 ${image.sha256}`);
    console.log(`        actual   sha256 ${actual}`);
    console.log(`        the upstream file changed — update art/sources.json if this is intended`);
  }
  console.log(`        ${image.rights}`);
}

console.log(`\nfetch-art: ${String(downloaded)} downloaded, ${String(skipped)} already present, ${String(failed)} failed`);
if (downloaded + skipped > 0) {
  console.log(`\nThe artwork is official game art and stays out of git on purpose.`);
  console.log(`${manifest.images.map((image) => `  ${image.file}: ${image.rights}`).join("\n")}`);
  console.log(`\nRestart DSH Desktop if this is the first time art/ has been populated.`);
}
process.exit(failed === 0 ? 0 : 1);
