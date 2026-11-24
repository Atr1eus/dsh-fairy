# DSH Fairy

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）装一个「人」：她有自己的聊天窗，
会打招呼、记得住事，也能替你干活。这个仓库是两个插件——**Fairy 伙伴预设** 和 **本地长期记忆**：

| 包 | 作用 | 目录 |
| --- | --- | --- |
| `dsh-fairy` | 侧边栏 **Fairy** 入口 + 气泡聊天面板 + `companion` 人格预设 | [`packages/dsh-fairy`](packages/dsh-fairy/README.md) |
| `dsh-memory` | `remember` / `recall` 工具、新会话记忆注入、长对话滚动摘要、记忆面板 | [`packages/dsh-memory`](packages/dsh-memory/README.md) |

两个包各自独立可装：Fairy 不装记忆也能用（人格会自动降级，不会假装记得），装上记忆才有跨会话记忆。

## 安装

需要 DSH 桌面版（带 Web GUI 的 profile，一般叫 `desktop`），Node ≥ 20。插件依赖的 `@deepseek-ai/*` 由 DSH 自带，不用另装。

仓库是 monorepo，每个包在子目录里，所以安装地址要带 `#path:`：

```sh
# 记忆（推荐，先装它）
dsh plugin --profile desktop add "git+https://github.com/Atr1eus/dsh-fairy.git#path:/packages/dsh-memory"

# Fairy
dsh plugin --profile desktop add "git+https://github.com/Atr1eus/dsh-fairy.git#path:/packages/dsh-fairy"
```

也可以先 clone 下来，按本地路径装：

```sh
git clone https://github.com/Atr1eus/dsh-fairy.git
dsh plugin --profile desktop add "$PWD/dsh-fairy/packages/dsh-memory"
dsh plugin --profile desktop add "$PWD/dsh-fairy/packages/dsh-fairy"
```

或者走 GUI：侧边栏 **插件 → 添加插件**，把上面那个 `git+https://…` 地址贴进去，两个包各装一次。

装完重启客户端：侧边栏会多出 **Fairy** 和 **本地记忆** 两个入口，新会话的默认预设变成 Fairy。
想保留标准编码预设，把 `packages/dsh-fairy/cordis.patch.yml` 末尾 `agent-preset-registry` 的 `default` 改回 `standard`。

卸载：

```sh
dsh plugin --profile desktop remove dsh-fairy
dsh plugin --profile desktop remove dsh-memory   # 记忆数据在 ~/.dsh/memory/，不会跟着删
```

## 开发

```sh
npm test          # 跑两个包的全部自检（Host RPC、槽位注册、存取/注入/摘要、图片路由）
```

仓库没有构建步骤：`index.js` / `client.js` 就是源码，DSH 直接加载。改完重启客户端生效。

## 许可

MIT
