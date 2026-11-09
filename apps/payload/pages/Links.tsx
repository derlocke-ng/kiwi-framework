// Links: the links made here (the app's settings, sealed to the person's key,
// so every device of the account has them), newest first: copied again, or
// deleted, which removes the files from the media servers so the link opens
// nothing any more.
import { useState } from 'react';
import { relTime, tErr } from '../../../shared/i18n.js';
import { Icon } from '../../../ui/components';
import { confirmDialog } from '../../../ui/dialogs';
import { useIdentity, useT } from '../../../ui/hooks';
import { copyText, toast } from '../../../ui/toast';
import { Tabs } from '../App';
import { deleteShare } from '../data/shares.js';
import { size, usePrefs } from '../state';

export function Links() {
  const t = useT();
  const prefs = usePrefs();
  const id = useIdentity();
  const shares: any[] = prefs.get('shares') || [];
  const [busy, setBusy] = useState('');
  const remove = async (s: any) => {
    if (!(await confirmDialog({ title: t('pl.deleteTitle'), message: t('pl.deleteText', { n: s.files.length }), confirm: t('common.delete'), danger: true })))
      return;
    setBusy(s.x);
    try {
      const { kept } = await deleteShare(s, id.sk);
      await prefs.set({ shares: (prefs.get('shares') || []).filter((x: any) => x.x !== s.x) });
      toast(kept ? t('pl.deletedSome', { n: kept }) : t('pl.deleted'), kept ? 'info' : 'success', kept ? 8000 : 3200);
    } catch (err) {
      toast(tErr(err), 'error');
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="pl-page">
      <div className="app-bar">
        <Tabs page="links" />
      </div>
      {shares.length ? (
        <ul className="pl-list" id="links">
          {shares.map((s) => {
            const first = s.files[0]?.name || '';
            const total = s.files.reduce((n: number, f: any) => n + (f.size || 0), 0);
            return (
              <li key={s.x} className="pl-item" data-link={first}>
                <Icon name="link" />
                <span className="pl-what">
                  <b>{s.files.length > 1 ? t('pl.andMore', { name: first, n: s.files.length - 1 }) : first}</b>
                  <span className="muted small">{[size(total), relTime(s.at)].join(' · ')}</span>
                </span>
                <span className="pl-buttons">
                  <button
                    type="button"
                    className="btn"
                    data-act="copy-link"
                    onClick={() => void copyText(s.link, t('pl.theLink'))}
                    aria-label={t('pl.copyLink')}
                  >
                    <Icon name="copy" />
                    <span className="phone-hide">{t('pl.copy')}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    data-act="delete-link"
                    disabled={busy === s.x}
                    onClick={() => void remove(s)}
                    aria-label={t('common.delete')}
                  >
                    <Icon name="trash-2" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty" id="linksEmpty">
          {t('pl.linksEmpty')}
        </p>
      )}
      <p className="muted small pl-foot">{t('pl.linksNote')}</p>
      <a className="btn btn-primary fab" href="#/" id="newSend">
        <Icon name="plus" />
        <span>{t('pl.sendFiles')}</span>
      </a>
    </div>
  );
}
