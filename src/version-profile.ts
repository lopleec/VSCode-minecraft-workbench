import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Version } from '@xmcl/core';
import { exists, filename, readJson, rejectSymlinkParents } from './files';

type Profile = Record<string, any>;

export async function versionChain(root: string, version: string, signal?: AbortSignal) {
  const chain: Profile[] = [];
  const seen = new Set<string>();
  let id: string | undefined = version;
  while (id) {
    signal?.throwIfAborted();
    filename(id);
    if (seen.has(id) || seen.size >= 32)
      throw new Error('Circular or excessively deep version inheritance.');
    seen.add(id);
    const file = path.join(root, 'versions', id, `${id}.json`);
    await rejectSymlinkParents(root, file);
    if (!(await exists(file))) throw new Error(`Missing version profile: ${id}`);
    if ((await fs.stat(file)).size > 8 * 1024 ** 2)
      throw new Error('Instance metadata exceeds 8 MB.');
    const profile = await readJson<Profile>(file);
    if (!profile || typeof profile !== 'object' || Array.isArray(profile))
      throw new Error('Invalid instance metadata.');
    if (profile.id !== id) throw new Error(`Version profile ID does not match its folder: ${id}`);
    chain.push(profile);
    id = typeof profile.inheritsFrom === 'string' ? profile.inheritsFrom : undefined;
  }
  return chain;
}

export function normalizeProfile(profile: Profile): Profile {
  if (profile.patches === undefined || profile.patches === null) return profile;
  if (!Array.isArray(profile.patches) || profile.patches.length > 128)
    throw new Error('Invalid instance patch list.');
  const patches = [...profile.patches].sort(
    (a, b) => (a?.priority ?? -2147483648) - (b?.priority ?? -2147483648),
  );
  let result: Profile = profile.root === true && !profile.inheritsFrom ? {} : { ...profile };
  delete result.patches;
  for (const patch of patches) {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      patch.patches?.length ||
      patch.inheritsFrom
    )
      throw new Error('Unsupported nested instance patch.');
    const arguments_ = {
      game: [...(result.arguments?.game || []), ...(patch.arguments?.game || [])],
      jvm: [...(result.arguments?.jvm || []), ...(patch.arguments?.jvm || [])],
    };
    const libraries = [...(result.libraries || []), ...(patch.libraries || [])];
    for (const [key, value] of Object.entries(patch))
      if (
        value !== null &&
        value !== undefined &&
        !['id', 'jar', 'version', 'priority', 'hidden', 'inheritsFrom', 'patches'].includes(key)
      )
        result[key] = value;
    if (result.arguments || patch.arguments) result.arguments = arguments_;
    result.libraries = libraries;
  }
  return { ...result, id: profile.id, jar: profile.jar, inheritsFrom: profile.inheritsFrom };
}

export async function resolveGameVersion(root: string, version: string, signal?: AbortSignal) {
  const chain = (await versionChain(root, version, signal)).map(normalizeProfile);
  const base = chain[chain.length - 1];
  const explicitJar = chain.find((profile) => typeof profile.jar === 'string')?.jar;
  const candidates = explicitJar
    ? [explicitJar]
    : [base.id, base.clientVersion, base._minecraftVersion];
  let jar = explicitJar || base.id;
  for (const id of candidates.filter((id): id is string => typeof id === 'string')) {
    filename(id);
    if (await exists(path.join(root, 'versions', id, id + '.jar'))) {
      jar = id;
      break;
    }
  }
  base.clientVersion = filename(jar);
  signal?.throwIfAborted();
  return Version.resolve(
    root,
    chain.map((profile) => Version.normalizeVersionJson(JSON.stringify(profile), root)),
  );
}
