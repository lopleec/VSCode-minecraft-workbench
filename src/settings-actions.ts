import * as vscode from 'vscode';
import manifest from '../package.json';
import { redact } from './files';
import english from '../package.nls.json';
import chinese from '../package.nls.zh-cn.json';
import { setLanguage, t } from './config';

interface SettingSchema {
  type: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  description?: string;
  markdownDescription?: string;
  items?: SettingSchema;
  properties?: Record<string, SettingSchema>;
  additionalProperties?: boolean;
}
function validate(value: unknown, schema: SettingSchema): void {
  const type = Array.isArray(value) ? 'array' : typeof value;
  if (
    value === null ||
    (schema.type === 'integer' ? !Number.isInteger(value) : schema.type !== type) ||
    (schema.enum && !schema.enum.includes(value)) ||
    (typeof value === 'string' && value.includes('\0')) ||
    (typeof value === 'number' &&
      (!Number.isFinite(value) ||
        (schema.minimum !== undefined && value < schema.minimum) ||
        (schema.maximum !== undefined && value > schema.maximum)))
  )
    throw new Error('Invalid setting value');
  if (Array.isArray(value) && schema.items) for (const item of value) validate(item, schema.items);
  if (type === 'object')
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key))
        throw new Error('Unknown setting property');
      if (schema.properties?.[key]) validate(item, schema.properties[key]);
    }
}
function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.username || url.password)
        return `${url.protocol}//[redacted]@${url.host}${url.pathname}${url.search}${url.hash}`;
    } catch {
      // Most setting strings are not URLs.
    }
    return redact(value);
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  return value;
}

export async function settingsAction(method: string, params: Record<string, unknown>) {
  const definitions = Object.assign(
    {},
    ...manifest.contributes.configuration.map((group) => group.properties),
  ) as Record<string, SettingSchema>;
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
            value: redactValue(value),
          },
        ];
      }),
    );
  if (method !== 'settings.update') throw new Error('Unknown settings request');
  const key = String(params.key || '');
  const schema = definitions['minecraftWorkbench.' + key];
  if (!schema) throw new Error('Unknown setting');
  const value = params.value;
  validate(value, schema);
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
  if (key === 'language') await setLanguage(value);
  else await settings.update(key, value, vscode.ConfigurationTarget.Global);
  return true;
}
