import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { buildBlockList, readBlockList, buildReport, REPORT_TYPES } from '../../shared/moderation.js';
import { KINDS } from '../../shared/events.js';

const key = () => bytesToHex(generateSecretKey());

test('a block list is a private NIP-51 mute list only its owner can read', async () => {
  const sk = key();
  const other = bytesToHex(generateSecretKey());
  const victim = getPublicKey(generateSecretKey());
  const event = buildBlockList([{ pubkey: victim, reason: 'spam' }], sk);
  assert.equal(event.kind, KINDS.MUTE_LIST);
  assert.ok(verifyEvent(event));
  assert.deepEqual(event.tags, [], 'nothing public');
  assert.ok(!event.content.includes(victim), 'the pubkey is not visible');
  assert.deepEqual(await readBlockList(event, sk), [{ pubkey: victim, reason: 'spam' }]);
  assert.deepEqual(await readBlockList(event, other), [], 'another key reads nothing');
});

test('reports follow NIP-56', () => {
  const sk = key();
  const who = getPublicKey(generateSecretKey());
  const r = buildReport({ pubkey: who, eventId: 'a'.repeat(64), type: 'spam', text: 'bot' }, sk);
  assert.equal(r.kind, KINDS.REPORT);
  assert.deepEqual(r.tags, [['p', who, 'spam'], ['e', 'a'.repeat(64), 'spam']]);
  assert.equal(r.content, 'bot');
  assert.equal(buildReport({ pubkey: who, type: 'nonsense' }, sk).tags[0][2], 'other');
  assert.ok(REPORT_TYPES.includes('illegal'));
});
