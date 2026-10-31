import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import AdmZip from 'adm-zip';
import { gt, prerelease, satisfies, valid, validRange } from 'semver';
import { Network } from './network';
import { Jobs } from './jobs';
import { waitFor } from './abort';
import { config, t } from './config';
import { extensionId, extensionVersion } from './build-info';

const repository = 'https://github.com/lopleec/VSCode-minecraft-workbench';
const latestApi = 'https://api.github.com/repos/lopleec/VSCode-minecraft-workbench/releases/latest';
export type InstallSource = 'gallery' | 'vsix' | 'development' | 'unknown';
type Context = Pick<
  vscode.ExtensionContext,
  'extensionMode' | 'extensionPath' | 'extension' | 'globalStorageUri'
>;
interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string;
}
export interface ExtensionRelease {
  version: string;
  page: string;
  asset: Asset;
  checksum?: string;
  sums?: Asset;
}
async function json(file: string): Promise<any> {
  try {
    if ((await fs.stat(file)).size > 4 * 1024 ** 2) return;
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return;
  }
}
function metadataSource(metadata: any): InstallSource {
  if (metadata?.source === 'gallery' || metadata?.source === 'vsix') return metadata.source;
  return typeof metadata?.id === 'string' &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(metadata.id)
    ? 'gallery'
    : 'unknown';
}
export async function installationSource(context: Context): Promise<InstallSource> {
  if (context.extensionMode !== vscode.ExtensionMode.Production) return 'development';
  const root = context.extensionPath;
  const indexes = [
    path.resolve(context.globalStorageUri.fsPath, '..', '..', 'extensions.json'),
    path.join(path.dirname(root), 'extensions.json'),
  ];
  for (const index of indexes) {
    const entries = await json(index);
    if (!Array.isArray(entries)) continue;
    const entry = entries.find((e) => {
      if (
        typeof e?.identifier?.id !== 'string' ||
        e.identifier.id.toLowerCase() !== extensionId.toLowerCase() ||
        e.version !== context.extension.packageJSON.version
      )
        return false;
      const location =
        typeof e.relativeLocation === 'string'
          ? path.resolve(path.dirname(index), e.relativeLocation)
          : e.location?.fsPath ||
            (e.location?.scheme === 'file' && typeof e.location.path === 'string'
              ? vscode.Uri.from({
                  scheme: 'file',
                  path: e.location.path,
                  authority: typeof e.location.authority === 'string' ? e.location.authority : '',
                }).fsPath
              : undefined);
      return typeof location === 'string' && path.relative(root, location) === '';
    });
    const source = metadataSource({ id: entry?.identifier?.uuid, ...entry?.metadata });
    if (source !== 'unknown') return source;
  }
  return metadataSource((await json(path.join(root, 'package.json')))?.__metadata);
}
export function extensionRelease(data: any): ExtensionRelease {
  const version =
    typeof data?.tag_name === 'string' ? valid(data.tag_name.replace(/^v/, '')) : null;
  if (
    !version ||
    prerelease(version) ||
    data.draft ||
    data.prerelease ||
    !Array.isArray(data.assets)
  )
    throw new Error('Invalid GitHub release.');
  const page = `${repository}/releases/tag/${data.tag_name}`;
  if (data.html_url !== page) throw new Error('Invalid GitHub release URL.');
  const find = (name: string, limit: number): Asset | undefined =>
    data.assets.find(
      (a: Asset) =>
        a?.name === name &&
        Number.isSafeInteger(a.size) &&
        a.size > 0 &&
        a.size <= limit &&
        a.browser_download_url === `${repository}/releases/download/${data.tag_name}/${name}`,
    );
  const asset = find(`minecraft-workbench-${version}.vsix`, 16 * 1024 ** 2);
  if (!asset) throw new Error('No compatible extension package in this release.');
  return {
    version,
    page,
    asset,
    checksum: /^sha256:[0-9a-f]{64}$/i.test(asset.digest || '')
      ? asset.digest!.slice(7).toLowerCase()
      : undefined,
    sums: find('SHA256SUMS.txt', 64 * 1024),
  };
}
export function verifyExtensionPackage(
  file: string,
  release: ExtensionRelease,
  codeVersion = vscode.version,
) {
  const zip = new AdmZip(file);
  const entry = zip.getEntry('extension/package.json');
  if (
    !entry ||
    entry.header.size > 256 * 1024 ||
    zip.getEntries().reduce((n, e) => n + e.header.size, 0) > 64 * 1024 ** 2
  )
    throw new Error('Invalid extension package.');
  const manifest = JSON.parse(entry.getData().toString('utf8'));
  if (
    `${manifest.publisher}.${manifest.name}`.toLowerCase() !== extensionId.toLowerCase() ||
    manifest.version !== release.version
  )
    throw new Error('Extension package identity does not match the release.');
  if (
    typeof manifest.engines?.vscode !== 'string' ||
    !validRange(manifest.engines.vscode) ||
    !satisfies(codeVersion, manifest.engines.vscode, { includePrerelease: true })
  )
    throw new Error(
      t(
        `This update requires VS Code ${manifest.engines?.vscode || 'a newer version'}.`,
        `此更新需要 VS Code ${manifest.engines?.vscode || '较新版本'}。`,
      ),
    );
}
export class ExtensionUpdates {
  source: InstallSource = 'unknown';
  private checking?: Promise<void>;
  private pendingVersion?: string;
  private active?: AbortController;
  private disposed = false;
  constructor(
    private readonly context: Context,
    private readonly net: Network,
    private readonly jobs: Jobs,
    private readonly isBusy: () => boolean,
  ) {}
  async initialize() {
    this.source = await installationSource(this.context);
  }
  get visible() {
    return this.enabled && (this.source === 'vsix' || this.source === 'unknown');
  }
  get enabled() {
    return !this.disposed && config<unknown>('updates.enabled', true) === true;
  }
  dispose() {
    this.disposed = true;
    this.active?.abort();
  }
  configurationChanged() {
    if (!this.enabled) this.active?.abort();
  }
  check(): Promise<void> {
    if (this.checking) return this.checking;
    const active = new AbortController();
    this.active = active;
    const work = this.checkLatest(active.signal);
    this.checking = work;
    void work.then(
      () => {
        this.checking = undefined;
        this.active = undefined;
      },
      () => {
        this.checking = undefined;
        this.active = undefined;
      },
    );
    return work;
  }
  private async open(url: string) {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
  private async checkLatest(signal: AbortSignal) {
    if (!this.enabled) {
      void vscode.window.showInformationMessage(
        t('Extension update checks are disabled in Settings.', '插件更新检查已在设置中关闭。'),
      );
      return;
    }
    if (this.pendingVersion) {
      void this.offerReload().catch(() => {});
      return;
    }
    if (this.source !== 'vsix') {
      const action =
        this.source === 'gallery'
          ? t('Open Extensions', '打开扩展')
          : t('Open GitHub Releases', '打开 GitHub Releases');
      const result = await vscode.window.showInformationMessage(
        this.source === 'gallery'
          ? t(
              'This installation is managed by Marketplace. Use VS Code to check for updates.',
              '此安装由 Marketplace 管理，请使用 VS Code 检查更新。',
            )
          : this.source === 'development'
            ? t(
                'Extension updates are unavailable in development builds.',
                '开发构建不执行插件更新。',
              )
            : t(
                'The installation source could not be identified. Download a VSIX manually from GitHub.',
                '无法识别安装来源，可前往 GitHub 手动下载 VSIX。',
              ),
        action,
      );
      if (result === action) {
        if (this.source === 'gallery')
          await vscode.commands.executeCommand('workbench.extensions.search', `@id:${extensionId}`);
        else await this.open(`${repository}/releases/latest`);
      }
      return;
    }
    const release = await this.jobs.run(
      t('Check for extension updates', '检查插件更新'),
      async (jobSignal) => {
        const requestSignal = AbortSignal.any([signal, jobSignal]);
        const release = extensionRelease(
          await this.net.json(latestApi, { signal: requestSignal, bypassSources: true }),
        );
        if (!release.checksum && release.sums) {
          const text = await this.net.text(release.sums.browser_download_url, {
            signal: requestSignal,
            bypassSources: true,
          });
          if (Buffer.byteLength(text) <= 64 * 1024) {
            const hashes = text
              .split(/\r?\n/)
              .map((line) => /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line))
              .filter((match) => match?.[2] === release.asset.name);
            if (hashes.length === 1) release.checksum = hashes[0]![1].toLowerCase();
          }
        }
        return release;
      },
      () => this.check(),
    );
    if (!this.enabled || signal.aborted) return;
    if (!gt(release.version, extensionVersion)) {
      void vscode.window.showInformationMessage(
        t(
          `Minecraft Workbench ${extensionVersion} is up to date.`,
          `Minecraft Workbench ${extensionVersion} 已是最新版本。`,
        ),
      );
      return;
    }
    const install = t('Download and install', '下载并安装'),
      download = t('Download VSIX', '下载 VSIX'),
      notes = t('Release notes', '更新说明');
    const canInstall = !!release.checksum && !vscode.env.remoteName;
    const result = await waitFor(
      Promise.resolve(
        vscode.window.showInformationMessage(
          t(
            `Minecraft Workbench ${release.version} is available (installed: ${extensionVersion}).`,
            `Minecraft Workbench ${release.version} 可用（已安装 ${extensionVersion}）。`,
          ),
          ...(canInstall ? [install, download, notes] : [download, notes]),
        ),
      ),
      signal,
    );
    if (!this.enabled || signal.aborted) return;
    if (result === notes) await this.open(release.page);
    else if (result === download) await this.open(release.asset.browser_download_url);
    else if (result === install) await this.install(release, signal);
  }
  private async install(release: ExtensionRelease, featureSignal: AbortSignal) {
    if (this.isBusy()) {
      void vscode.window.showInformationMessage(
        t(
          'Stop running games and servers before updating the extension.',
          '请先停止正在运行的游戏和服务端，再更新插件。',
        ),
      );
      return;
    }
    const net = new Network({
      ...this.net.options,
      sources: {},
      cacheDirectory: undefined,
      runtimeRoots: undefined,
    });
    try {
      await this.jobs.run(
        t(
          `Update Minecraft Workbench to ${release.version}`,
          `将 Minecraft Workbench 更新至 ${release.version}`,
        ),
        async (jobSignal, report) => {
          const signal = AbortSignal.any([featureSignal, jobSignal]);
          const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'minecraft-workbench-update-'));
          try {
            const file = path.join(stage, release.asset.name);
            await net.download(release.asset.browser_download_url, file, {
              signal,
              hash: release.checksum,
              algorithm: 'sha256',
              size: release.asset.size,
              progress: (n, total) => report(`${Math.round((n / Math.max(total, 1)) * 100)}%`),
            });
            verifyExtensionPackage(file, release);
            signal.throwIfAborted();
            if (this.isBusy())
              throw new Error(
                t(
                  'Stop running games and servers before updating the extension.',
                  '请先停止正在运行的游戏和服务端，再更新插件。',
                ),
              );
            await vscode.commands.executeCommand(
              'workbench.extensions.installExtension',
              vscode.Uri.file(file),
            );
          } finally {
            await fs.rm(stage, { recursive: true, force: true });
          }
        },
        () => this.check(),
      );
    } catch (error) {
      if (
        (error as Error).name === 'AbortError' ||
        (error as Error).message === 'Cancelled' ||
        (error as Error).message === '已取消'
      )
        return;
      const open = t('Open release page', '打开下载页');
      if (
        (await vscode.window.showErrorMessage(
          t(
            'The update could not be installed. You can download it from the release page.',
            '更新未能安装，可前往发布页下载。',
          ),
          open,
        )) === open
      )
        await this.open(release.page);
      return;
    } finally {
      await net.close();
    }
    this.pendingVersion = release.version;
    if (this.enabled && !featureSignal.aborted) void this.offerReload().catch(() => {});
  }
  private async offerReload() {
    const reload = t('Reload window', '重新加载窗口');
    if (
      (await vscode.window.showInformationMessage(
        t(
          'Update installed. Reload the window when ready.',
          '更新已安装，可在准备好后重新加载窗口。',
        ),
        reload,
      )) === reload
    ) {
      if (!this.isBusy()) await vscode.commands.executeCommand('workbench.action.reloadWindow');
      else
        await vscode.window.showInformationMessage(
          t(
            'Stop running games and servers before reloading.',
            '请先停止正在运行的游戏和服务端，再重新加载。',
          ),
        );
    }
  }
}
