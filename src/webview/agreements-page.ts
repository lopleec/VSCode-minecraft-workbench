import { h } from './dom';
import legal from '../legal.json';
import type { ConsentStatus } from '../consent';
import { toTraditional } from '../traditional';

interface AgreementContext {
  locale: 'en' | 'zh-cn' | 'zh-tw';
  preference: 'auto' | 'en' | 'zh-cn' | 'zh-tw';
  status: ConsentStatus;
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  accept(): Promise<void>;
  back(): void;
  language(value: 'auto' | 'en' | 'zh-cn' | 'zh-tw'): Promise<void>;
}
export function renderAgreements(root: HTMLElement, ctx: AgreementContext) {
  const locale = ctx.locale === 'en' ? 'en' : ctx.locale === 'zh-tw' ? 'zh-tw' : 'zh-cn';
  const chinese = locale !== 'en';
  const L = (en: string, zh: string) =>
    !chinese ? en : locale === 'zh-tw' ? toTraditional(zh) : zh;
  const pick = (value: { en: string; zh: string }) =>
    !chinese ? value.en : locale === 'zh-tw' ? toTraditional(value.zh) : value.zh;
  document.documentElement.lang = locale === 'en' ? 'en' : locale === 'zh-tw' ? 'zh-TW' : 'zh-CN';
  const error = h('p', { role: 'alert', class: 'agreement-error' });
  const run = (task: () => Promise<unknown>) => {
    void task().catch((e) => {
      error.textContent = (e as Error).message;
    });
  };
  const link = (document: keyof typeof legal.links, label: string) =>
    h(
      'button',
      {
        type: 'button',
        class: 'text-button',
        onclick: () => run(() => ctx.request('consent.link', { document })),
      },
      label,
    );
  const page = h(
    'main',
    { class: 'agreements-page' },
    h(
      'div',
      { class: 'agreement-heading' },
      h(
        'h1',
        {},
        ctx.status.accepted
          ? L('Agreements & About', '协议与关于')
          : L('Welcome to Minecraft Workbench', '欢迎使用 Minecraft Workbench'),
      ),
      h(
        'label',
        { class: 'agreement-language' },
        h('span', {}, L('Language', '语言')),
        h(
          'select',
          {
            name: 'agreementLanguage',
            'aria-label': L('Language', '语言'),
            onchange: (event: Event) =>
              run(() =>
                ctx.language(
                  (event.target as HTMLSelectElement).value as AgreementContext['preference'],
                ),
              ),
          },
          ...(
            [
              ['auto', L('Follow extension language', '跟随插件语言')],
              ['en', 'English'],
              ['zh-cn', '简体中文'],
              ['zh-tw', '繁體中文'],
            ] as const
          ).map(([value, label]) =>
            h('option', { value, selected: ctx.preference === value }, label),
          ),
        ),
      ),
    ),
    h('p', { class: 'agreement-disclaimer' }, pick(legal.disclaimer)),
    h(
      'section',
      {},
      h('h2', {}, 'Minecraft EULA'),
      h(
        'p',
        {},
        L(
          'Read the current Minecraft EULA on the official website before using Minecraft. This confirmation does not replace the official terms. If you are a minor, review them with a parent or legal guardian.',
          '使用 Minecraft 前，请阅读官方网站上的现行 EULA。此处的确认不替代官方条款；未成年人请与父母或法定监护人一同阅读。',
        ),
      ),
      h(
        'div',
        { class: 'agreement-links' },
        link('eula', L('Read Minecraft EULA ↗', '阅读 Minecraft EULA ↗')),
        link('guidelines', L('Usage guidelines ↗', '使用指南 ↗')),
        link('microsoftServices', L('Microsoft Services Agreement ↗', 'Microsoft 服务协议 ↗')),
      ),
    ),
    h(
      'section',
      {},
      h('h2', {}, L('Workbench terms and notices', 'Workbench 用户协议与声明')),
      ...legal.sections.map((section) =>
        h(
          'section',
          { class: 'agreement-section' },
          h('h3', {}, pick(section.title)),
          ...section.paragraphs.map((p) => h('p', {}, pick(p))),
        ),
      ),
      h(
        'div',
        { class: 'agreement-links' },
        link('repository', L('GitHub source and builds ↗', 'GitHub 源码与构建 ↗')),
        link('license', 'MIT License ↗'),
        link('thirdParty', L('Third-party services & licenses ↗', '第三方服务与许可 ↗')),
        link('modPermissions', L('Modpack permissions ↗', '整合包内容授权 ↗')),
        link('modrinthTerms', L('Modrinth terms ↗', 'Modrinth 条款 ↗')),
      ),
    ),
    h(
      'p',
      { class: 'muted' },
      L(
        `Notice version: ${ctx.status.version}. Confirmation is saved locally in your VS Code profile.`,
        `提示版本：${ctx.status.version}。确认记录仅保存在本地 VS Code 配置中。`,
      ),
    ),
    error,
  );
  if (ctx.status.accepted) {
    page.append(
      h(
        'p',
        { class: 'muted' },
        L('Accepted on ', '确认时间：') +
          new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(ctx.status.acceptedAt!),
          ),
      ),
      h(
        'button',
        { type: 'button', class: 'primary', onclick: ctx.back },
        L('Back to instances', '返回实例'),
      ),
    );
  } else {
    const eula = h('input', { name: 'minecraftEula', type: 'checkbox', required: true });
    const terms = h('input', { name: 'workbenchTerms', type: 'checkbox', required: true });
    const accept = h(
      'button',
      { type: 'submit', class: 'primary', disabled: true },
      L('Accept and continue', '同意并继续'),
    );
    const update = () => {
      accept.disabled = !eula.checked || !terms.checked;
    };
    eula.addEventListener('change', update);
    terms.addEventListener('change', update);
    const form = h(
      'form',
      { class: 'agreement-confirmation' },
      h(
        'label',
        { class: 'check' },
        eula,
        h(
          'span',
          {},
          L('I have read and agree to the Minecraft EULA.', '已阅读并同意 Minecraft EULA。'),
        ),
      ),
      h(
        'label',
        { class: 'check' },
        terms,
        h(
          'span',
          {},
          L(
            'I have read and accept the Workbench terms and notices.',
            '已阅读并接受 Workbench 用户协议与声明。',
          ),
        ),
      ),
      h(
        'div',
        { class: 'inline-actions' },
        accept,
        h(
          'button',
          {
            type: 'button',
            class: 'secondary',
            onclick: () => run(() => ctx.request('consent.close')),
          },
          L('Not now', '暂不使用'),
        ),
      ),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!eula.checked || !terms.checked || accept.disabled) return;
      accept.disabled = true;
      eula.disabled = terms.disabled = true;
      run(async () => {
        try {
          await ctx.accept();
        } finally {
          eula.disabled = terms.disabled = false;
          update();
        }
      });
    };
    page.append(form);
  }
  root.replaceChildren(page);
}
