// Chat: private messages between accounts and live rooms that vanish, on
// nostr. Armory mounts it as Uplink. Routes: #/ the list, #/dm/<pk> one
// conversation, #/room/<secret> one room, #/settings.
import { useEffect } from 'react';
import { AppShell, useMount } from '../../ui/AppShell';
import { useMessages, useT } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { ChatSettings } from './pages/ChatSettings';
import { Conversation } from './pages/Conversation';
import { Home } from './pages/Home';
import { RoomView } from './pages/RoomView';
import { DmContext, parseRoute } from './state';

export function ChatApp() {
  const t = useT();
  const mount = useMount();
  const route = parseRoute(useHash());
  const dm = useMessages(); // the runtime's inbox: it belongs to the identity and follows a sign-in
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
