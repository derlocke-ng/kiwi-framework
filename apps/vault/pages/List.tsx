// The vault's entries: a search over names, logins, sites, notes and tags; a
// filter by kind; each entry with its name, the line under it and a button that
// copies its password (or its 2FA code) without opening it. The bar leads to
// the generator and the health report and locks the vault; the round button
// makes a new entry of the kind chosen.
import { useMemo, useState } from 'react';
import { Icon } from '../../../ui/components';
import { openMenu } from '../../../ui/dialogs';
import { useT } from '../../../ui/hooks';
import { useVault, type VaultItem } from '../../../ui/vault/VaultProvider';
import { CodeLine, copySecret, NEW_TYPES, subtitle, TYPE_ICON } from './common';

const FILTERS = ['all', 'login', 'totp', 'note', 'card'];

const matches = (item: VaultItem, q: string) =>
  [item.name, item.username, ...item.urls, item.notes, ...item.tags, item.card?.holder || ''].some((s) => s.toLowerCase().includes(q));

export function List() {
  const t = useT();
  const vault = useVault();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vault.items.filter((i) => (filter === 'all' || i.type === filter || (filter === 'totp' && i.totp)) && (!q || matches(i, q)));
  }, [vault.items, query, filter]);
  const newMenu = (anchor: HTMLElement) =>
    openMenu(
      anchor,
      NEW_TYPES.map((type) => ({ label: t(`pw.type.${type}`), icon: TYPE_ICON[type], act: `new-${type}`, run: () => (location.hash = `#/new/${type}`) })),
    );
  return (
    <div className="pw-page">
      <div className="app-bar">
        <input
          className="search"
          type="search"
          id="search"
          placeholder={t('pw.search')}
          aria-label={t('pw.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <a className="icon-btn" href="#/generate" id="toGenerator" aria-label={t('pw.generator')} title={t('pw.generator')}>
          <Icon name="wand-sparkles" />
        </a>
        <a className="icon-btn" href="#/health" id="toHealth" aria-label={t('pw.health')} title={t('pw.health')}>
          <Icon name="heart-pulse" />
        </a>
        <button type="button" className="icon-btn" id="lockBtn" aria-label={t('vault.lock')} title={t('vault.lock')} onClick={() => vault.lock()}>
          <Icon name="lock" />
        </button>
        <button type="button" className="btn btn-primary fab" id="newBtn" onClick={(e) => newMenu(e.currentTarget)}>
          <Icon name="plus" />
          <span>{t('pw.new')}</span>
        </button>
      </div>
      <div className="pw-filters" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            className={`chip${filter === f ? ' active' : ''}`}
            data-filter={f}
            onClick={() => setFilter(f)}
          >
            {t(`pw.filter.${f}`)}
          </button>
        ))}
      </div>
      {shown.length ? (
        <ul className="pw-list" id="entries">
          {shown.map((item) => (
            <li key={item.id} className="pw-row" data-entry={item.name}>
              <a className="pw-main" href={`#/e/${encodeURIComponent(item.id)}`}>
                <span className={`pw-icon type-${item.type}`}>
                  <Icon name={TYPE_ICON[item.type] || 'file'} />
                </span>
                <span className="pw-text">
                  <b>
                    {item.fav ? <Icon name="star" /> : null}
                    {item.name || t('pw.unnamed')}
                  </b>
                  <span className="muted small">{subtitle(item)}</span>
                </span>
              </a>
              {item.type === 'totp' && item.totp ? (
                <CodeLine secret={item.totp} />
              ) : item.password ? (
                <button
                  type="button"
                  className="icon-btn"
                  data-act="copy-password"
                  aria-label={t('pw.copyPassword')}
                  title={t('pw.copyPassword')}
                  onClick={() => void copySecret(item.password, t('pw.field.password'))}
                >
                  <Icon name="copy" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty" id="entriesEmpty">
          {vault.items.length ? t('pw.noMatch') : t('pw.empty')}
        </p>
      )}
      {vault.store.unreadable.size ? <p className="hint">{t('pw.unreadable', { n: vault.store.unreadable.size })}</p> : null}
    </div>
  );
}
