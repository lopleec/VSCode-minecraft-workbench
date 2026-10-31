import { Dispatcher, request } from 'undici';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { exists, hashFile, readJson, writeJson } from './files';
import { Resource, sourceUrl } from './sources';
import type { NetworkOptions } from './network';
import { randomUUID } from 'node:crypto';
import { waitFor } from './abort';

import { userAgent } from './build-info';
export { userAgent } from './build-info';
export interface DownloadOptions {
  hash?: string;
  algorithm?: string;
  size?: number;
  kind?: Resource;
  signal?: AbortSignal;
  progress?: (bytes: number, total: number) => void;
}
class Slots {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}
  async run<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', abort);
        this.active++;
        resolve();
      };
      const abort = () => {
        const index = this.queue.indexOf(grant);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason);
      };
      if (this.active < this.limit) grant();
      else {
        this.queue.push(grant);
        signal?.addEventListener('abort', abort, { once: true });
      }
    });
    try {
      signal?.throwIfAborted();
      return await work();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
export class Downloads {
  private readonly slots: Slots;
  private readonly pending = new Map<string, Promise<void>>();
  private readonly destinations = new Map<string, Promise<void>>();
  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly options: NetworkOptions,
  ) {
    this.slots = new Slots(Math.max(1, Math.min(32, options.concurrency)));
  }
  private async valid(file: string, options: DownloadOptions) {
    return (
      (await exists(file)) &&
      (!options.size || (await fs.stat(file)).size === options.size) &&
      (!options.hash || (await hashFile(file, options.algorithm, options.signal)) === options.hash)
    );
  }
  async download(url: string, destination: string, input: DownloadOptions = {}): Promise<void> {
    input.signal?.throwIfAborted();
    const key = path.resolve(destination);
    const previous = this.destinations.get(key) || Promise.resolve();
    const work = previous.catch(() => {}).then(() => this.downloadFile(url, destination, input));
    this.destinations.set(key, work);
    const release = () => {
      if (this.destinations.get(key) === work) this.destinations.delete(key);
    };
    void work.then(release, release);
    await waitFor(work, input.signal);
  }
  private async downloadFile(
    url: string,
    destination: string,
    input: DownloadOptions,
  ): Promise<void> {
    const options = {
      ...input,
      hash: input.hash?.toLowerCase(),
      size: input.size && input.size > 0 ? input.size : undefined,
    };
    options.signal?.throwIfAborted();
    if (options.hash && !/^[a-f0-9]{16,128}$/.test(options.hash))
      throw new Error('Invalid download checksum');
    const algorithm = options.algorithm || 'sha1';
    if (!['sha1', 'sha256', 'sha512', 'md5'].includes(algorithm))
      throw new Error('Unsupported download checksum');
    const cache =
      options.hash && this.options.cacheDirectory
        ? path.join(this.options.cacheDirectory, algorithm, options.hash)
        : undefined;
    if ((options.hash || options.size) && (await this.valid(destination, options))) {
      if (cache && !(await this.valid(cache, options)))
        await this.seed(destination, cache, options);
      return;
    }
    if (!cache) {
      await this.cacheTransfer(url, destination, options, true);
      return;
    }
    const key = algorithm + ':' + options.hash;
    const active = this.pending.get(key);
    if (active) {
      try {
        await waitFor(active, options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        if (!(await this.valid(cache, options)))
          return this.downloadFile(url, destination, options);
      }
      options.signal?.throwIfAborted();
    }
    if (!(await this.valid(cache, options))) {
      const marker = path.sep + '.runtime' + path.sep;
      const at = destination.lastIndexOf(marker);
      const roots = [...new Set(this.options.runtimeRoots?.() || [])];
      const containing = roots
        .filter((root) => destination.startsWith(root + path.sep))
        .sort((a, b) => b.length - a.length)[0];
      const relative =
        at >= 0
          ? destination.slice(at + marker.length)
          : containing
            ? path.relative(containing, destination)
            : undefined;
      if (relative)
        for (const root of roots) {
          const candidates = [path.join(root, relative)];
          const client = /^versions\/([^/]+)\/\1\.jar$/.exec(relative.replaceAll(path.sep, '/'));
          if (client)
            candidates.push(
              path.join(
                root,
                'libraries',
                'com',
                'mojang',
                'minecraft',
                client[1],
                `minecraft-${client[1]}-client.jar`,
              ),
            );
          let reused = false;
          for (const candidate of candidates) {
            if (
              candidate !== destination &&
              (await this.valid(candidate, options)) &&
              (await this.seed(candidate, cache, options))
            ) {
              reused = true;
              break;
            }
          }
          if (reused) break;
        }
    }
    if (!(await this.valid(cache, options))) {
      const work = this.cacheTransfer(url, cache, options);
      this.pending.set(key, work);
      try {
        await work;
      } finally {
        if (this.pending.get(key) === work) this.pending.delete(key);
      }
    }
    options.signal?.throwIfAborted();
    await fs.mkdir(path.dirname(destination), { recursive: true });
    // Copy-on-write when available; instance edits must never modify the shared cache.
    const temporary = `${destination}.${randomUUID()}.copying`;
    try {
      await fs.copyFile(cache, temporary, fs.constants.COPYFILE_FICLONE);
      options.signal?.throwIfAborted();
      if (!(await this.valid(destination, options))) {
        try {
          await fs.rename(temporary, destination);
        } catch (error) {
          if (!(await this.valid(destination, options))) throw error;
        }
      }
    } finally {
      await fs.rm(temporary, { force: true });
    }
    options.progress?.((await fs.stat(cache)).size, (await fs.stat(cache)).size);
  }
  private async seed(source: string, cache: string, options: DownloadOptions) {
    const stage = cache + '.' + randomUUID() + '.tmp';
    await fs.mkdir(path.dirname(cache), { recursive: true });
    try {
      await fs.copyFile(source, stage, fs.constants.COPYFILE_FICLONE);
      if (!(await this.valid(stage, options))) return false;
      await fs.rename(stage, cache);
      return true;
    } finally {
      await fs.rm(stage, { force: true });
    }
  }
  private async cacheTransfer(url: string, file: string, options: DownloadOptions, force = false) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const lockFile = file + '.lock';
    let handle: fs.FileHandle | undefined;
    for (let attempt = 0; attempt < 600; attempt++) {
      options.signal?.throwIfAborted();
      try {
        handle = await fs.open(lockFile, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid }));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!force && (await this.valid(file, options))) return;
        const owner = await readJson<{ pid: number }>(lockFile).catch(() => undefined);
        if (owner?.pid && Number.isInteger(owner.pid) && owner.pid > 0) {
          try {
            process.kill(owner.pid, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
              await fs.rm(lockFile, { force: true });
              continue;
            }
          }
        }
        await delay(100, undefined, { signal: options.signal });
      }
    }
    if (!handle) throw new Error('Download cache is busy; retry the task');
    try {
      if (force || !(await this.valid(file, options))) await this.transfer(url, file, options);
    } finally {
      await handle.close();
      await fs.rm(lockFile, { force: true });
    }
  }
  private async transfer(url: string, destination: string, options: DownloadOptions) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const target = sourceUrl(url, this.options.sources, options.kind);
    const attempts = Math.max(1, Math.min(9, (this.options.retries ?? 2) + 1));
    for (let attempt = 0; attempt < attempts; attempt++) {
      options.signal?.throwIfAborted();
      const uri = attempt === attempts - 1 ? url : target;
      try {
        const segmented =
          (this.options.connectionsPerFile ?? 4) > 1 &&
          (!options.size || options.size >= 16 * 1024 ** 2) &&
          options.hash;
        if (segmented) {
          try {
            if (await this.parallel(uri, destination, options)) return;
          } catch (error) {
            if (options.signal?.aborted) throw error;
          }
        }
        await this.serial(uri, destination, options);
        const segments = await readJson<{ count: number }>(destination + '.parts.json').catch(
          () => undefined,
        );
        if (segments) {
          for (let i = 0; i < Math.min(2048, segments.count); i++)
            await fs.rm(`${destination}.part.${i}`, { force: true });
          await fs.rm(destination + '.parts.json', { force: true });
        }
        return;
      } catch (error) {
        if (options.signal?.aborted || attempt === attempts - 1) throw error;
        await delay(300 * (attempt + 1), undefined, { signal: options.signal });
      }
    }
  }
  private async response(
    url: string,
    options: DownloadOptions,
    headers: Record<string, string>,
    work: (response: Awaited<ReturnType<typeof request>>) => Promise<void>,
  ) {
    return this.slots.run(options.signal, async () => {
      const response = await request(url, {
        dispatcher: this.dispatcher,
        signal: options.signal,
        headers: { 'user-agent': userAgent, ...headers },
        headersTimeout: this.options.timeout || 30000,
        bodyTimeout: (this.options.timeout || 30000) * 2,
      });
      try {
        await work(response);
      } finally {
        await response.body.dump().catch(() => {});
      }
    });
  }
  private async serial(url: string, destination: string, options: DownloadOptions) {
    const part = destination + '.part';
    const meta = part + '.json';
    const previous = await readJson<{ url: string; etag?: string }>(meta, { url: '' });
    let offset = (await exists(part)) && previous.url === url ? (await fs.stat(part)).size : 0;
    if (!options.hash && !previous.etag) offset = 0;
    await this.response(
      url,
      options,
      offset
        ? { Range: `bytes=${offset}-`, ...(previous.etag ? { 'If-Range': previous.etag } : {}) }
        : {},
      async (response) => {
        if (response.statusCode === 416) {
          if ((options.hash || options.size) && (await this.valid(part, options))) {
            await fs.rename(part, destination);
            await fs.rm(meta, { force: true });
            return;
          }
          await fs.rm(part, { force: true });
          throw new Error('Invalid range; restarting download');
        }
        if (response.statusCode >= 400)
          throw new Error(`HTTP ${response.statusCode}: download failed`);
        if (response.statusCode === 206) {
          if (!String(response.headers['content-range'] || '').startsWith(`bytes ${offset}-`)) {
            await fs.rm(part, { force: true });
            throw new Error('Invalid Content-Range');
          }
        } else offset = 0;
        const total = options.size || offset + Number(response.headers['content-length'] || 0);
        await writeJson(meta, { url, etag: response.headers.etag });
        let bytes = offset;
        response.body.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          options.progress?.(bytes, total);
        });
        await pipeline(
          response.body,
          createWriteStream(part, { flags: offset ? 'a' : 'w', mode: 0o600 }),
          { signal: options.signal },
        );
        if (!(await this.valid(part, options))) {
          await fs.rm(part, { force: true });
          throw new Error(`Download checksum or size mismatch: ${path.basename(destination)}`);
        }
        await fs.rename(part, destination);
        await fs.rm(meta, { force: true });
      },
    );
  }
  private async parallel(url: string, destination: string, options: DownloadOptions) {
    const head = await this.slots.run(options.signal, async () => {
      const response = await request(url, {
        method: 'HEAD',
        dispatcher: this.dispatcher,
        signal: options.signal,
        headers: { 'user-agent': userAgent },
        headersTimeout: this.options.timeout || 30000,
        bodyTimeout: this.options.timeout || 30000,
      });
      await response.body.dump();
      return { status: response.statusCode, headers: response.headers };
    });
    const size = Number(head.headers['content-length']);
    if (
      head.status !== 200 ||
      !Number.isSafeInteger(size) ||
      size < 16 * 1024 ** 2 ||
      head.headers['accept-ranges'] !== 'bytes' ||
      (options.size && options.size !== size)
    )
      return false;
    const chunk = Math.max(
      1024 ** 2,
      Math.min(64 * 1024 ** 2, this.options.chunkSize || 8 * 1024 ** 2),
    );
    const count = Math.ceil(size / chunk);
    if (count > 2048) return false;
    const meta = destination + '.parts.json';
    const signature = JSON.stringify({
      url,
      size,
      chunk,
      etag: head.headers.etag,
      hash: options.hash,
    });
    const old = await readJson<{ signature: string; count: number }>(meta, {
      signature: '',
      count: 0,
    });
    if (old.signature !== signature) {
      for (let i = 0; i < Math.min(2048, old.count); i++)
        await fs.rm(`${destination}.part.${i}`, { force: true });
    }
    await writeJson(meta, { signature, count });
    const sizes = Array.from({ length: count }, (_, i) => Math.min(chunk, size - i * chunk));
    const progress = await Promise.all(
      sizes.map(async (length, i) => {
        const stat = await fs.stat(`${destination}.part.${i}`).catch(() => undefined);
        if (stat && stat.size <= length) return stat.size;
        await fs.rm(`${destination}.part.${i}`, { force: true });
        return 0;
      }),
    );
    const abort = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal;
    let next = 0;
    const workers = await Promise.allSettled(
      Array.from(
        { length: Math.min(count, Math.max(1, Math.min(8, this.options.connectionsPerFile ?? 4))) },
        async () => {
          try {
            while (next < count) {
              const index = next++;
              signal.throwIfAborted();
              if (progress[index] === sizes[index]) continue;
              const start = index * chunk + progress[index];
              const end = index * chunk + sizes[index] - 1;
              await this.response(
                url,
                { ...options, signal },
                {
                  Range: `bytes=${start}-${end}`,
                  ...(head.headers.etag ? { 'If-Range': String(head.headers.etag) } : {}),
                },
                async (response) => {
                  if (
                    response.statusCode !== 206 ||
                    !String(response.headers['content-range']).startsWith(`bytes ${start}-${end}/`)
                  ) {
                    response.body.destroy();
                    throw new Error('Server does not support segmented downloads');
                  }
                  response.body.on('data', (data: Buffer) => {
                    progress[index] += data.length;
                    options.progress?.(
                      progress.reduce((a, b) => a + b, 0),
                      size,
                    );
                  });
                  await pipeline(
                    response.body,
                    createWriteStream(`${destination}.part.${index}`, {
                      flags: start > index * chunk ? 'a' : 'w',
                      mode: 0o600,
                    }),
                    { signal },
                  );
                  if (progress[index] !== sizes[index])
                    throw new Error('Incomplete download segment');
                },
              );
            }
          } catch (error) {
            abort.abort(error);
            throw error;
          }
        },
      ),
    );
    const failure = workers.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) throw failure.reason;
    options.signal?.throwIfAborted();
    const assembled = destination + '.assembling';
    try {
      await fs.writeFile(assembled, '', { mode: 0o600 });
      for (let i = 0; i < count; i++)
        await pipeline(
          createReadStream(`${destination}.part.${i}`),
          createWriteStream(assembled, { flags: 'a' }),
          { signal: options.signal },
        );
      if (!(await this.valid(assembled, { ...options, size }))) {
        for (let i = 0; i < count; i++) await fs.rm(`${destination}.part.${i}`, { force: true });
        await fs.rm(meta, { force: true });
        throw new Error('Segmented download checksum mismatch');
      }
      await fs.rename(assembled, destination);
      for (let i = 0; i < count; i++) await fs.rm(`${destination}.part.${i}`, { force: true });
      await fs.rm(meta, { force: true });
      return true;
    } finally {
      await fs.rm(assembled, { force: true });
    }
  }
}
