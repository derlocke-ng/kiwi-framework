// What happens to a message after it is sent, in a conversation or a group.
// A reply names the message it answers (an `e` tag, as NIP-17 has it). A
// reaction (NIP-25, kind 7), an edit (kind 7830), a pin (kind 7831) and a
// deletion (NIP-09, kind 5) are events of their own that name a message;
// they travel sealed like the messages, inside the same gift wraps
// (shared/chat.js) or group seals (shared/groups.js), and arrive in any
// order, before the message or long after. So the store keeps them beside the
// messages (shared/store.js, putChange) and fold() applies them whenever a
// conversation is read: the newest edit by the writer, one reaction per
// person (their newest), the newest pin or unpin, a deletion by whoever wrote
// the thing it deletes. A deletion also erases the text in the store at once.
//
// A conversation can make its messages disappear: each then carries a NIP-40
// `expiration`, on the sealed message and on the wraps or the group event
// around it, so relays that keep to NIP-40 drop them and every device purges
// them on time (store.purgeExpired). What a message's changes say goes with it.
//
//   const change = changeOf(rumor, { conv, from, t });   if (change) await db.putChange(change);
//   const shown = fold(await db.messages(conv), await db.changes(conv), me);

import { expiryOf, isHex64, KINDS, now } from './events.js';

const TEXT = 4000; // as long as a message (shared/chat.js)
const EMOJI = 32; // a reaction is one emoji (with its joiners and skin tones), or a short custom one
export const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
/** The timers a conversation offers, in seconds; 0: messages stay. */
export const TIMERS = [0, 300, 3600, 28_800, 86_400, 604_800, 2_419_200];
export const MAX_TIMER = 2_419_200;
/** Kinds that change a message rather than being one. */
export const CHANGE_KINDS = [KINDS.REACTION, KINDS.DELETION, KINDS.CHAT_EDIT, KINDS.CHAT_PIN];

/** A timer as sent and stored: whole seconds between 0 and four weeks. */
export const cleanTimer = (s) => Math.min(MAX_TIMER, Math.max(0, Math.floor(Number(s) || 0)));

/** The emoji of a reaction: NIP-25's "+" and "" are a like, "-" a dislike. */
export function reactionOf(content) {
  const s = String(content ?? '').trim();
  if (s === '+' || s === '') return '👍';
  if (s === '-') return '👎';
  return /\s/.test(s) ? '' : s.slice(0, EMOJI);
}

/**
 * The change a sealed event makes, or null when it makes none we know.
 * `conv`: the conversation it was read in (the other person, or the group); `from`: who signed or sealed it;
 * `t`: its time in milliseconds.
 * @param {{ id: string, kind: number, content: string, tags: string[][] }} rumor
 * @param {{ conv: string, from: string, t: number }} where
 */
export function changeOf(rumor, { conv, from, t }) {
  const es = rumor.tags.filter((x) => x[0] === 'e' && isHex64(String(x[1]).toLowerCase())).map((x) => String(x[1]).toLowerCase());
  if (!es.length || !isHex64(from)) return null;
  const expires = expiryOf(rumor);
  const base = { ref: rumor.id, conv, from, t, ...(expires ? { expires } : {}) };
  if (rumor.kind === KINDS.REACTION) {
    const emoji = reactionOf(rumor.content);
    return emoji ? { ...base, type: 'react', target: es[es.length - 1], emoji } : null; // NIP-25: the last `e` is what is reacted to
  }
  if (rumor.kind === KINDS.DELETION) return { ...base, type: 'delete', targets: [...new Set(es)].slice(0, 50) };
  if (rumor.kind === KINDS.CHAT_EDIT) {
    const text = String(rumor.content || '')
      .trim()
      .slice(0, TEXT);
    return text ? { ...base, type: 'edit', target: es[0], text } : null;
  }
  if (rumor.kind === KINDS.CHAT_PIN) return { ...base, type: 'pin', target: es[0], on: rumor.content !== 'unpin' };
  return null;
}

/** The message a reply answers: the first `e` tag of a message (NIP-17), or ''. */
export function replyOf(rumor) {
  const e = rumor.tags.find((x) => x[0] === 'e')?.[1];
  return isHex64(String(e || '').toLowerCase()) ? String(e).toLowerCase() : '';
}

const byTime = (a, b) => a.t - b.t || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);

/**
 * Messages as they are now: changes applied, what has run out left out.
 * Each comes back with `reactions` ([{ emoji, from: [pk], mine }], the most given first), `pinned`
 * ({ by, t } or null), `edited` (the time of the edit shown) and `deleted`.
 * @param {any[]} messages  records of the chat table (shared/store.js)
 * @param {any[]} changes  the conversation's changes
 * @param {string} me  my public key
 */
export function fold(messages, changes, me, at = now()) {
  const deleted = new Map(); // what a deletion names -> who asked
  const byTarget = new Map();
  for (const c of changes) {
    if (c.expires && c.expires <= at) continue;
    if (c.type === 'delete') {
      for (const id of c.targets) {
        if (!deleted.has(id)) deleted.set(id, new Set());
        deleted.get(id).add(c.from);
      }
    } else {
      if (!byTarget.has(c.target)) byTarget.set(c.target, []);
      byTarget.get(c.target).push(c);
    }
  }
  const gone = (id, by) => Boolean(deleted.get(id)?.has(by));
  const out = [];
  for (const m of messages) {
    if (m.expires && m.expires <= at) continue;
    if (m.system) {
      out.push(m);
      continue;
    }
    if (m.deleted || gone(m.id, m.from)) {
      const { file: _file, ...rest } = m;
      out.push({ ...rest, text: '', deleted: true, reactions: [], pinned: null });
      continue;
    }
    const list = (byTarget.get(m.id) || []).sort(byTime);
    let text = m.text;
    let edited = 0;
    const per = new Map();
    let pinned = null;
    for (const c of list) {
      if (c.type === 'edit' && c.from === m.from && !m.file) {
        text = c.text;
        edited = c.t;
      } else if (c.type === 'react' && !gone(c.ref, c.from)) per.set(c.from, c);
      else if (c.type === 'pin') pinned = c.on ? { by: c.from, t: c.t } : null;
    }
    const byEmoji = new Map();
    for (const [from, c] of per) {
      if (!byEmoji.has(c.emoji)) byEmoji.set(c.emoji, []);
      byEmoji.get(c.emoji).push(from);
    }
    const reactions = [...byEmoji].map(([emoji, from]) => ({ emoji, from, mine: from.includes(me) })).sort((a, b) => b.from.length - a.from.length);
    out.push({ ...m, text, ...(edited ? { edited } : {}), reactions, pinned });
  }
  return out;
}

/** The pinned messages of a conversation, newest pin first: [{ id, by, t }]. */
export function pinsOf(changes, at = now()) {
  const last = new Map();
  for (const c of [...changes].filter((c) => c.type === 'pin' && !(c.expires && c.expires <= at)).sort(byTime)) last.set(c.target, c);
  return [...last.values()]
    .filter((c) => c.on)
    .sort((a, b) => b.t - a.t)
    .map((c) => ({ id: c.target, by: c.from, t: c.t }));
}

/** My reactions on a message (their ids), which taking my reaction back deletes. */
export function myReactions(changes, messageId, me) {
  return changes.filter((c) => c.type === 'react' && c.target === messageId && c.from === me).map((c) => c.ref);
}

// ---- calls (shared/calls.js): one line in the conversation for each ----

export const CALL_ACTIONS = ['ring', 'answer', 'decline', 'cancel', 'end'];
const CALL_STATE = { ring: 'ringing', answer: 'answered', decline: 'declined', cancel: 'missed', end: 'ended' };
const CALL_RANK = { ringing: 0, answered: 1, missed: 2, declined: 2, ended: 3 };
const SECRET = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * A call's line from one of its events, or null: `{ id: 'call:<id>', conv, from: <caller>, at, t, system: 'call',
 * call: { id, video, state, secret?, duration?, by } }`. A ring names its caller, who must be its author.
 */
export function callLine(body, { conv, from, group = false, expires = 0 }) {
  if (!body || typeof body !== 'object') return null;
  const id = String(body.id || '');
  const caller = String(body.caller || '');
  const at = Math.floor(Number(body.at) || 0);
  if (!/^[0-9a-f]{32}$/.test(id) || !isHex64(caller) || !CALL_ACTIONS.includes(body.action) || at <= 0) return null;
  if (body.action === 'ring' && (caller !== from || !SECRET.test(String(body.secret || '')))) return null;
  const call = {
    id,
    video: Boolean(body.video),
    state: CALL_STATE[body.action],
    by: from,
    ...(body.action === 'ring' ? { secret: String(body.secret) } : {}),
    ...(body.action === 'end' ? { duration: Math.max(0, Math.min(86_400, Math.floor(Number(body.duration) || 0))) } : {}),
  };
  // the ring's millisecond, carried by every step: the line sorts after a message of the same second that came before it
  const ms = Math.min(999, Math.max(0, Math.floor(Number(body.ms) || 0)));
  return { id: `call:${id}`, conv, ...(group ? { group: true } : {}), from: caller, name: '', at, t: at * 1000 + ms, seq: 0, text: '', system: 'call', call, ...(expires ? { expires } : {}) };
}

/** What two events of one call say together: the furthest state, the secret and video from the ring, the longest duration. */
export function mergeCall(a, b) {
  if (!a) return b;
  const state = (CALL_RANK[b.call.state] ?? 0) > (CALL_RANK[a.call.state] ?? 0) ? b.call.state : a.call.state;
  const duration = Math.max(a.call.duration || 0, b.call.duration || 0);
  const call = { ...a.call, ...b.call, state, video: a.call.video || b.call.video, secret: a.call.secret || b.call.secret, ...(duration ? { duration } : {}) };
  if (!call.secret) delete call.secret;
  return { ...a, seq: a.seq || b.seq, expires: a.expires || b.expires, call };
}

/** Text as search compares it: lower case, accents set aside. */
export const searchable = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Whether a message holds every word of `query` (its text, or its file's name). */
export function matches(m, words) {
  if (m.deleted || m.system) return false;
  const hay = searchable(`${m.text || ''} ${m.file?.name || ''}`);
  return words.every((w) => hay.includes(w));
}
