import { Network } from './network';
import { Minecraft } from './minecraft';
import { ServerEngine, ServerProfile } from './models';
import { filename } from './files';

export const serverEngines: { id: ServerEngine; name: string; content?: 'mod' | 'plugin' }[] = [
  { id: 'vanilla', name: 'Vanilla' },
  { id: 'paper', name: 'Paper', content: 'plugin' },
  { id: 'purpur', name: 'Purpur', content: 'plugin' },
  { id: 'folia', name: 'Folia', content: 'plugin' },
  { id: 'fabric', name: 'Fabric', content: 'mod' },
  { id: 'quilt', name: 'Quilt', content: 'mod' },
  { id: 'forge', name: 'Forge', content: 'mod' },
  { id: 'neoforge', name: 'NeoForge', content: 'mod' },
  { id: 'velocity', name: 'Velocity', content: 'plugin' },
  { id: 'custom', name: 'Custom JAR' },
];
export interface ServerBuild {
  id: string;
  stable: boolean;
}
interface PaperBuild {
  id: number;
  channel: string;
  downloads: Record<
    string,
    { name: string; url: string; size: number; checksums: { sha256: string } }
  >;
}
export interface ServerArtifact {
  url: string;
  hash?: string;
  algorithm?: string;
  size?: number;
  installer?: 'forge' | 'neoforge' | 'quilt';
}
export class ServerCatalog {
  constructor(
    private readonly net: Network,
    private readonly minecraft: Minecraft,
  ) {}
  async latestGameVersion() {
    return (await this.minecraft.manifest()).latest.release;
  }
  async versions(engine: ServerEngine): Promise<string[]> {
    if (['paper', 'folia', 'velocity'].includes(engine)) {
      const data = await this.net.json<{ versions: Record<string, string[]> }>(
        `https://fill.papermc.io/v3/projects/${engine}`,
      );
      return Object.values(data.versions)
        .flat()
        .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    }
    if (engine === 'purpur')
      return (
        await this.net.json<{ versions: string[] }>('https://api.purpurmc.org/v2/purpur')
      ).versions.reverse();
    const manifest = await this.minecraft.manifest();
    if (engine === 'fabric' || engine === 'quilt') {
      const host =
        engine === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
      const games = await this.net.json<{ version: string }[]>(`${host}/versions/game`);
      const supported = new Set(games.map((g) => g.version));
      return manifest.versions.filter((v) => supported.has(v.id)).map((v) => v.id);
    }
    return manifest.versions.map((v) => v.id);
  }
  async paperBuilds(engine: string, version: string) {
    return this.net.json<PaperBuild[]>(
      `https://fill.papermc.io/v3/projects/${engine}/versions/${encodeURIComponent(version)}/builds`,
    );
  }
  async builds(engine: ServerEngine, version: string): Promise<ServerBuild[]> {
    if (['paper', 'folia', 'velocity'].includes(engine))
      return (await this.paperBuilds(engine, version)).map((b) => ({
        id: String(b.id),
        stable: b.channel === 'STABLE',
      }));
    if (engine === 'purpur') {
      const data = await this.net.json<{ builds: { all: string[] } }>(
        `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(version)}`,
      );
      return data.builds.all
        .slice()
        .reverse()
        .map((id) => ({ id, stable: true }));
    }
    if (['fabric', 'quilt', 'forge', 'neoforge'].includes(engine))
      return (
        await this.minecraft.loaders(engine as 'fabric' | 'quilt' | 'forge' | 'neoforge', version)
      ).map((id) => ({ id, stable: !/alpha|beta|snapshot/i.test(id) }));
    return [];
  }
  async metadata(version: string, signal?: AbortSignal) {
    const entry = (await this.minecraft.manifest()).versions.find((v) => v.id === version);
    if (!entry) throw new Error('Minecraft version not found');
    return this.net.json<{
      javaVersion?: { majorVersion: number };
      downloads?: { server?: { url: string; sha1: string; size: number } };
    }>(entry.url, { signal, kind: 'manifest' });
  }
  async artifact(server: ServerProfile, signal: AbortSignal): Promise<ServerArtifact> {
    const version = encodeURIComponent(server.softwareVersion || server.minecraft);
    const engine = server.engine;
    if (['paper', 'folia', 'velocity'].includes(engine)) {
      const build = (
        await this.paperBuilds(engine, server.softwareVersion || server.minecraft)
      ).find((b) => String(b.id) === server.build);
      const file = build?.downloads['server:default'];
      if (!file) throw new Error('Server build not found');
      return { url: file.url, hash: file.checksums.sha256, algorithm: 'sha256', size: file.size };
    }
    if (engine === 'purpur') {
      const base = `https://api.purpurmc.org/v2/purpur/${version}/${encodeURIComponent(server.build!)}`;
      const data = await this.net.json<{ md5: string }>(base, { signal });
      return { url: base + '/download', hash: data.md5, algorithm: 'md5' };
    }
    if (engine === 'fabric') {
      const installers = await this.net.json<{ version: string; stable: boolean }[]>(
        'https://meta.fabricmc.net/v2/versions/installer',
        { signal },
      );
      const installer = installers.find((i) => i.stable) || installers[0];
      if (!installer) throw new Error('Fabric installer unavailable');
      return {
        url: `https://meta.fabricmc.net/v2/versions/loader/${version}/${encodeURIComponent(server.build!)}/${encodeURIComponent(installer.version)}/server/jar`,
      };
    }
    if (engine === 'quilt') {
      const installers = await this.net.json<
        { url: string; hashes?: { sha256: string }; file_size?: number }[]
      >('https://meta.quiltmc.org/v3/versions/installer', { signal });
      if (!installers[0]) throw new Error('Quilt installer unavailable');
      // The Maven checksum follows the artifact when installer metadata lags behind.
      const checksum = (await this.net.text(installers[0].url + '.sha256', { signal }))
        .trim()
        .split(/\s+/)[0];
      if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('Invalid installer checksum');
      return {
        url: installers[0].url,
        hash: checksum,
        algorithm: 'sha256',
        size: installers[0].file_size,
        installer: 'quilt',
      };
    }
    if (engine === 'forge' || engine === 'neoforge') {
      const full = filename(
        engine === 'forge' ? `${server.minecraft}-${server.build}` : server.build!,
      );
      const base =
        engine === 'forge'
          ? 'https://maven.minecraftforge.net/net/minecraftforge/forge'
          : 'https://maven.neoforged.net/releases/net/neoforged/neoforge';
      const url = `${base}/${full}/${engine === 'forge' ? 'forge' : 'neoforge'}-${full}-installer.jar`;
      const checksum = (await this.net.text(url + '.sha1', { signal })).trim().split(/\s+/)[0];
      if (!/^[a-f0-9]{40}$/i.test(checksum)) throw new Error('Invalid installer checksum');
      return { url, hash: checksum, installer: engine };
    }
    const file = (await this.metadata(server.minecraft, signal)).downloads?.server;
    if (!file) throw new Error('This Minecraft version has no dedicated server download');
    return { url: file.url, hash: file.sha1, size: file.size };
  }
}
