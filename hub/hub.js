// The start page: the apps, your account, the relays. Shared machinery in shell.js.

import { t, LANGUAGES, currentLanguage, shouldAskLanguage } from './shared/i18n.js';
import { savedRelays } from './shared/relays.js';
import { loadIdentity } from './shared/account.js';
import { bootShell, net, onLanguage, onSuite, chooseLanguage, hiddenApps, $, h, icon } from './shell.js';
import { mountTopbar, accountLink } from './shared/topbar.js';
import { statusPill, mountStatus } from './shared/status.js';
import { MOUNTS } from './shared/apps.js';
import { DISTRIBUTION } from './shared/distribution.js';

const infos = new Map();

function languageBanner() {
  const banner = $('#langBanner');
  if (!shouldAskLanguage()) return (banner.innerHTML = '');
  const options = Object.entries(LANGUAGES)
    .map(([code, name]) => `<option value="${code}" ${code === currentLanguage() ? 'selected' : ''}>${h(name)}</option>`)
    .join('');
  banner.innerHTML = `<div class="banner lang-banner">${icon('languages')}<p>${h(t('lang.prompt'))}</p><div class="lang-pick"><select id="langPick" aria-label="${h(t('lang.title'))}">${options}</select><button type="button" class="btn btn-primary btn-sm" id="langOk">${h(t('common.ok'))}</button></div></div>`;
  $('#langOk').addEventListener('click', () => chooseLanguage($('#langPick').value));
}

function drawHeader() {
  const id = loadIdentity();
  mountTopbar($('#top'), {
    base: './',
    current: 'hub',
    hidden: hiddenApps,
    brand: { href: './', html: DISTRIBUTION.brandHtml, label: DISTRIBUTION.name },
    right: statusPill() + accountLink({ href: 'settings.html#account', identity: id, label: t('hub.signIn') }),
  });
  $('#accountCta').hidden = Boolean(id.alias);
  mountStatus($('#sync'), net);
}

/** The cards are the distribution's mounts (shared/distribution.js): apps on spaces, with their names, icons, tags and flags. */
function drawApps() {
  const hidden = hiddenApps();
  const feature = MOUNTS.find((a) => a.featured);
  const tools = MOUNTS.filter((a) => a !== feature);
  const tags = (a) => `<ul class="tags">${a.tags.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
  const badge = (a) => (a.isNew ? ` <span class="badge">${h(t('hub.new'))}</span>` : '') + (a.legacy ? ` <small class="legacy">${h(t('hub.legacy'))}</small>` : '');
  $('#apps').innerHTML = `
    ${
      feature
        ? `<a class="feature" href="${feature.id}/" data-app="${feature.id}" ${hidden.includes(feature.id) ? 'hidden' : ''}>
      <div class="feature-icon">${icon(feature.icon)}</div>
      <div class="feature-body">${feature.isNew ? `<span class="badge">${h(t('hub.new'))}</span>` : ''}<h2>${h(feature.name)}</h2><p>${h(t(`hub.${feature.id}.text`))}</p>${tags(feature)}</div>
      <span class="go">${icon('arrow-up-right')}</span>
    </a>`
        : ''
    }
    <ul class="tools">${tools
      .map(
        (a) => `<li data-app="${a.id}" ${hidden.includes(a.id) ? 'hidden' : ''}><a class="tool" href="${a.id}/"><span class="tool-icon">${icon(a.icon)}</span><h3>${h(a.name)}${badge(a)}</h3><p>${h(t(`hub.${a.id}.text`))}</p>${tags(a)}</a></li>`,
      )
      .join('')}</ul>`;
}

function drawRelays() {
  const status = net.pool.status().relays;
  $('#relayList').innerHTML = savedRelays()
    .map((url) => {
      const r = status.find((x) => x.url === url);
      const info = infos.get(url);
      const state = r?.open ? (r.latency != null ? t('relay.latency', { n: r.latency }) : t('relay.connected')) : t('relay.notConnected');
      const detail = [info?.countries?.join(', '), info?.name, r?.publishError ? t('relay.rejected', { error: r.publishError, when: '' }).trim() : ''].filter(Boolean).join(' · ');
      return `<li class="${r?.open ? 'up' : 'down'}"><span class="dot"></span><span class="relay-name">${h(url.replace(/^wss?:\/\//, ''))}${detail ? ` <span class="relay-detail">${h(detail)}</span>` : ''}</span><span class="relay-state">${h(state)}</span></li>`;
    })
    .join('');
}

async function boot() {
  await bootShell();
  languageBanner();
  drawHeader();
  drawApps();
  drawRelays();
  net.pool.onStatus(drawRelays);
  for (const url of savedRelays()) {
    net.pool.info(url).then((info) => {
      if (info) {
        infos.set(url, info);
        drawRelays();
      }
    });
  }
  onLanguage(() => {
    languageBanner();
    drawHeader();
    drawApps();
    drawRelays();
  });
  onSuite(drawApps);
  addEventListener('storage', (e) => e.key === 'wjs.identity' && drawHeader());
}

boot().catch((err) => {
  console.error(err);
  document.documentElement.classList.add('i18n');
});
