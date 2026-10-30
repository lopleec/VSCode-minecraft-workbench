import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Java, preferredJava } from '../src/java';
import { Store } from '../src/store';
import { UI } from '../src/ui';
import { Instance } from '../src/models';

test('Java preference uses instance, then global, then automatic; explicit runtimes bypass preparation', async () => {
  const config = vscode.workspace.getConfiguration;
  vscode.workspace.getConfiguration = (() => ({
    get: (key: string, fallback: unknown) => (key === 'javaPath' ? '/global/java' : fallback),
  })) as typeof config;
  try {
    assert.equal(preferredJava('/instance/java'), '/instance/java');
    assert.equal(preferredJava('  /instance/java  '), '/instance/java');
    assert.equal(preferredJava(''), '/global/java');
    assert.equal(preferredJava(undefined, ''), undefined);
    const java = new Java({} as Store, {} as never);
    let selected: string | undefined;
    java.select = async (_major, preferred) => {
      selected = preferred;
      return { path: preferred!, version: '21.0.1', major: 21, architecture: 'test' };
    };
    await java.ensure(21, new AbortController().signal, () => {}, preferredJava('/instance/java'));
    assert.equal(selected, '/instance/java');
  } finally {
    vscode.workspace.getConfiguration = config;
  }
});

test('saving other instance settings retains an explicit Java override; empty clears only that override', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-java-priority-'));
  const store = new Store(root, () => {});
  const instance: Instance = {
    id: 'x',
    name: 'Game',
    minecraft: '1.21.1',
    loader: 'vanilla',
    directory: path.join(root, 'game'),
    java: '/instance/java',
    jvmArgs: ['-Dkeep=true'],
    createdAt: '',
  };
  store.state.instances.push(instance);
  const ui = Object.create(UI.prototype) as UI;
  Object.assign(ui, {
    store,
    minecraft: { assertIdle: () => {} },
    content: { isBusy: () => false },
  });
  try {
    await ui.saveInstance(instance, { name: 'Renamed' });
    assert.equal(instance.java, '/instance/java');
    assert.deepEqual(instance.jvmArgs, ['-Dkeep=true']);
    await ui.saveInstance(instance, { java: '' });
    assert.equal(instance.java, undefined);
    assert.equal(instance.name, 'Renamed');
  } finally {
    store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
