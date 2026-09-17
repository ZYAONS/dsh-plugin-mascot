#!/usr/bin/env node
/**
 * Measure the game's own idle animation, so the rig's numbers are a reading rather
 * than an opinion.
 *
 *   npm run rig:reference                    # Closure's base chibi
 *   npm run rig:reference -- 4228_closur Relax
 *
 * Arknights ships its base chibi as Spine 3.8 models, and they are readable —
 * [`Ark-Models`](https://github.com/isHarryh/Ark-Models) mirrors them, and the official
 * 3.8 runtime parses them. This samples one animation's bones over its length and
 * reports the amplitude and period of each, which is what `poseRig` in `lib/client.js`
 * is tuned to.
 *
 * Two things are deliberately *not* downloaded. The repository is about a gigabyte, so
 * only the single `.skel` is fetched; and the texture atlas and PNG are skipped
 * entirely, because nothing is rendered — the reader is given the real attachment
 * classes with a dummy texture region, which is enough to satisfy its bookkeeping.
 *
 * Neither the runtime nor the model is committed: both land in `.cache/spine`, which
 * `.gitignore` excludes. The runtime is Spine's, under the Spine Runtimes License; the
 * models are Hypergryph's, and this project redistributes neither.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, ".cache", "spine");
const model = process.argv[2] ?? "4228_closur";
const animationName = process.argv[3] ?? "Relax";

const RUNTIME_URL = "https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/3.8/spine-ts/build/spine-core.js";
const MODEL_URL = `https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/${model}/build_char_${model}.skel`;

/** Fetch to a cache path, once. */
async function cached(url, file, describe) {
  if (existsSync(file)) return readFileSync(file);
  process.stdout.write(`rig-reference: fetching ${describe}… `);
  const response = await fetch(url);
  if (!response.ok) {
    console.log("failed");
    throw new Error(`${describe}: HTTP ${String(response.status)} from ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  console.log(`${(bytes.length / 1024).toFixed(0)} KB`);
  return bytes;
}

const runtimeSource = await cached(RUNTIME_URL, join(cache, "spine-core-3.8.cjs"), "the Spine 3.8 runtime");
// The build is a browser global, not a module. Appending an export is the whole
// adaptation it needs.
if (!runtimeSource.toString("utf8").includes("module.exports = spine;")) {
  writeFileSync(join(cache, "spine-core-3.8.cjs"), `${runtimeSource.toString("utf8")}\nmodule.exports = spine;\n`);
}
const skeletonBytes = await cached(MODEL_URL, join(cache, `${model}.skel`), `${model}.skel`);

const spine = createRequire(import.meta.url)(join(cache, "spine-core-3.8.cjs"));

/**
 * The artwork is not wanted here, only the bones and the curves. A dummy region lets
 * `MeshAttachment.updateUVs` do its arithmetic without an atlas, and the real
 * attachment classes are used because the reader sets properties on them.
 */
const dummyRegion = {
  u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, degrees: 0, rotate: false,
  originalWidth: 1, originalHeight: 1, offsetX: 0, offsetY: 0,
};
const loader = {
  newRegionAttachment: (name) => { const a = new spine.RegionAttachment(name); a.region = dummyRegion; return a; },
  newMeshAttachment: (name) => { const a = new spine.MeshAttachment(name); a.region = dummyRegion; return a; },
  newBoundingBoxAttachment: (name) => new spine.BoundingBoxAttachment(name),
  newPathAttachment: (name) => new spine.PathAttachment(name),
  newPointAttachment: (name) => new spine.PointAttachment(name),
  newClippingAttachment: (name) => new spine.ClippingAttachment(name),
};

const data = new spine.SkeletonBinary(loader).readSkeletonData(new Uint8Array(skeletonBytes));
console.log(`rig-reference: ${model} — ${String(data.bones.length)} bones, ${String(data.slots.length)} slots, ${String(data.animations.length)} animations`);
console.log(`               ${data.animations.map((entry) => entry.name).join(", ")}`);

const animation = data.animations.find((entry) => entry.name === animationName);
if (animation === undefined) {
  console.error(`rig-reference: no animation named ${JSON.stringify(animationName)}`);
  console.error(`               the model has: ${data.animations.map((entry) => entry.name).join(", ")}`);
  process.exit(1);
}

// The bones a three-bone rig corresponds to: the hip carries the body, the head leads
// it. Looked up by name rather than by index, because the indices are not stable.
const findBone = (pattern) => data.bones.find((bone) => pattern.test(bone.name))?.name;
const watched = [
  ["hip", findBone(/waist/i) ?? findBone(/hip|pelvis/i)],
  ["chest", findBone(/chest/i)],
  ["head", findBone(/head/i) ?? findBone(/neck/i)],
].filter(([, name]) => name !== undefined);

const skeleton = new spine.Skeleton(data);
const state = new spine.AnimationState(new spine.AnimationStateData(data));
state.setAnimation(0, animationName, true);
skeleton.setToSetupPose();
state.apply(skeleton);
skeleton.updateWorldTransform();

const STEPS = 240;
const dt = animation.duration / STEPS;
const series = new Map(watched.map(([, name]) => [name, []]));
for (let step = 0; step < STEPS; step++) {
  state.update(dt);
  state.apply(skeleton);
  skeleton.updateWorldTransform();
  for (const [, name] of watched) {
    const bone = skeleton.findBone(name);
    if (bone !== null && bone !== undefined) series.get(name).push({ rotation: bone.worldRotationX ?? bone.rotation, y: bone.worldY });
  }
}

/** Amplitude and the period the motion actually runs at, from zero crossings. */
function describe(points) {
  const rotations = points.map((point) => point.rotation);
  const ys = points.map((point) => point.y);
  const span = Math.max(...rotations) - Math.min(...rotations);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  const mean = rotations.reduce((sum, value) => sum + value, 0) / rotations.length;
  let crossings = 0;
  for (let index = 1; index < rotations.length; index++) {
    if ((rotations[index - 1] - mean) * (rotations[index] - mean) < 0) crossings += 1;
  }
  const cycles = crossings / 2;
  return {
    rotation: span / 2,
    y: ySpan / 2,
    period: cycles > 0.2 ? animation.duration / cycles : undefined,
  };
}

console.log(`\n${animationName}: ${animation.duration.toFixed(2)} s, ${String(STEPS)} samples\n`);
console.log("  bone                     rotation        y        period");
for (const [label, name] of watched) {
  const points = series.get(name);
  if (points.length === 0) continue;
  const measured = describe(points);
  console.log(
    `  ${`${label} (${name})`.padEnd(22)} ±${measured.rotation.toFixed(2)}°`.padEnd(38)
    + `±${measured.y.toFixed(2)}`.padEnd(9)
    + (measured.period === undefined ? "—" : `${measured.period.toFixed(2)} s`),
  );
}
console.log("\nrig-reference: lib/client.js's poseRig is tuned to the period and the order of");
console.log("               magnitude, not to the degrees — the game rigs hundreds of bones and");
console.log("               the plugin rigs three, so an angle does not mean the same thing in both.");
