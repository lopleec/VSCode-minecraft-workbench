import type { PageContext } from './page-ui';
export const engines: [string, string][] = [
  ['vanilla', 'Vanilla'],
  ['paper', 'Paper'],
  ['purpur', 'Purpur'],
  ['folia', 'Folia'],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['forge', 'Forge'],
  ['neoforge', 'NeoForge'],
  ['velocity', 'Velocity'],
  ['custom', 'Custom JAR'],
];
export function serverContent(engine: string): 'mod' | 'plugin' | undefined {
  if (['paper', 'purpur', 'folia', 'velocity'].includes(engine)) return 'plugin';
  if (['fabric', 'quilt', 'forge', 'neoforge'].includes(engine)) return 'mod';
}
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
