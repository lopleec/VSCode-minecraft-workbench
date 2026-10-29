import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { execFile, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { MinecraftFolder, Version, launch } from '@xmcl/core';
import {
  createNodeInstallRuntime,
  executeInstallManifest,
  executeInstallWorkflow,
  resolveMinecraftJarInstallFile,
  resolveLibraryInstallFiles,
  resolveAssetMetadataInstallFiles,
  resolveAssetObjectInstallFiles,
  createModernForgeInstallWorkflow,
  createLegacyForgeInstallWorkflow,
  InstallFile,
} from '@xmcl/installer';
import { Store } from './store';
import { Network, HttpError } from './network';
import { Java } from './java';
import { Accounts } from './accounts';
import { Jobs } from './jobs';
import { Instance, Loader, VersionManifest } from './models';
import { config, t, trusted } from './config';
import { filename, readJson, redact, writeJson } from './files';
import { neoForgePrefix } from './versions';
import { memorySettings } from './memory';

const exec = promisify(execFile);
export class Minecraft {
  readonly running = new Map<string, ChildProcess>();
  private readonly installing = new Set<string>();
  private readonly starting = new Set<string>();
  constructor(
    private readonly store: Store,
    private readonly net: Network,
    private readonly java: Java,
    private readonly accounts: Accounts,
    private readonly jobs: Jobs,
    private readonly changed: () => void,
  ) {}
  async manifest(force = false): Promise<VersionManifest> {
    const file = path.join(this.store.root, 'cache', 'manifest.json');
    const cached = await readJson<{ fetched: number; data: VersionManifest } | undefined>(
      file,
      undefined,
    );
    if (!force && cached && Date.now() - cached.fetched < 3600000) return cached.data;
    try {
      const data = await this.net.json<VersionManifest>(
        'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
      );
      if (!Array.isArray(data.versions)) throw new Error('Invalid version manifest');
      await writeJson(file, { fetched: Date.now(), data });
      return data;
    } catch (error) {
      if (cached && !force) return cached.data;
      throw error;
    }
  }
  async loaders(loader: Loader, minecraft: string): Promise<string[]> {
    if (loader === 'vanilla') return [];
    if (loader === 'fabric' || loader === 'quilt') {
      const host = loader === 'fabric' ? 'https://meta.fabricmc.net' : 'https://meta.quiltmc.org';
      const versions = await this.net
        .json<
          { loader: { version: string } }[]
        >(`${host}/v${loader === 'fabric' ? 2 : 3}/versions/loader/${encodeURIComponent(minecraft)}`)
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
      );
      return [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((match) => match[1])
        .filter((v) => v.startsWith(minecraft + '-'))
        .map((v) => v.slice(minecraft.length + 1))
        .reverse();
    }
    const result = await this.net.json<{ versions: string[] }>(
      'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
    );
    const prefix = neoForgePrefix(minecraft);
    return prefix ? result.versions.filter((v) => v.startsWith(prefix)).reverse() : [];
  }
  async install(instance: Instance) {
    await trusted();
    if (
      this.running.has(instance.id) ||
      this.installing.has(instance.id) ||
      this.starting.has(instance.id)
    )
      throw new Error(t('This instance is busy.', '实例正在运行或安装。'));
    this.installing.add(instance.id);
    try {
      await this.jobs.run(
        t(`Install ${instance.name}`, `安装 ${instance.name}`),
        async (signal, report) => {
          const root = path.join(instance.directory, '.runtime');
          const folder = new MinecraftFolder(root);
          const download = async (requested: InstallFile[]) => {
            const files = [...new Map(requested.map((file) => [file.path, file])).values()];
            let index = 0;
            let complete = 0;
            const batch = new AbortController();
            const downloadSignal = AbortSignal.any([signal, batch.signal]);
            const results = await Promise.allSettled(
              Array.from(
                { length: Math.min(this.net.options.concurrency, files.length) },
                async () => {
                  try {
                    while (index < files.length) {
                      downloadSignal.throwIfAborted();
                      const file = files[index++];
                      let success = false;
                      let lastError: unknown;
                      for (const url of file.urls) {
                        try {
                          await this.net.download(url, file.path, {
                            signal: downloadSignal,
                            hash: file.checksum?.value,
                            algorithm: file.checksum?.algorithm,
                            size: file.size,
                          });
                          success = true;
                          break;
                        } catch (error) {
                          lastError = error;
                          if (downloadSignal.aborted) throw error;
                        }
                      }
                      if (!success) throw lastError || new Error('No download URL');
                      report(`${++complete} / ${files.length}`);
                    }
                  } catch (error) {
                    batch.abort(error);
                    throw error;
                  }
                },
              ),
            );
            const failure = results.find(
              (r): r is PromiseRejectedResult => r.status === 'rejected',
            );
            if (failure) throw failure.reason;
          };
          const runtime = createNodeInstallRuntime({
            signal,
            download,
            runJava: async (command) => {
              const { stdout, stderr } = await exec(command.executable, command.args, {
                cwd: command.cwd,
                env: { ...process.env, ...command.env },
                signal,
                maxBuffer: 16 * 1024 ** 2,
                windowsHide: true,
              });
              this.jobs.output.append(redact(stdout + stderr));
            },
          });
          const installFiles = async (files: InstallFile[]) =>
            executeInstallManifest(
              { schemaVersion: 1, tasks: [{ id: 'files', type: 'files', files }] },
              runtime,
              { signal },
            );
          const manifest = await this.manifest();
          const entry = manifest.versions.find((v) => v.id === instance.minecraft);
          if (!entry) throw new Error('Minecraft version not found');
          filename(entry.id);
          await this.net.download(
            entry.url,
            path.join(root, 'versions', entry.id, `${entry.id}.json`),
            { hash: entry.sha1, signal, kind: 'manifest' },
          );
          let resolved = await Version.parse(root, entry.id);
          const jar = resolveMinecraftJarInstallFile(resolved);
          if (jar) await installFiles([jar]);
          await installFiles(resolveLibraryInstallFiles(resolved.libraries, folder));
          let versionId = entry.id;
          if (instance.loader !== 'vanilla') {
            const loaderVersion =
              instance.loaderVersion ||
              (await this.loaders(instance.loader, instance.minecraft))[0];
            if (!loaderVersion) throw new Error('No compatible loader version');
            filename(loaderVersion);
            if (instance.loader === 'fabric' || instance.loader === 'quilt') {
              const fabric = instance.loader === 'fabric';
              const host = fabric ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
              const profile = await this.net.json<{
                id: string;
                libraries?: (Version.Library & {
                  sha1?: string;
                  size?: number;
                  downloads?: { artifact: Version.Artifact };
                })[];
              }>(
                `${host}/versions/loader/${encodeURIComponent(entry.id)}/${encodeURIComponent(loaderVersion)}/profile/json`,
                { signal },
              );
              for (const library of profile.libraries || []) {
                if (library.sha1 && !library.downloads?.artifact) {
                  const resolved = Version.resolveLibrary(library);
                  if (resolved)
                    library.downloads = {
                      ...library.downloads,
                      artifact: {
                        ...resolved.download,
                        sha1: library.sha1,
                        size: library.size ?? -1,
                      },
                    };
                }
              }
              versionId = filename(profile.id);
              await writeJson(path.join(root, 'versions', versionId, `${versionId}.json`), profile);
            } else {
              const java = await this.java.ensure(
                resolved.javaVersion?.majorVersion || 8,
                signal,
                report,
                instance.java || config('javaPath', '') || undefined,
              );
              const neo = instance.loader === 'neoforge';
              const artifact = neo ? loaderVersion : `${entry.id}-${loaderVersion}`;
              const base = neo
                ? 'https://maven.neoforged.net/releases/net/neoforged/neoforge'
                : 'https://maven.minecraftforge.net/net/minecraftforge/forge';
              const name = neo ? 'neoforge' : 'forge';
              const installerFile: InstallFile = {
                path: path.join(root, 'installers', `${name}-${artifact}-installer.jar`),
                urls: [`${base}/${artifact}/${name}-${artifact}-installer.jar`],
                validator: 'zip',
              };
              const [major, minor] = entry.id.split('.').map(Number);
              if (!neo && major === 1 && minor < 13) {
                const workflow = createLegacyForgeInstallWorkflow({
                  id: 'forge',
                  minecraft: folder,
                  minecraftVersion: entry.id,
                  artifactVersion: artifact,
                  universal: {
                    ...installerFile,
                    urls: [`${base}/${artifact}/${name}-${artifact}-universal.jar`],
                    path: installerFile.path.replace('-installer.jar', '-universal.jar'),
                  },
                  installOptions: {},
                });
                versionId = await executeInstallWorkflow(workflow, runtime, { signal });
              } else {
                const workflow = createModernForgeInstallWorkflow({
                  id: name,
                  minecraft: folder,
                  minecraftVersion: entry.id,
                  installer: installerFile,
                  artifactVersion: artifact,
                  java: java.path,
                  installOptions: { java: java.path, signal },
                });
                versionId = (await executeInstallWorkflow(workflow, runtime, { signal })).version;
              }
            }
            instance.loaderVersion = loaderVersion;
            resolved = await Version.parse(root, versionId);
            await installFiles(resolveLibraryInstallFiles(resolved.libraries, folder));
          }
          await installFiles(resolveAssetMetadataInstallFiles(resolved, folder));
          await installFiles(await resolveAssetObjectInstallFiles(resolved, folder));
          signal.throwIfAborted();
          instance.versionId = versionId;
          instance.installed = true;
          await this.store.save();
        },
        () => this.install(instance),
      );
    } finally {
      this.installing.delete(instance.id);
      this.changed();
    }
  }
  async start(instance: Instance, debug = false) {
    await trusted();
    if (this.running.has(instance.id) || this.installing.has(instance.id))
      throw new Error(t('This instance is busy.', '实例正在运行或安装。'));
    if (!instance.installed) await this.install(instance);
    if (this.starting.has(instance.id) || this.running.has(instance.id))
      throw new Error(t('This instance is busy.', '实例正在运行或安装。'));
    this.starting.add(instance.id);
    try {
      const account = this.store.state.accounts.find(
        (a) => a.id === (instance.accountId || this.store.state.selectedAccount),
      );
      if (!account) throw new Error(t('Add and select an account first.', '请先添加并选择账户。'));
      const root = path.join(instance.directory, '.runtime');
      const version = await Version.parse(root, instance.versionId || instance.minecraft);
      const java = await this.jobs.run(t('Prepare Java', '准备 Java'), (signal, report) =>
        this.java.ensure(
          version.javaVersion?.majorVersion || 8,
          signal,
          report,
          instance.java || config('javaPath', '') || undefined,
        ),
      );
      const token = await this.accounts.token(account);
      const gc = instance.gc || config<string>('gc', 'default');
      const args = [
        ...(instance.jvmArgs || config<string[]>('jvmArgs', [])),
        ...(gc === 'g1' ? ['-XX:+UseG1GC'] : gc === 'zgc' ? ['-XX:+UseZGC'] : []),
      ];
      if (debug)
        args.push('-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:5005');
      const { minMemory, maxMemory } = memorySettings(instance);
      if (minMemory > maxMemory)
        throw new Error(t('Minimum memory exceeds maximum memory.', '最小内存不能大于最大内存。'));
      const resolution = instance.resolution || {
        width: config('windowWidth', 1280),
        height: config('windowHeight', 720),
        fullscreen: config('fullscreen', false),
      };
      const supportsQuickPlay = version.arguments.game.some((argument) =>
        JSON.stringify(argument).includes('quickPlayMultiplayer'),
      );
      const address = instance.server?.trim();
      const portMatch = address?.match(/^(.*):(\d+)$/);
      const game = await launch({
        gamePath: instance.directory,
        resourcePath: root,
        version,
        javaPath: java.path,
        gameProfile: account,
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
        extraExecOption: { windowsHide: true },
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
    } finally {
      this.starting.delete(instance.id);
      this.changed();
    }
  }
  assertIdle(instance: Instance) {
    if (
      this.running.has(instance.id) ||
      this.installing.has(instance.id) ||
      this.starting.has(instance.id)
    )
      throw new Error(
        t('Stop this instance before changing its files.', '修改文件前请先停止该实例。'),
      );
  }
  async stop(instance: Instance) {
    this.running.get(instance.id)?.kill('SIGTERM');
  }
  async delete(instance: Instance) {
    this.assertIdle(instance);
    await vscode.workspace.fs.delete(vscode.Uri.file(instance.directory), {
      recursive: true,
      useTrash: true,
    });
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
}
