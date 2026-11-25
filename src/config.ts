import * as vscode from 'vscode';
import { localize, resolveLanguage } from './language';
export const config = <T>(key: string, fallback: T): T =>
  vscode.workspace.getConfiguration('minecraftWorkbench').get<T>(key, fallback);
export function t(en: string, zh: string, zhTw: string = zh): string {
  return localize(language(), en, zh, zhTw);
}
export function language() {
  return resolveLanguage(config<string>('language', 'auto'), vscode.env.language);
}
export async function trusted(): Promise<void> {
  if (!vscode.workspace.isTrusted)
    throw new Error(
      t(
        'Trust this workspace before running Minecraft or Gradle.',
        '请先信任工作区，再运行 Minecraft 或 Gradle。',
        '請先信任工作區，再執行 Minecraft 或 Gradle。',
      ),
    );
}

export async function setLanguage(value: unknown): Promise<void> {
  if (typeof value !== 'string' || !['auto', 'en', 'zh-cn', 'zh-tw'].includes(value))
    throw new Error('Invalid language');
  const settings = vscode.workspace.getConfiguration('minecraftWorkbench');
  await settings.update('language', value, vscode.ConfigurationTarget.Global);
  if (settings.inspect('language')?.workspaceValue !== undefined)
    await settings.update('language', undefined, vscode.ConfigurationTarget.Workspace);
}
