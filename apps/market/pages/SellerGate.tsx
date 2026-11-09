// Who may sell here, said to the person who wants to: the market's rule (so
// many posts in the community's feed that other people liked, or a
// moderator's approval), how far they are, a way into the feed and a message
// to a moderator, drafted. Shown instead of the listing form until they may
// sell; the form takes its place by itself once they may.
import { mountFor } from '../../../shared/apps.js';
import { useMount } from '../../../ui/AppShell';
import { useIdentity, useKiwi, useSpace, useT } from '../../../ui/hooks';
import { chatMount } from '../../../ui/notify';
import { Modal } from '../../../ui/widgets/Modal';
import { useSellers } from '../state';

/** The name of the feed a market's rule counts posts in (the mount that shows it here, else the space's name), and that mount. */
export function useFeedOfRule(): { name: string; mount: any | null } {
  const sellers = useSellers();
  const feed = sellers.rule?.feed || null;
  const mount = feed ? mountFor('feed', feed.address) : null;
  return { name: mount?.name || feed?.name || '', mount };
}

export function SellerGate({ onClose }: { onClose: () => void }) {
  const t = useT();
  const kiwi = useKiwi();
  const me = useIdentity();
  const space = useSpace();
  const market = useMount();
  const sellers = useSellers();
  const feed = useFeedOfRule();
  const s = sellers.status(me.pk);
  const moderator = space?.moderators?.[0] || null;
  const chat = chatMount();
  const ask = moderator && chat ? `${kiwi.base}${chat.id}/#/dm/${moderator}?text=${encodeURIComponent(t('mk.seller.askText', { market: market.name }))}` : null;
  return (
    <Modal open title={t('mk.seller.title')} onClose={onClose}>
      <div className="seller-gate" id="sellerGate">
        <p className="modal-text">{s.need ? t('mk.seller.rule', { feed: feed.name, posts: s.need, likes: s.likes }) : t('mk.seller.ruleApproval')}</p>
        {s.revoked ? (
          <p className="hint" id="sellerRevoked">
            {t('mk.seller.revoked')}
          </p>
        ) : s.need ? (
          <p className="hint" id="sellerProgress">
            {s.posts == null ? t('mk.seller.checking', { feed: feed.name }) : t('mk.seller.progress', { have: s.posts, posts: s.need })}
          </p>
        ) : null}
        <div className="modal-actions">
          {feed.mount && s.need ? (
            <a className="btn" href={`${kiwi.base}${feed.mount.id}/`}>
              {t('mk.seller.feed', { feed: feed.name })}
            </a>
          ) : null}
          {ask ? (
            <a className="btn btn-primary" id="askModerator" href={ask}>
              {t('mk.seller.ask')}
            </a>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
