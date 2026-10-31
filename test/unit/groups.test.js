// The invite link: it names the group, its host and a token, never a key; a member's own link has no token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLink, parseGroupLink } from '../../shared/groups.js';

const pub = 'a'.repeat(64);
const host = 'b'.repeat(64);

test('a link round-trips through its parts, with the name escaped', () => {
  const link = groupLink('https://x.test/armory/uplink/', { pub, host, invite: 'Tok_en-12345', name: 'Crew & friends' });
  assert.equal(link, `https://x.test/armory/uplink/#/group/${pub}/${host}/Tok_en-12345/Crew%20%26%20friends`);
  assert.deepEqual(parseGroupLink(link), { pub, host, invite: 'Tok_en-12345', name: 'Crew & friends' });
});

test('the token is optional: a member’s link reads "-" or nothing as no token', () => {
  assert.deepEqual(parseGroupLink(`#/group/${pub}/${host}/-/Crew`), { pub, host, invite: '', name: 'Crew' });
  assert.deepEqual(parseGroupLink(`#/group/${pub}/${host}`), { pub, host, invite: '', name: '' });
});

test('anything else is not a group link', () => {
  assert.equal(parseGroupLink(`#/group/${pub}`), null);
  assert.equal(parseGroupLink(`#/room/abcdefgh`), null);
  assert.equal(parseGroupLink('https://x.test/#/group/nothex/alsonot'), null);
});
