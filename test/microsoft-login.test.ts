import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { Accounts } from '../src/accounts';
import { Store } from '../src/store';
import { HttpError } from '../src/network';
import { microsoftSignInError } from '../src/microsoft-login';
import { LauncherActions } from '../src/launcher-actions';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture(response?: (url: string) => unknown) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-device-login-'));
  const store = new Store(root, () => {});
  const values = new Map<string, string>();
  const secrets = {
    get: async (k: string) => values.get(k),
    store: async (k: string, v: string) => values.set(k, v),
    delete: async (k: string) => values.delete(k),
  };
  const original = { clipboard: vscode.env.clipboard, openExternal: vscode.env.openExternal };
  const opened: string[] = [];
  Object.assign(vscode.env, {
    clipboard: { writeText: async () => {} },
    openExternal: async (uri: vscode.Uri) => {
      opened.push(uri.toString());
      return true;
    },
  });
  const settings = mock.method(vscode.workspace, 'getConfiguration', () => ({
    get: (key: string, fallback: unknown) =>
      key === 'microsoftClientId' ? '00000000-0000-0000-0000-000000000001' : fallback,
  }));
  const calls: string[] = [];
  const net = {
    json: async (url: string) => {
      calls.push(url);
      const override = response?.(url);
      if (override !== undefined) return override;
      if (url.endsWith('/devicecode'))
        return {
          device_code: 'private-device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://microsoft.com/devicelogin',
          interval: 5,
          expires_in: 900,
        };
      if (url.endsWith('/token'))
        return { access_token: 'private-ms', refresh_token: 'private-refresh' };
      if (url.includes('user.auth')) return { Token: 'private-xbox' };
      if (url.includes('xsts.auth'))
        return { Token: 'private-xsts', DisplayClaims: { xui: [{ uhs: 'hash' }] } };
      if (url.includes('login_with_xbox'))
        return { access_token: 'private-minecraft', expires_in: 86400 };
      if (url.endsWith('/profile')) return { id: 'player', name: 'Player' };
      throw new Error('Unexpected endpoint');
    },
  };
  const phases: string[] = [];
  const accounts = new Accounts(
    store,
    secrets as never,
    net as never,
    () => false,
    () => phases.push(accounts.signInStatus!.phase),
  );
  return {
    store,
    accounts,
    values,
    opened,
    calls,
    phases,
    async close() {
      accounts.dispose();
      store.dispose();
      settings.mock.restore();
      Object.assign(vscode.env, original);
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('device authorization shows ephemeral progress, polls, completes and keeps codes out of logs and persisted state', async (ctx) => {
  ctx.mock.timers.enable({ apis: ['setTimeout'] });
  let polls = 0;
  const f = await fixture((url) => {
    if (url.endsWith('/token') && ++polls === 1)
      throw new HttpError(400, '{"error":"authorization_pending"}');
  });
  const reports: string[] = [];
  try {
    const login = f.accounts.login(new AbortController().signal, (message, english) =>
      reports.push(message, english || ''),
    );
    await flush();
    assert.equal(f.accounts.signInStatus?.phase, 'waiting');
    assert.equal(f.accounts.signInStatus?.code, 'ABCD-EFGH');
    assert.deepEqual(f.opened, ['https://microsoft.com/devicelogin']);
    await assert.rejects(
      f.accounts.login(new AbortController().signal, () => {}),
      /already in progress/,
    );
    ctx.mock.timers.tick(5000);
    await flush();
    assert.equal(polls, 1);
    ctx.mock.timers.tick(5000);
    await login;
    assert.deepEqual(f.phases, ['requesting', 'waiting', 'exchanging', 'done']);
    assert.deepEqual(f.accounts.signInStatus, { phase: 'done' });
    assert.equal(f.store.state.accounts[0].kind, 'microsoft');
    assert.ok([...f.values.values()].some((value) => value.includes('private-refresh')));
    const publicData = JSON.stringify({
      state: f.store.state,
      reports,
      status: f.accounts.signInStatus,
    });
    for (const secret of [
      'private-device-code',
      'ABCD-EFGH',
      'private-refresh',
      'private-minecraft',
    ])
      assert.ok(!publicData.includes(secret));
  } finally {
    await f.close();
  }
});

test('cancelling device sign-in clears its code and permits retry without storing credentials', async () => {
  const f = await fixture();
  try {
    const login = f.accounts.login(new AbortController().signal, () => {});
    const cancelled = assert.rejects(login, { name: 'AbortError' });
    await flush();
    f.accounts.cancelSignIn();
    await cancelled;
    assert.deepEqual(f.accounts.signInStatus, { phase: 'cancelled', error: undefined });
    assert.equal(f.values.size, 0);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      f.accounts.login(controller.signal, () => {}),
      { name: 'AbortError' },
    );
    assert.equal(f.accounts.signInStatus?.phase, 'cancelled');
  } finally {
    await f.close();
  }
});

test('unapproved applications and untrusted authorization URLs fail with actionable messages and no browser navigation', async () => {
  for (const badUrl of [false, true]) {
    const f = await fixture((url) => {
      if (!url.endsWith('/devicecode')) return;
      if (!badUrl)
        throw new HttpError(
          400,
          '{"error":"unauthorized_client","error_description":"private-provider-detail"}',
        );
      return {
        device_code: 'private-device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://untrusted.example/signin',
        interval: 5,
        expires_in: 900,
      };
    });
    try {
      await assert.rejects(
        f.accounts.login(new AbortController().signal, () => {}),
        badUrl ? /Invalid Microsoft/ : /Client ID/,
      );
      assert.equal(f.opened.length, 0);
      assert.equal(f.accounts.signInStatus?.phase, 'failed');
      assert.ok(!JSON.stringify(f.accounts.signInStatus).includes('private-'));
    } finally {
      await f.close();
    }
  }
  assert.match(
    String(microsoftSignInError(new HttpError(401, '{"XErr":2148916233}'))),
    /Xbox profile/,
  );
});

test('the account page clears workspace Client ID overrides and treats cancellation as a normal result', async () => {
  const writes: unknown[] = [];
  const settings = mock.method(vscode.workspace, 'getConfiguration', () => ({
    inspect: () => ({ workspaceValue: 'old-id' }),
    update: async (...args: unknown[]) => {
      writes.push(args);
    },
  }));
  const actions = new LauncherActions(
    {} as never,
    {} as never,
    {
      accounts: { signInStatus: { phase: 'cancelled' } },
      jobs: {
        run: async () => {
          throw new DOMException('Aborted', 'AbortError');
        },
      },
    } as never,
  );
  try {
    const id = '00000000-0000-0000-0000-000000000001';
    await actions.handle('launcher.clientId', { value: id });
    assert.deepEqual(writes, [
      ['microsoftClientId', id, vscode.ConfigurationTarget.Global],
      ['microsoftClientId', undefined, vscode.ConfigurationTarget.Workspace],
    ]);
    assert.deepEqual(await actions.handle('launcher.signIn', {}), { cancelled: true });
  } finally {
    settings.mock.restore();
  }
});
