import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Store } from './store';
import { extractZip } from './files';
import { ImportScan, InstanceImporter, scanInstances } from './instance-import';

export class ImportSession {
  private stage?: string;
  private scan?: ImportScan;
  private source?: string;
  private busy = false;
  constructor(private readonly store: Store) {}
  async inspect(source: string, signal: AbortSignal) {
    if (this.busy) throw new Error('An instance import is already in progress.');
    this.busy = true;
    try {
      await this.clear();
      let directory = source;
      const stat = await fs.stat(source);
      if (stat.isFile()) {
        if (!/\.zip$/i.test(source))
          throw new Error('Select a Minecraft folder or a ZIP instance export.');
        if (stat.size > 512 * 1024 ** 2)
          throw new Error('Extract archives larger than 512 MB before importing.');
        const parent = path.join(this.store.root, 'cache', 'imports');
        await fs.mkdir(parent, { recursive: true });
        this.stage = await fs.mkdtemp(path.join(parent, 'import-'));
        await extractZip(source, this.stage, 0, undefined, signal);
        directory = this.stage;
      }
      this.scan = await scanInstances(directory, signal);
      this.source = directory;
      return { ...this.scan, archive: !!this.stage };
    } catch (error) {
      await this.clear();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async commit(
    key: string,
    mode: 'link' | 'copy',
    signal: AbortSignal,
    name?: string,
    root?: string,
  ) {
    if (this.busy || !this.source || !this.scan)
      throw new Error('Scan the source directory first.');
    if (!this.scan.candidates.some((c) => c.key === key))
      throw new Error('Instance was not found in the scan.');
    if (this.stage && mode !== 'copy') throw new Error('ZIP instances must be copied.');
    this.busy = true;
    try {
      const refreshed = (await scanInstances(this.source, signal)).candidates.find(
        (c) => c.key === key,
      );
      if (!refreshed) throw new Error('The source changed. Scan it again.');
      return await new InstanceImporter(this.store).import(refreshed, mode, signal, name, root);
    } finally {
      this.busy = false;
    }
  }
  async clear() {
    if (this.stage) await fs.rm(this.stage, { recursive: true, force: true });
    this.stage = undefined;
    this.scan = undefined;
    this.source = undefined;
  }
  dispose() {
    void this.clear().catch(() => {});
  }
}
