import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { scanInstances, InstanceImporter, loaderInfo } from '../src/instance-import';
import { writeJson } from '../src/files';
import { profileParent, resolveGameVersion } from '../src/version-profile';
import { repairVersionChain } from '../src/version-repair';
import { ImportSession } from '../src/import-session';
import { Store } from '../src/store';
import { isRuntimeReady } from '../src/runtime-status';
import { Minecraft } from '../src/minecraft';

const signal = () => new AbortController().signal;
const base = (id: string) => ({
  id,
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  libraries: [],
  arguments: { game: [], jvm: [] },
});

test('PCL external patch parents resolve and repair while complete imported runtimes stay offline', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-pcl-runtime-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const runtime = path.join(root, 'game');
  try {
    const bytes = Buffer.from('client');
    const digest = createHash('sha1').update(bytes).digest('hex');
    await writeJson(path.join(runtime, 'versions/1.21.1/1.21.1.json'), {
      ...base('1.21.1'),
      downloads: {
        client: { url: 'https://example.test/client', sha1: digest, size: bytes.length },
      },
    });
    await fs.writeFile(path.join(runtime, 'versions/1.21.1/1.21.1.jar'), bytes);
    await writeJson(path.join(runtime, 'versions/PCL Neo/PCL Neo.json'), {
      id: 'PCL Neo',
      root: true,
      patches: [
        {
          id: 'neoforge',
          inheritsFrom: '1.21.1',
          version: '21.1.250',
          mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
          arguments: { game: ['--fml.neoForgeVersion', '21.1.250'], jvm: ['-Dpcl=true'] },
        },
      ],
    });
    const scan = await scanInstances(runtime);
    assert.deepEqual(scan.warnings, []);
    const candidate = scan.candidates.find((c) => c.name === 'PCL Neo')!;
    assert.equal(candidate.minecraft, '1.21.1');
    assert.equal(candidate.loader, 'neoforge');
    const resolved = await resolveGameVersion(runtime, 'PCL Neo');
    assert.equal(resolved.mainClass, 'cpw.mods.bootstraplauncher.BootstrapLauncher');
    assert.deepEqual(resolved.arguments.game, ['--fml.neoForgeVersion', '21.1.250']);
    assert.deepEqual(loaderInfo(resolved.libraries, '1.21.1', [resolved]), {
      loader: 'neoforge',
      loaderVersion: '21.1.250',
    });
    const repaired = await repairVersionChain(runtime, 'PCL Neo', signal(), async () => {
      throw new Error('Unexpected recovery');
    });
    assert.equal(repaired.length, 2);
    for (const mode of ['link', 'copy'] as const) {
      const instance = await new InstanceImporter(store).import(
        candidate,
        mode,
        signal(),
        mode,
        path.join(root, 'target'),
      );
      assert.equal(await isRuntimeReady(instance, signal()), true);
      instance.installed = false;
      const minecraft = new Minecraft(
        store,
        {
          json: async () => {
            throw new Error('Unexpected network');
          },
        } as never,
        {} as never,
        {} as never,
        {
          output: {},
          run: async (_label: unknown, work: Function) => work(signal(), () => {}),
        } as never,
        () => {},
      );
      await minecraft.install(instance);
      assert.equal(instance.installed, true);
    }
    assert.throws(
      () => profileParent({ patches: [{ inheritsFrom: '../escape' }] }),
      /Invalid|filename|path/i,
    );
    assert.throws(
      () => profileParent({ patches: [{ inheritsFrom: '1.20.1' }, { inheritsFrom: '1.21.1' }] }),
      /Conflicting/,
    );
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SJMCL config imports isolated and shared saves, basic overrides and no launcher hooks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-sjmcl-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const runtime = path.join(root, 'game');
  const folder = path.join(runtime, 'versions', 'SJMCL Neo');
  const cfg = path.join(folder, 'sjmclcfg.json');
  const java = path.join(root, process.platform === 'win32' ? 'java.exe' : 'java');
  const session = new ImportSession(store);
  try {
    await fs.writeFile(java, 'java fixture');
    await writeJson(path.join(folder, 'SJMCL Neo.json'), {
      ...base('SJMCL Neo'),
      clientVersion: '1.21.1',
    });
    for (const dir of [runtime, folder]) {
      await fs.mkdir(path.join(dir, 'saves/world'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'saves/world/level.dat'),
        dir === folder ? 'isolated' : 'shared',
      );
    }
    const data = {
      name: 'SJMCL display name',
      version: '1.21.1',
      versionPath: path.join(root, 'unrelated'),
      modLoader: { loaderType: 'NeoForge', status: 'Installed', version: '21.1.250' },
      useSpecGameConfig: true,
      specGameConfig: {
        versionIsolation: true,
        gameJava: { auto: false, execPath: java },
        performance: { autoMemAllocation: false, maxMemAllocation: 4096 },
        gameWindow: { resolution: { width: 1280, height: 720, fullscreen: false } },
        advanced: {
          customCommands: { precallCommand: 'must-not-run', wrapperLauncher: 'must-not-run' },
        },
      },
    };
    await writeJson(cfg, data);
    const scanned = await session.inspect(cfg, signal());
    assert.equal(scanned.archive, false);
    const candidate = scanned.candidates[0];
    assert.equal(candidate.format, 'sjmcl');
    assert.equal(candidate.name, data.name);
    assert.equal(candidate.loader, 'neoforge');
    assert.equal(candidate.loaderVersion, '21.1.250');
    assert.equal(candidate.java, java);
    assert.equal(candidate.maxMemory, 4096);
    assert.deepEqual(candidate.resolution, data.specGameConfig.gameWindow.resolution);
    const instance = await session.commit(
      candidate.key,
      'copy',
      signal(),
      undefined,
      path.join(root, 'target'),
    );
    assert.equal(
      await fs.readFile(path.join(instance.directory, 'saves/world/level.dat'), 'utf8'),
      'isolated',
    );
    await assert.rejects(fs.access(path.join(instance.directory, 'sjmclcfg.json')));
    assert.ok(!JSON.stringify(instance).includes('must-not-run'));
    data.specGameConfig.versionIsolation = false;
    await writeJson(cfg, data);
    assert.equal((await scanInstances(folder)).candidates[0].directory, await fs.realpath(runtime));
    data.useSpecGameConfig = false;
    await writeJson(cfg, data);
    const inactive = (await scanInstances(folder)).candidates[0];
    assert.equal(inactive.java, undefined);
    assert.equal(inactive.maxMemory, undefined);
    assert.equal(inactive.resolution, undefined);
    await fs.rm(path.join(runtime, 'saves'), { recursive: true });
    await fs.rm(path.join(folder, 'saves'), { recursive: true });
    assert.equal(
      (await scanInstances(folder)).candidates[0].directory,
      await fs.realpath(folder),
      'Empty SJMCL instances use its default version isolation',
    );
  } finally {
    await session.clear();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
