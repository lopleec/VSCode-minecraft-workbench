import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Instance } from './models';
import { exists, extractZip, rejectSymlinkParents, suggestedFilename } from './files';
import { reserveNamedDirectory } from './game-paths';

export async function importWorlds(
  instance: Instance,
  source: string,
  signal: AbortSignal,
): Promise<string[]> {
  const staging = path.join(instance.directory, '.workbench', 'world-import', randomUUID());
  const saves = path.join(instance.directory, 'saves');
  await rejectSymlinkParents(instance.directory, staging);
  await rejectSymlinkParents(instance.directory, saves);
  await fs.mkdir(staging, { recursive: true });
  const created: string[] = [];
  try {
    let folder = source;
    if ((await fs.stat(source)).isFile()) {
      if (!/\.zip$/i.test(source)) throw new Error('Select a Java Edition world folder or ZIP.');
      if ((await fs.stat(source)).size > 512 * 1024 ** 2)
        throw new Error('Extract archives larger than 512 MB before importing.');
      folder = path.join(staging, 'archive');
      await extractZip(source, folder, 0, undefined, signal);
    }
    const worlds: string[] = [];
    const find = async (current: string, depth: number) => {
      signal.throwIfAborted();
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error('Worlds cannot contain symbolic links.');
      if (await exists(path.join(current, 'level.dat'))) {
        worlds.push(current);
        return;
      }
      if (depth >= 3) return;
      for (const entry of await fs.readdir(current, { withFileTypes: true }))
        if (entry.isDirectory()) await find(path.join(current, entry.name), depth + 1);
    };
    await find(folder, 0);
    if (!worlds.length) throw new Error('No Java Edition worlds found (level.dat is required).');
    await fs.mkdir(saves, { recursive: true });
    for (const world of worlds) {
      const temporary = path.join(staging, 'world-' + randomUUID());
      await fs.cp(world, temporary, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
        filter: async (file) => {
          signal.throwIfAborted();
          if ((await fs.lstat(file)).isSymbolicLink())
            throw new Error('Worlds cannot contain symbolic links.');
          return path.basename(file) !== 'session.lock';
        },
      });
      signal.throwIfAborted();
      const target = await reserveNamedDirectory(
        saves,
        world === folder && folder === path.join(staging, 'archive')
          ? path.basename(source, '.zip')
          : path.basename(world),
      );
      created.push(target);
      await fs.rmdir(target);
      await fs.rename(temporary, target);
    }
    return created.map((file) => path.basename(file));
  } catch (error) {
    for (const directory of created) await fs.rm(directory, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

export async function exportWorld(
  instance: Instance,
  name: string,
  destination: string,
  signal: AbortSignal,
) {
  const saves = path.join(instance.directory, 'saves');
  if (!name || name === '.' || name === '..' || path.basename(name) !== name || /[\\/]/.test(name))
    throw new Error('Invalid world folder.');
  const source = path.join(saves, name);
  await rejectSymlinkParents(instance.directory, source);
  if (!(await exists(path.join(source, 'level.dat'))))
    throw new Error('No Java Edition worlds found (level.dat is required).');
  const zip = new AdmZip();
  let size = 0;
  const walk = async (folder: string) => {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      signal.throwIfAborted();
      const file = path.join(folder, entry.name);
      if (path.resolve(file) === path.resolve(destination)) continue;
      if (entry.isSymbolicLink()) throw new Error('Worlds cannot contain symbolic links.');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name !== 'session.lock') {
        size += (await fs.stat(file)).size;
        if (size > 512 * 1024 ** 2)
          throw new Error('World exceeds 512 MB. Copy its folder instead of exporting a ZIP.');
        zip.addFile(
          `${suggestedFilename(name)}/${path.relative(source, file).replaceAll(path.sep, '/')}`,
          await fs.readFile(file),
        );
      }
    }
  };
  await walk(source);
  signal.throwIfAborted();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    zip.writeZip(temporary);
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
