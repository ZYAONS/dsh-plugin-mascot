#!/usr/bin/env node
/**
 * Publish the artwork next to the web console.
 *
 * The published console loads each look from the source URLs declared in
 * `art/looks.json`. That works, but only some of those hosts send a CORS header,
 * and a cross-origin image without one cannot be read into WebGL — so it displays
 * and cannot be deformed by the rig.
 *
 * Running this copies the artwork you already downloaded into `docs/art/`, which
 * puts it on the console's own origin. Everything then rigs and animates, and the
 * page stops depending on anyone else's server.
 *
 *   npm run art:publish -- --acknowledge
 *
 * It is opt-in, and deliberately not part of any other command, because it changes
 * what the repository can redistribute. The acknowledgement is not ceremony: it is
 * the difference between a command someone runs and a decision someone makes.
 * `npm test` refuses to pass if an image under `docs/art/` is ever tracked by git,
 * so the accident this guards against has a second line of defence.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "art");
const target = join(root, "docs", "art");

if (!process.argv.includes("--acknowledge")) {
  console.error("art:publish: refusing to run without an explicit acknowledgement.\n");
  console.error("  This copies official game artwork into the published web folder. The");
  console.error("  files stay on your machine unless you commit them, and committing them");
  console.error("  means this repository redistributes artwork owned by Hypergryph and");
  console.error("  Bushiroad, which GitHub Pages would then serve publicly.\n");
  console.error("  Bushiroad's terms for BanG Dream! permit individual, non-commercial");
  console.error("  derivative works that add creativity, and prohibit use that copies or");
  console.error("  imports the content without adding any:");
  console.error("  https://bang-dream.com/bdp-guideline/\n");
  console.error("  See COPYRIGHT.md. Re-run with the acknowledgement to proceed:\n");
  console.error("    npm run art:publish -- --acknowledge\n");
  process.exit(1);
}

let index;
try {
  index = JSON.parse(readFileSync(join(source, "index.json"), "utf8"));
} catch {
  console.error("art:publish: art/index.json is missing. Run `npm run fetch-art` first.");
  process.exit(1);
}

mkdirSync(target, { recursive: true });

const copied = [];
const missing = [];
for (const look of index.looks) {
  for (const frame of look.frames) {
    const from = join(source, frame.file);
    if (!existsSync(from)) {
      missing.push(frame.file);
      continue;
    }
    copyFileSync(from, join(target, frame.file));
    copied.push({ file: frame.file, bytes: statSync(from).size });
  }
}

const total = copied.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(`art:publish: copied ${String(copied.length)} file(s), ${(total / 1024 / 1024).toFixed(2)} MB, into docs/art/`);
if (missing.length > 0) {
  console.warn(`art:publish: ${String(missing.length)} frame(s) were not on disk: ${missing.join(", ")}`);
  console.warn("art:publish: run `npm run fetch-art` to download them, then publish again.");
}

writeFileSync(
  join(target, "README.md"),
  [
    "# Published artwork",
    "",
    "Copied here by `npm run art:publish` so the web console can rig and animate it.",
    "",
    "**This directory is not committed by default, and copying it in is a deliberate",
    "choice.** The files are official game artwork: Closure (可露希尔) © Hypergryph, from",
    "*Arknights*; Sengoku Yuno (千石由乃) © Bushiroad, from *BanG Dream!* / Mugendai MewType.",
    "Committing them means this repository redistributes that artwork, and GitHub Pages",
    "will serve it publicly. The project's default posture is the opposite — the",
    "artwork lives on your machine, fetched by `npm run fetch-art`, and never ships.",
    "",
    "Delete this directory and run `npm run build:site` to go back to loading each look",
    "from its declared source instead.",
    "",
  ].join("\n"),
);

console.log("art:publish: next, `npm run build:site` (it records which frames are local),");
console.log("art:publish: and `npm run check:site` to confirm the console rigs them.");
console.log("");
console.log("  ⚠  docs/art/ holds official game artwork. Committing it is a rights decision:");
console.log("     the repository would then redistribute Hypergryph / Bushiroad art, and");
console.log("     GitHub Pages would serve it publicly. Nothing leaves this machine unless");
console.log("     you commit it.");
