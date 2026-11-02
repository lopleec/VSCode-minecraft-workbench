import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import AdmZip from 'adm-zip';
import { Diagnostics, diagnosticData } from '../src/diagnostics';

const vscode = require('vscode');

test('diagnostic archives contain environment, configuration and full traces without credentials', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-diagnostics-'));
  const log = new Diagnostics(directory);
  const delivered: string[] = [];
  const channel = log.channel(
    Object.freeze({
      name: 'Minecraft Workbench',
      info: (text: string) => delivered.push(text),
      debug() {},
    }) as never,
  );
  try {
    assert.equal(channel.name, 'Minecraft Workbench');
    channel.info('Command: ["javaw.exe","--accessToken","hidden-access-token"]');
    channel.info(
      `Command: ["javaw.exe","--username","TestPlayer","--uuid","player-id","${os.homedir()}/game"]`,
    );
    channel.debug('Download started; HTTP 200; original output 原始输出');
    const zip = new AdmZip(
      await log.archive({
        settings: { proxy: 'http://user:proxy-pass@proxy.test' },
        nested: [{ accessToken: 'hidden-token', password: 'hidden-password' }],
        java: path.join(os.homedir(), 'jdk', 'bin', 'java'),
        phase: 'Java process started',
        accountName: 'TestPlayer',
        profileId: 'player-id',
      }),
    );
    const report = zip.readAsText('report.txt');
    const output = zip.readAsText('launcher.log');
    assert.ok(
      report.includes('[Environment]') &&
        report.includes('vscodeVersion') &&
        report.includes('nodeVersion'),
    );
    assert.ok(report.includes('Java process started'));
    assert.ok(output.includes('Download started; HTTP 200'));
    assert.ok(output.includes('原始输出'));
    const complete = report + output;
    for (const secret of ['hidden-access-token', 'hidden-token', 'hidden-password', 'proxy-pass'])
      assert.ok(!complete.includes(secret), secret);
    assert.ok(!complete.includes(os.homedir()));
    assert.ok(!complete.includes('TestPlayer') && !complete.includes('player-id'));
    assert.ok(complete.includes('[redacted]'));
    assert.equal(delivered.length, 2);
    assert.equal(diagnosticData('C:\\Users\\Example\\java.exe'), 'C:\\Users\\<user>\\java.exe');
    assert.ok(
      !String(diagnosticData(JSON.stringify(['C:\\Users\\Example\\java.exe']))).includes('Example'),
    );
  } finally {
    await log.flush();
    log.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('original exports retain local paths and player identifiers while excluding credentials', async () => {
  const log = new Diagnostics();
  try {
    log.record(
      'info',
      `Command: ["javaw.exe","--username","TestPlayer","--uuid","player-id","--accessToken","private-token","${os.homedir()}/game"]`,
    );
    const zip = new AdmZip(
      await log.archive(
        {
          accountName: 'TestPlayer',
          profileId: 'player-id',
          password: 'private-password',
          java: path.join(os.homedir(), 'jdk'),
        },
        'original',
      ),
    );
    const complete = zip.readAsText('report.txt') + zip.readAsText('launcher-memory.log');
    assert.ok(
      complete.includes(os.homedir()) &&
        complete.includes('TestPlayer') &&
        complete.includes('player-id'),
    );
    assert.ok(complete.includes('"exportMode": "original"'));
    assert.ok(!complete.includes('private-token') && !complete.includes('private-password'));
  } finally {
    log.dispose();
  }
});

test('export writes a diagnostic ZIP only after the user selects a destination', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-diagnostics-export-'));
  const target = path.join(root, 'diagnostics.zip');
  const log = new Diagnostics();
  vscode.window.showSaveDialog ||= async () => {};
  vscode.window.showQuickPick ||= async () => {};
  vscode.window.showInformationMessage ||= async () => {};
  vscode.workspace.fs ||= {};
  vscode.workspace.fs.writeFile ||= async () => {};
  const save = mock.method(vscode.window, 'showSaveDialog', async () => undefined);
  const pick = mock.method(vscode.window, 'showQuickPick', async () => undefined);
  const message = mock.method(vscode.window, 'showInformationMessage', async () => undefined);
  const write = mock.method(
    vscode.workspace.fs,
    'writeFile',
    async (uri: { fsPath: string }, bytes: Uint8Array) => fs.writeFile(uri.fsPath, bytes),
  );
  try {
    await log.export({});
    assert.equal(write.mock.callCount(), 0);
    assert.equal(save.mock.callCount(), 0, 'Cancelling export mode does not open a file dialog');
    pick.mock.mockImplementation(async (choices: unknown[]) => choices[0]);
    await log.export({});
    assert.equal(write.mock.callCount(), 0, 'Cancelling the file dialog does not write an archive');
    save.mock.mockImplementation(async () => vscode.Uri.file(target));
    log.record('info', 'Preparing Java');
    await log.export({ phase: 'Ready' });
    const zip = new AdmZip(target);
    assert.ok(zip.readAsText('report.txt').includes('[Environment]'));
    assert.ok(zip.readAsText('report.txt').includes('"exportMode": "sanitized"'));
    assert.ok(zip.readAsText('launcher-memory.log').includes('Preparing Java'));
    pick.mock.mockImplementation(async (choices: unknown[]) => choices[1]);
    await log.export({ java: path.join(os.homedir(), 'jdk') });
    assert.ok(
      new AdmZip(target)
        .readAsText('report.txt')
        .includes(JSON.stringify(path.join(os.homedir(), 'jdk'))),
    );
  } finally {
    pick.mock.restore();
    save.mock.restore();
    message.mock.restore();
    write.mock.restore();
    log.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('disk logging rotates an existing full segment before appending new traces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-diagnostics-rotate-'));
  await fs.writeFile(path.join(root, 'launcher.log'), 'x'.repeat(8 * 1024 ** 2));
  const log = new Diagnostics(root);
  try {
    log.record('info', 'New session');
    await log.flush();
    assert.equal((await fs.stat(path.join(root, 'launcher.1.log'))).size, 8 * 1024 ** 2);
    assert.ok((await fs.readFile(path.join(root, 'launcher.log'), 'utf8')).includes('New session'));
  } finally {
    log.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('diagnostics stay exportable when disk logging is unavailable', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-diagnostics-fallback-'));
  const directory = path.join(root, 'not-a-directory');
  await fs.writeFile(directory, 'occupied');
  const log = new Diagnostics(directory);
  try {
    log.record('error', 'Java process failed to start');
    const zip = new AdmZip(await log.archive({}));
    assert.ok(zip.readAsText('report.txt').includes('Disk log warning'));
    assert.ok(zip.readAsText('launcher-memory.log').includes('Java process failed to start'));
  } finally {
    log.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
});
