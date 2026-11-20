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
    L('Open Beta settings', '打开 Beta 设置', '開啟 Beta 設定'),
    () => ctx.request('terracotta.settings'),
    'secondary',
  );
  const language = select('terracottaNoticeLanguage', ctx.state().locale, [
    ['en', 'English'],
    ['zh-cn', '简体中文'],
    ['zh-tw', '繁體中文'],
  ]);
  const paragraphs = h('div');
  const license = h('input', { type: 'checkbox' });
  const network = h('input', { type: 'checkbox' });
  const licenseLabel = h('span');
  const networkLabel = h('span');
  const accept = ctx.button(
    L('Accept notices', '确认须知', '確認須知'),
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
    const locale = language.value === 'zh-tw' ? 'zhTw' : language.value === 'zh-cn' ? 'zh' : 'en';
    paragraphs.replaceChildren(...notice.paragraphs.map((p) => h('p', {}, p[locale])));
    licenseLabel.textContent = {
      en: 'I have read the Terracotta upstream license and project information.',
      zh: '我已阅读陶瓦的上游许可与项目信息。',
      zhTw: '我已閱讀陶瓦的上游授權與專案資訊。',
    }[locale];
    networkLabel.textContent = {
      en: 'I understand and agree to the Beta multiplayer notice above.',
      zh: '我理解并同意上述 Beta 联机须知。',
      zhTw: '我理解並同意上述 Beta 連線須知。',
    }[locale];
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
      h('legend', {}, L('Terracotta notices', '陶瓦联机须知', '陶瓦連線須知')),
      field(L('Language', '语言', '語言'), language),
      paragraphs,
      h(
        'p',
        {},
        h(
          'a',
          { href: notice.readme, target: '_blank', rel: 'noreferrer' },
          L('Upstream project', '上游项目', '上游專案'),
        ),
        ' · ',
        h(
          'a',
          { href: notice.license, target: '_blank', rel: 'noreferrer' },
          L('Upstream license', '上游许可', '上游授權'),
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
    L('Connect component', '连接组件', '連接元件'),
    () => run('terracotta.connect'),
    'primary',
  );
  const download = ctx.button(
    L('Download & set up', '下载安装', '下載安裝'),
    async () => {
      if ((await run('terracotta.download')) && ctx.state().terracotta?.installer)
        await run('terracotta.installer');
    },
    'primary',
  );
  const choose = ctx.button(
    L('Choose executable…', '选择可执行文件…', '選擇執行檔…'),
    () => run('terracotta.choose'),
    'secondary',
  );
  const installer = ctx.button(
    L('Open official macOS installer', '打开官方 macOS 安装包', '開啟官方 macOS 安裝套件'),
    () => run('terracotta.installer'),
    'secondary',
  );
  const host = ctx.button(
    L('Create room', '创建房间', '建立房間'),
    () => run('terracotta.host'),
    'secondary',
  );
  const join = ctx.button(
    L('Join room', '加入房间', '加入房間'),
    () => run('terracotta.join', { code: code.value }),
    'primary',
  );
  const leave = ctx.button(
    L('Leave room', '退出房间', '退出房間'),
    () => run('terracotta.leave'),
    'secondary',
  );
  const refresh = ctx.button(
    L('Refresh', '刷新', '重新整理'),
    () => run('terracotta.refresh'),
    'secondary',
  );
  const copyRoom = ctx.button(
    L('Copy room code', '复制房间码', '複製房間碼'),
    () => run('terracotta.copy'),
    'secondary',
  );
  const copyAddress = ctx.button(
    L('Copy game address', '复制游戏地址', '複製遊戲位址'),
    () => run('terracotta.copy', { address: true }),
    'secondary',
  );
  const launch = ctx.button(
    L('Launch selected instance', '启动所选实例', '啟動所選實例'),
    () => run('terracotta.launch', { instanceId: ctx.state().selectedInstance }),
    'secondary',
  );
  const revoke = ctx.button(
    L('Revoke confirmation', '撤回确认', '撤回確認'),
    () => run('terracotta.revoke'),
    'text-button',
  );
  const controls = h(
    'div',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h('legend', {}, L('Component', '联机组件', '連線元件')),
      h('div', { class: 'inline-actions' }, connect, download, choose, installer),
      status,
      error,
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, L('Room', '房间', '房間')),
      h(
        'p',
        { class: 'field-hint' },
        L(
          'Host: launch Minecraft, open a world to LAN, then create a room. Guests enter the room code.',
          '房主：启动 Minecraft，将世界开放到局域网，再创建房间。访客填写房间码加入。',
          '房主：啟動 Minecraft，將世界開放到區域網路，再建立房間。訪客填寫房間碼加入。',
        ),
      ),
      field(L('Room code', '房间码', '房間碼'), h('div', { class: 'input-action' }, code, join)),
      h('div', { class: 'inline-actions' }, host, leave, refresh),
      info,
      h('div', { class: 'inline-actions' }, copyRoom, copyAddress, launch),
    ),
    revoke,
  );
  body.append(
    heading(L('Terracotta multiplayer (Beta)', '陶瓦联机（Beta）', 'Terracotta（Beta）')),
    h('p', {}, notice.copyright),
    h(
      'div',
      { class: 'inline-actions page-actions' },
      settings,
      h(
        'a',
        {
          href: `${notice.source}/releases/tag/${notice.release}`,
          target: '_blank',
          rel: 'noreferrer',
        },
        L('Official downloads ↗', '官方下载 ↗', '官方下載 ↗'),
      ),
    ),
    terms,
    controls,
  );
  async function run(method: string, params: Record<string, unknown> = {}) {
    if (busy) return false;
    busy = true;
    update();
    try {
      await ctx.request(method, params);
      await ctx.refresh();
      return true;
    } catch (e) {
      ctx.error(e);
      return false;
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
      ? L('Beta settings', 'Beta 设置', 'Beta 設定')
      : L(
          'Enable in Settings to use Terracotta Beta',
          '在设置中开启陶瓦联机 Beta 后使用',
          '在設定中開啟陶瓦連線 Beta 後使用',
        );
    status.textContent =
      current?.version || current?.componentVersion
        ? `Terracotta ${current.version || current.componentVersion} · ${stateName(current.state)}`
        : L(
            'The official component runs separately from VS Code.',
            '官方联机组件独立于 VS Code 运行。',
            '官方連線元件獨立於 VS Code 執行。',
          );
    error.textContent = current?.error || '';
    connect.disabled = busy || connected;
    download.disabled = busy || connected;
    connect.className = current?.componentVersion || current?.version ? 'primary' : 'secondary';
    download.className = current?.componentVersion || current?.version ? 'secondary' : 'primary';
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
      disconnected: L('Not connected', '未连接', '未連接'),
      waiting: L('Ready', '就绪', '就緒'),
      'host-scanning': L('Waiting for a LAN world…', '等待局域网世界…', '等待區域網路世界…'),
      'host-starting': L('Starting room…', '正在创建房间…', '正在建立房間…'),
      'host-ok': L('Room open', '房间已开放', '房間已開放'),
      'guest-connecting': L('Connecting to room…', '正在连接房间…', '正在連接房間…'),
      'guest-starting': L('Preparing network…', '正在准备网络…', '正在準備網路…'),
      'guest-ok': L('Connected to room', '已加入房间', '已加入房間'),
      exception: L(
        'Connection failed. Leave the room and retry.',
        '连接失败，请退出房间后重试。',
        '連接失敗，請退出房間後重試。',
      ),
    };
    return names[state] || state;
  }
  update();
  return update;
}
