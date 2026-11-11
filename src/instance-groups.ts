import type { Instance } from './models';

export function instanceGroup(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 100 || /[\x00-\x1f]/.test(value))
    throw new Error('Invalid instance group');
  return value.trim() || undefined;
}

export function instanceGroups(instances: Instance[]): string[] {
  return [
    ...new Set(
      instances.map((instance) => instance.group).filter((group): group is string => !!group),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
