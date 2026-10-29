import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Instance } from './models';
import { exists, filename, rejectSymlinkParents, writeJson } from './files';

export async function noLinks(root: string): Promise<void> {
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new Error('World backups cannot contain symbolic links');
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('World backups cannot contain symbolic links');
    if (entry.isDirectory()) await noLinks(path.join(root, entry.name));
  }
}
export class Backups {
  directory(instance: Instance) {
    return path.join(instance.directory, '.workbench', 'backups');
  }
  async list(instance: Instance) {
    return (await fs.readdir(this.directory(instance), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
      .reverse();
  }
  async create(instance: Instance) {
    const saves = path.join(instance.directory, 'saves');
    if (!(await exists(saves))) throw new Error('No saves found');
    await noLinks(saves);
    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const target = path.join(this.directory(instance), id);
    const stage = path.join(this.directory(instance), '.' + id);
    await rejectSymlinkParents(instance.directory, stage);
    try {
      await fs.mkdir(stage, { recursive: true });
      await fs.cp(saves, path.join(stage, 'saves'), { recursive: true, errorOnExist: true });
      await writeJson(path.join(stage, 'backup.json'), {
        createdAt: new Date().toISOString(),
        instance: instance.name,
        minecraft: instance.minecraft,
      });
      await fs.rename(stage, target);
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
    return id;
  }
  async prune(instance: Instance, keep: number) {
    if (!Number.isInteger(keep) || keep <= 0) return;
    for (const id of (await this.list(instance)).slice(keep)) {
      const folder = path.join(this.directory(instance), filename(id));
      await rejectSymlinkParents(instance.directory, folder);
      if (await exists(path.join(folder, 'backup.json'))) await fs.rm(folder, { recursive: true });
    }
  }
  async restore(instance: Instance, id: string) {
    const source = path.join(this.directory(instance), filename(id), 'saves');
    await noLinks(source);
    const saves = path.join(instance.directory, 'saves');
    if (await exists(saves)) await this.create(instance);
    const stage = path.join(instance.directory, `.restore-${randomUUID()}`);
    const previous = path.join(instance.directory, `.saves-${randomUUID()}`);
    await rejectSymlinkParents(instance.directory, saves);
    let moved = false;
    try {
      await fs.cp(source, stage, { recursive: true, errorOnExist: true });
      if (await exists(saves)) {
        await fs.rename(saves, previous);
        moved = true;
      }
      try {
        await fs.rename(stage, saves);
      } catch (error) {
        if (moved) await fs.rename(previous, saves);
        throw error;
      }
      await fs.rm(previous, { recursive: true, force: true });
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
}
