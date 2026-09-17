# Copyright and licensing

This repository is **code under MIT** plus **references to artwork that belongs to
someone else**. The distinction is the whole point of this file.

---

## 1. What is licensed to you

| Path | Status |
|---|---|
| `lib/`, `scripts/`, `docs/site/*.js`, `docs/site/*.css`, `docs/index.html` | MIT — see [LICENSE](LICENSE) |
| `art/looks.json`, `art/index.json` | MIT — these are data this project generated: a declaration and measurements |
| `README.md`, `README.zh.md`, `COPYRIGHT.md`, `docs/site/*.png` | MIT |

Nothing in this repository is a copy of anyone's artwork. `art/index.json` contains
*measurements of* artwork — a bounding box, a silhouette profile, a seat size — which
is why the plugin can rig an image it has never seen.

## 2. What is not licensed to you, because it is not ours

| Character | Owner | Source |
|---|---|---|
| Closure / 可露希尔 | © Hypergryph (上海鹰角网络) — *Arknights* / 明日方舟 | official game assets |
| Sengoku Yuno / 千石由乃 | © Bushiroad — *BanG Dream!* / Mugendai MewType | official game and anime assets |

**No artwork by either owner is contained in this repository, in any commit.**
`npm run fetch-art` downloads it to the machine that runs the command, for that
person's own use. `.gitignore` excludes every image path under `art/`, and
`docs/art/` — where `npm run art:publish` puts a copy — is excluded too.

## 3. The terms this project is built around

Bushiroad publishes an explicit policy for *BanG Dream!*, which the Yuno looks fall
under: **[「BanG Dream!（バンドリ！）」著作物利用に関するガイドライン](https://bang-dream.com/bdp-guideline/)**.
Two parts of it shape this project's design.

**The allowance.** Derivatives are permitted for **individuals, for non-commercial
purposes**, and the project states it will not claim infringement for uses following
its terms:

> お客様は、本コンテンツを利用し、本コンテンツに新たな創作性を加えお客様ご自身が制作した著作物（以下「二次的著作物」といいます）を、個人により営利を目的としない場合に限り、制作、展示、頒布および公開…することができます。

**The prohibition that decides the design.** Copying the content *as is* is not
permitted:

> 5. なんらの創作性も加えずに、本コンテンツをコピー、トレース、取り込み等をして利用するもの

That clause is why **this repository never carries the artwork**. Committing
`closure-chibi.png` into `docs/` so GitHub Pages would serve it would be exactly
"importing the content without adding creativity" — and redistribution of the
original asset is not within a rule written for individual, non-commercial
derivative works in the first place. The same reasoning applies to Closure: no
equally explicit public guideline from Hypergryph was found while writing this, so
the stricter of the two postures is applied to both characters.

## 4. What this project does instead, and why that is a derivative work

The plugin does not display the artwork as-is. It:

- measures each image's silhouette and derives a **rig** from it;
- drives that rig with a **skinning renderer written for this project**;
- renders the result with a per-character interface built here.

The artwork is the *input* to something this project made, which is the "new
creativity" the guideline asks for. The web console loads each look **from the
source that already hosts it**, so the pixels travel from the rights holder's chosen
host to the viewer's browser and are never redistributed here.

## 5. Rules this project holds itself to

1. **No artwork in the repository.** Enforced by `.gitignore` and by a test:
   `npm test` fails if any image file is tracked under `art/` or `docs/art/`.
2. **No redistribution.** `fetch-art` downloads to one machine. `art:publish` copies
   into `docs/art/` for local preview only, refuses to run without an explicit
   acknowledgement, and that directory is gitignored.
3. **Non-commercial.** No advertising, no sponsorship, no paid tier, no donations
   tied to this project.
4. **No implied affiliation.** The project is unofficial. It uses no owner's logo,
   wordmark, typeface or trade dress — the console's visual language is the general
   tactical-UI idiom.
5. **Attribution on screen.** Where artwork is displayed, the console names the
   rights holder next to it rather than burying it in a footer.
6. **A takedown request is honoured immediately.** If either rights holder objects,
   the affected looks are removed by deleting their entries from `art/looks.json` —
   no other part of the project depends on them.

## 6. If you fork this

You inherit none of the artwork rights, and the reasoning above is not legal advice.
If you want the characters visible on your own deployed copy, the sources are
declared in `art/looks.json` and the console will load them from there. Publishing
the files yourself is your decision and your risk — which is why this project makes
you type the acknowledgement to do it.

---

## 中文摘要

- **代码是 MIT 的**（`lib/`、`scripts/`、`docs/site/`）。`art/index.json` 不是素材，
  是这个项目自己量出来的数据（包围盒、轮廓剖面），所以也属于代码。
- **立绘不是我们的**：可露希尔 © 鹰角网络《明日方舟》；千石由乃 © Bushiroad《BanG Dream!》/ 梦限大 MewType。
- **仓库里一张官方图都没有**，任何一次提交都没有。`npm run fetch-art` 只下载到你自己的机器。
- Bushiroad 有公开的[著作物利用指引](https://bang-dream.com/bdp-guideline/)，
  允许**个人、非营利**的二次创作，但**第 5 条明确禁止**「不加任何创作性地复制、描摹、导入」。
  把官方图提交进 `docs/` 让 Pages 公开提供，正是那一条禁止的事 —— 所以本项目不做。
- 本项目做的是：自己测轮廓、自己写骨骼与蒙皮、自己做界面 —— 官方图是**输入**，不是产出。
  公网页面从**素材原本的出处**加载，像素不经过这个仓库。
- 自我约束写在第 5 节，并且**由测试强制**：`art/` 或 `docs/art/` 下只要有图片被 git 跟踪，`npm test` 就失败。
- 以上不构成法律意见。如果权利方提出异议，删掉 `art/looks.json` 里对应的条目即可，其余部分不受影响。

## Voice / 配音

The plugin can play a voice line when the mascot is clicked. **No recording ships with
this repository** — a voice line is the actor's performance, and redistributing one is a
heavier thing than redistributing a still image. What ships is the mechanism.

Put your own file in `voices/` next to the plugin, named after the character id:

```
voices/closure.mp3
voices/yuno.ogg
voices/muelsyse.m4a
```

Any of `.mp3`, `.ogg`, `.m4a`, `.wav` works; the first extension in that order wins if
several are present. The host serves them at `<routePrefix>/voice/<file>` and reports
which characters have one, so the browser knows before it clicks.

Precedence at click time:

1. **your file**, if there is one — the real voice;
2. **speech synthesis**, if the machine has a Japanese voice installed;
3. **nothing**, with the written line still shown in the console.

That third case is deliberate. A Chinese or English voice reading kana produces nonsense,
and silence with a visible line is easier to understand than gibberish. Measured on the
machine this was developed on: Windows shipped `zh-CN` (Huihui) and `en-US` (Zira) and no
Japanese voice at all, so adding one is a Windows language-pack step, not a code change.

`voices/` is gitignored, and `npm test` fails if any audio file is ever *tracked* by git —
a .gitignore is a courtesy that `git add -f` steps over, so the guard checks what git
actually tracks rather than trusting the ignore file.

---

## 配音（中文）

点击看板娘时可以播放一句语音。**本仓库不分发任何录音** —— 一句语音是配音演员的表演，
比一张静图更重。仓库里只有机制。

把你自己的文件放在插件目录下的 `voices/`，用角色 id 命名：

```
voices/closure.mp3
voices/yuno.ogg
```

支持 `.mp3` / `.ogg` / `.m4a` / `.wav`，同名多个时按这个顺序取第一个。宿主在
`<routePrefix>/voice/<file>` 提供它们，并把"哪些角色有配音"告诉浏览器。

点击时的优先级：**你的文件** > 系统语音合成（若装了日语声音）> 静音但显示台词。第三种
是刻意的：中文或英文声音读假名会念成乱码，静音配台词比乱码更好懂。

`voices/` 已被 gitignore，并且 `npm test` 会在**任何音频文件被 git 跟踪**时失败 ——
gitignore 只是一道礼貌的门，`git add -f` 一步就跨过去，所以守卫检查的是 git 实际跟踪
了什么。
