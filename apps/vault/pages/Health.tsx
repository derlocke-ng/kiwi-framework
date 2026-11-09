// The vault's health: passwords that are weak, used for more than one entry,
// or not changed for a year, and certificates that run out within a month,
// worked out on the device; and, only when the
// person turned it on in the settings, passwords found in known breaches (Have
// I Been Pwned's range search: five hex characters of each hash leave, data/breach.js).
import { useMemo, useState } from 'react';
import { Icon } from '../../../ui/components';
import { useT } from '../../../ui/hooks';
import { toastError } from '../../../ui/toast';
import { useVault, type VaultItem } from '../../../ui/vault/VaultProvider';
import { pwnedCount } from '../data/breach.js';
import { strength } from '../data/strength.js';
import { PageHead } from './Generator';

const YEAR = 365 * 24 * 3600 * 1000;

function Section({ id, icon, title, items, note }: { id: string; icon: string; title: string; items: VaultItem[]; note?: (i: VaultItem) => string }) {
  const t = useT();
  return (
    <div className="card" id={id}>
      <h2>
        <Icon name={icon} />
        {title} <span className="count">{items.length}</span>
      </h2>
      {items.length ? (
        <ul className="pw-health-list">
          {items.map((i) => (
            <li key={i.id} data-entry={i.name}>
              <a href={`#/e/${encodeURIComponent(i.id)}`}>{i.name || t('pw.unnamed')}</a>
              {note ? <span className="muted small"> · {note(i)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{t('pw.health.none')}</p>
      )}
    </div>
  );
}

export function Health() {
  const t = useT();
  const vault = useVault();
  const logins = useMemo(() => vault.items.filter((i) => i.password), [vault.items]);
  const weak = useMemo(() => logins.filter((i) => strength(i.password).level <= 1), [logins]);
  const reused = useMemo(() => {
    const by = new Map<string, VaultItem[]>();
    for (const i of logins) by.set(i.password, [...(by.get(i.password) || []), i]);
    return logins.filter((i) => (by.get(i.password)?.length || 0) > 1);
  }, [logins]);
  const old = useMemo(() => logins.filter((i) => i.changed && Date.now() - i.changed > YEAR), [logins]);
  // certificates and CAs that run out within a month (or have): renew them before a browser says no
  const expiring = useMemo(
    () =>
      vault.items.filter((i) => i.pki?.notAfter && i.pki.notAfter - Date.now() < 30 * 86400e3).sort((a, b) => (a.pki?.notAfter || 0) - (b.pki?.notAfter || 0)),
    [vault.items],
  );
  const allowed = Boolean(vault.prefs.get('breachCheck', false));
  const [breached, setBreached] = useState<{ item: VaultItem; count: number }[] | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const check = async () => {
    setChecking(0);
    const found: { item: VaultItem; count: number }[] = [];
    try {
      for (const [n, item] of logins.entries()) {
        const count = await pwnedCount(item.password);
        if (count) found.push({ item, count });
        setChecking(n + 1);
      }
      setBreached(found);
    } catch (err) {
      toastError(err);
    }
    setChecking(null);
  };
  return (
    <section className="pw-subpage" id="health">
      <PageHead title={t('pw.health')} />
      <p className="muted">{t('pw.health.intro', { n: logins.length })}</p>
      <Section id="weak" icon="triangle-alert" title={t('pw.health.weak')} items={weak} />
      <Section id="reused" icon="copy" title={t('pw.health.reused')} items={reused} />
      <Section id="old" icon="history" title={t('pw.health.old')} items={old} note={(i) => new Date(i.changed).toLocaleDateString()} />
      <Section
        id="expiring"
        icon="refresh-cw"
        title={t('pw.health.expiring')}
        items={expiring}
        note={(i) =>
          (i.pki?.notAfter || 0) < Date.now() ? t('pw.health.expired') : t('pw.keys.until', { date: new Date(i.pki?.notAfter || 0).toLocaleDateString() })
        }
      />
      <div className="card" id="breaches">
        <h2>
          <Icon name="shield-alert" />
          {t('pw.health.breached')} {breached ? <span className="count">{breached.length}</span> : null}
        </h2>
        {!allowed ? (
          <p className="muted small" id="breachOff">
            {t('pw.health.breachOff')} <a href="#/settings">{t('pw.health.toSettings')}</a>
          </p>
        ) : (
          <>
            <p className="muted small">{t('pw.health.breachText')}</p>
            {breached ? (
              breached.length ? (
                <ul className="pw-health-list">
                  {breached.map(({ item, count }) => (
                    <li key={item.id} data-entry={item.name}>
                      <a href={`#/e/${encodeURIComponent(item.id)}`}>{item.name || t('pw.unnamed')}</a>
                      <span className="muted small"> · {t('pw.health.seen', { n: count })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p id="noBreaches">{t('pw.health.noBreaches')}</p>
              )
            ) : null}
            <button type="button" className="btn btn-primary" id="checkBreaches" disabled={checking !== null || !logins.length} onClick={() => void check()}>
              <Icon name="shield-check" />
              <span>{checking !== null ? t('pw.health.checking', { n: checking, total: logins.length }) : t('pw.health.check', { n: logins.length })}</span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
