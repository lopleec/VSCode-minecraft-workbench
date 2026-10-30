import { h } from './dom';
import { renderServers, renderServerCreate, renderServer, serverContent } from './server-page';
import { renderAgreements } from './agreements-page';
import { renderInstances, renderSetup } from './setup-page';
import { renderImport } from './import-page';
import { renderManagement, managementPages } from './manage-pages';
import type { PageContext } from './page-ui';
import type {
  Bootstrap,
  BrowserHit,
  InstalledEntry,
  PlanResult,
  ProjectDetail,
  SearchPage,
  VersionsPage,
  WorkbenchPage,
} from './protocol';
import type { Instance, ModVersion } from '../models';
import type { ProjectKind } from '../modrinth';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(value: unknown): void;
};
const bridge = acquireVsCodeApi();
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let requestId = 0;
function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    bridge.postMessage({
      id,
      method,
      params: {
        instanceId: boot?.selectedInstance,
        ...(boot?.mode === 'server' && boot.selectedServer
          ? { serverId: boot.selectedServer }
          : {}),
        kind,
        ...params,
      },
    });
  });
}
let boot: Bootstrap;
let page: WorkbenchPage = 'discover';
let agreementLanguage: 'auto' | 'en' | 'zh-cn' = 'auto';
let kind: ProjectKind = 'mod';
let query = '';
let order = 'downloads';
let onlyCompatible = true;
let hits: BrowserHit[] = [];
let totalHits = 0;
let installed: InstalledEntry[] = [];
let serverUpdates = new Map<string, string>();
let detail: ProjectDetail | undefined;
let detailTab: 'about' | 'versions' = 'about';
let versions: ModVersion[] = [];
let versionsTotal = 0;
let versionGames: string[] = [];
let versionLoaders: string[] = [];
let versionQuery = '';
let versionGame = '';
let versionLoader = '';
let versionChannel = 'release';
let versionCompatible = true;
let optional = false;
let selectedVersion: string | undefined;
let plan: PlanResult | undefined;
let generation = 0;
let versionGeneration = 0;
let planGeneration = 0;
let updateManaged: (() => void) | undefined;
let syncMemoryControls: (() => void) | undefined;
let debounce: ReturnType<typeof setTimeout>;
const root = document.getElementById('app')!;
const L = (en: string, zh: string) => (boot?.locale === 'zh-cn' ? zh : en);
const currentInstance = () => boot.instances.find((i) => i.id === boot.selectedInstance);
const currentTarget = () =>
  boot.mode === 'server'
    ? boot.servers.find((s) => s.id === boot.selectedServer)
    : currentInstance();
function find(id: string) {
  return document.getElementById(id)!;
}
function button(label: string, action: () => unknown, style = '', disabled = false) {
  return h(
    'button',
    {
      type: 'button',
      class: style,
      disabled,
      onclick: () => {
        void Promise.resolve().then(action).catch(showError);
      },
    },
    label,
  );
}
function dropdown(
  label: string,
  value: string,
  options: [string, string][],
  change: (value: string) => unknown,
  id?: string,
) {
  const node = h('select', {
    id,
    'aria-label': label,
    onchange: (event: Event) => {
      void Promise.resolve(change((event.target as HTMLSelectElement).value)).catch(showError);
    },
  });
  for (const [key, title] of options)
    node.append(h('option', { value: key, selected: key === value }, title));
  return node;
}
function check(
  label: string,
  checked: boolean,
  change: (checked: boolean) => unknown,
  disabled = false,
) {
  return h(
    'label',
    { class: 'check' },
    h('input', {
      type: 'checkbox',
      checked,
      disabled,
      onchange: (event: Event) => {
        void Promise.resolve(change((event.target as HTMLInputElement).checked)).catch(showError);
      },
    }),
    h('span', {}, label),
  );
}
function icon(url: string | undefined, name: string) {
  const wrap = h(
    'div',
    { class: 'project-icon', 'aria-hidden': 'true' },
    h('span', {}, name.slice(0, 1).toUpperCase() || '◇'),
  );
  if (boot.preferences.icons && url && /^https:\/\//.test(url)) {
    const image = h('img', {
      src: url,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
      onload: () => wrap.classList.add('loaded'),
      onerror: () => image.remove(),
    });
    wrap.append(image);
  }
  return wrap;
}
function badge(text: string, className = '') {
  return h('span', { class: `badge ${className}` }, text);
}
function number(value: number) {
  return new Intl.NumberFormat(boot.locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value || 0);
}
function date(value: string | undefined) {
  return value
    ? new Intl.DateTimeFormat(boot.locale, { dateStyle: 'medium' }).format(new Date(value))
    : '—';
}
function persist() {
  bridge.setState({ page, kind, query, order, onlyCompatible, agreementLanguage });
}
function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const area = document.getElementById('notice');
  if (!area) return;
  area.replaceChildren(
    h('span', {}, message),
    button(L('Dismiss', '关闭'), () => area.replaceChildren(), 'text-button'),
  );
  area.className = 'notice error';
}
function notice(text: string) {
  const area = find('notice');
  area.className = 'notice success';
  area.replaceChildren(
    h('span', {}, text),
    button('×', () => area.replaceChildren(), 'text-button'),
  );
}
async function action(name: string) {
  let resultMessage = '';
  if (boot.mode === 'server' && ['importContent', 'updates', 'conflicts'].includes(name)) {
    const serverId = boot.selectedServer;
    if (name === 'importContent')
      await call('server.action', { serverId, action: 'importContent' });
    else {
      const result = await call<unknown[]>('server.content', {
        serverId,
        action: name === 'updates' ? 'updates' : 'conflicts',
      });
      if (name === 'updates') {
        const updates = result as { item: { file: string; kind: string } }[];
        serverUpdates = new Map(updates.map((update) => [update.item.file, update.item.kind]));
        resultMessage = updates.length
          ? L(
              `${updates.length} updates available. Review the installed files below.`,
              `${updates.length} 个可用更新，可在下方逐个安装。`,
            )
          : L('No updates available.', '暂无可用更新。');
      } else
        resultMessage = result.length
          ? result.join('\n')
          : L('No conflicts found.', '未发现冲突。');
    }
  } else await call('action', { action: name });
  boot = await call<Bootstrap>('ready');
  render();
  if (resultMessage) notice(resultMessage);
}
function shell() {
  document.documentElement.lang = boot.locale === 'zh-cn' ? 'zh-CN' : 'en';
  document.body.dataset.density = boot.preferences.density;
  const isServer = boot.mode === 'server';
  const instance = currentInstance();
  const server = boot.servers.find((s) => s.id === boot.selectedServer);
  const pages: [WorkbenchPage, string][] = isServer
    ? [
        ['servers', L('Servers', '服务端')],
        ['server', L('Console & settings', '控制台与设置')],
        ['discover', L('Discover', '发现')],
        ['installed', L('Installed', '已安装')],
        ['java', L('Manage', '管理')],
      ]
    : boot.mode === 'developer'
      ? [
          ['projects', L('Projects', '项目')],
          ['java', L('Manage', '管理')],
        ]
      : [
          ['instances', L('Instances', '实例')],
          ['discover', L('Discover', '发现')],
          ['installed', L('Installed', '已安装')],
          ['instance', L('Instance settings', '实例设置')],
          ['accounts', L('Manage', '管理')],
        ];
  const modePicker = dropdown(
    L('Mode', '模式'),
    boot.mode,
    [
      ['launcher', L('Launcher', '启动')],
      ['developer', L('Developer', '开发')],
      ['server', L('Server', '开服')],
    ],
    async (mode) => {
      boot = await call<Bootstrap>('mode', { mode });
      page = mode === 'server' ? 'servers' : mode === 'developer' ? 'projects' : 'instances';
      kind =
        mode === 'server'
          ? serverContent(boot.servers.find((s) => s.id === boot.selectedServer)?.engine || '') ||
            'plugin'
          : 'mod';
      detail = undefined;
      plan = undefined;
      query = '';
      persist();
      render();
    },
    'mode-picker',
  );
  const picker =
    boot.mode === 'developer'
      ? undefined
      : dropdown(
          isServer ? L('Active server', '当前服务端') : L('Active instance', '当前实例'),
          (isServer ? server?.id : instance?.id) || '',
          [
            [
              '',
              isServer ? L('Select a server', '选择服务端') : L('Select an instance', '选择实例'),
            ],
            ...(isServer ? boot.servers : boot.instances).map(
              (i) => [i.id, `${i.name} · ${i.minecraft}`] as [string, string],
            ),
          ],
          async (value) => {
            if (!value) return;
            if (isServer) {
              await call('server.action', { serverId: value, action: 'select' });
              boot = await call<Bootstrap>('ready');
              kind = serverContent(boot.servers.find((s) => s.id === value)!.engine) || 'plugin';
            } else boot = await call<Bootstrap>('selectInstance', { instanceId: value });
            detail = undefined;
            plan = undefined;
            render();
          },
          'instance-picker',
        );
  root.replaceChildren(
    h(
      'header',
      { class: 'app-header' },
      h(
        'div',
        { class: 'mode-navigation' },
        modePicker,
        h(
          'nav',
          { class: 'tabs', 'aria-label': L('Workbench pages', '工作台页面') },
          ...pages.map(([value, label]) =>
            button(
              label,
              () => {
                page = value;
                detail = undefined;
                plan = undefined;
                persist();
                render();
              },
              value === page ||
                (value === 'instances' && ['create', 'version', 'import'].includes(page)) ||
                (value === 'servers' && page === 'serverCreate') ||
                (['accounts', 'java'].includes(value) &&
                  managementPages.includes(page) &&
                  page !== 'projects')
                ? 'tab active'
                : 'tab',
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'header-actions' },
        picker,
        button(
          boot.locale === 'en' ? 'EN' : '中',
          () => action('language'),
          'toolbar-button language',
        ),
        button(L('Settings', '设置'), () => action('settings'), 'toolbar-button'),
      ),
    ),
    h('div', { id: 'notice', role: 'status', 'aria-live': 'polite', class: 'notice' }),
    h('main', { id: 'main' }),
    h('footer', { id: 'task-status', 'aria-live': 'polite' }),
  );
  updateJobs();
}
function updateJobs() {
  const footer = document.getElementById('task-status');
  if (!footer) return;
  const job = boot.jobs.find((j) => j.status === 'running');
  footer.classList.toggle('visible', !!job);
  footer.replaceChildren(
    ...(job
      ? [
          h('span', { class: 'spinner' }),
          h('span', { class: 'task-name' }, job.label),
          h('span', { class: 'muted task-detail' }, job.detail || L('Working…', '处理中…')),
        ]
      : []),
  );
}
function categories() {
  const server =
    boot.mode === 'server' ? boot.servers.find((s) => s.id === boot.selectedServer) : undefined;
  const serverKind = serverContent(server?.engine || '');
  const options: [ProjectKind, string][] =
    boot.mode === 'server'
      ? serverKind
        ? [[serverKind, serverKind === 'plugin' ? L('Plugins', '插件') : L('Mods', '模组')]]
        : []
      : [
          ['mod', L('Mods', '模组')],
          ['modpack', L('Modpacks', '整合包')],
          ['resourcepack', L('Resource packs', '资源包')],
          ['shader', L('Shaders', '光影包')],
        ];
  return h(
    'div',
    { class: 'segments', 'aria-label': L('Content type', '内容类型') },
    ...options
      .filter(([value]) => page === 'discover' || value !== 'modpack')
      .map(([value, label]) =>
        button(
          label,
          () => {
            kind = value;
            detail = undefined;
            plan = undefined;
            query = '';
            persist();
            render();
          },
          value === kind ? 'segment active' : 'segment',
        ),
      ),
  );
}
function render() {
  generation++;
  versionGeneration++;
  planGeneration++;
  updateManaged = undefined;
  syncMemoryControls = undefined;
  if (!boot.consent.accepted || page === 'agreements') {
    renderAgreements(root, {
      locale: agreementLanguage === 'auto' ? boot.locale : agreementLanguage,
      preference: agreementLanguage,
      status: boot.consent,
      request: call,
      accept: async () => {
        boot = await call<Bootstrap>('consent.accept', {
          version: boot.consent.version,
          minecraftEula: true,
          workbenchTerms: true,
        });
        page = 'instances';
        persist();
        render();
      },
      back: () => {
        page = 'instances';
        render();
      },
      language: async (language) => {
        agreementLanguage = language;
        persist();
        render();
      },
    });
    return;
  }
  if (boot.mode === 'server' && !['mod', 'plugin'].includes(kind))
    kind =
      serverContent(boot.servers.find((s) => s.id === boot.selectedServer)?.engine || '') ||
      'plugin';
  if (boot.mode !== 'server' && kind === 'plugin') kind = 'mod';
  shell();
  if (
    [
      'servers',
      'serverCreate',
      'server',
      'instances',
      'create',
      'import',
      'version',
      ...managementPages,
    ].includes(page)
  ) {
    const main = find('main');
    main.className = 'management-page';
    const sequence = generation;
    const ctx: PageContext = {
      state: () => boot,
      text: L,
      request: call,
      button,
      notify: notice,
      error: showError,
      current: () => sequence === generation,
      refresh: async () => {
        boot = await call<Bootstrap>('ready');
        updateJobs();
        updateManaged?.();
      },
      navigate: async (value) => {
        boot = await call<Bootstrap>('ready');
        page = value;
        detail = undefined;
        plan = undefined;
        persist();
        render();
      },
    };
    if (page === 'servers') updateManaged = renderServers(main, ctx);
    else if (page === 'serverCreate') updateManaged = renderServerCreate(main, ctx);
    else if (page === 'server') updateManaged = renderServer(main, ctx);
    else if (page === 'instances') updateManaged = renderInstances(main, ctx);
    else if (page === 'import') renderImport(main, ctx);
    else if (page === 'create' || page === 'version')
      updateManaged = renderSetup(main, page === 'version', ctx);
    else updateManaged = renderManagement(main, page, ctx);
    return;
  }
  if (page === 'instance') {
    renderInstance();
    return;
  }
  if (
    boot.mode === 'server' &&
    (!boot.selectedServer ||
      !serverContent(boot.servers.find((s) => s.id === boot.selectedServer)?.engine || ''))
  ) {
    find('main').append(
      empty(
        L('Select a mod or plugin server', '请选择模组端或插件端'),
        '',
        () => {
          page = 'servers';
          render();
        },
        L('Servers', '服务端'),
      ),
    );
    return;
  }
  if (page === 'installed' && kind === 'modpack') kind = 'mod';
  find('main').append(
    categories(),
    h(
      'div',
      { class: 'content-layout', id: 'layout' },
      h(
        'section',
        { class: 'browser-pane', 'aria-label': L('Content list', '内容列表') },
        h('div', { class: 'browser-toolbar', id: 'browser-toolbar' }),
        h(
          'div',
          { class: 'list-scroll', id: 'list-scroll', tabindex: '0' },
          h('div', { id: 'results' }),
        ),
      ),
      h('aside', {
        class: 'detail-panel',
        id: 'detail',
        'aria-label': L('Project details', '项目详情'),
      }),
    ),
  );
  renderToolbar();
  if (page === 'discover') void loadSearch(false);
  else void loadInstalled();
  if (detail) renderDetail();
}
function renderToolbar() {
  const search = h('input', {
    type: 'search',
    class: 'search-input',
    'aria-label': L('Search content', '搜索内容'),
    placeholder:
      page === 'discover'
        ? L('Search Modrinth…', '搜索 Modrinth…')
        : L('Filter installed files…', '筛选已安装文件…'),
    value: query,
    oninput: (event: Event) => {
      query = (event.target as HTMLInputElement).value;
      persist();
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (page === 'discover') void loadSearch(false);
        else renderInstalled();
      }, 300);
    },
  });
  if (page === 'discover')
    find('browser-toolbar').replaceChildren(
      h(
        'div',
        { class: 'search-row' },
        search,
        dropdown(
          L('Sort by', '排序'),
          order,
          [
            ['downloads', L('Downloads', '下载量')],
            ['relevance', L('Relevance', '相关度')],
            ['follows', L('Followers', '关注数')],
            ['updated', L('Recently updated', '最近更新')],
            ['newest', L('Newest', '最新发布')],
          ],
          (value) => {
            order = value;
            persist();
            return loadSearch(false);
          },
        ),
      ),
      h(
        'div',
        { class: 'filter-row' },
        check(
          boot.mode === 'server'
            ? L('Compatible with server', '兼容当前服务端')
            : L('Compatible with instance', '兼容当前实例'),
          onlyCompatible && !!currentTarget(),
          (value) => {
            onlyCompatible = value;
            persist();
            return loadSearch(false);
          },
          !currentTarget(),
        ),
        h('span', { class: 'muted', id: 'result-count' }),
      ),
    );
  else
    find('browser-toolbar').replaceChildren(
      h(
        'div',
        { class: 'search-row' },
        search,
        button(L('Import files', '导入文件'), () => action('importContent'), 'secondary'),
        boot.mode === 'launcher' &&
          button(L('Import modpack…', '导入整合包…'), () => action('importPack'), 'secondary'),
      ),
      h(
        'div',
        { class: 'filter-row' },
        h('span', { class: 'muted', id: 'result-count' }),
        h(
          'div',
          { class: 'inline-actions' },
          button(L('Check updates', '检查更新'), () => action('updates'), 'secondary'),
          button(L('Check conflicts', '检查冲突'), () => action('conflicts'), 'secondary'),
        ),
      ),
    );
}
async function loadSearch(append: boolean) {
  const sequence = ++generation;
  if (!append) {
    hits = [];
    find('results').replaceChildren(
      h(
        'div',
        { class: 'loading', role: 'status' },
        h('span', { class: 'spinner' }),
        L('Loading projects…', '加载项目…'),
      ),
    );
  }
  try {
    const data = await call<SearchPage>('search', {
      query,
      order,
      compatible: onlyCompatible,
      offset: append ? hits.length : 0,
    });
    if (sequence !== generation || page !== 'discover') return;
    hits = append ? [...hits, ...data.hits] : data.hits;
    totalHits = data.total_hits;
    find('result-count').textContent = L(
      `${number(totalHits)} projects`,
      `${number(totalHits)} 个项目`,
    );
    const results = find('results');
    results.replaceChildren();
    if (!hits.length)
      results.append(
        empty(
          L('No matching projects', '没有符合条件的项目'),
          L(
            'Try another keyword or turn off the compatibility filter.',
            '尝试其他关键词，或关闭兼容性筛选。',
          ),
        ),
      );
    for (const hit of hits)
      results.append(
        h(
          'article',
          {
            class: `project-row ${detail?.project.id === hit.project_id ? 'selected' : ''}`,
            'data-project': hit.project_id,
          },
          icon(hit.icon_url, hit.title),
          h(
            'div',
            { class: 'project-summary' },
            button(hit.title, () => openProject(hit.project_id, 'about'), 'project-title'),
            h('p', { class: 'project-description' }, hit.description),
            h(
              'div',
              { class: 'metadata' },
              h('span', {}, `↓ ${number(hit.downloads)}`),
              hit.author && h('span', {}, hit.author),
            ),
          ),
          button(
            L('Versions', '版本'),
            () => openProject(hit.project_id, 'versions'),
            'secondary row-action',
          ),
        ),
      );
    if (hits.length < totalHits)
      results.append(
        button(
          L('Load more projects', '加载更多项目'),
          () => loadSearch(true),
          'secondary load-more',
        ),
      );
    if (!append) find('list-scroll').scrollTop = 0;
  } catch (error) {
    if (sequence === generation) {
      find('results').replaceChildren(
        empty(L('Could not load projects', '无法加载项目'), String((error as Error).message), () =>
          loadSearch(false),
        ),
      );
      showError(error);
    }
  }
}
async function loadInstalled() {
  const sequence = ++generation;
  if (!currentTarget()) {
    find('results').replaceChildren(
      empty(
        L('Select an instance', '选择实例'),
        L('Choose an instance above to manage its files.', '在上方选择实例以管理文件。'),
        () => action('createInstance'),
        L('New instance', '新建实例'),
      ),
    );
    return;
  }
  find('results').replaceChildren(
    h(
      'div',
      { class: 'loading' },
      h('span', { class: 'spinner' }),
      L('Loading installed files…', '加载已安装文件…'),
    ),
  );
  try {
    const result = await call<InstalledEntry[]>('installed');
    if (sequence !== generation || page !== 'installed') return;
    installed = result;
    renderInstalled();
    void call<InstalledEntry[]>('installedMetadata')
      .then((details) => {
        if (sequence !== generation || page !== 'installed') return;
        for (const entry of installed) {
          const metadata = details.find(
            (item) => item.projectId && item.projectId === entry.projectId,
          );
          if (metadata)
            Object.assign(entry, {
              title: metadata.title,
              description: metadata.description,
              icon: metadata.icon,
            });
        }
        const results = find('results');
        const scroll = results.scrollTop;
        renderInstalled();
        results.scrollTop = scroll;
      })
      .catch(() => {});
  } catch (error) {
    if (sequence === generation) showError(error);
  }
}
function renderInstalled() {
  const filtered = installed.filter((entry) =>
    `${entry.name} ${entry.title || ''} ${entry.file}`.toLowerCase().includes(query.toLowerCase()),
  );
  find('result-count').textContent = L(`${filtered.length} files`, `${filtered.length} 个文件`);
  const results = find('results');
  results.replaceChildren();
  if (!filtered.length)
    results.append(
      empty(
        query
          ? L('No matching files', '没有匹配的文件')
          : L('No content installed', '尚未安装内容'),
        '',
        () => {
          if (!query) page = 'discover';
          query = '';
          render();
        },
        query ? L('Clear filter', '清除筛选') : L('Browse Modrinth', '浏览 Modrinth'),
      ),
    );
  for (const entry of filtered)
    results.append(
      h(
        'article',
        { class: `project-row ${entry.enabled ? '' : 'disabled-content'}` },
        icon(entry.icon, entry.title || entry.name),
        h(
          'div',
          { class: 'project-summary' },
          h(
            'div',
            { class: 'title-line' },
            entry.projectId
              ? button(
                  entry.title || entry.name,
                  () => openProject(entry.projectId!, 'versions'),
                  'project-title',
                )
              : h('strong', {}, entry.name),
            !entry.enabled && badge(L('Disabled', '已禁用')),
          ),
          h('p', { class: 'project-description' }, entry.description || entry.file),
          h('div', { class: 'metadata', title: entry.file }, entry.file),
        ),
        h(
          'div',
          { class: 'installed-actions' },
          boot.mode === 'server' &&
            serverUpdates.has(entry.file) &&
            button(
              L('Update', '更新'),
              async () => {
                await call('server.content', {
                  action: 'update',
                  file: entry.file,
                  kind: entry.kind,
                });
                serverUpdates.delete(entry.file);
                await loadInstalled();
              },
              'secondary',
            ),
          button(
            entry.enabled ? L('Disable', '禁用') : L('Enable', '启用'),
            async () => {
              await call('toggle', { file: entry.file });
              await loadInstalled();
            },
            'secondary',
          ),
          button(
            L('Remove', '删除'),
            async () => {
              await call('remove', { file: entry.file });
              await loadInstalled();
            },
            'text-button danger',
          ),
        ),
      ),
    );
}
function empty(title: string, body: string, retry?: () => unknown, label = L('Retry', '重试')) {
  return h(
    'div',
    { class: 'empty-state' },
    h('h2', {}, title),
    h('p', {}, body),
    retry && button(label, retry, 'secondary'),
  );
}
async function openProject(id: string, tab: 'about' | 'versions') {
  const sequence = ++versionGeneration;
  planGeneration++;
  plan = undefined;
  selectedVersion = undefined;
  for (const row of document.querySelectorAll<HTMLElement>('.project-row'))
    row.classList.toggle('selected', row.dataset.project === id);
  find('layout').classList.add('has-detail');
  find('detail').replaceChildren(
    h(
      'div',
      { class: 'loading' },
      h('span', { class: 'spinner' }),
      L('Loading project…', '加载项目…'),
    ),
  );
  try {
    const value = await call<ProjectDetail>('project', { projectId: id });
    if (sequence !== versionGeneration) return;
    detail = value;
    detailTab = tab;
    versionGames = [];
    versionLoaders = [];
    versionQuery = '';
    versionGame = '';
    versionLoader = '';
    versionChannel = boot.preferences.channel;
    versionCompatible = boot.preferences.compatibleOnly;
    optional = boot.preferences.optional;
    renderDetail();
  } catch (error) {
    showError(error);
  }
}
function renderDetail() {
  if (!detail) return;
  find('layout').classList.add('has-detail');
  const project = detail.project;
  find('detail').replaceChildren(
    h(
      'div',
      { class: 'detail-heading' },
      button(
        L('← Back', '← 返回'),
        () => {
          detail = undefined;
          plan = undefined;
          planGeneration++;
          find('layout').classList.remove('has-detail');
          find('detail').replaceChildren();
          for (const row of document.querySelectorAll('.project-row'))
            row.classList.remove('selected');
        },
        'text-button',
      ),
      button(
        '↗ Modrinth',
        () => call('external', { url: `https://modrinth.com/project/${project.id}` }),
        'text-button',
      ),
    ),
    h(
      'div',
      { class: 'detail-title' },
      icon(project.icon_url, project.title),
      h(
        'div',
        {},
        h('h1', {}, project.title),
        h(
          'div',
          { class: 'metadata' },
          `↓ ${number(project.downloads)} · ${number(project.followers)} ${L('followers', '关注')}`,
        ),
      ),
    ),
    h(
      'div',
      { class: 'detail-tabs' },
      button(
        L('Overview', '简介'),
        () => {
          detailTab = 'about';
          renderDetail();
        },
        detailTab === 'about' ? 'tab active' : 'tab',
      ),
      button(
        L('Versions', '所有版本'),
        () => {
          detailTab = 'versions';
          renderDetail();
        },
        detailTab === 'versions' ? 'tab active' : 'tab',
      ),
    ),
    h('div', { class: 'detail-scroll', id: 'detail-scroll' }),
  );
  const body = find('detail-scroll');
  if (detailTab === 'about') {
    body.append(
      h('p', { class: 'detail-description' }, project.description),
      h(
        'div',
        { class: 'badge-list' },
        ...project.categories.slice(0, 12).map((value) => badge(value)),
      ),
      h(
        'section',
        { class: 'about-block' },
        h('h2', {}, L('Supported loaders', '支持的加载器')),
        h('p', {}, project.loaders.join(', ') || '—'),
      ),
      h(
        'section',
        { class: 'about-block' },
        h('h2', {}, L('Game versions', '游戏版本')),
        h('p', { class: 'version-support' }, project.game_versions.join(', ')),
      ),
      h(
        'p',
        { class: 'muted' },
        `${L('License', '许可')}: ${project.license?.name || project.license?.id || '—'}`,
      ),
      button(
        L('Browse versions', '浏览所有版本'),
        () => {
          detailTab = 'versions';
          renderDetail();
        },
        'primary',
      ),
      h('div', { class: 'prose' }, ...markdown(project.body || '')),
    );
    return;
  }
  body.append(
    h('div', { class: 'version-filters', id: 'version-filters' }),
    h('div', { id: 'versions-list' }),
    h('div', { id: 'install-review' }),
  );
  renderVersionFilters();
  void loadVersions(false);
}
function renderVersionFilters() {
  const input = h('input', {
    type: 'search',
    value: versionQuery,
    placeholder: L('Filter versions…', '筛选版本…'),
    'aria-label': L('Filter versions', '筛选版本'),
    oninput: (event: Event) => {
      versionQuery = (event.target as HTMLInputElement).value;
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        void loadVersions(false);
      }, 250);
    },
  });
  find('version-filters').replaceChildren(
    h(
      'div',
      { class: 'filter-row' },
      check(L('Compatible only', '仅兼容版本'), versionCompatible, (value) => {
        versionCompatible = value;
        return loadVersions(false);
      }),
      button(
        L('Show all versions', '查看全部版本'),
        () => {
          versionCompatible = false;
          versionGame = '';
          versionLoader = '';
          versionChannel = 'all';
          versionQuery = '';
          renderVersionFilters();
          return loadVersions(false);
        },
        'text-button',
      ),
    ),
    input,
    h(
      'div',
      { class: 'version-selects' },
      dropdown(
        L('Game version', '游戏版本'),
        versionGame,
        [
          ['', L('All game versions', '全部游戏版本')],
          ...versionGames.map((v) => [v, v] as [string, string]),
        ],
        (value) => {
          versionGame = value;
          return loadVersions(false);
        },
        'version-game',
      ),
      dropdown(
        L('Loader', '加载器'),
        versionLoader,
        [
          ['', L('All loaders', '全部加载器')],
          ...versionLoaders.map((v) => [v, v] as [string, string]),
        ],
        (value) => {
          versionLoader = value;
          return loadVersions(false);
        },
        'version-loader',
      ),
      dropdown(
        L('Release channel', '发布类型'),
        versionChannel,
        [
          ['release', L('Releases', '正式版')],
          ['beta', L('Release + beta', '正式版和测试版')],
          ['all', L('All channels', '全部类型')],
        ],
        (value) => {
          versionChannel = value;
          return loadVersions(false);
        },
      ),
    ),
    h('p', { class: 'muted', id: 'version-count' }),
  );
}
async function loadVersions(append: boolean) {
  if (!detail) return;
  const projectId = detail.project.id;
  const sequence = ++versionGeneration;
  if (!append) {
    versions = [];
    selectedVersion = undefined;
    plan = undefined;
    planGeneration++;
    find('install-review').replaceChildren();
    find('versions-list').replaceChildren(
      h('p', { class: 'loading' }, L('Loading versions…', '加载版本…')),
    );
  }
  try {
    const result = await call<VersionsPage>('versions', {
      projectId,
      compatible: versionCompatible,
      channel: versionChannel,
      query: versionQuery,
      game: versionGame,
      loader: versionLoader,
      offset: append ? versions.length : 0,
    });
    if (
      sequence !== versionGeneration ||
      detail?.project.id !== projectId ||
      detailTab !== 'versions'
    )
      return;
    const first = versionGames.length === 0 || !versionGames.some((v) => result.games.includes(v));
    versionGames = result.games;
    versionLoaders = result.loaders;
    if (first) renderVersionFilters();
    versions = append ? [...versions, ...result.versions] : result.versions;
    versionsTotal = result.total;
    find('version-count').textContent = L(`${versionsTotal} versions`, `${versionsTotal} 个版本`);
    renderVersions();
  } catch (error) {
    if (sequence === versionGeneration) showError(error);
  }
}
function renderVersions() {
  const list = find('versions-list');
  list.replaceChildren();
  if (!versions.length)
    list.append(
      empty(
        L('No versions match these filters', '没有符合筛选条件的版本'),
        L(
          'Use “Show all versions” to see every release.',
          '点击“查看全部版本”可显示所有发布记录。',
        ),
      ),
    );
  for (const version of versions)
    list.append(
      button(
        '',
        () => chooseVersion(version.id),
        `version-row ${version.id === selectedVersion ? 'selected' : ''}`,
      ),
    );
  [...list.querySelectorAll<HTMLButtonElement>('.version-row')].forEach((row, index) => {
    const v = versions[index];
    row.setAttribute('aria-label', `${v.name} ${v.version_number}`);
    row.setAttribute('aria-pressed', String(v.id === selectedVersion));
    row.append(
      h(
        'div',
        { class: 'title-line' },
        h('strong', {}, v.name),
        badge(
          v.version_type === 'alpha'
            ? L('Alpha', 'Alpha 测试版')
            : v.version_type === 'beta'
              ? L('Beta', 'Beta 测试版')
              : L('Release', '正式版'),
          v.version_type || 'release',
        ),
      ),
      h(
        'div',
        { class: 'version-meta' },
        h('span', {}, v.loaders.join(', ')),
        h(
          'span',
          { title: v.game_versions.join(', ') },
          v.game_versions.slice(0, 4).join(', ') + (v.game_versions.length > 4 ? '…' : ''),
        ),
        h('span', {}, date(v.date_published)),
      ),
    );
  });
  if (versions.length < versionsTotal)
    list.append(
      button(
        L('Load more versions', '加载更多版本'),
        () => loadVersions(true),
        'secondary load-more',
      ),
    );
}
async function chooseVersion(id: string) {
  selectedVersion = id;
  renderVersions();
  const sequence = ++planGeneration;
  find('install-review').replaceChildren(
    h(
      'div',
      { class: 'loading' },
      h('span', { class: 'spinner' }),
      L('Resolving dependencies…', '查找前置依赖…'),
    ),
  );
  try {
    const result = await call<PlanResult>('plan', { versionId: id, optional });
    if (sequence !== planGeneration || id !== selectedVersion) return;
    plan = result;
    renderPlan();
    find('install-review').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (error) {
    if (sequence === planGeneration) {
      find('install-review').replaceChildren(
        h('div', { class: 'inline-error', role: 'alert' }, (error as Error).message),
      );
    }
  }
}
function renderPlan() {
  if (!plan) return;
  const selected = plan;
  const files = selected.version.files;
  const primary = files.find((f) => f.primary) || files[0];
  const filePicker = dropdown(
    L('Download file', '下载文件'),
    primary?.filename || '',
    files.map((f) => [f.filename, f.filename]),
    () => {},
    'download-file',
  );
  const names: Record<string, string> = {
    install: L('Install', '安装'),
    update: L('Update', '更新'),
    enable: L('Enable', '启用'),
    installed: L('Installed', '已安装'),
  };
  const dependencies = selected.plan.entries.filter((e) => e.required);
  const changes = dependencies.filter((e) => e.action !== 'installed').length;
  find('install-review').replaceChildren(
    h(
      'section',
      { class: 'install-box' },
      h('h2', {}, selected.version.name),
      filePicker,
      h(
        'div',
        { class: 'dependency-heading' },
        h('h3', {}, L('Dependencies', '前置依赖')),
        badge(String(dependencies.length)),
      ),
      ...dependencies.map((entry) =>
        h(
          'div',
          { class: 'dependency-row' },
          h('span', {}, entry.version.name),
          h('span', { class: entry.action === 'installed' ? 'muted' : '' }, names[entry.action]),
        ),
      ),
      !dependencies.length &&
        h('p', { class: 'muted' }, L('No required dependencies.', '没有必需前置。')),
      !!selected.optionalNames.length &&
        h(
          'div',
          { class: 'optional-section' },
          check(L('Include optional dependencies', '同时安装可选依赖'), optional, (value) => {
            optional = value;
            return chooseVersion(selected.version.id);
          }),
          h('p', { class: 'muted' }, selected.optionalNames.map((p) => p.name).join(', ')),
        ),
      ...selected.plan.conflicts.map((message) =>
        h('div', { class: 'inline-error', role: 'alert' }, message),
      ),
      button(
        kind === 'modpack'
          ? L('Create instance from pack', '从整合包创建实例')
          : changes
            ? L(`Install + ${changes} dependencies`, `安装及 ${changes} 个前置`)
            : L('Install version', '安装此版本'),
        async () => {
          const button = document.querySelector<HTMLButtonElement>('#install-review .primary')!;
          button.disabled = true;
          try {
            await call('install', {
              versionId: selected.version.id,
              optional,
              filename: (find('download-file') as HTMLSelectElement).value,
            });
            notice(L('Installation completed.', '安装完成。'));
            boot = await call<Bootstrap>('ready');
          } finally {
            button.disabled = selected.plan.conflicts.length > 0;
          }
        },
        'primary',
        selected.plan.conflicts.length > 0 || !primary,
      ),
      selected.version.changelog &&
        h(
          'details',
          { class: 'changelog' },
          h('summary', {}, L('Changelog', '更新日志')),
          h('div', { class: 'prose' }, ...markdown(selected.version.changelog)),
        ),
    ),
  );
}
function markdown(text: string): Node[] {
  const result: Node[] = [];
  let code = false;
  let buffer: string[] = [];
  for (const raw of text.slice(0, 60000).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (code) {
        result.push(h('pre', {}, h('code', {}, buffer.join('\n'))));
        buffer = [];
      }
      code = !code;
      continue;
    }
    if (code) {
      buffer.push(raw);
      continue;
    }
    if (!line || /^!\[/.test(line) || /^<\/?[a-z]/i.test(line)) continue;
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      result.push(h('h3', {}, heading[2]));
      continue;
    }
    const paragraph = h('p', {}, /^[-*]\s/.test(line) ? '• ' : '');
    const normalized = line.replace(/^[-*]\s/, '');
    let start = 0;
    for (const match of normalized.matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)) {
      paragraph.append(
        document.createTextNode(normalized.slice(start, match.index)),
        button(match[1], () => call('external', { url: match[2] }), 'inline-link'),
      );
      start = match.index! + match[0].length;
    }
    paragraph.append(document.createTextNode(normalized.slice(start)));
    result.push(paragraph);
  }
  return result;
}
function field(label: string, node: HTMLElement, hint?: string) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    node,
    hint && h('span', { class: 'field-hint' }, hint),
  );
}
function formInput(name: string, value: string | number, type = 'text', placeholder = '') {
  return h('input', {
    name,
    id: `setting-${name}`,
    value,
    type,
    placeholder,
    ...(type === 'number'
      ? {
          min: name === 'minMemory' || name === 'maxMemory' ? 128 : 320,
          max: name === 'minMemory' || name === 'maxMemory' ? 1048576 : 16384,
        }
      : {}),
  });
}
function formSelect(name: string, value: string, options: [string, string][]) {
  const result = dropdown(name, value, options, () => {});
  result.name = name;
  result.id = `setting-${name}`;
  return result;
}
function renderInstance() {
  const instance = currentInstance();
  const main = find('main');
  main.className = 'instance-scroll';
  if (!instance) {
    main.append(
      empty(
        L('No instance selected', '未选择实例'),
        L(
          'Create or select an instance to configure its launch settings.',
          '创建或选择实例以配置启动设置。',
        ),
        () => action('createInstance'),
        L('New instance', '新建实例'),
      ),
    );
    return;
  }
  const running = boot.running.includes(instance.id);
  const globalMemory = h('input', {
    type: 'checkbox',
    name: 'globalMemory',
    checked: instance.minMemory === undefined && instance.maxMemory === undefined,
  });
  const effectiveMaximum = instance.maxMemory ?? boot.defaults.maxMemory;
  const effectiveMinimum =
    instance.minMemory ??
    (boot.defaults.memory.automaticMinimum
      ? Math.min(boot.defaults.minMemory, effectiveMaximum)
      : boot.defaults.minMemory);
  const minimum = formInput('minMemory', effectiveMinimum, 'number');
  const maximum = formInput('maxMemory', effectiveMaximum, 'number');
  minimum.required = true;
  maximum.required = true;
  const memoryHint = h('p', { class: 'field-hint', id: 'memory-recommendation' });
  syncMemoryControls = () => {
    if (globalMemory.checked) {
      minimum.value = String(boot.defaults.minMemory);
      maximum.value = String(boot.defaults.maxMemory);
    }
    minimum.disabled = globalMemory.checked;
    maximum.disabled = globalMemory.checked;
    const memory = boot.defaults.memory;
    const total = new Intl.NumberFormat(boot.locale, { maximumFractionDigits: 1 }).format(
      memory.totalMemory / 1024,
    );
    memoryHint.textContent = L(
      `System memory: ${total} GiB. Automatic recommendation: ${memory.minMemory}–${memory.maxMemory} MB (${memory.percentage}% maximum, capped at 8 GiB).`,
      `系统内存：${total} GiB。自动推荐：${memory.minMemory}–${memory.maxMemory} MB（最大约 ${memory.percentage}%，上限 8 GiB）。`,
    );
  };
  globalMemory.onchange = syncMemoryControls;
  syncMemoryControls();
  const form = h('form', {
    class: 'instance-form',
    onsubmit: (event: Event) => {
      event.preventDefault();
      void saveForm(form, instance).catch(showError);
    },
  });
  main.append(
    h(
      'div',
      { class: 'instance-heading' },
      h(
        'div',
        {},
        h('h1', {}, instance.name),
        h(
          'p',
          { class: 'muted' },
          `${instance.minecraft} · ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`,
        ),
      ),
      h(
        'div',
        { class: 'inline-actions' },
        button(
          running ? L('Stop', '停止') : L('Launch', '启动'),
          () => action(running ? 'stop' : 'launch'),
          'primary',
        ),
        button(L('Install / repair', '安装 / 修复'), () => action('install'), 'secondary', running),
      ),
    ),
    h(
      'div',
      { class: 'session-info' },
      h('span', {}, `${L('Last played', '上次启动')}: ${date(instance.lastPlayed)}`),
      h(
        'span',
        {},
        `${L('Playtime', '游戏时长')}: ${Math.floor((instance.playtimeSeconds || 0) / 3600)}h ${Math.floor(((instance.playtimeSeconds || 0) % 3600) / 60)}m`,
      ),
    ),
    form,
  );
  form.append(
    h(
      'fieldset',
      { disabled: running },
      h('legend', {}, L('General', '基本设置')),
      h(
        'div',
        { class: 'form-grid' },
        field(L('Instance name', '实例名称'), formInput('name', instance.name)),
        field(
          L('Minecraft language', 'Minecraft 语言'),
          formSelect('gameLanguage', instance.gameLanguage || '', [
            ['', L('Use global setting', '使用全局设置')],
            ['auto', L('Follow extension language', '跟随扩展语言')],
            ['preserve', L('Keep game language', '保留游戏内语言')],
            ['en_us', 'English (US)'],
            ['zh_cn', '简体中文'],
            ['zh_tw', '繁體中文'],
            ...(instance.gameLanguage &&
            !['auto', 'preserve', 'en_us', 'zh_cn', 'zh_tw'].includes(instance.gameLanguage)
              ? [[instance.gameLanguage, instance.gameLanguage] as [string, string]]
              : []),
          ]),
        ),
        field(
          L('Account', '账户'),
          formSelect('accountId', instance.accountId || '', [
            ['', L('Use active account', '使用当前账户')],
            ...boot.accounts.map((a) => [a.id, a.name] as [string, string]),
          ]),
        ),
      ),
      button(
        L('Change Minecraft / loader version…', '更改 Minecraft / 加载器版本…'),
        () => action('configure'),
        'text-button',
      ),
    ),
    h(
      'fieldset',
      { disabled: running },
      h('legend', {}, L('Java & memory', 'Java 与内存')),
      field(
        L('Java executable', 'Java 可执行文件'),
        formInput('java', instance.java || '', 'text', L('Automatic', '自动选择')),
        L(
          'Instance Java takes priority. Leave empty for the global default or automatic selection.',
          '实例 Java 优先；留空使用全局默认或自动选择。',
        ),
      ),
      h(
        'div',
        { class: 'inline-actions' },
        button(L('Detect Java', '检测 Java'), () => action('detectJava'), 'text-button'),
        button(L('Download JDK', '下载 JDK'), () => action('downloadJava'), 'text-button'),
      ),
      h(
        'label',
        { class: 'check' },
        globalMemory,
        L('Use global memory settings', '使用全局内存设置'),
      ),
      memoryHint,
      h(
        'div',
        { class: 'form-grid' },
        field(L('Minimum memory (MB)', '最小内存（MB）'), minimum),
        field(L('Maximum memory (MB)', '最大内存（MB）'), maximum),
        field(
          L('Garbage collector', '垃圾回收器'),
          formSelect('gc', instance.gc || '', [
            ['', L('Use global setting', '使用全局设置')],
            ['default', L('JVM default', 'JVM 默认')],
            ['g1', 'G1'],
            ['zgc', 'ZGC'],
          ]),
        ),
      ),
    ),
    h(
      'fieldset',
      { disabled: running },
      h('legend', {}, L('Game window & server', '游戏窗口与服务器')),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', name: 'customResolution', checked: !!instance.resolution }),
        L('Use custom window settings', '使用独立窗口设置'),
      ),
      h(
        'div',
        { class: 'form-grid' },
        field(
          L('Width', '宽度'),
          formInput('width', instance.resolution?.width || boot.defaults.width, 'number'),
        ),
        field(
          L('Height', '高度'),
          formInput('height', instance.resolution?.height || boot.defaults.height, 'number'),
        ),
      ),
      h(
        'label',
        { class: 'check' },
        h('input', {
          type: 'checkbox',
          name: 'fullscreen',
          checked: instance.resolution?.fullscreen ?? boot.defaults.fullscreen,
        }),
        L('Fullscreen', '全屏'),
      ),
      field(
        L('Join server on launch', '启动后加入服务器'),
        formInput('server', instance.server || '', 'text', 'server.example:25565'),
        L('Leave empty to open the main menu.', '留空进入主菜单。'),
      ),
    ),
    h(
      'fieldset',
      { disabled: running },
      h('legend', {}, L('Arguments & backups', '参数与备份')),
      field(
        L('JVM arguments', 'JVM 参数'),
        h('textarea', { name: 'jvmArgs', rows: 3 }, (instance.jvmArgs || []).join('\n')),
        L('One argument per line.', '每行一个参数。'),
      ),
      field(
        L('Game arguments', '游戏参数'),
        h('textarea', { name: 'gameArgs', rows: 3 }, (instance.gameArgs || []).join('\n')),
      ),
      field(
        L('Back up worlds before launch', '启动前备份存档'),
        formSelect(
          'backupBeforeLaunch',
          instance.backupBeforeLaunch === undefined ? '' : String(instance.backupBeforeLaunch),
          [
            ['', L('Use global setting', '使用全局设置')],
            ['true', L('Enabled', '启用')],
            ['false', L('Disabled', '禁用')],
          ],
        ),
      ),
    ),
    h(
      'div',
      { class: 'save-row' },
      h(
        'button',
        { class: 'primary', type: 'submit', disabled: running },
        L('Save instance settings', '保存实例设置'),
      ),
      h(
        'span',
        { class: 'muted' },
        running ? L('Stop the game to edit settings.', '停止游戏后可修改设置。') : '',
      ),
    ),
    h(
      'section',
      { class: 'maintenance' },
      h('h2', {}, L('Manage instance', '管理实例')),
      h(
        'div',
        { class: 'maintenance-grid' },
        ...(
          [
            ['directory', L('Open game directory', '打开游戏目录')],
            ['move', L('Move game directory…', '移动游戏目录…')],
            ['backups', L('World backups', '存档备份')],
            ['log', L('Latest log', '最新日志')],
            ['clone', L('Duplicate instance', '复制实例')],
            ['exportPack', L('Export .mrpack', '导出整合包')],
            ['exportNative', L('Export instance ZIP', '导出实例 ZIP')],
            ['conflicts', L('Check mod conflicts', '检查模组冲突')],
          ] as [string, string][]
        ).map(([key, label]) =>
          button(
            label,
            () => action(key),
            'secondary',
            running && !['directory', 'log'].includes(key),
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'danger-zone' },
      h(
        'h2',
        {},
        instance.linked ? L('Remove instance', '移除实例') : L('Delete instance', '删除实例'),
      ),
      h(
        'p',
        { class: 'muted' },
        instance.linked
          ? L(
              'Removes this registration and keeps the original game files.',
              '只移除此登记，保留原有游戏文件。',
            )
          : L(
              'Moves the instance folder to Trash when supported.',
              '系统支持时，将实例目录移到废纸篓。',
            ),
      ),
      button(
        instance.linked
          ? L('Remove from Workbench…', '从工作台移除…')
          : L('Delete instance…', '删除实例…'),
        () => action('delete'),
        'secondary danger',
        running,
      ),
    ),
  );
}
async function saveForm(form: HTMLFormElement, instance: Instance) {
  const values = new FormData(form);
  const value = (name: string) => String(values.get(name) || '');
  await call('saveInstance', {
    instanceId: instance.id,
    value: {
      name: value('name'),
      gameLanguage: value('gameLanguage'),
      accountId: value('accountId'),
      java: value('java'),
      minMemory: values.has('globalMemory') ? undefined : Number(value('minMemory')),
      maxMemory: values.has('globalMemory') ? undefined : Number(value('maxMemory')),
      gc: value('gc'),
      resolution: values.has('customResolution')
        ? {
            width: Number(value('width')),
            height: Number(value('height')),
            fullscreen: values.has('fullscreen'),
          }
        : undefined,
      server: value('server'),
      backupBeforeLaunch: value('backupBeforeLaunch')
        ? value('backupBeforeLaunch') === 'true'
        : undefined,
      jvmArgs: value('jvmArgs')
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
      gameArgs: value('gameArgs')
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
    },
  });
  boot = await call<Bootstrap>('ready');
  syncMemoryControls?.();
  notice(L('Instance settings saved.', '实例设置已保存。'));
}
window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data;
  if (message.id && pending.has(message.id)) {
    const item = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message.data);
    return;
  }
  if (message.event === 'navigate') {
    page = message.page;
    kind = message.kind;
    if (boot.mode === 'server' && ['discover', 'installed'].includes(page))
      kind =
        serverContent(boot.servers.find((s) => s.id === boot.selectedServer)?.engine || '') ||
        'plugin';
    detail = undefined;
    plan = undefined;
    persist();
    render();
  }
  if (message.event === 'state' && boot) {
    const next = message.data as Bootstrap;
    const runningChanged =
      ['instance', 'backups', 'version'].includes(page) &&
      JSON.stringify(next.running) !== JSON.stringify(boot.running);
    const changed =
      runningChanged ||
      next.consent.accepted !== boot.consent.accepted ||
      next.consent.version !== boot.consent.version ||
      next.locale !== boot.locale ||
      next.terracotta?.enabled !== boot.terracotta?.enabled ||
      next.mode !== boot.mode ||
      (['server', 'discover', 'installed'].includes(page) &&
        next.selectedServer !== boot.selectedServer) ||
      (['discover', 'installed', 'instance', 'backups', 'version'].includes(page) &&
        next.selectedInstance !== boot.selectedInstance) ||
      JSON.stringify(next.preferences) !== JSON.stringify(boot.preferences);
    if (next.mode !== boot.mode) {
      page =
        next.mode === 'server' ? 'servers' : next.mode === 'developer' ? 'projects' : 'instances';
      kind = next.mode === 'server' ? 'plugin' : 'mod';
      query = '';
    }
    if (next.selectedServer !== boot.selectedServer) {
      kind =
        serverContent(next.servers.find((s) => s.id === next.selectedServer)?.engine || '') ||
        'plugin';
      serverUpdates.clear();
    }
    boot = next;
    updateJobs();
    if (changed) {
      detail = undefined;
      plan = undefined;
      render();
    } else {
      updateManaged?.();
      syncMemoryControls?.();
    }
  }
});
void call<Bootstrap>('ready')
  .then((value) => {
    boot = value;
    page = value.page;
    kind = value.kind;
    const saved = bridge.getState() as
      | {
          page?: WorkbenchPage;
          kind?: ProjectKind;
          query?: string;
          order?: string;
          onlyCompatible?: boolean;
          agreementLanguage?: 'auto' | 'en' | 'zh-cn';
        }
      | undefined;
    if (saved) {
      if (['auto', 'en', 'zh-cn'].includes(String(saved.agreementLanguage)))
        agreementLanguage = saved.agreementLanguage!;
      query = saved.query || '';
      order = saved.order || value.preferences.order;
      onlyCompatible = saved.onlyCompatible ?? value.preferences.compatibleOnly;
    } else {
      order = value.preferences.order;
      onlyCompatible = value.preferences.compatibleOnly;
    }
    render();
  })
  .catch((error) => {
    root.replaceChildren(h('p', { role: 'alert' }, (error as Error).message));
  });
