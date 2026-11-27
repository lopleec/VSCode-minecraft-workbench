import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMemory, recommendMemory, resolveMemory } from '../src/memory';

test('automatic memory scales with system RAM and leaves headroom on small machines', () => {
  for (const [ram, minimum, maximum] of [
    [4, 256, 1024],
    [8, 256, 2048],
    [16, 512, 4096],
    [24, 768, 6144],
    [32, 1024, 8192],
    [64, 1024, 8192],
  ]) {
    const value = recommendMemory(ram * 1024 ** 3);
    assert.equal(value.minMemory, minimum);
    assert.equal(value.maxMemory, maximum);
    assert.ok(value.minMemory <= value.maxMemory);
    assert.ok(value.maxMemory <= (ram * 1024) / 2);
  }
  assert.equal(recommendMemory(16 * 1024 ** 3, 50).maxMemory, 8192);
  assert.equal(recommendMemory(16 * 1024 ** 3, 10).maxMemory, 1536);
});
test('manual instance and global memory settings override recommendations without being capped', () => {
  const auto = recommendMemory(16 * 1024 ** 3);
  assert.deepEqual(resolveMemory({}, { minMemory: 0, maxMemory: 0 }, auto), {
    minMemory: 512,
    maxMemory: 4096,
  });
  assert.deepEqual(resolveMemory({}, { minMemory: 768, maxMemory: 6144 }, auto), {
    minMemory: 768,
    maxMemory: 6144,
  });
  assert.deepEqual(
    resolveMemory({ minMemory: 1024, maxMemory: 12288 }, { minMemory: 0, maxMemory: 0 }, auto),
    { minMemory: 1024, maxMemory: 12288 },
  );
  assert.deepEqual(resolveMemory({ maxMemory: 256 }, { minMemory: 0, maxMemory: 0 }, auto), {
    minMemory: 256,
    maxMemory: 256,
  });
});
test('memory limits align to the JVM heap granularity', () => {
  assert.equal(normalizeMemory(8196), 8192);
  assert.equal(normalizeMemory(8192), 8192);
  assert.equal(normalizeMemory(8200), 8200);
  assert.equal(normalizeMemory(127), 128);
  assert.deepEqual(
    resolveMemory(
      { minMemory: 8196, maxMemory: 8196 },
      { minMemory: 0, maxMemory: 0 },
      recommendMemory(16 * 1024 ** 3),
    ),
    { minMemory: 8192, maxMemory: 8192 },
  );
});
