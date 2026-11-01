import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Store } from './store';
import { ServerEngine, ServerProfile } from './models';
import { exists, filename, rejectSymlinkParents } from './files';
import { serverEngines } from './server-types';

export interface ServerPreview {
  directory: string;
  name: string;
  engine: ServerEngine;
  minecraft: string;
  build?: string;
  jars: string[];
  launchJar?: string;
  argumentFile?: string;
  javaMajor?: number;
}
function versionIn(text: string) {
  return (
    text.match(/(?:^|[^\d])(1\.\d+(?:\.\d+)?|2[6-9]\.\d+(?:[.-][\w.]+)?)(?=[^\d.]|$)/)?.[1] || ''
  );
}
export async function readServerJar(file: string) {
  if ((await fs.stat(file)).size > 512 * 1024 ** 2) throw new Error('Server JAR exceeds 512 MB.');
  const zip = new AdmZip(file);
  const text = (name: string) => {
    const entry = zip.getEntry(name);
    return entry && entry.header.size < 1024 ** 2 ? entry.getData().toString() : '';
  };
  const manifest = text('META-INF/MANIFEST.MF').replace(/\r?\n /g, '');
  const main = manifest.match(/^Main-Class:\s*(.+)$/im)?.[1].trim() || '';
  if (!main || /(?:client\.main\.Main|SimpleInstaller|QuiltInstaller)$/i.test(main))
    throw new Error('Select an executable server JAR.');
  let minecraft = '';
  let javaMajor: number | undefined;
  try {
    const data = JSON.parse(text('version.json'));
    minecraft = typeof data.id === 'string' ? data.id : '';
    if (Number.isInteger(data.java_version) && data.java_version >= 8 && data.java_version < 100)
      javaMajor = data.java_version;
  } catch {
    /* Older server jars have no version.json. */
  }
  minecraft ||=
    text('META-INF/versions.list')
      .split(/[\t\r\n]/)
      .find((part) => /^(1\.\d+(?:\.\d+)?|2[6-9]\.\d+)$/.test(part)) || '';
  const entry = zip.getEntry(main.replaceAll('.', '/') + '.class');
  if (entry && entry.header.size >= 8 && entry.header.size < 4 * 1024 ** 2) {
    const bytes = entry.getData();
    if (bytes.readUInt32BE(0) === 0xcafebabe) {
      const major = bytes.readUInt16BE(6) - 44;
      if (major >= 8 && major < 100) javaMajor = Math.max(javaMajor || 8, major);
    }
  }
  return { main, minecraft, manifest, javaMajor };
}

export async function inspectServer(source: string, signal?: AbortSignal): Promise<ServerPreview> {
  if (!path.isAbsolute(source) || source.includes('\0'))
    throw new Error('Choose an absolute server directory.');
  const directory = await fs.realpath(source);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const jars = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.jar$/i.test(entry.name) &&
        !/(?:^|[-_.])(?:installer|sources|javadoc)(?:[-_.]|$)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  const preview: ServerPreview = {
    directory,
    name: path.basename(directory),
    engine: 'custom',
    minecraft: '',
    jars,
  };
  for (const [group, engine] of [
    ['net/minecraftforge/forge', 'forge'],
    ['net/neoforged/neoforge', 'neoforge'],
  ] as const) {
    const folder = path.join(directory, 'libraries', group);
    const versions = (await fs.readdir(folder).catch(() => [])).sort((a, b) =>
      b.localeCompare(a, 'en', { numeric: true }),
    );
    for (const version of versions) {
      signal?.throwIfAborted();
      const args = path.join(
        folder,
        version,
        process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt',
      );
      if (!(await exists(args))) continue;
      await rejectSymlinkParents(directory, args);
      preview.engine = engine;
      preview.argumentFile = path.relative(directory, args);
      const forge = /^(.+)-(\d{2,}\..+)$/.exec(version);
      preview.build = engine === 'forge' ? forge?.[2] || version : version;
      preview.minecraft =
        engine === 'forge'
          ? forge?.[1] || versionIn(version)
          : /^(20|21)\.(\d+)\./.test(version)
            ? `1.${version.split('.')[0]}${Number(version.split('.')[1]) ? '.' + version.split('.')[1] : ''}`
            : '';
      return preview;
    }
  }
  if (!jars.length) throw new Error('No executable server JAR or Forge argument file was found.');
  const candidates = [...jars].sort(
    (a, b) =>
      Number(/^(server|fabric-server-launch|quilt-server-launch)\.jar$/i.test(b)) -
      Number(/^(server|fabric-server-launch|quilt-server-launch)\.jar$/i.test(a)),
  );
  let metadata: Awaited<ReturnType<typeof readServerJar>> | undefined;
  let failure: unknown;
  for (const jar of candidates) {
    signal?.throwIfAborted();
    try {
      metadata = await readServerJar(path.join(directory, jar));
      preview.launchJar = jar;
      break;
    } catch (error) {
      signal?.throwIfAborted();
      failure ??= error;
    }
  }
  if (!metadata) throw failure || new Error('Select an executable server JAR.');
  const preferred = preview.launchJar!;
  preview.minecraft = metadata.minecraft || versionIn(preferred);
  preview.javaMajor = metadata.javaMajor;
  const identity = preferred + ' ' + metadata.main;
  const brand = preferred + ' ' + metadata.manifest;
  if (/velocity/i.test(identity)) preview.engine = 'velocity';
  else if (/neoforged|neoforge/i.test(identity)) preview.engine = 'neoforge';
  else if (/minecraftforge|(?:^|[-_.])forge(?:[-_.]|$)/i.test(identity)) preview.engine = 'forge';
  else if (/fabric/i.test(identity)) preview.engine = 'fabric';
  else if (/quilt/i.test(identity)) preview.engine = 'quilt';
  else if (/\bfolia\b/i.test(brand)) preview.engine = 'folia';
  else if (/\bpurpur\b/i.test(brand) || (await exists(path.join(directory, 'purpur.yml'))))
    preview.engine = 'purpur';
  else if (
    /paperclip|papermc/i.test(metadata.main) ||
    (await exists(path.join(directory, 'config', 'paper-global.yml')))
  )
    preview.engine = 'paper';
  else if (await exists(path.join(directory, 'spigot.yml'))) preview.engine = 'spigot';
  else if (/craftbukkit/i.test(metadata.main)) preview.engine = 'bukkit';
  else if (/^net\.minecraft\.(server|bundler)\./.test(metadata.main)) preview.engine = 'vanilla';
  const game = metadata.manifest.match(/Minecraft-Version:\s*(\S+)/i)?.[1];
  if (game) preview.minecraft = game;
  if (preview.engine === 'forge' && preview.minecraft) {
    const full = preferred.replace(/^forge[-_.]/i, '').replace(/\.jar$/i, '');
    if (full.startsWith(preview.minecraft + '-'))
      preview.build = full
        .slice(preview.minecraft.length + 1)
        .replace(/-(?:universal|server)$/i, '');
  }
  return preview;
}

export async function importServer(
  store: Store,
  value: Record<string, unknown>,
  signal: AbortSignal,
) {
  const preview = await inspectServer(String(value.directory || ''), signal);
  for (const server of store.state.servers)
    if (
      (await fs.realpath(server.directory).catch(() => path.resolve(server.directory))) ===
      preview.directory
    )
      throw new Error('This server is already registered.');
  const engine = String(value.engine || preview.engine) as ServerEngine;
  if (!serverEngines.some((entry) => entry.id === engine))
    throw new Error('Unknown server software');
  const name = String(value.name || preview.name).trim();
  const minecraft = String(value.minecraft || preview.minecraft).trim();
  if (!name || name.length > 100 || /[\r\n\0]/.test(name) || !minecraft || minecraft.length > 150)
    throw new Error('Enter a server name and Minecraft version.');
  filename(minecraft);
  const jar = typeof value.jar === 'string' && value.jar ? filename(value.jar) : undefined;
  if (jar && !preview.jars.includes(jar)) throw new Error('Server JAR not found');
  const useArguments = !jar && preview.argumentFile && engine === preview.engine;
  const selectedJar = jar || preview.launchJar;
  if (!useArguments && !selectedJar)
    throw new Error('Select a server JAR or keep the detected Forge/NeoForge software.');
  const metadata = !useArguments
    ? await readServerJar(path.join(preview.directory, selectedJar!))
    : undefined;
  const launchArgs = useArguments
    ? ['@' + preview.argumentFile!, 'nogui']
    : ['-jar', selectedJar!, ...(engine === 'velocity' ? [] : ['nogui'])];
  const server: ServerProfile = {
    id: randomUUID(),
    name,
    engine,
    minecraft,
    build: engine === preview.engine ? preview.build : undefined,
    directory: preview.directory,
    launchArgs,
    installed: true,
    imported: true,
    eulaAccepted: false,
    createdAt: new Date().toISOString(),
  };
  const parts = /^1\.(\d+)(?:\.(\d+))?/.exec(minecraft);
  const gameJava = parts
    ? Number(parts[1]) > 20 || (Number(parts[1]) === 20 && Number(parts[2] || 0) >= 5)
      ? 21
      : Number(parts[1]) >= 18
        ? 17
        : Number(parts[1]) === 17
          ? 16
          : 8
    : 25;
  server.requiredJava = Math.max(
    gameJava,
    metadata?.javaMajor || preview.javaMajor || 8,
    engine === 'velocity' ? 21 : 8,
  );
  const previous = store.state.selectedServer;
  store.state.servers.push(server);
  store.state.selectedServer = server.id;
  try {
    signal.throwIfAborted();
    await store.save();
  } catch (error) {
    store.state.servers = store.state.servers.filter((entry) => entry.id !== server.id);
    store.state.selectedServer = previous;
    throw error;
  }
  return server;
}
