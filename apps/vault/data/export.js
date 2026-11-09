// The vault's entries in plain formats for another manager: a JSON file of
// this vault's own shape, and a CSV in Bitwarden's columns (which Bitwarden,
// Proton Pass, KeePassXC and the browsers read). Both hold every secret in
// plain text; the settings say so before they are saved.
import { otpauthOf } from '../../../shared/totp.js';

export const EXPORT_TYPE = 'kiwi-vault-export';

/** Every entry as it is, without its address. */
export function toJson(items) {
  return JSON.stringify(
    {
      type: EXPORT_TYPE,
      v: 1,
      exported: new Date().toISOString(),
      items: items.map(({ id, ...rest }) => rest),
    },
    null,
    1,
  );
}

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A field of the CSV that holds custom fields: one "name: value" per line, as Bitwarden writes them. */
const fieldsCell = (fields) => fields.map((f) => `${f.name}: ${f.value}`).join('\n');

/** Logins and notes in Bitwarden's CSV columns (cards and keys are left to the JSON export). */
export function toCsv(items) {
  const head = ['folder', 'favorite', 'type', 'name', 'notes', 'fields', 'reprompt', 'login_uri', 'login_username', 'login_password', 'login_totp'];
  const rows = items
    .filter((i) => i.type === 'login' || i.type === 'note' || i.type === 'totp')
    .map((i) => [
      i.tags[0] || '',
      i.fav ? 1 : '',
      i.type === 'note' ? 'note' : 'login',
      i.name,
      i.notes,
      fieldsCell(i.fields),
      0,
      i.urls.join(','),
      i.username,
      i.password,
      i.totp ? otpauthOf({ issuer: i.name, account: i.username, ...i.totp }) : '',
    ]);
  return `${[head, ...rows].map((r) => r.map(cell).join(',')).join('\n')}\n`;
}
