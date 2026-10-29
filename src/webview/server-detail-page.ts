import { h } from './dom';
import { PageContext, field, input, select, blank, busy } from './page-ui';
import { statusLabel } from './server-ui';

export function renderServer(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  const server = ctx.state().servers.find((s) => s.id === ctx.state().selectedServer);
  if (!server) {
    main.append(
      blank(L('Select a server', '请选择服务端')),
      ctx.button(L('Servers', '服务端'), () => ctx.navigate('servers'), 'secondary'),
    );
    return () => {};
  }
  const id = server.id;
  const status = h('span', { class: 'status-label' });
  const start = ctx.button(L('Start', '启动'), () => perform('start'), 'primary');
  const stop = ctx.button(L('Stop', '停止'), () => perform('stop'), 'secondary');
  const restart = ctx.button(L('Restart', '重启'), () => perform('restart'), 'secondary');
  const tabs = h('nav', {
    class: 'segments server-tabs',
    'aria-label': L('Server pages', '服务端页面'),
  });
  const body = h('div', { class: 'server-body' });
  let tab = 'console';
  let updating = false;
  const title = h('h1', {}, server.name);
  const subtitle = h(
    'p',
    { class: 'muted' },
    `${server.engine} · ${server.softwareVersion || server.minecraft}${server.build ? ' · ' + server.build : ''}`,
  );
  main.append(
    h(
      'div',
      { class: 'instance-heading' },
      h('div', {}, title, subtitle),
      h('div', { class: 'inline-actions' }, status, start, stop, restart),
    ),
    tabs,
    body,
  );
  async function perform(action: string) {
    if (updating) return;
    updating = true;
    update();
    try {
      await ctx.request('server.action', { serverId: id, action });
      await ctx.refresh();
    } finally {
      updating = false;
      update();
    }
  }
  function update() {
    const current = ctx.state().servers.find((s) => s.id === id);
    if (current) {
      title.textContent = current.name;
      subtitle.textContent = `${current.engine} · ${current.softwareVersion || current.minecraft}${current.build ? ' · ' + current.build : ''}`;
    }
    const state = ctx.state().serverStatus[id] || 'stopped';
    status.textContent = statusLabel(state, L);
    start.hidden = state !== 'stopped';
    stop.hidden = state === 'stopped';
    restart.hidden = state !== 'running';
    stop.className = 'primary';
    start.disabled = updating || state !== 'stopped';
    stop.disabled = updating || !['starting', 'running'].includes(state);
    restart.disabled = updating || state !== 'running';
    for (const node of body.querySelectorAll<HTMLElement>('[data-idle]')) {
      if (node instanceof HTMLButtonElement || node instanceof HTMLFieldSetElement)
        node.disabled = updating || state !== 'stopped' || !!node.closest('form')?.dataset.busy;
    }
  }
  function renderTab() {
    tabs.replaceChildren(
      ...[
        ['console', L('Console', '控制台')],
        ['settings', L('Settings', '设置')],
        ['backups', L('Backups', '备份')],
      ].map(([key, title]) =>
        ctx.button(
          title,
          () => {
            tab = key;
            renderTab();
          },
          key === tab ? 'segment active' : 'segment',
        ),
      ),
    );
    body.replaceChildren();
    if (tab === 'console') consoleTab();
    else if (tab === 'settings') settingsTab();
    else backupTab();
    update();
  }
  function consoleTab() {
    const output = h('pre', {
      class: 'server-console',
      tabindex: 0,
      role: 'log',
      'aria-label': L('Server console', '服务端控制台'),
    });
    const command = input('serverCommand');
    command.placeholder = L('Server command…', '输入服务端指令…');
    command.maxLength = 4096;
    command.required = true;
    command.autocomplete = 'off';
    const send = h('button', { type: 'submit', class: 'secondary' }, L('Send', '发送'));
    const form = h('form', { class: 'console-command' }, command, send);
    form.onsubmit = (e) => {
      e.preventDefault();
      send.disabled = true;
      void ctx
        .request('server.command', { serverId: id, command: command.value })
        .then(() => {
          command.value = '';
        })
        .catch(ctx.error)
        .finally(() => {
          send.disabled = false;
        });
    };
    body.append(
      h(
        'div',
        { class: 'inline-actions page-actions' },
        ctx.button(L('Open output', '打开输出'), () => perform('log'), 'secondary'),
        ctx.button(L('Open directory', '打开目录'), () => perform('directory'), 'secondary'),
        ctx.button(L('Force stop…', '强制停止…'), () => perform('forceStop'), 'secondary danger'),
      ),
      output,
      form,
    );
    const poll = async () => {
      if (!ctx.current() || tab !== 'console' || !output.isConnected) return;
      try {
        const result = await ctx.request<{ lines: string[]; status: string }>('server.logs', {
          serverId: id,
        });
        if (!ctx.current() || !output.isConnected) return;
        const atEnd = output.scrollHeight - output.scrollTop - output.clientHeight < 36;
        const text =
          result.lines.join('\n') || L('Server output appears here.', '服务端输出显示在此处。');
        if (output.textContent !== text) output.textContent = text;
        if (atEnd) output.scrollTop = output.scrollHeight;
        command.disabled = !['running', 'starting'].includes(result.status);
        send.disabled = command.disabled;
      } catch (error) {
        if (ctx.current()) ctx.error(error);
      }
      if (ctx.current() && output.isConnected) setTimeout(() => void poll(), 1500);
    };
    void poll();
  }
  function settingsTab() {
    const loading = h('p', { class: 'muted' }, L('Loading settings…', '加载设置…'));
    body.append(loading);
    void ctx
      .request<Record<string, string>>('server.properties', { serverId: id })
      .then((properties) => {
        if (!ctx.current() || tab !== 'settings') return;
        loading.remove();
        const current = ctx.state().servers.find((s) => s.id === id)!;
        const name = input('name', current.name);
        name.required = true;
        const java = input('java', current.java || '');
        java.placeholder = L('Automatic', '自动');
        const min = input('minMemory', current.minMemory || 0, 'number');
        min.min = '0';
        min.max = '1048576';
        const max = input('maxMemory', current.maxMemory || 0, 'number');
        max.min = '0';
        max.max = '1048576';
        const major = input('javaMajor', current.javaMajor || '', 'number');
        major.min = '8';
        major.max = '99';
        major.placeholder = L('From game version', '按游戏版本');
        const args = h(
          'textarea',
          { name: 'jvmArgs', rows: 3 },
          (current.jvmArgs || []).join('\n'),
        );
        const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
        const propField = (key: string, label: string, choices?: [string, string][]) => {
          const control = choices
            ? select(key, properties[key], choices)
            : input(key, properties[key]);
          controls.set(key, control);
          return field(label, control);
        };
        const form = h('form', { class: 'management-form' });
        const settings = h(
          'fieldset',
          { 'data-idle': true },
          h('legend', {}, L('Java & memory', 'Java 与内存')),
          h(
            'div',
            { class: 'form-grid' },
            field(L('Name', '名称'), name),
            field(L('Java executable', 'Java 可执行文件'), java),
            field(L('Java version override', '指定 Java 版本'), major),
            field(L('Minimum memory (MB)', '最小内存（MB）'), min),
            field(L('Maximum memory (MB)', '最大内存（MB）'), max),
          ),
          h(
            'p',
            { class: 'field-hint' },
            L(
              `0 uses automatic memory (${ctx.state().defaults.minMemory}–${ctx.state().defaults.maxMemory} MB).`,
              `0 使用自动内存（${ctx.state().defaults.minMemory}–${ctx.state().defaults.maxMemory} MB）。`,
            ),
          ),
          field(
            L('JVM arguments', 'JVM 参数'),
            args,
            L('One argument per line.', '每行一个参数。'),
          ),
        );
        form.append(settings);
        if (current.engine !== 'velocity') {
          const booleans: [string, string][] = [
            ['true', L('Enabled', '启用')],
            ['false', L('Disabled', '禁用')],
          ];
          form.append(
            h(
              'fieldset',
              { 'data-idle': true },
              h('legend', {}, L('Network', '网络')),
              h(
                'div',
                { class: 'form-grid' },
                propField('server-ip', L('Bind address', '绑定地址')),
                propField('server-port', L('Port', '端口')),
                propField('max-players', L('Player limit', '人数上限')),
                propField('online-mode', L('Verify player accounts', '验证正版账户'), booleans),
                propField('white-list', L('Whitelist', '白名单'), booleans),
              ),
              h(
                'p',
                { class: 'field-hint' },
                L(
                  '127.0.0.1: local only. 0.0.0.0: allow LAN connections.',
                  '127.0.0.1：仅本机；0.0.0.0：允许局域网连接。',
                ),
              ),
            ),
            h(
              'fieldset',
              { 'data-idle': true },
              h('legend', {}, L('World', '世界')),
              h(
                'div',
                { class: 'form-grid' },
                propField('motd', L('Server description', '服务器简介')),
                propField('level-name', L('World folder', '存档目录')),
                propField('level-seed', L('Seed', '种子')),
                propField('gamemode', L('Game mode', '游戏模式'), [
                  ['survival', L('Survival', '生存')],
                  ['creative', L('Creative', '创造')],
                  ['adventure', L('Adventure', '冒险')],
                  ['spectator', L('Spectator', '旁观')],
                ]),
                propField('difficulty', L('Difficulty', '难度'), [
                  ['peaceful', L('Peaceful', '和平')],
                  ['easy', L('Easy', '简单')],
                  ['normal', L('Normal', '普通')],
                  ['hard', L('Hard', '困难')],
                ]),
                propField('pvp', 'PvP', booleans),
                propField('view-distance', L('View distance', '视距')),
                propField('simulation-distance', L('Simulation distance', '模拟距离')),
                propField('spawn-protection', L('Spawn protection', '出生点保护')),
                propField('enable-command-block', L('Command blocks', '命令方块'), booleans),
                propField('allow-flight', L('Allow flight', '允许飞行'), booleans),
              ),
            ),
          );
        }
        form.append(
          h(
            'div',
            { class: 'save-row' },
            h(
              'button',
              { type: 'submit', class: 'primary', 'data-idle': true },
              L('Save settings', '保存设置'),
            ),
            h('span', { class: 'muted' }, L('Stop the server to edit.', '停止服务端后可编辑。')),
          ),
        );
        form.onsubmit = (e) => {
          e.preventDefault();
          void busy(form, async () => {
            await ctx.request('server.save', {
              serverId: id,
              value: {
                name: name.value,
                java: java.value,
                javaMajor: major.value ? Number(major.value) : 0,
                minMemory: Number(min.value),
                maxMemory: Number(max.value),
                jvmArgs: args.value
                  .split('\n')
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
              properties: Object.fromEntries([...controls].map(([key, c]) => [key, c.value])),
            });
            await ctx.refresh();
            ctx.notify(L('Settings saved.', '设置已保存。'));
          }).catch(ctx.error);
        };
        body.append(
          form,
          h(
            'section',
            { class: 'maintenance' },
            h('h2', {}, L('Server files', '服务端文件')),
            h(
              'div',
              { class: 'inline-actions' },
              ...[
                ['install', L('Install / repair', '安装 / 修复')],
                ['version', L('Change version…', '更改版本…')],
                ['config', L('Open configuration', '打开配置文件')],
                ...(current.engine === 'custom'
                  ? [['importJar', L('Import server JAR…', '导入服务端 JAR…')]]
                  : []),
              ].map(([action, label]) => {
                const button = ctx.button(label, () => perform(action), 'secondary');
                button.dataset.idle = 'true';
                return button;
              }),
            ),
          ),
          h(
            'section',
            { class: 'danger-zone' },
            ctx.button(
              L('Remove from list…', '从列表移除…'),
              async () => {
                await perform('delete');
                if (!ctx.state().servers.some((s) => s.id === id)) await ctx.navigate('servers');
              },
              'secondary danger',
            ),
          ),
        );
        update();
      })
      .catch(ctx.error);
  }
  function backupTab() {
    const list = h('div', { class: 'management-list' });
    const create = ctx.button(
      L('Back up worlds', '备份存档'),
      async () => {
        await ctx.request('server.backup', { serverId: id });
        await refreshBackups();
      },
      'primary',
    );
    create.dataset.idle = 'true';
    body.append(h('div', { class: 'inline-actions page-actions' }, create), list);
    async function refreshBackups() {
      const ids = await ctx.request<string[]>('server.backups', { serverId: id });
      if (!ctx.current() || tab !== 'backups') return;
      list.replaceChildren(
        ...ids.map((value) =>
          h(
            'div',
            { class: 'management-row' },
            h('span', { class: 'row-body' }, value),
            ctx.button(
              L('Restore…', '恢复…'),
              async () => {
                await ctx.request('server.restore', { serverId: id, id: value });
                await refreshBackups();
              },
              'secondary',
              ctx.state().serverStatus[id] !== 'stopped',
            ),
          ),
        ),
      );
      if (!ids.length) list.append(blank(L('No backups', '暂无备份')));
    }
    void refreshBackups().catch(ctx.error);
  }
  renderTab();
  return update;
}
