import { h } from './dom';
import { PageContext, heading, blank } from './page-ui';
import { statusLabel } from './server-ui';

export function renderServers(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  const rows = h('div', { class: 'management-list' });
  main.append(
    heading(L('Servers', '服务端', '伺服器')),
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(
        L('New server', '新建服务端', '新增伺服器'),
        () => ctx.navigate('serverCreate'),
        'primary',
      ),
      ctx.button(
        L('Import server…', '导入服务端…', '匯入伺服器…'),
        () => ctx.navigate('serverImport'),
        'secondary',
      ),
    ),
    rows,
  );
  const update = () => {
    rows.replaceChildren(
      ...ctx.state().servers.map((server) => {
        const status = ctx.state().serverStatus[server.id] || 'stopped';
        return h(
          'article',
          { class: 'management-row' },
          h(
            'div',
            { class: 'row-body' },
            h('strong', {}, server.name),
            h(
              'p',
              { class: 'muted' },
              `${server.engine} · ${server.softwareVersion || server.minecraft}${server.build ? ' · ' + server.build : ''}`,
            ),
          ),
          h(
            'div',
            { class: 'inline-actions' },
            h('span', { class: 'muted' }, statusLabel(status, L)),
            ctx.button(
              L('Open', '打开', '開啟'),
              async () => {
                await ctx.request('server.action', { serverId: server.id, action: 'select' });
                await ctx.navigate('server');
              },
              'secondary',
            ),
            ctx.button(
              status === 'stopped' ? L('Start', '启动', '啟動') : L('Stop', '停止', '停止'),
              async () => {
                await ctx.request('server.action', { serverId: server.id, action: 'select' });
                await ctx.navigate('server');
                await ctx.request('server.action', {
                  serverId: server.id,
                  action: status === 'stopped' ? 'start' : 'stop',
                });
                await ctx.refresh();
              },
              'secondary',
              ['preparing', 'stopping'].includes(status),
            ),
          ),
        );
      }),
    );
    if (!ctx.state().servers.length)
      rows.append(blank(L('No servers', '暂无服务端', '暫無伺服器')));
  };
  update();
  return update;
}
