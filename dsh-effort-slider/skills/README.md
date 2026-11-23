# 随包技能（vendored skills）

这四个 skill 是 **Ultra** 与**闪电**两个模式策略正文里点名要加载的 playbook。它们在这里，
不是装饰 —— 正文写了要加载、文件却不在，模型就会去加载不存在的东西，用户看到的是
「找不到调用的东西」。

- Ultra 规则 8 → `verification-before-completion`、`systematic-debugging`
- 闪电规则 11 → `dispatching-parallel-agents`、`subagent-driven-development`

正文见 `../policy.mjs`。

## 出处与许可

| 项 | 值 |
| --- | --- |
| 上游 | [obra/superpowers](https://github.com/obra/superpowers) |
| 版本 | commit [`8ca22dba9a94f28898bbce59f2537ff4d87c747d`](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d) |
| 许可 | MIT，© Jesse Vincent / Prime Radiant。全文见 [`LICENSE-superpowers`](LICENSE-superpowers) |
| 改动 | **无**。逐字节取自上游；`VENDOR.json` 记着来源，`test/host.test.mjs` 第 [6] 组会挡回归 |

## 怎么装

**自动。** 插件在 `apply()` 里调用 `installBundledSkills()`（见 `../index.mjs`），把四个目录
复制到 DSH 的用户技能根：

- `$DSH_HOME/skills/<name>/` —— 设了 `DSH_HOME` 就用它
- 否则 `~/.dsh/skills/<name>/`

三条纪律：

1. **绝不覆盖**已存在的目录。那儿可能已经是更新的上游版本，也可能是你自己改过的。
2. 每个技能独立成败 —— 一个失败不影响另外三个，也不影响滑条本身（整段包在 try/catch 里）。
3. 技能目录是 DSH **watch** 着的，所以装完立刻能被发现，不需要重启。

**手动**（想装到别处，或者不想让插件写你的主目录）：

```bash
cp -r skills/verification-before-completion ~/.dsh/skills/
cp -r skills/systematic-debugging           ~/.dsh/skills/
cp -r skills/dispatching-parallel-agents    ~/.dsh/skills/
cp -r skills/subagent-driven-development    ~/.dsh/skills/
```

## 怎么确认它到位了

```bash
curl -s localhost:<dsh 端口>/plugins/dsh-effort-slider/preferences | jq .skills
```

四个键的值应当是 `installed`（刚装）、`present`（那儿本来就有，没动）、`missing`
（这个安装里没带）或 `failed: <原因>`。同一个响应里的 `skillsHome` 说的是它装到了哪。
