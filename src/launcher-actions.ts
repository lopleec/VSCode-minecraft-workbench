import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Store } from './store';
import { Minecraft } from './minecraft';
import { UI } from './ui';
import { Instance, Loader } from './models';
import { InstanceSetup } from './setup';
import { config, t, trusted } from './config';
import { inspectJava } from './java';
import { Template } from './developer';
import { describeError } from './errors';
import { reserveNamedDirectory } from './game-paths';

export class LauncherActions {
  constructor(
    private readonly store: Store,
    private readonly minecraft: Minecraft,
    private readonly ui: UI,
  ) {}

  async handle(
    method: string,
    params: Record<string, unknown>,
    instance?: Instance,
  ): Promise<unknown> {
    const text = (key: string, limit = 4096) => {
      const value = params[key];
      if (typeof value !== 'string' || value.length > limit || value.includes('\0'))
        throw new Error(`Invalid ${key}`);
      return value.trim();
    };
    const selected = () => {
      if (!instance) throw new Error(t('Select an instance first.', '请先选择实例。'));
      return instance;
    };
    switch (method) {
      case 'launcher.gameVersions':
        return this.minecraft.manifest(params.force === true);
      case 'launcher.loaderVersions': {
        const loader = text('loader') as Loader;
        if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(loader))
          throw new Error('Invalid mod loader');
        const game = text('minecraft', 150);
        if (!(await this.minecraft.manifest()).versions.some((v) => v.id === game))
          throw new Error('Minecraft version not found');
        return this.minecraft.loaders(loader, game);
      }
      case 'launcher.pickDirectory': {
        const folders = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
        });
        return folders?.[0]?.fsPath;
      }
      case 'launcher.pickInstanceSource': {
        const source = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: true,
          canSelectMany: false,
          filters: { 'Instance ZIP': ['zip'] },
          title: t('Import existing instance', '导入现有实例'),
        });
        return source?.[0]?.fsPath;
      }
      case 'launcher.scanInstances':
        return this.ui.jobs.run(t('Find existing instances', '查找现有实例'), (signal) =>
          this.ui.imports.inspect(text('source'), signal),
        );
      case 'launcher.importInstance': {
        const mode = text('mode');
        if (mode !== 'link' && mode !== 'copy') throw new Error('Invalid import mode.');
        return this.ui.jobs.run(t('Import instance', '导入实例'), (signal) =>
          this.ui.imports.commit(
            text('key'),
            mode,
            signal,
            text('name', 100),
            params.root ? text('root') : undefined,
          ),
        );
      }
      case 'launcher.moveInstance': {
        const value = selected();
        this.minecraft.assertIdle(value);
        if (value.linked)
          throw new Error(
            t(
              'Duplicate this linked instance before moving its files.',
              '请先复制原地管理的实例，再移动文件。',
            ),
          );
        const folders = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: t('Move instance', '移动实例'),
        });
        if (!folders?.[0]) return false;
        const source = value.containerDirectory || value.directory;
        const parent = folders[0].fsPath;
        if (path.resolve(parent) === path.dirname(source)) return false;
        if (path.resolve(parent) === source || path.resolve(parent).startsWith(source + path.sep))
          throw new Error('Cannot move an instance inside itself.');
        await trusted();
        return this.ui.content.exclusive(value, async () => {
          this.minecraft.assertIdle(value);
          const target = await reserveNamedDirectory(parent, value.name);
          const previous = {
            directory: value.directory,
            containerDirectory: value.containerDirectory,
          };
          await fs.rmdir(target);
          await fs.rename(source, target);
          value.directory = value.containerDirectory
            ? path.join(target, path.relative(source, value.directory))
            : target;
          if (value.containerDirectory) value.containerDirectory = target;
          try {
            await this.store.save();
          } catch (error) {
            Object.assign(value, previous);
            await fs.rename(target, source);
            throw error;
          }
          return true;
        });
      }
      case 'launcher.saveSetup': {
        const save = async () => {
          const result = await new InstanceSetup(this.store, this.minecraft).save(
            params.value,
            params.edit === true ? selected() : undefined,
          );
          let installError: string | undefined;
          if (params.install === true) {
            try {
              await this.minecraft.install(result);
            } catch (error) {
              installError = describeError(error);
            }
          }
          return { instance: result, installError };
        };
        if (params.edit === true) return this.ui.content.exclusive(selected(), save);
        return save();
      }
      case 'launcher.clientId': {
        const clientId = text('value', 100);
        if (clientId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(clientId))
          throw new Error(
            t('Enter a Microsoft application Client ID.', '请输入 Microsoft 应用 Client ID。'),
          );
        await vscode.workspace
          .getConfiguration('minecraftWorkbench')
          .update('microsoftClientId', clientId, vscode.ConfigurationTarget.Global);
        return true;
      }
      case 'launcher.offlineAccount': {
        const name = text('name', 16);
        if (!/^[A-Za-z0-9_]{3,16}$/.test(name))
          throw new Error(
            t('Use 3–16 letters, numbers or underscores.', '请输入 3–16 位字母、数字或下划线。'),
          );
        await this.ui.accounts.offline(name);
        return true;
      }
      case 'launcher.signIn':
        await this.ui.jobs.run(t('Microsoft sign-in', 'Microsoft 登录'), (signal, report) =>
          this.ui.accounts.login(signal, report),
        );
        return true;
      case 'launcher.authlibSignIn':
        await this.ui.authlibLogin(typeof params.server === 'string' ? text('server') : undefined);
        return true;
      case 'launcher.accountAction': {
        const account = this.store.state.accounts.find((a) => a.id === text('id', 150));
        if (!account) throw new Error('Account not found');
        const action = text('action');
        if (action === 'use') {
          this.store.state.selectedAccount = account.id;
          await this.store.save();
        } else if (action === 'refresh') await this.ui.accounts.token(account);
        else if (action === 'remove') {
          const remove = t('Remove', '移除');
          if (
            (await vscode.window.showWarningMessage(
              t(`Remove account ${account.name}?`, `移除账户 ${account.name}？`),
              { modal: true },
              remove,
            )) === remove
          )
            await this.ui.accounts.remove(account);
        } else throw new Error('Unknown account action');
        return true;
      }
      case 'launcher.javaAction': {
        const action = text('action');
        if (action === 'detect') await this.ui.detectJava();
        else if (action === 'add') {
          if (!params.path) await this.ui.addJava();
          else {
            await trusted();
            const runtime = await inspectJava(text('path'));
            this.store.state.java = [
              ...this.store.state.java.filter((j) => j.path !== runtime.path),
              runtime,
            ];
            await this.store.save();
          }
        } else {
          const runtime = this.store.state.java.find((j) => j.path === text('path'));
          if (!runtime) throw new Error('Java runtime not found');
          if (action === 'default')
            await vscode.workspace
              .getConfiguration('minecraftWorkbench')
              .update('javaPath', runtime.path, vscode.ConfigurationTarget.Global);
          else if (action === 'reveal')
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(runtime.path));
          else throw new Error('Unknown Java action');
        }
        return true;
      }
      case 'launcher.downloadJava': {
        const major = Number(params.major);
        if (!Number.isInteger(major) || major < 8 || major > 99)
          throw new Error('Invalid Java version');
        await trusted();
        await this.ui.jobs.run(`Eclipse Temurin ${major}`, (signal, report) =>
          this.ui.java.download(major, signal, report),
        );
        return true;
      }
      case 'launcher.jobAction': {
        const job = this.ui.jobs.items.find((j) => j.id === text('id', 150));
        if (!job) throw new Error('Task not found');
        const action = text('action');
        if (action === 'cancel' && job.status === 'running')
          job.controller.abort(new Error(t('Cancelled', '已取消')));
        else if (action === 'retry' && job.status !== 'running') await this.ui.jobs.retry(job);
        else if (action === 'output') this.ui.jobs.output.show(true);
        else throw new Error('Task action is unavailable');
        return true;
      }
      case 'launcher.backups':
        return this.ui.backups.list(selected());
      case 'launcher.importWorld':
        await this.ui.importWorld(
          instance ? ({ value: instance } as Parameters<UI['importWorld']>[0]) : undefined,
        );
        return true;
      case 'launcher.exportWorld':
        await this.ui.exportWorld(
          instance ? ({ value: instance } as Parameters<UI['exportWorld']>[0]) : undefined,
        );
        return true;
      case 'launcher.backupAction': {
        const value = selected();
        const action = text('action');
        if (action === 'open') {
          await fs.mkdir(this.ui.backups.directory(value), { recursive: true });
          await vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(this.ui.backups.directory(value)),
          );
        } else if (action === 'create')
          await this.ui.operation(value, t('Back up worlds', '备份存档'), () =>
            this.ui.backups.create(value),
          );
        else if (action === 'restore') {
          const id = text('id', 150);
          if (!(await this.ui.backups.list(value)).includes(id))
            throw new Error('Backup not found');
          const restore = t('Restore', '恢复');
          if (
            (await vscode.window.showWarningMessage(
              t(
                'Replace current worlds? A backup will be created first.',
                '替换当前存档？恢复前会自动备份当前存档。',
              ),
              { modal: true },
              restore,
            )) === restore
          )
            await this.ui.operation(value, t('Restore worlds', '恢复存档'), () =>
              this.ui.backups.restore(value, id),
            );
        } else throw new Error('Unknown backup action');
        return true;
      }
      case 'launcher.projectTemplates': {
        const loader = text('loader');
        if (loader === 'fabric' || loader === 'neoforge')
          return this.ui.developer.templates(loader);
        if (loader !== 'forge') throw new Error('Invalid project loader');
        const game = text('minecraft', 150);
        return (await this.minecraft.loaders('forge', game)).map((version) => ({
          loader: 'forge',
          minecraft: game,
          name: `${game}-${version}`,
          url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${game}-${version}/forge-${game}-${version}-mdk.zip`,
        }));
      }
      case 'launcher.createProject': {
        const loader = text('loader');
        let templates: Template[];
        if (loader === 'forge')
          templates = (await this.handle('launcher.projectTemplates', params)) as Template[];
        else if (loader === 'fabric' || loader === 'neoforge')
          templates = await this.ui.developer.templates(loader);
        else throw new Error('Invalid project loader');
        const template = templates.find((t) => t.name === text('template', 200));
        if (!template) throw new Error('Template not found');
        const project = await this.ui.jobs.run(t('Create mod project', '创建模组项目'), (signal) =>
          this.ui.developer.create(
            template,
            {
              name: text('name', 100),
              modId: text('modId', 64),
              packageName: text('packageName', 250),
              parent: text('parent'),
            },
            signal,
          ),
        );
        if (params.open === true || (params.open === undefined && config('autoOpenProject', true)))
          await this.ui.developer.open(project);
        return project;
      }
      case 'launcher.projectAction': {
        const project = this.store.state.projects.find((p) => p.id === text('id', 150));
        if (!project) throw new Error('Project not found');
        const action = text('action');
        if (action === 'open') await this.ui.developer.open(project);
        else if (action === 'attach') await this.ui.developer.attach(project);
        else if (action === 'artifacts')
          await vscode.commands.executeCommand(
            'revealFileInOS',
            vscode.Uri.file(path.join(project.directory, 'build', 'libs')),
          );
        else if (action === 'remove') {
          this.store.state.projects = this.store.state.projects.filter((p) => p.id !== project.id);
          await this.store.save();
        } else if (['build', 'runClient', 'debug', 'sources', 'clean'].includes(action))
          await this.ui.developer.run(
            project,
            action as 'build' | 'runClient' | 'debug' | 'sources' | 'clean',
          );
        else throw new Error('Unknown project action');
        return true;
      }
      default:
        throw new Error('Unknown request');
    }
  }
}
