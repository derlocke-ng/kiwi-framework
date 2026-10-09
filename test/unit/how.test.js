import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HOW, HOW_TOPICS, howKey, howLines } from '../../shared/how.js';
import { useCatalogs } from '../../shared/i18n.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const en = JSON.parse(fs.readFileSync(path.join(root, 'shared/locales/en.json'), 'utf8'));

test('every topic has its text, and every how.* text is a topic', () => {
  assert.ok(en['how.title']);
  for (const topic of HOW_TOPICS) assert.ok(en[`how.${topic}`], `how.${topic} is missing`);
  const texts = Object.keys(en).filter((k) => k.startsWith('how.') && k !== 'how.title');
  assert.deepEqual(
    texts.filter((k) => !HOW_TOPICS.includes(k.slice(4))),
    [],
    'a text without a topic',
  );
});

test('every preset uses known topics, each once', () => {
  for (const [kind, items] of Object.entries(HOW)) {
    for (const item of items) assert.ok(HOW_TOPICS.includes(item), `HOW.${kind}: unknown topic ${item}`);
    assert.equal(new Set(items).size, items.length, `HOW.${kind} repeats a topic`);
  }
  assert.ok(HOW.hub.length <= 8, 'the hub keeps it short');
});

test('topics and app keys become lines', () => {
  assert.equal(howKey('media'), 'how.media');
  assert.equal(howKey('db.how.1'), 'db.how.1');
  useCatalogs({ lang: 'en', catalog: { 'how.media': 'Photos…', 'my.how.1': 'Mine' } });
  assert.deepEqual(howLines(['my.how.1', 'media']), ['Mine', 'Photos…']);
});
