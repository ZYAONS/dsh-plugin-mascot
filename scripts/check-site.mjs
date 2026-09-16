#!/usr/bin/env node
/**
 * Self-check for the configuration console in `docs/`.
 *
 * The page is the one artefact in this repository nobody can unit-test by
 * importing it, so this drives it in a real browser instead and asserts what it
 * claims: that the catalogue loads, that the controls render, and that the YAML
 * it produces is the YAML the plugin's config surface actually accepts.
 *
 *   npm run check:site            # assert only
 *   npm run check:site -- --shot  # also write docs/site/preview.png
 *
 * On Pages the page is served over HTTP, where the catalogue fetch is ordinary.
 * Locally it is opened over `file:`, so Chromium needs
 * `--allow-file-access-from-files` for that same fetch to be allowed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { findChromium } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = join(root, "docs", "index.html");
const shot = process.argv.includes("--shot");

if (!existsSync(index)) {
  console.error("check-site: docs/index.html is missing");
  process.exit(1);
}

const chrome = findChromium();
const flags = ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=8000"];

let failures = 0;
const ok = (message) => console.log(`  ok  ${message}`);
const bad = (message) => {
  failures += 1;
  console.error(`  FAIL  ${message}`);
};

// ---- the page as served ----------------------------------------------------
const dom = execFileSync(chrome, [...flags, "--dump-dom", pathToFileURL(index).href], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const text = (pattern) => {
  const match = pattern.exec(dom);
  return match === null ? undefined : match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
};

const catalog = JSON.parse(readFileSync(join(root, "docs", "site", "catalog.json"), "utf8"));
ok(`catalogue loaded: ${String(catalog.characters.length)} characters, ${String(catalog.looks.length)} looks`);

const charactersMeta = text(/id="m-characters"[^>]*>([^<]*)</u);
const looksMeta = text(/id="m-looks"[^>]*>([^<]*)</u);
if (charactersMeta === String(catalog.characters.length)) ok(`the page reports ${String(charactersMeta)} characters`);
else bad(`the page reports ${String(charactersMeta)} characters, the catalogue has ${String(catalog.characters.length)}`);
if (looksMeta === String(catalog.looks.length)) ok(`the page reports ${String(looksMeta)} looks`);
else bad(`the page reports ${String(looksMeta)} looks, the catalogue has ${String(catalog.looks.length)}`);

const cards = (dom.match(/class="card"/gu) ?? []).length;
// One card per character plus one per look of the selected character.
const expectedCards = catalog.characters.length + catalog.looks.filter((look) => look.character === catalog.characters[0].id).length;
if (cards === expectedCards) ok(`${String(cards)} cards rendered (characters + the selected character's looks)`);
else bad(`rendered ${String(cards)} cards, expected ${String(expectedCards)}`);

// ---- the YAML it produces --------------------------------------------------
const yaml = text(/<pre id="output"[^>]*>([\s\S]*?)<\/pre>/u);
if (yaml === undefined || yaml.trim().length === 0) {
  bad("the output block is empty");
} else {
  ok(`output block present (${String(yaml.split("\n").length)} lines)`);
  const checks = [
    [/^- insert:$/mu, "an insert row opens the patch"],
    [/^ {4}- id: mascot$/mu, "the entry id is mascot"],
    [/^ {6}name: /mu, "the entry names a module"],
    [/^ {6}config:$/mu, "the entry carries a config block"],
    [/^ {8}character: [a-z]+$/mu, "a default character is written"],
    [/^ {8}look: [a-z0-9-]+$/mu, "a default look is written"],
    [/^ {8}looks:$/mu, "the look allowlist is written"],
    [/^ {8}skeleton: (true|false)$/mu, "the rig default is written"],
    [/^ {8}balance: (true|false)$/mu, "the balance default is written"],
  ];
  for (const [pattern, description] of checks) {
    if (pattern.test(yaml)) ok(`YAML: ${description}`);
    else bad(`YAML: missing ${description}`);
  }

  // Every id the page emits must exist in the catalogue, and every character id
  // it emits must be one the plugin knows. A typo here produces a patch that
  // mounts and then silently falls back to the first look.
  const characterId = /^ {8}character: (.+)$/mu.exec(yaml)?.[1]?.trim();
  const lookId = /^ {8}look: (.+)$/mu.exec(yaml)?.[1]?.trim();
  const listed = [...yaml.matchAll(/^ {10}- (.+)$/gmu)].map((match) => match[1].trim());
  if (catalog.characters.some((character) => character.id === characterId)) ok(`character id "${String(characterId)}" exists`);
  else bad(`character id "${String(characterId)}" is not in the catalogue`);
  if (catalog.looks.some((look) => look.id === lookId)) ok(`look id "${String(lookId)}" exists`);
  else bad(`look id "${String(lookId)}" is not in the catalogue`);
  const known = new Set(catalog.looks.map((look) => look.id));
  const unknown = listed.filter((id) => !known.has(id));
  if (unknown.length === 0) ok(`all ${String(listed.length)} allowlisted looks exist`);
  else bad(`allowlist names unknown looks: ${unknown.join(", ")}`);
  const wrongCharacter = listed.filter((id) => catalog.looks.find((look) => look.id === id)?.character !== characterId);
  if (wrongCharacter.length === 0) ok("every allowlisted look belongs to the selected character");
  else bad(`allowlist mixes characters: ${wrongCharacter.join(", ")}`);
}

// ---- the two page themes ---------------------------------------------------
// Rendered through the deep link rather than by driving clicks: a headless
// dump-dom pass per theme is deterministic, where scripted clicks would depend on
// the harness's own timing.
const themeOf = (query) => {
  const dom = execFileSync(chrome, [...flags, "--dump-dom", `${pathToFileURL(index).href}${query}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const match = /<html[^>]*data-theme="([a-z]+)"/u.exec(dom);
  return { theme: match === null ? undefined : match[1], dom };
};

const autoClosure = themeOf("?theme=auto&character=closure");
if (autoClosure.theme === "closure") ok("theme=auto with Closure selected resolves to the Closure theme");
else bad(`theme=auto with Closure selected gave "${String(autoClosure.theme)}"`);

const autoYuno = themeOf("?theme=auto&character=yuno");
if (autoYuno.theme === "yuno") ok("theme=auto with Yuno selected resolves to the Yuno theme");
else bad(`theme=auto with Yuno selected gave "${String(autoYuno.theme)}"`);

const pinned = themeOf("?theme=yuno&character=closure");
if (pinned.theme === "yuno") ok("a pinned theme outranks the selected character");
else bad(`pinning the Yuno theme with Closure selected gave "${String(pinned.theme)}"`);

if (autoClosure.theme !== autoYuno.theme) ok("the two characters resolve to two different themes");
else bad("both characters resolve to the same theme");

// The themes must differ in substance, not just in one colour: check the tokens
// each one sets on the root.
const css = readFileSync(join(root, "docs", "site", "site.css"), "utf8");
const tokensOf = (selector) => {
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "u").exec(css);
  if (block === null) return {};
  const tokens = {};
  for (const match of block[1].matchAll(/(--[a-z-]+):\s*([^;]+);/gu)) tokens[match[1]] = match[2].trim();
  return tokens;
};
const closureTheme = { ...tokensOf(":root"), ...tokensOf('\\[data-theme="closure"\\]') };
const yunoTheme = tokensOf('\\[data-theme="yuno"\\]');
for (const token of ["--signal", "--ink", "--panel", "--radius", "--tape-a", "--label-font"]) {
  if (closureTheme[token] === undefined || yunoTheme[token] === undefined) {
    bad(`theme token ${token} is not defined for both themes`);
  } else if (closureTheme[token] === yunoTheme[token]) {
    bad(`theme token ${token} is identical in both themes — that is a hue swap, not a theme`);
  } else {
    ok(`theme token ${token} differs (${closureTheme[token]} vs ${yunoTheme[token]})`);
  }
}
// The stage theme drops the console's corner brackets for a glow; if the rule is
// missing, the two themes would share their selection cue.
if (/\[data-theme="yuno"\]\s+\.card::before/u.test(css) && /\[data-theme="yuno"\]\s+\.card\[data-on="1"\]\s*\{\s*box-shadow/u.test(css)) {
  ok("the Yuno theme replaces the corner brackets with a glow");
} else {
  bad("the Yuno theme does not override the selection cue");
}

// ---- optional screenshot ---------------------------------------------------
if (shot) {
  for (const [name, query] of [["preview.png", "?theme=closure"], ["preview-yuno.png", "?theme=yuno"]]) {
    const png = join(root, "docs", "site", name);
    execFileSync(
      chrome,
      [...flags, "--force-device-scale-factor=1.4", `--screenshot=${png}`, "--window-size=1180,2000", `${pathToFileURL(index).href}${query}`],
      { stdio: "pipe" },
    );
    console.log(`  ok  wrote ${png} (${String(readFileSync(png).length)} bytes)`);
  }
}

console.log(failures === 0 ? "\ncheck-site: the console behaves as advertised" : `\ncheck-site: ${String(failures)} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
