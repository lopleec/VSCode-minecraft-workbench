import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ServerProfile } from './models';
import { noLinks } from './backups';
import { exists, filename, readJson, rejectSymlinkParents, within, writeJson } from './files';

export class ServerBackups {
  directory(server: ServerProfile) {
    return path.join(server.directory, '.workbench', 'server-backups');
  }
  async list(server: ServerProfile) {
    return (await fs.readdir(this.directory(server), { withFileTypes: true }).catch(() => []))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort()
      .reverse();
  }
  async create(server: ServerProfile, level: string) {
    filename(level);
    if (level.startsWith('.') || ['libraries', 'mods', 'plugins', 'logs', 'config'].includes(level))
      throw new Error('Reserved world folder');
    const worlds = [];
    for (const name of [level, level + '_nether', level + '_the_end']) {
      const folder = within(server.directory, name);
      if (await exists(folder)) {
        await noLinks(folder);
        worlds.push(name);
      }
    }
    if (!worlds.length) throw new Error('No server worlds found');
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
    const stage = path.join(this.directory(server), '.' + id);
    await rejectSymlinkParents(server.directory, stage);
    try {
      await fs.mkdir(stage, { recursive: true });
      for (const name of worlds)
        await fs.cp(within(server.directory, name), within(stage, name), { recursive: true });
      await writeJson(path.join(stage, 'backup.json'), {
        worlds,
        createdAt: new Date().toISOString(),
        minecraft: server.minecraft,
      });
      await fs.rename(stage, path.join(this.directory(server), id));
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
    return id;
  }
  async restore(server: ServerProfile, id: string, level: string) {
    if (!(await this.list(server)).includes(id)) throw new Error('Backup not found');
    const source = path.join(this.directory(server), filename(id));
    await noLinks(source);
    const { worlds } = await readJson<{ worlds: string[] }>(path.join(source, 'backup.json'));
    if (!Array.isArray(worlds) || !worlds.length || worlds.length > 3)
      throw new Error('Invalid server backup');
    for (const world of worlds) {
      filename(world);
      if (
        world.startsWith('.') ||
        ['libraries', 'mods', 'plugins', 'logs', 'config'].includes(world)
      )
        throw new Error('Invalid world folder');
    }
    if (await exists(within(server.directory, filename(level)))) await this.create(server, level);
    const rollback = path.join(server.directory, '.restore-' + randomUUID());
    const moved: string[] = [];
    const applied: string[] = [];
    await rejectSymlinkParents(server.directory, rollback);
    await fs.mkdir(rollback, { recursive: true });
    try {
      for (const name of worlds) {
        const target = within(server.directory, name);
        await rejectSymlinkParents(server.directory, target);
        if (await exists(target)) {
          await fs.rename(target, within(rollback, name));
          moved.push(name);
        }
        applied.push(name);
        await fs.cp(within(source, name), target, { recursive: true });
      }
    } catch (error) {
      for (const name of applied)
        await fs.rm(within(server.directory, name), { recursive: true, force: true });
      for (const name of moved)
        await fs.rename(within(rollback, name), within(server.directory, name));
      throw error;
    } finally {
      await fs.rm(rollback, { recursive: true, force: true });
    }
  }
}
