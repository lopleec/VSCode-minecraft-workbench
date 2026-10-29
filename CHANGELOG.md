# Changelog

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
