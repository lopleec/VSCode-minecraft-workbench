import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { ContentService } from '../src/content';
import { Network } from '../src/network';
import { Instance, ModVersion } from '../src/models';
import { writeJson } from '../src/files';

const payload = Buffer.from('test-mod');
function version(id: string, project = id): ModVersion {
  return {
    id,
    project_id: project,
    name: id,
    version_number: id,
    game_versions: ['1.21.1'],
    loaders: ['fabric'],
    dependencies: [],
    files: [
      {
        url: `https://cdn.modrinth.com/${id}.jar`,
        filename: `${id}.jar`,
        primary: true,
        size: payload.length,
        hashes: { sha1: createHash('sha1').update(payload).digest('hex') },
      },
    ],
  };
}
test('required dependencies install once; updates retain disabled state and archive old files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-content-'));
  const instance: Instance = {
    id: 'test',
    name: 'Test',
    directory: root,
    minecraft: '1.21.1',
    loader: 'fabric',
    createdAt: '',
  };
  const dep = version('dependency');
  const mod = version('mod-v1', 'mod');
  mod.dependencies.push({
    project_id: 'dependency',
    version_id: dep.id,
    dependency_type: 'required',
  });
  let downloads = 0;
  const net = {
    json: async (url: string) => {
      if (url.includes('/version/dependency')) return dep;
      if (url.includes('/version/mod-v1')) return mod;
      throw new Error(url);
    },
    download: async (_url: string, target: string) => {
      downloads++;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, payload);
    },
  } as unknown as Network;
  const service = new ContentService(net);
  try {
    await service.install(instance, mod, 'mod', new AbortController().signal, () => {});
    assert.equal(downloads, 2);
    assert.equal((await service.list(instance)).length, 2);
    const old = (await service.list(instance)).find((i) => i.projectId === 'mod')!;
    await service.toggle(instance, old);
    const update = version('mod-v2', 'mod');
    await service.install(instance, update, 'mod', new AbortController().signal, () => {});
    const current = (await service.list(instance)).find((i) => i.projectId === 'mod')!;
    assert.equal(current.enabled, false);
    assert.equal(current.file, 'mod-v2.jar.disabled');
    await fs.rm(path.join(root, 'mods', current.file));
    await service.repairPack(instance, new AbortController().signal, () => {});
    assert.equal(
      await fs.readFile(path.join(root, 'mods', current.file), 'utf8'),
      payload.toString(),
    );
    await assert.rejects(fs.access(path.join(root, 'mods', 'mod-v2.jar')));
    await assert.rejects(fs.access(path.join(root, 'mods', 'mod-v1.jar.disabled')));
    assert.ok((await fs.readdir(path.join(root, '.workbench', 'history'))).length > 0);
    const conflict = version('conflict');
    conflict.dependencies.push({ project_id: 'dependency', dependency_type: 'incompatible' });
    await assert.rejects(
      service.install(instance, conflict, 'mod', new AbortController().signal, () => {}),
      /Incompatible/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('modpack paths cannot escape an instance and server-only files are skipped', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-pack-'));
  const instance: Instance = {
    id: 'test',
    name: 'Test',
    directory: path.join(root, 'instance'),
    minecraft: '',
    loader: 'vanilla',
    createdAt: '',
  };
  const net = {
    download: async () => {
      throw new Error('Unexpected download');
    },
  } as unknown as Network;
  const service = new ContentService(net);
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.0' },
    files: [
      {
        path: '../outside.jar',
        hashes: { sha1: 'abc' },
        downloads: ['https://example.com/test.jar'],
        fileSize: 10,
      },
    ],
  };
  const archive = path.join(root, 'pack.mrpack');
  try {
    const zip = new AdmZip();
    zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index)));
    zip.writeZip(archive);
    await assert.rejects(
      service.importPack(archive, instance, new AbortController().signal, () => {}),
      /Reserved|escapes/,
    );
    index.files = [];
    const safe = new AdmZip();
    safe.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index)));
    safe.addFile('overrides/config/test.json', Buffer.from('{}'));
    safe.writeZip(archive);
    await service.importPack(archive, instance, new AbortController().signal, () => {});
    assert.equal(instance.loader, 'fabric');
    assert.equal(instance.minecraft, '1.21.1');
    assert.equal(
      await fs.readFile(path.join(instance.directory, 'config', 'test.json'), 'utf8'),
      '{}',
    );
    await writeJson(path.join(root, 'keep.json'), { safe: true });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('conflict metadata is cached, parallelism is bounded, and offline failures stop the queue', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-conflict-cache-'));
  const instance: Instance = {
    id: 'x',
    name: 'Game',
    minecraft: '1.21.1',
    loader: 'fabric',
    directory: root,
    createdAt: '',
  };
  try {
    const items = Array.from({ length: 12 }, (_, i) => ({
      file: `${i}.jar`,
      name: `Mod ${i}`,
      kind: 'mod',
      enabled: true,
      versionId: `v${i}`,
      projectId: `p${i}`,
    }));
    for (const item of items) {
      const zip = new AdmZip();
      zip.addFile('pack.mcmeta', Buffer.from('{}'));
      await fs.mkdir(path.join(root, 'mods'), { recursive: true });
      zip.writeZip(path.join(root, 'mods', item.file));
    }
    await writeJson(path.join(root, '.workbench', 'content.json'), items);
    let calls = 0,
      active = 0,
      peak = 0;
    const service = new ContentService({
      json: async (url: string) => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return version(url.split('/').pop()!);
      },
    } as unknown as Network);
    assert.deepEqual(await service.conflicts(instance), []);
    assert.equal(calls, 12);
    assert.ok(peak > 1 && peak <= 4);
    await service.conflicts(instance);
    assert.equal(calls, 12);
    let failed = 0;
    const offline = new ContentService({
      json: async () => {
        failed++;
        await new Promise((r) => setTimeout(r, 2));
        throw new Error('offline');
      },
    } as unknown as Network);
    assert.deepEqual(await offline.conflicts(instance), [
      'Online metadata unavailable; local checks only.',
    ]);
    assert.ok(failed <= 4);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
