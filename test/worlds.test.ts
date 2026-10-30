import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { importWorlds, exportWorld } from '../src/worlds';
import { Instance } from '../src/models';
import { InstanceFiles } from '../src/instance-files';
import { ContentService } from '../src/content';
import { Store } from '../src/store';
import { Network } from '../src/network';
import { ImportSession } from '../src/import-session';
const signal = () => new AbortController().signal;
test('world ZIPs round-trip in native format without overwriting existing worlds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-worlds-'));
  const instance: Instance = {
    id: 'x',
    name: 'Game',
    minecraft: '1.21.1',
    loader: 'vanilla',
    directory: path.join(root, 'game'),
    createdAt: '',
  };
  try {
    const world = path.join(root, 'World');
    await fs.mkdir(path.join(world, 'region'), { recursive: true });
    await fs.writeFile(path.join(world, 'level.dat'), 'nbt-data');
    await fs.writeFile(path.join(world, 'region', 'r.0.0.mca'), 'region');
    assert.deepEqual(await importWorlds(instance, world, signal()), ['World']);
    assert.deepEqual(await importWorlds(instance, world, signal()), ['World (2)']);
    await exportWorld(instance, 'World', path.join(root, 'world.zip'), signal());
    assert.deepEqual(await importWorlds(instance, path.join(root, 'world.zip'), signal()), [
      'World (3)',
    ]);
    assert.equal(
      await fs.readFile(
        path.join(instance.directory, 'saves', 'World (3)', 'region', 'r.0.0.mca'),
        'utf8',
      ),
      'region',
    );
    await assert.rejects(
      exportWorld(instance, '../escape', path.join(root, 'bad.zip'), signal()),
      /Invalid/,
    );
    await assert.rejects(importWorlds(instance, path.join(root, 'missing'), signal()));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('native instance ZIP exports round-trip through MultiMC import and omit private metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-native-pack-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const session = new ImportSession(store);
  const instance: Instance = {
    id: 'x',
    name: '中文 Pack',
    minecraft: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.10',
    directory: path.join(root, 'game'),
    createdAt: '',
  };
  try {
    for (const [file, data] of [
      ['mods/local.jar', 'mod'],
      ['saves/World/level.dat', 'world'],
      ['config/test.cfg', 'config'],
      ['accounts.json', 'private-token'],
      ['.workbench/content-private.json', 'private-index'],
    ]) {
      const target = path.join(instance.directory, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, data);
    }
    const archive = path.join(instance.directory, 'instance.zip');
    await new InstanceFiles(store, new ContentService({} as Network)).exportNative(
      instance,
      archive,
      signal(),
      true,
    );
    await new InstanceFiles(store, new ContentService({} as Network)).exportNative(
      instance,
      archive,
      signal(),
      true,
    );
    const scan = await session.inspect(archive, signal());
    assert.equal(scan.candidates[0].name, '中文 Pack');
    assert.equal(scan.candidates[0].loader, 'fabric');
    const copy = await session.commit(
      scan.candidates[0].key,
      'copy',
      signal(),
      'Imported',
      path.join(root, 'target'),
    );
    assert.equal(
      await fs.readFile(path.join(copy.directory, 'saves', 'World', 'level.dat'), 'utf8'),
      'world',
    );
    await assert.rejects(fs.access(path.join(copy.directory, 'accounts.json')));
    await assert.rejects(fs.access(path.join(copy.directory, 'instance.zip')));
    await assert.rejects(
      fs.access(path.join(copy.directory, '.workbench', 'content-private.json')),
    );
  } finally {
    await session.clear();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('repeated world exports exclude their existing archive and reject dot directories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-world-export-'));
  const instance: Instance = {
    id: 'x',
    name: 'Game',
    minecraft: '1.21.1',
    loader: 'vanilla',
    directory: root,
    createdAt: '',
  };
  try {
    const world = path.join(root, 'saves', 'World');
    await fs.mkdir(world, { recursive: true });
    await fs.writeFile(path.join(world, 'level.dat'), 'world');
    const destination = path.join(world, 'backup.zip');
    await exportWorld(instance, 'World', destination, signal());
    const before = (await fs.stat(destination)).size;
    await exportWorld(instance, 'World', destination, signal());
    assert.equal((await fs.stat(destination)).size, before);
    for (const name of ['.', '..', ''])
      await assert.rejects(
        exportWorld(instance, name, destination, signal()),
        /Invalid world folder/,
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
