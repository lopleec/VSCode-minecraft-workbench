import { h } from './dom';
import { PageContext, field, input, select, heading } from './page-ui';
import notice from '../terracotta-notice.json';

export function renderTerracotta(body: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  let busy = false;
  const status = h('p', { role: 'status', class: 'field-hint' });
  const error = h('p', { class: 'warning', role: 'alert' });
  const info = h('div', { class: 'management-list' });
  const settings = ctx.button(
    L('Open Beta settings', '打开 Beta 设置'),
    () => ctx.request('terracotta.settings'),
    'secondary',
  );
  const language = select('terracottaNoticeLanguage', ctx.state().locale, [
    ['en', 'English'],
    ['zh-cn', '简体中文'],
  ]);
  const paragraphs = h('div');
  const license = h('input', { type: 'checkbox' });
  const network = h('input', { type: 'checkbox' });
  const licenseLabel = h('span');
  const networkLabel = h('span');
  const accept = ctx.button(
    L('Accept notices', '确认须知'),
    async () => {
      await run('terracotta.accept', {
        version: notice.version,
        license: license.checked,
        network: network.checked,
      });
    },
    'primary',
    true,
  );
  const noticeText = () => {
    const zh = language.value === 'zh-cn';
    paragraphs.replaceChildren(...notice.paragraphs.map((p) => h('p', {}, zh ? p.zh : p.en)));
    licenseLabel.textContent = zh
      ? '我已阅读陶瓦的上游许可与项目信息。'
      : 'I have read the Terracotta upstream license and project information.';
    networkLabel.textContent = zh
      ? '我理解并同意上述 Beta 联机须知。'
      : 'I understand and agree to the Beta multiplayer notice above.';
  };
  language.onchange = noticeText;
  noticeText();
  license.onchange = network.onchange = () => {
    accept.disabled = busy || !license.checked || !network.checked;
  };
  const terms = h(
    'section',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('Terracotta notices', '陶瓦联机须知')),
      field('Language / 语言', language),
      paragraphs,
      h(
        'p',
        {},
        h(
          'a',
          { href: notice.readme, target: '_blank', rel: 'noreferrer' },
          L('Upstream project', '上游项目'),
        ),
        ' · ',
        h(
          'a',
          { href: notice.license, target: '_blank', rel: 'noreferrer' },
          L('Upstream license', '上游许可'),
        ),
      ),
      h('label', { class: 'check' }, license, licenseLabel),
      h('label', { class: 'check' }, network, networkLabel),
      accept,
    ),
  );
  const code = input('terracottaCode');
  code.placeholder = 'U/XXXX-XXXX-XXXX-XXXX';
  code.maxLength = 21;
  code.spellcheck = false;
  const connect = ctx.button(
    L('Connect component', '连接组件'),
    () => run('terracotta.connect'),
    'primary',
  );
  const download = ctx.button(
    L('Download official component', '下载官方组件'),
    () => run('terracotta.download'),
    'secondary',
  );
  const choose = ctx.button(
    L('Choose executable…', '选择可执行文件…'),
    () => run('terracotta.choose'),
    'secondary',
  );
  const installer = ctx.button(
    L('Open official macOS installer', '打开官方 macOS 安装包'),
    () => run('terracotta.installer'),
    'secondary',
  );
  const host = ctx.button(L('Create room', '创建房间'), () => run('terracotta.host'), 'secondary');
  const join = ctx.button(
    L('Join room', '加入房间'),
    () => run('terracotta.join', { code: code.value }),
    'primary',
  );
  const leave = ctx.button(L('Leave room', '退出房间'), () => run('terracotta.leave'), 'secondary');
  const refresh = ctx.button(L('Refresh', '刷新'), () => run('terracotta.refresh'), 'secondary');
  const copyRoom = ctx.button(
    L('Copy room code', '复制房间码'),
    () => run('terracotta.copy'),
    'secondary',
  );
  const copyAddress = ctx.button(
    L('Copy game address', '复制游戏地址'),
    () => run('terracotta.copy', { address: true }),
    'secondary',
  );
  const launch = ctx.button(
    L('Launch selected instance', '启动所选实例'),
    () => run('terracotta.launch', { instanceId: ctx.state().selectedInstance }),
    'secondary',
  );
  const revoke = ctx.button(
    L('Revoke confirmation', '撤回确认'),
    () => run('terracotta.revoke'),
    'text-button',
  );
  const controls = h(
    'div',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('Component', '联机组件')),
      h('div', { class: 'inline-actions' }, connect, download, choose, installer),
      status,
      error,
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, L('Room', '房间')),
      h(
        'p',
        { class: 'field-hint' },
        L(
          'Host: launch Minecraft, open a world to LAN, then create a room. Guests enter the room code.',
          '房主：启动 Minecraft，将世界开放到局域网，再创建房间。访客填写房间码加入。',
        ),
      ),
      field(L('Room code', '房间码'), h('div', { class: 'input-action' }, code, join)),
      h('div', { class: 'inline-actions' }, host, leave, refresh),
      info,
      h('div', { class: 'inline-actions' }, copyRoom, copyAddress, launch),
    ),
    revoke,
  );
  body.append(
    heading(L('Terracotta multiplayer (Beta)', '陶瓦联机（Beta）')),
    h('p', {}, notice.copyright),
    settings,
    terms,
    controls,
  );
  async function run(method: string, params: Record<string, unknown> = {}) {
    if (busy) return;
    busy = true;
    update();
    try {
      await ctx.request(method, params);
      await ctx.refresh();
    } catch (e) {
      ctx.error(e);
    } finally {
      busy = false;
      update();
    }
  }
  function update() {
    const current = ctx.state().terracotta;
    const enabled = current?.enabled === true,
      accepted = current?.accepted === true,
      connected = current?.connected === true;
    terms.hidden = !enabled || accepted;
    controls.hidden = !enabled || !accepted;
    settings.textContent = enabled
      ? L('Beta settings', 'Beta 设置')
      : L('Enable in Settings to use Terracotta Beta', '在设置中开启陶瓦联机 Beta 后使用');
    status.textContent = current?.version
      ? `Terracotta ${current.version} · ${stateName(current.state)}`
      : L(
          'The official component runs separately from VS Code.',
          '官方联机组件独立于 VS Code 运行。',
        );
    error.textContent = current?.error || '';
    connect.disabled = busy || connected;
    download.disabled = busy || connected;
    choose.disabled = busy || connected;
    installer.disabled = busy;
    installer.hidden = !current?.installer;
    host.disabled = busy || !connected || current?.state !== 'waiting';
    join.disabled = host.disabled;
    leave.disabled = busy || !connected || current?.state === 'waiting';
    refresh.disabled = busy || !connected;
    copyRoom.disabled = busy || !current?.room;
    copyAddress.disabled = busy || !current?.address;
    launch.disabled = busy || !current?.address || !ctx.state().selectedInstance;
    revoke.disabled = busy;
    accept.disabled = busy || !license.checked || !network.checked;
    info.replaceChildren(
      h(
        'div',
        {},
        h('p', {}, stateName(current?.state || 'disconnected')),
        current?.room && h('div', { class: 'path-value' }, current.room),
        current?.address && h('div', { class: 'path-value' }, current.address),
        ...(current?.players || []).map((name) => h('span', {}, name)),
      ),
    );
  }
  function stateName(state: string) {
    const names: Record<string, string> = {
      disconnected: L('Not connected', '未连接'),
      waiting: L('Ready', '就绪'),
      'host-scanning': L('Waiting for a LAN world…', '等待局域网世界…'),
      'host-starting': L('Starting room…', '正在创建房间…'),
      'host-ok': L('Room open', '房间已开放'),
      'guest-connecting': L('Connecting to room…', '正在连接房间…'),
      'guest-starting': L('Preparing network…', '正在准备网络…'),
      'guest-ok': L('Connected to room', '已加入房间'),
      exception: L('Connection failed. Leave the room and retry.', '连接失败，请退出房间后重试。'),
    };
    return names[state] || state;
  }
  update();
  return update;
}
