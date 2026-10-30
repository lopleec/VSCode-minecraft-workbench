import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { Agent, request } from 'undici';
import { x as untar } from 'tar';
import type * as vscode from 'vscode';
import { config, t } from './config';
import { exists, filename, readJson } from './files';
import { Network } from './network';
import notice from './terracotta-notice.json';

const consentKey = 'minecraftWorkbench.terracotta.agreement';
const componentKey = 'minecraftWorkbench.terracotta.component';
const release = 'v0.4.2';
interface Component {
  executable: string;
  installer?: string;
  version: string;
}
interface Acceptance {
  version: string;
  license: true;
  network: true;
  acceptedAt: string;
}
interface RemoteState {
  state: string;
  room?: string;
  url?: string;
  type?: number;
  profiles?: { name?: string }[];
}
export interface TerracottaStatus {
  enabled: boolean;
  accepted: boolean;
  noticeVersion: string;
  connected: boolean;
  state: string;
  version?: string;
  room?: string;
  address?: string;
  error?: string;
  players: string[];
  executable?: string;
  installer?: string;
}
export function roomCode(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Enter a Terracotta room code.');
  const code = value.trim().toUpperCase();
  if (!/^U\/[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(code))
    throw new Error('Use a Terracotta U/XXXX-XXXX-XXXX-XXXX room code.');
  return code;
}
export class Terracotta implements vscode.Disposable {
  private acceptance?: Partial<Acceptance>;
  private component?: Component;
  private endpoint?: string;
  private child?: ChildProcess;
  private processError?: Error;
  private handshake?: string;
  private poll?: NodeJS.Timeout;
  private polling?: Promise<void>;
  private lifecycle = new AbortController();
  private connecting?: Promise<void>;
  private ownsRoom = false;
  private remote: RemoteState = { state: 'disconnected' };
  private version?: string;
  private error?: string;
  private readonly agent = new Agent({ connections: 2, connect: { timeout: 2000 } });
  private readonly downloads = new Set<AbortController>();
  constructor(
    private readonly storage: Pick<vscode.Memento, 'get' | 'update'>,
    private readonly root: string,
    private readonly net: Network,
    private readonly changed: () => void,
    private readonly allowed: () => boolean,
  ) {
    this.acceptance = storage.get<Partial<Acceptance>>(consentKey);
    this.component = storage.get<Component>(componentKey);
  }
  get accepted() {
    return (
      this.acceptance?.version === notice.version &&
      this.acceptance.license === true &&
      this.acceptance.network === true &&
      typeof this.acceptance.acceptedAt === 'string' &&
      Number.isFinite(Date.parse(this.acceptance.acceptedAt))
    );
  }
  private get enabled() {
    return config<unknown>('terracotta.enabled', false) === true;
  }
  snapshot(): TerracottaStatus {
    return {
      enabled: this.enabled,
      accepted: this.accepted,
      noticeVersion: notice.version,
      connected: !!this.endpoint,
      state: this.remote.state,
      version: this.version,
      room: this.remote.room,
      address: this.address(),
      error: this.error,
      players: (this.remote.profiles || [])
        .flatMap((p) => (typeof p.name === 'string' ? [p.name.slice(0, 64)] : []))
        .slice(0, 50),
      executable: this.component?.executable,
      installer: this.component?.installer,
    };
  }
  private guard() {
    if (!this.allowed())
      throw new Error(
        t(
          'Accept the workbench agreements and trust this workspace first.',
          '请先确认工作台协议并信任工作区。',
        ),
      );
    if (!this.enabled)
      throw new Error(
        t('Enable Terracotta Beta in Settings first.', '请先在设置中开启陶瓦联机 Beta。'),
      );
    if (!this.accepted)
      throw new Error(
        t('Read and accept the Terracotta notices first.', '请先阅读并确认陶瓦联机须知。'),
      );
  }
  requireAvailable() {
    this.guard();
  }
  async installer() {
    this.guard();
    const file = this.component?.installer;
    if (!file || !file.endsWith('.pkg') || !(await exists(file)))
      throw new Error('Download the official Terracotta installer first.');
    return file;
  }
  async accept(value: Record<string, unknown>) {
    if (!this.allowed() || !this.enabled)
      throw new Error('Enable Terracotta Beta in Settings first.');
    if (value.version !== notice.version || value.license !== true || value.network !== true)
      throw new Error('Confirm both Terracotta notices to continue.');
    const record: Acceptance = {
      version: notice.version,
      license: true,
      network: true,
      acceptedAt: new Date().toISOString(),
    };
    await this.storage.update(consentKey, record);
    this.acceptance = record;
    this.changed();
  }
  async revoke() {
    await this.disconnect();
    await this.storage.update(consentKey, undefined);
    this.acceptance = undefined;
    this.changed();
  }
  async configurationChanged() {
    if (!this.enabled) await this.disconnect();
    this.changed();
  }
  async download(signal: AbortSignal, report: (message: string) => void) {
    this.guard();
    const controller = new AbortController();
    this.downloads.add(controller);
    try {
      return await this.prepareComponent(AbortSignal.any([signal, controller.signal]), report);
    } finally {
      this.downloads.delete(controller);
    }
  }
  private async prepareComponent(signal: AbortSignal, report: (message: string) => void) {
    const os = (
      { win32: 'windows', darwin: 'macos', linux: 'linux', freebsd: 'freebsd' } as Record<
        string,
        string
      >
    )[process.platform];
    const arch = (
      { x64: 'x86_64', arm64: 'arm64', loong64: 'loongarch64', riscv64: 'riscv64' } as Record<
        string,
        string
      >
    )[process.arch];
    if (!os || !arch)
      throw new Error('No official Terracotta build is available for this platform.');
    const data = await this.net.json<{
      assets: { name: string; browser_download_url: string; digest?: string; size: number }[];
    }>(`https://api.github.com/repos/burningtnt/Terracotta/releases/tags/${release}`, { signal });
    const name = `terracotta-${release.slice(1)}-${os}-${arch}-pkg.tar.gz`;
    const asset = data.assets?.find((a) => a.name === name);
    if (
      !asset ||
      !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ||
      asset.size > 128 * 1024 ** 2 ||
      !asset.browser_download_url.startsWith(
        'https://github.com/burningtnt/Terracotta/releases/download/',
      )
    )
      throw new Error('No verified Terracotta download is available.');
    this.guard();
    signal.throwIfAborted();
    const archive = path.join(this.root, 'cache', filename(name));
    report(name);
    await this.net.download(asset.browser_download_url, archive, {
      hash: asset.digest!.slice(7),
      algorithm: 'sha256',
      size: asset.size,
      signal,
      kind: 'terracotta',
    });
    this.guard();
    signal.throwIfAborted();
    const parent = path.join(this.root, 'tools', 'terracotta');
    await fs.mkdir(parent, { recursive: true });
    const stage = await fs.mkdtemp(path.join(parent, 'component-'));
    try {
      let size = 0;
      await untar({
        file: archive,
        cwd: stage,
        strict: true,
        filter: (entryPath, entry) => {
          signal.throwIfAborted();
          const relative = path.relative(stage, path.resolve(stage, entryPath));
          if (
            relative.startsWith('..' + path.sep) ||
            path.isAbsolute(relative) ||
            !('type' in entry) ||
            !['File', 'Directory', 'OldFile', 'ContiguousFile'].includes(entry.type)
          )
            throw new Error('Invalid Terracotta archive.');
          size += entry.size;
          if (size > 256 * 1024 ** 2) throw new Error('Terracotta archive exceeds size limit.');
          return true;
        },
      });
      const files = await fs.readdir(stage);
      const executable = files.find(
        (file) =>
          /^terracotta-/i.test(file) &&
          (process.platform === 'win32'
            ? file.endsWith('.exe')
            : !file.includes('.pkg') && !file.endsWith('.txt') && !file.endsWith('.md')),
      );
      if (!executable) throw new Error('Terracotta executable was not found in its package.');
      const component: Component = {
        executable: path.join(stage, executable),
        installer: files.find((file) => file.endsWith('.pkg'))
          ? path.join(stage, files.find((file) => file.endsWith('.pkg'))!)
          : undefined,
        version: release.slice(1),
      };
      if (process.platform !== 'win32') await fs.chmod(component.executable, 0o755);
      this.guard();
      signal.throwIfAborted();
      await this.storage.update(componentKey, component);
      this.component = component;
      this.changed();
      return component;
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true });
      throw error;
    }
  }
  private async executable() {
    let value = config('terracotta.executable', '').trim() || this.component?.executable;
    if (!value && process.platform === 'darwin')
      value = '/Applications/terracotta.app/Contents/MacOS/terracotta';
    if (!value || !path.isAbsolute(value) || !(await exists(value)))
      throw new Error('Download Terracotta or choose its executable first.');
    if (value.endsWith('.app')) value = path.join(value, 'Contents', 'MacOS', 'terracotta');
    if (!(await fs.stat(value)).isFile()) throw new Error('Choose the Terracotta executable.');
    if (
      process.platform === 'darwin' &&
      !(await exists('/Library/LaunchAgents/net.burningtnt.terracotta.daemon.plist'))
    )
      throw new Error('Install the official Terracotta package on macOS before connecting.');
    return value;
  }
  async connect(signal?: AbortSignal) {
    this.guard();
    if (this.endpoint) {
      await this.refresh();
      return;
    }
    if (this.connecting) return this.connecting;
    this.lifecycle = new AbortController();
    const active = signal
      ? AbortSignal.any([signal, this.lifecycle.signal])
      : this.lifecycle.signal;
    const work = this.start(active);
    this.connecting = work;
    try {
      await work;
    } finally {
      this.connecting = undefined;
    }
  }
  private async start(signal: AbortSignal) {
    const executable = await this.executable();
    this.guard();
    signal.throwIfAborted();
    const parent = path.join(this.root, 'cache', 'terracotta-sessions');
    await fs.mkdir(parent, { recursive: true });
    this.handshake = await fs.mkdtemp(path.join(parent, 'session-'));
    await fs.chmod(this.handshake, 0o700);
    const file = path.join(this.handshake, 'port.json');
    this.processError = undefined;
    const child = spawn(executable, ['--hmcl', file], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      cwd: path.dirname(executable),
    });
    this.child = child;
    child.on('error', (error) => {
      this.processError = error;
    });
    try {
      const deadline = Date.now() + 16000;
      while (Date.now() < deadline) {
        this.guard();
        signal.throwIfAborted();
        if (this.processError) throw this.processError;
        const data = await readJson<{ port: number } | undefined>(file, undefined);
        if (data) {
          if (!Number.isInteger(data.port) || data.port < 1 || data.port > 65535)
            throw new Error('Invalid Terracotta handshake.');
          this.endpoint = `http://127.0.0.1:${data.port}`;
          const meta = await this.local<{
            version: string;
            easytier_version: string;
            yggdrasil_port: number;
          }>('/meta', signal);
          if (
            !/^0\.4\./.test(meta.version) ||
            typeof meta.easytier_version !== 'string' ||
            !Number.isInteger(meta.yggdrasil_port)
          )
            throw new Error('Unsupported Terracotta local API.');
          this.version = meta.version;
          await this.refresh();
          this.guard();
          signal.throwIfAborted();
          this.poll = setInterval(() => {
            void this.refresh().catch((error) => {
              this.error = String(error);
              this.changed();
            });
          }, 2000);
          this.poll.unref();
          this.changed();
          return;
        }
        if (child.exitCode !== null && child.exitCode !== 0)
          throw new Error('Terracotta could not start. Check its installation.');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Terracotta did not provide its local API address in time.');
    } catch (error) {
      this.endpoint = undefined;
      this.child?.kill();
      this.child = undefined;
      this.error = String(error);
      this.changed();
      throw error;
    }
  }
  private async local<T>(suffix: string, signal?: AbortSignal): Promise<T> {
    if (!this.endpoint) throw new Error('Connect Terracotta first.');
    const response = await request(this.endpoint + suffix, {
      dispatcher: this.agent,
      signal,
      headersTimeout: 2500,
      bodyTimeout: 2500,
      headers: { accept: 'application/json' },
    });
    const text = await response.body.text();
    if (response.statusCode >= 400) throw new Error(`Terracotta API HTTP ${response.statusCode}`);
    if (Buffer.byteLength(text) > 2 * 1024 ** 2) throw new Error('Invalid Terracotta response.');
    return (text ? JSON.parse(text) : undefined) as T;
  }
  async refresh() {
    this.guard();
    if (!this.endpoint) return;
    if (this.polling) return this.polling;
    const work = (async () => {
      const state = await this.local<RemoteState>('/state', this.lifecycle.signal);
      if (
        ![
          'waiting',
          'host-scanning',
          'host-starting',
          'host-ok',
          'guest-connecting',
          'guest-starting',
          'guest-ok',
          'exception',
        ].includes(state.state)
      )
        throw new Error('Unsupported Terracotta state.');
      this.remote = state;
      this.error = undefined;
      this.changed();
    })();
    this.polling = work;
    try {
      await work;
    } finally {
      this.polling = undefined;
    }
  }
  private query(params: Record<string, string>, nodes: string[]) {
    const query = new URLSearchParams(params);
    for (const node of nodes) {
      const url = new URL(node);
      if (
        !['tcp:', 'udp:', 'ws:', 'wss:', 'wg:', 'quic:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error('Invalid Terracotta relay URL.');
      query.append('public_nodes', node);
    }
    return query.toString();
  }
  async host(player?: string) {
    this.guard();
    await this.refresh();
    if (this.remote.state !== 'waiting')
      throw new Error('Leave the current Terracotta room first.');
    const query = this.query(
      player ? { player } : {},
      config<string[]>('terracotta.publicNodes', []),
    );
    this.guard();
    await this.local(`/state/scanning?${query}`, this.lifecycle.signal);
    this.ownsRoom = true;
    await this.refresh();
  }
  async join(code: unknown, player?: string) {
    const room = roomCode(code);
    this.guard();
    await this.refresh();
    if (this.remote.state !== 'waiting')
      throw new Error('Leave the current Terracotta room first.');
    const query = this.query(
      { room, ...(player ? { player } : {}) },
      config<string[]>('terracotta.publicNodes', []),
    );
    this.guard();
    await this.local(`/state/guesting?${query}`, this.lifecycle.signal);
    this.ownsRoom = true;
    await this.refresh();
  }
  async leave() {
    this.guard();
    if (this.endpoint) await this.local('/state/ide');
    this.ownsRoom = false;
    await this.refresh();
  }
  address(): string | undefined {
    if (this.remote.state !== 'guest-ok' || typeof this.remote.url !== 'string') return;
    return /^127\.0\.0\.1(?::(?:[1-9]\d{0,4}))?$/.test(this.remote.url) &&
      Number(this.remote.url.split(':')[1] || 25565) <= 65535
      ? this.remote.url
      : undefined;
  }
  async disconnect() {
    for (const download of this.downloads) download.abort();
    clearInterval(this.poll);
    this.poll = undefined;
    this.lifecycle.abort();
    if (this.endpoint && this.ownsRoom) await this.local('/state/ide').catch(() => {});
    this.ownsRoom = false;
    this.endpoint = undefined;
    this.child?.kill();
    this.child = undefined;
    this.remote = { state: 'disconnected' };
    if (this.handshake)
      await fs.rm(this.handshake, { recursive: true, force: true }).catch(() => {});
    this.handshake = undefined;
    this.changed();
  }
  async close() {
    await this.disconnect();
    await this.agent.close();
  }
  dispose() {
    void this.close();
  }
}
