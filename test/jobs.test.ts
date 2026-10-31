import { test } from 'node:test';
import assert from 'node:assert/strict';
import type * as VSCode from 'vscode';
import { Jobs } from '../src/jobs';
const vscode = require('vscode') as typeof VSCode;

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
