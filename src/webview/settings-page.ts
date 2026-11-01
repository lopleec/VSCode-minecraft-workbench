import { h } from './dom';
import { PageContext, heading } from './page-ui';

interface Setting {
  type: string;
  label: string;
  group: string;
  description: string;
  value: unknown;
  enum?: string[];
  enumItemLabels?: string[];
  minimum?: number;
  maximum?: number;
  deprecationMessage?: string;
}

export async function renderSettings(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  main.append(heading(L('Settings', '设置')));
  const search = h('input', {
    type: 'search',
    placeholder: L('Search settings…', '搜索设置…'),
    'aria-label': L('Search settings', '搜索设置'),
  });
  const form = h('form', { class: 'settings-form' });
  const draft = new Map<string, () => unknown>();
  const save = h('button', { type: 'submit', class: 'primary', disabled: true }, L('Save', '保存'));
  const native = ctx.button(
    L('Open in VS Code Settings', '在 VS Code 设置中打开'),
    () => ctx.request('action', { action: 'nativeSettings' }),
    'secondary',
  );
  main.append(h('div', { class: 'inline-actions settings-toolbar' }, search, save, native), form);
  save.setAttribute('form', 'extension-settings');
  form.id = 'extension-settings';
  const groups = new Map<string, HTMLElement>();
  const rows: { node: HTMLElement; text: string }[] = [];
  try {
    const settings = await ctx.request<Record<string, Setting>>('settings.read');
    if (!ctx.current()) return;
    for (const [key, setting] of Object.entries(settings)) {
      if (setting.deprecationMessage) continue;
      let group = groups.get(setting.group);
      if (!group) {
        group = h('fieldset', {}, h('legend', {}, setting.group));
        groups.set(setting.group, group);
        form.append(group);
      }
      let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      let value: () => unknown;
      if (setting.type === 'boolean') {
        const input = h('input', { type: 'checkbox', checked: !!setting.value });
        control = input;
        value = () => input.checked;
      } else if (setting.enum) {
        const select = h(
          'select',
          {},
          ...setting.enum.map((item, index) =>
            h(
              'option',
              { value: item, selected: item === setting.value },
              setting.enumItemLabels?.[index] || item,
            ),
          ),
        );
        control = select;
        value = () => select.value;
      } else if (setting.type === 'array' || setting.type === 'object') {
        const textarea = h(
          'textarea',
          { rows: 3, spellcheck: false },
          JSON.stringify(setting.value, null, 2),
        );
        control = textarea;
        value = () => JSON.parse(textarea.value);
      } else {
        const numeric = ['integer', 'number'].includes(setting.type);
        const input = h('input', {
          type: numeric ? 'number' : 'text',
          value: String(setting.value ?? ''),
          ...(numeric
            ? {
                min: setting.minimum,
                max: setting.maximum,
                step: setting.type === 'integer' ? 1 : 'any',
                required: true,
              }
            : {}),
        });
        control = input;
        value = () => (numeric ? Number(input.value) : input.value);
      }
      control.id = `setting-${key}`;
      if (JSON.stringify(setting.value).includes('[redacted]')) {
        control.disabled = true;
        control.title = L(
          'Edit credentials in VS Code Settings.',
          '请在 VS Code 设置中修改包含凭据的配置。',
        );
      }
      const original = JSON.stringify(setting.value);
      control.oninput = () => {
        let dirty = true;
        try {
          dirty = JSON.stringify(value()) !== original;
        } catch {
          /* JSON is validated on save. */
        }
        if (dirty) draft.set(key, value);
        else draft.delete(key);
        save.disabled = !draft.size;
      };
      const row = h(
        'div',
        { class: 'setting-row' },
        h(
          'label',
          { for: control.id, class: setting.type === 'boolean' ? 'check' : 'field-label' },
          ...(setting.type === 'boolean' ? [control] : []),
          setting.label,
        ),
        setting.description && h('p', { class: 'setting-description' }, setting.description),
        setting.type !== 'boolean' && control,
      );
      group.append(row);
      rows.push({
        node: row,
        text: `${setting.label} ${setting.description} ${key} ${setting.group}`.toLowerCase(),
      });
    }
    search.oninput = () => {
      const query = search.value.trim().toLowerCase();
      for (const row of rows) row.node.hidden = !row.text.includes(query);
      for (const group of groups.values())
        group.hidden = ![...group.querySelectorAll<HTMLElement>('.setting-row')].some(
          (row) => !row.hidden,
        );
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      save.disabled = true;
      void (async () => {
        const updates = [...draft].map(([key, value]) => [key, value()] as const);
        updates.sort(([a], [b]) => Number(a === 'language') - Number(b === 'language'));
        for (const [key, value] of updates)
          await ctx.request('settings.update', { key, value, scope: 'effective' });
        draft.clear();
        await ctx.refresh();
        if (ctx.current()) ctx.notify(L('Settings saved.', '设置已保存。'));
      })()
        .catch(ctx.error)
        .finally(() => {
          save.disabled = !draft.size;
        });
    };
  } catch (error) {
    ctx.error(error);
  }
}
