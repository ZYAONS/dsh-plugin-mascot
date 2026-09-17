#!/usr/bin/env node
/**
 * 从明日方舟的官方 Spine 小人里量出动作，写进 art/motion.json。
 *
 * 为什么要有这个：这个项目自己那套待机是三条正弦叠出来的，读起来死板 —— 因为它是编的。
 * 官方小人（Spine 3.8.99）里有真实的动作曲线，可以量。量出来的东西进仓库，模型不进。
 *
 *   npm run measure:motion
 *
 * 需要的东西都在缓存目录里现取，取完就不动：
 *   - 官方 3.8 运行时（spine-runtimes 3.8 分支的 spine-core.js）
 *   - 模型（Ark-Models 里的 .skel / .atlas）
 * 两者都不进仓库 —— 前者是别人的运行时，后者是鹰角的美术资源。
 *
 * 输出的 art/motion.json 只是**数字**：某根骨头在某段时间里的角度序列。和 art/index.json
 * 里的轮廓剖面一样，是测量结果，不是素材。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cache = join(root, "art", ".motion-cache");

/** 要量的模型：可露希尔的小人，方舟里代号 4228_closur。 */
const MODEL = {
  id: "4228_closur",
  base: "https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/4228_closur",
  files: ["build_char_4228_closur.skel", "build_char_4228_closur.atlas"],
};
const RUNTIME = "https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/3.8/spine-ts/build/spine-core.js";

/** 要抽的骨头，用方舟的命名。键是我们这边的语义名。 */
const CHANNELS = {
  waist: "F_Waist_I",
  chest: "F_Chest_I",
  head: "F_Head_I",
  forearm: "F_L_Forearm_I",
  upperArm: "F_L_Arm_II",
  leg: "F_L_Leg_I",
};

/** 要量的动画：键是我们这边的语义名。 */
const ANIMATIONS = {
  idle: "Relax",
  greet: "Interact",
};

/** 下载到缓存目录，已存在就跳过。 */
async function fetchCached(url, file) {
  const target = join(cache, file);
  if (existsSync(target)) return target;
  const response = await fetch(url, { headers: { "user-agent": "dsh-plugin-mascot/0.1" }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${url} → HTTP ${String(response.status)}`);
  const body = Buffer.from(await response.arrayBuffer());
  writeFileSync(target, body);
  console.log(`  fetched ${file} (${String(body.length)} bytes)`);
  return target;
}

/** 在沙箱里加载官方运行时。它用一个 IIFE 挂到全局 spine 上。 */
function loadRuntime(source) {
  const context = {
    console, Math, JSON, Array, Object, String, Number, Boolean,
    Uint8Array, Float32Array, Int32Array, Uint16Array, DataView, ArrayBuffer,
    isNaN, parseInt, parseFloat, Error, TypeError,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "spine-core.js" });
  if (context.spine === undefined) throw new Error("运行时没有导出 spine");
  return context.spine;
}

/** 附件需要 region 才能算 UV；不加载贴图，给个最小对象即可。 */
function attachmentLoader(spine) {
  const attach = (node) => {
    node.region = {
      u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1,
      originalWidth: 1, originalHeight: 1, rotate: false, degrees: 0, texture: null, name: node.name,
    };
    return node;
  };
  return {
    newRegionAttachment: (_skin, name) => attach(new spine.RegionAttachment(name)),
    newMeshAttachment: (_skin, name) => attach(new spine.MeshAttachment(name)),
    newBoundingBoxAttachment: (_skin, name) => new spine.BoundingBoxAttachment(name),
    newPathAttachment: (_skin, name) => new spine.PathAttachment(name),
    newPointAttachment: (_skin, name) => new spine.PointAttachment(name),
    newClippingAttachment: (_skin, name) => new spine.ClippingAttachment(name),
  };
}

mkdirSync(cache, { recursive: true });
console.log("measure-motion: 取运行时与模型（缓存于 art/.motion-cache/）");
const runtimePath = await fetchCached(RUNTIME, "spine-core.js");
const modelPaths = [];
for (const file of MODEL.files) modelPaths.push(await fetchCached(`${MODEL.base}/${file}`, file));

const spine = loadRuntime(readFileSync(runtimePath, "utf8"));
const skelPath = modelPaths.find((path) => path.endsWith(".skel"));
const data = new spine.SkeletonBinary(attachmentLoader(spine)).readSkeletonData(new Uint8Array(readFileSync(skelPath)));
console.log(`  模型 ${String(data.bones.length)} 根骨头，${String(data.animations.length)} 段动画`);

/** 抽一根骨头在某段动画里的旋转关键帧，线性重采样到固定密度。 */
function channel(animation, boneName, step) {
  const boneIndex = data.bones.findIndex((bone) => bone.name === boneName);
  if (boneIndex < 0) return null;
  for (const timeline of animation.timelines ?? []) {
    if (!(timeline instanceof spine.RotateTimeline) || timeline.boneIndex !== boneIndex) continue;
    const keys = [];
    for (let i = 0; i < timeline.frames.length; i += 2) keys.push([timeline.frames[i], timeline.frames[i + 1]]);
    // 线性重采样：只在需要采样的那一层插值，够用，而且比存贝塞尔简单得多。
    const samples = [];
    const count = Math.max(2, Math.round(animation.duration / step));
    for (let index = 0; index <= count; index++) {
      const time = (index / count) * animation.duration;
      let value = keys[keys.length - 1][1];
      for (let k = 0; k < keys.length; k++) {
        if (keys[k][0] <= time) continue;
        const [t0, v0] = keys[k - 1];
        const [t1, v1] = keys[k];
        const ratio = t1 === t0 ? 0 : (time - t0) / (t1 - t0);
        value = v0 + (v1 - v0) * ratio;
        break;
      }
      samples.push(Number(value.toFixed(3)));
    }
    return samples;
  }
  return null;
}

/**
 * 眨眼时序：所有睫毛骨在每一帧上的角度合计，取平均。
 *
 * 这是官方小人真正的眨眼 —— 睫毛骨转 20 度左右，眼睛就闭上了。峰值出现的时间点就是
 * 眨眼发生的时刻，单次约 0.6 秒。
 */
function blink(animation, step) {
  const lashes = data.bones.map((bone, index) => ({ index })).filter(({ index }) => /Eyelash/i.test(data.bones[index].name));
  if (lashes.length === 0) return null;
  const count = Math.max(2, Math.round(animation.duration / step));
  const samples = [];
  for (let index = 0; index <= count; index++) {
    const time = (index / count) * animation.duration;
    let total = 0;
    let seen = 0;
    for (const { index: boneIndex } of lashes) {
      for (const timeline of animation.timelines ?? []) {
        if (!(timeline instanceof spine.RotateTimeline) || timeline.boneIndex !== boneIndex) continue;
        let value = 0;
        for (let i = 0; i < timeline.frames.length; i += 2) {
          if (timeline.frames[i] > time) break;
          value = timeline.frames[i + 1];
        }
        total += Math.abs(value);
        seen += 1;
        break;
      }
    }
    samples.push(Number((seen === 0 ? 0 : total / seen).toFixed(3)));
  }
  return samples;
}

const STEP = 0.08;
const motion = {
  source: `Arknights Spine ${data.version} · ${MODEL.id} · Ark-Models`,
  step: STEP,
  bones: CHANNELS,
  animations: {},
};

for (const [key, name] of Object.entries(ANIMATIONS)) {
  const animation = data.animations.find((entry) => entry.name === name);
  if (animation === undefined) {
    console.warn(`  跳过 ${name}：模型里没有这段动画`);
    continue;
  }
  const channels = {};
  for (const [semantic, boneName] of Object.entries(CHANNELS)) {
    const samples = channel(animation, boneName, STEP);
    if (samples !== null) channels[semantic] = samples;
  }
  const blinks = blink(animation, STEP);
  motion.animations[key] = {
    name,
    duration: Number(animation.duration.toFixed(3)),
    channels,
    blink: blinks,
  };
  const summary = Object.entries(channels)
    .map(([semantic, samples]) => `${semantic} ${(Math.max(...samples) - Math.min(...samples)).toFixed(1)}°`)
    .join("  ");
  console.log(`  ${key} (${name}, ${animation.duration.toFixed(2)}s): ${summary}`);
}

const target = join(root, "art", "motion.json");
writeFileSync(target, `${JSON.stringify(motion, null, 2)}\n`);
console.log(`measure-motion: 写入 ${target}`);
