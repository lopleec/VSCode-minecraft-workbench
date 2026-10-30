import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { prepareGameLanguage, minecraftLanguage } from '../src/game-language';
import { Instance } from '../src/models';

test('game language follows the extension/VS Code without replacing a player choice', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-language-'));
  const original = vscode.workspace.getConfiguration;
  const settings: Record<string, unknown> = { language: 'zh-cn' };
  vscode.workspace.getConfiguration = (() => ({
    get: (key: string, fallback: unknown) => settings[key] ?? fallback,
  })) as typeof original;
  const instance: Instance = {
    id: 'x',
    name: 'Test',
    minecraft: '1.21.1',
    loader: 'vanilla',
    directory: root,
    createdAt: '',
  };
  try {
    await prepareGameLanguage(instance);
    assert.equal(await fs.readFile(path.join(root, 'options.txt'), 'utf8'), 'lang:zh_cn\n');
    settings.language = 'en';
    await prepareGameLanguage(instance);
    assert.equal(await fs.readFile(path.join(root, 'options.txt'), 'utf8'), 'lang:en_us\n');
    await fs.writeFile(path.join(root, 'options.txt'), 'fov:70\r\nlang:ja_jp\r\n');
    settings.language = 'zh-cn';
    await prepareGameLanguage(instance);
    assert.equal(
      await fs.readFile(path.join(root, 'options.txt'), 'utf8'),
      'fov:70\r\nlang:ja_jp\r\n',
    );
    instance.gameLanguage = 'zh_tw';
    await prepareGameLanguage(instance);
    assert.equal(
      await fs.readFile(path.join(root, 'options.txt'), 'utf8'),
      'fov:70\r\nlang:zh_tw\r\n',
    );
    instance.gameLanguage = 'preserve';
    settings.language = 'en';
    await prepareGameLanguage(instance);
    assert.match(await fs.readFile(path.join(root, 'options.txt'), 'utf8'), /lang:zh_tw/);
    assert.equal(minecraftLanguage('zh-TW'), 'zh_tw');
    assert.equal(minecraftLanguage('pt-BR'), 'pt_br');
    assert.equal(minecraftLanguage('en'), 'en_us');
    instance.gameLanguage = 'en_us';
    instance.minecraft = '1.10.2';
    await prepareGameLanguage(instance);
    assert.match(await fs.readFile(path.join(root, 'options.txt'), 'utf8'), /lang:en_US/);
  } finally {
    vscode.workspace.getConfiguration = original;
    await fs.rm(root, { recursive: true, force: true });
  }
});
