import { t } from './config';
import { HttpError } from './network';

export interface MicrosoftSignInStatus {
  phase: 'requesting' | 'waiting' | 'exchanging' | 'done' | 'cancelled' | 'failed';
  code?: string;
  url?: string;
  expiresAt?: number;
  error?: string;
}

export function microsoftSignInError(error: unknown): unknown {
  if (!(error instanceof HttpError)) return error;
  let code: string | number | undefined;
  try {
    const body = JSON.parse(error.body);
    code = body.error || body.XErr;
  } catch {
    /* Identity services may return non-JSON errors. */
  }
  if (code === 'authorization_declined' || code === 'access_denied')
    return new Error(
      t(
        'Microsoft sign-in was declined. Start sign-in again to retry.',
        'Microsoft 登录授权已拒绝，可重新开始登录。',
        'Microsoft 登入授權已拒絕，可重新開始登入。',
      ),
    );
  if (code === 'expired_token' || code === 'bad_verification_code')
    return new Error(
      t(
        'Sign-in code expired. Start sign-in again.',
        '登录验证码已过期，请重新登录。',
        '登入驗證碼已過期，請重新登入。',
      ),
    );
  if (['invalid_client', 'unauthorized_client', 'invalid_scope'].includes(String(code)))
    return new Error(
      t(
        'Check the Client ID: this application must allow personal Microsoft accounts and public-client device sign-in, with Minecraft API access approved.',
        '请检查 Client ID：应用须支持个人 Microsoft 账户、公共客户端设备登录，并获准访问 Minecraft API。',
        '請檢查 Client ID：應用程式須支援個人 Microsoft 帳戶、公開用戶端裝置登入，並獲准存取 Minecraft API。',
      ),
    );
  if (code === 2148916233)
    return new Error(
      t(
        'Create an Xbox profile for this Microsoft account, then sign in again.',
        '请先为此 Microsoft 账户创建 Xbox 档案，再重新登录。',
        '請先為此 Microsoft 帳戶建立 Xbox 個人檔案，再重新登入。',
      ),
    );
  if (error.status === 403)
    return new Error(
      t(
        'Xbox or Minecraft services denied access. Check the account permissions and whether this Client ID is approved for Minecraft.',
        'Xbox 或 Minecraft 服务拒绝访问，请检查账户权限及此 Client ID 的 Minecraft API 审核状态。',
        'Xbox 或 Minecraft 服務拒絕存取，請檢查帳戶權限及此 Client ID 的 Minecraft API 審核狀態。',
      ),
    );
  return error;
}
