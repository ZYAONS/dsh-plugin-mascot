#!/usr/bin/env node
/**
 * Regenerate the inlined artwork inside `lib/client.js` from `assets/*.svg`.
 *
 * The browser half ships as a single loadable bundle, so the two mascots travel
 * as SVG source strings inside it. `assets/` stays the editable source of truth
 * (and the thing GitHub renders in the README); this script is what keeps the
 * two from drifting.
 *
 *   node scripts/sync-art.mjs           # rewrite lib/client.js
 *   node scripts/sync-art.mjs --check   # exit 1 when lib/client.js is stale
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(root, "lib", "client.js");
const checkOnly = process.argv.includes("--check");

/**
 * Escape SVG source so it survives inside a JavaScript template literal.
 * @param {string} svg - raw SVG source.
 * @returns {string} a template-literal-safe body.
 */
function literal(svg) {
  return svg
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("${", "\\${")
    .trim();
}

/** Read one asset and shape it as the replacement for its placeholder. */
function replacement(file) {
  const svg = readFileSync(join(root, "assets", file), "utf8");
  return `\`${literal(svg)}\``;
}

const source = readFileSync(TARGET, "utf8");
const next = source
  .replace(/const CLOSURE_SVG = .*?;\n/s, `const CLOSURE_SVG = ${replacement("closure.svg")};\n`)
  .replace(/const YUNO_SVG = .*?;\n/s, `const YUNO_SVG = ${replacement("yuno.svg")};\n`);

if (next === source) {
  console.log("sync-art: lib/client.js already matches assets/");
  process.exit(0);
}

if (checkOnly) {
  console.error("sync-art: lib/client.js is stale — run `npm run sync-art`");
  process.exit(1);
}

writeFileSync(TARGET, next);
console.log("sync-art: rewrote lib/client.js from assets/closure.svg + assets/yuno.svg");
