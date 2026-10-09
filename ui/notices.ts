// What every page shows for People: a toast for a new friend request and for
// something shared with you that no open app has taken, once per device.
import { useEffect } from 'react';
import { appById, mountsOf } from '../shared/apps.js';
import { fingerprint } from '../shared/events.js';
import { t } from '../shared/i18n.js';
import { store } from '../shared/util.js';
import { useKiwi, usePeople } from './hooks';
import { toast } from './toast';

const NOTIFIED = 'wjs.people.notified';

export function usePeopleNotices(): void {
  const { base, current } = useKiwi();
  const people = usePeople();
  useEffect(() => {
    if (!people) return;
    const done = new Set<string>(store.get(NOTIFIED, []));
    const fresh: string[] = [];
    if (current !== 'settings') {
      for (const r of people.incoming()) {
        const key = `req:${r.pk}:${r.at}`;
        if (done.has(key)) continue;
        fresh.push(key);
        toast(t('people.requestNotice', { name: r.name || fingerprint(r.pk) }), 'info', 10000, {
          label: t('hub.settings'),
          href: `${base}settings.html#people`,
        });
      }
    }
    for (const s of people.shares()) {
      if (s.app === current && people.handles(current)) continue;
      const key = `share:${s.id}`;
      if (done.has(key)) continue;
      fresh.push(key);
      const app = appById(s.app);
      toast(t('people.shareNotice', { name: s.name, app: app?.name || s.app }), 'info', 12000, {
        label: t('people.open'),
        href: typeof s.payload?.url === 'string' ? s.payload.url : `${base}${mountsOf(s.app)[0]?.id || s.app}/`,
        onClick: () => people.consume(s.id),
      });
    }
    if (fresh.length) store.set(NOTIFIED, [...done, ...fresh].slice(-300));
  });
}
