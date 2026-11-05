# 本 fork 的定制开发约定

开发个人定制功能、扩展插件接口、同步上游源码或打包定制版本前，先阅读 [定制功能开发与上游升级](./docs/readme/custom-fork-development.md)。

业务优先放入独立 Orca 插件，宿主只增加必要的通用扩展；当前采用源码同步和重新构建的升级方式。该文档记录已确定的交互、实施边界、验证和升级流程，不代表其中的待交付功能已经实现，也不扩大用户授权。完成相关功能或上游替换适配后同步维护该文档。

## 每次合并 main 前检查原生插件能力

每次用户要求合并或同步 main，都必须按本次实际获取的 main 提交重新评估：当前额外功能能否只安装插件，在未修改的原生 Orca 中完整实现。不能沿用历史结论，也不能把 fork 新增的接口当作上游能力。

- 核对插件 manifest/capability、面板与 worker 调用、工作区上下文、原生终端及浏览器 TAB、工具栏/弹窗/服务 TAB 扩展位；应用标识、独立数据目录、构建号与更新策略单独说明。
- 以目标 main 的源码为依据，记录提交 SHA、已有官方能力、仍缺少的接口和对应源码位置；区分完整复现与需要改变交互的替代方案。
- 将本轮结论写入 `docs/readme/custom-fork-development.md` 并简要告知用户。只有实际检查证明等价时才提出移除宿主适配；评估本身不授权扩大公共层改动或迁移用户数据。

以下保留上游规则，定制开发同样适用。

## 本项目的开发、页面审查与本地交付

本节是用户明确指定的持续工作流程，2026-10-15 按个人项目需求精简；与旧记录中的检查清单、提交及交付约定冲突时，以本节为准。

1. **每个版本独立分支并保留远端记录。** 新版本开始前获取最新 `origin/dev`，从该提交创建 `xfu-dev/<构建号>`；同一版本的反馈修正沿用该分支。完成一批改动后提交相关源码、构建脚本和必要文档，并推送同名版本分支。个人版本提交使用 `HUSKY=0 git commit`，避免提交钩子再批量 lint 和改写格式。保留无关改动，截图、日志、临时核验脚本、用户配置及构建产物不入库，不补造历史版本提交。本流程已获用户持续授权，可提交、推送版本分支及合并、推送个人仓库的 `dev`，无需逐次确认；不包含其他远端或线上发版。
2. **必要编译后自动打开开发版。** 完成一批功能代码修改后，只编译运行本次改动必需的目标，复用或刷新当前源码对应的 Orca ZStack 开发版。使用独立标识和数据目录，显示窗口供用户查看，告知入口、PID 和端口并保留运行。启动已获持续授权，无需重复询问；不在每次保存时重启，也不连带启动 ZStack FE/BFF。
3. **只检查本次改动，控制返工范围。** 使用 CDP 查看需求涉及的页面和交互，完成一轮聚焦检查；修正后只复查受影响部分。默认不安排代码 Review、审查代理、全量 test/lint/typecheck、完整状态矩阵或多轮哈希核对，不为简单样式改动新写整套核验脚本。已有有效结果直接复用；额外检查仅用于定位实际错误。页面模拟不得调用真实启停或写配置接口，也不记为真实服务验收。
4. **本地验证完成后直接发布到 dev 并构建。** 本地聚焦检查通过后，将版本分支以 `--no-ff` 合并到最新 `dev` 并推送 `origin/dev`，保留版本提交和合并记录，不再请求用户测试或构建许可。随后执行 `git fetch origin dev`，从刚获取的 `origin/dev` 精确提交检出源码并构建当前 Mac 架构生产包；只在本地合并、未推送的版本分支或未提交源码均不能作为生产构建来源。记录远端、提交 SHA 和构建号，构建配方随源码入库。生产构建阶段不再运行测试、lint、typecheck、页面验收或重复核验，只执行必要编译及打包；未变动产物只在对应源码一致时复用。发生问题按历史版本分支或提交回退，不改写已有 Git 历史。
5. **备份、替换、启动。** 只替换 `/Applications/Orca ZStack.app`，保留旧包备份、原版 `/Applications/Orca.app` 和用户数据。安装后启动新版本即可，不再展开功能测试或重复核验。可选的旧包登记清理失败只记录原因，不阻断新包启动；不得把备份作为同名应用入口。不能安全退出承载用户任务的实例时说明阻塞。交付完成后关闭本任务开发版并确认其进程及端口释放，保留开发包和数据。
6. **文档和 Git 整理直接完成。** 只改说明文档或整理分支、提交时，查看差异和提交路径即可，不启动应用、不构建、不运行业务测试。交付说明只写实际结果、版本、分支、提交和必要的未完成项，不撰写长篇核验报告。

# Design System

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role.

# Electron UI Validation

**本项目可见运行特例（用户持续授权）：** Orca ZStack 开发版及本项目已获启动授权的服务可以显示窗口、打开对应页面并进入前台，供用户查看和页面功能/样式审查；无需再次询问是否允许展示。启动供用户查看的实例时，不设置 `ORCA_BACKGROUND_LAUNCH=1` 或其他强制隐藏窗口的环境变量。此特例覆盖下方通用测试规则中的可见性限制，但不扩大服务启动、配置修改或真实业务操作的授权范围。

Pure automated tests remain background by default with `ORCA_BACKGROUND_LAUNCH=1`;
keep unrelated test windows hidden and use Playwright CDP for renderer inspection.
User-facing development and page-acceptance instances follow the visible-run exception above.
Rebuild modified launch-policy code before running an app; stale build wrappers are not safe.

Use the `$electron` skill and Playwright CDP for rendered Orca UI checks. Do not use computer-use for Orca UI validation.

# Code Style

## Reuse Before Reimplementing

Before writing new logic at any scale extend or generalize it instead of building a parallel version.

## Avoid Comments

- Only use when code does not describe
- BE CONCISE. 1 LINE if possible (why not how)

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

# First Class Citizens

Every change must consider these areas:

1. Cross-Platform Support (mac/linux/windows)
   - Guard platform-specific behavior at runtime; use platform-aware shortcuts, paths, and existing process wrappers. Before changing platform-specific code, processes, shells, shortcuts, paths, or native modules, read [`docs/agents-md-refs/cross-platform-support.md`](./docs/agents-md-refs/cross-platform-support.md).
2. Remote hosts
   - Features should work locally and on remote hosts
3. Mobile
4. Folder Workspaces
   - Don't assume every workspace is a git worktree.

# Footguns

## Git / GitHub

If changing code around `git`, `gh`, source-control, or review behavior read [`docs/agents-md-refs/git-workflow.md`](./docs/agents-md-refs/git-workflow.md).
