// What every page shows for People: notices about friend requests and about
// things shared with you, and the picker an app uses to choose friends or a
// circle to send something to.
import { t } from './i18n.js';
import { h, modal, toast } from './ui.js';
import { fingerprint } from './events.js';
import { appById, mountsOf } from './apps.js';
import { store } from './util.js';

const NOTIFIED = 'wjs.people.notified';

/** Toasts for new friend requests and for shares no open app has taken, once per device. */
export function peopleNotices(people, { base = '../', current = null } = {}) {
  const run = () => {
    const done = new Set(store.get(NOTIFIED, []));
    const fresh = [];
    if (current !== 'settings') {
      for (const r of people.incoming()) {
        const key = `req:${r.pk}:${r.at}`;
        if (done.has(key)) continue;
        fresh.push(key);
        toast(t('people.requestNotice', { name: r.name || fingerprint(r.pk) }), 'info', 10000, { label: t('hub.settings'), href: `${base}settings.html#people` });
      }
    }
    for (const s of people.shares()) {
      if (s.app === current && people.handles(current)) continue; // the app itself deals with it
      const key = `share:${s.id}`;
      if (done.has(key)) continue;
      fresh.push(key);
      const app = appById(s.app);
      toast(t('people.shareNotice', { name: s.name, app: app?.name || s.app }), 'info', 12000, {
        label: t('people.open'),
        href: typeof s.payload.url === 'string' ? s.payload.url : `${base}${mountsOf(s.app)[0]?.id || s.app}/`,
        onClick: () => people.consume(s.id),
      });
    }
    if (fresh.length) store.set(NOTIFIED, [...done, ...fresh].slice(-300));
  };
  run();
  return people.onChange(run);
}

/** Pick friends and circles to send to; resolves with pubkeys (empty when cancelled). */
export function pickPeople(people, { title = t('people.pick.title'), action = t('people.pick.send'), base = '../' } = {}) {
  const friends = people.friends();
  const circles = people.circles().filter((c) => c.members.length);
  const row = (name, value, label, extra = '') => `<li><label class="check-row"><input type="checkbox" name="${name}" value="${h(value)}"><span>${h(label)}${extra}</span></label></li>`;
  const m = modal({
    title,
    body: friends.length
      ? `<form class="form" id="pickPeople">
          ${circles.length ? `<p class="small muted">${h(t('people.pick.circles'))}</p><ul class="pick-list">${circles.map((c) => row('circle', c.id, c.name, ` <span class="muted small">${c.members.length}</span>`)).join('')}</ul>` : ''}
          <p class="small muted">${h(t('people.pick.friends'))}</p>
          <ul class="pick-list">${friends.map((f) => row('pk', f.pk, f.name || fingerprint(f.pk))).join('')}</ul>
          <div class="modal-actions"><button type="button" class="btn" data-close>${h(t('common.cancel'))}</button><button class="btn btn-primary">${h(action)}</button></div>
        </form>`
      : `<p class="modal-text">${h(t('people.pick.none'))}</p><div class="modal-actions"><a class="btn btn-primary" href="${h(base)}settings.html#people">${h(t('hub.settings'))}</a></div>`,
    onOpen: (el, close) => {
      el.querySelector('form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const pks = new Set([...e.target.querySelectorAll('input[name=pk]:checked')].map((i) => i.value));
        for (const c of e.target.querySelectorAll('input[name=circle]:checked')) for (const pk of people.membersOf(c.value)) pks.add(pk);
        close([...pks]);
      });
    },
  });
  return m.done.then((v) => v || []);
}
