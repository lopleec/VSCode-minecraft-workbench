import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import {
  parseProperties,
  updateProperties,
  validateProperties,
  validateServerRuntime,
  serverTarget,
  serverJvm,
} from '../src/server-settings';
import { compatible } from '../src/modrinth';
import { ServerProfile, ModVersion } from '../src/models';
import { ContentService } from '../src/content';
import { Network } from '../src/network';
import { ServerCatalog } from '../src/server-catalog';
import { Minecraft } from '../src/minecraft';
import { ServerBackups } from '../src/server-backups';

const profile: ServerProfile = {
  id: 'server',
  name: 'Test',
  engine: 'paper',
  minecraft: '1.21.4',
  directory: '/unused',
  createdAt: '2026-10-29T00:00:00.000Z',
};
function version(id: string, loader = 'paper'): ModVersion {
  const zip = new AdmZip();
  zip.addFile('plugin.yml', Buffer.from('name: ' + id));
  const body = zip.toBuffer();
  return {
    id,
    project_id: id,
    name: id,
    version_number: '1.0',
    game_versions: ['1.21.4'],
    loaders: [loader],
    dependencies: [],
    files: [
      {
        url: 'https://example.test/' + id,
        filename: id + '.jar',
        hashes: { sha1: createHash('sha1').update(body).digest('hex') },
        primary: true,
        size: body.length,
      },
    ],
  };
}
test('server properties retain unrelated settings, escape text, reject injection and invalid runtime values', () => {
  const original = '# server\nrcon.password=secret\nserver-port=25565\nmotd=old\n';
  const updated = updateProperties(
    original,
    validateProperties({ motd: '中文 \\ server', 'server-port': '25566' }),
  );
  assert.equal(parseProperties(updated).motd, '中文 \\ server');
  assert.equal(parseProperties(updated)['rcon.password'], 'secret');
  assert.equal(parseProperties(updated)['server-port'], '25566');
  for (const value of [
    { 'server-port': '70000' },
    { 'online-mode': 'yes' },
    { motd: 'new\nserver-ip=0.0.0.0' },
    { 'rcon.password': 'new' },
    { 'level-name': '../world' },
  ])
    assert.throws(() => validateProperties(value));
  assert.throws(() => validateServerRuntime({ name: 'Test', jvmArgs: ['-Xmx1G\nstop'] }));
  assert.throws(() => validateServerRuntime({ name: 'Test', javaMajor: 7 }));
  assert.deepEqual(serverJvm({ ...profile, minMemory: 512, maxMemory: 2048 }), [
    '-Xms512M',
    '-Xmx2048M',
  ]);
});
test('plugin compatibility includes Bukkit ancestry and requires explicit Folia support', () => {
  assert.equal(compatible(version('one', 'bukkit'), serverTarget(profile), 'plugin'), true);
  assert.equal(
    compatible(version('one', 'paper'), serverTarget({ ...profile, engine: 'purpur' }), 'plugin'),
    true,
  );
  assert.equal(
    compatible(version('one', 'paper'), serverTarget({ ...profile, engine: 'folia' }), 'plugin'),
    false,
  );
  assert.equal(compatible(version('one', 'fabric'), serverTarget(profile), 'plugin'), false);
});
test('plugin dependencies stay in plugins and client-only mods are rejected on servers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-content-'));
  const versions = [version('main'), version('dependency', 'bukkit')];
  versions[0].dependencies = [{ project_id: 'dependency', dependency_type: 'required' }];
  const requests: string[] = [];
  const net = {
    json: async (url: string) => {
      requests.push(url);
      if (url.includes('/project/') && url.includes('/version')) return [versions[1]];
      if (url.includes('/project/'))
        return {
          id: 'dependency',
          slug: 'dependency',
          project_type: 'mod',
          server_side: 'optional',
        };
      throw new Error(url);
    },
    download: async (_url: string, destination: string) => {
      const zip = new AdmZip();
      zip.addFile('plugin.yml', Buffer.from('plugin'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      zip.writeZip(destination);
    },
  } as unknown as Network;
  const service = new ContentService(net);
  const target = serverTarget({ ...profile, directory: root });
  try {
    const plan = await service.plan(target, versions[0], 'plugin');
    assert.equal(plan.conflicts.length, 0);
    assert.deepEqual(
      plan.entries.map((e) => e.kind),
      ['plugin', 'plugin'],
    );
    await service.install(target, versions[0], 'plugin', new AbortController().signal, () => {});
    assert.equal((await fs.readdir(path.join(root, 'plugins'))).length, 2);
    assert.ok(requests.some((url) => decodeURIComponent(url).includes('"bukkit"')));
    const client = new ContentService({
      json: async () => ({ server_side: 'unsupported' }),
    } as unknown as Network);
    const rejection = await client.plan(
      { ...target, directory: path.join(root, 'client-only-check'), loader: 'fabric' },
      version('client', 'fabric'),
      'mod',
    );
    assert.ok(rejection.conflicts.some((c) => c.includes('Client-only')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('Paper catalog uses Fill v3 pinned builds and server checksums', async () => {
  const net = {
    json: async (url: string) =>
      url.endsWith('/builds')
        ? [
            {
              id: 7,
              channel: 'STABLE',
              downloads: {
                'server:default': {
                  url: 'https://example.test/paper.jar',
                  size: 123,
                  checksums: { sha256: 'abc' },
                },
              },
            },
          ]
        : { versions: { '1.21': ['1.21.4', '1.21.5'] } },
  } as unknown as Network;
  const catalog = new ServerCatalog(net, {} as Minecraft);
  assert.deepEqual(await catalog.versions('paper'), ['1.21.5', '1.21.4']);
  assert.deepEqual(await catalog.builds('paper', '1.21.4'), [{ id: '7', stable: true }]);
  assert.equal(
    (await catalog.artifact({ ...profile, build: '7' }, new AbortController().signal)).algorithm,
    'sha256',
  );
  await assert.rejects(
    catalog.artifact({ ...profile, build: '8' }, new AbortController().signal),
    /not found/,
  );
});
test('server backups preserve current worlds before restore', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-backup-'));
  const server = { ...profile, directory: root };
  const backups = new ServerBackups();
  try {
    await fs.mkdir(path.join(root, 'world'));
    await fs.writeFile(path.join(root, 'world', 'level.dat'), 'first');
    const id = await backups.create(server, 'world');
    await fs.writeFile(path.join(root, 'world', 'level.dat'), 'second');
    await backups.restore(server, id, 'world');
    assert.equal(await fs.readFile(path.join(root, 'world', 'level.dat'), 'utf8'), 'first');
    assert.equal((await backups.list(server)).length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('server lifecycle prevents parallel starts, accepts console commands and releases locks before restart', async () => {
  const mutable = require('vscode') as { window: unknown };
  mutable.window = {
    createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
  };
  const { Servers } = await import('../src/servers');
  const { spawn } = await import('node:child_process');
  const { Store } = await import('../src/store');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-server-process-'));
  const store = new Store(root, () => {});
  await store.load();
  const directory = path.join(root, 'server');
  await fs.mkdir(directory);
  const fixture = path.join(root, 'fake-server.cjs');
  await fs.writeFile(
    fixture,
    "console.log('Done (0.01s)!');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{console.log('command:'+line);if(line==='stop')process.exit(0);});",
  );
  const jobs = {
    run: async (
      _label: string,
      work: (s: AbortSignal, r: (text: string) => void) => Promise<unknown>,
    ) => work(new AbortController().signal, () => {}),
    output: { error: () => {} },
  };
  const server = {
    ...profile,
    directory,
    installed: true,
    eulaAccepted: true,
    launchArgs: ['-jar', 'server.jar'],
  };
  store.state.servers = [server];
  const net = { json: async () => ({ javaVersion: { majorVersion: 21 } }) };
  const service = new Servers(
    store,
    { ensure: async () => ({ path: process.execPath, major: 21 }) } as never,
    jobs as never,
    net as never,
    {
      manifest: async () => ({
        versions: [{ id: '1.21.4', url: 'https://example.test/manifest' }],
      }),
    } as never,
    () => {},
    ((_java: unknown, _args: unknown, options: unknown) =>
      spawn(process.execPath, [fixture], options as never)) as typeof spawn,
  );
  const waitFor = async (predicate: () => boolean) => {
    const timeout = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > timeout) throw new Error('Process wait timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  try {
    await service.properties(server, { 'server-port': '25595' });
    await service.start(server);
    await waitFor(() => service.status(server) === 'running');
    await assert.rejects(service.start(server), /Stop the server/);
    await assert.rejects(service.command(server, 'say first\nstop'), /single server command/);
    await service.command(server, 'say test');
    await waitFor(() => service.log(server).some((line) => line === 'command:say test'));
    await service.stop(server);
    assert.equal(service.status(server), 'stopped');
    await service.start(server);
    await waitFor(() => service.status(server) === 'running');
    await service.stop(server);
    assert.equal(
      await fs.stat(path.join(directory, '.workbench', 'server.lock')).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await service.close();
    service.dispose();
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Quilt uses the Maven checksum when the installer metadata checksum is stale', async () => {
  const actual = 'a'.repeat(64);
  const net = {
    json: async () => [
      {
        url: 'https://maven.quiltmc.org/installer.jar',
        hashes: { sha256: 'b'.repeat(64) },
        file_size: 100,
      },
    ],
    text: async (url: string) => {
      assert.ok(url.endsWith('.jar.sha256'));
      return actual;
    },
  } as unknown as Network;
  const catalog = new ServerCatalog(net, {} as Minecraft);
  const artifact = await catalog.artifact(
    { ...profile, engine: 'quilt', build: '0.30.1' },
    new AbortController().signal,
  );
  assert.equal(artifact.hash, actual);
  assert.equal(artifact.algorithm, 'sha256');
});
