import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { Network, HttpError } from './network';
import { Content, ContentKind, ContentTarget, Instance, ModVersion } from './models';
import {
  exists,
  extractZip,
  filename,
  hashFile,
  readJson,
  rejectSymlinkParents,
  within,
  writeJson,
} from './files';
import { config, t } from './config';
import {
  FabricModule,
  fabricSatisfies,
  readFabricMetadata,
  fabricDiagnostics,
  candidateModVersion,
} from './fabric-metadata';
import {
  SearchOptions,
  ModProject,
  InstallPlan,
  ContentInstallOptions,
  compatible,
  contentLoaders,
  contentFile,
} from './modrinth';

const api = 'https://api.modrinth.com/v2';
export const contentFolders: Record<ContentKind, string> = {
  mod: 'mods',
  plugin: 'plugins',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
};
export interface SearchHit {
  project_id: string;
  title: string;
  description: string;
  downloads: number;
  slug: string;
  icon_url?: string;
  author?: string;
  categories?: string[];
  follows?: number;
}
export class ContentService {
  private readonly locks = new Set<string>();
  private readonly cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const old = this.cache.get(key);
    if (old && old.expires > Date.now()) return old.value as Promise<T>;
    const value = load().catch((error) => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { expires: Date.now() + 300000, value });
    return value;
  }
  project(id: string): Promise<ModProject> {
    return this.cached(`project:${id}`, () =>
      this.net.json<ModProject>(`${api}/project/${encodeURIComponent(id)}`),
    );
  }
  async projects(ids: string[]): Promise<ModProject[]> {
    const result: ModProject[] = [];
    for (let index = 0; index < ids.length; index += 100) {
      const group = ids.slice(index, index + 100);
      try {
        const projects = await this.cached(`projects:${group.join(',')}`, () =>
          this.net.json<ModProject[]>(
            `${api}/projects?${new URLSearchParams({ ids: JSON.stringify(group) })}`,
          ),
        );
        for (const project of projects) {
          this.cache.set(`project:${project.id}`, {
            expires: Date.now() + 300000,
            value: Promise.resolve(project),
          });
          result.push(project);
        }
      } catch {
        /* Local content remains usable when metadata is unavailable. */
      }
    }
    return result;
  }
  version(id: string): Promise<ModVersion> {
    return this.cached(`version:${id}`, () =>
      this.net.json<ModVersion>(`${api}/version/${encodeURIComponent(id)}`),
    );
  }
  constructor(
    private readonly net: Network,
    private readonly metadataDirectory?: string,
  ) {}
  private jarCache(version: ModVersion) {
    const file = contentFile(version);
    return this.metadataDirectory && file.filename.endsWith('.jar')
      ? path.join(
          this.metadataDirectory,
          `${filename(version.id)}-${file.hashes.sha1.slice(0, 12)}.jar`,
        )
      : undefined;
  }
  private async metadata(version: ModVersion, signal?: AbortSignal): Promise<FabricModule[]> {
    const target = this.jarCache(version);
    if (!target) return [];
    return this.cached(`metadata:${version.id}`, async () => {
      const file = contentFile(version);
      await this.net.download(file.url, target, {
        signal,
        hash: file.hashes.sha1,
        size: file.size,
        kind: 'modrinth',
      });
      return readFabricMetadata(target);
    });
  }
  async downloadPack(
    file: { url: string; hashes: { sha1: string }; size: number },
    archive: string,
    signal: AbortSignal,
  ) {
    await this.net.download(file.url, archive, {
      signal,
      hash: file.hashes.sha1,
      size: file.size,
      kind: 'modrinth',
    });
  }
  async exclusive<T>(instance: ContentTarget, work: () => Promise<T>): Promise<T> {
    if (this.locks.has(instance.id))
      throw new Error(t('Content operation already in progress.', '内容操作正在进行。'));
    this.locks.add(instance.id);
    try {
      return await work();
    } finally {
      this.locks.delete(instance.id);
    }
  }
  isBusy(instance: ContentTarget) {
    return this.locks.has(instance.id);
  }
  private index(instance: ContentTarget) {
    return path.join(instance.directory, '.workbench', 'content.json');
  }
  async search(
    query: string,
    kind: ContentKind | 'modpack',
    instance?: ContentTarget,
    offset = 0,
    options: SearchOptions = {},
  ) {
    const facets = [[kind === 'plugin' ? 'all_project_types:plugin' : `project_type:${kind}`]];
    if (kind === 'plugin' && !instance)
      facets.push([
        'categories:paper',
        'categories:spigot',
        'categories:bukkit',
        'categories:folia',
        'categories:velocity',
      ]);
    if (instance) {
      facets.push([`versions:${instance.minecraft}`]);
      if (kind === 'mod' || kind === 'plugin')
        facets.push(contentLoaders(instance, kind).map((l) => `categories:${l}`));
      if (instance.side === 'server') facets.push(['server_side:required', 'server_side:optional']);
    }
    const params = new URLSearchParams({
      query,
      facets: JSON.stringify(facets),
      limit: String(Math.max(1, Math.min(100, options.limit || 30))),
      index: options.order || (query.trim() ? 'relevance' : 'downloads'),
      offset: String(offset),
    });
    return this.net.json<{ hits: SearchHit[]; total_hits: number }>(`${api}/search?${params}`, {
      signal: options.signal,
    });
  }
  async versions(project: string, instance?: ContentTarget, kind: ContentKind | 'modpack' = 'mod') {
    const params = new URLSearchParams();
    if (instance) {
      params.set('game_versions', JSON.stringify([instance.minecraft]));
      if (kind === 'mod' || kind === 'plugin')
        params.set('loaders', JSON.stringify(contentLoaders(instance, kind)));
    }
    const key = `versions:${project}:${params}`;
    return this.cached(key, () =>
      this.net.json<ModVersion[]>(
        `${api}/project/${encodeURIComponent(project)}/version?${params}`,
      ),
    );
  }
  async plan(
    instance: ContentTarget,
    version: ModVersion,
    kind: ContentKind,
    includeOptional = false,
    signal?: AbortSignal,
  ): Promise<InstallPlan> {
    const installed = await this.list(instance);
    const versions = new Map<string, ModVersion>();
    const required = new Set<string>();
    const entryKinds = new Map<string, ContentKind>();
    const optional = new Set<string>();
    const conflicts = new Set<string>();
    const selectedMetadata = new Map<string, FabricModule[]>();
    const existingMetadata = new Map<string, FabricModule[]>();
    const useMetadata = !!this.metadataDirectory && ['fabric', 'quilt'].includes(instance.loader);
    if (useMetadata)
      for (const item of installed.filter(
        (i) => i.enabled && i.kind === 'mod' && i.projectId !== version.project_id,
      )) {
        try {
          existingMetadata.set(
            item.projectId || item.file,
            readFabricMetadata(path.join(instance.directory, 'mods', filename(item.file))),
          );
        } catch {
          /* Invalid local archives are reported by the conflict checker. */
        }
      }
    const modules = () => [
      ...[...existingMetadata]
        .filter(([project]) => !versions.has(project))
        .flatMap(([, values]) => values),
      ...[...selectedMetadata.values()].flat(),
    ];
    const satisfiesConstraints = (metadata: FabricModule[]) =>
      metadata.every((module) =>
        modules().every((owner) => {
          const predicates = [module.id, ...(module.provides || [])].flatMap((id) =>
            owner.depends?.[id] ? [owner.depends[id]] : [],
          );
          return predicates.every((predicate) => fabricSatisfies(module.version, predicate));
        }),
      );
    const dependencyVersion = async (
      projectId: string,
      explicit: string | undefined,
      targetKind: ContentKind,
    ): Promise<ModVersion | undefined> => {
      if (explicit) return this.version(explicit);
      if (versions.has(projectId)) return versions.get(projectId);
      const existing = installed.find((i) => i.projectId === projectId);
      const previous = existing?.versionId ? await this.version(existing.versionId) : undefined;
      if (
        previous &&
        compatible(previous, instance, targetKind) &&
        (!useMetadata || satisfiesConstraints(await this.metadata(previous, signal)))
      )
        return previous;
      const candidates = await this.versions(projectId, instance, targetKind);
      if (!useMetadata)
        return (
          candidates.find((v) => !v.version_type || v.version_type === 'release') || candidates[0]
        );
      const project = await this.project(projectId);
      const predicates = modules().flatMap((owner) =>
        owner.depends?.[project.slug] ? [owner.depends[project.slug]] : [],
      );
      const ordered = [
        ...candidates.filter((v) => !v.version_type || v.version_type === 'release'),
        ...candidates.filter((v) => v.version_type && v.version_type !== 'release'),
      ];
      for (const candidate of ordered) {
        if (
          !predicates.every((predicate) =>
            fabricSatisfies(candidateModVersion(candidate.version_number), predicate),
          )
        )
          continue;
        if (satisfiesConstraints(await this.metadata(candidate, signal))) return candidate;
      }
      return undefined;
    };
    const visit = async (current: ModVersion, isRequired: boolean, currentKind: ContentKind) => {
      signal?.throwIfAborted();
      if (isRequired) required.add(current.project_id);
      const previous = versions.get(current.project_id);
      if (previous && previous.id !== current.id) {
        conflicts.add(
          t(
            'Dependencies require different versions of the same mod.',
            '依赖要求安装同一模组的不同版本。',
          ),
        );
        return;
      }
      if (previous) return;
      if (
        instance.side === 'server' &&
        (await this.project(current.project_id)).server_side === 'unsupported'
      )
        conflicts.add(
          `${current.name}: ${t('Client-only content cannot be installed on a server.', '仅客户端内容不能安装到服务端。')}`,
        );
      if (!compatible(current, instance, currentKind))
        conflicts.add(
          `${current.name}: ${t('This version is incompatible with the instance.', '该版本与实例不兼容。')}`,
        );
      versions.set(current.project_id, current);
      entryKinds.set(current.project_id, currentKind);
      if (useMetadata && currentKind === 'mod')
        selectedMetadata.set(current.project_id, await this.metadata(current, signal));
      for (const dependency of current.dependencies) {
        if (dependency.dependency_type === 'optional')
          optional.add(dependency.project_id || dependency.version_id || '');
        if (
          dependency.dependency_type !== 'required' &&
          !(includeOptional && dependency.dependency_type === 'optional')
        )
          continue;
        let dependencyKind = currentKind;
        if (currentKind !== 'mod' && dependency.project_id) {
          const project = await this.project(dependency.project_id);
          if (project.project_type !== 'modpack')
            dependencyKind = currentKind === 'plugin' ? 'plugin' : project.project_type;
        }
        const next = dependency.version_id
          ? await this.version(dependency.version_id)
          : dependency.project_id
            ? await dependencyVersion(dependency.project_id, undefined, dependencyKind)
            : undefined;
        if (!next) {
          conflicts.add(t('A required dependency is unavailable.', '无法获取必需依赖。'));
          continue;
        }
        if (
          currentKind !== 'mod' &&
          currentKind !== 'plugin' &&
          contentFile(next).filename.endsWith('.jar')
        )
          dependencyKind = 'mod';
        await visit(next, true, dependencyKind);
      }
      if (useMetadata)
        for (const module of selectedMetadata.get(current.project_id) || []) {
          for (const [dependencyId, predicate] of Object.entries(module.depends || {})) {
            if (['minecraft', 'java', 'fabricloader', 'quilt_loader'].includes(dependencyId))
              continue;
            if (
              modules().some(
                (value) =>
                  (value.id === dependencyId || value.provides?.includes(dependencyId)) &&
                  fabricSatisfies(value.version, predicate),
              )
            )
              continue;
            let project: ModProject | undefined;
            try {
              project = await this.project(dependencyId);
            } catch {
              if (dependencyId.startsWith('fabric-')) {
                try {
                  project = await this.project('fabric-api');
                } catch {}
              }
            }
            const next = project
              ? await dependencyVersion(project.id, undefined, 'mod')
              : undefined;
            if (!next) {
              conflicts.add(
                `${module.id}: ${t('missing dependency', '缺少前置')} ${dependencyId} ${JSON.stringify(predicate)}`,
              );
              continue;
            }
            await visit(next, true, 'mod');
          }
        }
    };
    await visit(version, false, kind);
    if (useMetadata) {
      const registry = new Map<string, string>();
      for (const module of modules())
        for (const id of [module.id, ...(module.provides || [])]) registry.set(id, module.version);
      registry.set('minecraft', instance.minecraft);
      if (instance.loader === 'fabric' && instance.loaderVersion)
        registry.set('fabricloader', instance.loaderVersion);
      const changedIds = new Set(
        [...selectedMetadata.values()]
          .flat()
          .flatMap((value) => [value.id, ...(value.provides || [])]),
      );
      for (const [owner, metadata] of [...existingMetadata, ...selectedMetadata]) {
        if (existingMetadata.has(owner) && versions.has(owner) && !selectedMetadata.has(owner))
          continue;
        if (
          existingMetadata.has(owner) &&
          selectedMetadata.has(owner) &&
          metadata === existingMetadata.get(owner)
        )
          continue;
        for (const module of metadata) {
          for (const [id, predicate] of Object.entries(module.depends || {})) {
            if (
              id === 'java' ||
              id === 'quilt_loader' ||
              (id === 'fabricloader' && instance.loader === 'quilt')
            )
              continue;
            if (!selectedMetadata.has(owner) && !changedIds.has(id)) continue;
            const found = registry.get(id);
            if (!found || !fabricSatisfies(found, predicate))
              conflicts.add(
                `${module.id}: ${id} ${JSON.stringify(predicate)} (${found || t('missing', '未安装')})`,
              );
          }
          for (const [id, predicate] of Object.entries(module.breaks || {})) {
            const found = registry.get(id);
            if (found && fabricSatisfies(found, predicate))
              conflicts.add(
                `${t('Incompatible mod', '不兼容模组')}: ${module.id} / ${id} ${found}`,
              );
          }
        }
      }
    }
    const present = new Map(
      installed.filter((i) => i.enabled && i.projectId).map((i) => [i.projectId!, i.versionId]),
    );
    for (const current of versions.values()) present.set(current.project_id, current.id);
    const inspect = (current: ModVersion) => {
      for (const dep of current.dependencies.filter((d) => d.dependency_type === 'incompatible')) {
        const found = dep.project_id
          ? present.has(dep.project_id) &&
            (!dep.version_id || present.get(dep.project_id) === dep.version_id)
          : [...present.values()].includes(dep.version_id);
        if (found)
          conflicts.add(
            `${t('Incompatible mod', '不兼容模组')}: ${current.name} / ${dep.project_id || dep.version_id}`,
          );
      }
      for (const dep of current.dependencies.filter(
        (d) =>
          d.dependency_type === 'required' &&
          d.version_id &&
          d.project_id &&
          versions.has(d.project_id),
      )) {
        if (present.get(dep.project_id!) !== dep.version_id)
          conflicts.add(`${current.name}: ${t('required version mismatch', '必需版本不匹配')}`);
      }
    };
    for (const current of versions.values()) inspect(current);
    for (const item of installed.filter(
      (i) => i.enabled && i.versionId && !versions.has(i.projectId || ''),
    ))
      inspect(await this.version(item.versionId!));
    return {
      entries: [...versions.values()].map((current) => {
        const old = installed.find(
          (i) =>
            i.projectId === current.project_id && i.kind === entryKinds.get(current.project_id),
        );
        return {
          version: current,
          kind: entryKinds.get(current.project_id)!,
          required: required.has(current.project_id),
          action: !old
            ? 'install'
            : old.versionId !== current.id
              ? 'update'
              : !old.enabled && required.has(current.project_id)
                ? 'enable'
                : 'installed',
        };
      }),
      optional: [...optional].filter(Boolean),
      conflicts: [...conflicts],
    };
  }

  async list(instance: ContentTarget, kind?: ContentKind): Promise<Content[]> {
    const known = await readJson<Content[]>(this.index(instance), []);
    const items: Content[] = [];
    for (const current of kind ? [kind] : (Object.keys(contentFolders) as ContentKind[])) {
      const folder = path.join(instance.directory, contentFolders[current]);
      for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isFile() || !/\.(jar|zip)(\.disabled)?$/i.test(entry.name)) continue;
        const saved = known.find((item) => item.kind === current && item.file === entry.name);
        items.push({
          ...saved,
          file: entry.name,
          name: saved?.name || entry.name.replace(/\.disabled$/, ''),
          kind: current,
          enabled: !entry.name.endsWith('.disabled'),
        });
      }
    }
    return items;
  }
  private async persist(instance: ContentTarget, items: Content[]) {
    await writeJson(this.index(instance), items);
  }
  async identify(instance: ContentTarget) {
    const items = await this.list(instance);
    const unknown = items.filter((i) => !i.projectId);
    const hashes = new Map<string, Content>();
    for (const item of unknown)
      hashes.set(
        await hashFile(path.join(instance.directory, contentFolders[item.kind], item.file)),
        item,
      );
    const entries = [...hashes.keys()];
    for (let i = 0; i < entries.length; i += 100) {
      const versions = await this.net.json<Record<string, ModVersion>>(`${api}/version_files`, {
        method: 'POST',
        body: { hashes: entries.slice(i, i + 100), algorithm: 'sha1' },
      });
      for (const [hash, version] of Object.entries(versions)) {
        const item = hashes.get(hash);
        if (item)
          Object.assign(item, { projectId: version.project_id, versionId: version.id, hash });
      }
    }
    await this.persist(instance, items);
    return items;
  }
  async install(
    instance: ContentTarget,
    version: ModVersion,
    kind: ContentKind,
    signal: AbortSignal,
    report: (text: string) => void,
    options: ContentInstallOptions = {},
  ) {
    const installed = await this.list(instance);
    const resolved = await this.plan(instance, version, kind, options.includeOptional, signal);
    if (resolved.conflicts.length) throw new Error(resolved.conflicts.join('\n'));
    const plan = resolved.entries.filter(
      (entry) => entry.action !== 'installed' || entry.version.id === version.id,
    );
    const stage = path.join(instance.directory, '.workbench', 'staging', randomUUID());
    await rejectSymlinkParents(instance.directory, stage);
    const changes: {
      current: ModVersion;
      kind: ContentKind;
      file: string;
      staged: string;
      hash: string;
    }[] = [];
    try {
      for (const item of plan) {
        const current = item.version;
        const file = contentFile(current, current.id === version.id ? options.filename : undefined);
        if (!file || !/\.(jar|zip)$/i.test(filename(file.filename)))
          throw new Error('Invalid content file');
        report(current.name);
        const staged = path.join(stage, item.kind, file.filename);
        const cachedJar = this.jarCache(current);
        if (
          cachedJar &&
          (await exists(cachedJar)) &&
          (await hashFile(cachedJar)) === file.hashes.sha1
        ) {
          await fs.mkdir(path.dirname(staged), { recursive: true });
          await fs.copyFile(cachedJar, staged);
        } else
          await this.net.download(file.url, staged, {
            signal,
            hash: file.hashes.sha512 || file.hashes.sha1,
            algorithm: file.hashes.sha512 ? 'sha512' : 'sha1',
            size: file.size,
            kind: 'modrinth',
          });
        changes.push({
          current,
          kind: item.kind,
          file: file.filename,
          staged,
          hash: file.hashes.sha1,
        });
      }
      signal.throwIfAborted();
      const original = structuredClone(installed);
      const prepared: {
        change: (typeof changes)[number];
        old?: Content;
        file: string;
        destination: string;
        history?: string;
      }[] = [];
      for (const change of changes) {
        const folder = path.join(instance.directory, contentFolders[change.kind]);
        await rejectSymlinkParents(instance.directory, path.join(folder, change.file));
        await fs.mkdir(folder, { recursive: true });
        const old = installed.find(
          (i) => i.projectId === change.current.project_id && i.kind === change.kind,
        );
        const enabled = resolved.entries.find(
          (e) => e.version.project_id === change.current.project_id,
        )?.required
          ? true
          : (old?.enabled ?? true);
        const file = change.file + (enabled ? '' : '.disabled');
        const destination = path.join(folder, file);
        await rejectSymlinkParents(instance.directory, destination);
        if ((await exists(destination)) && old?.file !== file)
          throw new Error(`${t('Filename already exists', '文件名已存在')}: ${file}`);
        if (prepared.some((p) => p.destination === destination))
          throw new Error(`Duplicate content filename: ${file}`);
        const entry: (typeof prepared)[number] = { change, old, file, destination };
        if (old) {
          const history = path.join(
            instance.directory,
            '.workbench',
            'history',
            `${Date.now()}-${randomUUID()}-${filename(old.file)}`,
          );
          await rejectSymlinkParents(instance.directory, history);
          await fs.mkdir(path.dirname(history), { recursive: true });
          await fs.copyFile(path.join(folder, filename(old.file)), history);
          entry.history = history;
        }
        prepared.push(entry);
      }
      const applied: typeof prepared = [];
      try {
        for (const { change, old, file, destination, history } of prepared) {
          const folder = path.dirname(destination);
          await fs.rename(change.staged, destination);
          applied.push({ change, old, file, destination, history });
          if (old && old.file !== file) await fs.rm(path.join(folder, filename(old.file)));
          const index = installed.findIndex(
            (i) => i.projectId === change.current.project_id && i.kind === change.kind,
          );
          const entry: Content = {
            file,
            kind: change.kind,
            enabled: !file.endsWith('.disabled'),
            name: change.current.name,
            projectId: change.current.project_id,
            versionId: change.current.id,
            hash: change.hash,
          };
          if (index >= 0) installed[index] = entry;
          else installed.push(entry);
        }
        await this.persist(instance, installed);
      } catch (error) {
        for (const entry of applied.reverse()) {
          await fs.rm(entry.destination, { force: true });
          if (entry.old && entry.history)
            await fs.copyFile(
              entry.history,
              path.join(path.dirname(entry.destination), filename(entry.old.file)),
            );
        }
        await this.persist(instance, original);
        throw error;
      }
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
  async toggle(instance: ContentTarget, item: Content) {
    const items = await this.list(instance);
    const entry = items.find((i) => i.file === item.file && i.kind === item.kind);
    if (!entry) return;
    const folder = path.join(instance.directory, contentFolders[item.kind]);
    await rejectSymlinkParents(instance.directory, path.join(folder, filename(item.file)));
    const file = item.enabled ? item.file + '.disabled' : item.file.replace(/\.disabled$/, '');
    if (await exists(path.join(folder, file))) throw new Error('Target filename already exists');
    await fs.rename(path.join(folder, filename(item.file)), path.join(folder, filename(file)));
    entry.file = file;
    entry.enabled = !item.enabled;
    await this.persist(instance, items);
  }
  async remove(instance: ContentTarget, item: Content) {
    await rejectSymlinkParents(
      instance.directory,
      path.join(instance.directory, contentFolders[item.kind], filename(item.file)),
    );
    await fs.rm(path.join(instance.directory, contentFolders[item.kind], filename(item.file)));
    await this.persist(
      instance,
      (await this.list(instance)).filter((i) => i.file !== item.file || i.kind !== item.kind),
    );
  }
  async updates(instance: ContentTarget) {
    const items = await this.identify(instance);
    const result: { item: Content; version: ModVersion }[] = [];
    for (const item of items.filter((i) => i.projectId)) {
      const channel = config<string>('contentReleaseChannel', 'release');
      const next = (await this.versions(item.projectId!, instance, item.kind)).find(
        (version) =>
          channel === 'all' ||
          (channel === 'beta' && version.version_type !== 'alpha') ||
          !version.version_type ||
          version.version_type === 'release',
      );
      if (next && next.id !== item.versionId) result.push({ item, version: next });
    }
    return result;
  }
  async conflicts(instance: ContentTarget): Promise<string[]> {
    const items = (await this.list(instance)).filter((i) => i.enabled && i.kind === 'mod');
    const warnings: string[] = [];
    const localModules: FabricModule[] = [];
    let remoteUnavailable = false;
    const ids = new Map<string, string>();
    for (const item of items) {
      if (instance.loader === 'vanilla')
        warnings.push(`${item.name}: ${t('requires a mod loader', '需要模组加载器')}`);
      try {
        const zip = new AdmZip(path.join(instance.directory, 'mods', item.file));
        const fabric = zip.getEntry('fabric.mod.json');
        if (fabric) {
          localModules.push(
            ...readFabricMetadata(path.join(instance.directory, 'mods', item.file)),
          );
          const meta = JSON.parse(fabric.getData().toString());
          if (ids.has(meta.id)) warnings.push(`${meta.id}: ${ids.get(meta.id)} / ${item.file}`);
          ids.set(meta.id, item.file);
          if (!['fabric', 'quilt'].includes(instance.loader))
            warnings.push(`${item.name}: Fabric / Quilt ${t('required', '必需')}`);
        }
      } catch {
        warnings.push(`${item.file}: ${t('unreadable mod archive', '无法读取模组文件')}`);
      }
      if (item.versionId && !remoteUnavailable) {
        try {
          const version = await this.net.json<ModVersion>(`${api}/version/${item.versionId}`);
          if (
            !version.game_versions.includes(instance.minecraft) ||
            !version.loaders.includes(instance.loader)
          )
            warnings.push(`${item.name}: ${t('version or loader mismatch', '版本或加载器不匹配')}`);
          for (const dep of version.dependencies) {
            const found = items.some((i) =>
              dep.project_id
                ? i.projectId === dep.project_id &&
                  (!dep.version_id || i.versionId === dep.version_id)
                : i.versionId === dep.version_id,
            );
            if (
              (dep.dependency_type === 'required' && !found) ||
              (dep.dependency_type === 'incompatible' && found)
            )
              warnings.push(
                `${item.name}: ${dep.dependency_type} ${dep.project_id || dep.version_id}`,
              );
          }
        } catch (error) {
          if (error instanceof HttpError) warnings.push(`${item.name}: HTTP ${error.status}`);
          else {
            remoteUnavailable = true;
            warnings.push(
              t(
                'Online metadata unavailable; local checks only.',
                '在线元数据不可用，仅完成本地检查。',
              ),
            );
          }
        }
      }
    }
    if (['fabric', 'quilt'].includes(instance.loader)) {
      const native: Record<string, string> = { minecraft: instance.minecraft };
      if (instance.loader === 'fabric' && instance.loaderVersion)
        native.fabricloader = instance.loaderVersion;
      for (const issue of fabricDiagnostics(localModules, native))
        warnings.push(
          `${issue.owner}: ${issue.type === 'required' ? t('requires', '需要') : t('incompatible with', '不兼容')} ${issue.dependency} ${JSON.stringify(issue.expected)} (${issue.actual || t('missing', '未安装')})`,
        );
    }
    return [...new Set(warnings)];
  }
  async importPack(
    archive: string,
    instance: Instance,
    signal: AbortSignal,
    report: (text: string) => void,
  ) {
    const zip = new AdmZip(archive);
    const entry = zip.getEntry('modrinth.index.json');
    if (!entry) throw new Error('Not a Modrinth modpack');
    if (entry.header.size > 16 * 1024 ** 2) throw new Error('Modpack index exceeds size limit');
    const index = JSON.parse(entry.getData().toString()) as {
      formatVersion: number;
      game: string;
      dependencies: Record<string, string>;
      files: {
        path: string;
        hashes: { sha1: string };
        downloads: string[];
        fileSize: number;
        env?: { client?: string };
      }[];
    };
    if (index.formatVersion !== 1 || index.game !== 'minecraft')
      throw new Error('Unsupported modpack format');
    instance.minecraft = index.dependencies.minecraft;
    if (!instance.minecraft) throw new Error('Modpack has no Minecraft version');
    for (const [key, loader] of Object.entries({
      'fabric-loader': 'fabric',
      'quilt-loader': 'quilt',
      forge: 'forge',
      neoforge: 'neoforge',
    } as const)) {
      if (index.dependencies[key]) {
        instance.loader = loader;
        instance.loaderVersion = index.dependencies[key];
      }
    }
    for (const file of index.files) {
      signal.throwIfAborted();
      if (file.env?.client === 'unsupported' || file.env?.client === 'optional') continue;
      if (path.posix.normalize(file.path).startsWith('.') || file.path.startsWith('/'))
        throw new Error('Reserved modpack path');
      const destination = within(instance.directory, file.path);
      await rejectSymlinkParents(instance.directory, destination);
      if (!file.hashes.sha1 || !file.downloads.length)
        throw new Error('Modpack file has no hash or URL');
      report(file.path);
      let last: unknown;
      let done = false;
      for (const url of file.downloads) {
        if (!url.startsWith('https://')) throw new Error('Modpack URLs must use HTTPS');
        try {
          await this.net.download(url, destination, {
            signal,
            hash: file.hashes.sha1,
            size: file.fileSize,
            kind: 'modrinth',
          });
          done = true;
          break;
        } catch (error) {
          last = error;
          if (signal.aborted) throw error;
        }
      }
      if (!done) throw last;
    }
    for (const prefix of ['overrides/', 'client-overrides/']) {
      for (const file of zip.getEntries().filter((e) => e.entryName.startsWith(prefix))) {
        if (path.posix.normalize(file.entryName.slice(prefix.length)).startsWith('.'))
          throw new Error('Reserved modpack override path');
      }
      await extractZip(archive, instance.directory, 0, prefix);
    }
  }
}
