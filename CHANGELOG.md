# Changelog

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
