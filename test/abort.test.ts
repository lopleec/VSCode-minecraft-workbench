import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitFor } from '../src/abort';

test('an already cancelled wait observes a later rejection without leaking it', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(waitFor(Promise.reject(new Error('Late failure')), controller.signal), {
    name: 'AbortError',
  });
  await new Promise((resolve) => setImmediate(resolve));
});

test('cancelling one wait leaves shared work available to another waiter', async () => {
  let finish!: (value: string) => void;
  const work = new Promise<string>((resolve) => (finish = resolve));
  const controller = new AbortController();
  const cancelled = waitFor(work, controller.signal);
  const other = waitFor(work, new AbortController().signal);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  finish('Ready');
  assert.equal(await other, 'Ready');
});
