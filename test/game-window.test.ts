import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChildProcess } from 'node:child_process';
import { gameJavaExecutable } from '../src/game-java';
import { Minecraft } from '../src/minecraft';
import { Store } from '../src/store';
import { Jobs } from '../src/jobs';
import type { Instance } from '../src/models';

const vscode = require('vscode');

test('Windows games use a sibling javaw.exe when present and retain custom executables', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-game-java-'));
  const java = path.join(root, 'java.exe'),
    javaw = path.join(root, 'javaw.exe');
  try {
    assert.equal(await gameJavaExecutable(java, 'win32'), java);
    await fs.mkdir(javaw);
    assert.equal(await gameJavaExecutable(java, 'win32'), java);
    await fs.rmdir(javaw);
    await fs.writeFile(javaw, 'test executable');
    assert.equal(await gameJavaExecutable(java, 'win32'), javaw);
    assert.equal(await gameJavaExecutable(java, 'linux'), java);
    assert.equal(await gameJavaExecutable(java, 'darwin'), java);
    assert.equal(await gameJavaExecutable('java', 'win32'), 'java');
    assert.equal(await gameJavaExecutable(javaw, 'win32'), javaw);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

for (const [version, loader, major, format] of [
  ['1.6.4', 'vanilla', 8, 'legacy'],
  ['1.8.9', 'vanilla', 8, 'legacy'],
  ['1.12.2', 'vanilla', 8, 'legacy'],
  ['1.8.9', 'forge', 8, 'legacy'],
  ['1.12.2', 'forge', 8, 'legacy'],
  ['1.14.4', 'fabric', 8, 'modern'],
  ['1.16.5', 'fabric', 8, 'modern'],
  ['1.16.5', 'fabric', 8, 'hmcl'],
  ['1.18.2', 'fabric', 17, 'modern'],
  ['1.18.2', 'quilt', 17, 'modern'],
  ['1.19.2', 'quilt', 17, 'modern'],
  ['1.20.1', 'forge', 17, 'modern'],
  ['1.20.4', 'neoforge', 17, 'modern'],
  ['1.21.11', 'fabric', 21, 'modern'],
  ['26.3', 'fabric', 25, 'modern'],
] as const)
  test(`${version} ${loader} (${format}) preserves loader arguments without hiding game windows`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-window-launch-'));
    const store = new Store(path.join(root, 'state'), () => {});
    const logs: string[] = [];
    const token = 'private-minecraft-token';
    vscode.window.withProgress ||= () => {};
    const progress = mock.method(
      vscode.window,
      'withProgress',
      async (_options: unknown, work: Function) =>
        work({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    );
    const settings = mock.method(vscode.workspace, 'getConfiguration', () => ({
      get: (key: string, fallback: unknown) => (key === 'language' ? 'zh-cn' : fallback),
    }));
    const jobs = new Jobs(() => {}, {
      info: (message: string) => logs.push(message),
      error: (message: string) => logs.push(message),
      appendLine: (message: string) => logs.push(message),
    } as never);
    const instance: Instance = {
      id: 'game',
      name: 'Test client',
      minecraft: version,
      loader,
      loaderVersion: loader === 'vanilla' ? undefined : 'test-loader',
      installed: true,
      directory: path.join(root, 'game'),
      runtimeDirectory: path.join(root, 'runtime'),
      versionId: loader === 'vanilla' ? version : `${version}-${loader}-${format}`,
      linked: format === 'hmcl',
      preserveVersion: format === 'hmcl',
      createdAt: '',
    };
    store.state.instances = [instance];
    store.state.accounts = [{ id: 'account', kind: 'microsoft', name: 'TestPlayer' }];
    store.state.selectedAccount = 'account';
    const java = path.join(root, 'java.exe');
    const hasJavaw = loader !== 'vanilla' && version !== '1.14.4';
    if (hasJavaw) await fs.writeFile(path.join(root, 'javaw.exe'), 'test executable');
    await fs.mkdir(path.join(instance.runtimeDirectory!, 'versions', version), { recursive: true });
    await fs.mkdir(instance.directory, { recursive: true });
    const mainClass =
      loader === 'vanilla'
        ? 'net.minecraft.client.main.Main'
        : loader === 'forge' && format === 'legacy'
          ? 'net.minecraft.launchwrapper.Launch'
          : loader === 'forge' || loader === 'neoforge'
            ? 'cpw.mods.bootstraplauncher.BootstrapLauncher'
            : loader === 'quilt'
              ? 'org.quiltmc.loader.impl.launch.knot.KnotClient'
              : 'net.fabricmc.loader.impl.launch.knot.KnotClient';
    const gameArguments = [
      '--username',
      '${auth_player_name}',
      '--accessToken',
      '${auth_access_token}',
      '--gameDir',
      '${game_directory}',
    ];
    const jvmArguments = ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
    const loaderArguments =
      loader === 'forge' && format === 'legacy'
        ? ['--tweakClass', 'net.minecraftforge.fml.common.launcher.FMLTweaker']
        : loader === 'forge' || loader === 'neoforge'
          ? ['--launchTarget', `${loader}client`]
          : [];
    const profile = {
      id: version,
      mainClass: 'net.minecraft.client.main.Main',
      assets: 'test',
      javaVersion: { majorVersion: major },
      libraries: [],
      downloads: {},
      ...(format === 'legacy'
        ? { minecraftArguments: gameArguments.join(' ') }
        : { arguments: { game: gameArguments, jvm: jvmArguments } }),
    };
    const loaderProfile = {
      id: instance.versionId,
      inheritsFrom: version,
      mainClass,
      ...(format === 'legacy'
        ? { minecraftArguments: [...gameArguments, ...loaderArguments].join(' ') }
        : {
            arguments: {
              game: loaderArguments,
              jvm: loader === 'fabric' ? ['-DFabricMcEmu= net.minecraft.client.main.Main '] : [],
            },
          }),
    };
    await fs.writeFile(
      path.join(instance.runtimeDirectory!, 'versions', version, `${version}.json`),
      JSON.stringify(profile),
    );
    await fs.writeFile(
      path.join(instance.runtimeDirectory!, 'versions', version, `${version}.jar`),
      'fixture client',
    );
    const profileFile = path.join(
      instance.runtimeDirectory!,
      'versions',
      instance.versionId!,
      `${instance.versionId}.json`,
    );
    if (loader !== 'vanilla') {
      await fs.mkdir(path.dirname(profileFile), { recursive: true });
      await fs.writeFile(
        profileFile,
        JSON.stringify(
          format === 'hmcl'
            ? {
                id: instance.versionId,
                root: true,
                clientVersion: version,
                patches: [
                  { ...profile, id: 'game', version, priority: 0 },
                  { ...loaderProfile, id: 'fabric', inheritsFrom: undefined, priority: 100 },
                ],
              }
            : loaderProfile,
        ),
      );
    }
    if (format === 'hmcl')
      await fs.writeFile(profileFile.replace(/\.json$/, '.jar'), 'fixture client');
    const originalProfile = await fs.readFile(profileFile, 'utf8');
    let child: ChildProcess | undefined;
    const minecraft = new Minecraft(
      store,
      {} as never,
      { ensure: async () => ({ path: java, major, version: `${major}.0.1` }) } as never,
      { token: async () => token } as never,
      jobs,
      () => {},
      undefined,
      (command, args, options) => {
        assert.equal(
          options?.windowsHide,
          false,
          'SW_HIDE must never be requested for the game process',
        );
        assert.equal(
          command,
          process.platform === 'win32' && hasJavaw ? path.join(root, 'javaw.exe') : java,
        );
        assert.ok(args?.includes(token), 'The real launch generator receives the token');
        assert.ok(args?.includes(mainClass), 'The loader-specific entry point is retained');
        for (const argument of loaderArguments) assert.ok(args?.includes(argument), argument);
        if (loader === 'fabric')
          assert.ok(args?.includes('-DFabricMcEmu= net.minecraft.client.main.Main '));
        assert.equal(options?.cwd, instance.directory);
        assert.equal(options?.shell, undefined, 'Launch Java directly without an extra shell');
        assert.ok(options?.signal && !options.signal.aborted, 'Cancellation remains connected');
        child = new ChildProcess();
        Object.assign(child, { pid: 1234, spawnargs: [command, ...(args || [])] });
        return child;
      },
    );
    try {
      await minecraft.start(instance);
      assert.ok(minecraft.running.has(instance.id));
      assert.ok(logs.some((line) => line.includes('Preparing Java')));
      assert.ok(logs.some((line) => line.includes('Command:')));
      assert.ok(logs.some((line) => line.includes('Window hiding: disabled')));
      assert.ok(!logs.join('\n').includes(token));
      assert.ok(!logs.some((line) => /准备 Java|游戏进程已启动|启动 Test client/.test(line)));
      assert.equal(
        await fs.readFile(profileFile, 'utf8'),
        originalProfile,
        'Launching imported profiles does not rewrite them',
      );
      child!.emit('exit', 0);
      await store.save();
    } finally {
      child?.removeAllListeners();
      jobs.dispose();
      store.dispose();
      progress.mock.restore();
      settings.mock.restore();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

test('a content mutation blocks launching the same instance before Java or account preparation', async () => {
  const store = new Store('/unused', () => {});
  const instance = { id: 'game', directory: '/unused/game' } as Instance;
  const minecraft = new Minecraft(
    store,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    () => {},
    undefined,
    undefined,
    () => true,
  );
  try {
    await assert.rejects(minecraft.start(instance), /Content operation already in progress/);
  } finally {
    store.dispose();
  }
});
