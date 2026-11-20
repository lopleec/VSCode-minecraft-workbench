export type Language = 'en' | 'zh-cn' | 'zh-tw';
export type LanguagePreference = 'auto' | Language;

export function resolveLanguage(preference: string, environment: string): Language {
  const locale = (preference === 'auto' ? environment : preference).toLowerCase();
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(locale)) return 'zh-tw';
  return locale.startsWith('zh') ? 'zh-cn' : 'en';
}

export function localize(locale: Language, en: string, zh: string, zhTw = zh): string {
  return locale === 'zh-tw' ? zhTw : locale === 'zh-cn' ? zh : en;
}
