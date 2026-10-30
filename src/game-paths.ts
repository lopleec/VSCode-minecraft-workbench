import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { config } from './config';
import { Instance } from './models';
import { suggestedFilename, writeJson, writeText } from './files';

export function defaultMinecraftDirectory(
  platform = process.platform,
  home = os.homedir(),
  appData = process.env.APPDATA,
): string {
  if (platform === 'win32')
    return path.win32.join(appData || path.win32.join(home, 'AppData', 'Roaming'), '.minecraft');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'minecraft');
  return path.join(home, '.minecraft');
}
export function minecraftDirectory(): string {
  const configured = config('gameDirectory', '').trim();
  const root = configured || defaultMinecraftDirectory();
  if (!path.isAbsolute(root) || root.includes('\0'))
    throw new Error('Choose an absolute Minecraft directory.');
  return path.normalize(root);
}
export function runtimeDirectory(instance: Instance): string {
  return instance.runtimeDirectory || path.join(instance.directory, '.runtime');
}
export function instancesDirectory(root = minecraftDirectory()): string {
  const parent = config('instanceDirectory', '') || path.join(root, 'instances');
  if (!path.isAbsolute(parent) || parent.includes('\0'))
    throw new Error('Choose an absolute instances directory.');
  return parent;
}
export async function reserveInstanceLocation(
  root: string,
  name: string,
  parent?: string,
): Promise<Pick<Instance, 'directory' | 'runtimeDirectory' | 'containerDirectory' | 'layout'>> {
  if (!path.isAbsolute(root) || root.includes('\0'))
    throw new Error('Choose an absolute Minecraft directory.');
  const folder = parent || instancesDirectory(root);
  if (!path.isAbsolute(folder) || folder.includes('\0'))
    throw new Error('Choose an absolute instances directory.');
  await fs.mkdir(folder, { recursive: true });
  const containerDirectory = await reserveNamedDirectory(folder, name);
  const directory = path.join(containerDirectory, '.minecraft');
  try {
    await fs.mkdir(directory);
  } catch (error) {
    await fs.rmdir(containerDirectory).catch(() => {});
    throw error;
  }
  return { directory, containerDirectory, runtimeDirectory: root, layout: 'multimc' };
}
export async function writeInstanceMetadata(instance: Instance): Promise<void> {
  if (instance.linked || instance.layout !== 'multimc' || !instance.containerDirectory) return;
  const components = [{ uid: 'net.minecraft', version: instance.minecraft, important: true }];
  const uid = {
    vanilla: '',
    fabric: 'net.fabricmc.fabric-loader',
    quilt: 'org.quiltmc.quilt-loader',
    forge: 'net.minecraftforge',
    neoforge: 'net.neoforged',
  }[instance.loader];
  if (uid && instance.loaderVersion)
    components.push({ uid, version: instance.loaderVersion, important: true });
  await writeJson(path.join(instance.containerDirectory, 'mmc-pack.json'), {
    formatVersion: 1,
    components,
  });
  await writeText(
    path.join(instance.containerDirectory, 'instance.cfg'),
    `[General]\nInstanceType=OneSix\nname=${iniValue(instance.name)}\nOverrideJavaLocation=${!!instance.java}\n${instance.java ? `JavaPath=${iniValue(instance.java)}\n` : ''}OverrideMemory=${instance.minMemory !== undefined || instance.maxMemory !== undefined}\n${instance.minMemory !== undefined ? `MinMemAlloc=${instance.minMemory}\n` : ''}${instance.maxMemory !== undefined ? `MaxMemAlloc=${instance.maxMemory}\n` : ''}`,
  );
}
function iniValue(value: string): string {
  const escaped = value.startsWith('@') ? '@' + value : value;
  return /[\\";,=]|^\s|\s$/.test(escaped) ? JSON.stringify(escaped) : escaped;
}
export async function reserveNamedDirectory(parent: string, name: string): Promise<string> {
  const stem = suggestedFilename(name);
  for (let n = 1; n <= 10000; n++) {
    const target = path.join(parent, n === 1 ? stem : `${stem} (${n})`);
    try {
      await fs.mkdir(target);
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many instances with the same name.');
}
