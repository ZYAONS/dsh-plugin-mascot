#!/usr/bin/env node
/**
 * Measure the artwork and write `art/index.json` — the file the plugin actually
 * reads at runtime.
 *
 * Everything the browser half used to hard-code is derived here instead:
 *
 *   - the alpha bounding box of each image, so a look is framed by what is
 *     actually drawn rather than by a number someone tuned by eye;
 *   - `sprite` and `face`, the width and offsets that put the figure (or just the
 *     head) into each of the two seats the plugin renders;
 *   - the accent colour, sampled from the figure's most saturated mid-tone, so a
 *     new look themes itself;
 *   - which looks exist at all, so dropping a file in is enough to offer it.
 *
 *   npm run art:sync            # one pass
 *   npm run art:sync -- --watch # re-sync whenever art/ changes
 *
 * Measuring needs a real browser (canvas), so this shares Chromium with the
 * preview and cutout scripts. The plugin does not need any of this at runtime —
 * it just fetches the generated index over the host route.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { findChromium } from "./chrome.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const artDir = join(root, "art");

/** Seat geometry, mirroring the CSS in lib/client.js. */
export const SEATS = Object.freeze({
  // .dsh-mascot-sprite inside the 106x176 dock button
  sprite: { width: 104, height: 172, fill: 0.99, headFraction: 1 },
  // .dsh-mascot-face inside the 38x50 panel portrait
  face: { width: 38, height: 50, fill: 0.99, headFraction: 0.46 },
});

/** Image extensions the sync will consider. */
const IMAGE_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg", ".gif"]);

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>measure</title></head><body><pre id="out"></pre>
<script>
const sources = __SOURCES__;
const out = document.getElementById("out");
Promise.all(sources.map((src) => new Promise((done) => {
  const img = new Image();
  img.onload = () => {
    try {
      const W = img.naturalWidth, H = img.naturalHeight;
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, W, H).data;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      // Hue histogram over saturated, mid-luminance pixels. Taking the single
      // most saturated pixel instead picks anti-aliasing artefacts and stray
      // highlights, which is how you end up with a pure #ff00ff accent.
      const HUES = 12;
      const buckets = Array.from({ length: HUES }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const a = px[i + 3];
          // 64 rather than 24: soft hair wisps and glow reach well below full
          // opacity, and cropping to faint anti-aliasing overstates the figure.
          if (a < 64) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (max === 0 || lum < 45 || lum > 235) continue;
          const sat = (max - min) / max;
          if (sat < 0.25) continue;
          let hue;
          if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
          else if (max === g) hue = (b - r) / (max - min) + 2;
          else hue = (r - g) / (max - min) + 4;
          const bucket = buckets[Math.floor((hue / 6) * HUES) % HUES];
          const weight = sat;
          bucket.weight += weight; bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
        }
      }
      if (x1 < 0) { done({ src, error: "fully transparent" }); return; }
      // Coarse silhouette profile: for each of PROFILE_ROWS horizontal bands, the
      // leftmost and rightmost opaque column, normalised to the bounding box. The
      // client rigs a skeleton from it -- the row where the figure pinches is the
      // neck, and that differs too much between a chibi and a full-body portrait
      // for a fixed fraction to work.
      const PROFILE_ROWS = 32;
      const profile = [];
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      for (let r = 0; r < PROFILE_ROWS; r++) {
        const ya = y0 + Math.floor((r * bh) / PROFILE_ROWS);
        const yb = Math.min(y1, y0 + Math.floor(((r + 1) * bh) / PROFILE_ROWS) - 1);
        let lo = -1, hi = -1;
        for (let y = ya; y <= yb; y++) {
          for (let x = x0; x <= x1; x++) {
            if (px[(y * W + x) * 4 + 3] < 64) continue;
            if (lo < 0 || x < lo) lo = x;
            if (x > hi) hi = x;
          }
        }
        profile.push(lo < 0 ? 0 : Math.round(((lo - x0) / bw) * 1000) / 1000);
        profile.push(lo < 0 ? 0 : Math.round(((hi - x0) / bw) * 1000) / 1000);
      }
      const dominant = buckets.reduce((best, bucket) => (bucket.weight > best.weight ? bucket : best), buckets[0]);
      const accent = dominant.weight === 0 ? null : [dominant.r / dominant.weight, dominant.g / dominant.weight, dominant.b / dominant.weight];
      done({ src, W, H, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, accent, profile });
    } catch (error) { done({ src, error: String(error && error.message ? error.message : error) }); }
  };
  img.onerror = () => done({ src, error: "load failed" });
  img.src = src;
}))).then((results) => { out.id = "done"; out.textContent = JSON.stringify(results); });
</script></body></html>`;

/** Read one image's measurements through the browser. */
function measure(sources, chromium) {
  const work = mkdtempSync(join(tmpdir(), "dsh-mascot-measure-"));
  try {
    const page = join(work, "measure.html");
    writeFileSync(page, PAGE.replace("__SOURCES__", JSON.stringify(sources.map((source) => pathToFileURL(resolve(source)).href))));
    const dom = execFileSync(
      chromium,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=60000", "--dump-dom", pathToFileURL(page).href],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const match = /<pre id="done">([\s\S]*?)<\/pre>/u.exec(dom);
    if (match === null) throw new Error("the measure page reported nothing");
    return JSON.parse(match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** `#rrggbb` from a sampled `[r,g,b]`. */
function hex(rgb) {
  if (rgb === null || rgb === undefined) return undefined;
  return `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

/** Perceived luminance, for deciding whether a sampled colour is usable as-is. */
function luminance(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * Make a sampled colour usable as an accent on a near-black panel: keep the hue,
 * lift anything too dark to read and pull down anything that would glare.
 */
function usable(rgb) {
  if (rgb === null || rgb === undefined) return undefined;
  let [r, g, b] = rgb;
  const lum = luminance([r, g, b]);
  const target = 150;
  if (lum < 60 || lum > 215) {
    const scale = target / Math.max(1, lum);
    r = Math.min(255, r * scale);
    g = Math.min(255, g * scale);
    b = Math.min(255, b * scale);
  }
  return hex([r, g, b]);
}

/**
 * Frame one figure's bounding box into one seat.
 *
 * `scale` is passed in rather than derived, because every frame of one look must
 * share it: deriving per frame would rescale a narrow side-on pose up to fill the
 * seat and make the character appear to grow as the look animates.
 *
 * @param box - the frame's measurement (already cropped tight, so x0/y0 are 0).
 * @param seat - target geometry, including `headFraction` for the portrait.
 * @param scale - shared pixels-per-source-pixel for this look and seat.
 */
function frameSeat(box, seat, scale) {
  const height = box.h * seat.headFraction;
  return {
    width: Math.round(box.W * scale),
    left: Math.round((seat.width - box.w * scale) / 2),
    top: Math.round((seat.height - height * scale) / 2),
  };
}

/**
 * The scale that fits the largest frame of a look into a seat. Small frames then
 * sit centred inside the same window instead of being blown up to match.
 */
function sharedScale(boxes, seat) {
  const widest = Math.max(...boxes.map((box) => box.w));
  const tallest = Math.max(...boxes.map((box) => box.h * seat.headFraction));
  return Math.min((seat.width * seat.fill) / widest, (seat.height * seat.fill) / tallest);
}

/**
 * Build the runtime index from `art/looks.json` plus what is on disk.
 *
 * @param options - `chromium` overrides binary discovery.
 * @returns the index object, and the list of looks that are not installed yet.
 */
export function buildIndex(options = {}) {
  const declaration = JSON.parse(readFileSync(join(artDir, "looks.json"), "utf8"));
  const chromium = options.chromium ?? findChromium();

  const looks = [];
  const missing = [];
  /** Cells to measure, flattened so one browser pass covers every look. */
  const jobs = [];

  for (const look of declaration.looks) {
    const files = look.frames ?? (look.file === undefined ? [] : [look.file]);
    const present = files.filter((file) => existsSync(join(artDir, file)));
    if (present.length !== files.length) {
      missing.push({ id: look.id, files: files.filter((file) => !existsSync(join(artDir, file))) });
      continue;
    }
    present.forEach((file, index) => jobs.push({ look: look.id, file, index }));
  }

  const measured = jobs.length === 0 ? [] : measure(jobs.map((job) => join(artDir, job.file)), chromium);
  const byJob = new Map();
  measured.forEach((result, index) => {
    const job = jobs[index];
    if (job === undefined) return;
    byJob.set(`${job.look}#${String(job.index)}`, result);
  });

  for (const look of declaration.looks) {
    const files = look.frames ?? (look.file === undefined ? [] : [look.file]);
    if (files.some((file) => !existsSync(join(artDir, file)))) continue;
    const boxes = files.map((_, index) => byJob.get(`${look.id}#${String(index)}`));
    const failed = boxes.find((box) => box === undefined || box.error !== undefined);
    if (failed !== undefined) {
      missing.push({ id: look.id, files: [failed?.error ?? "unmeasurable"] });
      continue;
    }
    const character = declaration.characters.find((entry) => entry.id === look.character);
    // One shared scale per seat across the look's frames, so animating between
    // poses moves the character rather than resizing her.
    const scale = {
      sprite: sharedScale(boxes, SEATS.sprite),
      face: sharedScale(boxes, SEATS.face),
    };
    looks.push({
      id: look.id,
      character: look.character,
      name: look.name,
      animated: files.length > 1,
      frames: files.map((file, index) => ({
        file,
        seat: {
          sprite: frameSeat(boxes[index], SEATS.sprite, scale.sprite),
          face: frameSeat(boxes[index], SEATS.face, scale.face),
        },
        measured: { width: boxes[index].W, height: boxes[index].H, box: [boxes[index].x0, boxes[index].y0, boxes[index].w, boxes[index].h] },
        // Drives the client's automatic rig; absent when an older index is read.
        profile: boxes[index].profile ?? null,
      })),
      // The first frame doubles as the look's identity: it is what a static
      // context (a thumbnail, a switcher chip) renders.
      seat: {
        sprite: frameSeat(boxes[0], SEATS.sprite, scale.sprite),
        face: frameSeat(boxes[0], SEATS.face, scale.face),
      },
      accent: usable(boxes.find((box) => box.accent !== null && box.accent !== undefined)?.accent ?? null),
      rights: look.rights,
      theme: character?.theme,
    });
  }

  const characters = declaration.characters
    .map((character) => ({
      ...character,
      looks: looks.filter((look) => look.character === character.id).map((look) => look.id),
    }))
    .filter((character) => character.looks.length > 0);

  return {
    // No timestamp: index.json is committed next to looks.json, and a field that
    // changes on every run would make it churn in git for no information.
    seats: SEATS,
    characters,
    looks,
    missing,
  };
}

/** One sync pass; returns the index that was written. */
export function sync(options = {}) {
  const index = buildIndex(options);
  writeFileSync(join(artDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

/** Every art file's mtime, for the watch loop's change detection. */
function fingerprint() {
  return readdirSync(artDir)
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) || name === "looks.json")
    .sort()
    .map((name) => `${name}:${String(statSync(join(artDir, name)).mtimeMs)}`)
    .join("|");
}

/** Human summary of one sync result. */
function report(index) {
  console.log(`art-sync: ${String(index.looks.length)} look(s) indexed`);
  for (const character of index.characters) {
    console.log(`  ${character.name} (${character.id}) — theme ${String(character.theme)}`);
    for (const id of character.looks) {
      const look = index.looks.find((entry) => entry.id === id);
      const files = look.frames.map((frame) => frame.file).join(", ");
      console.log(`    ${look.id.padEnd(18)} ${look.name.padEnd(10)} ${files}${look.animated ? "  [animated]" : ""}  accent ${String(look.accent)}`);
    }
  }
  for (const miss of index.missing) {
    console.log(`  not installed: ${miss.id} (${miss.files.join(", ")}) — run \`npm run fetch-art\``);
  }
  console.log(`  wrote ${join("art", "index.json")}`);
}

/** CLI entry. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  mkdirSync(artDir, { recursive: true });
  const watch = process.argv.includes("--watch");
  report(sync());
  if (!watch) process.exit(0);

  console.log("art-sync: watching art/ — drop an image in and it is picked up on the next page refresh");
  let last = fingerprint();
  setInterval(() => {
    const now = fingerprint();
    if (now === last) return;
    last = now;
    try {
      report(sync());
    } catch (error) {
      console.error(`art-sync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 1500);
}
