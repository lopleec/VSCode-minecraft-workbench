import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Instance } from '../src/models';
import { Store } from '../src/store';
import { writeJson } from '../src/files';
import { InstanceImporter, scanInstances } from '../src/instance-import';
import { resolveGameVersion } from '../src/version-profile';
import { installRuntime } from '../src/runtime-install';
import {
  detectLwjgl3ify,
  isLwjgl3ifyProfile,
  installLwjgl3ify,
  lwjgl3ifyModVersion,
  lwjgl3ifyRelease,
  prepareLwjgl3ifyProfile,
} from '../src/lwjgl3ify';
import { HttpError, type Network } from '../src/network';

const signal = () => new AbortController().signal;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

async function temp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mc-lwjgl3ify-'));
}

test('lwjgl3ify profiles become standalone 1.7.10 version layers', async () => {
  const root = await temp();
  try {
    const id = '1.7.10-Forge10.13.4.1614-1.7.10-lwjgl3ify-3.1.1';
    const profile = prepareLwjgl3ifyProfile({
      id,
      mainClass: 'com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread',
      libraries: [
        { name: 'com.github.GTNewHorizons:lwjgl3ify:3.1.1:forgePatches' },
        { name: 'net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10:universal' },
      ],
      arguments: { game: [], jvm: ['-Djava.system.class.loader=RfbSystemClassLoader'] },
      javaVersion: { majorVersion: 25 },
      assets: '1.7.10',
    });
    assert.equal(profile.id, id);
    assert.equal(profile.clientVersion, '1.7.10');
    assert.equal(profile.jar, '1.7.10');
    assert.equal(profile.javaVersion.majorVersion, 25);
    assert.equal(isLwjgl3ifyProfile(profile), true);
    assert.throws(
      () => prepareLwjgl3ifyProfile({ ...profile, mainClass: 'net.minecraft.client.main.Main' }),
      /main class/,
    );
    assert.throws(
      () => prepareLwjgl3ifyProfile({ ...profile, javaVersion: { majorVersion: 8 } }),
      /Java/,
    );
    assert.throws(
      () => prepareLwjgl3ifyProfile({ ...profile, id: '../escape' }),
      /filename|Invalid/,
    );
    await writeJson(path.join(root, 'versions/1.7.10/1.7.10.json'), {
      id: '1.7.10',
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      libraries: [],
      arguments: { game: [], jvm: [] },
    });
    await fs.mkdir(path.join(root, 'versions/1.7.10'), { recursive: true });
    await fs.writeFile(path.join(root, 'versions/1.7.10/1.7.10.jar'), 'client');
    await writeJson(path.join(root, 'versions', id, id + '.json'), profile);
    const resolved = await resolveGameVersion(root, id);
    assert.equal(resolved.minecraftVersion, '1.7.10');
    assert.equal(
      resolved.mainClass,
      'com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('lwjgl3ify jar detection ignores API artifacts and rejects duplicate coremods', async () => {
  const root = await temp();
  try {
    const mods = path.join(root, 'mods');
    assert.equal(await lwjgl3ifyModVersion(root), undefined);
    await fs.mkdir(mods, { recursive: true });
    await fs.writeFile(path.join(mods, 'lwjgl3ify-3.1.1-api.jar'), 'api');
    await fs.writeFile(path.join(mods, 'lwjgl3ify-v3.1.1-custom.jar'), 'mod');
    assert.equal(await lwjgl3ifyModVersion(root), '3.1.1');
    await fs.writeFile(path.join(mods, 'lwjgl3ify-3.0.35.jar'), 'old');
    await assert.rejects(() => lwjgl3ifyModVersion(root), /only one|只能/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('installLwjgl3ify downloads the profile, coremod and UniMixins once', async () => {
  const root = await temp();
  try {
    const instance: Instance = {
      id: 'instance',
      name: 'GTNH',
      minecraft: '1.7.10',
      loader: 'forge',
      loaderVersion: '10.13.4.1614',
      directory: path.join(root, 'game'),
      runtimeDirectory: path.join(root, 'runtime'),
      createdAt: '',
    };
    await fs.mkdir(instance.directory, { recursive: true });
    const id = '1.7.10-Forge10.13.4.1614-1.7.10-lwjgl3ify-3.1.1';
    const profile = {
      id,
      mainClass: 'com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread',
      libraries: [
        { name: 'net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10:universal' },
        { name: 'com.github.GTNewHorizons:lwjgl3ify:3.1.1:forgePatches' },
      ],
      arguments: { game: [], jvm: [] },
      javaVersion: { majorVersion: 25 },
      assets: '1.7.10',
      downloads: { client: { url: 'https://example.test/client', sha1: '0'.repeat(40), size: 1 } },
    };
    const profileText = JSON.stringify(profile);
    const mod = 'mod-jar';
    const unimixins = 'unimixins-jar';
    const release = {
      tag_name: '3.1.1',
      assets: [
        {
          name: 'version.json',
          size: Buffer.byteLength(profileText),
          browser_download_url: 'https://github.com/example/version.json',
          digest: `sha256:${sha256(profileText)}`,
        },
        {
          name: 'lwjgl3ify-3.1.1.jar',
          size: Buffer.byteLength(mod),
          browser_download_url: 'https://github.com/example/lwjgl3ify-3.1.1.jar',
          digest: `sha256:${sha256(mod)}`,
        },
      ],
    };
    const unimixinsVersion = {
      version_type: 'release',
      files: [
        {
          url: 'https://cdn.modrinth.com/data/unimixins/unimixins.jar',
          filename: '+unimixins-gtnhmixins-1.7.10-0.3.1.jar',
          size: Buffer.byteLength(unimixins),
          primary: true,
          hashes: { sha512: createHash('sha512').update(unimixins).digest('hex') },
        },
      ],
    };
    const calls: string[] = [];
    const downloads: { url: string; bypass?: boolean }[] = [];
    const network = {
      json: async (url: string) => {
        calls.push(url);
        if (url.startsWith('https://api.github.com/')) return release;
        if (url.startsWith('https://api.modrinth.com/')) return [unimixinsVersion];
        throw new Error('Unexpected JSON: ' + url);
      },
      download: async (
        url: string,
        destination: string,
        options: { bypassSources?: boolean } = {},
      ) => {
        downloads.push({ url, bypass: options.bypassSources });
        await fs.mkdir(path.dirname(destination), { recursive: true });
        const body = url.endsWith('version.json')
          ? profileText
          : url.includes('unimixins')
            ? unimixins
            : mod;
        await fs.writeFile(destination, body);
      },
    } as unknown as Network;
    const result = await installLwjgl3ify(instance, {
      net: network,
      root: instance.runtimeDirectory!,
      signal: signal(),
      report: () => {},
    });
    const versionId = 'lwjgl3ify-1.7.10-forge-10.13.4.1614-3.1.1';
    assert.deepEqual(result, {
      versionId,
      forgeVersion: '10.13.4.1614',
      javaMajor: 25,
    });
    const stored = JSON.parse(
      await fs.readFile(
        path.join(instance.runtimeDirectory!, 'versions', versionId, versionId + '.json'),
        'utf8',
      ),
    );
    assert.equal(stored.clientVersion, '1.7.10');
    assert.equal(stored.jar, '1.7.10');
    assert.equal(await lwjgl3ifyModVersion(instance.directory), '3.1.1');
    assert.deepEqual(
      await fs.readdir(path.join(instance.directory, 'mods')).then((v) => v.sort()),
      ['+unimixins-gtnhmixins-1.7.10-0.3.1.jar', 'lwjgl3ify-3.1.1.jar'],
    );
    assert.equal(downloads.filter((entry) => entry.bypass).length, 2);
    const beforeDownloads = downloads.length;
    await installLwjgl3ify(instance, {
      net: network,
      root: instance.runtimeDirectory!,
      signal: signal(),
      report: () => {},
    });
    assert.equal(
      downloads.slice(beforeDownloads).some((entry) => entry.url.endsWith('.jar')),
      false,
      'an existing lwjgl3ify jar should not be downloaded twice',
    );
    const before = calls.length;
    await lwjgl3ifyRelease(
      network,
      signal(),
      undefined,
      path.join(instance.runtimeDirectory!, 'cache'),
    );
    assert.equal(calls.length, before, 'fresh release metadata should be reused');
    await assert.rejects(
      () =>
        installLwjgl3ify(
          { ...instance, minecraft: '1.12.2' },
          { net: network, root: instance.runtimeDirectory!, signal: signal(), report: () => {} },
        ),
      /1\.7\.10|Forge/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('falls back to direct GitHub download URLs when the release API is unavailable', async () => {
  const root = await temp();
  try {
    const profileText = JSON.stringify({
      id: '1.7.10-Forge10.13.4.1614-1.7.10-lwjgl3ify-3.1.1',
      mainClass: 'com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread',
      libraries: [{ name: 'com.github.GTNewHorizons:lwjgl3ify:3.1.1:forgePatches' }],
      arguments: { game: [], jvm: [] },
      javaVersion: { majorVersion: 25 },
    });
    let fetched = '';
    const network = {
      json: async () => {
        throw new HttpError(404, 'Not Found');
      },
      text: async (url: string) => {
        fetched = url;
        return profileText;
      },
    } as unknown as Network;
    const release = await lwjgl3ifyRelease(network, signal(), undefined, path.join(root, 'cache'));
    assert.equal(
      fetched,
      'https://github.com/GTNewHorizons/lwjgl3ify/releases/latest/download/version.json',
    );
    assert.equal(release.version, '3.1.1');
    assert.equal(release.profileText, profileText);
    assert.equal(
      release.modUrl,
      'https://github.com/GTNewHorizons/lwjgl3ify/releases/download/3.1.1/lwjgl3ify-3.1.1.jar',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('installRuntime prepares lwjgl3ify without installing a plain Forge profile', async () => {
  const root = await temp();
  try {
    const instance: Instance = {
      id: 'instance',
      name: 'GTNH',
      minecraft: '1.7.10',
      loader: 'forge',
      loaderVersion: '10.13.4.1614',
      directory: path.join(root, 'game'),
      runtimeDirectory: path.join(root, 'runtime'),
      createdAt: '',
    };
    await fs.mkdir(instance.directory, { recursive: true });
    await fs.mkdir(path.join(instance.directory, 'mods'), { recursive: true });
    await fs.writeFile(path.join(instance.directory, 'mods', 'lwjgl3ify-3.1.1.jar'), 'mod');
    const client = new AdmZip();
    client.addFile('fixture.txt', Buffer.from('client'));
    const clientBytes = client.toBuffer();
    const profile = {
      id: 'lwjgl3ify-test',
      mainClass: 'com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread',
      libraries: [],
      arguments: { game: [], jvm: [] },
      javaVersion: { majorVersion: 17 },
      downloads: {
        client: {
          url: 'https://example.test/client.jar',
          sha1: createHash('sha1').update(clientBytes).digest('hex'),
          size: clientBytes.length,
        },
      },
    };
    const profileText = JSON.stringify(profile);
    const network = {
      options: { concurrency: 2 },
      json: async (url: string) => {
        if (url.startsWith('https://api.github.com/')) {
          return {
            tag_name: '3.1.1',
            assets: [
              {
                name: 'version.json',
                size: Buffer.byteLength(profileText),
                browser_download_url: 'https://github.com/example/version.json',
                digest: `sha256:${sha256(profileText)}`,
              },
              {
                name: 'lwjgl3ify-3.1.1.jar',
                size: 3,
                browser_download_url: 'https://github.com/example/lwjgl3ify-3.1.1.jar',
              },
            ],
          };
        }
        if (url.startsWith('https://api.modrinth.com/')) return [];
        throw new Error('Unexpected JSON: ' + url);
      },
      download: async (url: string, destination: string, _options: unknown) => {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        if (url.endsWith('version.json')) await fs.writeFile(destination, profileText);
        else if (url.includes('lwjgl3ify-3.1.1.jar')) await fs.writeFile(destination, 'mod');
        else if (url === 'https://example.test/client.jar')
          await fs.writeFile(destination, clientBytes);
        else throw new Error('Unexpected download: ' + url);
      },
    } as unknown as Network;
    const result = await installRuntime(
      instance,
      {
        net: network,
        java: {} as never,
        output: { append() {} } as never,
        manifest: async () => {
          throw new Error('Unexpected manifest');
        },
        loaders: async () => [],
      },
      signal(),
      () => {},
    );
    assert.deepEqual(result, {
      versionId: 'lwjgl3ify-1.7.10-forge-10.13.4.1614-3.1.1',
      loaderVersion: '10.13.4.1614',
      preserveVersion: true,
    });
    const stored = JSON.parse(
      await fs.readFile(
        path.join(
          instance.runtimeDirectory!,
          'versions/lwjgl3ify-1.7.10-forge-10.13.4.1614-3.1.1/lwjgl3ify-1.7.10-forge-10.13.4.1614-3.1.1.json',
        ),
        'utf8',
      ),
    );
    assert.equal(stored.clientVersion, '1.7.10');
    assert.equal(stored.jar, '1.7.10');
    assert.equal(
      await fs
        .readFile(path.join(instance.runtimeDirectory!, 'versions/1.7.10/1.7.10.jar'))
        .then((value) => value.length),
      clientBytes.length,
    );
    assert.equal(await lwjgl3ifyModVersion(instance.directory), '3.1.1');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Prism instances using lwjgl3ify import without unsupported-component warnings', async () => {
  const root = await temp();
  const store = new Store(path.join(root, 'state'), () => {});
  try {
    const folder = path.join(root, 'instances', 'GTNH');
    await fs.mkdir(path.join(folder, '.minecraft', 'mods'), { recursive: true });
    await fs.writeFile(path.join(folder, '.minecraft', 'mods', 'lwjgl3ify-3.1.1.jar'), 'mod');
    await writeJson(path.join(folder, 'mmc-pack.json'), {
      formatVersion: 1,
      components: [
        { uid: 'net.minecraft', version: '1.7.10', important: true },
        { uid: 'org.lwjgl3', version: '3.4.3' },
        { uid: 'me.eigenraven.lwjgl3ify.forgepatches' },
        { uid: 'me.eigenraven.lwjgl3ify.launchargs' },
        { uid: 'net.minecraftforge', version: '10.13.4.1614', important: true },
      ],
    });
    await fs.writeFile(
      path.join(folder, 'instance.cfg'),
      '[General]\nInstanceType=OneSix\nname=GTNH\n',
    );
    const scan = await scanInstances(folder);
    assert.deepEqual(scan.warnings, []);
    const candidate = scan.candidates[0];
    assert.equal(candidate.loader, 'forge');
    assert.equal(candidate.loaderVersion, '10.13.4.1614');
    const instance = await new InstanceImporter(store).import(
      candidate,
      'link',
      signal(),
      'GTNH',
      path.join(root, 'target'),
    );
    assert.equal(instance.preserveVersion, false);
    assert.equal(instance.installed, false);
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('standard Forge 1.7.10 instances with a lwjgl3ify jar are detected once', async () => {
  const root = await temp();
  try {
    const runtime = path.join(root, 'minecraft');
    await fs.mkdir(path.join(runtime, 'versions', '1.7.10'), { recursive: true });
    await fs.mkdir(path.join(runtime, 'mods'), { recursive: true });
    await fs.writeFile(path.join(runtime, 'versions', '1.7.10', '1.7.10.jar'), 'client');
    await fs.writeFile(path.join(runtime, 'mods', 'lwjgl3ify-3.1.1.jar'), 'mod');
    await writeJson(path.join(runtime, 'versions', '1.7.10', '1.7.10.json'), {
      id: '1.7.10',
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      libraries: [
        {
          name: 'net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10:universal',
          downloads: {
            artifact: { url: 'https://example.test/forge.jar', size: 1, sha1: '0'.repeat(40) },
          },
        },
      ],
      arguments: { game: [], jvm: [] },
      assets: '1.7.10',
      downloads: { client: { url: 'https://example.test/client', sha1: '0'.repeat(40), size: 1 } },
    });
    const candidate = (await scanInstances(runtime)).candidates[0];
    assert.equal(candidate.loader, 'forge');
    const instance: Instance = {
      id: 'detect',
      name: 'Detect',
      minecraft: '1.7.10',
      loader: 'forge',
      directory: runtime,
      runtimeDirectory: runtime,
      createdAt: '',
    };
    assert.equal(await detectLwjgl3ify(instance), '3.1.1');
    await writeJson(path.join(runtime, 'versions', '1.7.10', '1.7.10.json'), {
      id: '1.7.10',
      type: 'release',
      mainClass: 'com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread',
      libraries: [
        {
          name: 'com.github.GTNewHorizons:lwjgl3ify:3.1.1:forgePatches',
          downloads: {
            artifact: { url: 'https://example.test/patches.jar', size: 1, sha1: '0'.repeat(40) },
          },
        },
        {
          name: 'net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10:universal',
          downloads: {
            artifact: { url: 'https://example.test/forge.jar', size: 1, sha1: '0'.repeat(40) },
          },
        },
      ],
      arguments: { game: [], jvm: [] },
      assets: '1.7.10',
      downloads: { client: { url: 'https://example.test/client', sha1: '0'.repeat(40), size: 1 } },
    });
    const upgraded = (await scanInstances(runtime)).candidates[0];
    assert.equal(upgraded.loader, 'forge');
    assert.equal(await detectLwjgl3ify(instance), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
