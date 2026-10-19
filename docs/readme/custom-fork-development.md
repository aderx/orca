# 定制功能开发与上游升级

### 2026-10-19 终端回退与 BFF SSH 转发

- 版本分支 `xfu-dev/20261019.1` 从新获取的 `origin/dev`（`1bb1dabd22`）创建。修改仅涉及启动器插件、定制构建配方和说明文档，没有修改宿主公共终端 API。
- 同类终端无法复用时先显示 toast，再为已保留的同一次运行创建新终端；新建仍失败时才终止启动。旧终端和归属校验保留。
- BFF 高级配置新增 SSH 转发，开启后 HOST 使用 `127.0.0.1`；按所选 MN、BFF PORT 或 BASE_PORT + INSTANCE_ID 建立独立反向连接。默认密码 `password`，可在高级配置中修改，只认证一次，失败不继续准备依赖或启动 BFF。正常停止、取消、准备失败、服务退出与转发断开均清理本次连接，不修改 MN 配置。
- `node --experimental-test-module-mocks --test plugins/zstack-launcher/launch-recovery.test.mjs` 的 6 项隔离回归通过，覆盖默认/自定义密码传递、`.env` 隔离、启动摘要快照及连接清理；开发版 CDP 本轮 7 项聚焦检查通过，覆盖 switch 排列及键盘切换、密码默认值与草稿、独立启动参数、运行标签及关闭后隐藏。此前已验证 toast 与新建终端请求顺序。启停与 SSH 使用模拟实现，没有启动真实 FE/BFF、连接 MN 或写入真实项目 `.env`。
- 同版本反馈修订：SSH 转发使用左侧名称、右侧 switch，开启后显示默认 `password` 的密码输入。密码仅保存在插件选择及本次私有运行记录，不写入项目 `.env`。运行摘要按本次启动记录显示 MN IP、HOST、开启时的 `SSH:密码`，以及已开启的 API_INSPECTOR / INTERACTIVE_COLLECT / OPEN_PLATFORM；后续修改选择不会改变运行摘要。
- 生产构建入口为 `node config/scripts/build-zstack-production.mjs 20261019.1`。要求 HEAD 等于新获取的 `origin/dev` 且已跟踪源码无改动；沿用当前未变动宿主产物，重新编译带构建号的 renderer 并打包 arm64。构建目录以构建号和提交短 SHA 区分，保留同版本反馈前的包与备份，并记录远端、精确提交、构建号和时间。

### 2026-10-15 远端 dev 生产构建流程

- 用户确认沿用 `xfu-dev/<构建号>` 版本分支；本地聚焦验证完成后直接合并并推送个人仓库 `origin/dev`，不再等待用户测试或再次请求生产构建许可。开发分支也推送保留，合并使用 `--no-ff`，便于按版本追溯。
- 生产包只使用重新获取的远端 `origin/dev` 精确提交，构建阶段只做必要编译及打包，不再测试、lint、typecheck 或页面验收。安装后启动新版本，保留旧包和用户数据；问题通过历史分支或提交追溯。
- 本次核对时，`origin` 为 `git@github.com:aderx/orca.git`，本地与远端均无 `dev`；由当前已提交的定制版本建立首次集成记录。本轮只有流程与 Git 整理，不重打已安装的同一功能版本；此前 `20261014.1` 构建来源仍按原记录保留，不追认为远端 dev 构建。

### 2026-10-15 流程精简与 Git 基线补记

- 本次 renderer 编译与 arm64 打包合计约 42 秒。此前耗时主要来自扩大的页面状态核验、临时核验脚本返工，以及安装已完成后，旧备份路径的 `lsregister -u` 错误阻断后续启动；期间另有会话中断，不能把跨夜间隔计为构建耗时。
- 截至本次整理前，定制代码仍未提交，生产构建记录的 `sourceHead` 仅是上游基线，不能据此还原定制版本。现以 `xfu-dev/20261014.1` 补记当前定制源码基线；此前各版本不补造提交，既有构建记录保留原始事实。
- 后续每个新版本先建独立分支，完成修改后本地提交；开发版只检查本次需求，用户确认后构建安装，生产版做一次启动和插件检查。不重复完整状态矩阵、哈希核验或独立代码 Review，不默认推送。详细规则以根 AGENTS.md 为准。

### 2026-10-15 启动状态与停止图标生产交付

- 用户明确要求继续更新生产应用。已构建并安装 arm64 `1.4.214` / 构建号 `20261014.1` 至 `/Applications/Orca ZStack.app`，标识保持 `local.orca.zstack`；包含高级配置仅在服务停止时可编辑、运行摘要缩高，以及启动中悬停/键盘聚焦时同步显示实心停止图标的修改。
- main、preload、CLI 复用与上一生产版哈希一致且源码未再变动的产物；renderer 通过独立配方从当前源码编译并注入构建号，未改公共 package.json、构建配置或开发版 renderer。打包器资源、daemon、终端辅助程序 PTY 与签名检查通过，安装后的 app.asar 和 19 个插件文件与构建产物一致。沿用本机 ad-hoc 签名，未公证或远程发布。
- 正式安装版 CDP 页面验收通过：设置页版本与构建号分行显示，BFF 停止状态下列表及高级配置均为 533px；启动、准备、运行及停止中的摘要为 163px，配置入口隐藏且字段禁用；BFF、FE 启动中显示“停止”时，图标为实心矩形。活跃状态仅使用临时页面数据，请求函数只放行环境读取，未执行真实服务启停或写入 .env；验收后已重载清除临时状态。
- 原有 10 个终端和 19 个 TAB 保留，原版 `/Applications/Orca.app` 的包元数据与 app.asar 哈希未变，应用登记指向唯一正式安装路径。生产版保持运行，PID 19491、CDP 9334。旧包备份为 `dist/local-builds.noindex/zstack-production-20261014/previous/Orca ZStack.app.backup`，工作区状态快照、构建配方、日志、截图及交付记录位于同级目录与 `BUILD-INFO.json`。安装脚本曾因备份后缀无法供 lsregister 扫描而在替换后中断，已确认安装结果并补齐正式应用登记与启动，没有重复替换。
- 生产验收后正常关闭本任务开发版，再清理身份核对一致的空闲残留进程；记录中的 15 个开发进程全部退出，9333、57660、6769 端口释放。开发版应用包、配置、工作区数据保留，不影响生产版与其他应用。未提交或推送。

### 2026-10-14 启动中停止图标同步

- 补齐启动中可取消的按钮路径：此前悬停或键盘聚焦只将文字换成“停止”，图标仍为加载圈。现在图标和文字同步切换为实心矩形与“停止”；移开并失去键盘焦点后恢复启动反馈。BFF、FE 共用这项插件内展示规则，按钮尺寸与实际启停逻辑保持原样。
- 仅修改插件 HTML、README 与本说明，开发版重载当前插件源码，无需宿主编译。页面检查脚本位于 `outputs/service-launcher-20261014-stop-hover/`，测试前在 iframe 内将 request 替换为拒绝全部调用的函数，只操作悬停与键盘焦点，不点击启停按钮；完成后重载恢复真实状态。未构建或替换生产版，未提交或推送。
- CDP 页面检查通过：BFF、FE 的启动、等待、准备依赖及运行未就绪状态均在悬停或 Tab 聚焦时同时显示实心停止图标与文案；移开并失焦后恢复加载图标，按钮宽度始终为 112px。已就绪的实心停止图标和停止中的忙碌反馈保留，原有 3 个终端会话未变化，页面临时状态已清除。截图与 `page-verification.json` 位于上述目录。

### 2026-10-14 启动状态配置与弹窗缩高

- BFF 仅在未启动或运行已结束时展示并允许编辑高级配置；启动请求、准备依赖、等待、运行和停止过程中隐藏入口与配置区，已有字段禁用。确认服务活跃后收起原已展开的配置；启动请求失败时仍恢复原表单与草稿。
- BFF 收起列表后的运行摘要按 TAG/IP 内容自适应高度，不再占用固定 400px；列表与高级配置继续使用随窗口限制缩小的 400px 区域。停止图标沿用现有矩形路径并使用 currentColor 填充，BFF、FE 同步生效。
- 修改限于插件 HTML、插件 README 与本说明。开发版直接加载当前插件源码，无需宿主编译；Playwright CDP 补验覆盖活跃状态、运行结束恢复、配置草稿与失败恢复、列表展开/收起及 FE 布局。单个 IP 的 BFF 运行态 iframe 为 163px，停止状态列表与高级配置均为 533px；无横向溢出或底部按钮裁切。安全补验使用页面内 request 替身，结束后重载清除，补验前后恢复后的 .env 哈希一致，原有两个终端保留。
- 首次验证脚本的 parent 消息拦截未完全生效，实际提交了一次 BFF 启动请求（运行 ID 933577ae-3f9f-407f-b133-ed0743a85c81）。已按精确运行 ID 停止，运行器 42871、服务子进程 43172 均退出，3100 无监听；原 HOST 172.22.2.103 被误写为 172.16.0.88，自动审批拒绝初次恢复命令后，用户明确批准仅恢复 HOST，已执行并读回确认。新增 BFF TAB 与 PTY 已清理，保留该次结束的运行记录供追溯。后续验证改在 iframe 内替换请求函数，不再依赖 parent 消息拦截。
- 保留 `dist/local-builds.noindex/service-toolbar-20260929/dev/Orca ZStack Dev.app` 供用户查看，PID 38727、PGID 38727，监听 9333（CDP）、57660、6769。备份、脚本、截图、页面检查及恢复记录位于 `outputs/service-launcher-20261014-state/`。未构建或替换生产版，未提交或推送。

### 2026-10-13 高级配置生产交付

- 用户测试后明确授权构建、替换生产版并关闭开发版。已将 arm64 `1.4.214` / 构建号 `20261013.1` 安装到 `/Applications/Orca ZStack.app`，标识保持 `local.orca.zstack`；打入本轮 BFF 高级配置、等高切换与手动 HOST 检测。
- 宿主 main/preload/CLI 复用与上一生产版哈希一致的编译产物；renderer 使用本次独立配方编译，将设置页构建号与包元数据统一为 `20261013.1`。生产元数据仅在构建目录中注入，没有改动公共 `package.json`、构建配置或开发版 renderer。打包器的资源、daemon、终端辅助程序 PTY 和签名检查通过；安装后的 app.asar 和 19 个插件文件与构建产物/源码一致。
- 安装版 CDP 页面检查通过：版本分行显示，24 个 BFF 候选、74 个 FE 模块；列表和高级配置均为 533px 弹窗、400px 内容区，5 组 12 个字段与滚动展示正常。点击 HOST 检测真实返回 `172.16.0.29`；草稿折叠保留、关闭丢弃，真实 `.env` 未写入，没有启动 FE/BFF。验证脚本读取本地路径插件不存在的可选 `source` 元数据时失败，已改用实际运行设置 `devPluginPaths` 补验；插件处于 running 且路径指向安装包。
- 原有 4 个空闲终端会话及 13 个 TAB 保留，原版 `/Applications/Orca.app` 的包元数据与 app.asar 哈希未变。生产版 PID `64361`、CDP `9334`，应用注册指向正式安装路径。旧包与用户数据备份位于 `dist/local-builds.noindex/zstack-production-20261013/previous/`，旧包使用 `.app.backup` 后缀。
- 开发版正常退出后，已清理记录中的空闲残留进程；本任务 14 个开发进程全部退出，`9333`、`51423`、`6769` 端口释放，保留开发版应用包和数据。构建配方、日志、截图及交付记录位于同级构建目录与 `BUILD-INFO.json`。本次为本机 ad-hoc 签名包，未公证、未远程发布、未提交或推送；沿用未包含可选 orcad 模板的本地构建，未验证 SSH 运行。

### 2026-10-13 等高切换与手动检测 HOST

- BFF 弹窗的列表、运行摘要与高级配置统一使用 400px 内容区，窗口空间不足时按现有测量结果一起缩小；切换高级配置前后高度一致，底部操作位置保持稳定。仍保留搜索、选择、滚动与草稿状态。
- HOST 输入框右侧新增悬浮检测图标，点击后只更新当前草稿。插件读取 macOS 网络服务顺序和当前网卡表，优先选择有可用 IPv4 的 `en*` Wi-Fi/以太网接口，排除 VPN、回环、链路本地和 Fake IP；服务顺序读取失败时从 `en*` 网卡选择。无可用地址时保留原输入并提示手动填写，等待期间禁用重复点击并显示加载图标。打开页面和启动服务不会自动检测，仍在启动/重启时保存修改。
- 本机只读检查确认 Wi-Fi `en0` 为 `172.16.0.29`，VPN `utun4` 为 `198.19.0.1`；新函数及开发版按钮真实调用均检测出 `172.16.0.29`。针对网卡表验证了多实体网卡顺序、没有有效 IPv4、普通私网 VPN 和 Fake IP 排除。
- 开发版 CDP 检查确认列表和高级配置弹窗均为 533px、内容区均为 400px；检测图标位于输入框内右侧、填值仅改草稿、折叠保留输入、失败保留原值、等待防重入、运行摘要切换等高及 FE 布局。失败/延迟响应与运行状态只用临时内存场景，检查后已重载清除；真实 `.env` 哈希及原有 2 个终端会话保持不变，未执行服务启停。
- 仅修改启动器插件与文档，已重载开发版 worker 和页面，无需宿主编译。开发版 PID `98723`，端口 `9333`、`51423`、`6769`，保留高级配置展开供用户查看。备份、脚本、截图与结果位于 `outputs/service-launcher-20261013-host-detect/`；未构建或替换生产版，未提交或推送。

### 2026-10-13 高级配置独立展示

- 按用户阅读反馈，BFF 弹窗展开高级配置时隐藏服务器列表、搜索、定位/检测和列表折叠按钮；收起后恢复原列表展开状态、搜索、选择与滚动位置。高级配置草稿仍在本次弹窗中保留，保存时机和字段范围不变。
- 配置区由最高 200px 调整为最高 400px，复用弹窗现有高度测量，根据窗口可用空间缩小并内部滚动，底部启动、重启和停止控件保持可见。修改仅限插件 HTML 与说明文档，无需重新编译宿主。
- 开发版 CDP 检查覆盖展开/收起、搜索与滚动恢复、草稿保留、运行中原列表收起状态、FE 布局；普通视口配置区为 400px，模拟 900×560 视口时为 347px，按钮未裁切。视口模拟结束后的脚本最终展示步骤曾发生交互超时，已重新连接 CDP、重载并确认真实视口与最终页面；没有因此修改宿主。
- 未执行真实服务启停或写入 `.env`，临时运行状态和草稿已清除，原有 2 个终端保留。开发版继续保留且展开高级配置供查看；截图和记录位于 `outputs/service-launcher-20261013-advanced-layout/`。本次未构建、替换生产版，未提交或推送。

### 2026-10-13 BFF 高级配置

- 按本次调整，用左下角“高级配置”折叠按钮替代 HOST 复选框与网卡检测。展开后位于候选列表下方、启动按钮上方，字段区最高 200px 并内部滚动；默认收起，不展示“修改将在启动或重启时保存”提示。
- 从当前 worktree 的 BFF `.env` 读取字段值与注释，筛选为本机服务、MySQL、Redis、请求设置、调试与功能五组，共 12 个常用字段。注释作为区域或字段说明，密码隐藏显示；不展示内部路径、实例标识、反馈账号和 MOCK 配置。`ZS_MN_SERVER`、`ZS_MYSQL_HOST`、`ZOPS_SERVER` 继续由上方服务器选择控制。
- 编辑内容只存于当前页面草稿，折叠后保留、关闭后丢弃。点击启动或重启时将实际修改字段与管理节点设置一并原子写入；不再检测或自动替换 HOST。保留原注释、未修改值与换行格式，文件发生外部修改时拒绝覆盖；重启在停止原服务前检查冲突，保存失败时保留弹窗与草稿。仍拒绝符号链接环境文件，不生成 `.bak`，配置值不写入选择或运行记录。
- 修改限定于启动器插件和说明文档；插件由开发版直接加载，已重载对应 worker 与页面，无需宿主编译。临时目录验证覆盖分组筛选、注释与特殊字符写回、HOST 保留、冲突及符号链接拒绝、启动/重启保存和冲突重启不停止原服务。
- Playwright CDP 页面检查通过：真实 `.env` 值与 12 个输入一致、默认折叠、区域位置及 200px 滚动、密码隐藏、草稿保留与关闭丢弃、启动/重启参数、保存失败保留表单、FE 布局。启停请求被拦截，就绪和失败状态只使用临时内存数据，结束后已重载清除；未启动真实 FE/BFF，真实 `.env` 哈希和原有 2 个终端会话保持不变。
- 保留 `dist/local-builds.noindex/service-toolbar-20260929/dev/Orca ZStack Dev.app` 供查看，PID `98723`，监听 `9333`（CDP）、`51423`、`6769`，最终展开高级配置。备份、验证脚本、结果和截图位于 `outputs/service-launcher-20261013-advanced/`。本次未构建或替换生产版，未提交或推送。

### 2026-10-13 BFF HOST 按需替换

- 本机检查确认 `en0` 为 `172.16.0.29`、`utun4` 为 `198.19.0.1`；访问当前管理节点 `172.25.119.0` 的系统路由走 `utun4`，原 UDP 路由检测也返回 `198.19.0.1`。此前每次启动无条件写入检测地址，导致已有物理网卡 HOST 被覆盖。
- BFF 弹窗左下角增加 `HOST:<检测地址>` 复选框，默认不勾选，沿用 worktree / 产品选择存储。打开弹窗和切换服务器时只预览地址；启动、重启仅在勾选时重新检测并替换 HOST，未勾选时复用环境写入函数的可选参数，保留原值且不补写缺失 HOST。检测失败不阻塞未勾选的启动；已有勾选仍可取消。FE 保存不覆盖 BFF 的选择，旧配置默认关闭。
- 修改限定于 `plugins/zstack-launcher/` 业务和说明文档，没有调整网卡优先级、公共宿主接口或真实项目 `.env`。插件由开发版动态加载，宿主源码及编译产物未变化，因此无需重编译。
- 临时目录验证覆盖默认保留、勾选替换、重启采用最新选择、检测失败不写文件和工作区隔离。开发版 Playwright CDP 检查通过：实际地址、左下角布局、保存后重开、空格键切换、展开/折叠启动参数、检测失败、迟到响应及 FE 布局。启动/重启请求被拦截，运行状态和失败场景仅用临时内存数据，随后重载清除；未启动真实 FE/BFF，真实 `.env` 哈希和原有 2 个终端会话保持不变。
- 开发入口为 `dist/local-builds.noindex/service-toolbar-20260929/dev/Orca ZStack Dev.app`，PID `98723`，本机监听 `9333`（CDP）、`51423`、`6769`，保留供用户查看且最终未勾选。修改前备份、截图、验证脚本和结果位于 `outputs/service-launcher-20261013-host/`。本次未构建或替换生产版，未提交或推送。

### 2026-10-12 同步版本生产交付

- 用户明确要求将同步后的版本更新到生产环境并关闭开发版。已将 `65a1611926228cb6ceb907565b9d347b5c6b2ff3` 加现有定制改动的 arm64 包安装到 `/Applications/Orca ZStack.app`；标识为 `local.orca.zstack`，官方版本 `1.4.214`，独立构建版本 `20261012.2`。
- 复用此次同步后已经编译并通过开发版页面检查的 CLI、main/preload/renderer 和原生辅助程序，重新生成 WSL、Web/mobile 资源并打包。已移除旧 SSH relay 构建目录，包内仅保留当前 WSL 资源。打包器的依赖、CLI、daemon、终端辅助程序 PTY 和签名检查通过；18 个安装后插件文件及 app.asar 均与构建产物一致。
- 安装后的 CDP 页面检查通过：BFF 搜索无匹配新增及 IP/URL/描述预填、24 个候选、74 个 FE 模块、FE 就绪按钮、版本分行、完整服务 TAB 打开/关闭。FE 就绪仅使用临时 iframe 内存状态，随后重载清除；未保存测试候选或启动真实 FE/BFF。更新前 4 个空闲终端会话和 13 个 TAB 记录保留，原版 `/Applications/Orca.app` 未改变。
- 生产版保持运行，PID `1714`、CDP `9334`；系统应用注册指向 `/Applications/Orca ZStack.app`。旧包与用户目录备份位于 `dist/local-builds.noindex/zstack-production-20261012-main-sync/previous/`，旧包后缀为 `.app.backup`。同目录上一级的 `BUILD-INFO.json`、`ui-production/` 记录构建、文件哈希和页面检查结果。
- 本任务开发版及记录下的 14 个进程均已关闭，`9333`、`50307`、`6769` 端口已释放；开发版应用包、配置及工作区数据保留。本次为本机 ad-hoc 签名包，未公证、未远程发布、未提交或推送；未验证 SSH 运行，也未包含可选 orcad 模板。

### 2026-10-12 同步最新 main 与插件边界确认

- 生产源码分支 `xfu-dev/zstack-main-sync-20261008` 已从 `907cb6e6038efda0fd1ee1975a3787200d0801b6` 快进到 `origin/main` 的 `65a1611926228cb6ceb907565b9d347b5c6b2ff3`，同步 650 个提交。先备份全部定制改动，再恢复到新基线；未创建提交或推送。备份和日志位于 `dist/local-builds.noindex/main-sync-20261012/`，恢复用 stash `15a18a6f027fcad7ad07730a803a9727463cdba8` 继续保留。
- 两处冲突已处理：`OpenFile.mode` 同时保留定制 `plugin-panel` 和上游 `chat-visual`；上游已删除 SSH relay，沿用其删除旧 `plugin-host-conformance.test.ts` 的结果，保留独立的 `plugin-workspace-extension.test.ts`。插件业务文件保持同步前内容。
- 经用户许可按锁文件补齐根项目和 mobile 依赖，锁文件没有额外变更。原生 PTY 编译使用本机 SDK 的 C++ 头文件路径完成准备；CLI、main/preload/renderer 和发生变动的 macOS computer helper 均已重新编译。`/usr/local/bin/orca-dev` 的可选链接因权限不足未更新，开发版从独立应用包启动。
- 开发版官方版本仍为 `1.4.214`，独立构建号为 `20261012.2`，应用入口继续使用 `dist/local-builds.noindex/service-toolbar-20260929/dev/Orca ZStack Dev.app`。本次启动记录为 PID `68143`，CDP `9333`，另监听本机 `50307`、`6769`，保留供用户查看。尚未构建或替换此次同步后的生产包，已安装生产版仍为 `20261012.1`。
- 开发版 CDP 页面检查通过：24 个 BFF 候选、搜索无匹配才新增、IP/URL 与描述预填、回车及中文组词边界、弹窗完整显示、74 个 FE 模块、版本分行、添加及关闭完整服务 TAB。原有 2 个终端会话及 TAB 保留。FE 就绪按钮仅用 iframe 内存状态验证，随后重载清除；没有保存测试候选、修改真实 `.env` 或启动真实 FE/BFF。截图及结果在上述目录的 `ui-dev/`。

最新 main 仍不能仅安装一个插件就完整复现当前功能和入口。此次新增的 `@orca/process-host` 是宿主进程实现的整理，没有增加插件授权接口；以下判断基于该 main 提交的源码，不将定制工作区中的新增接口算作上游能力。

| 范围 | 最新 main 的能力与缺口 |
| --- | --- |
| 插件业务 | 已有可信 Node worker，可承载目录读取、候选管理、HOST/`.env` 更新、服务状态及进程逻辑；搜索、预填和高亮可以留在插件 HTML 内。系统默认浏览器打开也可由本机 worker 实现。 |
| 面板与工作区 | `workspace.readContext` 仅提供名称、分支和终端 ID，不提供工作区路径或 ID。沙箱面板缺少 `commands.invoke`，仍需当前的工作区上下文和 worker 调用适配。 |
| 终端与浏览器 TAB | 上游仅有 `terminal.sendText`，缺少 `terminal.create`、`terminal.focusOwned`、`terminal.closeOwned`、`browser.open`，无法保持现有原生 TAB 的创建、复用、定位和关闭语义。 |
| UI 扩展位 | 现有面板贡献只提供侧栏面板；没有 BFF/FE 顶部工具栏、自适应弹窗、完整服务 TAB 或跳过首次空终端的扩展位。 |
| 应用定制 | 应用标识、标题、独立构建号、设置页版本展示和官方自动更新策略仍属于宿主或构建配置。 |

上游 `PLUGIN_HOST_API_V0` 仍为 13 项，这些插件 API 文件在本次基线间没有变化。当前插件声明的 `commands:invoke`、`terminal:manage`、`browser:open` 不在上游封闭的 capability 枚举中，原样安装会被清单校验拒绝。证据为该提交的 [plugin-host-api.ts](https://github.com/aderx/orca/blob/65a1611926228cb6ceb907565b9d347b5c6b2ff3/src/shared/plugins/plugin-host-api.ts)、[plugin-capabilities.ts](https://github.com/aderx/orca/blob/65a1611926228cb6ceb907565b9d347b5c6b2ff3/src/shared/plugins/plugin-capabilities.ts) 和 [plugin-manifest.ts](https://github.com/aderx/orca/blob/65a1611926228cb6ceb907565b9d347b5c6b2ff3/src/shared/plugins/plugin-manifest.ts)。继续采用“业务插件 + 必要的通用宿主扩展”；本次未为此新增宿主接口。

### 2026-10-12 生产交付

- 用户测试后明确要求继续更新生产环境。已构建并安装当前 Mac arm64 生产包至 `/Applications/Orca ZStack.app`，应用标识仍为 `local.orca.zstack`。应用版本为 `1.4.214`，独立构建版本为 `20261012.1`；安装包元数据与设置页均分别展示，不再拼接定制后缀。
- 复用已验证的当前 renderer 产物及与上一生产包一致、源码未再变动的 main/preload、CLI 和原生运行资源；重新生成 Web/mobile 资源并执行本地打包。打包器原生依赖、daemon、资源及签名校验通过，安装后的 18 个启动器文件与源码逐一一致。运行中的生产版实际读取安装包内的启动器路径。
- 生产版 CDP 检查通过：24 个真实 BFF 候选、搜索无匹配才展示新增、IP/URL 与描述预填、回车新增、取消保留搜索、中文组词边界、创建弹窗完整显示、74 个 FE 模块、FE 就绪按钮及版本分行。FE 就绪仅使用 iframe 内存状态检查，随后重载清除；未保存测试候选或启动真实 FE/BFF，此次不补充真实服务启动验收。
- 更新前的 4 个终端会话及 13 个 TAB 记录均保留，原版 `/Applications/Orca.app` 未改动。旧包位于 `dist/local-builds.noindex/zstack-production-20261012/previous/Orca ZStack.app.backup`，应用用户目录备份位于同目录 `user-data/`，仅跳过不可复制的临时 Unix socket。系统应用注册及 Spotlight 均指向唯一生产安装路径。
- 生产版保持运行，PID `97428`、CDP `9334`。本任务开发版及 14 个记录进程均已退出，端口 `9333`、`62882`、`6769` 已释放；开发版应用包和数据保留。交付配方、截图、校验记录及 `BUILD-INFO.json` 位于 `dist/local-builds.noindex/zstack-production-20261012/`。
- 沿用本地 ad-hoc 签名，不公证或远程发布；可选 orcad 模板仍未包含，SSH 真实运行未在此次验证。未提交、推送或改动共享打包配置及依赖锁文件。

### 2026-10-12 启动器入口、版本拆分与自适应高度

- FE 就绪后增加“打开”，读取本次运行的产品入口端口并调用 macOS 默认浏览器；旧运行记录按其原产品与启动模块恢复地址。点击时校验运行 ID 和就绪状态。
- BFF 启动前根据到所选管理节点的路由检测本机 IP，将其写入目标 worktree `.env` 的 `HOST`，与原管理节点配置一起原子替换；保留注释、其他变量和符号链接保护。检测失败不继续启动。
- BFF 仅在非空搜索没有匹配候选时，在空态中展示“＋ 新增”，保留无匹配时回车新增；点击或回车沿用原有识别规则，完整 IP/URL 预填地址，其他文字预填描述。新增/编辑后清空搜索、定位并高亮记录，已选服务器改 IP 后同步选择。小弹窗中的编辑表单随内容增高，底部保留 16px 间距。
- 沿用此前批准的 `WorkspacePluginToolbar.tsx` / `PluginPanel.tsx` 高度适配范围：外层仅设最大高度，iframe 按内容测量更新。插件不再声明 480/540px 初始高度；显式配置尺寸的其他插件保留配置值，侧栏和完整 TAB 保持原有布局。
- 用户本次明确批准修改 `package.json`、`GeneralUpdateSettingsSection.tsx` 与定制开发包脚本。`version` 恢复为当前官方源码基线 `1.4.214`，独立 `buildVersion` 为 `20261012.1`，设置页分行展示。开发包分别设置 `CFBundleShortVersionString` 和 `CFBundleVersion`；后续获准生产交付时，独立打包配方需将 `buildVersion` 映射到 electron-builder 的同名配置，不能重新拼入 `version`。
- 仅编译本次运行必需的 renderer。开发版 CDP 检查了真实的 24 个 BFF 候选、73 个 FE 模块；延迟响应场景中加载高度约 157px，数据返回后 BFF / FE 内容分别约 476 / 533px；新增/编辑高亮、输入预填、表单完整显示、FE 打开按钮和 32px 按钮对齐、深色高亮及版本分行均已检查。新增/编辑记录与运行就绪状态使用内存临时数据，检查后已通过重载清除。
- 后续按用户纠正移除常驻新增入口，只刷新动态加载的插件页面。CDP 已检查空搜索、已有/不可用候选匹配时无新增，无匹配时显示新增，IP/URL 与描述预填、回车新增、取消保留搜索及组合输入边界；24 个真实候选保持原值，没有保存测试数据。记录与截图位于 `outputs/service-launcher-20261012/search-add-correction/`。
- 临时目录验证覆盖 `HOST` 更新/补写/重复更新、注释及无关变量保留、无效 IP 和符号链接拒绝；本机回环路由检测通过。FE 业务验证捕获系统打开命令，覆盖当前运行、过期/未就绪拒绝与旧记录恢复，没有实际启动 FE/BFF 或打开浏览器业务页面。
- 复用并保留开发版 `dist/local-builds.noindex/service-toolbar-20260929/dev/Orca ZStack Dev.app`，PID `44850`，本机端口 `9333`（CDP）、`62882`、`6769`。截图、临时验证脚本、结果和本次修改前备份位于 `outputs/service-launcher-20261012/`。本次未构建生产包、未替换 `/Applications/Orca ZStack.app`，未提交或推送。

### 2026-10-09 main 同步与生产交付

- 按用户本次明确指令同步 `origin/main` 并更新生产版。升级分支为 `xfu-dev/zstack-main-sync-20261008`，基线从 `28942eed5af3` 快进到 `907cb6e6038e`，包含 1063 个新提交。定制改动已恢复，仍未提交或推送；源码备份和原始 stash 均保留。
- 两处冲突分别保留了上游安装期间的更新检查保护与定制自动更新开关，以及上游 TAB 条布局与定制插件入口、插件页保留逻辑。没有扩大插件权限或另改公共接口。
- 经用户批准，用 pnpm 12.8.1 按冻结锁文件同步根项目和 mobile 依赖；锁文件未改写。完成 CLI、relay、macOS 辅助程序、主进程、preload、renderer、web/mobile 资源和 arm64 本地生产包构建。
- 安装版本为 `1.4.214-zstack.20261008.1`，目标 `/Applications/Orca ZStack.app`，标识 `local.orca.zstack`；辅助程序标识仍为 `local.orca.zstack.computer-use`。旧包与配置位于 `dist/local-builds.noindex/main-sync-20261008/previous/`，旧包后缀为 `.app.backup`，避免新增同名应用入口。
- 开发版 CDP 验证了 IP 检测结果重开及重载后复用、最新勾选重启、分组筛选、空文案和无间隙吸顶。安装后的生产版验证了 75 个 FE 模块、未启动时展开且无折叠入口、右侧对齐、TAG/IP 摘要、80 个 TAG 的滚动与自适应高度、启动中悬停停止及 Orca 原生提示条；服务状态与启停操作使用临时模拟响应，随后已移除，没有启动真实 FE/BFF。
- 打包及安装后签名校验通过，17 个定制插件文件与源码一致。原有 11 个终端 TAB 记录和两个项目保留，原版 `/Applications/Orca.app` 未改动，应用注册及 Spotlight 均指向唯一的安装路径。生产版 PID `32621`、CDP `9334`。
- 生产验收后已关闭本任务开发版及其空闲守护进程，14 个记录进程全部退出，端口 `9333`、`64627`、`6769` 已释放；开发版应用包和数据保留。构建配方、文件哈希、截图和交付记录见同目录 `BUILD-INFO.json`。
- 本次为本机 ad-hoc 签名包，不进行公证或远程发布；沿用上游本地构建默认，不包含可选 orcad 部署模板，SSH 保留既有宿主 Node 路径，本次未做远程运行验收。

### 2026-10-08 启动结果、列表折叠与服务器检测

- 弹窗不再插入异常文字或日志。操作失败、列表读取失败及已结束的失败任务通过 Orca 的 Sonner 提示条显示；启动请求发出后立即关闭弹窗，延迟返回的失败仍能在宿主提示。
- 状态点表示本次启动结果。BFF 的 Nest 启动成功日志、FE 的所选端口及进程组确认仍是首次就绪依据；成功后记录 `startedAt`，业务 ERROR、重新编译及端口短时变化不再将活进程标为失败。进程退出、启动失败和无法确认的状态仍分别处理。
- 未启动或已结束时列表保持展开，不显示折叠按钮。服务启动中或启动后再次打开弹窗时默认折叠列表，仅查询启动摘要；折叠控件仅显示图标。展开时才读取候选服务器或 FE 模块、变更模块并渲染列表，折叠期间结束后自动加载并展开。顶部操作和搜索框贴齐右侧内边距。已启动后显示弱化的重启按钮，准备、启动和停止期间隐藏；重启先等待原进程结束，再沿用原终端启动。FE 默认沿用当前运行的产品。
- BFF 对未检测的地址自动请求一次 `http://IP:5000/`，完成结果保存在插件独立存储中；打开、筛选、状态读取、启动服务及重载插件均复用结果，新增 IP 补测，手动点击重新检测才重测已有地址。2 秒超时、最多 8 个并发，HTTP 2xx/3xx 视为可访问；检测独立于启动状态。没有可用 IP 时显示居中空文案，不可用地址置于列表末尾分组；搜索保留检测分组，没有不可用结果时隐藏该组，无右侧导航。BFF 列表顶部内边距归零，吸顶标题不再留缝。
- 用户明确批准此次宿主修改仅在 `PluginPanel.tsx` 和 `WorkspacePluginToolbar.tsx`：校验发送 iframe 后接入原生提示条，并将内容测量高度传给弹窗，外层只限制最大高度。其他插件不报告高度时保留原有尺寸配置；未改系统通知接口、终端内核或远程协议。
- renderer 必要编译及 7 项定向检查通过；另用缺失模块目录的临时仓库确认折叠时不读取目录、展开后才查询。真实开发版 CDP 已检查自动/手动定位、IP 重测、末尾分组、启动即关窗及延迟原生提示条；运行/重启按钮和懒加载页面使用临时响应验证，随后恢复。模拟子进程确认持续输出 ERROR 时仍保持启动成功，停止后已验证子进程退出；没有启动真实 ZStack FE/BFF。
- 页面复查修正了 FE 重启按钮出现时的底部换行，以及内容测量重置滚动导致首次定位失效的问题；折叠时约 158px、BFF 单条筛选时约 199px。旧运行记录缺少产品字段时返回合法空值，并从旧 FE 参数恢复产品，避免重启切换到默认产品。
- 后续按截图调整顶部右对齐和纯图标折叠。开发版 CDP 确认 BFF / FE 搜索框与内容右边缘间距为 0、未启动时列表展开且无折叠入口；模拟准备中及运行中的 4 种页面场景通过懒加载、32px 图标和停止/结束后自动展开检查。临时响应已清除，开发版恢复真实未启动的 FE 列表，未启动真实业务服务。
- 折叠摘要只显示 TAG/IP，状态由按钮表达：FE 从本次命令的 `--apps` 展示全部模块（含入口），BFF 从启动记录展示 IP；旧记录兼容读取原 BFF 标题中的地址。摘要不使用当前勾选配置、不加载候选；重启则携带列表最新勾选，在停止前保存，展开或折叠均如此。TAG 换行并在内容较多时滚动。启动中的按钮悬停或获得键盘焦点时显示“停止”，禁用或停止期间保持原提示。
- 此摘要修订已通过临时仓库的模块参数、旧/新 IP 记录和折叠免读目录检查，以及开发版 CDP 的 TAG 换行、80 项滚动、改选不影响运行摘要、悬停/移开文案和禁用按钮检查。取消启动使用临时响应验证，未启停真实 FE/BFF；临时响应已移除。结果和截图为 `summary-tags-verification.json`、`*-summary-tags.png`、`*-starting-hover-stop.png`。
- 后续缓存、分组和重启选择检查通过：2 项定向测试覆盖缓存恢复、并发上限、新 IP 补测及手动重测；真实开发版 24 个 IP 在重开弹窗、重载插件后检测时间和结果不变。模拟页面确认展开/折叠重启均发送最新勾选，临时仓库确认准备参数及启动参数同步更新；终端接口使用模拟返回，未启停真实服务。空文案居中且上下各 24px，搜索隐藏空的不可用分组，吸顶标题顶部间隙为 0。弹窗内只保留 TAG/IP，准备状态也由按钮表达；完整服务 TAB 保留准备说明。
- 验收记录及截图在 `outputs/service-launcher-20261008/`。复用独立开发包，保留开发版 PID `19298`、CDP `9333`，另监听本机 `53822`、`6769`，供用户测试。本次未构建或替换生产版，未提交或推送。

### 2026-09-29 生产交付

- 用户测试后明确要求继续更新生产版。已构建并安装 arm64 `1.4.214-zstack.20260929.1` 至 `/Applications/Orca ZStack.app`，应用标识保持 `local.orca.zstack`；原版 Orca 和既有用户数据保留。
- 重新构建 relay、macOS 原生辅助程序、主进程、preload、renderer 及内置 Web/mobile 资源；CLI 复用本轮同步 main 后已编译的产物。`mobile` 的独立依赖按其冻结锁文件补齐，两份锁文件均未改变。独立配方显式设置 `ORCA_COMPUTER_MACOS_BUNDLE_ID=local.orca.zstack.computer-use`，保留旧 ZStack 辅助程序的标识；本地签名和深度校验通过。
- 安装后的 16 个启动器插件文件与构建记录逐一匹配，主进程、preload 和页面入口与本轮编译产物一致。生产版实际 CDP 检查通过：中文、无边框图标、搜索前方操作按钮、打开后不聚焦搜索、自动居中定位、FE 字母导航等高及吸顶高亮；未启动真实 FE/BFF。更新前后 7 个终端会话 ID 全部一致。
- 旧包及配置备份位于 `dist/local-builds.noindex/zstack-production-20260929/previous/`；构建配方、文件哈希、生产截图及 `BUILD-INFO.json` 位于同级构建目录。系统应用标识解析到 `/Applications/Orca ZStack.app`。
- 生产版保持运行（本次 PID `63098`，CDP `9334`）。本任务开发版 PID `71371` 及其已记录的 8 个相关进程已退出，`9333`、`63383`、`6769` 端口已释放；开发包和数据保留。未提交、推送或远程发布。

### 2026-09-29 无边框入口与弹窗列表导航

- 按用户纠正，BFF / FE 对齐原来“未配置命令”按钮的样式：无边框、28px 高、14px 图标、左右 6px 内边距，保留原悬停/焦点颜色和 2px 间距；不再采用已配置命令的分段边框样式。
- 弹窗的 BFF 定位、FE 全选及定位移到顶部搜索框前方；FE 产品选择与启动/停止继续在底部。两种弹窗使用相同的标题/操作/搜索顺序。
- 弹窗打开及加载完成后不主动聚焦搜索框或启动按钮，保留用户点击后的正常焦点行为。
- BFF / FE 定位均在各自列表内居中滚动，边缘目标遵守原生滚动范围。弹窗首轮数据加载完成后自动定位已有选择，FE 产品切换后重新定位；没有已选模块时不因定位操作额外勾选模块。服务器列表重绘保留滚动位置，避免加载结束后的重绘撤销定位。
- FE 按首字母建立分组容器，弹窗中的字母标题在所属分组内吸顶。字母导航铺满列表高度，随列表顶部所在分组更新高亮；点击导航仍跳到对应分组。只显示当前列表含有的字母，窄矮窗口内仍允许导航滚动。
- 必要 renderer 编译完成，开发版 CDP 页面审查通过：无边框图标尺寸、顶部操作顺序、BFF / FE 自动和手动居中、打开后的容器焦点、FE 字母导航等高及滚动高亮、分组吸顶、搜索清空均已实际核对。修正列表顶部 3px 内边距，避免吸顶标题上方露出滚动内容。临时 FE 选择已恢复，没有启动业务服务。截图与几何记录位于 `outputs/service-toolbar-20260929/picker-navigation/`；继续保留开发版供用户查看。

### 2026-09-29 标题栏按钮样式与命令入口

- BFF / FE 仅显示 Zap / Lightbulb 图标，与已配置命令的按钮统一为 28px 高度、12px 图标、相同圆角边框和悬停/焦点颜色；服务入口使用 28px 方形按钮。去掉服务按钮组额外的水平 padding，命令与 BFF、BFF 与 FE 的间距均为 2px。
- `TabBarQuickCommandsButton` 复用现有有效命令过滤及最近命令选择：当前项目没有可用命令时隐藏，不再展示“命令”占位添加入口；有项目命令或适用的全局命令时显示。配置仍可从设置页进入，远程命令的加载、主机归属和执行路径不变。
- 本次移除占位入口的 3 个翻译引用，原语言条目保留，未删除语言包：`auto.components.tab.bar.TabBarQuickCommandsButton.a2c7a33831`、`auto.components.tab.bar.TabBarQuickCommandsButton.8f1e971966`、`auto.components.tab.bar.TabBarQuickCommandsButton.1d411fb6a5`。只读搜索表明它们的直接代码引用都位于被移除的占位分支；后续若清理条目，需单独批准。
- 必要 renderer 编译通过；开发版 CDP 验证了按钮高度、图标尺寸、边框/圆角/悬停颜色和 2px 间距，并确认无命令、其他项目命令、不完整命令时隐藏，当前项目或适用全局命令存在时显示。显示条件使用临时 renderer 内存状态验证，随后恢复原配置，没有执行命令或写入设置。BFF / FE 弹窗打开与关闭正常，截图及记录位于 `outputs/service-toolbar-20260929/command-button-style/`。继续保留开发版，不构建或替换生产版。

### 2026-09-29 空 TAB 与弹窗操作区修订

- 已有工作区没有 TAB 时，在 `TabGroupPanel` 内展示简版 logo、产品名和“新建终端”。复用 `newTerminalTab`，与顶部添加菜单走同一条终端创建路径，不执行最近的快捷命令；保留该路径原有的文件夹与远程主机路由。
- BFF / FE 弹窗统一为标题在左、184px 搜索框在右，辅助操作在底部左侧，启动/停止在右侧。FE 产品选择、全选、已选定位在左下；BFF 新增定位，优先滚动到已选服务器，没有有效选择时滚动到当前服务器，同时清空筛选并突出显示目标。
- 弹窗去掉刷新按钮，每次打开或切换 FE 产品都读取最新候选列表；保存服务器后即时更新。运行状态维持已有可见时轮询，完整服务 TAB 保留手动刷新。目录变更在下次打开时读取，不为目录变化增加后台持续 Git 扫描。
- 用户已选定 BFF 使用 Zap、FE 使用 Lightbulb。两者均为宿主已支持的 Lucide 图标，不增加图标库或扩展公共映射；开发版重载插件后已通过 CDP 确认，按钮仍为 32 × 24、图标为 16 × 16，状态点逻辑不变。
- renderer 必要编译通过，开发版 CDP 已检查空态、新建普通 shell 终端及关闭、BFF 搜索后定位、FE 搜索/字母/已选定位与底部产品选择的位置。两个搜索框均为 184px、右侧留白 16px，无横向溢出；完整服务 TAB 仍能手动添加。关闭最后一个 TAB 沿用宿主离开工作区行为，再次进入时显示简版空态。测试创建的终端已关闭并确认 PTY 不再存在，临时 FE 选择已恢复。
- 页面截图、几何记录及图标候选位于 `outputs/service-toolbar-20260929/empty-picker/`。继续保留 PID 71371 的开发版、CDP 9333 供用户查看，没有启动真实 FE/BFF 或构建、替换生产应用。

### 2026-09-29 服务弹窗布局修订

- 按用户反馈采用常驻入口方案：支持的工作区右上角保留 BFF / FE 图标，移除服务页顶部模式开关和弹窗底部“服务”跳转；完整页通过添加 TAB 菜单中的“服务”手动打开，首次进入工作区不自动打开。历史 `toolbarMode` 值保留在用户数据中，但不再参与显示决策。
- BFF 改为叠层图标，FE 改为地球图标；直接复用右侧栏按钮样式，按钮均为 32 × 24、图标均为 16 × 16，状态点保留。弹窗尺寸由插件的可选 `width` / `height` 字段描述，并限制在窗口可用范围内。
- 弹窗使用专门的布局：标题和 FE 产品选择位于顶部，搜索与紧凑列表位于中间，启动/停止位于底部；刷新为标题旁图标。保留服务器维护、模块依赖选择、字母和已选定位，弹窗中的依赖数量用 `+N` 表示，完整 TAB 保留原文案。四周留出 16px，列表滚动和输入焦点环不再被内部卡片裁切。
- `PluginPanel` 在沙箱 HTML 首次解析前写入经转义的展示属性，替代等待异步列表返回后才切换布局；保持既有 CSP 和沙箱边界。BFF 弹窗读取服务器列表时跳过 FE 模块目录和分支变更扫描。宿主修改仍限于已批准的 `components/plugin-workspace/` 和 `PluginPanel`。
- renderer 编译完成后刷新开发版，并通过插件启用接口重载启动器 worker；`plugins.refresh` 本身不会重启已运行的 worker，不可用它替代代码重载。实际 CDP 检查确认 BFF 384 × 480、FE 448 × 540，首屏没有完整页标题或另一服务区域；按钮尺寸一致，左右留白正常，无横向溢出。搜索、清空、字母/已选定位、“＋ → 服务”、无开关的完整页和关闭最后一个 TAB 后重新展开均通过。
- 截图和几何检查记录位于 `outputs/service-toolbar-20260929/refined/`。开发版继续保留（PID 71371，CDP 9333），本次没有启动真实 FE/BFF，也没有构建或替换生产版。

### 2026-09-29 main 同步与右上角服务入口

- 已同步 `origin/main` 的 `28942eed5af3410e924f171d230db9452a2c9dc6`，版本基线为 `1.4.214`，定制版本号为 `1.4.214-zstack.20260929.1`。既有定制改动保留在 `codex/zstack-service-toolbar-20260929`；原分支、升级前 stash 和 `dist/local-builds.noindex/service-toolbar-20260929/` 中的补丁备份保留，没有提交或推送。依赖按上游锁文件同步，没有升级锁文件。
- 安装版的 `uiLanguage=system` 实际收到 `en-US`，与系统首选中文不一致。已将安装版语言设置为 `zh`，并通过真实页面确认搜索、任务、项目和设置恢复中文；没有删除翻译或改写全局国际化实现。
- 复用旧按钮在 `TabGroupPanel` 的位置，空白页由 `TitlebarMainStrip` 承载同一通用组件。插件通过 `workspace-panel.<panelId>.toolbar` 返回入口和状态；ZStack 插件提供 BFF、FE 两个图标。插件关闭或上下文不受支持时不显示。下拉与完整页共享沙箱及服务操作逻辑；当前布局及手动打开规则以上方弹窗修订为准，自动进入工作区不打开服务 TAB。
- 用户批准的宿主范围为两个入口挂载处、`components/plugin-workspace/` 和 `PluginPanel` 的展示参数与关闭回调。上下文固定到当前工作区，状态轮询不重新绑定尚未完成的面板请求；完整 TAB 不发送未定义的展示参数。空白页展开下拉会恢复活动工作区，并在标题栏与标签栏布局切换时保留弹窗状态，确保后续终端或浏览器操作仍绑定正确工作区。没有修改终端内核或远程执行协议。
- 图标右下角使用项目现有状态色：启动中黄色闪烁，就绪绿色，报错红色；无法确认状态时灰色。BFF 读取 Nest 就绪日志，FE 核对所选模块端口及本次进程组；仅创建进程不视为就绪。服务日志中的错误会写入运行记录供入口和面板展示。
- 本次核实截图中的 `16322` 是端口，残留监听为 PID `16427` 的 Module Federation DTS Broker，父进程已退出且无已建立连接；核对进程身份后已停止，端口已释放。插件新增运行期间的 Broker 父进程归属记录，停止时核对 PID 出生时间、命令、其他运行记录和连接；仅清理能证明归属且空闲的 Broker，不按端口直接终止未知进程。
- 必要 CLI、Electron 和 renderer 编译完成。5 项进程归属与状态判断定向测试通过；实际开发版 CDP 已检查 BFF 24 项列表搜索/清空、FE 74 项列表搜索/字母/已选定位、新旧模式切换及弹窗关闭。关闭最后一个服务 TAB 后实际进入 `activeWorktreeId=null`，重新展开仍保持弹窗并恢复原工作区；另核对了不同工作区的数据绑定、不支持项目和远程上下文的入口隐藏。黄闪、绿、红、灰状态通过临时运行记录驱动真实插件和页面验证，记录随后恢复；这不等于真实 FE/BFF 生命周期验收，本次没有启动业务服务。
- 独立开发包位于 `dist/local-builds.noindex/service-toolbar-20260929/dev/Orca ZStack Dev.app`，使用 `Orca ZStack Dev` 数据目录，开发进程及 CDP 9333 保留供用户查看。没有构建生产包或替换 `/Applications/Orca ZStack.app`；等待用户测试后的明确生产交付指令。

### 2026-09-23 启动按钮并发与状态修订

- 修改仅限启动器插件及本文档。用户本次选择“仅修改插件，暂不处理默认 Pin”，没有改宿主 TAB 入口。
- BFF/FE 请求状态分开；一个终端创建或停止尚未返回时，另一服务请求和状态读取不再排队等待。运行记录仍按顺序登记，阻止同类重复启动；后续按用户纠正移除跨服务的依赖准备排队，BFF/FE 从准备到运行均互不等待。
- 启动请求与准备期间显示旋转图标和“启动中”；请求返回后的准备阶段支持取消。服务命令创建进程后显示停止按钮，失败后解除 loading。现有 running 状态不等同于业务端口就绪。
- 16322 残留排查：截图为端口号，当前已无监听。目标工作树的 `@module-federation/dts-plugin@2.8.0` 源码定义该 Broker 默认端口，以 `detached: true` / `unref()` 启动；启动器仅向记录的服务进程组发送信号，存在脱离进程组后漏清理的边界。缺少截图当时的监听 PID 和连接记录，未断言具体残留归属，未按端口清理或修改项目依赖。
- 17 项插件定向检查与页面逻辑检查通过，覆盖终端创建延迟期间接受另一服务请求、状态读取和同类防重入。开发版实际可见 iframe 已经 CDP 检查两个按钮连续点击、双 loading 动画、准备中取消入口、停止隔离与失败复位；后端响应被临时模拟且检查后恢复，没有启动真实 FE/BFF。截图位于 `outputs/service-launcher-20260923/concurrent-start.png`。
- 插件由开发版直接加载当前源码，无需宿主编译；保留独立开发版供用户测试，没有生产构建、替换、提交或推送。

本文件记录此 Orca fork 的开发约定。适用于个人定制插件、为插件补充宿主能力、同步上游源码及定制版本打包。它补充根目录 `AGENTS.md`，不替代原有设计系统、跨平台、SSH、进程和测试要求，也不扩大用户授权。

## 已确定的方向

- 优先将项目特有的业务做成独立 Orca 插件；宿主只保留可复用、边界明确的扩展接口。
- 优先复用现有 worktree、TAB、PTY、终端显示和进程生命周期实现；不要建立第二套终端或 worktree 管理系统。
- 当前采用“同步上游源码 → 合并定制改动 → 验证 → 重新构建安装”的升级方式。
- 不把“插件化”描述为官方原版零改动兼容。插件依赖自定义接口时，安装官方应用包可能使插件不可用。
- 后续可建设自己的线上发布和更新渠道；当前不默认引入线上发版或线上自动更新。版本分支与个人仓库 dev 的推送、本地验证后从远端 dev 构建并替换本地应用已获持续授权，按下文及根 AGENTS.md 执行。

## 开发前先定位边界

1. 核对当前分支、工作区改动、remote 和用户指定的 checkout，保留无关改动。
2. 从用户要求的实际入口追踪到最终效果：worktree 选择 → 页面/TAB → 插件后台 → 宿主接口 → 执行主机上的文件或进程 → 状态与日志回传。
3. 先查现有实现是否能复用。CLI 能做某事，不代表插件面板可以调用；面板、worker、主进程和终端分别确认。
4. 在编辑前说明交互方案、业务模块、必要的宿主接入文件、影响范围和验证方式。
5. 新增或扩大公共接口、修改跨模块配置前，列出具体文件/符号、必要性、消费者、风险及业务内替代方案，检查是否已有对应授权；没有授权才请求确认。不要重复索取已批准范围的许可，也不要将一次接入批准扩展为任意公共层改动许可。

## 插件与宿主如何分工

| 插件负责 | 宿主负责 |
| --- | --- |
| 项目识别、服务器列表、模块发现、启动参数、选择记忆、业务校验 | worktree 上下文、插件页面挂载、受控消息调用、已有终端能力的桥接 |
| 插件自己的配置、运行记录和日志策略 | 权限校验、执行主机路由、终端身份及生命周期 |

- 插件应有独立目录、manifest、说明文档和针对性验证；具体路径按仓库现有插件约定确定，不先假定目录已存在。
- 宿主的通用接口不得写入 ZStack 的服务器地址、模块名称、目录规则或 `zs-start` 业务分支。
- 插件只能调用经授权且属于其作用域的接口；保留参数/结果校验、请求大小和超时限制，不通过放宽整个面板 CSP 或暴露任意 Electron/IPC 调用来接通功能。
- 面板调用 worker 时由宿主绑定插件身份，不能信任页面传来的其他插件 ID。worktree 和终端目标也必须显式绑定，防止用户切换页面后延迟请求落到别的工作区。
- 接口应可检测、可版本化；缺少必要能力时明确提示，不静默退回另一台主机、另一个 worktree 或任意现有终端。
- 更改远程双方交换的字段前，读取 `docs/reference/remote-wire-compatibility.md`；仅支持本机的业务必须显式限制，不把远程路径当成本地路径执行。

## 当前 ZStack 启动器的目标交互

采用方案二，当前约定如下；实际交付以各次验证记录为准：

- 打开受支持的 ZStack worktree 时展示右上角 BFF / FE 入口，不自动打开“服务”TAB；完整配置页通过添加 TAB 菜单手动打开并去重。普通项目和不支持的工作区保持原有行为。
- 配置页维护 BFF 服务器及 FE 模块列表。模块目录沿用项目启动脚本的数据来源，不硬编码一份易过期的模块清单；模块移除后明确处理旧选择。
- 服务器候选列表按项目维护，FE 模块、所选服务器和启动选项按 worktree 及产品分别保存。切换 worktree 时不串配置。
- 启动后使用 Orca 原生终端 TAB 展示输出；弹窗底部提供启动/停止，手动打开的配置 TAB 保留；首次创建终端 TAB，后续复用同类服务的终端。
- 服务停止或失败后，配置页恢复可启动状态，保留该次运行的日志。不能因 PTY 或 TAB 仍存在就断言服务仍在运行，也不能因端口尚未监听就断言启动失败。
- 只停止本功能创建并且身份仍可确认的服务进程。复用已有进程树终止能力；不得按进程名批量杀 Node、pnpm 或其他 worktree 的服务。
- 区分“命令已提交”“进程运行中”和“服务已就绪”；就绪状态需要真实证据。
- 日志覆盖启动和持续运行时实际输出的 stdout/stderr，保留错误堆栈及终端显示效果；完整输出持续落盘，界面使用有限缓存并可查看/导出历史。不得把有限滚动缓存称为完整日志。
- 切换 worktree 不隐式终止服务；退出应用后的进程策略沿用宿主既有语义，若需改变先明确影响。
- 保留 worktree 自己的环境和依赖边界。维护候选列表不应立即改写运行环境；启动时只更新目标 worktree 必需的配置。安装依赖、修复项目环境、启动真实 FE/BFF 都不作为打开页面的隐式副作用。

## 验证与交付

- 以根 AGENTS.md 的“本项目的开发、页面审查与本地交付”为准：从最新 origin/dev 创建版本分支 → 开发、提交与必要编译 → CDP 聚焦检查本次需求 → 推送版本分支 → 合并并推送 dev → 获取并检出远端 dev 的提交 → 编译打包 → 备份替换并启动 → 关闭本任务开发版。无需再次等待用户测试或生产构建许可。
- 同一版本内的反馈沿用分支。版本分支和 dev 的推送均已获持续授权；使用 `--no-ff` 保留合并节点，不 squash 或改写历史。生产构建记录 `origin`、`origin/dev` 的 SHA 和构建号，所用构建配方随源码提交，禁止从未推送或未提交源码构建生产版。
- 检查集中在开发阶段，只覆盖本次需求；构建阶段不再运行测试、lint、typecheck、页面验收、完整状态矩阵或重复文件哈希。复用已有构建入口及源码未变化的有效产物，不为交付编写大型一次性核验脚本。只更新 `/Applications/Orca ZStack.app`，保留原版 Orca、用户数据和旧包回退点，安装后启动即可。
- 页面模拟不触发真实服务或配置写入；启动真实 FE/BFF、安装依赖仍须符合当前任务授权。模拟结果只说明页面行为，不代表真实服务验收。
- 只改文档或整理 Git 时查看差异与路径，不启动应用或运行构建、类型检查、业务测试。交付说明保持简短，说明实际结果及未完成项即可。

## 源码升级流程

1. 先审计工作区和 remotes。`origin` 通常是个人 fork，`upstream` 通常是官方仓库，但必须看实际 URL；不要根据名称自动改写已有 remote。
2. 用户要求升级时，获取明确的上游分支或版本，记录升级前 HEAD 和目标 commit/tag。不得把旧的分支名或一次会话中的 commit 固定成永久基线。
3. 在升级分支或隔离 checkout 中合并上游；保留可回退点，不用 `reset --hard` 覆盖定制开发或用户未提交内容，不未经授权重写已发布历史。
4. 分别审查插件接口、TAB/终端生命周期、权限与主机路由、日志和打包更新配置的冲突。上游已有同等能力时优先采用官方实现，并在验证后移除重复适配。
5. 按当前交付流程自动启动开发版并聚焦检查本次改动；通过后将版本分支合并并推送 dev，从重新获取的远端 dev 提交构建并替换本 fork 的本地应用，不再等待额外测试或构建许可。开发版与现用应用的数据和进程应隔离。
6. 更新本文件的定制改动清单，记录必要的宿主适配及其回归入口。不要把“合并成功”等同于“运行验收通过”。

### 2026-09-20 main 同步

- 用户明确要求将 main 同步到当前分支、更新版本并构建生产应用；本次生产交付已获授权，不延续到后续修改。
- `codex/zstack-service-launcher` 从 `b0ec11f5b` 快进到 `origin/main` 的 `bd5177801`，引入 52 个提交。同步前的全部定制改动已备份并通过 stash 恢复；`plugin-service.ts` 和 `EditorPanel.tsx` 自动合并，无冲突。未提交或推送定制改动。
- `package.json` 版本更新为 `1.4.197-zstack.20260920.3`，本次打包配置直接读取此版本，避免源码与应用包版本不一致。
- 同步记录、源码备份、stash 标识和生产构建配方位于 `dist/local-builds.noindex/main-sync-20260920/`。main 的 xterm 补丁更新通过冻结锁文件同步，依赖版本及上游补丁保持原样。
- 已完成 CLI、桌面、relay、web/mobile 资源构建及 arm64 生产打包；签名深度校验、打包守护进程入口与插件资源校验通过。已替换 `/Applications/Orca ZStack.app`，旧版 `.2` 位于上述目录的 `production/previous/`，保留原版 Orca 和既有用户会话。
- 开发版与安装版均通过实际服务页检查：Cloud 显示 74 个模块，未展示依赖未准备提示；开发版新增菜单和终端 TAB 已验证，测试终端已关闭。开发版继续保留供用户测试；没有启动真实 FE/BFF 服务，本次页面检查不代表真实服务启动验收。

## 应用更新渠道

- “检查更新”获取的是发布的应用包，不会执行 Git 合并，也不会保留安装包中没有的定制代码。
- 配置定制发布前，同时检查 `config/electron-builder.config.cjs` 的 `publish` 和 `src/main/updater/` 的运行时 feed；修改 fork 的 Git remote 并不会改变应用更新来源。
- 未配置并验证自己的发布渠道前，不通过官方更新包升级定制应用。也不直接删除官方更新逻辑或重定向 feed，除非任务已明确授权。
- 定制应用需并行安装时，明确应用标识、显示名称、用户数据目录、协议/CLI 注册和更新源。不能只换图标却共享所有运行状态。

## 当前实现状态与后续维护

2026-09-19：已实现方案二，源码位于分支 `codex/zstack-service-launcher`，尚未提交或推送。

### 插件业务

- `plugins/zstack-launcher/orca-plugin.json`：独立开发插件，worker 必须 **default export** 激活函数。
- `main.mjs`：项目共享服务器列表、按 worktree / 产品记忆选择、读取当前 .env 默认服务器、启动/依赖安装/停止/日志读取。
- `catalog.mjs` / `products.mjs`：用 Bun 读取当前 worktree 的 PRODUCT_CONFIGS / MF_CONFIG，不执行项目启动入口；展示项目声明的全部产品。
- `data.mjs`：Git common directory 区分项目；BFF 启动只更新本 worktree 的 `.env`，原子写入且不生成 `.bak`，拒绝共享链接环境。
- `runner.mjs` / `run-state.mjs`：在 Orca 原生终端运行 pnpm，stdout/stderr 实时显示并完整落盘；只停止本次子进程组，心跳过期时保守判断。运行中不等于端口已就绪。
- `panel.html`：iframe 内的服务页。BFF 平铺 IP/描述、“当前”标签与浏览器入口；FE 按名称排序，提供右侧字母定位、全选/全不选及产品入口名称。启动/停止在各区域右上角，代理开关和底部操作已移除。
- BFF“添加服务器”与启动按钮并排放在标题右侧。产品下拉保留产品及已发现的核心模块名称，未发现入口时仅显示产品名称；模块读取失败在列表中央展示简明原因，不显示原始代码堆栈，也不同时显示空列表提示或无效字母索引。
- FE 模块行不展示“依赖未准备”状态，保留名称后的依赖数量及选择依赖操作；依赖仍在启动时自动检测、安装和构建。
- FE“选择变更模块”根据当前工作树分支的版本基线共同祖先，合并分支提交、暂存、未暂存和未跟踪文件；按当前产品模块实际目录匹配，加载或刷新页面时默认自动补充勾选变更模块，保留核心入口和其他手动选择，不启动服务。有变更时按钮显示“取消变更模块”，可取消并再次选择；没有变更的业务模块时隐藏按钮。取消意图按 worktree 和产品持久化，刷新不重新勾选；手动取消变更模块或全不选也会关闭自动勾选。版本基线来自 `xfu-dev/版本/任务` 或 `codex/版本/任务`，依次查找本地 upstream、origin 和本地版本引用；其他命名只接受显式跟踪的不同目标分支，无法确定基线时保留原选择。检测只读本地 Git，不自动 fetch；不把公共包或其他产品的改动推断为当前产品全部模块，也不自动增加依赖模块。
- 变更模块检测的临时 Git 仓库定向检查覆盖提交、暂存、未暂存、未跟踪、跨模块重命名、上游前进及同名功能分支跟踪；开发版和生产版实际页面验证了按钮排列及“仅 BFF 改动时保留原选择”的行为。生产版更新为 `1.4.197-zstack.20260920.2`，构建及旧包备份位于 `dist/local-builds.noindex/zstack-production-20260920-changed/`。
- 后续自动选择修订仅更新开发版：用隔离 Git 示例在实际服务页验证默认勾选、取消时保留其他手选模块、刷新记住取消和再次选择；无前端变更的真实 worktree 中隐藏按钮。临时项目验证后移除，生产版保持上述版本，等待用户测试后的明确生产交付指令。
- 配置使用 Orca 的插件私有 storage；日志在 `~/Library/Application Support/Orca ZStack Launcher/<插件路径哈希>/<工作树哈希>/`。不读取需求记录 APP 的凭据或配置。
- 缺少源码与依赖分别显示；用户点击启动后自动准备依赖，页面打开不自动安装。切换 worktree 不停止已有服务。

### 必要宿主适配

- `src/shared/plugins/plugin-capabilities.ts` / `plugin-host-api.ts`：新增 `commands:invoke`、`terminal:manage` 独立授权，以及 `commands.invoke`、`terminal.create`、`terminal.focusOwned`、`terminal.closeOwned` 四个通用接口。已有能力不扩权，旧插件无需新字段。
- `src/main/plugins/plugin-host-method-bindings.ts`、`plugin-host-service-bindings.ts`、`plugin-service.ts`、`plugin-owned-terminals.ts`：复用原本 session / 授权 / 审计路径；命令只能调用所属插件，终端显式指定 worktree，切换时拒绝延迟启动，聚焦仅允许该插件创建的终端。
- `src/renderer/src/components/plugin-workspace/`：声明命令 `workspace-panel.<panelId>.probe` 的插件可按本机 worktree 自动打开去重 TAB；probe 只返回 `{ supported: boolean }`，不得启动服务。
- `use-terminal-controller.ts`：挂载通用自动打开 hook。
- `store/slices/editor/types/open-file.ts` / `components/editor/EditorPanel.tsx`：新增非文件的 `plugin-panel` 模式，在文件加载和保存 hooks 之前分流。属于瞬时视图，重启后按 worktree 重建，不扩展远程会话协议。
- `components/right-sidebar/PluginPanel.tsx`：复用 sandbox / CSP / postMessage 桥，给主区域页绑定自己的 worktree 上下文；不放开网络，不增加 allow-same-origin。
- 本次没有新增业务专用 preload / IPC，也没有修改原有终端内核、官方更新源或项目根 package.json。升级后优先检查上述适配点，官方具备相同接口时再迁移。

### 开发包与验证入口

- `config/scripts/build-zstack-dev.mjs <新输出目录>`：打包已编译 checkout，为 `Orca ZStack Dev.app` 设置独立标识和 `~/Library/Application Support/Orca ZStack Dev` 数据目录，仅首次创建开发配置。该包依赖当前 checkout 的 `out/`、`node_modules` 和插件目录，不是可分发的独立 DMG。
- 先编译 CLI，再运行 `node config/scripts/run-electron-vite-build.mjs`，避免两者共享 `out/` 时产物覆盖。使用 `verify-cli-bin.mjs --fix-executable --fix-package-json` 整理的是 `out/package.json` 和输出可执行位，不是根配置。
- 本机 CLT 的 C++ 标准库位于 SDK；原生模块构建需要 `CPLUS_INCLUDE_PATH=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/c++/v1` 与 `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk`。这是环境参数，不改公共构建配置。pnpm 12 的 exec 可能触发未完成安装的 postinstall，注意不要再次用缺少这两个变量的安装覆盖原生模块。
- 定向回归：`node --test plugins/zstack-launcher/test.mjs`、`node plugins/zstack-launcher/panel.test.mjs`；宿主用 Vitest 的 `plugin-workspace-extension.test.ts`、`plugin-host-methods.test.ts`、`plugin-host-conformance.test.ts`、`plugin-manifest.test.ts`。测试和检查进程设置 `ORCA_BACKGROUND_LAUNCH=1`。
- 后台冒烟通过现有插件 IPC 读取配置和模块，不运行 FE/BFF。真正的服务启动、工作树切换和端口就绪由用户测试验收；不能把模拟进程测试写成真实服务通过。

### 2026-09-19 服务页交互修订

- 已获批准修改 `src/renderer/src/lib/worktree-initial-terminal-seeding.ts` 和 `src/renderer/src/components/use-terminal-watcher-effects.ts`：在空工作树的自动终端创建前等待通用插件面板探测。显式启动命令、默认终端模板和远程主机行为不变。
- `components/plugin-workspace/initial-plugin-workspace-panel.ts` 合并并发探测，4 秒超时退回默认终端，迟到结果和切换工作树不抢焦点；旧终端不自动关闭。
- 模块排序取自项目 start.ts 的 Shell 优先/名称排序，增加 core-* 核心分组；源码缺失不能通过 pnpm install 补齐。
- FE 安装依赖复用本机 zs-start __prepare-frontend --product ... --apps ...，仅处理所选模块；BFF 使用 dependency-install.mjs 校验当前工作树目录和既有 pnpm store，离线、frozen-lockfile、ignore-scripts、filter=bff... 安装。两者均通过原有 runner 记录完整输出，不隐式启动服务。
- 对应回归：initial-plugin-workspace-panel.test.ts、catalog-selection.test.mjs、panel.test.mjs；实际依赖安装和真实服务启动仍由用户操作验收。

### 左右布局与产品筛选

- BFF/FE 左右布局，列表独立滚动，操作区固定可见；BFF 地址/描述两行显示，悬停或键盘聚焦显示铅笔编辑按钮。
- 保留产品下拉框，默认 Cloud。扫描仅保留当前产品或共享目录中可启动的模块；产品 Shell 自动加入启动选择，不再作为重复产品入口列出。
- 业务模块统一按名称字母排序，支持 A–Z 首字母筛选和“全部”，筛选不清空选择；清空业务模块仍保留当前产品入口。产品选择分别恢复各自已保存模块。
- 本次仅修改插件，不改宿主；插件文件由开发版直接加载，不需要重新构建 Electron。

### 固定服务入口与侧栏去重

2026-09-20 后续交互修订：按用户要求移除右上角及空白页标题栏的固定“服务”按钮，入口移至标签栏“＋”新增菜单，沿用现有插件探测、工作区绑定及 TAB 去重逻辑；下列固定按钮描述为历史实现。标题栏、空白页品牌和窗口标题统一显示 `orca zstack`，服务页添加按钮显示“＋ 添加”。旧品牌翻译记录保留，不进行语言包删除。

开发版已通过新增菜单打开/复用服务 TAB、添加弹窗、空白页品牌及工作区恢复页面的实际检查；安装版名称和菜单入口也已核验。生产版 `1.4.197-zstack.20260920.1` 已替换 `/Applications/Orca ZStack.app`，旧包备份于 `dist/local-builds.noindex/zstack-production-20260920-menu/previous/`。

- 已批准接入 TabGroupPanel.tsx、EditorFileTab.tsx、use-right-sidebar-activity-items.ts。通用识别依据仍是 workspace-panel.<id>.probe，不在公共组件写 ZStack 专用条件。
- 快捷命令旁提供固定图标按钮，仅在已确认支持的本机工作树显示。点击复用/聚焦现有 TAB（含其他分组），关闭后可重新打开。探测本身不打开页面，保留自动打开服务页的既有行为。
- 服务 TAB 和固定入口复用插件图标解析，ZStack 插件明确使用 Plug。普通文件 TAB 的图标与关闭行为不变。
- 主区域插件页从侧栏活动入口和可恢复路由中排除，旧的右侧服务路由回到 Explorer。其余侧栏插件保留。
- 宿主源码变化需要重建 renderer；不重启用户应用、不启动实际 BFF/FE。

### 关闭最后一个 TAB 后的服务入口

- 已批准在 `app-shell/TitlebarMainStrip.tsx` 的空白页标题栏增加“插头 + 服务”按钮，有 TAB 时沿用 TabGroupPanel 的入口。两处使用同一组件，右侧栏不重复渲染服务内容。
- `close-file-action.ts` 关闭最后一页会清空 activeWorktreeId，但保留 activeWorkspaceKey 的侧栏选择。插件入口只读探测这份选择；仅显式点击时通过 setActiveWorktree 恢复本机工作树并打开页面。自动探测不重新激活，切换选择后的迟到结果不抢焦点。
- 回归必须包含最后一页关闭后的 activeWorktreeId=null 状态，而不仅仅是 openFiles=[]；并覆盖切换工作树、远程主机、不支持的项目。

### 2026-09-19 standalone local app

- Installed `/Applications/Orca ZStack.app`, arm64, version `1.4.197-zstack.20260919`, bundle ID `local.orca.zstack`. Original Orca and development app are preserved.
- An independent electron-builder override reuses upstream resource maps and afterPack checks; public build configuration is unchanged. Recipe and verification records: current Codex task `outputs/orca-zstack-production/`.
- Packaged bootstrap pins userData to `~/Library/Application Support/Orca ZStack` before loading main. Keep the executable named `Orca` for Resources/bin/orca compatibility; the outer app folder may be named Orca ZStack.app.
- The launcher is copied to Contents/Resources/plugins/zstack-launcher. Migrated devPluginPaths points there. Settings, projects and launcher selections are copied from the development profile with a backup; live terminal/browser sessions and automations are not migrated.
- Swift 6.4 swiftbuild failed with `Unknown error parsing property list`. A temporary command wrapper used `swift build --build-system native --jobs 2`; system tools and public build scripts were not modified. Native build mode is deprecated, so recheck toolchain compatibility on future builds.
- Ad-hoc signature, deep strict verification, packaged daemon loading and hidden startup passed. app.isPackaged=true, launcher idle, no visible/focused window; smoke processes and ports were released. Not notarized. Real FE/BFF acceptance remains with the user.
- Continue updating this fork from source. Official in-app updates can replace custom functionality.

### 2026-09-20 启动器与自动更新调整

- 本次服务页布局修订已通过开发版和安装版的实际 CDP 页面检查：添加按钮与启动按钮同排、产品名称无不可用后缀、缺少源码错误在列表中央；开发版另验证添加弹窗、搜索空状态和字母跳转。生产版 `1.4.197-zstack.20260920` 已替换 `/Applications/Orca ZStack.app`，构建和旧包备份在 `dist/local-builds.noindex/zstack-production-20260920/`；这些页面检查不代表实际 FE/BFF 服务启动验收。

- 本 fork 的 `updater-policy.ts` 关闭自动更新；`updater-scheduling.ts` 禁止自动检查与定时重试，`updater-setup.ts` 禁止退出时自动安装。保留手动更新逻辑和原更新源；需要重建宿主才生效。
- BFF 浏览器按钮调用本机默认浏览器打开 `http://主机:5000`，与 zs-start 双右箭头相同；“当前”标签来自目标工作树 `.env`，不与待启动选择混淆。
- 产品从 start.ts 的 PRODUCT_CONFIGS 读取，名称带入口模块；模块依赖紧跟模块名称，右侧字母索引滚动定位而非筛选。全选/全不选作用于全部业务模块，保留产品入口。
- 移除代理开关、底部安装/终端/日志按钮与左上角运行状态。MF Hub Proxy 原端口确为 3200，它不是自动打开网页；Cloud Shell 是 3000。本次按要求停用代理（--proxy=false）。
- 两类服务先通过插件适配器复用 zs-start 的 prepare_frontend_scope 准备完整包依赖闭包和缺失/过期运行产物，再启动原命令；失败或取消准备不进入启动阶段，阶段输出都在同一个新终端 TAB 展示。页面打开没有安装副作用。
- `prepare-dependencies.py` 从 PATH 中的 zs-start 入口解析已安装 Python 源码，复用其依赖准备函数并传真实产品/包名。仅自动同意离线安装失败后的联网重试；准备阶段使用 CI=true 与关闭的 stdin，不向终端盲目发送 y。通过 Git common directory 显式绑定目标仓库，避免需求记录 APP 的全局项目选择影响当前工作树。不修改需求记录 APP 或 zs-start 源码。

### 2026-09-20 获批的终端关闭接口

- 用户明确批准公共接口扩展。`terminal.closeOwned` 使用已有 terminal:manage 授权、worker-only 调用和审计路径；只允许相同插件关闭宿主记录的终端，复用 runtime.closeTerminal，不更改终端内核或远程 wire。
- 宿主修改范围：plugin-host-api.ts、plugin-owned-terminals.ts、plugin-host-method-bindings.ts、plugin-host-service-bindings.ts、plugin-service.ts；对应 conformance 和 workspace-extension 测试同步更新。
- `stop-run.mjs` 先通知并等待本次服务进程组结束，再关闭终端 TAB；尚未执行的命令先失效处理。超时或执行主机返回 live / unverifiable 保留错误与重试权限，不误报成功。
- 依赖阶段自动安装和构建，无需手动输入 y；离线缺包时自动重试联网，联网失败停止流程。该行为只作用于点击启动后的准备阶段，不影响用户其他终端。

### 2026-09-22 服务启动、终端复用与环境维护

- 修改限于 `plugins/zstack-launcher/`，复用已有 `workspace.readContext`、`terminal.focusOwned`、`terminal.sendText`，不扩展宿主接口。插件 manifest 增加已有的 `workspace:read` / `terminal:send` 权限；已有配置需重新确认插件权限。
- BFF/FE 启动请求均可接受，运行阶段可以并行；同一 worktree 的依赖准备按运行记录排队，避免并发写 node_modules / 构建产物。等待状态明确展示，取消等待不停止另一项服务；无法确认前序准备状态时不继续执行。
- 停止后保留原生终端 TAB 和输出。再次启动确认旧运行器退出，核对当前 worktree 终端与插件归属后复用；用户已关闭旧 TAB 时才创建新 TAB。不向任意当前终端发送命令。
- BFF 右上角只保留启动/停止。IP/描述搜索无匹配时显示描述输入框和“添加并保存”，新增项置顶；编辑保存使用按钮脚本，避免 sandbox / CSP 阻止表单提交。删除当前候选后刷新不会从 `.env` 再次补回；候选维护不改写实际环境。
- `.env` 更新保留原子替换和工作树隔离校验，取消 `.orca-launcher.bak` 写入；不清理历史备份或其他应用的备份。
- FE 增加已选模块定位和上下循环切换，按字母顺序导航；定位清空搜索显示目标，保留选择，并排除隐含的产品入口。
- 本次只更新开发版，生产版等待用户测试后的明确交付指令。定向回归已通过 17 项（临时仓库及模拟子进程）；实际开发版沙箱页已检查 IP 搜索/新增/编辑/删除/刷新持久化、新增置顶、模块定位上下切换。真实 ZStack 服务及端口就绪不在此次验收范围内。
- 原生终端集成验收受宿主创建超时阻塞：开发版在隔离模拟项目中报 `Timed out waiting for terminal handle after creation`，未获得运行器日志；因此实际 TAB 重启复用未验收通过，不能用单元测试代替。没有改动公共终端实现；临时验收项目和终端已清理，开发版保留。

### 2026-09-22 FE 工具栏收拢

- FE 搜索行左侧仅保留全选、定位两个图标按钮，右侧放业务产品下拉。全选提供空方框、部分选择、全部选择三种状态；空选和部分选择时点击全选，全选时点击取消选择，作用于当前产品全部业务模块。
- 定位图标在无业务选择时调用既有 `changedModules` 获取当前 worktree 分支变更，先勾选并保存，不在同一次点击跳转；后续逐次循环定位已选模块。保留原来的初始默认勾选及取消自动勾选记忆；没有已选模块且没有可选变更模块时禁用定位按钮，不显示提示；点击时重新检测结果为空也直接禁用，不全选其他模块。
- 删除独立的变更选择按钮、上下定位按钮和“已选”文案。选择数只放在 FE“启动（N）”中，排除隐含 Shell；无业务选择时显示“启动”并禁用。服务运行中的停止操作保持可用。
- 修改仅涉及插件页面、既有页面测试断言和说明文档；无宿主改动。开发版直接加载插件源码，无需编译或生产构建。
- 已通过实际开发版 CDP 页面验证：临时 Git 分支默认勾选 alpha/beta/gamma；三态全选、取消后刷新保持、空选时先选变更再循环定位、搜索后定位、无变更提示、启动计数及空选禁用。未启动 FE/BFF；临时项目验证后移除，开发版切回原工作区并保留。

### 2026-09-22 搜索与 IP 补录

- BFF/FE 搜索框统一为 32px 高，清空图标仅在有内容时出现，点击立即恢复列表并保留搜索焦点。两者使用忽略大小写的顺序模糊匹配；输入停顿 300 毫秒后更新结果，中文输入法组合输入期间不显示空状态或补录表单。
- BFF 无匹配时按完整 IP（含 HTTP/HTTPS URL）或描述切换补录字段：IP 搜索补描述，描述搜索补 IP；不新增提示文案，字段不完整或 IP 无效时禁用添加。
- 新增/编辑保存接受 IP 主机的 HTTP/HTTPS URL，仅记录 IP，忽略协议、端口、路径、查询和片段。保留原有裸域名记录兼容；不接受域名 URL 或被 URL 解析器自动补全的非完整 IPv4。候选维护不触碰 `.env`。
- 修改仅涉及启动器插件页面、地址校验及说明，无宿主修改。开发版页面与插件后台均已重新加载源码；未构建或替换生产版。
- 已通过地址校验定向测试和实际开发版 CDP 验收：等高/清空、FE 非连续字符及 BFF 中文模糊匹配、输入等待与组合输入、两种补录方式、URL 新增/编辑/查询、刷新持久化及无效 IP 禁用。测试数据及临时项目已移除，未启动真实 FE/BFF；开发版保留在原工作区。

### 2026-09-22 连续包含搜索、回车新增及浏览器 TAB

- 以本次交互修订覆盖此前顺序模糊匹配和内联补录：BFF/FE 按独立字段连续包含完整输入，不跨字符或跨字段；无匹配时只显示空状态。BFF 输入完成按回车才复用新增弹窗，完整 IP/URL 填 IP，否则填描述，输入法确认不会触发新增。
- 新增候选与当前 worktree/product 的选中主机在同次保存中持久化；成功后清空搜索并选中新项，取消保留搜索。新增项置顶，URL 只记录 IP；候选维护不改写实际运行环境。
- 取消按钮移到保存旁边；编辑弹窗左下角为红色无边框删除图标和文字，悬停有背景，点击后出现二次确认。新增弹窗不显示删除。
- 用户明确批准公共浏览器接口修改：`plugin-capabilities.ts` 新增 `browser:open`，`plugin-host-api.ts`、`plugin-host-method-bindings.ts`、`plugin-host-service-bindings.ts` 增加 worker-only 的 `browser.open`。只接受 HTTP/HTTPS、沿用权限/审计/传输校验，校验当前 worktree 后向既有 `browserTabCreate` 传显式 worktree ID，创建并激活新 TAB。现有浏览器内核、远程 wire 与其他插件授权保持原行为；旧宿主不能启用含新权限的新版插件，需要同步重建。
- 启动器停止调用 `/usr/bin/open`，服务 URL 仍为 `http://IP:5000`。本次开发版已批准更新后的插件权限并加载重新编译的宿主；生产版尚未构建或替换。
- 定向权限/跨工作区/非 HTTP(S) 拒绝及 main/relay 合约检查共 22 项通过；Electron 源码编译通过。实际开发版页面已验证连续匹配、回车才新增、IP/描述预填、取消保留、自动选中与刷新持久化、删除确认/取消、按钮位置样式，以及浏览器 TAB 的显式 worktree 归属。测试记录及临时项目已清理，未启动真实 FE/BFF。
- 原工作区已选地址 `http://172.25.119.0:5000/` 的新 TAB 归属正确，但加载返回 `ERR_EMPTY_RESPONSE`；服务页面内容未验收通过，不将 TAB 创建成功等同于服务可达。保留该 TAB，开发版切回服务页供用户检查。

### 2026-09-23 服务页保留与可见性

- 实测原行为在切换浏览器 TAB 后卸载服务 iframe，切回重新发起 snapshot；一次采样页面创建约 407ms，数据就绪共 1.33 秒。此次用户明确批准公共 TAB 容器及插件页面生命周期修改。
- `TabGroupPanel.tsx` 将插件文件页与普通编辑器分开，按 TAB ID 保留组件，切换只隐藏/显示，关闭 TAB 时卸载；普通编辑器仍沿用原来的活动页渲染。`PluginWorkspacePanel.tsx` 延迟到首次显示才加载插件，未访问的持久化 TAB 不提前请求数据。
- `PluginPanel.tsx` 向 iframe 发送只含可见性的宿主消息，隐藏时暂停 watchdog，重新显示恢复。启动器仅接受 parent 的消息，隐藏期间停止状态请求，显示时只拉取运行状态；完整列表通过显式刷新、配置保存或产品切换更新。脚本、主题或应用刷新仍按既有机制重建页面。
- 已通过 12 项 PluginPanel 定向检查及渲染端编译。开发版实际 CDP 验收：切回同一文档约 104ms，只有 status、没有 snapshot；隐藏超过 4 秒无请求；搜索与滚动位置保持；跨 worktree 保留；关闭测试 TAB 释放 iframe。数据为单次本机采样，不作为性能上限承诺。
- 临时空白浏览器 TAB 和测试项目已移除，开发版切回原工作区并保留。此次仅刷新渲染端，没有重启用户终端、启动 FE/BFF 或构建/替换生产包。

### 2026-09-23 生产交付

- 用户明确选择“构建生产版并替换本地应用”，本次构建并安装 `1.4.197-zstack.20260923.1` 至 `/Applications/Orca ZStack.app`，标识保持 `local.orca.zstack`。原版 Orca、用户配置和原有 5 个终端会话保留；替换前核对终端均为空闲 shell。
- arm64 打包复用已验收的 CLI/主进程/renderer 产物并更新 web 投影；原生依赖首次重编译因缺少 C++ 头文件失败，补充既有 SDK 环境参数后打包成功。深度签名检查及 14 个插件文件逐一比对通过，打包守护进程入口与插件资源检查通过。
- 生产版通过 CDP 实际检查：Cloud 74 个模块、两搜索框同为 32px、连续匹配、一键清空、回车新增弹窗、URL 提取 IP、取消保留搜索；TAB 切换保留同一 iframe 及搜索，隐藏/显示通知正常。临时空白浏览器 TAB 已关闭，没有新增测试 IP 或启动真实 FE/BFF。此前原生终端重启复用的实际验收缺口仍保留。
- 旧应用包保留在 `dist/local-builds.noindex/zstack-production-20260923/previous/Orca ZStack.app`，构建配方及 `BUILD-INFO.json` 位于同级目录。生产版 PID 71160、CDP 9334，开发版 PID 50407、CDP 9333，均保留供用户使用；没有提交或推送。

### 2026-09-23 取消跨服务依赖准备排队

- 对照已安装 zs-start 的 `prepare_frontend_scope` 确认：`--workspace-concurrency=1` 只限制单次准备中的包构建顺序，没有 BFF/FE 跨任务锁。此前插件增加的 `waitForPreparation` 属于额外限制，现已从运行记录生成及 runner 执行路径移除。
- 两个服务各自准备并启动；一项准备未结束时，另一项可以进入运行；取消一项准备不影响另一项。保留同类服务防重复和单项准备失败不启动服务的行为。旧记录中的等待字段不再生效，页面不再提示等待另一项服务。

### 2026-09-23 加载时行内按钮显隐

- 加载时 `button:disabled` 的透明度优先于 `.server-open` / `.server-edit`，导致未悬停行的打开和编辑图标全部露出。仅在插件 CSS 中将显隐选择器限定为 `button.server-open` / `button.server-edit`，使默认隐藏规则在禁用状态仍生效；悬停、键盘聚焦及无悬停设备的入口保留。

### 2026-09-23 生产交付 .2

- 用户测试完成后明确授权生产更新。使用独立打包配方构建 arm64 `1.4.197-zstack.20260923.2` 并安装到 `/Applications/Orca ZStack.app`，标识 `local.orca.zstack`；复用本轮未修改的宿主编译产物和通过运行时检查的原生依赖，打入最新启动器插件。默认 Pin 仍按用户选择暂不修改。
- 新包和安装后深度签名检查通过，14 个插件文件与当前源码逐一匹配。生产版实际 iframe 验证跨服务按钮独立、启动中动画、准备中取消入口、失败复位和加载时行内按钮隐藏；仅使用临时模拟响应，未启动真实 FE/BFF。原有 7 个终端会话全部保留，原版 Orca 和用户数据未改动。
- 旧包备份：`dist/local-builds.noindex/zstack-production-20260923-2/previous/Orca ZStack.app`。配方、文件哈希、验收截图与 `BUILD-INFO.json` 在同级构建目录。
- 交付后正常关闭本任务开发版 PID 90635，记录的 9 个进程全部退出，CDP 9333 已释放；保留开发版应用包和数据。本次没有提交、推送或远程发布。
