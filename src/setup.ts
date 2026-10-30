import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { Minecraft } from './minecraft';
import { Instance, Loader } from './models';
import { t, trusted } from './config';
import { validateInstanceSettings } from './instance-settings';
import { minecraftDirectory, reserveInstanceLocation, writeInstanceMetadata } from './game-paths';

export class InstanceSetup {
  constructor(
    private readonly store: Store,
    private readonly minecraft: Minecraft,
  ) {}

  async save(value: unknown, existing?: Instance): Promise<Instance> {
    await trusted();
    if (!value || typeof value !== 'object') throw new Error('Invalid instance settings');
    if (existing) this.minecraft.assertIdle(existing);
    const input = value as Record<string, unknown>;
    const manifest = await this.minecraft.manifest();
    const version = manifest.versions.find((entry) => entry.id === input.minecraft);
    if (!version) throw new Error(t('Select a Minecraft version.', '请选择 Minecraft 版本。'));
    const loader = input.loader as Loader;
    if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(loader))
      throw new Error('Invalid mod loader');
    let loaderVersion: string | undefined;
    if (loader !== 'vanilla') {
      const available = await this.minecraft.loaders(loader, version.id);
      if (typeof input.loaderVersion !== 'string' || !available.includes(input.loaderVersion))
        throw new Error(t('Select a compatible loader version.', '请选择兼容的加载器版本。'));
      loaderVersion = input.loaderVersion;
    }
    const settings = validateInstanceSettings({ ...existing, ...input }, this.store.state.accounts);
    if (existing) {
      this.minecraft.assertIdle(existing);
      const changed =
        existing.minecraft !== version.id ||
        existing.loader !== loader ||
        existing.loaderVersion !== loaderVersion;
      if (changed && existing.linked)
        throw new Error(
          t(
            'Duplicate this linked instance before changing its version.',
            '请先复制原地管理的实例，再更改版本。',
          ),
        );
      const previous = { ...existing };
      Object.assign(existing, settings, { minecraft: version.id, loader, loaderVersion });
      if (changed) {
        existing.installed = false;
        existing.versionId = undefined;
        existing.preserveVersion = false;
      }
      try {
        await writeInstanceMetadata(existing);
        await this.store.save();
      } catch (error) {
        for (const key of Object.keys(existing))
          delete (existing as unknown as Record<string, unknown>)[key];
        Object.assign(existing, previous);
        await writeInstanceMetadata(existing).catch(() => {});
        throw error;
      }
      return existing;
    }
    const parent = input.parentDirectory || minecraftDirectory();
    if (typeof parent !== 'string' || !path.isAbsolute(parent) || parent.includes('\0'))
      throw new Error(t('Choose an absolute parent directory.', '请选择绝对路径的父目录。'));
    const id = randomUUID();
    const instance: Instance = {
      ...settings,
      id,
      minecraft: version.id,
      loader,
      loaderVersion,
      ...(await reserveInstanceLocation(parent, settings.name)),
      createdAt: new Date().toISOString(),
    };
    await this.minecraft.ensureDirectory(instance);
    const previousSelection = this.store.state.selectedInstance;
    this.store.state.instances.push(instance);
    this.store.state.selectedInstance = id;
    try {
      await writeInstanceMetadata(instance);
      await this.store.save();
    } catch (error) {
      this.store.state.instances = this.store.state.instances.filter((entry) => entry.id !== id);
      if (this.store.state.selectedInstance === id)
        this.store.state.selectedInstance = previousSelection;
      await fs.rm(instance.containerDirectory || instance.directory, {
        recursive: true,
        force: true,
      });
      await fs
        .rmdir(path.dirname(instance.containerDirectory || instance.directory))
        .catch(() => {});
      throw error;
    }
    return instance;
  }
}
