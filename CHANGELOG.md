# Changelog

## 0.4.4 — 2026-10-31

## Manual extension updates

- Add **More → Check for extension updates** for GitHub / manually installed VSIX builds. A newer stable release offers the VSIX download, release notes, or **Download and install** in a local desktop window.
- Checking, downloading/installing and reloading require separate user actions. There are no startup checks, scheduled checks or silent updates. `minecraftWorkbench.updates.enabled` disables the entry and cancels active checks/downloads; an old notification cannot start an installation after the setting is turned off.
- Before installation, verify the published SHA-256, extension identity, release version and VS Code requirement. Keep running games and servers from being interrupted by an install or reload. Clean up the temporary installer after use.
- Keep Marketplace installations under VS Code’s own update settings. Unknown installation sources, remote windows or releases without a published checksum use manual download links.

## Cleanup and fixes

- Exclude commands, menus and build-only metadata from the JavaScript bundle while retaining the complete extension manifest, both README languages and licenses in the VSIX. The main JavaScript bundle is about **40 KiB smaller** than in 0.4.3; the final CI-built VSIX remains about **602 KiB** including the new update feature and documentation, with no new runtime dependencies.
- Build the settings schema once instead of rebuilding it for every request; resolve the language dictionary once per settings read. Remove an unused content type and an empty download-recovery branch.
- Keep running tasks when trimming task history. They remain visible and cancellable even when the list exceeds 100 entries; completed history is still bounded.
- Record externally aborted work as cancelled rather than failed. Observe background promise rejections even when a wait was already cancelled, and allow cancellation during download-lock/retry delays.

## Validation

- **95 automated tests passed**, including manual-update actions, disabled/stale prompts, package validation, task-history limits, shared-wait cancellation and the existing launcher/server/import/download regressions.
- Check activation, commands, settings and MCP integration on VS Code **1.96.0** and **1.101.0**. The minimum supported VS Code version stays **1.96**.

---

## 简体中文

### 手动插件更新

- 为 GitHub / 手动 VSIX 安装增加**更多 → 检查插件更新**。发现新的稳定版本后，可下载 VSIX、查看更新说明，或在本地桌面窗口点击**下载并安装**。
- 检查、下载安装、重新加载分别由用户操作；没有启动检查、定时检查或静默更新。关闭 `minecraftWorkbench.updates.enabled` 会隐藏入口并取消正在进行的检查、下载；旧通知也无法在关闭后触发安装。
- 安装前校验发布的 SHA-256、扩展标识、版本和 VS Code 要求。游戏或服务端运行时不执行安装、重新加载；安装临时文件在使用后清理。
- Marketplace 安装继续由 VS Code 自身更新设置管理。来源不明、远程窗口或发布未提供校验值时，使用手动下载链接。

### 精简与修复

- JS 构建仅保留运行所需的清单字段，移除其中重复的命令、菜单及构建元数据；VSIX 仍保留完整扩展清单、中英文 README 和许可。主体 JS 比 0.4.3 减少约 **40 KiB**；计入新增更新功能和文档后，CI 发布包仍约 **602 KiB**，未增加运行依赖。
- 设置定义改为初始化一次，读取设置时只选择一次语言字典；删除未使用的内容类型和下载恢复中的空分支。
- 清理任务历史时保留运行中的任务。超过 100 条时，仍可查看、取消这些任务；已完成历史仍有数量上限。
- 外部中止的任务正确标记为已取消；已取消的等待也会接住后台 Promise 拒绝，避免未处理错误；等待下载锁、重试间隔时可立即响应取消。

### 验证

- **95 项自动测试通过**，覆盖手动更新、关闭开关及过期通知、安装包校验、任务历史上限、共享等待取消，以及既有启动器、服务端、导入和下载回归测试。
- 在 VS Code **1.96.0**、**1.101.0** 验证激活、命令、设置与 MCP 集成；最低支持版本仍为 **1.96**。

## 0.4.3 — 2026-10-30

## External sign-in

- Show a native, localized risk confirmation before asking for a third-party username or password. Display the complete authentication API address after discovery, including any change of host.
- Explain that credentials are sent to that provider, recommend a separate password, and warn against entering a Microsoft password. Clarify that HTTPS does not establish provider trust, tokens are stored in SecretStorage, passwords are not saved, and removing a local account does not revoke access at the provider.
- Require the same manual confirmation when sign-in is opened through MCP. Passing confirmation flags in tool arguments cannot bypass the dialog. Routine token validation/refresh does not prompt again.
- Show the actual authentication host and API address in the account/password inputs instead of relying on the provider's self-reported name.
- Leave the provider field empty so users choose their own service. Add a short account-page warning and update both README languages.

## Fixes

- Cancelling the provider warning, address entry or credential input stops sign-in cleanly. The shared launcher/MCP action now returns `false` on cancellation instead of reporting success.
- Validate that the account field is nonempty before proceeding to password entry.
- Retrying external sign-in opens a fresh confirmation and credential entry instead of reusing the previous password. Authentication discovery and metadata now bypass download mirrors, matching credential requests.
- Expand the third-party notices with service terms/privacy links and separately downloaded software licenses. Add an About-page link and BMCLAPI attribution in source settings, without new routine-operation dialogs.

## Validation

- Add regression coverage for declined confirmation, MCP-style bypass arguments, resolved-host display, credential-entry order, Chinese localization and cancelled inputs.
- **82 automated tests passed**, including the existing launcher, server, storage, download and MCP regression tests.

---

## 简体中文

### 第三方登录

- 输入第三方账户或密码前，先显示原生风险确认框。提示跟随插件语言，并展示识别、跳转后的完整认证 API 地址。
- 明确用户名和密码将发送给该服务商，建议使用独立密码，勿填写 Microsoft 密码；说明 HTTPS 不代表服务商可信、令牌保存在 SecretStorage、不保存密码，以及移除本地账户不等于撤销服务商访问权限。
- 通过 MCP 打开登录也必须由用户确认，传入确认标记不能跳过弹窗。正常令牌校验、刷新不会反复弹窗。
- 账户、密码输入框显示实际认证域名和完整地址，避免被服务商自报名称误导。
- 服务商地址默认留空，由用户选择；账户页增加简短提示，中英文 README 同步说明。

### 修复

- 取消风险确认、地址输入或账户/密码输入时，直接终止登录。启动器与 MCP 共用入口正确返回 `false`，不再误报成功。
- 账户不能为空，通过校验后才进入密码输入。
- 重试外置登录时重新确认并输入凭据，不复用上次密码；认证地址识别、元数据请求与凭据请求一样绕过下载镜像。
- 补齐第三方服务条款、隐私链接及单独下载程序的许可；协议与关于增加统一入口，下载源设置补充 BMCLAPI 署名，不为日常操作增加弹窗。

### 验证

- 增加拒绝确认、MCP 式绕过参数、最终域名展示、凭据输入顺序、中文提示和输入取消的回归测试。
- **82 项自动测试通过**，包括既有启动器、服务端、存储、下载与 MCP 回归测试。

## 0.4.2 — 2026-10-30

Minecraft Workbench 0.4.2 adds portable instance storage, existing-launcher imports, external authentication and optional Terracotta multiplayer. It also fixes Java overrides and reduces the packaged extension's size.

## Instances, imports and worlds

- New instances use the **Prism / MultiMC format**, with a readable folder name instead of a UUID:

  ```text
  instances/<instance name>/
  ├── instance.cfg
  ├── mmc-pack.json
  └── .minecraft/
      ├── mods/
      ├── config/
      └── saves/
  ```

- Minecraft versions, libraries and assets are shared through the system Minecraft directory. `minecraftWorkbench.gameDirectory` selects that shared directory; `minecraftWorkbench.instanceDirectory` selects the instances parent, including an existing PrismLauncher `instances` folder. Duplicate names receive a numbered suffix.
- **Instances → Import instance** scans official Minecraft, HMCL/PCL, Prism/MultiMC and supported Modrinth profile directories, plus ZIP instance exports. The preview shows detected game and loader versions, editable names and compatibility warnings.
- **Manage in place** registers existing files. Changes are shared with the original launcher; removing the registration keeps the files. **Copy** creates an independent Prism/MultiMC instance with mods, configuration and worlds. Launcher hooks and account databases are excluded. Existing Workbench instances continue to load from their current paths and can be copied into the new format.
- **Export instance ZIP** writes a Prism/MultiMC archive with optional worlds. **World backups → Import worlds / Export world** accepts ordinary Java Edition world folders and ZIPs. Name collisions create numbered copies.

## Game language and Java

- Minecraft's initial language follows the extension, which follows VS Code by default. Automatic mode preserves a language subsequently selected in-game or found in an imported instance.
- Set `minecraftWorkbench.gameLanguage` globally or choose an instance override. Supported preferences include automatic, preserve existing, and a Minecraft locale code such as `en_us` or `zh_cn`.
- Java selection uses **instance override → global default → automatic detection/download**. The instance setting is optional; clearing it restores inheritance.
- Fix Java paths being lost when saving other instance options or applying version settings. Custom executables remain selectable even when local detection does not list them.

## External authentication

- Add **Accounts → External authentication** for HTTPS Yggdrasil services compatible with **authlib-injector**, including LittleSkin. API-address discovery and player-profile selection are supported.
- Tokens are stored in VS Code SecretStorage and validated/refreshed before launch. Passwords are not persisted. Account identities include their provider and player profile, avoiding collisions between authentication services.
- The official authlib-injector Java agent is downloaded when needed and verified against its published SHA-256 checksum. External accounts authenticate to servers configured for their provider.

## Terracotta multiplayer — optional Beta

- **Off by default.** Enable `minecraftWorkbench.terracotta.enabled`, then open **More → Terracotta (Beta)** or **Manage → Terracotta (Beta)**.
- A separate upstream-license and multiplayer notice requires two explicit confirmations before component downloads or room operations. Its English/Chinese selector changes only the notice language.
- Download a verified, pinned official component or select an existing executable. On macOS, open the official installer to configure the required background component.
- Hosts open a Minecraft world to LAN and create a room. Guests enter its room code, then copy the game address or launch the selected instance into the joined room. This temporary address does not replace the instance's saved server setting.
- Provide room status, leave-room controls and custom public-node settings. Disabling the feature or revoking confirmation disconnects rooms opened through the extension.
- [Terracotta](https://github.com/burningtnt/Terracotta) runs as an unmodified, separate program under its upstream license; its binaries are not bundled. Extension proxy settings apply to downloads, while Terracotta manages peer and relay traffic separately.

## Downloads, diagnostics and package size

- Serialize downloads targeting the same shared file and write cache copies atomically, preventing concurrent instances from racing over installers or partially copied resources.
- Conflict checks reuse cached Modrinth metadata, use bounded parallel requests and stop scheduling queued metadata lookups after a connection failure. `minecraftWorkbench.metadataConcurrency` controls parallelism.
- Preserve Unicode export names, handle Windows reserved filenames and keep long names within filesystem limits.
- Fix copying an official launcher's shared game directory into the same Minecraft root. Other instance/profile containers are excluded from the copy.
- Exclude an existing destination ZIP from repeated world/instance exports, preventing archives from nesting and growing on each export. Reject invalid world-directory names.
- Invalid JSON errors identify the service without echoing response bodies that may contain credentials.
- Production builds now minify code and remove unused modules. Both English and Chinese README files and all bundled license notices remain in the VSIX; screenshots stay in the repository and are referenced by their GitHub URLs.
- CI builds the production package, checks its contents and enforces a **1 MiB package limit**. The release VSIX is approximately **0.6 MB**.

## MCP and validation

- Add instance scan/import, world import/export, external-login and Terracotta operations, bringing the tool count to **55**. Legal confirmations still require the user in VS Code.
- Load the MCP SDK on demand. Count requests before reading their bodies so incomplete uploads cannot bypass the concurrent-request limit; close pending connections when MCP is disabled.
- **78 automated tests passed**, with compatibility checks on **VS Code 1.96 / Node 20.18.1** and **VS Code 1.101**. Native UI checks cover creation/import, Java-path retention, English/Chinese, light/dark themes, a narrow window and Beta consent/room controls.

## Compatibility notes

- Current Modrinth App installations without `profile.json` should be exported as `.mrpack` before import. Legacy MultiMC jar mods and unrecognized components are reported as unsupported; launcher-specific profile patches require copying and rebuilding a supported loader.
- Native instance and world ZIP imports/exports have a 512 MB limit. Extract larger archives or copy their instance/world folders. Bedrock `.mcworld` files require conversion to Java Edition.
- Terracotta currently targets its 0.4 local API and Java Edition LAN worlds. Cross-device public-network connectivity and real external-account sign-in have not been manually verified; integration tests use local fixtures and simulated services. NAT traversal and relay availability depend on the participants' networks and the upstream service.

---

## 简体中文

0.4.2 新增通用实例格式、其他启动器实例导入、第三方认证和可选的陶瓦联机 Beta，同时修复 Java 覆盖设置并精简安装包。

### 实例、导入与世界存档

- 新实例采用 **Prism / MultiMC 格式**：以实例名称创建目录，包含 `instance.cfg`、`mmc-pack.json` 和 `.minecraft`；模组、配置、世界分别位于游戏目录的 `mods`、`config`、`saves` 中，不再以随机 UUID 命名实例文件夹。重名时自动添加数字后缀。
- Minecraft 版本文件、运行库和资源共用系统 Minecraft 目录。`minecraftWorkbench.gameDirectory` 设置共享目录，`minecraftWorkbench.instanceDirectory` 设置实例父目录，也可指向现有 PrismLauncher 的 `instances` 目录。
- **实例 → 导入实例** 可扫描官方 Minecraft、HMCL/PCL、Prism/MultiMC、支持的 Modrinth 档案目录及 ZIP 实例导出文件，预览游戏和 Loader 版本、修改名称并查看兼容提示。
- **原地管理**保留原有文件，与原启动器共享修改；移除登记时保留文件。**复制**创建独立的 Prism/MultiMC 实例，保留模组、配置和世界，不导入启动钩子或账户数据库。已有 Workbench 实例继续从原路径读取，可通过复制迁移到新格式。
- **导出实例 ZIP** 生成 Prism/MultiMC 档案，可选择包含世界。**世界备份 → 导入世界 / 导出世界**支持原生 Java 版世界文件夹与 ZIP，重名时创建编号副本。

### 游戏语言与 Java

- Minecraft 初始语言默认跟随扩展，扩展默认跟随 VS Code。自动模式保留玩家后来在游戏中选择的语言，以及导入实例已有的语言。
- 可通过全局 `minecraftWorkbench.gameLanguage` 或实例设置选择自动、保留原设置，或 `en_us`、`zh_cn` 等 Minecraft 语言代码。
- Java 优先级为**实例覆盖 → 全局默认 → 自动检测或下载**。实例 Java 不是必填项，留空即可继承。
- 修复保存其他实例设置、应用版本设置时丢失 Java 路径的问题；即使自动检测没有列出自定义运行环境，也会保留原有选择。

### 第三方认证

- 新增**账户 → 第三方认证**，支持 LittleSkin 等与 **authlib-injector** 兼容的 HTTPS Yggdrasil 服务、API 地址发现与角色选择。
- 令牌存入 VS Code SecretStorage，启动前校验并在需要时刷新；不保存密码。账户标识区分认证服务与角色，避免不同服务之间发生冲突。
- 按需下载官方 authlib-injector Java Agent 并校验发布的 SHA-256。第三方账户用于配置了对应认证服务的服务器。

### 陶瓦联机：可选 Beta

- **默认关闭**。在设置中开启 `minecraftWorkbench.terracotta.enabled`，再进入**更多 → 陶瓦联机（Beta）**或**管理 → 陶瓦联机（Beta）**。
- 下载组件或操作房间前，需分别勾选上游许可与联机须知确认。须知提供独立中英文切换，不改变插件语言。
- 支持下载并校验固定的官方组件版本，或选择已有可执行文件；macOS 需打开官方安装包配置后台组件。
- 房主将 Minecraft 世界开放到局域网后创建房间；访客填写房间码加入，可复制游戏地址或直接启动所选实例进入房间。临时地址不会覆盖实例保存的服务器地址。
- 提供房间状态、退出房间、自定义公共节点等选项；关闭功能或撤回确认时，断开本扩展建立的连接。
- [陶瓦](https://github.com/burningtnt/Terracotta)作为独立程序运行，遵循上游许可，扩展不内置其二进制文件。扩展代理设置用于下载，玩家和中继流量由陶瓦单独管理。

### 下载、诊断与安装包

- 同一路径的下载串行写入，共享缓存采用临时文件替换，修复多个实例同时操作安装器或资源文件的竞争问题。
- 冲突检查复用 Modrinth 元数据缓存、限制并行请求，并在连接失败后停止派发排队查询；可通过 `minecraftWorkbench.metadataConcurrency` 调整并发数。
- 导出名称保留中文等 Unicode 字符，处理 Windows 保留文件名与文件名长度限制。
- 修复官方启动器共享目录无法复制到同一 Minecraft 根目录的问题，复制时排除其他实例、档案容器。
- 重复导出世界或实例时排除已有的目标 ZIP，避免把旧压缩包再次打入；拒绝无效的世界目录名称。
- JSON 响应解析失败时只报告服务信息，避免把可能含凭据的响应正文带入错误信息。
- 发布构建自动压缩代码并移除未使用的模块。VSIX 保留完整中英文 README 和许可文件；截图保留在仓库，由 README 引用 GitHub 原图。
- CI 构建生产包、检查包内容，并限制 VSIX 不超过 **1 MiB**；本次安装包约 **0.6 MB**。

### MCP 与验证

- 新增实例扫描/导入、世界导入/导出、第三方登录和陶瓦操作，工具数量增至 **55**；协议确认仍须用户在 VS Code 中操作。
- MCP SDK 按需加载；接收请求体前就计入并发限制，防止未完成请求绕过限制。取消 MCP 时关闭待处理连接。
- **78 项自动测试通过**，并通过 **VS Code 1.96 / Node 20.18.1** 与 **VS Code 1.101** 兼容检查。真实界面检查覆盖创建/导入、Java 路径保留、中英文、明暗主题、窄窗口及 Beta 确认和房间操作。

### 兼容范围

- 没有 `profile.json` 的新版 Modrinth App 档案需先导出为 `.mrpack`。旧式 MultiMC Jar Mod、未知组件会明确提示不支持；启动器专用补丁需通过复制导入重建受支持的 Loader。
- 实例、世界 ZIP 导入和导出上限为 512 MB；更大的档案请解压或直接复制实例、世界文件夹。基岩版 `.mcworld` 需要先转换为 Java 版格式。
- 陶瓦当前适配其 0.4 本地 API 与 Java 版局域网世界。跨设备公网联机及真实第三方账户登录尚未完成人工验证，集成测试使用本地样本与模拟服务。实际穿透和中继可用性取决于参与者网络与上游服务。

## 0.4.1

### Changes

- Lowered the minimum VS Code version from 1.103 to 1.96, and the minimum Node.js version for source builds from 22.14 to 22.0.
- Added manual MCP connection support for VS Code 1.96–1.100 through **Copy MCP connection**.
- Added **Show Sidebar View** to reveal and focus sidebar views. Adjusted the initial space allocated to sidebar sections.
- Added Java settings and Tasks shortcuts under **More**. Moved proxy credentials, MCP controls, storage and documentation into the expandable **Settings** group.

### Fixes

- Fixed mode changes reverting and new edits being lost during state-file synchronization or saving.
- Fixed server version changes reusing outdated Java requirements.
- Restored server profiles when saving version changes fails, and prevented leftover directories when Velocity creation fails.
- Rejected malformed argument arrays, unknown download-source fields and non-finite numeric settings. Memory limits, window dimensions, ports and count settings now require integers.
- Fixed download-source credentials being exposed in MCP settings responses, including nested URLs and username-only authentication.
- Fixed MCP language changes being overridden by workspace settings.
- Fixed the Settings command using an outdated extension ID and showing no matching settings.

### 简体中文

#### 更新

- 最低 VS Code 版本从 1.103 降至 1.96，源码构建所需的最低 Node.js 版本从 22.14 降至 22.0。
- 新增 VS Code 1.96–1.100 的 MCP 手动接入支持，可通过 **复制 MCP 连接** 获取配置。
- 新增 **显示侧栏分类** 命令，用于显示并定位侧栏视图；调整侧栏各区域的初始空间比例。
- 在 **更多** 中增加 Java 设置和任务入口；将代理凭据、MCP、存储目录和文档入口移入可展开的 **设置** 分组。

#### 修复

- 修复状态文件同步或保存期间，模式切换回退、新编辑内容丢失的问题。
- 修复服务端更换版本后仍沿用旧 Java 要求的问题。
- 修复服务端版本变更保存失败后档案未恢复，以及 Velocity 创建失败后遗留目录的问题。
- 拒绝无效的启动参数数组、未知下载源字段和非有限数值；内存限制、窗口尺寸、端口和数量设置改为整数校验。
- 修复 MCP 设置响应中下载源凭据未被遮蔽的问题，覆盖嵌套 URL 和仅用户名认证的地址。
- 修复通过 MCP 切换语言后仍被工作区设置覆盖的问题。
- 修复设置命令使用旧扩展 ID，导致无法显示扩展设置的问题。

## 0.4.0

- Added Server Mode with isolated Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge, NeoForge, Velocity and custom JAR profiles, automatic JDK preparation, console commands, settings, version changes and world backups.
- Added Modrinth server plugins and mods, platform filters, dependency review and content management.
- Added MCP registration (off by default) with 43 tools, authenticated loopback transport and a connection configuration command.
- Added shared verified download caching, reuse of existing isolated runtimes and parallel resumable ranges for large files.
- Reworked mode navigation, button alignment, empty states and modpack import entry points. Preserved settings drafts during background refreshes. Mode, language and Settings stay visible; less-used actions live in a collapsed More group.
- Corrected the Marketplace publisher to `Lopleec`; retained existing default storage. Microsoft accounts need to sign in again after migrating from the old extension ID.
- Fixed Quilt installer checksum selection, server restart locking, retry locking, modpack registration rollback and invalid proxy startup handling.

### 简体中文

- 新增开服模式，支持独立的 Vanilla、Paper、Purpur、Folia、Fabric、Quilt、Forge、NeoForge、Velocity 和自定义 JAR 服务端，以及自动准备 JDK、控制台指令、配置、版本更换和存档备份。
- 新增 Modrinth 服务端插件与模组、平台筛选、前置预览和内容管理。
- 新增默认关闭的 MCP 注册，提供 43 个工具、本机授权接口和连接配置复制命令。
- 新增共享校验缓存、旧实例文件复用和大文件分段并行续传。
- 调整模式导航、按钮对齐、空列表与整合包导入入口；后台刷新保留设置草稿。模式、语言和设置直接可见，低频操作位于默认收起的更多分组。
- Marketplace Publisher 改为 `Lopleec`，保留原有默认存储；从旧扩展 ID 迁移后，Microsoft 账户需重新登录。
- 修复 Quilt 安装器校验来源、服务端重启锁、重试锁、整合包登记失败回滚和无效代理导致激活失败的问题。
