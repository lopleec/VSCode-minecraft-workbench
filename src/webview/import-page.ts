import { h } from './dom';
import { PageContext, field, input, select, heading, blank, busy } from './page-ui';
import type { ImportCandidate, ImportScan } from '../instance-import';

export function renderImport(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  const source = input('source', ctx.state().defaults.instanceDirectory);
  const mode = select('mode', 'link', [
    ['link', L('Manage in place', '原地管理')],
    ['copy', L('Copy into Minecraft directory', '复制到 Minecraft 目录')],
  ]);
  const root = input('root', ctx.state().defaults.gameDirectory);
  const results = h('div', { class: 'management-list', 'aria-live': 'polite' });
  const status = h('p', { class: 'field-hint', role: 'status' });
  const choices = new Map<
    string,
    { candidate: ImportCandidate; checkbox: HTMLInputElement; name: HTMLInputElement }
  >();
  const submit = ctx.button(
    L('Import selected', '导入所选实例'),
    async () => {
      const selected = [...choices.values()].filter((value) => value.checkbox.checked);
      if (!selected.length) return;
      await busy(form, async () => {
        let count = 0;
        const errors: string[] = [];
        for (const value of selected) {
          status.textContent = L(`Importing ${value.name.value}…`, `正在导入 ${value.name.value}…`);
          try {
            await ctx.request('launcher.importInstance', {
              key: value.candidate.key,
              mode: mode.value,
              name: value.name.value,
              root: root.value,
            });
            value.checkbox.checked = false;
            value.checkbox.disabled = true;
            count++;
          } catch (error) {
            errors.push(`${value.name.value}: ${(error as Error).message}`);
          }
        }
        await ctx.refresh();
        status.textContent = L(`${count} instance(s) imported.`, `已导入 ${count} 个实例。`);
        updateSelection();
        if (errors.length) ctx.error(new Error(errors.join('\n')));
        else if (count) await ctx.navigate('instances');
      });
    },
    'primary',
    true,
  );
  function updateSelection() {
    submit.disabled = ![...choices.values()].some((v) => v.checkbox.checked);
  }
  const scan = ctx.button(
    L('Scan', '扫描'),
    async () => {
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
          choices.set(candidate.key, { candidate, checkbox, name });
          results.append(
            h(
              'article',
              { class: 'management-row import-row' },
              checkbox,
              h(
                'div',
                { class: 'row-body' },
                name,
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
                        'This profile uses launcher-specific patches; create a copy to rebuild its loader.',
                        L(
                          'This profile uses launcher-specific patches; create a copy to rebuild its loader.',
                          '此配置包含原启动器专有补丁，请选择复制导入以重建加载器。',
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
            ),
          );
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
      });
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
  mode.onchange = syncMode;
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
    results,
    h(
      'div',
      { class: 'inline-actions page-actions' },
      submit,
      ctx.button(
        L('Back to instances', '返回实例列表'),
        () => ctx.navigate('instances'),
        'secondary',
      ),
    ),
  );
  syncMode();
}
