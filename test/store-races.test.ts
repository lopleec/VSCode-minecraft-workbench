import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Store } from '../src/store';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve() };
};
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('State synchronization timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcw-state-race-'));
  const store = new Store(root, () => {});
  await store.load();
  await store.save();
  return {
    store,
    file: path.join(root, 'state.json'),
    cleanup: async () => {
      store.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('a delayed file-watcher read cannot roll back a newer completed save', async () => {
  const { store, file, cleanup } = await fixture();
  const raw = require('node:fs/promises');
  const readFile = raw.readFile;
  const release = deferred();
  let reading = false,
    armed = true;
  const read = mock.method(raw, 'readFile', async (...args: unknown[]) => {
    const result = await readFile(...args);
    if (String(args[0]) === file && armed) {
      armed = false;
      reading = true;
      await release.promise;
    }
    return result;
  });
  try {
    const external = { ...store.state, mode: 'server' };
    await fs.writeFile(file, JSON.stringify(external));
    await until(() => reading);
    store.state.mode = 'developer';
    await store.save();
    release.resolve();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(store.state.mode, 'developer');
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).mode, 'developer');
  } finally {
    release.resolve();
    read.mock.restore();
    await cleanup();
  }
});

test('merging external state does not mark unsaved local changes as persisted', async () => {
  const { store, file, cleanup } = await fixture();
  try {
    const external = JSON.parse(await fs.readFile(file, 'utf8'));
    store.state.mode = 'developer';
    external.accounts.push({ id: 'external', name: 'TestPlayer', kind: 'offline' });
    await fs.writeFile(file, JSON.stringify(external));
    await until(() => store.state.accounts.some((account) => account.id === 'external'));
    assert.equal(store.state.mode, 'developer');
    await store.save();
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).mode, 'developer');
  } finally {
    await cleanup();
  }
});

test('edits made while a save writes remain dirty for the following save', async () => {
  const { store, file, cleanup } = await fixture();
  const raw = require('node:fs/promises');
  const writeFile = raw.writeFile;
  const release = deferred();
  let writing = false,
    armed = true;
  const write = mock.method(raw, 'writeFile', async (...args: unknown[]) => {
    if (String(args[0]).startsWith(file + '.') && armed) {
      armed = false;
      writing = true;
      await release.promise;
    }
    return writeFile(...args);
  });
  try {
    store.state.mode = 'developer';
    const saving = store.save();
    await until(() => writing);
    store.state.mode = 'server';
    release.resolve();
    await saving;
    assert.equal(store.state.mode, 'server');
    await store.save();
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).mode, 'server');
  } finally {
    release.resolve();
    write.mock.restore();
    await cleanup();
  }
});
