import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderContentVersions } from '../src/modrinth';
import type { ModVersion, Instance } from '../src/models';
import { Workbench } from '../src/workbench';
import { Store } from '../src/store';

const target = { id: 'selected', minecraft: '1.20.1', loader: 'fabric' } as Instance;
function version(
  id: string,
  game: string,
  loader: string,
  type: ModVersion['version_type'] = 'release',
  date = '2026-01-01',
): ModVersion {
  return {
    id,
    name: id,
    project_id: 'project',
    version_number: id,
    version_type: type,
    date_published: date,
    game_versions: [game],
    loaders: [loader],
    dependencies: [],
    files: [],
  };
}

test('recommendations prefer a matching stable version, then a matching prerelease, and never apply to modpacks', () => {
  const versions = [
    version('new-game', '1.21.1', 'fabric', 'release', '2026-10-20'),
    version('beta', '1.20.1', 'fabric', 'beta', '2026-10-10'),
    version('wrong-loader', '1.20.1', 'forge', 'release', '2026-10-05'),
    version('stable', '1.20.1', 'fabric', 'release', '2026-10-01'),
  ];
  const ordered = orderContentVersions(versions, target, 'mod');
  assert.equal(ordered.recommendedId, 'stable');
  assert.equal(ordered.versions[0].id, 'stable');
  assert.equal(new Set(ordered.versions.map((v) => v.id)).size, versions.length);
  assert.equal(orderContentVersions(versions.slice(0, 3), target, 'mod').recommendedId, 'beta');
  assert.equal(orderContentVersions(versions, undefined, 'mod').recommendedId, undefined);
  assert.equal(orderContentVersions(versions, target, 'modpack').recommendedId, undefined);
  assert.equal(orderContentVersions(versions, target, 'modpack').versions[0].id, 'new-game');
});

test('version pages pin the recommendation before pagination and keep pack versions independent of the selected instance', async () => {
  const store = new Store('/unused', () => {});
  store.state.instances = [target];
  store.state.selectedInstance = target.id;
  const versions = Array.from({ length: 35 }, (_, i) => version(`other-${i}`, '1.21.1', 'forge'));
  versions.push(version('matching', '1.20.1', 'fabric'));
  const workbench = new Workbench(
    {} as never,
    store,
    { versions: async () => versions } as never,
    {} as never,
    {} as never,
    { allowsRequest: () => true } as never,
    {} as never,
  );
  try {
    const first = (await workbench.handle('versions', {
      projectId: 'project',
      kind: 'mod',
      compatible: false,
    })) as { versions: ModVersion[]; recommendedId?: string };
    const next = (await workbench.handle('versions', {
      projectId: 'project',
      kind: 'mod',
      offset: 30,
    })) as { versions: ModVersion[] };
    assert.equal(first.versions[0].id, 'matching');
    assert.equal(first.recommendedId, 'matching');
    assert.equal(new Set([...first.versions, ...next.versions].map((v) => v.id)).size, 36);
    const filtered = (await workbench.handle('versions', {
      projectId: 'project',
      kind: 'mod',
      loader: 'forge',
    })) as { recommendedId?: string };
    assert.equal(filtered.recommendedId, undefined);
    const packs = (await workbench.handle('versions', {
      projectId: 'project',
      kind: 'modpack',
      compatible: true,
    })) as { total: number; recommendedId?: string };
    assert.equal(packs.total, versions.length);
    assert.equal(packs.recommendedId, undefined);
  } finally {
    store.dispose();
  }
});
