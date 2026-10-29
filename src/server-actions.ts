import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
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
import { exists, filename, rejectSymlinkParents } from './files';
import { Jobs } from './jobs';

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
  private async start(server: ServerProfile) {
    if (server.engine !== 'velocity' && !server.eulaAccepted) {
      if (
        !(await this.confirm(
          t(
            'Starting this server requires acceptance of the Minecraft EULA: https://www.minecraft.net/en-us/eula',
            '启动此服务端需要同意 Minecraft EULA：https://www.minecraft.net/en-us/eula',
          ),
          t('Accept and start', '同意并启动'),
        ))
      )
        return false;
      server.eulaAccepted = true;
      await this.servers.store.save();
    }
    await this.servers.start(server);
    return true;
  }
  async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
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
        Object.assign(server, update);
        try {
          await this.servers.store.save();
        } catch (error) {
          Object.assign(server, old);
          throw error;
        }
        await this.servers.properties(server, properties);
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
          t('Back up server worlds', '备份服务端存档'),
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
          t('Restore server worlds', '恢复服务端存档'),
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
              t(`Update ${item.name}`, `更新 ${item.name}`),
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
        return vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(server.directory));
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
        if (server.engine !== 'custom')
          throw new Error('JAR import is available for custom servers');
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { JAR: ['jar'] },
        });
        if (!selected?.[0]) return false;
        return this.servers.exclusive(server, async () => {
          const zip = new AdmZip(selected[0].fsPath);
          const manifest = zip.getEntry('META-INF/MANIFEST.MF');
          if (!manifest || !/Main-Class:/i.test(manifest.getData().toString()))
            throw new Error('JAR has no Main-Class');
          const destination = path.join(server.directory, 'server.jar');
          await rejectSymlinkParents(server.directory, destination);
          if (await exists(destination))
            await fs.copyFile(
              destination,
              path.join(server.directory, '.workbench', 'server-previous.jar'),
            );
          await fs.copyFile(selected[0].fsPath, destination);
          server.installed = false;
          server.requiredJava = undefined;
          await this.servers.store.save();
          return true;
        });
      }
      case 'importContent': {
        const kind = serverEngines.find((e) => e.id === server.engine)?.content;
        if (!kind) throw new Error('This server does not support managed content');
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: { JAR: ['jar'] },
        });
        if (!selected?.length) return false;
        return this.servers.exclusive(server, () =>
          this.content.exclusive(target, async () => {
            const directory = path.join(server.directory, kind === 'plugin' ? 'plugins' : 'mods');
            await rejectSymlinkParents(server.directory, directory);
            await fs.mkdir(directory, { recursive: true });
            for (const file of selected) {
              const destination = path.join(directory, filename(path.basename(file.fsPath)));
              await rejectSymlinkParents(server.directory, destination);
              if (await exists(destination)) throw new Error('Filename already exists');
              await fs.copyFile(file.fsPath, destination, fs.constants.COPYFILE_EXCL);
            }
            return true;
          }),
        );
      }
      case 'version': {
        this.servers.assertIdle(server);
        if (server.engine === 'custom') return false;
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
          if (server.engine === 'velocity') server.softwareVersion = version;
          else server.minecraft = version;
          server.build = build?.label;
          server.installed = false;
          server.launchArgs = undefined;
          await this.servers.store.save();
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
