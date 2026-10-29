import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { Store } from '../src/store';
import { ContentService } from '../src/content';
import { InstanceFiles } from '../src/instance-files';
import { Network } from '../src/network';
import { Instance, ModVersion } from '../src/models';
import { validateInstanceSettings } from '../src/instance-settings';

test('instance settings validate memory, resolution, account and argument boundaries', () => {
  const result = validateInstanceSettings(
    {
      name: 'Test',
      minMemory: 512,
      maxMemory: 4096,
      accountId: 'user',
      resolution: { width: 1280, height: 720, fullscreen: true },
      server: 'server.example:25565',
      jvmArgs: ['-XX:+UseG1GC'],
    },
    [{ id: 'user', name: 'Player', kind: 'offline' }],
  );
  assert.equal(result.accountId, 'user');
  assert.equal(result.resolution?.width, 1280);
  for (const change of [
    { maxMemory: 10 },
    { minMemory: 4096, maxMemory: 512 },
    { accountId: 'other' },
    { resolution: { width: -1, height: 1, fullscreen: true } },
    { server: 'https://server.example' },
    { jvmArgs: ['bad\0'] },
  ])
    assert.throws(() => validateInstanceSettings({ name: 'Test', ...change }, []));
  assert.ok(!('directory' in validateInstanceSettings({ name: 'Safe', directory: '/etc' }, [])));
});
test('local import is collision-safe; exported packs omit worlds, accounts, logs and disabled mods', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-tools-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const instance: Instance = {
    id: 'instance',
    name: 'Test',
    minecraft: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.10',
    directory: path.join(root, 'game'),
    createdAt: '',
  };
  const content = new ContentService({} as Network);
  const tools = new InstanceFiles(store, content);
  try {
    const mod = path.join(root, 'local.jar');
    const zip = new AdmZip();
    zip.addFile('fabric.mod.json', Buffer.from('{"id":"local"}'));
    zip.writeZip(mod);
    await tools.importLocal(instance, 'mod', [mod]);
    await assert.rejects(tools.importLocal(instance, 'mod', [mod]), /already exists/);
    for (const name of [
      'saves/World/level.dat',
      'logs/latest.log',
      '.workbench/content-private.json',
      'config/test.json',
      'mods/disabled.jar.disabled',
    ]) {
      await fs.mkdir(path.dirname(path.join(instance.directory, name)), { recursive: true });
      await fs.writeFile(path.join(instance.directory, name), 'test');
    }
    const destination = path.join(root, 'export.mrpack');
    await tools.exportPack(instance, destination, new AbortController().signal);
    const pack = new AdmZip(destination);
    const entries = pack.getEntries().map((e) => e.entryName);
    assert.ok(entries.includes('overrides/mods/local.jar'));
    assert.ok(entries.includes('overrides/config/test.json'));
    assert.ok(!entries.some((e) => /saves|logs|private|disabled/.test(e)));
    const index = JSON.parse(pack.getEntry('modrinth.index.json')!.getData().toString());
    assert.equal(index.dependencies['fabric-loader'], '0.16.10');
    const copy = await tools.clone(instance, root, 'Copy', false, new AbortController().signal);
    assert.equal(await fs.readFile(path.join(copy.directory, 'config/test.json'), 'utf8'), 'test');
    await assert.rejects(fs.access(path.join(copy.directory, 'saves')));
    assert.equal(copy.playtimeSeconds, 0);
    const restored: Instance = {
      ...instance,
      id: 'restored',
      directory: path.join(root, 'restored'),
    };
    await content.importPack(destination, restored, new AbortController().signal, () => {});
    assert.ok(await fs.readFile(path.join(restored.directory, 'mods/local.jar')));
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('a disabled required mod is enabled; shader dependencies are placed in mods', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-dependency-'));
  const instance: Instance = {
    id: 'test',
    name: 'Test',
    minecraft: '1.21.1',
    loader: 'fabric',
    directory: root,
    createdAt: '',
  };
  const make = (id: string, file: string): ModVersion => ({
    id,
    project_id: id,
    name: id,
    version_number: id,
    game_versions: ['1.21.1'],
    loaders: file.endsWith('.jar') ? ['fabric'] : ['iris'],
    dependencies: [],
    files: [
      {
        filename: file,
        url: 'https://cdn.modrinth.com/' + file,
        primary: true,
        size: 4,
        hashes: { sha1: 'hash' },
      },
    ],
  });
  const mod = make('dependency', 'dep.jar');
  const shader = make('shader', 'shader.zip');
  shader.dependencies = [
    { project_id: 'dependency', version_id: 'dependency', dependency_type: 'required' },
  ];
  const net = {
    json: async (url: string) => (url.includes('/project/') ? { project_type: 'mod' } : mod),
    download: async (_url: string, target: string) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, 'data');
    },
  } as unknown as Network;
  const service = new ContentService(net);
  try {
    await service.install(instance, mod, 'mod', new AbortController().signal, () => {});
    await service.toggle(instance, (await service.list(instance))[0]);
    const plan = await service.plan(instance, shader, 'shader');
    assert.equal(plan.entries.find((e) => e.required)?.action, 'enable');
    assert.equal(plan.entries.find((e) => e.required)?.kind, 'mod');
    await service.install(instance, shader, 'shader', new AbortController().signal, () => {});
    await fs.access(path.join(root, 'shaderpacks/shader.zip'));
    await fs.access(path.join(root, 'mods/dep.jar'));
    await assert.rejects(fs.access(path.join(root, 'mods/dep.jar.disabled')));
    assert.equal(
      (await service.list(instance)).find((e) => e.projectId === 'dependency')?.enabled,
      true,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('empty search explicitly uses downloads and full project versions have no compatibility filter', async () => {
  const urls: string[] = [];
  const content = new ContentService({
    json: async (url: string) => {
      urls.push(url);
      return [];
    },
  } as unknown as Network);
  const instance: Instance = {
    id: 'test',
    name: 'Test',
    minecraft: '1.21.1',
    loader: 'fabric',
    directory: '',
    createdAt: '',
  };
  await content.search('', 'mod', undefined, 0, { order: 'downloads', limit: 20 });
  await content.versions('test');
  await content.versions('test', instance);
  assert.equal(new URL(urls[0]).searchParams.get('index'), 'downloads');
  assert.equal(new URL(urls[1]).searchParams.has('game_versions'), false);
  assert.equal(new URL(urls[2]).searchParams.get('game_versions'), '["1.21.1"]');
});

test('failed modpack registration rolls back the selected instance and removes only the new directory', async () => {
  const vscode = require('vscode');
  vscode.window = { showInputBox: async () => 'Pack' };
  const { UI } = await import('../src/ui');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-pack-registration-'));
  const store = new Store(root, () => {});
  const existing = { id: 'existing', name: 'Existing' } as Instance;
  store.state.instances = [existing];
  store.state.selectedInstance = existing.id;
  store.save = async () => {
    throw new Error('disk full');
  };
  let created = '';
  const minecraft = {
    ensureDirectory: async (instance: Instance) => {
      created = instance.directory;
      await fs.mkdir(created, { recursive: true });
    },
  };
  const jobs = {
    run: async (_label: string, work: (s: AbortSignal, r: () => void) => Promise<void>) =>
      work(new AbortController().signal, () => {}),
  };
  const content = {
    importPack: async (_archive: string, instance: Instance) => {
      instance.minecraft = '1.21.4';
    },
  };
  const ui = new UI(
    store,
    minecraft as never,
    {} as never,
    {} as never,
    jobs as never,
    content as never,
    {} as never,
    {} as never,
    () => {},
  );
  try {
    await assert.rejects(ui.importPack('test.mrpack'), /disk full/);
    assert.deepEqual(store.state.instances, [existing]);
    assert.equal(store.state.selectedInstance, existing.id);
    assert.equal(
      await fs.stat(created).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
