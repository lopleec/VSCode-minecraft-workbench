import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MinecraftFolder, Version } from '@xmcl/core';
import {
  createNodeInstallRuntime,
  executeInstallManifest,
  executeInstallWorkflow,
  resolveMinecraftJarInstallFile,
  resolveLibraryInstallFiles,
  resolveAssetMetadataInstallFiles,
  resolveAssetObjectInstallFiles,
  createModernForgeInstallWorkflow,
  createLegacyForgeInstallWorkflow,
  InstallFile,
} from '@xmcl/installer';
import { Network } from './network';
import { Java, preferredJava } from './java';
import { Instance, Loader, VersionManifest } from './models';
import { filename, hashFile, redact, rejectSymlinkParents, writeJson, exists } from './files';
import { runtimeDirectory } from './game-paths';
import {
  backupVersionProfile,
  repairVersionChain,
  restoreVersionProfiles,
  UnavailableProfile,
} from './version-repair';
import { t } from './config';
import { loaderInfo } from './instance-import';

const exec = promisify(execFile);
interface RuntimeServices {
  net: Network;
  java: Java;
  output: Pick<vscode.LogOutputChannel, 'append'>;
  manifest(signal: AbortSignal): Promise<VersionManifest>;
  loaders(loader: Loader, minecraft: string, signal: AbortSignal): Promise<string[]>;
}
export async function installRuntime(
  instance: Instance,
  services: RuntimeServices,
  signal: AbortSignal,
  report: (message: string) => void,
): Promise<{ versionId: string; loaderVersion?: string }> {
  const root = runtimeDirectory(instance);
  const folder = new MinecraftFolder(root);
  let loaderVersion = instance.loaderVersion;
  if (!loaderVersion && instance.loader !== 'vanilla' && instance.versionId) {
    const existing = await Version.parse(root, instance.versionId).catch(() => undefined);
    if (existing) {
      const detected = loaderInfo(existing.libraries, instance.minecraft);
      if (detected.loader === instance.loader) loaderVersion = detected.loaderVersion;
    }
  }
  const download = async (requested: InstallFile[]) => {
    const files = [...new Map(requested.map((file) => [file.path, file])).values()];
    let index = 0;
    let complete = 0;
    const batch = new AbortController();
    const downloadSignal = AbortSignal.any([signal, batch.signal]);
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(services.net.options.concurrency, files.length) }, async () => {
        try {
          while (index < files.length) {
            downloadSignal.throwIfAborted();
            const file = files[index++];
            const relative = path.relative(root, file.path);
            if (
              !relative ||
              relative === '..' ||
              relative.startsWith('..' + path.sep) ||
              path.isAbsolute(relative)
            )
              throw new Error('Runtime file escapes the Minecraft directory.');
            await rejectSymlinkParents(root, file.path);
            let success = false;
            let lastError: unknown;
            for (const url of file.urls) {
              try {
                await services.net.download(url, file.path, {
                  signal: downloadSignal,
                  hash: file.checksum?.value,
                  algorithm: file.checksum?.algorithm,
                  size: file.size,
                });
                success = true;
                break;
              } catch (error) {
                lastError = error;
                if (downloadSignal.aborted) throw error;
              }
            }
            if (!success) throw lastError || new Error('No download URL');
            report(`${++complete} / ${files.length}`);
          }
        } catch (error) {
          batch.abort(error);
          throw error;
        }
      }),
    );
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) throw failure.reason;
  };
  const runtime = createNodeInstallRuntime({
    signal,
    download,
    checksum: (file, algorithm) => hashFile(file, algorithm, signal),
    runJava: async (command) => {
      report(t('Running Forge processors', '运行 Forge 处理器'));
      const execution = exec(command.executable, command.args, {
        cwd: command.cwd,
        env: { ...process.env, ...command.env },
        signal,
        timeout: 15 * 60 * 1000,
        maxBuffer: 16 * 1024 ** 2,
        windowsHide: true,
      });
      for (const stream of [execution.child.stdout, execution.child.stderr])
        stream?.on('data', (chunk: Buffer | string) =>
          services.output.append(redact(String(chunk))),
        );
      await execution;
    },
  });
  const installFiles = async (files: InstallFile[]) =>
    executeInstallManifest(
      { schemaVersion: 1, tasks: [{ id: 'files', type: 'files', files }] },
      runtime,
      { signal },
    );

  let manifest: Promise<VersionManifest> | undefined;
  const official = async (id: string) => {
    const entry = (await (manifest ??= services.manifest(signal))).versions.find(
      (v) => v.id === id,
    );
    if (!entry) return false;
    filename(id);
    const file = path.join(root, 'versions', id, id + '.json');
    await rejectSymlinkParents(root, file);
    if (
      entry.sha1 &&
      (await exists(file)) &&
      (await hashFile(file, 'sha1', signal)) === entry.sha1.toLowerCase()
    )
      return true;
    await backupVersionProfile(root, id);
    await services.net.download(entry.url, file, { hash: entry.sha1, signal, kind: 'manifest' });
    return true;
  };
  const clientFiles = async (resolved: Awaited<ReturnType<typeof Version.parse>>) => {
    const jar = resolveMinecraftJarInstallFile(resolved);
    if (jar) await installFiles([jar]);
    await installFiles(resolveLibraryInstallFiles(resolved.libraries, folder));
  };
  const assets = async (resolved: Awaited<ReturnType<typeof Version.parse>>) => {
    await installFiles(resolveAssetMetadataInstallFiles(resolved, folder));
    await installFiles(await resolveAssetObjectInstallFiles(resolved, folder));
  };
  const installLoader = async (resolved: Awaited<ReturnType<typeof Version.parse>>) => {
    let versionId = instance.minecraft;
    const selected =
      loaderVersion ||
      (!instance.installed && !instance.preserveVersion
        ? (await services.loaders(instance.loader, instance.minecraft, signal))[0]
        : undefined);
    if (!selected)
      throw new Error(
        t(
          'Select a loader version before repairing this instance.',
          '请先为此实例选择加载器版本，再执行修复。',
        ),
      );
    filename(selected);
    loaderVersion = selected;
    if (instance.loader === 'fabric' || instance.loader === 'quilt') {
      const fabric = instance.loader === 'fabric';
      const host = fabric ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
      const profile = await services.net.json<{
        id: string;
        libraries?: (Version.Library & {
          sha1?: string;
          size?: number;
          downloads?: { artifact: Version.Artifact };
        })[];
      }>(
        `${host}/versions/loader/${encodeURIComponent(instance.minecraft)}/${encodeURIComponent(loaderVersion)}/profile/json`,
        { signal },
      );
      for (const library of profile.libraries || []) {
        if (library.sha1 && !library.downloads?.artifact) {
          const resolved = Version.resolveLibrary(library);
          if (resolved)
            library.downloads = {
              ...library.downloads,
              artifact: {
                ...resolved.download,
                sha1: library.sha1,
                size: library.size ?? -1,
              },
            };
        }
      }
      versionId = filename(profile.id);
      await writeJson(path.join(root, 'versions', versionId, `${versionId}.json`), profile);
    } else {
      const java = await services.java.ensure(
        resolved.javaVersion?.majorVersion || 8,
        signal,
        report,
        preferredJava(instance.java),
      );
      const neo = instance.loader === 'neoforge';
      const artifact = neo ? loaderVersion : `${instance.minecraft}-${loaderVersion}`;
      const base = neo
        ? 'https://maven.neoforged.net/releases/net/neoforged/neoforge'
        : 'https://maven.minecraftforge.net/net/minecraftforge/forge';
      const name = neo ? 'neoforge' : 'forge';
      report(t('Installing mod loader', '安装模组加载器'));
      const installerFile: InstallFile = {
        path: path.join(root, 'installers', `${name}-${artifact}-installer.jar`),
        urls: [`${base}/${artifact}/${name}-${artifact}-installer.jar`],
        validator: 'zip',
      };
      const [major, minor] = instance.minecraft.split('.').map(Number);
      if (!neo && major === 1 && minor < 6) {
        const workflow = createLegacyForgeInstallWorkflow({
          id: 'forge',
          minecraft: folder,
          minecraftVersion: instance.minecraft,
          artifactVersion: artifact,
          universal: {
            ...installerFile,
            urls: [`${base}/${artifact}/${name}-${artifact}-universal.jar`],
            path: installerFile.path.replace('-installer.jar', '-universal.jar'),
          },
          installOptions: {},
        });
        versionId = await executeInstallWorkflow(workflow, runtime, { signal });
      } else {
        const workflow = createModernForgeInstallWorkflow({
          id: name,
          minecraft: folder,
          minecraftVersion: instance.minecraft,
          installer: installerFile,
          artifactVersion: artifact,
          java: java.path,
          installOptions: { java: java.path, signal },
        });
        versionId = (await executeInstallWorkflow(workflow, runtime, { signal })).version;
      }
    }
    return { versionId, loaderVersion };
  };
  let versionId = instance.versionId || instance.minecraft;
  if (instance.preserveVersion && instance.versionId) {
    let profiles;
    let rebuilt = false;
    try {
      profiles = await repairVersionChain(root, versionId, signal, official);
    } catch (error) {
      if (
        !(error instanceof UnavailableProfile) ||
        error.id !== versionId ||
        instance.loader === 'vanilla' ||
        !loaderVersion
      )
        throw error;
      await repairVersionChain(root, instance.minecraft, signal, official);
      const base = await Version.parse(root, instance.minecraft);
      const jar = resolveMinecraftJarInstallFile(base);
      if (jar) await installFiles([jar]);
      await backupVersionProfile(root, versionId);
      const generated = await installLoader(base);
      if (generated.versionId !== versionId)
        await writeJson(folder.getVersionJson(versionId), {
          id: versionId,
          inheritsFrom: generated.versionId,
        });
      profiles = await repairVersionChain(root, versionId, signal, official);
      rebuilt = true;
      const message = t(
        'Recreated the loader profile; custom settings require the original profile backup.',
        '已重建加载器配置；自定义配置需从原配置备份恢复。',
      );
      report(message);
      services.output.append(message + '\n');
    }
    if (!rebuilt && ['forge', 'neoforge'].includes(instance.loader) && loaderVersion) {
      await repairVersionChain(root, instance.minecraft, signal, official);
      const base = await Version.parse(root, instance.minecraft);
      const jar = resolveMinecraftJarInstallFile(base);
      if (jar) await installFiles([jar]);
      for (const profile of profiles)
        await backupVersionProfile(root, path.basename(profile.file, '.json'));
      try {
        await installLoader(base);
      } finally {
        await restoreVersionProfiles(profiles);
      }
    }
    const resolved = await Version.parse(root, versionId);
    await clientFiles(resolved);
    await assets(resolved);
  } else {
    if (!(await official(instance.minecraft))) throw new Error('Minecraft version not found');
    let resolved = await Version.parse(root, instance.minecraft);
    await clientFiles(resolved);
    versionId = instance.minecraft;
    if (instance.loader !== 'vanilla') {
      const generated = await installLoader(resolved);
      versionId = generated.versionId;
      loaderVersion = generated.loaderVersion;
      resolved = await Version.parse(root, versionId);
      await clientFiles(resolved);
    }
    await assets(resolved);
  }
  signal.throwIfAborted();
  const natives = path.join(instance.directory, '.workbench', 'natives');
  await rejectSymlinkParents(instance.directory, natives);
  await fs.rm(natives, { recursive: true, force: true });
  return { versionId, loaderVersion };
}
