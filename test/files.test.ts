import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { extractZip, offlineUuid, readJson, redact, within, writeJson } from '../src/files';
import { Store } from '../src/store';

test('managed paths reject traversal, Windows paths and archive symlinks', async () => {
  const managedRoot = path.resolve(os.tmpdir(), 'mc-root');
  for (const name of ['../secret', '/etc/passwd', 'C:/secret', '..\\secret', 'a/../../b', '\0'])
    assert.throws(() => within(managedRoot, name));
  assert.equal(within(managedRoot, 'mods/test.jar'), path.join(managedRoot, 'mods', 'test.jar'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-files-'));
  try {
    const zip = new AdmZip();
    zip.addFile('mods/test.jar', Buffer.from('content'));
    const archive = path.join(root, 'a.zip');
    zip.writeZip(archive);
    const output = path.join(root, 'out');
    await extractZip(archive, output);
    assert.equal(await fs.readFile(path.join(output, 'mods/test.jar'), 'utf8'), 'content');
    await fs.mkdir(path.join(root, 'outside'));
    await fs.symlink(path.join(root, 'outside'), path.join(output, 'redirect'), 'junction');
    const unsafe = new AdmZip();
    unsafe.addFile('redirect/secret.txt', Buffer.from('bad'));
    unsafe.writeZip(archive);
    await assert.rejects(extractZip(archive, output), /Symbolic/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('offline UUID matches Java UUID.nameUUIDFromBytes', () => {
  assert.equal(offlineUuid('Notch'), 'b50ad385829d3141a2167e7d7539ba7f');
  assert.notEqual(offlineUuid('Notch'), offlineUuid('notch'));
});

test('cancelled ZIP extraction does not create files', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    extractZip('not-opened.zip', 'not-created', 0, undefined, controller.signal),
    { name: 'AbortError' },
  );
});
test('tokens and proxy passwords are redacted', () => {
  const result = redact(
    'Bearer secret --accessToken hidden access_token="abc" refresh_token=def https://user:pass@proxy.test socks5h://name:password@proxy.test',
  );
  for (const secret of ['secret', 'hidden', 'abc', 'def', 'user:pass', 'name:password'])
    assert.ok(!result.includes(secret));
  assert.equal(redact('socks://:password@proxy.test'), 'socks://[redacted]@proxy.test');
  assert.equal(redact('https://token@mirror.test/file'), 'https://[redacted]@mirror.test/file');
  assert.equal(
    redact('https://mirror.test?email=user@example.test'),
    'https://mirror.test?email=user@example.test',
  );
});
test('atomic state writes are serialized and invalid JSON is preserved', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-store-'));
  const store = new Store(root, () => {});
  try {
    assert.equal(await readJson(path.join(root, 'absent'), undefined), undefined);
    await store.load();
    const writes = [];
    for (let i = 0; i < 20; i++) {
      store.state.mode = i % 2 ? 'developer' : 'launcher';
      writes.push(store.save());
    }
    await Promise.all(writes);
    assert.equal(
      (await readJson<{ mode: string }>(path.join(root, 'state.json'))).mode,
      'developer',
    );
    await fs.writeFile(path.join(root, 'state.json'), 'broken');
    await assert.rejects(store.load());
    assert.equal(await fs.readFile(path.join(root, 'state.json'), 'utf8'), 'broken');
    await writeJson(path.join(root, 'data.json'), { okay: true });
    assert.deepEqual(await readJson(path.join(root, 'data.json')), { okay: true });
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('separate windows merge additions and independent edits without reviving deleted entries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-windows-'));
  const a = new Store(root, () => {});
  const b = new Store(root, () => {});
  try {
    await a.load();
    await b.load();
    a.state.accounts.push({ id: 'a', name: 'Alice', kind: 'offline' });
    b.state.accounts.push({ id: 'b', name: 'Bob', kind: 'offline' });
    await Promise.all([a.save(), b.save()]);
    const data = await readJson<{ accounts: { id: string }[] }>(path.join(root, 'state.json'));
    assert.deepEqual(data.accounts.map((a) => a.id).sort(), ['a', 'b']);
    await a.load();
    await b.load();
    a.state.accounts = a.state.accounts.filter((account) => account.id !== 'b');
    b.state.accounts.find((account) => account.id === 'a')!.name = 'Updated';
    await Promise.all([a.save(), b.save()]);
    const merged = await readJson<{ accounts: { id: string; name: string }[] }>(
      path.join(root, 'state.json'),
    );
    assert.deepEqual(merged.accounts, [{ id: 'a', name: 'Updated', kind: 'offline' }]);
  } finally {
    a.dispose();
    b.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
