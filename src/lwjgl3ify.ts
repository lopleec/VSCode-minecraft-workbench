import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Network } from './network';
import { Instance } from './models';
import { filename, readJson, rejectSymlinkParents, writeJson } from './files';
import { t } from './config';
import { runtimeDirectory } from './game-paths';
import { resolveGameVersion } from './version-profile';

export const LWJGL3IFY_MINECRAFT = '1.7.10';
export const LWJGL3IFY_FORGE = '10.13.4.1614';
const RELEASES = 'https://api.github.com/repos/GTNewHorizons/lwjgl3ify/releases';
const DOWNLOADS = 'https://github.com/GTNewHorizons/lwjgl3ify/releases';
const UNIMIXINS =
  'https://api.modrinth.com/v2/project/unimixins/version?game_versions=%5B%221.7.10%22%5D&loaders=%5B%22forge%22%5D';

interface GithubAsset {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string | null;
}
interface GithubRelease {
  tag_name: string;
  draft?: boolean;
  assets?: GithubAsset[];
}
export interface Lwjgl3ifyRelease {
  version: string;
  profileUrl: string;
  profileSize: number;
  profileSha256?: string;
  modUrl: string;
  modSize: number;
  modSha256?: string;
  /** Present when GitHub's JSON API was unavailable and the profile was fetched directly. */
  profileText?: string;
}
export interface Lwjgl3ifyInstall {
  versionId: string;
  forgeVersion: string;
  javaMajor: number;
}
interface ModrinthFile {
  url: string;
  filename: string;
  size: number;
  primary: boolean;
  hashes?: { sha1?: string; sha512?: string };
}
interface ModrinthVersion {
  version_type?: string;
  files?: ModrinthFile[];
}

function digest(asset: GithubAsset | undefined): string | undefined {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(asset?.digest || '');
  return match?.[1];
}
function assetVersion(name: string): string | undefined {
  const match = /^lwjgl3ify-(.+)\.jar$/i.exec(name);
  if (
    !match ||
    /-(?:api|dev|dev-preshadow|sources|forgepatches|curse)$/i.test(match[1]) ||
    /-multimc$/i.test(match[1])
  )
    return undefined;
  return /^v?(\d+(?:\.\d+){1,3})/i.exec(match[1])?.[1];
}

/** The version of the lwjgl3ify coremod jar installed in the instance, if any. */
export async function lwjgl3ifyModVersion(directory: string): Promise<string | undefined> {
  const mods = path.join(directory, 'mods');
  const entries = await fs
    .readdir(mods, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const jars = entries
    .filter((entry) => entry.isFile() && assetVersion(entry.name) !== undefined)
    .map((entry) => entry.name);
  if (jars.length > 1)
    throw new Error(
      t(
        'Keep only one lwjgl3ify jar in mods/, or remove the older copy.',
        'mods/ 中只能保留一个 lwjgl3ify JAR，请移除旧版本。',
        'mods/ 中只能保留一個 lwjgl3ify JAR，請移除舊版本。',
      ),
    );
  return jars.length ? assetVersion(jars[0]) : undefined;
}

/**
 * Returns the lwjgl3ify mod version when the instance should switch to the LWJGL3
 * runtime automatically: explicit settings win, and an existing lwjgl3ify profile is kept.
 */
export async function detectLwjgl3ify(instance: Instance): Promise<string | undefined> {
  if (
    instance.lwjgl3ify !== undefined ||
    instance.minecraft !== LWJGL3IFY_MINECRAFT ||
    instance.loader !== 'forge'
  )
    return undefined;
  const mod = await lwjgl3ifyModVersion(instance.directory).catch(() => undefined);
  if (!mod) return undefined;
  const current = await resolveGameVersion(
    runtimeDirectory(instance),
    instance.versionId || instance.minecraft,
  ).catch(() => undefined);
  return current && isLwjgl3ifyProfile(current) ? undefined : mod;
}

/** Whether a version profile already replaces launchwrapper with RetroFuturaBootstrap. */
export function isLwjgl3ifyProfile(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false;
  const value = profile as Record<string, unknown>;
  const libraries = Array.isArray(value.libraries)
    ? value.libraries.map((library) =>
        library && typeof library === 'object'
          ? String((library as Record<string, unknown>).name || '')
          : '',
      )
    : [];
  const jvm = Array.isArray((value.arguments as Record<string, unknown> | undefined)?.jvm)
    ? JSON.stringify((value.arguments as Record<string, unknown>).jvm)
    : '';
  return (
    /retrofuturabootstrap/i.test(String(value.mainClass || '')) ||
    /retrofuturabootstrap|RfbSystemClassLoader/i.test(jvm) ||
    libraries.some((name) => name.startsWith('com.github.GTNewHorizons:lwjgl3ify:'))
  );
}

/** Validate and normalize the standalone profile published with a lwjgl3ify release. */
export function prepareLwjgl3ifyProfile(
  value: unknown,
  minecraft = LWJGL3IFY_MINECRAFT,
): Record<string, any> & { id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      t(
        'Invalid lwjgl3ify version profile.',
        '无效的 lwjgl3ify 版本配置。',
        '無效的 lwjgl3ify 版本設定。',
      ),
    );
  const profile = value as Record<string, any>;
  if (typeof profile.id !== 'string' || !profile.id)
    throw new Error(
      t(
        'Invalid lwjgl3ify version profile.',
        '无效的 lwjgl3ify 版本配置。',
        '無效的 lwjgl3ify 版本設定。',
      ),
    );
  if (typeof profile.mainClass !== 'string' || !/retrofuturabootstrap/i.test(profile.mainClass))
    throw new Error(
      t(
        'The lwjgl3ify version profile has an unexpected main class.',
        'lwjgl3ify 版本配置的主类不符合预期。',
        'lwjgl3ify 版本設定的主類別不符預期。',
      ),
    );
  if (!Array.isArray(profile.libraries) || profile.libraries.length > 512)
    throw new Error(
      t(
        'The lwjgl3ify version profile has an invalid library list.',
        'lwjgl3ify 版本配置的运行库列表无效。',
        'lwjgl3ify 版本設定的執行階段程式庫清單無效。',
      ),
    );
  const major = Number(profile.javaVersion?.majorVersion);
  if (!Number.isInteger(major) || major < 17 || major > 99)
    throw new Error(
      t(
        'The lwjgl3ify version profile has an invalid Java requirement.',
        'lwjgl3ify 版本配置的 Java 要求无效。',
        'lwjgl3ify 版本設定的 Java 要求無效。',
      ),
    );
  const id = filename(profile.id);
  const result: Record<string, any> = {
    ...profile,
    id,
    clientVersion: minecraft,
    jar: minecraft,
    javaVersion: { ...profile.javaVersion, majorVersion: major },
  };
  delete result.inheritsFrom;
  delete result.patches;
  return result as Record<string, any> & { id: string };
}

async function directRelease(
  net: Network,
  signal: AbortSignal,
  requested?: string,
): Promise<Lwjgl3ifyRelease> {
  const versions = requested
    ? [...new Set([requested, requested.replace(/^v/i, ''), `v${requested}`])]
    : [undefined];
  let lastError: unknown;
  for (const version of versions) {
    const profileUrl = `${DOWNLOADS}/${version ? 'download/' + encodeURIComponent(version) : 'latest/download'}/version.json`;
    try {
      const profileText = await net.text(profileUrl, { signal, bypassSources: true });
      const profile = JSON.parse(profileText) as Record<string, any>;
      const libraries = Array.isArray(profile.libraries) ? profile.libraries : [];
      const forgePatches = libraries.find(
        (library) =>
          typeof library?.name === 'string' &&
          /^com\.github\.GTNewHorizons:lwjgl3ify:.+:forgePatches$/.test(library.name),
      )?.name;
      const detected = /^com\.github\.GTNewHorizons:lwjgl3ify:(.+):forgePatches$/.exec(
        String(forgePatches || ''),
      )?.[1];
      const resolved = requested || detected;
      if (!resolved) throw new Error('Cannot determine the lwjgl3ify version.');
      if (requested && detected && detected !== requested)
        throw new Error('The lwjgl3ify profile version does not match the requested release.');
      return {
        version: resolved,
        profileUrl,
        profileSize: Buffer.byteLength(profileText),
        modUrl: `${DOWNLOADS}/download/${encodeURIComponent(resolved)}/lwjgl3ify-${resolved}.jar`,
        modSize: 0,
        profileText,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No lwjgl3ify release found');
}

export async function lwjgl3ifyRelease(
  net: Network,
  signal: AbortSignal,
  version?: string,
  cacheDirectory?: string,
): Promise<Lwjgl3ifyRelease> {
  signal.throwIfAborted();
  const cache =
    cacheDirectory &&
    path.join(cacheDirectory, `lwjgl3ify-release-${version ? filename(version) : 'latest'}.json`);
  const cached = cache
    ? await readJson<{ fetched: number; value: Lwjgl3ifyRelease }>(cache, undefined).catch(
        () => undefined,
      )
    : undefined;
  if (
    cached &&
    Date.now() - cached.fetched < (version ? 7 * 86400000 : 3600000) &&
    cached.value.version
  )
    return cached.value;
  const apiUrl = `${RELEASES}/${version ? 'tags/' + encodeURIComponent(version) : 'latest'}`;
  try {
    const release = await net.json<GithubRelease>(apiUrl, {
      signal,
      bypassSources: true,
      headers: { accept: 'application/vnd.github+json' },
    });
    if (release.draft) throw new Error('Draft release');
    const tag = String(release.tag_name || '').replace(/^v/, '');
    if (!tag) throw new Error('Missing release tag');
    const assets = release.assets || [];
    const profile = assets.find((asset) => asset.name === 'version.json');
    const mod =
      assets.find((asset) => asset.name === `lwjgl3ify-${tag}.jar`) ||
      assets.find((asset) => assetVersion(asset.name) === tag);
    if (!profile?.browser_download_url || !mod?.browser_download_url)
      throw new Error('The lwjgl3ify release is missing its launcher metadata.');
    const result: Lwjgl3ifyRelease = {
      version: tag,
      profileUrl: profile.browser_download_url,
      profileSize: profile.size,
      profileSha256: digest(profile),
      modUrl: mod.browser_download_url,
      modSize: mod.size,
      modSha256: digest(mod),
    };
    if (cache) await writeJson(cache, { fetched: Date.now(), value: result });
    return result;
  } catch (error) {
    if (cached?.value?.version) return cached.value;
    try {
      const fallback = await directRelease(net, signal, version);
      if (cache) await writeJson(cache, { fetched: Date.now(), value: fallback });
      return fallback;
    } catch (fallbackError) {
      const detail = [error, fallbackError]
        .map((value) => (value instanceof Error ? value.message : String(value)))
        .filter(Boolean)
        .join(' / ');
      throw new Error(
        t(
          `Could not load the lwjgl3ify ${version || 'latest'} release from GitHub (${apiUrl}; ${detail}). Check the connection or proxy, then retry Install / repair.`,
          `无法从 GitHub 获取 lwjgl3ify ${version || 'latest'} 发行版（${apiUrl}；${detail}）。请检查网络或代理后重试“安装 / 修复”。`,
          `無法從 GitHub 取得 lwjgl3ify ${version || 'latest'} 發行版（${apiUrl}；${detail}）。請檢查網路或代理後重試「安裝 / 修復」。`,
        ),
      );
    }
  }
}

function forgeVersionOf(profile: Record<string, any>): string {
  const name = profile.libraries
    .map((library: unknown) =>
      library && typeof library === 'object'
        ? String((library as Record<string, unknown>).name || '')
        : '',
    )
    .find((value: string) => value.startsWith('net.minecraftforge:forge:'));
  const artifact = name?.split(':')[2] || '';
  return artifact.startsWith(`${LWJGL3IFY_MINECRAFT}-`)
    ? artifact
        .slice(LWJGL3IFY_MINECRAFT.length + 1)
        .replace(new RegExp(`-${LWJGL3IFY_MINECRAFT}$`), '')
    : LWJGL3IFY_FORGE;
}

async function ensureUniMixins(
  instance: Instance,
  net: Network,
  signal: AbortSignal,
  report: (message: string, english?: string) => void,
) {
  const mods = path.join(instance.directory, 'mods');
  const installed = await fs
    .readdir(mods, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  if (
    installed.some(
      (entry) => entry.isFile() && /\.jar$/i.test(entry.name) && /unimixins/i.test(entry.name),
    )
  )
    return;
  try {
    report(t('Preparing UniMixins', '准备 UniMixins', '準備 UniMixins'), 'Preparing UniMixins');
    const versions = await net.json<ModrinthVersion[]>(UNIMIXINS, { signal });
    const candidates = (Array.isArray(versions) ? versions : []).filter(
      (version) => version.files?.length,
    );
    const chosen =
      candidates.find((version) => version.version_type === 'release') || candidates[0];
    const file = chosen?.files?.find((entry) => entry.primary) || chosen?.files?.[0];
    if (!file?.url || !file.filename) throw new Error('No UniMixins file');
    const target = path.join(mods, filename(file.filename));
    await rejectSymlinkParents(instance.directory, target);
    await net.download(file.url, target, {
      signal,
      size: file.size,
      hash: file.hashes?.sha512 || file.hashes?.sha1,
      algorithm: file.hashes?.sha512 ? 'sha512' : 'sha1',
      progress: (bytes, total) =>
        report(
          `${Math.round(bytes / 1024 ** 2)} / ${Math.round(total / 1024 ** 2)} MB`,
          'UniMixins',
        ),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    report(
      t(
        'UniMixins could not be downloaded automatically. Install it in mods/ before launching.',
        '无法自动下载 UniMixins，请在启动前将其放入 mods/。',
        '無法自動下載 UniMixins，請在啟動前將其放入 mods/。',
      ),
      'UniMixins download failed',
    );
  }
}

/**
 * Installs the launcher-side half of lwjgl3ify: the standalone LWJGL3 version profile,
 * its libraries, and the coremod jars. Runtime libraries are downloaded by installRuntime.
 */
export async function installLwjgl3ify(
  instance: Instance,
  options: {
    net: Network;
    root: string;
    signal: AbortSignal;
    report: (message: string, english?: string) => void;
  },
): Promise<Lwjgl3ifyInstall> {
  const { net, root, signal, report } = options;
  if (instance.minecraft !== LWJGL3IFY_MINECRAFT || instance.loader !== 'forge')
    throw new Error(
      t(
        'lwjgl3ify requires a Forge 1.7.10 instance.',
        'lwjgl3ify 仅支持 Forge 1.7.10 实例。',
        'lwjgl3ify 僅支援 Forge 1.7.10 實例。',
      ),
    );
  const installed = await lwjgl3ifyModVersion(instance.directory);
  report(
    t('Preparing lwjgl3ify runtime', '准备 lwjgl3ify 运行环境', '準備 lwjgl3ify 執行環境'),
    'Preparing lwjgl3ify runtime',
  );
  const release = await lwjgl3ifyRelease(net, signal, installed, path.join(root, 'cache'));
  const version = filename(release.version);
  const cachedProfile = path.join(root, 'cache', 'lwjgl3ify', `profile-${version}.json`);
  await rejectSymlinkParents(root, cachedProfile);
  if (release.profileText) {
    await writeJson(cachedProfile, JSON.parse(release.profileText));
  } else {
    await net.download(release.profileUrl, cachedProfile, {
      signal,
      size: release.profileSize,
      hash: release.profileSha256,
      algorithm: 'sha256',
      bypassSources: true,
    });
  }
  const profile = prepareLwjgl3ifyProfile(
    await readJson<Record<string, any>>(cachedProfile),
    instance.minecraft,
  );
  const forgeVersion = forgeVersionOf(profile);
  profile.id = filename(`lwjgl3ify-${instance.minecraft}-forge-${forgeVersion}-${version}`);
  const profileFile = path.join(root, 'versions', profile.id, `${profile.id}.json`);
  await rejectSymlinkParents(root, profileFile);
  await writeJson(profileFile, profile);
  const mods = path.join(instance.directory, 'mods');
  await fs.mkdir(mods, { recursive: true });
  const modFile = path.join(mods, `lwjgl3ify-${version}.jar`);
  if (!installed) {
    report(
      t(
        `Downloading lwjgl3ify ${version}`,
        `下载 lwjgl3ify ${version}`,
        `下載 lwjgl3ify ${version}`,
      ),
      `Downloading lwjgl3ify ${version}`,
    );
    await rejectSymlinkParents(instance.directory, modFile);
    await net.download(release.modUrl, modFile, {
      signal,
      size: release.modSize,
      hash: release.modSha256,
      algorithm: 'sha256',
      bypassSources: true,
      progress: (bytes, total) =>
        report(
          `${Math.round(bytes / 1024 ** 2)} / ${Math.round(total / 1024 ** 2)} MB`,
          'lwjgl3ify',
        ),
    });
  }
  await ensureUniMixins(instance, net, signal, report);
  return {
    versionId: profile.id,
    forgeVersion,
    javaMajor: Number(profile.javaVersion.majorVersion),
  };
}
