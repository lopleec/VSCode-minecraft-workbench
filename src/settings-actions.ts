import * as vscode from 'vscode';
import manifest from '../package.json';
import { redact } from './files';
import english from '../package.nls.json';
import chinese from '../package.nls.zh-cn.json';
import { t } from './config';

export async function settingsAction(method: string, params: Record<string, unknown>) {
  const definitions = Object.assign(
    {},
    ...manifest.contributes.configuration.map((group) => group.properties),
  ) as Record<
    string,
    {
      type: string;
      default?: unknown;
      enum?: unknown[];
      minimum?: number;
      maximum?: number;
      description?: string;
      markdownDescription?: string;
    }
  >;
  const settings = vscode.workspace.getConfiguration('minecraftWorkbench');
  if (method === 'settings.read')
    return Object.fromEntries(
      Object.entries(definitions).map(([full, schema]) => {
        const key = full.replace(/^minecraftWorkbench\./, '');
        const value = settings.get(key, schema.default);
        const dictionary = t('en', 'zh-cn') === 'en' ? english : chinese;
        const description = schema.markdownDescription || schema.description || '';
        const resolved = description.replace(
          /^%(.+)%$/,
          (_match, id: string) => (dictionary as Record<string, string>)[id] || id,
        );
        return [
          key,
          {
            ...schema,
            description: resolved,
            value: typeof value === 'string' ? redact(value) : value,
          },
        ];
      }),
    );
  const key = String(params.key || '');
  const schema = definitions['minecraftWorkbench.' + key];
  if (!schema) throw new Error('Unknown setting');
  const value = params.value;
  const type = Array.isArray(value) ? 'array' : typeof value;
  if (
    (schema.type === 'integer' ? !Number.isInteger(value) : schema.type !== type) ||
    (schema.enum && !schema.enum.includes(value)) ||
    (typeof value === 'number' &&
      ((schema.minimum !== undefined && value < schema.minimum) ||
        (schema.maximum !== undefined && value > schema.maximum)))
  )
    throw new Error('Invalid setting value');
  if (key === 'sources') {
    if (!value || Array.isArray(value)) throw new Error('Invalid sources');
    for (const source of Object.values(value as Record<string, unknown>)) {
      if (
        typeof source !== 'string' ||
        (!['official', 'bmclapi'].includes(source) && new URL(source).protocol !== 'https:')
      )
        throw new Error('Invalid source URL');
    }
  }
  if (key === 'proxy' && value) {
    const url = new URL(String(value));
    if (!['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(url.protocol))
      throw new Error('Invalid proxy URL');
  }
  await settings.update(key, value, vscode.ConfigurationTarget.Global);
  return true;
}
