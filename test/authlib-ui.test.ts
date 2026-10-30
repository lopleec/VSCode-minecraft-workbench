import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as VSCode from 'vscode';
import { UI } from '../src/ui';
import { LauncherActions } from '../src/launcher-actions';
const vscode = require('vscode') as typeof VSCode;

async function fixture(
  locale = 'en',
  confirmed = false,
  inputs: (string | undefined)[] = ['user', 'password'],
) {
  const original = { window: vscode.window, env: vscode.env, workspace: vscode.workspace };
  const warnings: { message: string; options: VSCode.MessageOptions }[] = [];
  const prompts: VSCode.InputBoxOptions[] = [];
  const calls: unknown[][] = [];
  const events: string[] = [];
  const retries: (() => Promise<unknown>)[] = [];
  Object.assign(vscode, {
    workspace: {
      ...vscode.workspace,
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
    },
    env: { ...vscode.env, language: locale },
    window: {
      showWarningMessage: async (
        message: string,
        options: VSCode.MessageOptions,
        label: string,
      ) => {
        events.push('warning');
        warnings.push({ message, options });
        return confirmed ? label : undefined;
      },
      showInputBox: async (options: VSCode.InputBoxOptions) => {
        events.push(options.password ? 'password' : 'account');
        prompts.push(options);
        return inputs.shift();
      },
    },
  });
  const ui = Object.create(UI.prototype) as UI;
  Object.assign(ui, {
    jobs: {
      run: async (
        _label: string,
        work: (signal: AbortSignal) => Promise<unknown>,
        retry?: () => Promise<unknown>,
      ) => {
        if (retry) retries.push(retry);
        return work(new AbortController().signal);
      },
    },
    accounts: {
      authlib: {
        discover: async () => {
          events.push('discover');
          return { url: 'https://auth.example.net/api/yggdrasil/', name: 'Microsoft' };
        },
        login: async (...args: unknown[]) => {
          events.push('login');
          calls.push(args);
        },
      },
    },
  });
  return {
    ui,
    warnings,
    prompts,
    calls,
    events,
    retries,
    decline: () => {
      confirmed = false;
    },
    restore: () => Object.assign(vscode, original),
  };
}

test('external login cancellation blocks credential prompts and MCP-style consent bypasses', async () => {
  const f = await fixture();
  try {
    const actions = new LauncherActions({} as never, {} as never, f.ui);
    const result = await actions.handle('launcher.authlibSignIn', {
      server: 'https://portal.example.org',
      confirmed: true,
      username: 'not-used',
      password: 'not-used',
    });
    assert.equal(result, false);
    assert.equal(f.prompts.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.warnings[0].options.modal, true);
    assert.match(f.warnings[0].options.detail!, /https:\/\/auth\.example\.net\/api\/yggdrasil\//);
    assert.match(f.warnings[0].options.detail!, /Microsoft|SecretStorage/);
    assert.doesNotMatch(f.warnings[0].options.detail!, /portal\.example/);
  } finally {
    f.restore();
  }
});

test('confirmed login uses the resolved host in both credential prompts and confirms first', async () => {
  const f = await fixture('en', true);
  try {
    assert.equal(await f.ui.authlibLogin('https://portal.example.org'), true);
    assert.deepEqual(f.events, ['discover', 'warning', 'account', 'password', 'login']);
    for (const prompt of f.prompts) {
      assert.match(prompt.title!, /auth\.example\.net/);
      assert.doesNotMatch(prompt.title!, /Microsoft/);
      assert.equal(prompt.prompt, 'https://auth.example.net/api/yggdrasil/');
    }
    assert.equal(f.prompts[1].password, true);
    assert.deepEqual(f.calls[0].slice(0, 3), [
      'https://auth.example.net/api/yggdrasil/',
      'user',
      'password',
    ]);
    f.decline();
    assert.equal(await f.retries[0](), false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.prompts.length, 2);
  } finally {
    f.restore();
  }
});

test('risk notice follows VS Code Chinese and cancelling either credential prompt returns false', async () => {
  for (const inputs of [[undefined], ['user', undefined]]) {
    const f = await fixture('zh-CN', true, inputs);
    try {
      assert.equal(await f.ui.authlibLogin('https://portal.example.org'), false);
      assert.match(f.warnings[0].message, /第三方认证/);
      assert.match(f.warnings[0].options.detail!, /独立密码|不保存密码/);
      assert.equal(f.calls.length, 0);
    } finally {
      f.restore();
    }
  }
});
