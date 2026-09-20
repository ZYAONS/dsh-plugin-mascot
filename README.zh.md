# dsh-plugin-mascot · DSH 看板娘

[English](README.md) | 中文

给 **DeepSeek Harness**（DSH）网页端加一个可以点的看板娘。停在右下角，点一下弹出面板，显示这次会话的 token 开销和缓存命中情况。

![预览](docs/preview.png)

上图是 `lib/client.js` 在 Chromium 里的真实运行结果，用的是内置占位图，也就是 `npm run fetch-art` 之前的全新克隆。装上官方素材后是 `docs/preview-official.png`，那张在本地生成，不进仓库。

## 面板显示什么

| | |
|---|---|
| Token 缓存命中率 | 缓存读取 ÷ 全部计费输入 |
| Token 明细 | 未命中输入、缓存读取、缓存写入、输出、会话合计 |
| 上下文占用 | 当前用量 ÷ 上下文窗口 |
| 账户余额 | 主机侧请求，API key 不出主机进程 |
| 音乐 | 该角色的塞壬唱片专辑，或 30 秒官方试听 |
| 角色与形象 | 9 位角色，22 个形象 |

## 安装

DSH Desktop 通过 profile 的 `cordis.patch.yml` 加载插件。`cordis.yml` 每次启动都会被改写成 `[]`，不要动它。

插件没有运行时依赖。两种装法，选一个。

**A —— 直接指向文件。**

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: mascot
      name: 'file:///C:/Users/<you>/Desktop/kexier/dsh-plugin-mascot/lib/index.js'
```

`file:` URL 指的是**文件**，不是目录。相对路径也可以，相对补丁文件自身所在目录解析。

**B —— 装成 profile 依赖。**

```bash
dsh plugin --profile desktop add "/absolute/path/to/dsh-plugin-mascot"
dsh plugin --profile desktop add link:/absolute/path/to/dsh-plugin-mascot
dsh plugin --profile desktop add "github:ZYAONS/dsh-plugin-mascot"
```

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
```

两种写法都可以加 `config`：

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
      config:
        baseUrl: 'https://api.deepseek.com'
        cacheTtlMs: 30000
```

**必须重启 DSH Desktop。** 桌面端每次启动只组装一次补丁层，不监视 profile 目录，刷新页面不够。首次挂载之后，改 `lib/client.js` 会走客户端 HMR，不用再重启。

## 配置台

装到本机之前，先在浏览器里配：

**https://zyaons.github.io/dsh-plugin-mascot/**

| 区块 | |
|---|---|
| 00 实时预览 | 看板娘动起来，穿你选的形象 |
| 01 插件 | 插件开关、余额查询开关 |
| 02 角色 | 每位角色一张卡 |
| 03 形象 | 勾选允许出现的素材 |
| 04 动效 | 骨骼动画、多帧形象 |
| 05 输出 | 可复制、可下载的 `cordis.patch.yml` |
| 06 安装 | 五步，含拉取素材和重启 |

页面是纯静态的，跑在 GitHub Pages 上，不读取本机任何东西。状态存在 localStorage。`?theme=` 和 `?character=` 可以深链，`?theme=` 同时会切换角色。

由插件在 `/dsh-mascot/console/` 提供时，它还会读本机的素材。

### 主题

10 套页面主题：一套中性 + 每位角色一套。

| | 中性 | 可露希尔 | 千石由乃 | 缪尔赛思 | 丰川祥子 | 谬因 | 予愿安洁莉娜 | 夕 | 结城理 | 望 |
|---|---|---|---|---|---|---|---|---|---|---|
| 信号色 | 银 | 蓝 | 品红 | 浅绿 | 紫罗兰 | 深绿 | 青 | 蓝绿 | P3R 蓝 | 米白 |
| 圆角 | 直角 | 直角 | 14px | 10px | 8px | 14px | 10px | 10px | 直角 | 直角 |

选某个角色的主题即选中该角色，选角色也切到它的主题。中性主题不属于任何角色，是唯一可以和画面不一致的，也是唯一不显示唱片行的。

### 语言

配置台是英文，插件面板是中文。`art/looks.json` 里 `nameEn` / `roleEn` / `taglineEn` 和 `name` / `role` / `tagline` 并排存放，`build-site.mjs` 把英文那组拷进目录。`check-site` 会在记录缺翻译、或页面正文出现中文（版权声明除外）时报错。

## 角色与形象

素材版权属于鹰角网络和 Bushiroad。仓库里只有声明，没有图。

```bash
npm run fetch-art              # 下载、需要时抠图、重建索引
npm run fetch-art -- --force   # 忽略哈希重新下载
```

| 角色 | 形象 | 出处 |
|---|---|---|
| 可露希尔 Closure | 基建小人、立绘 | 明日方舟 |
| 千石由乃 Yuno | Q 版（两个姿势）、动画、常服 | BanG Dream! |
| 缪尔赛思 Muelsyse | 基建小人、异格、立绘 | 明日方舟 |
| 丰川祥子 Sakiko | 动画、常服、联动小人 | BanG Dream! × 明日方舟 |
| 谬因 Miuyin | 基建小人、立绘 | 明日方舟 |
| 予愿安洁莉娜 Yuyuan | 基建小人、立绘 | 明日方舟 |
| 夕 Dusk | 基建小人、立绘 | 明日方舟 |
| 结城理 Makoto | 立绘、联动小人、P3R | 明日方舟 × P3R |
| 望 Wang | 基建小人、立绘 | 明日方舟 |

`art/looks.json` 是手写的，`art/index.json` 是生成的。每条都带源 URL 和 sha256，下载时校验。

加形象：在 `art/looks.json` 的 `looks` 里加一条，跑 `npm run fetch-art`。不用改代码。

`scripts/art-sync.mjs` 在浏览器里量每张图的 alpha 包围盒，推出两个座位的取景（104×172 小人、38×50 头像），并采样一个强调色。结果写进 `art/index.json`，主机半边过滤掉磁盘上没有的，再发给浏览器。

`npm run art:watch` 会在 `art/` 里落文件时自动重建索引。

文件缺失时回落到中性占位图：虚线框加一个通用图标，不描绘任何角色。

## 动作

三层。前两层是动画，第三层是浏览器放文件。

### 骨骼动画

WebGL2 的 2D 骨骼 + 蒙皮网格渲染器。

- `art-sync` 把每张图的轮廓量成 32 条水平带，客户端从最窄的那条找脖子。
- 七根骨头：脚底的 `root`、胯的 `spine`、脖子的 `neck`、两肩的 `armL`/`armR`、两肘的 `foreL`/`foreR`。子骨继承父骨变换。
- 顶点权重按竖直方向分配，每个关节处平滑过渡。手臂是独立区域，各自遮到自己那半边。
- 纹理用 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 上传。
- 点击触发一段衰减振动，1.6 秒内结束。

这不是 Live2D 也不是 Spine。明日方舟用的是改过的 Spine 3.8 格式，官方运行时读不了，没有现成骨架可以加载，骨骼是从静图推出来的。没有腕骨。

WebGL2 不可用、着色器编译失败、或图片污染 canvas 时，回落到普通 `<img>`。骨骼只可能增加动画，不会让看板娘消失。预览脚本会打印 `rig: ON (canvas 140x232)` 说明走的哪条路。

### 实测动作

待机、打招呼、走路来自游戏自己的 Spine 模型，由 [Ark-Models](https://github.com/isHarryh/Ark-Models) 镜像，用官方 3.8 运行时读取。

```bash
npm run measure:motion                            # 六段全量
npm run measure:motion -- --model=4228_closur --character=closure
npm run measure:motion -- --model=4228_closur --moves
```

方舟小人有六段动画：`Default`、`Interact`、`Move`、`Relax`、`Sit`、`Sleep`。有模型的 8 位角色全部量过，`art/motion.json` 按角色分份。用上的是三段：

| 动画 | 用途 | 幅度 |
|---|---|---|
| `Relax` | 待机 | 腰 0.4°，前臂 28.6° |
| `Interact` | 打招呼 | 腰 17.6°，前臂 79.5° |
| `Move` | 换形象时走过来 | IK 脚骨 ±89 单位 |

`Sit` 和 `Sleep` 两条通道里都几乎没有运动 —— `Sleep` 整段只有 3 根骨头动、最大 2.2 单位，`Sit` 最大的位移是眼球，`Default` 是 0 秒空动画。量了，没有内联。

```bash
npm run motion:literal    # 重新生成 lib/client.js 里那段内联
```

生成的块按角色带 `idle`、`greet`、`move` 和眨眼。没量过的角色退回默认那份。

声明了 `gesture: "evoker"` 的角色点击时会把右臂抬到太阳穴：上臂转 140°，前臂折 120°。

### 多帧动画

千石由乃的 Q 版是同一张图里的两个姿势。`cutout.mjs` 把它们分开、各自裁到自己的包围盒、并给一个共享缩放。浏览器每 5.2 秒交叉淡入淡出。骨骼动画打开时它停下。

GIF 和动态 WebP 直接播。

## 音乐

面板播放该角色的塞壬唱片专辑，封面和音源热链官方 CDN。`art/siren.json` 把角色映射到登场活动的专辑；`art/songs.json` 覆盖没有塞壬发行、但有 30 秒 Apple Music 试听的角色。

```bash
npm run siren:sync            # 重新解析专辑和试听
npm run siren:sync -- --list
```

不存音频文件。主机半边通过 `/api/looks` 把两张表一起发出去。

## 房间

每个角色的座位后面有背景：插件用渐变画的房间，或者官方家具图。

```bash
npm run fetch-rooms            # 下载缺的
npm run fetch-rooms -- --list  # 只看声明
npm run fetch-rooms -- --force # 重新下载
```

图片落在 `art/room-<角色 id>.<扩展名>`。主机按文件名找，重启即可生效。`art/rooms.json` 声明每张是哪一套、出处在哪。删掉 `art/room-*` 就回到画出来的房间。

## 用法

| 操作 | 结果 |
|---|---|
| 点小人 | 开关面板 |
| 角色行 | 换角色 |
| 形象行 | 换该角色的形象（带「动态」标记的是多帧） |
| 动效行 | 开关骨骼动画 |
| 唱片行 ▶ | 播放 / 停止 |
| 点背景或按 Esc | 关面板 |
| 刷新 | 立即重查余额 |

选择存在 localStorage。系统开了「减弱动态效果」时，所有动画停止。

小人身下那枚胶囊显示三个数：

| | 来源 |
|---|---|
| 余额 `¥128.42` | 主机问 DeepSeek；失败时显示「点我 Token / 余额」 |
| 命中 `89.0%` | 本次会话的缓存命中率 |
| 今天 `1.2M` | 本机今天的 token 花费 |

「今天」要主机记账：一小时前结束的会话把数字带走了。主机维护 `.cache/usage-daily.json`，按会话存**高水位**。浏览器反复上报累计值，重复上报不加；倒退的总数不扣。跨零点清零。

## 配置

每个字段都有默认值。

| 字段 | 默认 | 含义 |
|---|---|---|
| `routePrefix` | `/dsh-mascot` | 在主机 web server 上占用的路径前缀 |
| `baseUrl` | `https://api.deepseek.com` | 承载余额接口的服务地址 |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | `~/.dsh/.credentials.yaml` 里的凭据名 |
| `cacheTtlMs` | `60000` | 一次余额答复的新鲜度；失败不缓存 |
| `timeoutMs` | `10000` | 上游请求预算 |
| `artDir` | 插件自己的 `art/` | 素材目录 |

走代理或自建网关时把 `baseUrl` 指过去，需要实现 `GET /user/balance`。

## 目录

```
dsh-plugin-mascot/
├── lib/
│   ├── index.js        主机半边：/dsh-mascot 路由
│   └── client.js       浏览器半边：小人、面板、主题、渲染器、音乐
├── art/
│   ├── looks.json      角色、主题、URL、哈希
│   ├── index.json      art-sync 生成
│   ├── motion.json     measure-motion 生成，按角色分份
│   ├── eyes.json       眨眼框和眨眼的曲线
│   ├── rooms.json      背景声明
│   ├── siren.json      角色 → 塞壬唱片专辑
│   └── songs.json      角色 → 官方试听
└── scripts/
    ├── fetch-art.mjs       下载、抠图、交给 art-sync
    ├── cutout.mjs          抠背景；把多姿势图拆成多帧
    ├── art-sync.mjs        量包围盒和强调色，写 index.json；--watch
    ├── measure-motion.mjs  读 Spine 模型的动画
    ├── motion-literal.mjs  把量到的曲线内联进 lib/client.js
    ├── siren-sync.mjs      解析专辑和试听
    ├── fetch-rooms.mjs     下载背景
    ├── chrome.mjs          Chromium 查找，浏览器脚本共用
    ├── check.mjs           插件自检
    ├── check-site.mjs      用 CDP 驱动配置台
    ├── build-site.mjs      生成配置台的目录和 rig
    ├── preview.mjs         用真实代码渲染 docs/preview*.png
    └── verify-profile.mjs  当前 DSH profile 的预检
```

## 工作原理

DSH 网页端是插槽注册表。本插件注册一个条目：

**`shell.overlay`** —— 覆盖整个框架的浮层，在所有列之上、在各列滚动容器之外。它是 `list` 插槽，`id: "mascot"` 是新增而不是替换。浮层本身点击穿透，小人自己重新打开指针事件。

`shell.overlay` 是 `root` 作用域，拿不到 `useProjection`。所以该条目自己声明一个 `session-maybe` 作用域的子插槽（`mascot.panel`），通过 `props.renderSlot` 渲染面板，渲染器会把 `useProjection` / `useSession` / `sessionId` 一并给进去。

主机半边占用一个同源路径前缀：

```
GET /dsh-mascot/api/balance   账户余额，带缓存
GET /dsh-mascot/api/health    路由存活
GET /dsh-mascot/api/looks     已装形象、房间、动作、音乐
GET /dsh-mascot/art/<file>    插件 art/ 目录里的素材
```

- key 每次请求通过 `ctx.credentials.resolve()` 解析，只作为 `Authorization: Bearer` 头使用，不出现在响应体、日志或错误信息里。
- 路由用 `ctx.connection.isAuthenticated(req)` 把关。组装里没有 Connection 时，只接受回环 `Host` 头。
- 素材路由先查路径包含（`..`、编码分隔符 → 403），再查扩展名，最后才碰磁盘。文件不存在是 404。
- `/api/looks` 每次请求重读 `art/index.json`，丢掉磁盘上没有文件的形象。

## 数字从哪来

| 显示 | 来源 | 形状 |
|---|---|---|
| Token 明细 | `useProjection("tokenUsage")` | `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` |
| 缓存命中率 | 由上一行推出 | `cacheReadTokens ÷ (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)` |
| 上下文占用 | `useProjection("contextPressure")` | `{ contextWindow?, pressureTokens?, projectedTokens? }` |
| 账户余额 | `/dsh-mascot/api/balance` | `GET {baseUrl}/user/balance` |
| 形象、房间、音乐 | `/dsh-mascot/api/looks` | `art/index.json`，过滤到磁盘上有的 |

量不到的一律显示 `—`，不显示 `0`。

## 开发

```bash
npm install
npm test                  # 47 项
npm run check             # 两半各跑 node --check，再跑自检
npm run check:site        # 102 项，用 CDP 驱动配置台
npm run check:site -- https://zyaons.github.io/dsh-plugin-mascot/
npm run build:site        # 重新生成 docs/site/catalog.json 和 rig.js
npm run preview           # docs/preview.png —— 占位图，进仓库
npm run preview:official  # docs/preview-official.png —— 官方素材，不进仓库
npm run verify            # 当前 DSH profile 的预检
```

改完 `lib/client.js` 要跑 `npm run build:site`；`docs/site/rig.js` 和插件自己的骨架不同步时 `check:site` 会失败。

`art/` 或 `docs/art/` 下有图被 git 跟踪时，`npm test` 失败。

`check-site.mjs` 用 Chrome DevTools Protocol 驱动页面：点击走 `Input.dispatchMouseEvent`，控制台报错算失败，`file://` 和线上 URL 都能测。窄视口用 `Emulation.setDeviceMetricsOverride` 设置，不用 `--window-size`，因为无头窗口有最小宽度，会把布局裁窄。

加主题：在 `lib/client.js` 的 `THEMES` 里加一个键，在 `art/looks.json` 里让角色写上 `theme`，然后在**四个地方**都加上 —— `docs/index.html` 的按钮、`docs/site/site.js` 的 `THEME_COLOURS` 和 `PAGE_THEME_NAMES`、`docs/site/site.css` 的 `[data-theme="…"]` 规则。缺任何一处，`check:site` 失败。

## 版权

仓库里没有别人的素材。角色版权归各自所有者 —— 鹰角网络（明日方舟）、Bushiroad（BanG Dream!）。`npm run fetch-art` 把图下载到各人自己的机器上。

- **代码**：[MIT](LICENSE)
- **官方素材**（`art/*.png`，不进仓库）：可露希尔、缪尔赛思、谬因、予愿安洁莉娜、夕、结城理、望 © 鹰角网络；千石由乃、丰川祥子 © Bushiroad。本仓库不分发这些文件。个人使用可以，再分发或商用请先取得授权。
- **占位图**：`lib/client.js` 里那个通用图标，不描绘任何角色，随代码走 MIT。
- **DSH**：DeepSeek Harness 及其 `@deepseek-ai/*` 包归各自作者所有。

非官方同人作品，与任何权利方无关联、未获背书。

详见 [COPYRIGHT.md](COPYRIGHT.md)。
