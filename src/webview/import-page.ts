import { h } from './dom';
import { PageContext, field, input, select, heading, blank, busy } from './page-ui';
import type { ImportCandidate, ImportScan } from '../instance-import';
import type { BatchImportResult } from '../import-session';
import { instanceGroups } from '../instance-groups';

export function renderImport(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  const source = input('source', ctx.state().defaults.instanceDirectory);
  const mode = select('mode', 'link', [
    ['link', L('Manage in place', '原地管理')],
    ['copy', L('Copy into Minecraft directory', '复制到 Minecraft 目录')],
  ]);
  const root = input('root', ctx.state().defaults.gameDirectory);
  const group = input('group');
  group.maxLength = 100;
  group.setAttribute('list', 'import-groups');
  const filter = input('importFilter');
  filter.type = 'search';
  filter.placeholder = L('Filter instances…', '筛选实例…');
  filter.setAttribute('aria-label', L('Filter instances', '筛选实例'));
  const selectedCount = h('span', { class: 'muted', role: 'status' });
  let working = false;
  const results = h('div', { class: 'management-list', 'aria-live': 'polite' });
  const status = h('p', { class: 'field-hint', role: 'status' });
  const choices = new Map<
    string,
    {
      candidate: ImportCandidate;
      checkbox: HTMLInputElement;
      name: HTMLInputElement;
      row: HTMLElement;
      unavailable: boolean;
      unsupported: boolean;
      done: boolean;
      status: HTMLElement;
    }
  >();
  const submit = ctx.button(
    L('Import selected', '导入所选实例'),
    async () => {
      const selected = [...choices.values()].filter(
        (value) => value.checkbox.checked && !value.unavailable,
      );
      if (!selected.length) return;
      working = true;
      updateSelection();
      try {
        await busy(form, async () => {
          status.textContent = L(
            `Importing ${selected.length} instances…`,
            `正在导入 ${selected.length} 个实例…`,
          );
          const result = await ctx.request<BatchImportResult>('launcher.importInstances', {
            entries: selected.map((value) => ({
              key: value.candidate.key,
              name: value.name.value,
            })),
            mode: mode.value,
            root: root.value,
            group: group.value,
          });
          if (!ctx.current()) return;
          for (const { key } of result.imported) {
            const value = choices.get(key)!;
            value.checkbox.checked = false;
            value.done = true;
          }
          await ctx.refresh();
          status.textContent = L(
            `${result.imported.length} imported${result.cancelled ? ' · Cancelled' : ''}.`,
            `已导入 ${result.imported.length} 个${result.cancelled ? ' · 已取消' : ''}。`,
          );
          if (result.failed.length)
            ctx.error(
              new Error(result.failed.map((error) => `${error.name}: ${error.message}`).join('\n')),
            );
          else if (result.imported.length && !result.cancelled) await ctx.navigate('instances');
        });
      } finally {
        working = false;
        updateSelection();
      }
    },
    'primary',
    true,
  );
  function updateSelection() {
    const values = [...choices.values()];
    for (const value of values) {
      const registered = ctx
        .state()
        .instances.some(
          (instance) =>
            instance.directory === value.candidate.directory &&
            instance.versionId === value.candidate.versionId,
        );
      value.unavailable = value.unsupported || value.done || (mode.value === 'link' && registered);
      value.status.hidden = !registered && !value.done;
      value.status.textContent = value.done
        ? L('Imported', '已导入')
        : L('Already registered', '已在列表中');
      if (value.unavailable) value.checkbox.checked = false;
    }
    const count = values.filter((value) => value.checkbox.checked && !value.unavailable).length;
    submit.disabled = working || !count;
    selectAll.disabled =
      working || !values.some((value) => !value.unavailable && !value.row.hidden);
    clear.disabled = working || !count;
    filter.disabled = working;
    selectedCount.textContent = L(`${count} selected`, `已选择 ${count} 个`);
    for (const value of values) {
      value.checkbox.disabled = working || value.unavailable;
      value.name.disabled = working || value.unavailable;
    }
  }
  const selectAll = ctx.button(
    L('Select all', '全选'),
    () => {
      for (const value of choices.values())
        if (!value.unavailable && !value.row.hidden) value.checkbox.checked = true;
      updateSelection();
    },
    'secondary',
    true,
  );
  const clear = ctx.button(
    L('Clear selection', '取消选择'),
    () => {
      for (const value of choices.values()) value.checkbox.checked = false;
      updateSelection();
    },
    'secondary',
    true,
  );
  function filterRows() {
    const query = filter.value.trim().toLowerCase();
    for (const value of choices.values())
      value.row.hidden =
        !`${value.name.value} ${value.candidate.minecraft} ${value.candidate.loader} ${value.candidate.directory}`
          .toLowerCase()
          .includes(query);
    selectAll.textContent = query ? L('Select filtered', '选择筛选结果') : L('Select all', '全选');
    updateSelection();
  }
  filter.oninput = filterRows;
  const scan = ctx.button(
    L('Scan', '扫描'),
    async () => {
      if (working) return;
      working = true;
      updateSelection();
      try {
        await busy(form, async () => {
          status.textContent = L('Scanning…', '正在扫描…');
          choices.clear();
          results.replaceChildren();
          submit.disabled = true;
          const found = await ctx.request<ImportScan & { archive: boolean }>(
            'launcher.scanInstances',
            { source: source.value },
          );
          mode.value = found.archive ? 'copy' : 'link';
          mode.disabled = found.archive;
          for (const candidate of found.candidates) {
            const unsupported = candidate.warnings.some(
              (v) =>
                v.startsWith('Unsupported MultiMC component:') || v.startsWith('Legacy jar mods'),
            );
            const checkbox = h('input', {
              type: 'checkbox',
              disabled: unsupported,
              'aria-label': L(`Import ${candidate.name}`, `导入 ${candidate.name}`),
            });
            const name = input('importName', candidate.name);
            name.required = true;
            name.maxLength = 100;
            name.setAttribute('aria-label', L('Instance name', '实例名称'));
            checkbox.onchange = updateSelection;
            const importStatus = h('span', { class: 'badge', hidden: true });
            const row = h(
              'article',
              { class: 'management-row import-row' },
              checkbox,
              h(
                'div',
                { class: 'row-body' },
                h('div', { class: 'inline-actions' }, name, importStatus),
                h(
                  'p',
                  { class: 'muted' },
                  `${candidate.format === 'multimc' ? 'Prism / MultiMC' : candidate.format} · ${candidate.minecraft} · ${candidate.loader}${candidate.loaderVersion ? ` ${candidate.loaderVersion}` : ''}`,
                ),
                h('div', { class: 'path-value muted' }, candidate.directory),
                ...candidate.warnings.map((warning) =>
                  h(
                    'p',
                    { class: 'warning' },
                    warning
                      .replace(
                        'Unsupported MultiMC component:',
                        L('Unsupported MultiMC component:', '不支持的 MultiMC 组件：'),
                      )
                      .replace(
                        'Legacy jar mods require a compatible launcher.',
                        L(
                          'Legacy jar mods require a compatible launcher.',
                          '旧式 Jar 模组需要使用兼容的启动器。',
                        ),
                      )
                      .replace(
                        'The configured Java path is unavailable; global or automatic Java selection will be used.',
                        L(
                          'The configured Java path is unavailable; global or automatic Java selection will be used.',
                          '原有 Java 路径不可用，将使用全局或自动选择的 Java。',
                        ),
                      ),
                  ),
                ),
              ),
            );
            choices.set(candidate.key, {
              candidate,
              checkbox,
              name,
              row,
              unavailable: unsupported,
              unsupported,
              done: false,
              status: importStatus,
            });
            results.append(row);
          }
          if (!found.candidates.length)
            results.append(
              blank(
                L('No supported instances found', '未找到可识别的实例'),
                L(
                  'Select a game folder containing version metadata, or export a .mrpack from the original launcher.',
                  '请选择包含版本信息的游戏目录，或从原启动器导出 .mrpack 整合包。',
                ),
              ),
            );
          if (found.warnings.length)
            results.append(
              h(
                'details',
                {},
                h('summary', {}, L('Skipped folders', '已跳过的目录')),
                h('pre', { class: 'import-warnings' }, found.warnings.join('\n')),
              ),
            );
          status.textContent = L(
            `${found.candidates.length} instance(s) found.`,
            `找到 ${found.candidates.length} 个实例。`,
          );
          syncMode();
          filterRows();
        });
      } catch (error) {
        status.textContent = L('Scan failed.', '扫描失败。');
        throw error;
      } finally {
        working = false;
        updateSelection();
      }
    },
    'secondary',
  );
  const destination = field(L('Minecraft directory', 'Minecraft 目录'), root);
  const hint = h('p', { class: 'field-hint' });
  function syncMode() {
    destination.hidden = mode.value !== 'copy';
    hint.textContent =
      mode.value === 'link'
        ? L(
            'Changes to mods, settings and worlds also affect the original launcher. Removing the instance keeps its files.',
            '模组、设置和存档的更改也会在原启动器中生效。移除实例时保留游戏文件。',
          )
        : L(
            'Copies mods, settings and worlds. Missing game resources are installed on first launch.',
            '复制模组、设置和存档；缺失的游戏资源会在首次启动时补齐。',
          );
  }
  mode.onchange = () => {
    syncMode();
    updateSelection();
  };
  source.oninput = () => {
    choices.clear();
    results.replaceChildren();
    updateSelection();
  };
  const form = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      field(
        L('Source folder or ZIP export', '来源目录或 ZIP 导出文件'),
        h(
          'div',
          { class: 'input-action' },
          source,
          ctx.button(
            L('Browse…', '浏览…'),
            async () => {
              const path = await ctx.request<string | undefined>('launcher.pickInstanceSource');
              if (path) {
                source.value = path;
                choices.clear();
                results.replaceChildren();
                updateSelection();
              }
            },
            'secondary',
          ),
        ),
      ),
      h(
        'div',
        { class: 'inline-actions' },
        scan,
        ctx.button(
          L('Import .mrpack…', '导入 .mrpack…'),
          () => ctx.request('action', { action: 'importPack' }),
          'secondary',
        ),
      ),
      field(L('Import method', '导入方式'), mode),
      destination,
      field(L('Group (optional)', '分组（可选）'), group),
      h(
        'datalist',
        { id: 'import-groups' },
        ...instanceGroups(ctx.state().instances).map((name) => h('option', { value: name })),
      ),
      hint,
      status,
    ),
  );
  form.onsubmit = (event) => event.preventDefault();
  main.append(
    heading(
      L('Import instances', '导入实例'),
      L(
        'Minecraft / HMCL / PCL · Prism / MultiMC · Modrinth',
        'Minecraft / HMCL / PCL · Prism / MultiMC · Modrinth',
      ),
    ),
    form,
    h(
      'div',
      { class: 'inline-actions instance-import-toolbar' },
      filter,
      selectAll,
      clear,
      selectedCount,
      submit,
    ),
    results,
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(
        L('Back to instances', '返回实例列表'),
        () => ctx.navigate('instances'),
        'secondary',
      ),
    ),
  );
  syncMode();
  updateSelection();
}
