import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bundledDependencies } from './bundled-dependencies.mjs';
const blocks = ['Third-party runtime licenses / 第三方运行依赖许可\n'];
for (const pkg of await bundledDependencies()) {
  const names = (await readdir(pkg.directory))
    .sort()
    .filter((name) => /^(licen[sc]e|copying|notice)(?:[.\-]|$)/i.test(name));
  blocks.push(
    `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version} (${pkg.license || 'see license'})\n${'='.repeat(72)}\n`,
  );
  if (names.length)
    for (const name of names) blocks.push(await readFile(path.join(pkg.directory, name), 'utf8'));
  else if (pkg.name.startsWith('@xmcl/'))
    blocks.push(await readFile('node_modules/@xmcl/core/LICENSE', 'utf8'));
  else if (pkg.name === 'boolbase') blocks.push(await readFile('licenses/boolbase.txt', 'utf8'));
  else throw new Error(`Missing license file: ${pkg.name}`);
}
await writeFile(
  'THIRD_PARTY_LICENSES.txt',
  blocks
    .join('\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, ''),
);
