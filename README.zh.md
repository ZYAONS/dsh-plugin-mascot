# dsh-plugin-mascot · DSH 看板娘

[English](README.md) | 中文

给 **DeepSeek Harness**（DSH）Web GUI 加一个可以点的看板娘：平时缩在右下角，
点一下弹出一块面板，把这一局到底花了多少钱、命中率怎么样，一次说清楚。

- **Token 缓存命中率** —— 命中读取 ÷ 全部计费输入（命中率越高，单价越低）
- **Token 明细** —— 输入（未命中）/ 缓存读取 / 缓存写入 / 输出 / 本会话累计
- **上下文占用** —— 当前占用 ÷ 上下文窗口，带进度条
- **账户余额** —— 主机侧向 DeepSeek 查询，API Key 不进浏览器
- **两个角色，随时切换** —— 明日方舟的**可露希尔**，梦限大 MewType 的**千石由乃**

![预览](docs/preview.png)

> 预览图由 `node scripts/preview.mjs` 从真实的浏览器端代码渲染生成 —— 点开面板、
> 切换角色都是真的 DOM 事件，只有「会话投影」和「余额接口」两个浏览器拿不到的
> 输入被替换成了固定值。

---

## 目录

- [安装](#安装)
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

> 用的是中转站或自建网关时，把 `baseUrl` 指过去即可；只要它实现了
> `GET /user/balance`。

---

## 它是怎么工作的

一个插件包，两个半边：

```
dsh-plugin-mascot/
├── lib/
│   ├── index.js     主机半边：注册 /dsh-mascot 路由，查余额
│   └── client.js    浏览器半边：看板娘 + 面板（window.__ModuleLoader__ 格式）
├── assets/
│   ├── closure.svg  可露希尔立绘（矢量源文件）
│   └── yuno.svg     千石由乃立绘（矢量源文件）
└── scripts/
    ├── sync-art.mjs 把 assets/*.svg 内联进 lib/client.js
    ├── check.mjs    自检：清单契约、bundle 装载、统计函数、素材完整性
    └── preview.mjs  在真实浏览器里渲染 docs/preview.png
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
所以主机半边只干一件事 —— 提供一个小巧的同源 JSON 路由：

```
GET /dsh-mascot/api/balance   账户余额（带缓存）
GET /dsh-mascot/api/health    路由存活检查
```

- Key 每次请求都用 `ctx.credentials.resolve()` 现取，**轮换后下一次调用即生效**，
  不需要重启；
- Key 只作为 `Authorization: Bearer` 头发出去，**绝不**进入响应体、日志或错误信息；
- 路由先过 `ctx.connection.isAuthenticated(req)`，也就是和 GUI 其余部分同一张
  浏览器 cookie；万一组合里没有 Connection 服务，退回到只接受回环 `Host`。

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

拿不到的数就显示 `—`，**不会**当成 0 —— 没有会话时命中率是没有意义的，
面板也不会编一个 0% 出来。

---

## 开发

```bash
npm install          # 只为 preview 装的 react / react-dom（devDependencies）
npm test             # 自检
npm run check        # node --check 两个半边 + 自检
npm run sync-art     # 改完 assets/*.svg 之后同步进 lib/client.js
node scripts/preview.mjs   # 重新渲染 docs/preview.png
```

改看板娘画面的流程：编辑 `assets/*.svg` → `npm run sync-art` →
`node scripts/preview.mjs` 看图 → 重启（或等 HMR）之后在 GUI 里看。

---

## 素材与授权

- **代码**：[MIT](LICENSE)
- **立绘**：`assets/closure.svg` 与 `assets/yuno.svg` 是**本仓库原创绘制的矢量同人图**，
  依照角色公开的设计特征（发色、瞳色、服装配色与标志性道具）重新绘制，
  **没有**使用、描摹或内嵌任何官方素材或第三方图片。
  与代码同为 MIT，可自由使用；商用前请自行确认角色形象的相关权利。
- **角色权利**：可露希尔 © 上海鹰角网络（《明日方舟》）；千石由乃 © Bushiroad
  （《BanG Dream!》/ 梦限大 MewType）。二者均为各自权利人的商标／版权角色，
  本插件是非官方同人作品，与权利人无隶属或背书关系。
- **DSH**：DeepSeek Harness 及其 `@deepseek-ai/*` 包版权归其各自作者所有，
  本仓库只是在它的插件接口上工作。
