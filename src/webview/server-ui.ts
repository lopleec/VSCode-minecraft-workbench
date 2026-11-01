import type { PageContext } from './page-ui';
import { serverEngines } from '../server-types';
export const engines: [string, string][] = serverEngines.map((entry) => [entry.id, entry.name]);
export function statusLabel(status: string, L: PageContext['text']) {
  return (
    (
      {
        stopped: L('Stopped', '已停止'),
        preparing: L('Preparing', '准备中'),
        starting: L('Starting', '启动中'),
        running: L('Running', '运行中'),
        stopping: L('Stopping', '停止中'),
      } as Record<string, string>
    )[status] || status
  );
}
