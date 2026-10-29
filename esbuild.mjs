import { context } from 'esbuild';
import path from 'node:path';
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
  sourcemap: true,
  logLevel: 'info',
});
const browser = await context({
  entryPoints: ['src/webview/app.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  outfile: 'dist/workbench.js',
  sourcemap: true,
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
