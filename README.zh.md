# dsh-plugin-mascot · DSH 看板娘

[English](README.md) | 中文

给 **DeepSeek Harness**（DSH）Web GUI 加一个可以点的看板娘：平时缩在右下角，
点一下弹出一块面板，把这一局到底花了多少钱、命中率怎么样，一次说清楚。

**看板娘用的是官方 Q 版（Q版 / 小人）立绘** —— 可露希尔的官方 Q 版干员小人、
千石由乃的官方 Q 版形象，都是画师画的，不是手绘图。因为官方图是版权素材，
仓库里**不含图片**，只带一个下载脚本；跑一次 `npm run fetch-art` 就位（见[立绘](#立绘)）。

- **Token 缓存命中率** —— 命中读取 ÷ 全部计费输入（命中率越高，单价越低）
- **Token 明细** —— 输入（未命中）/ 缓存读取 / 缓存写入 / 输出 / 本会话累计
- **上下文占用** —— 当前占用 ÷ 上下文窗口，带进度条
- **账户余额** —— 主机侧向 DeepSeek 查询，API Key 不进浏览器
- **两个角色，随时切换** —— 明日方舟的**可露希尔**，梦限大 MewType 的**千石由乃**

![预览](docs/preview.png)

> 上面这张预览图是 `lib/client.js` 在真实 Chromium 里跑出来的（点开面板、切换角色
> 都是真 DOM 点击），用的是**内置占位图** —— 也就是刚 clone 下来、还没跑
> `npm run fetch-art` 时的样子。装上官方 Q 版之后的样子见 `docs/preview-official.png`
> （本地生成，不进仓库）。

---

## 目录

- [安装](#安装)
- [立绘](#立绘)
- [使用](#使用)
- [配置](#配置)
- [它是怎么工作的](#它是怎么工作的)
- [数据从哪来](#数据从哪来)
- [开发](#开发)
- [素材与授权](#素材与授权)

---

## 安装

DSH Desktop 通过 **profile 目录里的 `cordis.patch.yml`** 加载插件。
`cordis.yml` 每次启动都会被改写成 `[]`，**不要动它**。

本插件**没有任何运行时依赖**（主机半边一个 `import` 都没有），所以有两条路，
任选其一。

### 方案 A —— 不需要安装（最省事）

直接在 patch 行里用绝对 `file:` URL 指向主机半边：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: mascot
      name: 'file:///C:/Users/<你>/Desktop/kexier/dsh-plugin-mascot/lib/index.js'
```

注意 `file:` URL 要指向**文件**而不是目录。写相对路径
`./dsh-plugin-mascot/lib/index.js` 也可以，它相对于 patch 文件所在目录解析。

### 方案 B —— 装成 profile 的真依赖

用 DSH 自带的 CLI（它只是把参数原样转发给 profile 目录里的 pnpm）：

```bash
dsh plugin --profile desktop add "C:\Users\<你>\Desktop\kexier\dsh-plugin-mascot"
```

也可以 `link:` / `file:` 显式指定，或直接从 git 安装：

```bash
dsh plugin --profile desktop add link:/absolute/path/to/dsh-plugin-mascot
dsh plugin --profile desktop add "github:ZYAONS/dsh-plugin-mascot"
```

然后按包名挂载：

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
```

两种都行；**方案 A 更保险** —— 它完全不会动 profile 的依赖树。

### 配置

两种写法都可以加 `config`（字段见[配置](#配置)）：

```yaml
- insert:
    - id: mascot
      name: dsh-plugin-mascot
      config:
        baseUrl: 'https://api.deepseek.com'
        cacheTtlMs: 30000
```

### 重启 DSH Desktop

**必须重启整个应用。** DSH Desktop 不会监听 profile 目录 —— `patchReload: live`
只在 CLI 路径上生效；桌面端只在启动时组合一次 patch 层。刷新网页没用，
插件根本没进这一代的加载树。重启之后它就在了；之后再改 `lib/client.js`
的内容会通过客户端 HMR 热更新，不用再重启。

---

## 立绘

看板娘用的是**官方 Q 版图**，是画师产出的官方素材，不是手绘图。但官方图的版权属于
鹰角和 Bushiroad，把图片塞进公开仓库等于替别人分发受版权保护的素材 —— 所以本仓库
**只带下载清单，不带图片**：

```bash
npm run fetch-art              # 按 art/sources.json 下载到 art/
npm run fetch-art -- --force   # 强制重下
```

| 角色 | 素材 | 处理 |
|---|---|---|
| 可露希尔 | 《明日方舟》官方 Q 版干员小人（512×640，透明背景，含悬浮无人机） | 直接用 |
| 千石由乃 | 《BanG Dream!》梦限大 MewType 官方 Q 版形象（初代） | 自动抠图 |

由乃那张原图是宣传用的双人版式：两个姿势 + 粉色星形背景和彩纸。`scripts/cutout.mjs`
会用真浏览器把它处理干净 —— 从边缘采样背景色、向内洪泛填充、只保留最大的连通域
（也就是人物本体），最后裁到人物边界。步骤都写在脚本注释里，`fetch-art` 会自动调用。

`art/sources.json` 里每一项都写了来源 URL 和 **sha256**；脚本逐个校验，上游文件变了
会明确报出来（但仍然写入，免得你手上什么都没有）。抠图产物另外记 `derivedSha256`
供参考，因为不同 Chromium 版本的 PNG 编码可能不同。

**没跑 `fetch-art` 也能用**：内置一个**中性占位图**（虚线框 + 「图片缺失」图标），
官方图 404 时自动顶上。占位图是通用图形，不是任何角色的画像。

**换图**：把 `art/` 里的文件替换掉，文件名保持 `closure.png` / `yuno.png`。
想换别的角色，改 `lib/client.js` 里 `MASCOTS` 的 `art` 与 `sprite` / `face` 取景参数 ——
两个数字都是从素材的 alpha 边界算出来的（`width` 是图片渲染宽度，`left` / `top` 是
把人物或头部拉进框内的负偏移）。

---

## 使用

| 操作 | 结果 |
|---|---|
| 点右下角的立绘 | 展开 / 收起面板 |
| 点面板里的两个小头像 | 切换看板娘（选择存在 localStorage） |
| 点空白处 或 按 `Esc` | 关掉面板 |
| 点「刷新」 | 立刻重新问一次余额（默认 2 分钟自动刷新一次） |

面板展开时，立绘下面的胶囊会显示余额；查询失败时显示「点我 Token / 余额」，
不会假装自己知道。

---

## 配置

全部字段都有默认值，`config` 可以整段不写。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `routePrefix` | `/dsh-mascot` | 本插件在主机 webserver 上占用的路径前缀 |
| `baseUrl` | `https://api.deepseek.com` | 余额接口所在的提供方源站 |
| `apiKeyRef` | `DEEPSEEK_API_KEY` | 凭据服务里的引用名（`~/.dsh/.credentials.yaml`） |
| `cacheTtlMs` | `60000` | 一次余额查询的保鲜期；失败不缓存 |
| `timeoutMs` | `10000` | 上游请求超时 |
| `artDir` | 插件自己的 `art/` | 立绘所在目录，默认按插件位置推导 |

> 用的是中转站或自建网关时，把 `baseUrl` 指过去即可；只要它实现了
> `GET /user/balance`。

---

## 它是怎么工作的

一个插件包，两个半边：

```
dsh-plugin-mascot/
├── lib/
│   ├── index.js        主机半边：/dsh-mascot 路由（余额 + 立绘），查余额
│   └── client.js       浏览器半边：看板娘 + 面板（window.__ModuleLoader__ 格式）
├── art/
│   ├── sources.json    官方 Q 版图的下载清单（进仓库）
│   ├── closure.png     ← npm run fetch-art 下载，不进仓库
│   └── yuno.png        ← 同上（下载后自动抠图）
└── scripts/
    ├── fetch-art.mjs   按清单下载官方图；带 cutout 标记的会走抠图
    ├── cutout.mjs      用真浏览器洪泛填充抠背景 + 裁到人物边界
    ├── chrome.mjs      Chromium 定位（preview 与 cutout 共用）
    ├── check.mjs       自检：清单契约、bundle 装载、统计函数、素材与路由
    ├── preview.mjs     在真实浏览器里渲染 docs/preview*.png
    └── verify-profile.mjs  上线前体检：解析 patch 层、导入模块、检查浏览器半边
```

### 浏览器半边挂在哪个坑位

DSH 的 GUI 是一套 **slot 注册表**。本插件只注册了一个条目：

- **`shell.overlay`** —— 横跨整个窗口的浮层，层级在所有栏目之上、滚动容器之外。
  它是 `list` 类型的坑位，所以用一个全新的 `id: "mascot"` 就是**新增**而不是覆盖；
  这一层本身 `pointer-events: none`，所以立绘自己把 pointer 事件接回来，
  不会挡住下面的应用。

麻烦的地方在于：`shell.overlay` 是 `root` 作用域，**拿不到 `useProjection`**。
所以本条目在 `children` 里**自己声明了一个 `session-maybe` 作用域的子坑位
`mascot.panel`**，再通过 `props.renderSlot("mascot.panel", …)` 渲染面板 ——
渲染器会自动把 `useProjection` / `useSession` / `sessionId` 一并交给它。
用 `session-maybe` 而不是 `session`，是为了还没选会话时面板也能开。

### 主机半边

余额是浏览器够不着的那一个数字：问答需要 API Key，而 Key 不能离开主机进程。
立绘也是浏览器自己拿不到的 —— 官方图不在仓库里，得由主机从磁盘上读。
所以主机半边干两件事 —— 提供同源路由：

```
GET /dsh-mascot/api/balance   账户余额（带缓存）
GET /dsh-mascot/api/health    路由存活检查
GET /dsh-mascot/art/<文件>    从插件自己的 art/ 目录读立绘
```

- Key 每次请求都用 `ctx.credentials.resolve()` 现取，**轮换后下一次调用即生效**，
  不需要重启；
- Key 只作为 `Authorization: Bearer` 头发出去，**绝不**进入响应体、日志或错误信息；
- 路由先过 `ctx.connection.isAuthenticated(req)`，也就是和 GUI 其余部分同一张
  浏览器 cookie；万一组合里没有 Connection 服务，退回到只接受回环 `Host`；
- 立绘路由先做路径越界检查（`..`、编码分隔符一律 403），再限制扩展名，
  最后才落盘读文件；文件不在就 404，浏览器那边自动切到矢量兜底图。

---

## 数据从哪来

面板上的每个数字都来自 DSH 自己的**会话投影**（session projection），
不是本插件自己数的：

| 显示项 | 来源 | 形状 |
|---|---|---|
| Token 明细 | `useProjection("tokenUsage")` | `{ uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }` |
| Token 缓存命中 | 由上一行推导 | `cacheReadTokens ÷ (uncachedInputTokens + cacheReadTokens + cacheWriteTokens)` |
| 上下文占用 | `useProjection("contextPressure")` | `{ contextWindow?, pressureTokens?, projectedTokens? }`，优先用 `projectedTokens` |
| 账户余额 | 本插件的 `/dsh-mascot/api/balance` | `GET {baseUrl}/user/balance` |
| 立绘 | 本插件的 `/dsh-mascot/art/<文件>` | 磁盘上的 `art/`，缺失时用内置矢量图 |

拿不到的数就显示 `—`，**不会**当成 0 —— 没有会话时命中率是没有意义的，
面板也不会编一个 0% 出来。

---

## 开发

```bash
npm install                # 只为 preview 装的 react / react-dom（devDependencies）
npm run fetch-art          # 下载官方 Q 版图到 art/（由乃那张会自动抠图）
npm test                   # 自检（22 项）
npm run check              # node --check 两个半边 + 自检
npm run preview            # 渲染 docs/preview.png（占位图，会进仓库）
npm run preview:official   # 渲染 docs/preview-official.png（官方图，不进仓库）
npm run verify             # 体检当前 profile 能不能挂上
```

单独跑抠图：

```bash
node scripts/cutout.mjs <原图.png> <输出.png>
```

改立绘取景的流程：调 `lib/client.js` 里 `MASCOTS` 的 `sprite` / `face` 参数
→ `npm run preview:official` 看图 → 满意后重启 DSH。
取景数字的算法：量出素材的 alpha 边界框，按座位尺寸等比缩放，再把边界框居中。

---

## 素材与授权

- **代码**：[MIT](LICENSE)
- **官方 Q 版图（`art/`，不进仓库）**：可露希尔的《明日方舟》官方 Q 版干员小人、
  千石由乃的《BanG Dream!》官方 Q 版形象。**版权归各自权利人所有，是画师产出的官方素材。**
  本仓库不分发这些文件，只提供 `art/sources.json` 清单和 `npm run fetch-art` 下载脚本，
  由使用者自行下载到本机。个人自己用没问题；**再分发或商用请先取得授权**。
  由乃那张经过 `scripts/cutout.mjs` 抠图处理（去掉背景与第二个姿势），处理的是像素，
  没有改动画面内容。
- **内置占位图**：`lib/client.js` 里的通用「图片缺失」图标（虚线框 + 图形符号），
  不描绘任何角色，仅在官方图缺失时显示，同为 MIT。
- **角色权利**：可露希尔 © 上海鹰角网络（《明日方舟》）；千石由乃 © Bushiroad
  （《BanG Dream!》/ 梦限大 MewType）。二者均为各自权利人的商标／版权角色，
  本插件是非官方同人作品，与权利人无隶属或背书关系。
- **DSH**：DeepSeek Harness 及其 `@deepseek-ai/*` 包版权归其各自作者所有，
  本仓库只是在它的插件接口上工作。
