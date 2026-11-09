// A mount that asks for an account: `requireAccount: true` on the mount in
// distribution.js, `policy.requireAccount` for every mount, or the host's
// hub.local.json (`accountMounts`). Someone on a key alone (the one this
// browser made, or one they pasted) sees why the hub asks, in the
// distribution's words for that mount (`hub.<mount>.account` in its locales)
// or the framework's, and a way to the account page; once signed in or
// registered there, they come back to where they were. A key someone already
// uses can be given a username and password: creating an account keeps it.
//
// This is a rule of this hub's pages, not a lock on the data: what the mount
// shows is on relays, where other clients read it as before.
import type { ReactNode } from 'react';
import { accountRequired, mountById } from '../shared/apps.js';
import { DISTRIBUTION } from '../shared/distribution.js';
import { has } from '../shared/i18n.js';
import { Icon } from './components';
import { useIdentity, useKiwi, useT } from './hooks';

export const RETURN_KEY = 'wjs.returnTo';
const RETURN_FOR = 3_600_000; // an hour: a way back that old is forgotten

/** Remember where to come back to after signing in (this tab only). */
export function rememberReturn(url: string, name: string): void {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ url, name, at: Date.now() }));
  } catch {
    /* no session storage: the person finds their way back */
  }
}

/** The page that sent the person to sign in, when there is one on this site. */
export function pendingReturn(): { url: string; name: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null');
    if (v && typeof v.url === 'string' && new URL(v.url).origin === location.origin && Date.now() - Number(v.at || 0) < RETURN_FOR)
      return { url: v.url, name: String(v.name || '') };
  } catch {
    /* nothing usable */
  }
  return null;
}

/** The way back, once: it is forgotten as it is taken. */
export function takeReturn(): { url: string; name: string } | null {
  const v = pendingReturn();
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* nothing to forget */
  }
  return v;
}

/** The page, or the gate when this mount asks for an account the person does not have. */
export function RequireAccount({ children }: { children: ReactNode }) {
  const kiwi = useKiwi();
  const t = useT();
  const id = useIdentity();
  if (!accountRequired(kiwi.current) || id.accountPk) return <>{children}</>;
  const name = mountById(kiwi.current)?.name || kiwi.current;
  const own = `hub.${kiwi.current}.account`;
  const why = has(own) ? t(own) : t('gate.account.why', { app: name });
  const go = () => {
    rememberReturn(location.href, name);
    location.href = `${kiwi.base}settings.html#account`;
  };
  return (
    <div
      className="wjs-gate wjs-account-gate"
      id="accountGate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="accountGateTitle"
      aria-describedby="accountGateWhy"
    >
      <div className="wjs-gate-card">
        <Icon name="key-round" />
        <h2 id="accountGateTitle">{t('gate.account.title', { app: name })}</h2>
        <p id="accountGateWhy">{why}</p>
        <p className="muted small">{t(id.imported || id.alias ? 'gate.account.keyText' : 'gate.account.text')}</p>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" id="accountGateGo" onClick={go}>
            {t('gate.account.go')}
          </button>
          <a className="btn btn-ghost" href={kiwi.base}>
            {t('gate.account.home', { hub: DISTRIBUTION.name })}
          </a>
        </div>
      </div>
    </div>
  );
}
