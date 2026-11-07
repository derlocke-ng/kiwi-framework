// Chat: private messages between accounts, groups that stay until their host
// closes them, and live rooms that vanish, on nostr. Armory mounts it as
// Uplink. Routes: #/ messages, #/groups, #/dm/<pk>, #/group/<pub>/<host>/<invite>/<name>,
// #/room/<secret>, #/settings.
import { useEffect } from 'react';
import { AppShell, useMount } from '../../ui/AppShell';
import { useMessages, useT } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { ChatSettings } from './pages/ChatSettings';
import { Conversation } from './pages/Conversation';
import { GroupView } from './pages/GroupView';
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
  // a thread (a conversation, a group, a room) is a messenger screen: the page is the viewport, the composer pinned at the bottom
  const thread = route.page === 'dm' || route.page === 'group' || route.page === 'room';
  useEffect(() => {
    document.body.classList.toggle('thread', thread);
    return () => document.body.classList.remove('thread');
  }, [thread]);

  const page =
    route.page === 'room' ? (
      <RoomView key={route.secret} secret={route.secret} />
    ) : !dm ? (
      <p className="empty">{t('common.loading')}</p>
    ) : route.page === 'dm' ? (
      <Conversation key={route.pk} pk={route.pk} />
    ) : route.page === 'group' ? (
      <GroupView key={route.pub} pub={route.pub} host={route.host} invite={route.invite} name={route.name} />
    ) : route.page === 'settings' ? (
      <ChatSettings />
    ) : (
      <Home tab={route.tab} />
    );
  return (
    <AppShell footer={t('chat.footer')} settings="#/settings">
      <DmContext.Provider value={dm}>{page}</DmContext.Provider>
    </AppShell>
  );
}
