import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { inspectServer, importServer } from '../src/server-import';
import { Store } from '../src/store';
import { Servers } from '../src/servers';

async function jar(file: string, main: string, version?: string) {
  const zip = new AdmZip();
  zip.addFile('META-INF/MANIFEST.MF', Buffer.from(`Manifest-Version: 1.0\nMain-Class: ${main}\n`));
  if (version)
    zip.addFile('version.json', Buffer.from(JSON.stringify({ id: version, java_version: 21 })));
  await fs.mkdir(path.dirname(file), { recursive: true });
  zip.writeZip(file);
}

test('server imports keep installed files and launch configuration without inheriting EULA approval', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-import-'));
  const directory = path.join(root, 'My Paper server');
  const store = new Store(path.join(root, 'state'), () => {});
  await store.load();
  try {
    await jar(path.join(directory, 'paper-1.21.1.jar'), 'io.papermc.paperclip.Main', '1.21.1');
    await fs.writeFile(path.join(directory, 'eula.txt'), 'eula=true\n');
    await fs.writeFile(path.join(directory, 'server.properties'), 'motd=existing\n');
    const preview = await inspectServer(directory);
    assert.equal(preview.engine, 'paper');
    assert.equal(preview.minecraft, '1.21.1');
    const server = await importServer(
      store,
      { directory, eulaAccepted: true, eulaAcceptedAt: new Date().toISOString() },
      new AbortController().signal,
    );
    assert.equal(server.directory, await fs.realpath(directory));
    assert.equal(server.installed, true);
    assert.equal(server.requiredJava, 21);
    assert.equal(server.imported, true);
    assert.equal(server.eulaAccepted, false);
    assert.equal(server.eulaAcceptedAt, undefined);
    assert.deepEqual(server.launchArgs, ['-jar', 'paper-1.21.1.jar', 'nogui']);
    assert.equal(
      await fs.readFile(path.join(directory, 'server.properties'), 'utf8'),
      'motd=existing\n',
    );
    assert.equal((await fs.readdir(directory)).length, 3);
    await assert.rejects(
      importServer(store, { directory: directory + path.sep + '.' }, new AbortController().signal),
      /already registered/,
    );
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Forge and NeoForge server imports reuse the platform argument file without a root JAR', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-forge-server-'));
  const store = new Store(path.join(root, 'state'), () => {});
  try {
    for (const [engine, group, version, game, build] of [
      ['forge', 'net/minecraftforge/forge', '1.20.1-47.3.0', '1.20.1', '47.3.0'],
      ['forge', 'net/minecraftforge/forge', '26.3-64.0.5', '26.3', '64.0.5'],
      ['forge', 'net/minecraftforge/forge', '26.4-snapshot-3-65.0.5', '26.4-snapshot-3', '65.0.5'],
      ['neoforge', 'net/neoforged/neoforge', '21.0.160', '1.21', '21.0.160'],
      ['neoforge', 'net/neoforged/neoforge', '21.1.100', '1.21.1', '21.1.100'],
    ]) {
      const directory = path.join(root, engine + '-' + version);
      const file = path.join(
        'libraries',
        group,
        version,
        process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt',
      );
      await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await fs.writeFile(
        path.join(directory, file),
        '-cp libraries/server.jar net.minecraft.server.Main',
      );
      const preview = await inspectServer(directory);
      assert.equal(preview.engine, engine);
      assert.equal(preview.minecraft, game);
      assert.equal(preview.build, build);
      const server = await importServer(store, { directory }, new AbortController().signal);
      assert.deepEqual(server.launchArgs, ['@' + file, 'nogui']);
      await assert.rejects(
        importServer(store, { directory, engine: 'custom' }, new AbortController().signal),
        /already registered/,
      );
    }
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('server detection skips plugin/client JARs and reuses the detected executable JAR', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-candidates-'));
  const directory = path.join(root, 'Server');
  const store = new Store(path.join(root, 'state'), () => {});
  try {
    await jar(path.join(directory, 'server.jar'), 'net.minecraft.client.main.Main');
    const plugin = new AdmZip();
    plugin.addFile('plugin.yml', Buffer.from('name: plugin'));
    plugin.writeZip(path.join(directory, 'aaa.jar'));
    await jar(path.join(directory, 'paper-1.21.1.jar'), 'io.papermc.paperclip.Main', '1.21.1');
    const preview = await inspectServer(directory);
    assert.equal(preview.launchJar, 'paper-1.21.1.jar');
    assert.equal(preview.engine, 'paper');
    const server = await importServer(store, { directory }, new AbortController().signal);
    assert.deepEqual(server.launchArgs, ['-jar', 'paper-1.21.1.jar', 'nogui']);
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('server detection distinguishes legacy Forge and Folia executables', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-engines-'));
  try {
    const forge = path.join(root, 'forge');
    await jar(
      path.join(forge, 'forge-1.12.2-14.23.5.2860-universal.jar'),
      'net.minecraftforge.fml.relauncher.ServerLaunchWrapper',
    );
    const legacy = await inspectServer(forge);
    assert.equal(legacy.engine, 'forge');
    assert.equal(legacy.minecraft, '1.12.2');
    assert.equal(legacy.build, '14.23.5.2860');
    const folia = path.join(root, 'folia');
    await jar(path.join(folia, 'folia-1.21.1.jar'), 'io.papermc.paperclip.Main', '1.21.1');
    assert.equal((await inspectServer(folia)).engine, 'folia');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('server import rejects clients, duplicate/symlink roots and rolls back a failed registration', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-invalid-'));
  const directory = path.join(root, 'Server');
  const store = new Store(path.join(root, 'state'), () => {});
  try {
    await jar(path.join(directory, 'server.jar'), 'net.minecraft.client.main.Main');
    await assert.rejects(inspectServer(directory), /executable server/);
    await jar(path.join(directory, 'server.jar'), 'net.minecraft.server.Main', '1.21.1');
    const save = mock.method(store, 'save', async () => {
      throw new Error('disk full');
    });
    await assert.rejects(
      importServer(store, { directory }, new AbortController().signal),
      /disk full/,
    );
    assert.equal(store.state.servers.length, 0);
    assert.equal(store.state.selectedServer, undefined);
    save.mock.restore();
    const server = await importServer(store, { directory }, new AbortController().signal);
    await fs.symlink(directory, path.join(root, 'Alias'), 'dir');
    await assert.rejects(
      importServer(store, { directory: path.join(root, 'Alias') }, new AbortController().signal),
      /already registered/,
    );
    assert.equal(store.state.servers[0].id, server.id);
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('repairing an imported manual server retains its named JAR and bytecode Java requirement', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-manual-server-'));
  const directory = path.join(root, 'Spigot');
  const store = new Store(path.join(root, 'state'), () => {});
  const selected: number[] = [];
  const jobs = {
    output: { info: () => {}, error: () => {} },
    run: async (
      _label: string,
      work: (signal: AbortSignal, report: () => void) => Promise<unknown>,
    ) => work(new AbortController().signal, () => {}),
  };
  const servers = new Servers(
    store,
    {
      ensure: async (major: number) => {
        selected.push(major);
        return { major, path: '/test/java' };
      },
    } as never,
    jobs as never,
    {} as never,
    {} as never,
    () => {},
  );
  try {
    await jar(path.join(directory, 'spigot-1.12.2.jar'), 'org.bukkit.craftbukkit.Main');
    const zip = new AdmZip(path.join(directory, 'spigot-1.12.2.jar'));
    const header = Buffer.alloc(8);
    header.writeUInt32BE(0xcafebabe);
    header.writeUInt16BE(65, 6);
    zip.addFile('org/bukkit/craftbukkit/Main.class', header);
    zip.writeZip(path.join(directory, 'spigot-1.12.2.jar'));
    const server = await importServer(
      store,
      { directory, engine: 'spigot', minecraft: '1.12.2' },
      new AbortController().signal,
    );
    assert.equal(server.requiredJava, 21);
    await servers.install(server);
    assert.deepEqual(selected, [21]);
    assert.deepEqual(server.launchArgs, ['-jar', 'spigot-1.12.2.jar', 'nogui']);
    await fs.access(path.join(directory, 'spigot-1.12.2.jar'));
    await assert.rejects(fs.access(path.join(directory, 'server.jar')));
  } finally {
    servers.dispose();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
