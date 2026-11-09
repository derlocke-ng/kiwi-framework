// How hard a password is to guess, roughly: the bits its length and kinds of
// characters give, less what patterns take away (a run of the same character,
// a sequence like abc or 321, a keyboard row, a word or a well-known
// password). An estimate, not zxcvbn: enough to point at the weak ones in the
// vault's health report, made on the device.
import { wordlist } from '../../../shared/wordlist.mjs';

const WORDS = new Set(wordlist);
// the most used passwords (lists of leaked passwords agree on these): any of them, or one with digits added, is guessed at once
const COMMON = new Set(
  'password passw0rd p@ssw0rd 123456 12345678 123456789 1234567890 qwerty qwertz azerty 111111 000000 abc123 letmein welcome monkey dragon iloveyou admin login master sunshine princess football baseball shadow superman trustno1 hello freedom whatever starwars secret passwort motdepasse contraseña changeme default root toor test guest qwerty123 1q2w3e4r zaq12wsx asdfgh asdfghjkl'.split(
    ' ',
  ),
);
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', 'qwertzuiop', 'yxcvbnm', 'azertyuiop', 'wxcvbn', '1234567890'];

/** The size of the alphabet the characters come from. */
function alphabet(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n += 26;
  if (/[A-Z]/.test(pw)) n += 26;
  if (/[0-9]/.test(pw)) n += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) n += /[^\x20-\x7e]/.test(pw) ? 100 : 33;
  return n || 1;
}

/** The length that counts: runs, sequences and keyboard rows of three or more count as one character each. */
function effectiveLength(pw) {
  const s = pw.toLowerCase();
  let n = 0;
  let i = 0;
  while (i < s.length) {
    let j = i + 1;
    const step = s.charCodeAt(i + 1) - s.charCodeAt(i);
    if (Math.abs(step) <= 1) while (j < s.length && s.charCodeAt(j) - s.charCodeAt(j - 1) === step) j++;
    let k = i + 1;
    for (const row of ROWS) {
      const at = row.indexOf(s[i]);
      if (at < 0) continue;
      let m = i + 1;
      while (m < s.length && row[at + (m - i)] === s[m]) m++;
      k = Math.max(k, m);
    }
    const end = Math.max(j, k);
    n += 1; // a pattern of three or more is guessed as one piece
    i = end - i >= 3 ? end : i + 1;
  }
  return n;
}

/**
 * Bits of guessing a password takes, and a level: 0 very weak, 1 weak, 2 fair, 3 strong, 4 very strong.
 * @param {string} pw
 */
export function strength(pw) {
  const s = String(pw || '');
  if (!s) return { bits: 0, level: 0 };
  if (COMMON.has(s.toLowerCase()) || COMMON.has(s.toLowerCase().replace(/[\d!.]+$/, ''))) return { bits: 4, level: 0 };
  let bits = effectiveLength(s) * Math.log2(alphabet(s));
  // words: a word of the list counts as one of 2048, not as its letters (a phrase of words is as strong as its words)
  const segments = s.split(/([^a-zA-Z]+)/).filter(Boolean);
  if (segments.some((seg) => WORDS.has(seg.toLowerCase()))) {
    const byWords = segments.reduce((sum, seg) => sum + (WORDS.has(seg.toLowerCase()) ? 11 : effectiveLength(seg) * Math.log2(alphabet(seg))), 0);
    bits = Math.min(bits, byWords);
  }
  bits = Math.round(bits);
  const level = bits < 28 ? 0 : bits < 36 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, level };
}
