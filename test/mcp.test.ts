import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type * as VSCode from 'vscode';
import manifest from '../package.json';
import { mcpOperations } from '../src/mcp-operations';

test('MCP tools are unique and cannot bypass native command or agreement controls', () => {
  const setting = manifest.contributes.configuration
    .flatMap((group) => Object.entries(group.properties))
    .find(([key]) => key === 'minecraftWorkbench.mcp.enabled');
  assert.equal((setting?.[1] as { default: boolean }).default, false);
  assert.equal(new Set(mcpOperations.map((op) => op.name)).size, mcpOperations.length);
  assert.equal(
    mcpOperations.some((op) => op.method === 'consent.accept'),
    false,
  );
  assert.ok(mcpOperations.some((op) => op.method === 'server.command' && op.destructive));
  const commands = mcpOperations.find((op) => op.method === 'native.command')!.properties!
    .command as { enum: string[] };
  assert.ok(!commands.enum.includes('workbench.action.terminal.new'));
});
test('MCP uses authenticated loopback, interoperates with the official client and closes on unregister', async () => {
  const vscode = require('vscode') as Record<string, unknown>;
  let enabled = true;
  let provider: VSCode.McpServerDefinitionProvider | undefined;
  class EventEmitter {
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
  }
  class Uri {
    constructor(readonly value: string) {}
    static parse(s: string) {
      return new Uri(s);
    }
    get authority() {
      return new URL(this.value).host;
    }
    toString() {
      return this.value;
    }
  }
  Object.assign(vscode, {
    EventEmitter,
    Uri,
    McpHttpServerDefinition: class {
      constructor(
        readonly label: string,
        readonly uri: Uri,
        readonly headers: Record<string, string>,
      ) {}
    },
  });
  vscode.lm = {
    registerMcpServerDefinitionProvider: (
      _id: string,
      value: VSCode.McpServerDefinitionProvider,
    ) => {
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
  const { WorkbenchMcp } = await import('../src/mcp');
  const calls: string[] = [];
  const mcp = new WorkbenchMcp(
    { accepted: true } as never,
    async (method, params) => {
      calls.push(method);
      return { method, params };
    },
    { warn: () => {} } as never,
  );
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    const definitions = await provider!.provideMcpServerDefinitions({} as VSCode.CancellationToken);
    const definition = definitions![0] as VSCode.McpHttpServerDefinition;
    const url = new URL(definition.uri.toString());
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal(
      (
        await fetch(url, {
          method: 'POST',
          headers: { ...definition.headers, origin: 'https://malicious.test' },
          body: '{}',
        })
      ).status,
      403,
    );
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: definition.headers },
    });
    await client.connect(transport);
    const tools = await client.listTools();
    assert.equal(tools.tools.length, mcpOperations.length);
    const state = await client.callTool({ name: 'workbench_state', arguments: {} });
    assert.equal(state.isError, undefined);
    assert.deepEqual(calls, ['ready']);
    const invalid = await client.callTool({
      name: 'workbench_command',
      arguments: { command: 'arbitrary.command' },
    });
    assert.equal(invalid.isError, true);
    assert.deepEqual(calls, ['ready']);
    enabled = false;
    mcp.refresh();
    assert.deepEqual(
      await provider!.provideMcpServerDefinitions({} as VSCode.CancellationToken),
      [],
    );
    await assert.rejects(fetch(url, { method: 'POST', headers: definition.headers, body: '{}' }));
  } finally {
    await client.close();
    mcp.dispose();
  }
});
