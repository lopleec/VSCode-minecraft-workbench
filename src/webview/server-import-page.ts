import { h } from './dom';
import { PageContext, heading, field, input, select, busy } from './page-ui';
import { engines } from './server-ui';
import type { ServerPreview } from '../server-import';

export function renderServerImport(main: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  main.append(heading(L('Import server', '导入服务端')));
  const directory = input('serverDirectory');
  directory.required = true;
  const name = input('name');
  name.required = true;
  const engine = select('engine', 'custom', engines);
  const minecraft = input('minecraft');
  minecraft.required = true;
  const jar = select('jar', '', []);
  const fields = h(
    'fieldset',
    { disabled: true },
    h(
      'div',
      { class: 'form-grid' },
      field(L('Name', '名称'), name),
      field(L('Software', '服务端类型'), engine),
      field(L('Minecraft version', 'Minecraft 版本'), minecraft),
      field(L('Launch JAR', '启动 JAR'), jar),
    ),
  );
  const submit = h(
    'button',
    { class: 'primary', type: 'submit', disabled: true },
    L('Import', '导入'),
  );
  const info = h('p', { role: 'status' });
  const form = h(
    'form',
    { class: 'management-form' },
    field(
      L('Server directory', '服务端目录'),
      h(
        'div',
        { class: 'input-action' },
        directory,
        ctx.button(
          L('Browse…', '浏览…'),
          async () => {
            const value = await ctx.request<string | undefined>('launcher.pickDirectory');
            if (value) {
              directory.value = value;
              await inspect();
            }
          },
          'secondary',
        ),
        ctx.button(L('Detect', '识别'), inspect, 'secondary'),
      ),
    ),
    fields,
    h(
      'p',
      {},
      L(
        'Manage the existing files in place. The Minecraft EULA must be confirmed before the first start.',
        '原地管理已有文件，首次启动前需确认 Minecraft EULA。',
      ),
    ),
    info,
    h(
      'div',
      { class: 'inline-actions' },
      submit,
      ctx.button(L('Cancel', '取消'), () => ctx.navigate('servers'), 'secondary'),
    ),
  );
  let inspected = '';
  directory.oninput = () => {
    fields.disabled = true;
    submit.disabled = true;
  };
  async function inspect() {
    submit.disabled = true;
    const current = directory.value.trim();
    const preview = await ctx.request<ServerPreview>('server.inspect', { directory: current });
    if (!ctx.current() || current !== directory.value.trim()) return;
    inspected = current;
    name.value = preview.name;
    engine.value = preview.engine;
    minecraft.value = preview.minecraft;
    jar.replaceChildren(
      h('option', { value: '' }, preview.argumentFile || L('Automatic', '自动')),
      ...preview.jars.map((file) => h('option', { value: file }, file)),
    );
    fields.disabled = false;
    submit.disabled = false;
    info.textContent = preview.argumentFile || '';
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    if (inspected !== directory.value.trim() || !form.reportValidity()) return;
    void busy(form, async () => {
      await ctx.request('server.import', {
        value: {
          directory: inspected,
          name: name.value,
          engine: engine.value,
          minecraft: minecraft.value,
          jar: jar.value,
        },
      });
      await ctx.navigate('server');
    }).catch(ctx.error);
  };
  main.append(form);
}
