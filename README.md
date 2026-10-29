# Minecraft Workbench

A Minecraft Java Edition launcher, mod development workspace and server manager for VS Code.

[Releases](https://github.com/lopleec/VSCode-minecraft-workbench/releases/latest) · [简体中文](#简体中文) · [中文使用说明](README.zh-CN.md) · [MIT License](LICENSE)

Native sidebar views, commands, settings, tasks and output channels keep the extension at home in VS Code. Editor pages follow your theme, including light, dark and high contrast. The default language follows VS Code; English and Simplified Chinese can also be selected manually.

![Modrinth discovery in VS Code with the Dark Modern theme](docs/images/discover-dark.png)

## Requirements and installation

- Desktop VS Code **1.103 or later**. Minecraft **Java Edition** only.
- A compatible Java runtime for the selected game version; use **Java → Detect Local Java** or **Download JDK**. Mod development requires a JDK.
- Internet access for initial downloads. A fully installed instance can launch with an offline account without refreshing the version manifest.
- In SSH, WSL or container workspaces, files and processes live on the **extension host machine**. Launching a game there requires a graphical session.

1. Open the [latest release](https://github.com/lopleec/VSCode-minecraft-workbench/releases/latest).
2. Under **Assets**, download `minecraft-workbench-<version>.vsix`.
3. In VS Code, run **Extensions: Install from VSIX…** and select the downloaded file.
4. Reload VS Code if prompted, then open **Minecraft** in the activity bar.

Use a trusted workspace to enable operations that download files or run processes. Development builds are available from successful [CI runs](https://github.com/lopleec/VSCode-minecraft-workbench/actions/workflows/ci.yml) under **Artifacts → minecraft-workbench-vsix**; unzip the artifact before installing its VSIX.

To build from source, use Node.js **22.14 or later**:

```sh
git clone https://github.com/lopleec/VSCode-minecraft-workbench.git
cd VSCode-minecraft-workbench
npm ci
npm run package
```

Install the generated `.vsix` using the same steps above.

The publisher is `Lopleec`; the extension ID is `Lopleec.minecraft-workbench`. If upgrading from the old `minecraft-workbench.minecraft-workbench` development build, uninstall that build before installing this one. Existing default storage is detected and reused. Microsoft accounts must sign in again because SecretStorage is scoped to the extension ID.

### First use and agreements

The first run opens **Agreements & About**. Read the linked [Minecraft EULA](https://www.minecraft.net/en-us/eula) and the extension's [terms and notices](TERMS.md), then check both boxes and select **Accept and continue**. Both start unchecked. Choosing **Not now** closes the page and leaves extension operations unavailable.

Only agreement reading, language selection, confirmation and closing remain available; all other extension commands and operations stay locked. The sidebar Language command can still change the extension-wide preference before acceptance.

The page defaults to following the extension language. Its manual language selector changes only this page, leaving the extension, sidebar and VS Code preferences unchanged. The extension itself follows VS Code by default.

![First-use agreements in VS Code](docs/images/agreements-en.png)

The confirmation stores only the notice version, time and two choices locally in the VS Code profile. Updated extension notices require confirmation again; the notice version is not a Mojang EULA version. **Agreements & About** remains available from the sidebar and Command Palette. This confirmation adds no restrictions to MIT and does not grant a Minecraft game license.

## Launcher Mode

1. Open **Instances → New instance**. Choose a name, game version, loader and parent directory.
2. Add an offline account in **Manage → Accounts**, or configure Microsoft sign-in below.
3. Detect, add or download Java from **Manage → Java**.
4. Choose **Install / Repair**, then **Launch**. You can also save an instance first and install it later.

![Instance installation form with April Fools versions](docs/images/install-dark.png)

The version list includes releases, snapshots and previews, April Fools versions, old Beta and old Alpha from Mojang's manifest. Vanilla, Fabric, Quilt, Forge and NeoForge are available where the selected version supports them. Loader prereleases are listed too. Change game or loader versions later, reinstall a loader, or repair a failed download from the instance pages.

| Area | Available controls |
| --- | --- |
| Instances | Independent game directories, version switching, repair, duplicate with or without worlds, move directory, last played and playtime |
| Launch | Per-instance account and Java, memory, GC, JVM and game arguments, window size, fullscreen, server auto-join |
| Content | Modrinth mods, modpacks, resource packs and shaders; local JAR/ZIP imports; enable, disable, remove and update |
| Worlds | Full `saves` backups, restore, optional backup before launch and retention limits |
| Downloads | Progress, cancellation, retry, resumable files, published hash verification, mirrors and proxies |
| Accounts and Java | Multiple offline/Microsoft accounts, account switching, local Java discovery and Eclipse Temurin downloads |

### Browse and manage content

Open **Content → Browse content**. Discover starts with the most downloaded projects, with icons, descriptions and download counts. Search or sort by relevance, followers, recent updates or newest releases. Choose an instance to apply Minecraft and loader compatibility filters.

**Versions** lists a project's releases with game, loader and release-channel filters. **Show all versions** also reveals incompatible releases; installation into an incompatible instance stays blocked. Selecting a version opens a dependency review before installation.

![Iris version selection and required dependency review](docs/images/dependencies-dark.png)

Required dependencies resolve recursively. Optional dependencies can be included separately. Fabric and Quilt checks inspect `fabric.mod.json`, embedded modules, version ranges and declared incompatibilities. Forge and NeoForge use Modrinth declarations and game/loader compatibility. Conflict checks help detect declared dependency problems, duplicate Fabric IDs and unreadable archives; they cannot predict every runtime or mixin conflict.

The **Installed** tab supports filtering, local imports, toggling files, removal and updates. Updates preserve disabled state and archive replaced files in `.workbench/history`. Shader packs require a compatible shader mod such as Iris or Oculus.

Use **Instances → Import modpack** or **Installed → Import modpack…** to import Modrinth `.mrpack` files locally or download packs from Discover. Imports create a new instance and apply common/client overrides, skipping server-only and optional client files. Export includes enabled content and configuration, with download references for recognized files and overrides for local files. Worlds, logs, server lists and account metadata are excluded. **CurseForge packs are not supported.**

### Memory and instance settings

Memory is adjusted **after creation**, in **Instance settings**, or globally in VS Code Settings. By default, minimum and maximum memory are `0` (automatic): the maximum uses **25% of system RAM**, rounded down to 128 MB and capped at 8 GiB; the minimum scales with it, usually 256–1024 MB. Change the percentage globally, or turn off **Use global memory settings** to set an instance's own limits. Explicit manual values take precedence.

Stop a running instance before changing its content, versions or restoring worlds. Restore automatically backs up the current worlds first. Deleting an instance moves its entire game directory to the operating system trash when supported.

## Accounts and Microsoft sign-in

**No Microsoft Client ID is bundled.** Leave it empty to use offline accounts. Offline identities do not authenticate to servers that require Microsoft/Minecraft authentication.

For Microsoft sign-in, enter your own public-client application ID in **Manage → Accounts** or `minecraftWorkbench.microsoftClientId`. It must support device code flow, personal Microsoft accounts, Xbox sign-in and Minecraft Services access. An application ID alone does not guarantee Minecraft Services approval. No client secret is needed or collected.

Sign-in uses Microsoft's device login page. Refresh and Minecraft access tokens are stored in **VS Code SecretStorage**, refreshed before expiry and before launch. A failed refresh requires signing in again. Removing an account deletes its saved credentials. Account names and UUIDs are local metadata. The extension collects no telemetry.

## Server Mode

Choose **Server** in the mode selector, then **Servers → New server**. Select software, Minecraft/software version and a build. **Create and start** downloads the server, detects or downloads the required JDK and starts it. You can choose installation only, or create the entry and install later. The first game-server start asks you to accept the Minecraft EULA.

![Server installation in VS Code](docs/images/server-create-dark.png)

Supported software: **Vanilla, Paper, Purpur, Folia, Fabric, Quilt, Forge, NeoForge and Velocity**. **Custom JAR** creates a directory where you can import an executable server JAR. Availability follows each project's published versions; not every historical Minecraft version has a dedicated server. Experimental builds require an explicit selection.

**Console & settings** contains the console, commands, normal stop/restart, Java and memory settings, server properties, version changes, repair and world backups. Stop before editing content or restoring worlds. Normal stop sends the server's save/shutdown command; force stop asks for confirmation. A server can be removed from the list while retaining its files.

![Paper console and controls in VS Code](docs/images/server-console-dark.png)

**Discover** and **Installed** use the selected server. Paper/Purpur list compatible Bukkit, Spigot and Paper plugins; Folia requires declared Folia support. Velocity filters for Velocity plugins. Fabric, Quilt, Forge and NeoForge use server mods. Modrinth versions, descriptions, icons, dependency review, updates, enable/disable and removal use the same pages as client content. Client-only projects are rejected. Local JARs can be imported. Custom JAR entries have no inferred plugin/mod platform.

New game servers bind to `127.0.0.1` by default. Change **Settings → Network → Bind address** to `0.0.0.0` for LAN access. Firewall rules, router forwarding and public hosting are configured separately. Velocity is a proxy; configure its backend servers in `velocity.toml` using **Open configuration**.

## AI tools over MCP

MCP is **off by default**. Select **Workbench → Settings → Register MCP**, or enable `minecraftWorkbench.mcp.enabled`. Minecraft Workbench then appears in VS Code's MCP providers and chat tool picker. **Unregister MCP** removes the definition and closes the listener.

Tools cover instance creation and launch, game/loader versions, Modrinth content and dependencies, accounts, Java, tasks, backups, Gradle projects, server management and extension settings. `workbench_state` lists the current entries. Operations requiring a file picker or confirmation open the native VS Code UI. AI tools cannot accept the first-use agreements; server EULA acceptance remains interactive.

For another MCP client, run **Copy MCP Connection** and adapt the copied Streamable HTTP configuration to that client's format. It contains a local URL and authorization header, valid for the current extension-host session. The listener accepts authenticated requests only on `127.0.0.1`; keep the copied header private. In remote workspaces it runs on the extension host. Tool results may contain local paths, project details and console logs; the connected AI client's data policy applies. Login tokens are never returned.

## Developer Mode

Switch modes from the sidebar or status bar, then open **Manage → Projects**.

![Fabric mod project creation using an official template](docs/images/projects-dark.png)

1. Select **Fabric**, **Forge** or **NeoForge** and an official template/MDK version.
2. Enter the mod name, mod ID, Java package and project directory. The editable package suggestion uses `com.example.<mod_id>`.
3. Create the project. It opens automatically unless you disable that option. Existing projects with a Gradle wrapper can also be imported.
4. Use project actions to **build**, **clean**, **run the client**, **generate sources / IDE files** and view build artifacts.
5. For debugging, choose **Run client for debugging**. Once Gradle is listening, choose **Attach debugger**. Install **Debugger for Java** when prompted; the default port is 5005.

Gradle runs through the project's wrapper in VS Code Tasks. The first run downloads Gradle and project dependencies. Templates define compatible game, loader and Gradle versions; historical versions may have no maintained template. This creates mod projects, not decompiled standalone game clients. Extension proxy settings apply to extension-managed downloads; Gradle repositories and proxies follow Gradle/project configuration.

## Settings, downloads and storage

Open **Minecraft Workbench: Settings** to see the native grouped Settings page. **Change Language**, the sidebar language item and the **EN / 中** button switch language immediately. The extension language can be set independently from VS Code. The Workbench view keeps mode, language and Settings visible. Views retain VS Code's draggable dividers and native scrolling. Use **Workbench → … → Show Sidebar View** to reveal and focus a hidden or off-screen section. The collapsed **More** group contains Java, tasks, logs and agreements. Expand **Settings** for proxy credentials, MCP, storage and documentation; clicking its label opens the native Settings page.

```json
{
  "minecraftWorkbench.language": "en",
  "minecraftWorkbench.minMemory": 0,
  "minecraftWorkbench.maxMemory": 0,
  "minecraftWorkbench.memoryPercentage": 25,
  "minecraftWorkbench.sources": {
    "manifest": "official",
    "assets": "bmclapi",
    "libraries": "bmclapi"
  }
}
```

- **Download sources:** choose `official`, `bmclapi` or an HTTPS base per resource type: `manifest`, `client`, `server`, `assets`, `libraries`, `loader`, `modrinth`, `java`, `project`. Custom bases preserve the original path/query. BMCLAPI applies only to supported endpoints; failed mirrors fall back to the original source. Authentication always uses official endpoints.
- **Proxy:** HTTP, HTTPS, SOCKS5 and SOCKS5h are supported. SOCKS5 resolves names locally; SOCKS5h resolves through the proxy. An empty setting falls back to VS Code `http.proxy`. Use **Workbench → Settings → Proxy credentials** to save credentials in SecretStorage. Reload after network or storage changes.
- **Reuse and speed:** verified files share a content-addressed cache across instances. Existing isolated runtimes can seed it after checksum verification. Reusing a version copies its verified files and downloads only missing or changed resources. Files of at least 16 MiB use up to four HTTP Range connections with 8 MiB segments; the global connection limit defaults to six. Completed segments survive retries, and unsupported hosts fall back to a single connection. Configure `sharedDownloadCache`, `downloadConnectionsPerFile`, `downloadChunkSize` and `downloadConcurrency`. Instance files are independent copies, so edits cannot change the shared cache.
- **Download recovery:** `.part` files and HTTP Range validators allow resuming when the server supports it. A server ignoring ranges restarts the file. Published Minecraft/Modrinth hashes and JDK SHA-256 checks verify downloads.
- **Directories:** storage, game, server and project locations are configurable. Each game directory contains `.runtime` for dependencies and `.workbench` for metadata, history and backups; move them with the instance.
- **Process downloads:** these settings cover extension-managed downloads. Gradle and server bootstrappers/installers can make additional downloads under their own configuration.
- **Diagnostics:** use **Show Output** or **Open Game Log**. Extension output redacts authentication tokens and proxy credentials. Review external game/mod logs before sharing them.

## Development and validation

```sh
npm ci
npm test
npm run format:check
npm run legal -- --check
npm run compile
npm run test:host
npm run package
```

Press **F5** to open an Extension Development Host. Unit tests cover path safety, state persistence and recovery, accounts, range downloads, hashes, dependency resolution, backups and project customization. CI checks formatting, tests, compilation and packaging on Linux, Windows and macOS.

Host tests require network access and a local or downloadable VS Code. `VSCODE_EXECUTABLE` selects a local executable; `MW_LIVE_INSTALL=1` also downloads a test Fabric instance. Microsoft sign-in needs an approved application and account and is not exercised automatically. Game launch, Gradle builds and installation/start/stop of Paper, Fabric, Quilt, Forge and NeoForge 1.21.4 servers have been checked on macOS Apple Silicon; other platforms and every historical game/loader combination have not been manually verified.

Screenshots show the running extension in VS Code with sample instances and live Modrinth metadata. Project icons and descriptions belong to their respective authors.

## Feedback and contributions

Bug reports, feature requests, translations and pull requests are welcome.

- **Bugs:** search [existing issues](https://github.com/lopleec/VSCode-minecraft-workbench/issues) first, then [open an issue](https://github.com/lopleec/VSCode-minecraft-workbench/issues/new). Include reproduction steps, expected and actual behavior, extension and VS Code versions, operating system and architecture. For game issues, include the Minecraft, loader and Java versions, relevant mods and a short log excerpt.
- **Feature requests:** describe the use case and the workflow you would like to improve in an [issue](https://github.com/lopleec/VSCode-minecraft-workbench/issues/new). Screenshots or small examples help explain UI suggestions.
- **Pull requests:** fork the repository, create a branch and keep the change focused. Explain the problem, the change and how it was checked. Discuss substantial changes in an issue first. Follow the existing code style, update both languages when changing UI text or documentation, and include screenshots for UI changes. Run the relevant checks listed above before opening a [pull request](https://github.com/lopleec/VSCode-minecraft-workbench/pulls).

Remove tokens, proxy credentials, account details and personal paths from shared logs and screenshots. Keep downloaded game files, worlds, local instance data and generated VSIX files out of source contributions. Contributions are licensed under the project's [MIT License](LICENSE); third-party content retains its own license.

## License and acknowledgements

[MIT](LICENSE), Copyright © 2026 Lopleec. Bundled dependency licenses are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt).

Built with the [VS Code API](https://code.visualstudio.com/api), [XMCL](https://xmcl.app/en/core/), [Modrinth API](https://docs.modrinth.com/api/), and official [Fabric](https://docs.fabricmc.net/develop/getting-started/creating-a-project), [Forge](https://docs.minecraftforge.net/en/latest/gettingstarted/) and [NeoForge](https://docs.neoforged.net/docs/gettingstarted/) templates. Independent of Mojang, Microsoft, Modrinth and the loader projects. Game files, accounts and downloaded content retain their respective terms and licenses.

---

## 简体中文

在 VS Code 中启动 Minecraft Java 版、管理实例并开发模组。使用原生侧栏、命令、设置、任务和输出窗口；编辑器页面适配深色、浅色与高对比主题。默认跟随 VS Code 语言，也可单独手动选择英文或简体中文。

### 安装与开始使用

需要桌面版 **VS Code 1.103+**，仅支持 **Minecraft Java 版**。游戏所需 Java 可在插件中检测、手动添加或下载；开发模组需要 JDK。首次下载需要网络，完整安装后可使用离线账户启动，无需重新获取版本清单。

1. 打开 [最新 Release](https://github.com/lopleec/VSCode-minecraft-workbench/releases/latest)。
2. 在 **Assets** 中下载 `minecraft-workbench-<版本号>.vsix`。
3. 在 VS Code 中执行 **扩展：从 VSIX 安装…**，选择下载的文件。
4. 按提示重新加载 VS Code，然后打开活动栏中的 **Minecraft**。

下载和启动进程需要受信任的工作区。开发构建可从成功的 [CI 运行](https://github.com/lopleec/VSCode-minecraft-workbench/actions/workflows/ci.yml) 中下载 **Artifacts → minecraft-workbench-vsix**，解压后安装其中的 VSIX。

也可使用 **Node.js 22.14+** 从源码打包：

```sh
git clone https://github.com/lopleec/VSCode-minecraft-workbench.git
cd VSCode-minecraft-workbench
npm ci
npm run package
```

生成的 `.vsix` 按上面的步骤安装。

Publisher 为 `Lopleec`，扩展 ID 为 `Lopleec.minecraft-workbench`。从旧的 `minecraft-workbench.minecraft-workbench` 开发包升级时，请先卸载旧包。扩展会检测并复用原有默认存储；Microsoft 账户需要重新登录，因为 SecretStorage 按扩展 ID 隔离。
SSH、WSL、容器中的文件和进程位于扩展宿主机器；在远程机器运行游戏需要图形环境。

### 首次使用与协议

首次打开会显示 **协议与关于**。阅读链接中的 [Minecraft EULA](https://www.minecraft.net/en-us/eula) 与插件的 [用户协议和声明](TERMS.md)，勾选两项后选择 **同意并继续**。两项默认均未勾选；选择 **暂不使用** 会关闭页面，插件操作保持不可用。

未同意时仅开放协议阅读、语言选择、确认与关闭，其余插件命令和操作均锁定；侧栏“语言”仍可修改插件整体的语言。

协议页默认跟随插件语言；手动选择只改变协议页，不修改插件、侧栏或 VS Code 的语言设置。插件整体默认跟随 VS Code。

![首次使用协议确认界面](docs/images/agreements-zh.png)

仅将提示版本、确认时间和两项选择保存在本地 VS Code 配置中。插件提示更新后需重新确认；此版本号不代表 Mojang EULA 版本。之后可通过侧栏或命令面板的 **协议与关于** 再次查看。此确认不为 MIT 增加限制，也不授予 Minecraft 游戏许可。

### 启动模式

1. 打开 **实例 → 新建实例**，填写名称，选择游戏版本、加载器和父目录。
2. 在 **管理 → 账户** 添加离线账户，或按下文配置 Microsoft 登录。
3. 在 **管理 → Java** 检测、添加 Java 或下载 Eclipse Temurin JDK。
4. 选择 **安装 / 修复**，完成后启动。也可先保存实例，稍后安装。

版本列表包含 Mojang 清单中的正式版、快照与预发布版、愚人节版本、旧 Beta 和旧 Alpha。支持对应游戏版本可用的 Vanilla、Fabric、Quilt、Forge、NeoForge，以及 Loader 测试版本。创建后可以更改游戏版本、更新或重装 Loader，失败后可修复重试。

| 功能 | 支持内容 |
| --- | --- |
| 实例 | 独立游戏目录、版本切换、修复、复制（可选存档）、移动目录、上次启动与游戏时长 |
| 启动 | 独立账户与 Java、内存、GC、JVM / 游戏参数、窗口尺寸、全屏、自动加入服务器 |
| 内容 | Modrinth 模组、整合包、资源包、光影；导入本地 JAR/ZIP；启用、禁用、删除、更新 |
| 存档 | 完整 `saves` 备份与恢复、可选启动前备份、保留数量 |
| 下载 | 进度、取消、重试、断点续传、哈希校验、镜像与代理 |
| 账户与 Java | 多离线 / Microsoft 账户切换、本地 Java 检测、Temurin 下载 |

### 内容浏览与依赖

从 **内容 → 浏览内容** 打开页面。发现页默认按下载量展示项目图标、简介和下载数，也可搜索或按相关度、关注数、更新与发布时间排序。选择实例后，可按游戏版本和 Loader 筛选兼容内容。

**版本** 支持游戏版本、Loader 和发布类型筛选；**查看全部版本** 会显示不兼容版本，但不能将它们安装进当前实例。选定版本后先查看依赖计划，再安装。必需前置递归解析，可选依赖可单独勾选。

Fabric / Quilt 会读取 `fabric.mod.json`、内嵌模块、版本范围和声明的不兼容项；Forge / NeoForge 使用 Modrinth 声明及游戏、Loader 兼容性信息。冲突检查可发现声明的依赖问题、重复 Fabric ID、损坏文件，不能预测所有运行时或 Mixin 冲突。

**已安装** 页面支持筛选、导入本地文件、启用、禁用、删除和更新。更新保留禁用状态，旧文件存放在 `.workbench/history`。光影包需配合 Iris、Oculus 等兼容模组。

可从 **实例 → 导入整合包** 或 **已安装 → 导入整合包…** 导入本地 `.mrpack`，也可从 Modrinth 安装，新建实例并应用公共及客户端覆盖文件，跳过仅服务端和客户端可选文件。导出包含已启用内容与配置：已识别文件使用下载引用，本地文件作为覆盖文件。排除存档、日志、服务器列表和账户元数据。**暂不支持 CurseForge 整合包。**

### 内存、语言与实例设置

内存在**创建后的实例设置**或全局设置中调整。默认最小、最大内存为 `0`（自动）：最大值取**系统内存的 25%**，向下取整到 128 MB，上限 8 GiB；最小值随之调整，通常为 256–1024 MB。可修改全局百分比，或取消 **使用全局内存设置**，为实例单独填写。手动值优先。

![浅色主题下的中文实例设置](docs/images/settings-zh-light.png)

通过侧栏 **语言**、命令面板 **切换语言** 或 **EN / 中** 按钮即时切换。语言可独立于 VS Code 设置。

修改内容、版本或恢复存档前需停止实例。恢复前自动备份当前存档。删除实例会将整个游戏目录移至系统废纸篓（系统支持时）。

### 账户与 Microsoft 登录

**插件不内置 Microsoft Client ID**；留空时使用离线账户。离线身份无法通过要求 Microsoft / Minecraft 验证的服务器认证。

正版登录需在 **管理 → 账户** 或 `minecraftWorkbench.microsoftClientId` 中填写自己的公共客户端应用 ID。应用必须支持设备代码流程、个人 Microsoft 账户、Xbox 登录并获得 Minecraft Services 访问许可；仅创建应用 ID 不保证获得 Minecraft Services 许可。不需要也不会收集客户端密钥。

通过 Microsoft 设备登录页面授权。刷新令牌和 Minecraft 访问令牌存于 **VS Code SecretStorage**，到期前及启动前自动刷新；刷新失败需重新登录。移除账户会删除保存的凭据，账户名和 UUID 作为本地元数据保存。插件不收集遥测。

### 开服模式

在模式选择器中选择 **开服**，然后打开 **服务端 → 新建服务端**。选择服务端类型、Minecraft / 软件版本和构建版本。**创建并启动** 会下载服务端、检测或下载所需 JDK，然后启动；也可选择仅安装或仅创建。首次启动游戏服务端时需要确认 Minecraft EULA。

![服务端安装界面](docs/images/server-create-dark.png)

支持 **Vanilla、Paper、Purpur、Folia、Fabric、Quilt、Forge、NeoForge、Velocity**。**自定义 JAR** 可创建独立目录并导入可执行服务端 JAR。版本以各项目发布列表为准，并非每个历史 Minecraft 版本都提供独立服务端；实验构建需明确选择。

**控制台与设置** 包含输出、指令、正常停止和重启、Java 与内存、服务端属性、版本更换、修复和存档备份。编辑内容或恢复存档前需要停服。正常停服会发送保存与关闭指令；强制停止需确认。从列表移除服务端时会保留文件。

![Paper 控制台与服务端管理](docs/images/server-console-dark.png)

**发现** 与 **已安装** 使用当前服务端的兼容条件。Paper / Purpur 可安装兼容的 Bukkit、Spigot、Paper 插件；Folia 仅接受明确声明支持 Folia 的版本；Velocity 筛选其对应插件。Fabric、Quilt、Forge、NeoForge 使用服务端模组。版本、简介、图标、前置预览、更新、启用、禁用和删除与客户端使用同一套页面；拒绝仅客户端项目，也可导入本地 JAR。自定义 JAR 不会自动推断插件或模组平台。

新游戏服务端默认绑定 `127.0.0.1`。局域网访问可在 **设置 → 网络 → 绑定地址** 中改为 `0.0.0.0`。防火墙、路由器端口转发和公网托管需另行配置。Velocity 属于代理端，可通过 **打开配置文件** 编辑 `velocity.toml`，设置后端服务端。

### AI 与 MCP

MCP **默认关闭**。点击 **工作台 → 设置 → 注册 MCP**，或启用 `minecraftWorkbench.mcp.enabled`，然后在 VS Code 的 MCP 提供程序和聊天工具选择器中启用 Minecraft Workbench。**取消注册 MCP** 会移除服务定义并关闭监听。

工具覆盖实例创建与启动、游戏及 Loader 版本、Modrinth 内容与前置、账户、Java、任务、备份、Gradle 项目、服务端管理和扩展设置。`workbench_state` 可获取当前列表。需要文件选择或确认的操作仍使用 VS Code 原生界面。AI 工具不能代替用户同意首次使用协议；服务端 EULA 也需要交互确认。

其他 MCP 客户端可使用 **复制 MCP 连接**，按客户端格式填入复制的 Streamable HTTP 配置。配置包含本地 URL 与授权请求头，仅在当前扩展宿主会话中有效；请勿公开请求头。接口只监听 `127.0.0.1` 并检查授权。远程工作区中，接口运行在扩展宿主机器。工具结果可能包含本地路径、项目信息和控制台日志，并适用所连接 AI 客户端的数据政策；工具不会返回登录令牌。

### 开发模式

在侧栏或状态栏切换模式，打开 **管理 → 项目**。

1. 选择 **Fabric / Forge / NeoForge** 和官方模板或 MDK 版本。
2. 填写模组名称、ID、Java 包名和目录。包名建议使用通用的 `com.example.<mod_id>`，可自行修改。
3. 创建后自动打开项目，也可关闭该选项；支持导入包含 Gradle wrapper 的已有项目。
4. 项目操作支持构建、清理、启动客户端、生成源码 / IDE 文件和查看构建产物。
5. 调试时先选择 **启动客户端并等待调试**，待 Gradle 监听端口后 **附加调试器**。按提示安装 **Debugger for Java**，默认端口 5005。

Gradle 通过项目 wrapper 在 VS Code Tasks 中运行，首次会下载 Gradle 与依赖。模板提供对应的游戏、Loader 和 Gradle 版本，部分历史版本没有维护中的模板。生成的是模组项目，并非反编译后的独立游戏客户端。插件代理用于插件管理的下载；Gradle 的仓库与代理遵循项目及 Gradle 配置。

### 网络、目录与诊断

工作台保留模式、语言和设置；**更多** 默认收起，包含 Java、任务、日志和协议。展开 **设置** 可管理代理凭据、MCP、存储目录或查看文档；点击设置文字仍打开原生设置页。MCP 默认关闭。分类保留 VS Code 原生分栏、分隔线和滚动；在 **工作台 → … → 显示侧栏分类** 中可直接找回被隐藏或移到下方的分类。

全局选项位于 **Minecraft Workbench：设置** 的原生分组中。

```json
{
  "minecraftWorkbench.language": "zh-cn",
  "minecraftWorkbench.minMemory": 0,
  "minecraftWorkbench.maxMemory": 0,
  "minecraftWorkbench.memoryPercentage": 25,
  "minecraftWorkbench.sources": {
    "manifest": "official",
    "assets": "bmclapi",
    "libraries": "bmclapi"
  }
}
```

- **下载源：** 可按 `manifest`、`client`、`server`、`assets`、`libraries`、`loader`、`modrinth`、`java`、`project` 设置 `official`、`bmclapi` 或 HTTPS 基地址。自定义地址保留原路径和查询参数；BMCLAPI 仅用于支持的端点。镜像失败回退原始地址，认证始终走官方端点。
- **代理：** 支持 HTTP、HTTPS、SOCKS5、SOCKS5h；SOCKS5 本地解析域名，SOCKS5h 由代理解析。留空时沿用 VS Code `http.proxy`。使用 **工作台 → 设置 → 代理凭据** 将凭据存入 SecretStorage。修改网络、存储配置后需重载窗口。
- **断点与校验：** 保留 `.part`，在服务器支持时使用 HTTP Range 和校验器续传；服务器忽略范围则重新下载。校验 Minecraft / Modrinth 公布的哈希及 JDK SHA-256。
- **目录：** 存储、游戏、服务端和项目目录可配置。游戏目录中的 `.runtime` 保存运行依赖，`.workbench` 保存元数据、历史和备份，移动实例时应一起保留。
- **日志：** 使用 **显示输出** 或 **打开游戏日志**。插件输出会隐藏认证令牌和代理凭据；分享外部游戏或模组日志前仍需检查内容。

### 下载复用与并发

带校验和的文件在实例间使用共享缓存，包括客户端、库、资源、服务端、JDK 和 Modrinth 文件。旧实例中的文件也会在校验后纳入缓存；相同版本只补缺失或不同的资源，实例文件保持独立副本。

至少 16 MiB 的文件默认使用 4 个 HTTP Range 连接、每段 8 MiB；全局并发上限默认为 6。重试保留已完成分段，不支持分段的源自动回退单连接。可配置 `sharedDownloadCache`、`downloadConnectionsPerFile`、`downloadChunkSize`、`downloadConcurrency`。设置作用于插件管理的下载；Gradle、服务端引导程序和安装器可能另行下载其依赖。

### 开发与验证

```sh
npm ci
npm test
npm run format:check
npm run legal -- --check
npm run compile
npm run test:host
npm run package
```

按 **F5** 打开扩展开发宿主。单元测试覆盖路径安全、状态保存及失败恢复、账户、续传、哈希、依赖、备份和项目定制。CI 在 Linux、Windows 和 macOS 检查格式、测试、编译和打包。

宿主测试需要网络与本地或可下载的 VS Code。`VSCODE_EXECUTABLE` 可指定本地程序，`MW_LIVE_INSTALL=1` 会额外下载安装 Fabric 测试实例。Microsoft 登录需要获批应用和账户，不自动测试。游戏启动和 Gradle 构建，以及 Paper、Fabric、Quilt、Forge、NeoForge 1.21.4 服务端的安装、启动和停服，已在 macOS Apple Silicon 验证；其他平台及所有历史游戏 / Loader 组合尚未逐一人工验证。

截图来自 VS Code 中运行的插件，使用示例实例和实时 Modrinth 元数据。项目图标、简介属于各自作者。

### 反馈与贡献

欢迎提交问题、功能建议、翻译改进和 Pull Request。

- **问题反馈：** 请先搜索[已有 Issue](https://github.com/lopleec/VSCode-minecraft-workbench/issues)，再[创建 Issue](https://github.com/lopleec/VSCode-minecraft-workbench/issues/new)。提供复现步骤、预期与实际表现、插件及 VS Code 版本、系统与架构。游戏相关问题请附上 Minecraft、Loader、Java 版本、相关模组和简短日志。
- **功能建议：** 在 [Issue](https://github.com/lopleec/VSCode-minecraft-workbench/issues/new) 中说明使用场景和希望改善的操作流程。界面建议可附截图或小示例。
- **提交 PR：** Fork 仓库并创建分支，每个 PR 聚焦一项改动，说明问题、修改内容和验证方式。较大改动建议先通过 Issue 讨论。遵循现有代码风格，修改界面文案或文档时同步更新中英文，界面改动附上截图。提交 [Pull Request](https://github.com/lopleec/VSCode-minecraft-workbench/pulls) 前运行上文列出的相关检查。

分享日志和截图前，请移除令牌、代理凭据、账户信息和个人路径。源码贡献中不要包含下载的游戏文件、存档、本地实例数据或生成的 VSIX。贡献采用项目的 [MIT License](LICENSE)，第三方内容保留各自许可。

### 许可与致谢

[MIT License](LICENSE)，Copyright © 2026 Lopleec。依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)。

使用 VS Code API、XMCL、Modrinth API，以及 Fabric、Forge、NeoForge 官方模板。本项目独立于 Mojang、Microsoft、Modrinth 和各 Loader 项目。游戏文件、账户与下载内容仍适用各自条款和许可。

### 界面示例

![VS Code 中的 Modrinth 内容浏览](docs/images/discover-dark.png)

![包含愚人节版本的实例安装页面](docs/images/install-dark.png)

![版本选择与依赖安装预览](docs/images/dependencies-dark.png)

![官方 Fabric 模板项目创建](docs/images/projects-dark.png)
