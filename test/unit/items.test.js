import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItemText, splitLines, between, endOrders, sortItems, stats, listToMarkdown, isHeader } from '../../shared/items.js';

test('parses quantities', () => {
  assert.deepEqual(parseItemText('2x milk'), { t: 'milk', d: 0, q: 2 });
  assert.deepEqual(parseItemText('2 × Eggs'), { t: 'Eggs', d: 0, q: 2 });
  assert.deepEqual(parseItemText('bread x3'), { t: 'bread', d: 0, q: 3 });
  assert.deepEqual(parseItemText('3 apples'), { t: '3 apples', d: 0, q: null });
  assert.deepEqual(parseItemText('Xbox controller'), { t: 'Xbox controller', d: 0, q: null });
});

test('strips list and task markers', () => {
  assert.deepEqual(parseItemText('- [x] eggs'), { t: 'eggs', d: 1, q: null });
  assert.deepEqual(parseItemText('* [ ] 2x butter'), { t: 'butter', d: 0, q: 2 });
  assert.deepEqual(parseItemText('1. call mum'), { t: 'call mum', d: 0, q: null });
});

test('count lists default to one and accept "name: n"', () => {
  assert.deepEqual(parseItemText('AA batteries: 12', 'count'), { t: 'AA batteries', d: 0, q: 12 });
  assert.deepEqual(parseItemText('Light bulbs', 'count'), { t: 'Light bulbs', d: 0, q: 1 });
  assert.deepEqual(parseItemText('ratio: 3', 'check'), { t: 'ratio: 3', d: 0, q: null });
});

test('headers stay as typed', () => {
  assert.ok(isHeader('# Produce'));
  assert.ok(!isHeader('#hashtag'));
  assert.deepEqual(parseItemText('## Dairy', 'count'), { t: '## Dairy', d: 0, q: null });
});

test('splits pasted text', () => {
  assert.deepEqual(splitLines('milk\r\n\n  eggs \n'), ['milk', 'eggs']);
});

test('orders between neighbours', () => {
  assert.equal(between(null, null), 0);
  assert.equal(between(null, 5), 4);
  assert.equal(between(5, null), 6);
  assert.equal(between(1, 2), 1.5);
  assert.equal(between(1, 1 + 1e-12), null);
  assert.deepEqual(endOrders([{ o: 3 }, { o: 1 }], 2), [4, 5]);
  assert.deepEqual(endOrders([{ o: 2.5 }], 1), [3]);
  assert.deepEqual(endOrders([], 2), [0, 1]);
});

test('sorts and counts', () => {
  const items = [
    { id: 'a', t: 'b', d: 0, o: 2, c: 1 },
    { id: 'b', t: 'a', d: 0, o: 1, c: 1 },
    { id: 'c', t: 'x', d: 1, o: 0, c: 1, u: 5 },
    { id: 'd', t: 'y', d: 1, o: 0, c: 1, u: 9 },
    { id: 'e', t: '# Head', d: 0, o: 0, c: 1 },
  ];
  const { active, done } = sortItems(items);
  assert.deepEqual(active.map((i) => i.id), ['e', 'b', 'a']);
  assert.deepEqual(done.map((i) => i.id), ['d', 'c']);
  assert.deepEqual(stats(items), { total: 4, done: 2 });
});

test('exports markdown', () => {
  const items = [
    { t: '# Dairy', d: 0, o: 0 },
    { t: 'milk', d: 0, q: 2, o: 1 },
    { t: 'eggs', d: 1, o: 2, u: 1 },
  ];
  assert.equal(listToMarkdown('Groceries', items), '# Groceries\n\n## Dairy\n- [ ] milk ×2\n- [x] eggs\n');
  assert.equal(listToMarkdown('Stock', [{ t: 'bulbs', q: 3, o: 0 }], 'count'), '# Stock\n\n- bulbs: 3\n');
});
