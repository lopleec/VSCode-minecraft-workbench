import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as VSCode from 'vscode';
const vscode = require('vscode') as typeof VSCode;
import { Store } from '../src/store';
import { showOutput } from '../src/output';

for (const mode of ['launcher', 'server', 'developer'] as const)
  test(`${mode} output offers only relevant logs and terminals`, async () => {
    const store = new Store('/unused', () => {});
    store.state.mode = mode;
    store.state.instances = [{ id: 'game', name: 'Game' } as never];
    store.state.selectedInstance = 'game';
    store.state.projects = [{ id: 'mod', name: 'Mod' } as never];
    const opened: string[] = [];
    const original = vscode.window;
    let labels: string[] = [];
    const window = {
      ...vscode.window,
      showQuickPick: async (items: { label: string }[]) => {
        labels = items.map((i) => i.label);
        return items.at(-1);
      },
      terminals: [
        { name: 'Mod: build', show: () => opened.push('gradle') },
        { name: 'bash', show: () => opened.push('unrelated') },
      ],
    };
    Object.assign(vscode, { window });
    try {
      await showOutput(
        store,
        { output: { show: () => opened.push('workbench') } } as never,
        {
          logs: async () => {
            opened.push('game');
          },
        } as never,
        {
          selected: { id: 'server', name: 'Server' },
          showLog: () => opened.push('server'),
        } as never,
      );
      assert.equal(labels.length, 2);
      assert.equal(labels[0], 'Minecraft Workbench');
      assert.deepEqual(opened, [
        mode === 'launcher' ? 'game' : mode === 'server' ? 'server' : 'gradle',
      ]);
      assert.ok(!labels.includes('bash'));
    } finally {
      Object.assign(vscode, { window: original });
      store.dispose();
    }
  });
