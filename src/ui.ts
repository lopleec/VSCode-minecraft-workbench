import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Minecraft } from './minecraft';
import { Accounts } from './accounts';
import { Java, inspectJava } from './java';
import { Jobs } from './jobs';
import { ContentService } from './content';
import { Developer } from './developer';
import { Backups } from './backups';
import { Item } from './views';
import { Instance, Content, ContentKind, Account } from './models';
import { config, t, trusted, setLanguage } from './config';
import { exists, writeJson } from './files';
import { describeError } from './errors';
import { InstanceFiles } from './instance-files';
import { ContentInstallOptions, contentFile } from './modrinth';
import { validateInstanceSettings } from './instance-settings';

class Cancelled extends Error {}
async function input(
  title: string,
  value?: string,
  validateInput?: (value: string) => string | undefined,
): Promise<string> {
  const result = await vscode.window.showInputBox({
    title,
    value,
    ignoreFocusOut: true,
    validateInput,
  });
  if (result === undefined) throw new Cancelled();
  return result.trim();
}
async function choose<T extends vscode.QuickPickItem>(
  items: readonly T[],
  title: string,
): Promise<T> {
  const result = await vscode.window.showQuickPick(items, {
    title,
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!result) throw new Cancelled();
  return result;
}
async function directory(title: string, defaultPath?: string) {
  const result = await vscode.window.showOpenDialog({
    title,
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: defaultPath ? vscode.Uri.file(defaultPath) : undefined,
  });
  if (!result?.[0]) throw new Cancelled();
  return result[0].fsPath;
}
export class UI {
  browser?: (tab?: string, kind?: ContentKind | 'modpack') => Promise<void>;
  constructor(
    readonly store: Store,
    readonly minecraft: Minecraft,
    readonly accounts: Accounts,
    readonly java: Java,
    readonly jobs: Jobs,
    readonly content: ContentService,
    readonly developer: Developer,
    readonly backups: Backups,
    private readonly refresh: () => void,
  ) {}
  async guard(work: () => Promise<unknown>) {
    try {
      await work();
    } catch (error) {
      if (
        error instanceof Cancelled ||
        (error as Error)?.name === 'AbortError' ||
        (error as Error)?.message === 'Cancelled' ||
        (error as Error)?.message === '已取消'
      )
        return;
      const message = describeError(error);
      this.jobs.output.error(message);
      const action = await vscode.window.showErrorMessage(message, t('Show output', '查看输出'));
      if (action) this.jobs.output.show(true);
    } finally {
      this.refresh();
    }
  }
  async instance(item?: Item): Promise<Instance> {
    if (
      item?.value &&
      'minecraft' in item.value &&
      'createdAt' in item.value &&
      'loader' in item.value
    )
      return item.value;
    if (this.store.selected) return this.store.selected;
    if (!this.store.state.instances.length)
      throw new Error(t('Create an instance first.', '请先创建实例。'));
    return (
      await choose(
        this.store.state.instances.map((value) => ({
          label: value.name,
          description: `${value.minecraft} · ${value.loader}`,
          value,
        })),
        t('Select instance', '选择实例'),
      )
    ).value;
  }
  private async account(item?: Item): Promise<Account> {
    if (item?.value && 'kind' in item.value && 'id' in item.value) return item.value as Account;
    return (
      await choose(
        this.store.state.accounts.map((value) => ({
          label: value.name,
          description: value.kind,
          value,
        })),
        t('Select account', '选择账户'),
      )
    ).value;
  }
  private idle(instance: Instance) {
    this.minecraft.assertIdle(instance);
    if (this.content.isBusy(instance))
      throw new Error(t('Content operation already in progress.', '内容操作正在进行。'));
  }
  async operation<T>(
    instance: Instance,
    label: string,
    work: (signal: AbortSignal, report: (message: string) => void) => Promise<T>,
  ): Promise<T> {
    const execute = (): Promise<T> => {
      this.idle(instance);
      return this.content.exclusive(instance, () => this.jobs.run(label, work, execute));
    };
    return execute();
  }
  async mode() {
    const selection = await choose(
      [
        {
          label: `$(game) ${t('Launcher Mode', '启动模式')}`,
          value: 'launcher' as const,
          description: t('Play and manage Minecraft', '启动与管理 Minecraft'),
        },
        {
          label: `$(code) ${t('Developer Mode', '开发模式')}`,
          value: 'developer' as const,
          description: t('Create, build and debug mods', '创建、构建与调试模组'),
        },
        {
          label: `$(server) ${t('Server Mode', '开服模式')}`,
          value: 'server' as const,
          description: t('Install and run Minecraft servers', '安装与管理 Minecraft 服务端'),
        },
      ],
      t('Minecraft Workbench mode', 'Minecraft Workbench 模式'),
    );
    this.store.state.mode = selection.value;
    await this.store.save();
  }
  async createInstance() {
    await this.browser?.('create');
  }
  async selectInstance(item?: Item) {
    this.store.state.selectedInstance = (await this.instance(item)).id;
    await this.store.save();
  }
  async launch(item?: Item) {
    const instance = await this.instance(item);
    this.idle(instance);
    if (instance.backupBeforeLaunch ?? config('backupBeforeLaunch', false)) {
      if (await exists(path.join(instance.directory, 'saves')))
        await this.operation(instance, t('Back up worlds', '备份存档'), async () => {
          await this.backups.create(instance);
          await this.backups.prune(instance, config('backupRetention', 0));
        });
    }
    if (config('checkConflictsBeforeLaunch', false)) {
      const conflicts = await this.content.conflicts(instance);
      if (conflicts.length) {
        const proceed = t('Launch anyway', '仍然启动');
        if (
          (await vscode.window.showWarningMessage(
            conflicts.slice(0, 5).join('\n'),
            { modal: true },
            proceed,
          )) !== proceed
        )
          return;
      }
    }
    await this.minecraft.start(instance);
  }
  async language() {
    const result = await choose(
      [
        { label: 'Follow VS Code / 跟随 VS Code', value: 'auto', description: '' },
        { label: 'English', value: 'en', description: 'English' },
        { label: '简体中文', value: 'zh-cn', description: 'Simplified Chinese' },
      ],
      'Language / 语言',
    );
    await setLanguage(result.value);
  }

  async saveInstance(instance: Instance, value: unknown) {
    this.idle(instance);
    Object.assign(instance, validateInstanceSettings(value, this.store.state.accounts));
    await this.store.save();
  }
  async cloneInstance(item?: Item) {
    const instance = await this.instance(item);
    this.idle(instance);
    const name = await input(
      t('Copy name', '副本名称'),
      `${instance.name} ${t('copy', '副本')}`,
      (value) => (value.trim() ? undefined : t('Enter a name.', '请输入名称。')),
    );
    const worlds = (
      await choose(
        [
          { label: t('Copy mods and settings', '复制模组和设置'), value: false },
          { label: t('Also copy worlds', '同时复制存档'), value: true },
        ],
        t('Duplicate instance', '复制实例'),
      )
    ).value;
    const parent = config('gameDirectory', '') || path.join(this.store.root, 'instances');
    await this.operation(instance, t('Duplicate instance', '复制实例'), (signal) =>
      new InstanceFiles(this.store, this.content).clone(instance, parent, name, worlds, signal),
    );
  }
  async importContent(kind: ContentKind = 'mod') {
    const instance = await this.instance();
    this.idle(instance);
    const files = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { [kind === 'mod' ? 'Java mods' : 'ZIP packs']: [kind === 'mod' ? 'jar' : 'zip'] },
    });
    if (!files?.length) return;
    await this.operation(instance, t('Import local content', '导入本地内容'), () =>
      new InstanceFiles(this.store, this.content).importLocal(
        instance,
        kind,
        files.map((file) => file.fsPath),
      ),
    );
  }
  async exportPack(item?: Item) {
    const instance = await this.instance(item);
    this.idle(instance);
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${instance.name.replace(/[^\w.-]/g, '_')}.mrpack`),
      filters: { 'Modrinth modpack': ['mrpack'] },
    });
    if (!destination) return;
    await this.operation(instance, t('Export modpack', '导出整合包'), (signal) =>
      new InstanceFiles(this.store, this.content).exportPack(instance, destination.fsPath, signal),
    );
  }
  async installVersion(
    instance: Instance | undefined,
    id: string,
    kind: ContentKind | 'modpack',
    options: ContentInstallOptions = {},
  ) {
    const version = await this.content.version(id);
    if (kind === 'modpack') {
      const file = contentFile(version, options.filename);
      const archive = path.join(this.store.root, 'cache', `pack-${version.id}.mrpack`);
      await this.jobs.run(version.name, (signal) =>
        this.content.downloadPack(file, archive, signal),
      );
      await this.importPack(archive, (await this.content.project(version.project_id)).title);
      return;
    }
    if (!instance) throw new Error(t('Select an instance first.', '请先选择实例。'));
    await this.operation(instance, version.name, (signal, report) =>
      this.content.install(instance, version, kind, signal, report, options),
    );
  }
  async stop(item?: Item) {
    await this.minecraft.stop(await this.instance(item));
  }
  async install(item?: Item) {
    const instance = await this.instance(item);
    this.idle(instance);
    await this.minecraft.install(instance);
  }
  async openInstance(item?: Item) {
    await vscode.commands.executeCommand(
      'revealFileInOS',
      vscode.Uri.file((await this.instance(item)).directory),
    );
  }
  async gameLog(item?: Item) {
    await this.minecraft.logs(await this.instance(item));
  }
  async deleteInstance(item?: Item) {
    const instance = await this.instance(item);
    this.idle(instance);
    const yes = t('Move to Trash', '移到废纸篓');
    if (
      (await vscode.window.showWarningMessage(
        t(`Delete “${instance.name}” and its game files?`, `删除“${instance.name}”及其游戏文件？`),
        { modal: true },
        yes,
      )) === yes
    )
      await this.minecraft.delete(instance);
  }
  async configureInstance(item?: Item) {
    const instance = await this.instance(item);
    this.idle(instance);
    this.store.state.selectedInstance = instance.id;
    await this.store.save();
    await this.browser?.('version');
  }
  async addAccount() {
    await this.browser?.('accounts');
  }
  async selectAccount(item?: Item) {
    if (!item) return this.browser?.('accounts');
    this.store.state.selectedAccount = (await this.account(item)).id;
    await this.store.save();
  }
  async removeAccount(item?: Item) {
    if (!item) return this.browser?.('accounts');
    await this.accounts.remove(await this.account(item));
  }
  async detectJava() {
    await this.jobs.run(t('Detect Java', '检测 Java'), () => this.java.detect());
  }
  async addJava() {
    const picked = await vscode.window.showOpenDialog({
      title: t('Select Java executable', '选择 Java 可执行文件'),
      canSelectMany: false,
    });
    if (!picked?.[0]) return;
    const runtime = await inspectJava(picked[0].fsPath);
    this.store.state.java = this.store.state.java.filter((j) => j.path !== runtime.path);
    this.store.state.java.push(runtime);
    await this.store.save();
  }
  async downloadJava() {
    await this.browser?.('java');
  }
  async javaActions(_item?: Item) {
    await this.browser?.('java');
  }
  async search() {
    await this.browser?.('discover');
  }
  async importPack(archive?: string, packName?: string) {
    if (!archive) {
      const selected = await vscode.window.showOpenDialog({
        filters: { 'Modrinth modpack': ['mrpack'] },
        canSelectMany: false,
      });
      if (!selected?.[0]) return;
      archive = selected[0].fsPath;
    }
    const name = await input(
      t('Instance name', '实例名称'),
      packName || path.basename(archive, '.mrpack'),
      (v) => (v.trim() ? undefined : t('Enter a name.', '请输入名称。')),
    );
    const id = randomUUID();
    const instance: Instance = {
      id,
      name,
      minecraft: '',
      loader: 'vanilla',
      directory: path.join(
        config('gameDirectory', '') || path.join(this.store.root, 'instances'),
        id,
      ),
      createdAt: new Date().toISOString(),
    };
    if (!path.isAbsolute(instance.directory)) throw new Error('Absolute directory path required');
    await this.minecraft.ensureDirectory(instance);
    const previousSelection = this.store.state.selectedInstance;
    try {
      await this.jobs.run(
        name,
        (signal, report) => this.content.importPack(archive!, instance, signal, report),
        () => this.importPack(archive, name),
      );
      this.store.state.instances.push(instance);
      this.store.state.selectedInstance = id;
      await this.store.save();
    } catch (error) {
      this.store.state.instances = this.store.state.instances.filter((item) => item.id !== id);
      if (this.store.state.selectedInstance === id)
        this.store.state.selectedInstance = previousSelection;
      await fs.rm(instance.directory, { recursive: true, force: true });
      throw error;
    }
    await this.minecraft.install(instance);
  }
  async contentActions(item?: Item) {
    const instance = await this.instance();
    this.idle(instance);
    const content = item?.value as Content;
    if (!content?.file) return;
    const selection = await choose(
      [
        { label: content.enabled ? t('Disable', '禁用') : t('Enable', '启用'), key: 'toggle' },
        { label: t('Remove', '删除'), key: 'remove' },
        { label: t('Open on Modrinth', '在 Modrinth 中打开'), key: 'web' },
      ],
      content.name,
    );
    if (selection.key === 'web') {
      if (content.projectId)
        await vscode.env.openExternal(
          vscode.Uri.parse(`https://modrinth.com/project/${content.projectId}`),
        );
      return;
    }
    if (selection.key === 'remove') {
      const yes = t('Remove', '删除');
      if (
        (await vscode.window.showWarningMessage(
          t(`Remove ${content.file}?`, `删除 ${content.file}？`),
          { modal: true },
          yes,
        )) !== yes
      )
        return;
    }
    await this.content.exclusive(instance, () =>
      selection.key === 'toggle'
        ? this.content.toggle(instance, content)
        : this.content.remove(instance, content),
    );
  }
  async checkUpdates() {
    const instance = await this.instance();
    this.idle(instance);
    const updates = await this.jobs.run(t('Check content updates', '检查内容更新'), () =>
      this.content.updates(instance),
    );
    if (!updates.length) {
      await vscode.window.showInformationMessage(
        t('All recognized content is up to date.', '已识别的内容均为最新版本。'),
      );
      return;
    }
    const selected = await vscode.window.showQuickPick(
      updates.map((value) => ({
        label: value.item.name,
        description: value.version.version_number,
        picked: true,
        value,
      })),
      { canPickMany: true, title: t('Select updates', '选择更新') },
    );
    if (!selected) return;
    await this.operation(instance, t('Update content', '更新内容'), async (signal, report) => {
      for (const entry of selected)
        await this.content.install(
          instance,
          entry.value.version,
          entry.value.item.kind,
          signal,
          report,
        );
    });
  }
  async conflicts() {
    const instance = await this.instance();
    const conflicts = await this.jobs.run(t('Check mod conflicts', '检查模组冲突'), () =>
      this.content.conflicts(instance),
    );
    if (!conflicts.length) {
      await vscode.window.showInformationMessage(
        t(
          'No known conflicts found. Runtime compatibility still depends on the mods.',
          '未发现已知冲突。实际兼容性仍取决于模组运行情况。',
        ),
      );
      return;
    }
    const doc = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content: conflicts.join('\n'),
    });
    await vscode.window.showTextDocument(doc);
  }
  async backupsMenu(item?: Item) {
    const instance = await this.instance(item);
    this.store.state.selectedInstance = instance.id;
    await this.store.save();
    await this.browser?.('backups');
  }
  async createProject() {
    await this.browser?.('projects');
  }
  async importProject() {
    const project = await this.developer.import(
      await directory(t('Import Gradle project', '导入 Gradle 项目')),
    );
    if (config('autoOpenProject', true)) await this.developer.open(project);
  }
  async projectActions(_item?: Item) {
    await this.browser?.('projects');
  }
  async jobActions(_item?: Item) {
    await this.browser?.('downloads');
  }
  async exportInstance(item?: Item) {
    const instance = await this.instance(item);
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${instance.name.replace(/[^\w.-]/g, '_')}.json`),
      filters: { JSON: ['json'] },
    });
    if (destination)
      await writeJson(destination.fsPath, {
        name: instance.name,
        minecraft: instance.minecraft,
        loader: instance.loader,
        loaderVersion: instance.loaderVersion,
        minMemory: instance.minMemory,
        maxMemory: instance.maxMemory,
        jvmArgs: instance.jvmArgs,
        gameArgs: instance.gameArgs,
      });
  }
  async refreshManifest() {
    await this.jobs.run(t('Update Minecraft manifest', '更新 Minecraft 版本清单'), () =>
      this.minecraft.manifest(true),
    );
  }
  async settings() {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:minecraft-workbench.minecraft-workbench',
    );
  }
  async trusted() {
    await trusted();
  }
}
