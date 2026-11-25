import { h } from './dom';
import { PageContext, field, input, select, heading, blank, busy } from './page-ui';
import type { WorkbenchPage } from './protocol';
import { renderTerracotta } from './terracotta-page';
import { renderSettings } from './settings-page';
import { authenticationPresets } from '../auth-presets';

export function renderManagement(main: HTMLElement, page: WorkbenchPage, ctx: PageContext) {
  const body = h('div', { class: 'management-body' });
  main.append(body);
  if (page === 'accounts') return accounts(body, ctx);
  if (page === 'java') return java(body, ctx);
  if (page === 'downloads') return downloads(body, ctx);
  if (page === 'backups') return backups(body, ctx);
  if (page === 'multiplayer') return renderTerracotta(body, ctx);
  if (page === 'settings') {
    void renderSettings(body, ctx);
    return;
  }
}

function accounts(body: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  body.append(heading(L('Accounts', '账户', '帳戶')));
  const rows = h('div', { class: 'management-list' });
  const name = input('playerName');
  name.pattern = '[A-Za-z0-9_]{3,16}';
  name.required = true;
  name.maxLength = 16;
  const offline = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('Offline player', '离线玩家', '離線玩家')),
      field(
        L('Player name', '玩家名称', '玩家名稱'),
        name,
        L(
          '3–16 letters, numbers or underscores.',
          '3–16 位字母、数字或下划线。',
          '3–16 位字母、數字或下劃線。',
        ),
      ),
      h(
        'button',
        { type: 'submit', class: 'secondary' },
        L('Add offline account', '添加离线账户', '新增離線帳戶'),
      ),
    ),
  );
  offline.onsubmit = (e) => {
    e.preventDefault();
    void busy(offline, async () => {
      await ctx.request('launcher.offlineAccount', { name: name.value });
      name.value = '';
      await ctx.refresh();
      update();
      ctx.notify(L('Account added.', '账户已添加。', '帳戶已新增。'));
    }).catch(ctx.error);
  };
  const clientId = input('clientId', ctx.state().defaults.clientId);
  clientId.spellcheck = false;
  let startingSignIn = false;
  const authorization = h('div', {
    class: 'sign-in-status',
    role: 'status',
    'aria-live': 'polite',
  });
  const signIn = ctx.button(
    L('Sign in with Microsoft', '使用 Microsoft 登录', '使用 Microsoft 登入'),
    async () => {
      if (startingSignIn) return;
      startingSignIn = true;
      updateSignIn();
      try {
        if (clientId.value.trim() !== ctx.state().defaults.clientId)
          await ctx.request('launcher.clientId', { value: clientId.value });
        await ctx.request('launcher.signIn');
      } finally {
        startingSignIn = false;
        await ctx.refresh();
        update();
      }
    },
    'primary',
    !ctx.state().defaults.clientId,
  );
  const microsoft = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, 'Microsoft'),
      h(
        'ol',
        { class: 'sign-in-steps' },
        h(
          'li',
          {},
          L(
            'Enter an application Client ID that supports Minecraft sign-in.',
            '填写支持 Minecraft 登录的应用 Client ID。',
            '填寫支援 Minecraft 登入的應用程式 Client ID。',
          ),
        ),
        h(
          'li',
          {},
          L(
            'Start sign-in, then enter the code on Microsoft’s website. Return here after authorization.',
            '开始登录，在 Microsoft 网站输入验证码，授权后返回此处。',
            '開始登入，在 Microsoft 網站輸入驗證碼，授權後返回此處。',
          ),
        ),
      ),
      field(
        L('Application Client ID', '应用 Client ID', '應用 Client ID'),
        clientId,
        L(
          'An application ID, not an email address or password. Enable personal Microsoft accounts and public-client device sign-in; Minecraft API access requires approval.',
          '应用 ID，不是邮箱或密码。应用须启用个人 Microsoft 账户和公共客户端设备登录，并获准访问 Minecraft API。',
          '應用程式 ID，不是電子郵件或密碼。應用程式須啟用個人 Microsoft 帳戶和公開用戶端裝置登入，並獲准存取 Minecraft API。',
        ),
      ),
      h(
        'div',
        { class: 'inline-actions' },
        h(
          'button',
          { type: 'submit', class: 'secondary' },
          L('Save Client ID', '保存 Client ID', '儲存 Client ID'),
        ),
        signIn,
        h(
          'a',
          {
            href: 'https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app',
          },
          L('Client ID setup ↗', 'Client ID 配置说明 ↗', 'Client ID 設定說明 ↗'),
        ),
      ),
      authorization,
    ),
  );
  microsoft.onsubmit = (e) => {
    e.preventDefault();
    void busy(microsoft, async () => {
      await ctx.request('launcher.clientId', { value: clientId.value });
      await ctx.refresh();
      update();
      ctx.notify(L('Client ID saved.', 'Client ID 已保存。', 'Client ID 已儲存。'));
    }).catch(ctx.error);
  };
  clientId.oninput = () => updateSignIn();
  const authServer = input('authServer');
  authServer.placeholder = 'https://example.org/api/yggdrasil/';
  const external = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('External authentication', '外置登录', '外置登入')),
      field(
        L('Authentication server API URL', '认证服务器 API 地址', '驗證伺服器 API 位址'),
        h(
          'div',
          { class: 'input-action' },
          authServer,
          ...authenticationPresets.map((preset) =>
            ctx.button(
              preset.name,
              () => {
                authServer.value = preset.url;
                authServer.focus();
              },
              'secondary',
            ),
          ),
        ),
        L(
          'Use this provider’s credentials. Do not enter your Microsoft password.',
          '使用此服务商的账户与独立密码，请勿填写 Microsoft 密码。',
          '使用此服務商的帳戶與獨立密碼，請勿填寫 Microsoft 密碼。',
        ),
      ),
      ctx.button(
        L(
          'Sign in with authlib-injector',
          '使用 authlib-injector 登录',
          '使用 authlib-injector 登入',
        ),
        async () => {
          await ctx.request('launcher.authlibSignIn', { server: authServer.value });
          await ctx.refresh();
          update();
        },
        'secondary',
      ),
    ),
  );
  external.onsubmit = (event) => event.preventDefault();
  body.append(rows, microsoft, external, offline);
  function updateSignIn() {
    const state = ctx.state();
    const session = state.microsoftSignIn;
    const pending =
      startingSignIn ||
      (!!session && ['requesting', 'waiting', 'exchanging'].includes(session.phase));
    clientId.disabled = pending;
    microsoft.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = pending;
    signIn.disabled = !clientId.value.trim() || pending;
    signIn.textContent =
      session?.phase === 'failed' || session?.phase === 'cancelled'
        ? L('Retry Microsoft sign-in', '重新登录 Microsoft', '重新登入 Microsoft')
        : L('Sign in with Microsoft', '使用 Microsoft 登录', '使用 Microsoft 登入');
    authorization.replaceChildren();
    if (!session) return;
    const messages = {
      requesting: L('Requesting a sign-in code…', '正在获取登录验证码…', '正在取得登入驗證碼…'),
      waiting: L('Waiting for browser authorization', '等待浏览器授权', '等待瀏覽器授權'),
      exchanging: L(
        'Checking Xbox and Minecraft profile…',
        '正在验证 Xbox 与 Minecraft 档案…',
        '正在驗證 Xbox 與 Minecraft 個人檔案…',
      ),
      done: L('Signed in.', '已登录。', '已登入。'),
      cancelled: L('Sign-in cancelled.', '登录已取消。', '登入已取消。'),
      failed: session.error || L('Sign-in failed.', '登录失败。', '登入失敗。'),
    };
    authorization.append(h('p', {}, messages[session.phase]));
    if (session.phase === 'waiting' && session.code) {
      const code = input('microsoftCode', session.code);
      code.readOnly = true;
      code.className = 'sign-in-code';
      authorization.append(
        field(L('Sign-in code', '登录验证码', '登入驗證碼'), code),
        h(
          'div',
          { class: 'inline-actions' },
          ctx.button(
            L('Copy code', '复制验证码', '複製驗證碼'),
            () => ctx.request('launcher.signInCode', { action: 'copy' }),
            'secondary',
          ),
          ctx.button(
            L('Open Microsoft sign-in ↗', '打开 Microsoft 登录 ↗', '開啟 Microsoft 登入 ↗'),
            () => ctx.request('launcher.signInCode', { action: 'open' }),
            'secondary',
          ),
        ),
      );
      if (session.expiresAt)
        authorization.append(
          h(
            'p',
            {},
            L('Expires at ', '有效期至 ', '有效期限至 ') +
              new Date(session.expiresAt).toLocaleTimeString(state.locale),
          ),
        );
    }
    if (pending)
      authorization.append(
        ctx.button(
          L('Cancel sign-in', '取消登录', '取消登入'),
          () => ctx.request('launcher.cancelSignIn'),
          'secondary',
        ),
      );
  }
  function update() {
    const state = ctx.state();
    updateSignIn();
    rows.replaceChildren(
      ...state.accounts.map((account) =>
        h(
          'article',
          { class: 'management-row' },
          h(
            'div',
            { class: 'row-body' },
            h('strong', {}, account.name),
            h(
              'p',
              { class: 'muted' },
              account.kind === 'microsoft'
                ? 'Microsoft'
                : account.kind === 'authlib'
                  ? `${account.authServerName || 'authlib-injector'} · ${account.authServer || ''}`
                  : L('Offline', '离线', '離線'),
            ),
          ),
          h(
            'div',
            { class: 'inline-actions' },
            state.selectedAccount === account.id &&
              h('span', { class: 'muted' }, L('Active', '当前账户', '當前帳戶')),
            ctx.button(
              L('Use account', '使用账户', '使用帳戶'),
              () => perform(account.id, 'use'),
              'secondary',
              state.selectedAccount === account.id,
            ),
            account.kind === 'microsoft' &&
              ctx.button(
                L('Refresh token', '刷新令牌', '重新整理權杖'),
                () => perform(account.id, 'refresh'),
                'secondary',
              ),
            ctx.button(
              L('Remove', '移除', '移除'),
              () => perform(account.id, 'remove'),
              'text-button danger',
            ),
          ),
        ),
      ),
    );
    async function perform(id: string, action: string) {
      await ctx.request('launcher.accountAction', { id, action });
      await ctx.refresh();
      update();
    }
  }
  update();
  return update;
}

function java(body: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  const rows = h('div', { class: 'management-list' });
  body.append(
    heading(L('Java runtimes', 'Java 运行环境', 'Java 執行環境')),
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(
        L('Detect local Java', '检测本地 Java', '偵測本機 Java'),
        async () => {
          await ctx.request('launcher.javaAction', { action: 'detect' });
          await ctx.refresh();
          update();
        },
        'secondary',
      ),
      ctx.button(
        L('Browse executable…', '浏览可执行文件…', '瀏覽執行檔…'),
        async () => {
          await ctx.request('launcher.javaAction', { action: 'add' });
          await ctx.refresh();
          update();
        },
        'secondary',
      ),
    ),
    rows,
  );
  const path = input('javaPath');
  path.placeholder = L('Path to java / java.exe', 'java / java.exe 路径', 'java / java.exe 路徑');
  const add = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('Add Java', '添加 Java', '新增 Java')),
      field(L('Executable path', '可执行文件路径', '執行檔路徑'), path),
      h(
        'button',
        { type: 'submit', class: 'secondary' },
        L('Verify and add', '验证并添加', '驗證並新增'),
      ),
    ),
  );
  add.onsubmit = (e) => {
    e.preventDefault();
    void busy(add, async () => {
      await ctx.request('launcher.javaAction', { action: 'add', path: path.value });
      await ctx.refresh();
      update();
    }).catch(ctx.error);
  };
  const major = input('major', 25, 'number');
  major.min = '8';
  major.max = '99';
  major.required = true;
  const download = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h(
        'legend',
        {},
        L('Download Eclipse Temurin', '下载 Eclipse Temurin', '下載 Eclipse Temurin'),
      ),
      field(
        L('Java major version', 'Java 主版本', 'Java 主版本'),
        major,
        L('For example: 8, 17, 21 or 25.', '例如：8、17、21 或 25。', '例如：8、17、21 或 25。'),
      ),
      h('button', { type: 'submit', class: 'primary' }, L('Download JDK', '下载 JDK', '下載 JDK')),
    ),
  );
  download.onsubmit = (e) => {
    e.preventDefault();
    void busy(download, async () => {
      await ctx.request('launcher.downloadJava', { major: Number(major.value) });
      await ctx.refresh();
      update();
      ctx.notify(L('JDK installed.', 'JDK 安装完成。', 'JDK 安裝完成。'));
    }).catch(ctx.error);
  };
  body.append(add, download);
  function update() {
    const state = ctx.state();
    rows.replaceChildren(
      ...state.java.map((runtime) =>
        h(
          'article',
          { class: 'management-row' },
          h(
            'div',
            { class: 'row-body' },
            h('strong', {}, `Java ${runtime.version}`),
            h('p', { class: 'muted' }, runtime.architecture),
            h('div', { class: 'path-value muted' }, runtime.path),
          ),
          h(
            'div',
            { class: 'inline-actions' },
            runtime.path === state.defaults.javaPath &&
              h('span', { class: 'muted' }, L('Default', '默认', '預設')),
            ctx.button(
              L('Use as default', '设为默认', '設為預設'),
              async () => {
                await ctx.request('launcher.javaAction', { action: 'default', path: runtime.path });
                await ctx.refresh();
                update();
              },
              'secondary',
              runtime.path === state.defaults.javaPath,
            ),
            ctx.button(
              L('Reveal', '显示文件', '顯示檔案'),
              () => ctx.request('launcher.javaAction', { action: 'reveal', path: runtime.path }),
              'secondary',
            ),
          ),
        ),
      ),
    );
    if (!state.java.length)
      rows.append(
        blank(
          L('No Java detected', '尚未检测到 Java', '尚未偵測到 Java'),
          L(
            'Detect installed Java or download a JDK.',
            '检测已安装的 Java，或下载 JDK。',
            '偵測已安裝的 Java，或下載 JDK。',
          ),
        ),
      );
  }
  update();
  return update;
}

function downloads(body: HTMLElement, ctx: PageContext) {
  const L = ctx.text,
    rows = h('div', { class: 'management-list' });
  const filter = select('taskStatus', 'all', [
    ['all', L('All tasks', '所有任务', '所有工作')],
    ['running', L('Running', '运行中', '執行中')],
    ['failed', L('Failed', '失败', '失敗')],
    ['cancelled', L('Cancelled', '已取消', '已取消')],
    ['done', L('Completed', '已完成', '已完成')],
  ]);
  filter.setAttribute('aria-label', L('Task status', '任务状态', '工作狀態'));
  body.append(
    heading(L('Tasks', '任务', '工作')),
    h('div', { class: 'inline-actions page-actions' }, filter),
    rows,
  );
  filter.onchange = update;
  function update() {
    const jobs = ctx
      .state()
      .jobs.filter((j) => filter.value === 'all' || j.status === filter.value);
    const status: Record<string, string> = {
      running: L('Running', '运行中', '執行中'),
      done: L('Completed', '已完成', '已完成'),
      failed: L('Failed', '失败', '失敗'),
      cancelled: L('Cancelled', '已取消', '已取消'),
    };
    rows.replaceChildren(
      ...jobs.map((job) =>
        h(
          'article',
          { class: `management-row job-${job.status}` },
          h(
            'div',
            { class: 'row-body' },
            h('strong', {}, job.label),
            h(
              'p',
              { class: job.status === 'failed' ? 'danger' : 'muted' },
              job.detail || status[job.status],
            ),
            job.status === 'running' &&
              h('div', { class: 'task-progress', role: 'progressbar', 'aria-label': job.label }),
          ),
          h(
            'div',
            { class: 'inline-actions' },
            ctx.button(
              job.status === 'running'
                ? L('Cancel', '取消', '取消')
                : L('Retry / resume', '重试 / 继续', '重試 / 繼續'),
              () =>
                ctx.request('launcher.jobAction', {
                  id: job.id,
                  action: job.status === 'running' ? 'cancel' : 'retry',
                }),
              'secondary',
            ),
          ),
        ),
      ),
    );
    if (!jobs.length) rows.append(blank(L('No tasks', '暂无任务', '暫無工作')));
  }
  update();
  return update;
}

function backups(body: HTMLElement, ctx: PageContext): (() => void) | undefined {
  const L = ctx.text,
    instance = ctx.state().instances.find((i) => i.id === ctx.state().selectedInstance);
  body.append(heading(L('World backups', '存档备份', '存檔備份'), instance?.name));
  if (!instance) {
    body.append(blank(L('Select an instance first', '请先选择实例', '請先選擇實例')));
    return;
  }
  const rows = h('div', { class: 'management-list' });
  const running = ctx.state().running.includes(instance.id);
  body.append(
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(
        L('Open saves directory', '打开世界存档目录', '開啟世界存檔目錄'),
        () => ctx.request('launcher.openWorldDirectory'),
        'secondary',
      ),
      ctx.button(
        L('Import worlds…', '导入世界存档…', '匯入世界存檔…'),
        async () => {
          await ctx.request('launcher.importWorld', { instanceId: instance.id });
          await load();
        },
        'secondary',
        running,
      ),
      ctx.button(
        L('Export world…', '导出世界存档…', '匯出世界存檔…'),
        () => ctx.request('launcher.exportWorld', { instanceId: instance.id }),
        'secondary',
        running,
      ),
      ctx.button(
        L('Create backup', '创建备份', '建立備份'),
        async () => {
          await ctx.request('launcher.backupAction', { action: 'create' });
          await load();
          ctx.notify(L('Backup created.', '备份已创建。', '備份已建立。'));
        },
        'primary',
        running,
      ),
      ctx.button(
        L('Open backups directory', '打开备份目录', '開啟備份目錄'),
        () => ctx.request('launcher.backupAction', { action: 'open' }),
        'secondary',
      ),
      ctx.button(L('Refresh', '刷新', '重新整理'), load, 'secondary'),
    ),
    rows,
  );
  if (running)
    body.append(
      h(
        'p',
        { class: 'muted' },
        L(
          'Stop the game before backing up or restoring worlds.',
          '备份或恢复存档前请先停止游戏。',
          '備份或還原存檔前請先停止遊戲。',
        ),
      ),
    );
  async function load() {
    const ids = await ctx.request<string[]>('launcher.backups');
    if (!ctx.current()) return;
    rows.replaceChildren(
      ...ids.map((id) =>
        h(
          'article',
          { class: 'management-row' },
          h('div', { class: 'row-body' }, h('strong', {}, id)),
          ctx.button(
            L('Restore', '恢复', '還原'),
            async () => {
              await ctx.request('launcher.backupAction', { action: 'restore', id });
              await load();
            },
            'secondary',
            running,
          ),
        ),
      ),
    );
    if (!ids.length) rows.append(blank(L('No backups', '暂无备份', '暫無備份')));
  }
  void load().catch(ctx.error);
}
