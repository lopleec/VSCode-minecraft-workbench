import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as VSCode from 'vscode';
import { Store } from '../src/store';
import type { Item, View } from '../src/views';

const vscode = require('vscode');
class Emitter {
  listeners = new Set<(item?: Item) => void>();
  event = (listener: (item?: Item) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(item?: Item) {
    for (const listener of this.listeners) listener(item);
  }
  dispose() {
    this.listeners.clear();
  }
}

function fixture() {
  const trees = new Map<
    string,
    { provider: VSCode.TreeDataProvider<Item>; tree: VSCode.TreeView<Item> }
  >();
  mock.method(vscode.window, 'createTreeView', (id: string, options: any) => {
    const tree = { dispose() {} } as VSCode.TreeView<Item>;
    trees.set(id, { provider: options.treeDataProvider, tree });
    return tree;
  });
  return trees;
}

Object.assign(vscode, { EventEmitter: Emitter });
vscode.window.createTreeView = () => {};

test('all native sidebar providers register before activation performs asynchronous IO', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-sidebar-'));
  const subscriptions: VSCode.Disposable[] = [];
  const trees = fixture();
  const failures: string[] = [];
  let release!: () => void;
  const loading = new Promise<void>((resolve) => (release = resolve));
  mock.method(Store.prototype, 'load', async () => {
    assert.equal(trees.size, 8);
    await loading;
    throw new Error('State read failed');
  });
  Object.assign(vscode.window, {
    createOutputChannel: () => ({
      info() {},
      error: (value: string) => failures.push(value),
      dispose() {},
    }),
    createStatusBarItem: () => ({ dispose() {} }),
    showErrorMessage: async () => {},
  });
  vscode.StatusBarAlignment = { Left: 1 };
  try {
    const { activate } = await import('../src/extension');
    const activation = activate({
      subscriptions,
      globalStorageUri: vscode.Uri.file(root),
      globalState: { get: () => undefined },
    } as never);
    assert.equal(trees.size, 8, 'Registration is synchronous, before the first await');
    const home = trees.get('minecraftWorkbench.home')!;
    let settled = false;
    const children = Promise.resolve(home.provider.getChildren()).then((items) => {
      settled = true;
      return items;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, 'A slow startup waits instead of exposing empty actions');
    release();
    await activation;
    assert.deepEqual(await children, []);
    assert.match(home.tree.message as string, /Could not read instance data/);
    assert.ok(failures.some((message) => message.includes('State read failed')));
  } finally {
    release();
    for (const subscription of subscriptions.reverse()) subscription.dispose();
    mock.restoreAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('pending sidebar requests receive real data and refreshes when initialization completes', async () => {
  const trees = fixture();
  const { Sidebar } = await import('../src/sidebar');
  const sidebar = new Sidebar();
  const changed = new Emitter();
  let notifications = 0;
  try {
    const home = trees.get('minecraftWorkbench.home')!.provider;
    home.onDidChangeTreeData!(() => notifications++);
    const pending = home.getChildren();
    const item = { label: 'Ready' } as Item;
    sidebar.initialize(
      () =>
        ({
          getChildren: async () => [item],
          onDidChangeTreeData: changed.event,
          refresh: () => changed.fire(),
          dispose() {},
        }) as View,
    );
    assert.deepEqual(await pending, [item]);
    assert.equal(home.getTreeItem(item), item);
    sidebar.refresh();
    assert.ok(notifications > 0);
    assert.equal(trees.size, 8, 'Refresh keeps the existing native views');
  } finally {
    sidebar.dispose();
    mock.restoreAll();
  }
});

test('disposing a pending sidebar releases native loading requests', async () => {
  const trees = fixture();
  const { Sidebar } = await import('../src/sidebar');
  const sidebar = new Sidebar();
  try {
    const pending = trees.get('minecraftWorkbench.home')!.provider.getChildren();
    sidebar.dispose();
    assert.deepEqual(await pending, []);
  } finally {
    mock.restoreAll();
  }
});
