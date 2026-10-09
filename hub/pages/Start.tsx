import { useState } from 'react';
import { DISTRIBUTION } from '../../shared/distribution.js';
import { currentLanguage, LANGUAGES, shouldAskLanguage } from '../../shared/i18n.js';
import { AccountLink, Icon, RelayList, StatusPill, Toasts, TopBar } from '../../ui/components';
import { useIdentity, useKiwi, useKiwiTick, useT } from '../../ui/hooks';
import { usePeopleNotices } from '../../ui/notices';

function LanguageBanner() {
  const kiwi = useKiwi();
  const t = useT();
  const [pick, setPick] = useState(currentLanguage());
  if (!shouldAskLanguage()) return <div id="langBanner" />;
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

const Tags = ({ tags }: { tags: string[] }) => (
  <ul className="tags">
    {tags.map((x) => (
      <li key={x}>{x}</li>
    ))}
  </ul>
);

/** The cards are the distribution's mounts (apps on spaces) in the person's order; the first one shown is the large card. */
function Apps() {
  const kiwi = useKiwi();
  const t = useT();
  useKiwiTick();
  const hidden = kiwi.hiddenApps();
  const ordered = kiwi.orderedApps();
  const feature = ordered.find((a) => !hidden.includes(a.id));
  const tools = ordered.filter((a) => a !== feature);
  return (
    <div id="apps" className="apps">
      {feature ? (
        <a className="feature" href={`${feature.id}/`} data-app={feature.id}>
          <div className="feature-icon">
            <Icon name={feature.icon} />
          </div>
          <div className="feature-body">
            {feature.isNew ? <span className="badge">{t('hub.new')}</span> : null}
            <h2>{feature.name}</h2>
            <p>{t(`hub.${feature.id}.text`)}</p>
            <Tags tags={feature.tags} />
          </div>
          <span className="go">
            <Icon name="arrow-up-right" />
          </span>
        </a>
      ) : null}
      <ul className="tools">
        {tools.map((a) => (
          <li key={a.id} data-app={a.id} hidden={hidden.includes(a.id)}>
            <a className="tool" href={`${a.id}/`}>
              <span className="tool-icon">
                <Icon name={a.icon} />
              </span>
              <h3>
                {a.name}
                {a.isNew ? (
                  <>
                    {' '}
                    <span className="badge">{t('hub.new')}</span>
                  </>
                ) : null}
                {a.legacy ? (
                  <>
                    {' '}
                    <small className="legacy">{t('hub.legacy')}</small>
                  </>
                ) : null}
              </h3>
              <p>{t(`hub.${a.id}.text`)}</p>
              <Tags tags={a.tags} />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Start() {
  const t = useT();
  const identity = useIdentity();
  usePeopleNotices();
  return (
    <>
      <TopBar
        brand={{ href: './', html: DISTRIBUTION.brandHtml, label: DISTRIBUTION.name }}
        right={
          <>
            <StatusPill href="settings.html#relays" />
            <AccountLink href="settings.html#account" label={t('hub.signIn')} />
          </>
        }
      />
      <LanguageBanner />
      <main>
        <section className="hero">
          <h1 dangerouslySetInnerHTML={{ __html: t('hub.title') }} />
          <p>{t('hub.lead')}</p>
        </section>
        <div className="banner" id="accountCta" hidden={Boolean(identity.alias)}>
          <Icon name="shield" />
          <p dangerouslySetInnerHTML={{ __html: t('hub.cta') }} />
        </div>
        <Apps />
        <section className="relays" aria-labelledby="relaysTitle">
          <h2 id="relaysTitle">
            <Icon name="radio-tower" />
            <span>{t('hub.relays')}</span>
          </h2>
          <p>{t('hub.relaysText')}</p>
          <RelayList />
        </section>
      </main>
      <footer className="foot">
        <p dangerouslySetInnerHTML={{ __html: t('hub.footer') }} />
        <p className="foot-links">
          <a href="settings.html">{t('hub.settings')}</a> ·{' '}
          <a href={DISTRIBUTION.repo || DISTRIBUTION.homepage || './'} rel="noopener">
            {t('hub.source')}
          </a>
        </p>
      </footer>
      <Toasts />
    </>
  );
}
