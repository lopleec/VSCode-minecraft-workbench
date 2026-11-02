import { h } from './dom';
import type { BatchInstallPlan } from '../modrinth';
import { modrinthProjects } from '../modrinth';

export function renderBatchInput(
  panel: HTMLElement,
  ui: {
    text(en: string, zh: string): string;
    button(
      label: string,
      action: () => unknown,
      style?: string,
      disabled?: boolean,
    ): HTMLButtonElement;
    close(): void;
    review(projects: string[]): void;
  },
) {
  const L = ui.text;
  const input = h('textarea', {
    rows: 9,
    required: true,
    spellcheck: false,
    'aria-label': L('Modrinth mod links or project IDs', 'Modrinth 模组链接或项目 ID'),
    placeholder: 'https://modrinth.com/mod/sodium\nhttps://modrinth.com/mod/lithium',
  });
  const error = h('p', { class: 'danger', role: 'alert' });
  const form = h(
    'form',
    { class: 'management-form' },
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, L('Modrinth links or IDs', 'Modrinth 链接或 ID')),
      input,
    ),
    h(
      'p',
      {},
      L(
        'One per line. Versions, loaders and required dependencies are matched automatically.',
        '每行一个。自动匹配游戏版本、加载器和必需前置。',
      ),
    ),
    error,
    h('button', { class: 'primary', type: 'submit' }, L('Match versions', '匹配版本')),
  );
  form.onsubmit = (event) => {
    event.preventDefault();
    try {
      ui.review(modrinthProjects(input.value));
    } catch {
      error.textContent = L(
        'Enter up to 100 Modrinth mod links or project IDs.',
        '请输入最多 100 个 Modrinth 模组链接或项目 ID。',
      );
    }
  };
  panel.replaceChildren(
    h('div', { class: 'detail-heading' }, ui.button(L('Close', '关闭'), ui.close, 'text-button')),
    h('div', { class: 'detail-title' }, h('h1', {}, L('Batch install', '批量安装'))),
    h('div', { class: 'detail-scroll' }, form),
  );
}

export async function renderBatchInstall(
  panel: HTMLElement,
  projects: string[],
  ui: {
    text(en: string, zh: string): string;
    request<T>(method: string, params: Record<string, unknown>): Promise<T>;
    button(
      label: string,
      action: () => unknown,
      style?: string,
      disabled?: boolean,
    ): HTMLButtonElement;
    close(): void;
    complete(): void;
    error(error: unknown): void;
  },
) {
  const L = ui.text;
  const body = h(
    'div',
    { class: 'detail-scroll' },
    h('p', { role: 'status' }, L('Matching versions…', '匹配版本…')),
  );
  panel.replaceChildren(
    h(
      'div',
      { class: 'detail-heading' },
      ui.button(L('← Back', '← 返回'), ui.close, 'text-button'),
    ),
    h('div', { class: 'detail-title' }, h('h1', {}, L('Install selected mods', '安装所选模组'))),
    body,
  );
  try {
    const result = await ui.request<BatchInstallPlan>('batchPlan', { projects, kind: 'mod' });
    if (!body.isConnected) return;
    const selected = new Set(result.versions.map((v) => v.id));
    const dependencies = result.plan.entries.filter((entry) => !selected.has(entry.version.id));
    body.replaceChildren(
      ...result.versions.map((v) =>
        h(
          'article',
          { class: 'management-row' },
          h('div', { class: 'row-body' }, h('strong', {}, v.name), h('p', {}, v.version_number)),
        ),
      ),
      ...result.unavailable.map((item) =>
        h('p', { class: 'danger' }, `${item.name}: ${L('No compatible version', '没有兼容版本')}`),
      ),
      ...(dependencies.length
        ? [
            h(
              'details',
              { class: 'optional-section' },
              h(
                'summary',
                {},
                L(`Dependencies (${dependencies.length})`, `前置依赖（${dependencies.length}）`),
              ),
              ...dependencies.map((entry) => h('p', {}, entry.version.name)),
            ),
          ]
        : []),
      ...result.plan.conflicts.map((message) => h('p', { class: 'danger' }, message)),
    );
    const installable = result.versions.map((v) => v.project_id);
    const confirm = ui.button(
      result.unavailable.length
        ? L(
            `Install compatible mods (${installable.length})`,
            `安装兼容的模组（${installable.length}）`,
          )
        : L(`Install (${installable.length})`, `安装（${installable.length}）`),
      async () => {
        confirm.disabled = true;
        try {
          await ui.request('batchInstall', { projects: installable, kind: 'mod' });
          if (body.isConnected) ui.complete();
        } finally {
          if (confirm.isConnected) confirm.disabled = false;
        }
      },
      'primary',
      !installable.length || result.plan.conflicts.length > 0,
    );
    body.append(h('div', { class: 'inline-actions page-actions' }, confirm));
  } catch (error) {
    if (body.isConnected) {
      body.replaceChildren(h('p', { class: 'danger' }, String((error as Error).message)));
      ui.error(error);
    }
  }
}
