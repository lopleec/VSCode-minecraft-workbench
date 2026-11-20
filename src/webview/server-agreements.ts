import { h } from './dom';
import { localize, type LanguagePreference } from '../language';
import type { ServerProfile } from '../models';
import type { PageContext } from './page-ui';
import legal from '../legal.json';
import { select, field } from './page-ui';

export function renderServerAgreements(
  body: HTMLElement,
  ctx: PageContext,
  server: ServerProfile,
  accepted: () => void,
) {
  const container = h('section');
  body.append(container);
  let preference: LanguagePreference = 'auto';
  function render() {
    container.replaceChildren();
    const locale = preference === 'auto' ? ctx.state().locale : preference;
    const L = (en: string, zh: string, zhTw?: string) => localize(locale, en, zh, zhTw);
    const language = select('serverAgreementLanguage', preference, [
      ['auto', L('Follow extension language', '跟随插件语言', '跟隨擴充套件語言')],
      ['en', 'English'],
      ['zh-cn', '简体中文'],
      ['zh-tw', '繁體中文'],
    ]);
    language.onchange = () => {
      preference = language.value as LanguagePreference;
      render();
    };
    container.append(field(L('Language', '语言', '語言'), language));
    container.append(
      h(
        'h2',
        {},
        server.engine === 'velocity'
          ? L('Software licenses', '软件许可', '軟體授權')
          : 'Minecraft EULA',
      ),
    );
    container.append(
      h('p', {}, L(legal.disclaimer.en, legal.disclaimer.zh, legal.disclaimer.zhTw)),
    );
    container.append(
      h(
        'div',
        { class: 'inline-actions page-actions' },
        ...(['eula', 'microsoftServices', 'guidelines', 'thirdParty'] as const).map((document) =>
          ctx.button(
            document === 'eula'
              ? 'Minecraft EULA ↗'
              : document === 'microsoftServices'
                ? L(
                    'Microsoft Services Agreement ↗',
                    'Microsoft 服务协议 ↗',
                    'Microsoft 服務協議 ↗',
                  )
                : document === 'guidelines'
                  ? L('Usage Guidelines ↗', '使用指南 ↗', '使用指南 ↗')
                  : L('Third-party licenses ↗', '第三方许可 ↗', '第三方授權 ↗'),
            () => ctx.request('consent.link', { document }),
            'text-button',
          ),
        ),
      ),
    );
    if (server.engine === 'velocity') return;
    if (server.eulaAccepted) {
      container.append(
        h(
          'p',
          {},
          L('EULA accepted for this server.', '已为此服务端确认 EULA。', '已為此伺服器確認 EULA。'),
        ),
      );
      return;
    }
    const check = h('input', { type: 'checkbox' });
    const confirm = ctx.button(
      L('Accept EULA', '确认 EULA', '確認 EULA'),
      async () => {
        confirm.disabled = true;
        try {
          await ctx.request('server.acceptEula', { serverId: server.id, accepted: check.checked });
          await ctx.refresh();
          accepted();
        } finally {
          if (confirm.isConnected) confirm.disabled = !check.checked;
        }
      },
      'primary',
      true,
    );
    check.onchange = () => {
      confirm.disabled = !check.checked;
    };
    container.append(
      h(
        'label',
        { class: 'check' },
        check,
        L(
          'I have read and agree to the Minecraft EULA for running this server.',
          '我已阅读并同意运行此服务端所适用的 Minecraft EULA。',
          '我已閱讀並同意執行此伺服器所適用的 Minecraft EULA。',
        ),
      ),
      h('div', { class: 'inline-actions page-actions' }, confirm),
    );
  }
  render();
}
