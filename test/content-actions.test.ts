import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { modrinthProjects } from '../src/modrinth';
import { Workbench } from '../src/workbench';
import { ContentService } from '../src/content';
import { Store } from '../src/store';
import type { Instance, ModVersion, ServerProfile } from '../src/models';

const vscode = require('vscode');

test('batch input accepts Modrinth mod links and IDs, deduplicates and rejects unrelated sources', () => {
  assert.deepEqual(
    modrinthProjects(
      'sodium, https://modrinth.com/mod/lithium\nsodium;https://www.modrinth.com/project/fabric-api/version/test',
    ),
    ['sodium', 'lithium', 'fabric-api'],
  );
  for (const value of [
    '',
    'https://example.com/mod/sodium',
    'https://modrinth.com/modpack/test',
    '../mods/a.jar',
    Array.from({ length: 101 }, (_, i) => `project-${i}`).join('\n'),
  ])
    assert.throws(() => modrinthProjects(value));
});

function version(
  id: string,
  loader: string,
  game = '1.20.1',
  type: ModVersion['version_type'] = 'release',
): ModVersion {
  return {
    id,
    project_id: 'project',
    name: id,
    version_number: id,
    game_versions: [game],
    loaders: [loader],
    version_type: type,
    date_published: '2026-01-01',
    dependencies: [],
    files: [],
  };
}

test('list installation selects a stable matching client or server version and uses the existing dependency installer', async () => {
  const store = new Store('/unused', () => {});
  const client = { id: 'client', minecraft: '1.20.1', loader: 'fabric' } as Instance;
  const server = {
    id: 'server',
    minecraft: '1.20.1',
    engine: 'paper',
    directory: '/unused/server',
  } as ServerProfile;
  store.state.instances = [client];
  store.state.selectedInstance = client.id;
  store.state.servers = [server];
  store.state.selectedServer = server.id;
  const versions = [
    version('wrong-game', 'fabric', '1.21.1'),
    version('wrong-loader', 'forge'),
    version('beta', 'fabric', '1.20.1', 'beta'),
    version('stable', 'fabric'),
    version('plugin', 'paper'),
  ];
  const installed: unknown[][] = [];
  const content = {
    versions: async () => versions,
    version: async (id: string) => versions.find((v) => v.id === id),
    exclusive: async (_target: unknown, work: () => unknown) => work(),
    install: async (...args: unknown[]) => {
      installed.push(args);
    },
  };
  const ui = {
    installVersion: async (...args: unknown[]) => {
      installed.push(args);
    },
    jobs: {
      run: async (_label: unknown, work: Function) => work(new AbortController().signal, () => {}),
    },
  };
  const workbench = new Workbench(
    {} as never,
    store,
    content as never,
    {} as never,
    ui as never,
    { allowsRequest: () => true } as never,
    {
      selected: server,
      exclusive: async (_target: unknown, work: () => unknown) => work(),
    } as never,
  );
  try {
    await workbench.handle('quickInstall', {
      projectId: 'project',
      kind: 'mod',
      instanceId: client.id,
    });
    assert.equal(installed[0][0], client);
    assert.equal(installed[0][1], 'stable');
    store.state.mode = 'server';
    await workbench.handle('quickInstall', {
      projectId: 'project',
      kind: 'plugin',
      serverId: server.id,
    });
    assert.equal((installed[1][1] as ModVersion).id, 'plugin');
    await assert.rejects(
      workbench.handle('quickInstall', { projectId: 'project', kind: 'modpack' }),
      /modpack version/,
    );
    await assert.rejects(
      workbench.handle('quickInstall', {
        projectId: 'project',
        instanceId: client.id,
        serverId: server.id,
      }),
      /not both/,
    );
    versions.splice(0, versions.length);
    await assert.rejects(
      workbench.handle('quickInstall', {
        projectId: 'project',
        kind: 'plugin',
        serverId: server.id,
      }),
      /No compatible version/,
    );
  } finally {
    store.dispose();
  }
});

for (const mode of ['launcher', 'server'] as const)
  test(`bulk ${mode} management supports disabled files, checks exact names and keeps native delete confirmation`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-content-actions-'));
    const store = new Store(directory, () => {});
    const instance = { id: 'client', directory, minecraft: '1.20.1', loader: 'fabric' } as Instance;
    const server = {
      id: 'server',
      directory,
      minecraft: '1.20.1',
      engine: 'paper',
    } as ServerProfile;
    store.state.mode = mode;
    store.state.instances = [instance];
    store.state.selectedInstance = instance.id;
    store.state.servers = [server];
    store.state.selectedServer = server.id;
    const service = new ContentService({} as never);
    let running = false;
    const assertIdle = () => {
      if (running) throw new Error('running');
    };
    const workbench = new Workbench(
      {} as never,
      store,
      service,
      { assertIdle } as never,
      {
        jobs: {
          run: async (_label: unknown, work: Function) =>
            work(new AbortController().signal, () => {}),
        },
      } as never,
      { allowsRequest: () => true } as never,
      {
        selected: server,
        assertIdle,
        exclusive: async (_server: unknown, work: () => unknown) => {
          assertIdle();
          return work();
        },
      } as never,
    );
    const kind = mode === 'server' ? 'plugin' : 'mod';
    const folder = path.join(directory, kind === 'mod' ? 'mods' : 'plugins');
    vscode.window.showWarningMessage ||= async () => {};
    const confirmation = mock.method(vscode.window, 'showWarningMessage', async () => undefined);
    try {
      await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, 'a.jar'), 'a');
      await fs.writeFile(path.join(folder, 'b.jar.disabled'), 'b');
      assert.deepEqual(
        await workbench.handle('manageContent', {
          kind,
          action: 'disable',
          files: ['a.jar', 'b.jar.disabled'],
        }),
        { changed: 2, failed: [] },
      );
      assert.deepEqual((await fs.readdir(folder)).sort(), ['a.jar.disabled', 'b.jar.disabled']);
      await assert.rejects(
        workbench.handle('manageContent', { kind, action: 'remove', files: ['../escape.jar'] }),
        /Content changed/,
      );
      const cancelled = await workbench.handle('manageContent', {
        kind,
        action: 'remove',
        files: ['a.jar.disabled'],
      });
      assert.deepEqual(cancelled, { cancelled: true, changed: 0, failed: [] });
      assert.equal(confirmation.mock.callCount(), 1);
      running = true;
      await assert.rejects(
        workbench.handle('manageContent', { kind, action: 'enable', files: ['a.jar.disabled'] }),
        /running/,
      );
      running = false;
      await workbench.handle('manageContent', {
        kind,
        action: 'enable',
        files: ['a.jar.disabled', 'b.jar.disabled'],
      });
      confirmation.mock.mockImplementation(async (...args: unknown[]) => args[2]);
      await workbench.handle('manageContent', {
        kind,
        action: 'remove',
        files: ['a.jar', 'b.jar'],
      });
      assert.deepEqual(await fs.readdir(folder), []);
    } finally {
      confirmation.mock.restore();
      store.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
