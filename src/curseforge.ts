import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import AdmZip from 'adm-zip';
import { Network, HttpError } from './network';
import { Instance, Loader } from './models';
import { config, t } from './config';
import { extractZip, filename, hashFile, within, writeJson } from './files';
import { waitFor } from './abort';
import {
  PackFile,
  packDestination,
  validPackFile,
  copyPackFile,
  savePackFiles,
  managedPackPath,
} from './pack-files';

const api = 'https://api.curseforge.com/v1';
const origins = [
  'https://api.curseforge.com',
  'https://edge.forgecdn.net',
  'https://mediafilez.forgecdn.net',
  'https://media.forgecdn.net',
];
const secretKey = 'minecraftWorkbench.curseforgeApiKey';
interface Reference {
  projectID: number;
  fileID: number;
  required?: boolean;
}
interface Manifest {
  manifestType: 'minecraftModpack';
  manifestVersion: number;
  name?: string;
  minecraft: { version: string; modLoaders: { id: string; primary?: boolean }[] };
  overrides?: string;
  files: Reference[];
}
interface ApiFile {
  id: number;
  modId: number;
  gameId: number;
  fileName: string;
  fileLength: number;
  downloadUrl?: string | null;
  hashes: { algo: number; value: string }[];
}
interface ApiMod {
  id: number;
  gameId: number;
  classId: number;
  allowModDistribution?: boolean | null;
  links: { websiteUrl: string };
}
export function curseforgeManifest(archive: string): Manifest {
  const entry = new AdmZip(archive).getEntry('manifest.json');
  if (!entry || entry.header.size > 8 * 1024 ** 2) throw new Error('Invalid CurseForge manifest.');
  const value = JSON.parse(entry.getData().toString('utf8')) as Manifest;
  if (
    value.manifestType !== 'minecraftModpack' ||
    value.manifestVersion !== 1 ||
    typeof value.minecraft?.version !== 'string' ||
    !Array.isArray(value.files) ||
    value.files.length > 10000 ||
    !Array.isArray(value.minecraft.modLoaders)
  )
    throw new Error('Unsupported CurseForge manifest.');
  filename(value.minecraft.version);
  for (const file of value.files)
    if (![file.projectID, file.fileID].every((id) => Number.isSafeInteger(id) && id > 0))
      throw new Error('Invalid CurseForge file reference.');
  return value;
}
export class CurseForge {
  private readonly active = new Set<AbortController>();
  constructor(
    private readonly net: Network,
    private readonly secrets: Pick<vscode.SecretStorage, 'get' | 'store' | 'delete'>,
    private readonly chooseFiles: (
      files: PackFile[],
      signal: AbortSignal,
    ) => Promise<string[]> = manualDownloads,
  ) {}
  get enabled() {
    return config<unknown>('curseforge.enabled', false) === true;
  }
  async hasKey() {
    return !!(await this.secrets.get(secretKey));
  }
  async configure() {
    const key = await vscode.window.showInputBox({
      title: t('CurseForge API Key', 'CurseForge API 密钥'),
      password: true,
      ignoreFocusOut: true,
      prompt: t(
        'Used only for CurseForge downloads (Beta). Empty removes the saved key.',
        '仅用于 CurseForge 下载（Beta）。留空删除已保存的密钥。',
      ),
      validateInput: (value) =>
        /[\r\n\0]/.test(value) ? t('Invalid API key.', 'API 密钥无效。') : undefined,
    });
    if (key === undefined) return;
    if (key.trim()) await this.secrets.store(secretKey, key.trim());
    else await this.secrets.delete(secretKey);
  }
  configurationChanged() {
    if (!this.enabled) for (const controller of this.active) controller.abort();
  }
  dispose() {
    for (const controller of this.active) controller.abort();
  }
  private async client<T>(
    signal: AbortSignal,
    work: (net: Network, signal: AbortSignal) => Promise<T>,
  ) {
    if (!this.enabled)
      throw new Error(
        t(
          'CurseForge downloads (Beta) are disabled. Use local files or enable the setting.',
          'CurseForge 下载（Beta）已关闭，请使用本地文件或开启设置。',
        ),
      );
    const key = await waitFor(Promise.resolve(this.secrets.get(secretKey)), signal);
    if (!this.enabled) throw new DOMException('Cancelled', 'AbortError');
    signal.throwIfAborted();
    if (!key)
      throw new Error(
        t(
          'Configure a CurseForge API key in Workbench → Settings.',
          '请在工作台 → 设置中配置 CurseForge API 密钥。',
        ),
      );
    const controller = new AbortController();
    this.active.add(controller);
    const net = new Network({
      ...this.net.options,
      sources: {},
      originHeaders: Object.fromEntries(origins.map((origin) => [origin, { 'x-api-key': key }])),
    });
    try {
      return await work(net, AbortSignal.any([signal, controller.signal]));
    } catch (error) {
      if (error instanceof HttpError && [401, 403].includes(error.status))
        throw new Error(
          t(
            'CurseForge rejected the API key. Configure the key again.',
            'CurseForge 拒绝了 API 密钥，请重新配置。',
          ),
        );
      throw error;
    } finally {
      this.active.delete(controller);
      await net.close();
    }
  }
  private async resolve(net: Network, refs: Reference[], signal: AbortSignal): Promise<PackFile[]> {
    const records: PackFile[] = [];
    for (let offset = 0; offset < refs.length; offset += 50) {
      const batch = refs.slice(offset, offset + 50);
      const [files, mods] = await Promise.all([
        net.json<{ data: ApiFile[] }>(`${api}/mods/files`, {
          method: 'POST',
          body: { fileIds: batch.map((file) => file.fileID) },
          signal,
          bypassSources: true,
        }),
        net.json<{ data: ApiMod[] }>(`${api}/mods`, {
          method: 'POST',
          body: { modIds: [...new Set(batch.map((file) => file.projectID))] },
          signal,
          bypassSources: true,
        }),
      ]);
      for (const ref of batch) {
        const file = files.data.find(
          (value) =>
            value.id === ref.fileID && value.modId === ref.projectID && value.gameId === 432,
        );
        const mod = mods.data.find((value) => value.id === ref.projectID && value.gameId === 432);
        if (!file || !mod)
          throw new Error(
            `CurseForge file metadata is unavailable: ${ref.projectID}/${ref.fileID}`,
          );
        const folder = (
          { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' } as Record<number, string>
        )[mod.classId];
        if (!folder) throw new Error(`Unsupported CurseForge content type: ${mod.classId}`);
        if (!(folder === 'mods' ? /\.jar$/i : /\.zip$/i).test(file.fileName))
          throw new Error('Invalid CurseForge content filename.');
        const hash =
          file.hashes.find((value) => value.algo === 1) ||
          file.hashes.find((value) => value.algo === 2);
        if (!hash || !Number.isSafeInteger(file.fileLength) || file.fileLength <= 0)
          throw new Error('Invalid CurseForge file metadata.');
        const website = new URL(mod.links.websiteUrl);
        if (website.protocol !== 'https:' || website.hostname !== 'www.curseforge.com')
          throw new Error('Invalid CurseForge project URL.');
        website.pathname = website.pathname.replace(/\/$/, '') + `/files/${ref.fileID}`;
        website.search = '';
        website.hash = '';
        const url = file.downloadUrl ? new URL(file.downloadUrl) : undefined;
        const allowed =
          url && origins.slice(1).includes(url.origin) && !url.username && !url.password;
        records.push({
          path: `${folder}/${filename(file.fileName)}`,
          hash: hash.value.toLowerCase(),
          algorithm: hash.algo === 1 ? 'sha1' : 'md5',
          size: file.fileLength,
          urls: allowed && mod.allowModDistribution !== false ? [url.href] : [],
          source: 'curseforge',
          projectId: ref.projectID,
          fileId: ref.fileID,
          website: website.href,
        });
      }
    }
    if (new Set(records.map((file) => file.path.toLowerCase())).size !== records.length)
      throw new Error('CurseForge files have conflicting names.');
    return records;
  }
  private async restore(
    instance: Instance,
    records: PackFile[],
    net: Network | undefined,
    signal: AbortSignal,
    report: (text: string) => void,
  ) {
    const manual: PackFile[] = [];
    for (const record of records) {
      const destination = await packDestination(instance, record);
      if (await validPackFile(destination, record, signal)) continue;
      report(record.path);
      if (!net || !record.urls.length) {
        manual.push(record);
        continue;
      }
      try {
        await net.download(record.urls[0], destination, {
          signal,
          hash: record.hash,
          algorithm: record.algorithm,
          size: record.size,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        if (/HTTP 40[13]/.test(String(error))) manual.push(record);
        else throw error;
      }
    }
    if (manual.length) {
      const selected = await this.chooseFiles(manual, signal);
      for (const record of manual) {
        let found: string | undefined;
        for (const source of selected)
          if (await validPackFile(source, record, signal)) {
            found = source;
            break;
          }
        if (!found)
          throw new Error(
            t(`Select the original file for ${record.path}.`, `请为 ${record.path} 选择原文件。`),
          );
        await copyPackFile(found, await packDestination(instance, record), record, signal);
      }
    }
  }
  async repair(
    instance: Instance,
    files: PackFile[],
    signal: AbortSignal,
    report: (text: string) => void,
  ) {
    if (!this.enabled) return this.restore(instance, files, undefined, signal, report);
    return this.client(signal, async (net, signal) => {
      const resolved = await this.resolve(
        net,
        files.map((file) => ({ projectID: file.projectId!, fileID: file.fileId! })),
        signal,
      );
      // Keep paths and versions from the installed pack, including renamed files.
      for (let i = 0; i < resolved.length; i++) {
        resolved[i].path = files[i].path;
        resolved[i].disabled = files[i].disabled;
        resolved[i].hash = files[i].hash;
        resolved[i].algorithm = files[i].algorithm;
        resolved[i].size = files[i].size;
      }
      await this.restore(instance, resolved, net, signal, report);
    });
  }
  async importPack(
    archive: string,
    instance: Instance,
    signal: AbortSignal,
    report: (text: string) => void,
  ) {
    const manifest = curseforgeManifest(archive);
    const automatic = this.enabled;
    instance.minecraft = manifest.minecraft.version;
    const loaders = manifest.minecraft.modLoaders;
    const primary = loaders.filter((loader) => loader.primary);
    if (primary.length > 1 || (!primary.length && loaders.length > 1))
      throw new Error('Choose a single primary mod loader.');
    const loader = primary[0] || loaders[0];
    if (loader) {
      const match = /^(forge|neoforge|fabric|quilt)-(.+)$/.exec(loader.id);
      if (!match) throw new Error('Unsupported CurseForge mod loader.');
      instance.loader = match[1] as Loader;
      instance.loaderVersion = filename(
        match[2].startsWith(instance.minecraft + '-')
          ? match[2].slice(instance.minecraft.length + 1)
          : match[2],
      );
    }
    const prefix = (manifest.overrides || 'overrides').replace(/\/$/, '') + '/';
    within(instance.directory, prefix.slice(0, -1));
    const zip = new AdmZip(archive);
    for (const entry of zip.getEntries().filter((entry) => entry.entryName.startsWith(prefix))) {
      const relative = entry.entryName.slice(prefix.length);
      if (relative && relative.split('/').some((part) => part.startsWith('.')))
        throw new Error('Reserved modpack override path.');
    }
    let records: PackFile[] = [];
    const refs = [
      ...new Map(
        manifest.files.filter((file) => file.required !== false).map((file) => [file.fileID, file]),
      ).values(),
    ];
    if (automatic && refs.length)
      await this.client(signal, async (net, signal) => {
        records = await this.resolve(net, refs, signal);
        await this.restore(instance, records, net, signal, report);
      });
    await extractZip(archive, instance.directory, 0, prefix, signal);
    const overrides = new Set(
      zip
        .getEntries()
        .filter((entry) => entry.entryName.startsWith(prefix))
        .map((entry) => entry.entryName.slice(prefix.length)),
    );
    records = records.filter((record) => !overrides.has(record.path));
    for (const entry of zip.getEntries()) {
      const relative = entry.entryName.startsWith(prefix)
        ? entry.entryName.slice(prefix.length)
        : '';
      if (!entry.isDirectory && managedPackPath(relative)) {
        const file = within(instance.directory, relative);
        records.push({
          path: relative,
          hash: await hashFile(file, 'sha1', signal),
          algorithm: 'sha1',
          size: entry.header.size,
          source: 'local',
          urls: [],
          archive,
          entry: entry.entryName,
        });
      }
    }
    if (!automatic && refs.length) {
      const selected = await localPackFiles(refs.length, records.length, signal);
      for (const source of selected) {
        const name = filename(path.basename(source));
        if (!/\.(jar|zip)$/i.test(name)) throw new Error('Select a JAR or ZIP content file.');
        const folder = /\.jar$/i.test(name)
          ? 'mods'
          : source.replaceAll('\\', '/').includes('/shaderpacks/')
            ? 'shaderpacks'
            : 'resourcepacks';
        const record: PackFile = {
          path: `${folder}/${name}`,
          hash: await hashFile(source, 'sha1', signal),
          algorithm: 'sha1',
          size: (await fs.stat(source)).size,
          source: 'local',
          urls: [],
          localFile: source,
        };
        await copyPackFile(source, within(instance.directory, record.path), record, signal);
        records = records.filter((file) => file.path !== record.path);
        records.push(record);
      }
    }
    await savePackFiles(instance, records);
    await writeJson(
      path.join(instance.directory, '.workbench', 'curseforge-manifest.json'),
      manifest,
    );
  }
}

async function localPackFiles(references: number, included: number, signal: AbortSignal) {
  const choose = t('Choose local files', '选择本地文件'),
    use = t('Use included files', '使用包内文件');
  const selected = await waitFor(
    Promise.resolve(
      vscode.window.showQuickPick([choose, ...(included ? [use] : [])], {
        title: t(
          'CurseForge: local import (IDs unverified)',
          'CurseForge：本地导入（未校验文件 ID）',
        ),
        placeHolder: t(
          `${references} file references; ${included} files included. Offline import cannot verify CurseForge IDs.`,
          `清单引用 ${references} 个文件，包内包含 ${included} 个文件。离线导入无法校验 CurseForge 文件 ID。`,
        ),
      }),
    ),
    signal,
  );
  if (!selected) throw new DOMException('Cancelled', 'AbortError');
  if (selected === use) return [];
  const files = await waitFor(
    Promise.resolve(
      vscode.window.showOpenDialog({
        canSelectMany: true,
        filters: { 'Local pack files': ['jar', 'zip'] },
      }),
    ),
    signal,
  );
  if (!files?.length) throw new DOMException('Cancelled', 'AbortError');
  return files.map((file) => file.fsPath);
}
async function manualDownloads(files: PackFile[], signal: AbortSignal): Promise<string[]> {
  while (true) {
    const pick = await waitFor(
      Promise.resolve(
        vscode.window.showQuickPick(
          [
            { label: t('Select downloaded files…', '选择已下载的文件…'), file: undefined },
            ...files.map((file) => ({
              label: path.basename(file.path),
              description: file.website,
              file,
            })),
          ],
          {
            title: t('Files requiring manual download', '需要手动下载的文件'),
            placeHolder: t(
              'Open a file page, then select the original downloaded files.',
              '打开文件页面，然后选择下载的原文件。',
            ),
          },
        ),
      ),
      signal,
    );
    if (!pick) throw new DOMException('Cancelled', 'AbortError');
    if (pick.file?.website) {
      await vscode.env.openExternal(vscode.Uri.parse(pick.file.website));
      continue;
    }
    const selected = await waitFor(
      Promise.resolve(
        vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: { 'Pack files': ['jar', 'zip'] },
        }),
      ),
      signal,
    );
    if (!selected?.length) throw new DOMException('Cancelled', 'AbortError');
    return selected.map((file) => file.fsPath);
  }
}
