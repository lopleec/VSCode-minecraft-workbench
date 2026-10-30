import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type * as vscode from 'vscode';
import { Account } from './models';
import { Store } from './store';
import { Network, HttpError } from './network';
import { hashFile, readJson, writeJson } from './files';
import { t } from './config';

export interface AuthProfile {
  id: string;
  name: string;
}
interface Credentials {
  accessToken: string;
  clientToken: string;
  username: string;
}
interface AuthResponse {
  accessToken: string;
  clientToken: string;
  selectedProfile?: AuthProfile;
  availableProfiles?: AuthProfile[];
}
interface Artifact {
  build_number: number;
  download_url: string;
  checksums: { sha256: string };
}
const artifactApi = 'https://authlib-injector.yushi.moe/artifact/latest.json';
export const accountSecretKey = (id: string) => `minecraftWorkbench.account.${id}`;
export function authServerUrl(input: string): string {
  let value = input.trim();
  if (value.startsWith('authlib-injector:yggdrasil-server:'))
    value = decodeURIComponent(value.slice('authlib-injector:yggdrasil-server:'.length));
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      t(
        'Use an HTTPS authentication server API URL without credentials or query parameters.',
        '请使用 HTTPS 认证服务器 API 地址，不含凭据或查询参数。',
      ),
    );
  url.pathname = url.pathname.replace(/\/$/, '') + '/';
  return url.toString();
}
function profile(value: unknown): value is AuthProfile {
  const p = value as AuthProfile | undefined;
  return (
    !!p &&
    typeof p.id === 'string' &&
    /^[0-9a-f]{32}$/i.test(p.id) &&
    typeof p.name === 'string' &&
    !!p.name &&
    p.name.length <= 64
  );
}
function validateResponse(value: AuthResponse): void {
  if (
    !value ||
    typeof value.accessToken !== 'string' ||
    !value.accessToken ||
    typeof value.clientToken !== 'string' ||
    !value.clientToken ||
    [value.accessToken, value.clientToken].some((v) => v.length > 16384 || v.includes('\0'))
  )
    throw new Error('Invalid authentication response.');
}
export class Authlib {
  private pending = new Map<string, Promise<string>>();
  constructor(
    private readonly store: Store,
    private readonly secrets: vscode.SecretStorage,
    private readonly net: Network,
  ) {}
  private async metadata(api: string, signal?: AbortSignal) {
    const raw = await this.net.text(api, { signal, redirects: false });
    if (Buffer.byteLength(raw) > 2 * 1024 ** 2)
      throw new Error('Authentication server metadata exceeds 2 MB.');
    const data = JSON.parse(raw);
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      !data.meta ||
      typeof data.meta !== 'object'
    )
      throw new Error(
        t(
          'This URL does not provide authlib-injector metadata.',
          '此地址未提供 authlib-injector 元数据。',
        ),
      );
    return {
      raw,
      name:
        typeof data.meta.serverName === 'string'
          ? data.meta.serverName.slice(0, 100)
          : new URL(api).host,
    };
  }
  async discover(input: string, signal?: AbortSignal) {
    let url = authServerUrl(input);
    for (let n = 0; n < 8; n++) {
      const response = await this.net.response(url, { signal, redirects: false });
      const location =
        response.status >= 300 && response.status < 400
          ? response.headers.location
          : response.headers['x-authlib-injector-api-location'];
      if (location) {
        const next = authServerUrl(new URL(String(location), url).toString());
        if (next !== url) {
          url = next;
          continue;
        }
      }
      const meta = await this.metadata(url, signal);
      return { url, name: meta.name };
    }
    throw new Error('Too many authentication server redirects.');
  }
  async login(
    api: string,
    username: string,
    password: string,
    select: (profiles: AuthProfile[]) => Promise<AuthProfile | undefined>,
    signal: AbortSignal,
  ) {
    api = authServerUrl(api);
    username = username.trim();
    if (!username || username.length > 320 || !password || password.length > 4096)
      throw new Error('Enter an account and password.');
    const meta = await this.metadata(api, signal);
    let response = await this.net.json<AuthResponse>(`${api}authserver/authenticate`, {
      method: 'POST',
      body: {
        username,
        password,
        clientToken: randomUUID().replaceAll('-', ''),
        agent: { name: 'Minecraft', version: 1 },
        requestUser: true,
      },
      signal,
      redirects: false,
    });
    password = '';
    validateResponse(response);
    if (!profile(response.selectedProfile)) {
      const profiles = (response.availableProfiles || []).filter(profile);
      if (!profiles.length)
        throw new Error(
          t(
            'Create a player profile on this authentication server first.',
            '请先在认证服务器创建游戏角色。',
          ),
        );
      const selected = profiles.length === 1 ? profiles[0] : await select(profiles);
      if (!selected || !profiles.some((p) => p.id === selected.id)) throw new Error('Cancelled');
      response = await this.net.json<AuthResponse>(`${api}authserver/refresh`, {
        method: 'POST',
        body: {
          accessToken: response.accessToken,
          clientToken: response.clientToken,
          selectedProfile: selected,
          requestUser: true,
        },
        signal,
        redirects: false,
      });
      validateResponse(response);
      if (!profile(response.selectedProfile) || response.selectedProfile.id !== selected.id)
        throw new Error('Authentication profile changed.');
    }
    const selected = response.selectedProfile!;
    const id =
      'authlib:' + createHash('sha256').update(`${api}\0${username}\0${selected.id}`).digest('hex');
    const account: Account = {
      id,
      name: selected.name,
      kind: 'authlib',
      profileId: selected.id,
      authServer: api,
      authServerName: meta.name,
    };
    const oldSecret = await this.secrets.get(accountSecretKey(id));
    const previous = this.store.state.selectedAccount;
    const old = this.store.state.accounts.find((a) => a.id === id);
    await this.secrets.store(
      accountSecretKey(id),
      JSON.stringify({
        accessToken: response.accessToken,
        clientToken: response.clientToken,
        username,
      } satisfies Credentials),
    );
    this.store.state.accounts = [...this.store.state.accounts.filter((a) => a.id !== id), account];
    this.store.state.selectedAccount = id;
    try {
      await this.store.save();
    } catch (error) {
      this.store.state.accounts = this.store.state.accounts.filter((a) => a.id !== id);
      if (old) this.store.state.accounts.push(old);
      this.store.state.selectedAccount = previous;
      if (oldSecret) await this.secrets.store(accountSecretKey(id), oldSecret);
      else await this.secrets.delete(accountSecretKey(id));
      throw error;
    }
  }
  async token(account: Account): Promise<string> {
    const pending = this.pending.get(account.id);
    if (pending) return pending;
    const work = this.refresh(account);
    this.pending.set(account.id, work);
    try {
      return await work;
    } finally {
      this.pending.delete(account.id);
    }
  }
  private async refresh(account: Account): Promise<string> {
    const api = authServerUrl(account.authServer || '');
    const raw = await this.secrets.get(accountSecretKey(account.id));
    if (!raw) throw new Error(t('Sign in to this account again.', '请重新登录该账户。'));
    let stored: Credentials;
    try {
      stored = JSON.parse(raw) as Credentials;
    } catch {
      throw new Error(
        t(
          'Stored login credentials are invalid. Sign in again.',
          '保存的登录凭据无效，请重新登录。',
        ),
      );
    }
    if (!stored.accessToken || !stored.clientToken)
      throw new Error('Invalid stored credentials. Sign in again.');
    try {
      await this.net.text(`${api}authserver/validate`, {
        method: 'POST',
        body: { accessToken: stored.accessToken, clientToken: stored.clientToken },
        redirects: false,
      });
      if (!this.store.state.accounts.some((a) => a.id === account.id))
        throw new Error('Account was removed');
      return stored.accessToken;
    } catch (error) {
      if (!(error instanceof HttpError) || ![401, 403].includes(error.status)) throw error;
    }
    const response = await this.net.json<AuthResponse>(`${api}authserver/refresh`, {
      method: 'POST',
      body: { accessToken: stored.accessToken, clientToken: stored.clientToken, requestUser: true },
      redirects: false,
    });
    validateResponse(response);
    if (
      !profile(response.selectedProfile) ||
      response.selectedProfile.id !== account.profileId ||
      response.clientToken !== stored.clientToken
    )
      throw new Error('Authentication profile changed. Sign in again.');
    if (!this.store.state.accounts.some((a) => a.id === account.id))
      throw new Error('Account was removed');
    await this.secrets.store(
      accountSecretKey(account.id),
      JSON.stringify({
        ...stored,
        accessToken: response.accessToken,
        clientToken: response.clientToken,
      }),
    );
    account.name = response.selectedProfile.name;
    await this.store.save();
    return response.accessToken;
  }
  async launchArguments(account: Account, signal: AbortSignal): Promise<string[]> {
    const api = authServerUrl(account.authServer || '');
    const directory = path.join(this.store.root, 'cache', 'authlib-injector');
    const cache = path.join(directory, 'artifact.json');
    const old = await readJson<{ fetched: number; artifact: Artifact } | undefined>(
      cache,
      undefined,
    );
    let artifact = old?.artifact;
    if (!old || Date.now() - old.fetched > 86400000) {
      try {
        artifact = await this.net.json<Artifact>(artifactApi, { signal });
      } catch (error) {
        if (!artifact || signal.aborted) throw error;
      }
    }
    if (
      !artifact ||
      !Number.isSafeInteger(artifact.build_number) ||
      artifact.build_number < 0 ||
      !/^[a-f0-9]{64}$/i.test(artifact.checksums?.sha256 || '') ||
      new URL(artifact.download_url).protocol !== 'https:'
    )
      throw new Error('Invalid authlib-injector artifact metadata.');
    const jar = path.join(directory, `authlib-injector-${artifact.build_number}.jar`);
    await this.net.download(artifact.download_url, jar, {
      signal,
      hash: artifact.checksums.sha256,
      algorithm: 'sha256',
    });
    if ((await hashFile(jar, 'sha256')) !== artifact.checksums.sha256.toLowerCase())
      throw new Error('Invalid authlib-injector checksum.');
    if (artifact !== old?.artifact) await writeJson(cache, { fetched: Date.now(), artifact });
    const metadata = await this.metadata(api, signal);
    return [
      `-javaagent:${jar}=${api}`,
      `-Dauthlibinjector.yggdrasil.prefetched=${Buffer.from(metadata.raw).toString('base64')}`,
    ];
  }
}
