import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgeMaven, neoForgePrefix } from '../src/versions';
import { Minecraft } from '../src/minecraft';
import { Network, HttpError } from '../src/network';
import { Store } from '../src/store';
import { Java } from '../src/java';
import { Accounts } from '../src/accounts';
import { Jobs } from '../src/jobs';
import { gameVersionCategory } from '../src/game-versions';
test('NeoForge version discovery supports legacy and year-based Minecraft versions', () => {
  assert.equal(neoForgePrefix('1.21.1'), '21.1.');
  assert.equal(neoForgePrefix('1.21'), '21.0.');
  assert.equal(neoForgePrefix('26.1'), '26.1.0.');
  assert.equal(neoForgePrefix('26.1.1'), '26.1.1.');
  assert.equal(neoForgePrefix('26.3'), '26.3.0.');
  assert.equal(neoForgePrefix('26w01a'), undefined);
});
test('April Fools classification recognizes special IDs without classifying ordinary April 1 releases', () => {
  for (const id of [
    '15w14a',
    '1.RV-Pre1',
    '3D Shareware v1.34',
    '20w14infinite',
    '22w13oneblockatatime',
    '23w13a_or_b',
    '24w14potato',
    '25w14craftmine',
    '26w14a',
  ])
    assert.equal(gameVersionCategory({ id, type: 'snapshot' }), 'april_fools');
  assert.equal(gameVersionCategory({ id: '26.1.1', type: 'release' }), 'release');
  assert.equal(gameVersionCategory({ id: '26.4-snapshot-5', type: 'snapshot' }), 'snapshot');
});

test('NeoForge uses Maven metadata for mirror-compatible discovery, including its 1.20.1 artifact', async () => {
  const requested: string[] = [];
  const minecraft = new Minecraft(
    {} as Store,
    {
      text: async (url: string) => {
        requested.push(url);
        const versions = url.includes('/neoforge/')
          ? ['21.1.9', '21.1.250', '21.0.1']
          : ['1.20.1-47.1.106'];
        return (
          '<metadata><versioning><versions>' +
          versions.map((v) => `<version>${v}</version>`).join('') +
          '</versions></versioning></metadata>'
        );
      },
    } as Network,
    {} as Java,
    {} as Accounts,
    {} as Jobs,
    () => {},
  );
  assert.deepEqual(await minecraft.loaders('neoforge', '1.21.1'), ['21.1.250', '21.1.9']);
  assert.deepEqual(await minecraft.loaders('neoforge', '1.20.1'), ['47.1.106']);
  assert.ok(requested.every((url) => url.endsWith('/maven-metadata.xml')));
  assert.equal(forgeMaven('neoforge', '1.20.1').name, 'forge');
});
test('unsupported Fabric and Quilt versions return no loaders while server failures remain visible', async () => {
  for (const status of [400, 404, 500]) {
    const network = {
      json: async () => {
        throw new HttpError(status, 'metadata');
      },
    } as unknown as Network;
    const minecraft = new Minecraft(
      {} as Store,
      network,
      {} as Java,
      {} as Accounts,
      {} as Jobs,
      () => {},
    );
    for (const loader of ['fabric', 'quilt'] as const) {
      if (status === 500) await assert.rejects(minecraft.loaders(loader, 'a1.2.6'), /HTTP 500/);
      else assert.deepEqual(await minecraft.loaders(loader, 'a1.2.6'), []);
    }
  }
});
