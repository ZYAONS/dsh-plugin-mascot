#!/usr/bin/env node
/**
 * Key the background out of a character sheet, in a real browser.
 *
 * Some official Q-version art ships as a promotional sheet: two poses on a
 * decorated background. That is not usable as a floating sprite, and Node has
 * no image library here to fix it — but the browser the rest of this project
 * already drives does, via canvas.
 *
 * The pass is deliberately conservative:
 *   1. sample the opaque colours on the outer ring to learn the background;
 *   2. flood-fill inward from every border pixel through transparent or
 *      background-coloured pixels, which walks around the figure's outline;
 *   3. keep only the largest remaining connected component — the figure —
 *      which is what discards stray confetti and the second pose;
 *   4. crop to what survived.
 *
 * The page returns the finished PNG as a data URL inside the DOM, read back with
 * `--dump-dom`. Screenshotting instead would drag in headless Chromium's minimum
 * viewport width, which silently reflows the page and re-scales the output.
 *
 *   node scripts/cutout.mjs <in.png> <out.png>
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findChromium } from "./chrome.mjs";

/** Tolerance for "this pixel is the background colour", sum of RGB deltas. */
const TOLERANCE = 96;

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>cutout</title></head><body>
<pre id="out"></pre>
<script>
const img = new Image();
img.onload = () => {
  const report = (payload) => { document.getElementById("out").textContent = JSON.stringify(payload); };
  try {
    const W = img.naturalWidth, H = img.naturalHeight, N = W * H;
    const src = document.createElement("canvas");
    src.width = W; src.height = H;
    const sctx = src.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0);
    const data = sctx.getImageData(0, 0, W, H);
    const px = data.data;
    const alpha = (i) => px[i * 4 + 3];
    const rgb = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
    const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

    const ring = [];
    for (let x = 0; x < W; x++) { ring.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { ring.push(y * W, y * W + W - 1); }
    const hist = new Map();
    for (const i of ring) {
      if (alpha(i) < 16) continue;
      const p = rgb(i), k = (p[0] >> 3) + "," + (p[1] >> 3) + "," + (p[2] >> 3);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
    const seeds = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k]) => k.split(",").map((n) => n * 8 + 4));
    const isBackground = (i) => {
      if (alpha(i) < 16) return true;
      const p = rgb(i);
      for (const s of seeds) if (dist(p, s) < ${String(TOLERANCE)}) return true;
      return false;
    };

    const background = new Uint8Array(N);
    const stack = [];
    for (const i of ring) if (isBackground(i) && !background[i]) { background[i] = 1; stack.push(i); }
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i - x) / W;
      const push = (j) => { if (!background[j] && isBackground(j)) { background[j] = 1; stack.push(j); } };
      if (x > 0) push(i - 1);
      if (x < W - 1) push(i + 1);
      if (y > 0) push(i - W);
      if (y < H - 1) push(i + W);
    }

    const seen = new Uint8Array(N), keep = new Uint8Array(N);
    let bestArea = -1, bestCells = null;
    for (let s = 0; s < N; s++) {
      if (background[s] || seen[s] || alpha(s) < 16) continue;
      seen[s] = 1;
      const cells = [s], st = [s];
      while (st.length) {
        const i = st.pop(); cells.push(i);
        const x = i % W, y = (i - x) / W;
        const push = (j) => { if (j >= 0 && !seen[j] && !background[j] && alpha(j) >= 16) { seen[j] = 1; st.push(j); } };
        if (x > 0) push(i - 1);
        if (x < W - 1) push(i + 1);
        if (y > 0) push(i - W);
        if (y < H - 1) push(i + W);
      }
      if (cells.length > bestArea) { bestArea = cells.length; bestCells = cells; }
    }
    if (bestCells === null) { report({ error: "nothing survived the key" }); return; }
    for (const i of bestCells) keep[i] = 1;

    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let i = 0; i < N; i++) {
      if (!keep[i]) { px[i * 4 + 3] = 0; continue; }
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    sctx.putImageData(data, 0, 0);

    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    out.getContext("2d").drawImage(src, x0, y0, w, h, 0, 0, w, h);
    report({ w, h, kept: bestArea, png: out.toDataURL("image/png") });
  } catch (error) {
    report({ error: String(error && error.message ? error.message : error) });
  }
};
img.onerror = () => {
  document.getElementById("out").textContent = JSON.stringify({ error: "image failed to load" });
};
img.src = new URLSearchParams(location.search).get("src");
</script>
</body></html>`;

/**
 * Remove the background from one image.
 *
 * @param input - source image path.
 * @param output - destination PNG path.
 * @param options - `chromium` overrides binary discovery (for tests).
 * @returns `{ width, height }` of the written file.
 */
export function cutout(input, output, options = {}) {
  const chromium = options.chromium ?? findChromium();
  const work = mkdtempSync(join(tmpdir(), "dsh-mascot-cutout-"));
  try {
    const page = join(work, "cutout.html");
    writeFileSync(page, PAGE);
    const url = `${pathToFileURL(page).href}?src=${encodeURIComponent(pathToFileURL(resolve(input)).href)}`;
    const dom = execFileSync(
      chromium,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=20000", "--dump-dom", url],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const match = /<pre id="out">([\s\S]*?)<\/pre>/u.exec(dom);
    if (match === null) throw new Error(`cutout: the page reported nothing for ${input}`);
    const report = JSON.parse(match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"'));
    if (report.error !== undefined) throw new Error(`cutout: ${report.error} (${input})`);
    const png = /^data:image\/png;base64,(.+)$/u.exec(report.png);
    if (png === null) throw new Error(`cutout: the page returned no PNG for ${input}`);
    const bytes = Buffer.from(png[1], "base64");
    if (bytes.length === 0) throw new Error(`cutout: decoded an empty PNG for ${input}`);
    writeFileSync(output, bytes);
    return { width: report.w, height: report.h };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** CLI entry: `node scripts/cutout.mjs <in> <out>`. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (input === undefined || output === undefined) {
    console.error("usage: node scripts/cutout.mjs <in.png> <out.png>");
    process.exit(2);
  }
  const size = cutout(input, output);
  console.log(`cutout: ${output} (${String(size.width)}x${String(size.height)})`);
}
