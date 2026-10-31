import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip from 'adm-zip';
import { inc } from 'semver';
import type * as VSCode from 'vscode';
import { extensionVersion, extensionId } from '../src/build-info';
import {
  ExtensionUpdates,
  extensionRelease,
  installationSource,
  verifyExtensionPackage,
} from '../src/extension-updates';
import { Network } from '../src/network';
import { writeJson } from '../src/files';
const vscode = require('vscode') as typeof VSCode;
const repo = 'https://github.com/lopleec/VSCode-minecraft-workbench';
const nextVersion = inc(extensionVersion, 'patch')!;
const release = (version = nextVersion) => ({
  tag_name: 'v' + version,
  html_url: repo + '/releases/tag/v' + version,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `minecraft-workbench-${version}.vsix`,
      size: 200,
      digest: 'sha256:' + 'a'.repeat(64),
      browser_download_url: `${repo}/releases/download/v${version}/minecraft-workbench-${version}.vsix`,
    },
  ],
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-extension-update-'));
  const context = {
    extensionMode: 1,
    extensionPath: path.join(root, 'extensions', 'workbench'),
    globalStorageUri: {
      scheme: 'file',
      fsPath: path.join(root, 'profile', 'globalStorage', extensionId),
    },
    extension: { packageJSON: { version: extensionVersion } },
  } as VSCode.ExtensionContext;
  const original = {
    window: vscode.window,
    workspace: vscode.workspace,
    env: vscode.env,
    commands: vscode.commands,
    version: vscode.version,
  };
  let enabled = true,
    choice: string | undefined,
    calls = 0,
    downloads = 0,
    busy = false;
  const messages: string[] = [],
    opened: string[] = [],
    commands: { name: string; args: unknown[] }[] = [];
  Object.assign(vscode, {
    version: '1.96.0',
    workspace: {
      ...vscode.workspace,
      getConfiguration: () => ({
        get: (_key: string, fallback: unknown) => (_key === 'updates.enabled' ? enabled : fallback),
      }),
    },
    env: {
      ...vscode.env,
      remoteName: undefined,
      openExternal: async (uri: VSCode.Uri) => {
        opened.push(uri.toString());
        return true;
      },
    },
    window: {
      showInformationMessage: async (message: string, ...actions: string[]) => {
        messages.push(message);
        return choice && actions.includes(choice) ? choice : undefined;
      },
      showErrorMessage: async (message: string) => {
        messages.push(message);
        return undefined;
      },
    },
    commands: {
      executeCommand: async (name: string, ...args: unknown[]) => {
        commands.push({ name, args });
      },
    },
  });
  const network = {
    options: { proxy: '', sources: {}, concurrency: 1 },
    json: async () => {
      calls++;
      return release();
    },
    text: async () => '',
  } as unknown as Network;
  const originalDownload = Network.prototype.download;
  Network.prototype.download = async (_url, file) => {
    downloads++;
    const zip = new AdmZip();
    zip.addFile(
      'extension/package.json',
      Buffer.from(
        JSON.stringify({
          publisher: 'Lopleec',
          name: 'minecraft-workbench',
          version: nextVersion,
          engines: { vscode: '^1.96.0' },
        }),
      ),
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    zip.writeZip(file);
  };
  const jobs = {
    run: async (
      _label: string,
      work: (signal: AbortSignal, report: (v: string) => void) => Promise<unknown>,
    ) => work(new AbortController().signal, () => {}),
  };
  const updater = new ExtensionUpdates(context, network, jobs as never, () => busy);
  return {
    root,
    context,
    updater,
    network,
    messages,
    opened,
    commands,
    calls: () => calls,
    downloads: () => downloads,
    enabled: (v: boolean) => {
      enabled = v;
      updater.configurationChanged();
    },
    choose: (v?: string) => {
      choice = v;
    },
    busy: (v: boolean) => {
      busy = v;
    },
    close: async () => {
      updater.dispose();
      Network.prototype.download = originalDownload;
      Object.assign(vscode, original);
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

test('source detection prefers the active profile and defaults safely for missing metadata', async () => {
  const f = await fixture();
  try {
    await writeJson(path.join(path.dirname(f.context.extensionPath), 'extensions.json'), [
      {
        identifier: { id: extensionId },
        version: extensionVersion,
        relativeLocation: 'workbench',
        metadata: { source: 'vsix' },
      },
    ]);
    await f.updater.initialize();
    assert.equal(f.updater.source, 'vsix');
    assert.equal(f.calls(), 0);
    await writeJson(
      path.resolve(f.context.globalStorageUri.fsPath, '..', '..', 'extensions.json'),
      [
        {
          identifier: { id: extensionId.toLowerCase() },
          version: extensionVersion,
          location: { fsPath: f.context.extensionPath },
          metadata: { source: 'gallery' },
        },
      ],
    );
    assert.equal(await installationSource(f.context), 'gallery');
    assert.equal(await installationSource({ ...f.context, extensionMode: 2 }), 'development');
    await fs.rm(path.join(f.root, 'profile'), { recursive: true, force: true });
    await fs.rm(path.join(f.root, 'extensions'), { recursive: true, force: true });
    assert.equal(await installationSource(f.context), 'unknown');
  } finally {
    await f.close();
  }
});

test('release metadata only accepts stable releases and the exact official VSIX URL', () => {
  assert.equal(extensionRelease(release()).version, nextVersion);
  for (const change of [
    { prerelease: true },
    { draft: true },
    { tag_name: 'v0.4.4-beta.1' },
    { html_url: 'https://other.example/releases/tag/v0.4.4' },
    {
      assets: [
        { ...release().assets[0], browser_download_url: 'https://other.example/update.vsix' },
      ],
    },
  ])
    assert.throws(() => extensionRelease({ ...release(), ...change }));
});

test('checks are manual and disabled or Marketplace installations make no GitHub requests', async () => {
  const f = await fixture();
  try {
    assert.equal(f.calls(), 0);
    f.updater.source = 'gallery';
    await f.updater.check();
    assert.equal(f.calls(), 0);
    f.updater.source = 'vsix';
    f.enabled(false);
    await f.updater.check();
    assert.equal(f.calls(), 0);
    assert.equal(f.updater.visible, false);
    f.enabled(true);
    await f.updater.check();
    assert.equal(f.calls(), 1);
    assert.equal(f.downloads(), 0);
    assert.equal(f.commands.length, 0);
    f.choose('Download VSIX');
    await f.updater.check();
    assert.deepEqual(f.opened, [release().assets[0].browser_download_url]);
    assert.equal(f.downloads(), 0);
  } finally {
    await f.close();
  }
});

test('explicit install validates the package, does not reload automatically, and avoids repeat downloads', async () => {
  const f = await fixture();
  try {
    f.updater.source = 'vsix';
    f.choose('Download and install');
    await f.updater.check();
    assert.equal(f.downloads(), 1);
    assert.deepEqual(
      f.commands.map((c) => c.name),
      ['workbench.extensions.installExtension'],
    );
    await assert.rejects(fs.access((f.commands[0].args[0] as VSCode.Uri).fsPath));
    const calls = f.calls();
    await f.updater.check();
    assert.equal(f.calls(), calls);
    assert.equal(f.downloads(), 1);
    f.choose('Reload window');
    await f.updater.check();
    assert.equal(f.commands.at(-1)?.name, 'workbench.action.reloadWindow');
  } finally {
    await f.close();
  }
});

test('running games, remote windows and absent checksums do not trigger installation', async () => {
  const f = await fixture();
  try {
    f.updater.source = 'vsix';
    f.choose('Download and install');
    f.busy(true);
    await f.updater.check();
    assert.equal(f.downloads(), 0);
    f.busy(false);
    Object.assign(vscode.env, { remoteName: 'ssh-remote' });
    await f.updater.check();
    assert.equal(f.downloads(), 0);
    Object.assign(vscode.env, { remoteName: undefined });
    f.network.json = async () =>
      ({ ...release(), assets: release().assets.map(({ digest, ...a }) => a) }) as never;
    await f.updater.check();
    assert.equal(f.downloads(), 0);
  } finally {
    await f.close();
  }
});

test('turning checks off cancels in-flight metadata and prevents stale prompts from installing', async () => {
  const f = await fixture();
  try {
    f.updater.source = 'vsix';
    let signal: AbortSignal | undefined, finish: ((v: unknown) => void) | undefined;
    f.network.json = async (_url, options) => {
      signal = options?.signal;
      return (await new Promise<unknown>((r) => {
        finish = r;
      })) as never;
    };
    const work = f.updater.check();
    f.enabled(false);
    assert.equal(signal!.aborted, true);
    finish!(release());
    await work;
    assert.equal(f.messages.length, 0);
    assert.equal(f.downloads(), 0);
  } finally {
    await f.close();
  }
});

test('VSIX validation rejects another extension, wrong version or unsupported VS Code engine', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, 'update.vsix'),
      r = extensionRelease(release());
    for (const change of [
      { publisher: 'Other' },
      { version: extensionVersion },
      { engines: { vscode: '^1.120.0' } },
    ]) {
      const zip = new AdmZip();
      zip.addFile(
        'extension/package.json',
        Buffer.from(
          JSON.stringify({
            publisher: 'Lopleec',
            name: 'minecraft-workbench',
            version: r.version,
            engines: { vscode: '^1.96.0' },
            ...change,
          }),
        ),
      );
      zip.writeZip(file);
      assert.throws(() => verifyExtensionPackage(file, r, '1.96.0'));
    }
  } finally {
    await f.close();
  }
});

test('checks accept published checksum files when the asset API has no digest', async () => {
  const f = await fixture();
  try {
    const data = {
      ...release(),
      assets: [
        ...release().assets.map(({ digest, ...asset }) => asset),
        {
          name: 'SHA256SUMS.txt',
          size: 97,
          browser_download_url: `${repo}/releases/download/v${nextVersion}/SHA256SUMS.txt`,
        },
      ],
    };
    f.network.json = async () => data as never;
    f.network.text = async (_url, options) => {
      assert.equal(options?.bypassSources, true);
      return 'a'.repeat(64) + `  minecraft-workbench-${nextVersion}.vsix\n`;
    };
    f.updater.source = 'vsix';
    f.choose('Download and install');
    await f.updater.check();
    assert.equal(f.downloads(), 1);
  } finally {
    await f.close();
  }
});

test('disabling checks releases a pending offer and its old install action cannot run', async () => {
  const f = await fixture();
  try {
    f.updater.source = 'vsix';
    let offer: ((v: string) => void) | undefined;
    vscode.window.showInformationMessage = (() =>
      new Promise<string>((r) => {
        offer = r;
      })) as typeof vscode.window.showInformationMessage;
    const work = f.updater.check();
    for (let i = 0; i < 20 && !offer; i++) await new Promise((r) => setImmediate(r));
    assert.ok(offer);
    f.enabled(false);
    await assert.rejects(work, { name: 'AbortError' });
    offer!('Download and install');
    await new Promise((r) => setImmediate(r));
    assert.equal(f.downloads(), 0);
  } finally {
    await f.close();
  }
});
