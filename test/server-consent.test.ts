import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Store } from '../src/store';
import { Servers } from '../src/servers';
import { ServerActions } from '../src/server-actions';
import { Workbench } from '../src/workbench';
import { Consent } from '../src/consent';
import { mcpOperations } from '../src/mcp-operations';
import type { ServerProfile } from '../src/models';
import legal from '../src/legal.json';

test('server EULA is confirmed through the webview and cannot be accepted by MCP/save/create flags', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-eula-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const jobs = { output: { info: () => {}, error: () => {} }, items: [] };
  const servers = new Servers(
    store,
    {} as never,
    jobs as never,
    {} as never,
    {} as never,
    () => {},
  );
  const consent = new Consent({ get: () => undefined, update: async () => {} });
  const workbench = new Workbench(
    {} as never,
    store,
    {} as never,
    {} as never,
    { jobs } as never,
    consent,
    servers,
  );
  const receive = (request: unknown) =>
    (workbench as unknown as { receive(value: unknown): Promise<void> }).receive(request);
  mock.method(servers.catalog, 'versions', async () => ['1.21.1']);
  mock.method(servers.catalog, 'builds', async () => []);
  try {
    await fs.mkdir(root, { recursive: true });
    const server = await servers.create({
      name: 'EULA',
      engine: 'vanilla',
      version: '1.21.1',
      parent: root,
      eulaAccepted: true,
    });
    assert.equal(server.eulaAccepted, undefined);
    await receive({
      id: 1,
      method: 'server.acceptEula',
      params: { serverId: server.id, accepted: true },
    });
    assert.equal(server.eulaAccepted, undefined);
    await consent.accept({ version: legal.version, minecraftEula: true, workbenchTerms: true });
    await assert.rejects(
      workbench.handle('server.acceptEula', { serverId: server.id, accepted: true }),
      /Unknown server request/,
    );
    await receive({
      id: 2,
      method: 'server.acceptEula',
      params: { serverId: server.id, accepted: 'true' },
    });
    assert.equal(server.eulaAccepted, undefined);
    const actions = new ServerActions(servers, {} as never, jobs as never);
    await actions.handle('server.save', {
      serverId: server.id,
      value: { name: 'EULA', eulaAccepted: true },
      properties: {},
    });
    assert.equal(server.eulaAccepted, undefined);
    const save = mock.method(store, 'save', async () => {
      throw new Error('disk full');
    });
    await receive({
      id: 3,
      method: 'server.acceptEula',
      params: { serverId: server.id, accepted: true },
    });
    assert.ok(!server.eulaAccepted);
    save.mock.restore();
    await receive({
      id: 4,
      method: 'server.acceptEula',
      params: { serverId: server.id, accepted: true },
    });
    assert.equal(server.eulaAccepted, true);
    assert.ok(Number.isFinite(Date.parse(server.eulaAcceptedAt!)));
    assert.ok(!mcpOperations.some((operation) => operation.method === 'server.acceptEula'));
  } finally {
    servers.dispose();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('starting an unconfirmed server opens EULA review without starting or preparing Java', async () => {
  const vscode = require('vscode');
  const original = vscode.commands;
  const commands: string[] = [];
  vscode.commands = {
    executeCommand: async (command: string) => {
      commands.push(command);
    },
  };
  const store = new Store('/unused', () => {});
  const server = {
    id: 'server',
    name: 'Server',
    engine: 'paper',
    minecraft: '1.21.1',
    directory: '/unused',
    createdAt: '',
  } as ServerProfile;
  store.state.servers.push(server);
  store.state.selectedServer = server.id;
  mock.method(store, 'save', async () => {});
  let starts = 0;
  const service = {
    store,
    selected: server,
    start: async () => {
      starts++;
    },
  };
  const actions = new ServerActions(service as never, {} as never, {} as never);
  try {
    assert.equal(await actions.handle('server.action', { action: 'start' }), false);
    assert.deepEqual(commands, ['minecraftWorkbench.reviewServerEula']);
    assert.equal(starts, 0);
    server.eulaAccepted = true;
    assert.equal(await actions.handle('server.action', { action: 'start' }), true);
    assert.equal(starts, 1);
  } finally {
    vscode.commands = original;
    store.dispose();
  }
});

test('failed server settings persistence restores the profile and original properties', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-save-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const server = {
    id: 'server',
    name: 'Before',
    engine: 'vanilla',
    minecraft: '1.21.1',
    directory: root,
    createdAt: '',
  } as ServerProfile;
  store.state.servers.push(server);
  store.state.selectedServer = server.id;
  const servers = new Servers(store, {} as never, {} as never, {} as never, {} as never, () => {});
  const actions = new ServerActions(servers, {} as never, {} as never);
  try {
    await fs.writeFile(
      path.join(root, 'server.properties'),
      'motd=before\nrcon.password=preserved\n',
    );
    const before = structuredClone(server);
    mock.method(store, 'save', async () => {
      throw new Error('disk full');
    });
    await assert.rejects(
      actions.handle('server.save', {
        value: { name: 'After', java: '/test/java', maxMemory: 2048 },
        properties: { motd: 'after' },
      }),
      /disk full/,
    );
    assert.deepEqual(server, before);
    assert.equal(
      await fs.readFile(path.join(root, 'server.properties'), 'utf8'),
      'motd=before\nrcon.password=preserved\n',
    );
  } finally {
    servers.dispose();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
