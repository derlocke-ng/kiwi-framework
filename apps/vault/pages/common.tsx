// What the password manager's screens share: an icon for each kind of entry,
// the line under its name, a live 2FA code, and copying a secret (which the
// clipboard holds for a while only: it is emptied after 30 seconds if this
// page still has the focus, as other managers do).
import { useEffect, useState } from 'react';
import { spaced, totp } from '../../../shared/totp.js';
import { useT } from '../../../ui/hooks';
import { copyText } from '../../../ui/toast';
import type { VaultItem } from '../../../ui/vault/VaultProvider';

export const TYPE_ICON: Record<string, string> = {
  login: 'key-round',
  note: 'notebook',
  card: 'credit-card',
  totp: 'shield-check',
  ssh: 'square-terminal',
  ca: 'award',
  cert: 'file-badge',
  tls: 'file-badge',
};
export const NEW_TYPES = ['login', 'note', 'card', 'totp', 'ssh', 'tls', 'ca'];
export const KEY_TYPES = ['ssh', 'ca', 'cert'];

/** The line under an entry's name: who it is for, or what it is. */
export function subtitle(item: VaultItem, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (item.type === 'card') return item.card?.number ? `•••• ${item.card.number.replace(/\D/g, '').slice(-4)}` : item.card?.brand || '';
  if (item.type === 'note') return item.notes.split('\n')[0].slice(0, 80);
  if (item.ssh) return `${item.ssh.ca ? 'CA · ' : ''}${item.ssh.fingerprint.slice(0, 22)}…`;
  if (item.pki)
    return item.pki.notAfter
      ? `${t(`pw.ca.kind.${item.pki.kind}`)} · ${t('pw.keys.until', { date: new Date(item.pki.notAfter).toLocaleDateString() })}`
      : t('pw.tls.waiting');
  return item.username || (item.urls[0] ? hostOf(item.urls[0]) : '');
}

export function hostOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A link to open: an address as typed, with https:// when it has no scheme (and never javascript: or data:). */
export function openable(url: string): string | null {
  const u = url.includes('://') ? url : `https://${url}`;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/** Copy a secret, and empty the clipboard after 30 seconds while this page has the focus. */
export async function copySecret(text: string, what: string) {
  if (!(await copyText(text, what))) return;
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = null;
    if (document.hasFocus()) navigator.clipboard.writeText('').catch(() => {});
  }, 30_000);
}

/** The 2FA code of a secret, made again every second; null without one. */
export function useCode(secret: VaultItem['totp'] | null) {
  const [code, setCode] = useState<{ code: string; left: number; period: number } | null>(null);
  useEffect(() => {
    if (!secret) return setCode(null);
    let live = true;
    const tick = () =>
      totp(secret)
        .then((c) => live && setCode(c))
        .catch(() => live && setCode(null));
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [secret]);
  return code;
}

/** A 2FA code with its countdown, to copy. */
export function CodeLine({ secret }: { secret: NonNullable<VaultItem['totp']> }) {
  const t = useT();
  const code = useCode(secret);
  if (!code) return null;
  return (
    <button type="button" className="pw-code" data-code={code.code} onClick={() => void copySecret(code.code, t('pw.field.code'))}>
      <span className="pw-code-digits">{spaced(code.code)}</span>
      <span className="pw-code-left">{t('pw.left', { s: code.left })}</span>
    </button>
  );
}
