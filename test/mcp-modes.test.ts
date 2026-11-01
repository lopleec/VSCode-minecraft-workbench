import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { NativeMcpProvider } from '../src/mcp';
import type { Mode, Instance, ServerProfile, Project, ContentTarget } from '../src/models';
import { requestParameters } from '../src/webview/protocol';

test('one MCP connection manages clients, projects and servers in every UI mode without changing targets', async () => {
  const vscode = require('vscode');
  let provider: NativeMcpProvider | undefined;
  let enabled = true;
  const executions: any[] = [];
  vscode.EventEmitter = class {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  };
  vscode.Uri = class {
    constructor(readonly value: string) {}
    static parse(value: string) {
      return new this(value);
    }
    get authority() {
      return new URL(this.value).host;
    }
    toString() {
      return this.value;
    }
  };
  vscode.McpHttpServerDefinition = class {
    constructor(
      readonly label: string,
      readonly uri: unknown,
      readonly headers: unknown,
    ) {}
  };
  vscode.lm = {
    registerMcpServerDefinitionProvider: (_id: string, value: NativeMcpProvider) => {
      provider = value;
      return { dispose() {} };
    },
  };
  vscode.workspace = {
    isTrusted: true,
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => (key === 'mcp.enabled' ? enabled : fallback),
    }),
  };
  vscode.tasks = { taskExecutions: executions };
  vscode.window.showOpenDialog = async () => {
    throw new Error('Direct MCP paths must not open a file picker');
  };
  const [
    { WorkbenchMcp },
    { Workbench },
    { Consent },
    { Store },
    { Developer },
    { Servers },
    { ContentService },
    { default: legal },
  ] = await Promise.all([
    import('../src/mcp'),
    import('../src/workbench'),
    import('../src/consent'),
    import('../src/store'),
    import('../src/developer'),
    import('../src/servers'),
    import('../src/content'),
    import('../src/legal.json'),
  ]);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-mcp-modes-'));
  const store = new Store(path.join(root, 'state'), () => {});
  await store.load();
  const log = { info() {}, warn() {}, error() {} };
  const jobs = {
    items: [],
    output: log,
    run: async (
      _label: string,
      work: (signal: AbortSignal, report: () => void) => Promise<unknown>,
    ) => work(new AbortController().signal, () => {}),
  };
  const developer = new Developer(store, {} as never, {} as never);
  const servers = new Servers(
    store,
    {} as never,
    jobs as never,
    {} as never,
    {} as never,
    () => {},
  );
  const content = new ContentService({} as never);
  const approval = {
    version: legal.version,
    minecraftEula: true,
    workbenchTerms: true,
    acceptedAt: new Date().toISOString(),
  };
  const consent = new Consent({ get: <T>() => approval as T, update: async () => {} });
  const calls: { action: string; id?: string; kind?: string }[] = [];
  const ui = {
    developer,
    jobs,
    installVersion: async (instance: Instance) => {
      calls.push({ action: 'clientInstall', id: instance?.id });
    },
    stop: async (item: { value: Instance }) => {
      calls.push({ action: 'clientStop', id: item.value.id });
    },
  };
  const workbench = new Workbench(
    {} as never,
    store,
    content,
    { running: new Map(), assertIdle() {}, status: () => 'stopped' } as never,
    ui as never,
    consent,
    servers,
  );
  const mcp = new WorkbenchMcp(
    consent,
    (method, params) => workbench.handle(method, params),
    log as never,
  );
  const client = new Client({ name: 'mode-regression', version: '1.0.0' });
  const instance: Instance = {
    id: 'client',
    name: 'Client',
    directory: path.join(root, 'client'),
    minecraft: '1.21.1',
    loader: 'fabric',
    createdAt: '',
  };
  const paper: ServerProfile = {
    id: 'paper',
    name: 'Paper',
    directory: path.join(root, 'paper'),
    engine: 'paper',
    minecraft: '1.21.1',
    eulaAccepted: true,
    createdAt: '',
  };
  const custom: ServerProfile = {
    ...paper,
    id: 'custom',
    name: 'Custom',
    directory: path.join(root, 'custom'),
    engine: 'custom',
    eulaAccepted: false,
  };
  store.state.instances.push(instance);
  store.state.selectedInstance = instance.id;
  store.state.servers.push(paper, custom);
  store.state.selectedServer = paper.id;
  mock.method(content, 'search', async (_query: string, kind: string, target?: ContentTarget) => {
    calls.push({ action: 'search', id: target?.id, kind });
    return { hits: [], total_hits: 0, offset: 0, limit: 20 };
  });
  mock.method(content, 'version', async (id: string) => ({ id, name: id }) as never);
  mock.method(
    content,
    'install',
    async (target: ContentTarget, _version: unknown, kind: string) => {
      calls.push({ action: 'serverInstall', id: target.id, kind });
    },
  );
  mock.method(developer, 'run', async (project: Project, action: string) => {
    calls.push({ action, id: project.id });
  });
  mock.method(servers, 'start', async (server: ServerProfile) => {
    calls.push({ action: 'serverStart', id: server.id });
  });
  mock.method(servers, 'stop', async (server: ServerProfile) => {
    calls.push({ action: 'serverStop', id: server.id });
  });
  async function invoke(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
    return JSON.parse((result.content as { text: string }[])[0].text);
  }
  try {
    for (const directory of [instance.directory, paper.directory, custom.directory])
      await fs.mkdir(directory, { recursive: true });
    const projectDirectory = path.join(root, 'mod-project');
    await fs.mkdir(path.join(projectDirectory, 'gradle/wrapper'), { recursive: true });
    await fs.writeFile(path.join(projectDirectory, 'gradle/wrapper/gradle-wrapper.jar'), 'wrapper');
    await fs.writeFile(
      path.join(projectDirectory, 'gradle.properties'),
      'mod_name=Example\nmod_id=example\nminecraft_version=1.21.1\nneo_version=21.1.1',
    );
    const jar = new AdmZip();
    jar.addFile(
      'META-INF/MANIFEST.MF',
      Buffer.from('Manifest-Version: 1.0\nMain-Class: net.minecraft.server.Main\n'),
    );
    const serverJar = path.join(root, 'server.jar');
    jar.writeZip(serverJar);
    const [definition] = await provider!.provideMcpServerDefinitions();
    await client.connect(
      new StreamableHTTPClientTransport(new URL(definition.uri.toString()), {
        requestInit: { headers: definition.headers },
      }),
    );
    const originalTools = (await client.listTools()).tools.map((tool) => tool.name);
    for (const mode of ['launcher', 'developer', 'server'] as Mode[]) {
      await invoke('workbench_mode', { mode });
      assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        originalTools,
      );
      const state = await invoke('workbench_state');
      assert.equal(state.mode, mode);
      await invoke(
        'content_search',
        requestParameters(state, mode === 'server' ? 'plugin' : 'mod'),
      );
      assert.deepEqual(calls.pop(), {
        action: 'search',
        id: mode === 'server' ? paper.id : mode === 'launcher' ? instance.id : undefined,
        kind: mode === 'server' ? 'plugin' : 'mod',
      });
      await invoke('content_search');
      assert.deepEqual(calls.pop(), {
        action: 'search',
        id: mode === 'server' ? paper.id : mode === 'launcher' ? instance.id : undefined,
        kind: mode === 'server' ? 'plugin' : 'mod',
      });
      await invoke('content_search', { instanceId: instance.id });
      assert.deepEqual(calls.pop(), { action: 'search', id: instance.id, kind: 'mod' });
      await invoke('content_search', { serverId: paper.id });
      assert.deepEqual(calls.pop(), { action: 'search', id: paper.id, kind: 'plugin' });
      await invoke('content_install', { instanceId: instance.id, versionId: 'mod' });
      assert.deepEqual(calls.pop(), { action: 'clientInstall', id: instance.id });
      await invoke('content_install', { serverId: paper.id, versionId: 'plugin' });
      assert.deepEqual(calls.pop(), { action: 'serverInstall', id: paper.id, kind: 'plugin' });
      await invoke('instance_action', { instanceId: instance.id, action: 'stop' });
      assert.deepEqual(calls.pop(), { action: 'clientStop', id: instance.id });
      const imported = await invoke('project_import', { directory: projectDirectory });
      assert.equal(imported.loader, 'neoforge');
      await invoke('project_configure', {
        id: imported.id,
        value: { java: '', gradleArgs: ['--offline'], debugPort: 5071 },
      });
      assert.equal((await invoke('project_status', { id: imported.id })).debugPort, 5071);
      await invoke('project_action', { id: imported.id, action: 'build' });
      assert.deepEqual(calls.pop(), { action: 'build', id: imported.id });
      executions.push({
        task: {
          name: 'Example: build',
          definition: { type: 'minecraftWorkbench', project: imported.id, action: 'build' },
        },
        terminate: () => {
          executions.length = 0;
        },
      });
      assert.equal((await invoke('project_status', { id: imported.id })).status, 'running');
      await invoke('project_action', { id: imported.id, action: 'stop' });
      assert.equal((await invoke('project_status', { id: imported.id })).status, 'idle');
      await invoke('server_import_jar', { serverId: custom.id, path: serverJar });
      assert.equal(custom.eulaAccepted, false);
      assert.deepEqual(custom.launchArgs, ['-jar', 'server.jar', 'nogui']);
      const plugin = path.join(root, mode + '.jar');
      jar.writeZip(plugin);
      await invoke('server_import_content', { serverId: paper.id, paths: [plugin] });
      const installed = await invoke('content_installed', { serverId: paper.id });
      assert.ok(
        installed.some(
          (entry: { file: string; kind: string }) =>
            entry.file === mode + '.jar' && entry.kind === 'plugin',
        ),
      );
      await invoke('server_action', { serverId: paper.id, action: 'start' });
      assert.deepEqual(calls.pop(), { action: 'serverStart', id: paper.id });
      await invoke('server_action', { serverId: paper.id, action: 'stop' });
      assert.deepEqual(calls.pop(), { action: 'serverStop', id: paper.id });
      assert.deepEqual(await invoke('server_logs', { serverId: paper.id }), {
        status: 'stopped',
        lines: [],
      });
      assert.equal(store.state.mode, mode, 'Targeted calls do not switch the user’s UI mode');
      const before = calls.length;
      if (mode === 'developer')
        assert.equal(
          (await client.callTool({ name: 'content_install', arguments: { versionId: 'mod' } }))
            .isError,
          true,
        );
      for (const args of [
        { instanceId: instance.id, serverId: paper.id },
        { serverId: 'missing' },
        { instanceId: 'missing' },
      ])
        assert.equal(
          (
            await client.callTool({
              name: 'content_install',
              arguments: { ...args, versionId: 'mod' },
            })
          ).isError,
          true,
        );
      assert.equal(calls.length, before, 'Invalid targets never reach installation');
    }
    await invoke('workbench_mode', { mode: 'server' });
    store.state.selectedServer = undefined;
    await invoke('content_search');
    assert.deepEqual(calls.pop(), { action: 'search', id: undefined, kind: 'mod' });
    const count = calls.length;
    assert.equal(
      (await client.callTool({ name: 'content_install', arguments: { versionId: 'mod' } })).isError,
      true,
    );
    assert.equal(
      calls.length,
      count,
      'An empty server selection cannot fall back to the selected client',
    );
    assert.equal(store.state.projects.length, 1);
    assert.equal(
      (
        await client.callTool({
          name: 'server.acceptEula',
          arguments: { serverId: custom.id, accepted: true },
        })
      ).isError,
      true,
    );
    enabled = false;
    mcp.refresh();
  } finally {
    await client.close();
    mcp.dispose();
    servers.dispose();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
