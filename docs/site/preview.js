/*
 * Live mascot preview for the configuration console.
 *
 * The artwork is never served from this site — it is official game art the
 * repository deliberately does not carry. Instead this connects to the DSH running
 * on the visitor's own machine and renders the art they installed, with the very
 * same skeleton the plugin runs. If there is no local DSH, or it is on another
 * port, the visitor can hand the preview a file directly; either way the image
 * stays in the browser.
 *
 * Everything here is a preview: it reads, and never writes, anything on the host.
 */

import { buildRig, createSkinner, poseRig, rigStatus } from "./rig.js";

/** The dock seat the plugin renders into, in CSS pixels. Mirrors `.dsh-mascot-frames`. */
const SEAT = { width: 104, height: 172 };

/** Horizontal bands in a measured silhouette profile; mirrors scripts/art-sync.mjs. */
const PROFILE_ROWS = 32;

/**
 * Measure an image the way `art-sync` does: the alpha bounding box, an accent
 * colour, and the silhouette profile the rig's neck search needs.
 *
 * This exists so the preview can rig an arbitrary file the visitor supplies, with
 * no server and no build step — the same numbers, computed in the browser.
 *
 * @param image - a loaded HTMLImageElement.
 * @returns `{ box, profile, accent }`, all in image pixels.
 */
export function measure(image) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, width, height).data;

  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] < 64) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return undefined;

  const boxWidth = x1 - x0 + 1;
  const boxHeight = y1 - y0 + 1;
  const profile = [];
  for (let row = 0; row < PROFILE_ROWS; row++) {
    const from = y0 + Math.floor((row * boxHeight) / PROFILE_ROWS);
    const to = Math.min(y1, y0 + Math.floor(((row + 1) * boxHeight) / PROFILE_ROWS) - 1);
    let lo = -1;
    let hi = -1;
    for (let y = from; y <= to; y++) {
      for (let x = x0; x <= x1; x++) {
        if (px[(y * width + x) * 4 + 3] < 64) continue;
        if (lo < 0 || x < lo) lo = x;
        if (x > hi) hi = x;
      }
    }
    profile.push(lo < 0 ? 0 : (lo - x0) / boxWidth, lo < 0 ? 0 : (hi - x0) / boxWidth);
  }
  return { box: [x0, y0, boxWidth, boxHeight], profile };
}

/** Load an image, resolving to undefined rather than rejecting on failure. */
function loadImage(url, crossOrigin) {
  return new Promise((resolve) => {
    const image = new Image();
    if (crossOrigin === true) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

/**
 * A preview bound to one host element.
 *
 * The public surface is deliberately small: `connect`, `useFile`, `show` and
 * `stop`. Selection lives in the console's own state, so switching character is a
 * `show` call rather than a re-connect.
 */
export function createPreview(host, onStatus) {
  let origin;
  let index;
  let skinner;
  let raf;
  let frameImage;
  /** A visitor-supplied file overrides whatever the local host offers. */
  let override;

  const say = (kind, message) => {
    if (onStatus !== undefined) onStatus({ kind, message });
  };

  /** Tear down any running renderer. */
  function stop() {
    window.cancelAnimationFrame(raf);
    raf = undefined;
    if (skinner !== undefined) {
      skinner.canvas.remove();
      skinner = undefined;
    }
    frameImage = undefined;
  }

  /** Draw one still frame with no animation, used when the rig cannot run. */
  function still(image) {
    host.textContent = "";
    const node = document.createElement("img");
    node.src = image.src;
    node.alt = "";
    node.className = "preview-still";
    host.append(node);
  }

  /**
   * Render one image through the rig.
   *
   * @param image - a loaded image whose pixels are readable (same-origin or CORS).
   * @param profile - the silhouette profile, or null to let the rig use its default.
   * @param box - the figure's bounding box in image pixels.
   */
  function rig(image, profile, box) {
    stop();
    const bones = buildRig(profile, { rows: 26, cols: 18 });
    const built = createSkinner(
      image,
      bones,
      { width: SEAT.width, left: 0, top: 0 },
      box,
      SEAT,
    );
    if (built === undefined) {
      still(image);
      say("warn", `This browser could not start the renderer, so the preview shows a still image (${String(rigStatus() ?? "no reason reported")}).`);
      return false;
    }
    skinner = built;
    frameImage = image;
    host.textContent = "";
    host.append(skinner.canvas);
    skinner.canvas.style.width = `${String(SEAT.width)}px`;
    skinner.canvas.style.height = `${String(SEAT.height)}px`;
    skinner.canvas.style.display = "block";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    skinner.resize(Math.round(SEAT.width * dpr), Math.round(SEAT.height * dpr));
    const started = performance.now();
    const loop = (now) => {
      raf = window.requestAnimationFrame(loop);
      skinner.draw(poseRig(bones, box, { time: (now - started) / 1000, pokeAge: undefined }));
    };
    raf = window.requestAnimationFrame(loop);
    return true;
  }

  /**
   * Connect to a local DSH and read its look index.
   *
   * A session-less cross-origin read only succeeds because the plugin's art route
   * accepts allowlisted origins; the index itself is read here too, which the
   * plugin gates on an explicit allowlist entry as well.
   */
  async function connect(base) {
    stop();
    host.textContent = "";
    const trimmed = String(base).trim().replace(/\/+$/u, "");
    if (trimmed === "") {
      say("idle", "Enter the address your DSH is listening on.");
      return false;
    }
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      say("error", `"${trimmed}" is not a valid address.`);
      return false;
    }
    say("busy", `Reading ${url.origin}…`);
    try {
      const response = await fetch(new URL("/dsh-mascot/api/looks", url), { headers: { accept: "application/json" } });
      if (!response.ok) {
        say("error", response.status === 401
          ? `DSH at ${url.origin} refused the read. Add ${window.location.origin} to the plugin's artOrigins.`
          : `DSH at ${url.origin} answered HTTP ${String(response.status)}.`);
        return false;
      }
      const payload = await response.json();
      if (payload?.ok !== true || !Array.isArray(payload.looks) || payload.looks.length === 0) {
        say("error", `DSH at ${url.origin} answered, but no artwork is installed. Run \`npm run fetch-art\` there.`);
        return false;
      }
      origin = url.origin;
      index = payload;
      override = undefined;
      say("ok", `Connected to ${url.origin} — ${String(payload.looks.length)} look(s) across ${String(payload.characters.length)} character(s).`);
      return true;
    } catch {
      say("error", `Could not reach ${url.origin}. Is DSH Desktop running, and is that its address?`);
      return false;
    }
  }

  /** Render a visitor-supplied file, measured and rigged entirely in the browser. */
  async function useFile(file) {
    stop();
    const url = URL.createObjectURL(file);
    const image = await loadImage(url);
    URL.revokeObjectURL(url);
    if (image === undefined) {
      say("error", "That file could not be decoded as an image.");
      return false;
    }
    const measured = measure(image);
    if (measured === undefined) {
      say("error", "That image is fully transparent, so there is nothing to rig.");
      return false;
    }
    override = { image, measured };
    say("ok", `Rigging ${file.name} (${String(image.naturalWidth)}×${String(image.naturalHeight)}) — measured and animated in this browser; the file was not uploaded.`);
    return true;
  }

  /**
   * Show one look, from whichever source is active.
   *
   * @param characterId - the selected character.
   * @param lookId - the selected look, or undefined for the character's first.
   */
  async function show(characterId, lookId) {
    if (override !== undefined) {
      host.textContent = "";
      rig(override.image, override.measured.profile, override.measured.box);
      return;
    }
    if (index === undefined) {
      host.textContent = "";
      const notice = document.createElement("p");
      notice.className = "preview-empty";
      notice.textContent = "No local DSH connected — the preview will appear here once you connect, or drop in an image file.";
      host.append(notice);
      return;
    }
    const looks = index.looks.filter((look) => look.character === characterId);
    const look = looks.find((entry) => entry.id === lookId) ?? looks[0];
    stop();
    host.textContent = "";
    if (look === undefined) {
      const notice = document.createElement("p");
      notice.className = "preview-empty";
      notice.textContent =
        `Your DSH has no artwork installed for "${characterId}". Run \`npm run fetch-art\` there, or switch character.`;
      host.append(notice);
      return;
    }
    const frame = look.frames[0];
    const image = await loadImage(`${origin}${index.artBase}/${frame.file}`, true);
    if (image === undefined) {
      say("error", `${frame.file} did not load. It may be missing from the DSH's art directory.`);
      return;
    }
    const box = frame.measured?.box;
    if (Array.isArray(frame.profile) && Array.isArray(box)) {
      rig(image, frame.profile, box);
    } else {
      still(image);
      say("warn", `${look.id} carries no measured silhouette, so the preview shows a still image. Re-run \`npm run art:sync\` there.`);
    }
  }

  /**
   * Render a neutral test pattern through the rig.
   *
   * This is a diagnostic silhouette, not a character — it exists so the preview can
   * demonstrate what the skeleton does before anything is installed, and so the
   * whole chain (measure → rig → skin → animate) is testable in a headless browser
   * with no host and no asset.
   */
  function useTestPattern() {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#8d96a3";
    const capsule = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.roundRect?.(x, y, w, h, r) ?? ctx.rect(x, y, w, h);
      ctx.fill();
    };
    capsule(88, 24, 44, 44, 22); // head
    capsule(78, 74, 64, 118, 26); // torso
    capsule(52, 82, 22, 96, 11); // left arm
    capsule(146, 82, 22, 96, 11); // right arm
    capsule(84, 196, 22, 128, 11); // left leg
    capsule(114, 196, 22, 128, 11); // right leg
    ctx.fillStyle = "#37e0d8";
    capsule(96, 104, 28, 6, 3);
    capsule(96, 122, 28, 6, 3);
    const image = new Image();
    return new Promise((resolve) => {
      image.onload = () => {
        const measured = measure(image);
        stop();
        host.textContent = "";
        if (measured === undefined) {
          say("error", "The test pattern measured as empty, which should be impossible.");
          resolve(false);
          return;
        }
        // Recorded as an override, exactly like a chosen file: `show()` runs on
        // every console render, and without this the pattern would be wiped the
        // first time the visitor switched character.
        override = { image, measured };
        const rigged = rig(image, measured.profile, measured.box);
        say(rigged ? "ok" : "warn", rigged
          ? "Rendering the built-in test pattern: measure → auto-rig → skinned animation, all in this browser. Connect a local DSH to see your own artwork instead."
          : "The test pattern rendered as a still image because this browser could not start the renderer.");
        resolve(rigged);
      };
      image.onerror = () => resolve(false);
      image.src = canvas.toDataURL("image/png");
    });
  }

  return {
    connect,
    useFile,
    useTestPattern,
    show,
    stop,
    connected: () => origin !== undefined,
    hasFile: () => override !== undefined,
  };
}
