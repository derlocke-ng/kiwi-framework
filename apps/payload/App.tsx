// Payload: the suite's file share. One drop, three ways to send: a link
// (files encrypted on the person's media servers, opened by whoever has the
// link, also when the sender is offline: data/shares.js), to people (sealed
// into their Uplink, as Uplink's own files: shared/files.js, shared/chat.js,
// shared/groups.js), or directly between two open browsers, nothing stored
// (sender.js, receiver.js on shared/p2p.js, through the hub's relays). What
// people sent in Uplink is listed under Received; the links made here under
// Links, where they can be deleted from the servers.
// Routes: #/ send, #/received, #/links, #/l/<…> a link's files, #<secret> the
// receiving side of a direct transfer, #/settings.
import { useEffect, useState } from 'react';
import { tErr } from '../../shared/i18n.js';
import { AccountSettings } from '../../shared/settings.js';
import { AppShell, useMount } from '../../ui/AppShell';
import { useIdentity, useKiwi, usePeople, useT } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { toast } from '../../ui/toast';
import { parseShare } from './data/shares.js';
import { DirectReceive } from './pages/Direct';
import { Links } from './pages/Links';
import { OpenLink } from './pages/OpenLink';
import { PayloadSettings } from './pages/PayloadSettings';
import { Received } from './pages/Received';
import { Send } from './pages/Send';
import { PayloadContext } from './state';

const SECRET = /^#[\w-]{22}$/;

export type Route =
  | { page: 'send' | 'received' | 'links' | 'settings' }
  | { page: 'open'; ref: ReturnType<typeof parseShare> }
  | { page: 'direct'; secret: string };

export function parseRoute(hash: string): Route {
  if (SECRET.test(hash)) return { page: 'direct', secret: hash.slice(1) };
  const h = hash.replace(/^#\/?/, '');
  if (h.startsWith('l/')) return { page: 'open', ref: parseShare(h) };
  if (h === 'received') return { page: 'received' };
  if (h === 'links') return { page: 'links' };
  if (h.startsWith('settings')) return { page: 'settings' };
  return { page: 'send' };
}

/** The three lists under the app's bar: send, what came in Uplink, the links made here. */
export function Tabs({ page }: { page: string }) {
  const t = useT();
  return (
    <nav className="seg pl-tabs" id="plTabs" aria-label={t('pl.tabs')}>
      {(['send', 'received', 'links'] as const).map((p) => (
        <a key={p} href={p === 'send' ? '#/' : `#/${p}`} data-tab={p} aria-current={page === p ? 'page' : undefined} className={page === p ? 'on' : ''}>
          {t(`pl.tab.${p}`)}
        </a>
      ))}
    </nav>
  );
}

export function PayloadApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const people = usePeople();
  const mount = useMount();
  const hash = useHash();
  const route = parseRoute(hash);
  const [prefs, setPrefs] = useState<any>(null);

  // the links made here and the app's choices: the account's, on the hub's network
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const p = new AccountSettings(identity, kiwi.hubNet, 'payload');
    let live = true;
    p.start()
      .then(() => live && setPrefs(p))
      .catch((err: unknown) => toast(tErr(err), 'error'));
    return () => {
      live = false;
      p.stop();
      setPrefs(null);
    };
  }, [identity.pk, kiwi]);

  useEffect(() => {
    document.title = route.page === 'direct' || route.page === 'open' ? t('pl.titleReceiving', { app: mount.name }) : mount.name;
  }, [route.page, mount.name, t]);

  // a link a friend sent with an earlier Payload (a share, not a message): one tap opens it here
  useEffect(() => {
    if (!people) return;
    return people.onShare('payload', (share: any) => {
      if (typeof share.payload?.url !== 'string') return;
      toast(t('pl.friendSent', { name: share.name }), 'info', 15000, { label: t('pl.open'), href: share.payload.url, onClick: () => people.consume(share.id) });
    });
  }, [people, t]);

  const page =
    route.page === 'direct' ? (
      <DirectReceive secret={route.secret} />
    ) : route.page === 'open' ? (
      <OpenLink shareRef={route.ref} />
    ) : !prefs ? (
      <p className="empty">{t('common.loading')}</p>
    ) : route.page === 'settings' ? (
      <PayloadSettings />
    ) : route.page === 'received' ? (
      <Received />
    ) : route.page === 'links' ? (
      <Links />
    ) : (
      <Send />
    );
  return (
    <AppShell footer={t('pl.footer')} settings="#/settings">
      <PayloadContext.Provider value={{ prefs }}>{page}</PayloadContext.Provider>
    </AppShell>
  );
}
