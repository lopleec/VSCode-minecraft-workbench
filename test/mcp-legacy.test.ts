import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpOperations } from '../src/mcp-operations';

test('older hosts keep MCP off by default and support authenticated manual connections without native MCP APIs', async () => {
  const vscode = require('vscode') as Record<string, unknown>;
  let enabled = false;
  let copied = '';
  Object.assign(vscode, {
    EventEmitter: class {
      event = () => ({ dispose() {} });
      fire() {}
      dispose() {}
    },
    Uri: {
      parse(value: string) {
        return { authority: new URL(value).host, toString: () => value };
      },
    },
    McpHttpServerDefinition: undefined,
    workspace: {
      isTrusted: true,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) => (key === 'mcp.enabled' ? enabled : fallback),
        update: async (_key: string, value: boolean) => {
          enabled = value;
        },
      }),
    },
    env: {
      language: 'en',
      clipboard: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    },
    window: { showInformationMessage: async () => undefined },
  });
  const { WorkbenchMcp } = await import('../src/mcp');
  for (const lm of [
    undefined,
    {},
    {
      registerMcpServerDefinitionProvider: () => {
        throw new Error('Partial API must not register');
      },
    },
  ]) {
    vscode.lm = lm;
    const mcp = new WorkbenchMcp({ accepted: true } as never, async (method) => ({ method }), {
      warn: () => {},
    } as never);
    const client = new Client({ name: 'legacy-test', version: '1.0.0' });
    try {
      assert.equal(mcp.nativeIntegration, false);
      assert.equal(mcp.enabled, false);
      mcp.refresh();
      await assert.rejects(mcp.copyConnection(), /Register MCP first/);
      await mcp.setEnabled(true);
      await mcp.copyConnection();
      const connection = JSON.parse(copied).servers['minecraft-workbench'];
      const url = new URL(connection.url);
      assert.equal(url.hostname, '127.0.0.1');
      assert.match(connection.headers.Authorization, /^Bearer [0-9a-f]{64}$/);
      assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
      await client.connect(
        new StreamableHTTPClientTransport(url, { requestInit: { headers: connection.headers } }),
      );
      const tools = await client.listTools();
      assert.equal(tools.tools.length, mcpOperations.length);
      assert.equal(
        (await client.callTool({ name: 'workbench_state', arguments: {} })).isError,
        undefined,
      );
      await client.close();
      await mcp.setEnabled(false);
      await assert.rejects(fetch(url));
      await assert.rejects(mcp.copyConnection(), /Register MCP first/);
    } finally {
      await client.close().catch(() => {});
      await mcp.setEnabled(false);
      mcp.dispose();
    }
  }
});
