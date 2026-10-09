// Sharing a board: an edit or a view link (the keys ride in the fragment),
// copy, the system share sheet, a QR code, or straight to friends, whose
// copy of the app adds the board to their wallet.
import { useState } from 'react';
import { tErr } from '../../../shared/i18n.js';
import qrcode from '../../../shared/qrcode.mjs';
import { Icon } from '../../../ui/components';
import { pickPeople } from '../../../ui/dialogs';
import { useKiwi, usePeople, useT } from '../../../ui/hooks';
import { copyText, toast } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import type { Board } from '../data/boards.js';
import { shareLink } from '../data/links.js';
import { pageBase } from '../state';

/** The QR code as one SVG path (no inline styles, so it passes the content security policy). */
function Qr({ text, label }: { text: string; label: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  const size = n + 8;
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <rect width={size} height={size} className="qr-bg" />
      <path d={d} className="qr-fg" />
    </svg>
  );
}

export function ShareDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const t = useT();
  const kiwi = useKiwi();
  const people = usePeople();
  const roles = board.canEdit ? (['edit', 'view'] as const) : (['view'] as const);
  const [role, setRole] = useState<'edit' | 'view'>(roles[0]);
  const [qr, setQr] = useState(false);
  const url = shareLink(pageBase(), { pub: board.pub, w: board.w, k: board.k }, role);
  const toFriends = async () => {
    const pks: string[] = await pickPeople(people, { base: kiwi.base });
    if (!pks.length) return;
    const keys = role === 'edit' ? { w: board.w } : { k: board.k };
    try {
      // The link and the board's keys for this role, wrapped for each friend; their copy of the app adds the board.
      const n = await people.share(
        'loadout',
        { type: 'board', url, board: { pub: board.pub, kind: board.info.type, mode: board.info.mode, title: board.info.title, ...keys } },
        pks,
      );
      toast(t('people.sent', { n }), 'success');
    } catch (err) {
      toast(tErr(err), 'error');
    }
  };
  return (
    <Modal open title={t('share.title', { title: board.info.title })} onClose={onClose}>
      {roles.length > 1 ? (
        <div className="seg" role="radiogroup" aria-label={t('share.access')}>
          <label>
            <input type="radio" name="role" value="edit" checked={role === 'edit'} onChange={() => setRole('edit')} />
            <span>
              <Icon name="pencil" />
              {t('share.canEdit')}
            </span>
          </label>
          <label>
            <input type="radio" name="role" value="view" checked={role === 'view'} onChange={() => setRole('view')} />
            <span>
              <Icon name="eye" />
              {t('share.viewOnly')}
            </span>
          </label>
        </div>
      ) : null}
      <p className="modal-text" id="roleText" dangerouslySetInnerHTML={{ __html: t(role === 'edit' ? 'share.explainEdit' : 'share.explainView') }} />
      <div className="copy-field">
        <input id="shareUrl" readOnly aria-label={t('share.link')} spellCheck={false} value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-primary" data-act="copy" onClick={() => void copyText(url)}>
          <Icon name="copy" />
          <span>{t('common.copy')}</span>
        </button>
      </div>
      <div className="share-row">
        {'share' in navigator ? (
          <button
            type="button"
            className="btn"
            data-act="native"
            onClick={() => navigator.share({ title: board.info.title, text: board.info.title, url }).catch(() => {})}
          >
            <Icon name="share-2" />
            <span>{t('share.native')}</span>
          </button>
        ) : null}
        <button type="button" className="btn" data-act="qr" onClick={() => setQr((q) => !q)}>
          <Icon name="qr-code" />
          <span>{t('share.qr')}</span>
        </button>
        {people ? (
          <button type="button" className="btn" data-act="friends" onClick={() => void toFriends()}>
            <Icon name="users" />
            <span>{t('share.friends')}</span>
          </button>
        ) : null}
      </div>
      {qr ? (
        <div className="qr-box" id="qrBox">
          <Qr text={url} label={t('share.qrAlt')} />
        </div>
      ) : null}
      <p className="hint">
        <Icon name="key-round" /> <span dangerouslySetInnerHTML={{ __html: t('share.hint') }} />
      </p>
    </Modal>
  );
}
