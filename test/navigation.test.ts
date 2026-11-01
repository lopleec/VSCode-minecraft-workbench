import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managementPagesFor, resolvePage, defaultPage, pageMode } from '../src/navigation';
import type { Mode } from '../src/models';
import { requestParameters } from '../src/webview/protocol';

for (const mode of ['launcher', 'developer', 'server'] as Mode[]) {
  test(`${mode} management excludes project creation and other modes' pages`, () => {
    const pages = managementPagesFor(mode, true);
    assert.ok(!pages.includes('projects'));
    assert.ok(pages.includes('downloads') && pages.includes('java') && pages.includes('settings'));
    for (const page of pages) assert.equal(resolvePage(page, mode, true), page);
    if (mode !== 'launcher')
      for (const page of ['accounts', 'backups', 'multiplayer']) {
        assert.ok(!pages.includes(page as never));
        assert.equal(resolvePage(page, mode, true), defaultPage(mode));
      }
    for (const [page, owner] of [
      ['projects', 'developer'],
      ['servers', 'server'],
      ['instances', 'launcher'],
    ] as const) {
      assert.equal(pageMode(page), owner);
      assert.equal(resolvePage(page, mode, true), mode === owner ? page : defaultPage(mode));
    }
  });
}

test('closing Beta hides its management entry and redirects an already open page to Settings', () => {
  assert.ok(managementPagesFor('launcher', true).includes('multiplayer'));
  assert.ok(!managementPagesFor('launcher', false).includes('multiplayer'));
  assert.equal(resolvePage('multiplayer', 'launcher', false), 'settings');
  assert.equal(resolvePage('projects', 'launcher'), 'instances');
  assert.equal(resolvePage('discover', 'developer'), 'projects');
  assert.equal(resolvePage('unknown', 'server'), 'servers');
});

test('webview requests attach only the active target and explicit IDs override defaults', () => {
  const state = { mode: 'server' as const, selectedInstance: 'client', selectedServer: 'server' };
  assert.deepEqual(requestParameters(state, 'plugin'), { serverId: 'server', kind: 'plugin' });
  assert.deepEqual(requestParameters({ ...state, mode: 'launcher' }, 'mod'), {
    instanceId: 'client',
    kind: 'mod',
  });
  assert.deepEqual(requestParameters({ ...state, mode: 'developer' }, 'mod'), { kind: 'mod' });
  assert.deepEqual(requestParameters(state, 'mod', { instanceId: 'other' }), {
    instanceId: 'other',
    kind: 'mod',
  });
  assert.deepEqual(
    requestParameters({ ...state, mode: 'launcher' }, 'plugin', { serverId: 'other' }),
    { serverId: 'other', kind: 'plugin' },
  );
});
