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

import { buildRig, createBlink, createSkinner, findNeck, poseRig, speakLine, voiceStatus, VOICE_LINES, RIG, rigStatus } from "./rig.js";

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
function loadImage(url, crossOrigin) {
  return new Promise((resolve) => {
    const image = new Image();
    // Asking for CORS on a host that does not send the header makes the load fail
    // outright, so the caller tries this first and falls back to a plain load.
    if (crossOrigin === true) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(undefined);
    image.src = url;
  });
}

/**
 * Find the pixels for one frame, and say whether they can be rigged.
 *
 * Three sources, in descending order of usefulness:
 *
 *   1. a copy published next to the console (`docs/art/…`, opt in with
 *      `npm run art:publish`). Same origin, so the rig always works;
 *   2. the declared source loaded with CORS, which the rig also accepts;
 *   3. the declared source loaded plainly — it displays, but a cross-origin image
 *      without CORS taints the canvas and WebGL refuses it, so it cannot deform.
 *
 * @returns `{ image, riggable }`, or undefined when nothing loaded.
 */
async function acquire(frame, look) {
  if (frame.local === true) {
    const local = await loadImage(`art/${frame.file}`);
    if (local !== undefined) return { image: local, riggable: true, alreadyCropped: true };
  }
  for (const url of look.sources ?? []) {
    if (look.cors !== false) {
      const cors = await loadImage(url, true);
      if (cors !== undefined) return { image: cors, riggable: true, alreadyCropped: false };
    }
    const plain = await loadImage(url);
    if (plain !== undefined) return { image: plain, riggable: false, alreadyCropped: false };
  }
  return undefined;
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
  let catalogue;
  let skinner;
  let skeletonCanvas;
  let raf;
  /**
   * Which request owns the frame.
   *
   * Every draw is async — an image has to load first — and each one clears the host
   * and appends its own result. Without this, a request that started earlier and
   * finished later appended on top of a newer one, leaving the previous frame visible
   * underneath the current one. Only the newest generation may draw.
   */
  let generation = 0;

  /**
   * When the figure was last clicked, and the line that click produced.
   *
   * Both live here rather than in the DOM because the pose has to see the first one and the
   * bubble is rebuilt on every render.
   */
  let pokeAt;
  let said;
  /**
   * Which character is showing, so a click knows whose line to speak.
   *
   * Declared here, assigned in `show`: the CSS rig has no idea which character it is
   * drawing, and the click handler needs to. Missing this declaration is not a subtle
   * failure — every `show` throws a ReferenceError in module scope, nothing is ever
   * appended to the frame, and the page looks like it simply never loaded.
   */
  let current = null;

  /** Say the current character's line, show it, and start the wobble. */
  function greetByClick(characterId) {
    pokeAt = performance.now();
    const spoken = speakLine(characterId);
    said = spoken;
    const bubble = document.getElementById("preview-say");
    if (bubble !== null) {
      // The official wording when it is known, the line's name when it is not, and the
      // written line only when there is no recording at all. Showing a sentence the
      // voice is not saying is worse than showing nothing.
      const said = spoken.ja !== "" ? spoken.ja : (spoken.label !== "" ? `（官方语音：${spoken.label}）` : spoken.ja);
      bubble.textContent = said;
      bubble.dataset.on = "1";
      // Dashed when there is no wording to show, so a label is not mistaken for a line.
      bubble.dataset.silent = spoken.ja === "" ? "1" : (spoken.spoke ? "0" : "1");
      const explanation = [spoken.zh, spoken.label !== "" ? `官方语音：${spoken.label}` : "", spoken.reason ?? ""].filter((part) => part !== "").join(" — ");
      bubble.title = explanation;
      window.setTimeout(() => { bubble.dataset.on = "0"; }, 2600);
    }
  }

  /** Seconds since the last click, or undefined once the impulse has rung out. */
  function pokeAgeAt(now) {
    if (pokeAt === undefined) return undefined;
    const age = (now - pokeAt) / 1000;
    if (age > 1.6) { pokeAt = undefined; return undefined; }
    return age;
  }
  /** Whether a newer request has taken over the frame since this one started. */
  const stale = (mine) => generation !== mine;
  let timers = [];
  /** A supplied image — a chosen file or the test pattern — beats everything else. */
  let override;

  const say = (kind, message) => {
    if (onStatus !== undefined) onStatus({ kind, message });
  };

  /** Tear down the running renderer, whatever kind it is. */
  function stop() {
    window.cancelAnimationFrame(raf);
    raf = undefined;
    for (const timer of timers) window.clearTimeout(timer);
    timers = [];
    if (skinner !== undefined) {
      skinner.canvas.remove();
      skinner = undefined;
    }
    if (skeletonCanvas !== undefined) {
      skeletonCanvas.remove();
      skeletonCanvas = undefined;
    }
    // Cleared here rather than in each caller: a draw path that forgets to empty the
    // host leaves the previous frame underneath its own, which is the same ghosting
    // the generation guard prevents, reached by a different route.
    host.textContent = "";
  }

  /** Draw a still frame. */
  function still(image) {
    host.textContent = "";
    const node = document.createElement("img");
    node.src = image.src;
    node.alt = "";
    node.className = "preview-still";
    host.append(node);
  }

  /**
   * Cross-fade between the frames of a look that cannot be rigged.
   *
   * A look with more than one drawn pose is animation in its own right — it is what
   * the plugin itself does for the Q-version that turns around — and it needs no
   * pixels read from the canvas, so it works for artwork the rig is not allowed to
   * touch.
   */
  function cycle(images) {
    host.textContent = "";
    const stack = images.map((image, position) => {
      const node = document.createElement("img");
      node.src = image.src;
      node.alt = "";
      node.className = "preview-still preview-frame";
      node.style.opacity = position === 0 ? "1" : "0";
      host.append(node);
      return node;
    });
    let shown = 0;
    const advance = () => {
      stack[shown].style.opacity = "0";
      shown = (shown + 1) % stack.length;
      stack[shown].style.opacity = "1";
      timers.push(window.setTimeout(advance, 5200));
    };
    timers.push(window.setTimeout(advance, 5200));
  }

  /**
   * A CSS polygon around the figure, from the silhouette the index already measured.
   *
   * Hotlinked artwork arrives with whatever the publisher drew behind it — the
   * Q-version's source is a pink star scattered with confetti, and a rectangular crop
   * of it carries all of that along. The pixels cannot be read, so the background
   * cannot be keyed out the way `cutout.mjs` does it for a local copy; but the
   * silhouette is 32 rows of left and right extents, and that is enough to describe
   * the figure as a clip path and leave everything outside it behind.
   *
   * Slightly dilated, because the head layer rotates and a clip that hugged the hair
   * would shave it.
   *
   * @param frame - the frame record: `box`, `profile` and optionally `crop`.
   * @param sourceWidth - the natural width of the image being clipped.
   * @param sourceHeight - its natural height.
   * @returns a `polygon(...)` string, or undefined when there is no profile.
   */
  function silhouetteClip(frame, sourceWidth, sourceHeight) {
    if (!Array.isArray(frame.profile) || !Array.isArray(frame.box)) return undefined;
    const crop = frame.crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
    const box = frame.box;
    const rows = frame.profile.length / 2;
    // Two percent of the figure's width, expressed against the whole image.
    const pad = ((box[2] * 0.02) / sourceWidth) * 100;
    const x = (normalised) => (((crop.x + box[0] + normalised * box[2]) / sourceWidth) * 100).toFixed(2);
    const y = (normalised) => (((crop.y + box[1] + normalised * box[3]) / sourceHeight) * 100).toFixed(2);
    const left = [];
    const right = [];
    for (let row = 0; row < rows; row++) {
      const atY = y((row + 0.5) / rows);
      left.push(`${(Number(x(frame.profile[row * 2])) - pad).toFixed(2)}% ${atY}%`);
      right.push(`${(Number(x(frame.profile[row * 2 + 1])) + pad).toFixed(2)}% ${atY}%`);
    }
    return `polygon(${[...left, ...right.reverse()].join(", ")})`;
  }
  /**
   * Animate a look with CSS layers, when the WebGL rig is not allowed near it.
   *
   * A cross-origin image without a CORS header cannot be uploaded as a texture, so
   * no vertex of it can be deformed. It can still be decomposed: `index.json`
   * already records where this figure's neck pinches and where its hip sits, and
   * two masked copies of the same image — each rotating about one of those joints —
   * produce a head that leads and a body that sways. The head copy is feathered
   * into the body across the neck, so a small angle reads as movement rather than
   * as two pictures sliding past one another.
   *
   * Two rigid layers rather than a skinned mesh: nothing bends. That is the honest
   * description of what can be done with an image whose pixels are off-limits.
   *
   * @param images - one loaded image per drawn pose.
   * @param frame - the frame record, carrying `box` and `profile`.
   */
  function cssRig(poses, label, face) {
    const first = poses[0];
    const sourceWidth = first.image.naturalWidth;
    const sourceHeight = first.image.naturalHeight;

    // Where each pose sits inside the file the browser holds. A frame that was cut
    // out of a larger download has its own rectangle, and they are *not* the same —
    // the Q-version's two poses are 250 pixels apart in a 645-wide source. Drawing
    // every pose through the first one's window shows the first pose twice, which is
    // what made the turn look like nothing happening.
    const geometry = poses.map((pose) => {
      const crop = pose.frame.crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
      const box = pose.frame.box;
      const neck = findNeck(pose.frame.profile);
      const scale = SEAT.height / crop.height;
      // Everything the rig uses is a percentage of the source image, which is what
      // the transform origins and the mask line resolve against.
      const asSourceX = (value) => ((crop.x + value) / sourceWidth) * 100;
      const asSourceY = (value) => ((crop.y + value) / sourceHeight) * 100;
      return {
        crop,
        scale,
        viewWidth: crop.width * scale,
        sourceDisplayWidth: sourceWidth * scale,
        sourceDisplayHeight: sourceHeight * scale,
        cut: asSourceY(box[1] + neck.y * box[3]),
        neckX: asSourceX(box[0] + neck.x * box[2]),
        neckY: asSourceY(box[1] + neck.y * box[3]),
        hipY: asSourceY(box[1] + RIG.hip * box[3]),
      };
    });

    // One box wide enough for the widest pose; each pose centres its own crop in it,
    // so a narrower turned pose stays centred instead of drifting sideways.
    const boxWidth = Math.max(...geometry.map((entry) => entry.viewWidth));

    host.textContent = "";
    const rig = document.createElement("div");
    rig.className = "css-rig";
    rig.style.width = `${boxWidth.toFixed(1)}px`;
    rig.style.height = `${SEAT.height}px`;

    for (const [position, pose] of poses.entries()) {
      const spec = geometry[position];
      const layer = document.createElement("div");
      layer.className = "rig-pose";
      if (position === 0) layer.dataset.shown = "1";
      layer.style.setProperty("--off-x", `${((boxWidth - spec.viewWidth) / 2 - spec.crop.x * spec.scale).toFixed(1)}px`);
      layer.style.setProperty("--off-y", `${(-spec.crop.y * spec.scale).toFixed(1)}px`);
      layer.style.setProperty("--src-w", `${spec.sourceDisplayWidth.toFixed(1)}px`);
      layer.style.setProperty("--src-h", `${spec.sourceDisplayHeight.toFixed(1)}px`);
      layer.style.setProperty("--cut", `${spec.cut.toFixed(2)}%`);
      layer.style.setProperty("--neck-x", `${spec.neckX.toFixed(2)}%`);
      layer.style.setProperty("--neck-y", `${spec.neckY.toFixed(2)}%`);
      layer.style.setProperty("--hip-x", "50%");
      layer.style.setProperty("--hip-y", `${spec.hipY.toFixed(2)}%`);

      // Clipped to the figure, so whatever the publisher drew behind it stays behind.
      //
      // Only for a look that was cut out of its source in the first place: `cutout` is
      // declared for artwork whose download carries a background worth removing, and a
      // crop rectangle is the record of that. A look downloaded whole already looks
      // however its publisher intended, and a 32-sided polygon would only add faceting
      // to artwork that has nothing to hide.
      if (pose.frame.crop !== null && pose.frame.crop !== undefined) {
        const clip = silhouetteClip(pose.frame, sourceWidth, sourceHeight);
        if (clip !== undefined) layer.style.clipPath = clip;
      }

      // One root per pose, holding the body and the head: the head is its child, so
      // it inherits the sway and adds its own nod on top.
      const root = document.createElement("div");
      root.className = "rig-root";
      const bodyImage = document.createElement("img");
      bodyImage.src = pose.image.src;
      bodyImage.alt = "";
      const headLayer = document.createElement("div");
      headLayer.className = "rig-head-layer";
      const headImage = document.createElement("img");
      headImage.src = pose.image.src;
      headImage.alt = "";
      headLayer.append(headImage);
      root.append(bodyImage, headLayer);
      layer.append(root);
      rig.append(layer);
    }
    host.append(rig);

    // The CSS rig draws the same figure, so it blinks on the same schedule.
    const cssBlink = createBlink(host, {
      width: poses[0].image.naturalWidth,
      height: poses[0].image.naturalHeight,
      body: face?.body ?? null,
      eyes: face?.eyes ?? null,
      colour: Array.isArray(face?.skin) ? `rgb(${face.skin.join(",")})` : undefined,
    });
    if (cssBlink !== undefined) {
      const blinkStarted = performance.now();
      const blinkLoop = (now) => {
        if (!host.contains(rig)) return;
        cssBlink((now - blinkStarted) / 1000);
        timers.push(window.requestAnimationFrame(blinkLoop));
      };
      timers.push(window.requestAnimationFrame(blinkLoop));
    }

    // The same two moments the WebGL rig uses: once when it appears, once whenever the
    // pointer comes back to it. A flag rather than a timer, because CSS owns the
    // timeline here — removing it after the animation is all that is needed.
    const greet = () => {
      // Counted as well as flagged: the flag lives for 1.8 s, and whether a test happens
      // to sample inside that window is a race, not a fact about the page.
      rig.dataset.greets = String(Number(rig.dataset.greets ?? 0) + 1);
      delete rig.dataset.greet;
      // Reading offsetWidth flushes the style change, so re-adding the attribute
      // restarts the animation instead of being ignored as "already set".
      void rig.offsetWidth;
      rig.dataset.greet = "1";
    };
    greet();
    host.addEventListener("pointerenter", greet);
    host.addEventListener("pointerdown", () => greetByClick(current));
    timers.push(window.setTimeout(() => { delete rig.dataset.greet; }, 3400));

    if (poses.length > 1) {
      const layers = [...rig.children];
      let shown = 0;
      const advance = () => {
        delete layers[shown].dataset.shown;
        shown = (shown + 1) % layers.length;
        layers[shown].dataset.shown = "1";
        timers.push(window.setTimeout(advance, 5200));
      };
      timers.push(window.setTimeout(advance, 5200));
    }
    say("ok", `${label} 由分层 CSS 骨架驱动：源站不发 CORS 头，像素无法蒙皮，但量出的轮廓仍然给出了头和胯的位置。` + (poses.length > 1 ? ` 它的 ${String(poses.length)} 个姿势会轮流切换。` : " 发布一份本地副本即可获得完整骨骼。"));
  }
  /**
   * Draw the skeleton itself, for the selected look.
   *
   * This needs no pixels: the rig comes from the silhouette profile and the bounding
   * box, both of which are numbers in the catalogue. So it works for every look on
   * the published page, including the ones whose artwork the WebGL rig is not allowed
   * to touch — and it answers the question the artwork cannot, which is what the three
   * bones actually are and where they were put.
   *
   * The figure outline and the deformation mesh are drawn from the same rest-pose
   * measurements and are skinned by the same weights, so what is on screen is the rig
   * doing its work rather than an illustration of it.
   *
   * @param frames - one `{ box, profile }` per pose; the first is drawn.
   * @param label - what to caption it with.
   */
  function skeleton(frames, label) {
    stop();
    host.textContent = "";
    const frame = frames[0];
    const box = frame.box;
    const bones = buildRig(frame.profile, { rows: 18, cols: 12 });

    const canvas = document.createElement("canvas");
    skeletonCanvas = canvas;
    const width = SEAT.width;
    const height = SEAT.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${String(width)}px`;
    canvas.style.height = `${String(height)}px`;
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const style = getComputedStyle(document.documentElement);
    const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    const signal = read("--signal", "#6ea8e8");
    const dim = read("--dim", "#8b98a8");
    const text = read("--text", "#e6ecf4");

    // Fit the figure's bounding box into the seat, preserving its proportions.
    const scale = Math.min(width / box[2], height / box[3]);
    const offsetX = (width - box[2] * scale) / 2;
    const offsetY = (height - box[3] * scale) / 2;
    const toCanvas = (imageX, imageY) => ({
      x: (imageX - box[0]) * scale + offsetX,
      y: (imageY - box[1]) * scale + offsetY,
    });
    /** Normalised figure coordinates to canvas coordinates. */
    const at = (nx, ny) => toCanvas(box[0] + nx * box[2], box[1] + ny * box[3]);

    /** Apply one bone matrix to a point, in image space. */
    const apply = (matrix, point) => ({
      x: matrix[0] * point.x + matrix[3] * point.y + matrix[6],
      y: matrix[1] * point.x + matrix[4] * point.y + matrix[7],
    });
    /** Linear blend skinning: the same weighted sum the vertex shader performs. */
    const skin = (matrices, weights, point) => {
      let x = 0;
      let y = 0;
      for (let index = 0; index < 3; index++) {
        const moved = apply(matrices[index], point);
        x += weights[index] * moved.x;
        y += weights[index] * moved.y;
      }
      return { x, y };
    };
    const smoothstep = (edge0, edge1, value) => {
      const ratio = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
      return ratio * ratio * (3 - 2 * ratio);
    };

    const stride = bones.cols + 1;
    const started = performance.now();
    const loop = (now) => {
      raf = window.requestAnimationFrame(loop);
      const time = (now - started) / 1000;
      const matrices = poseRig(bones, box, { time, pokeAge: pokeAgeAt(performance.now()) });
      ctx.clearRect(0, 0, width, height);

      const skinnedAt = (index) => {
        const vertex = bones.vertices[index];
        const rest = { x: box[0] + vertex.x * box[2], y: box[1] + vertex.y * box[3] };
        const moved = skin(matrices, vertex.w, rest);
        return toCanvas(moved.x, moved.y);
      };

      // A person, drawn from the figure's own measurements.
      //
      // This used to trace the artwork's silhouette and lay a deformation mesh over it,
      // which showed the rig working but at the cost of reading as a grey blob with a
      // grid on it. A drawn figure says the same thing and looks like what it is: the
      // joints sit where this look's silhouette says they sit — a chibi's head lands at
      // half its height, a full-body portrait's at an eighth — and the limbs are placed
      // between them in ordinary human proportions. Skinned by the same weights, so the
      // figure bends with the rig rather than beside it.
      const weightsAt = (normalisedY) => {
        const head = smoothstep(bones.neck.y + RIG.band, bones.neck.y - RIG.band, normalisedY);
        const lower = smoothstep(RIG.hip - RIG.band, RIG.hip + RIG.band, normalisedY);
        const spine = Math.max(0, 1 - head - lower);
        const total = head + spine + lower;
        return [lower / total, spine / total, head / total];
      };
      const joint = (normalisedX, normalisedY) => {
        const rest = { x: box[0] + normalisedX * box[2], y: box[1] + normalisedY * box[3] };
        const moved = skin(matrices, weightsAt(normalisedY), rest);
        return toCanvas(moved.x, moved.y);
      };

      const neck = bones.neck.y;
      const hip = RIG.hip;
      const limb = Math.max(1.6, box[2] * 0.055);
      const torso = limb * 1.7;
      ctx.lineCap = "round";
      ctx.strokeStyle = dim;

      // Arms, then legs, then the spine over them — drawn back to front so the joins
      // read as one body rather than as overlapping sticks.
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = limb;
      const arm = (side) => {
        const shoulder = joint(0.5 + side * 0.15, neck + (hip - neck) * 0.08);
        const elbow = joint(0.5 + side * 0.22, neck + (hip - neck) * 0.55);
        const hand = joint(0.5 + side * 0.2, neck + (hip - neck) * 0.98);
        ctx.beginPath();
        ctx.moveTo(shoulder.x, shoulder.y);
        ctx.lineTo(elbow.x, elbow.y);
        ctx.lineTo(hand.x, hand.y);
        ctx.stroke();
      };
      const leg = (side) => {
        const top = joint(0.5 + side * 0.09, hip);
        const knee = joint(0.5 + side * 0.13, hip + (1 - hip) * 0.5);
        const foot = joint(0.5 + side * 0.12, 0.98);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(knee.x, knee.y);
        ctx.lineTo(foot.x, foot.y);
        ctx.stroke();
      };
      arm(-1);
      arm(1);
      leg(-1);
      leg(1);

      // The trunk, and a head sized to the neck the measurement found.
      ctx.globalAlpha = 0.62;
      ctx.lineWidth = torso;
      const top = joint(0.5, neck);
      const bottom = joint(0.5, hip);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.stroke();

      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      const skull = joint(0.5, neck * 0.5);
      // The head owns everything above the neck, so its diameter is that much: a chibi
      // gets a big head and a portrait a small one, both from the same measurement.
      const radius = Math.max(3, (neck * box[3] * scale) / 2 * 0.9);
      ctx.beginPath();
      ctx.arc(skull.x, skull.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = dim;
      ctx.fill();
      ctx.stroke();

      // The joints, so the figure reads as a skeleton rather than a pictogram.
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = text;
      for (const point of [joint(0.5, neck), joint(0.5, hip)]) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // The chain: root at the feet, spine at the hip, neck carrying the head. Each
      // joint is its own bone's pivot carried by that bone's matrix, which is what
      // puts the head on the end of the chain rather than beside it.
      const jointAt = (index) => {
        const bone = bones.bones[index].pivot;
        const rest = { x: box[0] + bone.x * box[2], y: box[1] + bone.y * box[3] };
        const moved = apply(matrices[index], rest);
        return toCanvas(moved.x, moved.y);
      };
      const joints = [jointAt(0), jointAt(1), jointAt(2), at(bones.bones[2].pivot.x, 0)];
      const alphas = [1, 0.72, 0.46];
      ctx.lineCap = "round";
      for (let index = 0; index < 3; index++) {
        ctx.strokeStyle = signal;
        ctx.globalAlpha = alphas[index];
        ctx.lineWidth = 3.2 - index * 0.6;
        ctx.beginPath();
        ctx.moveTo(joints[index].x, joints[index].y);
        ctx.lineTo(joints[index + 1].x, joints[index + 1].y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let index = 0; index < 3; index++) {
        ctx.beginPath();
        ctx.arc(joints[index].x, joints[index].y, 3.2 - index * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = text;
        ctx.fill();
        ctx.strokeStyle = signal;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      ctx.font = "600 8px ui-monospace, monospace";
      ctx.fillStyle = signal;
      ctx.globalAlpha = 0.85;
      const names = ["ROOT", "SPINE", "NECK"];
      for (let index = 0; index < 3; index++) {
        ctx.fillText(names[index], joints[index].x + 5, joints[index].y + 3);
      }
      ctx.globalAlpha = 1;
    };
    raf = window.requestAnimationFrame(loop);
    host.append(canvas);
    say("ok", `正在展示由 ${label} 推出的骨架：根在脚下，脊柱在胯，脖子在人物身高的 ${(findNeck(frame.profile).y * 100).toFixed(0)}% 处 —— 这是从轮廓收窄处<em>找</em>出来的，不是写死的。网格由这三根骨头蒙皮，算法与顶点着色器同源。`);
  }

  /**
   * Show the skeleton for one look.
   *
   * Resolved from whichever source this page has, exactly as `show` does — but the
   * skeleton needs only the bounding box and the silhouette profile, both of which
   * are numbers. No image loads and no CORS is involved, which is why this works for
   * every look on the published page, including the ones whose pixels WebGL refuses.
   */
  async function useSkeleton(characterId, lookId) {
    const mine = (generation += 1);
    const hosted = index === undefined ? [] : index.looks.filter((look) => look.character === characterId);
    const baked = (catalogue?.looks ?? []).filter((look) => look.character === characterId);
    const fromHost = hosted.find((look) => look.id === lookId) ?? hosted[0];
    const fromCatalogue = baked.find((look) => look.id === lookId) ?? baked[0];

    if (fromHost !== undefined) {
      const frames = fromHost.frames
        .map((frame) => ({ box: frame.measured?.box, profile: frame.profile }))
        .filter((frame) => Array.isArray(frame.box) && Array.isArray(frame.profile));
      if (frames.length > 0) {
        skeleton(frames, fromHost.nameEn ?? fromHost.id);
        return true;
      }
    }
    if (fromCatalogue !== undefined) {
      const frames = fromCatalogue.frames.filter((frame) => Array.isArray(frame.box) && Array.isArray(frame.profile));
      if (frames.length > 0) {
        skeleton(frames, fromCatalogue.nameEn ?? fromCatalogue.id);
        return true;
      }
    }
    notice("这套形象没有量出轮廓，所以没有骨架可画。");
    return false;
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
  function rig(image, profile, box, face) {
    stop();
    const bones = buildRig(profile, { rows: 26, cols: 18 });
    const built = createSkinner(image, bones, { width: SEAT.width, left: 0, top: 0 }, box, SEAT);
    if (built === undefined) {
      still(image);
      say("warn", `这个浏览器起不了渲染器，预览退回静态图（${String(rigStatus() ?? "未报告原因")}）。`);
      return false;
    }
    skinner = built;
    host.textContent = "";
    host.append(skinner.canvas);
    // Lids over the eyes. `face` carries the body box and the eye boxes; without them
    // there is simply nothing to blink, which is better than blinking in the wrong place.
    const blink = createBlink(host, {
      width: image.naturalWidth,
      height: image.naturalHeight,
      body: face?.body ?? null,
      eyes: face?.eyes ?? null,
      colour: Array.isArray(face?.skin) ? `rgb(${face.skin.join(",")})` : undefined,
    });
    skinner.canvas.style.width = `${String(SEAT.width)}px`;
    skinner.canvas.style.height = `${String(SEAT.height)}px`;
    skinner.canvas.style.display = "block";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    skinner.resize(Math.round(SEAT.width * dpr), Math.round(SEAT.height * dpr));
    const started = performance.now();
    const loop = (now) => {
      raf = window.requestAnimationFrame(loop);
      const elapsed = (now - started) / 1000;
      skinner.draw(poseRig(bones, box, { time: elapsed, pokeAge: pokeAgeAt(now) }));
      blink?.(elapsed);
    };
    raf = window.requestAnimationFrame(loop);
    // The same click pokes it and speaks it, on both render paths.
    host.addEventListener("pointerdown", () => greetByClick(current));
    return true;
  }

  /** Render whichever supplied image is active. */
  function showOverride() {
    host.textContent = "";
    return rig(override.image, override.measured.profile, override.measured.box, override.measured);
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
    const mine = (generation += 1);
    const url = URL.createObjectURL(file);
    const image = await loadImage(url);
    URL.revokeObjectURL(url);
    if (stale(mine)) return false;
    if (image === undefined) {
      say("error", "这个文件解不出图像。");
      return false;
    }
    const measured = measure(image);
    if (measured === undefined) {
      say("error", "这张图完全透明，没有东西可绑。");
      return false;
    }
    override = { image, measured };
    showOverride();
    say("ok", `正在为 ${file.name}（${String(image.naturalWidth)}×${String(image.naturalHeight)}）绑骨。测量与动画都在这个标签页里完成，文件没有被上传。`);
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
    const mine = (generation += 1);
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
    if (stale(mine)) return false;
    if (image === undefined) {
      say("error", "内置测试图案画不出来。");
      return false;
    }
    const measured = measure(image);
    if (measured === undefined) {
      say("error", "测试图案量出来是空的，这不应该发生。");
      return false;
    }
    // Recorded as an override, exactly like a chosen file: `show` runs on every
    // console render, so without this the pattern would vanish the first time the
    // visitor switched character.
    override = { image, measured };
    const rigged = showOverride();
    say(rigged ? "ok" : "warn", rigged
      ? "正在渲染内置测试图案：测量 → 自动绑骨 → 蒙皮动画，全部在这个标签页里完成。从你自己的 DSH 打开同一个配置台，就能看到你装好的素材。"
      : "这个浏览器起不了渲染器，测试图案退回了静态图。");
    return rigged;
  }

  /**
   * Show one look, from whichever source this page has.
   *
   * Two lives, one entry point: served by the plugin there is a host to ask, and on
   * the published copy there is the bundled catalogue plus the artwork's own
   * sources. The caller does not have to know which.
   *
   * @param characterId - the selected character.
   * @param lookId - the selected look, or undefined for the character's first.
   */
  async function show(characterId, lookId) {
    const mine = (generation += 1);
    // Remembered here rather than passed down: the CSS rig has no idea which character it
    // is drawing, and a click needs to know whose line to speak.
    current = characterId;
    if (override !== undefined) {
      showOverride();
      return;
    }
    if (index !== undefined) {
      await showFromHost(characterId, lookId, mine);
      return;
    }
    await showFromSources(characterId, lookId, mine);
  }

  /** Render a look served by the plugin on this origin. */
  async function showFromHost(characterId, lookId, mine) {
    const looks = index.looks.filter((look) => look.character === characterId);
    const look = looks.find((entry) => entry.id === lookId) ?? looks[0];
    stop();
    host.textContent = "";
    if (look === undefined) {
      notice(`你的 DSH 里没有装 "${characterId}" 的素材。在那边跑 \`npm run fetch-art\`，或者换一位角色。`);
      return;
    }
    const frame = look.frames[0];
    const image = await loadImage(`${origin}${index.artBase}/${frame.file}`);
    if (stale(mine)) return;
    if (image === undefined) {
      notice(`${frame.file} did not load.`);
      return;
    }
    const box = frame.measured?.box;
    if (Array.isArray(frame.profile) && Array.isArray(box)) {
      rig(image, frame.profile, box, { body: frame.body, eyes: frame.eyes, skin: frame.skin });
    } else {
      still(image);
      say("warn", `${look.id} 没有量出轮廓，预览退回静态图。请在插件目录跑 \`npm run art:sync\`。`);
    }
  }

  /** Render a look on the published copy, where only the sources have the pixels. */
  async function showFromSources(characterId, lookId, mine) {
    const looks = (catalogue?.looks ?? []).filter((look) => look.character === characterId);
    const look = looks.find((entry) => entry.id === lookId) ?? looks[0];
    stop();
    host.textContent = "";
    if (look === undefined) {
      notice("这位角色没有可预览的形象。");
      return;
    }
    const acquired = [];
    for (const frame of look.frames) {
      const got = await acquire(frame, look);
      if (stale(mine)) return;
      if (got === undefined) {
        notice(`${look.name ?? look.nameEn ?? look.id} 无法从源站加载。可能文件挪了位置，或者源站挡住了这个页面。`);
        say("error", `${String(look.sources?.[0] ?? look.id)} 加载失败。`);
        return;
      }
      acquired.push({ ...got, frame });
    }
    const first = acquired[0];
    // Report only once the frame is actually on screen. Reporting first would light
    // the badge before anything exists to look at, which reads as "not connected" on
    // a page that is showing the character perfectly well.
    const boxes = acquired.every((entry) => Array.isArray(entry.frame.box) && Array.isArray(entry.frame.profile));
    if (first.riggable && boxes) {
      rig(first.image, first.frame.profile, first.frame.box, { body: first.frame.body, eyes: first.frame.eyes, skin: first.frame.skin });
      say("ok", `正在显示 ${look.name ?? look.nameEn ?? look.id}，由插件同一套骨架绑定驱动。`);
      return;
    }
    if (boxes && Array.isArray(first.frame.profile)) {
      // No CORS header means no texture, so the WebGL rig cannot touch these
      // pixels — but the measured silhouette still says where the neck and hip are,
      // and that is enough to compose two masked layers into a moving figure.
      // A frame fetched by URL is the whole download, so the crop rectangle tells the
      // rig which part of it this is. A frame read from a local file is already the
      // crop, and offsetting it again would push it out of the box.
      cssRig(
        acquired.map((entry) => ({
          image: entry.image,
          frame: { ...entry.frame, crop: entry.alreadyCropped ? null : entry.frame.crop },
        })),
        look.nameEn ?? look.id,
        // The eye boxes and skin tone travel with the frames: the CSS rig draws the same
        // figure as the WebGL one, so it blinks the same way.
        { body: first.frame.body, eyes: first.frame.eyes, skin: first.frame.skin },
      );
      return;
    }
    still(first.image);
    say("warn", `${look.name ?? look.nameEn ?? look.id} 原样显示：没有为它量出轮廓。`);
  }

  return {
    detect,
    show,
    useFile,
    useSkeleton,
    useTestPattern,
    stop,
    /**
     * Drop a chosen file or the test pattern, and report whether there was one.
     *
     * The caller needs to know: the frame changes, so any record of what it holds is
     * no longer true.
     */
    clearOverride: () => {
      if (override === undefined) return false;
      override = undefined;
      return true;
    },
    /** Hand the preview the published catalogue, so it can work without a host. */
    setCatalogue: (value) => {
      catalogue = value;
    },
    /** Let the console report the outcome of a sequence it drove itself. */
    report: (message, kind = "ok") => say(kind, message),
    isLive: () => index !== undefined,
  };
}
