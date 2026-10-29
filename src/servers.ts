import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as net from 'node:net';
import * as vscode from 'vscode';
import { spawn, execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import AdmZip from 'adm-zip';
import { Store } from './store';
import { Java } from './java';
import { Jobs } from './jobs';
import { Network } from './network';
import { ServerProfile, ServerEngine, JavaRuntime } from './models';
import { Minecraft } from './minecraft';
import { ServerCatalog, serverEngines } from './server-catalog';
import { ServerBackups } from './server-backups';
import { config, t, trusted } from './config';
import {
  exists,
  filename,
  readJson,
  redact,
  rejectSymlinkParents,
  within,
  writeText,
} from './files';
import {
  parseProperties,
  updateProperties,
  propertyDefaults,
  serverJvm,
  validateProperties,
} from './server-settings';

const exec = promisify(execFile);
interface Session {
  process: ChildProcess;
  phase: 'starting' | 'running' | 'stopping';
  closed: Promise<void>;
  output: vscode.OutputChannel;
}
export class Servers implements vscode.Disposable {
  readonly catalog: ServerCatalog;
  readonly backups = new ServerBackups();
  readonly running = new Map<string, Session>();
  private readonly busy = new Set<string>();
  private readonly logs = new Map<string, string[]>();
  private readonly outputs = new Map<string, vscode.OutputChannel>();
  private shuttingDown = false;
  constructor(
    readonly store: Store,
    readonly java: Java,
    private readonly jobs: Jobs,
    private readonly net: Network,
    minecraft: Minecraft,
    private readonly changed: () => void,
    private readonly spawnProcess: typeof spawn = spawn,
  ) {
    this.catalog = new ServerCatalog(net, minecraft);
  }
  get selected() {
    return this.store.state.servers.find((s) => s.id === this.store.state.selectedServer);
  }
  status(server: ServerProfile) {
    return (
      this.running.get(server.id)?.phase || (this.busy.has(server.id) ? 'preparing' : 'stopped')
    );
  }
  log(server: ServerProfile) {
    return this.logs.get(server.id) || [];
  }
  showLog(server: ServerProfile) {
    this.output(server).show(true);
  }
  private output(server: ServerProfile) {
    let output = this.outputs.get(server.id);
    if (!output) {
      output = vscode.window.createOutputChannel(`Minecraft Server: ${server.name}`);
      this.outputs.set(server.id, output);
    }
    return output;
  }
  private append(server: ServerProfile, line: string) {
    const text = redact(line.replace(/\x1b\[[0-9;]*m/g, ''));
    const lines = this.logs.get(server.id) || [];
    lines.push(text.slice(0, 16000));
    if (lines.length > 1000) lines.splice(0, lines.length - 1000);
    this.logs.set(server.id, lines);
    this.output(server).appendLine(text);
  }
  assertIdle(server: ServerProfile) {
    if (this.busy.has(server.id) || this.running.has(server.id))
      throw new Error(
        t('Stop the server before changing its files.', '请先停止服务端，再修改文件。'),
      );
  }
  private async lock(server: ServerProfile) {
    const target = path.join(server.directory, '.workbench', 'server.lock');
    await rejectSymlinkParents(server.directory, target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await fs.open(target, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
        return async () => {
          await handle.close();
          await fs.rm(target, { force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const existing = await readJson<{ pid: number }>(target).catch(() => undefined);
        let alive = true;
        if (existing && Number.isInteger(existing.pid) && existing.pid > 0) {
          try {
            process.kill(existing.pid, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') alive = false;
          }
        }
        if (!alive) {
          await fs.rm(target, { force: true });
          continue;
        }
        throw new Error(
          t(
            'This server is in use in another VS Code window.',
            '另一个 VS Code 窗口正在使用此服务端。',
          ),
        );
      }
    }
    throw new Error('Server lock unavailable');
  }
  async exclusive<T>(server: ServerProfile, work: () => Promise<T>) {
    await trusted();
    this.assertIdle(server);
    this.busy.add(server.id);
    this.changed();
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.lock(server);
      return await work();
    } finally {
      try {
        await release?.();
      } finally {
        this.busy.delete(server.id);
        this.changed();
      }
    }
  }
  async create(value: Record<string, unknown>): Promise<ServerProfile> {
    await trusted();
    const engine = value.engine as ServerEngine;
    if (!serverEngines.some((e) => e.id === engine)) throw new Error('Unknown server software');
    const name = String(value.name || '').trim();
    if (!name || name.length > 100 || /[\r\n\0]/.test(name)) throw new Error('Invalid server name');
    const version = String(value.version || '');
    if (!(await this.catalog.versions(engine)).includes(version))
      throw new Error('Server version not found');
    const builds = await this.catalog.builds(engine, version);
    const build = value.build
      ? builds.find((b) => b.id === value.build)
      : builds.find((b) => b.stable);
    if (builds.length && !build)
      throw new Error(t('Select a server build.', '请选择服务端构建版本。'));
    if (!['vanilla', 'custom'].includes(engine) && !build)
      throw new Error('No compatible server builds');
    const parent = String(
      value.parent || config('serverDirectory', '') || path.join(this.store.root, 'servers'),
    );
    if (!path.isAbsolute(parent) || parent.includes('\0'))
      throw new Error('Server directory must be absolute');
    let minecraft = version;
    if (engine === 'velocity') {
      minecraft = String(value.minecraft || '') || (await this.catalog.latestGameVersion());
      await this.catalog.metadata(minecraft);
    }
    const id = randomUUID();
    const directory = path.join(parent, id);
    await rejectSymlinkParents(parent, directory);
    await fs.mkdir(parent, { recursive: true });
    await fs.mkdir(directory, { recursive: false });
    const server: ServerProfile = {
      id,
      name,
      engine,
      minecraft,
      ...(engine === 'velocity' ? { softwareVersion: version } : {}),
      build: build?.id,
      directory,
      createdAt: new Date().toISOString(),
    };
    this.store.state.servers.push(server);
    const previous = this.store.state.selectedServer;
    this.store.state.selectedServer = id;
    try {
      await this.store.save();
    } catch (error) {
      this.store.state.servers = this.store.state.servers.filter((s) => s.id !== id);
      this.store.state.selectedServer = previous;
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
    return server;
  }
  private async prepareJava(
    server: ServerProfile,
    signal: AbortSignal,
    report: (text: string) => void,
  ) {
    const metadata = server.requiredJava
      ? undefined
      : await this.catalog.metadata(server.minecraft, signal);
    server.requiredJava ??= Math.max(
      server.engine === 'velocity' ? 21 : 8,
      metadata?.javaVersion?.majorVersion || 8,
    );
    let bytecodeJava = 8;
    const jar = path.join(server.directory, 'server.jar');
    if (
      ['custom', 'velocity'].includes(server.engine) &&
      (await exists(jar)) &&
      (await fs.stat(jar)).size < 512 * 1024 ** 2
    ) {
      try {
        const zip = new AdmZip(jar);
        const manifest = zip.getEntry('META-INF/MANIFEST.MF');
        if (manifest && manifest.header.size < 65536) {
          const main = /^Main-Class:\s*(\S+)/im.exec(
            manifest
              .getData()
              .toString()
              .replace(/\r?\n /g, ''),
          )?.[1];
          const entry = main ? zip.getEntry(main.replace(/\./g, '/') + '.class') : undefined;
          if (entry && entry.header.size < 4 * 1024 ** 2) {
            const bytes = entry.getData();
            if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0xcafebabe)
              bytecodeJava = bytes.readUInt16BE(6) - 44;
          }
        }
      } catch {
        /* The JVM reports invalid custom archives on launch. */
      }
    }
    const major = server.javaMajor || Math.max(server.requiredJava, bytecodeJava);
    return this.java.ensure(
      major,
      signal,
      report,
      server.java || config('javaPath', '') || undefined,
    );
  }
  private async installCore(
    server: ServerProfile,
    signal: AbortSignal,
    report: (text: string) => void,
  ) {
    if (server.engine === 'custom') {
      if (!(await exists(path.join(server.directory, 'server.jar'))))
        throw new Error(t('Import a server JAR first.', '请先导入服务端 JAR。'));
      server.launchArgs = ['-jar', 'server.jar', 'nogui'];
    } else {
      const artifact = await this.catalog.artifact(server, signal);
      const stage = path.join(server.directory, '.workbench', 'install');
      await rejectSymlinkParents(server.directory, stage);
      await fs.mkdir(stage, { recursive: true });
      const jar = path.join(stage, artifact.installer ? 'installer.jar' : 'server.jar');
      await this.net.download(artifact.url, jar, {
        signal,
        hash: artifact.hash,
        algorithm: artifact.algorithm,
        size: artifact.size,
        kind: 'server',
        progress: (n, total) =>
          report(`${Math.round(n / 1024 ** 2)} / ${Math.round(total / 1024 ** 2)} MB`),
      });
      if (artifact.installer) {
        const java = await this.prepareJava(server, signal, report);
        let args = ['-jar', jar, '--installServer'];
        if (artifact.installer === 'quilt')
          args = [
            '-jar',
            jar,
            'install',
            'server',
            server.minecraft,
            server.build!,
            '--download-server',
            `--install-dir="${server.directory}"`,
          ];
        report(t('Installing server dependencies…', '安装服务端依赖…'));
        const installing = exec(java.path, args, {
          cwd: server.directory,
          signal,
          windowsHide: true,
          maxBuffer: 32 * 1024 ** 2,
          timeout: 15 * 60 * 1000,
        });
        for (const stream of [installing.child.stdout, installing.child.stderr])
          stream?.on('data', (chunk: string | Buffer) => {
            const lines = String(chunk).split(/\r?\n/).filter(Boolean);
            for (const line of lines) this.append(server, line);
            const last = lines.at(-1);
            if (last) report(last.slice(0, 180));
          });
        await installing;
        if (artifact.installer === 'quilt')
          server.launchArgs = ['-jar', 'quilt-server-launch.jar', 'nogui'];
        else {
          const artifactName = server.engine === 'forge' ? 'forge' : 'neoforge';
          const full =
            server.engine === 'forge' ? `${server.minecraft}-${server.build}` : server.build!;
          const arg = path.posix.join(
            'libraries',
            server.engine === 'forge' ? 'net/minecraftforge' : 'net/neoforged',
            artifactName,
            full,
            process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt',
          );
          if (await exists(within(server.directory, arg))) server.launchArgs = ['@' + arg, 'nogui'];
          else {
            const candidates = (await fs.readdir(server.directory)).filter(
              (name) =>
                name.startsWith('forge-') && name.endsWith('.jar') && !name.includes('installer'),
            );
            const jarName = candidates.find((name) => name.includes(full));
            if (!jarName) throw new Error('Installer did not produce a server launch file');
            server.launchArgs = ['-jar', filename(jarName), 'nogui'];
          }
        }
      } else {
        await rejectSymlinkParents(server.directory, path.join(server.directory, 'server.jar'));
        await fs.copyFile(jar, path.join(server.directory, 'server.jar'));
        server.launchArgs = [
          '-jar',
          'server.jar',
          ...(server.engine === 'velocity' ? [] : ['nogui']),
        ];
      }
    }
    signal.throwIfAborted();
    await this.properties(server, {});
    const java = await this.prepareJava(server, signal, report);
    server.installed = true;
    await this.store.save();
    return java;
  }
  async install(server: ServerProfile): Promise<JavaRuntime> {
    return this.exclusive(server, () =>
      this.jobs.run(
        t(`Install ${server.name}`, `安装 ${server.name}`),
        (signal, report) => this.installCore(server, signal, report),
        () => this.install(server),
      ),
    );
  }
  async properties(server: ServerProfile, values?: Record<string, string>) {
    if (server.engine === 'velocity') return {};
    const file = path.join(server.directory, 'server.properties');
    await rejectSymlinkParents(server.directory, file);
    const text = await fs.readFile(file, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (values) {
      const initial = Object.keys(parseProperties(text)).length
        ? {}
        : { ...propertyDefaults, 'server-ip': config('serverBindAddress', '127.0.0.1') };
      await writeText(file, updateProperties(text, { ...initial, ...validateProperties(values) }));
    }
    const parsed = parseProperties(values ? await fs.readFile(file, 'utf8') : text);
    return Object.fromEntries(
      Object.keys(propertyDefaults).map((k) => [k, parsed[k] ?? propertyDefaults[k]]),
    );
  }
  async start(server: ServerProfile) {
    await trusted();
    if (this.shuttingDown) throw new Error('VS Code is shutting down');
    this.assertIdle(server);
    this.busy.add(server.id);
    this.changed();
    let release: (() => Promise<void>) | undefined;
    try {
      release = await this.lock(server);
      if (server.engine !== 'velocity' && !server.eulaAccepted)
        throw new Error(
          t(
            'Accept the Minecraft EULA for this server before starting it.',
            '请先为此服务端确认 Minecraft EULA。',
          ),
        );
      const java = await this.jobs.run(
        t(`Prepare ${server.name}`, `准备 ${server.name}`),
        async (signal, report) =>
          server.installed
            ? this.prepareJava(server, signal, report)
            : this.installCore(server, signal, report),
        () => this.start(server),
      );
      if (this.shuttingDown) throw new Error('VS Code is shutting down');
      if (!server.launchArgs?.length) throw new Error('Install or repair the server first');
      if (server.engine !== 'velocity') {
        const props = await this.properties(server);
        await checkPort(Number(props['server-port']), props['server-ip'] || '0.0.0.0');
        const eula = path.join(server.directory, 'eula.txt');
        await rejectSymlinkParents(server.directory, eula);
        await fs.writeFile(eula, 'eula=true\n', 'utf8');
      }
      const child = this.spawnProcess(java.path, [...serverJvm(server), ...server.launchArgs], {
        cwd: server.directory,
        stdio: 'pipe',
        windowsHide: true,
      });
      let resolveClosed!: () => void;
      const closed = new Promise<void>((resolve) => {
        resolveClosed = resolve;
      });
      const session: Session = {
        process: child,
        closed,
        output: this.output(server),
        phase: 'starting',
      };
      this.running.set(server.id, session);
      const unlock = release;
      release = undefined;
      let ended = false;
      const finish = async () => {
        if (ended) return;
        ended = true;
        try {
          await unlock();
        } catch (e) {
          this.jobs.output.error(String(e));
        } finally {
          this.running.delete(server.id);
          resolveClosed();
          this.changed();
        }
      };
      child.once('error', (error) => {
        this.append(server, error.message);
        void finish();
      });
      child.once('close', (code) => {
        this.append(
          server,
          t(`Server exited (${code ?? 'signal'}).`, `服务端已退出（${code ?? '信号'}）。`),
        );
        void finish();
      });
      for (const stream of [child.stdout, child.stderr]) {
        const decoder = new StringDecoder('utf8');
        let pending = '';
        stream?.on('data', (chunk: Buffer) => {
          pending += decoder.write(chunk);
          const lines = pending.split(/\r?\n/);
          pending = lines.pop()!.slice(-16000);
          for (const line of lines) {
            this.append(server, line);
            if (
              /Done \([\d.,]+s\)|Listening on|Listening for connections/i.test(line) &&
              session.phase === 'starting'
            ) {
              session.phase = 'running';
              this.changed();
            }
          }
        });
        stream?.once('end', () => {
          pending += decoder.end();
          if (pending) this.append(server, pending);
        });
      }
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      server.lastStarted = new Date().toISOString();
      await this.store.save();
    } finally {
      try {
        await release?.();
      } finally {
        this.busy.delete(server.id);
        this.changed();
      }
    }
  }
  async command(server: ServerProfile, command: string) {
    await trusted();
    if (!command.trim() || command.length > 4096 || /[\r\n\0]/.test(command))
      throw new Error('Enter a single server command');
    const session = this.running.get(server.id);
    if (!session || session.phase === 'stopping' || !session.process.stdin?.writable)
      throw new Error(t('The server is not accepting commands.', '服务端当前无法接收命令。'));
    await new Promise<void>((resolve, reject) =>
      session.process.stdin!.write(command.replace(/^\//, '') + '\n', (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  async stop(server: ServerProfile) {
    const session = this.running.get(server.id);
    if (!session) return;
    if (session.phase !== 'stopping') {
      await this.command(server, server.engine === 'velocity' ? 'shutdown' : 'stop');
      session.phase = 'stopping';
      this.changed();
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      session.closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 15000);
      }),
    ]);
    clearTimeout(timer);
    if (this.running.has(server.id))
      throw new Error(
        t(
          'Server is still saving or stopping. Check the console; force stop is available separately.',
          '服务端仍在保存或停止，请查看控制台；可另行强制停止。',
        ),
      );
  }
  forceStop(server: ServerProfile) {
    const session = this.running.get(server.id);
    session?.process.kill('SIGKILL');
  }
  async close() {
    this.shuttingDown = true;
    await Promise.allSettled(
      [...this.running.keys()].map((id) =>
        this.stop(this.store.state.servers.find((s) => s.id === id)!),
      ),
    );
  }
  dispose() {
    for (const session of this.running.values()) session.process.stdin?.write('stop\n');
    for (const output of this.outputs.values()) output.dispose();
  }
}
export async function checkPort(port: number, host: string) {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once('error', (error) =>
      reject(
        new Error(
          t(
            `Cannot bind ${host}:${port}: ${error.message}`,
            `无法绑定 ${host}:${port}：${error.message}`,
          ),
        ),
      ),
    );
    socket.listen(port, host, () => socket.close((error) => (error ? reject(error) : resolve())));
  });
}
