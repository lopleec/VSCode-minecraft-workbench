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
import { config, locale, t } from './config';
import { exists } from './files';
import { Workbench } from './workbench';
import { Consent } from './consent';
import { Servers } from './servers';
import { WorkbenchMcp } from './mcp';
import { ServerActions } from './server-actions';
import { runtimeDirectory, minecraftDirectory } from './game-paths';
import { Terracotta } from './terracotta';
import { ExtensionUpdates } from './extension-updates';
import { CurseForge } from './curseforge';
import { showOutput } from './output';
import { extensionVersion } from './build-info';
import { serverTarget } from './server-settings';
import { Sidebar, sidebarTitles } from './sidebar';
import { Diagnostics } from './diagnostics';
import { settingsAction } from './settings-actions';

let activeServers: Servers | undefined;
let activeTerracotta: Terracotta | undefined;
let activeDiagnostics: Diagnostics | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const sidebar = new Sidebar();
  const nativeOutput = vscode.window.createOutputChannel('Minecraft Workbench', { log: true });
  const diagnostics = new Diagnostics(context.logUri?.fsPath);
  activeDiagnostics = diagnostics;
  const output = diagnostics.channel(nativeOutput);
  context.subscriptions.push(sidebar, nativeOutput, diagnostics);
  try {
    return await initialize(context, sidebar, output, diagnostics);
  } catch (error) {
    output.error(String(error));
    sidebar.fail(
      t(
        'Minecraft Workbench could not start. See Output for details.',
        'Minecraft Workbench 启动失败，请查看输出。',
      ),
    );
    throw error;
  }
}

async function initialize(
  context: vscode.ExtensionContext,
  sidebar: Sidebar,
  output: vscode.LogOutputChannel,
  diagnostics: Diagnostics,
) {
  output.info(
    `Minecraft Workbench ${extensionVersion} | VS Code ${vscode.version} | Node ${process.versions.node} | ${process.platform}/${process.arch}`,
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
  context.subscriptions.push(status);
  let workbench: Workbench | undefined;
  let mcp: WorkbenchMcp | undefined;
  const refresh = () => {
    sidebar.refresh();
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
    void vscode.commands.executeCommand('setContext', 'minecraftWorkbench.language', locale());
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
    sidebar.fail(t('Storage directory must be an absolute path.', '存储目录必须是绝对路径。'));
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
    sidebar.fail(
      t('Could not read instance data. See Output for details.', '无法读取实例数据，请查看输出。'),
    );
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
    log: (level, message) => output[level](message),
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
    runtimeRoots: () => [
      ...new Set([
        minecraftDirectory(),
        ...store.state.servers.map((server) => server.directory),
        ...store.state.instances.flatMap((instance) => [
          runtimeDirectory(instance),
          ...(instance.resourceDirectories || []),
        ]),
      ]),
    ],
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
  context.subscriptions.push(
    vscode.tasks.onDidStartTask((event) => {
      if (event.execution.task.definition.type === 'minecraftWorkbench')
        jobs.taskStarted(event.execution);
    }),
    vscode.tasks.onDidStartTaskProcess((event) =>
      jobs.taskProcessStarted(event.execution, event.processId),
    ),
    vscode.tasks.onDidEndTaskProcess((event) => jobs.taskEnded(event.execution, event.exitCode)),
    vscode.tasks.onDidEndTask((event) => jobs.taskStopped(event.execution)),
  );
  for (const execution of vscode.tasks.taskExecutions)
    if (execution.task.definition.type === 'minecraftWorkbench') jobs.taskStarted(execution, true);
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
    undefined,
    (instance) => content.isBusy(instance),
  );
  const developer = new Developer(store, network, java, jobs);
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
  sidebar.initialize(
    (section) =>
      new View(section, store, minecraft, content, jobs, () => consent.accepted, servers, updates),
  );
  const commands: Record<string, (item?: Item) => Promise<unknown> | unknown> = {
    exportLogs: async () => {
      const { accounts, selectedAccount: _selectedAccount, ...state } = store.state;
      const settings = (await settingsAction('settings.read', {})) as Record<
        string,
        { value: unknown }
      >;
      await diagnostics.export({
        state,
        accounts: accounts.map((account) => ({
          kind: account.kind,
          accountName: account.name,
          profileId: account.profileId,
          authServer: account.authServer,
        })),
        settings: Object.fromEntries(
          Object.entries(settings).map(([key, value]) => [key, value.value]),
        ),
        tasks: jobs.items.map(({ id, label, status, detail }) => ({ id, label, status, detail })),
        activeGameProcesses: [...minecraft.running].map(([instanceId, process]) => ({
          instanceId,
          pid: process.pid,
        })),
        activeServers: [...servers.running.keys()],
      });
    },
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
        ...(store.state.mode !== 'developer' ? (['content'] as Section[]) : []),
        ...(store.state.mode === 'launcher' ? (['accounts'] as Section[]) : []),
        ...(config('showRuntimeViews', false) ? (['java', 'downloads'] as Section[]) : []),
      ];
      const selected = await vscode.window.showQuickPick(
        sections.map((section) => ({ label: t(...sidebarTitles[section]), section })),
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
    importServer: () => workbench!.open('serverImport'),
    reviewServerEula: () => workbench!.open('server'),
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
        item && ['mod', 'plugin', 'resourcepack', 'shader'].includes(item.kind)
          ? (item.kind as 'mod' | 'plugin' | 'resourcepack' | 'shader')
          : 'mod',
      ),
    inspectInstance: async (item) => {
      await ui.selectInstance(item);
      await workbench!.open('instance');
    },
    language: () => ui.language(),
    cloneInstance: (item) => ui.cloneInstance(item),
    exportPack: (item) => ui.exportPack(item),
    importContent: async () => {
      if (store.state.mode !== 'server') return ui.importContent();
      if (!servers.selected) return workbench!.open('servers');
      await new ServerActions(servers, content, jobs).handle('server.action', {
        action: 'importContent',
      });
      refresh();
    },
    importPack: () => ui.importPack(),
    contentActions: (item) => ui.contentActions(item),
    checkUpdates: async () => {
      if (store.state.mode !== 'server') return ui.checkUpdates();
      const server = servers.selected;
      if (!server) return workbench!.open('servers');
      const updates = await jobs.run(['Check content updates', '检查内容更新'], () =>
        content.updates(serverTarget(server)),
      );
      if (!updates.length)
        return vscode.window.showInformationMessage(t('No updates available.', '暂无可用更新。'));
      const selected = await vscode.window.showQuickPick(
        updates.map((update) => ({
          label: update.item.name,
          description: update.version.version_number,
          update,
        })),
        { canPickMany: true, title: t('Select updates', '选择更新') },
      );
      for (const item of selected || [])
        await new ServerActions(servers, content, jobs).handle('server.content', {
          serverId: server.id,
          action: 'update',
          file: item.update.item.file,
          kind: item.update.item.kind,
        });
      refresh();
    },
    conflicts: async () => {
      if (store.state.mode !== 'server') return ui.conflicts();
      if (!servers.selected) return workbench!.open('servers');
      const warnings = await content.conflicts(serverTarget(servers.selected));
      const document = await vscode.workspace.openTextDocument({
        language: 'plaintext',
        content: warnings.join('\n') || t('No conflicts found.', '未发现冲突。'),
      });
      await vscode.window.showTextDocument(document);
    },
    backups: (item) => ui.backupsMenu(item),
    createProject: () => ui.createProject(),
    importProject: () => ui.importProject(),
    projectActions: (item) => ui.projectActions(item),
    jobActions: (item) => ui.jobActions(item),
    refreshManifest: () => ui.refreshManifest(),
    refresh: () => refresh(),
    settings: () => workbench!.open('settings'),
    output: () => showOutput(store, jobs, minecraft, servers),
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
      const zh = locale() !== 'en';
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
    for (const suffix of ['', '.zh', '.tw'])
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
  activeDiagnostics?.record('info', 'Extension deactivated');
  await activeDiagnostics?.flush();
  activeDiagnostics = undefined;
}
