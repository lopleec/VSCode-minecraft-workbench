import * as vscode from 'vscode';
import { Account, Tokens } from './models';
import { Store } from './store';
import { Network, HttpError } from './network';
import { config, t } from './config';
import { offlineUuid } from './files';
import { Authlib, accountSecretKey } from './authlib';

const oauth = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const scope = 'XboxLive.signin offline_access';
export class Accounts implements vscode.Disposable {
  readonly authlib: Authlib;
  private readonly refreshing = new Map<string, Promise<string>>();
  private readonly timer: NodeJS.Timeout;
  constructor(
    private readonly store: Store,
    private readonly secrets: vscode.SecretStorage,
    private readonly net: Network,
    private readonly canRefresh: () => boolean = () => true,
  ) {
    this.authlib = new Authlib(store, secrets, net);
    this.timer = setInterval(() => {
      if (!this.canRefresh()) return;
      for (const account of store.state.accounts.filter((a) => a.kind === 'microsoft')) {
        void this.token(account).catch(() => {});
      }
    }, 60000);
  }
  private key(id: string) {
    return accountSecretKey(id);
  }
  private clientId() {
    const clientId = config('microsoftClientId', '').trim();
    if (!clientId)
      throw new Error(
        t(
          'Set Minecraft Workbench: Microsoft Client ID in Settings first.',
          '请先在设置中填写 Minecraft Workbench: Microsoft Client ID。',
        ),
      );
    return clientId;
  }
  async offline(name: string) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name))
      throw new Error(
        t('Use 3–16 letters, numbers or underscores.', '名称需为 3–16 位字母、数字或下划线。'),
      );
    const id = offlineUuid(name);
    if (!this.store.state.accounts.some((a) => a.id === id))
      this.store.state.accounts.push({ id, name, kind: 'offline' });
    this.store.state.selectedAccount = id;
    await this.store.save();
  }
  async login(signal: AbortSignal, report: (message: string) => void) {
    const clientId = this.clientId();
    const device = await this.net.json<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
      expires_in: number;
    }>(`${oauth}/devicecode`, {
      method: 'POST',
      form: new URLSearchParams({ client_id: clientId, scope }),
      signal,
    });
    await vscode.env.clipboard.writeText(device.user_code);
    report(
      t(
        `Enter code ${device.user_code} (copied to clipboard)`,
        `输入验证码 ${device.user_code}（已复制）`,
      ),
    );
    await vscode.env.openExternal(vscode.Uri.parse(device.verification_uri));
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = Math.max(device.interval, 5);
    while (Date.now() < deadline) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, interval * 1000);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      try {
        const response = await this.net.json<{ access_token: string; refresh_token: string }>(
          `${oauth}/token`,
          {
            method: 'POST',
            form: new URLSearchParams({
              client_id: clientId,
              grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
              device_code: device.device_code,
            }),
            signal,
          },
        );
        const profile = await this.exchange(response.access_token, signal);
        await this.secrets.store(
          this.key(profile.id),
          JSON.stringify({
            refreshToken: response.refresh_token,
            accessToken: profile.token,
            expiresAt: profile.expiresAt,
          } satisfies Tokens),
        );
        this.store.state.accounts = this.store.state.accounts.filter((a) => a.id !== profile.id);
        this.store.state.accounts.push({ id: profile.id, name: profile.name, kind: 'microsoft' });
        this.store.state.selectedAccount = profile.id;
        await this.store.save();
        return;
      } catch (error) {
        if (error instanceof HttpError) {
          let code: string | undefined;
          try {
            code = JSON.parse(error.body).error;
          } catch {
            /* Non-JSON identity response. */
          }
          if (code === 'authorization_pending') continue;
          if (code === 'slow_down') {
            interval += 5;
            continue;
          }
        }
        throw error;
      }
    }
    throw new Error(
      t('Sign-in code expired. Start sign-in again.', '登录验证码已过期，请重新登录。'),
    );
  }
  private async exchange(msToken: string, signal?: AbortSignal) {
    const xbox = await this.net.json<{ Token: string }>(
      'https://user.auth.xboxlive.com/user/authenticate',
      {
        method: 'POST',
        body: {
          Properties: {
            AuthMethod: 'RPS',
            SiteName: 'user.auth.xboxlive.com',
            RpsTicket: `d=${msToken}`,
          },
          RelyingParty: 'http://auth.xboxlive.com',
          TokenType: 'JWT',
        },
        signal,
      },
    );
    const xsts = await this.net.json<{ Token: string; DisplayClaims: { xui: { uhs: string }[] } }>(
      'https://xsts.auth.xboxlive.com/xsts/authorize',
      {
        method: 'POST',
        body: {
          Properties: { SandboxId: 'RETAIL', UserTokens: [xbox.Token] },
          RelyingParty: 'rp://api.minecraftservices.com/',
          TokenType: 'JWT',
        },
        signal,
      },
    );
    const minecraft = await this.net.json<{ access_token: string; expires_in: number }>(
      'https://api.minecraftservices.com/authentication/login_with_xbox',
      {
        method: 'POST',
        body: { identityToken: `XBL3.0 x=${xsts.DisplayClaims.xui[0].uhs};${xsts.Token}` },
        signal,
      },
    );
    const profile = await this.net.json<{ id: string; name: string }>(
      'https://api.minecraftservices.com/minecraft/profile',
      { headers: { Authorization: `Bearer ${minecraft.access_token}` }, signal },
    );
    if (!profile.id || !profile.name)
      throw new Error(
        t('A Minecraft Java profile is required.', '该账户需要拥有 Minecraft Java 版档案。'),
      );
    return {
      ...profile,
      token: minecraft.access_token,
      expiresAt: Date.now() + minecraft.expires_in * 1000,
    };
  }
  async token(account: Account): Promise<string> {
    if (account.kind === 'offline') return '0';
    if (account.kind === 'authlib') return this.authlib.token(account);
    const stored = await this.secrets.get(this.key(account.id));
    if (!stored) throw new Error(t('Sign in to this account again.', '请重新登录该账户。'));
    let tokens: Tokens;
    try {
      tokens = JSON.parse(stored) as Tokens;
    } catch {
      throw new Error(
        t(
          'Stored login credentials are invalid. Sign in again.',
          '保存的登录凭据无效，请重新登录。',
        ),
      );
    }
    if (tokens.expiresAt > Date.now() + 5 * 60000) return tokens.accessToken;
    const existing = this.refreshing.get(account.id);
    if (existing) return existing;
    const refresh = (async () => {
      const response = await this.net.json<{ access_token: string; refresh_token?: string }>(
        `${oauth}/token`,
        {
          method: 'POST',
          form: new URLSearchParams({
            client_id: this.clientId(),
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
            scope,
          }),
        },
      );
      if (response.refresh_token && this.store.state.accounts.some((a) => a.id === account.id)) {
        tokens.refreshToken = response.refresh_token;
        await this.secrets.store(this.key(account.id), JSON.stringify(tokens));
      }
      const profile = await this.exchange(response.access_token);
      if (profile.id !== account.id) throw new Error('Account identity changed');
      if (!this.store.state.accounts.some((a) => a.id === account.id))
        throw new Error('Account was removed');
      await this.secrets.store(
        this.key(account.id),
        JSON.stringify({
          refreshToken: response.refresh_token || tokens.refreshToken,
          accessToken: profile.token,
          expiresAt: profile.expiresAt,
        } satisfies Tokens),
      );
      account.name = profile.name;
      await this.store.save();
      return profile.token;
    })();
    this.refreshing.set(account.id, refresh);
    try {
      return await refresh;
    } finally {
      this.refreshing.delete(account.id);
    }
  }
  launchArguments(account: Account, signal: AbortSignal) {
    return this.authlib.launchArguments(account, signal);
  }
  async remove(account: Account) {
    await this.secrets.delete(this.key(account.id));
    this.store.state.accounts = this.store.state.accounts.filter((a) => a.id !== account.id);
    if (this.store.state.selectedAccount === account.id)
      this.store.state.selectedAccount = this.store.state.accounts[0]?.id;
    for (const instance of this.store.state.instances)
      if (instance.accountId === account.id) instance.accountId = undefined;
    await this.store.save();
  }
  dispose() {
    clearInterval(this.timer);
  }
}
