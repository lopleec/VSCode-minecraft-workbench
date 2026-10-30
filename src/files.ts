import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import AdmZip from 'adm-zip';

export function within(root: string, name: string): string {
  if (!name || name.includes('\0') || name.includes('\\') || /^[a-z]:/i.test(name))
    throw new Error('Invalid relative path');
  const target = path.resolve(root, name);
  const relative = path.relative(path.resolve(root), target);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error('Path escapes directory');
  return target;
}
export function filename(name: string): string {
  if (
    !name ||
    path.basename(name) !== name ||
    /[\\/:\x00-\x1f]/.test(name) ||
    name === '.' ||
    name === '..'
  )
    throw new Error('Invalid filename');
  return name;
}
export function suggestedFilename(value: string, fallback = 'instance'): string {
  const cleaned =
    value
      .normalize('NFC')
      .replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '') || fallback;
  let name = '';
  for (const char of cleaned) {
    if (Buffer.byteLength(name + char) > 200) break;
    name += char;
  }
  name = name.replace(/[.\s]+$/, '') || 'instance';
  return /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) ? `_${name}` : name;
}
export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
export async function readJson<T>(target: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && arguments.length >= 2)
      return fallback as T;
    throw error;
  }
}
export async function writeJson(target: string, data: unknown): Promise<void> {
  return writeText(target, JSON.stringify(data, null, 2) + '\n');
}
export async function writeText(target: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { mode: 0o600 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
export async function hashFile(target: string, algorithm = 'sha1'): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest('hex');
}
export async function rejectSymlinkParents(root: string, target: string): Promise<void> {
  let current = path.resolve(root);
  const parts = path.relative(current, path.resolve(target)).split(path.sep);
  for (const part of ['', ...parts]) {
    current = path.join(current, part);
    try {
      if ((await fs.lstat(current)).isSymbolicLink())
        throw new Error('Symbolic links are not allowed in managed paths');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
export async function extractZip(
  archive: string,
  destination: string,
  strip = 0,
  prefix?: string,
): Promise<void> {
  const zip = new AdmZip(archive);
  let size = 0;
  for (const entry of zip.getEntries()) {
    if (prefix && !entry.entryName.startsWith(prefix)) continue;
    const raw = prefix ? entry.entryName.slice(prefix.length) : entry.entryName;
    const name = raw.split('/').slice(strip).join('/');
    if (!name || entry.isDirectory) continue;
    if (((entry.header.attr >>> 16) & 0o170000) === 0o120000)
      throw new Error('Archive contains a symbolic link');
    size += entry.header.size;
    if (size > 4 * 1024 ** 3) throw new Error('Archive exceeds extraction limit');
    const target = within(destination, name);
    await rejectSymlinkParents(destination, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.getData());
    if (path.basename(target) === 'gradlew') await fs.chmod(target, 0o755);
  }
}
export function offlineUuid(name: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${name}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes.toString('hex');
}
export function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(
      /((?:access_token|refresh_token|identityToken|RpsTicket)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
      '$1[redacted]',
    )
    .replace(/(--accessToken\s+)\S+/g, '$1[redacted]')
    .replace(/((?:https?|socks(?:5h?)?):\/\/)[^/\s@?#"'<>]+@/gi, '$1[redacted]@');
}
