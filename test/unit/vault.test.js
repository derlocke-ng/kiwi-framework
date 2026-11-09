// The vault (0.27): a random vault key wrapped under the passphrase, one sealed event per entry bound to
// its address, entries kept by the newest event per address, a new passphrase that keeps the entries as
// they are, deletions that look like any other edit to a relay, backups, and 0.26's codes still readable.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { KINDS } = await import('../../shared/events.js');
const { backupOf, changePassphrase, createKeys, createVault, isKeys, openItem, openKeys, readBackup, sealItem } = await import('../../shared/vault.js');
const { VaultStore, cleanItem } = await import('../../shared/vaultstore.js');
const { bytesToHex, generateSecretKey, getPublicKey, matchFilters } = await import('../../shared/nostr.mjs');

const sk = bytesToHex(generateSecretKey());
const id = { sk, pk: getPublicKey(Buffer.from(sk, 'hex')) };
const PASS = 'correct horse battery';

/** A device: its store and what it published; `relay` hands it another device's event. */
function device() {
  const events = [];
  const listeners = new Set();
  const published = [];
  const db = {
    put: async (ev) => {
      const i = events.findIndex((e) => e.kind === ev.kind && e.tags[0][1] === ev.tags[0][1]);
      if (i >= 0) events.splice(i, 1);
      events.push(ev);
      for (const fn of listeners) fn(ev, 'hub');
    },
    query: async (filters) => events.filter((e) => matchFilters(filters, e)),
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
  };
  const pool = { subscribe: (_f, h) => (setTimeout(() => h.oneose?.('wss://r'), 5), { close() {} }) };
  const sync = { publish: async (ev) => (published.push(ev), db.put(ev)) };
  return { net: { db, pool, sync }, published, events };
}

test('the keys: a wrong passphrase is refused, a new one keeps the vault key and its id', async () => {
  const { record, key } = await createKeys(PASS);
  assert.ok(isKeys(record));
  await assert.rejects(createKeys('short'), (err) => err.code === 'vault.error.short');
  await assert.rejects(openKeys(record, 'wrong horse battery'), (err) => err.code === 'vault.error.wrong');
  const sealed = await sealItem(key, 'a1', { name: 'Shop', password: 'hunter2' });
  assert.deepEqual(await openItem(await openKeys(record, PASS), 'a1', sealed), { name: 'Shop', password: 'hunter2' });
  const next = await changePassphrase(record, PASS, 'a new passphrase here');
  assert.equal(next.id, record.id, 'the same vault');
  assert.notEqual(next.kdf.salt, record.kdf.salt, 'a new salt');
  await assert.rejects(changePassphrase(record, 'wrong horse battery', 'whatever else'), (err) => err.code === 'vault.error.wrong');
  await assert.rejects(openKeys(next, PASS), (err) => err.code === 'vault.error.wrong');
  assert.equal((await openItem(await openKeys(next, 'a new passphrase here'), 'a1', sealed)).password, 'hunter2', 'entries need no new sealing');
});

test('an entry is bound to its address, and a long one is compressed', async () => {
  const { key } = await createKeys(PASS);
  const sealed = await sealItem(key, 'a1', { password: 'hunter2' });
  await assert.rejects(openItem(key, 'b2', sealed), 'moved to another address, it does not open');
  const long = { notes: 'lorem ipsum '.repeat(500) };
  const big = await sealItem(key, 'n1', long);
  assert.equal(Buffer.from(big, 'base64url')[0], 2, 'gzipped');
  assert.ok(big.length < 2000);
  assert.deepEqual(await openItem(key, 'n1', big), long);
});

test('entries sync between two devices of the key; the relay sees no name, password or type', async () => {
  const { record, key } = await createKeys(PASS);
  const A = device();
  const a = await new VaultStore(id, A.net).start();
  await assert.rejects(a.put({ type: 'login', name: 'x' }), 'locked: nothing is written');
  await a.unlock(key);
  const shop = await a.put({ type: 'login', name: 'Shop', username: 'ada@example.org', password: 'first-password', urls: ['https://shop.example'] });
  await a.put({ type: 'note', name: 'Wifi', notes: 'the router is in the hall' });
  await a.put({ type: 'totp', name: 'Mail', username: 'ada', totp: { secret: 'JBSWY3DPEHPK3PXP' } });
  assert.deepEqual(
    a.list().map((e) => e.name),
    ['Mail', 'Shop', 'Wifi'],
  );
  const onRelay = JSON.stringify(A.published);
  for (const s of ['Shop', 'ada@example.org', 'first-password', 'login', 'Wifi', 'JBSWY3DPEHPK3PXP']) assert.ok(!onRelay.includes(s), `no ${s} on the relay`);
  assert.ok(A.published.every((e) => e.kind === KINDS.VAULT_ITEM && e.tags.length === 1));

  // another device: the events arrive sealed; opened with the key from the record and the passphrase
  const B = device();
  for (const ev of A.events) await B.net.db.put(ev);
  const b = await new VaultStore(id, B.net).start();
  assert.equal(b.count, 3);
  assert.equal(b.list().length, 0, 'locked: nothing readable');
  await b.unlock(await openKeys(record, PASS));
  assert.equal(b.get(shop.id).password, 'first-password');
  assert.equal(b.list().find((e) => e.name === 'Mail').totp.secret, 'JBSWY3DPEHPK3PXP');

  // a new password keeps the old one in the history; B sees it when the event arrives
  const changed = await a.put({ id: shop.id, password: 'second-password' });
  assert.equal(changed.history[0].password, 'first-password');
  assert.ok(changed.changed >= changed.created);
  await B.net.db.put(A.published.at(-1));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(b.get(shop.id).password, 'second-password');

  // an older version arriving late changes nothing
  const old = A.published.find((e) => e.tags[0][1] === shop.id);
  await b.receive(old);
  assert.equal(b.get(shop.id).password, 'second-password');

  // a deletion is an edit like any other to the relay
  await a.remove(shop.id);
  const del = A.published.at(-1);
  assert.ok(del.content.length > 20, 'a sealed note, not an empty event');
  await B.net.db.put(del);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(b.get(shop.id), null);
  assert.equal(b.list().length, 2);

  // locked: every value forgotten
  b.lock();
  assert.equal(b.list().length, 0);
  assert.equal(b.open, false);
});

test('a vault removed when its passphrase is lost: every entry emptied; a vault made anew does not read the old ones', async () => {
  const first = await createKeys(PASS);
  const A = device();
  const a = await new VaultStore(id, A.net).start();
  await a.unlock(first.key);
  await a.put({ type: 'note', name: 'One' });
  await a.put({ type: 'note', name: 'Two' });
  a.lock();
  await a.clear();
  assert.equal(a.count, 0);
  assert.ok(A.published.slice(-2).every((e) => e.content === ''));
  const second = await createKeys('another passphrase');
  assert.notEqual(second.record.id, first.record.id);
  await a.unlock(second.key);
  assert.equal(a.list().length, 0);
  await a.put({ type: 'note', name: 'Three' });
  assert.deepEqual(
    a.list().map((e) => e.name),
    ['Three'],
  );
});

test('entries are cleaned: unknown types refused, limits kept, a bad 2FA secret dropped, unknown fields kept', () => {
  assert.equal(cleanItem({ type: 'nope!' }), null);
  assert.equal(cleanItem(null), null);
  const e = cleanItem({ type: 'login', name: 'x'.repeat(500), totp: { secret: 'not base32!' }, urls: [' https://a ', '', 'https://b'], tags: ['a', 'a', ' b '], future: 42 });
  assert.equal(e.name.length, 200);
  assert.equal(e.totp, null);
  assert.deepEqual(e.urls, ['https://a', 'https://b']);
  assert.deepEqual(e.tags, ['a', 'b']);
  assert.equal(e.future, 42);
  assert.equal(cleanItem({ type: 'card', card: { number: '4111 1111-1111 1111x' } }).card.number, '4111 11111111 1111');
});

test('backups: the vault as it is, opened with its passphrase; 0.26 authenticator backups too', async () => {
  const { record, key } = await createKeys(PASS);
  const A = device();
  const a = await new VaultStore(id, A.net).start();
  await a.unlock(key);
  await a.put({ type: 'login', name: 'Shop', password: 'p1' });
  const gone = await a.put({ type: 'note', name: 'Gone' });
  await a.remove(gone.id);
  const file = JSON.parse(JSON.stringify(backupOf(record, a.sealed())));
  assert.ok(!JSON.stringify(file).includes('p1'));
  await assert.rejects(readBackup(file, 'wrong horse battery'), (err) => err.code === 'vault.error.wrong');
  const back = await readBackup(file, PASS);
  assert.equal(back.kind, 'vault');
  assert.deepEqual(
    back.items.map((i) => i.name),
    ['Shop'],
  );
  const v1 = await createVault(PASS, [{ id: 'x', issuer: 'Old', account: 'ada', secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30 }]);
  const old = await readBackup({ type: 'kiwi-authenticator-backup', v: 1, vault: v1.record }, PASS);
  assert.equal(old.kind, 'authenticator');
  assert.equal(old.items[0].issuer, 'Old');
  await assert.rejects(readBackup({ hello: 1 }, PASS), (err) => err.code === 'vault.error.notBackup');
});
