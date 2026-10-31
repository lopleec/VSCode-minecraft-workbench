import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import type * as VSCode from 'vscode';
import { CurseForge, curseforgeManifest } from '../src/curseforge';
import { Network } from '../src/network';
import { Instance } from '../src/models';
import { hashFile, readJson } from '../src/files';
import { PackFile, repairPackFiles, savePackFiles, forgetPackFiles } from '../src/pack-files';
import manifest from '../package.json';
const vscode = require('vscode') as typeof VSCode;

async function fixture(enabled = false) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-cf-'));
  const source = path.join(root, 'selected.jar');
  await fs.writeFile(source, 'mod payload');
  const hash = await hashFile(source);
  const original = {
    getConfiguration: vscode.workspace.getConfiguration,
    window: vscode.window,
    json: Network.prototype.json,
    download: Network.prototype.download,
  };
  const state = {
    enabled,
    calls: 0,
    downloads: 0,
    secretReads: 0,
    blocked: false,
    manual: 0,
    included: true,
    key: 'fixture-api-key' as string | undefined,
  };
  vscode.workspace.getConfiguration = (() => ({
    get: (key: string, fallback: unknown) =>
      key === 'curseforge.enabled' ? state.enabled : fallback,
  })) as never;
  Object.assign(vscode, {
    window: {
      showQuickPick: async (items: string[]) =>
        state.included && items.includes('Use included files') ? 'Use included files' : items[0],
      showOpenDialog: async () => [vscode.Uri.file(source)],
    },
  });
  Network.prototype.json = async function (url, options) {
    state.calls++;
    assert.equal(
      this.options.originHeaders?.['https://api.curseforge.com']['x-api-key'],
      'fixture-api-key',
    );
    assert.equal(options?.bypassSources, true);
    assert.ok(!url.includes('fixture-api-key'));
    return (
      url.endsWith('/mods/files')
        ? {
            data: [
              {
                id: 10,
                modId: 20,
                gameId: 432,
                fileName: 'remote.jar',
                fileLength: 11,
                downloadUrl: 'https://edge.forgecdn.net/files/remote.jar',
                hashes: [{ algo: 1, value: hash }],
              },
            ],
          }
        : {
            data: [
              {
                id: 20,
                gameId: 432,
                classId: 6,
                allowModDistribution: !state.blocked,
                links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/fixture' },
              },
            ],
          }
    ) as never;
  };
  Network.prototype.download = async function (url, destination, options) {
    state.downloads++;
    assert.ok(!url.includes('fixture-api-key'));
    assert.equal(this.options.originHeaders?.[new URL(url).origin]['x-api-key'], 'fixture-api-key');
    assert.equal(options?.hash, hash);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  };
  const service = new CurseForge(
    {
      options: { proxy: '', sources: { modrinth: 'https://unused.example' }, concurrency: 2 },
    } as unknown as Network,
    {
      get: async () => {
        state.secretReads++;
        return state.key;
      },
      store: async () => {},
      delete: async () => {},
    },
    async (files) => {
      state.manual++;
      assert.ok(files.every((file) => !file.urls.length || !state.enabled));
      return [source];
    },
  );
  const archive = path.join(root, 'pack.zip');
  const instance: Instance = {
    id: 'pack',
    name: 'Pack',
    minecraft: '',
    loader: 'vanilla',
    directory: path.join(root, 'game'),
    createdAt: '',
  };
  const make = (extra: Record<string, unknown> = {}, included = true) => {
    const zip = new AdmZip();
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          manifestType: 'minecraftModpack',
          manifestVersion: 1,
          minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] },
          files: [{ projectID: 20, fileID: 10, required: true }],
          overrides: 'overrides',
          ...extra,
        }),
      ),
    );
    if (included) zip.addFile('overrides/mods/included.jar', Buffer.from('mod payload'));
    zip.addFile('overrides/config/options.json', Buffer.from('user config'));
    zip.writeZip(archive);
  };
  make();
  return {
    root,
    source,
    hash,
    state,
    service,
    archive,
    instance,
    make,
    close: async () => {
      service.dispose();
      vscode.workspace.getConfiguration = original.getConfiguration;
      Object.assign(vscode, { window: original.window });
      Network.prototype.json = original.json;
      Network.prototype.download = original.download;
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('CurseForge online access is off by default and local ZIP imports read neither API keys nor the network', async () => {
  const setting = manifest.contributes.configuration
    .flatMap((group) => Object.entries(group.properties))
    .find(([name]) => name === 'minecraftWorkbench.curseforge.enabled')![1];
  assert.equal(setting.default, false);
  const f = await fixture();
  try {
    await f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {});
    assert.equal(f.instance.minecraft, '1.20.1');
    assert.equal(f.instance.loaderVersion, '47.2.0');
    assert.equal(
      await fs.readFile(path.join(f.instance.directory, 'mods', 'included.jar'), 'utf8'),
      'mod payload',
    );
    assert.equal(f.state.calls, 0);
    assert.equal(f.state.downloads, 0);
    assert.equal(f.state.secretReads, 0);
    const records = await readJson<PackFile[]>(
      path.join(f.instance.directory, '.workbench', 'pack-files.json'),
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].source, 'local');
    await fs.rm(path.join(f.instance.directory, 'mods', 'included.jar'));
    await repairPackFiles(f.instance, {} as Network, new AbortController().signal, () => {});
    assert.equal(
      await fs.readFile(path.join(f.instance.directory, 'mods', 'included.jar'), 'utf8'),
      'mod payload',
    );
    assert.ok(!JSON.stringify(records).includes('fixture-api-key'));
  } finally {
    await f.close();
  }
});

test('manual CurseForge imports can use selected local files without enabling online access', async () => {
  const f = await fixture();
  try {
    f.make({}, false);
    await f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {});
    assert.equal(
      await fs.readFile(path.join(f.instance.directory, 'mods', 'selected.jar'), 'utf8'),
      'mod payload',
    );
    assert.equal(f.state.calls, 0);
    assert.equal(f.state.secretReads, 0);
  } finally {
    await f.close();
  }
});

test('enabled CurseForge Beta resolves pinned references and authenticates downloads without storing the key', async () => {
  const f = await fixture(true);
  try {
    f.make({}, false);
    await f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {});
    assert.equal(f.state.calls, 2);
    assert.equal(f.state.downloads, 1);
    const records = await readJson<PackFile[]>(
      path.join(f.instance.directory, '.workbench', 'pack-files.json'),
    );
    assert.equal(records[0].fileId, 10);
    assert.equal(records[0].hash, f.hash);
    assert.ok(!JSON.stringify(records).includes('fixture-api-key'));
    await fs.rm(path.join(f.instance.directory, 'mods', 'remote.jar'));
    f.state.enabled = false;
    await f.service.repair(f.instance, records, new AbortController().signal, () => {});
    assert.equal(f.state.calls, 2);
    assert.equal(f.state.downloads, 1);
    assert.equal(f.state.manual, 1);
  } finally {
    await f.close();
  }
});

test('author-disabled downloads require manually selected original files even when a CDN URL is returned', async () => {
  const f = await fixture(true);
  try {
    f.state.blocked = true;
    f.make({}, false);
    await f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {});
    assert.equal(f.state.downloads, 0);
    assert.equal(f.state.manual, 1);
    assert.equal(
      await fs.readFile(path.join(f.instance.directory, 'mods', 'remote.jar'), 'utf8'),
      'mod payload',
    );
  } finally {
    await f.close();
  }
});

test('CurseForge Beta requires a user key and rejects a manually selected file with the wrong checksum', async () => {
  const f = await fixture(true);
  try {
    f.state.key = undefined;
    await assert.rejects(
      f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {}),
      /Configure a CurseForge API key/,
    );
    assert.equal(f.state.calls, 0);
    f.state.key = 'fixture-api-key';
    f.state.blocked = true;
    await fs.writeFile(f.source, 'wrong bytes');
    await assert.rejects(
      f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {}),
      /original file/,
    );
    await assert.rejects(
      fs.access(path.join(f.instance.directory, '.workbench', 'pack-files.json')),
    );
  } finally {
    await f.close();
  }
});

test('disabling CurseForge Beta cancels active metadata requests', async () => {
  const f = await fixture(true);
  try {
    let signal: AbortSignal | undefined;
    Network.prototype.json = async (_url, options) => {
      signal = options?.signal;
      return new Promise((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      ) as never;
    };
    const work = f.service.importPack(
      f.archive,
      f.instance,
      new AbortController().signal,
      () => {},
    );
    const rejection = assert.rejects(work, { name: 'AbortError' });
    for (let n = 0; !signal && n < 50; n++) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(signal);
    f.state.enabled = false;
    f.service.configurationChanged();
    await rejection;
    assert.equal(signal.aborted, true);
    assert.equal(f.state.downloads, 0);
  } finally {
    await f.close();
  }
});

test('disabling CurseForge while retrieving a saved key prevents the first API request', async () => {
  const f = await fixture(true);
  const service = new CurseForge(
    { options: { proxy: '', sources: {}, concurrency: 2 } } as Network,
    {
      get: async () => {
        f.state.enabled = false;
        return 'fixture-api-key';
      },
      store: async () => {},
      delete: async () => {},
    },
  );
  try {
    await assert.rejects(
      service.importPack(f.archive, f.instance, new AbortController().signal, () => {}),
      { name: 'AbortError' },
    );
    assert.equal(f.state.calls, 0);
    assert.equal(f.state.downloads, 0);
  } finally {
    service.dispose();
    await f.close();
  }
});

test('invalid manifests, multiple primary loaders and escaping override paths are rejected', async () => {
  const f = await fixture();
  try {
    f.make({ files: [{ projectID: -1, fileID: 10 }] });
    assert.throws(() => curseforgeManifest(f.archive), /reference/);
    f.make({
      minecraft: {
        version: '1.20.1',
        modLoaders: [
          { id: 'forge-47.2.0', primary: true },
          { id: 'fabric-0.16.10', primary: true },
        ],
      },
    });
    await assert.rejects(
      f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {}),
      /single primary/,
    );
    f.make({ overrides: '../outside' });
    await assert.rejects(
      f.service.importPack(f.archive, f.instance, new AbortController().signal, () => {}),
      /escapes/,
    );
    assert.equal(f.state.calls, 0);
  } finally {
    await f.close();
  }
});

test('managed pack repair respects disabled files and explicit removal', async () => {
  const f = await fixture();
  try {
    const record: PackFile = {
      path: 'mods/selected.jar',
      hash: f.hash,
      algorithm: 'sha1',
      size: 11,
      source: 'local',
      urls: [],
      localFile: f.source,
    };
    await savePackFiles(f.instance, [record]);
    await fs.mkdir(path.join(f.instance.directory, 'mods'), { recursive: true });
    const target = path.join(f.instance.directory, 'mods', 'selected.jar.disabled');
    await fs.writeFile(target, 'corrupt');
    await repairPackFiles(f.instance, {} as Network, new AbortController().signal, () => {});
    assert.equal(await hashFile(target), f.hash);
    await assert.rejects(fs.access(target.replace(/\.disabled$/, '')));
    await forgetPackFiles(f.instance, ['mods/selected.jar.disabled']);
    await fs.rm(target);
    await repairPackFiles(f.instance, {} as Network, new AbortController().signal, () => {});
    await assert.rejects(fs.access(target));
  } finally {
    await f.close();
  }
});
