import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as VSCode from 'vscode';
import { Jobs } from '../src/jobs';
const vscode = require('vscode') as typeof VSCode;

test('a batch returning partial results after cancellation is recorded as cancelled', async () => {
  const original = vscode.window;
  Object.assign(vscode, {
    window: {
      withProgress: async (_options: unknown, work: Function) =>
        work({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    },
  });
  const jobs = new Jobs(() => {}, { info() {}, error() {} } as never);
  try {
    const result = await jobs.run('Import instances', async () => {
      jobs.items[0].controller.abort();
      return { imported: 1, cancelled: true };
    });
    assert.equal(result.imported, 1);
    assert.equal(jobs.items[0].status, 'cancelled');
  } finally {
    jobs.dispose();
    Object.assign(vscode, { window: original });
  }
});

test('an external abort is recorded as cancelled while a real failure stays failed', async () => {
  const original = vscode.window;
  Object.assign(vscode, {
    window: {
      withProgress: async (_options: unknown, work: Function) =>
        work({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    },
  });
  const jobs = new Jobs(() => {}, { info() {}, error() {} } as never);
  try {
    await assert.rejects(
      jobs.run('Check update', async () => {
        throw new DOMException('Disabled', 'AbortError');
      }),
      { name: 'AbortError' },
    );
    assert.equal(jobs.items[0].status, 'cancelled');
    await assert.rejects(
      jobs.run('Download', async () => {
        throw new Error('Connection failed');
      }),
    );
    assert.equal(jobs.items[0].status, 'failed');
  } finally {
    jobs.dispose();
    Object.assign(vscode, { window: original });
  }
});

test('history trimming keeps running tasks available for cancellation and disposal', async () => {
  const original = vscode.window;
  Object.assign(vscode, {
    window: {
      withProgress: async (_options: unknown, work: Function) =>
        work({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    },
  });
  const jobs = new Jobs(() => {}, { info() {}, error() {} } as never);
  const running = Array.from({ length: 101 }, (_, i) =>
    jobs.run(
      `Task ${i}`,
      (signal) =>
        new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        ),
    ),
  );
  const settled = Promise.allSettled(running);
  try {
    assert.equal(jobs.items.length, 101);
    await jobs.run('Finished', async () => {});
    assert.equal(jobs.items.length, 101);
    assert.ok(jobs.items.every((job) => job.status === 'running'));
    jobs.dispose();
    assert.ok((await settled).every((result) => result.status === 'rejected'));
    assert.equal(jobs.items.length, 100);
    assert.ok(jobs.items.every((job) => job.status === 'cancelled'));
  } finally {
    jobs.dispose();
    Object.assign(vscode, { window: original });
  }
});

test('task logs keep stages, duration and nested failure details while redacting tokens', async () => {
  const original = vscode.window;
  const logs: string[] = [];
  Object.assign(vscode, {
    window: {
      withProgress: async (_options: unknown, work: Function) =>
        work({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
    },
  });
  const jobs = new Jobs(() => {}, {
    info: (message: string) => logs.push(message),
    error: (message: string) => logs.push(message),
  } as never);
  try {
    await assert.rejects(
      jobs.run('Install', async (_signal, report) => {
        report('Preparing Java');
        report('Preparing Java');
        report('access_token=private-access');
        throw new Error('Installer failed', {
          cause: new Error('Refresh refresh_token=private-refresh'),
        });
      }),
    );
    const text = logs.join('\n');
    assert.match(text, /Started/);
    assert.equal(logs.filter((line) => line.includes('Preparing Java')).length, 1);
    assert.match(text, /Caused by: Error: Refresh/);
    assert.match(text, /\d\.\ds/);
    assert.ok(!text.includes('private-access') && !text.includes('private-refresh'));
    assert.equal(jobs.items[0].status, 'failed');
  } finally {
    jobs.dispose();
    Object.assign(vscode, { window: original });
  }
});

test('Gradle executions appear in Tasks, record their real outcome and support cancellation', () => {
  const logs: string[] = [];
  const jobs = new Jobs(() => {}, {
    info: (line: string) => logs.push(line),
    error: (line: string) => logs.push(line),
  } as never);
  let terminated = 0;
  const execution = {
    task: { name: 'Mod: build' },
    terminate: () => {
      terminated++;
    },
  } as never;
  jobs.taskStarted(execution);
  jobs.taskStarted(execution);
  assert.equal(jobs.items.length, 1);
  jobs.taskProcessStarted(execution, 1234);
  jobs.taskStopped(execution);
  assert.equal(
    jobs.items[0].status,
    'running',
    'A task end event cannot overwrite a pending process exit result',
  );
  jobs.taskEnded(execution, 1);
  assert.equal(jobs.items[0].status, 'failed');
  assert.match(jobs.items[0].detail!, /1/);
  jobs.taskStarted(execution);
  jobs.items[0].controller.abort();
  assert.equal(terminated, 1);
  jobs.taskEnded(execution, 0);
  assert.equal(jobs.items[0].status, 'cancelled');
  jobs.taskStarted(execution);
  jobs.taskEnded(execution, 0);
  assert.equal(jobs.items[0].status, 'done');
  assert.ok(logs.some((line) => line.includes('PID 1234')));
  jobs.taskStarted(execution, true);
  jobs.dispose();
  assert.equal(
    terminated,
    1,
    'Reloading the extension leaves native Gradle tasks under VS Code control',
  );
});
