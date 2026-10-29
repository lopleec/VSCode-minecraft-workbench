import { h } from './dom';
import { PageContext, field, input, select, heading, busy } from './page-ui';
import type { ServerProfile, VersionManifest } from '../models';
import type { ServerBuild } from '../server-catalog';
import { gameVersionCategory } from '../game-versions';
import { engines } from './server-ui';

export function renderServerCreate(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  main.append(heading(L('New server', '新建服务端')));
  const name = input('serverName');
  name.required = true;
  name.maxLength = 100;
  const engine = select(
    'engine',
    'paper',
    engines.map(([id, title]) => [id, id === 'custom' ? L('Custom JAR', '自定义 JAR') : title]),
  );
  const search = input('versionSearch', '', 'search');
  search.placeholder = L('Filter versions…', '筛选版本…');
  const category = select('versionType', 'release', [
    ['release', L('Release', '正式版')],
    ['all', L('All versions', '全部版本')],
    ['snapshot', L('Snapshot / preview', '快照 / 预发布版')],
    ['april_fools', L('April Fools', '愚人节版本')],
    ['old_beta', 'Beta'],
    ['old_alpha', 'Alpha'],
  ]);
  const version = select('version', '', []);
  version.size = 8;
  const build = select('build', '', []);
  const experimental = h('input', { type: 'checkbox' });
  const parent = input('serverParent', ctx.state().defaults.serverDirectory);
  const behavior = select('afterCreate', 'start', [
    ['start', L('Install and start', '安装并启动')],
    ['install', L('Install only', '仅安装')],
    ['create', L('Create only', '仅创建')],
  ]);
  const info = h('div', { class: 'setup-status', 'aria-live': 'polite' });
  const submit = h(
    'button',
    { class: 'primary', type: 'submit', disabled: true },
    L('Create and start', '创建并启动'),
  );
  const form = h('form', { class: 'management-form setup-form' });
  let all: string[] = [];
  let builds: ServerBuild[] = [];
  let manifest: VersionManifest | undefined;
  let sequence = 0;
  let buildsSequence = 0;
  let automaticName = true;
  let creating = false;
  const existingIds = new Set(ctx.state().servers.map((s) => s.id));
  name.oninput = () => {
    automaticName = false;
  };
  const suggestName = () => {
    if (automaticName)
      name.value =
        `${engines.find(([id]) => id === engine.value)?.[1] || ''} ${version.value}`.trim();
  };
  const updateSubmit = () => {
    const custom = engine.value === 'custom';
    submit.disabled =
      creating || !version.value || (!['vanilla', 'custom'].includes(engine.value) && !build.value);
    behavior.disabled = custom;
    submit.textContent =
      custom || behavior.value === 'create'
        ? L('Create server', '创建服务端')
        : behavior.value === 'install'
          ? L('Create and install', '创建并安装')
          : L('Create and start', '创建并启动');
  };
  const displayBuilds = () => {
    const previous = build.value;
    const visible = builds.filter((b) => experimental.checked || b.stable);
    build.replaceChildren(
      ...visible.map((b) =>
        h(
          'option',
          { value: b.id, selected: b.id === previous },
          b.id + (b.stable ? '' : L(' · Experimental', ' · 实验版')),
        ),
      ),
    );
    build.disabled = !builds.length;
    if (!builds.length && ['vanilla', 'custom'].includes(engine.value))
      build.append(h('option', { value: '' }, L('Not required', '无需选择')));
    info.textContent =
      builds.length && !visible.length
        ? L(
            'No stable builds. Enable experimental builds to select one.',
            '暂无稳定构建，可勾选实验版后选择。',
          )
        : !builds.length && !['vanilla', 'custom'].includes(engine.value)
          ? L('No builds for this version.', '此版本暂无可用构建。')
          : '';
    updateSubmit();
  };
  const loadBuilds = async () => {
    const current = ++buildsSequence;
    suggestName();
    submit.disabled = true;
    build.replaceChildren(h('option', {}, L('Loading…', '加载中…')));
    build.disabled = true;
    try {
      const result = await ctx.request<ServerBuild[]>('server.builds', {
        engine: engine.value,
        version: version.value,
      });
      if (!ctx.current() || current !== buildsSequence) return;
      builds = result;
      displayBuilds();
    } catch (error) {
      if (ctx.current() && current === buildsSequence) {
        info.textContent = (error as Error).message;
        build.replaceChildren();
        submit.disabled = true;
      }
    }
  };
  const filter = () => {
    const previous = version.value;
    const visible = all.filter(
      (v) =>
        v.toLowerCase().includes(search.value.toLowerCase()) &&
        (category.value === 'all' ||
          (manifest?.versions.some((m) => m.id === v)
            ? gameVersionCategory(manifest.versions.find((m) => m.id === v)!)
            : 'release') === category.value),
    );
    version.replaceChildren(
      ...visible.map((v) => h('option', { value: v, selected: v === previous }, v)),
    );
    version.value = visible.includes(previous) ? previous : visible[0] || '';
    if (!visible.length) {
      build.replaceChildren();
      info.textContent = L('No matching versions.', '没有符合条件的版本。');
      updateSubmit();
      return;
    }
    void loadBuilds();
  };
  const load = async () => {
    const current = ++sequence;
    ++buildsSequence;
    info.textContent = L('Loading versions…', '加载版本…');
    submit.disabled = true;
    version.disabled = true;
    build.disabled = true;
    try {
      const result = await ctx.request<{ versions: string[] }>('server.catalog', {
        engine: engine.value,
      });
      if (!ctx.current() || current !== sequence) return;
      all = result.versions;
      version.disabled = false;
      search.value = '';
      filter();
    } catch (error) {
      if (ctx.current() && current === sequence) {
        info.textContent = (error as Error).message;
        ctx.error(error);
      }
    }
  };
  engine.onchange = () => {
    experimental.checked = false;
    void load();
  };
  search.oninput = filter;
  category.onchange = filter;
  version.onchange = () => void loadBuilds();
  build.onchange = updateSubmit;
  experimental.onchange = displayBuilds;
  behavior.onchange = updateSubmit;
  form.append(
    h(
      'fieldset',
      {},
      h('legend', {}, L('Server', '服务端')),
      h(
        'div',
        { class: 'form-grid' },
        field(L('Name', '名称'), name),
        field(L('Software', '服务端类型'), engine),
      ),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, L('Version', '版本')),
      h(
        'div',
        { class: 'version-search-row' },
        search,
        category,
        ctx.button(L('Refresh', '刷新'), () => load(), 'secondary'),
      ),
      field(L('Minecraft / software version', 'Minecraft / 软件版本'), version),
      field(L('Build / loader version', '构建 / Loader 版本'), build),
      h('label', { class: 'check' }, experimental, L('Show experimental builds', '显示实验版构建')),
    ),
    h(
      'details',
      { class: 'advanced-options' },
      h('summary', {}, L('Directory', '目录')),
      field(
        L('Parent directory', '父目录'),
        h(
          'div',
          { class: 'directory-control' },
          parent,
          ctx.button(
            L('Browse…', '浏览…'),
            async () => {
              const folder = await ctx.request<string | undefined>('launcher.pickDirectory');
              if (folder) parent.value = folder;
            },
            'secondary',
          ),
        ),
      ),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, L('Install', '安装')),
      field(L('After creation', '创建后'), behavior),
      h(
        'p',
        { class: 'field-hint' },
        L('Java is detected or downloaded automatically.', '自动检测或下载所需 Java。'),
      ),
      h(
        'div',
        { class: 'save-row' },
        submit,
        ctx.button(L('Cancel', '取消'), () => ctx.navigate('servers'), 'secondary'),
      ),
    ),
    info,
  );
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    creating = true;
    updateSubmit();
    void busy(form, async () => {
      const server = await ctx.request<ServerProfile>('server.create', {
        value: {
          name: name.value,
          engine: engine.value,
          version: version.value,
          build: build.value,
          parent: parent.value,
        },
        install: engine.value !== 'custom' && behavior.value === 'install',
        start: engine.value !== 'custom' && behavior.value === 'start',
      });
      await ctx.refresh();
      if (!ctx.current()) return;
      await ctx.request('server.action', { serverId: server.id, action: 'select' });
      await ctx.navigate('server');
    })
      .catch(async (error) => {
        await ctx.refresh();
        // A created server remains available after a download failure.
        if (!ctx.current()) return;
        if (ctx.state().servers.some((s) => !existingIds.has(s.id))) await ctx.navigate('server');
        ctx.error(error);
      })
      .finally(() => {
        creating = false;
        updateSubmit();
      });
  };
  main.append(form);
  void ctx
    .request<VersionManifest>('launcher.gameVersions')
    .then((value) => {
      manifest = value;
      return load();
    })
    .catch((error) => {
      ctx.error(error);
      void load();
    });
  return () => {};
}
