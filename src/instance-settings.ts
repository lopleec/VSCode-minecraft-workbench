import { Account, Instance } from './models';
import { validGameLanguage } from './game-language';

export type InstanceSettings = Pick<
  Instance,
  | 'name'
  | 'accountId'
  | 'java'
  | 'minMemory'
  | 'maxMemory'
  | 'gc'
  | 'resolution'
  | 'server'
  | 'backupBeforeLaunch'
  | 'jvmArgs'
  | 'gameArgs'
  | 'gameLanguage'
>;
export function validateInstanceSettings(value: unknown, accounts: Account[]): InstanceSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid instance settings');
  const input = value as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 100 || /[\x00-\x1f]/.test(name))
    throw new Error('Invalid instance name');
  const memory = (key: string) => {
    const value = input[key];
    if (value === '' || value === undefined || value === null) return undefined;
    if (!Number.isInteger(value) || Number(value) < 128 || Number(value) > 1048576)
      throw new Error('Invalid memory limit');
    return Number(value);
  };
  const minMemory = memory('minMemory');
  const maxMemory = memory('maxMemory');
  if (minMemory && maxMemory && minMemory > maxMemory)
    throw new Error('Minimum memory exceeds maximum memory.');
  const text = (key: string) => {
    const value = input[key];
    if (value === '' || value === undefined) return undefined;
    if (typeof value !== 'string' || value.includes('\0') || value.length > 4096)
      throw new Error('Invalid instance settings');
    return value.trim();
  };
  const accountId = text('accountId');
  const gameLanguage = text('gameLanguage');
  if (gameLanguage && !validGameLanguage(gameLanguage))
    throw new Error('Invalid Minecraft language.');
  if (accountId && !accounts.some((a) => a.id === accountId)) throw new Error('Account not found');
  const gc = input.gc || undefined;
  if (gc && !['default', 'g1', 'zgc'].includes(String(gc)))
    throw new Error('Invalid garbage collector');
  let resolution: Instance['resolution'];
  if (input.resolution) {
    const r = input.resolution as Record<string, unknown>;
    if (
      ![r.width, r.height].every(
        (n) => Number.isInteger(n) && Number(n) >= 320 && Number(n) <= 16384,
      ) ||
      typeof r.fullscreen !== 'boolean'
    )
      throw new Error('Invalid window resolution');
    resolution = { width: Number(r.width), height: Number(r.height), fullscreen: r.fullscreen };
  }
  const server = text('server');
  if (server && (/[\s/\\?#@]/.test(server) || server.length > 255))
    throw new Error('Invalid server address');
  const args = (key: string) => {
    const value = input[key];
    if (value === undefined) return undefined;
    if (
      !Array.isArray(value) ||
      !value.every((v) => typeof v === 'string' && !v.includes('\0')) ||
      value.length > 200
    )
      throw new Error('Arguments must be an array of strings');
    return value as string[];
  };
  if (input.backupBeforeLaunch !== undefined && typeof input.backupBeforeLaunch !== 'boolean')
    throw new Error('Invalid backup preference');
  return {
    name,
    gameLanguage,
    accountId,
    java: text('java'),
    minMemory,
    maxMemory,
    gc: gc as Instance['gc'],
    resolution,
    server,
    backupBeforeLaunch: input.backupBeforeLaunch as boolean | undefined,
    jvmArgs: args('jvmArgs'),
    gameArgs: args('gameArgs'),
  };
}
