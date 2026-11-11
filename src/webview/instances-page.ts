import { h } from './dom';
import { input, select, heading, blank, type PageContext } from './page-ui';
import { instanceGroups } from '../instance-groups';
import type { Instance } from '../models';

export function renderInstances(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  const rows = h('div', { class: 'management-list' });
  const selected = new Set<string>();
  const collapsed = new Set<string>();
  let selecting = false,
    working = false,
    groupsKey = '';
  const search = input('instanceSearch');
  search.type = 'search';
  search.placeholder = L('Filter instances…', '筛选实例…');
  search.setAttribute('aria-label', L('Filter instances', '筛选实例'));
  const group = select('instanceGroup', '@all', []);
  group.setAttribute('aria-label', L('Instance group', '实例分组'));
  const sort = select('instanceSort', 'name', [
    ['name', L('Name', '名称')],
    ['played', L('Last played', '上次启动')],
    ['version', L('Minecraft version', '游戏版本')],
  ]);
  sort.setAttribute('aria-label', L('Sort instances', '实例排序'));
  const actions = h('div', { class: 'inline-actions instance-selection' });
  const groupActions = h('div', { class: 'inline-actions' });
  const count = h('span', { class: 'muted', role: 'status' });
  const toggle = ctx.button(
    L('Select multiple', '批量管理'),
    () => {
      selecting = !selecting;
      selected.clear();
      update();
    },
    'secondary',
  );
  main.append(
    heading(L('Instances', '实例')),
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(L('New instance', '新建实例'), () => ctx.navigate('create'), 'primary'),
      ctx.button(L('Import instance', '导入实例'), () => ctx.navigate('import'), 'secondary'),
      ctx.button(
        L('Import modpack', '导入整合包'),
        () => ctx.request('action', { action: 'importPack' }),
        'secondary',
      ),
      toggle,
    ),
    h('div', { class: 'instance-filters inline-actions' }, search, group, sort, count),
    groupActions,
    actions,
    rows,
  );
  const filtered = () =>
    ctx
      .state()
      .instances.filter((instance) => {
        const query = search.value.trim().toLowerCase();
        return (
          (group.value === '@all' ||
            (instance.group || '') === (group.value === '@none' ? '' : group.value.slice(6))) &&
          `${instance.name} ${instance.minecraft} ${instance.loader} ${instance.group || ''}`
            .toLowerCase()
            .includes(query)
        );
      })
      .sort((a, b) =>
        sort.value === 'played'
          ? (b.lastPlayed || '').localeCompare(a.lastPlayed || '') ||
            a.name.localeCompare(b.name, undefined, { numeric: true })
          : sort.value === 'version'
            ? b.minecraft.localeCompare(a.minecraft, undefined, { numeric: true }) ||
              a.name.localeCompare(b.name, undefined, { numeric: true })
            : a.name.localeCompare(b.name, undefined, { numeric: true }),
      );

  async function operate(action: string, ids = [...selected], extra: Record<string, unknown> = {}) {
    if (working || !ids.length) return;
    working = true;
    update();
    try {
      const result = await ctx.request<{
        changed: number;
        cancelled?: boolean;
        failed: { id: string; name: string; message: string }[];
      }>('launcher.manageInstances', { ids, action, ...extra });
      if (!ctx.current()) return;
      await ctx.refresh();
      if (!result.cancelled) {
        selected.clear();
        result.failed.forEach((error) => selected.add(error.id));
        ctx.notify(
          L(`${result.changed} instance(s) processed.`, `已处理 ${result.changed} 个实例。`),
        );
        if (result.failed.length)
          ctx.error(
            new Error(result.failed.map((error) => `${error.name}: ${error.message}`).join('\n')),
          );
      }
    } finally {
      working = false;
      if (ctx.current()) update();
    }
  }
  function updateSelection() {
    const visible = filtered();
    for (const node of rows.querySelectorAll<HTMLInputElement>('input[data-instance]'))
      node.checked = selected.has(node.dataset.instance!);
    toggle.textContent = selecting ? L('Done', '完成多选') : L('Select multiple', '批量管理');
    toggle.disabled = working;
    search.disabled = group.disabled = sort.disabled = working;
    count.textContent = L(`${visible.length} instances`, `${visible.length} 个实例`);
    actions.hidden = !selecting;
    actions.replaceChildren(
      ctx.button(
        L('Select filtered', '选择筛选结果'),
        () => {
          visible.forEach((instance) => selected.add(instance.id));
          updateSelection();
        },
        'secondary',
        working || !visible.length,
      ),
      ctx.button(
        L('Clear selection', '取消选择'),
        () => {
          selected.clear();
          updateSelection();
        },
        'secondary',
        working || !selected.size,
      ),
      h('span', { class: 'muted' }, L(`${selected.size} selected`, `已选择 ${selected.size} 个`)),
      ctx.button(
        L('Move to group…', '移至分组…'),
        () => operate('group'),
        'secondary',
        working || !selected.size,
      ),
      ctx.button(L('Stop', '停止'), () => operate('stop'), 'secondary', working || !selected.size),
      ctx.button(
        L('Repair', '修复'),
        () => operate('repair'),
        'secondary',
        working || !selected.size,
      ),
      ctx.button(
        L('Remove…', '删除…'),
        () => operate('remove'),
        'text-button danger',
        working || !selected.size,
      ),
    );
    groupActions.replaceChildren();
    if (group.value.startsWith('group:')) {
      const name = group.value.slice(6);
      const ids = ctx
        .state()
        .instances.filter((instance) => instance.group === name)
        .map((instance) => instance.id);
      groupActions.append(
        ctx.button(
          L('Rename group…', '重命名分组…'),
          async () => {
            await ctx.request('launcher.renameGroup', { group: name });
            await ctx.refresh();
            update();
          },
          'text-button',
          working,
        ),
        ctx.button(
          L('Ungroup all', '取消此分组'),
          () => operate('group', ids, { group: '' }),
          'text-button',
          working,
        ),
      );
    }
  }
  function row(instance: Instance) {
    const state = ctx.state(),
      status = state.instanceStatus[instance.id] || 'stopped';
    return h(
      'article',
      { class: 'management-row instance-row' },
      h('input', {
        type: 'checkbox',
        hidden: !selecting,
        checked: selected.has(instance.id),
        disabled: working,
        'data-instance': instance.id,
        'aria-label': L(`Select ${instance.name}`, `选择 ${instance.name}`),
        onchange: (event: Event) => {
          if ((event.target as HTMLInputElement).checked) selected.add(instance.id);
          else selected.delete(instance.id);
          updateSelection();
        },
      }),
      h(
        'div',
        { class: 'row-body' },
        h('strong', {}, instance.name),
        h(
          'p',
          { class: 'muted' },
          `${instance.minecraft} · ${instance.loader}${instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}`,
        ),
        h('div', { class: 'path-value muted' }, instance.directory),
      ),
      h(
        'div',
        { class: 'inline-actions' },
        h(
          'span',
          { class: 'muted' },
          status === 'installing'
            ? L('Installing', '安装中')
            : status === 'starting'
              ? L('Starting', '启动中')
              : status === 'running'
                ? L('Running', '运行中')
                : instance.installed
                  ? L('Ready', '已安装')
                  : L('Not installed', '未安装'),
        ),
        ctx.button(
          L('Open', '打开目录'),
          () => ctx.request('action', { action: 'directory', instanceId: instance.id }),
          'secondary',
          working,
        ),
        ctx.button(
          L('Configure', '配置'),
          async () => {
            await ctx.request('selectInstance', { instanceId: instance.id });
            await ctx.navigate('instance');
          },
          'secondary',
          working,
        ),
        ctx.button(
          status !== 'stopped'
            ? L('Stop', '停止')
            : instance.installed
              ? L('Launch', '启动')
              : L('Install', '安装'),
          async () => {
            await ctx.request('selectInstance', { instanceId: instance.id });
            if (status !== 'stopped')
              await ctx.request('action', { action: 'stop', instanceId: instance.id });
            else if (instance.installed)
              await ctx.request('action', { action: 'launch', instanceId: instance.id });
            else await ctx.navigate('version');
          },
          'secondary',
          working,
        ),
      ),
    );
  }
  function update() {
    const state = ctx.state();
    for (const id of selected)
      if (!state.instances.some((instance) => instance.id === id)) selected.delete(id);
    const names = instanceGroups(state.instances),
      key = JSON.stringify(names);
    if (key !== groupsKey) {
      groupsKey = key;
      const previous = group.value || '@all';
      group.replaceChildren(
        h('option', { value: '@all' }, L('All groups', '所有分组')),
        h('option', { value: '@none' }, L('Ungrouped', '未分组')),
        ...names.map((name) => h('option', { value: `group:${name}` }, name)),
      );
      group.value = [...group.options].some((option) => option.value === previous)
        ? previous
        : '@all';
    }
    const visible = filtered();
    rows.replaceChildren();
    if (group.value === '@all' && names.length) {
      for (const name of [...names, '']) {
        const values = visible.filter((instance) => (instance.group || '') === name);
        if (!values.length) continue;
        const section = h(
          'details',
          { class: 'instance-group', open: !collapsed.has(name) },
          h('summary', {}, `${name || L('Ungrouped', '未分组')} (${values.length})`),
          ...values.map(row),
        );
        section.ontoggle = () => {
          if (section.open) collapsed.delete(name);
          else collapsed.add(name);
        };
        rows.append(section);
      }
    } else rows.append(...visible.map(row));
    if (!visible.length)
      rows.append(
        blank(
          state.instances.length
            ? L('No matching instances', '没有匹配的实例')
            : L('No instances', '暂无实例'),
        ),
      );
    updateSelection();
  }
  search.oninput = group.onchange = sort.onchange = update;
  update();
  return update;
}
