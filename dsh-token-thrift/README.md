# dsh-token-thrift

让 DSH **花得聪明**，而不只是被卡住上限。

## 它和 `dsh-agent-budget` 的分工

[`dsh-agent-budget`](https://github.com/vibeinging/dsh-agent-budget) 做的是**准入**：每次请求服务商
之前判断"这笔花得起吗"，花不起就拒绝。那是"限制"，也很有价值——它保证你不会超支。

本插件做**另一半**：在还没超支的时候，让同样的活花更少。它**不拒绝任何请求**，只做两件事：

1. **按花费升级劝告**——花到预算的一档，就往上下文里注入一条提醒，从"读文件前先想想要不要读"
   到"别再探索了，交活"。
2. **遮罩会开枝的工具**——到了后段，把 `subagent` / `workflow` / `ralph` 从该 agent 的工具表里
   摘掉。

> **省 token 最有效的一招不是少说几句，而是不要再开新的分支。** 每开一个子 agent，整段上下文
> 都要在新会话里重新读一遍——那是这个系统里最贵的一次复制。

两者可以同时装：一个兜底，一个省钱。

## 为什么是"提醒"而不是"拒绝"

一个跑在自动驾驶上的 agent，最贵的失败不是"多花了几千 token"，而是**"被中途掐断、活没干完"**。

所以本插件默认只劝告。`maskTools` 是唯一的硬手段，而它遮的是**枝**，不是**活**：主线的读写、
检索、编辑都还在，agent 仍然能把活干完。

## 配置

```yaml
- name: file:///path/to/dsh-token-thrift/lib/index.js
  config:
    budget: 2000000        # 0 = 关闭（默认）
    maskRatio: 0.9         # 到多少比例开始遮工具；不填则用最后一档的 ratio
    countCache: true       # 缓存 token 也算花费（它们确实计费）
    maxReminders: 6        # 单会话最多提醒几次，防止档位表写坏
    maskTools: [subagent, subagent_fork, workflow, ralph]
    tiers:
      - { ratio: 0.4, text: "……" }
      - { ratio: 0.7, text: "……" }
      - { ratio: 0.9, text: "……" }
```

**`budget: 0` 是关闭，且是真的关闭**——不注册任何监听器（有一条测试守着这件事）。

## 花费从哪来

读 DSH 自己的 `tokenUsage` 投影（`ctx.sessionProjections.snapshot`），不自己记账。理由是投影已经
是权威口径，自己再算一份迟早会和它对不上。

口径：`inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens`。

**`reasoningTokens` 不加**——它已经在 `outputTokens` 里，再加一次会让每个读数都虚高一个思考预算。

## 测试

```sh
node test/run.mjs
```

20 项，**不启 DSH**：造一个够用的伪 ctx，把钩子拿出来直接驱动。测的是插件的逻辑（哪一档该响、
响几次、什么时候遮工具），而不是 DSH 能不能起来——后者用
`dsh --profile <名字> --dump-config` 验。

## 已知边界

- **不保证不超支。** 那是 `dsh-agent-budget` 的事。本插件只在事后按比例劝告，中间那一步花多少
  它管不着。
- **`tools.restrict` 不存在时不会失败**——提醒照发，只是遮不了工具。为了一个可选的优化而中断
  整轮，是不划算的交易（有测试守着）。
- **只劝告，不阻断**。想要硬停，去装 `dsh-agent-budget`。
