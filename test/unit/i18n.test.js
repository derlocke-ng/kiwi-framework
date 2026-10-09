import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, pickLanguage, useCatalogs, t, tErr, relTime } from '../../shared/i18n.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
// The framework's catalogs: the shared one and the hub's. A distribution tests its own and its apps' the same way.
const DIRS = ['shared/locales', 'hub/locales'];
const read = (dir, lang) => JSON.parse(fs.readFileSync(path.join(root, dir, `${lang}.json`), 'utf8'));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const tags = (s) => [...String(s).matchAll(/<\/?[a-z]+/g)].map((m) => m[0]).sort().join(',');
const forms = (v) => (typeof v === 'object' ? Object.values(v) : [v]);

test('every language has every key of the English catalog, with the same placeholders and markup', () => {
  for (const dir of DIRS) {
    const en = read(dir, 'en');
    for (const lang of Object.keys(LANGUAGES)) {
      const cat = read(dir, lang);
      assert.deepEqual(Object.keys(cat).filter((k) => !(k in en)), [], `${dir}/${lang}.json has keys English lacks`);
      assert.deepEqual(Object.keys(en).filter((k) => !(k in cat)), [], `${dir}/${lang}.json misses keys`);
      const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      for (const [key, value] of Object.entries(en)) {
        const other = cat[key];
        assert.equal(typeof other, typeof value, `${dir}/${lang}.json ${key}: plural object vs string`);
        if (typeof value === 'object') {
          assert.deepEqual(categories.filter((c) => !(c in other)), [], `${dir}/${lang}.json ${key} lacks plural forms`);
        }
        for (const form of forms(other)) {
          assert.equal(placeholders(form), placeholders(forms(value)[0]), `${dir}/${lang}.json ${key}: placeholders differ`);
          assert.equal(tags(form), tags(forms(value)[0]), `${dir}/${lang}.json ${key}: markup differs`);
          assert.ok(String(form).trim().length, `${dir}/${lang}.json ${key} is empty`);
        }
      }
    }
  }
});

test('no HTML entities in the catalogs: text is shown as text, markup uses real tags', () => {
  for (const dir of DIRS) {
    for (const lang of Object.keys(LANGUAGES)) {
      for (const [key, value] of Object.entries(read(dir, lang))) {
        for (const form of forms(value)) assert.doesNotMatch(String(form), /&[a-z]+;|&#\d+;/, `${dir}/${lang}.json ${key}: write the character itself`);
      }
    }
  }
});

test('picks the best supported language from browser preferences', () => {
  assert.equal(pickLanguage(['de-DE', 'en-US']), 'de');
  assert.equal(pickLanguage(['pt-BR']), 'pt');
  assert.equal(pickLanguage(['ja', 'fr-CA']), 'fr');
  assert.equal(pickLanguage(['ja']), 'en');
  assert.equal(pickLanguage([]), 'en');
});

test('translates with placeholders, plural forms and English fallback', () => {
  useCatalogs({
    lang: 'pl',
    catalog: { 'x.items': { one: '{n} rzecz', few: '{n} rzeczy', many: '{n} rzeczy', other: '{n} rzeczy' }, 'x.hi': 'Cześć, {name}!' },
    fallback: { 'x.items': { one: '{n} item', other: '{n} items' }, 'x.hi': 'Hi {name}!', 'x.only': 'English only', 'time.justNow': 'just now' },
  });
  assert.equal(t('x.items', { n: 1 }), '1 rzecz');
  assert.equal(t('x.items', { n: 3 }), '3 rzeczy');
  assert.equal(t('x.items', { n: 25 }), '25 rzeczy');
  assert.equal(t('x.hi', { name: 'Ola' }), 'Cześć, Ola!');
  assert.equal(t('x.only'), 'English only');
  assert.equal(t('x.missing'), 'x.missing');
  assert.equal(t('x.hi'), 'Cześć, {name}!', 'missing params stay visible');
  const err = Object.assign(new Error('fallback text'), { code: 'x.only' });
  assert.equal(tErr(err), 'English only');
  assert.equal(tErr(new Error('plain')), 'plain');
  assert.equal(relTime(Date.now() - 1000), 'just now');
  assert.match(relTime(Date.now() - 3 * 864e5), /3/);
});
