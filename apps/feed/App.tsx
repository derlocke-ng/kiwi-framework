// The feed: entries with photos for the space a mount serves, for friends, a
// circle or only me (Armory mounts it as Outpost, its grow reports).
// Routes: #/ the feed, #/e/<author>/<d> one entry and its comments (a link
// into the mount's space, ui/spaces.ts), #/p/<pk> one person, #/settings.
import { useEffect, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useIdentity, useKiwi, useT } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { resolveSpaceLink } from '../../ui/spaces';
import { toast } from '../../ui/toast';
import { FeedData, NAMESPACE, parseRoute } from './data/feed.js';
import { Social } from './data/social.js';
import { EntryPage } from './pages/EntryPage';
import { FeedSettings } from './pages/FeedSettings';
import { FeedView } from './pages/FeedView';
import { PersonPage } from './pages/PersonPage';
import { FeedContext, type FeedState } from './state';

export function FeedApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const mount = useMount();
  const hash = useHash();
  const route = parseRoute(hash);
  // a link into another space: this hub's mount for it, or a word that it is not served here
  const link = route.page === 'entry' ? resolveSpaceLink(kiwi, route.params, hash) : null;
  useEffect(() => {
    if (link?.redirect) location.replace(link.redirect);
  }, [link?.redirect]);
  const [state, setState] = useState<FeedState | null>(null);

  // The entries are on the mount's content network (the space's relays, or the hub's); the app's settings,
  // like everything of the account's, on the hub's own. All of it belongs to the identity.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const data = new FeedData(kiwi.net, identity, { space: kiwi.mountSpace, audiences: () => kiwi.audiences });
    const social = new Social(kiwi.net, identity, { space: kiwi.mountSpace }).start();
    const prefs = new AccountSettings(identity, kiwi.hubNet, NAMESPACE);
    let live = true;
    prefs
      .start()
      .then(() => live && setState({ data, social, prefs }))
      .catch((err: unknown) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      social.stop();
      prefs.stop();
      setState(null);
    };
  }, [identity.pk, kiwi]);

  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);

  const page = !state ? (
    <p className="empty">{t('common.loading')}</p>
  ) : route.page === 'settings' ? (
    <FeedSettings />
  ) : route.page === 'entry' ? (
    <EntryPage pk={route.pk} d={route.d} foreign={link?.foreign || null} />
  ) : route.page === 'person' ? (
    <PersonPage pk={route.pk} />
  ) : (
    <FeedView />
  );
  return (
    <AppShell footer={t('fd.footer')} settings="#/settings">
      {state ? <FeedContext.Provider value={state}>{page}</FeedContext.Provider> : page}
    </AppShell>
  );
}
