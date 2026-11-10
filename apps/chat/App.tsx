// Chat: private messages between accounts, groups that stay until their host
// closes them, and live rooms that vanish, on nostr. Armory mounts it as
// Uplink. Routes: #/ messages, #/groups, #/dm/<pk>, #/group/<pub>/<host>/<invite>/<name>
// (either with ?m=<message> to show one), #/room/<secret>, #/search?q=, #/call (the call this page is in;
// #/call/<id>: a ringing one), #/settings. A ringing call shows over every screen, a call going on as a bar.
import { useEffect } from 'react';
import { AppShell, useMount } from '../../ui/AppShell';
import { useMessages, useT } from '../../ui/hooks';
import { useHash } from '../../ui/route';
import { useActiveCall } from './calling';
import { CallBar, CallScreen, IncomingCall } from './pages/Call';
import { ChatSettings } from './pages/ChatSettings';
import { Conversation } from './pages/Conversation';
import { GroupView } from './pages/GroupView';
import { Home } from './pages/Home';
import { RoomView } from './pages/RoomView';
import { Search } from './pages/Search';
import { DmContext, parseRoute } from './state';

export function ChatApp() {
  const t = useT();
  const mount = useMount();
  const route = parseRoute(useHash());
  const dm = useMessages(); // the runtime's inbox: it belongs to the identity and follows a sign-in
  const active = useActiveCall();
  useEffect(() => {
    document.title = mount.name;
  }, [mount.name]);
  // a thread (a conversation, a group, a room) is a messenger screen: the page is the viewport, the composer pinned at the bottom
  const thread = route.page === 'dm' || route.page === 'group' || route.page === 'room' || route.page === 'call';
  useEffect(() => {
    document.body.classList.toggle('thread', thread);
    return () => document.body.classList.remove('thread');
  }, [thread]);
  // The keyboard: the thread is as tall as what is visible, so the composer sits above the keyboard and the list
  // shrinks instead of hiding behind it. Chrome on Android resizes the layout for the keyboard when the viewport
  // meta asks (interactive-widget=resizes-content); Safari does not, so the visual viewport's height is followed
  // too. When the list shrinks, it stays at its end, where the newest message and the composer are.
  useEffect(() => {
    if (!thread) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    const fit = () => {
      const h = vv ? Math.round(vv.height) : window.innerHeight;
      root.style.setProperty('--thread-h', `${h}px`);
      if (vv && (vv.offsetTop > 0 || window.scrollY > 0)) window.scrollTo(0, 0); // the keyboard may have pushed the page up
      const list = document.querySelector('.messages');
      if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTop = list.scrollHeight;
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    const onFocus = () => setTimeout(fit, 300);
    document.addEventListener('focusin', onFocus);
    return () => {
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      document.removeEventListener('focusin', onFocus);
      root.style.removeProperty('--thread-h');
    };
  }, [thread]);

  const page =
    route.page === 'room' ? (
      <RoomView key={route.secret} secret={route.secret} relays={route.relays} />
    ) : !dm ? (
      <p className="empty">{t('common.loading')}</p>
    ) : route.page === 'dm' ? (
      <Conversation key={route.pk} pk={route.pk} draft={route.draft} focus={route.focus} />
    ) : route.page === 'group' ? (
      <GroupView key={route.pub} pub={route.pub} host={route.host} invite={route.invite} name={route.name} relays={route.relays} focus={route.focus} />
    ) : route.page === 'call' && (active || !route.id) ? (
      <CallScreen />
    ) : route.page === 'call' ? (
      <Home tab="messages" />
    ) : route.page === 'search' ? (
      <Search q={route.q} />
    ) : route.page === 'settings' ? (
      <ChatSettings />
    ) : (
      <Home tab={route.tab} />
    );
  return (
    <AppShell footer={t('chat.footer')} settings="#/settings">
      <DmContext.Provider value={dm}>
        {dm && route.page !== 'call' ? <CallBar /> : null}
        {page}
        {dm ? <IncomingCall want={route.page === 'call' ? route.id : ''} /> : null}
      </DmContext.Provider>
    </AppShell>
  );
}
