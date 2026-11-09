// New passwords: random characters from the classes chosen (at least one of
// each), or a passphrase of random words from the BIP-39 English list (2048
// words, 11 bits each). Every choice is uniform: crypto.getRandomValues with
// rejection, never a modulo's bias. The choices are this device's
// (localStorage), as a generator's settings are in other managers.
import { wordlist } from '../../../shared/wordlist.mjs';

export const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
};
const AMBIGUOUS = new Set('Il1O0o|');
export const DEFAULTS = { mode: 'password', length: 20, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: false, words: 6, separator: '-', capitalize: true, number: false };
const KEY = 'vault.generator';

/** A uniform integer in [0, n). */
export function randomInt(n) {
  if (!(n > 0) || n > 2 ** 32) throw new Error('bad range');
  const limit = 2 ** 32 - (2 ** 32 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

const pick = (s) => s[randomInt(s.length)];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The character sets a choice gives (without the look-alikes when asked). */
export function setsOf(o) {
  return Object.keys(SETS)
    .filter((k) => o[k])
    .map((k) => [...SETS[k]].filter((c) => !o.avoidAmbiguous || !AMBIGUOUS.has(c)).join(''));
}

/** Clean options: lengths in their ranges, at least one class. */
export function options(o = {}) {
  const v = { ...DEFAULTS, ...o };
  v.mode = v.mode === 'passphrase' ? 'passphrase' : 'password';
  v.length = Math.min(128, Math.max(8, Math.round(Number(v.length) || DEFAULTS.length)));
  v.words = Math.min(12, Math.max(3, Math.round(Number(v.words) || DEFAULTS.words)));
  v.separator = typeof v.separator === 'string' ? v.separator.slice(0, 3) : '-';
  if (!Object.keys(SETS).some((k) => v[k])) v.lower = true;
  for (const k of ['lower', 'upper', 'digits', 'symbols', 'avoidAmbiguous', 'capitalize', 'number']) v[k] = Boolean(v[k]);
  return v;
}

/**
 * A new password or passphrase and the bits of entropy it carries.
 * @param {Partial<typeof DEFAULTS>} [o]
 * @returns {{ value: string, bits: number }}
 */
export function generate(o = {}) {
  const v = options(o);
  if (v.mode === 'passphrase') {
    const words = Array.from({ length: v.words }, () => pick(wordlist));
    const shown = v.capitalize ? words.map((w) => w[0].toUpperCase() + w.slice(1)) : words;
    if (v.number) {
      const i = randomInt(shown.length);
      shown[i] += String(randomInt(10));
    }
    const bits = v.words * Math.log2(wordlist.length) + (v.number ? Math.log2(10 * v.words) : 0);
    return { value: shown.join(v.separator), bits: Math.floor(bits) };
  }
  const sets = setsOf(v);
  const all = sets.join('');
  const chars = sets.map(pick); // one of each class chosen
  while (chars.length < v.length) chars.push(pick(all));
  return { value: shuffle(chars).join(''), bits: Math.floor(v.length * Math.log2(all.length)) };
}

/** This device's generator choices. */
export function savedOptions() {
  try {
    return options(JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    return options();
  }
}

export function saveOptions(o) {
  try {
    localStorage.setItem(KEY, JSON.stringify(options(o)));
  } catch {
    /* storage blocked: the choice holds for this page */
  }
}
