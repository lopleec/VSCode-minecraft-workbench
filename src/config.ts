import * as vscode from 'vscode';
import { Locale, toTraditional } from './traditional';
export const config = <T>(key: string, fallback: T): T =>
  vscode.workspace.getConfiguration('minecraftWorkbench').get<T>(key, fallback);
export function locale(): Locale {
  const value = config<string>('language', 'auto');
  if (value === 'zh-cn' || value === 'zh-tw') return value;
  const language = vscode.env.language.toLowerCase();
  if (
    language.startsWith('zh-tw') ||
    language.startsWith('zh-hk') ||
    language.startsWith('zh-hant')
  )
    return 'zh-tw';
  if (language.startsWith('zh')) return 'zh-cn';
  return 'en';
}
export function t(en: string, zh: string): string {
  const current = locale();
  return current === 'en' ? en : current === 'zh-tw' ? toTraditional(zh) : zh;
}
export async function trusted(): Promise<void> {
  if (!vscode.workspace.isTrusted)
    throw new Error(
      t(
        'Trust this workspace before running Minecraft or Gradle.',
        '请先信任工作区，再运行 Minecraft 或 Gradle。',
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
