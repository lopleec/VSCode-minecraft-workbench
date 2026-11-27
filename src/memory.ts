import * as os from 'node:os';
import { config } from './config';
import type { Instance } from './models';

export interface MemoryLimits {
  minMemory: number;
  maxMemory: number;
}
/**
 * JVM heap sizes are aligned to an 8 MB boundary, so a value such as 8196 MB
 * would actually start with a 8200 MB maximum heap. Store and pass only aligned
 * values so the configured limit matches the runtime limit.
 */
export function normalizeMemory(value: number): number {
  return Math.max(128, Math.floor(value / 8) * 8);
}
export function recommendMemory(totalBytes: number, percentage = 25) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) throw new Error('Invalid system memory');
  const totalMemory = Math.floor(totalBytes / 1024 ** 2);
  const percent = Number.isFinite(percentage) ? Math.max(10, Math.min(50, percentage)) : 25;
  const maxMemory = Math.max(
    128,
    Math.floor(Math.min(8192, (totalMemory * percent) / 100, totalMemory / 2) / 128) * 128,
  );
  const minMemory = Math.min(
    maxMemory,
    Math.max(256, Math.min(1024, Math.floor(maxMemory / 8 / 128) * 128)),
  );
  return { minMemory, maxMemory, totalMemory, percentage: percent };
}
export function resolveMemory(
  instance: Partial<MemoryLimits>,
  defaults: Partial<MemoryLimits>,
  recommendation: MemoryLimits,
): MemoryLimits {
  const valid = (value: number | undefined) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 128 && value <= 1048576
      ? value
      : undefined;
  const maxMemory = normalizeMemory(
    valid(instance.maxMemory) ?? valid(defaults.maxMemory) ?? recommendation.maxMemory,
  );
  const minMemory = Math.min(
    maxMemory,
    normalizeMemory(
      valid(instance.minMemory) ??
        valid(defaults.minMemory) ??
        Math.min(recommendation.minMemory, maxMemory),
    ),
  );
  return { minMemory, maxMemory };
}
export function memorySettings(instance: Partial<Instance> = {}) {
  const recommendation = recommendMemory(os.totalmem(), config('memoryPercentage', 25));
  const defaults = { minMemory: config('minMemory', 0), maxMemory: config('maxMemory', 0) };
  return {
    ...resolveMemory(instance, defaults, recommendation),
    recommendation,
    automaticMinimum: !defaults.minMemory,
    automaticMaximum: !defaults.maxMemory,
  };
}
