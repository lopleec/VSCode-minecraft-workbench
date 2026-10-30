import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { config } from './config';
import { Instance } from './models';
import { readJson, rejectSymlinkParents, writeJson, writeText } from './files';

export function minecraftLanguage(locale: string): string {
  const normalized = locale.toLowerCase().replaceAll('-', '_');
  if (normalized === 'zh_tw' || normalized === 'zh_hant') return 'zh_tw';
  if (normalized === 'zh_hk') return 'zh_hk';
  if (normalized.startsWith('zh')) return 'zh_cn';
  const languages: Record<string, string> = {
    en: 'en_us',
    de: 'de_de',
    fr: 'fr_fr',
    es: 'es_es',
    ja: 'ja_jp',
    ko: 'ko_kr',
    ru: 'ru_ru',
    pt: 'pt_br',
    it: 'it_it',
    pl: 'pl_pl',
    tr: 'tr_tr',
    cs: 'cs_cz',
    uk: 'uk_ua',
  };
  if (/^[a-z]{2,3}_[a-z]{2,3}$/.test(normalized)) return normalized;
  return languages[normalized] || languages[normalized.split('_')[0]] || 'en_us';
}
export function validGameLanguage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    (['auto', 'preserve'].includes(value) || /^[a-z0-9]{2,8}_[a-z0-9]{2,8}$/.test(value))
  );
}
export async function prepareGameLanguage(instance: Instance): Promise<void> {
  const preference = instance.gameLanguage || config('gameLanguage', 'auto');
  if (!validGameLanguage(preference)) throw new Error('Invalid Minecraft language.');
  if (preference === 'preserve') return;
  const extension = config('language', 'auto');
  let language =
    preference === 'auto'
      ? minecraftLanguage(extension === 'auto' ? vscode.env.language : extension)
      : preference;
  const legacy = /^1\.(\d+)(?:\.|$)/.exec(instance.minecraft);
  if (legacy && Number(legacy[1]) < 11)
    language = language.replace(/_([a-z]+)$/, (_, region: string) => '_' + region.toUpperCase());
  const options = path.join(instance.directory, 'options.txt');
  const marker = path.join(instance.directory, '.workbench', 'language.json');
  await rejectSymlinkParents(instance.directory, options);
  await rejectSymlinkParents(instance.directory, marker);
  const previous = await fs.readFile(options, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const current = /^lang:([^\r\n]*)/m.exec(previous)?.[1];
  const managed = await readJson<{ language?: string }>(marker, {});
  if (preference === 'auto' && current && current !== managed.language) return;
  if (current === language) return;
  const newline = previous.includes('\r\n') ? '\r\n' : '\n';
  const updated =
    current !== undefined
      ? previous.replace(/^lang:[^\r\n]*/m, `lang:${language}`)
      : previous +
        (previous && !previous.endsWith('\n') ? newline : '') +
        `lang:${language}${newline}`;
  await writeText(options, updated);
  await writeJson(marker, { language });
}
