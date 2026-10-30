# Third-party notices / 第三方说明

Bundled runtime packages retain their respective licenses. / 随附运行依赖保留各自的许可。

| Package / 依赖 | License / 许可 | Source / 源码 |
| --- | --- | --- |
| @xmcl/core, @xmcl/installer and @xmcl utilities | MIT | https://github.com/Voxelum/minecraft-launcher-core-node |
| adm-zip | MIT | https://github.com/cthackers/adm-zip |
| undici | MIT | https://github.com/nodejs/undici |
| semver | ISC | https://github.com/npm/node-semver |
| socks | MIT | https://github.com/JoshGlazebrook/socks |
| @modelcontextprotocol/sdk | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| zod | MIT | https://github.com/colinhacks/zod |
| tar | ISC | https://github.com/isaacs/node-tar |

Full bundled runtime license texts are included in `THIRD_PARTY_LICENSES.txt`, generated from the installed dependencies by `npm run licenses`. Official project templates retain their upstream license files when downloaded. / 完整运行依赖许可文本随附于 `THIRD_PARTY_LICENSES.txt`，由 `npm run licenses` 从已安装依赖生成。下载官方项目模板时保留其上游许可文件。

Authlib-injector is downloaded separately at runtime and loaded as a Java agent. It is licensed under AGPL-3.0-or-later with the AUTHLIB-INJECTOR exception; see [its license](https://github.com/yushijinhun/authlib-injector/blob/develop/COPYING.md). It is not included in the extension package. / authlib-injector 在运行时单独下载，并作为 Java Agent 加载，采用附带 AUTHLIB-INJECTOR 例外的 AGPL-3.0-or-later 许可；扩展安装包不包含该组件。

Terracotta © Burning_TNT and contributors is downloaded separately and used unmodified through its local HTTP API, under AGPL-3.0-or-later with the upstream integration exception. Its copyright and license are displayed on the multiplayer page. See [Terracotta source and exception](https://github.com/burningtnt/Terracotta#许可) and [license](https://github.com/burningtnt/Terracotta/blob/master/LICENSE). / 陶瓦在运行时单独下载，通过本地 HTTP 接口调用未修改的官方程序；其版权与许可在联机页显示，采用附带上游接入例外的 AGPL-3.0-or-later。

## Online services

A service's terms and privacy policy govern access to that service. An open-source license for its client or server code is a separate matter. This extension's MIT license does not relicense downloaded games, mods, plugins, templates or runtimes. The license and notices shipped with each selected release take precedence over this index.

| Service | Purpose | Official terms and information |
| --- | --- | --- |
| Microsoft / Mojang | Microsoft device sign-in, Xbox/Minecraft account checks, game metadata and downloads | [Microsoft services agreement](https://www.microsoft.com/servicesagreement), [privacy](https://privacy.microsoft.com/privacystatement), [Minecraft EULA](https://www.minecraft.net/en-us/eula), [usage guidelines](https://www.minecraft.net/en-us/usage-guidelines) |
| Modrinth | Project search, version/dependency metadata, icons and content downloads | [Terms](https://modrinth.com/legal/terms), [privacy](https://modrinth.com/legal/privacy), [modpack permissions](https://support.modrinth.com/en/articles/8797527-obtaining-modpack-permissions); each project's own license governs its files |
| BMCLAPI by bangbang93 | Optional Minecraft/loader/download mirrors | [Service documentation and conditions](https://bmclapidoc.bangbang93.com/); mirrored files retain their upstream owners and licenses |
| GitHub, GitHub Releases and codeload | Project templates and official component downloads | [Terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service), [privacy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement); repository content retains its own license |
| Eclipse Adoptium | Temurin JDK metadata and downloads | [API documentation](https://github.com/adoptium/api.adoptium.net), [Temurin licensing FAQ](https://adoptium.net/docs/faq) |
| Fabric, Quilt, Forge and NeoForge | Loader metadata, Maven artifacts, installers and development templates | [Fabric](https://github.com/FabricMC), [Quilt](https://github.com/QuiltMC), [Forge](https://github.com/MinecraftForge/MinecraftForge), [NeoForge](https://github.com/neoforged/NeoForge); retain the selected artifact's license and notices |
| PaperMC / PurpurMC | Paper, Folia, Velocity and Purpur server catalogs and downloads | [PaperMC downloads API](https://docs.papermc.io/misc/downloads-service/), [Purpur API](https://purpurmc.org/docs/purpur/downloads/); server distributions include upstream components under their own terms |
| User-selected Yggdrasil providers | External-account credentials, profile selection and token validation/refresh | The selected provider's terms and privacy policy apply. Workbench has no universal trust list and does not certify providers. Check the final API address before entering credentials |
| Terracotta / EasyTier nodes | Optional peer discovery, room networking and relays | [Terracotta documentation](https://burningtnt.github.io/Terracotta/), [source and integration exception](https://github.com/burningtnt/Terracotta#许可), [EasyTier](https://github.com/EasyTier/EasyTier). Node operators may have additional service policies |
| Gradle and template-defined Maven repositories | Gradle distributions, plugins and development dependencies | [Gradle license](https://github.com/gradle/gradle/blob/master/LICENSE); repositories and downloaded dependencies retain their own terms and licenses |
| Custom mirrors, proxies and servers | User-configured network routes and multiplayer endpoints | The operator's policies apply. Proxy credentials entered through the dedicated command use SecretStorage; credentials embedded in a settings URL are part of that settings value |

## Separately downloaded software

These binaries are obtained at runtime and are not included in the VSIX. Modified or redistributed copies may have additional obligations; keep the downloaded release's license files, attribution and source links.

| Component | Upstream license information |
| --- | --- |
| Eclipse Temurin | [GPL-2.0 with the Classpath Exception](https://adoptium.net/docs/faq), plus notices in each JDK |
| Fabric Loader / Quilt Loader | [Fabric Apache-2.0](https://github.com/FabricMC/fabric-loader/blob/master/LICENSE), [Quilt Apache-2.0](https://github.com/QuiltMC/quilt-loader/blob/develop/LICENSE) |
| Forge / NeoForge | [Forge license](https://github.com/MinecraftForge/MinecraftForge/blob/26.3/LICENSE.txt), [NeoForge LGPL-2.1 license](https://github.com/neoforged/NeoForge/blob/1.21.x/LICENSE.txt); consult the selected version for component-specific notices |
| Paper / Folia / Velocity | [Paper GPL-3.0 and contributor notices](https://github.com/PaperMC/Paper/blob/main/LICENSE.md), [Folia patch licensing](https://github.com/PaperMC/Folia#license), [Velocity GPL-3.0](https://github.com/PaperMC/Velocity/blob/dev/3.0.0/LICENSE) |
| Purpur | [Purpur MIT patches](https://github.com/PurpurMC/Purpur/blob/ver/1.21.11/LICENSE), alongside inherited Paper/Minecraft notices |
| authlib-injector | [AGPL-3.0-or-later with AUTHLIB-INJECTOR exception](https://github.com/yushijinhun/authlib-injector/blob/develop/COPYING.md) |
| Terracotta / EasyTier | [Terracotta AGPL-3.0-or-later and integration exception](https://github.com/burningtnt/Terracotta#许可), [EasyTier LGPL-3.0](https://github.com/EasyTier/EasyTier/blob/main/LICENSE); use the notices accompanying the packaged upstream version |
| Gradle / project templates | [Gradle Apache-2.0](https://github.com/gradle/gradle/blob/master/LICENSE); each template's LICENSE/COPYING/NOTICE files and generated project settings apply separately |
| Mods, plugins, packs and custom JARs | Each author's license applies. Catalog availability or an unknown/missing license does not grant redistribution permission |

## Data and execution

Relevant services receive network requests, including the requested paths and ordinary connection information such as IP addresses. Modrinth receives search/filter queries; Microsoft handles its device sign-in; an external authentication provider receives the username/password submitted to it and issues the tokens. Authentication discovery and credential requests bypass download mirrors; configured proxies still apply. Removing a Workbench account deletes local credentials and does not revoke access at its provider.

Mods, plugins, JAR installers and Gradle projects can execute code with local process permissions. Checksums verify consistency with published metadata; they do not establish that an author or program is trustworthy. Review sources and preserve backups. Content redistribution permissions must be checked before sharing exported local files. Terracotta's separate Beta notice covers peer/relay networking; MCP results may be processed by the connected AI client under that client's policies.

## 简体中文

在线服务适用服务商的使用条款、隐私政策；服务端或客户端源码的开源许可是另一回事。上表列明了本扩展实际使用的服务、用途和官方链接。插件的 MIT 许可不覆盖 Minecraft、模组、插件、整合包、模板、JDK 和服务端软件。各版本随附的许可、版权声明及依赖例外条款优先于本索引；再分发前需核对授权、保留声明及适用的源码提供要求。

- **运行依赖**：完整许可随附在 `THIRD_PARTY_LICENSES.txt`，由安装的依赖自动生成。
- **单独下载的组件**：Temurin、Loader、服务端、authlib-injector、陶瓦及 Gradle 不内置于 VSIX；对应许可证和来源见上表。Purpur 的 MIT 补丁许可不替代其继承组件的许可。
- **Microsoft/Mojang、Modrinth、GitHub**：分别提供登录、游戏资源、内容目录、模板与下载服务，适用各自条款和隐私政策。Modrinth 上的各个项目仍适用作者自己的许可。
- **BMCLAPI**：由 bangbang93 提供的可选镜像服务，遵守其使用条件；镜像内容的版权及许可仍归上游。
- **外置认证服务**：用户名、密码发送至用户确认的服务商，由服务商签发令牌。请使用独立密码，核对识别后的完整 API 地址；HTTPS 不代表服务商可信。账户移除只删除本地凭据，撤销访问需到服务商处理。
- **镜像、代理和自定义服务器**：运营者可能获得请求路径、连接地址等信息。认证地址识别与凭据请求绕过下载镜像，但仍使用已配置的代理。通过专用命令设置的代理凭据存入 SecretStorage；写在设置 URL 中的凭据仍属于该设置值。
- **执行与分发**：模组、插件、安装器、Gradle 可执行本地代码；哈希校验不等于安全审计。分享导出的本地内容前需核对再分发权限，并保留独立备份。
- **陶瓦与 MCP**：联机涉及的节点、参与者和数据已在独立 Beta 须知中说明；AI 客户端可能按自身政策处理 MCP 返回的路径、元数据和日志。
