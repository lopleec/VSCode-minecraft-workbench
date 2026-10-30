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
