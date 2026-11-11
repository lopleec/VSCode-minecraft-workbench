import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Store } from '../src/store';
import { Minecraft } from '../src/minecraft';
import { manageInstances } from '../src/instance-actions';
import { instanceGroup, instanceGroups } from '../src/instance-groups';
import { LauncherActions } from '../src/launcher-actions';
import type { Instance } from '../src/models';

const vscode = require('vscode');
const jobs = {
  run: async (_name: unknown, work: Function) => work(new AbortController().signal, () => {}),
};
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-instance-groups-'));
  const store = new Store(root, () => {});
  store.state.instances = ['one', 'two', 'linked'].map(
    (id) =>
      ({
        id,
        name: id,
        directory: path.join(root, id),
        minecraft: '1.20.1',
        loader: 'fabric',
        createdAt: '',
        linked: id === 'linked',
      }) as Instance,
  );
  for (const instance of store.state.instances) {
    await fs.mkdir(instance.directory);
    await fs.writeFile(path.join(instance.directory, 'world.txt'), 'keep');
  }
  return {
    store,
    root,
    close: async () => {
      store.dispose();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('group assignment persists without changing game files and renaming merges groups', async () => {
  const f = await fixture();
  const engine = {} as Minecraft;
  const actions = new LauncherActions(f.store, engine, { jobs } as never);
  try {
    await manageInstances(f.store, engine, jobs as never, {
      ids: ['one', 'two'],
      action: 'group',
      group: 'Survival',
    });
    await manageInstances(f.store, engine, jobs as never, {
      ids: ['linked'],
      action: 'group',
      group: 'Modpacks',
    });
    assert.deepEqual(instanceGroups(f.store.state.instances), ['Modpacks', 'Survival']);
    await actions.handle('launcher.renameGroup', { group: 'Survival', name: 'Modpacks' });
    assert.ok(f.store.state.instances.every((instance) => instance.group === 'Modpacks'));
    assert.ok(
      JSON.parse(await fs.readFile(path.join(f.root, 'state.json'), 'utf8')).instances.every(
        (instance: Instance) => instance.group === 'Modpacks',
      ),
    );
    for (const instance of f.store.state.instances)
      assert.equal(await fs.readFile(path.join(instance.directory, 'world.txt'), 'utf8'), 'keep');
    await manageInstances(f.store, engine, jobs as never, {
      ids: ['one', 'two', 'linked'],
      action: 'group',
      group: '',
    });
    assert.deepEqual(instanceGroups(f.store.state.instances), []);
    await assert.rejects(
      manageInstances(f.store, engine, jobs as never, {
        ids: ['unknown'],
        action: 'group',
        group: 'A',
      }),
      /not found/,
    );
    assert.throws(() => instanceGroup('bad\nname'));
  } finally {
    await f.close();
  }
});

test('failed group persistence restores the previous group for all selected instances', async () => {
  const f = await fixture();
  const save = mock.method(f.store, 'save', async () => {
    throw new Error('write failed');
  });
  try {
    await assert.rejects(
      manageInstances(f.store, {} as never, jobs as never, {
        ids: ['one', 'two'],
        action: 'group',
        group: 'A',
      }),
      /write failed/,
    );
    assert.ok(f.store.state.instances.every((instance) => instance.group === undefined));
  } finally {
    save.mock.restore();
    await f.close();
  }
});

test('bulk removal confirms once, keeps linked files and rejects running instances before prompting', async () => {
  const f = await fixture();
  const engine = new Minecraft(
    f.store,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    () => {},
  );
  vscode.window.showWarningMessage ||= async () => {};
  vscode.workspace.fs ||= {};
  vscode.workspace.fs.delete ||= async () => {};
  const confirm = mock.method(vscode.window, 'showWarningMessage', async () => undefined);
  const remove = mock.method(
    vscode.workspace.fs,
    'delete',
    async (uri: { fsPath: string }, options: { useTrash: boolean }) => {
      assert.equal(options.useTrash, true);
      await fs.rm(uri.fsPath, { recursive: true });
    },
  );
  try {
    const request = { ids: ['one', 'two', 'linked'], action: 'remove' };
    await manageInstances(f.store, engine, jobs as never, request);
    assert.equal(f.store.state.instances.length, 3);
    assert.equal(remove.mock.callCount(), 0);
    engine.running.set('two', {} as never);
    await assert.rejects(
      manageInstances(f.store, engine, jobs as never, request),
      /Stop this instance/,
    );
    assert.equal(confirm.mock.callCount(), 1);
    engine.running.clear();
    confirm.mock.mockImplementation(async (...args: unknown[]) => args[2]);
    const result = await manageInstances(f.store, engine, jobs as never, request);
    assert.equal(result.changed, 3);
    assert.deepEqual(f.store.state.instances, []);
    assert.equal(remove.mock.callCount(), 2);
    assert.equal(await fs.readFile(path.join(f.root, 'linked', 'world.txt'), 'utf8'), 'keep');
  } finally {
    confirm.mock.restore();
    remove.mock.restore();
    await f.close();
  }
});

test('bulk repair reports per-instance failures without skipping other selected instances', async () => {
  const f = await fixture();
  const visited: string[] = [];
  try {
    const result = await manageInstances(
      f.store,
      {
        install: async (instance: Instance) => {
          visited.push(instance.id);
          if (instance.id === 'two') throw new Error('busy');
        },
      } as never,
      jobs as never,
      { ids: ['one', 'two', 'linked'], action: 'repair' },
    );
    assert.equal(result.changed, 2);
    assert.equal(result.failed[0].id, 'two');
    assert.deepEqual(visited, ['one', 'two', 'linked']);
  } finally {
    await f.close();
  }
});
