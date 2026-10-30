import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { Store } from '../src/store';
import { InstanceImporter, scanInstances, versionChain } from '../src/instance-import';
import { ImportSession } from '../src/import-session';
import {
  defaultMinecraftDirectory,
  reserveInstanceLocation,
  writeInstanceMetadata,
} from '../src/game-paths';
import { suggestedFilename, writeJson } from '../src/files';

const signal = () => new AbortController().signal;
const profile = (id: string, extra = {}) => ({
  id,
  mainClass: 'net.minecraft.client.main.Main',
  type: 'release',
  libraries: [],
  arguments: { game: [], jvm: [] },
  ...extra,
});
async function temp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mc-import-'));
}
async function put(root: string, file: string, value: string) {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), value);
}

test('new instances use portable Prism/MultiMC metadata, readable unique names, and system game roots', async () => {
  const root = await temp();
  try {
    const first = await reserveInstanceLocation(root, '我的世界');
    const second = await reserveInstanceLocation(root, '我的世界');
    assert.equal(first.directory, path.join(root, 'instances', '我的世界', '.minecraft'));
    assert.equal(second.containerDirectory, path.join(root, 'instances', '我的世界 (2)'));
    await writeInstanceMetadata({
      ...first,
      id: 'a',
      name: '我的世界',
      minecraft: '1.21.1',
      loader: 'fabric',
      loaderVersion: '0.16.10',
      createdAt: '',
    });
    const cfg = await fs.readFile(path.join(first.containerDirectory!, 'instance.cfg'), 'utf8');
    assert.match(cfg, /InstanceType=OneSix/);
    assert.match(cfg, /name=我的世界/);
    const pack = JSON.parse(
      await fs.readFile(path.join(first.containerDirectory!, 'mmc-pack.json'), 'utf8'),
    );
    assert.deepEqual(
      pack.components.map((c: { uid: string }) => c.uid),
      ['net.minecraft', 'net.fabricmc.fabric-loader'],
    );
    const found = await scanInstances(path.join(root, 'instances'));
    assert.equal(found.candidates.length, 1);
    assert.equal(found.candidates[0].loader, 'fabric');
    assert.equal(found.candidates[0].name, '我的世界');
    assert.equal(
      defaultMinecraftDirectory(
        'win32',
        'C:\\Users\\Player',
        'C:\\Users\\Player\\AppData\\Roaming',
      ),
      'C:\\Users\\Player\\AppData\\Roaming\\.minecraft',
    );
    assert.match(defaultMinecraftDirectory('linux', '/home/player'), /\.minecraft$/);
    for (const value of ['CON.foo', 'NUL.tar.gz', 'COM¹', 'LPT².data'])
      assert.match(suggestedFilename(value), /^_/);
    assert.ok(Buffer.byteLength(suggestedFilename('😀'.repeat(200)) + '.mrpack') < 255);
    assert.equal(suggestedFilename('../我的世界:测试'), '_我的世界_测试');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('standard isolated and official shared profiles retain their real game directories and loaders', async () => {
  const root = await temp();
  try {
    await writeJson(path.join(root, 'versions', '1.21.1', '1.21.1.json'), profile('1.21.1'));
    await writeJson(
      path.join(root, 'versions', 'Fabric Pack', 'Fabric Pack.json'),
      profile('Fabric Pack', {
        inheritsFrom: '1.21.1',
        libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.10' }],
      }),
    );
    await put(root, 'versions/Fabric Pack/saves/World/level.dat', 'world');
    await put(root, 'versions/Fabric Pack/PCL/Setup.ini', 'VersionArgumentIndie=1\n');
    const shared = path.join(root, 'official-game');
    await fs.mkdir(shared);
    await writeJson(path.join(root, 'launcher_profiles.json'), {
      profiles: { official: { name: 'Official', lastVersionId: '1.21.1', gameDir: shared } },
    });
    const found = await scanInstances(root);
    assert.equal(found.candidates.length, 2);
    const fabric = found.candidates.find((c) => c.loader === 'fabric')!;
    assert.equal(fabric.minecraft, '1.21.1');
    assert.equal(fabric.loaderVersion, '0.16.10');
    assert.equal(fabric.directory, await fs.realpath(path.join(root, 'versions', 'Fabric Pack')));
    assert.equal(
      found.candidates.find((c) => c.name === 'Official')!.directory,
      await fs.realpath(shared),
    );
    const store = new Store(path.join(root, 'state'), () => {});
    const imported = await new InstanceImporter(store).import(fabric, 'link', signal());
    assert.equal(imported.preserveVersion, true);
    assert.equal(imported.linked, true);
    await assert.rejects(
      new InstanceImporter(store).import(fabric, 'link', signal()),
      /already registered/,
    );
    store.dispose();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Prism/MultiMC and Modrinth profiles import worlds without hooks or account databases', async () => {
  const root = await temp();
  const store = new Store(path.join(root, 'state'), () => {});
  try {
    const prism = path.join(root, 'PrismLauncher', 'instances', 'test');
    await writeJson(path.join(prism, 'mmc-pack.json'), {
      formatVersion: 1,
      components: [
        { uid: 'net.minecraft', version: '1.20.1' },
        { uid: 'net.minecraftforge', version: '47.2.0' },
      ],
    });
    await put(
      prism,
      'instance.cfg',
      '[General]\nname=Pack\nPreLaunchCommand=do-not-run\nOverrideMemory=true\nMaxMemAlloc=4096\n',
    );
    await put(prism, '.minecraft/saves/World/level.dat', 'world');
    await put(prism, '.minecraft/mods/local.jar', 'mod');
    await put(prism, '.minecraft/accounts.json', 'secret');
    const mr = path.join(root, 'Modrinth', 'profiles', 'one');
    await writeJson(path.join(mr, 'profile.json'), {
      metadata: {
        name: 'MR',
        game_version: '1.21.1',
        loader: 'fabric',
        loader_version: { id: '0.16.10' },
      },
    });
    await put(mr, 'saves/Another/level.dat', 'world2');
    const found = await scanInstances(prism);
    const item = found.candidates[0];
    assert.equal(item.maxMemory, 4096);
    assert.equal(item.loaderVersion, '47.2.0');
    const copy = await new InstanceImporter(store).import(
      item,
      'copy',
      signal(),
      'Copied',
      path.join(root, 'target'),
    );
    assert.equal(copy.layout, 'multimc');
    assert.equal(
      await fs.readFile(path.join(copy.directory, 'saves', 'World', 'level.dat'), 'utf8'),
      'world',
    );
    assert.equal(await fs.readFile(path.join(copy.directory, 'mods', 'local.jar'), 'utf8'), 'mod');
    await assert.rejects(fs.access(path.join(copy.directory, 'accounts.json')));
    assert.doesNotMatch(
      await fs.readFile(path.join(copy.containerDirectory!, 'instance.cfg'), 'utf8'),
      /PreLaunchCommand/,
    );
    assert.equal(
      (await scanInstances(path.join(root, 'Modrinth', 'profiles'))).candidates[0].loaderVersion,
      '0.16.10',
    );
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('copying a standard instance preserves its runtime offline and rejects profile collisions', async () => {
  const root = await temp();
  const store = new Store(path.join(root, 'state'), () => {});
  try {
    const source = path.join(root, 'source');
    const target = path.join(root, 'target');
    await writeJson(path.join(source, 'versions', '1.21.1', '1.21.1.json'), profile('1.21.1'));
    await put(source, 'versions/1.21.1/1.21.1.jar', 'client');
    await put(source, 'libraries/example/lib.jar', 'library');
    await put(source, 'assets/objects/00/hash', 'asset');
    await put(source, 'options.txt', 'lang:zh_cn\n');
    const item = (await scanInstances(source)).candidates[0];
    const copy = await new InstanceImporter(store).import(
      item,
      'copy',
      signal(),
      'Offline copy',
      target,
    );
    assert.equal(copy.preserveVersion, true);
    assert.equal(
      await fs.readFile(path.join(target, 'versions', '1.21.1', '1.21.1.jar'), 'utf8'),
      'client',
    );
    await fs.rm(source, { recursive: true });
    assert.equal((await versionChain(copy.runtimeDirectory!, copy.versionId!))[0].id, '1.21.1');
    assert.equal(
      await fs.readFile(path.join(copy.directory, 'options.txt'), 'utf8'),
      'lang:zh_cn\n',
    );
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ZIP imports are staged, require copying and roll back registration failures', async () => {
  const root = await temp();
  const store = new Store(path.join(root, 'state'), () => {});
  const session = new ImportSession(store);
  try {
    const zip = new AdmZip();
    zip.addFile(
      'Pack/mmc-pack.json',
      Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          components: [{ uid: 'net.minecraft', version: '1.21.1' }],
        }),
      ),
    );
    zip.addFile('Pack/instance.cfg', Buffer.from('name=Pack\n'));
    zip.addFile('Pack/.minecraft/saves/World/level.dat', Buffer.from('world'));
    const archive = path.join(root, 'pack.zip');
    zip.writeZip(archive);
    const found = await session.inspect(archive, signal());
    assert.equal(found.archive, true);
    assert.equal(found.candidates.length, 1);
    await assert.rejects(
      session.commit(found.candidates[0].key, 'link', signal(), 'Pack', path.join(root, 'target')),
      /must be copied/,
    );
    store.save = async () => {
      throw new Error('Disk full');
    };
    await assert.rejects(
      session.commit(found.candidates[0].key, 'copy', signal(), 'Pack', path.join(root, 'target')),
      /Disk full/,
    );
    assert.equal(store.state.instances.length, 0);
    assert.deepEqual(await fs.readdir(path.join(root, 'target', 'instances')), []);
    assert.equal(
      await fs.readFile(
        path.join(found.candidates[0].directory, 'saves', 'World', 'level.dat'),
        'utf8',
      ),
      'world',
    );
  } finally {
    await session.clear();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('broken metadata, traversal, and cyclic inheritance do not hide valid instances', async () => {
  const root = await temp();
  try {
    await writeJson(path.join(root, 'versions', 'ok', 'ok.json'), profile('ok'));
    await writeJson(
      path.join(root, 'versions', 'bad', 'bad.json'),
      profile('bad', { inheritsFrom: '../../escape' }),
    );
    await writeJson(
      path.join(root, 'versions', 'cycle', 'cycle.json'),
      profile('cycle', { inheritsFrom: 'cycle' }),
    );
    const found = await scanInstances(root);
    assert.equal(found.candidates.length, 1);
    assert.equal(found.candidates[0].name, 'ok');
    assert.equal(found.warnings.length, 2);
    await assert.rejects(versionChain(root, '../escape'), /filename/);
    await assert.rejects(versionChain(root, 'cycle'), /Circular/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('shared official games copy into the same Minecraft root without copying other instances', async () => {
  const root = await temp();
  const minecraft = path.join(root, '.minecraft');
  const store = new Store(path.join(root, 'state'), () => {});
  try {
    await writeJson(path.join(minecraft, 'versions', '1.21.1', '1.21.1.json'), profile('1.21.1'));
    await put(minecraft, 'config/test.cfg', 'keep');
    await put(minecraft, 'saves/World/level.dat', 'world');
    await put(minecraft, 'instances/Other/.minecraft/mods/other.jar', 'other-instance');
    await put(minecraft, 'profiles/Other/profile.json', '{}');
    const scan = await scanInstances(minecraft);
    const source = scan.candidates.find((c) => c.format === 'standard')!;
    assert.equal(source.directory, await fs.realpath(minecraft));
    const copy = await new InstanceImporter(store).import(
      source,
      'copy',
      signal(),
      'Copied',
      minecraft,
    );
    assert.equal(copy.directory, path.join(minecraft, 'instances', 'Copied', '.minecraft'));
    assert.equal(
      await fs.readFile(path.join(copy.directory, 'config', 'test.cfg'), 'utf8'),
      'keep',
    );
    assert.equal(
      await fs.readFile(path.join(copy.directory, 'saves', 'World', 'level.dat'), 'utf8'),
      'world',
    );
    await assert.rejects(fs.access(path.join(copy.directory, 'instances')));
    await assert.rejects(fs.access(path.join(copy.directory, 'profiles')));
    assert.equal(
      await fs.readFile(
        path.join(minecraft, 'instances', 'Other', '.minecraft', 'mods', 'other.jar'),
        'utf8',
      ),
      'other-instance',
    );
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
