# d2p — demo to product

> 把 demo 推到 product 的本地工具。
> 你给一个 demo 文件夹 + 一段自然语言 vision，d2p 派 Claude Code 子进程
> 自动补 auth / tests / 错误处理 / 部署配置 / docs / 监控 等"产品级肌肉"，
> 自动 commit、自动 merge，直到 preset 清单 + vision 双绿才停。

**Repo**: https://github.com/Upp-Ljl/d2p

**状态**：原始产品目标已完整实现。71 单测全绿、端到端 smoke 用 fake-claude 跑通。
真 cc 实跑需要你的机器有 `claude` 登录态。

## 为什么是本地工具，不是 SaaS

d2p 必须在你的机器上跑，因为它要：

- 读写你硬盘上的 git 仓库（worktree、commit、merge）
- 长进程 spawn `claude` CLI 子进程，**用你已经付的 Claude Code 订阅，不烧 API key**
- 常驻 daemon、SSE 长连接、本地 SQLite

→ 这些 Vercel / serverless 都跑不了。**别想着把 d2p 部署上线，它就是你 IDE 旁边的小帮手。**

## 它做什么

给一个本地仓库 + 一段 vision，d2p：

1. 多轮对话问你"这个 demo 想做成啥样"，存成 markdown
2. 看仓库猜项目类型（saas-web / api-service / cli-tool / library / static-site / ...）
3. 派 differ 找差距，produce gap 队列
4. 每个 gap 进 git worktree → spawn implementer → 4 层 reviewer
   pipeline（Static Gate → Alignment → Behavioral → 高敏 gap 加 Adversarial
   + 跨引擎二审）→ merge `fix/<slug>` 回 main
5. 用户可随时 pause；改 `vision.md` / `preset-overrides.yaml` 触发 watcher，loop 自动 re-diff
6. preset 全绿 + vision verdict yes（双绿）才宣告 DONE

## 快速开始

需要 [Claude Code](https://claude.com/claude-code) 登录态 + Node 24+ + Git。

```bash
git clone https://github.com/Upp-Ljl/d2p.git
cd d2p
npm install
npm run build
npm link --workspaces            # 把 d2p 命令挂到全局

claude login                     # 如果还没登录过 Claude Code
d2p doctor                       # 自检 claude / git / sqlite / presets
d2p start                        # 起 daemon + UI；浏览器自动开 http://localhost:5173
```

UI 打开后：选 demo 文件夹 → 确认项目类型 → 多轮回答 vision → 启动主循环 →
看着它干活。随时点 Pause / Resume / End。

### 装成系统服务（开机自启，可选）

```bash
d2p install-service              # 生成 ~/.d2p/service/ 下的安装脚本
                                 # Windows: 管理员跑 install.cmd
                                 # macOS:   launchctl bootstrap ...plist
                                 # Linux:   systemctl --user enable --now d2p-daemon
```

详细步骤在生成时打印出来。

## 验证

```bash
npm run typecheck                # 三个 workspace 全过
npm test --workspace daemon      # 71 单测，~5s
npm run smoke                    # 端到端跑通（用 fake-claude shim，不烧 cc）
npm run build                    # daemon tsc + UI vite + cli tsc
```

## 仓库布局

| 路径 | 内容 |
|---|---|
| `daemon/` | Hono server `:5174`，编排 + agents + 状态 + SQLite |
| `ui/` | Vite + React + Tailwind `:5173`，4 页面 + SSE 实时日志 |
| `cli/` | `d2p start | stop | status | open | doctor | install-service` |
| `presets/` | 6 套内置验收清单（saas-web / api-service / cli-tool / library / static-site / unknown） |
| `scripts/` | dev runner / 端到端 smoke / fake-claude shim |
| `fixtures/` | smoke 用的最小 demo |
| `docs/` | `DEV-DOC.md` + 10 份 details + 计划 |

## 给 d2p 添加新 preset

在 `presets/` 加一个 `<your-type>.md`，frontmatter 写 `type / name / version`，body 用
`- [ ] slug: description` 列条目。然后在 detector 输出枚举里加上这个类型名。
重新 `npm run build && d2p start`，UI 的"类型确认"列表里就有了。

## 开发

工作流规则在 `CLAUDE.md`。完整设计在 `docs/DEV-DOC.md`。计划落地节奏在
`docs/plans/`。所有 commit 走 conventional commits（`feat / fix / chore /
docs / test / refactor / perf`）。

## License

TBD — 看你打算开源还是闭源再放。
