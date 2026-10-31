import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import {
  LaunchPrecheck,
  LaunchOption,
  MinecraftFolder,
  ResolvedVersion,
  getPlatform,
} from '@xmcl/core';
import { filename, hashFile, rejectSymlinkParents, within } from './files';
import { t } from './config';

export async function prepareNatives(
  resource: MinecraftFolder,
  version: ResolvedVersion,
  options: LaunchOption,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const root = options.nativeRoot!;
  const platform = options.platform || getPlatform();
  await rejectSymlinkParents(options.gamePath, root);
  await fs.mkdir(root, { recursive: true });
  for (const library of version.libraries.filter((lib) => lib.isNative)) {
    signal.throwIfAborted();
    // AdmZip closes its input before returning; Windows must be able to repair the JAR later.
    const zip = new AdmZip(resource.getLibraryByPath(library.download.path));
    let size = 0;
    for (const entry of zip.getEntries()) {
      signal.throwIfAborted();
      const name = entry.entryName.replaceAll('\\', '/');
      if (
        entry.isDirectory ||
        name.includes('META-INF/') ||
        name.endsWith('.sha1') ||
        name.endsWith('.git') ||
        (library.extractExclude || []).some((prefix) => name.startsWith(prefix))
      )
        continue;
      if (name.includes('/')) {
        const [os, arch] = name.split('/');
        if (os !== platform.name || (arch === 'ia32' ? 'x86' : arch) !== platform.arch) continue;
      }
      size += entry.header.size;
      if (entry.header.size > 64 * 1024 ** 2 || size > 256 * 1024 ** 2)
        throw new Error(
          t('Native library exceeds extraction size limit.', '本地库超过解压大小限制。'),
        );
      const target = path.join(root, filename(path.posix.basename(name)));
      await rejectSymlinkParents(options.gamePath, target);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, entry.getData(), { signal });
        signal.throwIfAborted();
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
  }
}

export async function prepareLegacyAssets(
  resource: MinecraftFolder,
  version: ResolvedVersion,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (version.assets !== 'legacy' && !version.assets.startsWith('pre-')) return;
  const index = JSON.parse(
    await fs.readFile(resource.getAssetsIndex(version.assets), { encoding: 'utf8', signal }),
  );
  const root = resource.getPath('assets', 'virtual', filename(version.assets));
  for (const [name, value] of Object.entries(index.objects) as [string, { hash: string }][]) {
    signal.throwIfAborted();
    if (!/^[a-f0-9]{40}$/.test(value.hash)) throw new Error('Invalid asset hash.');
    const target = within(root, name);
    await rejectSymlinkParents(resource.root, target);
    if (
      (await hashFile(target, 'sha1', signal).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return undefined;
      })) === value.hash
    )
      continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs
        .link(resource.getAsset(value.hash), temporary)
        .catch(async (error: NodeJS.ErrnoException) => {
          if (!['EXDEV', 'EPERM', 'ENOTSUP'].includes(error.code!)) throw error;
          await fs.copyFile(resource.getAsset(value.hash), temporary);
        });
      signal.throwIfAborted();
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}

export function launchPrecheck(
  signal: AbortSignal,
  report: (phase: string) => void,
): LaunchPrecheck {
  return async (resource, version, options) => {
    signal.throwIfAborted();
    report(t('Checking game files', '校验游戏文件'));
    const files = version.libraries.map((library) => ({
      path: resource.getLibraryByPath(library.download.path),
      sha1: library.download.sha1,
    }));
    if (version.downloads.client?.sha1)
      files.unshift({
        path: resource.getVersionJar(version.minecraftVersion),
        sha1: version.downloads.client.sha1,
      });
    for (const file of files) {
      signal.throwIfAborted();
      const exists = await fs.stat(file.path).then(
        (stat) => stat.isFile(),
        () => false,
      );
      if (
        !exists ||
        (file.sha1 && (await hashFile(file.path, 'sha1', signal)) !== file.sha1.toLowerCase())
      )
        throw new Error(
          t(
            `Missing or corrupt game file: ${file.path}. Use Install / repair.`,
            `游戏文件缺失或损坏：${file.path}。请使用安装 / 修复。`,
          ),
        );
    }
    report(t('Preparing native libraries', '准备本地库'));
    await prepareNatives(resource, version, options, signal);
    signal.throwIfAborted();
    report(t('Preparing assets', '准备资源文件'));
    await prepareLegacyAssets(resource, version, signal);
    signal.throwIfAborted();
    report(t('Starting Java process', '启动 Java 进程'));
  };
}
