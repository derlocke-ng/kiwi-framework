// The market: listings for the space a mount serves (Armory mounts it as
// Trading Post, for hemp: seeds, cuttings, gear), found by category and by
// where the buyer is, without plain words on the relays.
// Routes: #/ the listings, #/l/<seller>/<d> one listing (a link into the
// mount's space, ui/spaces.ts), #/s/<pk> one seller, #/settings.
import { useEffect, useState } from 'react';
import { mountById } from '../../shared/apps.js';
import { KINDS } from '../../shared/events.js';
import { tErr } from '../../shared/i18n.js';
import { Sellers, sellerRule } from '../../shared/sellers.js';
import { AccountSettings } from '../../shared/settings.js';
import { Social } from '../../shared/social.js';
import { spaceById } from '../../shared/spaces.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useIdentity, useKiwi, useT } from '../../ui/hooks';
import { goBack, useHash } from '../../ui/route';
import { resolveSpaceLink } from '../../ui/spaces';
import { toast } from '../../ui/toast';
import { Panel } from '../../ui/widgets/Panel';
import { MarketData, NAMESPACE, parseRoute } from './data/market.js';
import { Home } from './pages/Home';
import { MarketSettings } from './pages/MarketSettings';
import { ListingPanel, SellerPanel } from './pages/Panels';
import { MarketContext, type MarketState } from './state';

export function MarketApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const mount = useMount();
  const hash = useHash({ scroll: false }); // a listing or a seller opens over the listings, which keep their place
  const route = parseRoute(hash);
  const link = route.page === 'listing' ? resolveSpaceLink(kiwi, route.params, hash) : null;
  useEffect(() => {
    if (link?.redirect) location.replace(link.redirect);
  }, [link?.redirect]);
  const [state, setState] = useState<MarketState | null>(null);

  // The listings are on the mount's content network; the app's settings, like everything of the account's, on the hub's own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const data = new MarketData(kiwi.net, identity, { space: kiwi.mountSpace, audiences: () => kiwi.audiences });
    const social = new Social(kiwi.net, identity, { space: kiwi.mountSpace, kind: KINDS.MARKET_LISTING }).start();
    const prefs = new AccountSettings(identity, kiwi.hubNet, NAMESPACE);
    // who may sell here: the mount's rule (posts in a feed space and likes on them, or a moderator's approval)
    const rule = sellerRule(mountById(kiwi.current)?.sellers, spaceById);
    const feedNet = rule?.feed ? kiwi.netOf(rule.feed.network || 'hub') : null;
    const sellers = new Sellers({ market: kiwi.net, feed: feedNet }, identity, {
      space: kiwi.mountSpace,
      rule,
      isBlocked: (pk: string) => Boolean(kiwi.blocks?.isBlocked(pk)),
    });
    let live = true;
    Promise.all([prefs.start(), sellers.start()])
      .then(() => live && setState({ data, social, prefs, sellers }))
      .catch((err: unknown) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      social.stop();
      prefs.stop();
      sellers.stop();
      setState(null);
    };
  }, [identity.pk, kiwi]);

  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);
  useEffect(() => {
    if (route.page === 'settings') window.scrollTo(0, 0);
  }, [route.page]);

  const close = () => goBack('#/');
  const page = !state ? (
    <p className="empty">{t('common.loading')}</p>
  ) : route.page === 'settings' ? (
    <MarketSettings />
  ) : (
    <>
      <Home />
      {route.page === 'listing' ? (
        <Panel key={`${route.pk}/${route.d}`} title={t('mk.listing')} onClose={close}>
          <ListingPanel pk={route.pk} d={route.d} foreign={link?.foreign || null} />
        </Panel>
      ) : null}
      {route.page === 'seller' ? (
        <Panel key={route.pk} title={t('mk.sellerTitle')} onClose={close}>
          <SellerPanel pk={route.pk} />
        </Panel>
      ) : null}
    </>
  );
  return (
    <AppShell footer={t('mk.footer')} settings="#/settings">
      {state ? <MarketContext.Provider value={state}>{page}</MarketContext.Provider> : page}
    </AppShell>
  );
}
