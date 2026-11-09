// What opens in a panel over the market: one listing (with a word when it is
// gone or not for this person), one seller and their listings.
import { useState } from 'react';
import { npub } from '../../../shared/account.js';
import { fingerprint, KINDS } from '../../../shared/events.js';
import { tErr } from '../../../shared/i18n.js';
import { isModerator } from '../../../shared/spaces.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, usePeople, useSpace, useT } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { toast } from '../../../ui/toast';
import { useListings, useMarket, useNameOf, useSellers } from '../state';
import { Compose } from './Compose';
import { ListingCard, ListingView } from './Listing';
import { useFeedOfRule } from './SellerGate';

export function ListingPanel({ pk, d, foreign }: { pk: string; d: string; foreign?: { address: string; from: string | null } | null }) {
  const t = useT();
  const [editing, setEditing] = useState<any>(null);
  const list = useListings([{ kinds: [KINDS.MARKET_LISTING], authors: [pk], '#d': [d] }], 1);
  const listing = list.listings[0];
  return (
    <div className="listing-page">
      {foreign ? (
        <div className="banner foreign-space" id="foreignSpace">
          <Icon name="globe" />
          <p>
            {t('mk.foreignSpace', { space: foreign.address.split(':')[2] })}
            {foreign.from ? (
              <>
                {' '}
                <a href={`${foreign.from}${location.hash}`} rel="noopener">
                  {t('mk.openElsewhere')}
                </a>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      {listing ? (
        <ListingView listing={listing} onEdit={setEditing} />
      ) : list.loading || list.opening ? (
        <p className="empty">{t('common.loading')}</p>
      ) : (
        <p className="empty" id="notForYou">
          {t('mk.gone')}
        </p>
      )}
      {editing ? <Compose existing={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

export function SellerPanel({ pk }: { pk: string }) {
  const t = useT();
  const kiwi = useKiwi();
  const id = useIdentity();
  const people = usePeople();
  const space = useSpace();
  const nameOf = useNameOf();
  const list = useListings([{ kinds: [KINDS.MARKET_LISTING], authors: [pk], ...(space ? { '#a': [space.address] } : {}) }]);
  const written = list.listings.find((l: any) => l.name)?.name || '';
  const name = nameOf(pk, written);
  const me = pk === id.pk;
  const friend = Boolean(people?.isFriend(pk));
  const asked = Boolean(people?.outgoing().some((r: any) => r.pk === pk));
  const chat = chatMount();
  const { data } = useMarket();
  const sellers = useSellers();
  const feed = useFeedOfRule();
  const moderator = isModerator(space, id.pk);
  const st = sellers.status(pk);
  const decide = (decision: string) =>
    data
      .decideSeller(pk, decision, sellers.decisions.get(pk)?.at || 0)
      .then(() => toast(t(decision === 'approved' ? 'mk.seller.approved' : 'mk.seller.withdrawn'), 'success'))
      .catch((err: unknown) => toast(tErr(err), 'error'));
  return (
    <div className="seller-page">
      <section className="person-head card" id="seller" data-pk={pk}>
        <h2>
          <span className="entry-avatar" aria-hidden="true">
            {(name.replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase()}
          </span>
          <span>{name}</span>
        </h2>
        <p className="muted small">
          <code title={npub(pk)}>{fingerprint(pk)}</code> · {me ? t('mk.thisIsYou') : friend ? t('people.friend') : t('mk.seller')}
        </p>
        {sellers.ruled ? (
          <p className="small seller-status" id="sellerStatus" data-ok={String(st.ok)}>
            {st.approved
              ? t('mk.seller.statusApproved')
              : st.need && st.posts != null
                ? t('mk.seller.statusPosts', { feed: feed.name, have: st.posts, posts: st.need })
                : t('mk.seller.statusNone')}
          </p>
        ) : null}
        {moderator && !me && sellers.ruled ? (
          <div className="form-actions">
            {st.approved ? (
              <button type="button" className="btn btn-sm" data-act="withdraw-seller" onClick={() => decide('revoked')}>
                <Icon name="x" />
                <span>{t('mk.seller.withdraw')}</span>
              </button>
            ) : (
              <button type="button" className="btn btn-sm btn-primary" data-act="approve-seller" onClick={() => decide('approved')}>
                <Icon name="check" />
                <span>{t('mk.seller.approve')}</span>
              </button>
            )}
          </div>
        ) : null}
        {me ? null : (
          <div className="form-actions">
            {chat ? (
              <a className="btn btn-sm" data-act="message" href={`${kiwi.base}${chat.id}/#/dm/${pk}`}>
                <Icon name="message-circle" />
                <span>{t('mk.message')}</span>
              </a>
            ) : null}
            {friend ? null : (
              <button
                type="button"
                className="btn btn-sm"
                data-act="befriend"
                disabled={asked}
                onClick={() =>
                  people
                    .request(pk)
                    .then((r: string) => toast(t(r === 'friends' ? 'people.friend' : 'people.requested'), 'success'))
                    .catch((err: unknown) => toast(tErr(err), 'error'))
                }
              >
                <Icon name="user-plus" />
                <span>{asked ? t('people.requested') : t('people.add')}</span>
              </button>
            )}
          </div>
        )}
      </section>
      {list.listings.length ? (
        <ul className="listing-grid">
          {list.listings.map((l: any) => (
            <li key={l.address}>
              <ListingCard listing={l} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{list.loading || list.opening ? t('common.loading') : t('mk.emptySeller')}</p>
      )}
    </div>
  );
}
