// What a React app needs to sit in the suite: the top bar with the app's own
// mark and name (from the mount it runs as), the switcher, the connection
// pill and the account button; the language question for browsers in
// another language; the footer back to the hub; and the settings page every
// app has (identity, the app's own cards, "How it works"); notices about
// friend requests and shares come with the shell.
//
//   <AppShell footer={t('app.footer')}>…the page…</AppShell>
//   <AppSettings title=… backLabel=… how={['myapp.how.1', 'relays']}>…cards…</AppSettings>
import type { ReactNode } from 'react';
import { useState } from 'react';
import { npub } from '../shared/account.js';
import { appById, mountById } from '../shared/apps.js';
import { DISTRIBUTION } from '../shared/distribution.js';
import { fingerprint } from '../shared/events.js';
import { currentLanguage, LANGUAGES, shouldAskLanguage } from '../shared/i18n.js';
import { AccountLink, Icon, StatusPill, Toasts, TopBar } from './components';
import { useIdentity, useKiwi, useKiwiTick, useT } from './hooks';
import { usePeopleNotices } from './notices';
import { HowItWorks } from './widgets/HowItWorks';

/** Asked once, in the browser's own language, when it is not English; nothing at all otherwise. */
export function LanguageBanner() {
  const kiwi = useKiwi();
  const t = useT();
  useKiwiTick();
  const [pick, setPick] = useState(currentLanguage());
  if (!shouldAskLanguage()) return null;
  return (
    <div id="langBanner">
      <div className="banner lang-banner">
        <Icon name="languages" />
        <p>{t('lang.prompt')}</p>
        <div className="lang-pick">
          <select id="langPick" aria-label={t('lang.title')} value={pick} onChange={(e) => setPick(e.target.value)}>
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-primary btn-sm" id="langOk" onClick={() => kiwi.chooseLanguage(pick)}>
            {t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The mount this page runs as (its name and icon), or the app itself. */
export function useMount(): { id: string; name: string; icon: string } {
  const kiwi = useKiwi();
  const m = mountById(kiwi.current) || appById(kiwi.current);
  return { id: kiwi.current, name: m?.name || kiwi.current, icon: m?.icon || 'layout-grid' };
}

export interface AppShellProps {
  children: ReactNode;
  /** trusted markup after the hub's name in the footer (the app's catalog) */
  footer?: string;
  /** where the brand goes: the app's start */
  home?: string;
  /** the brand's accessible name, e.g. "Loadout home" */
  homeLabel?: string;
  /** the app's own settings; null: the app has none (no account button) */
  settings?: string | null;
  /** the right of the top bar instead of the connection pill and the account button */
  right?: ReactNode;
}

export function AppShell({ children, footer = '', home = '#/', homeLabel, settings = '#/settings', right }: AppShellProps) {
  const kiwi = useKiwi();
  const mount = useMount();
  useKiwiTick();
  usePeopleNotices();
  const mark = (
    <span className="wjs-app-mark" aria-hidden="true">
      <Icon name={mount.icon} />
    </span>
  );
  return (
    <>
      <TopBar
        brand={{ href: home, name: mount.name, label: homeLabel || mount.name, mark }}
        right={
          right ?? (
            <>
              <StatusPill href={`${kiwi.base}settings.html#relays`} />
              {settings ? <AccountLink href={settings} /> : null}
            </>
          )
        }
      />
      <LanguageBanner />
      <main id="view" className="view" tabIndex={-1}>
        {children}
      </main>
      <footer className="foot">
        <a href={kiwi.base}>{DISTRIBUTION.name}</a>
        {footer ? ' · ' : ''}
        {footer ? <span dangerouslySetInnerHTML={{ __html: footer }} /> : null}
      </footer>
      <Toasts />
    </>
  );
}

export interface AppSettingsProps {
  title: string;
  children?: ReactNode;
  back?: string;
  backLabel?: string;
  /** "How it works": topics (shared/how.js) and the app's own keys */
  how?: readonly string[];
}

/** Every app's settings page: back and title, who you are and where the site settings are, the app's cards, "How it works" last. */
export function AppSettings({ title, children, back = '#/', backLabel, how = [] }: AppSettingsProps) {
  const kiwi = useKiwi();
  const t = useT();
  const id = useIdentity();
  return (
    <section className="wjs-settings">
      <div className="page-head">
        <a className="icon-btn back" href={back} aria-label={backLabel || t('common.back')}>
          <Icon name="chevron-left" />
        </a>
        <h1>{title}</h1>
      </div>
      <div className="card">
        <h2>
          <Icon name="key-round" />
          {t('account.identity')}
        </h2>
        <p>
          {id.alias ? <span dangerouslySetInnerHTML={{ __html: t('app.settings.signedIn', { alias: escapeHtml(id.alias) }) }} /> : t('app.settings.deviceKey')}{' '}
          <code title={npub(id.pk)}>{fingerprint(id.pk)}</code>
        </p>
        <p className="muted small">{t('app.settings.siteHint')}</p>
        <a className="btn btn-primary" href={`${kiwi.base}settings.html#account`}>
          <Icon name="settings" />
          <span>{t('app.settings.openSite')}</span>
        </a>
      </div>
      {children}
      {how.length ? <HowItWorks items={how} /> : null}
    </section>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
