import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { settingsAction } from '../src/settings-actions';
import { describeError } from '../src/errors';
import { t } from '../src/config';
import { sidebarTitles } from '../src/sidebar';
import { localize } from '../src/language';
import { UI } from '../src/ui';
import manifest from '../package.json';
import english from '../package.nls.json';
import simplified from '../package.nls.zh-cn.json';
import traditional from '../package.nls.zh-tw.json';
import legal from '../src/legal.json';
import notice from '../src/terracotta-notice.json';

test('settings, sidebar and errors follow Traditional Chinese and switching back preserves Simplified Chinese', async () => {
  let preference = 'auto';
  const environment = vscode.env as { language: string };
  const originalLanguage = environment.language;
  environment.language = 'zh-TW';
  const settings = mock.method(vscode.workspace, 'getConfiguration', () => ({
    get: (key: string, fallback: unknown) => (key === 'language' ? preference : fallback),
  }));
  try {
    const read = async () =>
      (await settingsAction('settings.read', {})) as Record<
        string,
        { label: string; description: string; enumItemLabels?: string[] }
      >;
    const result = await read();
    assert.equal(result.javaPath.label, '預設 Java 路徑');
    assert.equal(result.language.description, traditional['setting.language']);
    assert.deepEqual(result.language.enumItemLabels, [
      'English',
      '簡體中文',
      '繁體中文',
      '跟隨 VS Code',
    ]);
    assert.equal(t(...sidebarTitles.projects), '專案');
    assert.equal(describeError(new Error('Invalid Minecraft language')), 'Minecraft 語言無效');
    preference = 'zh-cn';
    assert.equal((await read()).javaPath.label, '默认 Java 路径');
    assert.equal(describeError(new Error('Invalid Minecraft language')), 'Minecraft 语言无效');
    preference = 'en';
    assert.equal((await read()).javaPath.label, english['label.javaPath']);
  } finally {
    settings.mock.restore();
    environment.language = originalLanguage;
  }
});

test('the native language picker offers and persists Traditional Chinese', async () => {
  let saved: unknown;
  const api = require('vscode') as typeof vscode;
  const originalWindow = api.window;
  Object.assign(api, {
    window: {
      ...originalWindow,
      showQuickPick: async (items: { label: string; value: string }[]) => {
        const selected = items.find((item) => item.value === 'zh-tw');
        assert.equal(selected?.label, '繁體中文');
        return selected;
      },
    },
  });
  const settings = mock.method(vscode.workspace, 'getConfiguration', () => ({
    get: (_key: string, fallback: unknown) => fallback,
    inspect: () => ({}),
    update: async (key: string, value: unknown, target: vscode.ConfigurationTarget) => {
      assert.equal(key, 'language');
      assert.equal(target, vscode.ConfigurationTarget.Global);
      saved = value;
    },
  }));
  try {
    await UI.prototype.language.call({} as UI);
    assert.equal(saved, 'zh-tw');
  } finally {
    settings.mock.restore();
    Object.assign(api, { window: originalWindow });
  }
});

test('all locale dictionaries retain the same settings keys, command links and substitution markers', () => {
  for (const dictionary of [simplified, traditional]) {
    assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(english).sort());
    for (const [key, source] of Object.entries(english)) {
      const value = dictionary[key as keyof typeof dictionary];
      assert.ok(value.trim(), key);
      assert.deepEqual(
        value.match(/command:[\w.]+|https?:\/\/[^\s)）]+|\{[^{}]+\}/g) || [],
        source.match(/command:[\w.]+|https?:\/\/[^\s)）]+|\{[^{}]+\}/g) || [],
        key,
      );
    }
  }
});

test('Traditional Chinese commands and menu entries are registered separately from the other languages', () => {
  const commands = new Map(manifest.contributes.commands.map((entry) => [entry.command, entry]));
  assert.equal(commands.size, manifest.contributes.commands.length);
  for (const [id] of commands) {
    if (id.endsWith('.zh')) assert.ok(commands.has(id.replace(/\.zh$/, '.zh-tw')), id);
  }
  for (const entries of Object.values(manifest.contributes.menus)) {
    for (const entry of entries) {
      if (entry.command.endsWith('.zh-tw')) {
        assert.ok(commands.has(entry.command), entry.command);
        assert.match(entry.when || '', /minecraftWorkbench\.language == zh-tw/);
      } else if (entry.when?.includes('minecraftWorkbench.language != zh-cn')) {
        assert.match(entry.when, /minecraftWorkbench\.language != zh-tw/);
      }
    }
  }
});

test('agreement and multiplayer notices include independently selectable Traditional Chinese text', () => {
  assert.equal(
    localize('zh-tw', legal.disclaimer.en, legal.disclaimer.zh, legal.disclaimer.zhTw),
    legal.disclaimer.zhTw,
  );
  assert.match(legal.disclaimer.zhTw, /本軟體並非 Minecraft 官方產品/);
  for (const section of legal.sections) {
    assert.ok(section.title.zhTw);
    for (const paragraph of section.paragraphs) assert.ok(paragraph.zhTw);
  }
  for (const paragraph of notice.paragraphs) assert.ok(paragraph.zhTw);
});
