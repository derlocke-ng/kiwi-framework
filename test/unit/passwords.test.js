// The password manager's own parts: the generator (classes kept, lengths, passphrases from the word
// list), the strength estimate, the breach check's k-anonymity (only five hex characters leave), the
// imports from other managers and the exports for them.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { generate, options, randomInt, setsOf } = await import('../../apps/vault/data/generate.js');
const { strength } = await import('../../apps/vault/data/strength.js');
const { pwnedCount, RANGE_URL } = await import('../../apps/vault/data/breach.js');
const { fromCsv, importFile, parseCsv } = await import('../../apps/vault/data/import.js');
const { toCsv, toJson } = await import('../../apps/vault/data/export.js');
const { cleanItem } = await import('../../shared/vaultstore.js');
const { wordlist } = await import('../../shared/wordlist.mjs');

test('generated passwords: the length asked, one of every class chosen, look-alikes left out when asked', () => {
  for (let i = 0; i < 200; i++) {
    const { value, bits } = generate({ length: 12 });
    assert.equal(value.length, 12);
    assert.match(value, /[a-z]/);
    assert.match(value, /[A-Z]/);
    assert.match(value, /[0-9]/);
    assert.match(value, /[^a-zA-Z0-9]/);
    assert.ok(bits >= 70);
  }
  const digits = generate({ length: 8, lower: false, upper: false, digits: true, symbols: false });
  assert.match(digits.value, /^\d{8}$/);
  for (let i = 0; i < 100; i++) assert.doesNotMatch(generate({ length: 40, avoidAmbiguous: true }).value, /[Il1O0o|]/);
  assert.equal(options({ length: 3 }).length, 8, 'at least 8');
  assert.equal(options({ length: 999 }).length, 128);
  assert.equal(options({ lower: false, upper: false, digits: false, symbols: false }).lower, true, 'never no class at all');
  assert.equal(setsOf(options({ avoidAmbiguous: true }))[0].includes('l'), false);
});

test('passphrases: words from the list, a separator, capitals and a number when asked; 11 bits a word', () => {
  assert.equal(wordlist.length, 2048);
  const { value, bits } = generate({ mode: 'passphrase', words: 5, separator: '.', capitalize: false });
  const words = value.split('.');
  assert.equal(words.length, 5);
  for (const w of words) assert.ok(wordlist.includes(w), w);
  assert.equal(bits, 55);
  const withNumber = generate({ mode: 'passphrase', words: 4, number: true, capitalize: true }).value;
  assert.match(withNumber, /\d/);
  assert.match(withNumber, /^[A-Z]/);
});

test('randomInt is uniform enough and in range', () => {
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 6000; i++) counts[randomInt(6)]++;
  for (const c of counts) assert.ok(c > 850 && c < 1150, String(counts));
  assert.throws(() => randomInt(0));
});

test('strength: common passwords, patterns and word phrases score low; random ones high', () => {
  assert.equal(strength('').level, 0);
  assert.equal(strength('password').level, 0);
  assert.equal(strength('Password123').level, 0);
  assert.equal(strength('qwerty123').level, 0);
  assert.ok(strength('aaaaaaaaaaaa').level <= 1, 'a run');
  assert.ok(strength('abcdefghijkl').level <= 1, 'a sequence');
  assert.ok(strength('asdfghjkl').level <= 1, 'a keyboard row');
  assert.ok(strength('correct horse zebra').bits < 50, 'three words of the list are three words, not 21 letters');
  assert.ok(strength('Correct-Horse-Zebra-Ozone-Wrist-Paper').level >= 3, 'six are many');
  assert.ok(strength(generate({ length: 20 }).value).level >= 3);
  assert.ok(strength(generate({ mode: 'passphrase', words: 7 }).value).level >= 3);
});

test('the breach check sends five hex characters of the SHA-1, nothing else, and finds the suffix', async () => {
  const asked = [];
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const fake = async (url, init) => {
    asked.push({ url, init });
    return { ok: true, text: async () => '0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365\r\nFFFF:0' };
  };
  assert.equal(await pwnedCount('password', fake), 9659365);
  assert.equal(asked[0].url, `${RANGE_URL}5BAA6`);
  assert.equal(asked[0].init.headers['Add-Padding'], 'true');
  assert.equal(await pwnedCount('password', fake), 9659365);
  assert.equal(asked.length, 1, 'asked once per page');
  assert.equal(await pwnedCount('a password nobody uses 7f3', async () => ({ ok: true, text: async () => 'ABC:1' })), 0);
});

test('CSV: quotes, commas and line breaks in fields; columns found by name', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"\nthere'],
  ]);
  const chrome = fromCsv('name,url,username,password,note\nShop,https://shop.example/login,ada,s3cret,"two\nlines"\n');
  assert.deepEqual(
    chrome.map((e) => [e.type, e.name, e.username, e.password, e.urls[0], e.notes]),
    [['login', 'Shop', 'ada', 's3cret', 'https://shop.example/login', 'two\nlines']],
  );
  const firefox = fromCsv('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://www.mail.example","bob","pw","","","{x}","1","2","3"\n');
  assert.equal(firefox[0].name, 'mail.example', 'named after the site when the file has no names');
  assert.equal(fromCsv('a,b\n1,2\n'), null, 'not a password export');
});

test('imports: Bitwarden CSV and JSON, KeePassXC CSV, otpauth lists, this vault’s export', () => {
  const bw = importFile(
    'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\nWork,1,login,Git,,,0,https://git.example,ada,pw1,otpauth://totp/Git:ada?secret=JBSWY3DPEHPK3PXP&issuer=Git\n,,note,Wifi,router in the hall,,0,,,,\n',
    'bitwarden.csv',
  );
  assert.deepEqual(
    bw.map((e) => [e.type, e.name, e.fav, e.tags, e.totp?.secret || null]),
    [
      ['login', 'Git', true, ['Work'], 'JBSWY3DPEHPK3PXP'],
      ['note', 'Wifi', false, [], null],
    ],
  );
  const json = importFile(
    JSON.stringify({
      encrypted: false,
      folders: [{ id: 'f1', name: 'Banking' }],
      items: [
        { type: 1, name: 'Bank', folderId: 'f1', favorite: true, login: { username: 'ada', password: 'pw', uris: [{ uri: 'https://bank.example' }], totp: 'JBSWY3DPEHPK3PXP' }, fields: [{ name: 'PIN', value: '1234', type: 1 }] },
        { type: 3, name: 'Visa', card: { cardholderName: 'Ada L', number: '4111111111111111', expMonth: '7', expYear: '2029', code: '123', brand: 'Visa' } },
        { type: 2, name: 'Note', notes: 'hello' },
      ],
    }),
  );
  assert.equal(json[0].tags[0], 'Banking');
  assert.deepEqual(json[0].fields, [{ name: 'PIN', value: '1234', hidden: true }]);
  assert.equal(json[1].card.exp, '07/29');
  assert.equal(json[2].type, 'note');
  assert.throws(() => importFile(JSON.stringify({ encrypted: true, items: [] })), (err) => err.code === 'pw.import.encrypted');
  const kx = importFile('"Group","Title","Username","Password","URL","Notes","TOTP","Icon","Last Modified","Created"\n"Root/Mail","Mail","bob","pw","https://mail.example","","JBSWY3DPEHPK3PXP","0","",""\n');
  assert.deepEqual([kx[0].name, kx[0].tags, kx[0].totp.secret], ['Mail', ['Mail'], 'JBSWY3DPEHPK3PXP']);
  const links = importFile('otpauth://totp/Shop:ada?secret=JBSWY3DPEHPK3PXP&issuer=Shop\notpauth://totp/Mail:bob?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Mail\n');
  assert.deepEqual(
    links.map((e) => [e.type, e.name, e.username]),
    [
      ['totp', 'Shop', 'ada'],
      ['totp', 'Mail', 'bob'],
    ],
  );
  assert.equal(importFile('just some text'), null);
});

test('exports: JSON round-trips, CSV in Bitwarden’s columns reads back', () => {
  const items = [
    cleanItem({ id: 'a', type: 'login', name: 'Git, work', username: 'ada', password: 'p"w', urls: ['https://git.example'], totp: { secret: 'JBSWY3DPEHPK3PXP' }, tags: ['Work'], fav: true, fields: [{ name: 'PIN', value: '1' }] }),
    cleanItem({ id: 'b', type: 'note', name: 'Wifi', notes: 'line one\nline two' }),
    cleanItem({ id: 'c', type: 'card', name: 'Visa', card: { number: '4111111111111111' } }),
  ];
  const back = importFile(toJson(items));
  assert.deepEqual(
    back.map((e) => e.name),
    ['Git, work', 'Wifi', 'Visa'],
  );
  assert.equal(back[0].id, undefined, 'no addresses in an export');
  const csv = toCsv(items);
  const read = importFile(csv, 'x.csv');
  assert.deepEqual(
    read.map((e) => [e.type, e.name, e.password, e.notes, e.totp?.secret || null, e.fav, e.tags]),
    [
      ['login', 'Git, work', 'p"w', '', 'JBSWY3DPEHPK3PXP', true, ['Work']],
      ['note', 'Wifi', '', 'line one\nline two', null, false, []],
    ],
  );
});
