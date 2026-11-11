import { h } from './dom';
import { PageContext, field, input, select, heading, blank, busy } from './page-ui';
import type { Instance, VersionManifest } from '../models';
import { gameVersionCategory } from '../game-versions';
import { instanceGroups } from '../instance-groups';

export function renderSetup(main: HTMLElement, edit: boolean, ctx: PageContext) {
  const L = ctx.text,
    state = ctx.state();
  const existing = edit ? state.instances.find((i) => i.id === state.selectedInstance) : undefined;
  let progress: HTMLElement | undefined;
  let activeForm: HTMLFormElement | undefined;
  if (edit && !existing) {
    main.append(blank(L('Select an instance first', '请先选择实例')));
    return;
  }
  const loading = h(
    'div',
    { class: 'loading' },
    L('Loading Minecraft versions…', '加载 Minecraft 版本…'),
  );
  main.append(
    heading(
      edit ? L('Install / change version', '安装 / 更改版本') : L('New instance', '新建实例'),
      existing?.name,
    ),
    loading,
  );
  void ctx
    .request<VersionManifest>('launcher.gameVersions')
    .then((manifest) => {
      if (!ctx.current()) return;
      loading.remove();
      mountForm(manifest);
    })
    .catch((error) => {
      if (ctx.current()) {
        loading.replaceChildren(
          ctx.button(
            L('Retry loading versions', '重试加载版本'),
            () => ctx.navigate(edit ? 'version' : 'create'),
            'secondary',
          ),
        );
        ctx.error(error);
      }
    });
  return () => {
    if (!progress || !activeForm?.dataset.busy) return;
    const job = ctx.state().jobs.find((j) => j.status === 'running');
    if (job) progress.textContent = `${job.label}${job.detail ? ` · ${job.detail}` : ''}`;
  };

  function mountForm(manifest: VersionManifest) {
    const name = input('name', existing?.name || manifest.latest.release);
    const group = input('group', existing?.group || '');
    group.maxLength = 100;
    group.setAttribute('list', 'setup-groups');
    name.required = true;
    name.maxLength = 100;
    let automaticName = !existing;
    name.oninput = () => {
      automaticName = false;
    };
    const parent = input('parentDirectory', existing?.directory || state.defaults.gameDirectory);
    parent.required = true;
    parent.readOnly = edit;
    const directoryRow = h(
      'div',
      { class: 'input-action' },
      parent,
      !edit &&
        ctx.button(
          L('Browse…', '浏览…'),
          async () => {
            const value = await ctx.request<string | undefined>('launcher.pickDirectory');
            if (value) parent.value = value;
          },
          'secondary',
        ),
    );
    const versionType = select('versionType', 'all', [
      ['all', L('All versions', '所有版本')],
      ['release', L('Releases', '正式版')],
      ['snapshot', L('Snapshots / previews', '快照 / 预发布版')],
      ['april_fools', L('April Fools', '愚人节版本')],
      ['old_beta', L('Old Beta', '旧 Beta')],
      ['old_alpha', L('Old Alpha', '旧 Alpha')],
    ]);
    versionType.setAttribute('aria-label', L('Version type', '版本类型'));
    const search = input('versionSearch');
    search.type = 'search';
    search.placeholder = L('Filter Minecraft versions…', '筛选 Minecraft 版本…');
    search.setAttribute('aria-label', L('Filter Minecraft versions', '筛选 Minecraft 版本'));
    const game = select('minecraft', existing?.minecraft || manifest.latest.release, []);
    game.size = 9;
    game.required = true;
    const count = h('span', { class: 'muted' }),
      versionInfo = h('span', { class: 'muted' });
    const loader = select('loader', existing?.loader || 'vanilla', [
      ['vanilla', 'Vanilla'],
      ['fabric', 'Fabric'],
      ['quilt', 'Quilt'],
      ['forge', 'Forge'],
      ['neoforge', 'NeoForge'],
    ]);
    const loaderVersion = select('loaderVersion', '', []);
    const loaderInfo = h('p', { class: 'field-hint', 'aria-live': 'polite' });
    const java = select('java', existing?.java || '', [
      ['', L('Automatic / global preference', '自动选择 / 全局设置')],
      ...state.java.map(
        (j) => [j.path, `Java ${j.version} · ${j.architecture}`] as [string, string],
      ),
      ...(existing?.java && !state.java.some((j) => j.path === existing.java)
        ? [[existing.java, existing.java] as [string, string]]
        : []),
    ]);
    const account = select('accountId', existing?.accountId || '', [
      ['', L('Use active account', '使用当前账户')],
      ...state.accounts.map((a) => [a.id, a.name] as [string, string]),
    ]);
    const download = h('input', { type: 'checkbox', name: 'install', checked: true });
    const submit = h(
      'button',
      { type: 'submit', class: 'primary' },
      edit ? L('Apply and install', '应用并安装') : L('Create and install', '创建并安装'),
    );
    const status = h('div', { class: 'setup-status', 'aria-live': 'polite' });
    const form = h('form', { class: 'management-form setup-form' });
    progress = status;
    activeForm = form;
    let loaderSequence = 0;
    const updateName = () => {
      if (automaticName)
        name.value = `${game.value}${loader.value === 'vanilla' ? '' : ` ${loader.value}`}`;
    };
    const loadLoaders = async () => {
      const sequence = ++loaderSequence;
      updateName();
      loaderVersion.replaceChildren();
      loaderVersion.disabled = true;
      if (loader.value === 'vanilla') {
        loaderVersion.append(h('option', { value: '' }, L('Not required', '无需加载器')));
        loaderInfo.textContent = '';
        submit.disabled = !game.value;
        return;
      }
      loaderInfo.textContent = L('Loading loader versions…', '加载 Loader 版本…');
      submit.disabled = true;
      try {
        const versions = await ctx.request<string[]>('launcher.loaderVersions', {
          minecraft: game.value,
          loader: loader.value,
        });
        if (sequence !== loaderSequence || !ctx.current()) return;
        const preferred =
          existing?.minecraft === game.value && existing.loader === loader.value
            ? existing.loaderVersion
            : undefined;
        for (const value of versions)
          loaderVersion.append(h('option', { value, selected: value === preferred }, value));
        loaderVersion.disabled = !versions.length;
        submit.disabled = !versions.length;
        loaderInfo.textContent = versions.length
          ? L(
              `${versions.length} compatible loader versions`,
              `${versions.length} 个兼容的 Loader 版本`,
            )
          : L(
              'No compatible loader for this Minecraft version. Select another version or Vanilla.',
              '该 Minecraft 版本没有兼容的 Loader，请更换版本或选择 Vanilla。',
            );
      } catch (error) {
        if (sequence === loaderSequence) {
          loaderInfo.textContent = (error as Error).message;
          submit.disabled = true;
        }
      }
    };
    const typeName = (type: string) =>
      type === 'april_fools'
        ? L('April Fools', '愚人节版本')
        : type === 'release'
          ? L('Release', '正式版')
          : type === 'snapshot'
            ? L('Snapshot / preview', '快照 / 预发布版')
            : type === 'old_beta'
              ? 'Beta'
              : type === 'old_alpha'
                ? 'Alpha'
                : type;
    const updateVersionInfo = () => {
      const item = manifest.versions.find((v) => v.id === game.value);
      versionInfo.textContent = item
        ? `${typeName(gameVersionCategory(item))} · ${new Date(item.releaseTime).toLocaleDateString(state.locale)}`
        : '';
    };
    const filter = () => {
      const previous = game.value || existing?.minecraft || manifest.latest.release;
      const values = manifest.versions.filter(
        (v) =>
          (versionType.value === 'all' || gameVersionCategory(v) === versionType.value) &&
          v.id.toLowerCase().includes(search.value.trim().toLowerCase()),
      );
      const selected = values.some((v) => v.id === previous) ? previous : values[0]?.id;
      game.replaceChildren(
        ...values.map((v) =>
          h(
            'option',
            { value: v.id, selected: v.id === selected },
            `${v.id} · ${typeName(gameVersionCategory(v))}`,
          ),
        ),
      );
      count.textContent = L(`${values.length} versions`, `${values.length} 个版本`);
      updateVersionInfo();
      if (game.value) void loadLoaders();
      else {
        submit.disabled = true;
        loaderVersion.replaceChildren();
        loaderInfo.textContent = L('No matching versions.', '没有符合条件的版本。');
      }
    };
    game.onchange = () => {
      updateVersionInfo();
      void loadLoaders();
    };
    loader.onchange = () => void loadLoaders();
    versionType.onchange = filter;
    search.oninput = filter;
    download.onchange = () => {
      submit.textContent = download.checked
        ? edit
          ? L('Apply and install', '应用并安装')
          : L('Create and install', '创建并安装')
        : edit
          ? L('Apply changes', '应用更改')
          : L('Create instance', '创建实例');
    };
    const quickVersion = (snapshot: boolean) => {
      versionType.value = 'all';
      search.value = '';
      filter();
      game.value = snapshot ? manifest.latest.snapshot : manifest.latest.release;
      updateVersionInfo();
      void loadLoaders();
    };
    form.append(
      h(
        'fieldset',
        {},
        h('legend', {}, L('Instance', '实例')),
        h(
          'div',
          { class: 'form-grid' },
          field(L('Instance name', '实例名称'), name),
          field(L('Account', '账户'), account),
          field(L('Group (optional)', '分组（可选）'), group),
        ),
        h(
          'datalist',
          { id: 'setup-groups' },
          ...instanceGroups(state.instances).map((name) => h('option', { value: name })),
        ),
        field(
          edit ? L('Game directory', '游戏目录') : L('Minecraft directory', 'Minecraft 目录'),
          directoryRow,
        ),
      ),
      h(
        'fieldset',
        {},
        h('legend', {}, L('Minecraft & loader', 'Minecraft 与 Loader')),
        h('div', { class: 'version-search-row' }, search, versionType),
        h(
          'div',
          { class: 'filter-row version-shortcuts' },
          h(
            'div',
            { class: 'inline-actions' },
            ctx.button(L('Latest release', '最新正式版'), () => quickVersion(false), 'text-button'),
            ctx.button(L('Latest snapshot', '最新快照'), () => quickVersion(true), 'text-button'),
          ),
          count,
        ),
        field(L('Minecraft version', 'Minecraft 版本'), game),
        versionInfo,
        h(
          'div',
          { class: 'form-grid loader-fields' },
          field(L('Mod loader', '模组加载器'), loader),
          field(L('Loader version', 'Loader 版本'), loaderVersion),
        ),
        loaderInfo,
      ),
      h(
        'fieldset',
        {},
        h('legend', {}, 'Java'),
        field(
          L('Java runtime', 'Java 运行环境'),
          java,
          L(
            'The game metadata determines the required Java version.',
            '所需 Java 版本以游戏元数据为准。',
          ),
        ),
        h(
          'div',
          { class: 'inline-actions' },
          ctx.button(
            L('Detect Java', '检测 Java'),
            async () => {
              await ctx.request('launcher.javaAction', { action: 'detect' });
              await ctx.refresh();
              const value = java.value;
              java.replaceChildren(
                h(
                  'option',
                  { value: '' },
                  L('Automatic / global preference', '自动选择 / 全局设置'),
                ),
                ...ctx
                  .state()
                  .java.map((j) =>
                    h(
                      'option',
                      { value: j.path, selected: j.path === value },
                      `Java ${j.version} · ${j.architecture}`,
                    ),
                  ),
                ...(value && !ctx.state().java.some((j) => j.path === value)
                  ? [h('option', { value, selected: true }, value)]
                  : []),
              );
            },
            'text-button',
          ),
          ctx.button(L('Manage Java…', '管理 Java…'), () => ctx.navigate('java'), 'text-button'),
        ),
      ),
      h(
        'fieldset',
        {},
        h(
          'label',
          { class: 'check' },
          download,
          L('Download game files after saving', '保存后下载游戏文件'),
        ),
        h(
          'div',
          { class: 'save-row' },
          submit,
          ctx.button(
            L('Cancel', '取消'),
            () => ctx.navigate(edit ? 'instance' : 'instances'),
            'secondary',
          ),
        ),
      ),
      status,
    );
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!game.value || !form.reportValidity()) return;
      status.textContent = L('Saving instance…', '保存实例…');
      void busy(form, async () => {
        const result = await ctx.request<{ instance: Instance; installError?: string }>(
          'launcher.saveSetup',
          {
            edit,
            install: download.checked,
            value: {
              name: name.value,
              group: group.value,
              minecraft: game.value,
              loader: loader.value,
              loaderVersion: loaderVersion.value,
              parentDirectory: parent.value,
              java: java.value,
              accountId: account.value,
            },
          },
        );
        await ctx.refresh();
        if (!ctx.current()) return;
        await ctx.navigate('instance');
        if (result.installError) ctx.error(new Error(result.installError));
        else
          ctx.notify(
            download.checked
              ? L('Instance installed.', '实例安装完成。')
              : L('Instance saved.', '实例已保存。'),
          );
      }).catch((error) => {
        status.textContent = '';
        ctx.error(error);
      });
    };
    main.append(form);
    filter();
  }
}
