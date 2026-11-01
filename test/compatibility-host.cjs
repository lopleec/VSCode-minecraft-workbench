const assert = require('node:assert/strict');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('Lopleec.minecraft-workbench');
  const api = await extension.activate();
  assert.ok(api?.store, 'Extension activates on the minimum supported VS Code');
  const hasNativeMcp =
    typeof vscode.lm?.registerMcpServerDefinitionProvider === 'function' &&
    typeof vscode.McpHttpServerDefinition === 'function';
  assert.equal(api.mcp.nativeIntegration, hasNativeMcp);
  assert.equal(api.mcp.enabled, false, 'MCP remains off by default');
  assert.equal(api.updates.source, 'development');
  assert.equal(api.updates.visible, false, 'Development hosts do not offer extension updates');
  assert.equal(api.consent.accepted, false);
  await assert.rejects(api.workbench.handle('launcher.gameVersions', {}), /Accept the agreements/);
  await api.workbench.handle('consent.accept', {
    version: api.consent.snapshot().version,
    minecraftEula: true,
    workbenchTerms: true,
  });
  const definitions = await api.workbench.handle('settings.read', {});
  assert.equal(definitions['updates.enabled'].value, true);
  assert.ok(definitions['updates.enabled'].description.includes('manual'));
  assert.equal(definitions['curseforge.enabled'].value, false);
  assert.ok(definitions['javaPath'] && definitions['sources'], 'Bundled settings stay complete');
  const commands = await vscode.commands.getCommands(true);
  for (const command of extension.packageJSON.contributes.commands)
    assert.ok(commands.includes(command.command), command.command);
  for (const section of [
    'home',
    'instances',
    'projects',
    'servers',
    'content',
    'accounts',
    'java',
    'downloads',
  ])
    assert.ok(commands.includes(`minecraftWorkbench.${section}.focus`), section);
  for (const mode of ['server', 'developer', 'launcher']) {
    await api.workbench.handle('mode', { mode });
    assert.equal(api.store.state.mode, mode);
  }
  await api.accounts.offline('WorkbenchTest');
  assert.equal(api.store.state.accounts[0].kind, 'offline');
  assert.ok(!JSON.stringify(api.store.state).includes('accessToken'));
  const taskName = 'Workbench compatibility task';
  const task = new vscode.Task(
    { type: 'minecraftWorkbench', project: 'compatibility', action: 'build' },
    vscode.TaskScope.Global,
    taskName,
    'Minecraft Workbench',
    new vscode.ProcessExecution(process.execPath, ['--version'], {
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }),
  );
  await vscode.tasks.executeTask(task);
  const taskDeadline = Date.now() + 15000;
  let tracked;
  do {
    tracked = api.ui.jobs.items.find((job) => job.label === taskName);
    if (tracked && tracked.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < taskDeadline);
  assert.equal(
    tracked?.status,
    'done',
    'Native Gradle-style tasks appear in the task history with their process exit status',
  );

  const AdmZip = require('adm-zip');
  const packDirectory = path.join(api.store.root, 'local-curseforge');
  const archive = path.join(api.store.root, 'local-curseforge.zip');
  const zip = new AdmZip();
  zip.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        minecraft: { version: '1.12.2', modLoaders: [] },
        files: [],
        overrides: 'overrides',
      }),
    ),
  );
  zip.addFile('overrides/mods/local.jar', Buffer.from('local fixture'));
  zip.writeZip(archive);
  const pack = { directory: packDirectory, loader: 'vanilla' };
  const signal = new AbortController().signal;
  await api.content.importPack(archive, pack, signal, () => {});
  const localMod = path.join(packDirectory, 'mods', 'local.jar');
  assert.equal(await fs.readFile(localMod, 'utf8'), 'local fixture');
  await fs.rm(localMod);
  await api.content.repairPack(pack, signal, () => {});
  assert.equal(await fs.readFile(localMod, 'utf8'), 'local fixture');

  const fixture = {
    id: 'launch-cancel-test',
    name: 'Launch cancellation',
    minecraft: '1.12.2',
    loader: 'vanilla',
    directory: path.join(api.store.root, 'launch-cancel-test'),
    runtimeDirectory: path.join(api.store.root, 'launch-cancel-runtime'),
    installed: true,
    createdAt: '',
  };
  const versionFolder = path.join(fixture.runtimeDirectory, 'versions', '1.12.2');
  await fs.mkdir(versionFolder, { recursive: true });
  await fs.mkdir(fixture.directory, { recursive: true });
  await fs.writeFile(
    path.join(versionFolder, '1.12.2.json'),
    JSON.stringify({
      id: '1.12.2',
      mainClass: 'net.minecraft.client.main.Main',
      assets: '1.12',
      minecraftArguments: '--username ${auth_player_name}',
      libraries: [],
      downloads: {},
    }),
  );
  api.store.state.instances.push(fixture);
  const ensure = api.java.ensure;
  let preparing = false;
  api.java.ensure = async (_major, signal) => {
    preparing = true;
    return new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  };
  try {
    const launch = api.minecraft.start(fixture);
    const rejection = assert.rejects(launch, { name: 'AbortError' });
    const deadline = Date.now() + 5000;
    while (!preparing) {
      assert.ok(Date.now() < deadline, 'Java preparation starts');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(api.workbench.snapshot().instanceStatus[fixture.id], 'starting');
    await api.workbench.handle('action', { action: 'stop', instanceId: fixture.id });
    await rejection;
    api.minecraft.assertIdle(fixture);
    assert.equal(api.workbench.snapshot().instanceStatus[fixture.id], 'stopped');
  } finally {
    api.java.ensure = ensure;
    await api.minecraft.stop(fixture);
    api.store.state.instances = api.store.state.instances.filter((i) => i.id !== fixture.id);
  }

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import(
    '@modelcontextprotocol/sdk/client/streamableHttp.js'
  );
  const client = new Client({ name: 'compatibility-test', version: '1.0.0' });
  try {
    await api.mcp.setEnabled(true);
    await api.mcp.start();
    const url = new URL(api.mcp.endpoint.toString());
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${api.mcp.token}` } },
      }),
    );
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === 'workbench_state'));
    for (const name of [
      'project_import',
      'project_status',
      'server_import_jar',
      'server_import_content',
    ])
      assert.ok(
        tools.tools.some((tool) => tool.name === name),
        name,
      );
    const result = await client.callTool({ name: 'workbench_state', arguments: {} });
    assert.equal(result.isError, undefined);
    const mcpProject = path.join(api.store.root, 'mcp-project');
    await fs.mkdir(path.join(mcpProject, 'gradle/wrapper'), { recursive: true });
    await fs.writeFile(
      path.join(mcpProject, 'gradle/wrapper/gradle-wrapper.jar'),
      'wrapper-fixture',
    );
    await fs.writeFile(
      path.join(mcpProject, 'gradle.properties'),
      'mod_name=MCP Example\nminecraft_version=1.21.1\nneo_version=21.1.1',
    );
    const imported = await client.callTool({
      name: 'project_import',
      arguments: { directory: mcpProject },
    });
    assert.equal(imported.isError, undefined);
    const project = JSON.parse(imported.content[0].text);
    for (const mode of ['launcher', 'developer', 'server']) {
      assert.equal(
        (await client.callTool({ name: 'workbench_mode', arguments: { mode } })).isError,
        undefined,
      );
      const status = await client.callTool({
        name: 'project_status',
        arguments: { id: project.id },
      });
      assert.equal(status.isError, undefined);
      assert.equal(JSON.parse(status.content[0].text).status, 'idle');
      assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        tools.tools.map((tool) => tool.name),
      );
      assert.equal(api.store.state.mode, mode);
    }
    assert.equal(
      (
        await client.callTool({
          name: 'project_action',
          arguments: { id: project.id, action: 'remove' },
        })
      ).isError,
      undefined,
    );
    await client.callTool({ name: 'workbench_mode', arguments: { mode: 'launcher' } });
    const update = (key, value) =>
      client.callTool({
        name: 'workbench_update_settings',
        arguments: { key, value },
      });
    assert.equal((await update('jvmArgs', [123])).isError, true);
    assert.equal((await update('debugPort', 5005.5)).isError, true);
    assert.equal((await update('jvmArgs', ['-Dworkbench.test=true'])).isError, undefined);
    assert.equal(
      (await update('sources', { client: 'https://test:private@mirror.example.test' })).isError,
      undefined,
    );
    const settings = await client.callTool({ name: 'workbench_settings', arguments: {} });
    assert.equal(settings.isError, undefined);
    assert.ok(!JSON.stringify(settings).includes('test:private'));
    await update('sources', {});
    await update('jvmArgs', []);
    console.log(
      `Compatibility passed: VS Code ${vscode.version}, Node ${process.versions.node}, ${tools.tools.length} MCP tools, native integration: ${hasNativeMcp}.`,
    );
    await client.close();
    await api.mcp.setEnabled(false);
    await assert.rejects(fetch(url));
  } finally {
    await client.close().catch(() => {});
    await api.mcp.setEnabled(false);
    api.workbench.panel?.dispose();
  }
};
