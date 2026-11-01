import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { ContentService } from '../src/content';
import type { Network } from '../src/network';
import type { Instance, ModVersion } from '../src/models';

const payload = Buffer.from('batch mod');
const sha1 = createHash('sha1').update(payload).digest('hex');
function version(project: string, id = project): ModVersion {
  return {
    id,
    project_id: project,
    name: project,
    version_number: id,
    game_versions: ['1.20.1'],
    loaders: ['fabric'],
    version_type: 'release',
    date_published: '2026-01-01',
    dependencies: [],
    files: [
      {
        filename: id + '.jar',
        primary: true,
        url: 'https://cdn.modrinth.com/' + id,
        hashes: { sha1 },
        size: payload.length,
      },
    ],
  };
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-batch-'));
  const target: Instance = {
    id: 'target',
    name: 'Target',
    minecraft: '1.20.1',
    loader: 'fabric',
    directory: root,
    createdAt: '',
  };
  const dependency = version('dependency');
  const a = version('a');
  const b = version('b');
  for (const mod of [a, b])
    mod.dependencies.push({ project_id: dependency.project_id, dependency_type: 'required' });
  const beta = { ...a, id: 'a-beta', version_type: 'beta' as const, date_published: '2026-10-01' };
  const wrongLoader = { ...a, id: 'a-forge', loaders: ['forge'], date_published: '2026-11-01' };
  const wrongGame = {
    ...b,
    id: 'b-other',
    game_versions: ['1.21.1'],
    date_published: '2026-11-01',
  };
  const versions = new Map<string, ModVersion[]>([
    ['a', [wrongLoader, beta, a]],
    ['b', [wrongGame, b]],
    ['dependency', [dependency]],
    ['unavailable', [wrongGame]],
  ]);
  const downloads: string[] = [];
  const net = {
    json: async (address: string) => {
      const url = new URL(address);
      const [, , type, id, action] = url.pathname.split('/');
      if (type === 'project' && action === 'version') return versions.get(id) || [];
      if (type === 'project') return { id, title: id, project_type: 'mod' };
      if (type === 'version') return [...versions.values()].flat().find((v) => v.id === id);
      throw new Error(address);
    },
    download: async (url: string, file: string) => {
      downloads.push(url);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, payload);
    },
  } as unknown as Network;
  return { root, target, versions, net, downloads, service: new ContentService(net) };
}

test('bulk installation matches game and loader, prefers stable releases and installs shared dependencies once', async () => {
  const f = await fixture();
  try {
    const result = await f.service.planBatch(f.target, ['a', 'b', 'a']);
    assert.deepEqual(
      result.versions.map((v) => v.id),
      ['a', 'b'],
    );
    assert.deepEqual(result.plan.conflicts, []);
    assert.equal(result.plan.entries.filter((e) => e.version.id === 'dependency').length, 1);
    await f.service.installBatch(f.target, ['a', 'b'], new AbortController().signal, () => {});
    assert.equal(f.downloads.length, 3);
    assert.equal((await f.service.list(f.target)).length, 3);
    await f.service.installBatch(f.target, ['a', 'b'], new AbortController().signal, () => {});
    assert.equal(f.downloads.length, 3, 'Already installed files are not downloaded again');
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('bulk conflicts, incompatible projects and cancellation leave installed files unchanged', async () => {
  const f = await fixture();
  try {
    const unavailable = await f.service.planBatch(f.target, ['a', 'unavailable']);
    assert.equal(unavailable.unavailable[0].projectId, 'unavailable');
    await assert.rejects(
      f.service.installBatch(
        f.target,
        ['a', 'unavailable'],
        new AbortController().signal,
        () => {},
      ),
      /No compatible/,
    );
    f.versions.get('b')![1].dependencies.push({ project_id: 'a', dependency_type: 'incompatible' });
    await assert.rejects(
      f.service.installBatch(f.target, ['a', 'b'], new AbortController().signal, () => {}),
      /Incompatible/,
    );
    assert.equal(f.downloads.length, 0);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(f.service.planBatch(f.target, ['a'], abort.signal));
    assert.deepEqual(await f.service.list(f.target), []);
    for (const ids of [[], Array(101).fill('a'), ['../bad']])
      await assert.rejects(f.service.planBatch(f.target, ids));
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('bulk download failures discard staged files before applying any mod', async () => {
  const f = await fixture();
  try {
    f.net.download = async (_url, file) => {
      if (file.endsWith('b.jar')) throw new Error('Download failed');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, payload);
    };
    await assert.rejects(
      f.service.installBatch(f.target, ['a', 'b'], new AbortController().signal, () => {}),
      /Download failed/,
    );
    assert.deepEqual(await f.service.list(f.target), []);
    assert.deepEqual(await fs.readdir(path.join(f.root, '.workbench', 'staging')), []);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('cancelling metadata resolution aborts its request without cancelling another caller of the same project', async () => {
  const f = await fixture();
  try {
    const abort = new AbortController();
    let requests = 0;
    f.net.json = async (_url, options) => {
      requests++;
      if (!options?.signal) return { id: 'a', title: 'a', project_type: 'mod' } as never;
      return new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
          once: true,
        });
      });
    };
    const pending = f.service.planBatch(f.target, ['a'], abort.signal);
    const failure = assert.rejects(pending, /Cancelled/);
    const project = await f.service.project('a');
    assert.equal(project.id, 'a');
    abort.abort(new Error('Cancelled'));
    await failure;
    assert.equal(
      (await f.service.project('a')).id,
      'a',
      'Cancelling an earlier request preserves the newer cached response',
    );
    assert.equal(requests, 2);
    assert.deepEqual(await f.service.list(f.target), []);
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
