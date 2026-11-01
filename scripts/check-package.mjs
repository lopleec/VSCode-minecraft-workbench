import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import AdmZip from 'adm-zip';
import { bundledDependencies } from './bundled-dependencies.mjs';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const file = process.argv[2] || `${manifest.name}-${manifest.version}.vsix`;
const bytes = (await stat(file)).size;
const zip = new AdmZip(file);
const entries = zip.getEntries().map((entry) => entry.entryName);
for (const name of [
  'extension/readme.md',
  'extension/README.zh-CN.md',
  'extension/LICENSE.txt',
  'extension/THIRD_PARTY_LICENSES.txt',
  'extension/TERMS.md',
])
  assert.ok(entries.includes(name), `Missing ${name}`);
assert.ok(bytes <= 640 * 1024, `VSIX exceeds 640 KiB: ${bytes} bytes`);
assert.ok(
  !entries.some((name) =>
    /\.map$|bundle-meta\.json$|^extension\/(?:docs\/images|src|test|tests|scripts|fixtures|coverage|output|\.playwright-cli|node_modules)\//.test(
      name,
    ),
  ),
  'Unexpected development or documentation assets',
);
const readme = zip.readAsText('extension/readme.md');
const licenses = zip.readAsText('extension/THIRD_PARTY_LICENSES.txt');
for (const dependency of await bundledDependencies())
  assert.ok(
    licenses.includes(`\n${dependency.name} ${dependency.version} (`),
    `Missing bundled dependency license: ${dependency.name}`,
  );
const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
assert.ok(images.length > 0, 'README screenshots are missing');
assert.ok(
  images.every(([, url]) =>
    url.startsWith('https://github.com/lopleec/VSCode-minecraft-workbench/raw/'),
  ),
  'README screenshots must resolve outside the VSIX',
);
for (const name of ['extension/dist/extension.js', 'extension/dist/workbench.js']) {
  assert.ok(entries.includes(name), `Missing ${name}`);
  assert.ok(
    !zip.readAsText(name).includes('sourceMappingURL='),
    'Production bundle references a missing source map',
  );
  assert.ok(
    !zip.readAsText(name).includes('https://fixture.test/'),
    'Temporary UI fixture leaked into the package',
  );
}
console.log(`${file}: ${(bytes / 1024).toFixed(0)} KiB; package checks passed.`);
