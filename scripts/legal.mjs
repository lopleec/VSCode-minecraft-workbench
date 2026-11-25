import { readFile, writeFile } from 'node:fs/promises';
const legal = JSON.parse(await readFile(new URL('../src/legal.json', import.meta.url), 'utf8'));
const lines = ['# Minecraft Workbench — Terms and Notices / 用户协议与声明 / 使用者協議與聲明', ''];
for (const locale of ['en', 'zh', 'zhTw']) {
  lines.push(
    `## ${{ en: 'English', zh: '简体中文', zhTw: '繁體中文' }[locale]}`,
    '',
    `${locale === 'en' ? 'Notice version' : '提示版本'}: ${legal.version}`,
    '',
    legal.disclaimer[locale],
    '',
  );
  for (const section of legal.sections)
    lines.push(
      `### ${section.title[locale]}`,
      '',
      ...section.paragraphs.flatMap((p) => [p[locale], '']),
    );
  lines.push(
    locale === 'en'
      ? 'Minecraft use is governed by the official EULA linked below. The links provide the current official text; this notice does not replace it. The recorded version identifies this extension notice, not a Mojang EULA revision.'
      : locale === 'zhTw'
        ? 'Minecraft 的使用以連結中的官方 EULA 全文為準，本文不取代官方條款。記錄的版本號碼代表本擴充套件提示版本，並非 Mojang EULA 的修訂版本。'
        : 'Minecraft 的使用以链接中的官方 EULA 全文为准，本文不替代官方条款。记录的版本号代表本插件提示版本，并非 Mojang EULA 的修订版本。',
    '',
    `[Minecraft EULA](${legal.links.eula}) · [Microsoft Services Agreement](${legal.links.microsoftServices}) · [Minecraft Usage Guidelines](${legal.links.guidelines}) · [GitHub](${legal.links.repository}) · [MIT License](${legal.links.license}) · [Modpack permissions](${legal.links.modPermissions}) · [Modrinth terms](${legal.links.modrinthTerms}) · [Third-party services / ${locale === 'zhTw' ? '第三方服務' : '第三方服务'}](${legal.links.thirdParty})`,
    '',
  );
}
const target = new URL('../TERMS.md', import.meta.url),
  text = lines.join('\n');
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')) !== text)
    throw new Error('Run npm run legal to update TERMS.md');
} else await writeFile(target, text);
