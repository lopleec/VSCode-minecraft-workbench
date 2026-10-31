import * as vscode from 'vscode';
import * as path from 'node:path';
import { Store } from './store';
import { Network } from './network';
import { Jobs } from './jobs';
import { Java } from './java';
import { Accounts } from './accounts';
import { Minecraft } from './minecraft';
import { ContentService } from './content';
import { Developer } from './developer';
import { Backups } from './backups';
import { View, Item, Section, updateStatus } from './views';
import { UI } from './ui';
import { config, t } from './config';
import { exists } from './files';
import { Workbench } from './workbench';
import { Consent } from './consent';
import { Servers } from './servers';
import { WorkbenchMcp } from './mcp';
import { ServerActions } from './server-actions';
import { runtimeDirectory } from './game-paths';
import { Terracotta } from './terracotta';
import { ExtensionUpdates } from './extension-updates';
import { CurseForge } from './curseforge';

let activeServers: Servers | undefined;
let activeTerracotta: Terracotta | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Minecraft Workbench', { log: true });
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  context.subscriptions.push(output, status);
  const views: View[] = [];
  let workbench: Workbench | undefined;
  let mcp: WorkbenchMcp | undefined;
  const refresh = () => {
    for (const view of views) view.refresh();
    updateStatus(status, store);
    if (!consent.accepted) {
      status.text = '$(shield) ' + t('Agreements required', '请先确认协议');
      status.command = 'minecraftWorkbench.agreements';
      status.tooltip = t(
        'Review the agreements to use Minecraft Workbench.',
        '确认协议后使用 Minecraft Workbench。',
      );
    }
    workbench?.refresh();
    mcp?.refresh();
    void vscode.commands.executeCommand(
      'setContext',
      'minecraftWorkbench.mcpEnabled',
      mcp?.enabled ?? false,
    );
    void vscode.commands.executeCommand('setContext', 'minecraftWorkbench.mode', store.state.mode);
    void vscode.commands.executeCommand(
      'setContext',
      'minecraftWorkbench.agreementsAccepted',
      consent.accepted,
    );
    void vscode.commands.executeCommand(
      'setContext',
      'minecraftWorkbench.language',
      t('en', 'zh-cn'),
    );
  };
  const consent = new Consent(context.globalState, refresh);
  let root = config('storageDirectory', '') || context.globalStorageUri.fsPath;
  const legacy = path.join(
    path.dirname(context.globalStorageUri.fsPath),
    'minecraft-workbench.minecraft-workbench',
  );
  if (
    !config('storageDirectory', '') &&
    !(await exists(path.join(root, 'state.json'))) &&
    (await exists(path.join(legacy, 'state.json')))
  )
    root = legacy;
  if (!path.isAbsolute(root)) {
    void vscode.window.showErrorMessage(
      t('Storage directory must be an absolute path.', '存储目录必须是绝对路径。'),
    );
    return;
  }
  const store = new Store(root, refresh);
  try {
    await store.load();
  } catch (error) {
    output.error(String(error));
    void vscode.window.showErrorMessage(
      t(
        'Minecraft Workbench could not read its state. Check the output before changing or restoring state.json.',
        'Minecraft Workbench 无法读取状态文件。请先查看输出，再处理或恢复 state.json。',
      ),
    );
    return;
  }
  context.subscriptions.push(store);
  let proxy =
    config('proxy', '').trim() ||
    vscode.workspace.getConfiguration('http').get<string>('proxy', '').trim();
  const credentials = await context.secrets.get('minecraftWorkbench.proxyCredentials');
  let proxyError: string | undefined;
  if (proxy && credentials) {
    try {
      const url = new URL(proxy);
      const value = JSON.parse(credentials);
      url.username = value.username;
      url.password = value.password;
      proxy = url.toString();
    } catch (error) {
      proxyError = String(error);
    }
  }
  const network = new Network({
    proxy,
    sources: config('sources', {}),
    concurrency: Math.max(1, Math.min(32, config('downloadConcurrency', 6))),
    retries: config('downloadRetries', 2),
    timeout: config('networkTimeout', 30000),
    cacheDirectory: config('sharedDownloadCache', true)
      ? path.join(store.root, 'cache', 'downloads')
      : undefined,
    connectionsPerFile: config('downloadConnectionsPerFile', 4),
    chunkSize: config('downloadChunkSize', 8) * 1024 ** 2,
    runtimeRoots: () =>
      store.state.instances.flatMap((instance) => [
        runtimeDirectory(instance),
        ...(instance.resourceDirectories || []),
      ]),
  });
  network.blockedReason ??= proxyError;
  if (network.blockedReason)
    output.error(
      t(
        'Invalid proxy configuration. Open extension settings to correct it.',
        '代理设置无效，请在扩展设置中修正。',
      ),
    );
  context.subscriptions.push({
    dispose: () => {
      void network.close();
    },
  });
  const jobs = new Jobs(refresh, output);
  const java = new Java(store, network);
  const accounts = new Accounts(store, context.secrets, network, () => consent.accepted);
  const curseforge = new CurseForge(network, context.secrets);
  context.subscriptions.push(curseforge);
  const content = new ContentService(
    network,
    path.join(store.root, 'cache', 'mod-metadata'),
    curseforge,
  );
  const minecraft = new Minecraft(
    store,
    network,
    java,
    accounts,
    jobs,
    refresh,
    (instance, signal, report) => content.repairPack(instance, signal, report),
  );
  const developer = new Developer(store, network, java);
  const servers = new Servers(store, java, jobs, network, minecraft, refresh);
  activeServers = servers;
  context.subscriptions.push(servers);
  const ui = new UI(
    store,
    minecraft,
    accounts,
    java,
    jobs,
    content,
    developer,
    new Backups(),
    refresh,
  );
  context.subscriptions.push(jobs, accounts, ui.imports);
  const terracotta = new Terracotta(
    context.globalState,
    store.root,
    network,
    refresh,
    () => consent.accepted && vscode.workspace.isTrusted,
  );
  activeTerracotta = terracotta;
  context.subscriptions.push(terracotta);
  workbench = new Workbench(context, store, content, minecraft, ui, consent, servers, terracotta);
  ui.browser = (page, kind) => workbench!.open(page, kind);
  context.subscriptions.push(workbench);
  mcp = new WorkbenchMcp(consent, (method, params) => workbench!.handle(method, params), output);
  context.subscriptions.push(mcp);
  const updates = new ExtensionUpdates(
    context,
    network,
    jobs,
    () => minecraft.activeIds.length > 0 || servers.running.size > 0,
  );
  await updates.initialize();
  await vscode.commands.executeCommand(
    'setContext',
    'minecraftWorkbench.githubUpdates',
    updates.visible,
  );
  context.subscriptions.push(updates);
  const titles: Record<Section, [string, string]> = {
    home: ['Workbench', '工作台'],
    instances: ['Instances', '实例'],
    projects: ['Projects', '项目'],
    servers: ['Servers', '服务端'],
    content: ['Content', '内容'],
    accounts: ['Accounts', '账户'],
    java: ['Java', 'Java'],
    downloads: ['Tasks', '任务'],
  };
  const treeViews: { section: Section; tree: vscode.TreeView<Item> }[] = [];
  for (const section of Object.keys(titles) as Section[]) {
    const provider = new View(
      section,
      store,
      minecraft,
      content,
      jobs,
      () => consent.accepted,
      servers,
      updates,
    );
    const tree = vscode.window.createTreeView(`minecraftWorkbench.${section}`, {
      treeDataProvider: provider,
      showCollapseAll: section === 'instances' || section === 'content',
    });
    tree.title = t(...titles[section]);
    treeViews.push({ section, tree });
    views.push(provider);
    context.subscriptions.push(provider, tree);
  }
  const commands: Record<string, (item?: Item) => Promise<unknown> | unknown> = {
    agreements: () => workbench!.open('agreements'),
    checkExtensionUpdates: () => updates.check(),
    curseforgeKey: () => curseforge.configure(),
    showView: async () => {
      const sections: Section[] = [
        'home',
        store.state.mode === 'launcher'
          ? 'instances'
          : store.state.mode === 'server'
            ? 'servers'
            : 'projects',
        ...(store.state.mode === 'launcher' ? (['content', 'accounts'] as Section[]) : []),
        'java',
        'downloads',
      ];
      const selected = await vscode.window.showQuickPick(
        sections.map((section) => ({ label: t(...titles[section]), section })),
        { title: t('Show Sidebar View', '显示侧栏分类') },
      );
      if (selected)
        await vscode.commands.executeCommand(`minecraftWorkbench.${selected.section}.focus`);
    },
    mode: () => ui.mode(),
    mcp: () => mcp!.toggle(),
    registerMcp: () => mcp!.setEnabled(true),
    unregisterMcp: () => mcp!.setEnabled(false),
    mcpCopy: () => mcp!.copyConnection(),
    manageServers: () => workbench!.open('servers'),
    createServer: () => workbench!.open('serverCreate'),
    serverActions: async (item) => {
      if (item?.value && 'engine' in item.value) {
        store.state.selectedServer = item.value.id;
        await store.save();
      }
      await workbench!.open('server');
    },
    startServer: async (item) =>
      new ServerActions(servers, content, jobs).handle('server.action', {
        serverId: item?.value && 'engine' in item.value ? item.value.id : servers.selected?.id,
        action: 'start',
      }),
    stopServer: async (item) =>
      new ServerActions(servers, content, jobs).handle('server.action', {
        serverId: item?.value && 'engine' in item.value ? item.value.id : servers.selected?.id,
        action: 'stop',
      }),
    createInstance: () => ui.createInstance(),
    importInstance: () => ui.importInstance(),
    terracotta: () => workbench!.open('multiplayer'),
    selectInstance: (item) => ui.selectInstance(item),
    launch: (item) => ui.launch(item),
    stop: (item) => ui.stop(item),
    install: (item) => ui.install(item),
    configureInstance: (item) => ui.configureInstance(item),
    deleteInstance: (item) => ui.deleteInstance(item),
    openInstance: (item) => ui.openInstance(item),
    gameLog: (item) => ui.gameLog(item),
    exportInstance: (item) => ui.exportInstance(item),
    addAccount: () => ui.addAccount(),
    selectAccount: (item) => ui.selectAccount(item),
    removeAccount: (item) => ui.removeAccount(item),
    detectJava: () => ui.detectJava(),
    addJava: () => ui.addJava(),
    downloadJava: () => ui.downloadJava(),
    javaActions: (item) => ui.javaActions(item),
    search: () => ui.search(),
    browse: () => workbench!.open('discover'),
    manageInstances: () => workbench!.open('instances'),
    manageAccounts: () => workbench!.open('accounts'),
    manageJava: () => workbench!.open('java'),
    manageTasks: () => workbench!.open('downloads'),
    manageProjects: () => workbench!.open('projects'),
    installed: (item) =>
      workbench!.open(
        'installed',
        item && ['mod', 'resourcepack', 'shader'].includes(item.kind)
          ? (item.kind as 'mod' | 'resourcepack' | 'shader')
          : 'mod',
      ),
    inspectInstance: async (item) => {
      await ui.selectInstance(item);
      await workbench!.open('instance');
    },
    language: () => ui.language(),
    cloneInstance: (item) => ui.cloneInstance(item),
    exportPack: (item) => ui.exportPack(item),
    importContent: () => ui.importContent(),
    importPack: () => ui.importPack(),
    contentActions: (item) => ui.contentActions(item),
    checkUpdates: () => ui.checkUpdates(),
    conflicts: () => ui.conflicts(),
    backups: (item) => ui.backupsMenu(item),
    createProject: () => ui.createProject(),
    importProject: () => ui.importProject(),
    projectActions: (item) => ui.projectActions(item),
    jobActions: (item) => ui.jobActions(item),
    refreshManifest: () => ui.refreshManifest(),
    refresh: () => refresh(),
    settings: () => ui.settings(),
    output: () => output.show(),
    openStorage: () =>
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(store.root)),
    proxyCredentials: async () => {
      const username = await vscode.window.showInputBox({
        title: t('Proxy username (empty to clear)', '代理用户名（留空清除）'),
        ignoreFocusOut: true,
      });
      if (username === undefined) return;
      if (!username) {
        await context.secrets.delete('minecraftWorkbench.proxyCredentials');
      } else {
        const password = await vscode.window.showInputBox({
          title: t('Proxy password', '代理密码'),
          password: true,
          ignoreFocusOut: true,
        });
        if (password === undefined) return;
        await context.secrets.store(
          'minecraftWorkbench.proxyCredentials',
          JSON.stringify({ username, password }),
        );
      }
      const reload = t('Reload window', '重新加载窗口');
      if (
        (await vscode.window.showInformationMessage(
          t('Proxy credentials saved.', '代理凭据已保存。'),
          reload,
        )) === reload
      )
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    },
    help: async () => {
      const language = config<string>('language', 'auto');
      const zh =
        language === 'zh-cn' || (language === 'auto' && vscode.env.language.startsWith('zh'));
      const name = zh
        ? 'README.zh-CN.md'
        : (await exists(path.join(context.extensionPath, 'README.md')))
          ? 'README.md'
          : 'readme.md';
      await vscode.commands.executeCommand(
        'markdown.showPreview',
        vscode.Uri.file(path.join(context.extensionPath, name)),
      );
    },
  };
  for (const [name, command] of Object.entries(commands)) {
    for (const suffix of ['', '.zh'])
      context.subscriptions.push(
        vscode.commands.registerCommand(`minecraftWorkbench.${name}${suffix}`, (item?: Item) =>
          ui.guard(async () => {
            if (!consent.allowsCommand(name)) {
              await workbench!.open('agreements');
              return;
            }
            await command(item);
          }),
        ),
      );
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('minecraftWorkbench.curseforge.enabled'))
        curseforge.configurationChanged();
      if (event.affectsConfiguration('minecraftWorkbench.updates.enabled')) {
        updates.configurationChanged();
        void vscode.commands.executeCommand(
          'setContext',
          'minecraftWorkbench.githubUpdates',
          updates.visible,
        );
      }
      if (event.affectsConfiguration('minecraftWorkbench.terracotta'))
        void terracotta.configurationChanged().catch((error) => output.error(String(error)));
      if (!event.affectsConfiguration('minecraftWorkbench')) return;
      refresh();
      for (const { section, tree } of treeViews) tree.title = t(...titles[section]);
      if (
        [
          'proxy',
          'sources',
          'storageDirectory',
          'downloadConcurrency',
          'downloadRetries',
          'networkTimeout',
          'sharedDownloadCache',
          'downloadConnectionsPerFile',
          'downloadChunkSize',
        ].some((key) => event.affectsConfiguration(`minecraftWorkbench.${key}`))
      ) {
        const reload = t('Reload window', '重新加载窗口');
        void vscode.window
          .showInformationMessage(
            t(
              'Reload the window to apply network or storage changes.',
              '重新加载窗口以应用网络或存储设置。',
            ),
            reload,
          )
          .then((result) => {
            if (result) void vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
      }
    }),
  );
  const timer = setInterval(() => {
    if (consent.accepted && store.state.instances.length && config('autoUpdateManifest', true))
      void minecraft.manifest().catch((error) => output.warn(String(error)));
  }, 3600000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  refresh();
  if (!consent.accepted) await workbench.open('agreements');
  return {
    store,
    minecraft,
    content,
    java,
    developer,
    network,
    accounts,
    ui,
    workbench,
    consent,
    servers,
    mcp,
    terracotta,
    updates,
  };
}
export async function deactivate() {
  await activeTerracotta?.close();
  activeTerracotta = undefined;
  await activeServers?.close();
  activeServers = undefined;
}
