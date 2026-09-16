/*
 * Live mascot preview for the configuration console.
 *
 * The artwork is never served from this site — it is official game art that the
 * repository deliberately does not carry. So the preview reads it from the one
 * place it exists: the DSH on the visitor's own machine, which also serves this
 * very page when you open it at `/dsh-mascot/console/`.
 *
 * That is why there is no cross-origin connection box here. A fetch from a public
 * origin to a local DSH is refused before any plugin code runs — measured against a
 * real browser, not assumed — so an address field on the published copy would be a
 * control that can never succeed. On the published copy the preview offers a file
 * of the visitor's own instead, and both routes stay entirely inside the browser.
 *
 * Everything here reads. Nothing is written, and nothing is uploaded.
 */

import { buildRig, createSkinner, poseRig, rigStatus } from "./rig.js";

/** The dock seat the plugin renders into, in CSS pixels. Mirrors `.dsh-mascot-frames`. */
const SEAT = { width: 104, height: 172 };

/** Horizontal bands in a measured silhouette profile; mirrors scripts/art-sync.mjs. */
const PROFILE_ROWS = 32;

/**
 * Measure an image the way `art-sync` does: the alpha bounding box and the
 * silhouette profile the rig's neck search needs.
 *
 * This exists so the preview can rig an arbitrary file the visitor supplies, with
 * no server and no build step — the same numbers, computed in the browser.
 *
 * @param image - a loaded HTMLImageElement.
 * @returns `{ box, profile }` in image pixels, or undefined for a blank image.
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
function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

/**
 * A preview bound to one host element.
 *
 * The surface is small on purpose: `detect`, `show`, `useFile`, `useTestPattern`,
 * `stop`. The console owns the selection, so switching character is a `show` call
 * rather than a reconnect.
 */
export function createPreview(host, onStatus) {
  let origin;
  let index;
  let skinner;
  let raf;
  /** A supplied image — a chosen file or the test pattern — beats whatever the host offers. */
  let override;

  const say = (kind, message) => {
    if (onStatus !== undefined) onStatus({ kind, message });
  };

  /** Tear down the running renderer. */
  function stop() {
    window.cancelAnimationFrame(raf);
    raf = undefined;
    if (skinner !== undefined) {
      skinner.canvas.remove();
      skinner = undefined;
    }
  }

  /** Draw a still frame, used when the rig cannot run. */
  function still(image) {
    host.textContent = "";
    const node = document.createElement("img");
    node.src = image.src;
    node.alt = "";
    node.className = "preview-still";
    host.append(node);
  }

  /** An explanatory placeholder, so the frame is never merely blank. */
  function notice(text) {
    host.textContent = "";
    const node = document.createElement("p");
    node.className = "preview-empty";
    node.textContent = text;
    host.append(node);
  }

  /**
   * Render one image through the rig.
   *
   * @param image - a loaded image whose pixels are readable.
   * @param profile - the silhouette profile, or null for the rig's own default.
   * @param box - the figure's bounding box in image pixels.
   */
  function rig(image, profile, box) {
    stop();
    const bones = buildRig(profile, { rows: 26, cols: 18 });
    const built = createSkinner(image, bones, { width: SEAT.width, left: 0, top: 0 }, box, SEAT);
    if (built === undefined) {
      still(image);
      say("warn", `This browser could not start the renderer, so the preview shows a still image (${String(rigStatus() ?? "no reason reported")}).`);
      return false;
    }
    skinner = built;
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

  /** Render whichever supplied image is active. */
  function showOverride() {
    host.textContent = "";
    return rig(override.image, override.measured.profile, override.measured.box);
  }

  /**
   * Work out where this page is running, and whether the plugin answered here.
   *
   * The test is the URL, not a probe. The plugin serves the console at
   * `<prefix>/console/` and nothing else does, so the path alone decides — whereas
   * probing `/api/looks` from the published copy would 404 on every visit and put
   * an error in the console of a page that is working perfectly.
   *
   * Only once the path says "served by the plugin" is the index actually fetched,
   * and then it is on an origin where it exists.
   *
   * @returns "local" when the plugin is on this origin, otherwise "public".
   */
  async function detect() {
    if (window.location.protocol === "file:") return "public";
    const match = /^(.*)\/console\/?(?:index\.html)?$/u.exec(window.location.pathname);
    if (match === null) return "public";
    const base = `${window.location.origin}${match[1]}`;
    try {
      const response = await fetch(`${base}/api/looks`, { headers: { accept: "application/json" } });
      if (!response.ok) return "public";
      const payload = await response.json();
      if (payload?.ok !== true || !Array.isArray(payload.looks)) return "public";
      origin = window.location.origin;
      index = payload;
      return "local";
    } catch {
      return "public";
    }
  }

  /** Render a visitor-supplied file, measured and rigged entirely in the browser. */
  async function useFile(file) {
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
    showOverride();
    say("ok", `Rigging ${file.name} (${String(image.naturalWidth)}×${String(image.naturalHeight)}). It was measured and animated inside this tab and was never uploaded.`);
    return true;
  }

  /**
   * Render a neutral test pattern through the rig.
   *
   * A diagnostic silhouette, not a character. It exists so the preview can show
   * what the skeleton does before anything is installed, and so the whole chain —
   * measure, auto-rig, skin, animate — is exercisable in a headless browser with no
   * host and no asset.
   */
  async function useTestPattern() {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 360;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#8d96a3";
    const capsule = (x, y, w, h, r) => {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
      ctx.fill();
    };
    capsule(88, 24, 44, 44, 22); // head
    capsule(78, 74, 64, 118, 26); // torso
    capsule(52, 82, 22, 96, 11); // arms
    capsule(146, 82, 22, 96, 11);
    capsule(84, 196, 22, 128, 11); // legs
    capsule(114, 196, 22, 128, 11);
    ctx.fillStyle = "#37e0d8";
    capsule(96, 104, 28, 6, 3);
    capsule(96, 122, 28, 6, 3);

    const image = await loadImage(canvas.toDataURL("image/png"));
    if (image === undefined) {
      say("error", "The built-in test pattern could not be drawn.");
      return false;
    }
    const measured = measure(image);
    if (measured === undefined) {
      say("error", "The test pattern measured as empty, which should be impossible.");
      return false;
    }
    // Recorded as an override, exactly like a chosen file: `show` runs on every
    // console render, so without this the pattern would vanish the first time the
    // visitor switched character.
    override = { image, measured };
    const rigged = showOverride();
    say(rigged ? "ok" : "warn", rigged
      ? "Rendering the built-in test pattern: measure → auto-rig → skinned animation, all inside this tab. Open this same console from your own DSH to see your installed artwork instead."
      : "The test pattern rendered as a still image because this browser could not start the renderer.");
    return rigged;
  }

  /**
   * Show one look from the connected host.
   *
   * @param characterId - the selected character.
   * @param lookId - the selected look, or undefined for the character's first.
   */
  async function show(characterId, lookId) {
    if (override !== undefined) {
      showOverride();
      return;
    }
    if (index === undefined) {
      notice("No artwork to preview yet. Open this console from your own DSH for the live view, or choose an image file below.");
      return;
    }
    const looks = index.looks.filter((look) => look.character === characterId);
    const look = looks.find((entry) => entry.id === lookId) ?? looks[0];
    stop();
    host.textContent = "";
    if (look === undefined) {
      notice(`Your DSH has no artwork installed for "${characterId}". Run \`npm run fetch-art\` there, or switch character.`);
      return;
    }
    const frame = look.frames[0];
    const image = await loadImage(`${origin}${index.artBase}/${frame.file}`);
    if (image === undefined) {
      say("error", `${frame.file} did not load. It may be missing from the DSH's art directory.`);
      notice(`${frame.file} did not load.`);
      return;
    }
    const box = frame.measured?.box;
    if (Array.isArray(frame.profile) && Array.isArray(box)) {
      rig(image, frame.profile, box);
    } else {
      still(image);
      say("warn", `${look.id} carries no measured silhouette, so the preview shows a still image. Run \`npm run art:sync\` in the plugin directory.`);
    }
  }

  return {
    detect,
    show,
    useFile,
    useTestPattern,
    stop,
    /** Let the console report the outcome of a sequence it drove itself. */
    report: (message, kind = "ok") => say(kind, message),
    isLive: () => index !== undefined,
  };
}
