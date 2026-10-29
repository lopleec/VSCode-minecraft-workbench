import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { watch, FSWatcher } from 'node:fs';
import { State } from './models';
import { readJson, writeJson } from './files';
import { mergeState } from './state-merge';

export class Store {
  state: State = {
    schema: 1,
    mode: 'launcher',
    instances: [],
    accounts: [],
    projects: [],
    servers: [],
    java: [],
  };
  private pending: Promise<void> = Promise.resolve();
  private baseline: State = structuredClone(this.state);
  private watcher?: FSWatcher;
  private watchTimer?: NodeJS.Timeout;
  private revision = 0;
  constructor(
    readonly root: string,
    private readonly changed: () => void,
  ) {}
  async load(): Promise<void> {
    const state = await readJson(path.join(this.root, 'state.json'), this.state);
    if (state.schema !== 1) throw new Error('Unsupported state schema');
    if (
      !['launcher', 'developer', 'server'].includes(state.mode) ||
      !Array.isArray(state.instances) ||
      !Array.isArray(state.accounts) ||
      !Array.isArray(state.projects) ||
      !Array.isArray(state.java)
    )
      throw new Error('Invalid state file');
    state.servers ??= [];
    if (!Array.isArray(state.servers)) throw new Error('Invalid servers in state file');
    this.state = state;
    this.baseline = structuredClone(state);
    await fs.mkdir(this.root, { recursive: true });
    this.watcher?.close();
    this.watcher = watch(this.root, { persistent: false }, (_event, name) => {
      if (String(name) !== 'state.json') return;
      clearTimeout(this.watchTimer);
      this.watchTimer = setTimeout(() => {
        void this.pending
          .then(async () => {
            const external = await readJson<State>(path.join(this.root, 'state.json'));
            if (external.schema !== 1) return;
            external.servers ??= [];
            this.apply(mergeState(external, this.baseline, this.state));
            this.baseline = structuredClone(this.state);
            this.changed();
          })
          .catch(() => {});
      }, 100);
      this.watchTimer.unref();
    });
  }
  private apply(next: State) {
    for (const field of ['instances', 'accounts', 'projects', 'java', 'servers'] as const) {
      const id = (item: unknown) =>
        (item as { id?: string; path?: string }).id || (item as { path?: string }).path;
      const existing = new Map(this.state[field].map((item) => [id(item), item]));
      const values = next[field].map((item) => {
        const original = existing.get(id(item));
        if (!original) return item;
        for (const key of Object.keys(original))
          if (!(key in item)) delete (original as unknown as Record<string, unknown>)[key];
        Object.assign(original, item);
        return original;
      });
      (next[field] as unknown[]) = values;
    }
    Object.assign(this.state, next);
  }
  save(): Promise<void> {
    const snapshot = structuredClone(this.state);
    const base = this.baseline;
    this.baseline = snapshot;
    const revision = ++this.revision;
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(this.root, { recursive: true });
        const lockFile = path.join(this.root, 'state.lock');
        let lock: fs.FileHandle | undefined;
        for (let attempt = 0; attempt < 200; attempt++) {
          try {
            lock = await fs.open(lockFile, 'wx');
            break;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const stat = await fs.stat(lockFile).catch(() => undefined);
            if (stat && Date.now() - stat.mtimeMs > 30000) await fs.rm(lockFile, { force: true });
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        }
        if (!lock) throw new Error('State file is busy');
        try {
          const current = await readJson<State>(path.join(this.root, 'state.json'), {
            schema: 1,
            mode: 'launcher',
            instances: [],
            accounts: [],
            projects: [],
            servers: [],
            java: [],
          });
          const merged = mergeState(current, base, snapshot);
          await writeJson(path.join(this.root, 'state.json'), merged);
          if (revision === this.revision) {
            this.apply(mergeState(merged, snapshot, this.state));
            this.baseline = structuredClone(this.state);
          }
        } finally {
          await lock.close();
          await fs.rm(lockFile, { force: true });
        }
        this.changed();
      })
      .catch((error) => {
        if (revision === this.revision) this.baseline = base;
        throw error;
      });
    this.changed();
    return this.pending;
  }
  get selected() {
    return this.state.instances.find((i) => i.id === this.state.selectedInstance);
  }
  dispose() {
    clearTimeout(this.watchTimer);
    this.watcher?.close();
  }
}
