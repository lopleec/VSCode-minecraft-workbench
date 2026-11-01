import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { moveInstance } from '../src/instance-move';
import type { Instance } from '../src/models';
import { readJson, writeJson } from '../src/files';

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-move-')));
  const source = path.join(root, 'instances', 'Named instance');
  const directory = path.join(source, '.minecraft');
  const parent = path.join(root, 'destination');
  await fs.mkdir(parent);
  await fs.mkdir(path.join(directory, 'saves', 'World'), { recursive: true });
  await fs.writeFile(path.join(directory, 'saves', 'World', 'level.dat'), 'world data');
  await fs.writeFile(path.join(source, 'mmc-pack.json'), '{"formatVersion":1}');
  const instance: Instance = {
    id: 'instance',
    name: 'Named instance',
    minecraft: '1.20.1',
    loader: 'fabric',
    createdAt: '',
    directory,
    containerDirectory: source,
    runtimeDirectory: path.join(source, 'runtime'),
    resourceDirectories: [path.join(root, 'shared'), path.join(source, 'assets')],
    layout: 'multimc',
  };
  const pack = [
    {
      path: 'mods/mod.jar',
      hash: '',
      algorithm: 'sha1',
      size: 0,
      source: 'local',
      urls: [],
      archive: path.join(directory, 'original.zip'),
      localFile: path.join(root, 'external.jar'),
    },
  ];
  await writeJson(path.join(directory, '.workbench', 'pack-files.json'), pack);
  return { root, source, parent, directory, instance, pack };
}

test('moving an instance keeps worlds and metadata and rebases only paths inside its container', async () => {
  const f = await fixture();
  try {
    let saved = 0;
    await moveInstance(
      f.instance,
      f.parent,
      async () => {
        saved++;
      },
      new AbortController().signal,
      () => {},
    );
    const target = path.join(f.parent, 'Named instance');
    assert.equal(saved, 1);
    assert.equal(f.instance.directory, path.join(target, '.minecraft'));
    assert.equal(f.instance.runtimeDirectory, path.join(target, 'runtime'));
    assert.deepEqual(f.instance.resourceDirectories, [
      path.join(f.root, 'shared'),
      path.join(target, 'assets'),
    ]);
    assert.equal(
      await fs.readFile(path.join(f.instance.directory, 'saves', 'World', 'level.dat'), 'utf8'),
      'world data',
    );
    assert.equal(
      await fs.readFile(path.join(target, 'mmc-pack.json'), 'utf8'),
      '{"formatVersion":1}',
    );
    const pack = await readJson<typeof f.pack>(
      path.join(f.instance.directory, '.workbench', 'pack-files.json'),
    );
    assert.equal(pack[0].archive, path.join(f.instance.directory, 'original.zip'));
    assert.equal(pack[0].localFile, path.join(f.root, 'external.jar'));
    await assert.rejects(fs.access(f.source));
  } finally {
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

for (const crossVolume of [false, true])
  test(`move rollback preserves all source data when saving fails (${crossVolume ? 'cross-volume' : 'same-volume'})`, async () => {
    const f = await fixture();
    const before = structuredClone(f.instance);
    const rename = fs.rename;
    const patch = crossVolume
      ? mock.method(
          fs,
          'rename',
          async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
            if (String(from) === f.source)
              throw Object.assign(new Error('Cross-device'), { code: 'EXDEV' });
            return rename(from, to);
          },
        )
      : undefined;
    try {
      await assert.rejects(
        moveInstance(
          f.instance,
          f.parent,
          async () => {
            throw new Error('State write failed');
          },
          new AbortController().signal,
          () => {},
        ),
        /State write failed/,
      );
      assert.deepEqual(f.instance, before);
      assert.equal(
        await fs.readFile(path.join(f.directory, 'saves', 'World', 'level.dat'), 'utf8'),
        'world data',
      );
      assert.deepEqual(
        await readJson(path.join(f.directory, '.workbench', 'pack-files.json')),
        f.pack,
      );
      assert.deepEqual(await fs.readdir(f.parent), []);
    } finally {
      patch?.mock.restore();
      await fs.rm(f.root, { recursive: true, force: true });
    }
  });

test('cross-volume moves copy hidden files and preserve shared external runtime paths', async () => {
  const f = await fixture();
  f.instance.runtimeDirectory = path.join(f.root, 'shared-runtime');
  const rename = fs.rename;
  const patch = mock.method(
    fs,
    'rename',
    async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (String(from) === f.source)
        throw Object.assign(new Error('Cross-device'), { code: 'EXDEV' });
      return rename(from, to);
    },
  );
  try {
    await moveInstance(
      f.instance,
      f.parent,
      async () => {},
      new AbortController().signal,
      () => {},
    );
    assert.equal(f.instance.runtimeDirectory, path.join(f.root, 'shared-runtime'));
    assert.equal(
      await fs.readFile(path.join(f.instance.directory, 'saves', 'World', 'level.dat'), 'utf8'),
      'world data',
    );
    await assert.rejects(fs.access(f.source));
  } finally {
    patch.mock.restore();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});

test('cancelling a cross-volume copy and rejecting unsafe destinations leave the original intact', async () => {
  const f = await fixture();
  const before = structuredClone(f.instance);
  const rename = fs.rename;
  const patch = mock.method(
    fs,
    'rename',
    async (from: Parameters<typeof fs.rename>[0], to: Parameters<typeof fs.rename>[1]) => {
      if (String(from) === f.source)
        throw Object.assign(new Error('Cross-device'), { code: 'EXDEV' });
      return rename(from, to);
    },
  );
  try {
    const abort = new AbortController();
    await assert.rejects(
      moveInstance(
        f.instance,
        f.parent,
        async () => assert.fail('Cancelled moves cannot save'),
        abort.signal,
        () => abort.abort(),
      ),
    );
    assert.deepEqual(f.instance, before);
    assert.deepEqual(await fs.readdir(f.parent), []);
    await assert.rejects(
      moveInstance(
        f.instance,
        f.directory,
        async () => {},
        new AbortController().signal,
        () => {},
      ),
      /inside itself/,
    );
    f.instance.linked = true;
    await assert.rejects(
      moveInstance(
        f.instance,
        f.parent,
        async () => {},
        new AbortController().signal,
        () => {},
      ),
      /linked/,
    );
    assert.equal(
      await fs.readFile(path.join(f.directory, 'saves', 'World', 'level.dat'), 'utf8'),
      'world data',
    );
  } finally {
    patch.mock.restore();
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
