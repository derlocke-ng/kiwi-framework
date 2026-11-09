// The market's listings: everything in the space, filtered by category and by
// where the buyer is (listings that ship there, or pickup there), with a
// search over what came; my own listings; the ones I saved. A grid of cards;
// a listing opens in a panel over it.
import { useState } from 'react';
import { countriesByName } from '../../../shared/countries.js';
import { KINDS } from '../../../shared/events.js';
import { currentLanguage } from '../../../shared/i18n.js';
import { isModerator } from '../../../shared/spaces.js';
import { store } from '../../../shared/util.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, useSpace, useT } from '../../../ui/hooks';
import { CATEGORIES } from '../data/market.js';
import { useListings, useMarket, usePrefs, useSellers } from '../state';
import { Compose } from './Compose';
import { ListingCard } from './Listing';
import { SellerGate } from './SellerGate';

type View = 'all' | 'mine' | 'saved';

const matches = (l: any, q: string) => {
  const s = q.trim().toLowerCase();
  return !s || `${l.title} ${l.text} ${l.price}`.toLowerCase().includes(s);
};

function Grid({ filters, query, empty }: { filters: Record<string, unknown>[]; query: string; empty: string }) {
  const t = useT();
  const list = useListings(filters);
  const shown = list.listings.filter((l: any) => matches(l, query));
  return (
    <>
      {shown.length ? (
        <ul className="listing-grid" id="listings">
          {shown.map((l: any) => (
            <li key={l.address}>
              <ListingCard listing={l} />
            </li>
          ))}
        </ul>
      ) : list.loading || list.opening ? (
        <p className="empty">{t('common.loading')}</p>
      ) : (
        <p className="empty">{query ? t('mk.noMatch') : empty}</p>
      )}
      {list.hasMore && shown.length ? (
        <div className="feed-more">
          <button type="button" className="btn btn-sm" data-act="more" disabled={list.loading} onClick={list.loadMore}>
            {list.loading ? t('common.loading') : t('feed.loadMore')}
          </button>
        </div>
      ) : null}
    </>
  );
}

export function Home() {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const space = useSpace();
  const prefs = usePrefs();
  const { data } = useMarket();
  const lang = currentLanguage();
  const viewKey = `market.view.${kiwi.current}`;
  const [view, setViewState] = useState<View>(() => (['all', 'mine', 'saved'].includes(store.get(viewKey)) ? store.get(viewKey) : 'all'));
  const setView = (v: View) => {
    setViewState(v);
    store.set(viewKey, v);
  };
  const [category, setCategory] = useState<string>('');
  const [country, setCountry] = useState<string | null>(null); // null: the person's own, from the settings
  const [pickup, setPickup] = useState(false);
  const [query, setQuery] = useState('');
  const [compose, setCompose] = useState(false);
  // a market with a rule for sellers: the form for those who may sell (and its moderators), the rule for everyone else
  const sellers = useSellers();
  const canSell = !sellers.ruled || isModerator(space, id.pk) || sellers.status(id.pk).ok === true;
  const where = country ?? String(prefs.get('country') || '');
  const inSpace = space ? { '#a': [space.address] } : {};
  const labels = data.labelsFor({ category: category || null, country: where || null, pickup });
  const saved: string[] = prefs.get('saved', []) || [];
  const filters =
    view === 'mine'
      ? [{ kinds: [KINDS.MARKET_LISTING], authors: [id.pk], ...inSpace }]
      : view === 'saved'
        ? saved.slice(-50).map((a) => {
            const [, pk, ...d] = a.split(':');
            return { kinds: [KINDS.MARKET_LISTING], authors: [pk], '#d': [d.join(':')] };
          })
        : [{ kinds: [KINDS.MARKET_LISTING], ...inSpace, ...(labels ? { '#l': labels } : {}) }];
  return (
    <div className="market-page">
      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label={t('mk.show')} id="marketViews">
          {(['all', 'mine', 'saved'] as View[]).map((v) => (
            <label key={v}>
              <input type="radio" name="view" value={v} checked={view === v} onChange={() => setView(v)} />
              <span>{t(`mk.view.${v}`)}</span>
            </label>
          ))}
        </div>
        <input
          className="search"
          id="search"
          type="search"
          placeholder={t('mk.search')}
          aria-label={t('mk.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {view === 'all' ? (
          <div className="filters" id="filters">
            <select id="category" aria-label={t('mk.category')} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('mk.allCategories')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`mk.cat.${c}`)}
                </option>
              ))}
            </select>
            <select id="country" aria-label={t('mk.where')} value={where} onChange={(e) => setCountry(e.target.value)}>
              <option value="">{t('mk.anywhere')}</option>
              {countriesByName(lang).map((c) => (
                <option key={c.code} value={c.code}>
                  {t('mk.reaches', { place: c.name })}
                </option>
              ))}
            </select>
            <label className="check-row">
              <input type="checkbox" id="pickup" checked={pickup} disabled={!where} onChange={(e) => setPickup(e.target.checked)} />
              <span>{t('mk.pickupHere')}</span>
            </label>
          </div>
        ) : null}
        <button type="button" className="btn btn-primary fab" id="newListing" onClick={() => setCompose(true)}>
          <Icon name="plus" />
          <span>{t('mk.new')}</span>
        </button>
      </div>
      <p className="muted small market-notice" id="marketNotice">
        {t('mk.notice')}
      </p>
      {view === 'saved' && !saved.length ? (
        <p className="empty">{t('mk.emptySaved')}</p>
      ) : (
        <Grid filters={filters} query={query} empty={t(view === 'mine' ? 'mk.emptyMine' : where ? 'mk.emptyHere' : 'mk.empty')} />
      )}
      {compose ? (
        canSell ? (
          <Compose onClose={() => setCompose(false)} onPosted={() => view === 'saved' && setView('mine')} />
        ) : (
          <SellerGate onClose={() => setCompose(false)} />
        )
      ) : null}
    </div>
  );
}
