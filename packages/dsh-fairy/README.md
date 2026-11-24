# DSH Fairy · 会聊天的伙伴预设

![Fairy](sticker.jpg)

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）装一个「人」：
它不是任务面板里的工具视图，而是侧边栏里一间自己的聊天室——微信/QQ 式的左右气泡、不显示工具卡片和步骤，
你点进去她就抬头打个招呼。写代码时随时能切回标准预设。

这个仓库是一个 DSH 插件（bundle patch + Web 客户端），装完会得到：

- **一套 Fairy 人格预设**（`companion`）：中文、叫你「主人」、记得住事、也能干活；
- **侧边栏入口 + 独立聊天面板**：`sidebar.panellist` 里多一项 **Fairy**，点开是气泡聊天，Enter 发送、Shift+Enter 换行；
- **主动问候**：距上次问候和你上一条消息都超过 30 分钟、且她闲着时，进门会先开口；
- **发图片**：输入框「+」选图（最多 4 张，单张 ≤ 10MB），她真的能看图；
- **审批卡片**：需要你允许的操作会以卡片浮在输入框上方，点「允许一次 / 拒绝」。

## 安装

需要 DSH 桌面版（带 Web GUI 的 profile，通常是 `desktop`），Node ≥ 20。插件依赖的 `@deepseek-ai/*` 包由 DSH 自带，不用另装。

这个包在 [本仓库](../..) 的 `packages/dsh-fairy`，装的时候地址要带 `#path:`：

```sh
# 从 GitHub 装（推荐）
dsh plugin --profile desktop add "git+https://github.com/Atr1eus/dsh-fairy.git#path:/packages/dsh-fairy"

# 或先 clone 再按本地路径装
git clone https://github.com/Atr1eus/dsh-fairy.git
dsh plugin --profile desktop add "$PWD/dsh-fairy/packages/dsh-fairy"
```

也可以在 GUI 里装：侧边栏 **插件 → 添加插件**，把仓库地址贴进去。

装完重启客户端，侧边栏就会多出 **Fairy**。新会话的默认预设会变成 Fairy；
想保留标准编码预设，把 `cordis.patch.yml` 最后那段 `agent-preset-registry` 的 `default` 改成 `standard`。

> **记忆可选**：想让她「记得住」就再装同一个仓库里的 [`dsh-memory`](../dsh-memory/README.md)，数据放在 `~/.dsh/memory/`。
> 不装也能用——人格提示词检查 `remember` / `recall` 在不在，不在就按「没有记忆」处理，不会假装记得。

## 怎么用

- 左侧栏点 **Fairy** 进入独立聊天面板；上下文和记忆跨次保留。
- 想清空这间聊天：调用本机 RPC `/fairy/reset`（清掉 state.json 里的会话 id，旧会话仍留在磁盘）。
- 状态在 `~/.dsh/fairy/state.json`，诊断日志 `~/.dsh/fairy/debug.log`（只记会话 id 和错误，不记聊天内容）。
- 新开的 Fairy 会话工作目录是你的 home 目录，不是 profile 目录。

## 配置

插件 config（`cordis.patch.yml` 里 `id: fairy` 那一段）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `agentPreset` | `companion` | 用哪个预设跑这间会话 |
| `directory` | `~/.dsh/fairy` | 状态与日志目录，支持 `~`、相对路径、`<home>` |

## 改人格

人格全在 `cordis.patch.yml` 的 `persona.prefix` 里——称呼、语气、边界、表情包规则都是那段中文，直接改，重启客户端生效。
`plugins` 列表决定她有哪些工具（文件、搜索、命令、日程、Office 技能、待办、长对话压缩），可以增删。

## 自检

```sh
npm test
```

三个脚本分别覆盖 Host 半边（RPC 鉴权、会话创建/恢复、问候窗口、history、send、reset）、
Web 客户端（模块 id、槽位注册、locale）、以及图片与贴纸路由。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-fairy
```

## License

MIT
