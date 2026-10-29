import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExtensionContext, Memento } from 'vscode';
import { Consent, consentKey } from '../src/consent';
import legal from '../src/legal.json';
import { Workbench } from '../src/workbench';
import { Store } from '../src/store';
import type { ContentService } from '../src/content';
import type { Minecraft } from '../src/minecraft';
import type { UI } from '../src/ui';

function memory(initial?: unknown) {
  const values = new Map<string, unknown>(initial ? [[consentKey, initial]] : []);
  const storage: Pick<Memento, 'get' | 'update'> = {
    get: <T>(key: string, fallback?: T) => (values.get(key) ?? fallback) as T,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  return { storage, values };
}
const approval = { version: legal.version, minecraftEula: true, workbenchTerms: true };

test('both agreements require explicit true values for the current notice version', async () => {
  const { storage, values } = memory();
  const consent = new Consent(storage);
  assert.equal(consent.accepted, false);
  for (const input of [
    {},
    { ...approval, minecraftEula: false },
    { ...approval, workbenchTerms: false },
    { ...approval, minecraftEula: 'true' },
    { ...approval, version: 'previous' },
  ]) {
    await assert.rejects(consent.accept(input), /both agreements/);
    assert.equal(consent.accepted, false);
    assert.equal(values.size, 0);
  }
  await consent.accept(approval);
  assert.equal(consent.accepted, true);
  const saved = structuredClone(values.get(consentKey));
  assert.deepEqual(Object.keys(saved as object).sort(), [
    'acceptedAt',
    'minecraftEula',
    'version',
    'workbenchTerms',
  ]);
  assert.equal(new Consent(storage).accepted, true);
  await consent.accept(approval);
  assert.deepEqual(values.get(consentKey), saved);
});

test('old, incomplete and corrupt confirmations never unlock the extension', () => {
  for (const record of [
    true,
    { ...approval, version: 'old', acceptedAt: new Date().toISOString() },
    { ...approval, acceptedAt: 'invalid' },
    { ...approval, workbenchTerms: undefined, acceptedAt: new Date().toISOString() },
  ]) {
    const consent = new Consent(memory(record).storage);
    assert.equal(consent.accepted, false);
    assert.equal(consent.snapshot().acceptedAt, undefined);
  }
});

test('acceptance is applied and announced only after persistence succeeds', async () => {
  const { storage } = memory();
  let changes = 0;
  const consent = new Consent(storage, () => changes++);
  const update = storage.update;
  storage.update = async () => {
    throw new Error('Storage unavailable');
  };
  await assert.rejects(consent.accept(approval), /Storage unavailable/);
  assert.equal(consent.accepted, false);
  assert.equal(changes, 0);
  storage.update = update;
  await consent.accept(approval);
  assert.equal(consent.accepted, true);
  assert.equal(changes, 1);
});

test('all extension operations remain blocked until acceptance except agreement and language controls', async () => {
  const consent = new Consent(memory().storage);
  for (const command of [
    'launch',
    'install',
    'createProject',
    'addAccount',
    'downloadJava',
    'refreshManifest',
    'futureOperation',
    'settings',
    'stop',
    'help',
    'output',
    'refresh',
  ])
    assert.equal(consent.allowsCommand(command), false, command);
  for (const command of ['agreements', 'language'])
    assert.equal(consent.allowsCommand(command), true, command);
  for (const method of [
    'search',
    'plan',
    'install',
    'launcher.saveSetup',
    'launcher.createProject',
    'launcher.signIn',
    'launcher.downloadJava',
    'future.operation',
    'consent.language',
  ])
    assert.equal(consent.allowsRequest(method, {}), false, method);
  for (const action of [
    'launch',
    'install',
    'downloadJava',
    'addAccount',
    'settings',
    'stop',
    'output',
  ])
    assert.equal(consent.allowsRequest('action', { action }), false, action);
  for (const method of ['ready', 'consent.accept', 'consent.link', 'consent.close'])
    assert.equal(consent.allowsRequest(method, {}), true, method);
  assert.equal(consent.allowsRequest('action', { action: 'language' }), true);
  await consent.accept(approval);
  assert.equal(consent.allowsCommand('launch'), true);
  assert.equal(consent.allowsRequest('launcher.createProject', {}), true);
});

test('webview bridge blocks launcher and developer requests before services run, then unlocks after confirmed acceptance', async () => {
  const consent = new Consent(memory().storage);
  let calls = 0;
  const store = new Store('/unused', () => {});
  const content = {
    search: async () => {
      calls++;
      return { hits: [] };
    },
  } as unknown as ContentService;
  const minecraft = {
    running: new Map(),
    manifest: async () => {
      calls++;
      return { versions: [] };
    },
  } as unknown as Minecraft;
  const ui = {
    jobs: { items: [] },
    developer: {
      templates: async () => {
        calls++;
        return [];
      },
    },
  } as unknown as UI;
  const workbench = new Workbench({} as ExtensionContext, store, content, minecraft, ui, consent, {
    status: () => 'stopped',
  } as never);
  assert.equal(
    ((await workbench.handle('ready', {})) as { consent: { accepted: boolean } }).consent.accepted,
    false,
  );
  for (const [method, params] of [
    ['search', {}],
    ['launcher.gameVersions', {}],
    ['launcher.projectTemplates', { loader: 'fabric' }],
    ['action', { action: 'launch' }],
  ] as const)
    await assert.rejects(workbench.handle(method, params), /Accept the agreements/);
  assert.equal(calls, 0);
  await assert.rejects(
    workbench.handle('consent.accept', { ...approval, workbenchTerms: false }),
    /both agreements/,
  );
  await assert.rejects(
    workbench.handle('consent.link', { document: '__proto__' }),
    /Unknown agreement/,
  );
  const result = (await workbench.handle('consent.accept', approval)) as {
    consent: { accepted: boolean };
    page: string;
  };
  assert.equal(result.consent.accepted, true);
  assert.equal(result.page, 'instances');
  await workbench.handle('search', {});
  await workbench.handle('launcher.gameVersions', {});
  await workbench.handle('launcher.projectTemplates', { loader: 'fabric' });
  assert.equal(calls, 3);
});
