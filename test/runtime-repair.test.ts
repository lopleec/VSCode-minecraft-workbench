import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Version, MinecraftFolder } from '@xmcl/core';
import { Instance, Loader } from '../src/models';
import { Network } from '../src/network';
import { installRuntime } from '../src/runtime-install';
import { RuntimeQueue } from '../src/runtime-queue';
import { scanInstances, InstanceImporter } from '../src/instance-import';
import { Store } from '../src/store';
import { hashFile, writeJson } from '../src/files';

const sha1 = (bytes: Buffer) => createHash('sha1').update(bytes).digest('hex');
function jar() {
  const zip = new AdmZip();
  zip.addFile('fixture.class', Buffer.from('fixture'));
  return zip.toBuffer();
}
async function fixture(loader: Loader = 'vanilla') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-repair-'));
  const game = loader === 'forge' ? '1.12.2' : '1.21.1';
  const pinned = {
    vanilla: undefined,
    fabric: '0.16.10',
    quilt: '0.26.0',
    forge: '14.23.5.2855',
    neoforge: '21.1.0',
  }[loader];
  const client = jar(),
    library = jar(),
    loaderJar = jar(),
    asset = Buffer.from('game asset');
  const assetHash = sha1(asset);
  const metadata = {
    id: game,
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    minecraftArguments: '--username ${auth_player_name}',
    assets: game,
    javaVersion: { majorVersion: game === '1.12.2' ? 8 : 21, component: 'fixture' },
    downloads: {
      client: { url: 'https://fixture.test/client.jar', sha1: sha1(client), size: client.length },
    },
    libraries: [
      {
        name: 'example:runtime:1',
        downloads: {
          artifact: {
            path: 'example/runtime/1/runtime.jar',
            url: 'https://fixture.test/library.jar',
            sha1: sha1(library),
            size: library.length,
          },
        },
      },
    ],
    assetIndex: { id: game, url: 'https://fixture.test/assets.json' },
  };
  const profile = {
    id: `${loader}-${game}-${pinned}`,
    inheritsFrom: game,
    mainClass: 'net.minecraft.client.main.Main',
    minecraftArguments: '--tweakClass fixture.Tweaker',
    libraries: [
      {
        name:
          loader === 'forge'
            ? `net.minecraftforge:forge:${game}-${pinned}`
            : `example:${loader}:${pinned}`,
        downloads: {
          artifact: {
            path: 'example/loader/loader.jar',
            url: 'https://fixture.test/loader.jar',
            sha1: sha1(loaderJar),
            size: loaderJar.length,
          },
        },
      },
    ],
  };
  const metadataBytes = Buffer.from(JSON.stringify(metadata));
  const remote = new Map<string, Buffer>([
    ['https://fixture.test/base.json', metadataBytes],
    ['https://fixture.test/client.jar', client],
    ['https://fixture.test/library.jar', library],
    ['https://fixture.test/loader.jar', loaderJar],
    [
      'https://fixture.test/assets.json',
      Buffer.from(JSON.stringify({ objects: { asset: { hash: assetHash, size: asset.length } } })),
    ],
    [`https://resources.download.minecraft.net/${assetHash.slice(0, 2)}/${assetHash}`, asset],
  ]);
  const installer = new AdmZip();
  if (loader === 'forge') {
    installer.addFile(`forge-${game}-${pinned}-universal.jar`, loaderJar);
    installer.addFile(
      'install_profile.json',
      Buffer.from(JSON.stringify({ versionInfo: profile })),
    );
  } else {
    installer.addFile('version.json', Buffer.from(JSON.stringify(profile)));
    installer.addFile(
      'install_profile.json',
      Buffer.from(
        JSON.stringify({
          minecraft: game,
          version: profile.id,
          libraries: [],
          processors: [],
          data: {},
        }),
      ),
    );
  }
  const installerUrl =
    loader === 'neoforge'
      ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${pinned}/neoforge-${pinned}-installer.jar`
      : `https://maven.minecraftforge.net/net/minecraftforge/forge/${game}-${pinned}/forge-${game}-${pinned}-installer.jar`;
  remote.set(installerUrl, installer.toBuffer());
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const url = new URL(req.url!, 'http://localhost').searchParams.get('url')!;
    const bytes = remote.get(url);
    res.writeHead(bytes ? 200 : 404, { 'content-length': bytes?.length || 0 });
    res.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const net = new Network({
    proxy: '',
    sources: {},
    concurrency: 3,
    retries: 0,
    cacheDirectory: path.join(root, 'cache'),
  });
  const download = net.download.bind(net);
  net.download = (url, file, options) =>
    download(`http://127.0.0.1:${port}/?url=${encodeURIComponent(url)}`, file, options);
  net.json = async () => structuredClone(profile) as never;
  const services = {
    net,
    java: { ensure: async () => ({ path: process.execPath }) } as never,
    output: { append() {} },
    manifest: async () => ({
      latest: { release: game, snapshot: game },
      versions: [
        {
          id: game,
          type: 'release',
          url: 'https://fixture.test/base.json',
          sha1: sha1(metadataBytes),
          releaseTime: '',
        },
      ],
    }),
    loaders: async () => {
      throw new Error('Repair must not upgrade a pinned loader');
    },
  };
  const instance: Instance = {
    id: 'game',
    name: 'Game',
    minecraft: game,
    loader,
    loaderVersion: pinned,
    directory: path.join(root, 'game'),
    runtimeDirectory: path.join(root, 'runtime'),
    createdAt: '',
    installed: true,
  };
  const folder = new MinecraftFolder(instance.runtimeDirectory!);
  const run = () => installRuntime(instance, services, new AbortController().signal, () => {});
  return {
    root,
    game,
    instance,
    folder,
    services,
    profile,
    metadata,
    client,
    library,
    asset,
    assetHash,
    run,
    requests: () => requests,
    close: async () => {
      await net.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function userFiles(instance: Instance) {
  for (const relative of [
    'saves/World/level.dat',
    'mods/local.jar',
    'config/settings.json',
    'resourcepacks/local.zip',
    'shaderpacks/local.zip',
    'options.txt',
  ]) {
    const file = path.join(instance.directory, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'user data');
  }
}
async function assertUserFiles(instance: Instance) {
  for (const relative of [
    'saves/World/level.dat',
    'mods/local.jar',
    'config/settings.json',
    'resourcepacks/local.zip',
    'shaderpacks/local.zip',
    'options.txt',
  ])
    assert.equal(await fs.readFile(path.join(instance.directory, relative), 'utf8'), 'user data');
}

for (const loader of ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'] as const)
  test(`${loader} repair restores missing/corrupt runtime files without changing user data or the pinned loader`, async () => {
    const f = await fixture(loader);
    try {
      await userFiles(f.instance);
      const result = await f.run();
      assert.equal(result.loaderVersion, f.instance.loaderVersion);
      await fs.writeFile(f.folder.getVersionJar(f.game), 'corrupt client');
      await fs.rm(f.folder.getLibraryByPath('example/runtime/1/runtime.jar'));
      await fs.writeFile(f.folder.getAsset(f.assetHash), 'corrupt asset');
      await fs.writeFile(f.folder.getAssetsIndex(f.game), '{broken asset index');
      const nativeRoot = path.join(f.instance.directory, '.workbench', 'natives', result.versionId);
      await fs.mkdir(nativeRoot, { recursive: true });
      await fs.writeFile(path.join(nativeRoot, 'stale.dll'), 'stale');
      const repaired = await f.run();
      assert.equal(repaired.versionId, result.versionId);
      assert.equal(await hashFile(f.folder.getVersionJar(f.game)), sha1(f.client));
      assert.equal(
        await hashFile(f.folder.getLibraryByPath('example/runtime/1/runtime.jar')),
        sha1(f.library),
      );
      assert.deepEqual(await fs.readFile(f.folder.getAsset(f.assetHash)), f.asset);
      await assert.rejects(fs.access(nativeRoot));
      await assertUserFiles(f.instance);
      const count = f.requests();
      await f.run();
      assert.equal(f.requests(), count, 'Valid cached runtime files need no HTTP downloads');
    } finally {
      await f.close();
    }
  });

for (const sourceFormat of [
  'official',
  'official-copy',
  'hmcl',
  'pcl',
  'prism',
  'multimc',
  'modrinth',
])
  test(`an imported ${sourceFormat} instance uses the shared runtime repair path`, async () => {
    const f = await fixture();
    const store = new Store(path.join(f.root, 'state'), () => {});
    try {
      const source = path.join(f.root, 'source');
      const format = sourceFormat === 'official-copy' ? 'official' : sourceFormat;
      const standard = ['official', 'hmcl', 'pcl'].includes(format);
      let gameDirectory: string;
      if (standard) {
        await writeJson(path.join(source, 'versions', f.game, f.game + '.json'), f.metadata);
        gameDirectory =
          format === 'official'
            ? path.join(source, 'official-game')
            : path.join(source, 'versions', 'Custom');
        if (format === 'official')
          await writeJson(path.join(source, 'launcher_profiles.json'), {
            profiles: { main: { name: 'Official', lastVersionId: f.game, gameDir: gameDirectory } },
          });
        else {
          await writeJson(path.join(gameDirectory, 'Custom.json'), {
            id: 'Custom',
            inheritsFrom: f.game,
            arguments: { jvm: ['-Dcustom=keep'] },
          });
          if (format === 'hmcl')
            await writeJson(path.join(gameDirectory, 'hmclversion.cfg'), { gameDirType: 1 });
          else {
            await fs.mkdir(path.join(gameDirectory, 'PCL'), { recursive: true });
            await fs.writeFile(
              path.join(gameDirectory, 'PCL', 'Setup.ini'),
              'VersionArgumentIndie=1\n',
            );
          }
        }
      } else if (format === 'modrinth') {
        gameDirectory = source;
        await writeJson(path.join(source, 'profile.json'), {
          metadata: { name: 'Modrinth', game_version: f.game, loader: 'vanilla' },
        });
      } else {
        gameDirectory = path.join(source, '.minecraft');
        await writeJson(path.join(source, 'mmc-pack.json'), {
          formatVersion: 1,
          components: [{ uid: 'net.minecraft', version: f.game }],
        });
        await fs.writeFile(path.join(source, 'instance.cfg'), '[General]\nname=Pack\n');
      }
      await userFiles({ ...f.instance, directory: gameDirectory });
      const scan = await scanInstances(source);
      const realDirectory = await fs.realpath(gameDirectory);
      const item = scan.candidates.find(
        (c) => path.resolve(c.directory) === path.resolve(realDirectory),
      )!;
      assert.ok(item, 'Real launcher metadata is discovered');
      const imported = await new InstanceImporter(store).import(
        item,
        sourceFormat === 'official-copy' ? 'copy' : 'link',
        new AbortController().signal,
        'Imported',
        f.instance.runtimeDirectory,
      );
      if (sourceFormat === 'official-copy') await fs.rm(source, { recursive: true });
      if (standard)
        await fs.rm(path.join(imported.runtimeDirectory!, 'versions', f.game, f.game + '.json'));
      const result = await installRuntime(
        imported,
        f.services,
        new AbortController().signal,
        () => {},
      );
      assert.ok(result.versionId);
      assert.equal(imported.linked, sourceFormat !== 'official-copy');
      await assertUserFiles(imported);
      if (format !== 'official' && standard)
        assert.ok(
          (
            await Version.parse(imported.runtimeDirectory!, result.versionId)
          ).arguments.jvm.includes('-Dcustom=keep'),
        );
    } finally {
      store.dispose();
      await f.close();
    }
  });

test('repairing an imported Forge instance preserves its custom profile while regenerating loader files', async () => {
  const f = await fixture('forge');
  try {
    const initial = await f.run();
    f.instance.preserveVersion = true;
    f.instance.versionId = initial.versionId;
    const file = f.folder.getVersionJson(initial.versionId);
    const custom = { ...f.profile, arguments: { jvm: ['-Dcustom=keep'] } };
    await writeJson(file, custom);
    const text = await fs.readFile(file, 'utf8');
    await fs.rm(f.folder.getLibraryByPath('example/loader/loader.jar'));
    await f.run();
    assert.equal(await fs.readFile(file, 'utf8'), text);
    assert.ok(
      (await Version.parse(f.folder, initial.versionId)).arguments.jvm.includes('-Dcustom=keep'),
    );
  } finally {
    await f.close();
  }
});

test('known loader metadata can be rebuilt with an original backup; unknown custom profiles fail without data changes', async () => {
  const f = await fixture('fabric');
  try {
    await f.run();
    f.instance.preserveVersion = true;
    f.instance.versionId = 'Imported';
    await writeJson(f.folder.getVersionJson('Imported'), { id: 'Imported' });
    await fs.writeFile(f.folder.getVersionJson('Imported'), '{broken');
    const result = await f.run();
    assert.equal(result.versionId, 'Imported');
    const backups = await fs.readdir(path.join(f.folder.root, '.workbench', 'profile-backups'));
    assert.ok(backups.includes('Imported'));
    assert.equal((await Version.parse(f.folder, 'Imported')).minecraftVersion, f.game);
    f.instance.loader = 'vanilla';
    await fs.writeFile(f.folder.getVersionJson('Imported'), '{unknown custom');
    await assert.rejects(f.run(), /Cannot recover custom version profile/);
    assert.equal(await fs.readFile(f.folder.getVersionJson('Imported'), 'utf8'), '{unknown custom');
  } finally {
    await f.close();
  }
});

test('repair infers a missing loader pin from the installed profile instead of selecting the latest version', async () => {
  const f = await fixture('forge');
  try {
    const initial = await f.run();
    f.instance.versionId = initial.versionId;
    f.instance.preserveVersion = true;
    f.instance.loaderVersion = undefined;
    assert.equal((await f.run()).loaderVersion, '14.23.5.2855');
  } finally {
    await f.close();
  }
});

test('a cancelled queued repair never starts or lets another repair bypass the current writer', async () => {
  const queue = new RuntimeQueue();
  const controller = new AbortController();
  const order: string[] = [];
  let release!: () => void;
  const first = queue.run('/fixture/runtime', new AbortController().signal, async () => {
    order.push('first');
    await new Promise<void>((resolve) => (release = resolve));
  });
  const second = queue.run('/fixture/runtime', controller.signal, async () => {
    order.push('cancelled');
  });
  const rejection = assert.rejects(second, { name: 'AbortError' });
  controller.abort();
  await rejection;
  const third = queue.run('/fixture/runtime', new AbortController().signal, async () => {
    order.push('third');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['first']);
  release();
  await Promise.all([first, third]);
  assert.deepEqual(order, ['first', 'third']);
});
