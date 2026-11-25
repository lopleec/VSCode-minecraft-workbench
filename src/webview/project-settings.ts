import type { Project } from '../models';
import { h } from './dom';
import { field, input, busy, type PageContext } from './page-ui';

export function projectSettings(project: Project, ctx: PageContext) {
  const L = ctx.text;
  const java = input('projectJava', project.java || '');
  java.placeholder = L('Default Java', '默认 Java', '預設 Java');
  const port = input('projectDebugPort', project.debugPort || 0, 'number');
  port.min = '0';
  port.max = '65535';
  const args = h(
    'textarea',
    { name: 'projectGradleArgs', rows: 3 },
    (project.gradleArgs || []).join('\n'),
  );
  const form = h(
    'form',
    { class: 'management-form' },
    h(
      'fieldset',
      {},
      h(
        'div',
        { class: 'form-grid' },
        field(
          L('Java executable', 'Java 可执行文件', 'Java 執行檔'),
          h(
            'div',
            { class: 'input-action' },
            java,
            ctx.button(
              L('Browse…', '浏览…', '瀏覽…'),
              async () => {
                const selected = await ctx.request<string | undefined>('launcher.pickJava');
                if (selected) java.value = selected;
              },
              'secondary',
            ),
          ),
        ),
        field(
          L('Debug port (0 = default)', '调试端口（0 为默认）', '偵錯連接埠（0 為預設）'),
          port,
        ),
      ),
      field(
        L('Gradle arguments', 'Gradle 参数', 'Gradle 引數'),
        args,
        L('One argument per line.', '每行一个参数。', '每行一個引數。'),
      ),
      h(
        'div',
        { class: 'save-row' },
        h('button', { class: 'primary', type: 'submit' }, L('Save', '保存', '儲存')),
      ),
    ),
  );
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    void busy(form, async () => {
      await ctx.request('launcher.projectConfigure', {
        id: project.id,
        value: {
          java: java.value,
          debugPort: Number(port.value),
          gradleArgs: args.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        },
      });
      await ctx.refresh();
      ctx.notify(L('Project settings saved.', '项目设置已保存。', '項目設定已儲存。'));
    }).catch(ctx.error);
  };
  return h(
    'details',
    { class: 'project-settings' },
    h('summary', {}, L('Project settings', '项目设置', '項目設定')),
    form,
  );
}
