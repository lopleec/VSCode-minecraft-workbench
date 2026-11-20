import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { t, setLanguage } from '../src/config';
import manifest from '../package.json';

test('extension language follows VS Code by default and manual choices override it', () => {
  const setting = manifest.contributes.configuration
    .flatMap((group) => Object.entries(group.properties))
    .find(([key]) => key === 'minecraftWorkbench.language');
  assert.equal((setting?.[1] as { default: string }).default, 'auto');
  const env = vscode.env as { language: string };
  const workspace = vscode.workspace as { getConfiguration: unknown };
  const original = workspace.getConfiguration,
    originalLanguage = env.language;
  let preference: string | undefined;
  workspace.getConfiguration = () => ({
    get: (_key: string, fallback: string) => preference ?? fallback,
  });
  try {
    env.language = 'zh-CN';
    assert.equal(t('English', '中文'), '中文');
    env.language = 'en';
    assert.equal(t('English', '中文'), 'English');
    preference = 'en';
    env.language = 'zh-CN';
    assert.equal(t('English', '中文'), 'English');
    preference = 'zh-cn';
    env.language = 'en';
    assert.equal(t('English', '中文'), '中文');
    preference = 'auto';
    assert.equal(t('English', '中文'), 'English');
    for (const locale of ['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW']) {
      env.language = locale;
      assert.equal(t('English', '简体中文', '繁體中文'), '繁體中文');
      assert.equal(t('English', '中文'), '中文');
    }
    for (const locale of ['zh-CN', 'zh-SG', 'zh-Hans', 'zh']) {
      env.language = locale;
      assert.equal(t('English', '简体中文', '繁體中文'), '简体中文');
    }
    preference = 'zh-tw';
    env.language = 'en';
    assert.equal(t('English', '简体中文', '繁體中文'), '繁體中文');
    preference = 'zh-cn';
    env.language = 'zh-TW';
    assert.equal(t('English', '简体中文', '繁體中文'), '简体中文');
    preference = 'en';
    assert.equal(t('English', '简体中文', '繁體中文'), 'English');
  } finally {
    workspace.getConfiguration = original;
    env.language = originalLanguage;
  }
});

test('a language change is global, clears an overriding workspace value and rejects unknown choices', async () => {
  const workspace = vscode.workspace as { getConfiguration: unknown };
  const original = workspace.getConfiguration;
  let globalValue = 'auto',
    workspaceValue: string | undefined = 'zh-cn';
  workspace.getConfiguration = () => ({
    get: () => workspaceValue ?? globalValue,
    inspect: () => ({ workspaceValue }),
    update: async (_key: string, value: string | undefined, target: vscode.ConfigurationTarget) => {
      if (target === vscode.ConfigurationTarget.Global) globalValue = value!;
      else {
        assert.equal(target, vscode.ConfigurationTarget.Workspace);
        workspaceValue = value;
      }
    },
  });
  try {
    await setLanguage('en');
    assert.equal(globalValue, 'en');
    assert.equal(workspaceValue, undefined);
    assert.equal(t('English', '中文'), 'English');
    await setLanguage('zh-cn');
    assert.equal(t('English', '中文'), '中文');
    await setLanguage('zh-tw');
    assert.equal(t('English', '简体中文', '繁體中文'), '繁體中文');
    for (const invalid of ['unknown', ['en'], {}, true, undefined, null])
      await assert.rejects(setLanguage(invalid), /Invalid language/);
    assert.equal(globalValue, 'zh-tw');
  } finally {
    workspace.getConfiguration = original;
  }
});
