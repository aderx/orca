# 本 fork 的定制开发约定

开发个人定制功能、扩展插件接口、同步上游源码或打包定制版本前，先阅读 [定制功能开发与上游升级](./docs/readme/custom-fork-development.md)。

业务优先放入独立 Orca 插件，宿主只增加必要的通用扩展；当前采用源码同步和重新构建的升级方式。该文档记录已确定的交互、实施边界、验证和升级流程，不代表其中的待交付功能已经实现，也不扩大用户授权。完成相关功能或上游替换适配后同步维护该文档。

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

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Most of it is linted: `pnpm run check:code-quality:changed` fails on new restyles of a `components/ui/` primitive, raw palette colors, and computed `className` strings; `pnpm lint` fails on any class Tailwind cannot generate. See the Enforcement section of the style guide before suppressing either. Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role. When STYLEGUIDE.md is silent, follow the resolution order in its final section. In `components/native-chat/`, the "Chat type scale" and "Chat text colour, hover and focus" sections are binding, and `pnpm lint` fails on arbitrary font sizes, softened `text-foreground`, and weakened focus rings there.

## Electron UI Validation

**本项目可见运行特例（用户持续授权）：** Orca ZStack 开发版及本项目已获启动授权的服务可以显示窗口、打开对应页面并进入前台，供用户查看和页面功能/样式审查；无需再次询问是否允许展示。启动供用户查看的实例时，不设置 `ORCA_BACKGROUND_LAUNCH=1` 或其他强制隐藏窗口的环境变量。此特例覆盖下方通用测试规则中的可见性限制，但不扩大服务启动、配置修改或真实业务操作的授权范围。

Pure automated tests remain background by default with `ORCA_BACKGROUND_LAUNCH=1`;
keep unrelated test windows hidden and use Playwright CDP for renderer inspection.
User-facing development and page-acceptance instances follow the visible-run exception above.
Rebuild modified launch-policy code before running an app; stale build wrappers are not safe.

Use the `$electron` skill and Playwright CDP for rendered Orca UI checks. Do not use computer-use for Orca UI validation.

# Style

## Reuse Before Reimplementing

Before writing new logic at any scale — a function, component, IPC channel, state store, or whole subsystem/flow — check whether an existing implementation already does the job (or nearly does). Extend or generalize it instead of building a parallel version; only write from scratch when nothing fits. Keep the check proportionate: a quick search for trivial code, a real one before building anything substantial.

## Concise/Brief Non-obvious Comments ONLY

- DO NOT: be verbose, explain the obvious, walk through the code ("WHY not HOW")
- BE CONCISE. 1 LINE if possible

## Lint Rules: Do Not Disable Max Lines

NEVER add a `max-lines` disable (`eslint-disable max-lines`, `oxlint-disable max-lines`, or line-specific variants), and never add a per-file `max-lines` bump in `mobile/.oxlintrc.json`.

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

## Type Declarations: Prefer `.ts` Over `.d.ts`

## Type Assertions: Prefer Checked Types

Avoid type assertions except `as const`. Unavoidable casts need a line-specific `SAFETY:` explanation:

```ts
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Explain the verified invariant here.
```

# Verifying Changes

下列命令是按需使用的工具参考，不是本 fork 每次开发都要执行的检查清单；验收流程以“本项目的开发、页面审查与本地交付”为准。

- **Typecheck**: `pnpm tc` (or `tc:node` / `tc:cli` / `tc:web`)
- **Test**: `pnpm test [path/to/file.test.ts]`
- **Lint**: `oxlint`, or `pnpm run check:code-quality:changed` for changed files (full `pnpm lint` is slow); format with `pnpm format`
- **Design system**: `pnpm run lint:design-system` for the full renderer report (not a gate); the changed-lines gate above is what CI enforces
- **Real Claude CLI**: when you change Claude structured-session code (`src/main/claude/claude-structured-*`), run `ORCA_REAL_CLAUDE_CLI_TEST=1 pnpm test src/main/claude/claude-structured-real-cli.test.ts src/main/claude/claude-structured-real-cli-fold.test.ts`; it uses your real Claude login

# Writing Pull Requests

Fill in [`.github/pull_request_template.md`](./.github/pull_request_template.md), written for a reviewer who has never seen this code:

- No jargon — plain language, no internal shorthand.
- The before and after as the user experiences it.
- The mechanism you changed, not just the symptom.
- Why this approach over the alternatives you considered.

Cover all four concisely. Don't pad or walk the diff.

# Considerations

## Worktree Safety

Always use the primary working directory (the worktree) for all file reads and edits. Never follow absolute paths from subagent results that point to the main repo.

## Cross-Platform Support

Orca targets macOS, Linux, and Windows. Keep all platform-dependent behavior behind runtime checks:

- **Keyboard shortcuts**: Never hardcode `e.metaKey`. Use a platform check (`navigator.userAgent.includes('Mac')`) to pick `metaKey` on Mac and `ctrlKey` on Linux/Windows. Electron menu accelerators should use `CmdOrCtrl`.
- **Shortcut labels in UI**: Display `⌘` / `⇧` on Mac and `Ctrl+` / `Shift+` on other platforms.
- **File paths**: Use `path.join` or Electron/Node path utilities — never assume `/` or `\`.
- **Windows terminal shells**: `--shell` picks the shell a terminal _is_; `--command` is typed into whatever shell the host spawned, so a shell choice routed through `command` silently becomes a child process.
- **Windows setup scripts**: the setup/issue-command runner is a `.cmd` batch file unless the script starts with a `#!` line — never derive that from the user's terminal-shell preference, and never launch a `.cmd` runner with a bare `cmd.exe /c` from a Git Bash pane (MSYS rewrites the `/c`).
- **Windows child processes**: start them through `runProcess`/`spawnProcess` from `@orca/process-host` — never `child_process` directly. It pins `windowsHide`, refuses `shell: true`, and encodes `.cmd`/`.bat` arguments so neither `CommandLineToArgvW` nor `cmd.exe` mangles them. Recognised npm/pnpm `.cmd` shims are resolved to their real target so the spawn skips `cmd.exe` entirely.
- **Ripgrep**: Orca bundles `rg` for every platform, WSL, and SSH remotes. Spawn it through `spawnBundledRipgrep` (main) or `resolveRelayRipgrepCommand` (relay), never a bare `'rg'` — Windows resolves a bare name in the spawn cwd before PATH. Don't add git/readdir fallbacks locally; the relay's chain exists only for hosts an upload never reached.
- **Windows process enumeration**: read the table through `src/main/windows/windows-process-table.ts`, never by forking `powershell.exe`.
- **Windows MSYS/Git Bash panes**: their children break away from the per-PTY job unless it is created without `JOB_OBJECT_LIMIT_BREAKAWAY_OK`, and a `conpty.node` built before that fix passes every existing gate.
- **Windows daemon-host relocation**: the terminal daemon runs from a copy of the app runtime under `%LOCALAPPDATA%`, which is what survives an auto-update.
- **macOS daemon launch**: packaged macOS runs the terminal daemon from a copy of the signed terminal host helper through launchd, so an update cannot sever its privacy grants. Before touching that copy, its cleanup, or the fork fallback, read [`docs/reference/macos-daemon-tcc-attribution.md`](./docs/reference/macos-daemon-tcc-attribution.md).
- **Windows EDR signal**: don't add `-ExecutionPolicy Bypass`, `-EncodedCommand`, `cmd.exe /c` with escaped free text, per-operation interpreter spawning, or runtime `Add-Type` compilation without reviewing the EDR impact first — behavioural EDR scores each of those, and being signed does not clear them.
- **WSL commands**: build argv with `buildWslExecArgs` (always `--exec` — under `--`, `wsl.exe` expands `$name` in every argument and silently rewrites the script), and fence anything whose stdout you parse with `buildWslCapturedLoginShellCommand`, because the interactive login shell prints the distro banner to stdout.
- **Linux native modules**: keep the glibc floor at Ubuntu 20.04 / glibc 2.31. A module compiled from source on a newer runner can reference symbol versions absent on the floor and crash the app on startup. Packaging fails if a bundled native binary needs newer glibc.

## Native Dependency Installs

Ordinary `pnpm install` covers the host OS and CPU only. Before packaging for another architecture — including `pnpm build:mac`, which builds x64 and arm64 by default — run `pnpm install:release`. electron-builder only warns on a missing `extraResources` source, so the `beforePack` guard is what turns a thin install into a build failure instead of a silently broken artifact.

## SSH Use Case

All changes must consider the SSH use case. Don't assume local-only execution. Before changing anything that reports on, stops, or lists remote work, the execution host owns everything that touches execution, and loss of contact is never evidence of process death — the verdict vocabulary is `live` / `unverifiable` / `exited`, with no synonyms.

## Folder Workspace Use Case

All changes must consider folder workspaces as well as git worktrees. Don't assume every workspace is a git worktree.

## Agent Status

The execution host owns agent status in one store, the hook server's, and every reader (sidebar, `worktree ps`, mobile, dashboard) subscribes to it. New producers write into that store, and readers keep only presentation policy.

## Agent Terminal Screens

A rule that reads what an agent CLI paints on a terminal — readiness, blocked prompts, idle — must be written against a captured transcript, not a remembered screen. Use `config/scripts/capture-agent-pty-transcript.mjs` to keep escapes and wrapping intact and scrub account identifiers before they reach git.

## Remote Wire Compatibility

Clients and remote Orca servers update independently, so mixed versions are the normal state. Before changing anything a paired client and host exchange — RPC params, stream frames, or the content either side publishes over them — preserve compatibility with older peers. A new optional field is safe; a new stream opcode must be capability-negotiated because decoders drop unknown opcodes silently; and changing what the host publishes reaches old clients even with no wire change.

## Git Binary Compatibility

Orca runs the user's Git binary on native, WSL, and SSH hosts, which may all have different versions. Treat Git 2.25 as the core-workflow baseline.

When adding or changing a Git command:

- Check when every subcommand and option was introduced. For newer behavior, keep a baseline-compatible fallback or degrade safely.
- Use `GitCapabilityCache` with a narrow unsupported-error predicate so recurring operations do not retry a known-invalid command. Do not rely only on `git --version`; wrappers such as `simple-git` do not remove host-version differences.
- Scope capability state to the host that executes Git: native, WSL distro, SSH provider, or relay connection. Cover the first fallback, later cached calls, concurrent probes, and relevant host isolation in tests.
- Keep the real-binary compatibility contract in PR CI current. When adopting a newer Git feature, add its version boundary so the preferred command and fallback both run against representative Git releases.
- Preserve commands that begin with global Git options such as `-c` before the subcommand, including auto-maintenance suppression used by worktree-create fetches.

## Git Scan Safety

- Never enumerate every ref and then run `git ls-tree -r` or `git show` once per ref. That ref × tree fan-out can retain gigabytes of output before a downstream `sort -u` or search can make progress.
- Prefer `rg` over the checked-out files for source searches. For history or refs, use a named ref, an explicit namespace/path, `--max-count`, and a bounded output; do not use an unqualified `--all` scan as a first diagnostic.
- Keep repository-wide commands targeted to the current repository and worktree. If an unbounded scan is genuinely required, measure the ref count first, explain the cost, and get confirmation before running it.

## Git Provider Compatibility

Source-control and review changes must consider GitLab and other supported git providers, not only GitHub. Keep provider-specific behavior behind explicit checks, and avoid GitHub-only naming for generic review concepts.

## GitHub CLI Usage

Be mindful of the user's `gh` CLI API rate limit — batch requests where possible and avoid unnecessary calls. All code, commands, and scripts must be compatible with macOS, Linux, and Windows.
