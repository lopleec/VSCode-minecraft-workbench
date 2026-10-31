import { context } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const production = process.argv.includes('--production');
const output = { minify: production, sourcemap: !production, sourcesContent: false };
// XMCL 6.3.6 references an unpublished utils entry; unzip 2.2.0 points main at an omitted source file.
const alias = {
  '@xmcl/unzip': path.resolve('node_modules/@xmcl/unzip/dist/index.js'),
  '@xmcl/core/utils': path.resolve('src/compat/xmcl-utils.ts'),
};
const ctx = await context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20.18',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  alias,
  mainFields: ['module', 'main'],
  plugins: [
    {
      name: 'runtime-manifest',
      setup(build) {
        build.onLoad({ filter: /[\\/]package\.json$/ }, async ({ path: file }) => {
          if (file !== path.resolve('package.json')) return;
          // Commands, menus and build metadata belong in the VSIX manifest, not the JS bundle.
          const { name, version, publisher, repository, contributes } = JSON.parse(
            await readFile(file, 'utf8'),
          );
          return {
            contents: JSON.stringify({
              name,
              version,
              publisher,
              repository,
              contributes: { configuration: contributes.configuration },
            }),
            loader: 'json',
          };
        });
      },
    },
  ],
  ...output,
  logLevel: 'info',
});
const browser = await context({
  entryPoints: ['src/webview/app.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/workbench.js',
  ...output,
  logLevel: 'info',
});
if (process.argv.includes('--watch')) {
  await ctx.watch();
  await browser.watch();
} else {
  await ctx.rebuild();
  await browser.rebuild();
  await ctx.dispose();
  await browser.dispose();
}
