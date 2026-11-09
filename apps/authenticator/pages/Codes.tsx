// The codes: one card per account, the current code large, how long it has
// left as a shrinking bar, the next code when the current one is about to go.
// A tap copies the code. Each card's menu pins it to the top, renames it,
// shows its QR code (to move it to another authenticator) or deletes it (from
// a login of the password manager: its 2FA secret only). The round button adds
// one; the bar locks the vault and, with many accounts, searches them.
import { useEffect, useMemo, useState } from 'react';
import { qrSvg } from '../../../shared/qr.js';
import { otpauthOf, spaced, totp } from '../../../shared/totp.js';
import { Icon } from '../../../ui/components';
import { confirmDialog, openMenu } from '../../../ui/dialogs';
import { useT } from '../../../ui/hooks';
import { copyText, toast } from '../../../ui/toast';
import { useVault } from '../../../ui/vault/VaultProvider';
import { Modal } from '../../../ui/widgets/Modal';
import { type Entry, useEntries } from '../state';
import { AddSheet } from './AddSheet';

/** The codes of all entries, computed again every second (cheap: a few HMACs). */
function useCodes(items: Entry[]) {
  const [now, setNow] = useState(() => Date.now());
  const [codes, setCodes] = useState<Record<string, { code: string; next: string; left: number; period: number }>>({});
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all(items.map(async (e) => [e.id, await totp(e, now)] as const)).then((pairs) => live && setCodes(Object.fromEntries(pairs)));
    return () => {
      live = false;
    };
  }, [items, now]);
  return codes;
}

export function Codes() {
  const t = useT();
  const vault = useVault();
  const entries = useEntries();
  const codes = useCodes(entries);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [showing, setShowing] = useState<Entry | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.issuer} ${e.account}`.toLowerCase().includes(q)) : entries;
  }, [entries, query]);
  const copy = (e: Entry) => {
    const c = codes[e.id];
    if (c) void copyText(c.code, t('au.theCode'));
  };
  const remove = async (e: Entry) => {
    const login = e.item.type !== 'totp'; // a login of the password manager keeps everything but its 2FA secret
    if (
      !(await confirmDialog({
        title: t('au.deleteTitle', { name: e.issuer || e.account }),
        message: login ? t('au.deleteFromLogin') : t('au.deleteText'),
        confirm: t('common.delete'),
        danger: true,
      }))
    )
      return;
    if (login) await vault.store.put({ id: e.id, totp: null });
    else await vault.store.remove(e.id);
    toast(t('au.deleted'), 'success');
  };
  const pin = (e: Entry) => vault.store.put({ id: e.id, fav: !e.item.fav });
  return (
    <div className="au-page">
      <div className="app-bar">
        {entries.length > 4 ? (
          <input
            className="search"
            type="search"
            id="search"
            placeholder={t('au.search')}
            aria-label={t('au.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : (
          <strong className="au-count">{t('au.count', { n: entries.length })}</strong>
        )}
        <button type="button" className="btn" id="lockBtn" onClick={() => vault.lock()}>
          <Icon name="lock" />
          <span>{t('au.lock')}</span>
        </button>
        <button type="button" className="btn btn-primary fab" id="addBtn" onClick={() => setAdding(true)}>
          <Icon name="plus" />
          <span>{t('au.add')}</span>
        </button>
      </div>
      {shown.length ? (
        <ul className="au-list" id="codes">
          {shown.map((e) => {
            const c = codes[e.id];
            const soon = c && c.left <= 5;
            return (
              <li key={e.id} className={`au-card${soon ? ' soon' : ''}`} data-entry={e.issuer || e.account}>
                <button type="button" className="au-main" onClick={() => copy(e)} aria-label={t('au.copyFor', { name: e.issuer || e.account })}>
                  <span className="au-who">
                    <b>{e.issuer || e.account}</b>
                    {e.issuer && e.account ? <span className="muted small">{e.account}</span> : null}
                  </span>
                  <span className="au-code" data-code={c?.code || ''}>
                    {c ? spaced(c.code) : '··· ···'}
                  </span>
                  <span className="au-time" aria-hidden="true">
                    <span style={{ width: `${c ? (c.left / c.period) * 100 : 0}%` }} />
                  </span>
                  <span className="au-next muted small">{soon && c ? t('au.next', { code: spaced(c.next) }) : c ? t('au.left', { s: c.left }) : ''}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  data-act="menu"
                  aria-label={t('au.more')}
                  onClick={(ev) =>
                    openMenu(ev.currentTarget, [
                      { label: t('au.copy'), icon: 'copy', act: 'copy', run: () => copy(e) },
                      { label: t('au.edit'), icon: 'pencil', act: 'edit', run: () => setEditing(e) },
                      { label: t('au.showQr'), icon: 'qr-code', act: 'qr', run: () => setShowing(e) },
                      e.item.fav
                        ? { label: t('au.unpin'), icon: 'pin-off', act: 'unpin', run: () => pin(e) }
                        : { label: t('au.pin'), icon: 'pin', act: 'pin', run: () => pin(e) },
                      '-',
                      { label: t('common.delete'), icon: 'trash-2', act: 'delete', danger: true, run: () => remove(e) },
                    ])
                  }
                >
                  <Icon name="ellipsis" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty" id="codesEmpty">
          {query ? t('au.noMatch') : t('au.empty')}
        </p>
      )}
      {shown.length ? <p className="muted small au-foot">{t('au.tapToCopy')}</p> : null}
      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}
      {editing ? <EditSheet entry={editing} onClose={() => setEditing(null)} /> : null}
      {showing ? <QrSheet entry={showing} onClose={() => setShowing(null)} /> : null}
    </div>
  );
}

/** A new name for an account (the issuer and the account shown); the secret stays as it is. */
function EditSheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const t = useT();
  const vault = useVault();
  const [issuer, setIssuer] = useState(entry.issuer);
  const [account, setAccount] = useState(entry.account);
  return (
    <Modal open id="editSheet" title={t('au.editTitle')} onClose={onClose}>
      <form
        className="form"
        id="editForm"
        onSubmit={async (ev) => {
          ev.preventDefault();
          await vault.store.put({ id: entry.id, name: issuer, username: account });
          onClose();
        }}
      >
        <label className="field">
          <span>{t('au.issuer')}</span>
          <input name="issuer" value={issuer} maxLength={80} onChange={(e) => setIssuer(e.target.value)} data-autofocus />
        </label>
        <label className="field">
          <span>{t('au.account')}</span>
          <input name="account" value={account} maxLength={120} onChange={(e) => setAccount(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" data-close onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('au.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** An account's QR code, for another authenticator: shown only on request, with a word on what it is. */
function QrSheet({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const t = useT();
  const uri = otpauthOf(entry);
  return (
    <Modal open id="qrSheet" title={entry.issuer || entry.account} onClose={onClose}>
      <p className="hint">{t('au.qrWarning')}</p>
      <div className="qr-box au-qr" dangerouslySetInnerHTML={{ __html: qrSvg(uri) }} />
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" data-close onClick={onClose}>
          {t('au.done')}
        </button>
      </div>
    </Modal>
  );
}
