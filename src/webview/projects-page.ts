import { h } from './dom';
import { PageContext, field, input, select, heading, blank, busy } from './page-ui';
import type { Template } from '../developer';
import type { VersionManifest } from '../models';
import { projectSettings } from './project-settings';

export function renderProjects(body: HTMLElement, ctx: PageContext) {
  const L = ctx.text;
  const rows = h('div', { class: 'management-list' });
  body.append(
    heading(L('Mod projects', '模组项目')),
    h(
      'div',
      { class: 'inline-actions page-actions' },
      ctx.button(
        L('Import Gradle project', '导入 Gradle 项目'),
        async () => {
          await ctx.request('action', { action: 'importProject' });
          await ctx.refresh();
          update();
        },
        'secondary',
      ),
    ),
    rows,
  );
  const name = input('projectName');
  name.required = true;
  name.maxLength = 100;
  const modId = input('modId');
  modId.required = true;
  modId.pattern = '[a-z][a-z0-9_]{1,63}';
  modId.maxLength = 64;
  const packageName = input('packageName', 'com.example.example_mod');
  packageName.required = true;
  const parent = input('projectDirectory', ctx.state().defaults.projectDirectory);
  parent.required = true;
  const loader = select('projectLoader', 'fabric', [
    ['fabric', 'Fabric'],
    ['forge', 'Forge'],
    ['neoforge', 'NeoForge'],
  ]);
  const game = select('projectMinecraft', '', []);
  const template = select('projectTemplate', '', []);
  template.required = true;
  const templateStatus = h('p', { class: 'field-hint', 'aria-live': 'polite' });
  const open = h('input', { type: 'checkbox', checked: ctx.state().defaults.autoOpenProject });
  const submit = h(
    'button',
    { type: 'submit', class: 'primary', disabled: true },
    L('Create project', '创建项目'),
  );
  const form = h('form', { class: 'management-form' });
  const gameField = field(L('Minecraft version', 'Minecraft 版本'), game);
  gameField.hidden = true;
  let templateSequence = 0,
    idEdited = false,
    packageEdited = false;
  const suggestPackage = () => {
    if (!packageEdited) packageName.value = `com.example.${modId.value || 'example_mod'}`;
  };
  name.oninput = () => {
    if (!idEdited)
      modId.value = name.value
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^[^a-z]+/, '')
        .slice(0, 64);
    suggestPackage();
  };
  modId.oninput = () => {
    idEdited = true;
    suggestPackage();
  };
  packageName.oninput = () => {
    packageEdited = true;
  };
  async function templates() {
    const sequence = ++templateSequence;
    template.replaceChildren();
    template.disabled = true;
    submit.disabled = true;
    templateStatus.textContent = L('Loading official templates…', '加载官方模板…');
    gameField.hidden = loader.value !== 'forge';
    try {
      if (loader.value === 'forge' && !game.options.length) {
        const manifest = await ctx.request<VersionManifest>('launcher.gameVersions');
        if (sequence !== templateSequence || !ctx.current()) return;
        game.replaceChildren(
          ...manifest.versions.map((v) =>
            h(
              'option',
              { value: v.id, selected: v.id === manifest.latest.release },
              `${v.id} · ${v.type}`,
            ),
          ),
        );
      }
      const values = await ctx.request<Template[]>('launcher.projectTemplates', {
        loader: loader.value,
        minecraft: game.value,
      });
      if (sequence !== templateSequence || !ctx.current()) return;
      template.replaceChildren(
        ...values.map((value) =>
          h('option', { value: value.name }, `${value.minecraft} · ${value.name}`),
        ),
      );
      template.disabled = !values.length;
      submit.disabled = !values.length;
      templateStatus.textContent = values.length
        ? L(
            'The template supplies its compatible Minecraft, loader and Gradle versions.',
            '模板包含对应的 Minecraft、Loader 和 Gradle 版本。',
          )
        : L(
            'No official template is available for this selection.',
            '当前选择没有可用的官方模板。',
          );
    } catch (error) {
      if (sequence === templateSequence) templateStatus.textContent = (error as Error).message;
    }
  }
  loader.onchange = () => void templates();
  game.onchange = () => void templates();
  form.append(
    h(
      'fieldset',
      {},
      h('legend', {}, L('New mod project', '新建模组项目')),
      h(
        'div',
        { class: 'form-grid' },
        field(L('Mod name', '模组名称'), name),
        field(L('Mod ID', '模组 ID'), modId),
      ),
      field(L('Java package', 'Java 包名'), packageName),
      field(
        L('Project parent directory', '项目父目录'),
        h(
          'div',
          { class: 'input-action' },
          parent,
          ctx.button(
            L('Browse…', '浏览…'),
            async () => {
              const value = await ctx.request<string | undefined>('launcher.pickDirectory');
              if (value) parent.value = value;
            },
            'secondary',
          ),
        ),
      ),
      h('div', { class: 'form-grid' }, field(L('Loader', '加载器'), loader), gameField),
      field(L('Template version', '模板版本'), template),
      templateStatus,
      h('label', { class: 'check' }, open, L('Open the project after creation', '创建后打开项目')),
      h(
        'div',
        { class: 'save-row' },
        submit,
        ctx.button(L('Reload templates', '重新加载模板'), templates, 'secondary'),
      ),
    ),
  );
  form.onsubmit = (e) => {
    e.preventDefault();
    void busy(form, async () => {
      await ctx.request('launcher.createProject', {
        loader: loader.value,
        minecraft: game.value,
        template: template.value,
        name: name.value,
        modId: modId.value,
        packageName: packageName.value,
        parent: parent.value,
        open: open.checked,
      });
      await ctx.refresh();
      update();
      ctx.notify(L('Project created.', '项目已创建。'));
    }).catch(ctx.error);
  };
  body.append(form);
  void templates();
  let projectsKey = '';
  function update() {
    const key = JSON.stringify(ctx.state().projects);
    if (key === projectsKey) return;
    projectsKey = key;
    const actions: [string, string][] = [
      ['attach', L('Attach debugger', '连接调试器')],
      ['stop', L('Stop Gradle task', '停止 Gradle 任务')],
      ['sources', L('Generate sources / IDE runs', '生成源码 / IDE 配置')],
      ['clean', L('Clean', '清理构建')],
      ['artifacts', L('Show artifacts', '显示构建产物')],
      ['directory', L('Open directory', '打开目录')],
      ['refresh', L('Reload project metadata', '重新读取项目元数据')],
      ['remove', L('Remove from list', '从列表移除')],
    ];
    rows.replaceChildren(
      ...ctx.state().projects.map((project) => {
        const action = select('projectAction', 'attach', actions);
        action.setAttribute(
          'aria-label',
          L(`Action for ${project.name}`, `${project.name} 的操作`),
        );
        return h(
          'article',
          { class: 'management-row project-row' },
          h(
            'div',
            { class: 'row-body' },
            h('strong', {}, project.name),
            h(
              'p',
              { class: 'muted' },
              `${project.minecraft} · ${project.loader} · ${project.packageName}`,
            ),
            h('div', { class: 'path-value muted' }, project.directory),
            projectSettings(project, ctx),
          ),
          h(
            'div',
            { class: 'inline-actions' },
            ctx.button(
              L('Open', '打开'),
              () => ctx.request('launcher.projectAction', { id: project.id, action: 'open' }),
              'secondary',
            ),
            ...(['build', 'runClient', 'debug'] as const).map((action) =>
              ctx.button(
                action === 'build'
                  ? L('Build', '构建')
                  : action === 'runClient'
                    ? L('Run client', '运行客户端')
                    : L('Run for debugging', '运行以调试'),
                () => ctx.request('launcher.projectAction', { id: project.id, action }),
                'secondary',
              ),
            ),
            action,
            ctx.button(
              L('Run action', '执行操作'),
              async () => {
                await ctx.request('launcher.projectAction', {
                  id: project.id,
                  action: action.value,
                });
                await ctx.refresh();
                update();
              },
              'secondary',
            ),
          ),
        );
      }),
    );
    if (!ctx.state().projects.length) rows.append(blank(L('No mod projects', '暂无模组项目')));
  }
  update();
  return update;
}
