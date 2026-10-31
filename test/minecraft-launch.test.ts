import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { MinecraftFolder, LaunchOption, ResolvedVersion, Version } from '@xmcl/core';
import { Minecraft } from '../src/minecraft';
import { Store } from '../src/store';
import { Instance } from '../src/models';
import { Network } from '../src/network';
import { prepareNatives, launchPrecheck, prepareLegacyAssets } from '../src/launch-prechecks';
import { hashFile, writeJson } from '../src/files';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-launch-'));
  const store = new Store(root, () => {});
  const instance: Instance = {
    id: 'game',
    name: 'Game',
    minecraft: '1.12.2',
    loader: 'vanilla',
    directory: path.join(root, 'game'),
    runtimeDirectory: path.join(root, 'runtime'),
    createdAt: '',
    installed: true,
  };
  const base = {
    id: '1.12.2',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    minecraftArguments: '--username ${auth_player_name}',
    assets: '1.12',
    libraries: [],
    downloads: {},
    javaVersion: { majorVersion: 8, component: 'jre-legacy' },
  };
  const logs: string[] = [],
    urls: string[] = [];
  const network = {
    options: { concurrency: 2 },
    json: async () => ({ versions: [{ id: '1.12.2', url: 'https://example.test/1.12.2.json' }] }),
    download: async (url: string, destination: string) => {
      urls.push(url);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (url.endsWith('/1.12.2.json')) await writeJson(destination, base);
      else throw new Error('Unexpected download: ' + url);
    },
  };
  const java = {
    ensure: async () => ({
      path: process.execPath,
      major: 8,
      version: '1.8.0',
      architecture: 'test',
    }),
  };
  const accounts = { token: async () => '0' };
  const jobs = {
    run: async (
      _name: string,
      work: (signal: AbortSignal, report: (value: string) => void) => Promise<unknown>,
    ) => work(new AbortController().signal, (v) => logs.push(v)),
    output: { info: (v: string) => logs.push(v), error() {}, append() {}, appendLine() {} },
  };
  const minecraft = new Minecraft(
    store,
    network as unknown as Network,
    java as never,
    accounts as never,
    jobs as never,
    () => {},
  );
  store.state.instances.push(instance);
  store.state.accounts.push({ id: 'account', name: 'Player', kind: 'offline' });
  store.state.selectedAccount = 'account';
  await fs.mkdir(instance.directory, { recursive: true });
  await writeJson(new MinecraftFolder(instance.runtimeDirectory!).getVersionJson('1.12.2'), base);
  return {
    store,
    instance,
    minecraft,
    java,
    accounts,
    network,
    logs,
    urls,
    close: async () => {
      store.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Preparation did not reach the expected stage');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('Forge 1.12.2 reads its installer profile and preserves the FML tweak arguments', async () => {
  const f = await fixture();
  try {
    f.instance.installed = false;
    f.instance.loader = 'forge';
    f.instance.loaderVersion = '14.23.5.2855';
    const zip = new AdmZip(),
      universal = new AdmZip();
    universal.addFile('test.class', Buffer.from('fixture'));
    zip.addFile('forge-1.12.2-14.23.5.2855-universal.jar', universal.toBuffer());
    zip.addFile(
      'install_profile.json',
      Buffer.from(
        JSON.stringify({
          versionInfo: {
            id: '1.12.2-forge-14.23.5.2855',
            inheritsFrom: '1.12.2',
            mainClass: 'net.minecraft.launchwrapper.Launch',
            minecraftArguments: '--tweakClass net.minecraftforge.fml.common.launcher.FMLTweaker',
            libraries: [{ name: 'net.minecraftforge:forge:1.12.2-14.23.5.2855' }],
          },
        }),
      ),
    );
    const download = f.network.download;
    f.network.download = async (url, file) => {
      if (!url.endsWith('-installer.jar')) return download(url, file);
      f.urls.push(url);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, zip.toBuffer());
    };
    await f.minecraft.install(f.instance);
    assert.equal(f.instance.installed, true);
    assert.ok(f.urls.some((url) => url.endsWith('-installer.jar')));
    assert.ok(!f.urls.some((url) => url.endsWith('-universal.jar')));
    const profile = JSON.parse(
      await fs.readFile(
        new MinecraftFolder(f.instance.runtimeDirectory!).getVersionJson(f.instance.versionId!),
        'utf8',
      ),
    );
    assert.ok(profile.minecraftArguments.includes('FMLTweaker'));
    assert.equal(f.minecraft.status(f.instance), 'stopped');
  } finally {
    await f.close();
  }
});

test('stopping Java or account preparation releases the instance and allows another attempt', async () => {
  for (const stage of ['java', 'account']) {
    const f = await fixture();
    try {
      let ready = false;
      if (stage === 'java')
        f.java.ensure = ((_major: number, signal: AbortSignal) => {
          ready = true;
          return new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        }) as never;
      else
        f.accounts.token = () => {
          ready = true;
          return new Promise(() => {});
        };
      const work = f.minecraft.start(f.instance);
      const rejection = assert.rejects(work, { name: 'AbortError' });
      await until(() => ready);
      assert.equal(f.minecraft.status(f.instance), 'starting');
      assert.deepEqual(f.minecraft.activeIds, [f.instance.id]);
      await f.minecraft.stop(f.instance);
      await rejection;
      assert.equal(f.minecraft.status(f.instance), 'stopped');
      f.minecraft.assertIdle(f.instance);
      f.java.ensure = async () => {
        throw new Error('Fixture failure');
      };
      await assert.rejects(f.minecraft.start(f.instance), /Fixture failure/);
      f.minecraft.assertIdle(f.instance);
    } finally {
      await f.close();
    }
  }
});

test('stopping version metadata retrieval cancels installation and releases its lock', async () => {
  const f = await fixture();
  try {
    let ready = false;
    f.network.json = ((_url: string, { signal }: { signal: AbortSignal }) => {
      ready = true;
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    }) as never;
    const work = f.minecraft.install(f.instance);
    const rejection = assert.rejects(work, { name: 'AbortError' });
    await until(() => ready);
    assert.equal(f.minecraft.status(f.instance), 'installing');
    await f.minecraft.stop(f.instance);
    await rejection;
    f.minecraft.assertIdle(f.instance);
  } finally {
    await f.close();
  }
});

test('Windows natives are isolated per instance, exclude metadata and release their archive', async () => {
  const f = await fixture();
  try {
    const resource = new MinecraftFolder(f.instance.runtimeDirectory!);
    const file = resource.getLibraryByPath('native.jar'),
      zip = new AdmZip();
    zip.addFile('META-INF/MANIFEST.MF', Buffer.from('metadata'));
    zip.addFile('lwjgl64.dll', Buffer.from('native'));
    zip.addFile('lwjgl64.dll.sha1', Buffer.from('checksum'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, zip.toBuffer());
    const version = {
      libraries: [{ name: 'test:native:1', isNative: true, download: { path: 'native.jar' } }],
    } as ResolvedVersion;
    const options = {
      gamePath: f.instance.directory,
      nativeRoot: path.join(f.instance.directory, '.workbench', 'natives', '1.12.2'),
      platform: { name: 'windows', arch: 'x64', version: '10.0' },
    } as LaunchOption;
    await prepareNatives(resource, version, options, new AbortController().signal);
    assert.deepEqual(await fs.readdir(options.nativeRoot!), ['lwjgl64.dll']);
    await fs.rename(file, file + '.old');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(prepareNatives(resource, version, options, controller.signal), {
      name: 'AbortError',
    });
  } finally {
    await f.close();
  }
});

test('launch file checks report corrupt libraries and honour cancellation before extraction', async () => {
  const f = await fixture();
  try {
    const resource = new MinecraftFolder(f.instance.runtimeDirectory!);
    const version = await Version.parse(resource, '1.12.2');
    version.libraries = [
      {
        name: 'test:broken:1',
        isNative: false,
        download: { path: 'broken.jar', sha1: 'f'.repeat(40) },
      },
    ] as ResolvedVersion['libraries'];
    await fs.mkdir(path.dirname(resource.getLibraryByPath('broken.jar')), { recursive: true });
    await fs.writeFile(resource.getLibraryByPath('broken.jar'), 'corrupt');
    const options = {
      gamePath: f.instance.directory,
      nativeRoot: path.join(f.instance.directory, '.workbench', 'natives', '1.12.2'),
    } as LaunchOption;
    const phases: string[] = [];
    await assert.rejects(
      launchPrecheck(new AbortController().signal, (v) => phases.push(v))(
        resource,
        version,
        options,
      ),
      /Missing or corrupt game file/,
    );
    assert.deepEqual(phases, ['Checking game files']);
    const controller = new AbortController();
    await assert.rejects(
      launchPrecheck(controller.signal, () => controller.abort())(resource, version, options),
      { name: 'AbortError' },
    );
    await assert.rejects(fs.access(options.nativeRoot!));
  } finally {
    await f.close();
  }
});

test('legacy assets replace stale virtual files and can be cancelled before linking', async () => {
  const f = await fixture();
  try {
    const resource = new MinecraftFolder(f.instance.runtimeDirectory!);
    const source = path.join(resource.root, 'assets', 'objects', 'fixture');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, 'correct asset');
    const hash = await hashFile(source);
    await fs.mkdir(path.dirname(resource.getAsset(hash)), { recursive: true });
    await fs.rename(source, resource.getAsset(hash));
    await writeJson(resource.getAssetsIndex('legacy'), {
      objects: { 'sound/click.ogg': { hash } },
    });
    const target = resource.getPath('assets', 'virtual', 'legacy', 'sound', 'click.ogg');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'stale asset');
    await prepareLegacyAssets(
      resource,
      { assets: 'legacy' } as ResolvedVersion,
      new AbortController().signal,
    );
    assert.equal(await fs.readFile(target, 'utf8'), 'correct asset');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      prepareLegacyAssets(resource, { assets: 'legacy' } as ResolvedVersion, controller.signal),
      { name: 'AbortError' },
    );
  } finally {
    await f.close();
  }
});
