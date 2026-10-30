import { h } from './dom';
import { PageContext, field, input, select, heading, blank, busy } from './page-ui';
import type { WorkbenchPage } from './protocol';
import { renderProjects } from './projects-page';
import { renderTerracotta } from './terracotta-page';

export const managementPages: WorkbenchPage[] = [
  'accounts',
  'java',
  'downloads',
  'backups',
  'projects',
  'multiplayer',
];
export function renderManagement(main: HTMLElement, page: WorkbenchPage, ctx: PageContext) {
  const L = ctx.text;
  const labels: Record<string, string> = {
    accounts: L('Accounts', '账户'),
    java: 'Java',
    downloads: L('Tasks', '任务'),
    backups: L('World backups', '存档备份'),
    projects: L('Projects', '项目'),
    multiplayer: L('Terracotta (Beta)', '陶瓦联机（Beta）'),
  };
  main.append(
    h(
      'nav',
      { class: 'segments management-tabs', 'aria-label': L('Management pages', '管理页面') },
      ...managementPages
        .filter((value) => value !== 'multiplayer' || ctx.state().terracotta?.enabled)
        .filter((value) =>
          ctx.state().mode === 'server'
            ? ['java', 'downloads'].includes(value)
            : ctx.state().mode === 'developer'
              ? ['projects', 'java', 'downloads'].includes(value)
              : true,
        )
        .map((value) =>
          ctx.button(
            labels[value],
            () => ctx.navigate(value),
            value === page ? 'segment active' : 'segment',
          ),
        ),
    ),
  );
  const body = h('div', { class: 'management-body' });
  main.append(body);
  if (page === 'accounts') return accounts(body, ctx);
  if (page === 'java') return java(body, ctx);
  if (page === 'downloads') return downloads(body, ctx);
  if (page === 'backups') return backups(body, ctx);
  if (page === 'projects') return renderProjects(body, ctx);
  if (page === 'multiplayer') return renderTerracotta(body, ctx);
}

function accounts(body: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  body.append(heading(L('Accounts', '账户')));
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
      h('legend', {}, L('Offline player', '离线玩家')),
      field(
        L('Player name', '玩家名称'),
        name,
        L('3–16 letters, numbers or underscores.', '3–16 位字母、数字或下划线。'),
      ),
      h('button', { type: 'submit', class: 'secondary' }, L('Add offline account', '添加离线账户')),
    ),
  );
  offline.onsubmit = (e) => {
    e.preventDefault();
    void busy(offline, async () => {
      await ctx.request('launcher.offlineAccount', { name: name.value });
      name.value = '';
      await ctx.refresh();
      update();
      ctx.notify(L('Account added.', '账户已添加。'));
    }).catch(ctx.error);
  };
  const clientId = input('clientId', ctx.state().defaults.clientId);
  clientId.spellcheck = false;
  const signIn = ctx.button(
    L('Sign in with Microsoft', '使用 Microsoft 登录'),
    async () => {
      await ctx.request('launcher.signIn');
      await ctx.refresh();
      update();
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
      field(
        L('Application Client ID', '应用 Client ID'),
        clientId,
        L(
          'Use your own public-client application. Leave empty to use offline accounts.',
          '填写自己的公共客户端应用 ID；留空可使用离线账户。',
        ),
      ),
      h(
        'div',
        { class: 'inline-actions' },
        h('button', { type: 'submit', class: 'secondary' }, L('Save Client ID', '保存 Client ID')),
        signIn,
      ),
    ),
  );
  microsoft.onsubmit = (e) => {
    e.preventDefault();
    void busy(microsoft, async () => {
      await ctx.request('launcher.clientId', { value: clientId.value });
      await ctx.refresh();
      signIn.disabled = !ctx.state().defaults.clientId;
      ctx.notify(L('Client ID saved.', 'Client ID 已保存。'));
    }).catch(ctx.error);
  };
  const authServer = input('authServer', 'https://littleskin.cn/api/yggdrasil');
  const external = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('External authentication', '外置登录')),
      field(L('Authentication server API URL', '认证服务器 API 地址'), authServer),
      ctx.button(
        L('Sign in with authlib-injector', '使用 authlib-injector 登录'),
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
  function update() {
    const state = ctx.state();
    signIn.disabled = !state.defaults.clientId;
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
                  : L('Offline', '离线'),
            ),
          ),
          h(
            'div',
            { class: 'inline-actions' },
            state.selectedAccount === account.id &&
              h('span', { class: 'muted' }, L('Active', '当前账户')),
            ctx.button(
              L('Use account', '使用账户'),
              () => perform(account.id, 'use'),
              'secondary',
              state.selectedAccount === account.id,
            ),
            account.kind === 'microsoft' &&
              ctx.button(
                L('Refresh token', '刷新令牌'),
                () => perform(account.id, 'refresh'),
                'secondary',
              ),
            ctx.button(
              L('Remove', '移除'),
              () => perform(account.id, 'remove'),
              'text-button danger',
            ),
          ),
        ),
      ),
    );
    if (!state.accounts.length) rows.append(blank(L('No accounts', '暂无账户')));
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
    heading(L('Java runtimes', 'Java 运行环境')),
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(
        L('Detect local Java', '检测本地 Java'),
        async () => {
          await ctx.request('launcher.javaAction', { action: 'detect' });
          await ctx.refresh();
          update();
        },
        'secondary',
      ),
      ctx.button(
        L('Browse executable…', '浏览可执行文件…'),
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
  path.placeholder = L('Path to java / java.exe', 'java / java.exe 路径');
  const add = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('Add Java', '添加 Java')),
      field(L('Executable path', '可执行文件路径'), path),
      h('button', { type: 'submit', class: 'secondary' }, L('Verify and add', '验证并添加')),
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
      h('legend', {}, L('Download Eclipse Temurin', '下载 Eclipse Temurin')),
      field(
        L('Java major version', 'Java 主版本'),
        major,
        L('For example: 8, 17, 21 or 25.', '例如：8、17、21 或 25。'),
      ),
      h('button', { type: 'submit', class: 'primary' }, L('Download JDK', '下载 JDK')),
    ),
  );
  download.onsubmit = (e) => {
    e.preventDefault();
    void busy(download, async () => {
      await ctx.request('launcher.downloadJava', { major: Number(major.value) });
      await ctx.refresh();
      update();
      ctx.notify(L('JDK installed.', 'JDK 安装完成。'));
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
              h('span', { class: 'muted' }, L('Default', '默认')),
            ctx.button(
              L('Use as default', '设为默认'),
              async () => {
                await ctx.request('launcher.javaAction', { action: 'default', path: runtime.path });
                await ctx.refresh();
                update();
              },
              'secondary',
              runtime.path === state.defaults.javaPath,
            ),
            ctx.button(
              L('Reveal', '显示文件'),
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
          L('No Java detected', '尚未检测到 Java'),
          L('Detect installed Java or download a JDK.', '检测已安装的 Java，或下载 JDK。'),
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
    ['all', L('All tasks', '所有任务')],
    ['running', L('Running', '运行中')],
    ['failed', L('Failed', '失败')],
    ['cancelled', L('Cancelled', '已取消')],
    ['done', L('Completed', '已完成')],
  ]);
  filter.setAttribute('aria-label', L('Task status', '任务状态'));
  body.append(
    heading(L('Download & background tasks', '下载与后台任务')),
    h(
      'div',
      { class: 'inline-actions page-actions' },
      filter,
      ctx.button(
        L('Show output', '显示输出'),
        () => ctx.request('action', { action: 'output' }),
        'secondary',
      ),
    ),
    rows,
  );
  filter.onchange = update;
  function update() {
    const jobs = ctx
      .state()
      .jobs.filter((j) => filter.value === 'all' || j.status === filter.value);
    const status: Record<string, string> = {
      running: L('Running', '运行中'),
      done: L('Completed', '已完成'),
      failed: L('Failed', '失败'),
      cancelled: L('Cancelled', '已取消'),
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
              job.status === 'running' ? L('Cancel', '取消') : L('Retry / resume', '重试 / 继续'),
              () =>
                ctx.request('launcher.jobAction', {
                  id: job.id,
                  action: job.status === 'running' ? 'cancel' : 'retry',
                }),
              'secondary',
            ),
            ctx.button(
              L('Output', '输出'),
              () => ctx.request('launcher.jobAction', { id: job.id, action: 'output' }),
              'text-button',
            ),
          ),
        ),
      ),
    );
    if (!jobs.length) rows.append(blank(L('No tasks', '暂无任务')));
  }
  update();
  return update;
}

function backups(body: HTMLElement, ctx: PageContext): (() => void) | undefined {
  const L = ctx.text,
    instance = ctx.state().instances.find((i) => i.id === ctx.state().selectedInstance);
  body.append(heading(L('World backups', '存档备份'), instance?.name));
  if (!instance) {
    body.append(blank(L('Select an instance first', '请先选择实例')));
    return;
  }
  const rows = h('div', { class: 'management-list' });
  const running = ctx.state().running.includes(instance.id);
  body.append(
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(
        L('Import worlds…', '导入世界存档…'),
        async () => {
          await ctx.request('launcher.importWorld', { instanceId: instance.id });
          await load();
        },
        'secondary',
        running,
      ),
      ctx.button(
        L('Export world…', '导出世界存档…'),
        () => ctx.request('launcher.exportWorld', { instanceId: instance.id }),
        'secondary',
        running,
      ),
      ctx.button(
        L('Create backup', '创建备份'),
        async () => {
          await ctx.request('launcher.backupAction', { action: 'create' });
          await load();
          ctx.notify(L('Backup created.', '备份已创建。'));
        },
        'primary',
        running,
      ),
      ctx.button(
        L('Open backups directory', '打开备份目录'),
        () => ctx.request('launcher.backupAction', { action: 'open' }),
        'secondary',
      ),
      ctx.button(L('Refresh', '刷新'), load, 'secondary'),
    ),
    rows,
  );
  if (running)
    body.append(
      h(
        'p',
        { class: 'muted' },
        L('Stop the game before backing up or restoring worlds.', '备份或恢复存档前请先停止游戏。'),
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
            L('Restore', '恢复'),
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
    if (!ids.length) rows.append(blank(L('No backups', '暂无备份')));
  }
  void load().catch(ctx.error);
}
