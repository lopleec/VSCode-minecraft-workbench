import { h } from './dom';
import type { BatchInstallPlan } from '../modrinth';

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
