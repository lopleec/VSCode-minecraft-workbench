import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { constants, type CopyOptions } from 'node:fs';
import AdmZip from 'adm-zip';
import { createHash, randomUUID } from 'node:crypto';
import { Instance, Loader } from './models';
import { Store } from './store';
import { exists, filename, readJson, rejectSymlinkParents } from './files';
import { minecraftDirectory, reserveInstanceLocation, writeInstanceMetadata } from './game-paths';
import { InstanceSettings, validateInstanceSettings } from './instance-settings';

type Json = Record<string, any>;
export interface ImportCandidate {
  key: string;
  name: string;
  minecraft: string;
  loader: Loader;
  loaderVersion?: string;
  directory: string;
  runtimeDirectory?: string;
  versionId?: string;
  format: 'standard' | 'multimc' | 'modrinth' | 'workbench';
  resourceDirectories?: string[];
  minMemory?: number;
  maxMemory?: number;
  java?: string;
  warnings: string[];
}
export interface ImportScan {
  candidates: ImportCandidate[];
  warnings: string[];
}

export function parseIni(text: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*([^#;=\[\]][^=]*?)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) {
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.slice(1, -1);
        }
      }
      if (value.startsWith('@@')) value = value.slice(1);
      values[match[1].trim()] = value;
    }
  }
  return values;
}
async function json(file: string): Promise<Json | undefined> {
  if (!(await exists(file))) return;
  if ((await fs.stat(file)).size > 8 * 1024 ** 2)
    throw new Error('Instance metadata exceeds 8 MB.');
  const value = await readJson<Json>(file);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid instance metadata.');
  return value;
}
export async function versionChain(root: string, version: string): Promise<Json[]> {
  const chain: Json[] = [];
  const seen = new Set<string>();
  let id: string | undefined = version;
  while (id) {
    filename(id);
    if (seen.has(id) || seen.size >= 32)
      throw new Error('Circular or excessively deep version inheritance.');
    seen.add(id);
    const profile = await json(path.join(root, 'versions', id, `${id}.json`));
    if (!profile) throw new Error(`Missing version profile: ${id}`);
    if (profile.id !== id) throw new Error(`Version profile ID does not match its folder: ${id}`);
    chain.push(profile);
    id = typeof profile.inheritsFrom === 'string' ? profile.inheritsFrom : undefined;
  }
  return chain;
}
export function loaderInfo(
  libraries: Json[],
  minecraft: string,
): { loader: Loader; loaderVersion?: string } {
  for (const [group, loader] of [
    ['org.quiltmc:quilt-loader:', 'quilt'],
    ['net.fabricmc:fabric-loader:', 'fabric'],
    ['net.neoforged:neoforge:', 'neoforge'],
    ['net.minecraftforge:forge:', 'forge'],
  ] as const) {
    const found = libraries.find((l) => typeof l.name === 'string' && l.name.startsWith(group));
    if (found) {
      const version = found.name.slice(group.length).split(':')[0];
      return {
        loader,
        loaderVersion:
          loader === 'forge'
            ? version.replace(new RegExp(`^${minecraft.replaceAll('.', '\\.')}[-]`), '')
            : version,
      };
    }
  }
  return { loader: 'vanilla' };
}
function gameVersion(chain: Json[]): string {
  for (const profile of chain) {
    for (const field of ['clientVersion', '_minecraftVersion', 'minecraftVersion'])
      if (typeof profile[field] === 'string') return filename(profile[field]);
    const game = profile.patches?.find((p: Json) => p.id === 'game' || p.id === 'net.minecraft');
    if (typeof game?.version === 'string') return filename(game.version);
  }
  return filename(chain[chain.length - 1].id);
}
function candidate(value: Omit<ImportCandidate, 'key'>): ImportCandidate {
  return {
    ...value,
    key: createHash('sha256')
      .update([value.format, value.directory, value.runtimeDirectory, value.versionId].join('\0'))
      .digest('hex'),
  };
}
async function text(file: string): Promise<string> {
  if (!(await exists(file))) return '';
  if ((await fs.stat(file)).size > 1024 ** 2) throw new Error('Instance settings exceed 1 MB.');
  return fs.readFile(file, 'utf8');
}
async function standard(root: string, id: string, override?: Json): Promise<ImportCandidate> {
  const chain = await versionChain(root, id);
  let minecraft = gameVersion(chain);
  const base = chain[chain.length - 1];
  if (
    !chain.some((p) => p.clientVersion || p._minecraftVersion || p.minecraftVersion || p.patches)
  ) {
    const jar = path.join(root, 'versions', filename(base.id), `${filename(base.id)}.jar`);
    const stat = await fs.stat(jar).catch(() => undefined);
    if (stat && stat.size <= 128 * 1024 ** 2) {
      try {
        const entry = new AdmZip(jar).getEntry('version.json');
        if (entry && entry.header.size < 65536) {
          const version = JSON.parse(entry.getData().toString());
          if (typeof version.id === 'string') minecraft = filename(version.id);
        }
      } catch {
        /* Older clients may not have embedded version metadata. */
      }
    }
  }
  const folder = path.join(root, 'versions', filename(id));
  const libraries = chain.flatMap((p) => [
    ...(p.libraries || []),
    ...(p.patches || []).flatMap((v: Json) => v.libraries || []),
  ]);
  const info = loaderInfo(libraries, minecraft);
  const settings = await json(path.join(folder, 'hmclversion.cfg'));
  const pcl = parseIni(await text(path.join(folder, 'PCL', 'Setup.ini')));
  const isolated = await Promise.all(
    ['mods', 'saves', 'options.txt', 'config'].map((p) => exists(path.join(folder, p))),
  );
  let directory = isolated.some(Boolean) ? folder : root;
  if (settings?.gameDirType === 0 || settings?.gameDirType === 'ROOT_FOLDER') directory = root;
  if (settings?.gameDirType === 1 || settings?.gameDirType === 'VERSION_FOLDER') directory = folder;
  if (settings?.gameDirType === 2 || settings?.gameDirType === 'CUSTOM') {
    if (typeof settings.gameDir === 'string' && path.isAbsolute(settings.gameDir))
      directory = settings.gameDir;
  }
  if (pcl.VersionArgumentIndie === '1' || pcl.VersionArgumentIndieV2?.toLowerCase() === 'true')
    directory = folder;
  if (pcl.VersionArgumentIndie === '2' || pcl.VersionArgumentIndieV2?.toLowerCase() === 'false')
    directory = root;
  if (typeof override?.gameDir === 'string') directory = path.resolve(root, override.gameDir);
  directory = await fs.realpath(directory);
  const warnings: string[] = [];
  if (chain.some((p) => Array.isArray(p.patches)))
    warnings.push(
      'This profile uses launcher-specific patches; create a copy to rebuild its loader.',
    );
  return candidate({
    name: override?.name || id,
    minecraft,
    ...info,
    directory,
    runtimeDirectory: root,
    versionId: id,
    format: 'standard',
    warnings,
  });
}
const componentLoaders: Record<string, Loader> = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};
async function multiMC(folder: string): Promise<ImportCandidate | undefined> {
  const pack = await json(path.join(folder, 'mmc-pack.json'));
  if (!pack) return;
  if (!Array.isArray(pack.components)) throw new Error('Invalid MultiMC component list.');
  const game = pack.components.find((c: Json) => c.uid === 'net.minecraft');
  if (typeof game?.version !== 'string')
    throw new Error('MultiMC instance has no Minecraft version.');
  const settings = parseIni(await text(path.join(folder, 'instance.cfg')));
  const mods = pack.components.filter((c: Json) => componentLoaders[c.uid]);
  if (mods.length > 1) throw new Error('Multiple mod loaders are not supported in one instance.');
  const loader = mods[0] ? componentLoaders[mods[0].uid] : 'vanilla';
  const directory = await fs.realpath(
    path.join(folder, (await exists(path.join(folder, '.minecraft'))) ? '.minecraft' : 'minecraft'),
  );
  const warnings = pack.components
    .filter(
      (c: Json) =>
        !['net.minecraft', 'org.lwjgl', 'org.lwjgl3', ...Object.keys(componentLoaders)].includes(
          c.uid,
        ),
    )
    .map((c: Json) => `Unsupported MultiMC component: ${String(c.uid)}`);
  const requestedJava =
    settings.OverrideJavaLocation === 'true' || settings.OverrideJava === 'true'
      ? settings.JavaPath
      : undefined;
  const java =
    requestedJava && path.isAbsolute(requestedJava) && (await exists(requestedJava))
      ? requestedJava
      : undefined;
  if (requestedJava && !java)
    warnings.push(
      'The configured Java path is unavailable; global or automatic Java selection will be used.',
    );
  if ((await fs.readdir(path.join(folder, 'jarmods')).catch(() => [])).length)
    warnings.push('Legacy jar mods require a compatible launcher.');
  const memory = (key: string) =>
    settings.OverrideMemory === 'true' &&
    /^\d+$/.test(settings[key] || '') &&
    Number(settings[key]) >= 128 &&
    Number(settings[key]) <= 1048576
      ? Number(settings[key])
      : undefined;
  return candidate({
    name: settings.name || path.basename(folder),
    minecraft: filename(game.version),
    loader,
    loaderVersion: mods[0]
      ? String(mods[0].version).replace(new RegExp(`^${game.version.replaceAll('.', '\\.')}-`), '')
      : undefined,
    directory,
    format: 'multimc',
    resourceDirectories: [path.dirname(path.dirname(folder)), folder],
    minMemory: memory('MinMemAlloc'),
    maxMemory: memory('MaxMemAlloc'),
    java,
    warnings,
  });
}
async function modrinth(folder: string): Promise<ImportCandidate | undefined> {
  const profile = await json(path.join(folder, 'profile.json'));
  if (!profile) return;
  const meta = profile.metadata || profile;
  const minecraft = meta.game_version || meta.gameVersion;
  if (typeof minecraft !== 'string') return;
  const loader = String(meta.loader || 'vanilla').toLowerCase();
  if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(loader))
    throw new Error('Unsupported Modrinth loader.');
  const version = meta.loader_version;
  return candidate({
    name: meta.name || path.basename(folder),
    minecraft: filename(minecraft),
    loader: loader as Loader,
    loaderVersion: typeof version === 'string' ? version : version?.id || version?.version,
    directory: await fs.realpath(folder),
    format: 'modrinth',
    resourceDirectories: [path.dirname(path.dirname(folder))],
    warnings: [],
  });
}
export async function scanInstances(source: string, signal?: AbortSignal): Promise<ImportScan> {
  if (!path.isAbsolute(source) || source.includes('\0'))
    throw new Error('Choose an absolute instance directory.');
  const root = await fs.realpath(source);
  const result: ImportScan = { candidates: [], warnings: [] };
  const seen = new Set<string>();
  const add = (item: ImportCandidate) => {
    if (!seen.has(item.key)) {
      seen.add(item.key);
      result.candidates.push(item);
    }
  };
  let visited = 0;
  const inspect = async (folder: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    if (++visited > 3000)
      throw new Error('Too many folders; select a narrower instance directory.');
    try {
      const mmc = await multiMC(folder);
      if (mmc) {
        add(mmc);
        return;
      }
      const mr = await modrinth(folder);
      if (mr) {
        add(mr);
        return;
      }
      if (path.basename(path.dirname(folder)) === 'versions') {
        const runtime = path.dirname(path.dirname(folder));
        add(await standard(runtime, path.basename(folder)));
        return;
      }
      if (await exists(path.join(folder, 'versions'))) {
        const official = await json(path.join(folder, 'launcher_profiles.json'));
        const profiles = Object.values(official?.profiles || {}) as Json[];
        for (const entry of await fs.readdir(path.join(folder, 'versions'), {
          withFileTypes: true,
        })) {
          signal?.throwIfAborted();
          if (!entry.isDirectory()) continue;
          const overrides = profiles.filter((p) => p.lastVersionId === entry.name);
          try {
            if (overrides.length)
              for (const profile of overrides) add(await standard(folder, entry.name, profile));
            else add(await standard(folder, entry.name));
          } catch (error) {
            result.warnings.push(`${entry.name}: ${(error as Error).message}`);
          }
        }
        for (const child of ['instances', 'profiles'])
          if (await exists(path.join(folder, child)))
            await inspect(path.join(folder, child), depth + 1);
        return;
      }
      if (depth > 2) return;
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (
          !entry.isDirectory() ||
          [
            'assets',
            'libraries',
            'mods',
            'saves',
            'config',
            'logs',
            'cache',
            '.git',
            'node_modules',
          ].includes(entry.name) ||
          (entry.name.startsWith('.') && entry.name !== '.minecraft')
        )
          continue;
        await inspect(path.join(folder, entry.name), depth + 1);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      result.warnings.push(`${folder}: ${(error as Error).message}`);
    }
  };
  await inspect(root, 0);
  return result;
}

export async function copyGameFiles(
  source: string,
  destination: string,
  signal: AbortSignal,
  options: { worlds?: boolean; keepMetadata?: boolean; skipFile?: string } = {},
): Promise<void> {
  const exclude = new Set([
    'assets',
    'libraries',
    'versions',
    'instances',
    'profiles',
    '.runtime',
    'logs',
    'crash-reports',
    'launcher_accounts.json',
    'launcher_profiles.json',
    'accounts.json',
    'profile.json',
    'instance.cfg',
    'mmc-pack.json',
    'PCL',
    'hmclversion.cfg',
  ]);
  await fs.mkdir(destination, { recursive: true });
  const relative = path.relative(await fs.realpath(source), await fs.realpath(destination));
  if (
    !relative ||
    (relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative) &&
      !exclude.has(relative.split(path.sep)[0]))
  )
    throw new Error('Cannot copy an instance inside itself.');
  const copyOptions: CopyOptions = {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    filter: async (file) => {
      signal.throwIfAborted();
      const relative = path.relative(source, file).split(path.sep);
      if (
        (options.skipFile && path.resolve(file) === path.resolve(options.skipFile)) ||
        exclude.has(relative[0]) ||
        (options.worlds === false && relative[0] === 'saves') ||
        (relative[0] === '.workbench' &&
          (options.keepMetadata === false ||
            (relative.length > 1 && relative[1] !== 'content.json')))
      )
        return false;
      if ((await fs.lstat(file)).isSymbolicLink())
        throw new Error(
          'Symbolic links cannot be copied. Use in-place management for linked folders.',
        );
      return true;
    },
  };
  for (const entry of await fs.readdir(source)) {
    signal.throwIfAborted();
    if (!exclude.has(entry))
      await fs.cp(path.join(source, entry), path.join(destination, entry), copyOptions);
  }
}
export class InstanceImporter {
  constructor(private readonly store: Store) {}
  async import(
    source: ImportCandidate,
    mode: 'link' | 'copy',
    signal: AbortSignal,
    name = source.name,
    root = minecraftDirectory(),
    worlds = true,
    overrides?: InstanceSettings,
  ): Promise<Instance> {
    signal.throwIfAborted();
    if (!['link', 'copy'].includes(mode)) throw new Error('Invalid import mode.');
    if (!name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name))
      throw new Error('Invalid instance name.');
    const settings = validateInstanceSettings(
      {
        name,
        java: source.java,
        minMemory: source.minMemory,
        maxMemory: source.maxMemory,
        ...overrides,
      },
      this.store.state.accounts,
    );
    const directory = await fs.realpath(source.directory);
    if (
      this.store.state.instances.some(
        (i) => path.resolve(i.directory) === directory && i.versionId === source.versionId,
      ) &&
      mode === 'link'
    )
      throw new Error('This instance is already registered.');
    if (
      source.warnings.some(
        (v) => v.startsWith('Unsupported MultiMC component:') || v.startsWith('Legacy jar mods'),
      )
    )
      throw new Error(source.warnings.join('\n'));
    if (mode === 'link' && source.warnings.some((v) => v.includes('launcher-specific patches')))
      throw new Error('This profile must be copied to rebuild its launcher-specific patches.');
    const location =
      mode === 'copy'
        ? await reserveInstanceLocation(root, name)
        : {
            directory,
            runtimeDirectory: source.runtimeDirectory || root,
            containerDirectory: source.format === 'multimc' ? path.dirname(directory) : undefined,
            layout: source.format === 'multimc' ? ('multimc' as const) : undefined,
          };
    const target = location.directory;
    const preserveVersion =
      !!source.versionId && !source.warnings.some((v) => v.includes('launcher-specific patches'));
    const instance: Instance = {
      ...settings,
      id: randomUUID(),
      name: name.trim(),
      minecraft: source.minecraft,
      loader: source.loader,
      loaderVersion: source.loaderVersion,
      ...location,
      sourceFormat: source.format,
      linked: mode === 'link',
      preserveVersion,
      versionId: preserveVersion ? source.versionId : undefined,
      installed: false,
      resourceDirectories: [
        ...new Set([
          ...(source.resourceDirectories || []),
          ...(source.runtimeDirectory ? [source.runtimeDirectory] : []),
        ]),
      ],
      playtimeSeconds: 0,
      createdAt: new Date().toISOString(),
    };
    const previous = this.store.state.selectedInstance;
    try {
      if (mode === 'copy') {
        await copyGameFiles(directory, target, signal, { worlds });
        if (source.runtimeDirectory)
          await copyRuntimeFiles(
            source.runtimeDirectory,
            root,
            source.versionId,
            preserveVersion,
            signal,
          );
        await writeInstanceMetadata(instance);
      }
      if (instance.preserveVersion) {
        await versionChain(instance.runtimeDirectory!, instance.versionId!);
        await rejectSymlinkParents(
          instance.runtimeDirectory!,
          path.join(
            instance.runtimeDirectory!,
            'versions',
            instance.versionId!,
            instance.versionId! + '.json',
          ),
        );
      }
      signal.throwIfAborted();
      this.store.state.instances.push(instance);
      this.store.state.selectedInstance = instance.id;
      await this.store.save();
      return instance;
    } catch (error) {
      this.store.state.instances = this.store.state.instances.filter((i) => i.id !== instance.id);
      if (this.store.state.selectedInstance === instance.id)
        this.store.state.selectedInstance = previous;
      if (mode === 'copy')
        await fs.rm(instance.containerDirectory || target, { recursive: true, force: true });
      throw error;
    }
  }
}
async function copyRuntimeFiles(
  source: string,
  target: string,
  version: string | undefined,
  profiles: boolean,
  signal: AbortSignal,
) {
  if (path.resolve(source) === path.resolve(target)) return;
  const copy = async (from: string, to: string) => {
    if (!(await exists(from))) return;
    await rejectSymlinkParents(target, to);
    await fs.cp(from, to, {
      recursive: true,
      force: false,
      mode: constants.COPYFILE_FICLONE,
      filter: async (file) => {
        signal.throwIfAborted();
        if ((await fs.lstat(file)).isSymbolicLink())
          throw new Error('Runtime files cannot contain symbolic links.');
        return true;
      },
    });
  };
  if (profiles && version)
    for (const profile of await versionChain(source, version)) {
      const id = filename(profile.id);
      const relative = path.join('versions', id, id + '.json');
      const destination = path.join(target, relative);
      if (await exists(destination)) {
        if (JSON.stringify(await readJson(destination)) !== JSON.stringify(profile))
          throw new Error(
            `A different version profile named ${id} already exists. Choose another Minecraft directory.`,
          );
      } else await copy(path.join(source, relative), destination);
      await copy(
        path.join(source, 'versions', id, id + '.jar'),
        path.join(target, 'versions', id, id + '.jar'),
      );
    }
  for (const resource of ['libraries', 'assets'])
    await copy(path.join(source, resource), path.join(target, resource));
}
