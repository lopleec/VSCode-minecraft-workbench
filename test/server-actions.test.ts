import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store } from '../src/store';
import type { ServerProfile } from '../src/models';

test('server upgrades re-evaluate Java requirements and failed version saves restore the profile', async () => {
  const mutable = require('vscode') as { window: unknown };
  mutable.window = {
    showQuickPick: async (items: unknown[]) => items[0],
    showWarningMessage: async (_message: string, _options: unknown, label: string) => label,
  };
  const { Servers } = await import('../src/servers');
  const { ServerActions } = await import('../src/server-actions');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-upgrade-'));
  const store = new Store(path.join(root, 'state'), () => {});
  await store.load();
  const directory = path.join(root, 'server');
  await fs.mkdir(directory);
  const server: ServerProfile = {
    id: 'upgrade',
    name: 'Upgrade',
    engine: 'vanilla',
    minecraft: '1.16.5',
    requiredJava: 8,
    installed: true,
    launchArgs: ['-jar', 'server.jar'],
    directory,
    createdAt: new Date(0).toISOString(),
  };
  store.state.servers.push(server);
  store.state.selectedServer = server.id;
  const versions: number[] = [];
  const jobs = {
    run: async (
      _label: string,
      work: (signal: AbortSignal, report: () => void) => Promise<unknown>,
    ) => work(new AbortController().signal, () => {}),
    output: { error: () => {} },
  };
  const service = new Servers(
    store,
    {
      ensure: async (major: number) => {
        versions.push(major);
        return { path: '/test/java', major };
      },
    } as never,
    jobs as never,
    { download: async (_url: string, file: string) => fs.writeFile(file, 'server') } as never,
    {} as never,
    () => {},
  );
  mock.method(service.catalog, 'versions', async () => ['1.21.4']);
  mock.method(service.catalog, 'builds', async () => []);
  mock.method(service.catalog, 'metadata', async () => ({ javaVersion: { majorVersion: 21 } }));
  mock.method(service.catalog, 'artifact', async () => ({
    url: 'https://example.test/server.jar',
  }));
  const actions = new ServerActions(service, {} as never, jobs as never);
  try {
    const before = structuredClone(server);
    const save = mock.method(store, 'save', async () => {
      throw new Error('disk full');
    });
    try {
      await assert.rejects(actions.handle('server.action', { action: 'version' }), /disk full/);
      assert.deepEqual(server, before);
    } finally {
      save.mock.restore();
    }
    await actions.handle('server.action', { action: 'version' });
    assert.deepEqual(versions, [21]);
    assert.equal(server.minecraft, '1.21.4');
    assert.equal(server.requiredJava, 21);
    assert.equal(server.installed, true);
  } finally {
    await service.close();
    service.dispose();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('invalid Velocity game metadata does not leave an unregistered server directory', async () => {
  const { Servers } = await import('../src/servers');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-create-'));
  const store = new Store(path.join(root, 'state'), () => {});
  await store.load();
  const service = new Servers(store, {} as never, {} as never, {} as never, {} as never, () => {});
  mock.method(service.catalog, 'versions', async () => ['3.4.0']);
  mock.method(service.catalog, 'builds', async () => [{ id: '1', stable: true }]);
  mock.method(service.catalog, 'metadata', async () => {
    throw new Error('metadata unavailable');
  });
  const parent = path.join(root, 'servers');
  await fs.mkdir(parent);
  try {
    await assert.rejects(
      service.create({
        name: 'Proxy',
        engine: 'velocity',
        version: '3.4.0',
        minecraft: '1.21.4',
        parent,
      }),
      /metadata unavailable/,
    );
    assert.deepEqual(await fs.readdir(parent), []);
    assert.deepEqual(store.state.servers, []);
  } finally {
    service.dispose();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
