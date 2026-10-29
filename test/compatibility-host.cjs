const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('Lopleec.minecraft-workbench');
  const api = await extension.activate();
  assert.ok(api?.store, 'Extension activates on the minimum supported VS Code');
  const hasNativeMcp =
    typeof vscode.lm?.registerMcpServerDefinitionProvider === 'function' &&
    typeof vscode.McpHttpServerDefinition === 'function';
  assert.equal(api.mcp.nativeIntegration, hasNativeMcp);
  assert.equal(api.mcp.enabled, false, 'MCP remains off by default');
  assert.equal(api.consent.accepted, false);
  await assert.rejects(api.workbench.handle('launcher.gameVersions', {}), /Accept the agreements/);
  await api.workbench.handle('consent.accept', {
    version: api.consent.snapshot().version,
    minecraftEula: true,
    workbenchTerms: true,
  });
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
    const result = await client.callTool({ name: 'workbench_state', arguments: {} });
    assert.equal(result.isError, undefined);
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
