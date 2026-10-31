import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Instance } from './models';
import { Network } from './network';
import { exists, hashFile, readJson, rejectSymlinkParents, within, writeJson } from './files';
import { t } from './config';

export interface PackFile {
  path: string;
  hash: string;
  algorithm: 'sha1' | 'md5';
  size: number;
  source: 'modrinth' | 'curseforge' | 'local';
  urls: string[];
  projectId?: number;
  fileId?: number;
  website?: string;
  localFile?: string;
  archive?: string;
  entry?: string;
  disabled?: boolean;
}
const index = (instance: Pick<Instance, 'directory'>) =>
  path.join(instance.directory, '.workbench', 'pack-files.json');
export function managedPackPath(relative: string) {
  return (
    /^(mods|coremods|resourcepacks|texturepacks|shaderpacks)\//.test(relative) &&
    /\.(jar|zip)(\.disabled)?$/i.test(relative) &&
    !relative.split('/').some((part) => part.startsWith('.'))
  );
}
export async function savePackFiles(instance: Pick<Instance, 'directory'>, files: PackFile[]) {
  await rejectSymlinkParents(instance.directory, index(instance));
  await writeJson(
    index(instance),
    files
      .filter((file) => managedPackPath(file.path))
      .map((file) => ({
        ...file,
        path: file.path.replace(/\.disabled$/, ''),
        disabled: file.path.endsWith('.disabled') || file.disabled === true,
      })),
  );
}
export async function trackPackFiles(
  instance: Pick<Instance, 'directory'>,
  removed: string[],
  added: PackFile[],
) {
  const paths = new Set(
    [...removed, ...added.map((file) => file.path)].map((name) => name.replace(/\.disabled$/, '')),
  );
  const current = await readJson<PackFile[]>(index(instance), []);
  await savePackFiles(instance, [
    ...current.filter((file) => !paths.has(file.path.replace(/\.disabled$/, ''))),
    ...added,
  ]);
}
export async function forgetPackFiles(instance: Pick<Instance, 'directory'>, paths: string[]) {
  if (!(await exists(index(instance)))) return;
  const removed = new Set(paths.map((name) => name.replace(/\.disabled$/, '')));
  await savePackFiles(
    instance,
    (await readJson<PackFile[]>(index(instance), [])).filter(
      (file) => !removed.has(file.path.replace(/\.disabled$/, '')),
    ),
  );
}
export async function setPackFileEnabled(
  instance: Pick<Instance, 'directory'>,
  relative: string,
  enabled: boolean,
) {
  if (!(await exists(index(instance)))) return;
  const normalized = relative.replace(/\.disabled$/, '');
  const files = await readJson<PackFile[]>(index(instance), []);
  for (const file of files)
    if (file.path.replace(/\.disabled$/, '') === normalized) file.disabled = !enabled;
  await savePackFiles(instance, files);
}
export async function packDestination(instance: Pick<Instance, 'directory'>, file: PackFile) {
  if (!managedPackPath(file.path)) throw new Error('Invalid managed modpack path.');
  const target = within(instance.directory, file.path);
  const destination =
    !(await exists(target)) && ((await exists(target + '.disabled')) || file.disabled)
      ? target + '.disabled'
      : target;
  await rejectSymlinkParents(instance.directory, destination);
  return destination;
}
export async function validPackFile(file: string, record: PackFile, signal: AbortSignal) {
  signal.throwIfAborted();
  if (
    !['sha1', 'md5'].includes(record.algorithm) ||
    !new RegExp(record.algorithm === 'sha1' ? '^[a-f0-9]{40}$' : '^[a-f0-9]{32}$', 'i').test(
      record.hash,
    )
  )
    throw new Error('Invalid modpack checksum.');
  return (
    (await exists(file)) &&
    (await fs.stat(file)).size === record.size &&
    (await hashFile(file, record.algorithm, signal)) === record.hash.toLowerCase()
  );
}
export async function copyPackFile(
  source: string,
  destination: string,
  record: PackFile,
  signal: AbortSignal,
) {
  if (!(await validPackFile(source, record, signal)))
    throw new Error(
      t(`The local file does not match ${record.path}.`, `本地文件与 ${record.path} 不匹配。`),
    );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.copyFile(source, temporary, fs.constants.COPYFILE_FICLONE);
    signal.throwIfAborted();
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export async function repairPackFiles(
  instance: Instance,
  net: Network,
  signal: AbortSignal,
  report: (text: string) => void,
  curseforge?: (files: PackFile[]) => Promise<void>,
) {
  await rejectSymlinkParents(instance.directory, index(instance));
  const files = await readJson<PackFile[]>(index(instance), []);
  const pending: PackFile[] = [];
  for (const file of files) {
    const target = await packDestination(instance, file);
    if (await validPackFile(target, file, signal)) continue;
    report(t(`Repair pack file: ${file.path}`, `修复整合包文件：${file.path}`));
    if (file.source === 'curseforge') {
      pending.push(file);
      continue;
    }
    if (file.localFile && (await exists(file.localFile))) {
      await copyPackFile(file.localFile, target, file, signal);
      continue;
    }
    if (file.archive && file.entry && (await exists(file.archive))) {
      const entry = new AdmZip(file.archive).getEntry(file.entry);
      if (entry && entry.header.size === file.size) {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, entry.getData(), { signal });
          if (await validPackFile(temporary, file, signal)) {
            await fs.rename(temporary, target);
            continue;
          }
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
    }
    let repaired = false;
    let failure: unknown;
    for (const url of file.urls) {
      if (new URL(url).protocol !== 'https:') throw new Error('Modpack URLs must use HTTPS.');
      try {
        await net.download(url, target, {
          signal,
          hash: file.hash,
          algorithm: file.algorithm,
          size: file.size,
        });
        repaired = true;
        break;
      } catch (error) {
        if (signal.aborted) throw error;
        failure = error;
      }
    }
    if (!repaired)
      throw (
        failure ||
        new Error(
          t(
            `Restore the original file or re-import the modpack: ${file.path}`,
            `请恢复原文件或重新导入整合包：${file.path}`,
          ),
        )
      );
  }
  if (pending.length) {
    if (!curseforge) throw new Error('CurseForge files need manual restoration.');
    await curseforge(pending);
  }
}
