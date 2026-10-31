import * as path from 'node:path';
import { waitFor } from './abort';

export class RuntimeQueue {
  private readonly pending = new Map<string, Promise<void>>();
  async run<T>(directory: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const resolved = path.resolve(directory);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const previous = this.pending.get(key) || Promise.resolve();
    let release!: () => void;
    const finished = new Promise<void>((resolve) => (release = resolve));
    const ticket = previous.then(() => finished);
    this.pending.set(key, ticket);
    void ticket.then(() => {
      if (this.pending.get(key) === ticket) this.pending.delete(key);
    });
    try {
      await waitFor(previous, signal);
      signal.throwIfAborted();
      return await work();
    } finally {
      release();
    }
  }
}
