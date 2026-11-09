// Entries from another password manager's export: Bitwarden's JSON (not
// encrypted), KeePass 2's XML, and the CSV files of Bitwarden, the browsers
// (Chrome, Edge, Firefox, Safari), 1Password, LastPass, Dashlane, Proton Pass
// and KeePassXC, read by their column names; lists of otpauth:// links and
// Google Authenticator exports; and this vault's own plain export. What comes
// in is the vault's entry shape; the vault cleans it (shared/vaultstore.js).
import { cleanEntry, parseMigration, parseOtpauth } from '../../../shared/totp.js';
import { fromAuthenticator } from '../../../shared/vaultstore.js';
import { fail } from '../../../shared/util.js';
import { EXPORT_TYPE } from './export.js';

/** RFC 4180 rows: quoted fields with commas, quotes and line breaks; CRLF or LF; a byte-order mark dropped. */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

// column names, lower case, of every CSV this reads, for each part of an entry
const COLUMNS = {
  name: ['name', 'title', 'item name', 'account'],
  url: ['url', 'uri', 'login_uri', 'website', 'web site', 'login url', 'urls'],
  username: ['username', 'login_username', 'user name', 'login', 'email', 'user', 'username1'],
  password: ['password', 'login_password'],
  notes: ['notes', 'note', 'extra', 'comments', 'comment'],
  totp: ['totp', 'login_totp', 'otpauth', 'otp', 'otpsecret', 'one-time password', 'otp secret'],
  tags: ['folder', 'group', 'tags', 'grouping', 'category', 'vault'],
  fav: ['favorite', 'fav', 'favourite'],
  type: ['type'],
};

/** A 2FA value as a manager writes it: an otpauth:// link, or the bare secret. */
function totpOf(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const e = s.startsWith('otpauth:') ? parseOtpauth(s) : cleanEntry({ secret: s });
  return e ? { secret: e.secret, algorithm: e.algorithm, digits: e.digits, period: e.period } : null;
}

const hostOf = (url) => {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const truthy = (v) => /^(1|true|yes|x)$/i.test(String(v || '').trim());

/** Entries from a CSV with a header row; null when the header names nothing this knows. */
export function fromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 1) return null;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [part, names] of Object.entries(COLUMNS)) col[part] = names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  if (col.password < 0 && col.totp < 0 && col.notes < 0) return null;
  const at = (r, part) => (col[part] >= 0 ? String(r[col[part]] ?? '') : '');
  return rows.slice(1).map((r) => {
    const url = at(r, 'url').trim();
    const urls = url ? url.split(/[,\s]+/).filter(Boolean) : [];
    const type = /note/i.test(at(r, 'type')) ? 'note' : 'login';
    const tag = at(r, 'tags').trim().replace(/^Root\//, '');
    return {
      type,
      name: at(r, 'name').trim() || hostOf(urls[0] || '') || at(r, 'username').trim(),
      username: at(r, 'username'),
      password: at(r, 'password'),
      urls,
      notes: at(r, 'notes'),
      totp: totpOf(at(r, 'totp')),
      tags: tag && tag !== 'Root' ? [tag] : [],
      fav: truthy(at(r, 'fav')),
    };
  });
}

/** Entries from Bitwarden's JSON export (not the encrypted one). */
function fromBitwarden(json) {
  if (json.encrypted) throw fail('pw.import.encrypted', 'This export is encrypted: export it from Bitwarden as plain JSON.');
  const folders = new Map((json.folders || []).map((f) => [f.id, f.name]));
  return (json.items || []).map((i) => {
    const base = {
      name: i.name || '',
      notes: i.notes || '',
      fav: Boolean(i.favorite),
      tags: i.folderId && folders.get(i.folderId) ? [folders.get(i.folderId)] : [],
      fields: (i.fields || []).map((f) => ({ name: f.name || '', value: f.value || '', hidden: f.type === 1 })),
    };
    if (i.type === 1)
      return {
        ...base,
        type: 'login',
        username: i.login?.username || '',
        password: i.login?.password || '',
        urls: (i.login?.uris || []).map((u) => u.uri).filter(Boolean),
        totp: totpOf(i.login?.totp),
      };
    if (i.type === 3)
      return {
        ...base,
        type: 'card',
        card: {
          holder: i.card?.cardholderName || '',
          number: i.card?.number || '',
          exp: i.card?.expMonth && i.card?.expYear ? `${String(i.card.expMonth).padStart(2, '0')}/${String(i.card.expYear).slice(-2)}` : '',
          code: i.card?.code || '',
          brand: i.card?.brand || '',
        },
      };
    if (i.type === 4) {
      // an identity: kept as a note, its parts as fields
      const id = i.identity || {};
      const fields = Object.entries(id)
        .filter(([, v]) => typeof v === 'string' && v)
        .map(([k, v]) => ({ name: k, value: v, hidden: false }));
      return { ...base, type: 'note', fields: [...fields, ...base.fields] };
    }
    return { ...base, type: 'note' };
  });
}

/** Entries from KeePass 2's XML export (DOMParser: in a page). */
function fromKeePass(text) {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.querySelector('KeePassFile')) return null;
  const out = [];
  const walk = (group, path) => {
    const name = group.querySelector(':scope > Name')?.textContent || '';
    const here = path ? `${path}/${name}` : '';
    if (/^recycle bin$/i.test(name)) return;
    for (const entry of group.querySelectorAll(':scope > Entry')) {
      const s = {};
      for (const str of entry.querySelectorAll(':scope > String')) s[str.querySelector('Key')?.textContent || ''] = str.querySelector('Value')?.textContent || '';
      const known = ['Title', 'UserName', 'Password', 'URL', 'Notes', 'otp', 'TOTP Seed'];
      out.push({
        type: 'login',
        name: s.Title || hostOf(s.URL || ''),
        username: s.UserName || '',
        password: s.Password || '',
        urls: s.URL ? [s.URL] : [],
        notes: s.Notes || '',
        totp: totpOf(s.otp || s['TOTP Seed']),
        tags: here ? [here] : [],
        fields: Object.entries(s)
          .filter(([k]) => !known.includes(k))
          .map(([k, v]) => ({ name: k, value: v, hidden: true })),
      });
    }
    for (const child of group.querySelectorAll(':scope > Group')) walk(child, here);
  };
  const root = doc.querySelector('KeePassFile > Root > Group');
  if (root) walk(root, '');
  return out;
}

/** 2FA secrets from otpauth:// links and Google Authenticator exports, one per line; null when there are none. */
function fromLinks(text) {
  const out = [];
  for (const line of String(text).split(/\s+/)) {
    if (line.startsWith('otpauth-migration:')) out.push(...parseMigration(line));
    else if (line.startsWith('otpauth:')) {
      const e = parseOtpauth(line);
      if (e) out.push(e);
    }
  }
  return out.length ? out.map(fromAuthenticator) : null;
}

/**
 * The entries in a file another manager (or this vault) wrote; null when the file is none of the formats.
 * @param {string} text
 * @param {string} [name]  the file's name, for a hint at its kind
 * @returns {any[] | null}
 */
export function importFile(text, name = '') {
  const s = String(text).replace(/^﻿/, '').trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    let json;
    try {
      json = JSON.parse(s);
    } catch {
      return null;
    }
    if (json?.type === EXPORT_TYPE && Array.isArray(json.items)) return json.items;
    if (Array.isArray(json?.items)) return fromBitwarden(json);
    return null;
  }
  if (s.startsWith('<')) return fromKeePass(s);
  if (/^otpauth/m.test(s) && !/\.csv$/i.test(name) && !s.split('\n')[0].includes(',')) return fromLinks(s);
  return fromCsv(s);
}
