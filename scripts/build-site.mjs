#!/usr/bin/env node
/**
 * Generate the public catalogue the web page reads.
 *
 * GitHub Pages serves `docs/` as the site root, so the page cannot reach
 * `../art/looks.json`. Rather than duplicate the declaration into the page — two
 * copies that would drift — this writes the public subset of it into the site
 * folder, and the page fetches that.
 *
 *   npm run build:site
 *
 * Only fields that are safe and useful in public are copied: identities, names in
 * both languages, the theme key and whether a look animates. Rights lines and
 * source URLs stay in the repository.
 *
 * The English wording (`nameEn`, `roleEn`, `taglineEn`) lives in the same
 * declaration rather than in the page, so a look added for the plugin gets an
 * English name in the console by editing one file — and a missing translation
 * falls back to the plugin's own copy instead of rendering `undefined`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const declaration = JSON.parse(readFileSync(join(root, "art", "looks.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/**
 * The generated art index, when it exists, carries the framing and the measured
 * silhouette for every look — everything the preview needs except the pixels.
 * Those come either from a local copy under `docs/art/` (opt in with
 * `npm run art:publish`) or from the sources declared in `looks.json`.
 */
let indexed = { looks: [] };
try {
  indexed = JSON.parse(readFileSync(join(root, "art", "index.json"), "utf8"));
} catch {
  /* no index yet — the page falls back to the declaration's own frame lists */
}

const animated = new Set(indexed.looks.filter((look) => look.animated).map((look) => look.id));
const published = join(root, "docs", "art");

/**
 * Whether a path is part of the repository.
 *
 * The catalogue is committed and baked, but `docs/art/` is ignored by default, so
 * the two can disagree: a developer who published the artwork locally would build a
 * catalogue promising files GitHub Pages does not have, and the deployed page would
 * 404 on every look. Advertising a local copy only when it is actually tracked makes
 * that impossible.
 */
function trackedInGit(relative) {
  try {
    return execFileSync("git", ["ls-files", "--", relative], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().length > 0;
  } catch {
    return false;
  }
}

const publishingArt = trackedInGit("docs/art");

/** One frame as the browser needs it: where it is, and how to place and rig it. */
/**
 * Crop rectangles, when `fetch-art` had to cut figures out of a larger download.
 * The console hotlinks that download, so this is what maps a frame onto it.
 */
let crops = {};
try {
  crops = JSON.parse(readFileSync(join(root, "art", "crops.json"), "utf8"));
} catch {
  /* nothing was cut out, or the file predates this */
}

function frameOf(look, frame) {
  const cut = crops[look.id]?.frames?.find((entry) => entry.file === frame.file);
  return {
    file: frame.file,
    seat: frame.seat,
    box: frame.measured?.box ?? null,
    profile: frame.profile ?? null,
    // The character alone, without free-floating props, and the eye boxes as fractions
    // of it. The console needs both in order to blink: the anatomy comes from the
    // official rig, and these are where that anatomy lands on this particular artwork.
    body: frame.body ?? null,
    eyes: frame.eyes ?? null,
    // Shown as a picture rather than rigged.
    still: frame.still === true,
    arms: frame.arms ?? null,
    skin: frame.skin ?? null,
    eyesFrom: frame.eyesFrom ?? null,
    // Where this frame sits inside the file the console will actually download.
    crop: cut === undefined ? null : { x: cut.x, y: cut.y, width: cut.width, height: cut.height },
    // True only when the copy beside the console is committed, so the page never
    // reaches for a file the deployment does not serve.
    local: publishingArt && existsSync(join(published, frame.file)),
  };
}

const catalog = {
  version: manifest.version,
  repository: "https://github.com/ZYAONS/dsh-plugin-mascot",
  characters: declaration.characters.map((character) => ({
    id: character.id,
    name: character.name,
    nameEn: character.latin,
    latin: character.latin,
    role: character.role,
    roleEn: character.roleEn ?? character.role,
    tagline: character.tagline,
    taglineEn: character.taglineEn ?? character.tagline,
    theme: character.theme,
    looks: declaration.looks
      .filter((look) => look.character === character.id)
      .map((look) => look.id),
  })),
  looks: declaration.looks.map((look) => {
    const generated = indexed.looks.find((entry) => entry.id === look.id);
    const frames = (generated?.frames ?? look.frames?.map((file) => ({ file })) ?? [])
      .map((frame) => frameOf(look, frame));
    return {
      id: look.id,
      character: look.character,
      name: look.name,
      nameEn: look.nameEn ?? look.name,
      animated: animated.has(look.id) || frames.length > 1,
      accent: generated?.accent,
      // Where the pixels live. The repository carries none of them, so the page
      // reads them from here — and a local copy, when the operator has published
      // one, is preferred because only a same-origin image can be rigged.
      sources: look.urls ?? [],
      // Whether those hosts send CORS. Declared in looks.json from a measurement,
      // so the page does not ask for a header that is not there: that request fails
      // and leaves an error in the console of a page working exactly as intended.
      cors: look.cors !== false,
      frames,
    };
  }),
};

const target = join(root, "docs", "site", "catalog.json");
writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`build-site: wrote ${target} (${String(catalog.characters.length)} characters, ${String(catalog.looks.length)} looks)`);

//#region rig extraction
/**
 * Lift the rig out of the plugin's browser bundle.
 *
 * The console previews the mascot with the very same skeleton the plugin runs, and
 * the plugin's half is a single file by necessity (the browser module loader takes
 * one registration per package). Rather than keep a second copy of the geometry,
 * this copies the regions verbatim — the same "generate from one source" move as
 * `catalog.json`, and `check-site` fails when the copy goes stale.
 *
 * The three regions are self-contained: they reference each other, `document` and
 * `Math`, and nothing from the surrounding closure.
 */
function region(source, name) {
  const start = source.indexOf(`//#region ${name}\n`);
  if (start < 0) throw new Error(`build-site: lib/client.js has no #region ${name}`);
  const end = source.indexOf("//#endregion", start);
  if (end < 0) throw new Error(`build-site: #region ${name} is never closed`);
  return source
    .slice(start, end)
    .split("\n")
    .map((line) => (line.startsWith("\t\t") ? line.slice(2) : line))
    .join("\n")
    .trimEnd();
}

const client = readFileSync(join(root, "lib", "client.js"), "utf8");
const rigModule = [
  "/**",
  " * The skeleton: automatic rigging, linear blend skinning and idle posing.",
  " *",
  " * GENERATED by scripts/build-site.mjs from the #region blocks of lib/client.js.",
  " * Do not edit here — edit the plugin and run `npm run build:site`.",
  " */",
  "",
  region(client, "skeleton"),
  "",
  region(client, "skinning"),
  "",
  region(client, "pose"),
  "",
  "",
  region(client, "voice"),
  "",
  "/** Why the last rig attempt was abandoned, or null when it never was. */",
  "function rigStatus() {",
  "  return lastRigError ?? null;",
  "}",
  "",
  "export { RIG, findNeck, buildRig, createSkinner, poseRig, speakLine, setVoiceUrls, voiceStatus, rigStatus };",
  "",
].join("\n");
const rigTarget = join(root, "docs", "site", "rig.js");
writeFileSync(rigTarget, rigModule);
console.log(`build-site: wrote ${rigTarget} (${String(rigModule.length)} bytes, extracted from lib/client.js)`);
//#endregion

