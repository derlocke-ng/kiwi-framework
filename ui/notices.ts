// What every page shows for People and the chat: a toast for a new friend
// request, for something shared with you that no open app has taken (once
// per device), and for a message that arrives while you are elsewhere; the
// same as browser notifications when the device asked for them.
import { useEffect } from 'react';
import { appById, mountsOf } from '../shared/apps.js';
import { fingerprint } from '../shared/events.js';
import { t } from '../shared/i18n.js';
import { store } from '../shared/util.js';
import { useKiwi, useMessages, usePeople } from './hooks';
import { chatMount, notifyBrowser } from './notify';
import { toast } from './toast';

const NOTIFIED = 'wjs.people.notified';

export function usePeopleNotices(): void {
  const kiwi = useKiwi();
  const { base, current } = kiwi;
  const people = usePeople();
  const messages = useMessages();
  const icon = `${base}icon-192.png`;
  // a message while this page is open, unless it is the conversation on screen
  useEffect(() => {
    const chat = chatMount();
    if (!messages || !chat) return;
    return messages.onMessage((m: any) => {
      if (current === chat.id && messages.active === m.conv) return;
      const name = people?.nameOf?.(m.from) || fingerprint(m.from);
      const href = `${base}${chat.id}/#/dm/${m.conv}`;
      toast(t('notify.message', { name }), 'info', 8000, { label: t('people.open'), href });
      notifyBrowser({ title: t('notify.message', { name }), body: m.text.slice(0, 120), url: href, tag: `msg-${m.conv}`, icon });
    });
  }, [messages, people, base, current, icon]);
  useEffect(() => {
    if (!people) return;
    // A tick later: an app takes its own shares (people.onShare) in effects of the same render.
    const timer = setTimeout(() => run(people));
    return () => clearTimeout(timer);
  });
  function run(people: any) {
    const done = new Set<string>(store.get(NOTIFIED, []));
    const fresh: string[] = [];
    if (current !== 'settings') {
      for (const r of people.incoming()) {
        const key = `req:${r.pk}:${r.at}`;
        if (done.has(key)) continue;
        fresh.push(key);
        const name = r.name || fingerprint(r.pk);
        toast(t('people.requestNotice', { name }), 'info', 10000, {
          label: t('hub.settings'),
          href: `${base}settings.html#people`,
        });
        notifyBrowser({ title: t('people.requestNotice', { name }), url: `${base}settings.html#people`, tag: `req-${r.pk}`, icon });
      }
    }
    for (const s of people.shares()) {
      if (people.handles(s.app)) continue; // this page's app takes it itself
      const key = `share:${s.id}`;
      if (done.has(key)) continue;
      fresh.push(key);
      const app = appById(s.app);
      const href = typeof s.payload?.url === 'string' ? s.payload.url : `${base}${mountsOf(s.app)[0]?.id || s.app}/`;
      toast(t('people.shareNotice', { name: s.name, app: app?.name || s.app }), 'info', 12000, {
        label: t('people.open'),
        href,
        onClick: () => people.consume(s.id),
      });
      notifyBrowser({ title: t('people.shareNotice', { name: s.name, app: app?.name || s.app }), url: href, tag: `share-${s.id}`, icon });
    }
    if (fresh.length) store.set(NOTIFIED, [...done, ...fresh].slice(-300));
  }
}
