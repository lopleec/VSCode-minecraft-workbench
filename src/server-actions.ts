import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Servers } from './servers';
import { ContentService } from './content';
import { ServerEngine, ServerProfile } from './models';
import { serverEngines } from './server-catalog';
import {
  serverTarget,
  validateServerRuntime,
  validateProperties,
  serverJvm,
} from './server-settings';
import { t } from './config';
import { exists, filename, rejectSymlinkParents, writeText } from './files';
import { Jobs } from './jobs';
import { manualServer } from './server-types';
import { inspectServer, importServer, readServerJar } from './server-import';
import { InstanceFiles } from './instance-files';

export class ServerActions {
  constructor(
    private readonly servers: Servers,
    private readonly content: ContentService,
    private readonly jobs: Jobs,
  ) {}
  private selected(params: Record<string, unknown>) {
    const server =
      params.serverId === undefined
        ? this.servers.selected
        : this.servers.store.state.servers.find((s) => s.id === params.serverId);
    if (!server) throw new Error(t('Select a server first.', '请先选择服务端。'));
    return server;
  }
  private async confirm(message: string, label = t('Continue', '继续')) {
    return (await vscode.window.showWarningMessage(message, { modal: true }, label)) === label;
  }
  private async localJars(value: unknown, many: boolean): Promise<string[] | undefined> {
    if (value === undefined) {
      const selected = await vscode.window.showOpenDialog({
        canSelectMany: many,
        filters: { JAR: ['jar'] },
      });
      value = selected?.map((file) => file.fsPath);
      if (!value) return;
    }
    const files = typeof value === 'string' && !many ? [value] : value;
    if (!Array.isArray(files) || files.length < 1 || files.length > (many ? 100 : 1))
      throw new Error(t('Select valid local JAR files.', '请选择有效的本地 JAR 文件。'));
    for (const file of files) {
      if (
        typeof file !== 'string' ||
        !path.isAbsolute(file) ||
        file.includes('\0') ||
        !/\.jar$/i.test(file)
      )
        throw new Error(t('Select valid local JAR files.', '请选择有效的本地 JAR 文件。'));
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 512 * 1024 ** 2)
        throw new Error(
          t('Select JAR files smaller than 512 MB.', '请选择小于 512 MB 的 JAR 文件。'),
        );
    }
    return files as string[];
  }
  private async start(server: ServerProfile) {
    if (server.engine !== 'velocity' && !server.eulaAccepted) {
      this.servers.store.state.selectedServer = server.id;
      await this.servers.store.save();
      await vscode.commands.executeCommand('minecraftWorkbench.reviewServerEula');
      return false;
    }
    await this.servers.start(server);
    return true;
  }
  async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === 'server.importJar' || method === 'server.importContent')
      return this.handle('server.action', { ...params, action: method.slice('server.'.length) });
    if (method === 'server.inspect') return inspectServer(String(params.directory || ''));
    if (method === 'server.import') {
      if (!params.value || typeof params.value !== 'object' || Array.isArray(params.value))
        throw new Error('Invalid server settings');
      return this.jobs.run(['Import server', '导入服务端'], (signal) =>
        importServer(this.servers.store, params.value as Record<string, unknown>, signal),
      );
    }
    if (method === 'server.catalog') {
      const engine = params.engine as ServerEngine;
      if (!serverEngines.some((e) => e.id === engine)) throw new Error('Unknown server software');
      return { engines: serverEngines, versions: await this.servers.catalog.versions(engine) };
    }
    if (method === 'server.builds') {
      const engine = params.engine as ServerEngine;
      if (!serverEngines.some((e) => e.id === engine)) throw new Error('Unknown server software');
      const version = String(params.version || '');
      if (!(await this.servers.catalog.versions(engine)).includes(version))
        throw new Error('Server version not found');
      return this.servers.catalog.builds(engine, version);
    }
    if (method === 'server.create') {
      if (!params.value || typeof params.value !== 'object')
        throw new Error('Invalid server settings');
      const server = await this.servers.create(params.value as Record<string, unknown>);
      if (params.start === true) await this.start(server);
      else if (params.install === true) await this.servers.install(server);
      return server;
    }
    const server = this.selected(params);
    const target = serverTarget(server);
    if (method === 'server.logs')
      return {
        status: this.servers.status(server),
        lines: this.servers
          .log(server)
          .slice(-Math.min(1000, Math.max(1, Number(params.limit) || 300))),
      };
    if (method === 'server.properties') return this.servers.properties(server);
    if (method === 'server.save') {
      if (!params.value || typeof params.value !== 'object')
        throw new Error('Invalid server settings');
      const update = validateServerRuntime(params.value as Record<string, unknown>);
      serverJvm({ ...server, ...update });
      const properties = validateProperties(params.properties || {});
      return this.servers.exclusive(server, async () => {
        const old = { ...server };
        const file = path.join(server.directory, 'server.properties');
        await rejectSymlinkParents(server.directory, file);
        const original =
          server.engine === 'velocity'
            ? undefined
            : await fs.readFile(file, 'utf8').catch((error) => {
                if (error.code === 'ENOENT') return undefined;
                throw error;
              });
        await this.servers.properties(server, properties);
        Object.assign(server, update);
        try {
          await this.servers.store.save();
        } catch (error) {
          for (const key of Object.keys(server))
            delete (server as unknown as Record<string, unknown>)[key];
          Object.assign(server, old);
          if (server.engine !== 'velocity') {
            if (original === undefined) await fs.rm(file, { force: true });
            else await writeText(file, original);
          }
          throw error;
        }
        return true;
      });
    }
    if (method === 'server.command') {
      await this.servers.command(server, String(params.command || ''));
      return true;
    }
    if (method === 'server.backups') return this.servers.backups.list(server);
    if (method === 'server.backup')
      return this.servers.exclusive(server, () =>
        this.jobs.run(
          ['Back up server worlds', '备份服务端存档'],
          async () => {
            const properties = await this.servers.properties(server);
            return this.servers.backups.create(server, properties['level-name'] || 'world');
          },
          () => this.handle(method, params),
        ),
      );
    if (method === 'server.restore') {
      if (
        !(await this.confirm(
          t(
            'Restore this backup? Current worlds will be backed up first.',
            '恢复此备份？当前存档会先自动备份。',
          ),
          t('Restore', '恢复'),
        ))
      )
        return false;
      return this.servers.exclusive(server, () =>
        this.jobs.run(
          ['Restore server worlds', '恢复服务端存档'],
          async () => {
            const properties = await this.servers.properties(server);
            await this.servers.backups.restore(
              server,
              String(params.id || ''),
              properties['level-name'] || 'world',
            );
            return true;
          },
          () => this.handle(method, params),
        ),
      );
    }
    if (method === 'server.content') {
      const action = String(params.action || 'list');
      if (action === 'list') return this.content.list(target);
      if (action === 'updates') return this.content.updates(target);
      if (action === 'conflicts') return this.content.conflicts(target);
      const item = (await this.content.list(target)).find(
        (c) => c.file === params.file && c.kind === params.kind,
      );
      if (!item) throw new Error('Content file not found');
      if (!['toggle', 'remove', 'update'].includes(action))
        throw new Error('Unknown content action');
      if (
        action === 'remove' &&
        !(await this.confirm(t(`Remove ${item.file}?`, `删除 ${item.file}？`), t('Remove', '删除')))
      )
        return false;
      return this.servers.exclusive(server, () =>
        this.content.exclusive(target, async () => {
          if (action === 'toggle') await this.content.toggle(target, item);
          else if (action === 'remove') await this.content.remove(target, item);
          else {
            const next = (await this.content.updates(target)).find(
              (u) => u.item.file === item.file && u.item.kind === item.kind,
            );
            if (!next) return false;
            await this.jobs.run(
              [`Update ${item.name}`, `更新 ${item.name}`],
              (signal, report) =>
                this.content.install(target, next.version, item.kind, signal, report),
              () => this.handle(method, params),
            );
          }
          return true;
        }),
      );
    }
    if (method !== 'server.action') throw new Error('Unknown server request');
    switch (params.action) {
      case 'select':
        this.servers.store.state.selectedServer = server.id;
        await this.servers.store.save();
        return true;
      case 'start':
        return this.start(server);
      case 'stop':
        await this.servers.stop(server);
        return true;
      case 'restart':
        await this.servers.stop(server);
        return this.start(server);
      case 'forceStop':
        if (
          await this.confirm(
            t(
              'Force stop this server? Unsaved world data may be lost.',
              '强制停止服务端？未保存的存档数据可能丢失。',
            ),
            t('Force stop', '强制停止'),
          )
        )
          this.servers.forceStop(server);
        return true;
      case 'install':
        await this.servers.install(server);
        return true;
      case 'log':
        this.servers.showLog(server);
        return true;
      case 'directory':
        return vscode.env.openExternal(vscode.Uri.file(server.directory));
      case 'config': {
        const file = path.join(
          server.directory,
          server.engine === 'velocity' ? 'velocity.toml' : 'server.properties',
        );
        if (!(await exists(file)))
          throw new Error(
            t(
              'Install or start the server to generate its configuration.',
              '请先安装或启动服务端以生成配置。',
            ),
          );
        return vscode.window.showTextDocument(vscode.Uri.file(file));
      }
      case 'importJar': {
        if (!manualServer(server.engine))
          throw new Error('JAR import is available for custom servers');
        const selected = await this.localJars(params.path, false);
        if (!selected?.[0]) return false;
        return this.servers.exclusive(server, async () => {
          const metadata = await readServerJar(selected[0]);
          const destination = path.join(server.directory, 'server.jar');
          await rejectSymlinkParents(server.directory, destination);
          const staging = path.join(server.directory, '.workbench', `server-${randomUUID()}.jar`);
          await fs.mkdir(path.dirname(staging), { recursive: true });
          const backup = path.join(server.directory, '.workbench', 'server-previous.jar');
          const existing = await exists(destination);
          const old = { ...server };
          let applied = false;
          try {
            await fs.copyFile(selected[0], staging);
            if (existing) await fs.copyFile(destination, backup);
            await fs.rename(staging, destination);
            applied = true;
            server.installed = false;
            server.requiredJava = metadata.javaMajor;
            server.launchArgs = ['-jar', 'server.jar', 'nogui'];
            await this.servers.store.save();
            return true;
          } catch (error) {
            for (const key of Object.keys(server))
              delete (server as unknown as Record<string, unknown>)[key];
            Object.assign(server, old);
            if (applied) {
              if (existing) await fs.copyFile(backup, destination);
              else await fs.rm(destination, { force: true });
            }
            throw error;
          } finally {
            await fs.rm(staging, { force: true });
          }
        });
      }
      case 'importContent': {
        const kind = serverEngines.find((e) => e.id === server.engine)?.content;
        if (!kind) throw new Error('This server does not support managed content');
        const selected = await this.localJars(params.paths, true);
        if (!selected?.length) return false;
        return this.servers.exclusive(server, () =>
          this.content.exclusive(target, async () => {
            await new InstanceFiles(this.servers.store, this.content).importLocal(
              target,
              kind,
              selected,
            );
            return true;
          }),
        );
      }
      case 'version': {
        this.servers.assertIdle(server);
        if (manualServer(server.engine)) return false;
        const versions = await this.servers.catalog.versions(server.engine);
        const version = await vscode.window.showQuickPick(versions, {
          title: t('Server version', '服务端版本'),
          ignoreFocusOut: true,
        });
        if (!version) return false;
        const builds = await this.servers.catalog.builds(server.engine, version);
        const build = builds.length
          ? await vscode.window.showQuickPick(
              builds.map((b) => ({
                label: b.id,
                description: b.stable ? '' : t('Experimental', '实验版'),
              })),
              { title: t('Server build', '服务端构建'), ignoreFocusOut: true },
            )
          : undefined;
        if (builds.length && !build) return false;
        if (
          !(await this.confirm(
            t(
              'Change server version? Back up worlds before upgrading. Older game versions may not read newer worlds.',
              '更改服务端版本？升级前请备份存档，旧版本可能无法读取新版本存档。',
            ),
          ))
        )
          return false;
        await this.servers.exclusive(server, async () => {
          const properties = await this.servers.properties(server);
          const level = properties['level-name'] || 'world';
          if (await exists(path.join(server.directory, filename(level))))
            await this.servers.backups.create(server, level);
          const previous = { ...server };
          if (server.engine === 'velocity') server.softwareVersion = version;
          else server.minecraft = version;
          server.build = build?.label;
          server.requiredJava = undefined;
          server.installed = false;
          server.launchArgs = undefined;
          try {
            await this.servers.store.save();
          } catch (error) {
            for (const key of Object.keys(server))
              delete (server as unknown as Record<string, unknown>)[key];
            Object.assign(server, previous);
            throw error;
          }
        });
        return this.servers.install(server);
      }
      case 'delete': {
        this.servers.assertIdle(server);
        if (
          !(await this.confirm(
            t(
              `Remove ${server.name} from the list? Its files will remain on disk.`,
              `从列表移除 ${server.name}？文件将保留在磁盘中。`,
            ),
            t('Remove', '移除'),
          ))
        )
          return false;
        return this.servers.exclusive(server, async () => {
          this.servers.store.state.servers = this.servers.store.state.servers.filter(
            (s) => s.id !== server.id,
          );
          await this.servers.store.save();
          return true;
        });
      }
      default:
        throw new Error('Unknown server action');
    }
  }
}
