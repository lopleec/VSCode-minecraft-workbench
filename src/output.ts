import * as vscode from 'vscode';
import { Store } from './store';
import { Jobs } from './jobs';
import { Minecraft } from './minecraft';
import { Servers } from './servers';
import { t } from './config';

export async function showOutput(store: Store, jobs: Jobs, minecraft: Minecraft, servers: Servers) {
  const choices: (vscode.QuickPickItem & { open(): unknown })[] = [
    {
      label: 'Minecraft Workbench',
      description: t('Installation, launch and task logs', '安装、启动与任务日志'),
      open: () => jobs.output.show(true),
    },
  ];
  if (store.state.mode === 'launcher' && store.selected) {
    const instance = store.selected;
    choices.push({
      label: t('Game log', '游戏日志'),
      description: instance.name,
      open: () => minecraft.logs(instance),
    });
  }
  if (store.state.mode === 'server' && servers.selected) {
    const server = servers.selected;
    choices.push({
      label: t('Server output', '服务端输出'),
      description: server.name,
      open: () => servers.showLog(server),
    });
  }
  if (store.state.mode === 'developer')
    for (const terminal of vscode.window.terminals)
      if (store.state.projects.some((project) => terminal.name.includes(`${project.name}: `)))
        choices.push({
          label: terminal.name,
          description: t('Gradle terminal', 'Gradle 终端'),
          open: () => terminal.show(true),
        });
  const choice =
    choices.length === 1
      ? choices[0]
      : await vscode.window.showQuickPick(choices, { title: t('Output', '输出') });
  await choice?.open();
}
