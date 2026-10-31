import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { filename, rejectSymlinkParents, writeText } from './files';
import { t } from './config';

export class UnavailableProfile extends Error {
  constructor(readonly id: string) {
    super(
      t(
        `Cannot recover custom version profile ${id}. Restore it from its original launcher or backup.`,
        `无法恢复自定义版本配置 ${id}，请从原启动器或备份恢复。`,
      ),
    );
  }
}
export async function backupVersionProfile(root: string, id: string) {
  const file = path.join(root, 'versions', filename(id), id + '.json');
  await rejectSymlinkParents(root, file);
  const bytes = await fs.readFile(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!bytes) return;
  const hash = createHash('sha256').update(bytes).digest('hex');
  const backup = path.join(root, '.workbench', 'profile-backups', id, hash + '.json');
  await rejectSymlinkParents(root, backup);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs
    .writeFile(backup, bytes, { flag: 'wx', mode: 0o600 })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
}

export async function repairVersionChain(
  root: string,
  version: string,
  signal: AbortSignal,
  recoverOfficial: (id: string) => Promise<boolean>,
) {
  const profiles: { file: string; text: string }[] = [];
  const seen = new Set<string>();
  let id: string | undefined = version;
  while (id) {
    signal.throwIfAborted();
    filename(id);
    if (seen.has(id) || seen.size >= 32)
      throw new Error('Circular or excessively deep version inheritance.');
    seen.add(id);
    const file = path.join(root, 'versions', id, id + '.json');
    await rejectSymlinkParents(root, file);
    const read = async () => {
      if ((await fs.stat(file)).size > 8 * 1024 ** 2)
        throw new Error('Instance metadata exceeds 8 MB.');
      const text = await fs.readFile(file, 'utf8');
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value) || value.id !== id)
        throw new SyntaxError('Invalid version profile.');
      return { value, text };
    };
    let profile;
    try {
      profile = await read();
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error;
      if (!(await recoverOfficial(id))) throw new UnavailableProfile(id);
      profile = await read();
    }
    profiles.push({ file, text: profile.text });
    id = typeof profile.value.inheritsFrom === 'string' ? profile.value.inheritsFrom : undefined;
  }
  return profiles;
}

export async function restoreVersionProfiles(profiles: { file: string; text: string }[]) {
  for (const { file, text } of profiles) {
    if ((await fs.readFile(file, 'utf8').catch(() => undefined)) !== text)
      await writeText(file, text);
  }
}
