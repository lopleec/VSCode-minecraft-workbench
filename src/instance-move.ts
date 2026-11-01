import * as fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Instance } from './models';
import { reserveNamedDirectory, runtimeDirectory } from './game-paths';
import { exists, readJson, rejectSymlinkParents, writeJson } from './files';
import type { PackFile } from './pack-files';
import { t } from './config';

function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return (
    !relative ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  );
}

async function copyDirectory(
  source: string,
  target: string,
  signal: AbortSignal,
  report: (message: string) => void,
  sourceRoot = source,
  targetRoot = target,
) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    signal.throwIfAborted();
    const from = path.join(source, entry.name),
      to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(to);
      await copyDirectory(from, to, signal, report, sourceRoot, targetRoot);
    } else if (entry.isSymbolicLink()) {
      const link = await fs.readlink(from);
      const rebased =
        path.isAbsolute(link) && inside(sourceRoot, link)
          ? path.join(targetRoot, path.relative(sourceRoot, link))
          : link;
      await fs.symlink(
        rebased,
        to,
        process.platform === 'win32' && (await fs.stat(from)).isDirectory()
          ? 'junction'
          : undefined,
      );
    } else if (entry.isFile()) {
      report(entry.name);
      const stat = await fs.stat(from);
      await pipeline(
        createReadStream(from),
        createWriteStream(to, { flags: 'wx', mode: stat.mode }),
        { signal },
      );
      await fs.utimes(to, stat.atime, stat.mtime);
    } else
      throw new Error(
        t('Unsupported file in instance directory.', '实例目录包含不支持的文件类型。'),
      );
  }
}

export async function moveInstance(
  instance: Instance,
  parent: string,
  persist: () => Promise<void>,
  signal: AbortSignal,
  report: (message: string) => void,
  instances: Instance[] = [],
) {
  if (instance.linked)
    throw new Error(
      t(
        'Duplicate this linked instance before moving its files.',
        '请先复制原地管理的实例，再移动文件。',
      ),
    );
  const source = path.resolve(instance.containerDirectory || instance.directory);
  if (
    instances.some(
      (other) =>
        other.id !== instance.id &&
        [other.directory, runtimeDirectory(other), ...(other.resourceDirectories || [])].some(
          (file) => inside(source, path.resolve(file)),
        ),
    )
  )
    throw new Error(
      t(
        'Other instances use files inside this directory. Duplicate this instance before moving it.',
        '其他实例正在复用此目录内的文件，请先复制此实例再移动。',
      ),
    );
  const realSource = await fs.realpath(source),
    realParent = await fs.realpath(parent);
  if (realParent === path.dirname(realSource)) return false;
  if (inside(realSource, realParent))
    throw new Error(t('Cannot move an instance inside itself.', '不能将实例移入自身目录。'));
  if (!inside(source, path.resolve(instance.directory)))
    throw new Error('Invalid instance directory.');
  await rejectSymlinkParents(source, instance.directory);
  const previous = structuredClone(instance);
  const index = path.join(instance.directory, '.workbench', 'pack-files.json');
  await rejectSymlinkParents(instance.directory, index);
  const originalFiles = (await exists(index)) ? await readJson<PackFile[]>(index) : undefined;
  const target = await reserveNamedDirectory(realParent, instance.name);
  const rebase = (file: string) =>
    path.isAbsolute(file) && inside(source, file)
      ? path.join(target, path.relative(source, file))
      : file;
  let renamed = false,
    copied = false;
  const next: Instance = {
    ...instance,
    directory: rebase(instance.directory),
    ...(instance.containerDirectory
      ? { containerDirectory: rebase(instance.containerDirectory) }
      : {}),
    ...(instance.runtimeDirectory ? { runtimeDirectory: rebase(instance.runtimeDirectory) } : {}),
    ...(instance.java ? { java: rebase(instance.java) } : {}),
    ...(instance.resourceDirectories
      ? { resourceDirectories: instance.resourceDirectories.map(rebase) }
      : {}),
  };
  const newIndex = path.join(next.directory, '.workbench', 'pack-files.json');
  try {
    signal.throwIfAborted();
    await fs.rmdir(target);
    try {
      await fs.rename(source, target);
      renamed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await fs.mkdir(target);
      copied = true;
      await copyDirectory(source, target, signal, report);
    }
    signal.throwIfAborted();
    if (originalFiles) {
      await rejectSymlinkParents(next.directory, newIndex);
      await writeJson(
        newIndex,
        originalFiles.map((file) => ({
          ...file,
          ...(file.localFile ? { localFile: rebase(file.localFile) } : {}),
          ...(file.archive ? { archive: rebase(file.archive) } : {}),
        })),
      );
    }
    Object.assign(instance, next);
    await persist();
  } catch (error) {
    Object.assign(instance, previous);
    if (renamed) {
      await fs.rename(target, source);
      if (originalFiles) await writeJson(index, originalFiles);
    } else await fs.rm(target, { recursive: true, force: true });
    throw error;
  }
  if (copied) {
    try {
      await fs.rm(source, { recursive: true });
    } catch {
      report(
        t(
          `Instance moved. Remove the remaining source files manually: ${source}`,
          `实例已移动，请手动清理原目录中剩余的文件：${source}`,
        ),
      );
    }
  }
  return true;
}
