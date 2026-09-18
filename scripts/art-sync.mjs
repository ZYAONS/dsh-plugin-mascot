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

/**
 * Eye boxes measured per artwork file, filled in by buildIndex.
 *
 * Module level because two worlds need it: buildIndex reads the file, and measure() runs
 * the browser page that applies them.
 */
let eyesForLook = {};
/**
 * Artwork files whose eye boxes are good enough to *warp* with.
 *
 * A stricter thing than "roughly where the eye is". A blink collapses everything
 * inside the box onto the lid line, so a box a third of an eye off does not close
 * the eye — it drags the fringe down over it. The boxes in `art/eyes.json` were
 * measured for an earlier, abandoned blink and several of them sit beside the eye
 * rather than on it, so the blink is opt-in per file and `art/eyes.json`'s `blink`
 * list names the ones that have been checked against the artwork.
 */
let blinkableFiles = new Set();

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
  const ANATOMY = __ANATOMY__;
  const EYES_BY_FILE = __EYES__;
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
      // ---- eyes --------------------------------------------------------------
      // The neck, by the same rule the client uses: the narrowest band in the upper
      // part of the figure, and only if it is a real pinch. Everything above it is
      // the head, which is the only region worth searching for a face.
      const bandWidth = (r) => profile[r * 2 + 1] - profile[r * 2];
      const firstRow = Math.max(1, Math.floor(PROFILE_ROWS * 0.08));
      const lastRow = Math.min(PROFILE_ROWS - 2, Math.ceil(PROFILE_ROWS * 0.55));
      let neckRow = -1, neckWidth = Infinity;
      for (let r = firstRow; r <= lastRow; r++) {
        if (profile[r * 2 + 1] <= profile[r * 2]) continue;
        if (bandWidth(r) < neckWidth) { neckWidth = bandWidth(r); neckRow = r; }
      }
      // A neck is a pinch, not merely the narrowest band: the crown of a head is
      // narrower than any neck and sits inside the search window. Same test the
      // client's findNeck applies, so the two agree on where the head ends.
      if (neckRow >= 0) {
        let above = 0, below = 0;
        for (let r = 1; r < PROFILE_ROWS; r++) {
          if (profile[r * 2 + 1] <= profile[r * 2]) continue;
          if (r < neckRow) above = Math.max(above, bandWidth(r));
          if (r > neckRow) below = Math.max(below, bandWidth(r));
        }
        if (!(neckWidth < above * 0.82 && neckWidth < below * 0.9)) neckRow = -1;
      }
      const headBottom = neckRow < 0 ? y0 + Math.floor(bh * 0.45) : y0 + Math.floor(((neckRow + 1) * bh) / PROFILE_ROWS);

      // The body on its own: the largest connected opaque region. A prop that floats
      // free of the character — Closure's drone sits apart from her in the corner —
      // stretches the overall box, and every anatomical length is a fraction of the
      // body, so the body has to be measured separately or the fractions are wrong.
      const bodyStep = Math.max(1, Math.round(Math.max(W, H) / 420));
      const bodyCols = Math.ceil(W / bodyStep);
      const bodyRows = Math.ceil(H / bodyStep);
      const bodyMask = new Uint8Array(bodyCols * bodyRows);
      for (let r = 0; r < bodyRows; r++) {
        for (let c = 0; c < bodyCols; c++) {
          const i = (Math.min(H - 1, r * bodyStep) * W + Math.min(W - 1, c * bodyStep)) * 4;
          if (px[i + 3] > 200) bodyMask[r * bodyCols + c] = 1;
        }
      }
      let body = null;
      {
        const seen = new Uint8Array(bodyCols * bodyRows);
        let best = 0;
        for (let s = 0; s < bodyMask.length; s++) {
          if (bodyMask[s] === 0 || seen[s] === 1) continue;
          seen[s] = 1;
          const stack = [s];
          let n = 0;
          let ax = bodyCols;
          let ay = bodyRows;
          let bx = -1;
          let by = -1;
          while (stack.length > 0) {
            const i = stack.pop();
            n += 1;
            const c = i % bodyCols;
            const r = (i - c) / bodyCols;
            if (c < ax) ax = c;
            if (c > bx) bx = c;
            if (r < ay) ay = r;
            if (r > by) by = r;
            const push = (j) => { if (j >= 0 && seen[j] === 0 && bodyMask[j] === 1) { seen[j] = 1; stack.push(j); } };
            if (c > 0) push(i - 1);
            if (c < bodyCols - 1) push(i + 1);
            if (r > 0) push(i - bodyCols);
            if (r < bodyRows - 1) push(i + bodyCols);
          }
          if (n > best) {
            best = n;
            body = { x: ax * bodyStep, y: ay * bodyStep, w: (bx - ax + 1) * bodyStep, h: (by - ay + 1) * bodyStep };
          }
        }
      }

      // Where the official rig says the eyes are, as a fraction of the body. It is a
      // prior, not an answer: a different art style draws a different head, and on
      // Closure's own chibi the prediction sits about 7% of the body too high. What it
      // is good for is shrinking the search enough that the wrong skin region — a pale
      // coat, which is what actually broke this — cannot be chosen.
      const anatomy = ANATOMY;
      const eyePrior = anatomy === null || body === null
        ? null
        : {
          x: body.x + body.w / 2,
          y: body.y + body.h - anatomy.eyes.y * body.h,
          radius: body.h * 0.22,
        };

      const findEyes = () => {
        const step = Math.max(1, Math.round(Math.min(bw, headBottom - y0) / 220));
        const cols = Math.ceil(bw / step), rowsN = Math.ceil((headBottom - y0) / step);
        const lum = new Float32Array(cols * rowsN);
        const sat = new Float32Array(cols * rowsN);
        const opaque = new Uint8Array(cols * rowsN);
        for (let r = 0; r < rowsN; r++) {
          for (let c = 0; c < cols; c++) {
            const x = x0 + c * step, y = y0 + r * step, i = (y * W + x) * 4;
            const R = px[i], G = px[i + 1], B = px[i + 2], A = px[i + 3];
            const k = r * cols + c;
            if (A < 200) { lum[k] = -1; continue; }
            opaque[k] = 1;
            const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            lum[k] = 0.2126 * R + 0.7152 * G + 0.0722 * B;
            sat[k] = mx === 0 ? 0 : (mx - mn) / mx;
          }
        }
        const blobsOf = (mask) => {
          const seen = new Uint8Array(cols * rowsN);
          const found = [];
          for (let s = 0; s < mask.length; s++) {
            if (mask[s] === 0 || seen[s] === 1) continue;
            seen[s] = 1;
            const stack = [s], cells = [];
            while (stack.length > 0) {
              const i = stack.pop();
              cells.push(i);
              const c = i % cols, r = (i - c) / cols;
              const push = (j) => { if (j >= 0 && seen[j] === 0 && mask[j] === 1) { seen[j] = 1; stack.push(j); } };
              if (c > 0) push(i - 1);
              if (c < cols - 1) push(i + 1);
              if (r > 0) push(i - cols);
              if (r < rowsN - 1) push(i + cols);
            }
            let ax = cols, ay = rowsN, bx = -1, by = -1;
            for (const i of cells) {
              const c = i % cols, r = (i - c) / cols;
              if (c < ax) ax = c; if (c > bx) bx = c;
              if (r < ay) ay = r; if (r > by) by = r;
            }
            found.push({ n: cells.length, x: ax * step, y: ay * step, w: (bx - ax + 1) * step, h: (by - ay + 1) * step });
          }
          return found.sort((a, b) => b.n - a.n);
        };

        // The face is bright and not colourful: anime skin is pale and low in
        // saturation, whatever the character's palette is.
        const isSkin = (i) => opaque[i] === 1 && lum[i] > 165 && sat[i] < 0.42;
        const skinMask = new Uint8Array(cols * rowsN);
        for (let i = 0; i < skinMask.length; i++) skinMask[i] = isSkin(i) ? 1 : 0;
        const skinBlobs = blobsOf(skinMask);
        if (skinBlobs.length === 0) return null;
        // Ranked, not chosen. Taking the single blob nearest the prior turned out worse
        // than taking the largest: a sliver of skin can sit right where the prediction
        // is and hold no eyes at all, and then the measurement returns nothing for the
        // whole look. Every candidate now gets a turn, prior-nearest first, with area
        // breaking the tie.
        const ranked = eyePrior === null
          ? skinBlobs
          : [...skinBlobs].sort((a, b) => {
            const da = Math.hypot(x0 + a.x + a.w / 2 - eyePrior.x, y0 + a.y + a.h / 2 - eyePrior.y) / eyePrior.radius;
            const db = Math.hypot(x0 + b.x + b.w / 2 - eyePrior.x, y0 + b.y + b.h / 2 - eyePrior.y) / eyePrior.radius;
            return (da - Math.min(3, b.n / 4000)) - (db - Math.min(3, a.n / 4000));
          });

        /** The eye pair inside one candidate face, or null when it holds none. */
        const eyesInFace = (face) => {
        // Everything inside the face that is not skin: eyes, brows, mouth.
        const marks = new Uint8Array(cols * rowsN);
        const fx0 = Math.max(0, Math.floor(face.x / step)), fx1 = Math.min(cols, Math.ceil((face.x + face.w) / step));
        const fy0 = Math.max(0, Math.floor(face.y / step)), fy1 = Math.min(rowsN, Math.ceil((face.y + face.h) / step));
        for (let r = fy0; r < fy1; r++) {
          for (let c = fx0; c < fx1; c++) {
            const i = r * cols + c;
            if (opaque[i] === 1 && isSkin(i) === false) marks[i] = 1;
          }
        }
        const candidates = blobsOf(marks)
          .filter((b) => b.n > face.n * 0.004 && b.n < face.n * 0.35)
          .map((b) => ({
            ...b,
            fx: (b.x + b.w / 2 - face.x) / face.w,
            fy: (b.y + b.h / 2 - face.y) / face.h,
          }))
          // Below the fringe and above the chin: the band an eye can be in.
          .filter((b) => b.fy > 0.4 && b.fy < 0.95)
          .slice(0, 8);

        // The pair that best mirrors itself about the face's centre line.
        let best = null, bestScore = Infinity;
        for (let i = 0; i < candidates.length; i++) {
          for (let j = i + 1; j < candidates.length; j++) {
            const a = candidates[i], b = candidates[j];
            if (a.fx > b.fx) continue;
            const balance = Math.abs(a.fx + b.fx - 1);
            const size = Math.max(a.n, b.n) / Math.min(a.n, b.n);
            const height = Math.abs(a.fy - b.fy);
            const gap = b.fx - a.fx;
            if (gap < 0.2 || balance > 0.35 || size > 2.6 || height > 0.22) continue;
            const score = balance + height + (size - 1) * 0.2;
            if (score < bestScore) { bestScore = score; best = [a, b]; }
          }
        }
        return best;
        };

        for (const face of ranked.slice(0, 4)) {
          const pair = eyesInFace(face);
          if (pair !== null) return pair;
        }
        return null;
      };

      const eyeBoxes = findEyes();
      let eyes = null, skin = null;
      let eyesFrom = "anatomy";
      // Default to the anatomy prior. The pixel search above is a refinement, not the
      // source of truth: it succeeded on one look out of eleven, and the result it
      // produced there was a sliver of forehead rather than an eye. The prior, by
      // contrast, was checked against artwork and landed within 2% of the real thing.
      // Measured for this look, if it has been; otherwise the anatomy prior, which is
      // only trustworthy for the art style it came from.
      const measured = EYES_BY_FILE[String(src).split("/").pop()] ?? null;
      if (measured !== null) {
        eyes = measured;
        eyesFrom = "measured";
      } else if (eyeBoxes === null && ANATOMY !== null && body !== null) {
        const anatomy = ANATOMY;
        const inWidth = (value) => (value * body.h) / body.w;
        const halfWidth = inWidth(anatomy.eyes.separation * 0.26);
        const height = anatomy.eyes.separation * 0.44;
        const eyeMiddleY = 1 - anatomy.eyes.y;
        const offsetX = inWidth(anatomy.eyes.offset);
        eyes = [-1, 1].map((sign) => [
          Math.round((0.5 + sign * offsetX - halfWidth) * 1000) / 1000,
          Math.round((eyeMiddleY - height / 2) * 1000) / 1000,
          Math.round(halfWidth * 2 * 1000) / 1000,
          Math.round(height * 1000) / 1000,
        ]);
      }
      // Only when nothing better was available. The order is measured > anatomy > pixels,
      // and a later step must never overwrite an earlier one — the pixel search succeeded
      // on a look that had already been measured and replaced a correct box with a wrong
      // one.
      if (measured === null && eyeBoxes !== null) {
        // Normalised to the **body**, not the overall box: the eye positions the rig
        // predicts are fractions of the body height, so this has to be the same
        // denominator or the two cannot be compared.
        const bb = body ?? { x: x0, y: y0, w: bw, h: bh };
        eyesFrom = "pixels";
        eyes = eyeBoxes.map((b) => [
          Math.round(((b.x) / bb.w) * 1000) / 1000,
          Math.round(((b.y) / bb.h) * 1000) / 1000,
          Math.round(((b.w) / bb.w) * 1000) / 1000,
          Math.round(((b.h) / bb.h) * 1000) / 1000,
        ]);
        // Skin, sampled just below each eye: the cheek is the one patch of face that
        // is reliably not hair, not an eye and not a highlight.
        const samples = [];
        for (const b of eyeBoxes) {
          const sx = x0 + b.x + Math.floor(b.w / 2);
          const sy = Math.min(y1, y0 + b.y + b.h + Math.max(2, Math.floor(b.h * 0.6)));
          const i = (sy * W + sx) * 4;
          if (px[i + 3] > 200) samples.push([px[i], px[i + 1], px[i + 2]]);
        }
        if (samples.length > 0) {
          const mid = (k) => Math.round(samples.reduce((sum, s) => sum + s[k], 0) / samples.length);
          skin = [mid(0), mid(1), mid(2)];
        }
      }

      const dominant = buckets.reduce((best, bucket) => (bucket.weight > best.weight ? bucket : best), buckets[0]);
      const accent = dominant.weight === 0 ? null : [dominant.r / dominant.weight, dominant.g / dominant.weight, dominant.b / dominant.weight];
      done({ src, W, H, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, accent, profile, eyes, eyesFrom, skin, body });
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
    const anatomyPath = resolve("art/anatomy.json");
    const anatomy = existsSync(anatomyPath) ? JSON.parse(readFileSync(anatomyPath, "utf8")) : null;
    // The page knows each cell by its file, so that is the key it gets.
    writeFileSync(page, PAGE
      .replace("__SOURCES__", JSON.stringify(sources.map((source) => pathToFileURL(resolve(source)).href)))
      .replace("__ANATOMY__", JSON.stringify(anatomy))
      .replace("__EYES__", JSON.stringify(eyesForLook)));
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
  // Read first. The frame records are built in the middle of this function, so anything
  // they need has to exist before that — a definition next to the return statement is
  // already too late, and the failure is a temporal dead zone error, not a missing field.
  const anatomyPath = resolve("art/anatomy.json");
  const anatomyForIndex = existsSync(anatomyPath) ? JSON.parse(readFileSync(anatomyPath, "utf8")) : null;
  const frameArms = anatomyForIndex === null ? null : (anatomyForIndex.arms ?? null);
  // Eye boxes measured per look, where they have been measured. One ratio cannot serve
  // both a chibi — head half the figure — and a full-body portrait, and using one anyway
  // put the lids on the chest of every standing character.
  const eyesPath = resolve("art/eyes.json");
  const eyeData = existsSync(eyesPath) ? JSON.parse(readFileSync(eyesPath, "utf8")) : {};
  eyesForLook = eyeData.eyes ?? {};
  blinkableFiles = new Set(eyeData.blink ?? []);
  const frameEyes = (id) => eyesForLook[id] ?? null;

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
        // The character alone, without free-floating props. Anatomy is expressed as a
        // fraction of this, so it is what the eye positions are measured against.
        body: boxes[index].body ?? null,
        // Eye boxes as [x, y, w, h] fractions of the body, plus the skin tone sampled
        // just below them. Both were computed all along and simply never published.
        eyes: boxes[index].eyes ?? null,
        // Static art: shown as a picture, never rigged. Only the chibi figures animate.
        still: look.still === true,
        // Shoulders in stature units, so the rig can put its arm bones where the game does.
        arms: frameArms,
        // "pixels" when the artwork was measured, "anatomy" when the official
        // proportions were used. Worth publishing: it says how much to trust the box.
        eyesFrom: boxes[index].eyesFrom ?? null,
        // Whether those boxes have been checked against the artwork, and so whether
        // the blink may use them. See `blinkableFiles`.
        blinkable: blinkableFiles.has(file),
        skin: boxes[index].skin ?? null,
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
    anatomy: anatomyForIndex,
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
