// Boards: shared checklists, inventories and markdown notes. Every board is
// its own key pair; your wallet of boards is encrypted to your key, so every
// device signed in as you has them. Routes live in the fragment:
//   #/            your boards
//   #/b/<pub>…    one board (links carry its keys after the #, see data/links.js)
//   #/account     the app's settings
import { useEffect, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { AppShell } from '../../ui/AppShell';
import { useIdentity, useKiwi, usePeople, useT } from '../../ui/hooks';
import { toast } from '../../ui/toast';
import { carryOver } from './data/carry.js';
import { unwatchAll, watchAll } from './data/heal.js';
import { isPub, isSecret, parseRoute } from './data/links.js';
import { Wallet } from './data/wallet.js';
import { closeMenus } from './menu.js';
import { BoardPage } from './pages/BoardPage';
import { BoardsSettings } from './pages/BoardsSettings';
import { Home } from './pages/Home';
import { BoardsContext, type BoardsState } from './state';

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const follow = () => {
      closeMenus();
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', follow);
    return () => removeEventListener('hashchange', follow);
  }, []);
  return parseRoute(hash);
}

export function BoardsApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const people = usePeople();
  const [state, setState] = useState<BoardsState | null>(null);
  const route = useRoute();

  // The wallet and the app's settings belong to the identity: a sign-in elsewhere in the suite starts them over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const wallet = new Wallet(identity, kiwi.net);
    const settings = new AccountSettings(identity, kiwi.net, 'loadout');
    let live = true;
    // Relays that (re)connect get this device's copy of everything that is ours.
    const rewatch = () => watchAll(identity, wallet, kiwi.net);
    rewatch();
    const off = wallet.onChange(rewatch);
    (async () => {
      await Promise.all([wallet.start(), settings.start()]);
      await carryOver({ identity, wallet, settings, net: kiwi.net }); // boards this device kept under a key it used before
      if (live) setState({ wallet, settings });
    })().catch((err) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      off();
      unwatchAll();
      wallet.stop();
      settings.stop();
      setState(null);
    };
  }, [identity.pk, kiwi]);

  // Boards friends sent (the share dialog's "Send to friends") go straight into the wallet.
  useEffect(() => {
    if (!people || !state) return;
    return people.onShare('loadout', async (share: any) => {
      const b = share.payload?.board;
      if (share.payload?.type !== 'board' || !b || !isPub(b.pub)) return;
      const { wallet } = state;
      if (!wallet.get(b.pub))
        await wallet.upsert({
          pub: b.pub,
          w: isSecret(b.w) ? b.w : null,
          k: isSecret(b.k) ? b.k : null,
          type: b.kind,
          mode: b.mode,
          title: String(b.title || '').slice(0, 120),
        });
      await people.consume(share.id);
      toast(t('share.received', { name: share.name, title: b.title || t('common.untitled') }), 'success', 6000);
    });
  }, [people, state, t]);

  // A relay that refuses a write says why; relays that are already open get our copy now.
  useEffect(() => {
    const { pool, sync } = kiwi.net;
    for (const r of pool.status().relays) if (r.open) sync.healRelay(r.url).catch(() => {});
    return sync.onError(({ reason }: { reason: string }) => toast(t('sync.rejected', { reason }), 'error', 8000));
  }, [kiwi, t]);

  useEffect(() => {
    document.body.dataset.route = route.name;
  }, [route.name]);

  const page =
    route.name === 'board' ? (
      <BoardPage key={`${route.pub}`} route={route as { pub: string; w: string | null; k: string | null }} />
    ) : route.name === 'account' ? (
      <BoardsSettings />
    ) : route.name === 'home' ? (
      <Home />
    ) : (
      <section className="empty">
        <h1>{t('app.notFound')}</h1>
        <p>
          <a href="#/">{t('app.backToBoards')}</a>
        </p>
      </section>
    );
  return (
    <AppShell footer={t('app.footer')} homeLabel={t('app.home')} settings="#/account">
      {state ? <BoardsContext.Provider value={state}>{page}</BoardsContext.Provider> : <div className="boot">{t('common.loading')}</div>}
    </AppShell>
  );
}
