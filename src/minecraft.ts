import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'node:child_process';
import { launch, type LaunchOption } from '@xmcl/core';
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
import { neoForgePrefix } from './versions';
import { memorySettings } from './memory';
import { waitFor } from './abort';
import { launchPrecheck } from './launch-prechecks';
import { installRuntime } from './runtime-install';
import { RuntimeQueue } from './runtime-queue';
import { resolveGameVersion, versionChain } from './version-profile';
import { isRuntimeReady } from './runtime-status';
import { gameJavaExecutable } from './game-java';
import { gameEnvironment } from './game-environment';

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
      report: (text: string, english?: string) => void,
    ) => Promise<void>,
    private readonly spawnGame: NonNullable<LaunchOption['spawn']> = (command, args, options) =>
      spawn(command, args || [], options || {}),
    private readonly contentBusy: (instance: Instance) => boolean = () => false,
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
          ? [`Repair ${instance.name}`, `修复 ${instance.name}`]
          : [`Install ${instance.name}`, `安装 ${instance.name}`],
        async (jobSignal, report) => {
          const signal = AbortSignal.any([jobSignal, controller.signal]);
          report(
            t('Preparing shared game files', '准备共享游戏文件'),
            'Preparing shared game files',
          );
          await this.runtimeQueue.run(runtimeDirectory(instance), signal, async () => {
            const ready =
              !instance.installed &&
              instance.preserveVersion &&
              (await isRuntimeReady(instance, signal));
            const result = ready
              ? { versionId: instance.versionId!, loaderVersion: instance.loaderVersion }
              : await installRuntime(
                  instance,
                  {
                    net: this.net,
                    java: this.java,
                    output: this.jobs.output,
                    instances: this.store.state.instances,
                    manifest: (signal) => this.manifest(false, signal),
                    loaders: (loader, version, signal) => this.loaders(loader, version, signal),
                  },
                  signal,
                  report,
                );
            if (!ready) await this.repairPack?.(instance, signal, report);
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
        [`Start ${instance.name}`, `启动 ${instance.name}`],
        async (jobSignal, report) => {
          const signal = AbortSignal.any([jobSignal, controller.signal]);
          const phase = (message: string, chinese = message) => {
            signal.throwIfAborted();
            this.jobs.output.info(`[${instance.name}] ${message}`);
            report(t(message, chinese), message);
          };
          this.jobs.output.info(
            redact(
              `[${instance.name}] Minecraft ${instance.minecraft}, ${instance.loader} ${instance.loaderVersion || ''}\nGame: ${instance.directory}\nRuntime: ${runtimeDirectory(instance)}`,
            ),
          );
          const account = this.store.state.accounts.find(
            (a) => a.id === (instance.accountId || this.store.state.selectedAccount),
          );
          if (!account)
            throw new Error(t('Add and select an account first.', '请先添加并选择账户。'));
          const root = runtimeDirectory(instance);
          await prepareGameLanguage(instance);
          const version = await resolveGameVersion(
            root,
            instance.versionId || instance.minecraft,
            signal,
          );
          phase('Preparing Java', '准备 Java');
          const java = await this.java.ensure(
            version.javaVersion?.majorVersion || 8,
            signal,
            report,
            preferredJava(instance.java),
          );
          this.jobs.output.info(
            `[${instance.name}] Using Java ${java.major} (${java.version}): ${java.path}`,
          );
          phase('Preparing account', '准备账户');
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
          this.jobs.output.info(
            `[${instance.name}] JVM: ${minMemory}–${maxMemory} MB, GC: ${gc}, main: ${version.mainClass}, account: ${account.kind}`,
          );
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
          const executable = await gameJavaExecutable(java.path);
          const env = gameEnvironment(
            process.env,
            process.platform,
            config('linuxWindowSystem', 'auto'),
          );
          this.jobs.output.info(
            `[${instance.name}] Window environment: ${JSON.stringify(Object.fromEntries(['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_SESSION_TYPE', 'GDK_BACKEND', 'SDL_VIDEO_DRIVER', 'SDL_VIDEODRIVER'].filter((key) => env[key] !== undefined).map((key) => [key, env[key]])))}`,
          );
          this.jobs.output.info(`[${instance.name}] Java executable: ${executable}`);
          const game = await launch({
            spawn: (command, args, options) => {
              const invocation = JSON.stringify([command, ...(args || [])]);
              this.jobs.output.info(
                `[${instance.name}] Command: ${redact(token === '0' ? invocation : invocation.split(token).join('[redacted]'))}`,
              );
              return this.spawnGame(command, args, options);
            },
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
            javaPath: executable,
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
            // windowsHide also hides LWJGL game windows; javaw.exe avoids a separate console.
            extraExecOption: { windowsHide: false, signal, env },
          });
          this.running.set(instance.id, game);
          this.jobs.output.info(
            `[${instance.name}] Game process started (PID ${game.pid}). Window hiding: disabled.`,
          );
          const startedAt = Date.now();
          instance.lastPlayed = new Date(startedAt).toISOString();
          this.changed();
          for (const stream of [game.stdout, game.stderr]) {
            if (!stream) continue;
            let pending = '';
            const print = (line: string) =>
              this.jobs.output.appendLine(
                `[${instance.name}] ${redact(token === '0' ? line : line.split(token).join('[redacted]'))}`,
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
                this.jobs.output.appendLine('[Long log line omitted]');
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
          game.once('exit', (code, signal) => {
            this.running.delete(instance.id);
            instance.playtimeSeconds =
              (instance.playtimeSeconds || 0) +
              Math.max(0, Math.round((Date.now() - startedAt) / 1000));
            void this.store.save().catch((error) => this.jobs.output.error(redact(String(error))));
            this.changed();
            this.jobs.output.info(
              `[${instance.name}] Game process exited; code: ${code ?? 'none'}, signal: ${signal || 'none'}, elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
            );
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
    if (aliases.some(this.contentBusy))
      throw new Error(t('Content operation already in progress.', '内容操作正在进行。'));
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
