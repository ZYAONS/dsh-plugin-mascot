# 出处与致谢 / Third-Party Notices

这个插件的**代码**几乎全是自己写的，但它的**交互设计与提示词策略**明确建立在若干公开成果之上。
这份文件把"用了什么、从哪来、什么许可、用在哪"逐条写清楚，免得含糊。

---

## 一、代码 / 资产复用（有许可证，必须署名）

| 来源 | 许可证 | 用在哪 | 是否随本仓库分发 |
| --- | --- | --- | --- |
| [Feather Icons](https://github.com/feathericons/feather) 的 `zap` 轮廓<br>`M13 2 L3 14 h9 l-1 8 10-12 h-9 l1-8 z` | MIT | 闪电开关按钮的 SVG 路径（`client.js` 的 `BOLT_PATH`）；描边/渐变/电流包都是在这条路径上做的 | 只有那一行路径字符串，**不含** Feather 的源码或字体 |
| [React](https://github.com/facebook/react) | MIT | 客户端半边的 UI 由 React 渲染 | **不打包**。通过宿主的模块加载器 `require('react')` 取，是 peer dependency |
| [obra/superpowers](https://github.com/obra/superpowers) 的四个 skill：`dispatching-parallel-agents` / `subagent-driven-development` / `verification-before-completion` / `systematic-debugging` | MIT | Ultra 与闪电两个模式的策略正文里点名要加载的 playbook | **原样打包**在 `skills/`（21 个文件，含配套 prompt 模板与脚本，逐字节未改）。pin 在 commit [`8ca22dba…`](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d)；许可证全文见 `skills/LICENSE-superpowers`；装法见 `skills/README.md` |

> Feather Icons：Copyright (c) 2013-2023 Cole Bemis。
> React：Copyright (c) Meta Platforms, Inc. and affiliates。
> Superpowers：Copyright (c) Jesse Vincent / Prime Radiant，MIT。

## 二、提示词 / 设计参考（文章与社区实践，非代码）

| 来源 | 用在哪 |
| --- | --- |
| [obra/superpowers](https://github.com/obra/superpowers)（MIT）<br>四个 skill：`dispatching-parallel-agents`、`subagent-driven-development`、`verification-before-completion`、`systematic-debugging` | **闪电模式**的派活与集成纪律（先切边界再派、子代理自包含、产物回传指针）；**Ultra 档**的证据与根因纪律（先定义"做完"、证据先于断言、对抗式复查、先定位根因） |
| [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)，Anthropic（2025-06-13） | 委派契约的四要素（目标 / 产出格式 / 工具与来源 / 任务边界）、按复杂度分档的规模阶梯、"多智能体约 15× token"这条成本事实、"子代理把产物写进文件、只回传引用"这条反电话游戏的做法 |
| 社区对 Claude Code 档位设置的整理（详见 `TURBO-CONTRACT.md` §7） | "**effort 与 orchestration 是两个正交的控制**"这一分档依据——正因为正交，Ultra 与闪电才是两个开关而不是一个等级 |
| 本机另一个 DSH 插件 `gpt6-delegation` 的实战经验 | "卡住时问一个不同模型的第二意见"这条兜底（写进 Ultra 第 8 条）；**未**采用它的对拍 SOP，原因记在 `policy.mjs` 顶部注释 |

**打包了什么**：只有上表第一行的 skill 目录。它们是上游的完整目录（含 prompt 模板与 `scripts/`），逐字节未改，
许可证全文随包。除它之外仓库不含任何第三方源码，也没有运行时依赖（见下一节）。

## 二·一、策略正文的逐条出处

`policy.mjs` 里的英文条款不是原创，是把下面这些公开成果**组合**出来的。逐条对应关系记在这里，
正文本身只留策略、不留出处说明——**出处是要给人看的，不是每一步都要发给模型看的**。

| 条款 | 出处 |
| --- | --- |
| 优先级与作用域（`PRECEDENCE`） | 自己写的；用来消解"模糊就问"与"别问了直接干"的冲突 |
| Ultra 1（先定义"做完"） | ClaudeWorld S28 的"可见覆盖边界" + superpowers `verification-before-completion` 的 gate function |
| Ultra 2（证据先于断言、置信度三档） | superpowers `verification-before-completion`（Iron Law：evidence before claims）+ ClaudeWorld S28 的"证据契约"字段 |
| Ultra 3（对抗式复查） | ClaudeWorld S28 的 adversarial verification |
| Ultra 4（先定位根因，症状级修补要明说） | superpowers `systematic-debugging` 的 Iron Law |
| Ultra 5（已验证 / 推断分开写） | ClaudeWorld S28 的"未验证必须显式标注" |
| Ultra 6（停止条件） | ClaudeWorld S28 的显式停止条件 + Anthropic 多智能体博客的成本纪律 |
| Ultra 7（不许改测试迁就实现） | superpowers `systematic-debugging` / `verification-before-completion` |
| Ultra 8（卡点时短问 Astra 一次） | 本机另一个 DSH 插件 `gpt6-delegation` 的实战经验；**未**采用它的对拍 SOP——那套假设两端都吃长背景包，与 Astra"不吃长输入、不产长输出"的实际限制冲突，照抄只会写出跑不动的流程 |
| 闪电 1（只管不做） | Anthropic 多智能体博客的 orchestrator 分工 + superpowers `dispatching-parallel-agents` |
| 闪电 2（按边界正交拆，不许克隆） | superpowers `dispatching-parallel-agents`（one agent per independent problem domain）+ ClaudeWorld S28 的正交搜索 |
| 闪电 3（一条消息里并发派发） | DSH 的运行时语义（同一条消息里的多个委派调用并行执行，跨消息串行） |
| 闪电 4（子代理 prompt 自包含） | Anthropic 多智能体博客的委派契约四要素 + superpowers `dispatching-parallel-agents` |
| 闪电 5（规模阶梯 + 并发硬上限） | Anthropic 多智能体博客的规模阶梯；硬上限是本地补的安全阀（没有上限时模型会无节制 fan-out） |
| 闪电 6（同一文件只给一个写者） | 本地补的；多个子代理同写一个文件会互相覆盖，这是并行委派最常见的真实事故 |
| 闪电 7（子代理写文件，只回传指针） | Anthropic 多智能体博客的"别玩电话游戏" |
| 闪电 8（集成、查冲突、自己跑整合验证、抽查） | superpowers `dispatching-parallel-agents` + `subagent-driven-development` 的 review 环节 |
| 闪电 9（卡点短问 Astra） | 同 Ultra 8 |
| 闪电 10（成本诚实：约 15× token） | Anthropic 多智能体博客（token 用量解释约 80% 的方差） |
| 闪电 11（加载 playbook） | 见上一节，skill 已随仓库打包 |
| 子代理守则（`SUBAGENT_GUARD`） | 本地补的防递归；子代理会继承父代理的注入，没有这一条会指数级 fan-out |
| "effort 与 orchestration 正交"（为什么是两个开关而不是一个档） | 社区对 Claude Code 档位设置的整理（`TURBO-CONTRACT.md` §7）。Claude Code 的 `ultracode` = xhigh + 编排，正好说明两者可以叠加 |

## 三、运行时依赖

本插件**零运行时依赖**（`package.json` 没有 `dependencies`）：宿主半边只用 Node 内置模块，客户端半边只用宿主注入的模块加载器与 React。
不发起任何外部网络请求，也没有遥测。

## 四、如果你的成果出现在这里但你希望被移除

开 issue 即可，会立刻改署名或删掉对应引用。

---

## English

The plugin's **code** is original; its **interaction design and prompt strategies** build on public work, credited above. Three assets are reused under licence: the lightning-bolt outline is [Feather Icons](https://github.com/feathericons/feather) `zap` (MIT); React (MIT) is a peer dependency fetched from the host's module loader rather than bundled; and four [obra/superpowers](https://github.com/obra/superpowers) skills (MIT) are bundled verbatim under `skills/` — the full MIT text ships as `skills/LICENSE-superpowers`, install steps in `skills/README.md`. The prompt engineering also draws on Anthropic's [multi-agent research system post](https://www.anthropic.com/engineering/multi-agent-research-system); §II-i above maps each policy rule to its source.

**Beyond those four skills, no third-party source code is bundled**, and there are no runtime dependencies.
