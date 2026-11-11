import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ImportSession } from '../src/import-session';
import { Store } from '../src/store';

async function fixture(count: number) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-import-many-'));
  const source = path.join(root, 'source');
  await fs.mkdir(source);
  await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const folder = path.join(source, `Instance ${i}`);
      await fs.mkdir(path.join(folder, '.minecraft'), { recursive: true });
      await fs.writeFile(path.join(folder, 'instance.cfg'), `[General]\nname=Instance ${i}\n`);
      await fs.writeFile(
        path.join(folder, 'mmc-pack.json'),
        JSON.stringify({
          formatVersion: 1,
          components: [{ uid: 'net.minecraft', version: '1.20.1' }],
        }),
      );
      await fs.writeFile(path.join(folder, '.minecraft', 'world.txt'), 'keep');
    }),
  );
  const store = new Store(path.join(root, 'state'), () => {});
  const session = new ImportSession(store);
  return {
    root,
    source,
    store,
    session,
    close: async () => {
      await session.clear();
      store.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('100 imports use one batch rescan, retain files and apply the selected group', async () => {
  const f = await fixture(100);
  const nativeFs = require('node:fs/promises');
  const original = nativeFs.readdir;
  const realSource = await fs.realpath(f.source);
  let scans = 0;
  const read = mock.method(nativeFs, 'readdir', async (folder: unknown, ...args: unknown[]) => {
    if (folder === realSource) scans++;
    return original(folder, ...args);
  });
  try {
    const scan = await f.session.inspect(f.source, new AbortController().signal);
    const entries = scan.candidates.map((candidate) => ({
      key: candidate.key,
      name: candidate.name,
    }));
    const result = await f.session.commitMany(
      entries,
      'link',
      new AbortController().signal,
      () => {},
      undefined,
      'Imported',
    );
    assert.equal(result.imported.length, 100);
    assert.deepEqual(result.failed, []);
    assert.equal(result.cancelled, false);
    assert.equal(scans, 2, 'One initial scan and one recheck for the whole batch');
    assert.equal(f.store.state.instances.length, 100);
    assert.ok(f.store.state.instances.every((instance) => instance.group === 'Imported'));
    assert.equal(
      await fs.readFile(path.join(result.imported[0].instance.directory, 'world.txt'), 'utf8'),
      'keep',
    );
  } finally {
    read.mock.restore();
    await f.close();
  }
});

test('a duplicate does not abort other imports; cancellation retains completed instances', async () => {
  const f = await fixture(4);
  try {
    const scan = await f.session.inspect(f.source, new AbortController().signal);
    const entries = scan.candidates.map((candidate) => ({
      key: candidate.key,
      name: candidate.name,
    }));
    await f.session.commit(entries[0].key, 'link', new AbortController().signal);
    const result = await f.session.commitMany(
      entries.slice(0, 2),
      'link',
      new AbortController().signal,
      () => {},
    );
    assert.equal(result.imported.length, 1);
    assert.equal(result.failed.length, 1);
    const controller = new AbortController();
    let calls = 0;
    const cancelled = await f.session.commitMany(
      entries.slice(2),
      'link',
      controller.signal,
      () => {
        if (++calls === 2) controller.abort();
      },
    );
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.imported.length, 1);
    assert.equal(f.store.state.instances.length, 3);
    await assert.rejects(
      f.session.commitMany(
        [entries[0], entries[0]],
        'link',
        new AbortController().signal,
        () => {},
      ),
      /Invalid instance import selection/,
    );
  } finally {
    await f.close();
  }
});
