import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { t, setLanguage } from '../src/config';
import { toTraditional } from '../src/traditional';
import manifest from '../package.json';

test('extension language follows VS Code by default and manual choices override it', () => {
  const setting = manifest.contributes.configuration
    .flatMap((group) => Object.entries(group.properties))
    .find(([key]) => key === 'minecraftWorkbench.language');
  assert.equal((setting?.[1] as { default: string }).default, 'auto');
  assert.deepEqual((setting?.[1] as { enum: string[] }).enum, ['en', 'zh-cn', 'zh-tw', 'auto']);
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
    env.language = 'zh-TW';
    assert.equal(t('Software', '软件'), '軟體');
    env.language = 'en';
    assert.equal(t('English', '中文'), 'English');
    preference = 'en';
    env.language = 'zh-CN';
    assert.equal(t('English', '中文'), 'English');
    preference = 'zh-cn';
    env.language = 'en';
    assert.equal(t('English', '中文'), '中文');
    preference = 'zh-tw';
    assert.equal(t('Software', '软件'), '軟體');
    preference = 'auto';
    assert.equal(t('English', '中文'), 'English');
  } finally {
    workspace.getConfiguration = original;
    env.language = originalLanguage;
  }
});

test('Traditional Chinese conversion keeps Latin text and applies Taiwan wording', () => {
  assert.equal(toTraditional('Minecraft 实例'), 'Minecraft 實例');
  assert.equal(toTraditional('打开文件夹'), '開啟資料夾');
  assert.equal(toTraditional('https://example.com/path'), 'https://example.com/path');
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
    assert.equal(t('Software', '软件'), '軟體');
    for (const invalid of ['unknown', ['en'], {}, true, undefined, null])
      await assert.rejects(setLanguage(invalid), /Invalid language/);
    assert.equal(globalValue, 'zh-tw');
  } finally {
    workspace.getConfiguration = original;
  }
});
