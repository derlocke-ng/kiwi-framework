// The settings view every app has, behind the account button in its top
// bar: a back button and title, the identity card (who you are, where the
// site settings are), the app's own cards, and "How it works" last. Account,
// relays, language, appearance, backup and blocked people live in the site
// settings, so an app only passes what is its own.
//
//   main.innerHTML = settingsView({ identity, title, cards: [cardMarkup], how: howLines(['myapp.how.1', 'relays']) });
//
// `how` takes translated lines; howLines() in how.js makes them from topics and the app's own keys.
import { t } from './i18n.js';
import { icon, h } from './ui.js';
import { fingerprint } from './events.js';
import { npub } from './account.js';

export function settingsView({ identity, title, back = '#/', backLabel = null, site = '../settings.html#account', cards = [], how = [] }) {
  const { alias } = identity;
  return `
    <section class="wjs-settings">
      <div class="page-head">
        <a class="icon-btn back" href="${h(back)}" aria-label="${h(backLabel || t('common.back'))}">${icon('chevron-left')}</a>
        <h1>${h(title)}</h1>
      </div>
      <div class="card">
        <h2>${icon('key-round')}${h(t('account.identity'))}</h2>
        <p>${alias ? t('app.settings.signedIn', { alias: h(alias) }) : h(t('app.settings.deviceKey'))} <code title="${h(npub(identity.pk))}">${h(fingerprint(identity.pk))}</code></p>
        <p class="muted small">${h(t('app.settings.siteHint'))}</p>
        <a class="btn btn-primary" href="${h(site)}">${icon('settings')}<span>${h(t('app.settings.openSite'))}</span></a>
      </div>
      ${cards.join('\n')}
      ${how.length ? `<details class="card how" id="how"><summary><h2>${icon('shield')}${h(t('how.title'))}</h2></summary><ul>${how.map((x) => `<li>${x}</li>`).join('')}</ul></details>` : ''}
    </section>`;
}
