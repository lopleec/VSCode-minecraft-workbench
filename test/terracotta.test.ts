import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:http';
import type { Memento } from 'vscode';
import * as vscode from 'vscode';
import { Terracotta, roomCode } from '../src/terracotta';
import notice from '../src/terracotta-notice.json';
import type { Network } from '../src/network';
import manifest from '../package.json';

function storage() {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string) => values.get(key) as T,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  } as Pick<Memento, 'get' | 'update'>;
}
test('Terracotta is opt-in and requires separately persisted explicit confirmations', async () => {
  const original = vscode.workspace.getConfiguration;
  let enabled = false,
    networkCalls = 0;
  vscode.workspace.getConfiguration = (() => ({
    get: (_key: string, fallback: unknown) => (_key === 'terracotta.enabled' ? enabled : fallback),
  })) as typeof original;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-terracotta-'));
  const saved = storage();
  const feature = new Terracotta(
    saved,
    root,
    {
      json: async () => {
        networkCalls++;
        throw new Error('network called');
      },
    } as unknown as Network,
    () => {},
    () => true,
  );
  try {
    const defaults = manifest.contributes.configuration
      .flatMap((group) => Object.entries(group.properties))
      .find(([key]) => key === 'minecraftWorkbench.terracotta.enabled');
    assert.equal((defaults![1] as { default: boolean }).default, false);
    await assert.rejects(feature.connect(), /Enable Terracotta/);
    await assert.rejects(
      feature.download(new AbortController().signal, () => {}),
      /Enable Terracotta/,
    );
    assert.equal(networkCalls, 0);
    enabled = true;
    await assert.rejects(feature.connect(), /notices/);
    for (const change of [
      {},
      { version: notice.version, license: 'true', network: true },
      { version: notice.version, license: true, network: false },
      { version: 'old', license: true, network: true },
    ])
      await assert.rejects(feature.accept(change));
    const update = saved.update;
    saved.update = async () => {
      throw new Error('disk full');
    };
    await assert.rejects(
      feature.accept({ version: notice.version, license: true, network: true }),
      /disk full/,
    );
    assert.equal(feature.accepted, false);
    saved.update = update;
    await feature.accept({ version: notice.version, license: true, network: true });
    assert.equal(feature.accepted, true);
    assert.equal(networkCalls, 0);
    assert.equal(roomCode('u/abcd-1234-abcd-1234'), 'U/ABCD-1234-ABCD-1234');
    for (const invalid of ['http://example.org', '../file', 'U/', 'LEGACY', true])
      assert.throws(() => roomCode(invalid));
    await feature.revoke();
    assert.equal(feature.accepted, false);
  } finally {
    await feature.close();
    vscode.workspace.getConfiguration = original;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Terracotta room APIs use loopback, validate addresses, and disconnect owned rooms when disabled', async () => {
  const original = vscode.workspace.getConfiguration;
  let enabled = true;
  vscode.workspace.getConfiguration = (() => ({
    get: (key: string, fallback: unknown) => (key === 'terracotta.enabled' ? enabled : fallback),
  })) as typeof original;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-terracotta-api-'));
  const seen: URL[] = [];
  let state: Record<string, unknown> = { state: 'waiting' };
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    seen.push(url);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/state') {
      res.end(JSON.stringify(state));
      return;
    }
    if (url.pathname === '/state/scanning')
      state = { state: 'host-ok', room: 'U/ABCD-1234-ABCD-1234' };
    if (url.pathname === '/state/guesting')
      state = {
        state: 'guest-ok',
        url: '127.0.0.1:25566',
        profiles: [{ name: 'Player', machine_id: 'private-device' }],
      };
    if (url.pathname === '/state/ide') state = { state: 'waiting' };
    res.end('');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const feature = new Terracotta(
    storage(),
    root,
    {} as Network,
    () => {},
    () => true,
  );
  try {
    await feature.accept({ version: notice.version, license: true, network: true });
    (feature as unknown as { endpoint: string }).endpoint =
      `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await feature.host('Player');
    assert.equal(feature.snapshot().state, 'host-ok');
    await feature.leave();
    await feature.join('U/ABCD-1234-ABCD-1234', 'Player');
    assert.equal(feature.address(), '127.0.0.1:25566');
    assert.ok(!JSON.stringify(feature.snapshot()).includes('private-device'));
    assert.equal(
      seen.find((url) => url.pathname === '/state/guesting')!.searchParams.get('room'),
      'U/ABCD-1234-ABCD-1234',
    );
    state = { state: 'guest-ok', url: 'example.org:25565' };
    await feature.refresh();
    assert.equal(feature.address(), undefined);
    enabled = false;
    await feature.configurationChanged();
    assert.equal(feature.snapshot().connected, false);
    assert.equal(state.state, 'waiting');
    const before = seen.length;
    await assert.rejects(feature.host(), /Enable Terracotta/);
    assert.equal(seen.length, before);
  } finally {
    await feature.close();
    vscode.workspace.getConfiguration = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
