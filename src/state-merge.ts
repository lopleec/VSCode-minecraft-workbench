import { State } from './models';
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function patch(
  current: Record<string, unknown>,
  base: Record<string, unknown>,
  next: Record<string, unknown>,
) {
  const result = { ...current };
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (equal(base[key], next[key])) continue;
    if (!(key in next) || next[key] === undefined) delete result[key];
    else result[key] = next[key];
  }
  return result;
}
export function mergeState(current: State, base: State, next: State): State {
  const merged = patch(
    current as unknown as Record<string, unknown>,
    base as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
  ) as unknown as State;
  for (const field of ['instances', 'accounts', 'projects', 'java', 'servers'] as const) {
    const id = (item: unknown): string => {
      const value = item as { id?: string; path?: string };
      return value.id || value.path || '';
    };
    const before = new Map((base[field] || []).map((item) => [id(item), item]));
    const after = new Map((next[field] || []).map((item) => [id(item), item]));
    const result = new Map((current[field] || []).map((item) => [id(item), structuredClone(item)]));
    for (const key of before.keys()) if (!after.has(key)) result.delete(key);
    for (const [key, item] of after) {
      const old = before.get(key);
      if (!old) result.set(key, item);
      else if (!equal(old, item) && result.has(key))
        result.set(
          key,
          patch(
            result.get(key) as unknown as Record<string, unknown>,
            old as unknown as Record<string, unknown>,
            item as unknown as Record<string, unknown>,
          ) as never,
        );
    }
    (merged[field] as unknown[]) = [...result.values()];
  }
  if (!merged.instances.some((i) => i.id === merged.selectedInstance))
    merged.selectedInstance = merged.instances[0]?.id;
  if (!merged.accounts.some((a) => a.id === merged.selectedAccount))
    merged.selectedAccount = merged.accounts[0]?.id;
  if (!merged.servers.some((s) => s.id === merged.selectedServer))
    merged.selectedServer = merged.servers[0]?.id;
  return merged;
}
