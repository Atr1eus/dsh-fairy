# 本地长期记忆（DSH 插件）

给 DeepSeek Harness 加上跨会话的本地记忆：助手能 `remember` / `recall`，新会话自动带上画像；
长对话超过阈值会自动生成滚动摘要并把原文另存 JSONL；Web 侧边栏还有一块「本地记忆」面板。

**纯本地**：不调用任何外部服务、不做遥测；数据就是 `~/.dsh/memory/` 下的普通文本文件。

---

## 安装

需要 DSH 桌面版（带 Web GUI 的 profile，一般叫 `desktop`），Node ≥ 20。插件依赖的 `@deepseek-ai/*` 由 DSH 自带。

这个包在 [本仓库](../..) 的 `packages/dsh-memory`，装的时候地址要带 `#path:`：

```sh
# 从 GitHub 装
dsh plugin --profile desktop add "git+https://github.com/Atr1eus/dsh-fairy.git#path:/packages/dsh-memory"

# 或先 clone 再按本地路径装
git clone https://github.com/Atr1eus/dsh-fairy.git
dsh plugin --profile desktop add "$PWD/dsh-fairy/packages/dsh-memory"
```

装完重启客户端，左侧栏会多出 **本地记忆** 入口（记忆图标）。

| 内容 | 位置 |
| --- | --- |
| 记忆数据 | `~/.dsh/memory/`（`memory.md`、`index.json`、`archives/`、`summaries/`、`ui-state.json`） |
| 配置覆盖 | profile 的 `cordis.patch.yml` 里 `- id: local-memory` 的 `config` |

想让它和 [Fairy](../dsh-fairy/README.md) 一起用，就把两个包都装上——Fairy 的 `remember` / `recall` 就是这里提供的。


## 怎么用

- 直接对助手说「记住：我偏好中文沟通」「回忆一下我之前说过的论文要求」即可，模型会调用 `remember` / `recall`。
- 侧边栏面板可以：搜索、新增、固定/取消固定、删除；并能看到长对话摘要与原文归档。
  面板顶部会显示「面板已连接 / 尚未收到心跳」——这是浏览器里客户端模块加载后写下的
  `~/.dsh/memory/ui-state.json`，只记录时间与几个布尔值，不含任何记忆内容。
- 手工编辑 `~/.dsh/memory/memory.md` 也行，保存后下一次检索/重启就生效。

### `memory.md` 格式

每行一条记忆：

```markdown
- [fact] (2026-10-25T18:48:04+08:00) 用户偏好中文沟通 #偏好 <!-- session=session-xxx -->
```

- `kind`：`fact` / `preference` / `event` / `note`
- 行尾 `#标签` 会被识别为标签（空格分隔）
- 行尾加 `!pinned` 表示固定；新会话注入时 pinned 优先。例如：
  `- [preference] (2026-10-25T18:48:04+08:00) 用户偏好中文沟通 #偏好 !pinned`
- 行尾 `<!-- session=... -->` 是插件写入的来源会话元数据，可删

`index.json` 只是派生索引：删掉它，重启后插件会依据 `memory.md` 重建（id 不变、pinned 不变）。

## 配置

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 里覆盖（整段 `config` 会替换默认值，没写的键用默认）：

```yaml
- id: local-memory
  config:
    directory: '/Users/你的名字/Documents/dsh-memory'   # 默认 $DSH_HOME/memory
    recentLimit: 8          # 注入时附带最近多少条非 pinned 记忆
    budgetChars: 1200       # 注入上下文总字符预算
    maxEntries: 5000        # 记忆库上限，超出淘汰最旧的非 pinned
    maxContentLength: 500   # 单条正文上限（字）
    injectContext: true     # 是否在每个新会话注入
    summaryEnabled: true    # 是否启用长对话滚动摘要
    summaryTurns: 60        # 超过多少轮触发一次摘要
    summaryTokens: 8000     # 或超过约多少 token 触发
```

## 长对话滚动摘要

- 触发：单个顶层会话累计超过 `summaryTurns`（默认 60 轮）**或** `summaryTokens`（默认约 8000 tokens）时触发一次。
- 触发后：
  1. 生成一段**本地抽取式**摘要（用户提问 + 助手回答的代表片段 + 用到的工具），以 `kind: note`、标签 `summary` 写入记忆库，新会话会自动带上；
  2. 原文逐事件另存为 `~/.dsh/memory/archives/<sessionId>.jsonl`（含用户、助手、工具调用与结果）；
  3. 状态写入 `~/.dsh/memory/summaries/<sessionId>.json`（已覆盖轮次、历次摘要）。
- 然后计数器清零，继续「滚动」下 60 轮 / 8000 tokens。
- 摘要**不调用模型、不联网**，因此是抽取式的；需要更精炼的模型摘要时以 JSONL 原文为准，或自行替换 `lib/session-summary.js` 里的 `buildSummary`。
- 子代理会话（delegationDepth > 0）不参与摘要与归档，避免噪音。

## 注入规则

每个新会话（新 agent）创建时取一次快照，拼成一段带来源标注的文本注入 system prompt：

- 先 pinned（新的在前），再最近 `recentLimit` 条非 pinned；
- 总长 ≤ `budgetChars`（默认 1200 字符），超出时按「pinned 优先 → 时间新近」截断，并注明还有多少条未展示；
- 文本以 `[Local memory / 本地记忆]` 开头，明确告诉模型这不是用户本次说的话。

## 自检

```bash
npm test                        # 两套都跑
node test/self-check.mjs        # 13 项：存取/去重/上限/淘汰/检索/预算/重建/摘要
node test/integration.mjs       # 假 ctx 装配：工具注册/执行、注入快照、面板 RPC、滚动摘要
```

`~/.dsh/memory/ui-state.json` 里的字段含义：

| 字段 | 含义 |
| --- | --- |
| `sidebar` / `main` | 浏览器里侧边栏入口 / 主面板已注册 |
| `sidebar_rendered` | 侧边栏图标组件已在页面中渲染 |
| `last_ready_at` | 最近一次心跳时间 |

面板数据走本机 RPC（`/local-memory`），需要浏览器登录态；插件不监听外部地址、不发起外部请求。

## 修改与删除

- 改行为：直接改本目录代码（本地路径安装时改完重启客户端即生效；从 GitHub 装的要重新装一次）。
- 改配置：改 `cordis.patch.yml` 里 `- id: local-memory` 的 `config`。
- 停用：把 profile `package.json` 里 `dsh.profile.bundles` 中的 `dsh-memory` 删掉（或写成 `disabled: true` 的 patch 行）。
- 卸载：`dsh plugin --profile desktop remove dsh-memory`。
- **记忆数据与插件解耦**：卸载不会删除 `~/.dsh/memory/`，想清空就手动删该目录。

## 已知限制

- 检索是词法匹配（大小写不敏感的子串/分词），没有向量检索；中文按关键词命中。
- 正文统一存成一行（换行会变成空格），单条上限 500 字。
- 注入快照只在 agent 创建时取一次，同一会话内新写入的记忆不会改写已发出的 system prompt。
- 滚动摘要只统计插件加载后发生的事件；客户端重启会重置未满一轮的计数（已归档/已摘要的进度保留在 `summaries/`）。
- 面板通过本机 RPC 读取数据，需要浏览器登录态；插件不开放任何外网端口或外部请求。
