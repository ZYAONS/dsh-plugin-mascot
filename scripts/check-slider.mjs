/**
 * Guards for the vendored `dsh-effort-slider` plugin.
 *
 * Two things can rot here without any obvious symptom:
 *
 * ① **The artifact goes stale.** `effort-slider.css` is not loaded at runtime — `build.mjs`
 *    inlines it into `lib/client.js` as a string. Editing the CSS and forgetting the build
 *    leaves a plugin that looks fine in the editor and renders the old colours. This check
 *    rebuilds into a copy and compares hashes, so a stale artifact fails instead of shipping.
 *    It restores the original bytes afterwards: a check must not silently fix what it reports.
 *
 * ② **The Rhodes Island recolour leaks.** The upstream palette was cool white / periwinkle /
 *    mint (73 hex + 144 rgba literals across four skins). The recolour maps all of it onto
 *    `#37e0d8` plus the `rgba(24,32,42) -> rgba(11,15,21)` surface, and the only reason it can
 *    be trusted is that *every* colour gets classified, so a leftover periwinkle has nowhere
 *    to hide. Whites are deliberately exempt: `#fff` is 0-saturation, and the panel's glass
 *    highlights *should* stay white while the knob's bead should not — that distinction lives
 *    in an appended override block, not in the literal map.
 *
 * Upstream's own suite runs here too. It covers the parts a palette check cannot see: the
 * host half, the turbo/ultra level contract, the fluid canvas and the client lifecycle.
 *
 *   node scripts/check-slider.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const plugin = join(here, "..", "dsh-effort-slider");

const problems = [];
const report = (ok, line) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${line}`);
  if (!ok) problems.push(line);
};

// ── ① artifact freshness ────────────────────────────────────────────────────
{
  const artifact = join(plugin, "lib", "client.js");
  const before = readFileSync(artifact);
  const hash = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

  execFileSync(process.execPath, ["build.mjs"], { cwd: plugin, stdio: "pipe" });
  const after = readFileSync(artifact);
  const same = hash(before) === hash(after);

  if (!same) writeFileSync(artifact, before); // a check restores what it changed
  report(
    same,
    same
      ? `lib/client.js is up to date with effort-slider.css (${hash(before)})`
      : "lib/client.js was stale — effort-slider.css changed without a rebuild; run `node build.mjs`"
  );
}

// ── ② palette ──────────────────────────────────────────────────────────────
// Colours that belong to the Rhodes Island palette and must not be reported.
const PALETTE = new Set([
  "#e4edf4", // text
  "#eafaf7", "#d8fbf7", "#eafdfb", // pale cyan text / glows
]);

// Semantic colours kept on purpose; a hue sweep would otherwise flag them.
const SEMANTIC = new Set([
  "#e43c3c", // the fallback for var(--dsw-alias-state-error-primary)
]);

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/**
 * A colour is fine if it is cyan, a Rhodes-dark blue-black, a near-neutral, or explicitly
 * whitelisted. Anything else with visible chroma is a leftover from the old palette.
 *
 * The `l < 0.25` guard on the blue-black branch matters: `rgb(4,8,12)` has saturation 0.5,
 * because saturation is scale-free. Without the lightness test every shadow reads as violet.
 */
function classify({ h, s, l, hex }) {
  if (PALETTE.has(hex)) return "palette";
  if (SEMANTIC.has(hex)) return "semantic";
  if (s < 0.1) return "neutral";
  if (h >= 150 && h <= 200) return "cyan";
  if (h >= 195 && h <= 235 && l < 0.25) return "dark";
  return "suspect";
}

// Comments cannot paint; scanning them invents failures (one old comment quotes a colour
// that was deleted from the rules years ago).
function stripComments(text, js) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  if (js) out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  return out;
}

function colours(text) {
  const found = new Map();
  const add = (r, g, b, raw) => {
    const key = `${r},${g},${b}`;
    const entry = found.get(key) ?? { rgb: [r, g, b], count: 0, raw: new Set() };
    entry.count++;
    entry.raw.add(raw);
    found.set(key, entry);
  };

  for (const m of text.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    let v = m[1];
    if (v.length === 3) v = v.split("").map((c) => c + c).join("");
    add(parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), m[0]);
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    add(+m[1], +m[2], +m[3], `${m[0]},…`);
  }

  return [...found.values()].map((entry) => {
    const [r, g, b] = entry.rgb;
    const hex = "#" + entry.rgb.map((x) => x.toString(16).padStart(2, "0")).join("");
    return { ...entry, hex, ...hsl(r, g, b) };
  });
}

for (const [label, file, js] of [
  ["effort-slider.css", join(plugin, "effort-slider.css"), false],
  ["client.js", join(plugin, "client.js"), true],
]) {
  if (!existsSync(file)) {
    report(false, `${label} is missing`);
    continue;
  }
  const list = colours(stripComments(readFileSync(file, "utf8"), js));
  const leftovers = list.filter((c) => classify(c) === "suspect");
  const accent = list.find((c) => c.hex === "#37e0d8");

  report(
    leftovers.length === 0,
    leftovers.length === 0
      ? `${label}: ${list.length} colours, all Rhodes Island`
      : `${label}: ${leftovers.length} colour(s) left over from the old palette — ` +
        leftovers
          .map((c) => `${c.raw.values().next().value} (hsl ${c.h.toFixed(0)}° ${(c.s * 100).toFixed(0)}%)`)
          .join(", ")
  );
  report(
    accent !== undefined,
    accent === undefined
      ? `${label}: the accent #37e0d8 never appears — is this still the Rhodes theme?`
      : `${label}: accent #37e0d8 appears ${accent.count}×`
  );
}

// ── ③ upstream's own suite ─────────────────────────────────────────────────
const SUITE = [
  "smoke-test.mjs",
  "test/metrics.test.mjs",
  "test/turbo.test.mjs",
  "test/host.test.mjs",
  "test/fluid.test.mjs",
  "test/client-lifecycle.test.mjs",
];

for (const file of SUITE) {
  let output = "";
  let ok = true;
  try {
    output = execFileSync(process.execPath, [file], { cwd: plugin, encoding: "utf8" });
  } catch (error) {
    ok = false;
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  // Two output dialects: the hand-rolled scripts print one `ok …` line per assertion, while
  // `client-lifecycle.test.mjs` runs under node:test and reports `ℹ pass N` / `# pass N`.
  // Counting only `ok` lines made that file look like it asserted nothing.
  const okLines = (output.match(/^\s*ok\s/gm) ?? []).length;
  const tapPass = /(?:^|\n)\s*(?:#|ℹ)\s*pass (\d+)/.exec(output);
  const count = okLines + (tapPass ? Number(tapPass[1]) : 0);

  report(ok && count > 0, `${file} — ${count} assertions${ok ? "" : " (failed)"}`);
  if (!ok) console.log(output.split("\n").slice(-12).join("\n"));
}

console.log(problems.length === 0 ? "\nAll slider checks passed." : `\n${problems.length} slider check(s) failed.`);
process.exitCode = problems.length === 0 ? 0 : 1;
