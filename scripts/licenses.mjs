import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const args = ['ls', '--omit=dev', '--all', '--parseable'];
const { stdout } = await promisify(execFile)(
  process.env.npm_execpath ? process.execPath : 'npm',
  process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args,
);
const blocks = ['Third-party runtime licenses / 第三方运行依赖许可\n'];
for (const folder of [...new Set(stdout.trim().split(/\r?\n/))].filter(
  (p) => p !== process.cwd(),
)) {
  const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  const names = (await readdir(folder)).filter((name) =>
    /^(licen[sc]e|copying|notice)(?:[.\-]|$)/i.test(name),
  );
  blocks.push(
    `\n${'='.repeat(72)}\n${pkg.name} ${pkg.version} (${pkg.license || 'see license'})\n${'='.repeat(72)}\n`,
  );
  if (names.length)
    for (const name of names) blocks.push(await readFile(path.join(folder, name), 'utf8'));
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
