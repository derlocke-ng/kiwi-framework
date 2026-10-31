// Chat: private messages between accounts and live rooms that vanish, on
// nostr. Armory mounts it as Uplink. Routes: #/ the list, #/dm/<pk> one
// conversation, #/room/<secret> one room, #/settings.
import { useCallback, useEffect, useState } from 'react';
import { AppShell, useMount } from '../../ui/AppShell';
import { useBlocks, useIdentity, useKiwi, useT, useTick } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { toastError } from '../../ui/toast';
import { DirectMessages } from './data/dm.js';
import { ChatSettings } from './pages/ChatSettings';
import { Conversation } from './pages/Conversation';
import { Home } from './pages/Home';
import { RoomView } from './pages/RoomView';
import { DmContext, parseRoute } from './state';

export function ChatApp() {
  const t = useT();
  const kiwi = useKiwi();
  const identity = useIdentity();
  const blocks = useBlocks();
  const mount = useMount();
  const route = parseRoute(useHash());
  const [dm, setDm] = useState<any>(null);

  // The inbox belongs to the identity: a sign-in elsewhere in the suite starts it over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the identity
  useEffect(() => {
    const inbox = new DirectMessages(identity, kiwi.net, { isBlocked: (pk: string) => Boolean(kiwi.blocks?.isBlocked(pk)) });
    let live = true;
    inbox
      .start()
      .then(() => live && setDm(inbox))
      .catch(toastError);
    return () => {
      live = false;
      inbox.stop();
      setDm(null);
    };
  }, [identity.pk, kiwi]);
  const blocksVersion = useTick(useCallback((fn: () => void) => (blocks ? blocks.onChange(fn) : () => {}), [blocks]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: `blocksVersion` is the block list saying it changed
  useEffect(() => {
    dm?.purgeBlocked().catch(() => {});
  }, [dm, blocksVersion]);
  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);

  const page =
    route.page === 'room' ? (
      <RoomView key={route.secret} secret={route.secret} />
    ) : !dm ? (
      <p className="empty">{t('common.loading')}</p>
    ) : route.page === 'dm' ? (
      <Conversation key={route.pk} pk={route.pk} />
    ) : route.page === 'settings' ? (
      <ChatSettings />
    ) : (
      <Home />
    );
  return (
    <AppShell footer={t('chat.footer')} settings="#/settings">
      <DmContext.Provider value={dm}>{page}</DmContext.Provider>
    </AppShell>
  );
}
