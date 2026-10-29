import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { settingsAction } from '../src/settings-actions';

test('settings updates reject malformed nested values before writing configuration', async () => {
  const writes: unknown[] = [];
  const config = mock.method(vscode.workspace, 'getConfiguration', () => ({
    get: (_key: string, fallback: unknown) => fallback,
    update: async (...args: unknown[]) => {
      writes.push(args);
    },
  }));
  try {
    for (const [key, value] of [
      ['jvmArgs', ['-Dtest=true', 123]],
      ['gameArgs', [{ option: '--demo' }]],
      ['javaPath', 'java\0invalid'],
      ['memoryPercentage', NaN],
      ['debugPort', 5005.5],
      ['minMemory', 128.5],
      ['sources', { unknown: 'official' }],
      ['sources', null],
      ['sources', { client: 123 }],
    ])
      await assert.rejects(settingsAction('settings.update', { key, value }));
    assert.deepEqual(writes, []);
    await assert.rejects(settingsAction('settings.unknown', { key: 'gc', value: 'g1' }));
    await settingsAction('settings.update', { key: 'jvmArgs', value: ['-Dtest=true'] });
    await settingsAction('settings.update', {
      key: 'sources',
      value: { client: 'https://mirror.example.test' },
    });
    assert.equal(writes.length, 2);
  } finally {
    config.mock.restore();
  }
});

test('settings reads redact nested source credentials without changing stored settings', async () => {
  const sources = {
    client: 'https://user:secret@mirror.example.test/client',
    java: 'https://token@mirror.example.test/java',
    assets: 'https://user:secret pass@mirror.example.test/assets',
  };
  const config = mock.method(vscode.workspace, 'getConfiguration', () => ({
    get: (key: string, fallback: unknown) => (key === 'sources' ? sources : fallback),
  }));
  try {
    const result = (await settingsAction('settings.read', {})) as Record<
      string,
      { value: unknown }
    >;
    assert.deepEqual(result.sources.value, {
      client: 'https://[redacted]@mirror.example.test/client',
      java: 'https://[redacted]@mirror.example.test/java',
      assets: 'https://[redacted]@mirror.example.test/assets',
    });
    assert.equal(sources.client, 'https://user:secret@mirror.example.test/client');
  } finally {
    config.mock.restore();
  }
});

test('MCP language changes clear a conflicting workspace override', async () => {
  let globalValue = 'auto';
  let workspaceValue: string | undefined = 'zh-cn';
  const config = mock.method(vscode.workspace, 'getConfiguration', () => ({
    get: () => workspaceValue ?? globalValue,
    inspect: () => ({ workspaceValue }),
    update: async (_key: string, value: string | undefined, target: vscode.ConfigurationTarget) => {
      if (target === vscode.ConfigurationTarget.Global) globalValue = value!;
      else workspaceValue = value;
    },
  }));
  try {
    await settingsAction('settings.update', { key: 'language', value: 'en' });
    assert.equal(globalValue, 'en');
    assert.equal(workspaceValue, undefined);
  } finally {
    config.mock.restore();
  }
});
