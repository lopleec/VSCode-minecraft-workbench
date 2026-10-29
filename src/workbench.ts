import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store } from './store';
import { ContentService } from './content';
import { Minecraft } from './minecraft';
import { UI } from './ui';
import { config, t } from './config';
import { Item } from './views';
import { Instance } from './models';
import { ProjectKind, SearchOrder, compatible } from './modrinth';
import {
  Bootstrap,
  ViewRequest,
  WorkbenchPage,
  InstalledEntry,
  workbenchPages,
} from './webview/protocol';
import { describeError } from './errors';
import { LauncherActions } from './launcher-actions';
import { memorySettings } from './memory';
import { Consent } from './consent';
import legal from './legal.json';
import { Servers } from './servers';
import { ServerActions } from './server-actions';
import { serverTarget } from './server-settings';
import { serverEngines } from './server-catalog';
import { settingsAction } from './settings-actions';
import { mcpOperations } from './mcp-operations';

const kinds: ProjectKind[] = ['mod', 'plugin', 'modpack', 'resourcepack', 'shader'];
export class Workbench implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private page: WorkbenchPage = 'discover';
  private kind: ProjectKind = 'mod';
  private searchAbort?: AbortController;
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: Store,
    private readonly content: ContentService,
    private readonly minecraft: Minecraft,
    private readonly ui: UI,
    private readonly consent: Consent,
    private readonly servers: Servers,
  ) {}
  async open(page: string = 'discover', kind: ProjectKind = 'mod') {
    if (!this.consent.accepted) page = 'agreements';
    const mode = ['servers', 'serverCreate', 'server'].includes(page)
      ? 'server'
      : page === 'projects'
        ? 'developer'
        : ['instances', 'instance', 'create', 'version'].includes(page)
          ? 'launcher'
          : undefined;
    if (mode && this.store.state.mode !== mode) {
      this.store.state.mode = mode;
      await this.store.save();
    }
    if ((workbenchPages as readonly string[]).includes(page)) this.page = page as WorkbenchPage;
    if (kinds.includes(kind)) this.kind = kind;
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel(
        'minecraftWorkbench.browser',
        t('Minecraft Workbench', 'Minecraft 工作台'),
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
            vscode.Uri.file(path.join(this.context.extensionPath, 'dist')),
          ],
        },
      );
      this.panel = panel;
      panel.iconPath = vscode.Uri.file(
        path.join(this.context.extensionPath, 'media', 'minecraft.svg'),
      );
      panel.webview.html = this.html(panel.webview);
      panel.webview.onDidReceiveMessage(
        (message) => {
          void this.receive(message);
        },
        undefined,
        this.context.subscriptions,
      );
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.searchAbort?.abort();
      });
    } else {
      this.panel.reveal();
      await this.panel.webview.postMessage({ event: 'navigate', page: this.page, kind: this.kind });
      this.refresh();
    }
  }
  snapshot(): Bootstrap {
    const memory = memorySettings();
    return {
      consent: this.consent.snapshot(),
      locale: t('en', 'zh-cn') as Bootstrap['locale'],
      page: this.page,
      kind: this.kind,
      instances: this.store.state.instances,
      selectedInstance: this.store.state.selectedInstance,
      accounts: this.store.state.accounts.map(({ id, name, kind }) => ({ id, name, kind })),
      selectedAccount: this.store.state.selectedAccount,
      projects: this.store.state.projects,
      mode: this.store.state.mode,
      servers: this.store.state.servers,
      selectedServer: this.store.state.selectedServer,
      serverStatus: Object.fromEntries(
        this.store.state.servers.map((s) => [s.id, this.servers.status(s)]),
      ),
      mcpEnabled: config('mcp.enabled', false),
      java: this.store.state.java,
      running: [...this.minecraft.running.keys()],
      preferences: {
        order: config<SearchOrder>('modrinthSort', 'downloads'),
        pageSize: config('modrinthPageSize', 20),
        compatibleOnly: config('compatibleContentOnly', true),
        channel: config('contentReleaseChannel', 'release'),
        icons: config('showProjectIcons', true),
        density: config('contentDensity', 'comfortable'),
        optional: config('installOptionalDependencies', false),
      },
      defaults: {
        minMemory: memory.minMemory,
        maxMemory: memory.maxMemory,
        memory: {
          ...memory.recommendation,
          automaticMinimum: memory.automaticMinimum,
          automaticMaximum: memory.automaticMaximum,
        },
        gc: config('gc', 'default'),
        width: config('windowWidth', 1280),
        height: config('windowHeight', 720),
        fullscreen: config('fullscreen', false),
        backup: config('backupBeforeLaunch', false),
        gameDirectory: config('gameDirectory', '') || path.join(this.store.root, 'instances'),
        projectDirectory: config('projectDirectory', ''),
        javaPath: config('javaPath', ''),
        clientId: config('microsoftClientId', ''),
        autoOpenProject: config('autoOpenProject', true),
        serverDirectory: config('serverDirectory', '') || path.join(this.store.root, 'servers'),
      },
      jobs: this.ui.jobs.items
        .slice(0, 100)
        .map(({ id, label, status, detail }) => ({ id, label, status, detail })),
    };
  }
  refresh() {
    if (this.panel) void this.panel.webview.postMessage({ event: 'state', data: this.snapshot() });
  }
  private instance(params: Record<string, unknown>): Instance | undefined {
    if (params.instanceId === undefined || params.instanceId === '') return this.store.selected;
    const instance = this.store.state.instances.find((i) => i.id === params.instanceId);
    if (!instance) throw new Error(t('Instance not found.', '实例不存在。'));
    return instance;
  }
  private async receive(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const request = raw as ViewRequest;
    if (!Number.isSafeInteger(request.id) || typeof request.method !== 'string') return;
    try {
      const data = await this.handle(
        request.method,
        request.params && typeof request.params === 'object' ? request.params : {},
      );
      await this.panel?.webview.postMessage({ id: request.id, data });
    } catch (error) {
      this.refresh();
      await this.panel?.webview.postMessage({ id: request.id, error: describeError(error) });
    }
  }
  async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.consent.allowsRequest(method, params))
      throw new Error(
        t(
          'Accept the agreements before using Minecraft Workbench.',
          '请先确认协议，再使用 Minecraft Workbench。',
        ),
      );
    if (method === 'ready') return this.snapshot();
    if (method === 'native.command') {
      const allowed = mcpOperations.find((op) => op.method === 'native.command')!.properties!
        .command as { enum: string[] };
      if (!allowed.enum.includes(String(params.command))) throw new Error('Unknown command');
      await vscode.commands.executeCommand(`minecraftWorkbench.${String(params.command)}`);
      return true;
    }
    if (method === 'mode') {
      if (!['launcher', 'developer', 'server'].includes(String(params.mode)))
        throw new Error('Unknown mode');
      this.store.state.mode = params.mode as Bootstrap['mode'];
      await this.store.save();
      return this.snapshot();
    }
    if (method === 'settings.read' || method === 'settings.update')
      return settingsAction(method, params);
    if (method.startsWith('server.')) {
      try {
        return await new ServerActions(this.servers, this.content, this.ui.jobs).handle(
          method,
          params,
        );
      } finally {
        this.refresh();
      }
    }
    if (method === 'content.change') {
      if (!['toggle', 'remove'].includes(String(params.action)))
        throw new Error('Unknown content action');
      return this.handle(String(params.action), params);
    }
    if (method === 'consent.accept') {
      await this.consent.accept(params);
      this.page = 'instances';
      this.refresh();
      return this.snapshot();
    }
    if (method === 'consent.close') {
      this.panel?.dispose();
      return true;
    }
    if (method === 'consent.link') {
      const key = String(params.document);
      if (!Object.hasOwn(legal.links, key)) throw new Error('Unknown agreement link');
      return vscode.env.openExternal(
        vscode.Uri.parse(legal.links[key as keyof typeof legal.links]),
      );
    }
    const kind = kinds.includes(params.kind as ProjectKind) ? (params.kind as ProjectKind) : 'mod';
    const instance = this.instance(params);
    const server =
      params.serverId !== undefined
        ? this.store.state.servers.find((s) => s.id === params.serverId)
        : this.store.state.mode === 'server'
          ? this.servers.selected
          : undefined;
    if (params.serverId !== undefined && !server) throw new Error('Server not found');
    const target = server ? serverTarget(server) : instance;
    const id = (name: string) => {
      const value = params[name];
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(value))
        throw new Error('Invalid content identifier');
      return value;
    };
    switch (method) {
      case 'search': {
        this.searchAbort?.abort();
        this.searchAbort = new AbortController();
        const order = ['relevance', 'downloads', 'follows', 'newest', 'updated'].includes(
          String(params.order),
        )
          ? (params.order as SearchOrder)
          : 'downloads';
        return this.content.search(
          String(params.query || '').slice(0, 200),
          kind,
          params.compatible === false ? undefined : target,
          Math.max(0, Math.min(100000, Number(params.offset) || 0)),
          { order, limit: config('modrinthPageSize', 20), signal: this.searchAbort.signal },
        );
      }
      case 'project':
        return { project: await this.content.project(id('projectId')) };
      case 'versions': {
        const versions = await this.content.versions(id('projectId'));
        const games = [...new Set(versions.flatMap((v) => v.game_versions))];
        const loaders = [...new Set(versions.flatMap((v) => v.loaders))].sort();
        const query = String(params.query || '').toLowerCase();
        const channel = params.channel;
        const selected = versions.filter(
          (v) =>
            (!query || `${v.name} ${v.version_number}`.toLowerCase().includes(query)) &&
            (!params.game || v.game_versions.includes(String(params.game))) &&
            (!params.loader || v.loaders.includes(String(params.loader))) &&
            (params.compatible !== true || !target || compatible(v, target, kind)) &&
            (channel !== 'release' || !v.version_type || v.version_type === 'release') &&
            (channel !== 'beta' || v.version_type !== 'alpha'),
        );
        const offset = Math.max(0, Number(params.offset) || 0);
        return {
          versions: selected
            .slice(offset, offset + 30)
            .map((v) => ({ ...v, changelog: undefined })),
          total: selected.length,
          games,
          loaders,
        };
      }
      case 'plan': {
        const version = await this.content.version(id('versionId'));
        if (kind === 'modpack')
          return { version, plan: { entries: [], optional: [], conflicts: [] }, optionalNames: [] };
        if (!target)
          throw new Error(t('Select an instance or server first.', '请先选择实例或服务端。'));
        if (server && serverEngines.find((e) => e.id === server.engine)?.content !== kind)
          throw new Error('Unsupported server content type');
        if (!server && kind === 'plugin') throw new Error('Select a plugin server first');
        const plan = await this.content.plan(target, version, kind, params.optional === true);
        const optionalNames = await Promise.all(
          plan.optional.map(async (value) => {
            try {
              const project = await this.content.project(value);
              return { id: value, name: project.title };
            } catch {
              return { id: value, name: value };
            }
          }),
        );
        return { version, plan, optionalNames };
      }
      case 'install': {
        if (server) {
          if (serverEngines.find((e) => e.id === server.engine)?.content !== kind)
            throw new Error('Unsupported server content type');
          const version = await this.content.version(id('versionId'));
          await this.servers.exclusive(server, () =>
            this.content.exclusive(target!, () =>
              this.ui.jobs.run(
                t(`Install ${version.name}`, `安装 ${version.name}`),
                (signal, report) =>
                  this.content.install(target!, version, kind as 'mod' | 'plugin', signal, report, {
                    includeOptional: params.optional === true,
                    filename: typeof params.filename === 'string' ? params.filename : undefined,
                  }),
                () => this.handle('install', params),
              ),
            ),
          );
          this.refresh();
          return true;
        }
        if (kind === 'plugin') throw new Error('Select a plugin server first');
        await this.ui.installVersion(instance, id('versionId'), kind, {
          includeOptional: params.optional === true,
          filename: typeof params.filename === 'string' ? params.filename : undefined,
        });
        this.refresh();
        return true;
      }
      case 'installed': {
        if (!target) return [];
        const entries = await this.content.list(target, kind === 'modpack' ? undefined : kind);
        return entries;
      }
      case 'installedMetadata': {
        if (!target) return [];
        const result: InstalledEntry[] = await this.content.list(
          target,
          kind === 'modpack' ? undefined : kind,
        );
        const projects = [
          ...new Set(result.flatMap((entry) => (entry.projectId ? [entry.projectId] : []))),
        ];
        const details = await this.content.projects(projects);
        for (const entry of result) {
          const project = details.find((p) => p.id === entry.projectId);
          if (project)
            Object.assign(entry, {
              title: project.title,
              description: project.description,
              icon: project.icon_url,
            });
        }
        return result;
      }
      case 'toggle':
      case 'remove': {
        if (server)
          return new ServerActions(this.servers, this.content, this.ui.jobs).handle(
            'server.content',
            { ...params, action: method },
          );
        if (!instance) throw new Error(t('Select an instance first.', '请先选择实例。'));
        const entry = (await this.content.list(instance)).find(
          (item) => item.file === params.file && item.kind === kind,
        );
        if (!entry) throw new Error('Content file not found');
        this.minecraft.assertIdle(instance);
        if (method === 'remove') {
          const yes = t('Remove', '删除');
          if (
            (await vscode.window.showWarningMessage(
              t(`Remove ${entry.file}?`, `删除 ${entry.file}？`),
              { modal: true },
              yes,
            )) !== yes
          )
            return false;
        }
        await this.content.exclusive(instance, () =>
          method === 'toggle'
            ? this.content.toggle(instance, entry)
            : this.content.remove(instance, entry),
        );
        this.refresh();
        return true;
      }
      case 'saveInstance':
        if (instance) {
          await this.ui.saveInstance(instance, params.value);
          this.refresh();
          return true;
        }
        throw new Error('Instance not found');
      case 'selectInstance':
        if (instance) {
          this.store.state.selectedInstance = instance.id;
          await this.store.save();
        }
        return this.snapshot();
      case 'external': {
        const url = new URL(String(params.url));
        if (url.protocol !== 'https:') throw new Error('Only HTTPS links are allowed');
        return vscode.env.openExternal(vscode.Uri.parse(url.toString()));
      }
      case 'action': {
        const item = instance ? new Item(instance.name, 'instance', instance) : undefined;
        const actions: Record<string, () => Promise<unknown>> = {
          createInstance: () => this.ui.createInstance(),
          launch: () => this.ui.launch(item),
          stop: () => this.ui.stop(item),
          install: () => this.ui.install(item),
          configure: () => this.ui.configureInstance(item),
          clone: () => this.ui.cloneInstance(item),
          delete: () => this.ui.deleteInstance(item),
          directory: () => this.ui.openInstance(item),
          move: () =>
            new LauncherActions(this.store, this.minecraft, this.ui).handle(
              'launcher.moveInstance',
              {},
              instance,
            ),
          log: () => this.ui.gameLog(item),
          backups: () => this.ui.backupsMenu(item),
          importContent: () => this.ui.importContent(kind === 'modpack' ? 'mod' : kind),
          exportPack: () => this.ui.exportPack(item),
          importPack: () => this.ui.importPack(),
          updates: () => this.ui.checkUpdates(),
          conflicts: () => this.ui.conflicts(),
          settings: () => this.ui.settings(),
          language: () => this.ui.language(),
          addAccount: () => this.ui.addAccount(),
          detectJava: () => this.ui.detectJava(),
          downloadJava: () => this.ui.downloadJava(),
          output: async () => this.ui.jobs.output.show(true),
          importProject: () => this.ui.importProject(),
        };
        const action = actions[String(params.action)];
        if (!action) throw new Error('Unknown action');
        await action();
        this.refresh();
        return true;
      }
      default:
        if (method.startsWith('launcher.')) {
          try {
            return await new LauncherActions(this.store, this.minecraft, this.ui).handle(
              method,
              params,
              instance,
            );
          } finally {
            this.refresh();
          }
        }
        throw new Error('Unknown request');
    }
  }
  private html(webview: vscode.Webview) {
    const nonce = randomBytes(18).toString('base64');
    const uri = (relative: string) =>
      webview
        .asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, relative)))
        .toString();
    return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${uri('media/workbench.css')}"><title>Minecraft Workbench</title></head><body><div id="app"><p class="initial">Minecraft Workbench</p></div><script nonce="${nonce}" src="${uri('dist/workbench.js')}"></script></body></html>`;
  }
  dispose() {
    this.searchAbort?.abort();
    this.panel?.dispose();
  }
}
