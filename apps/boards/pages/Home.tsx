// The start page: your boards and notes in your order, the starters, and
// the dialogs to make a board or open a link.
import { type FormEvent, useState } from 'react';
import { relTime, tErr } from '../../../shared/i18n.js';
import { store } from '../../../shared/util.js';
import { Icon } from '../../../ui/components';
import { useIdentity, useKiwi, useT } from '../../../ui/hooks';
import { toast } from '../../../ui/toast';
import { Modal } from '../../../ui/widgets/Modal';
import { useSortable } from '../../../ui/widgets/useSortable';
import { createBoard } from '../data/boards.js';
import { boardHash, parseBoardInput } from '../data/links.js';
import { fillBoard, KINDS, kindOf, starters } from '../data/starters.js';
import { go, useBoardsSettings, useWallet } from '../state';

const TITLE = 120;
type Kind = 'check' | 'count' | 'note';
const fail = (err: unknown) => toast(tErr(err), 'error');

function Starters({ compact = false, onPick }: { compact?: boolean; onPick: (s: { kind: Kind; title: string; text: string }) => void }) {
  const t = useT();
  const settings = useBoardsSettings();
  return (
    <div className={`starters ${compact ? 'compact' : ''}`.trim()}>
      {starters(settings, t).map((s) => (
        <button
          key={s.key}
          type="button"
          className="starter"
          data-new={s.kind}
          data-starter={s.key}
          onClick={() => onPick({ kind: s.kind as Kind, title: s.title, text: s.text })}
        >
          <span className={`board-icon kind-${s.kind}`}>
            <Icon name={KINDS[s.kind as Kind].icon} />
          </span>
          <strong>{s.title}</strong>
          <small>{s.hint}</small>
        </button>
      ))}
    </div>
  );
}

/** Starters above the board list: there when wanted, one tap to hide, one tap to bring back. */
function StartersRow({ onPick }: { onPick: (s: { kind: Kind; title: string; text: string }) => void }) {
  const t = useT();
  const settings = useBoardsSettings();
  const set = (show: boolean) => settings.set({ showStarters: show }).catch(fail);
  if (!(settings.get('showStarters', true) ?? true)) {
    return (
      <p className="starters-toggle">
        <button type="button" className="link-btn" data-act="show-starters" onClick={() => set(true)}>
          <Icon name="plus" />
          {t('home.starters.show')}
        </button>
      </p>
    );
  }
  return (
    <section className="starters-row" aria-label={t('home.starters.title')}>
      <div className="starters-head">
        <h2>{t('home.starters.title')}</h2>
        <a className="muted small" href="#/account">
          {t('home.starters.custom')}
        </a>
        <button
          type="button"
          className="icon-btn"
          data-act="hide-starters"
          aria-label={t('home.starters.hide')}
          title={t('home.starters.hide')}
          onClick={() => set(false)}
        >
          <Icon name="x" />
        </button>
      </div>
      <Starters compact onPick={onPick} />
    </section>
  );
}

function NewBoardDialog({ start, onClose }: { start: { kind: Kind; title: string; text: string }; onClose: () => void }) {
  const t = useT();
  const { net } = useKiwi();
  const wallet = useWallet();
  const [kind, setKind] = useState<Kind>(start.kind);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const title =
      String(new FormData(e.currentTarget).get('title') || '')
        .trim()
        .slice(0, TITLE) || t('common.untitled');
    setBusy(true);
    try {
      const entry = await createBoard({ type: kind === 'note' ? 'note' : 'list', mode: kind === 'count' ? 'count' : 'check', title }, net);
      if (start.text && kind === start.kind) await fillBoard(entry, kind, start.text, net); // the template fits the type it was made for
      await wallet.upsert(entry);
      onClose();
      go(boardHash({ pub: entry.pub }));
    } catch (err) {
      setBusy(false);
      fail(err);
    }
  };
  return (
    <Modal open title={t('home.new.title')} onClose={onClose}>
      <form className="form" id="newBoard" onSubmit={submit}>
        <div className="seg" role="radiogroup" aria-label={t('home.new.type')}>
          {(Object.keys(KINDS) as Kind[]).map((k) => (
            <label key={k}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>
                <Icon name={KINDS[k].icon} />
                {t(`type.${k}`)}
              </span>
            </label>
          ))}
        </div>
        <label className="field">
          {t('home.new.titleLabel')}
          {/* biome-ignore lint/a11y/noAutofocus: the dialog opens to type a title */}
          <input name="title" maxLength={TITLE} required defaultValue={start.title} placeholder={t('home.new.placeholder')} autoFocus />
        </label>
        <p className="hint">
          <Icon name="lock" /> {t('home.new.hint')}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('common.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OpenLinkDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const route = parseBoardInput(String(new FormData(e.currentTarget).get('link') || ''));
    if (!route) return toast(t('home.open.invalid'), 'error');
    onClose();
    go(boardHash(route));
  };
  return (
    <Modal open title={t('home.open.title')} onClose={onClose}>
      <form className="form" id="openLink" onSubmit={submit}>
        <label className="field">
          {t('home.open.label')}
          {/* biome-ignore lint/a11y/noAutofocus: the dialog opens to paste a link */}
          <input name="link" required placeholder={t('home.open.placeholder')} autoComplete="off" spellCheck={false} autoFocus />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary">
            {t('common.open')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Home() {
  const t = useT();
  const identity = useIdentity();
  const wallet = useWallet();
  useBoardsSettings();
  const [making, setMaking] = useState<{ kind: Kind; title: string; text: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const boards = wallet.list();
  const byPub = new Map(boards.map((b: any) => [b.pub, b]));

  // Your order: pinned boards stay above the others, so a card is ordered within its group.
  const sort = useSortable({
    ids: boards.map((b: any) => b.pub),
    onMove: async (id, order) => {
      const pinned = Boolean(byPub.get(id)?.pinned);
      const inGroup = (pub: string) => Boolean(byPub.get(pub)?.pinned) === pinned;
      const group = order.filter(inGroup);
      if (
        group.join() ===
        boards
          .map((b: any) => b.pub)
          .filter(inGroup)
          .join()
      )
        return false;
      try {
        await wallet.reorder(group, id);
      } catch (err) {
        fail(err);
        throw err;
      }
    },
  });
  const make = (kind: Kind) => setMaking({ kind, title: '', text: '' });
  const nudge = !identity.alias && boards.length > 0 && !store.get('loadout.lastBackup') && !store.get('wjs.lastBackup');

  return (
    <section className="home">
      <div className="home-head">
        <h1>{t('home.title')}</h1>
        <div className="home-actions">
          <button type="button" className="btn btn-primary" data-new="check" onClick={() => make('check')}>
            <Icon name="plus" />
            <span>{t('home.newList')}</span>
          </button>
          <button type="button" className="btn" data-new="note" onClick={() => make('note')}>
            <Icon name="notebook-pen" />
            <span>{t('home.newNote')}</span>
          </button>
          <button type="button" className="btn btn-ghost" data-open-link onClick={() => setOpening(true)}>
            <Icon name="link" />
            <span>{t('home.openLink')}</span>
          </button>
        </div>
      </div>
      {nudge ? (
        <div className="banner">
          <Icon name="shield" />
          <p dangerouslySetInnerHTML={{ __html: t('home.nudge') }} />
        </div>
      ) : null}
      {boards.length ? <StartersRow onPick={setMaking} /> : null}
      {boards.length ? (
        <ul className="boards" {...sort.listProps}>
          {sort.order.map((pub) => {
            const b = byPub.get(pub);
            if (!b) return null;
            const local = wallet.localOf(b.pub);
            const kind = kindOf(b) as Kind;
            const progress =
              kind === 'check' && local.total
                ? t('home.progress', { done: local.done || 0, total: local.total })
                : kind === 'count' && local.total
                  ? t('home.items', { n: local.total })
                  : '';
            const when = local.opened ? t('home.opened', { when: relTime(local.opened) }) : t('home.added', { when: relTime(b.added) });
            return (
              <li
                key={b.pub}
                className={`board-row${b.pinned ? ' pinned' : ''}${sort.draggingId === b.pub ? ' dragging' : ''}`}
                data-id={b.pub}
                ref={sort.rowRef(b.pub)}
                style={sort.rowStyle(b.pub)}
              >
                <button type="button" className="grip" aria-label={t('list.drag')} title={t('list.drag')} tabIndex={-1} {...sort.gripProps(b.pub)}>
                  <Icon name="grip-vertical" />
                </button>
                <a className="board-card" href={boardHash({ pub: b.pub })}>
                  <span className={`board-icon kind-${kind}`}>
                    <Icon name={KINDS[kind].icon} />
                  </span>
                  <span className="board-main">
                    <span className="board-title">{b.title || t('common.untitled')}</span>
                    <span className="board-meta">{[progress, when].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="board-badges">
                    {b.pinned ? (
                      <span className="chip" title={t('home.pinned')}>
                        <Icon name="pin" />
                      </span>
                    ) : null}
                    {b.w ? null : (
                      <span className="chip" title={t('home.viewOnly')}>
                        <Icon name="eye" />
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-home">
          <p className="lead">{t('home.emptyLead')}</p>
          <Starters onPick={setMaking} />
          <p className="hint" dangerouslySetInnerHTML={{ __html: t('home.emptyHint') }} />
        </div>
      )}
      {making ? <NewBoardDialog start={making} onClose={() => setMaking(null)} /> : null}
      {opening ? <OpenLinkDialog onClose={() => setOpening(false)} /> : null}
    </section>
  );
}
