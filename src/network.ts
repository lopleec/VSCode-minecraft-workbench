import { Agent, Dispatcher, ProxyAgent, request, interceptors } from 'undici';
import { SocksClient } from 'socks';
import * as tls from 'node:tls';
import * as dns from 'node:dns/promises';
import { Downloads, DownloadOptions, userAgent } from './downloads';
import { Resource, sourceUrl } from './sources';

export interface NetworkOptions {
  proxy: string;
  sources: Partial<Record<Resource, string>>;
  concurrency: number;
  retries?: number;
  timeout?: number;
  cacheDirectory?: string;
  connectionsPerFile?: number;
  chunkSize?: number;
  runtimeRoots?: () => string[];
}
interface JsonOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  form?: URLSearchParams;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  kind?: Resource;
  redirects?: boolean;
}
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}`);
  }
}
export class Network {
  readonly dispatcher: Dispatcher;
  private readonly directDispatcher: Dispatcher;
  private readonly downloads: Downloads;
  blockedReason?: string;
  constructor(readonly options: NetworkOptions) {
    try {
      if (/^socks/.test(options.proxy)) {
        const proxy = new URL(options.proxy);
        if (!['socks:', 'socks5:', 'socks5h:'].includes(proxy.protocol))
          throw new Error('Use SOCKS5 or SOCKS5h');
        this.dispatcher = new Agent({
          connect: (opts, callback) => {
            void (async () => {
              let host = opts.hostname;
              if (proxy.protocol === 'socks5:') host = (await dns.lookup(host)).address;
              const connection = await SocksClient.createConnection({
                proxy: {
                  host: proxy.hostname,
                  port: Number(proxy.port || 1080),
                  type: 5,
                  userId: decodeURIComponent(proxy.username),
                  password: decodeURIComponent(proxy.password),
                },
                command: 'connect',
                destination: {
                  host,
                  port: Number(opts.port || (opts.protocol === 'https:' ? 443 : 80)),
                },
                timeout: options.timeout || 30000,
              });
              if (opts.protocol === 'https:') {
                const socket = tls.connect({
                  socket: connection.socket,
                  servername: opts.hostname,
                });
                const error = (e: Error) => callback(e, null);
                socket.once('error', error);
                socket.once('secureConnect', () => {
                  socket.off('error', error);
                  callback(null, socket);
                });
              } else callback(null, connection.socket);
            })().catch((error) => callback(error, null));
          },
        });
      } else
        this.dispatcher = options.proxy
          ? new ProxyAgent(options.proxy)
          : new Agent({
              connections: options.concurrency,
              connect: { timeout: options.timeout || 30000 },
            });
    } catch (error) {
      this.blockedReason = String(error);
      this.dispatcher = new Agent();
    }
    this.directDispatcher = this.dispatcher;
    this.dispatcher = this.dispatcher.compose(interceptors.redirect({ maxRedirections: 8 }));
    this.downloads = new Downloads(this.dispatcher, options);
  }
  async close() {
    await this.dispatcher.close();
  }
  async json<T>(url: string, options: JsonOptions = {}): Promise<T> {
    const text = await this.text(url, options);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Invalid JSON response from ${new URL(url).host}.`);
    }
  }
  async text(url: string, options: JsonOptions = {}): Promise<string> {
    const response = await this.response(url, options);
    if (response.status >= 300 && response.status < 400)
      throw new HttpError(response.status, response.text);
    return response.text;
  }
  async response(url: string, options: JsonOptions = {}) {
    if (this.blockedReason) throw new Error(`Invalid network configuration: ${this.blockedReason}`);
    const target =
      options.method === 'POST' || options.headers?.Authorization
        ? url
        : sourceUrl(url, this.options.sources, options.kind);
    const execute = async (uri: string) => {
      const response = await request(uri, {
        dispatcher: options.redirects === false ? this.directDispatcher : this.dispatcher,
        method: options.method || 'GET',
        headers: {
          'user-agent': userAgent,
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(options.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...options.headers,
        },
        body: options.form?.toString() ?? (options.body ? JSON.stringify(options.body) : undefined),
        signal: options.signal,
        headersTimeout: this.options.timeout || 30000,
        bodyTimeout: (this.options.timeout || 30000) * 2,
      });
      const body = await response.body.text();
      if (response.statusCode >= 400) throw new HttpError(response.statusCode, body);
      return { text: body, headers: response.headers, status: response.statusCode };
    };
    try {
      return await execute(target);
    } catch (error) {
      if (target !== url && !options.signal?.aborted) return execute(url);
      throw error;
    }
  }
  download(url: string, destination: string, options: DownloadOptions = {}): Promise<void> {
    if (this.blockedReason)
      return Promise.reject(new Error(`Invalid network configuration: ${this.blockedReason}`));
    return this.downloads.download(url, destination, options);
  }
}
