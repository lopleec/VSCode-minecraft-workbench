import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MinecraftFolder } from '@xmcl/core';
import { Instance } from './models';
import { filename, hashFile, within } from './files';
import { runtimeDirectory } from './game-paths';
import { resolveGameVersion } from './version-profile';

export async function isRuntimeReady(instance: Instance, signal: AbortSignal) {
  signal.throwIfAborted();
  const root = runtimeDirectory(instance);
  let version;
  try {
    version = await resolveGameVersion(root, instance.versionId || instance.minecraft, signal);
  } catch {
    signal.throwIfAborted();
    return false;
  }
  const folder = new MinecraftFolder(root);
  const valid = async (file: string, expected?: { size?: number; sha1?: string }) => {
    signal.throwIfAborted();
    const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (
      !stat?.isFile() ||
      (stat.size === 0 && expected?.size !== 0) ||
      (expected?.size !== undefined && expected.size >= 0 && stat.size !== expected.size)
    )
      return false;
    return (
      !expected?.sha1 || (await hashFile(file, 'sha1', signal)) === expected.sha1.toLowerCase()
    );
  };
  if (!(await valid(folder.getVersionJar(version.minecraftVersion), version.downloads.client)))
    return false;
  for (const library of version.libraries)
    if (
      !(await valid(within(path.join(root, 'libraries'), library.download.path), library.download))
    )
      return false;
  const logging = version.logging?.client?.file;
  if (
    logging &&
    !(await valid(folder.getPath('assets', 'log_configs', filename(logging.id)), logging))
  )
    return false;
  const assetId = version.assetIndex?.id || version.assets;
  if (assetId) {
    const file = folder.getAssetsIndex(filename(assetId));
    if (!(await valid(file, version.assetIndex))) return false;
    if ((await fs.stat(file)).size > 32 * 1024 ** 2) return false;
    let index;
    try {
      index = JSON.parse(await fs.readFile(file, { encoding: 'utf8', signal }));
    } catch (error) {
      if (error instanceof SyntaxError) return false;
      throw error;
    }
    if (
      !index ||
      !index.objects ||
      typeof index.objects !== 'object' ||
      Array.isArray(index.objects)
    )
      return false;
    const objects = Object.values(index.objects) as { hash: string; size: number }[];
    for (let i = 0; i < objects.length; i += 16) {
      const checks = await Promise.all(
        objects
          .slice(i, i + 16)
          .map((asset) =>
            asset &&
            typeof asset === 'object' &&
            /^[a-f0-9]{40}$/.test(asset.hash) &&
            Number.isSafeInteger(asset.size) &&
            asset.size >= 0
              ? valid(folder.getAsset(asset.hash), { size: asset.size })
              : false,
          ),
      );
      if (checks.includes(false)) return false;
    }
  }
  signal.throwIfAborted();
  return true;
}
