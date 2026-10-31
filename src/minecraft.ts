import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ChildProcess } from 'node:child_process';
import { Version, launch } from '@xmcl/core';
import { Store } from './store';
import { Network, HttpError } from './network';
import { Java, preferredJava } from './java';
import { Accounts } from './accounts';
import { Jobs } from './jobs';
import { Instance, Loader, VersionManifest } from './models';
import { config, t, trusted } from './config';
import { filename, readJson, redact, writeJson, exists } from './files';
import { runtimeDirectory, writeInstanceMetadata } from './game-paths';
import { prepareGameLanguage } from './game-language';
import { versionChain } from './instance-import';
import { neoForgePrefix } from './versions';
import { memorySettings } from './memory';
import { waitFor } from './abort';
import { launchPrecheck } from './launch-prechecks';
import { installRuntime } from './runtime-install';
import { RuntimeQueue } from './runtime-queue';

export class Minecraft {
  readonly running = new Map<string, ChildProcess>();
  private readonly runtimeQueue = new RuntimeQueue();
  private readonly installing = new Map<string, AbortController>();
  private readonly starting = new Map<string, AbortController>();
  constructor(
    private readonly store: Store,
    private readonly net: Network,
    private readonly java: Java,
    private readonly accounts: Accounts,
    private readonly jobs: Jobs,
    private readonly changed: () => void,
    private readonly repairPack?: (
      instance: Instance,
      signal: AbortSignal,
      report: (text: string) => void,
    ) => Promise<void>,
  ) {}
  async manifest(force = false, signal?: AbortSignal): Promise<VersionManifest> {
    signal?.throwIfAborted();
    const file = path.join(this.store.root, 'cache', 'manifest.json');
    const cached = await readJson<{ fetched: number; data: VersionManifest } | undefined>(
      file,
      undefined,
    );
    if (!force && cached && Date.now() - cached.fetched < 3600000) return cached.data;
    try {
      const data = await this.net.json<VersionManifest>(
        'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
        { signal },
      );
      if (!Array.isArray(data.versions)) throw new Error('Invalid version manifest');
      await writeJson(file, { fetched: Date.now(), data });
      return data;
    } catch (error) {
      signal?.throwIfAborted();
      if (cached && !force) return cached.data;
      throw error;
    }
  }
  async loaders(loader: Loader, minecraft: string, signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted();
    if (loader === 'vanilla') return [];
    if (loader === 'fabric' || loader === 'quilt') {
      const host = loader === 'fabric' ? 'https://meta.fabricmc.net' : 'https://meta.quiltmc.org';
      const versions = await this.net
        .json<
          { loader: { version: string } }[]
        >(`${host}/v${loader === 'fabric' ? 2 : 3}/versions/loader/${encodeURIComponent(minecraft)}`, { signal })
        .catch((error) => {
          if (error instanceof HttpError && [400, 404].includes(error.status)) return [];
          throw error;
        });
      return versions
        .map((v) => v.loader.version)
        .sort((a, b) => {
          const order = b.split('-')[0].localeCompare(a.split('-')[0], 'en', { numeric: true });
          return (
            order ||
            (a.includes('-') ? 1 : 0) - (b.includes('-') ? 1 : 0) ||
            b.localeCompare(a, 'en', { numeric: true })
          );
        });
    }
    if (loader === 'forge') {
      const xml = await this.net.text(
        'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
        { signal },
      );
      return [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((match) => match[1])
        .filter((v) => v.startsWith(minecraft + '-'))
        .map((v) => v.slice(minecraft.length + 1))
        .reverse();
    }
    const result = await this.net.json<{ versions: string[] }>(
      'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
      { signal },
    );
    const prefix = neoForgePrefix(minecraft);
    return prefix ? result.versions.filter((v) => v.startsWith(prefix)).reverse() : [];
  }
  async install(instance: Instance) {
    await trusted();
    this.assertIdle(instance);
    if (
      this.running.has(instance.id) ||
      this.installing.has(instance.id) ||
      this.starting.has(instance.id)
    )
      throw new Error(t('This instance is busy.', '实例正在运行或安装。'));
    const controller = new AbortController();
    this.installing.set(instance.id, controller);
    this.changed();
    try {
      await this.jobs.run(
        instance.installed
          ? t(`Repair ${instance.name}`, `修复 ${instance.name}`)
          : t(`Install ${instance.name}`, `安装 ${instance.name}`),
        async (jobSignal, report) => {
          const signal = AbortSignal.any([jobSignal, controller.signal]);
          report(t('Preparing shared game files', '准备共享游戏文件'));
          await this.runtimeQueue.run(runtimeDirectory(instance), signal, async () => {
            const result = await installRuntime(
              instance,
              {
                net: this.net,
                java: this.java,
                output: this.jobs.output,
                manifest: (signal) => this.manifest(false, signal),
                loaders: (loader, version, signal) => this.loaders(loader, version, signal),
              },
              signal,
              report,
            );
            await this.repairPack?.(instance, signal, report);
            signal.throwIfAborted();
            Object.assign(instance, result, { installed: true });
            await this.portableProfile(instance);
            await this.store.save();
          });
        },
        () => this.install(instance),
      );
    } finally {
      this.installing.delete(instance.id);
      this.changed();
    }
  }
  async start(instance: Instance, debug = false, serverOverride?: string) {
    await trusted();
    this.assertIdle(instance);
    if (this.running.has(instance.id) || this.installing.has(instance.id))
      throw new Error(t('This instance is busy.', '实例正在运行或安装。'));
    if (!instance.installed) await this.install(instance);
    if (this.starting.has(instance.id) || this.running.has(instance.id))
      throw new Error(t('This instance is busy.', '实例正在运行或安装。'));
    const controller = new AbortController();
    this.starting.set(instance.id, controller);
    this.changed();
    try {
      await this.jobs.run(
        t(`Start ${instance.name}`, `启动 ${instance.name}`),
        async (jobSignal, report) => {
          const signal = AbortSignal.any([jobSignal, controller.signal]);
          const phase = (message: string) => {
            signal.throwIfAborted();
            report(message);
            this.jobs.output.info(message);
          };
          const account = this.store.state.accounts.find(
            (a) => a.id === (instance.accountId || this.store.state.selectedAccount),
          );
          if (!account)
            throw new Error(t('Add and select an account first.', '请先添加并选择账户。'));
          const root = runtimeDirectory(instance);
          await prepareGameLanguage(instance);
          const version = await Version.parse(root, instance.versionId || instance.minecraft);
          phase(t('Preparing Java', '准备 Java'));
          const java = await this.java.ensure(
            version.javaVersion?.majorVersion || 8,
            signal,
            report,
            preferredJava(instance.java),
          );
          this.jobs.output.info(
            t(
              `Using Java ${java.major} (${java.version})`,
              `使用 Java ${java.major}（${java.version}）`,
            ),
          );
          phase(t('Preparing account', '准备账户'));
          const token = await waitFor(this.accounts.token(account), signal);
          const gc = instance.gc || config<string>('gc', 'default');
          const args = [
            ...(instance.jvmArgs || config<string[]>('jvmArgs', [])),
            ...(gc === 'g1' ? ['-XX:+UseG1GC'] : gc === 'zgc' ? ['-XX:+UseZGC'] : []),
          ];
          if (account.kind === 'authlib')
            args.push(...(await this.accounts.launchArguments(account, signal)));
          if (debug)
            args.push(
              '-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:5005',
            );
          const { minMemory, maxMemory } = memorySettings(instance);
          if (minMemory > maxMemory)
            throw new Error(
              t('Minimum memory exceeds maximum memory.', '最小内存不能大于最大内存。'),
            );
          const resolution = instance.resolution || {
            width: config('windowWidth', 1280),
            height: config('windowHeight', 720),
            fullscreen: config('fullscreen', false),
          };
          const supportsQuickPlay = version.arguments.game.some((argument) =>
            JSON.stringify(argument).includes('quickPlayMultiplayer'),
          );
          const address = serverOverride?.trim() || instance.server?.trim();
          const portMatch = address?.match(/^(.*):(\d+)$/);
          const game = await launch({
            gamePath: instance.directory,
            resourcePath: root,
            nativeRoot: path.join(
              instance.directory,
              '.workbench',
              'natives',
              filename(version.id),
            ),
            prechecks: [launchPrecheck(signal, phase)],
            version,
            javaPath: java.path,
            gameProfile: { id: account.profileId || account.id, name: account.name },
            accessToken: token,
            userType: account.kind === 'offline' ? 'legacy' : 'mojang',
            minMemory,
            maxMemory,
            resolution,
            ...(address
              ? supportsQuickPlay
                ? { quickPlayMultiplayer: address }
                : {
                    server: {
                      ip: portMatch ? portMatch[1] : address,
                      port: portMatch ? Number(portMatch[2]) : undefined,
                    },
                  }
              : {}),
            extraJVMArgs: args,
            extraMCArgs: instance.gameArgs || config('gameArgs', []),
            launcherName: 'Minecraft Workbench',
            launcherBrand: 'minecraft-workbench',
            extraExecOption: { windowsHide: true, signal },
          });
          this.running.set(instance.id, game);
          const startedAt = Date.now();
          instance.lastPlayed = new Date(startedAt).toISOString();
          this.changed();
          for (const stream of [game.stdout, game.stderr]) {
            if (!stream) continue;
            let pending = '';
            const print = (line: string) =>
              this.jobs.output.appendLine(
                redact(token === '0' ? line : line.split(token).join('[redacted]')),
              );
            stream.setEncoding('utf8');
            stream.on('data', (data: string) => {
              pending += data;
              let newline: number;
              while ((newline = pending.indexOf('\n')) >= 0) {
                print(pending.slice(0, newline));
                pending = pending.slice(newline + 1);
              }
              if (pending.length > 1024 ** 2) {
                this.jobs.output.appendLine(t('[Long log line omitted]', '[已省略超长日志行]'));
                pending = '';
              }
            });
            stream.once('end', () => {
              if (pending) print(pending);
            });
          }
          game.once('error', (error) => {
            this.jobs.output.error(redact(error.message));
            this.running.delete(instance.id);
            this.changed();
          });
          game.once('exit', (code) => {
            this.running.delete(instance.id);
            instance.playtimeSeconds =
              (instance.playtimeSeconds || 0) +
              Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            void this.store.save().catch((error) => this.jobs.output.error(redact(String(error))));
            this.changed();
            this.jobs.output.info(`${instance.name}: exit ${code}`);
            if (code && code !== 0)
              void vscode.window.showWarningMessage(
                t(
                  'Minecraft exited unexpectedly. Check the game logs.',
                  'Minecraft 异常退出，请查看游戏日志。',
                ),
              );
          });
          if (debug)
            await vscode.debug.startDebugging(undefined, {
              type: 'java',
              request: 'attach',
              name: 'Minecraft',
              hostName: '127.0.0.1',
              port: 5005,
            });
          await this.store.save();
          if (config('showOutputOnLaunch', false)) this.jobs.output.show(true);
        },
        () => this.start(instance, debug, serverOverride),
      );
    } finally {
      this.starting.delete(instance.id);
      this.changed();
    }
  }
  assertIdle(instance: Instance) {
    const aliases = [
      instance,
      ...this.store.state.instances.filter(
        (i) => i !== instance && path.resolve(i.directory) === path.resolve(instance.directory),
      ),
    ];
    if (
      aliases.some(
        (i) => this.running.has(i.id) || this.installing.has(i.id) || this.starting.has(i.id),
      )
    )
      throw new Error(
        t('Stop this instance before changing its files.', '修改文件前请先停止该实例。'),
      );
  }
  async stop(instance: Instance) {
    this.installing.get(instance.id)?.abort();
    this.starting.get(instance.id)?.abort();
    this.running.get(instance.id)?.kill('SIGTERM');
  }
  status(instance: Instance): 'running' | 'starting' | 'installing' | 'stopped' {
    return this.running.has(instance.id)
      ? 'running'
      : this.starting.has(instance.id)
        ? 'starting'
        : this.installing.has(instance.id)
          ? 'installing'
          : 'stopped';
  }
  get activeIds() {
    return [
      ...new Set([...this.running.keys(), ...this.starting.keys(), ...this.installing.keys()]),
    ];
  }
  async delete(instance: Instance) {
    this.assertIdle(instance);
    if (!instance.linked)
      await vscode.workspace.fs.delete(
        vscode.Uri.file(instance.containerDirectory || instance.directory),
        {
          recursive: true,
          useTrash: true,
        },
      );
    this.store.state.instances = this.store.state.instances.filter((i) => i.id !== instance.id);
    if (this.store.state.selectedInstance === instance.id)
      this.store.state.selectedInstance = this.store.state.instances[0]?.id;
    await this.store.save();
  }
  async logs(instance: Instance) {
    const log = path.join(instance.directory, 'logs', 'latest.log');
    await vscode.window.showTextDocument(vscode.Uri.file(log), { preview: true });
  }
  async ensureDirectory(instance: Instance) {
    await fs.mkdir(instance.directory, { recursive: true });
  }
  private async portableProfile(instance: Instance) {
    if (instance.linked) return;
    await writeInstanceMetadata(instance);
    if (instance.layout === 'multimc') return;
    const root = runtimeDirectory(instance);
    const id = path.basename(instance.directory);
    if (
      path.dirname(instance.directory) === path.join(root, 'versions') &&
      id !== instance.versionId
    ) {
      const chain = await versionChain(root, instance.versionId!);
      const file = path.join(instance.directory, `${filename(id)}.json`);
      if (!chain.some((p) => p.id === id) && !(await exists(file))) {
        await writeJson(file, { id, inheritsFrom: instance.versionId, type: 'custom' });
        instance.versionId = id;
      }
    }
  }
}
