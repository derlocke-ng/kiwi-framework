// Getting events to relays and keeping them there.
//
// publish(): store locally first (the UI reads from the store, so it works
// offline), then send to every relay; relays answer in the background and
// leave the outbox as they accept. Relays that were unreachable get the event
// from the outbox when they connect, or on the retry timer.
//
// heal(): relays forget; devices don't. When a relay (re)connects, each
// watched author's events are compared with what the relay holds and only
// the gaps are published, at most every few hours per relay and author
// (remembered across page loads), never while a relay asked us to back off.
// Relays keep the newest version per address, so healing never rolls back.

import { isPermanent } from './relays.js';
import { store as local } from './util.js';
import { addressOf, supersedes } from './events.js';

const FLUSH_EVERY = 15_000;
const HEAL_PACE = 150; // ms between re-published events, so relays don't rate-limit us
const HEAL_EVERY = 10 * 60_000; // per relay and author: a gap check is one REQ, so it can run often, but not on every page hop
const HEALED_KEY = 'wjs.healed';
const BACKOFF_KEY = 'wjs.backoff';
/** How long to leave a relay alone after it complained. */
const backoffFor = (error) => (/^banned/.test(error) ? 60 * 60_000 : /^rate-limited/.test(error) ? 5 * 60_000 : 20_000);
const busy = (error) => /offline|timed out|^rate-limited|^banned/.test(error);

export class Sync {
  constructor(pool, store) {
    this.pool = pool;
    this.store = store;
    this.healed = new Map(Object.entries(local.get(HEALED_KEY, {}))); // `${url}|${pubkey}` -> time
    this.authors = new Set(); // whose events to heal
    this.listeners = new Set();
    this.errorListeners = new Set();
    this.backoff = new Map(Object.entries(local.get(BACKOFF_KEY, {}))); // url -> time before which we leave the relay alone
    this.flushing = new Set();
    pool.onConnect((url) => {
      this.flush(url).catch((err) => console.warn('outbox:', err));
      this.healRelay(url).catch((err) => console.warn('heal:', err));
    });
    this.timer = setInterval(() => this.flushAll().catch(() => {}), FLUSH_EVERY);
    store.pruneOutbox(pool.urls).catch(() => {});
  }

  /** A relay complained (rate limit, ban, timeout): leave it alone for a while, also after a reload. */
  complain(url, error) {
    this.backoff.set(url, Date.now() + backoffFor(error));
    local.set(BACKOFF_KEY, Object.fromEntries(this.backoff));
  }

  quiet(url) {
    return (this.backoff.get(url) || 0) > Date.now();
  }

  rememberHealed(key, time) {
    if (time) this.healed.set(key, time);
    else this.healed.delete(key);
    local.set(HEALED_KEY, Object.fromEntries([...this.healed].filter(([, t]) => Date.now() - t < 7 * 86_400_000)));
  }

  /** Events no relay has accepted yet. */
  unsynced() {
    return this.store.pendingCount(this.pool.urls.length);
  }

  outbox() {
    return this.store.outboxSummary(this.pool.urls.length);
  }

  /**
   * Store an event and send it to every relay, now or later. Resolves as soon
   * as the event is stored locally (the UI never waits for relays).
   * `wait: 'one'` resolves when the first relay accepts and rejects when none
   * does (for things that must reach a relay now, like a new account).
   * `wait: 'all'` resolves with every relay's answer.
   */
  async publish(event, { wait = 'none' } = {}) {
    await this.store.put(event);
    await this.store.setPending(event.id, this.pool.urls);
    this.emit();
    let first;
    const gotOne = new Promise((resolve) => (first = resolve));
    const all = this.pool.publish(event, {
      onResult: (url, r) => {
        if (r.ok) first({ ok: [url], failed: [] });
        if (r.ok || r.permanent) this.store.ack(event.id, url, { accepted: r.ok }).then(() => this.emit());
        else if (r.error !== 'offline') this.complain(url, r.error);
      },
    });
    all
      .then((res) => {
        // Every connected relay said no for good: the change stays on this device, and the person should know.
        const answered = res.failed.filter((f) => f.error !== 'offline');
        const rejected = answered.filter((f) => f.permanent);
        if (!res.ok.length && rejected.length && rejected.length === answered.length) {
          for (const fn of this.errorListeners) fn({ event, reason: rejected[0].error, relays: rejected.map((f) => f.url) });
        }
      })
      .catch(() => {});
    if (wait === 'all') return all;
    if (wait === 'one') {
      const result = await Promise.race([gotOne, all]);
      if (!result.ok.length) throw new Error(result.failed[0]?.error || 'offline');
      return result;
    }
    return { ok: [], failed: [] };
  }

  /** Send everything this relay still misses from the outbox. */
  async flush(url) {
    if (this.flushing.has(url)) return;
    this.flushing.add(url);
    try {
      const ids = await this.store.pendingFor(url);
      for (const id of ids) {
        const event = await this.store.get(id);
        if (!event) {
          await this.store.ack(id, url, { accepted: false });
          continue;
        }
        try {
          await this.pool.publishTo(url, event);
          this.pool.notePublish(url, null);
          await this.store.ack(id, url);
        } catch (err) {
          const error = String(err?.message || err);
          if (isPermanent(error)) {
            this.pool.notePublish(url, error);
            await this.store.ack(id, url, { accepted: false });
          } else {
            if (error !== 'offline') {
              this.pool.notePublish(url, error);
              this.complain(url, error);
            }
            break; // relay is away or busy; keep the rest for next time
          }
        }
      }
    } finally {
      this.flushing.delete(url);
    }
    this.emit();
  }

  /** Flush the outbox to every connected relay that isn't backing off. */
  async flushAll({ force = false } = {}) {
    for (const url of this.pool.urls) {
      if (!this.pool.relays.get(url)?.open) continue;
      if (!force && this.quiet(url)) continue;
      if (!force && !(await this.store.pendingFor(url)).length) continue;
      await this.flush(url);
    }
  }

  /** Re-publish what the connected relays miss, now (the "Sync now" button). */
  async healAll() {
    await this.flushAll({ force: true });
    for (const url of this.pool.urls) if (this.pool.relays.get(url)?.open) await this.healRelay(url, { force: true });
  }

  /** Keep re-publishing these authors' events to relays that (re)connect. */
  watch(pubkeys) {
    for (const pk of pubkeys) this.authors.add(pk);
  }

  unwatch(pubkey) {
    this.authors.delete(pubkey);
  }

  /** Fill one relay's gaps for the watched authors (or the given ones). */
  async healRelay(url, { force = false, authors = this.authors } = {}) {
    let sent = 0;
    if (!force && this.quiet(url)) return sent;
    for (const pk of authors) {
      const key = `${url}|${pk}`;
      if (!force && Date.now() - (this.healed.get(key) || 0) < HEAL_EVERY) continue;
      this.rememberHealed(key, Date.now());
      const mine = await this.store.byAuthor(pk);
      if (!mine.length) continue;
      let theirs;
      try {
        theirs = await this.pool.fetchFrom(url, [{ authors: [pk] }]);
      } catch {
        this.rememberHealed(key, 0);
        return sent; // relay gone; next time
      }
      const have = new Map(theirs.map((e) => [addressOf(e) || e.id, e]));
      for (const event of mine) {
        const current = have.get(addressOf(event) || event.id);
        if (current && (current.id === event.id || !supersedes(event, current))) continue;
        try {
          await this.pool.publishTo(url, event);
          sent++;
          await new Promise((r) => setTimeout(r, HEAL_PACE));
        } catch (err) {
          const error = String(err?.message || err);
          if (busy(error)) {
            if (error !== 'offline') {
              this.pool.notePublish(url, error);
              this.complain(url, error);
            }
            this.rememberHealed(key, 0); // try again on the next occasion
            return sent;
          }
        }
      }
    }
    return sent;
  }

  /** Fill one author's gaps on every connected relay (opening a board). */
  async healAuthor(pubkey) {
    this.authors.add(pubkey);
    let sent = 0;
    for (const url of this.pool.urls) {
      if (!this.pool.relays.get(url)?.open) continue;
      sent += await this.healRelay(url, { authors: [pubkey] });
    }
    return sent;
  }

  async pending() {
    return this.store.pendingCount();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** fn({ event, reason, relays }) when every connected relay refused an event for good. */
  onError(fn) {
    this.errorListeners.add(fn);
    return () => this.errorListeners.delete(fn);
  }

  close() {
    clearInterval(this.timer);
  }

  emit() {
    for (const fn of this.listeners) fn();
  }
}
