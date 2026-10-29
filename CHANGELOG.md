# Changelog

## 0.4.1

- Lowered the minimum VS Code version to 1.96 and the source build Node.js requirement to 22.0. Clarified that VSIX users do not need a separate Node.js installation.
- Made native MCP registration optional. VS Code 1.96–1.100 supports authenticated manual MCP connections; 1.101 and later keeps automatic registration.
- Fixed stale Java requirements after server upgrades, restored profiles when version saving fails, and avoided orphan directories on failed Velocity creation.
- Validated nested MCP settings, redacted source URL credentials recursively, and made MCP language changes clear workspace overrides. Memory, ports and counts now require integers.
- Kept native resizable sidebar views, balanced the initial space allocation and added Show Sidebar View to reveal or focus a section.
- Limited More to Java settings, tasks, logs and agreements. Proxy credentials, MCP and storage utilities are grouped under Settings.
- Fixed the native Settings filter after the publisher ID change.

### 简体中文

- 最低 VS Code 版本降至 1.96，源码构建所需 Node.js 降至 22.0；明确安装 VSIX 无需额外安装 Node.js。
- MCP 原生注册改为可选；VS Code 1.96–1.100 可手动配置带认证的 MCP 连接，1.101 及以上保持自动注册。
- 修复服务端升级后 Java 要求未更新、版本保存失败后档案未恢复，以及 Velocity 创建失败遗留目录的问题。
- 补齐 MCP 嵌套设置校验、下载源凭据遮蔽和语言切换覆盖工作区设置；内存、端口和数量设置改为整数校验。
- 保留原生可拖动分栏，调整初始空间比例，增加“显示侧栏分类”以找回隐藏或位于下方的分类。
- 更多分组只保留 Java 设置、任务、日志和协议；代理凭据、MCP 和存储工具归入设置。
- 修复 Publisher ID 变更后原生设置筛选条件仍使用旧 ID 的问题。

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
