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
import { serverEngines } from './server-catalog';
import { serverTarget } from './server-settings';
import { instanceGroups } from './instance-groups';

export type ItemValue = Instance | Account | Project | Content | JavaRuntime | Job | ServerProfile;
export class Item extends vscode.TreeItem {
  group?: string;
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
              t('Agreements & About', '协议与关于', '協議與關於'),
              'action',
              undefined,
              'shield',
              'agreements',
            ),
            new Item(t('Language', '语言', '語言'), 'action', undefined, 'globe', 'language'),
          ]
        : [];
    if (this.section === 'home') {
      if (_parent?.kind === 'moreHome')
        return [
          ...(this.updates?.visible
            ? [
                new Item(
                  t('Check for extension updates', '检查插件更新', '檢查擴充套件更新'),
                  'action',
                  undefined,
                  'cloud-download',
                  'checkExtensionUpdates',
                ),
              ]
            : []),
          new Item(
            t('Java settings', 'Java 设置', 'Java 設定'),
            'action',
            undefined,
            'symbol-method',
            'manageJava',
          ),
          new Item(
            t('Tasks', '任务', '工作'),
            'action',
            undefined,
            'tasklist',
            'manageTasks',
            this.jobs.items.some((job) => job.status === 'running')
              ? String(this.jobs.items.filter((job) => job.status === 'running').length)
              : undefined,
          ),
          new Item(t('Output', '输出', '輸出'), 'action', undefined, 'output', 'output'),
          new Item(
            t('Export launcher logs…', '导出启动器日志…', '匯出啟動器日誌…'),
            'action',
            undefined,
            'export',
            'exportLogs',
          ),
          ...(state.mode === 'launcher' && config('terracotta.enabled', false)
            ? [
                new Item(
                  t('Terracotta (Beta)', '陶瓦联机（Beta）', 'Terracotta（Beta）'),
                  'action',
                  undefined,
                  'radio-tower',
                  'terracotta',
                ),
              ]
            : []),
          new Item(
            t('Agreements & About', '协议与关于', '協議與關於'),
            'action',
            undefined,
            'shield',
            'agreements',
          ),
        ];
      if (_parent?.kind === 'settingsHome')
        return [
          new Item(
            t('Proxy credentials', '代理凭据', 'Proxy 驗證資訊'),
            'action',
            undefined,
            'key',
            'proxyCredentials',
          ),
          ...(state.mode === 'launcher' && config('curseforge.enabled', false)
            ? [
                new Item(
                  t('CurseForge API key', 'CurseForge API 密钥', 'CurseForge API 金鑰'),
                  'action',
                  undefined,
                  'key',
                  'curseforgeKey',
                ),
              ]
            : []),
          new Item(
            config('mcp.enabled', false)
              ? t('Unregister MCP', '取消注册 MCP', '取消註冊 MCP')
              : t('Register MCP', '注册 MCP', '註冊 MCP'),
            'action',
            undefined,
            'plug',
            config('mcp.enabled', false) ? 'unregisterMcp' : 'registerMcp',
          ),
          ...(config('mcp.enabled', false)
            ? [
                new Item(
                  t('Copy MCP connection', '复制 MCP 连接', '複製 MCP 連接'),
                  'action',
                  undefined,
                  'copy',
                  'mcpCopy',
                ),
              ]
            : []),
          new Item(
            t('Open storage directory', '打开存储目录', '開啟儲存目錄'),
            'action',
            undefined,
            'folder-opened',
            'openStorage',
          ),
          new Item(t('Documentation', '使用文档', '使用說明'), 'action', undefined, 'book', 'help'),
        ];
      if (_parent) return [];
      const more = new Item(
        t('More', '更多', '更多'),
        'moreHome',
        undefined,
        'ellipsis',
        undefined,
        undefined,
        true,
      );
      more.id = 'minecraftWorkbench.more';
      const settings = new Item(
        t('Settings', '设置', '設定'),
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
            ? t('Launcher Mode', '启动模式', '啟動模式')
            : state.mode === 'server'
              ? t('Server Mode', '开服模式', '架設伺服器模式')
              : t('Developer Mode', '开发模式', '開發模式'),
          'mode',
          undefined,
          state.mode === 'launcher' ? 'game' : state.mode === 'server' ? 'server' : 'code',
          'mode',
        ),
        new Item(
          t('Language', '语言', '語言'),
          'action',
          undefined,
          'globe',
          'language',
          t('English', '简体中文', '繁體中文'),
        ),
        settings,
        more,
      ];
    }
    if (this.section === 'instances') {
      if (!_parent && state.instances.some((instance) => instance.group)) {
        return [
          ...instanceGroups(state.instances),
          ...(state.instances.some((instance) => !instance.group) ? [''] : []),
        ].map((group) => {
          const item = new Item(
            group || t('Ungrouped', '未分组', '未分組'),
            'instanceGroup',
            undefined,
            'folder',
            undefined,
            String(state.instances.filter((instance) => (instance.group || '') === group).length),
            true,
          );
          item.group = group;
          item.id = `minecraftWorkbench.instances.group:${encodeURIComponent(group)}`;
          return item;
        });
      }
      const instances = _parent
        ? state.instances.filter(
            (instance) =>
              _parent.kind === 'instanceGroup' && (instance.group || '') === _parent.group,
          )
        : state.instances;
      return instances.map((instance) => {
        const status = this.minecraft.status(instance);
        const running = status !== 'stopped';
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
          `${instance.minecraft} · ${instance.loader}${status === 'starting' ? t(' · Starting', ' · 启动中', ' · 啟動中') : status === 'installing' ? t(' · Installing', ' · 安装中', ' · 安裝中') : instance.installed ? '' : t(' · Not installed', ' · 未安装', ' · 未安裝')}`,
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
          `${server.minecraft} · ${server.engine} · ${{ stopped: t('Stopped', '已停止', '已停止'), preparing: t('Preparing', '准备中', '準備中'), starting: t('Starting', '启动中', '啟動中'), running: t('Running', '运行中', '執行中'), stopping: t('Stopping', '停止中', '停止中') }[status] || status}`,
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
            account.kind === 'microsoft' ? 'Microsoft' : t('Offline', '离线', '離線'),
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
          running: t('Running', '运行中', '執行中'),
          done: t('Completed', '已完成', '已完成'),
          cancelled: t('Cancelled', '已取消', '已取消'),
          failed: t('Failed', '失败', '失敗'),
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
      t('Browse content', '浏览内容', '瀏覽內容'),
      'action',
      undefined,
      'extensions',
      'browse',
    );
    if (state.mode === 'server') {
      const server = this.servers?.selected;
      if (!server)
        return [
          new Item(
            t('Manage servers', '管理服务端', '管理伺服器'),
            'action',
            undefined,
            'server',
            'manageServers',
          ),
        ];
      const kind = serverEngines.find((entry) => entry.id === server.engine)?.content;
      if (!kind)
        return [
          new Item(
            t(
              'This server does not load mods or plugins.',
              '此服务端不加载模组或插件。',
              '此伺服器不載入模組或擴充套件。',
            ),
            'information',
            undefined,
            'info',
          ),
        ];
      const counts = await this.content.list(serverTarget(server), kind);
      return [
        new Item(
          kind === 'plugin' ? t('Plugins', '插件', '擴充套件') : t('Mods', '模组', '模組'),
          kind,
          undefined,
          'extensions',
          'installed',
          String(counts.length),
        ),
        browse,
      ];
    }
    if (!instance) return [browse];
    const counts = await this.content.list(instance);
    return [
      new Item(
        t('Mods', '模组', '模組'),
        'mod',
        undefined,
        'extensions',
        'installed',
        String(counts.filter((i) => i.kind === 'mod').length),
      ),
      new Item(
        t('Resource packs', '资源包', '資源包'),
        'resourcepack',
        undefined,
        'file-media',
        'installed',
        String(counts.filter((i) => i.kind === 'resourcepack').length),
      ),
      new Item(
        t('Shaders', '光影包', '光影包'),
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
      ? t('Launcher', '启动器', '啟動器')
      : mode === 'server'
        ? t('Servers', '开服', '架設伺服器')
        : t('Developer', '开发', '開發');
  const selected =
    mode === 'launcher'
      ? store.selected?.name
      : mode === 'server'
        ? store.state.servers.find((s) => s.id === store.state.selectedServer)?.name
        : undefined;
  status.text = `$(${mode === 'server' ? 'server' : mode === 'developer' ? 'code' : 'game'}) ${label}${selected ? ' · ' + selected : ''}`;
  status.tooltip =
    mode === 'launcher'
      ? `${account?.name || t('No account', '未选择账户', '未選擇帳戶')} · ${memorySettings(store.selected).maxMemory} MB`
      : label;
  status.command = 'minecraftWorkbench.mode';
  status.show();
}
