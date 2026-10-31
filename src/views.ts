import * as vscode from 'vscode';
import { Store } from './store';
import { Minecraft } from './minecraft';
import { ContentService } from './content';
import { Jobs } from './jobs';
import { Instance, Account, Project, Content, JavaRuntime } from './models';
import { Job } from './jobs';
import { t, config } from './config';
import { memorySettings } from './memory';
import type { ExtensionUpdates } from './extension-updates';
import { Servers } from './servers';
import type { ServerProfile } from './models';

export type ItemValue = Instance | Account | Project | Content | JavaRuntime | Job | ServerProfile;
export class Item extends vscode.TreeItem {
  constructor(
    label: string,
    readonly kind: string,
    readonly value?: ItemValue,
    icon?: string,
    command?: string,
    description?: string,
    expandable = false,
  ) {
    super(
      label,
      expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.contextValue = kind;
    this.description = description;
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
    if (command)
      this.command = { title: label, command: `minecraftWorkbench.${command}`, arguments: [this] };
  }
}
export type Section =
  | 'home'
  | 'instances'
  | 'projects'
  | 'servers'
  | 'content'
  | 'accounts'
  | 'java'
  | 'downloads';
export class View implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(
    readonly section: Section,
    private readonly store: Store,
    private readonly minecraft: Minecraft,
    private readonly content: ContentService,
    private readonly jobs: Jobs,
    private readonly hasConsent: () => boolean = () => true,
    private readonly servers?: Servers,
    private readonly updates?: ExtensionUpdates,
  ) {}
  refresh() {
    this.emitter.fire(undefined);
  }
  getTreeItem(item: Item) {
    return item;
  }
  async getChildren(_parent?: Item): Promise<Item[]> {
    const state = this.store.state;
    if (!this.hasConsent())
      return this.section === 'home'
        ? [
            new Item(
              t('Agreements & About', '协议与关于'),
              'action',
              undefined,
              'shield',
              'agreements',
            ),
            new Item(t('Language', '语言'), 'action', undefined, 'globe', 'language'),
          ]
        : [];
    if (this.section === 'home') {
      if (_parent?.kind === 'moreHome')
        return [
          ...(this.updates?.visible
            ? [
                new Item(
                  t('Check for extension updates', '检查插件更新'),
                  'action',
                  undefined,
                  'cloud-download',
                  'checkExtensionUpdates',
                ),
              ]
            : []),
          new Item(
            t('Java settings', 'Java 设置'),
            'action',
            undefined,
            'symbol-method',
            'manageJava',
          ),
          new Item(t('Tasks', '任务'), 'action', undefined, 'tasklist', 'manageTasks'),
          new Item(t('Logs', '日志'), 'action', undefined, 'output', 'output'),
          ...(config('terracotta.enabled', false)
            ? [
                new Item(
                  t('Terracotta (Beta)', '陶瓦联机（Beta）'),
                  'action',
                  undefined,
                  'radio-tower',
                  'terracotta',
                ),
              ]
            : []),
          new Item(
            t('Agreements & About', '协议与关于'),
            'action',
            undefined,
            'shield',
            'agreements',
          ),
        ];
      if (_parent?.kind === 'settingsHome')
        return [
          new Item(
            t('Proxy credentials', '代理凭据'),
            'action',
            undefined,
            'key',
            'proxyCredentials',
          ),
          new Item(
            config('mcp.enabled', false)
              ? t('Unregister MCP', '取消注册 MCP')
              : t('Register MCP', '注册 MCP'),
            'action',
            undefined,
            'plug',
            config('mcp.enabled', false) ? 'unregisterMcp' : 'registerMcp',
          ),
          ...(config('mcp.enabled', false)
            ? [
                new Item(
                  t('Copy MCP connection', '复制 MCP 连接'),
                  'action',
                  undefined,
                  'copy',
                  'mcpCopy',
                ),
              ]
            : []),
          new Item(
            t('Open storage directory', '打开存储目录'),
            'action',
            undefined,
            'folder-opened',
            'openStorage',
          ),
          new Item(t('Documentation', '使用文档'), 'action', undefined, 'book', 'help'),
        ];
      if (_parent) return [];
      const more = new Item(
        t('More', '更多'),
        'moreHome',
        undefined,
        'ellipsis',
        undefined,
        undefined,
        true,
      );
      more.id = 'minecraftWorkbench.more';
      const settings = new Item(
        t('Settings', '设置'),
        'settingsHome',
        undefined,
        'settings-gear',
        'settings',
        undefined,
        true,
      );
      settings.id = 'minecraftWorkbench.settings';
      return [
        new Item(
          state.mode === 'launcher'
            ? t('Launcher Mode', '启动模式')
            : state.mode === 'server'
              ? t('Server Mode', '开服模式')
              : t('Developer Mode', '开发模式'),
          'mode',
          undefined,
          state.mode === 'launcher' ? 'game' : state.mode === 'server' ? 'server' : 'code',
          'mode',
        ),
        new Item(
          t('Language', '语言'),
          'action',
          undefined,
          'globe',
          'language',
          t('English', '简体中文'),
        ),
        settings,
        more,
      ];
    }
    if (this.section === 'instances') {
      return state.instances.map((instance) => {
        const running = this.minecraft.running.has(instance.id);
        const item = new Item(
          instance.name,
          running ? 'runningInstance' : 'instance',
          instance,
          running
            ? 'vm-running'
            : state.selectedInstance === instance.id
              ? 'pass-filled'
              : 'package',
          'inspectInstance',
          `${instance.minecraft} · ${instance.loader}${instance.installed ? '' : t(' · Not installed', ' · 未安装')}`,
          false,
        );
        item.id = instance.id;
        item.tooltip = `${instance.name}\n${instance.directory}`;
        return item;
      });
    }
    if (this.section === 'servers')
      return state.servers.map((server) => {
        const status = this.servers?.status(server) || 'stopped';
        const item = new Item(
          server.name,
          status === 'stopped' ? 'server' : 'runningServer',
          server,
          status === 'stopped' ? 'server' : 'vm-running',
          'serverActions',
          `${server.minecraft} · ${server.engine} · ${{ stopped: t('Stopped', '已停止'), preparing: t('Preparing', '准备中'), starting: t('Starting', '启动中'), running: t('Running', '运行中'), stopping: t('Stopping', '停止中') }[status] || status}`,
        );
        item.id = server.id;
        return item;
      });
    if (this.section === 'projects')
      return state.projects.map(
        (project) =>
          new Item(
            project.name,
            'project',
            project,
            'code',
            'projectActions',
            `${project.minecraft} · ${project.loader}`,
          ),
      );
    if (this.section === 'accounts')
      return state.accounts.map(
        (account) =>
          new Item(
            account.name,
            'account',
            account,
            account.id === state.selectedAccount ? 'pass-filled' : 'account',
            'selectAccount',
            account.kind === 'microsoft' ? 'Microsoft' : t('Offline', '离线'),
          ),
      );
    if (this.section === 'java')
      return state.java.map(
        (java) =>
          new Item(
            `Java ${java.major}`,
            'java',
            java,
            'symbol-method',
            'javaActions',
            `${java.version} · ${java.architecture}`,
          ),
      );
    if (this.section === 'downloads')
      return this.jobs.items.map((job) => {
        const icon = {
          running: 'loading~spin',
          done: 'check',
          cancelled: 'circle-slash',
          failed: 'error',
        }[job.status];
        const states = {
          running: t('Running', '运行中'),
          done: t('Completed', '已完成'),
          cancelled: t('Cancelled', '已取消'),
          failed: t('Failed', '失败'),
        };
        const item = new Item(
          job.label,
          job.status === 'running' ? 'runningJob' : 'job',
          job,
          icon,
          'jobActions',
          job.detail || states[job.status],
        );
        item.id = job.id;
        return item;
      });
    const instance = this.store.selected;
    const browse = new Item(
      t('Browse content', '浏览内容'),
      'action',
      undefined,
      'extensions',
      'browse',
    );
    if (!instance) return [browse];
    const counts = await this.content.list(instance);
    return [
      new Item(
        t('Mods', '模组'),
        'mod',
        undefined,
        'extensions',
        'installed',
        String(counts.filter((i) => i.kind === 'mod').length),
      ),
      new Item(
        t('Resource packs', '资源包'),
        'resourcepack',
        undefined,
        'file-media',
        'installed',
        String(counts.filter((i) => i.kind === 'resourcepack').length),
      ),
      new Item(
        t('Shaders', '光影包'),
        'shader',
        undefined,
        'sparkle',
        'installed',
        String(counts.filter((i) => i.kind === 'shader').length),
      ),
      browse,
    ];
  }

  dispose() {
    this.emitter.dispose();
  }
}
export function updateStatus(status: vscode.StatusBarItem, store: Store) {
  const account = store.state.accounts.find((a) => a.id === store.state.selectedAccount);
  const mode = store.state.mode;
  const label =
    mode === 'launcher'
      ? t('Launcher', '启动器')
      : mode === 'server'
        ? t('Servers', '开服')
        : t('Developer', '开发');
  const selected =
    mode === 'launcher'
      ? store.selected?.name
      : mode === 'server'
        ? store.state.servers.find((s) => s.id === store.state.selectedServer)?.name
        : undefined;
  status.text = `$(${mode === 'server' ? 'server' : mode === 'developer' ? 'code' : 'game'}) ${label}${selected ? ' · ' + selected : ''}`;
  status.tooltip =
    mode === 'launcher'
      ? `${account?.name || t('No account', '未选择账户')} · ${memorySettings(store.selected).maxMemory} MB`
      : label;
  status.command = 'minecraftWorkbench.mode';
  status.show();
}
