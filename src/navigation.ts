import type { Mode } from './models';
import { workbenchPages, type WorkbenchPage } from './webview/protocol';

export const managementPages: WorkbenchPage[] = [
  'accounts',
  'java',
  'downloads',
  'backups',
  'multiplayer',
  'settings',
];

export function defaultPage(mode: Mode): WorkbenchPage {
  return mode === 'developer' ? 'projects' : mode === 'server' ? 'servers' : 'instances';
}

export function pageMode(page: string): Mode | undefined {
  if (page === 'projects') return 'developer';
  if (['servers', 'serverCreate', 'serverImport', 'server'].includes(page)) return 'server';
  if (
    [
      'instances',
      'instance',
      'create',
      'import',
      'version',
      'accounts',
      'backups',
      'multiplayer',
    ].includes(page)
  )
    return 'launcher';
}

export function managementPagesFor(mode: Mode, terracotta = false): WorkbenchPage[] {
  return managementPages.filter((page) =>
    page === 'multiplayer'
      ? mode === 'launcher' && terracotta
      : !pageMode(page) || pageMode(page) === mode,
  );
}

export function resolvePage(page: string, mode: Mode, terracotta = false): WorkbenchPage {
  if (!(workbenchPages as readonly string[]).includes(page)) return defaultPage(mode);
  const owner = pageMode(page);
  if (owner && owner !== mode) return defaultPage(mode);
  if (page === 'multiplayer' && !terracotta) return 'settings';
  if (mode === 'developer' && ['discover', 'installed'].includes(page)) return 'projects';
  return page as WorkbenchPage;
}
