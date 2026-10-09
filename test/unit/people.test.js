import test from 'node:test';
import assert from 'node:assert/strict';
import { People } from '../../shared/people.js';
import { KINDS } from '../../shared/events.js';
import { generateSecretKey, getPublicKey, bytesToHex, matchFilters } from '../../shared/nostr.mjs';

// Two (or more) devices on one relay, in memory: every published event reaches every store.
function world() {
  const nets = [];
  const make = () => {
    const events = [];
    const listeners = new Set();
    const db = {
      async query(filters) {
        return events.filter((e) => matchFilters(filters, e)).sort((a, b) => b.created_at - a.created_at);
      },
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      async put(ev) {
        if (events.some((e) => e.id === ev.id)) return 'ignored';
        events.push(ev);
        for (const fn of listeners) fn(ev);
        return 'stored';
      },
    };
    const net = { db, pool: { subscribe: () => ({ close() {} }) }, sync: { async publish(ev) { for (const n of nets) await n.db.put(ev); } } };
    nets.push(net);
    return net;
  };
  return { make };
}
const identity = (alias = null) => {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk), alias };
};
const until = async (fn, what) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out: ${what}`);
};

test('a request and an accept make two people mutual friends; shares reach friends only; removing drops both', async () => {
  const w = world();
  const a = identity('alice');
  const b = identity('bob');
  const c = identity('carol');
  const A = await new People(a, w.make()).start();
  const B = await new People(b, w.make()).start();
  const C = await new People(c, w.make()).start();

  assert.equal(await A.request(b.pk), 'requested');
  assert.deepEqual(A.outgoing().map((r) => r.pk), [b.pk]);
  await until(() => B.incoming().length === 1, 'B gets the request');
  assert.equal(B.incoming()[0].name, 'alice', 'the request carries the asker’s name');
  assert.ok(!B.isFriend(a.pk) && !A.isFriend(b.pk), 'not friends until accepted');

  assert.equal(await B.accept(a.pk), 'friends');
  assert.ok(B.isFriend(a.pk));
  await until(() => A.isFriend(b.pk), 'the accept reaches A');
  assert.equal(A.nameOf(b.pk), 'bob');
  assert.deepEqual(A.outgoing(), []);
  assert.deepEqual(B.incoming(), []);

  // shares go to friends only, wait for their app, and are taken once
  assert.equal(await A.share('loadout', { type: 'board', url: 'x' }, [b.pk, c.pk]), 1, 'carol is not a friend');
  await until(() => B.shares('loadout').length === 1, 'B holds the share');
  const got = [];
  B.onShare('loadout', (s) => got.push(s));
  assert.equal(got.length, 1, 'a listener gets what was waiting');
  assert.equal(got[0].name, 'alice');
  assert.deepEqual(got[0].payload, { type: 'board', url: 'x' });
  await B.consume(got[0].id);
  assert.deepEqual(B.shares(), []);

  // a forged share from a non-friend is ignored, an unsolicited accept is treated as a request
  await C.send(a.pk, KINDS.SHARE, { app: 'loadout', payload: { url: 'evil' } });
  await C.send(a.pk, KINDS.FRIEND_ACCEPT, { name: 'carol' });
  await until(() => A.incoming().some((r) => r.pk === c.pk), 'carol shows up as a request');
  assert.deepEqual(A.shares(), [], 'nothing from a stranger');
  await A.ignore(c.pk);
  assert.deepEqual(A.incoming(), []);

  // circles hold friends only; removing a friend is mutual
  const id = await A.circleCreate('Crew');
  await A.circleSet(id, [b.pk, c.pk]);
  assert.deepEqual(A.membersOf(id), [b.pk]);
  await A.remove(b.pk);
  assert.ok(!A.isFriend(b.pk));
  assert.deepEqual(A.membersOf(id), []);
  await until(() => !B.isFriend(a.pk), 'B dropped A too');
  for (const p of [A, B, C]) p.stop();
});

test('two people who ask each other become friends, and a blocked person cannot ask', async () => {
  const w = world();
  const a = identity('alice');
  const b = identity('bob');
  const c = identity();
  const blockedByA = new Set([c.pk]);
  const A = await new People(a, w.make(), { isBlocked: (pk) => blockedByA.has(pk) }).start();
  const B = await new People(b, w.make()).start();
  const C = await new People(c, w.make()).start();
  await Promise.all([A.request(b.pk), B.request(a.pk)]);
  await until(() => A.isFriend(b.pk) && B.isFriend(a.pk), 'both asked, both friends');
  assert.deepEqual([...A.outgoing(), ...A.incoming(), ...B.outgoing(), ...B.incoming()], []);
  await C.request(a.pk);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(A.incoming(), [], 'a blocked person’s request never shows');
  assert.ok(A.settings.get('seen', []).length >= 2, 'wraps are marked seen either way');
  for (const p of [A, B, C]) p.stop();
});
