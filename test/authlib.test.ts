import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { Authlib, authServerUrl, accountSecretKey } from '../src/authlib';
import { Store } from '../src/store';
import { Network, HttpError } from '../src/network';
import type * as vscode from 'vscode';

const player = { id: '0123456789abcdef0123456789abcdef', name: 'Player' };
const other = { id: 'abcdef0123456789abcdef0123456789', name: 'Other' };
const signal = () => new AbortController().signal;
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-authlib-'));
  const store = new Store(path.join(root, 'state'), () => {});
  const saved = new Map<string, string>();
  const secrets = {
    get: async (key: string) => saved.get(key),
    store: async (key: string, value: string) => {
      saved.set(key, value);
    },
    delete: async (key: string) => {
      saved.delete(key);
    },
  } as unknown as vscode.SecretStorage;
  const calls: { url: string; options: any }[] = [];
  const jar = Buffer.from('authlib-test');
  const hash = createHash('sha256').update(jar).digest('hex');
  let valid = false,
    wrongProfile = false;
  const net = {
    response: async (url: string) => ({
      status: 200,
      headers: url.includes('/api/')
        ? {}
        : { 'x-authlib-injector-api-location': '/api/yggdrasil/' },
      text: '{}',
    }),
    text: async (url: string, options: unknown) => {
      calls.push({ url, options });
      if (url.endsWith('/validate')) {
        if (!valid) throw new HttpError(403, 'expired');
        return '';
      }
      return '{"meta":{"serverName":"Example"},"signaturePublickey":"key"}';
    },
    json: async (url: string, options: any) => {
      calls.push({ url, options });
      if (url.endsWith('latest.json'))
        return {
          build_number: 1,
          download_url: 'https://example.org/agent.jar',
          checksums: { sha256: hash },
        };
      if (url.endsWith('/authenticate'))
        return {
          accessToken: 'initial-secret',
          clientToken: 'client-secret',
          availableProfiles: [player, other],
        };
      if (url.endsWith('/refresh'))
        return {
          accessToken: 'refreshed-secret',
          clientToken: 'client-secret',
          selectedProfile: wrongProfile ? other : options.body.selectedProfile || player,
        };
      throw new Error(url);
    },
    download: async (_url: string, target: string) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, jar);
    },
  } as unknown as Network;
  return {
    root,
    store,
    saved,
    calls,
    net,
    auth: new Authlib(store, secrets, net),
    setValid: (value: boolean) => (valid = value),
    setWrong: () => (wrongProfile = true),
    close: async () => {
      store.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
test('external auth discovers ALI, selects a profile and keeps passwords/tokens outside state', async () => {
  const f = await fixture();
  try {
    assert.equal(authServerUrl('example.org/api/yggdrasil'), 'https://example.org/api/yggdrasil/');
    for (const bad of [
      'http://example.org/',
      'https://user:password@example.org/',
      'https://example.org/?token=secret',
    ])
      assert.throws(() => authServerUrl(bad));
    assert.equal(
      (await f.auth.discover('https://example.org/', signal())).url,
      'https://example.org/api/yggdrasil/',
    );
    let chosen = 0;
    await f.auth.login(
      'https://example.org/api/yggdrasil/',
      'user@example.org',
      'private-password',
      async (profiles) => {
        chosen++;
        assert.equal(profiles.length, 2);
        return player;
      },
      signal(),
    );
    assert.equal(chosen, 1);
    assert.ok(
      f.calls
        .filter((call) => call.url.endsWith('/yggdrasil/'))
        .every((call) => call.options.bypassSources === true),
    );
    const account = f.store.state.accounts[0];
    assert.equal(account.kind, 'authlib');
    assert.equal(account.profileId, player.id);
    const publicState = JSON.stringify(f.store.state);
    assert.doesNotMatch(
      publicState,
      /private-password|initial-secret|refreshed-secret|client-secret|user@example/,
    );
    const secret = f.saved.get(accountSecretKey(account.id))!;
    assert.match(secret, /refreshed-secret/);
    assert.doesNotMatch(secret, /private-password/);
    const authenticate = f.calls.find((call) => call.url.endsWith('/authenticate'))!;
    assert.equal(authenticate.options.body.password, 'private-password');
    assert.equal(authenticate.options.redirects, false);
    await f.auth.login(
      'https://another.example.org/api/',
      'user@example.org',
      'private-password',
      async () => player,
      signal(),
    );
    assert.equal(f.store.state.accounts.length, 2);
    assert.notEqual(f.store.state.accounts[0].id, f.store.state.accounts[1].id);
  } finally {
    await f.close();
  }
});
test('external tokens validate first, refresh once concurrently, and reject a different profile', async () => {
  const f = await fixture();
  try {
    await f.auth.login(
      'https://example.org/api/',
      'user',
      'password',
      async () => player,
      signal(),
    );
    const account = f.store.state.accounts[0];
    f.calls.length = 0;
    assert.deepEqual(await Promise.all([f.auth.token(account), f.auth.token(account)]), [
      'refreshed-secret',
      'refreshed-secret',
    ]);
    assert.equal(f.calls.filter((call) => call.url.endsWith('/refresh')).length, 1);
    f.setValid(true);
    f.calls.length = 0;
    await f.auth.token(account);
    assert.equal(f.calls.filter((call) => call.url.endsWith('/refresh')).length, 0);
    f.setValid(false);
    f.setWrong();
    await assert.rejects(f.auth.token(account), /profile changed/);
  } finally {
    await f.close();
  }
});
test('external login persistence failure rolls back credentials and agent arguments verify downloads', async () => {
  const f = await fixture();
  try {
    const original = f.store.save.bind(f.store);
    f.store.save = async () => {
      throw new Error('disk full');
    };
    await assert.rejects(
      f.auth.login('https://example.org/api/', 'user', 'password', async () => player, signal()),
      /disk full/,
    );
    assert.equal(f.saved.size, 0);
    assert.equal(f.store.state.accounts.length, 0);
    f.store.save = original;
    await f.auth.login(
      'https://example.org/api/',
      'user',
      'password',
      async () => player,
      signal(),
    );
    const args = await f.auth.launchArguments(f.store.state.accounts[0], signal());
    assert.match(args[0], /^-javaagent:.*authlib-injector-1\.jar=https:\/\/example\.org\/api\/$/);
    assert.match(args[1], /^-Dauthlibinjector.yggdrasil.prefetched=/);
    assert.doesNotMatch(args.join(' '), /refreshed-secret|password/);
  } finally {
    await f.close();
  }
});
