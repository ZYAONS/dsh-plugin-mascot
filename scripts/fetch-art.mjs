#!/usr/bin/env node
/**
 * Download every declared look, then hand off to `art-sync` so the plugin's
 * runtime index matches what is now on disk.
 *
 * Why the artwork is not in the repository: it is official game art owned by
 * Hypergryph and Bushiroad. Committing it would redistribute someone else's
 * copyrighted asset, so the repo ships the declaration plus these scripts, and
 * the operator pulls the real art onto their own machine (art/*.png is
 * gitignored).
 *
 *   npm run fetch-art            # download what is missing, then sync
 *   npm run fetch-art -- --force # re-download even when the hash matches
 *
 * Pipeline, per look:
 *   1. try each `urls` entry until one returns a non-empty body;
 *   2. verify the body against the pinned `sha256` (a mismatch is reported
 *      loudly but still written, so a moved asset never leaves you with nothing);
 *   3. if the look declares `cutout`, run scripts/cutout.mjs over the download —
 *      official sheets carry decorated backgrounds and sometimes two poses, and
 *      `mode: "all"` turns those into pixel-aligned animation frames;
 *   4. after every look, run scripts/art-sync.mjs to measure the images and
 *      rewrite art/index.json.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cutout } from "./cutout.mjs";
import { sync } from "./art-sync.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artDir = join(root, "art");
const force = process.argv.includes("--force");

const declaration = JSON.parse(readFileSync(join(artDir, "looks.json"), "utf8"));
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

/** The files a look produces. */
function outputsOf(look) {
  return look.frames ?? (look.file === undefined ? [] : [look.file]);
}

/** A look whose files are all present and newer than nothing to do. */
function installed(look) {
  const files = outputsOf(look);
  return files.length > 0 && files.every((file) => existsSync(join(artDir, file)));
}

let written = 0;
let skipped = 0;
let failed = 0;

for (const look of declaration.looks) {
  const outputs = outputsOf(look);
  console.log(`\n${look.id}  (${look.name})`);

  if (!force && installed(look) && look.sha256 === undefined) {
    console.log("  ok    already present");
    skipped += 1;
    continue;
  }

  let body;
  for (const url of look.urls) {
    console.log(`  try   ${url}`);
    body = await grab(url);
    if (body !== undefined) break;
  }
  if (body === undefined) {
    console.error("  FAIL  every source failed");
    failed += 1;
    continue;
  }

  const actual = sha256(body);
  if (look.sha256 === undefined) {
    console.log(`  note  no sha256 pinned; got ${actual}`);
  } else if (actual !== look.sha256) {
    console.log("  warn  source hash differs from the declaration");
    console.log(`        expected ${look.sha256}`);
    console.log(`        actual   ${actual}`);
    console.log("        the upstream file changed — update art/looks.json if this is intended");
  } else {
    console.log(`  ok    source verified (${String(Math.round(body.length / 1024))} KB)`);
  }

  if (look.cutout === undefined) {
    if (outputs.length !== 1) {
      console.error(`  FAIL  a look without cutout must declare exactly one file`);
      failed += 1;
      continue;
    }
    writeFileSync(join(artDir, outputs[0]), body);
    written += 1;
  } else {
    const mode = look.cutout === true ? "largest" : String(look.cutout);
    const work = mkdtempSync(join(tmpdir(), "dsh-mascot-fetch-"));
    try {
      const staged = join(work, `source${extname(outputs[0]) || ".png"}`);
      writeFileSync(staged, body);
      console.log(`  cut   removing the background (mode: ${mode}, needs Chromium)`);
      const size = cutout(staged, outputs.map((file) => join(artDir, file)), { mode });
      written += 1;
      console.log(`  ok    ${String(size.count)} frame(s), ${String(size.width)}x${String(size.height)}`);
    } catch (error) {
      console.error(`  FAIL  cutout: ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
      continue;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  if (look.sha256 === undefined) {
    console.log(`        pin this hash in art/looks.json: ${actual}`);
  }
  console.log(`        ${look.rights}`);
}

console.log(`\nfetch-art: ${String(written)} written, ${String(skipped)} already present, ${String(failed)} failed`);

if (written + skipped > 0) {
  console.log("");
  const index = sync();
  console.log(`art-sync: indexed ${String(index.looks.length)} look(s) across ${String(index.characters.length)} character(s)`);
  for (const miss of index.missing) {
    console.log(`  still missing: ${miss.id} (${miss.files.join(", ")})`);
  }
  console.log("\nThe artwork is official game art and stays out of git on purpose.");
  for (const look of declaration.looks) console.log(`  ${look.id}: ${look.rights}`);
  console.log("\nRestart DSH Desktop if this is the first time art/ has been populated.");
}

process.exit(failed === 0 ? 0 : 1);
