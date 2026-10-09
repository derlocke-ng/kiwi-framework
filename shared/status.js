// The connection pill: how many relays are connected and how many changes
// no relay has yet. Links to the relay settings. Used in every top bar.
//
//   mountStatus(el, net, { href: '../settings.html#relays' })

import { t } from './i18n.js';

const h = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Markup for the pill; call mountStatus() once it is in the document. */
export const statusPill = ({ href = 'settings.html#relays', id = 'sync' } = {}) =>
  `<a class="wjs-status" id="${h(id)}" href="${h(href)}" title="${h(t('app.relayStatus'))}"><span class="wjs-status-dot"></span><span class="wjs-status-text">…</span></a>`;

/**
 * Keep the pill current. `net` is { pool, sync }. Returns a function that stops the updates.
 */
export function mountStatus(el, net, { onChange = null } = {}) {
  if (!el || !net?.pool) return () => {};
  let last = '';
  const draw = async () => {
    const s = net.pool.status();
    const pending = net.sync ? await net.sync.unsynced() : 0;
    const key = `${s.connected}/${s.total}/${pending}`;
    if (key === last || !el.isConnected) return;
    last = key;
    el.dataset.state = s.connected ? 'on' : 'off';
    el.querySelector('.wjs-status-text').textContent = s.connected
      ? `${s.connected}/${s.total}${pending ? ` · ${t('sync.toSync', { n: pending })}` : ''}`
      : pending
        ? `${t('sync.offline')} · ${t('sync.toSync', { n: pending })}`
        : t('sync.offline');
    el.title = s.connected ? t('sync.titleOn', { connected: s.connected, relays: s.total }) : t('sync.titleOff');
    onChange?.({ ...s, pending });
  };
  const off1 = net.pool.onStatus(draw);
  const off2 = net.sync?.onChange(draw) || (() => {});
  draw();
  return () => {
    off1();
    off2();
  };
}
