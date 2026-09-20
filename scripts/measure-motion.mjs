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

/**
 * 要量的模型：可露希尔的小人，方舟里代号 4228_closur。
 *
 * `--model=<id>` 换成任意一个 Ark-Models 里的模型。骨骼名与动画名是方舟统一的，
 * 所以换模型不用换别的配置；但动画名每个角色不一样，`--list` 就是用来先看一眼的。
 */
const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((entry) => entry === `--${name}` || entry.startsWith(`--${name}=`));
  if (hit === undefined) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : true;
};
const MODEL_ID = flag("model") ?? "4228_closur";
const MODEL = {
  id: MODEL_ID,
  base: `https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/${MODEL_ID}`,
  files: [`build_char_${MODEL_ID}.skel`, `build_char_${MODEL_ID}.atlas`],
};
const RUNTIME = "https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/3.8/spine-ts/build/spine-core.js";

/**
 * 要抽的骨头，用方舟的命名。键是我们这边的语义名。
 *
 * 每项是一串候选名，按顺序取第一个存在的。方舟的小人骨架有两代命名：老一代带 `_I`
 * 后缀（可露希尔那批，`F_Waist_I`），新一代去掉了（`F_Waist`）。写死一个名字的后果不是
 * 报错，而是**通道静默为空** —— 看起来就像这个角色根本不动。
 */
const CHANNEL_NAMES = {
  waist: ["F_Waist_I", "F_Waist"],
  chest: ["F_Chest_I", "F_Chest"],
  head: ["F_Head_I", "F_Head", "F_Face"],
  // 三代骨架三套叫法：老 `F_L_Forearm_I` / `F_L_Arm_II`、新 `F_L_Arm_A` / `F_L_Arm_B`、
  // 联动那种最简的 `F_L_Forearm` / `F_L_Arm`。`F_L_HandHold` 是新骨架的握持点。
  forearm: ["F_L_Forearm_I", "F_L_Arm_B", "F_L_Forearm"],
  upperArm: ["F_L_Arm_II", "F_L_Arm_I", "F_L_Arm_A", "F_L_Arm"],
  leg: ["F_L_Leg_I", "F_L_Leg_A", "F_L_Leg"],
};

/** 要量的动画：键是我们这边的语义名。`--anims=idle:Relax,greet:Interact` 可以覆盖。 */
const ANIMATIONS = (() => {
  const override = flag("anims");
  if (typeof override !== "string" || override === "") return { idle: "Relax", greet: "Interact" };
  const map = {};
  for (const pair of override.split(",")) {
    const [key, name] = pair.split(":");
    if (key !== undefined && name !== undefined && key !== "" && name !== "") map[key] = name;
  }
  return Object.keys(map).length > 0 ? map : { idle: "Relax", greet: "Interact" };
})();

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

/** 这份骨架里实际存在的骨头名，语义键 → 骨头名。缺失的会被报出来而不是悄悄跳过。 */
const CHANNELS = {};
for (const [semantic, candidates] of Object.entries(CHANNEL_NAMES)) {
  const found = candidates.find((name) => data.bones.some((entry) => entry.name === name));
  if (found === undefined) {
    console.warn(`  警告：${semantic} 一个候选都没有 —— ${candidates.join(" / ")}`);
    continue;
  }
  CHANNELS[semantic] = found;
}

// `--bones` is the other half of `--list`: a model's bone names are as unguessable as its
// animation names, and a channel that silently finds nothing looks exactly like a character
// who does not move.
if (flag("bones") !== undefined) {
  for (const [semantic, candidates] of Object.entries(CHANNEL_NAMES)) {
    console.log(`  ${semantic in CHANNELS ? "ok  " : "MISS"} ${semantic.padEnd(9)} ${candidates.join(" | ")}`);
  }
  const interesting = data.bones.map((entry) => entry.name).filter((name) => /Arm|Forearm|Hand|Leg|Waist|Chest|Head/i.test(name));
  console.log(`\n相关的骨头（${String(interesting.length)}）:\n  ${interesting.join(", ")}`);
  process.exit(0);
}

// `--list` stops here: which animations a model has is the one thing you cannot guess, and
// picking the two worth measuring is a job for a person looking at the names.
if (flag("list") !== undefined) {
  console.log(`\n${MODEL_ID} 的动画（时长秒）:`);
  for (const animation of data.animations) {
    console.log(`  ${animation.name.padEnd(28)} ${animation.duration.toFixed(2)}`);
  }
  process.exit(0);
}

/**
 * `--moves` answers "where is the character-specific bit?".
 *
 * The six rotation channels above cover the body, and a character whose arms barely move in
 * them is not necessarily a character who does nothing — a prop (a floating stone, a
 * summoning device) is usually a bone animated by **translation**, or an attachment that
 * hangs off one. Neither shows up in a rotate-only measurement.
 */
if (flag("moves") !== undefined) {
  for (const animation of data.animations) {
    const rotating = [];
    const translating = [];
    const scaling = [];
    for (const timeline of animation.timelines ?? []) {
      const name = data.bones[timeline.boneIndex]?.name ?? `#${String(timeline.boneIndex)}`;
      if (timeline instanceof spine.RotateTimeline) rotating.push(name);
      else if (timeline instanceof spine.TranslateTimeline) translating.push(name);
      else if (timeline instanceof spine.ScaleTimeline) scaling.push(name);
    }
    console.log(`\n${animation.name} (${animation.duration.toFixed(2)}s)`);
    console.log(`  位移 ${String(translating.length)}: ${translating.slice(0, 14).join(", ")}`);
    console.log(`  缩放 ${String(scaling.length)}: ${scaling.slice(0, 8).join(", ")}`);
    console.log(`  旋转 ${String(rotating.length)}`);
  }
  process.exit(0);
}

/**
 * 道具通道：用**位移**驱动的骨头。
 *
 * 望的招牌动作是他手里那颗悬浮的黑棋，而它是一根叫 `C_Chess_Black` 的骨头，靠位移动 ——
 * 六个旋转通道里完全看不见（他的上臂整段动画只转 1.8°）。只量旋转的话，这个角色看起来
 * 就是站着不动，而实际上他最有辨识度的那一下就在数据里。
 */
const PROP_CHANNELS = {
  chess: ["C_Chess_Black", "C_Chess_White"],
};

/** 这份骨架里实际存在的道具骨头。 */
const PROPS = {};
for (const [semantic, candidates] of Object.entries(PROP_CHANNELS)) {
  const found = candidates.find((name) => data.bones.some((entry) => entry.name === name));
  if (found !== undefined) PROPS[semantic] = found;
}

/**
 * 一根骨头在某段动画里的**位移**关键帧，重采样到与旋转相同的密度。
 *
 * TranslateTimeline 每帧是 `[时间, x, y]`，所以一圈下来是两条序列。返回 `{ x, y }`，
 * 单位是骨架自己的单位（方舟小人的骨架按像素走），不是度 —— 调用方要清楚这一点。
 */
function translations(animation, boneName, step) {
  const boneIndex = data.bones.findIndex((bone) => bone.name === boneName);
  if (boneIndex < 0) return null;
  for (const timeline of animation.timelines ?? []) {
    if (!(timeline instanceof spine.TranslateTimeline) || timeline.boneIndex !== boneIndex) continue;
    const keys = [];
    for (let i = 0; i < timeline.frames.length; i += 3) {
      keys.push([timeline.frames[i], timeline.frames[i + 1], timeline.frames[i + 2]]);
    }
    if (keys.length === 0) return null;
    const count = Math.max(2, Math.round(animation.duration / step));
    const xs = [];
    const ys = [];
    for (let index = 0; index <= count; index++) {
      const time = (index / count) * animation.duration;
      let x = keys[keys.length - 1][1];
      let y = keys[keys.length - 1][2];
      for (let k = 0; k < keys.length; k++) {
        if (keys[k][0] <= time) continue;
        const [t0, x0, y0] = keys[k - 1];
        const [t1, x1, y1] = keys[k];
        const ratio = t1 === t0 ? 0 : (time - t0) / (t1 - t0);
        x = x0 + (x1 - x0) * ratio;
        y = y0 + (y1 - y0) * ratio;
        break;
      }
      xs.push(Number(x.toFixed(3)));
      ys.push(Number(y.toFixed(3)));
    }
    return { x: xs, y: ys };
  }
  return null;
}

function channel(animation, boneName, step) {
  const boneIndex = data.bones.findIndex((bone) => bone.name === boneName);
  if (boneIndex < 0) return null;
  for (const timeline of animation.timelines ?? []) {
    if (!(timeline instanceof spine.RotateTimeline) || timeline.boneIndex !== boneIndex) continue;
    const keys = [];
    for (let i = 0; i < timeline.frames.length; i += 2) keys.push([timeline.frames[i], timeline.frames[i + 1]]);
    /**
     * 关键帧先解回绕。
     *
     * Spine 每个关键帧存的是**绝对角度**，所以动画师写出 ±180 的另一侧时，相邻两帧的数值
     * 会差一整圈。直接插值的话骨骼会真的转完那一圈 —— 结城理 idle 的上臂因此量出 362.3°，
     * 而那段动画其实是站着不动。把每一帧挪到离前一帧半圈以内，插值就跟着动画师画的那条
     * 短路径走了。
     *
     * 可露希尔的数字一直很小，所以这个坑在她身上从来没露出来过。
     */
    const unwrapped = [keys[0]];
    for (let k = 1; k < keys.length; k++) {
      let value = keys[k][1];
      const previous = unwrapped[k - 1][1];
      while (value - previous > 180) value -= 360;
      while (value - previous < -180) value += 360;
      unwrapped.push([keys[k][0], value]);
    }
    // 线性重采样：只在需要采样的那一层插值，够用，而且比存贝塞尔简单得多。
    const samples = [];
    const count = Math.max(2, Math.round(animation.duration / step));
    for (let index = 0; index <= count; index++) {
      const time = (index / count) * animation.duration;
      let value = unwrapped[unwrapped.length - 1][1];
      for (let k = 0; k < unwrapped.length; k++) {
        if (unwrapped[k][0] <= time) continue;
        const [t0, v0] = unwrapped[k - 1];
        const [t1, v1] = unwrapped[k];
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
  const props = {};
  for (const [semantic, boneName] of Object.entries(PROPS)) {
    const moved = translations(animation, boneName, STEP);
    if (moved !== null) props[semantic] = moved;
  }
  motion.animations[key] = {
    name,
    duration: Number(animation.duration.toFixed(3)),
    channels,
    blink: blinks,
    ...(Object.keys(props).length > 0 ? { props } : {}),
  };
  const summary = Object.entries(channels)
    .map(([semantic, samples]) => `${semantic} ${(Math.max(...samples) - Math.min(...samples)).toFixed(1)}°`)
    .join("  ");
  const propSummary = Object.entries(props)
    .map(([semantic, moved]) => {
      const span = (values) => (Math.max(...values) - Math.min(...values)).toFixed(1);
      return `${semantic} Δ${span(moved.x)},${span(moved.y)}`;
    })
    .join("  ");
  console.log(`  ${key} (${name}, ${animation.duration.toFixed(2)}s): ${summary}${propSummary === "" ? "" : `  |  ${propSummary}`}`);
}

const target = typeof flag("out") === "string" ? join(root, flag("out")) : join(root, "art", "motion.json");
writeFileSync(target, `${JSON.stringify(motion, null, 2)}\n`);
console.log(`measure-motion: 写入 ${target}`);
// `--out` means "measure this other character": the anatomy file holds this project's own
// ratios for the character the dock is drawn from, and overwriting it with a different
// model's proportions would silently change how every character is drawn.
if (typeof flag("out") === "string") {
  console.log("measure-motion: 指定了 --out，跳过解剖比例（那是给主形象用的）");
  process.exit(0);
}

/**
 * 解剖比例：眼睛、胯、胸、颈各在身高的几分之几处。
 *
 * 以脚底为原点、身高为单位。不能用骨头包围盒归一化 —— 那个盒子被触手之类的骨头撑到
 * 1250×370，人物在里面只剩一条。
 */
const skeleton = new spine.Skeleton(data);
skeleton.setToSetupPose();
skeleton.updateWorldTransform();
const world = new Map();
for (const bone of skeleton.bones) world.set(bone.data.name, { x: bone.worldX, y: bone.worldY });

const rootBone = world.get("root");
// The tip, not the joint. The skull is F_Head_I (24.1) → F_Head_Ii (45.4), and taking
// joints stopped the measurement at the root of the second bone — 45 units short, which
// is what pushed every predicted eye up to the hairline.
let topY = -Infinity;
for (const [name, point] of world) {
  if (!/^F_Head/u.test(name)) continue;
  const bone = skeleton.bones.find((entry) => entry.data.name === name);
  // bone.length is undefined in 3.8; the length lives on bone.data.
  const length = bone === undefined || bone.data.length === undefined ? 0 : bone.data.length;
  const tip = point.y + length;
  if (tip > topY) topY = tip;
}
const stature = topY - rootBone.y;

/** 某组骨头的世界坐标中点。 */
const centre = (pattern) => {
  const points = [...world].filter(([name]) => pattern.test(name)).map(([, point]) => point);
  if (points.length === 0) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
};
const leftEye = centre(/^F_L_Eyelash/u);
const rightEye = centre(/^F_R_Eyelash/u);

/** 肩关节：手臂第一段的世界坐标。 */
const shoulder = (pattern) => {
  const found = [...world].find(([name]) => pattern.test(name));
  if (found === undefined) return null;
  const [, point] = found;
  return {
    x: Number(((point.x - rootBone.x) / stature).toFixed(4)),
    y: Number(((point.y - rootBone.y) / stature).toFixed(4)),
  };
};
const leftShoulder = shoulder(/^F_L_Arm_II$/u);
const rightShoulder = shoulder(/^F_R_Arm_II$/u);

const anatomy = {
  source: `Arknights Spine ${data.version} · ${MODEL.id}`,
  unit: "figure height, origin at the feet",
  // Shoulders, from the game's own arm chain. The model stands slightly off-its-axis
  // — its eyes sit 0.06 of a stature to one side of its root — so the raw shoulder
  // positions read as lopsided. They are not: a shoulder is a shoulder. Symmetric
  // about the eye midpoint, which is the one landmark checked against real artwork.
  arms: leftShoulder === null || rightShoulder === null
    ? null
    : {
      halfWidth: Number(((rightShoulder.x - leftShoulder.x) / 2).toFixed(4)),
      y: Number(((leftShoulder.y + rightShoulder.y) / 2).toFixed(4)),
      // Where the hand hangs, so the weight can fade out above the hip.
      hand: Number(((world.get("F_L_Hand_I").y - rootBone.y) / stature).toFixed(4)),
    },
  eyes: {
    y: Number((((leftEye.y + rightEye.y) / 2 - rootBone.y) / stature).toFixed(4)),
    separation: Number(((rightEye.x - leftEye.x) / stature).toFixed(4)),
    offset: Number(((rightEye.x - (leftEye.x + rightEye.x) / 2) / stature).toFixed(4)),
  },
  spine: {
    waist: Number(((world.get("F_Waist_I").y - rootBone.y) / stature).toFixed(4)),
    chest: Number(((world.get("F_Chest_I").y - rootBone.y) / stature).toFixed(4)),
    neck: Number(((world.get("F_Head_I").y - rootBone.y) / stature).toFixed(4)),
  },
};
const anatomyTarget = join(root, "art", "anatomy.json");
writeFileSync(anatomyTarget, `${JSON.stringify(anatomy, null, 2)}\n`);
console.log(`measure-motion: 眼睛离地 ${String(anatomy.eyes.y)} 个身高，间距 ${String(anatomy.eyes.separation)}；写入 ${anatomyTarget}`);
