#!/usr/bin/env node
/**
 * Download the mascot artwork declared in `art/sources.json`.
 *
 * Why this exists: the artwork is official game art owned by Hypergryph and
 * Bushiroad. Committing it here would redistribute someone else's copyrighted
 * asset, so the repository ships a neutral placeholder plus this script, and the
 * operator pulls the real art onto their own machine (art/ is gitignored).
 *
 *   npm run fetch-art            # download anything missing
 *   npm run fetch-art -- --force # re-download even when the hash matches
 *
 * Two kinds of entry:
 *   - plain entries are verified against the sha256 pinned in the manifest;
 *   - `cutout: true` entries download a promotional sheet and then run
 *     `scripts/cutout.mjs` over it, because the sheet carries two poses on a
 *     decorated background. The pinned hash covers the SOURCE; the derived file
 *     is sanity-checked instead, since browser PNG encoding may differ between
 *     Chromium builds.
 *
 * A mismatch is reported loudly — an upstream that changed under us is worth
 * knowing about — but the file is still written, so a moved asset never leaves
 * the plugin with nothing to render.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cutout } from "./cutout.mjs";

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

/** Download the first working source for one entry. */
async function download(image) {
  for (const url of image.urls) {
    console.log(`  try   ${url}`);
    const body = await grab(url);
    if (body !== undefined) return body;
  }
  return undefined;
}

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const image of manifest.images) {
  const target = join(artDir, image.file);
  console.log(`\n${image.file}  (${image.character})`);

  if (!force && existsSync(target) && !image.cutout) {
    if (sha256(readFileSync(target)) === image.sha256) {
      console.log("  ok    already present and verified");
      skipped += 1;
      continue;
    }
    console.log("  note  present but the hash differs — re-fetching");
  }

  const body = await download(image);
  if (body === undefined) {
    console.error("  FAIL  every source failed");
    failed += 1;
    continue;
  }

  const actual = sha256(body);
  if (actual !== image.sha256) {
    console.log(`  warn  source hash differs from the manifest`);
    console.log(`        expected ${image.sha256}`);
    console.log(`        actual   ${actual}`);
    console.log(`        the upstream file changed — update art/sources.json if this is intended`);
  } else {
    console.log(`  ok    source verified (${String(Math.round(body.length / 1024))} KB)`);
  }

  if (image.cutout !== true) {
    writeFileSync(target, body);
    downloaded += 1;
  } else {
    const work = mkdtempSync(join(tmpdir(), "dsh-mascot-fetch-"));
    try {
      const staged = join(work, `source${extname(image.file) || ".png"}`);
      writeFileSync(staged, body);
      console.log("  cut   removing the background (needs Chromium)");
      const size = cutout(staged, target);
      const derived = sha256(readFileSync(target));
      downloaded += 1;
      console.log(`  ok    ${String(size.width)}x${String(size.height)}, ${String(Math.round(readFileSync(target).length / 1024))} KB`);
      if (image.derivedSha256 !== undefined && derived !== image.derivedSha256) {
        console.log(`  note  derived hash differs from the recorded one (encoding drift, not content)`);
        console.log(`        recorded ${image.derivedSha256}`);
        console.log(`        derived  ${derived}`);
      }
    } catch (error) {
      console.error(`  FAIL  cutout: ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
      continue;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  console.log(`        ${image.rights}`);
}

console.log(`\nfetch-art: ${String(downloaded)} written, ${String(skipped)} already present, ${String(failed)} failed`);
if (downloaded + skipped > 0) {
  console.log("\nThe artwork is official game art and stays out of git on purpose.");
  for (const image of manifest.images) console.log(`  ${image.file}: ${image.rights}`);
  console.log("\nRestart DSH Desktop if this is the first time art/ has been populated.");
}
process.exit(failed === 0 ? 0 : 1);
