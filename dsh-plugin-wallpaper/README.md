# dsh-plugin-wallpaper

把本机的图片或视频当作 **DSH 网页界面**的背景，并且**认得 Wallpaper Engine 的创意工坊壁纸**。

## 它做什么

- 从 `~/.dsh-wallpaper/wallpapers/` 里读图片（png / jpg / webp / gif / avif）和视频（mp4 / webm）
- **自动发现 Wallpaper Engine 的工坊壁纸**，把能渲染的列出来
- 选一张，铺满整个界面**后面**
- 一个**暗化**滑条，保证压在上面的字看得清
- 一个检索框 + 一排作品筛选（明日方舟 / BanG Dream!）

界面右上角一个「壁纸」按钮，点开是选择面板。不占右下角——那里是看板娘的。

## 检索

面板里一行检索：一个输入框 + 一排**作品筛选**胶囊（`全部` / `明日方舟` / `BanG Dream!`），
**两者叠加生效**。输入框按子串匹配标题与文件名，大小写不敏感。作品筛选是**单选** ——
「只看」两个字本来就不该能同时成立。

### 两张表的可信度不一样，这件事写在界面上

**「明日方舟」那张是拿真实的 152 张工坊壁纸校准出来的。** 校准抓到过两个真误伤：

```
Zero Two / DARLING in the FRANXX [4K] [AR]     ← 被单个字母 "w" 匹配
【4k…】黑神话悟空——夜莺Night                     ← "夜莺" 撞了工坊作者名「夜莺Night」
```

于是表里有两条规矩：**不收单字和常用词**（`w` / `年` / `夕` / `令` / `dusk` / `logos` 这类），
**不收会和作者名撞车的**。砍掉之后仍然净赚 7 张：

| | |
|---|---|
| 只靠游戏名 | 38 张 |
| 加上干员名 | **45 张** |

**「BanG Dream!」那张没校准过** —— 写它的时候本机 152 张里一张邦多利都没有
（作品名、乐队名、角色名全零命中）。没有真实样本就没法验证认对了没有，所以那张表
**刻意更保守**：不收任何单字，也不收 `layer` / `lock` / `masking` / `pareo` 这类
同时是常用英文词的成员代号。

**这一点不藏在源码注释里**：胶囊的 `title` 和面板底部的提示行都会写出"这个词表没校准过"，
`lib/client.js` 的 `CATALOGS` 里每张表带一个 `calibrated` 字段，自检断言它。

**单向**：只从标题往表上匹配，不反向、不做模糊、不猜。判不出来就是判不出来 ——
宁可漏，不可错，因为筛错了会让人以为插件在乱认。

加名字之前先自己数一遍，看它在真实库里多认了谁、有没有认错。

### 看一眼再交

```powershell
cd C:\Users\qing1\Desktop\kexier
node .scratch/wallpaper-panel.mjs     # 用真 React 把面板渲染出来
```

**必须有这一步**：检索框和作品胶囊加进去的时候**一条样式都没有** —— 它们一直是浏览器
默认的长相（白底输入框、灰渐变按钮）躺在深色面板里，而当时的自检全绿。不渲染就看不见。

## Wallpaper Engine 联动

装上 Wallpaper Engine 并订阅过壁纸之后，它们会**自动出现**在选择面板里。定位方式是：

1. 环境变量 `DSH_WALLPAPER_STEAM`（分号分隔，优先级最高）
2. 注册表 `HKCU\Software\Valve\Steam` 的 `SteamPath`
3. 再顺着每个库的 `libraryfolders.vdf` 把声明过的其它盘加进来

然后扫 `steamapps/workshop/content/431960/<壁纸 id>/project.json`。

**四类壁纸只收一类**：

| 类型 | | |
|---|---|---|
| `video` | ✅ | 一个 mp4/webm，浏览器直接播 |
| `scene` | ❌ | 需要 Wallpaper Engine 自己的 3D 引擎实时渲染 |
| `web` | ❌ | 需要一个隔离的 HTML 运行时 |
| `application` | ❌ | 要宿主直接跑第三方可执行程序，本插件不提供这个能力 |

收不了的那些**不静默跳过**：面板里会写"另外 N 张这里渲染不了"，`/api/state` 里也带着
每张的类型。让人以为"我的壁纸没被认出来"比直接说"这一类做不了"糟得多。

**作者在 `project.json` 里写的路径不可信**：写 `..\..\evil.mp4` 的那种，
**扫描时就不列出来**（而不是列出来、点了才 403）；发送时再查一次目录包含。

## 安装

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: wallpaper
      name: 'file:///C:/Users/<you>/Desktop/kexier/dsh-plugin-wallpaper/lib/index.js'
```

**重启 DSH Desktop。** 也可以把图片放进 `~/.dsh-wallpaper/wallpapers/`。

## 为什么壁纸不能像看板娘那样注册进 `shell.overlay`

DSH 的 `shell.overlay` 容器是：

```css
.dshDesktopOverlay { position: absolute; z-index: 1000; inset: 0; }
```

**比界面高。** 而且桌面模式下它带 `transform: translateZ(0)`，里面 `fixed` 定位的后代会被困在浮层里，逃不出去。

所以壁纸层**直接注入 `body`**：

```css
#dsh-wallpaper-layer { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
```

`body` 在桌面模式下是 `background: transparent !important`，负层级的东西透得出来；`pointer-events: none` 保证它永远不吃点击。

**这一条是量过的**：给图层塞一个铺满的不透明子元素后，屏幕正中 `elementFromPoint` 拿到的仍是界面内容，`layerReceivedClick` 为 false。层级算错的后果不是"壁纸没出来"，而是**整个界面点不动**。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `routePrefix` | `/dsh-wallpaper` | 占用的路径前缀 |
| `dir` | `~/.dsh-wallpaper/wallpapers` | 壁纸目录 |
| `dim` | `42` | 暗化 0–100 |
| `blur` | `6` | 保留字段 |
| `muted` | `true` | 视频壁纸静音播放 |

环境变量：

| 变量 | 作用 |
|---|---|
| `DSH_WALLPAPER_STEAM` | 直接指定 Steam 库（分号分隔），跳过注册表探测 |

## 路由

```
GET  <prefix>/api/state      装了什么、选了哪张、当前的两个值
POST <prefix>/api/state      改选中的那张 / 暗化
GET  <prefix>/media/<file>   发一个本机壁纸
GET  <prefix>/workshop/<id>  发一个工坊壁纸的视频
```

- 全部走会话认证，外加**跨站栅栏**（`Sec-Fetch-Site: cross-site` 与 `Origin ≠ Host` 一律 401）
- 本机媒体先查路径包含（`..`、编码分隔符 → 403），再查扩展名，最后才碰磁盘
- **只能选真的存在的那张** —— 状态文件是可手改的，而它决定发哪个文件出去
- 工坊路由**不接受路径**，只接受一个数字 id：路径由宿主的扫描结果决定，不由请求决定

## 没做的

参考 [`elysia395/dsh-wallpaper-engine`](https://github.com/elysia395/dsh-wallpaper-engine) 时
明确没搬的部分，别指望它们：

- **场景（Scene）/ 网页（Web）壁纸** —— 那需要一个实时 WebGL 引擎，是一个独立项目的工作量
- **转码与帧率上限** —— 需要 ffmpeg
- **系统音频反应、Now Playing** —— 需要一个平台相关的中间件
- **自动轮播、多列表管理**

现在能渲染的是**图片和视频**这两类。

## 开发

```bash
npm test      # 16 项：配置、路由、认证、路径包含、状态持久化、工坊扫描与越界
npm run check # 两个半边各跑 node --check，再跑自检
```

自检**不依赖这台机器**：开头把 `DSH_WALLPAPER_STEAM` 钉到一个空目录，
工坊那几条自己造一棵假的库树来验。

## 许可

MIT。代码是自己写的；`elysia395/dsh-wallpaper-engine` 与
`MeteorNOX/DeepSeek-Balance-Whale-Widget` 是参考对象，未复制其源码。
