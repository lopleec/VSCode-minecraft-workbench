import * as vscode from 'vscode';
import { Account, Tokens } from './models';
import { Store } from './store';
import { Network, HttpError } from './network';
import { config, t } from './config';
import { offlineUuid } from './files';
import { Authlib, accountSecretKey } from './authlib';
import { setTimeout as delay } from 'node:timers/promises';
import { describeError } from './errors';
import { MicrosoftSignInStatus, microsoftSignInError } from './microsoft-login';

const oauth = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const scope = 'XboxLive.signin offline_access';
export class Accounts implements vscode.Disposable {
  readonly authlib: Authlib;
  private readonly refreshing = new Map<string, Promise<string>>();
  private readonly timer: NodeJS.Timeout;
  private signingIn?: AbortController;
  signInStatus?: MicrosoftSignInStatus;
  constructor(
    private readonly store: Store,
    private readonly secrets: vscode.SecretStorage,
    private readonly net: Network,
    private readonly canRefresh: () => boolean = () => true,
    private readonly changed: () => void = () => {},
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
          '請先在設定中填寫 Minecraft Workbench: Microsoft Client ID。',
        ),
      );
    return clientId;
  }
  async offline(name: string) {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name))
      throw new Error(
        t(
          'Use 3–16 letters, numbers or underscores.',
          '名称需为 3–16 位字母、数字或下划线。',
          '名稱需為 3–16 位字母、數字或下劃線。',
        ),
      );
    const id = offlineUuid(name);
    if (!this.store.state.accounts.some((a) => a.id === id))
      this.store.state.accounts.push({ id, name, kind: 'offline' });
    this.store.state.selectedAccount = id;
    await this.store.save();
  }
  async login(signal: AbortSignal, report: (message: string, english?: string) => void) {
    if (this.signingIn)
      throw new Error(
        t(
          'Microsoft sign-in is already in progress.',
          'Microsoft 登录正在进行。',
          'Microsoft 登入正在進行。',
        ),
      );
    const controller = new AbortController();
    this.signingIn = controller;
    const loginSignal = AbortSignal.any([signal, controller.signal]);
    this.setSignInStatus({ phase: 'requesting' });
    try {
      loginSignal.throwIfAborted();
      await this.deviceLogin(loginSignal, report);
      this.setSignInStatus({ phase: 'done' });
    } catch (failure) {
      const error = loginSignal.aborted ? failure : microsoftSignInError(failure);
      this.setSignInStatus({
        phase: loginSignal.aborted ? 'cancelled' : 'failed',
        error: loginSignal.aborted ? undefined : describeError(error),
      });
      throw error;
    } finally {
      this.signingIn = undefined;
    }
  }
  cancelSignIn() {
    this.signingIn?.abort();
  }
  private setSignInStatus(status: MicrosoftSignInStatus) {
    this.signInStatus = status;
    this.changed();
  }
  private async deviceLogin(
    signal: AbortSignal,
    report: (message: string, english?: string) => void,
  ) {
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
    const uri = new URL(device.verification_uri);
    if (
      uri.protocol !== 'https:' ||
      !['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(uri.hostname) ||
      uri.username ||
      uri.password ||
      !/^[A-Z0-9-]{4,24}$/i.test(device.user_code) ||
      !Number.isFinite(device.expires_in) ||
      device.expires_in <= 0 ||
      device.expires_in > 3600
    )
      throw new Error('Invalid Microsoft device authorization response.');
    const deadline = Date.now() + device.expires_in * 1000;
    this.setSignInStatus({
      phase: 'waiting',
      code: device.user_code,
      url: uri.href,
      expiresAt: deadline,
    });
    await Promise.resolve(vscode.env.clipboard.writeText(device.user_code)).catch(() => {});
    report(
      t(
        'Complete Microsoft authorization in your browser. The code is shown in Accounts.',
        '请在浏览器中完成 Microsoft 授权，验证码显示在账户页。',
        '請在瀏覽器中完成 Microsoft 授權，驗證碼顯示在帳戶頁。',
      ),
      'Microsoft sign-in: waiting for device authorization',
    );
    await Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(uri.href))).catch(() => false);
    let interval = Number.isFinite(device.interval)
      ? Math.max(5, Math.min(60, device.interval))
      : 5;
    while (Date.now() < deadline) {
      await delay(Math.min(interval * 1000, deadline - Date.now()), undefined, { signal });
      if (Date.now() >= deadline) break;
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
        this.setSignInStatus({ phase: 'exchanging' });
        report(
          t(
            'Checking Xbox and Minecraft profile',
            '验证 Xbox 与 Minecraft 档案',
            '驗證 Xbox 與 Minecraft 個人檔案',
          ),
          'Checking Xbox and Minecraft profile',
        );
        const profile = await this.exchange(response.access_token, signal);
        signal.throwIfAborted();
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
      t(
        'Sign-in code expired. Start sign-in again.',
        '登录验证码已过期，请重新登录。',
        '登入驗證碼已過期，請重新登入。',
      ),
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
        t(
          'A Minecraft Java profile is required.',
          '该账户需要拥有 Minecraft Java 版档案。',
          '該帳戶需要擁有 Minecraft Java 版檔案。',
        ),
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
    if (!stored)
      throw new Error(
        t('Sign in to this account again.', '请重新登录该账户。', '請重新登入該帳戶。'),
      );
    let tokens: Tokens;
    try {
      tokens = JSON.parse(stored) as Tokens;
    } catch {
      throw new Error(
        t(
          'Stored login credentials are invalid. Sign in again.',
          '保存的登录凭据无效，请重新登录。',
          '儲存的登入驗證資訊無效，請重新登入。',
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
    this.cancelSignIn();
    clearInterval(this.timer);
  }
}
