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
 *   3. keep the requested connected components and drop the rest, which is what
 *      discards stray confetti;
 *   4. crop to the union of what survived.
 *
 * When more than one component survives, one PNG is written per component from
 * the SAME crop window. That is what makes a two-pose sheet usable as a
 * two-frame animation: the frames are pixel-aligned, so cross-fading them looks
 * like the character moving rather than jumping.
 *
 * The page returns finished PNGs as data URLs inside the DOM, read back with
 * `--dump-dom`. Screenshotting instead would drag in headless Chromium's minimum
 * viewport width, which silently reflows the page and re-scales the output.
 *
 *   node scripts/cutout.mjs <in.png> <out.png> [--mode largest|second|all]
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findChromium } from "./chrome.mjs";

/** Tolerance for "this pixel is the background colour", sum of RGB deltas. */
const TOLERANCE = 96;

/** Which components a mode keeps. */
const MODES = new Set(["largest", "second", "all"]);

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>cutout</title></head><body>
<pre id="report"></pre>
<script>
const query = new URLSearchParams(location.search);
const MODE = query.get("mode") || "largest";
const img = new Image();
img.onload = () => {
  const done = (payload) => {
    const node = document.getElementById("report");
    node.id = "done";
    node.textContent = JSON.stringify(payload);
  };
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

    const seen = new Uint8Array(N);
    const components = [];
    for (let s = 0; s < N; s++) {
      if (background[s] || seen[s] || alpha(s) < 24) continue;
      seen[s] = 1;
      const cells = [s], st = [s];
      while (st.length) {
        const i = st.pop(); cells.push(i);
        const x = i % W, y = (i - x) / W;
        const push = (j) => { if (j >= 0 && !seen[j] && !background[j] && alpha(j) >= 24) { seen[j] = 1; st.push(j); } };
        if (x > 0) push(i - 1);
        if (x < W - 1) push(i + 1);
        if (y > 0) push(i - W);
        if (y < H - 1) push(i + W);
      }
      components.push(cells);
    }
    if (components.length === 0) { done({ error: "nothing survived the key" }); return; }
    components.sort((a, b) => b.length - a.length);

    const biggest = components[0].length;
    let keep;
    if (MODE === "second") keep = components.slice(1, 2);
    else if (MODE === "all") keep = components.filter((cells) => cells.length >= Math.max(biggest * 0.15, 2000));
    else keep = components.slice(0, 1);
    if (keep.length === 0) { done({ error: "no component matched mode " + MODE }); return; }

    // Union box over everything being kept, so the frames share one window.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const cells of keep) {
      for (const i of cells) {
        const x = i % W, y = (i - x) / W;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;

    // One frame per kept component (or one frame holding all of them). Each frame
    // is cropped to its OWN bounding box: the caller scales a look's frames by a
    // shared factor, so tight crops keep each pose the same size on screen and a
    // shared window would only shrink the whole set into the middle of a wide
    // canvas.
    const groups = keep.length > 1 ? keep.map((cells) => [cells]) : [keep];
    const frames = groups.map((group) => {
      let gx0 = W, gy0 = H, gx1 = -1, gy1 = -1;
      for (const cells of group) {
        for (const i of cells) {
          const x = i % W, y = (i - x) / W;
          if (x < gx0) gx0 = x; if (x > gx1) gx1 = x;
          if (y < gy0) gy0 = y; if (y > gy1) gy1 = y;
        }
      }
      const fw = gx1 - gx0 + 1, fh = gy1 - gy0 + 1;
      const frame = new ImageData(W, H);
      frame.data.set(data.data);
      const keepMask = new Uint8Array(N);
      for (const cells of group) for (const i of cells) keepMask[i] = 1;
      for (let i = 0; i < N; i++) if (!keepMask[i]) frame.data[i * 4 + 3] = 0;
      const layer = document.createElement("canvas");
      layer.width = W; layer.height = H;
      layer.getContext("2d").putImageData(frame, 0, 0);
      const out = document.createElement("canvas");
      out.width = fw; out.height = fh;
      out.getContext("2d").drawImage(layer, gx0, gy0, fw, fh, 0, 0, fw, fh);
      // The crop origin is kept, not discarded: the web console hotlinks the
      // *original* image, and without this it cannot tell which part of it a frame
      // corresponds to — so the measured geometry would be applied to the wrong
      // pixels, which is exactly what happened to the two-pose Q-version.
      return { png: out.toDataURL("image/png"), w: fw, h: fh, x: gx0, y: gy0 };
    });

    done({ w: W, h: H, count: frames.length, kept: keep.length, frames });
  } catch (error) {
    done({ error: String(error && error.message ? error.message : error) });
  }
};
img.onerror = () => {
  const node = document.getElementById("report");
  node.id = "done";
  node.textContent = JSON.stringify({ error: "image failed to load" });
};
img.src = query.get("src");
</script>
</body></html>`;

/**
 * Remove the background from one image and write one PNG per surviving figure.
 *
 * @param input - source image path.
 * @param outputs - destination PNG paths; extras must match the component count.
 * @param options - `mode` (`largest` | `second` | `all`) and `chromium`.
 * @returns `{ width, height, count }`.
 */
export function cutout(input, outputs, options = {}) {
  const mode = options.mode ?? "largest";
  if (!MODES.has(mode)) throw new Error(`cutout: unknown mode ${JSON.stringify(mode)}`);
  const chromium = options.chromium ?? findChromium();
  const work = mkdtempSync(join(tmpdir(), "dsh-mascot-cutout-"));
  try {
    const page = join(work, "cutout.html");
    writeFileSync(page, PAGE);
    const url = `${pathToFileURL(page).href}?src=${encodeURIComponent(pathToFileURL(resolve(input)).href)}&mode=${mode}`;
    const dom = execFileSync(
      chromium,
      ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=60000", "--dump-dom", url],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const match = /<pre id="done">([\s\S]*?)<\/pre>/u.exec(dom);
    if (match === null) throw new Error(`cutout: the page reported nothing for ${input}`);
    const report = JSON.parse(match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"'));
    if (report.error !== undefined) throw new Error(`cutout: ${report.error} (${input})`);
    if (report.frames.length !== outputs.length) {
      throw new Error(`cutout: ${input} yielded ${String(report.frames.length)} figure(s) but ${String(outputs.length)} output path(s) were given`);
    }
    report.frames.forEach((frame, index) => {
      const parts = /^data:image\/png;base64,(.+)$/u.exec(frame.png);
      if (parts === null) throw new Error(`cutout: frame ${String(index)} came back without a PNG`);
      const bytes = Buffer.from(parts[1], "base64");
      if (bytes.length === 0) throw new Error(`cutout: frame ${String(index)} decoded empty`);
      writeFileSync(outputs[index], bytes);
    });
    return {
      sourceWidth: report.w,
      sourceHeight: report.h,
      count: report.frames.length,
      frames: report.frames.map((f) => ({ width: f.w, height: f.h, x: f.x, y: f.y })),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** CLI entry: `node scripts/cutout.mjs <in> <out.png> [--mode all]`. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const modeFlag = args.indexOf("--mode");
  const mode = modeFlag >= 0 ? args[modeFlag + 1] : "largest";
  const positional = args.filter((arg, index) => !arg.startsWith("--") && index !== modeFlag + 1);
  const [input, ...outputs] = positional;
  if (input === undefined || outputs.length === 0) {
    console.error("usage: node scripts/cutout.mjs <in.png> <out.png> [<out2.png> ...] [--mode largest|second|all]");
    process.exit(2);
  }
  // `all` may yield more figures than paths given; the caller names them all.
  const size = cutout(input, outputs, { mode });
  console.log(`cutout: ${String(size.count)} frame(s) from a ${String(size.sourceWidth)}x${String(size.sourceHeight)} source`);
}
