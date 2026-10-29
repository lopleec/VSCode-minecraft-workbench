import { ServerProfile, ContentTarget } from './models';
import { memorySettings } from './memory';
import { filename } from './files';

export const propertyDefaults: Record<string, string> = {
  'server-ip': '127.0.0.1',
  'server-port': '25565',
  motd: 'Minecraft Server',
  'max-players': '20',
  'online-mode': 'true',
  'white-list': 'false',
  'enforce-whitelist': 'false',
  gamemode: 'survival',
  difficulty: 'normal',
  pvp: 'true',
  'view-distance': '10',
  'simulation-distance': '10',
  'level-name': 'world',
  'level-seed': '',
  'enable-command-block': 'false',
  'spawn-protection': '16',
  'allow-flight': 'false',
};
export function serverTarget(server: ServerProfile): ContentTarget {
  return {
    id: server.id,
    directory: server.directory,
    minecraft: server.minecraft,
    loader: server.engine,
    loaderVersion: server.build,
    side: 'server',
  };
}
export function parseProperties(text: string): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const decode = (value: string) =>
    value.replace(/\\u([a-f\d]{4})|\\(.)/gi, (_m, unicode, escaped) =>
      unicode
        ? String.fromCharCode(parseInt(unicode, 16))
        : ({ n: '\n', r: '\r', t: '\t', f: '\f' } as Record<string, string>)[escaped] || escaped,
    );
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^#!\s=:]+)\s*[=:]\s*(.*)$/.exec(line);
    if (match) result[decode(match[1])] = decode(match[2]);
  }
  return result;
}
export function updateProperties(text: string, values: Record<string, string>): string {
  const encode = (value: string) =>
    value
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const remaining = new Map(Object.entries(values));
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const key = /^\s*([^#!\s=:]+)\s*[=:]/.exec(line)?.[1];
    if (key && Object.hasOwn(values, key)) {
      if (remaining.has(key)) lines.push(`${key}=${encode(remaining.get(key)!)}`);
      remaining.delete(key);
    } else lines.push(line);
  }
  for (const [key, value] of remaining) lines.push(`${key}=${encode(value)}`);
  return lines.join('\n').trimEnd() + '\n';
}
export function validateProperties(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid server properties');
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      !Object.hasOwn(propertyDefaults, key) ||
      typeof value !== 'string' ||
      value.length > 2048 ||
      /[\r\n\0]/.test(value)
    )
      throw new Error(`Invalid server property: ${key}`);
    result[key] = value;
  }
  for (const [key, min, max] of [
    ['server-port', 1, 65535],
    ['max-players', 1, 10000],
    ['view-distance', 2, 32],
    ['simulation-distance', 2, 32],
    ['spawn-protection', 0, 100000],
  ] as const) {
    if (
      key in result &&
      (!/^\d+$/.test(result[key]) || Number(result[key]) < min || Number(result[key]) > max)
    )
      throw new Error(`Invalid ${key}`);
  }
  for (const key of [
    'online-mode',
    'white-list',
    'enforce-whitelist',
    'pvp',
    'enable-command-block',
    'allow-flight',
  ])
    if (key in result && !['true', 'false'].includes(result[key]))
      throw new Error(`Invalid ${key}`);
  if (result['level-name']) {
    filename(result['level-name']);
    if (
      result['level-name'].startsWith('.') ||
      ['libraries', 'mods', 'plugins', 'logs', 'config'].includes(result['level-name'])
    )
      throw new Error('Reserved world folder');
  }
  if (
    result['gamemode'] &&
    !['survival', 'creative', 'adventure', 'spectator'].includes(result['gamemode'])
  )
    throw new Error('Invalid gamemode');
  if (
    result['difficulty'] &&
    !['peaceful', 'easy', 'normal', 'hard'].includes(result['difficulty'])
  )
    throw new Error('Invalid difficulty');
  return result;
}
export function serverJvm(server: ServerProfile): string[] {
  const memory = memorySettings(server);
  if (memory.minMemory > memory.maxMemory) throw new Error('Minimum memory exceeds maximum memory');
  return [`-Xms${memory.minMemory}M`, `-Xmx${memory.maxMemory}M`, ...(server.jvmArgs || [])];
}
export function validateServerRuntime(raw: Record<string, unknown>): Partial<ServerProfile> {
  const result: Partial<ServerProfile> = {};
  if (
    typeof raw.name !== 'string' ||
    !raw.name.trim() ||
    raw.name.length > 100 ||
    /[\r\n\0]/.test(raw.name)
  )
    throw new Error('Invalid server name');
  result.name = raw.name.trim();
  if (raw.java !== undefined && (typeof raw.java !== 'string' || raw.java.includes('\0')))
    throw new Error('Invalid Java path');
  if (Object.hasOwn(raw, 'java')) result.java = String(raw.java || '').trim() || undefined;
  for (const key of ['minMemory', 'maxMemory'] as const) {
    const value = raw[key];
    if (
      value !== undefined &&
      value !== 0 &&
      (!Number.isInteger(value) || Number(value) < 128 || Number(value) > 1048576)
    )
      throw new Error(`Invalid ${key}`);
    if (Object.hasOwn(raw, key)) result[key] = Number(value) || undefined;
  }
  if (
    raw.javaMajor !== undefined &&
    raw.javaMajor !== 0 &&
    (!Number.isInteger(raw.javaMajor) || Number(raw.javaMajor) < 8 || Number(raw.javaMajor) > 99)
  )
    throw new Error('Invalid Java version');
  if (Object.hasOwn(raw, 'javaMajor')) result.javaMajor = Number(raw.javaMajor) || undefined;
  if (
    raw.jvmArgs !== undefined &&
    (!Array.isArray(raw.jvmArgs) ||
      raw.jvmArgs.length > 100 ||
      raw.jvmArgs.some((v) => typeof v !== 'string' || !v.startsWith('-') || /[\r\n\0]/.test(v)))
  )
    throw new Error('Invalid JVM arguments');
  if (Object.hasOwn(raw, 'jvmArgs')) result.jvmArgs = raw.jvmArgs as string[] | undefined;
  return result;
}
