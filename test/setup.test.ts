import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store } from '../src/store';
import { InstanceSetup } from '../src/setup';
import { Minecraft } from '../src/minecraft';
import type { Instance } from '../src/models';

test('setup accepts every official game version type and validates loader compatibility before updating an instance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-setup-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const types = ['release', 'snapshot', 'old_beta', 'old_alpha'];
  const engine = {
    manifest: async () => ({
      latest: { release: 'release', snapshot: 'snapshot' },
      versions: types.map((type) => ({
        id: type,
        type,
        url: 'https://example.com/version.json',
        releaseTime: '2026-01-01',
      })),
    }),
    loaders: async (_loader: string, game: string) =>
      game === 'release' ? ['1.0-beta.1', '1.0'] : [],
    assertIdle: () => {},
    ensureDirectory: async (instance: Instance) => {
      await fs.mkdir(instance.directory, { recursive: true });
    },
  } as unknown as Minecraft;
  const service = new InstanceSetup(store, engine);
  try {
    for (const minecraft of types) {
      const created = await service.save({
        name: minecraft,
        minecraft,
        loader: 'vanilla',
        parentDirectory: root,
        ...(minecraft === 'release' ? { maxMemory: 2048 } : {}),
      });
      assert.equal(created.minecraft, minecraft);
      if (minecraft !== 'release') {
        assert.equal(created.minMemory, undefined);
        assert.equal(created.maxMemory, undefined);
      }
      assert.equal(store.state.selectedInstance, created.id);
      assert.equal(created.directory, path.join(root, 'instances', minecraft, '.minecraft'));
      assert.equal(created.layout, 'multimc');
      await fs.access(created.directory);
    }
    const original = store.state.instances[0];
    original.installed = true;
    original.versionId = 'installed';
    original.jvmArgs = ['-Dtest=true'];
    const before = structuredClone(original);
    await assert.rejects(
      service.save(
        { name: 'Preview', minecraft: 'snapshot', loader: 'fabric', loaderVersion: '1.0' },
        original,
      ),
      /compatible/,
    );
    assert.deepEqual(original, before);
    await service.save(
      { name: 'Beta loader', minecraft: 'release', loader: 'fabric', loaderVersion: '1.0-beta.1' },
      original,
    );
    assert.equal(original.loaderVersion, '1.0-beta.1');
    assert.equal(original.installed, false);
    assert.equal(original.versionId, undefined);
    assert.deepEqual(original.jvmArgs, ['-Dtest=true']);
    assert.equal(original.directory, before.directory);
    await assert.rejects(
      service.save({
        name: 'Invalid',
        minecraft: 'missing',
        loader: 'vanilla',
        parentDirectory: root,
      }),
      /Minecraft version/,
    );
    await assert.rejects(
      service.save({
        name: 'Invalid',
        minecraft: 'release',
        loader: 'vanilla',
        parentDirectory: 'relative',
      }),
      /absolute/,
    );
    assert.equal(store.state.instances.length, 4);
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('failed instance creation restores the selection and removes its empty directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-setup-failure-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const original: Instance = {
    id: 'original',
    name: 'Original',
    minecraft: '1.21.1',
    loader: 'vanilla',
    directory: path.join(root, 'original'),
    createdAt: new Date().toISOString(),
  };
  store.state.instances.push(original);
  store.state.selectedInstance = original.id;
  const engine = {
    manifest: async () => ({ versions: [{ id: '1.21.1', type: 'release' }] }),
    ensureDirectory: async (instance: Instance) => {
      await fs.mkdir(instance.directory, { recursive: true });
    },
  } as unknown as Minecraft;
  const save = store.save.bind(store);
  store.save = async () => {
    throw new Error('Disk full');
  };
  try {
    await assert.rejects(
      new InstanceSetup(store, engine).save({
        name: 'New instance',
        minecraft: '1.21.1',
        loader: 'vanilla',
        parentDirectory: root,
      }),
      /Disk full/,
    );
    assert.deepEqual(store.state.instances, [original]);
    assert.equal(store.state.selectedInstance, original.id);
    assert.deepEqual(await fs.readdir(root), []);
    store.save = save;
    const result = await new InstanceSetup(store, engine).save({
      name: 'Retry',
      minecraft: '1.21.1',
      loader: 'vanilla',
      parentDirectory: root,
    });
    assert.equal(store.state.selectedInstance, result.id);
    assert.equal(store.state.instances.length, 2);
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('failed version changes retain the installed profile and original settings', async () => {
  const store = new Store('/unused', () => {});
  const original: Instance = {
    id: 'original',
    name: 'Original',
    minecraft: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.10',
    installed: true,
    versionId: 'fabric-profile',
    directory: '/unused/game',
    maxMemory: 3072,
    createdAt: new Date().toISOString(),
  };
  store.state.instances.push(original);
  const before = structuredClone(original);
  store.save = async () => {
    throw new Error('Permission denied');
  };
  const engine = {
    assertIdle: () => {},
    manifest: async () => ({ versions: [{ id: '26w14a', type: 'snapshot' }] }),
  } as unknown as Minecraft;
  await assert.rejects(
    new InstanceSetup(store, engine).save(
      { name: 'April Fools', minecraft: '26w14a', loader: 'vanilla' },
      original,
    ),
    /Permission denied/,
  );
  assert.equal(store.state.instances[0], original);
  assert.deepEqual(original, before);
});
