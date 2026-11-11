import * as vscode from 'vscode';
import type { Store } from './store';
import type { Minecraft } from './minecraft';
import type { Jobs } from './jobs';
import { instanceGroup, instanceGroups } from './instance-groups';
import { t, trusted } from './config';
import { describeError } from './errors';

export async function manageInstances(
  store: Store,
  minecraft: Minecraft,
  jobs: Jobs,
  params: Record<string, unknown>,
) {
  await trusted();
  const ids = params.ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 2000 ||
    ids.some((id) => typeof id !== 'string')
  )
    throw new Error('Select between 1 and 2000 instances.');
  const instances = [...new Set(ids as string[])].map((id) => {
    const instance = store.state.instances.find((instance) => instance.id === id);
    if (!instance) throw new Error('Instance not found.');
    return instance;
  });
  const action = String(params.action);
  if (!['group', 'stop', 'repair', 'remove'].includes(action))
    throw new Error('Unknown instance action');
  if (action === 'group') {
    let group = params.group;
    if (group === undefined) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: t('New group…', '新建分组…'), create: true, group: '' },
          { label: t('Ungrouped', '未分组'), group: '' },
          ...instanceGroups(store.state.instances).map((group) => ({ label: group, group })),
        ],
        { title: t('Move selected instances to group', '将所选实例移动到分组') },
      );
      if (!choice) return { cancelled: true, changed: 0, failed: [] };
      group =
        'create' in choice && choice.create
          ? await vscode.window.showInputBox({
              title: t('Group name', '分组名称'),
              validateInput: (value) => {
                try {
                  return instanceGroup(value)
                    ? undefined
                    : t('Enter a group name.', '请输入分组名称。');
                } catch {
                  return t(
                    'Use up to 100 characters without control characters.',
                    '请使用不超过 100 个字符，不能包含控制字符。',
                  );
                }
              },
            })
          : choice.group;
      if (group === undefined) return { cancelled: true, changed: 0, failed: [] };
    }
    const next = instanceGroup(group);
    const previous = instances.map((instance) => instance.group);
    instances.forEach((instance) => {
      instance.group = next;
    });
    try {
      await store.save();
    } catch (error) {
      instances.forEach((instance, i) => {
        instance.group = previous[i];
      });
      throw error;
    }
    return { changed: instances.length, failed: [] };
  }
  if (action === 'remove') {
    for (const instance of instances) minecraft.assertIdle(instance);
    const yes = t('Remove', '删除');
    const owned = instances.filter((instance) => !instance.linked).length;
    if (
      (await vscode.window.showWarningMessage(
        t(
          `Remove ${instances.length} selected instances?`,
          `删除所选的 ${instances.length} 个实例？`,
        ),
        {
          modal: true,
          detail:
            t(
              `${owned} managed instance folder(s) will be moved to Trash. Files managed in place will be kept.`,
              `${owned} 个托管实例目录会移入废纸篓，原地管理的实例保留文件。`,
            ) +
            '\n\n' +
            instances
              .slice(0, 20)
              .map((instance) => instance.name)
              .join('\n'),
        },
        yes,
      )) !== yes
    )
      return { cancelled: true, changed: 0, failed: [] };
  }
  return jobs.run(
    [`Manage ${instances.length} instances`, `管理 ${instances.length} 个实例`],
    async (signal, report) => {
      let changed = 0;
      const failed: { id: string; name: string; message: string }[] = [];
      for (const instance of instances) {
        signal.throwIfAborted();
        report(`${changed + failed.length + 1} / ${instances.length}: ${instance.name}`);
        const abort = () => {
          void minecraft.stop(instance);
        };
        if (action === 'repair') signal.addEventListener('abort', abort, { once: true });
        try {
          if (action === 'stop') await minecraft.stop(instance);
          else if (action === 'repair') await minecraft.install(instance);
          else await minecraft.delete(instance);
          changed++;
        } catch (error) {
          signal.throwIfAborted();
          failed.push({ id: instance.id, name: instance.name, message: describeError(error) });
        } finally {
          signal.removeEventListener('abort', abort);
        }
      }
      return { changed, failed };
    },
  );
}
