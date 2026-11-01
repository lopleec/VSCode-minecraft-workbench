import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function bundledDependencies() {
  const meta = JSON.parse(await readFile('dist/bundle-meta.json', 'utf8'));
  const folders = new Set();
  for (const output of Object.values(meta.outputs))
    for (const [file, input] of Object.entries(output.inputs)) {
      if (!input.bytesInOutput) continue;
      const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(file);
      if (match) folders.add(match[1]);
    }
  if (!folders.size)
    throw new Error('No bundled dependencies found. Run a production build first.');
  return Promise.all(
    [...folders].sort().map(async (directory) => ({
      ...JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8')),
      directory,
    })),
  );
}
