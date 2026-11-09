// Whether a password is in a known data breach, asked of Have I Been Pwned's
// Pwned Passwords, only when the person turned it on (the owner's choice: an
// outside service, so off unless asked for). k-anonymity: only the first five
// hex characters of the password's SHA-1 leave the device; the service answers
// every hash with that beginning (padded with fake ones, so even the answer's
// size says nothing) and the match is looked up here.
export const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const seen = new Map(); // hash -> count, for this page

async function sha1Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * How often the password was seen in breaches (0: not known to be).
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 */
export async function pwnedCount(password, fetchImpl = fetch) {
  const hash = await sha1Hex(password);
  if (seen.has(hash)) return seen.get(hash);
  const res = await fetchImpl(`${RANGE_URL}${hash.slice(0, 5)}`, { headers: { 'Add-Padding': 'true' }, referrerPolicy: 'no-referrer', credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const suffix = hash.slice(5);
  let count = 0;
  for (const line of (await res.text()).split('\n')) {
    const [s, n] = line.trim().split(':');
    if (s === suffix) count = Number(n) || 0; // a padding line counts 0
  }
  seen.set(hash, count);
  return count;
}
